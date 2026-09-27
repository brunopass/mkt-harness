import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { Command } from "commander";
import { adapterFor } from "./browser/adapters/index.js";
import { chromePath, chromeStatus, closeChrome, detachAll, ensureChrome, getPage, goto, RESEARCH_PROFILE } from "./browser/chrome.js";
import { dispatchDue, dispatchOne, type DispatchResult } from "./channels/dispatch.js";
import { addAccount, createBrand, getAccount, getBrand, listAccounts, listBrands, listPersonas } from "./core/brands.js";
import { loadCtx, ROOT, type Ctx } from "./core/config.js";
import { listContent } from "./core/content.js";
import { listThreads } from "./core/conversations.js";
import { suppress } from "./core/identity.js";
import { getLead, importLeadsCsv, listLeads, updateLead } from "./core/leads.js";
import { approveOutbox, cancelOutbox, getOutbox, listOutbox, updateOutbox } from "./core/outbox.js";
import { checkPolicy } from "./core/policy.js";
import { Account, LEAD_STAGES, PLATFORMS, type LeadStage, type OutboxItem } from "./core/schemas.js";
import { MktError, readJsonl, truncate } from "./core/store.js";
import { fetchFeedAndObserve, momentum } from "./core/trends.js";
import { launchdPlist, runDaemon } from "./daemon.js";
import { syncAccount, syncAll } from "./inbox/sync.js";
import { startMcp } from "./mcp/server.js";
import { scanSite, describeProfile, saveProfile } from "./research/site.js";
import { checkLogin, claudeTrusted, launchAgent, realDeps } from "./setup/deps.js";
import { engineOf, findApp, initWorkspace, SURFACES, switchMode, type Surface } from "./setup/helpers.js";
import { Cancelled, clackPrompter } from "./setup/prompter.js";
import { homePrompt, runSetup, SURFACE_LABEL } from "./setup/tui.js";
import { renderContent } from "./render/carousel.js";
import { openInBrowser, writeReport } from "./report/render.js";
import { buildCommand, runAgent } from "./runner/agent.js";

const envFile = path.join(ROOT, ".env");
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const ctx = (): Ctx => loadCtx({ actor: "human:cli" });
const out = (s: string): void => void process.stdout.write(s + "\n");
const tty = process.stdout.isTTY;
const c = {
  dim: (s: string) => (tty ? `\x1b[2m${s}\x1b[0m` : s),
  bold: (s: string) => (tty ? `\x1b[1m${s}\x1b[0m` : s),
  red: (s: string) => (tty ? `\x1b[31m${s}\x1b[0m` : s),
  green: (s: string) => (tty ? `\x1b[32m${s}\x1b[0m` : s),
  yellow: (s: string) => (tty ? `\x1b[33m${s}\x1b[0m` : s),
};

function table(rows: Record<string, unknown>[], cols?: string[]): string {
  if (!rows.length) return c.dim("(none)");
  const keys = cols ?? Object.keys(rows[0]);
  const cell = (v: unknown) => (v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v)).replace(/\s+/g, " ");
  const widths = keys.map((k) => Math.min(60, Math.max(k.length, ...rows.map((r) => cell(r[k]).length))));
  const line = (vals: string[]) => vals.map((v, i) => truncate(v, widths[i]).padEnd(widths[i])).join("  ");
  return [c.bold(line(keys)), ...rows.map((r) => line(keys.map((k) => cell(r[k]))))].join("\n");
}

function statusColor(s: string): string {
  if (["sent", "approved", "published"].includes(s)) return c.green(s);
  if (["failed", "blocked"].includes(s)) return c.red(s);
  if (["pending_approval", "sending"].includes(s)) return c.yellow(s);
  return s;
}

function printDispatch(r: DispatchResult): void {
  const bits = [r.id, statusColor(r.status), r.reason, r.retryAt && `retry after ${r.retryAt}`, r.url, r.note, r.screenshot && `screenshot: ${r.screenshot}`];
  out(bits.filter(Boolean).join("  "));
}

