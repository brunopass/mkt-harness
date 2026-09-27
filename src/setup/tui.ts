import path from "node:path";
import { addAccount, createBrand, getBrand, listAccounts, listBrands } from "../core/brands.js";
import { loadConfig, type Ctx } from "../core/config.js";
import { Account, type Platform } from "../core/schemas.js";
import { slugify } from "../core/store.js";
import { editConfig, enableRoutines, envName, initWorkspace, MAIL_PROVIDERS, upsertEnv, withAuth, type MailProvider, type ToolCheck } from "./helpers.js";
import type { Choice, Prompter } from "./prompter.js";

type Engine = "claude" | "codex";

/** Side effects the flow needs; the CLI passes the real ones, tests pass fakes. */
export interface SetupDeps {
  detectTools(ctx: Ctx): { checks: ToolCheck[]; engines: Engine[] };
  openForLogin(ctx: Ctx, accountId: string): Promise<void>;
  checkLogin(ctx: Ctx, accountId: string): Promise<boolean>;
  closeBrowser(ctx: Ctx, accountId: string): Promise<void>;
  verifySmtp(url: string): Promise<void>;
  installDaemon(ctx: Ctx): Promise<string>;
  launchAgent(ctx: Ctx, engine: Engine, prompt: string): Promise<void>;
  platform: NodeJS.Platform;
}

