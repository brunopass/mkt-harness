import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Config, loadCtx, type Ctx } from "../src/core/config.js";

export const ROOT = path.resolve(import.meta.dirname, "..");

/** A throwaway workspace with brand "acme" and one account per transport we test. */
export function makeWs(configOverrides: Record<string, unknown> = {}): Ctx {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "mkt-test-"));
  const b = path.join(ws, "brands", "acme");
  fs.mkdirSync(path.join(b, "personas"), { recursive: true });
  fs.mkdirSync(path.join(b, "content"), { recursive: true });
  fs.writeFileSync(path.join(b, "brand.yaml"), 'name: Acme\ntimezone: Europe/Madrid\nlanguages: ["en", "pt"]\npillars: ["how-to", "proof"]\nbanned: ["guaranteed"]\n');
  fs.writeFileSync(path.join(b, "brand.md"), "# Acme\n\n## One-liner\nInbox software for small teams.\n");
  fs.writeFileSync(path.join(b, "voice.md"), "# Voice\nDirect, warm, no jargon.\n");
  fs.writeFileSync(path.join(b, "offers.md"), "# Offers\n## Offer: Starter\n- Price: 29 EUR/mo\n");
  fs.writeFileSync(path.join(b, "personas", "founder.md"), "# Persona: founder\nRuns a 5-person agency.\n");
  fs.writeFileSync(
    path.join(b, "accounts.yaml"),
    `accounts:
  - { id: acme-ig, platform: instagram, handle: "@acme" }
  - { id: acme-li, platform: linkedin, handle: acme }
  - { id: acme-wa, platform: whatsapp, handle: "+34600000001", inbox: true }
  - { id: acme-x, platform: x, handle: acme }
  - id: acme-email
    platform: email
    handle: hello@acme.test
    transport: smtp
    email: { from: "Acme <hello@acme.test>", smtpUrlEnv: MKT_TEST_SMTP }
`,
  );
  const config = Config.parse({ quietHours: null, ...configOverrides });
  return loadCtx({ ws, config, actor: "test" });
}

export const human = (ctx: Ctx): Ctx => ({ ...ctx, actor: "human:cli" });
