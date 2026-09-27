/**
 * Instagram (www.instagram.com), professional or personal account.
 *
 * Supported: post (feed photo/video/carousel; media required), dm (profile "Message" button, falls back to
 * direct/new search), comment (on a post URL).
 * Best effort: readInbox (Instagram's DM markup is obfuscated; direction is inferred from bubble alignment),
 * reels-specific options (cover, audio) are left at defaults.
 * Selectors written 2026-09-27. Calibrate with: mkt send <id> --dry-run
 */
import type { Page } from "playwright-core";
import { attachFiles, bareHandle, clickFirst, clickWhenEnabled, dryRunStop, firstVisible, maybeVisible, typeText, type Candidate, loginState } from "./helpers.js";
import { AdapterError, type AdapterEnv, type InboxMessage, type InboxThread, type PlatformAdapter, type SendResult } from "./types.js";
import type { Recipient } from "../../core/schemas.js";

const HOME = "https://www.instagram.com/";

const LOGGED_IN: Candidate[] = [
  "svg[aria-label='Home'], svg[aria-label='Página inicial'], svg[aria-label='Inicio']",
  "a[href='/direct/inbox/']",
  "svg[aria-label='New post'], svg[aria-label='Nova publicação'], svg[aria-label='Nueva publicación']",
];
const LOGGED_OUT: Candidate[] = [
  // CSS on purpose: the EU cookie modal marks the page aria-hidden, which hides it from getByRole
  "input[name='pass']",
  "input[name='username']",
  (p) => p.getByRole("button", { name: /^(log in|entrar|iniciar sesión)$/i }),
  (p) => p.getByRole("link", { name: /^(log in|entrar|iniciar sesión|sign up|cadastre-se|regístrate)$/i }),
];

const dialog = (p: Page) => p.getByRole("dialog");
const snippet = (text: string) => (text.split("\n").find((l) => l.trim()) ?? "").trim().slice(0, 30);
const NEXT = /^(next|avançar|siguiente)$/i;

/** "Turn on notifications", "Save login info" and similar interstitials. */
async function dismissPopups(page: Page): Promise<void> {
  for (let i = 0; i < 2; i++) {
    const b = await maybeVisible(page, [(p) => p.getByRole("button", { name: /^(not now|agora não|ahora no)$/i })], 1_500);
    if (!b) return;
    await b.click().catch(() => {});
    await page.waitForTimeout(400);
  }
}

const DM_COMPOSER: Candidate[] = [
  (p) => p.getByRole("textbox", { name: /^(message|mensagem|mensaje)/i }),
  "div[aria-label^='Message'][contenteditable='true']",
  "div[role='textbox'][contenteditable='true']",
];

async function openThread(env: AdapterEnv, to: Recipient): Promise<void> {
  const page = env.page;
  if (to.url && /instagram\.com\/direct\/t\//i.test(to.url)) {
    await env.goto(to.url);
    return;
  }
  const h = to.handle ?? to.url;
  if (!h) throw new AdapterError("recipient", "Instagram DM needs to.handle or to.url");
  const handle = bareHandle(h);
  await env.goto(`${HOME}${handle}/`);
  await dismissPopups(page);
  const msg = await maybeVisible(
    page,
    [(p) => p.locator("header").getByRole("button", { name: /^(message|mensagem|enviar mensagem|mensaje|enviar mensaje)$/i }), (p) => p.getByRole("button", { name: /^(message|mensagem|enviar mensagem|mensaje|enviar mensaje)$/i })],
    8_000,
  );
  if (msg) {
    await msg.click();
    return;
  }
  // no Message button on the profile: search from the new-message dialog
  await env.goto(`${HOME}direct/new/`);
  await dismissPopups(page);
  await typeText(page, "search", ["input[name='queryBox']", (p) => dialog(p).getByPlaceholder(/search|pesquisar|buscar/i)], handle);
  await page.waitForTimeout(1_500);
  await clickFirst(page, "pick-recipient", [(p) => dialog(p).getByText(handle, { exact: true }), (p) => dialog(p).getByRole("checkbox").first()], 15_000);
  await clickWhenEnabled(page, "chat", [(p) => dialog(p).getByRole("button", { name: /^(chat|next|bate-papo|conversar|siguiente)$/i })], 10_000);
}

