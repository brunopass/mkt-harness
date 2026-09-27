/**
 * Threads (www.threads.com; threads.net redirects there).
 *
 * Supported: post (text up to 500 chars + optional images/video), comment (= reply to a post URL).
 * Best effort: topic tags, polls and multi-post threads are not handled (post the first part, reply to continue).
 * Selectors written 2026-09-27. Calibrate with: mkt send <id> --dry-run
 */
import type { Page } from "playwright-core";
import { attachFiles, clickFirst, clickWhenEnabled, dryRunStop, firstVisible, maybeVisible, typeText, type Candidate, loginState } from "./helpers.js";
import { AdapterError, type AdapterEnv, type PlatformAdapter } from "./types.js";

const HOME = "https://www.threads.com/";

const LOGGED_IN: Candidate[] = [
  (p) => p.getByText(/^(what's new\?|o que há de novo\?|novidades\?|¿qué novedades hay\?|¿qué hay de nuevo\?)$/i),
  "a[href='/activity'], a[href$='/activity']",
];
const LOGGED_OUT: Candidate[] = [
  "a[href*='/login']",
  (p) => p.getByRole("link", { name: /^(log in|entrar|iniciar sesión)$/i }),
  (p) => p.getByRole("button", { name: /^(log in|entrar|iniciar sesión)$/i }),
  (p) => p.getByText(/continue with instagram|continuar com o instagram|continuar con instagram/i),
];

const dialog = (p: Page) => p.getByRole("dialog");
const snippet = (text: string) => (text.split("\n").find((l) => l.trim()) ?? "").trim().slice(0, 30);
const EDITOR: Candidate[] = [(p) => dialog(p).getByRole("textbox").first(), "div[role='dialog'] div[contenteditable='true']"];
const POST: Candidate[] = [(p) => dialog(p).getByRole("button", { name: /^(post|publicar|postar)$/i })];

async function submit(env: AdapterEnv, what: string): Promise<string | undefined> {
  const page = env.page;
  await clickWhenEnabled(page, "post", POST, 120_000);
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (!(await maybeVisible(page, EDITOR, 0))) break;
    await page.waitForTimeout(500);
  }
  if (Date.now() >= deadline) throw new AdapterError("verify", `${what} dialog did not close`, await env.shot("verify"));
  const view = await maybeVisible(page, [(p) => p.getByRole("link", { name: /^(view|ver)$/i })], 10_000);
  const href = view ? await view.getAttribute("href").catch(() => null) : null;
  return href ? new URL(href, HOME).toString() : undefined;
}

export const threads: PlatformAdapter = {
  platform: "threads",
  homeUrl: HOME,
  loginUrl: "https://www.threads.com/login",

  async isLoggedIn(env) {
    return loginState(env.page, { loggedIn: LOGGED_IN, loggedOut: LOGGED_OUT, outUrl: /\/login/ });
  },

  async post(env, { text, media }) {
    const page = env.page;
    if (text.length > 500) throw new AdapterError("text", `text is ${text.length} chars; Threads allows 500 per post (split into replies)`);
    await clickFirst(page, "open-composer", [
      (p) => p.getByText(/^(what's new\?|o que há de novo\?|novidades\?|¿qué novedades hay\?|¿qué hay de nuevo\?)$/i),
      (p) => p.getByRole("button", { name: /^(create|criar|crear)$/i }),
      "svg[aria-label='Create'], svg[aria-label='Criar'], svg[aria-label='Crear']",
    ]);
    await typeText(page, "text", EDITOR, text, { newline: "enter" });
    if (media.length) await attachFiles(page, "media", media, { input: "div[role='dialog'] input[type='file']" });
    await firstVisible(page, "post-button", POST, 15_000);
    if (env.dryRun) return dryRunStop(env, "threads-post");
    const url = await submit(env, "post");
    return { url, note: "posted", screenshot: await env.shot("sent") };
  },

  async comment(env, { url, text }) {
    const page = env.page;
    if (text.length > 500) throw new AdapterError("text", `reply is ${text.length} chars; Threads allows 500`);
    await env.goto(url);
    await clickFirst(page, "open-reply", [
      (p) => p.locator("main").getByRole("button", { name: /^(reply|responder)$/i }).first(),
      "main svg[aria-label='Reply'], main svg[aria-label='Responder']",
    ]);
    await typeText(page, "text", EDITOR, text, { newline: "enter" });
    await firstVisible(page, "post-button", POST, 15_000);
    if (env.dryRun) return dryRunStop(env, "threads-reply");
    const replyUrl = await submit(env, "reply");
    const seen = replyUrl || (await maybeVisible(page, [(p) => p.locator("main").getByText(snippet(text)).last()], 10_000));
    if (!seen) throw new AdapterError("verify", "reply did not appear", await env.shot("verify"));
    return { url: replyUrl ?? url, note: "reply posted", screenshot: await env.shot("sent") };
  },
};