const program = new Command("mkt").description("mkt-harness: AI marketing harness for Claude Code and Codex").showHelpAfterError();

// ---------------------------------------------------------------- setup

program
  .command("init")
  .description("create the workspace, config and MCP wiring for Claude Code (.mcp.json) and Codex (.codex/config.toml)")
  .action(() => {
    const x = ctx();
    initWorkspace(x);
    out(`workspace: ${x.ws}\nconfig:    ${path.join(x.root, "mkt.config.yaml")}\nMCP:       .mcp.json (Claude Code), .codex/config.toml (Codex; trust the project in Codex)\nskills:    .claude/skills, .agents/skills -> skills/`);
    out(`\nnext: mkt setup   (or: mkt brand new <slug> --name "<Brand>")`);
  });

/**
 * `mkt open [claude|codex|claude-desktop|codex-desktop|desktop] [words...]`: everything after the target is the first
 * message, taken literally. No target: the remembered choice (config `open`), else the default engine in the terminal.
 */
async function openAgent(args: string[]): Promise<never> {
  const x = ctx();
  const fallback: Surface = x.config.open ?? x.config.engine;
  let surface: Surface = fallback;
  let words = args;
  if ((SURFACES as readonly string[]).includes(args[0])) (surface = args[0] as Surface), (words = args.slice(1));
  else if (args[0] === "desktop") (surface = `${engineOf(fallback)}-desktop` as Surface), (words = args.slice(1));
  // no message: start on the home screen (brand status and next actions)
  const prompt = words.length ? words.join(" ") : homePrompt(engineOf(surface));
  if (surface === "claude" && !claudeTrusted(x))
    process.stderr.write('First time here: when Claude Code asks whether you trust this folder, choose "Yes, I trust this folder".\n');
  if (surface.endsWith("-desktop") && !findApp(surface === "claude-desktop" ? "Claude" : "Codex"))
    throw new MktError(`${SURFACE_LABEL[surface]} isn't installed; use: mkt open ${engineOf(surface)}`);
  const r = await launchAgent(x, surface, prompt);
  if (surface === "claude-desktop") out(`Opening ${SURFACE_LABEL[surface]}: confirm the folder, then press Enter to send "${prompt}".`);
  if (surface === "codex-desktop") out(`Opening ${SURFACE_LABEL[surface]}.${r.copied ? " The first message is on your clipboard: paste it (⌘V) and send." : ` First message: ${prompt}`}`);
  if (r.url && !r.opened) out(r.url); // MKT_NO_OPEN, or no system handler
  process.exit(0);
}

program
  .command("open [target] [prompt...]")
  .description("open the agent on the harness folder: claude | codex | claude-desktop | codex-desktop | desktop (default: your last choice)")
  .helpOption(false)
  .action(async () => {
    await openAgent(process.argv.slice(3)); // handled before parsing; kept here for --help
  });

program
  .command("setup")
  .description("guided setup in the terminal: brand, accounts, logins, routines (also what `mkt` alone opens)")
  .action(async () => {
    if (!process.stdin.isTTY || !process.stdout.isTTY) throw new MktError("mkt setup needs an interactive terminal");
    try {
      await runSetup(ctx(), clackPrompter, realDeps);
    } catch (e) {
      if (!(e instanceof Cancelled)) throw e;
      out(c.dim("\nSetup stopped. Run mkt again to pick up where you left off."));
    } finally {
      await detachAll();
    }
    // exit now: leftover handles (Chrome connections, sockets) must not delay handing the terminal to the agent
    process.exit(0);
  });

