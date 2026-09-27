/**
 * Gmail web (mail.google.com): used by email accounts with transport "browser". SMTP/IMAP is the sturdier path;
 * prefer it when the mailbox allows app passwords.
 *
 * Supported: email (compose URL -> Send; the cold-email opt-out footer is appended here, same text as SMTP),
 * reply (opens the latest thread from that sender and replies in it).
 * Best effort: readInbox (list view only: subject + snippet, so nothing gets marked as read).
 * Selectors written 2026-09-27. Calibrate with: mkt send <id> --dry-run
 */
import { clickFirst, dryRunStop, firstVisible, maybeVisible, typeText, type Candidate, loginState } from "./helpers.js";
import { AdapterError, type AdapterEnv, type InboxThread, type PlatformAdapter, type SendResult } from "./types.js";

const BASE = "https://mail.google.com/mail/u/0/";

const LOGGED_IN: Candidate[] = [
  (p) => p.getByRole("button", { name: /^(compose|escrever|redactar)$/i }),
  "div[gh='cm']",
  (p) => p.getByRole("navigation").getByRole("link", { name: /^(inbox|caixa de entrada|recibidos)/i }),
];
const LOGGED_OUT: Candidate[] = ["input[type='email']", (p) => p.getByText(/^(sign in|fazer login|iniciar sesión)$/i)];

const BODY: Candidate[] = [
  "div[aria-label='Message Body'][contenteditable='true']",
  "div[aria-label='Corpo da mensagem'][contenteditable='true']",
  "div[aria-label='Cuerpo del mensaje'][contenteditable='true']",
  (p) => p.getByRole("textbox", { name: /message body|corpo da mensagem|cuerpo del mensaje/i }),
];
const SEND: Candidate[] = [
  (p) => p.getByRole("button", { name: /^(send|enviar)\b/i }),
  "div[role='button'][data-tooltip^='Send']",
  "div[role='button'][data-tooltip^='Enviar']",
];

const snippet = (text: string) => (text.split("\n").find((l) => l.trim()) ?? "").trim().slice(0, 30);

async function clickSendAndVerify(env: AdapterEnv): Promise<void> {
  const page = env.page;
  const btn = await maybeVisible(page, SEND, 5_000);
  if (btn) await btn.click();
  else await page.keyboard.press(process.platform === "darwin" ? "Meta+Enter" : "Control+Enter");
  const ok = await maybeVisible(page, [(p) => p.getByText(/^(message sent|mensagem enviada|mensaje enviado)/i)], 25_000);
  if (!ok) throw new AdapterError("verify", "no 'Message sent' confirmation", await env.shot("verify"));
}

export const gmail: PlatformAdapter = {
  platform: "email",
  homeUrl: `${BASE}#inbox`,
  loginUrl: "https://accounts.google.com/ServiceLogin?service=mail",

  async isLoggedIn(env) {
    return loginState(env.page, { loggedIn: LOGGED_IN, loggedOut: LOGGED_OUT, outUrl: /accounts\.google\.com|workspace\.google\.com|google\.com\/gmail\/about/, timeoutMs: 20_000 });
  },

  async email(env, { to, subject, text }): Promise<SendResult> {
    const page = env.page;
    if (!to.email) throw new AdapterError("recipient", "email needs to.email");
    if (!subject) throw new AdapterError("subject", "email needs a subject");
    // `text` arrives composed by the dispatcher (sender identity + opt-out line), same as the SMTP path
    const body = text;
    const params = new URLSearchParams({ view: "cm", fs: "1", to: to.email, su: subject });
    const inUrl = encodeURIComponent(body).length < 1800;
    if (inUrl) params.set("body", body);
    await env.goto(`${BASE}?${params.toString()}`);
    const editor = await firstVisible(page, "compose", BODY, 30_000);
    const current = ((await editor.innerText().catch(() => "")) || "").trim();
    if (!inUrl || !current.includes(snippet(text))) await typeText(page, "body", BODY, body, { newline: "enter", clear: true });
    const toOk = await maybeVisible(page, [`[email='${to.email}']`, `[data-hovercard-id='${to.email}']`, (p) => p.getByText(to.email!, { exact: false })], 5_000);
    if (!toOk) throw new AdapterError("recipient", `recipient ${to.email} not shown in the To field`, await env.shot("to"));
    if (env.dryRun) return dryRunStop(env, "gmail-email");
    await clickSendAndVerify(env);
    return { note: `email sent to ${to.email}`, screenshot: await env.shot("sent") };
  },

  async reply(env, { to, text }): Promise<SendResult> {
    const page = env.page;
    if (!to.email) throw new AdapterError("recipient", "email reply needs to.email");
    await env.goto(`${BASE}#search/${encodeURIComponent(`from:${to.email}`)}`);
    const row = await firstVisible(page, "find-thread", ["div[role='main'] tr.zA"], 20_000).catch(async () => {
      throw new AdapterError("find-thread", `no email from ${to.email} found to reply to`, await env.shot("find-thread"));
    });
    await row.click();
    await clickFirst(page, "reply", [
      (p) => p.getByRole("button", { name: /^(reply|responder)$/i }).last(),
      "div[role='button'][aria-label='Reply'], div[role='button'][aria-label='Responder']",
    ]);
    await typeText(page, "body", BODY, text, { newline: "enter" });
    if (env.dryRun) return dryRunStop(env, "gmail-reply");
    await clickSendAndVerify(env);
    return { url: page.url(), note: `reply sent to ${to.email}`, screenshot: await env.shot("sent") };
  },

  async readInbox(env, { limit, unreadOnly }): Promise<InboxThread[]> {
    const page = env.page;
    await env.goto(`${BASE}#search/${encodeURIComponent(unreadOnly ? "is:unread in:inbox" : "in:inbox")}`);
    const rows = page.locator("div[role='main'] tr.zA");
    await rows.first().waitFor({ state: "visible", timeout: 15_000 }).catch(() => {});
    const n = Math.min(await rows.count(), limit);
    const out: InboxThread[] = [];
    for (let i = 0; i < n; i++) {
      const r = rows.nth(i);
      const sender = r.locator("span[email]").first();
      const email = (await sender.getAttribute("email").catch(() => null)) ?? undefined;
      const name = (await sender.getAttribute("name").catch(() => null)) ?? undefined;
      const subject = ((await r.locator("span.bog").first().innerText().catch(() => "")) || "").trim();
      const snip = ((await r.locator("span.y2").first().innerText().catch(() => "")) || "").replace(/^\s*[-–]\s*/, "").trim();
      const tid = (await r.locator("[data-legacy-thread-id]").first().getAttribute("data-legacy-thread-id").catch(() => null)) ?? undefined;
      const unread = ((await r.getAttribute("class").catch(() => "")) ?? "").includes("zE");
      if (!email) continue;
      out.push({
        contact: { name, email },
        url: tid ? `${BASE}#inbox/${tid}` : undefined,
        unread,
        messages: [{ direction: "in", text: [subject, snip].filter(Boolean).join("\n"), externalId: tid ? `gmail-thread:${tid}` : undefined }],
      });
    }
    return out;
  },
};