const LANGUAGES: Choice<string>[] = [
  { value: "en", label: "English" },
  { value: "pt", label: "Portuguese" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
  { value: "it", label: "Italian" },
  { value: "de", label: "German" },
];

const PLATFORMS: Choice<Platform>[] = [
  { value: "instagram", label: "Instagram", hint: "posts, carousels, DMs" },
  { value: "linkedin", label: "LinkedIn", hint: "posts, connection requests, DMs" },
  { value: "whatsapp", label: "WhatsApp", hint: "replies and opted-in contacts" },
  { value: "email", label: "Email", hint: "outreach and replies" },
  { value: "x", label: "X", hint: "posts and replies" },
  { value: "tiktok", label: "TikTok", hint: "video posts" },
  { value: "threads", label: "Threads" },
  { value: "facebook", label: "Facebook", hint: "profile or Page posts" },
  { value: "youtube", label: "YouTube", hint: "video uploads" },
];

const HANDLE_PROMPT: Partial<Record<Platform, { message: string; placeholder: string }>> = {
  instagram: { message: "Instagram username", placeholder: "@acme" },
  linkedin: { message: "LinkedIn profile or company page URL", placeholder: "https://www.linkedin.com/company/acme" },
  x: { message: "X username", placeholder: "@acme" },
  tiktok: { message: "TikTok username", placeholder: "@acme" },
  threads: { message: "Threads username", placeholder: "@acme" },
  facebook: { message: "Facebook Page URL (or your profile URL)", placeholder: "https://www.facebook.com/acme" },
  youtube: { message: "YouTube channel URL or @handle", placeholder: "@acme" },
};

const LOGIN_HINT: Partial<Record<Platform, string>> = {
  whatsapp: "scan the QR code with WhatsApp on your phone (Settings › Linked devices)",
  email: "sign in to Gmail",
};

const ROUTINE_HINTS: Record<string, string> = {
  "trend-radar": "weekdays 08:00: record trend signals, update the radar, add ideas",
  "inbox-triage": "every 30 min, 9–20h: sort new messages, draft replies",
  "follow-ups": "weekdays 10:00: draft the next step for leads that went quiet",
  "weekly-plan": "Mondays 07:00: last week's results and this week's plan",
};

const PLATFORM_NAME = Object.fromEntries(PLATFORMS.map((p) => [p.value, p.label])) as Record<Platform, string>;

export async function runSetup(ctx: Ctx, p: Prompter, deps: SetupDeps): Promise<void> {
  p.intro("mkt-harness");
  const tools = deps.detectTools(ctx);
  p.note(tools.checks.map((c) => `${c.ok ? "✓" : "✗"} ${c.name.padEnd(14)} ${c.detail}`).join("\n"), "This computer");
  if (!tools.checks.find((c) => c.name === "Google Chrome")?.ok)
    p.warn("Posting and inboxes need Google Chrome. Install it, then run mkt again. Everything else works now.");
  if (!tools.engines.length)
    p.warn("Claude Code or Codex is needed to run the team. Install one, then run mkt again: setup continues meanwhile.");
  initWorkspace(ctx);
  ctx.config = loadConfig(ctx.root); // init may have just created mkt.config.yaml
  p.success("Workspace ready: config, tools for Claude Code and Codex, skills");

  const own = () => listBrands(ctx).filter((b) => b !== "example");
  if (!own().length) {
    p.info("Let's set up your first brand. It takes a few minutes; every answer can be changed later.");
    const brand = await addBrand(ctx, p);
    await addAccounts(ctx, p, deps, brand);
    await logIn(ctx, p, deps, brand, false);
    await automation(ctx, p, deps, brand, tools.engines);
    await finish(ctx, p, deps, brand, tools.engines);
    return;
  }

  while (true) {
    const brands = own();
    const action = await p.select({
      message: "What do you want to do?",
      options: [
        ...(tools.engines.length ? [{ value: "open", label: `Open ${tools.engines[0] === "claude" ? "Claude Code" : "Codex"}`, hint: brands.join(", ") }] : []),
        { value: "accounts", label: "Add accounts" },
        { value: "login", label: "Log in to accounts", hint: "opens Chrome" },
        { value: "automation", label: "Routines and background service" },
        { value: "brand", label: "Add a brand" },
        { value: "status", label: "Check everything" },
        { value: "exit", label: "Exit" },
      ],
    });
    if (action === "exit") return p.outro("See you. Run mkt any time to come back here.");
    if (action === "brand") {
      const b = await addBrand(ctx, p);
      await addAccounts(ctx, p, deps, b);
      await logIn(ctx, p, deps, b, false);
      continue;
    }
    if (action === "status") {
      await status(ctx, p, deps, tools);
      continue;
    }
    const brand = brands.length === 1 ? brands[0] : await p.select({ message: "Which brand?", options: brands.map((b) => ({ value: b, label: getBrand(ctx, b).name, hint: b })) });
    if (action === "open") return finish(ctx, p, deps, brand, tools.engines, true);
    if (action === "accounts") await addAccounts(ctx, p, deps, brand);
    if (action === "login") await logIn(ctx, p, deps, brand, true);
    if (action === "automation") await automation(ctx, p, deps, brand, tools.engines);
  }
}

// ---------------------------------------------------------------- brand

async function addBrand(ctx: Ctx, p: Prompter): Promise<string> {
  const name = await p.text({ message: "Brand name", placeholder: "Acme Clinics" });
  const taken = listBrands(ctx);
  const slug = await p.text({
    message: "Short id for commands and folders",
    initial: slugify(name),
    validate: (v) => (!/^[a-z0-9][a-z0-9_-]*$/.test(v) ? "Use lowercase letters, digits, - and _" : taken.includes(v) ? `"${v}" already exists` : undefined),
  });
  const site = await p.text({
    message: "Website",
    placeholder: "acme.com (optional)",
    optional: true,
    validate: (v) => (/^(https?:\/\/)?[^\s/]+\.[^\s]+$/.test(v) ? undefined : "That doesn't look like a web address"),
  });
  const website = site ? (/^https?:\/\//.test(site) ? site : `https://${site}`) : undefined;
  const languages = await p.multiselect({ message: "Languages you publish in", options: LANGUAGES, initial: ["en"], required: true });
  const timezone = await p.text({
    message: "Timezone (used for quiet hours and scheduling)",
    initial: Intl.DateTimeFormat().resolvedOptions().timeZone,
    validate: (v) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: v });
        return undefined;
      } catch {
        return "Unknown timezone: use a name like Europe/Madrid or America/Sao_Paulo";
      }
    },
  });
  createBrand(ctx, slug, name, { website, languages, timezone });
  p.success(`Created ${name} in workspace/brands/${slug}`);
  return slug;
}

// ---------------------------------------------------------------- accounts

function uniqueId(ctx: Ctx, base: string): string {
  const ids = new Set(listAccounts(ctx).map((a) => a.id));
  if (!ids.has(base)) return base;
  for (let i = 2; ; i++) if (!ids.has(`${base}-${i}`)) return `${base}-${i}`;
}

async function addAccounts(ctx: Ctx, p: Prompter, deps: SetupDeps, brand: string): Promise<void> {
  const name = getBrand(ctx, brand).name;
  const platforms = await p.multiselect({ message: `Where does ${name} publish or talk to customers?`, options: PLATFORMS, required: false });
  if (!platforms.length) return p.info("No accounts for now. Add them any time: mkt › Add accounts.");
  for (const platform of platforms) {
    const account = await askAccount(ctx, p, deps, brand, platform);
    if (!account) continue;
    addAccount(ctx, brand, account);
    p.success(`Added ${PLATFORM_NAME[platform]} as ${account.id}`);
  }
}

