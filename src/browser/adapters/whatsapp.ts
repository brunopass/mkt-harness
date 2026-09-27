/**
 * WhatsApp Web (web.whatsapp.com), personal or Business app account linked by QR code.
 *
 * Supported: dm (to.phone, international format), reply (= dm), readInbox (opens chats, which marks them read).
 * Best effort: media (sent as one attachment batch with the text as caption).
 * Selectors written 2026-09-27. Calibrate with: mkt send <id> --dry-run
 *
 * Cold WhatsApp needs opt-in (enforced by policy before we get here). Numbers are passed as digits only.
 */
import type { Page } from "playwright-core";
import { attachFiles, clickFirst, dryRunStop, firstVisible, maybeVisible, typeText, type Candidate, loginState } from "./helpers.js";
import { AdapterError, type AdapterEnv, type InboxMessage, type InboxThread, type PlatformAdapter, type SendResult } from "./types.js";

const HOME = "https://web.whatsapp.com/";

const LOGGED_IN: Candidate[] = [
  "#pane-side",
  (p) => p.getByRole("grid", { name: /chat list|lista de conversas|lista de chats/i }),
  (p) => p.getByRole("textbox", { name: /search|pesquisar|buscar/i }),
];
const LOGGED_OUT: Candidate[] = [
  "canvas[aria-label*='scan' i]",
  "canvas[aria-label*='escane' i]",
  "[data-ref] canvas",
  (p) => p.getByText(/use whatsapp on your computer|log into whatsapp web|steps to log in|use o whatsapp no seu computador|entrar no whatsapp web|usa whatsapp en tu computadora|inicia sesi[oó]n en whatsapp web/i),
  (p) => p.getByText(/whatsapp works with google chrome|update (google )?chrome/i),
];
const COMPOSER: Candidate[] = [
  "footer div[contenteditable='true'][role='textbox']",
  "footer div[contenteditable='true']",
  (p) => p.getByRole("textbox", { name: /type a message|digite uma mensagem|escribe un mensaje|escriba un mensaje/i }),
];
const CAPTION: Candidate[] = [
  (p) => p.getByRole("textbox", { name: /add a caption|adicione uma legenda|adicionar legenda|añade un comentario|añadir un comentario|agrega un comentario/i }),
  "div[role='dialog'] div[contenteditable='true']",
  "div[contenteditable='true'][data-lexical-editor='true']:not(footer *)",
];
const SEND: Candidate[] = [
  (p) => p.getByRole("button", { name: /^(send|enviar)$/i }),
  "span[data-icon='send']",
  "span[data-icon='wds-ic-send-filled']",
  "[aria-label='Send']",
];
const INVALID = /phone number shared via url is invalid|n[uú]mero de telefone compartilhado (por|atrav[eé]s de) url [eé] inv[aá]lido|n[uú]mero de tel[eé]fono compartido (a trav[eé]s de la|por) (direcci[oó]n )?url no es v[aá]lido/i;

function digits(phone?: string): string {
  const d = (phone ?? "").replace(/\D/g, "").replace(/^00/, "");
  if (d.length < 8) throw new AdapterError("recipient", `WhatsApp needs to.phone in international format (got "${phone ?? ""}")`);
  return d;
}

const snippet = (text: string) => (text.split("\n").find((l) => l.trim()) ?? "").trim().slice(0, 30);

/** Wait for the chat composer, or fail fast on the "invalid number" dialog. */
async function waitForChat(env: AdapterEnv, phone: string): Promise<void> {
  const page = env.page;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (await page.getByText(INVALID).first().isVisible().catch(() => false)) {
      throw new AdapterError("recipient", `+${phone} is not on WhatsApp (invalid number dialog)`, await env.shot("invalid-number"));
    }
    if (await maybeVisible(page, COMPOSER, 0)) return;
    await page.waitForTimeout(500);
  }
  throw new AdapterError("open-chat", `chat with +${phone} did not open within 60s`, await env.shot("open-chat"));
}

async function verifyOutgoing(env: AdapterEnv, text: string, step: string): Promise<void> {
  const s = snippet(text);
  const page = env.page;
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const last = page.locator("#main div.message-out").last();
    const t = (await last.innerText().catch(() => "")) || "";
    if (s && t.includes(s)) return;
    if (!s && (await last.count()) > 0) return;
    await page.waitForTimeout(500);
  }
  throw new AdapterError(step, "sent message bubble did not appear in the chat", await env.shot(step));
}