program
  .command("doctor")
  .description("check node, chrome, config, brands, accounts and agent CLIs")
  .action(async () => {
    const x = ctx();
    const check = (ok: boolean, label: string, detail = "") => out(`${ok ? c.green("ok  ") : c.red("FAIL")} ${label}${detail ? c.dim("  " + detail) : ""}`);
    const major = +process.versions.node.split(".")[0];
    check(major >= 22, "node", process.versions.node);
    try {
      check(true, "chrome", chromePath(x));
    } catch (e: any) {
      check(false, "chrome", e.message);
    }
    check(fs.existsSync(path.join(x.root, "mkt.config.yaml")), "mkt.config.yaml", "run mkt init if missing");
    check(fs.existsSync(path.join(x.root, ".mcp.json")), ".mcp.json (Claude Code)");
    check(fs.existsSync(path.join(x.root, ".codex", "config.toml")), ".codex/config.toml (Codex)");
    for (const bin of [x.config.runner.claude.bin, x.config.runner.codex.bin]) {
      const r = spawnSync(bin, ["--version"], { encoding: "utf8", timeout: 15_000 });
      check(r.status === 0, bin, r.status === 0 ? r.stdout.trim().split("\n")[0] : r.error?.message ?? `exit ${r.status ?? r.signal}`);
    }
    for (const app of ["Claude", "Codex"]) {
      const found = findApp(app);
      out(`${found ? c.green("ok  ") : c.dim("--  ")} ${app} desktop app${c.dim("  " + (found ?? "not installed (optional): mkt open uses the terminal"))}`);
    }
    const brands = listBrands(x);
    check(brands.length > 0, "brands", brands.join(", ") || "none: mkt brand new <slug>");
    for (const b of brands) {
      try {
        const accts = listAccounts(x, b);
        check(true, `  ${b}`, `${accts.length} accounts, ${listPersonas(x, b).length} personas`);
        for (const a of accts) {
          if (a.transport === "smtp") check(!!(a.email?.smtpUrlEnv && process.env[a.email.smtpUrlEnv]), `    ${a.id} smtp`, a.email?.smtpUrlEnv ? `env ${a.email.smtpUrlEnv}` : "email.smtpUrlEnv missing");
          else if (a.transport === "whatsapp_cloud") check(!!(a.whatsappCloud && process.env[a.whatsappCloud.tokenEnv]), `    ${a.id} whatsapp cloud`);
          else {
            const st = await chromeStatus(x, a.id);
            check(true, `    ${a.id} browser`, st.alive ? `running on :${st.port}` : fs.existsSync(st.profile) ? "profile exists (check login: mkt browser check)" : `no profile yet: mkt browser open ${a.id}`);
          }
        }
      } catch (e: any) {
        check(false, `  ${b}`, e.message);
      }
    }
  });

program.command("mcp").description("run the MCP server on stdio (used by Claude Code and Codex)").action(async () => {
  await startMcp(loadCtx({ actor: "agent:mcp" }));
});

// ---------------------------------------------------------------- brands & accounts

const brand = program.command("brand").description("brands");
brand
  .command("new <slug>")
  .requiredOption("--name <name>")
  .option("--website <url>")
  .option("--languages <list>", "comma separated, e.g. pt,en", "en")
  .option("--timezone <tz>", "IANA timezone, e.g. Europe/Madrid")
  .action((slug, o) => {
    const dir = createBrand(ctx(), slug, o.name, { website: o.website, languages: o.languages.split(","), timezone: o.timezone });
    out(`created ${dir}\nnext: run the brand-foundation skill in Claude Code / Codex ("/brand-foundation ${slug}") to fill it in.`);
  });
brand
  .command("scan <url>")
  .description("read a website: name, languages, socials, contacts, colours and fonts (saved under research/ with --brand)")
  .option("--brand <brand>", "save the scan to workspace/brands/<brand>/research/")
  .option("--json", "print the full result as JSON")
  .action(async (url, o) => {
    const x = ctx();
    const prof = await scanSite(x, url);
    if (o.json) out(JSON.stringify(prof, null, 2));
    else out(describeProfile(prof));
    if (o.brand) out(c.dim(`saved ${path.relative(x.root, saveProfile(x, o.brand, prof))}`));
  });