async function askAccount(ctx: Ctx, p: Prompter, deps: SetupDeps, brand: string, platform: Platform): Promise<Account | undefined> {
  const id = uniqueId(ctx, `${brand}-${platform}`);
  const envFile = path.join(ctx.root, ".env");

  if (platform === "whatsapp") {
    const transport = await p.select({
      message: "How should mkt use WhatsApp?",
      options: [
        { value: "browser" as const, label: "WhatsApp Web", hint: "scan a QR code once; for replies and people who opted in" },
        { value: "whatsapp_cloud" as const, label: "WhatsApp Cloud API", hint: "the official Business API; needs a Meta app" },
      ],
    });
    const phone = await p.text({ message: "WhatsApp number with country code", placeholder: "+34 600 000 000", validate: (v) => (/^\+?[\d\s().-]{8,}$/.test(v) ? undefined : "Use the full number, e.g. +34 600 000 000") });
    if (transport === "browser") {
      const inbox = await p.confirm({ message: "Let mkt read this inbox? (Opening a chat marks it as read.)", initial: true });
      return Account.parse({ id, platform, handle: phone, transport, inbox });
    }
    const phoneNumberId = await p.text({ message: "Phone number ID (Meta › WhatsApp › API setup)" });
    const token = await p.password({ message: "Access token" });
    const phoneEnv = envName("WA_PHONE_ID", id), tokenEnv = envName("WA_TOKEN", id);
    upsertEnv(envFile, { [phoneEnv]: phoneNumberId, [tokenEnv]: token });
    p.info(`Saved the token in .env as ${tokenEnv} (private to this computer).`);
    return Account.parse({ id, platform, handle: phone, transport, whatsappCloud: { phoneNumberIdEnv: phoneEnv, tokenEnv } });
  }

  if (platform === "email") {
    const mode = await p.select({
      message: "How should mkt send email?",
      options: [
        { value: "smtp" as const, label: "SMTP and IMAP", hint: "recommended: works with Gmail, Outlook, Zoho and most hosts" },
        { value: "browser" as const, label: "Gmail in the browser", hint: "no passwords stored; slower" },
      ],
    });
    const address = await p.text({ message: "Email address", placeholder: "hello@acme.com", validate: (v) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? undefined : "Enter an email address") });
    if (mode === "browser") return Account.parse({ id, platform, handle: address, transport: "browser" });

    const domain = address.split("@")[1].toLowerCase();
    const guess: MailProvider = /gmail\.com$/.test(domain) ? "gmail" : /(outlook|hotmail|live)\./.test(domain) ? "outlook" : /zoho/.test(domain) ? "zoho" : "gmail";
    while (true) {
      const provider = await p.select<MailProvider>({
        message: "Email provider",
        options: [
          ...Object.entries(MAIL_PROVIDERS).map(([k, v]) => ({ value: k as MailProvider, label: v.label })),
          { value: "custom" as const, label: "Other (enter servers)" },
        ],
        initial: guess,
      });
      let smtpBase: string, imapBase: string | undefined;
      if (provider === "custom") {
        smtpBase = await p.text({ message: "SMTP server", placeholder: "smtps://mail.acme.com:465", validate: (v) => (/^smtps?:\/\/[^\s]+$/.test(v) ? undefined : "Like smtps://host:465 or smtp://host:587") });
        imapBase = (await p.text({ message: "IMAP server (to read replies)", placeholder: "imaps://mail.acme.com:993 (optional)", optional: true, validate: (v) => (/^imaps?:\/\/[^\s]+$/.test(v) ? undefined : "Like imaps://host:993") })) || undefined;
      } else {
        p.note(MAIL_PROVIDERS[provider].help, MAIL_PROVIDERS[provider].label);
        smtpBase = MAIL_PROVIDERS[provider].smtp;
        imapBase = MAIL_PROVIDERS[provider].imap;
      }
      const user = await p.text({ message: "Login", initial: address });
      const pass = await p.password({ message: "Password or app password" });
      const sender = await p.text({ message: "Sender name", initial: getBrand(ctx, brand).name });
      const smtpUrl = withAuth(smtpBase, user, pass);
      let ok = true;
      try {
        await p.spin("Checking the SMTP login", () => deps.verifySmtp(smtpUrl), () => "SMTP login works");
      } catch {
        ok = false;
      }
      if (!ok) {
        const next = await p.select({
          message: "The SMTP login didn't work. What now?",
          options: [
            { value: "retry" as const, label: "Enter the details again" },
            { value: "save" as const, label: "Save it anyway", hint: "fix it later in .env" },
            { value: "skip" as const, label: "Skip email for now" },
          ],
        });
        if (next === "retry") continue;
        if (next === "skip") return undefined;
      }
      const smtpUrlEnv = envName("SMTP", id);
      const imapUrlEnv = imapBase ? envName("IMAP", id) : undefined;
      upsertEnv(envFile, { [smtpUrlEnv]: smtpUrl, ...(imapUrlEnv ? { [imapUrlEnv]: withAuth(imapBase!, user, pass) } : {}) });
      p.info(`Saved the login in .env as ${smtpUrlEnv} (private to this computer).`);
      return Account.parse({ id, platform, handle: address, transport: "smtp", inbox: !!imapUrlEnv, email: { from: `${sender} <${address}>`, smtpUrlEnv, imapUrlEnv } });
    }
  }

  const q = HANDLE_PROMPT[platform] ?? { message: `${PLATFORM_NAME[platform]} handle`, placeholder: "@acme" };
  const handle = await p.text({ message: q.message, placeholder: q.placeholder });
  const inbox = platform === "instagram" || platform === "linkedin" ? await p.confirm({ message: `Let mkt read ${PLATFORM_NAME[platform]} messages?`, initial: true }) : false;
  return Account.parse({ id, platform, handle, transport: "browser", inbox });
}

