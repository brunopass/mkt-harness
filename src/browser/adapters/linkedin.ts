/**
 * LinkedIn (www.linkedin.com), personal profile.
 *
 * Supported: post (text + optional images/video), dm (1st-degree connections via the profile's Message button),
 * connect (with or without a note), comment (on a post URL), readInbox (messaging list; opening a thread marks it read).
 * Best effort: company-page posting (post as the member profile only), DMs to non-connections (needs InMail: fails clearly).
 * Selectors written 2026-09-27. Calibrate with: mkt send <id> --dry-run
 */
import type { Page } from "playwright-core";
import { attachFiles, bareHandle, clickFirst, clickWhenEnabled, dryRunStop, firstVisible, maybeVisible, typeText, type Candidate, loginState } from "./helpers.js";
import { AdapterError, type AdapterEnv, type InboxMessage, type InboxThread, type PlatformAdapter, type SendResult } from "./types.js";
import type { Recipient } from "../../core/schemas.js";

const FEED = "https://www.linkedin.com/feed/";

const LOGGED_IN: Candidate[] = [
  "#global-nav",
  "nav.global-nav",
  (p) => p.getByRole("button", { name: /^(start a post|começar (uma )?publicação|comenzar (una )?publicación|crear (una )?publicación)/i }),
  "a[href*='/mynetwork/']",
];
const LOGGED_OUT: Candidate[] = [
  "input#username",
  "form.login__form",
  (p) => p.getByRole("button", { name: /^(sign in|entrar|iniciar sesión)$/i }),
  (p) => p.getByRole("link", { name: /^(join now|cadastre-se agora|únete ahora)$/i }),
];

const snippet = (text: string) => (text.split("\n").find((l) => l.trim()) ?? "").trim().slice(0, 30);
const dialog = (p: Page) => p.getByRole("dialog");

function profileUrl(to: Recipient): string {
  if (to.url && /linkedin\.com\/in\//i.test(to.url)) return to.url;
  const h = to.handle ?? to.url;
  if (!h) throw new AdapterError("recipient", "LinkedIn needs to.url (profile URL) or to.handle (the /in/<handle> part)");
  return `https://www.linkedin.com/in/${bareHandle(h)}/`;
}

async function waitHidden(env: AdapterEnv, step: string, cands: Candidate[], timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await maybeVisible(env.page, cands, 0))) return;
    await env.page.waitForTimeout(500);
  }
  throw new AdapterError(step, "composer did not close after submitting", await env.shot(step));
}

async function openMessageComposer(env: AdapterEnv, to: Recipient): Promise<void> {
  await env.goto(profileUrl(to));
  const btn = await maybeVisible(
    env.page,
    [
      (p) => p.locator("main").getByRole("button", { name: /^(message|mensagem|enviar mensagem|mensaje|enviar mensaje)\b/i }),
      (p) => p.locator("main").getByRole("link", { name: /^(message|mensagem|enviar mensagem|mensaje|enviar mensaje)\b/i }),
      "main a[href*='/messaging/compose']",
    ],
    12_000,
  );
  if (!btn) throw new AdapterError("message-button", "no Message button on the profile: probably not a 1st-degree connection (use connect with a note)", await env.shot("message-button"));
  await btn.click();
}

const MSG_COMPOSER: Candidate[] = [
  "div.msg-form__contenteditable[contenteditable='true']",
  (p) => p.getByRole("textbox", { name: /write a message|escreva uma mensagem|escribe un mensaje/i }),
];

async function verifyMessage(env: AdapterEnv, text: string): Promise<void> {
  const s = snippet(text);
  const page = env.page;
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const last = page.locator(".msg-s-event-listitem__body, .msg-s-message-list__event").last();
    if (s && ((await last.innerText().catch(() => "")) || "").includes(s)) return;
    await page.waitForTimeout(500);
  }
  throw new AdapterError("verify", "sent message did not appear in the conversation", await env.shot("verify"));
}