async function send(env: AdapterEnv, input: { to: { phone?: string }; text: string; media: string[] }): Promise<SendResult> {
  const page = env.page;
  const phone = digits(input.to.phone);

  if (input.media.length) {
    await env.goto(`${HOME}send?phone=${phone}`);
    await waitForChat(env, phone);
    // the photo/video file input only exists once the attach menu is open
    await clickFirst(page, "attach-menu", [
      (p) => p.getByRole("button", { name: /^(attach|anexar|adjuntar)$/i }),
      "span[data-icon='plus']",
      "span[data-icon='plus-rounded']",
      "span[data-icon='clip']",
    ]);
    await page.waitForTimeout(500);
    await attachFiles(page, "attach", input.media, {
      input: "input[type='file'][accept*='image'], input[type='file'][accept*='video']",
      trigger: [
        (p) => p.getByRole("menuitem", { name: /photos? (&|and) videos?|fotos e v[ií]deos|fotos y v[ií]deos/i }),
        (p) => p.getByRole("button", { name: /photos? (&|and) videos?|fotos e v[ií]deos|fotos y v[ií]deos/i }),
      ],
    });
    if (input.text.trim()) await typeText(page, "caption", CAPTION, input.text, { newline: "shift-enter" });
    if (env.dryRun) return dryRunStop(env, "whatsapp-media");
    await clickFirst(page, "send", SEND);
    await verifyOutgoing(env, input.text, "verify-media");
    return { note: `sent to +${phone} with ${input.media.length} attachment(s)`, screenshot: await env.shot("sent") };
  }

  await env.goto(`${HOME}send?phone=${phone}&text=${encodeURIComponent(input.text)}`);
  await waitForChat(env, phone);
  const composer = await firstVisible(page, "composer", COMPOSER);
  const prefilled = ((await composer.innerText().catch(() => "")) || "").trim();
  if (!prefilled.includes(snippet(input.text))) {
    await typeText(page, "composer", COMPOSER, input.text, { newline: "shift-enter", clear: true });
  }
  if (env.dryRun) return dryRunStop(env, "whatsapp-message");
  const sendBtn = await maybeVisible(page, SEND, 3_000);
  if (sendBtn) await sendBtn.click();
  else {
    await composer.click();
    await page.keyboard.press("Enter");
  }
  await verifyOutgoing(env, input.text, "verify");
  return { note: `sent to +${phone}`, screenshot: await env.shot("sent") };
}

/** "false_5511999999999@c.us_3EB0..." -> "+5511999999999" */
function phoneFromDataId(id?: string | null): string | undefined {
  const m = id?.match(/_(\d{8,15})@c\.us_/);
  return m ? `+${m[1]}` : undefined;
}

async function readOpenChat(page: Page, max: number): Promise<{ messages: InboxMessage[]; phone?: string }> {
  const rows = page.locator("#main div.message-in, #main div.message-out");
  const n = await rows.count();
  const messages: InboxMessage[] = [];
  let phone: string | undefined;
  for (let i = Math.max(0, n - max); i < n; i++) {
    const row = rows.nth(i);
    const cls = (await row.getAttribute("class").catch(() => "")) ?? "";
    const dataId = await row.evaluate((el) => el.closest("[data-id]")?.getAttribute("data-id") ?? null).catch(() => null);
    const text = (
      (await row.locator("span.selectable-text").first().innerText().catch(() => "")) ||
      (await row.innerText().catch(() => ""))
    ).trim();
    if (!text) continue;
    const direction = cls.includes("message-out") ? "out" : "in";
    if (direction === "in") phone ??= phoneFromDataId(dataId);
    messages.push({ direction, text, externalId: dataId ?? undefined });
  }
  return { messages, phone };
}

export const whatsapp: PlatformAdapter = {
  platform: "whatsapp",
  homeUrl: HOME,
  loginUrl: HOME,

  async isLoggedIn(env) {
    return loginState(env.page, { loggedIn: LOGGED_IN, loggedOut: LOGGED_OUT, timeoutMs: 25_000 });
  },

  dm: (env, input) => send(env, input),
  reply: (env, input) => send(env, input),

  async readInbox(env, { limit, unreadOnly }) {
    const page = env.page;
    if (!(await maybeVisible(page, ["#pane-side"], 20_000))) throw new AdapterError("inbox", "chat list not visible", await env.shot("inbox"));
    const rows = page.locator("#pane-side [role='listitem'], #pane-side [role='row']");
    const total = Math.min(await rows.count(), 40);
    const threads: InboxThread[] = [];
    for (let i = 0; i < total && threads.length < limit; i++) {
      const row = rows.nth(i);
      const unread =
        (await row.locator("[aria-label*='unread' i], [aria-label*='não lida' i], [aria-label*='nao lida' i], [aria-label*='no leído' i], [aria-label*='no leido' i]").count()) > 0;
      if (unreadOnly && !unread) continue;
      const name = (await row.locator("span[title]").first().getAttribute("title").catch(() => null)) ?? undefined;
      await row.click().catch(() => {});
      if (!(await maybeVisible(page, COMPOSER, 8_000))) continue; // groups you can't post in, channels, etc.
      await page.waitForTimeout(800);
      const { messages, phone } = await readOpenChat(page, 12);
      if (!messages.length) continue;
      threads.push({ contact: { name, phone }, url: phone ? `${HOME}send?phone=${phone.slice(1)}` : undefined, unread, messages });
    }
    return threads;
  },
};
