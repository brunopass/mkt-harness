import nodemailer, { type SendMailOptions } from "nodemailer";
import { getBrand } from "../core/brands.js";
import type { Ctx } from "../core/config.js";
import { getThread, threadKey } from "../core/conversations.js";
import type { Account, OutboxItem } from "../core/schemas.js";
import { MktError } from "../core/store.js";
import type { SendResult } from "../browser/adapters/types.js";

export function smtpUrl(account: Account): string {
  const env = account.email?.smtpUrlEnv;
  if (!env) throw new MktError(`account ${account.id}: set email.smtpUrlEnv (name of an env var holding smtps://user:pass@host:465)`);
  const v = process.env[env];
  if (!v) throw new MktError(`account ${account.id}: env var ${env} is not set (put it in .env)`);
  return v;
}

/** Cold emails carry the opt-out line and the sender's identity; replies in an existing thread do not. */
export function composeEmailText(ctx: Ctx, item: OutboxItem): string {
  if (item.kind === "reply") return item.body;
  const brand = getBrand(ctx, item.brand);
  const sender = [brand.sender?.name ?? brand.name, brand.sender?.address].filter(Boolean).join(" · ");
  return `${item.body.trimEnd()}\n\n--\n${sender}\n${ctx.config.outreach.emailFooter}\n`;
}

export async function sendSmtp(ctx: Ctx, account: Account, item: OutboxItem, opts: { dryRun: boolean; media: string[] }): Promise<SendResult> {
  if (!item.to?.email) throw new MktError("email needs to.email");
  const from = account.email?.from ?? account.handle;
  const transport = nodemailer.createTransport(smtpUrl(account));
  const inbound = getThread(ctx, item.brand, threadKey("email", { email: item.to.email }))
    .filter((m) => m.direction === "in")
    .at(-1);
  const subject = item.subject ?? (inbound?.subject ? (/^re:/i.test(inbound.subject) ? inbound.subject : `Re: ${inbound.subject}`) : undefined);
  if (!subject) throw new MktError("email needs a subject");
  const fromAddr = from.match(/<([^>]+)>/)?.[1] ?? from;
  const msg: SendMailOptions = {
    from,
    to: item.to.name ? { name: item.to.name, address: item.to.email } : item.to.email,
    subject,
    text: composeEmailText(ctx, item),
    headers: { "List-Unsubscribe": `<mailto:${fromAddr}?subject=unsubscribe>` },
    attachments: opts.media.map((p) => ({ path: p })),
  };
  if (item.kind === "reply" && inbound?.externalId) {
    msg.inReplyTo = inbound.externalId;
    msg.references = [inbound.externalId];
  }
  if (opts.dryRun) {
    await transport.verify();
    return { note: `dry run: SMTP login ok; would send "${subject}" to ${item.to.email}` };
  }
  const info = await transport.sendMail(msg);
  return { externalId: info.messageId, note: info.response };
}
