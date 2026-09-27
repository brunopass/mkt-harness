/**
 * X (x.com).
 *
 * Supported: post (text + up to 4 images or 1 video), comment (= reply to a post URL).
 * Best effort: dm (opens the profile's Message button, which lands in either legacy DMs or the 2025 "Chat" UI;
 * encrypted chats that ask for a passcode fail clearly).
 * Length: never truncates. Non-Premium accounts are capped at 280 weighted chars; when the Post button stays
 * disabled we fail with the reason instead of cutting the text.
 * Selectors written 2026-09-27. Calibrate with: mkt send <id> --dry-run
 */
import type { Page } from "playwright-core";
import { attachFiles, bareHandle, clickFirst, dryRunStop, firstVisible, maybeVisible, typeText, type Candidate, loginState } from "./helpers.js";
import { AdapterError, type AdapterEnv, type PlatformAdapter, type SendResult } from "./types.js";
import type { Recipient } from "../../core/schemas.js";

const HOME = "https://x.com/home";

const LOGGED_IN: Candidate[] = ["[data-testid='SideNav_NewTweet_Button']", "[data-testid='AppTabBar_Home_Link']", "[data-testid='SideNav_AccountSwitcher_Button']"];
const LOGGED_OUT: Candidate[] = [
  "#main-frame-error",
  "[data-testid='loginButton']",
  "[data-testid='signupButton']",
  (p) => p.getByRole("link", { name: /^(sign in|log in|entrar|iniciar sesión)$/i }),
  "input[autocomplete='username']",
];

const snippet = (text: string) => (text.split("\n").find((l) => l.trim()) ?? "").trim().slice(0, 30);

/** Weighted length per X rules (URLs = 23, CJK/emoji = 2). Used only to explain a disabled Post button. */
function weightedLength(text: string): number {
  const noUrls = text.replace(/https?:\/\/\S+/g, "x".repeat(23));
  let n = 0;
  for (const ch of noUrls) n += /[ᄀ-ￜ]|[\u{1F000}-\u{1FFFF}]/u.test(ch) ? 2 : 1;
  return n;
}

