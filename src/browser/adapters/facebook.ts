/**
 * Facebook (www.facebook.com).
 *
 * Supported: post (to the logged-in profile, or to a Page when the account handle is the Page URL: we open the
 * Page first; the profile must already be switched to / able to post as that Page), comment (on a post URL).
 * Not supported: dm (Messenger web is a separate app; do it by hand with the browser tools).
 * Best effort: Page posting through the new Pages experience (if the composer only offers "post as you",
 * switch profile once by hand in this Chrome profile).
 * Selectors written 2026-09-27. Calibrate with: mkt send <id> --dry-run
 */
import type { Page } from "playwright-core";
import { attachFiles, clickFirst, clickWhenEnabled, dryRunStop, firstVisible, maybeVisible, typeText, type Candidate, loginState } from "./helpers.js";
import { AdapterError, type PlatformAdapter } from "./types.js";

const HOME = "https://www.facebook.com/";

const LOGGED_IN: Candidate[] = [
  (p) => p.getByRole("button", { name: /what's on your mind|no que você está pensando|¿qué estás pensando|en qué estás pensando/i }),
  "[aria-label='Your profile'], [aria-label='Seu perfil'], [aria-label='Tu perfil']",
  (p) => p.getByRole("navigation", { name: /^facebook$/i }),
];
const LOGGED_OUT: Candidate[] = ["input[name='email']", "button[name='login']", "form[data-testid='royal_login_form']"];

const dialog = (p: Page) => p.getByRole("dialog");
const snippet = (text: string) => (text.split("\n").find((l) => l.trim()) ?? "").trim().slice(0, 30);

export const facebook: PlatformAdapter = {
  platform: "facebook",
  homeUrl: HOME,
  loginUrl: "https://www.facebook.com/login",

  async isLoggedIn(env) {
    return loginState(env.page, { loggedIn: LOGGED_IN, loggedOut: LOGGED_OUT, outUrl: /\/login|\/checkpoint/ });
  },

  async post(env, { text, media }) {
    const page = env.page;
    if (/^https?:\/\//i.test(env.account.handle)) await env.goto(env.account.handle);
    await clickFirst(page, "open-composer", [
      (p) => p.getByRole("button", { name: /what's on your mind|no que você está pensando|¿qué estás pensando|en qué estás pensando|write something|escreva algo|escribe algo|create (a )?post|criar publicação|crear publicación/i }),
    ]);
    const EDITOR: Candidate[] = [(p) => dialog(p).getByRole("textbox").first(), "div[role='dialog'] div[contenteditable='true'][role='textbox']"];
    await typeText(page, "text", EDITOR, text, { newline: "enter" });
    if (media.length) {
      await attachFiles(page, "media", media, {
        input: "div[role='dialog'] input[type='file'][accept*='image'], div[role='dialog'] input[type='file']",
        trigger: [(p) => dialog(p).getByRole("button", { name: /^(photo\/video|foto\/vídeo|foto\/video)$/i })],
      });
      await page.waitForTimeout(2_000);
    }
    // some flows (Pages, media) add a "Next" step before "Post"
    const next = await maybeVisible(page, [(p) => dialog(p).getByRole("button", { name: /^(next|avançar|siguiente)$/i })], 2_000);
    if (next) await next.click();
    const POST: Candidate[] = [(p) => dialog(p).getByRole("button", { name: /^(post|publicar|postar)$/i })];
    await firstVisible(page, "post-button", POST, 20_000);
    if (env.dryRun) return dryRunStop(env, "facebook-post");
    await clickWhenEnabled(page, "post", POST, 120_000);
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      if (!(await maybeVisible(page, EDITOR, 0))) break;
      await page.waitForTimeout(500);
    }
    if (Date.now() >= deadline) throw new AdapterError("verify", "post dialog did not close", await env.shot("verify"));
    return { note: "posted", screenshot: await env.shot("sent") };
  },

  async comment(env, { url, text }) {
    const page = env.page;
    await env.goto(url);
    const BOX: Candidate[] = [
      (p) => p.getByRole("textbox", { name: /write a (public )?comment|comment as|escreva um comentário|comentar como|escribe un comentario|comenta como/i }),
    ];
    await typeText(page, "comment", BOX, text, { newline: "shift-enter" });
    if (env.dryRun) return dryRunStop(env, "facebook-comment");
    await page.keyboard.press("Enter");
    const ok = await maybeVisible(page, [(p) => p.getByRole("article").getByText(snippet(text)).last()], 20_000);
    if (!ok) throw new AdapterError("verify", "comment did not appear", await env.shot("verify"));
    return { url, note: "comment posted", screenshot: await env.shot("sent") };
  },
};
