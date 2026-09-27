import { spawn, spawnSync } from "node:child_process";

/**
 * Open a URL or file with the system handler (browser, desktop app deep link). MKT_NO_OPEN=1 (tests) and headless
 * MCP runs never open anything.
 */
export function openExternal(target: string): boolean {
  if (process.env.MKT_NO_OPEN === "1" || process.env.MKT_MCP_PROFILE === "headless") return false;
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", target] : [target];
  try {
    spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();
    return true;
  } catch {
    return false;
  }
}

/** Best-effort clipboard copy (pbcopy, wl-copy/xclip, clip). Never touches the clipboard under MKT_NO_OPEN=1. */
export function copyToClipboard(text: string): boolean {
  if (process.env.MKT_NO_OPEN === "1") return false;
  const tries: [string, string[]][] =
    process.platform === "darwin" ? [["pbcopy", []]] : process.platform === "win32" ? [["clip", []]] : [["wl-copy", []], ["xclip", ["-selection", "clipboard"]]];
  for (const [cmd, args] of tries) {
    const r = spawnSync(cmd, args, { input: text, stdio: ["pipe", "ignore", "ignore"], timeout: 5000 });
    if (r.status === 0) return true;
  }
  return false;
}