brand.command("list").action(() => {
  const x = ctx();
  out(table(listBrands(x).map((b) => ({ brand: b, name: getBrand(x, b).name, accounts: listAccounts(x, b).length, personas: listPersonas(x, b).length, content: listContent(x, b).length, leads: listLeads(x, b).length }))));
});
brand.command("show <slug>").action((slug) => {
  const x = ctx();
  out(JSON.stringify(getBrand(x, slug), null, 2));
  out(table(listAccounts(x, slug).map((a) => ({ id: a.id, platform: a.platform, handle: a.handle, transport: a.transport, active: a.active, inbox: a.inbox }))));
});

const account = program.command("account").description("social / email / WhatsApp accounts");
account
  .command("add <brand> <platform> <handle>")
  .option("--id <id>", "account id (default <brand>-<platform>)")
  .option("--transport <t>", "browser | smtp | whatsapp_cloud", "browser")
  .option("--inbox", "read this account's inbox in inbox sync / the daemon")
  .option("--from <from>", "email: From header, e.g. 'Ana <ana@acme.com>'")
  .option("--smtp-env <var>", "email: env var holding smtps://user:pass@host:465")
  .option("--imap-env <var>", "email: env var holding imaps://user:pass@host:993")
  .action((b, platform, handle, o) => {
    if (!PLATFORMS.includes(platform)) throw new MktError(`platform must be one of ${PLATFORMS.join(", ")}`);
    const a = Account.parse({
      id: o.id ?? `${b}-${platform}`,
      platform,
      handle,
      transport: o.transport,
      inbox: !!o.inbox,
      email: platform === "email" && o.transport === "smtp" ? { from: o.from ?? handle, smtpUrlEnv: o.smtpEnv, imapUrlEnv: o.imapEnv } : undefined,
    });
    addAccount(ctx(), b, a);
    out(`added ${a.id}` + (a.transport === "browser" ? `\nnext: mkt browser open ${a.id}   (log in once in that window)` : ""));
  });
account.command("list [brand]").action((b) => {
  out(table(listAccounts(ctx(), b).map((a) => ({ id: a.id, brand: a.brand, platform: a.platform, handle: a.handle, transport: a.transport, active: a.active, inbox: a.inbox }))));
});

// ---------------------------------------------------------------- browser

const browser = program.command("browser").description("per-account Chrome profiles");
browser
  .command("open <account> [url]")
  .description(`open the account's Chrome window (visible) at the login page or a URL; log in by hand once ("${RESEARCH_PROFILE}" = brand-neutral research profile)`)
  .action(async (id, url) => {
    const x = ctx();
    const target = url ?? (id === RESEARCH_PROFILE ? "https://www.google.com/" : adapterFor(getAccount(x, id).platform).loginUrl);
    const { port, launched } = await ensureChrome(x, id, { headless: false, url: target });
    if (!launched) {
      const page = await getPage(x, id, { newTab: true });
      await goto(x, page, target);
    }
    await detachAll();
    out(`Chrome for ${id} on :${port} (${launched ? "launched" : "already running"}). Log in there; the session stays in workspace/.profiles/${id}.`);
  });
browser.command("close [account]").option("--all").action(async (id, o) => {
  const x = ctx();
  const ids = o.all ? listAccounts(x).map((a) => a.id) : id ? [id] : [];
  if (!ids.length) throw new MktError("pass an account or --all");
  for (const i of ids) if (await closeChrome(x, i)) out(`closed ${i}`);
});
browser.command("status").action(async () => {
  const x = ctx();
  const rows = [];
  for (const a of listAccounts(x).filter((a) => a.transport === "browser")) rows.push({ ...(await chromeStatus(x, a.id)), platform: a.platform });
  out(table(rows, ["account", "platform", "alive", "port", "headless"]));
});
browser
  .command("check [account]")
  .description("is each browser account still logged in?")
  .action(async (id) => {
    const x = ctx();
    const ids = id ? [getAccount(x, id)] : listAccounts(x).filter((a) => a.transport === "browser" && a.active);
    for (const a of ids) {
      const ok = await checkLogin(x, a.id);
      out(`${ok ? c.green("logged in ") : c.red("logged out")} ${a.id}${ok ? "" : `  -> mkt browser open ${a.id}`}`);
    }
    await detachAll();
  });