async function sendDm(env: AdapterEnv, input: { to: Recipient; text: string }): Promise<SendResult> {
  const page = env.page;
  await openThread(env, input.to);
  await dismissPopups(page);
  await typeText(page, "composer", DM_COMPOSER, input.text, { newline: "shift-enter" });
  if (env.dryRun) return dryRunStop(env, "instagram-dm");
  await page.keyboard.press("Enter");
  const ok = await maybeVisible(page, [(p) => p.locator("[role='grid'], [role='main']").getByText(snippet(input.text)).last()], 20_000);
  if (!ok) throw new AdapterError("verify", "sent message did not appear in the thread", await env.shot("verify"));
  return { url: page.url(), note: "message sent", screenshot: await env.shot("sent") };
}

export const instagram: PlatformAdapter = {
  platform: "instagram",
  homeUrl: HOME,
  loginUrl: "https://www.instagram.com/accounts/login/",

  async isLoggedIn(env) {
    return loginState(env.page, { loggedIn: LOGGED_IN, loggedOut: LOGGED_OUT, outUrl: /\/accounts\/login|\/challenge\// });
  },

  async post(env, { text, media }) {
    const page = env.page;
    if (!media.length) throw new AdapterError("media", "Instagram posts need at least one image or video");
    if (text.length > 2200) throw new AdapterError("caption", `caption is ${text.length} chars; Instagram allows 2200`);
    await dismissPopups(page);
    await clickFirst(page, "create", [
      (p) => p.getByRole("link", { name: /^(new post|create|criar|nova publicação|crear|nueva publicación)$/i }),
      "a:has(svg[aria-label='New post']), a:has(svg[aria-label='Nova publicação']), a:has(svg[aria-label='Nueva publicación'])",
    ]);
    // newer UI opens a small menu (Post / Live / AI) before the upload dialog
    const sub = await maybeVisible(page, [(p) => p.getByRole("link", { name: /^(post|publicação|publicación)$/i }), (p) => p.getByRole("menuitem", { name: /^(post|publicação|publicación)$/i })], 2_500);
    if (sub) await sub.click();
    await attachFiles(page, "upload", media, {
      input: "div[role='dialog'] input[type='file'], form[enctype='multipart/form-data'] input[type='file']",
      trigger: [(p) => dialog(p).getByRole("button", { name: /select from (computer|device)|selecionar d[oe] (computador|dispositivo)|seleccionar de(l)? (ordenador|computadora|dispositivo)/i })],
    });
    // "Video posts are now shared as reels"
    const ok = await maybeVisible(page, [(p) => dialog(p).getByRole("button", { name: /^(ok)$/i })], 3_000);
    if (ok) await ok.click();
    for (const step of ["crop-next", "edit-next"]) {
      await clickWhenEnabled(page, step, [(p) => dialog(p).getByRole("button", { name: NEXT })], 60_000);
      await page.waitForTimeout(800);
    }
    if (text.trim()) {
      await typeText(
        page,
        "caption",
        [(p) => dialog(p).getByRole("textbox", { name: /write a caption|escreva uma legenda|escribe (un pie de foto|una descripción)|agrega una descripción/i }), "div[role='dialog'] div[contenteditable='true']"],
        text,
        { newline: "enter" },
      );
    }
    const SHARE: Candidate[] = [(p) => dialog(p).getByRole("button", { name: /^(share|compartilhar|compartir)$/i })];
    await firstVisible(page, "share-button", SHARE, 15_000);
    if (env.dryRun) return dryRunStop(env, "instagram-post");
    await clickFirst(page, "share", SHARE);
    const done = await maybeVisible(
      page,
      [
        (p) => p.getByText(/your (post|reel) has been shared|(post|reel) shared|sua publicação foi compartilhada|seu reel foi compartilhado|se ha compartido tu (publicación|reel)|se compartió tu (publicación|reel)/i),
        "img[alt*='checkmark' i]",
      ],
      180_000,
    );
    if (!done) throw new AdapterError("verify", "no 'shared' confirmation within 3 minutes", await env.shot("verify"));
    return { note: "post shared (Instagram does not return a URL here: check the profile grid)", screenshot: await env.shot("sent") };
  },

  dm: (env, input) => sendDm(env, input),
  reply: (env, input) => sendDm(env, input),

  async comment(env, { url, text }) {
    const page = env.page;
    await env.goto(url);
    await dismissPopups(page);
    const BOX: Candidate[] = [
      (p) => p.getByRole("textbox", { name: /add a comment|adicione um comentário|adicionar um comentário|añade un comentario|agrega un comentario/i }),
      "form textarea",
    ];
    await typeText(page, "comment", BOX, text.replace(/\n+/g, " "));
    if (env.dryRun) return dryRunStop(env, "instagram-comment");
    const post = await maybeVisible(page, [(p) => p.locator("form").getByRole("button", { name: /^(post|publicar)$/i })], 3_000);
    if (post) await post.click();
    else await page.keyboard.press("Enter");
    const ok = await maybeVisible(page, [(p) => p.locator("ul, [role='main']").getByText(snippet(text)).last()], 20_000);
    if (!ok) throw new AdapterError("verify", "comment did not appear", await env.shot("verify"));
    return { url, note: "comment posted", screenshot: await env.shot("sent") };
  },

  async readInbox(env, { limit, unreadOnly }) {
    const page = env.page;
    await env.goto(`${HOME}direct/inbox/`);
    await dismissPopups(page);
    const list = page.locator(
      "[aria-label*='thread list' i] [role='button'], [aria-label*='conversas' i] [role='button'], [aria-label*='conversaciones' i] [role='button'], [aria-label*='chats' i] [role='listitem']",
    );
    await list.first().waitFor({ state: "visible", timeout: 20_000 }).catch(() => {});
    const total = Math.min(await list.count(), 25);
    const threads: InboxThread[] = [];
    for (let i = 0; i < total && threads.length < limit; i++) {
      const row = list.nth(i);
      const rowText = ((await row.innerText().catch(() => "")) || "").trim();
      if (!rowText) continue;
      const unread = /\b(unread|não lida|no leído)\b/i.test(rowText) || (await row.locator("[aria-label*='unread' i], [aria-label*='não lida' i]").count()) > 0;
      if (unreadOnly && !unread) continue;
      const name = rowText.split("\n")[0]?.trim() || undefined;
      await row.click().catch(() => {});
      await page.waitForTimeout(1_500);
      const headerLink = await page.locator("[role='main'] header a[href^='/'], [role='main'] a[role='link'][href^='/']").first().getAttribute("href").catch(() => null);
      const handle = headerLink?.match(/^\/([^/?#]+)\/?$/)?.[1];
      const messages = await readMessages(page, 12);
      if (!messages.length) continue;
      threads.push({ contact: { name, handle }, url: page.url(), unread, messages });
    }
    return threads;
  },
};

/** Direction from bubble alignment: our messages sit on the right half of the conversation pane. */
async function readMessages(page: Page, max: number): Promise<InboxMessage[]> {
  const raw = await page
    .evaluate(`(() => {
      const pane = document.querySelector("[role='main'] [role='grid']") || document.querySelector("[role='main']");
      if (!pane) return [];
      const box = pane.getBoundingClientRect();
      const mid = box.left + box.width / 2;
      const out = [];
      for (const el of Array.from(pane.querySelectorAll("div[dir='auto']"))) {
        const t = (el.innerText || "").trim();
        if (!t) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 4) continue;
        out.push({ text: t, out: r.left + r.width / 2 > mid });
      }
      return out;
    })()`)
    .catch(() => [] as { text: string; out: boolean }[]);
  const rows = raw as { text: string; out: boolean }[];
  return rows.slice(-max).map((r) => ({ direction: r.out ? "out" : "in", text: r.text }));
}