async function sendMessage(env: AdapterEnv, input: { to: Recipient; text: string }): Promise<SendResult> {
  const page = env.page;
  if (input.to.url && /linkedin\.com\/messaging\/thread\//i.test(input.to.url)) await env.goto(input.to.url);
  else await openMessageComposer(env, input.to);
  await typeText(page, "composer", MSG_COMPOSER, input.text, { newline: "shift-enter" });
  if (env.dryRun) return dryRunStop(env, "linkedin-message");
  await clickWhenEnabled(page, "send", ["button.msg-form__send-button", (p) => p.getByRole("button", { name: /^(send|enviar)$/i })], 10_000);
  await verifyMessage(env, input.text);
  return { url: page.url(), note: "message sent", screenshot: await env.shot("sent") };
}

async function readThread(page: Page, max: number): Promise<InboxMessage[]> {
  const items = page.locator("li.msg-s-message-list__event");
  const n = await items.count();
  const out: InboxMessage[] = [];
  for (let i = Math.max(0, n - max); i < n; i++) {
    const it = items.nth(i);
    const body = ((await it.locator(".msg-s-event-listitem__body").first().innerText().catch(() => "")) || "").trim();
    if (!body) continue;
    const other = (await it.locator(".msg-s-event-listitem--other").count()) > 0;
    const urn = (await it.locator("[data-event-urn]").first().getAttribute("data-event-urn").catch(() => null)) ?? undefined;
    out.push({ direction: other ? "in" : "out", text: body, externalId: urn });
  }
  return out;
}

export const linkedin: PlatformAdapter = {
  platform: "linkedin",
  homeUrl: FEED,
  loginUrl: "https://www.linkedin.com/login",

  async isLoggedIn(env) {
    return loginState(env.page, { loggedIn: LOGGED_IN, loggedOut: LOGGED_OUT, outUrl: /\/(login|authwall|checkpoint|signup|uas\/login)/ });
  },

  async post(env, { text, media }) {
    const page = env.page;
    await env.goto(`${FEED}?shareActive=true`);
    let editor = await maybeVisible(page, ["div[role='dialog'] div.ql-editor[contenteditable='true']", (p) => dialog(p).getByRole("textbox")], 6_000);
    if (!editor) {
      await clickFirst(page, "open-composer", [
        (p) => p.getByRole("button", { name: /^(start a post|começar (uma )?publicação|comenzar (una )?publicación|crear (una )?publicación)/i }),
        "button.share-box-feed-entry__trigger",
      ]);
    }
    await typeText(
      page,
      "text",
      [
        "div[role='dialog'] div.ql-editor[contenteditable='true']",
        (p) => dialog(p).getByRole("textbox", { name: /text editor|editor de texto|what do you want to talk about|sobre o que você quer falar|sobre qué quieres hablar/i }),
        (p) => dialog(p).getByRole("textbox"),
      ],
      text,
      { newline: "enter" },
    );
    if (media.length) {
      await attachFiles(page, "media", media, {
        input: "div[role='dialog'] input[type='file']",
        trigger: [
          (p) => dialog(p).getByRole("button", { name: /add (a )?(media|photo|video)|adicionar (mídia|foto|vídeo)|añadir (contenido multimedia|foto|vídeo)|agregar (contenido multimedia|foto|video)/i }),
        ],
      });
      // media editor step ("Next"/"Done") before returning to the composer
      const next = await maybeVisible(page, [(p) => dialog(p).getByRole("button", { name: /^(next|done|avançar|concluído|concluir|siguiente|listo|hecho)$/i })], 60_000);
      if (next) await clickWhenEnabled(page, "media-next", [(p) => dialog(p).getByRole("button", { name: /^(next|done|avançar|concluído|concluir|siguiente|listo|hecho)$/i })], 120_000);
    }
    const POST: Candidate[] = [
      (p) => dialog(p).getByRole("button", { name: /^(post|publicar|postar)$/i }),
      "button.share-actions__primary-action",
    ];
    await firstVisible(page, "post-button", POST, 30_000);
    if (env.dryRun) return dryRunStop(env, "linkedin-post");
    await clickWhenEnabled(page, "post", POST, 120_000);
    await waitHidden(env, "verify", ["div[role='dialog'] div.ql-editor[contenteditable='true']"], 90_000);
    const view = await maybeVisible(page, [(p) => p.getByRole("link", { name: /view post|ver publicação|ver publicación/i })], 10_000);
    const url = view ? ((await view.getAttribute("href").catch(() => null)) ?? undefined) : undefined;
    return { url, note: "post published", screenshot: await env.shot("sent") };
  },

  dm: (env, input) => sendMessage(env, input),
  reply: (env, input) => sendMessage(env, input),

  async connect(env, { to, note }) {
    const page = env.page;
    await env.goto(profileUrl(to));
    if (await maybeVisible(page, [(p) => p.locator("main").getByRole("button", { name: /^(pending|pendente|pendiente)\b/i })], 3_000))
      throw new AdapterError("connect", "invitation already pending", await env.shot("pending"));
    const CONNECT: Candidate[] = [
      (p) => p.locator("main").getByRole("button", { name: /^(invite .+ to connect|convidar .+ para (se )?conectar|invitar a .+ a conectar)/i }),
      (p) => p.locator("main").getByRole("button", { name: /^(connect|conectar)$/i }),
    ];
    let btn = await maybeVisible(page, CONNECT, 8_000);
    if (!btn) {
      await clickFirst(page, "more", [(p) => p.locator("main").getByRole("button", { name: /^(more( actions)?|mais( ações)?|más( acciones)?)$/i })], 8_000);
      btn = await maybeVisible(
        page,
        [
          (p) => p.getByRole("menuitem", { name: /(invite .+ to connect|convidar .+ para (se )?conectar|invitar a .+ a conectar|^connect$|^conectar$)/i }),
          (p) => p.locator(".artdeco-dropdown__content").getByRole("button", { name: /(invite .+ to connect|convidar .+ para (se )?conectar|invitar a .+ a conectar|^connect$|^conectar$)/i }),
          (p) => p.locator(".artdeco-dropdown__content").getByText(/^(connect|conectar)$/i),
        ],
        5_000,
      );
    }
    if (!btn) throw new AdapterError("connect", "no Connect action on this profile (already connected, or follow-only)", await env.shot("connect"));
    await btn.click();

    if (note) {
      await clickFirst(page, "add-note", [(p) => dialog(p).getByRole("button", { name: /^(add a note|adicionar (uma )?nota|añadir una nota|agregar una nota)$/i })], 10_000);
      const box = await firstVisible(page, "note", ["div[role='dialog'] textarea[name='message']", (p) => dialog(p).getByRole("textbox")], 10_000);
      const max = Number((await box.getAttribute("maxlength").catch(() => null)) ?? 300);
      if (note.length > max) throw new AdapterError("note", `note is ${note.length} chars, LinkedIn allows ${max} here: shorten it`, await env.shot("note-too-long"));
      await box.fill(note);
    }
    const SEND: Candidate[] = note
      ? [(p) => dialog(p).getByRole("button", { name: /^(send|enviar)( invitation| convite| invitación)?$/i })]
      : [
          (p) => dialog(p).getByRole("button", { name: /^(send without a note|enviar sem (uma )?nota|enviar sin (una )?nota)$/i }),
          (p) => dialog(p).getByRole("button", { name: /^(send|enviar)( invitation| convite| invitación)?$/i }),
        ];
    await firstVisible(page, "send-invite", SEND, 10_000).catch(async (e) => {
      // free accounts that ran out of personalised invites get an upsell instead of the note box
      throw new AdapterError("send-invite", `${e.message} (monthly personalised-invite limit reached?)`, await env.shot("send-invite"));
    });
    if (env.dryRun) return dryRunStop(env, "linkedin-connect");
    await clickWhenEnabled(page, "send-invite", SEND, 10_000);
    const ok = await maybeVisible(page, [(p) => p.locator("main").getByRole("button", { name: /^(pending|pendente|pendiente)\b/i }), (p) => p.getByText(/invitation sent|convite enviado|invitación enviada/i)], 15_000);
    if (!ok) throw new AdapterError("verify", "could not confirm the invitation (no Pending state)", await env.shot("verify"));
    return { url: page.url(), note: note ? "invitation sent with note" : "invitation sent", screenshot: await env.shot("sent") };
  },

  async comment(env, { url, text }) {
    const page = env.page;
    await env.goto(url);
    const BOX: Candidate[] = [
      ".comments-comment-box div.ql-editor[contenteditable='true']",
      (p) => p.getByRole("textbox", { name: /add a comment|adicionar (um )?comentário|añadir un comentario|agregar un comentario/i }),
    ];
    if (!(await maybeVisible(page, BOX, 5_000))) {
      await clickFirst(page, "open-comment", [(p) => p.locator("main").getByRole("button", { name: /^(comment|comentar)$/i })]);
    }
    await typeText(page, "comment", BOX, text, { newline: "enter" });
    if (env.dryRun) return dryRunStop(env, "linkedin-comment");
    await clickWhenEnabled(page, "submit", ["button.comments-comment-box__submit-button--cr", "button.comments-comment-box__submit-button", (p) => p.getByRole("button", { name: /^(comment|post|comentar|publicar)$/i })], 10_000);
    const ok = await maybeVisible(page, [(p) => p.locator(".comments-comment-item, article.comments-comment-entity").getByText(snippet(text))], 20_000);
    if (!ok) throw new AdapterError("verify", "comment did not appear under the post", await env.shot("verify"));
    return { url, note: "comment posted", screenshot: await env.shot("sent") };
  },

  async readInbox(env, { limit, unreadOnly }) {
    const page = env.page;
    await env.goto("https://www.linkedin.com/messaging/");
    const items = page.locator("li.msg-conversation-listitem");
    await items.first().waitFor({ state: "visible", timeout: 20_000 }).catch(() => {});
    const total = Math.min(await items.count(), 30);
    const threads: InboxThread[] = [];
    for (let i = 0; i < total && threads.length < limit; i++) {
      const it = items.nth(i);
      const unread =
        (await it.locator(".msg-conversation-card__convo-item--unread, .msg-conversation-card__unread-count, .notification-badge--show").count()) > 0;
      if (unreadOnly && !unread) continue;
      const name = ((await it.locator(".msg-conversation-listitem__participant-names, h3").first().innerText().catch(() => "")) || "").trim() || undefined;
      await it.locator(".msg-conversation-listitem__link, a, [role='button']").first().click().catch(() => {});
      await page.waitForTimeout(1_500);
      const profile = await page.locator(".msg-thread a[href*='/in/'], .msg-title-bar a[href*='/in/']").first().getAttribute("href").catch(() => null);
      const messages = await readThread(page, 12);
      if (!messages.length) continue;
      const handle = profile?.match(/\/in\/([^/?#]+)/)?.[1];
      threads.push({ contact: { name, handle }, url: page.url(), unread, messages });
    }
    return threads;
  },
};