// ---------------------------------------------------------------- content

const content = program.command("content").description("content items");
content.command("list <brand>").option("--status <list>").action((b, o) => {
  out(table(listContent(ctx(), b, { status: o.status?.split(",") }).map((i) => ({ id: i.id, status: i.status, format: i.format, title: i.title, score: i.score, scheduledFor: i.scheduledFor }))));
});
content.command("render <brand> <id>").option("--handle <text>").action(async (b, id, o) => {
  for (const f of await renderContent(ctx(), b, id, { handle: o.handle })) out(f);
});

// ---------------------------------------------------------------- leads

const leads = program.command("leads").description("leads / CRM");
leads
  .command("list <brand>")
  .option("--stage <list>")
  .option("--limit <n>", "", "50")
  .action((b, o) => {
    out(table(listLeads(ctx(), b, { stage: o.stage?.split(","), limit: +o.limit }).map((l) => ({ id: l.id, name: l.name, company: l.company, stage: l.stage, score: l.score, touches: l.touches, email: l.email, handles: Object.keys(l.handles).join(",") }))));
  });
leads.command("show <brand> <id>").action((b, id) => out(JSON.stringify(getLead(ctx(), b, id), null, 2)));
leads
  .command("import <brand> <csv>")
  .option("--source <text>", "where this list came from (recorded on each lead)")
  .description("columns: name,company,role,email,phone,persona,tags,notes,consent_email,consent_whatsapp,consent_basis,<platform> handles")
  .action((b, file, o) => {
    const r = importLeadsCsv(ctx(), b, fs.readFileSync(file, "utf8"), o.source ?? path.basename(file));
    out(`created ${r.created}, merged ${r.merged}, skipped ${r.skipped} (no email/phone/handle)`);
  });
leads.command("set-stage <brand> <id> <stage>").description("human override, including leaving do_not_contact").action((b, id, stage) => {
  if (!LEAD_STAGES.includes(stage)) throw new MktError(`stage must be one of ${LEAD_STAGES.join(", ")}`);
  const l = updateLead(ctx(), b, id, { stage: stage as LeadStage, note: `stage set to ${stage} by human` });
  out(`${l.id} -> ${l.stage}`);
});

// ---------------------------------------------------------------- outbox, review, send

program
  .command("outbox")
  .description("list outbox items")
  .option("--brand <brand>")
  .option("--status <list>", "comma separated", "pending_approval,approved,sending,failed,blocked")
  .option("--all", "every status")
  .action((o) => {
    const items = listOutbox(ctx(), o.brand, { status: o.all ? undefined : o.status.split(",") });
    out(table(items.map((i) => ({ id: i.id, status: statusColor(i.status), kind: i.kind, account: i.account, to: i.to?.name ?? i.to?.handle ?? i.to?.email ?? i.to?.phone ?? "", when: i.scheduledFor ?? "", body: i.body, error: i.lastError ?? "" }))));
  });

function card(x: Ctx, it: OutboxItem): string {
  const lines = [
    c.bold(`${it.id}  ${it.kind.toUpperCase()} via ${it.account} (${it.platform})  [${it.brand}]`),
    it.to ? `to:        ${[it.to.name, it.to.handle, it.to.email, it.to.phone, it.to.url].filter(Boolean).join(" · ")}` : "",
  ];
  if (it.to?.leadId) {
    try {
      const l = getLead(x, it.brand, it.to.leadId);
      lines.push(`lead:      ${l.id} stage=${l.stage} score=${l.score} touches=${l.touches}${l.research ? `\n           ${truncate(l.research, 200)}` : ""}`);
    } catch {}
  }
  if (it.scheduledFor) lines.push(`when:      ${it.scheduledFor}`);
  if (it.sequence) lines.push(`sequence:  ${it.sequence.name} step ${it.sequence.step}`);
  if (it.rationale) lines.push(`why:       ${it.rationale}`);
  if (it.subject) lines.push(`subject:   ${it.subject}`);
  if (it.media.length) lines.push(`media:     ${it.media.join(", ")}`);
  lines.push(c.dim("─".repeat(60)), it.body, c.dim("─".repeat(60)));
  const p = checkPolicy(x, { ...it, approval: { by: "preview", at: new Date().toISOString() } });
  if (!p.ok) lines.push((p.block ? c.red("will be blocked: ") : c.yellow("will wait: ")) + p.reason);
  if (it.dryRun) lines.push(c.dim(`dry run ${it.dryRun.at}: ${it.dryRun.note ?? ""} ${it.dryRun.screenshot ?? ""}`));
  return lines.filter(Boolean).join("\n");
}