async function waitEnabled(page: Page, loc: Awaited<ReturnType<typeof firstVisible>>, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const disabled = await loc.evaluate((el) => (el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true").catch(() => true);
    if (!disabled) return true;
    await page.waitForTimeout(500);
  }
  return false;
}

async function composeAndSubmit(env: AdapterEnv, opts: { text: string; media: string[]; button: Candidate[] }): Promise<void> {
  const page = env.page;
  await typeText(page, "text", ["[data-testid='tweetTextarea_0']", (p) => p.getByRole("textbox", { name: /post text|texto do post|texto del post/i })], opts.text, { newline: "enter" });
  if (opts.media.length) {
    if (opts.media.length > 4) throw new AdapterError("media", "X allows at most 4 images (or 1 video) per post");
    await attachFiles(page, "media", opts.media, { input: "input[data-testid='fileInput']" });
  }
  const btn = await firstVisible(page, "post-button", opts.button, 15_000);
  // uploads keep the button disabled until they finish; so does going over the length limit
  const enabled = await waitEnabled(page, btn, opts.media.length ? 180_000 : 8_000);
  if (!enabled) {
    const len = weightedLength(opts.text);
    const why = len > 280 ? `text is ${len} weighted chars (limit 280 without Premium): shorten it or split into a thread` : "media upload did not finish or X rejected the content";
    throw new AdapterError("post-button", `Post button stayed disabled: ${why}`, await env.shot("disabled"));
  }
}

async function sendDm(env: AdapterEnv, input: { to: Recipient; text: string }): Promise<SendResult> {
  const page = env.page;
  const h = input.to.handle ?? input.to.url;
  if (!h) throw new AdapterError("recipient", "X DM needs to.handle or to.url");
  if (input.to.url && /x\.com\/(messages|i\/chat)\//.test(input.to.url)) await env.goto(input.to.url);
  else {
    await env.goto(`https://x.com/${bareHandle(h)}`);
    const btn = await maybeVisible(page, ["[data-testid='sendDMFromProfile']", (p) => p.getByRole("button", { name: /^(message|mensagem|mensaje)$/i })], 10_000);
    if (!btn) throw new AdapterError("dm", "no Message button on the profile: this account does not accept DMs from you", await env.shot("no-dm"));
    await btn.click();
  }
  if (await maybeVisible(page, [(p) => p.getByText(/enter (your )?passcode|digite (sua|seu) (senha|código)|introduce (tu )?código/i)], 3_000))
    throw new AdapterError("dm", "X Chat asks for the encryption passcode: unlock chat by hand once in this profile", await env.shot("passcode"));
  const COMPOSER: Candidate[] = [
    "[data-testid='dmComposerTextInput']",
    (p) => p.getByRole("textbox", { name: /start a (new )?message|message|inicie uma (nova )?mensagem|mensagem|escribe un mensaje|inicia un mensaje|mensaje/i }),
    "[role='main'] textarea",
  ];
  await typeText(page, "composer", COMPOSER, input.text, { newline: "shift-enter" });
  if (env.dryRun) return dryRunStop(env, "x-dm");
  const send = await maybeVisible(page, ["[data-testid='dmComposerSendButton']", (p) => p.getByRole("button", { name: /^(send|enviar)$/i })], 3_000);
  if (send) await send.click();
  else await page.keyboard.press("Enter");
  const ok = await maybeVisible(page, [(p) => p.locator("[role='main']").getByText(snippet(input.text)).last()], 20_000);
  if (!ok) throw new AdapterError("verify", "sent message did not appear", await env.shot("verify"));
  return { url: page.url(), note: "message sent", screenshot: await env.shot("sent") };
}

async function toastUrl(page: Page): Promise<string | undefined> {
  const toast = await maybeVisible(page, ["[data-testid='toast']"], 15_000);
  if (!toast) return undefined;
  const href = await toast.locator("a[href*='/status/']").first().getAttribute("href").catch(() => null);
  return href ? new URL(href, "https://x.com").toString() : undefined;
}

export const x: PlatformAdapter = {
  platform: "x",
  homeUrl: HOME,
  loginUrl: "https://x.com/i/flow/login",

  async isLoggedIn(env) {
    return loginState(env.page, { loggedIn: LOGGED_IN, loggedOut: LOGGED_OUT, outUrl: /\/(i\/flow\/login|login|i\/flow\/signup)/ });
  },

  async post(env, { text, media }) {
    const page = env.page;
    await env.goto("https://x.com/compose/post");
    const BTN: Candidate[] = ["[role='dialog'] [data-testid='tweetButton']", "[data-testid='tweetButton']", "[data-testid='tweetButtonInline']"];
    await composeAndSubmit(env, { text, media, button: BTN });
    if (env.dryRun) return dryRunStop(env, "x-post");
    await clickFirst(page, "post", BTN);
    const url = await toastUrl(page);
    const closed = !(await maybeVisible(page, ["[role='dialog'] [data-testid='tweetTextarea_0']"], 0));
    if (!url && !closed) throw new AdapterError("verify", "composer still open and no 'sent' toast", await env.shot("verify"));
    return { url, note: "posted", screenshot: await env.shot("sent") };
  },

  async comment(env, { url, text }) {
    const page = env.page;
    await env.goto(url);
    const inline = await maybeVisible(page, ["[data-testid='tweetTextarea_0']"], 8_000);
    if (!inline) await clickFirst(page, "open-reply", ["article [data-testid='reply']"]);
    const BTN: Candidate[] = ["[data-testid='tweetButtonInline']", "[role='dialog'] [data-testid='tweetButton']"];
    await composeAndSubmit(env, { text, media: [], button: BTN });
    if (env.dryRun) return dryRunStop(env, "x-reply");
    await clickFirst(page, "reply", BTN);
    const replyUrl = await toastUrl(page);
    const ok = replyUrl || (await maybeVisible(page, [(p) => p.locator("article").getByText(snippet(text)).last()], 15_000));
    if (!ok) throw new AdapterError("verify", "reply did not appear", await env.shot("verify"));
    return { url: replyUrl ?? url, note: "reply posted", screenshot: await env.shot("sent") };
  },

  dm: (env, input) => sendDm(env, input),
  reply: (env, input) => sendDm(env, input),
};
