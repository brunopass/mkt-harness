import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { detachAll } from "./browser/chrome.js";
import { dispatchDue, type DispatchResult } from "./channels/dispatch.js";
import type { Ctx, Routine } from "./core/config.js";
import { audit, readJson, stateFile, writeJson } from "./core/store.js";
import { cronMatches } from "./core/time.js";
import { syncAll, type SyncResult } from "./inbox/sync.js";
import { runAgent } from "./runner/agent.js";

interface DaemonState {
  lastInboxSync?: string;
  lastRoutineRun: Record<string, string>;
}

export interface TickReport {
  at: string;
  dispatched: DispatchResult[];
  inbox?: SyncResult[];
  routinesStarted: string[];
}

const running = new Set<string>();
const minuteKey = (d: Date) => d.toISOString().slice(0, 16);

export function dueRoutines(ctx: Ctx, now: Date, state: DaemonState): Routine[] {
  return ctx.config.routines.filter(
    (r) => r.enabled && !running.has(r.name) && state.lastRoutineRun[r.name] !== minuteKey(now) && cronMatches(r.cron, now, ctx.config.timezone),
  );
}

export async function tick(ctx: Ctx, now = new Date(), opts: { routines?: boolean; inbox?: boolean } = {}): Promise<TickReport> {
  const sf = stateFile(ctx, "daemon.json");
  const state = readJson<DaemonState>(sf, { lastRoutineRun: {} });
  const report: TickReport = { at: now.toISOString(), dispatched: [], routinesStarted: [] };

  report.dispatched = await dispatchDue(ctx, { now });

  const every = ctx.config.inbox.syncEveryMin * 60_000;
  if (opts.inbox !== false && (!state.lastInboxSync || now.getTime() - Date.parse(state.lastInboxSync) >= every)) {
    report.inbox = await syncAll(ctx);
    state.lastInboxSync = now.toISOString();
  }

  if (opts.routines !== false) {
    for (const r of dueRoutines(ctx, now, state)) {
      state.lastRoutineRun[r.name] = minuteKey(now);
      running.add(r.name);
      report.routinesStarted.push(r.name);
      // routines can run for many minutes: never block sending on them
      runAgent({ ...ctx, actor: `routine:${r.name}` }, { prompt: r.prompt, engine: r.engine, brand: r.brand, name: r.name, browserActions: r.browserActions })
        .catch((e) => audit(ctx, "routine.error", { ref: r.name, detail: { error: String(e) } }))
        .finally(() => running.delete(r.name));
    }
  }
  writeJson(sf, state);
  return report;
}

export async function runDaemon(ctx: Ctx, opts: { once?: boolean; log?: (s: string) => void } = {}): Promise<void> {
  const log = opts.log ?? ((s: string) => console.log(s));
  const d: Ctx = { ...ctx, actor: "daemon" };
  let stop = false;
  const onSignal = () => {
    stop = true;
    log("stopping after this tick…");
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  log(`mkt daemon: workspace ${d.ws}, ${d.config.routines.filter((r) => r.enabled).length} routines, inbox every ${d.config.inbox.syncEveryMin}m`);
  do {
    try {
      const r = await tick(d);
      const sent = r.dispatched.filter((x) => x.status === "sent").length;
      const other = r.dispatched.filter((x) => x.status !== "sent");
      if (r.dispatched.length || r.inbox?.some((i) => i.added) || r.routinesStarted.length)
        log(
          `[${r.at}] sent ${sent}` +
            (other.length ? `, ${other.map((o) => `${o.id}:${o.status}${o.reason ? ` (${o.reason})` : ""}`).join("; ")}` : "") +
            (r.inbox ? `, inbox +${r.inbox.reduce((a, i) => a + i.added, 0)}` : "") +
            (r.routinesStarted.length ? `, started ${r.routinesStarted.join(", ")}` : ""),
        );
    } catch (e: any) {
      log(`[${new Date().toISOString()}] tick failed: ${e.message}`);
    }
    await detachAll();
    if (opts.once || stop) break;
    const ms = 60_000 - (Date.now() % 60_000) + 500;
    await new Promise((res) => setTimeout(res, ms));
  } while (!stop);
  while (running.size) await new Promise((res) => setTimeout(res, 1000));
}

/** macOS launchd agent that keeps `mkt daemon` running while the user is logged in. */
export function launchdPlist(ctx: Ctx): { file: string; xml: string } {
  const label = "com.mkt-harness.daemon";
  const logs = path.join(ctx.ws, "logs");
  fs.mkdirSync(logs, { recursive: true });
  const nodeDir = path.dirname(process.execPath);
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key>
  <array><string>${path.join(ctx.root, "bin", "mkt")}</string><string>daemon</string></array>
  <key>WorkingDirectory</key><string>${ctx.root}</string>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>${nodeDir}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${path.join(os.homedir(), ".local/bin")}</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${path.join(logs, "daemon.log")}</string>
  <key>StandardErrorPath</key><string>${path.join(logs, "daemon.err.log")}</string>
</dict>
</plist>
`;
  return { file: path.join(os.homedir(), "Library", "LaunchAgents", `${label}.plist`), xml };
}