function editInEditor(text: string): string {
  const f = path.join(os.tmpdir(), `mkt-edit-${process.pid}.txt`);
  fs.writeFileSync(f, text);
  const editor = process.env.VISUAL || process.env.EDITOR || "vi";
  spawnSync(editor, [f], { stdio: "inherit", shell: true });
  const r = fs.readFileSync(f, "utf8");
  fs.rmSync(f, { force: true });
  return r;
}

program
  .command("review")
  .description("go through items waiting for approval: approve, edit, reject, dry-run")
  .option("--brand <brand>")
  .action(async (o) => {
    const x = ctx();
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      const queue = listOutbox(x, o.brand, { status: ["pending_approval"] });
      if (!queue.length) return out("nothing waiting for approval");
      out(`${queue.length} waiting for approval\n`);
      for (let i = 0; i < queue.length; i++) {
        let it = getOutbox(x, queue[i].id);
        if (it.status !== "pending_approval") continue;
        out(`\n(${i + 1}/${queue.length})\n${card(x, it)}`);
        const ans = (await rl.question("[a]pprove  [e]dit  [r]eject  [d]ry-run  [s]kip  [q]uit > ")).trim().toLowerCase();
        if (ans === "a") {
          approveOutbox(x, [it.id]);
          out(c.green("approved"));
        } else if (ans === "e") {
          const header = it.subject != null ? `Subject: ${it.subject}\n\n` : "";
          const edited = editInEditor(header + it.body);
          const m = edited.match(/^Subject: (.*)\n\n?([\s\S]*)$/);
          it = updateOutbox(x, it.id, m ? { subject: m[1], body: m[2].trimEnd() } : { body: edited.trimEnd() });
          i--;
        } else if (ans === "r") {
          const reason = (await rl.question("reason (helps the agent learn): ")).trim() || "rejected in review";
          cancelOutbox(x, it.id, `rejected: ${reason}`);
          out(c.red("rejected"));
        } else if (ans === "d") {
          printDispatch(await dispatchOne(x, it.id, { dryRun: true }));
          await detachAll();
          i--;
        } else if (ans === "q") break;
      }
    } finally {
      rl.close();
    }
  });

program.command("approve <ids...>").option("--note <text>").action((ids, o) => {
  for (const it of approveOutbox(ctx(), ids, o.note)) out(`approved ${it.id}`);
});
program.command("reject <id>").option("--reason <text>", "", "rejected").action((id, o) => {
  cancelOutbox(ctx(), id, `rejected: ${o.reason}`);
  out(`rejected ${id}`);
});
program
  .command("send [id]")
  .description("send one approved item, or --due for everything due; --dry-run prepares without sending")
  .option("--due")
  .option("--dry-run")
  .action(async (id, o) => {
    const x = ctx();
    try {
      if (id) printDispatch(await dispatchOne(x, id, { dryRun: !!o.dryRun }));
      else if (o.due) (await dispatchDue(x)).forEach(printDispatch);
      else throw new MktError("pass an id or --due");
    } finally {
      await detachAll();
    }
  });

// ---------------------------------------------------------------- inbox

const inbox = program.command("inbox").description("inbound messages");
inbox.command("sync [account]").option("--brand <brand>").action(async (id, o) => {
  const x = ctx();
  try {
    const rs = id ? [await syncAccount(x, id)] : await syncAll(x, o.brand);
    out(table(rs as any));
  } finally {
    await detachAll();
  }
});
inbox.command("list <brand>").option("--needs-reply").action((b, o) => {
  out(table(listThreads(ctx(), b, { needsReply: o.needsReply ? true : undefined, limit: 50 }).map((t) => ({ thread: t.threadKey, account: t.account, last: t.lastDirection, at: t.lastAt, text: t.lastText, flags: t.flags.join(",") }))));
});