// ---------------------------------------------------------------- log in

async function logIn(ctx: Ctx, p: Prompter, deps: SetupDeps, brand: string, precheck: boolean): Promise<void> {
  const accounts = listAccounts(ctx, brand).filter((a) => a.transport === "browser" && a.active);
  if (!accounts.length) return;
  const go = await p.confirm({
    message: `Log in to ${accounts.length === 1 ? accounts[0].id : `${accounts.length} accounts`} now? Each opens in its own Chrome window; the login stays on this computer.`,
    initial: true,
  });
  if (!go) return p.info("Later: mkt › Log in to accounts.");
  for (const a of accounts) {
    if (precheck && (await p.spin(`Checking ${a.id}`, () => deps.checkLogin(ctx, a.id), (ok) => (ok ? `${a.id} is already logged in` : `${a.id} needs a login`)))) {
      await deps.closeBrowser(ctx, a.id);
      continue;
    }
    await p.spin(`Opening Chrome for ${a.id}`, () => deps.openForLogin(ctx, a.id), () => `Chrome is open for ${a.id}`);
    while (true) {
      const next = await p.select({
        message: `In that window, ${LOGIN_HINT[a.platform] ?? `log in to ${PLATFORM_NAME[a.platform]} as ${a.handle}`}. Then:`,
        options: [
          { value: "check" as const, label: "I'm logged in" },
          { value: "skip" as const, label: "Skip for now" },
        ],
      });
      if (next === "skip") break;
      const ok = await p.spin(`Checking ${a.id}`, () => deps.checkLogin(ctx, a.id), (ok) => (ok ? `${a.id} is logged in` : `${a.id} doesn't look logged in yet`));
      if (ok) break;
    }
    await deps.closeBrowser(ctx, a.id);
  }
}

// ---------------------------------------------------------------- automation

async function automation(ctx: Ctx, p: Prompter, deps: SetupDeps, brand: string, engines: Engine[]): Promise<void> {
  if (engines.length > 1) {
    const engine = await p.select<Engine>({
      message: "Which agent runs the scheduled work?",
      options: [
        { value: "claude", label: "Claude Code" },
        { value: "codex", label: "Codex" },
      ],
      initial: ctx.config.engine,
    });
    if (engine !== ctx.config.engine) editConfig(ctx, (doc) => doc.set("engine", engine));
  } else if (engines.length === 1 && engines[0] !== ctx.config.engine) {
    editConfig(ctx, (doc) => doc.set("engine", engines[0]));
  }

  const base = ctx.config.routines.filter((r) => ROUTINE_HINTS[r.name]);
  const already = ctx.config.routines.filter((r) => r.enabled && r.brand === brand).map((r) => r.name.replace(new RegExp(`-${brand}$`), ""));
  const picked = base.length
    ? await p.multiselect({
        message: `Routines for ${getBrand(ctx, brand).name}. They only prepare work; nothing goes out until you approve it.`,
        options: base.map((r) => ({ value: r.name, label: r.name, hint: ROUTINE_HINTS[r.name] })),
        initial: already,
        required: false,
      })
    : [];
  const fresh = picked.filter((n) => !already.includes(n));
  if (fresh.length) p.success(`Turned on: ${enableRoutines(ctx, brand, fresh).join(", ")}`);

  const hasWork = picked.length > 0 || listAccounts(ctx, brand).length > 0;
  if (deps.platform === "darwin") {
    const bg = await p.confirm({
      message: "Keep mkt running in the background? It sends what you approved on time, reads inboxes and runs routines.",
      initial: hasWork,
    });
    if (bg) await p.spin("Installing the background service", () => deps.installDaemon(ctx), (msg) => msg);
  } else if (hasWork) {
    p.note("Keep `mkt daemon` running (tmux, screen or a systemd user service) to send on time and run routines.", "Background");
  }
}

