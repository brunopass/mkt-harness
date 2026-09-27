import type { Account, OutboxItem } from "../core/schemas.js";
import { MktError } from "../core/store.js";
import type { SendResult } from "../browser/adapters/types.js";

/**
 * Official WhatsApp Business Cloud API. Free-form text only works inside the 24h customer-service window (the
 * contact wrote to us in the last 24h); outside it Meta requires an approved template. Use
 * `subject: "template:<name>:<language>"` and put one template parameter per line in the body.
 */
export async function sendWhatsappCloud(account: Account, item: OutboxItem, opts: { dryRun: boolean }): Promise<SendResult> {
  const cfg = account.whatsappCloud;
  if (!cfg) throw new MktError(`account ${account.id}: whatsappCloud {phoneNumberIdEnv, tokenEnv} missing`);
  const phoneId = process.env[cfg.phoneNumberIdEnv];
  const token = process.env[cfg.tokenEnv];
  if (!phoneId || !token) throw new MktError(`account ${account.id}: set ${cfg.phoneNumberIdEnv} and ${cfg.tokenEnv} in .env`);
  const to = item.to?.phone?.replace(/\D/g, "");
  if (!to) throw new MktError("WhatsApp needs to.phone in international format");

  const tpl = item.subject?.match(/^template:([\w-]+):([\w_-]+)$/);
  const payload = tpl
    ? {
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: tpl[1],
          language: { code: tpl[2] },
          components: item.body.trim()
            ? [{ type: "body", parameters: item.body.split("\n").filter(Boolean).map((text) => ({ type: "text", text })) }]
            : [],
        },
      }
    : { messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { body: item.body, preview_url: true } };

  if (opts.dryRun) return { note: `dry run: would POST ${tpl ? "template" : "text"} message to ${to}` };

  const res = await fetch(`https://graph.facebook.com/${cfg.apiVersion}/${phoneId}/messages`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30_000),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new MktError(`WhatsApp Cloud API ${res.status}: ${json?.error?.message ?? JSON.stringify(json).slice(0, 300)}`);
  return { externalId: json?.messages?.[0]?.id };
}