// ---------------------------------------------------------------- trends

const trends = program.command("trends").description("trend signals");
trends.command("fetch <brand> <feed>").description("feed: https://... or google-trends:<GEO>").action(async (b, feed) => {
  const r = await fetchFeedAndObserve(ctx(), b, feed);
  out(table(r.items.map((i) => ({ title: i.title, traffic: i.traffic ?? "", published: i.published ?? "" }))));
  out(c.dim(`recorded ${r.observed} observations`));
});
trends.command("momentum <brand>").option("--days <n>", "", "30").action((b, o) => {
  out(table(momentum(ctx(), b, { windowDays: +o.days, limit: 40 }).map((t) => ({ topic: t.topic, stage: t.stage, momentum: t.momentum, confidence: t.confidence, sources: t.sources, obs: t.observations, lastSeen: t.lastSeen }))));
});

// ---------------------------------------------------------------- safety

program
  .command("report <file>")
  .description("show a Markdown report/plan from the workspace as a styled page in the browser")
  .option("--no-open", "only write the .html next to it")
  .action((file: string, o) => {
    const x = ctx();
    const r = writeReport(x, file);
    const opened = o.open !== false && openInBrowser(r.html);
    out(`${path.relative(x.root, r.html)}${opened ? " (opened)" : ""}`);
  });

program
  .command("suppress <identifiers...>")
  .description("never contact: email, +phone or platform:handle")
  .requiredOption("--reason <text>")
  .action((ids, o) => {
    const added = suppress(ctx(), ids, o.reason, "human:cli");
    out(`suppressed ${added.length} new identifier(s)`);
  });
program.command("audit").option("--tail <n>", "", "30").action((o) => {
  const rows = readJsonl<any>(path.join(ctx().ws, "audit.jsonl")).slice(-+o.tail);
  out(table(rows.map((r) => ({ at: r.at, actor: r.actor, action: r.action, brand: r.brand ?? "", ref: r.ref ?? "", detail: r.detail ?? "" }))));
});

// ---------------------------------------------------------------- agents & automation

program
  .command("agent <prompt...>")
  .description("run a task headlessly with Claude Code or Codex (e.g. mkt agent --brand acme \"use trend-radar and update the radar\")")
  .option("--brand <brand>")
  .option("--engine <engine>", "claude | codex")
  .option("--browser-actions", "allow clicking/typing in the browser (default read-only browsing)")
  .option("--name <name>", "run name for the log file in workspace/runs/")
  .option("--print-command", "show the command instead of running it")
  .action(async (words, o) => {
    const x = ctx();
    const prompt = words.join(" ");
    if (o.printCommand) {
      const cmd = buildCommand(x, o.engine ?? x.config.engine, "<mcp.json>", "<last.txt>", { MKT_MCP_PROFILE: "headless" });
      return out([cmd.bin, ...cmd.args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a))].join(" "));
    }
    const r = await runAgent(x, { prompt, brand: o.brand, engine: o.engine, name: o.name, browserActions: !!o.browserActions });
    out(r.output);
    out(c.dim(`\n${r.ok ? "ok" : "FAILED"} (${r.engine}${r.costUsd != null ? `, $${r.costUsd.toFixed(3)}` : ""}) log: ${r.logFile}`));
    if (!r.ok) process.exitCode = 1;
  });