// ---------------------------------------------------------------- finish

async function finish(ctx: Ctx, p: Prompter, deps: SetupDeps, brand: string, engines: Engine[], fromMenu = false): Promise<void> {
  const cfg = getBrand(ctx, brand);
  const accounts = listAccounts(ctx, brand);
  const routines = ctx.config.routines.filter((r) => r.enabled && r.brand === brand).map((r) => r.name);
  if (!fromMenu)
    p.note(
      [
        `Brand      ${cfg.name} (${brand})`,
        `Accounts   ${accounts.map((a) => a.id).join(", ") || "none yet"}`,
        `Routines   ${routines.join(", ") || "none"}`,
        "",
        "Ask the agent for outcomes, for example:",
        `  /brand-foundation ${brand}`,
        `  "Trend radar for ${cfg.name}, then 10 scored ideas"`,
        `  "Find 20 leads that fit our customer and draft a first message"`,
        "",
        "Approve what it prepares with:  mkt review",
      ].join("\n"),
      "Ready",
    );
  const task = cfg.website
    ? `Use the brand-foundation skill for brand "${brand}": start from ${cfg.website}, then ask me what you can't find.`
    : `Use the brand-foundation skill for brand "${brand}": ask me what you need to know.`;
  const choice = engines.length
    ? await p.select<Engine | "done">({
        message: fromMenu ? "Open which agent?" : "Start now?",
        options: [
          ...engines.map((e) => ({
            value: e,
            label: fromMenu ? (e === "claude" ? "Claude Code" : "Codex") : `Open ${e === "claude" ? "Claude Code" : "Codex"} and build the brand foundation`,
            hint: fromMenu ? undefined : "it reads your website and asks you a few questions",
          })),
          { value: "done" as const, label: fromMenu ? "Back" : "Finish" },
        ],
      })
    : "done";
  if (choice === "done") {
    if (!fromMenu) p.outro("All set. Run mkt any time to change something.");
    return;
  }
  p.outro(`Opening ${choice === "claude" ? "Claude Code" : "Codex"}…`);
  await deps.launchAgent(ctx, choice, fromMenu ? "" : choice === "claude" ? `/brand-foundation ${brand}` : task);
}

// ---------------------------------------------------------------- status

async function status(ctx: Ctx, p: Prompter, deps: SetupDeps, tools: { checks: ToolCheck[] }): Promise<void> {
  const lines = tools.checks.map((c) => `${c.ok ? "✓" : "✗"} ${c.name.padEnd(14)} ${c.detail}`);
  const all = listAccounts(ctx).filter((a) => a.brand !== "example");
  const browsers = all.filter((a) => a.transport === "browser" && a.active);
  const check = browsers.length ? await p.confirm({ message: `Check the ${browsers.length} browser login(s)? Chrome opens briefly for each.`, initial: true }) : false;
  lines.push("");
  for (const a of all) {
    let state: string;
    if (a.transport === "smtp") state = a.email?.smtpUrlEnv && process.env[a.email.smtpUrlEnv] ? "✓ login saved" : `✗ ${a.email?.smtpUrlEnv ?? "SMTP"} missing in .env`;
    else if (a.transport === "whatsapp_cloud") state = a.whatsappCloud && process.env[a.whatsappCloud.tokenEnv] ? "✓ token saved" : "✗ token missing in .env";
    else if (!check) state = "· not checked";
    else {
      const ok = await p.spin(`Checking ${a.id}`, () => deps.checkLogin(ctx, a.id), (ok) => `${a.id}: ${ok ? "logged in" : "logged out"}`);
      await deps.closeBrowser(ctx, a.id);
      state = ok ? "✓ logged in" : "✗ logged out: mkt › Log in to accounts";
    }
    lines.push(`${a.id.padEnd(22)} ${state}`);
  }
  if (!all.length) lines.push("No accounts yet: mkt › Add accounts");
  p.note(lines.join("\n"), "Status");
}