program
  .command("autopilot [state]")
  .description("on: agents decide and the harness approves their drafts; off: you approve everything (mkt review); status")
  .option("--kinds <list>", "which kinds run on autopilot (comma separated): post,reply,dm,comment,connect,email")
  .option("--approve-pending", "when turning on: also approve what's already waiting (never held items)")
  .action((state: string | undefined, o) => {
    const x = ctx();
    const kinds = o.kinds ? (o.kinds.split(",").map((k: string) => k.trim()) as any) : undefined;
    if (!state || state === "status") {
      const held = listOutbox(x, undefined, { status: ["pending_approval"] });
      out(`mode: ${x.config.mode === "autopilot" ? c.yellow("autopilot") : "review"}${x.config.mode === "autopilot" ? ` (${x.config.autopilot.kinds.join(", ")})` : ""}`);
      out(`waiting for a human: ${held.length}${held.filter((i) => i.hold).length ? ` (${held.filter((i) => i.hold).length} held)` : ""}`);
      return;
    }
    if (state !== "on" && state !== "off") throw new MktError("use: mkt autopilot on | off | status");
    const r = switchMode(x, state === "on" ? "autopilot" : "review", { kinds, approvePending: !!o.approvePending });
    if (r.mode === "autopilot") {
      out(c.yellow(`autopilot on for: ${r.kinds.join(", ")}`));
      out("Agents decide and their drafts are approved automatically; the daemon sends them within the limits.");
      out("Still enforced: do-not-contact list and opt-outs, consent, quiet hours, daily limits, and items an agent holds for you.");
      if (r.approved) out(`approved ${r.approved} item(s) that were waiting`);
    } else {
      out("review mode: you approve everything in mkt review");
      if (r.revoked) out(`${r.revoked} item(s) autopilot had approved went back to review`);
    }
    if (r.held) out(`${r.held} item(s) held for you: mkt review`);
  });

const routine = program.command("routine").description("scheduled agent routines (mkt.config.yaml routines:)");
routine.command("list").action(() => {
  out(table(ctx().config.routines.map((r) => ({ name: r.name, cron: r.cron, enabled: r.enabled, engine: r.engine ?? "", brand: r.brand ?? "", prompt: r.prompt }))));
});
routine.command("run <name>").action(async (name) => {
  const x = ctx();
  const r = x.config.routines.find((r) => r.name === name);
  if (!r) throw new MktError(`no routine "${name}"`);
  const res = await runAgent({ ...x, actor: `routine:${name}` }, { prompt: r.prompt, engine: r.engine, brand: r.brand, name, browserActions: r.browserActions });
  out(res.output);
  out(c.dim(`log: ${res.logFile}`));
});

const daemon = program.command("daemon").description("send due items, sync inboxes and run routines every minute").option("--once", "one tick and exit");
daemon.action(async (o) => runDaemon(ctx(), { once: !!o.once }));
daemon
  .command("install")
  .description("macOS: keep the daemon running with launchd")
  .option("--load", "also load it now")
  .action((o) => {
    const { file, xml } = launchdPlist(ctx());
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, xml);
    out(`wrote ${file}`);
    const cmd = `launchctl bootstrap gui/${process.getuid?.()} ${file}`;
    if (o.load) {
      const r = spawnSync("launchctl", ["bootstrap", `gui/${process.getuid?.()}`, file], { encoding: "utf8" });
      out(r.status === 0 ? "loaded" : `launchctl failed: ${r.stderr}`);
    } else out(`load with: ${cmd}`);
  });
daemon.command("uninstall").action(() => {
  const { file } = launchdPlist(ctx());
  spawnSync("launchctl", ["bootout", `gui/${process.getuid?.()}`, file], { stdio: "inherit" });
  fs.rmSync(file, { force: true });
  out(`removed ${file}`);
});

// `mkt open ...` takes the rest of the line literally (a message may contain "-rf" or "--x"), so it skips option parsing.
// `mkt` alone opens the guided setup in a terminal, and prints help otherwise.
const argv = process.argv.length <= 2 && process.stdin.isTTY && process.stdout.isTTY ? [...process.argv, "setup"] : process.argv;
(argv[2] === "open" ? openAgent(argv.slice(3)) : program.parseAsync(argv)).catch((e) => {
  process.stderr.write(c.red(`error: ${e instanceof MktError ? e.message : e?.stack ?? e}`) + "\n");
  process.exit(1);
});
