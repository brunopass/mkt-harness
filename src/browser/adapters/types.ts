import type { Page } from "playwright-core";
import type { Ctx } from "../../core/config.js";
import type { Account, Platform, Recipient } from "../../core/schemas.js";

export interface AdapterEnv {
  ctx: Ctx;
  account: Account & { brand: string };
  /** a private tab in this account's Chrome; the dispatcher closes it afterwards */
  page: Page;
  /** fill everything, screenshot, and stop before the final Send/Post/Share click */
  dryRun: boolean;
  /** save a screenshot of the page, return its path */
  shot(label: string): Promise<string>;
  log(msg: string): void;
  /** navigate and wait for the SPA to settle */
  goto(url: string): Promise<void>;
}

export interface SendResult {
  url?: string;
  externalId?: string;
  note?: string;
  screenshot?: string;
}

export interface InboxMessage {
  direction: "in" | "out";
  text: string;
  at?: string;
  externalId?: string;
}

export interface InboxThread {
  contact: { name?: string; handle?: string; phone?: string; email?: string };
  url?: string;
  unread: boolean;
  messages: InboxMessage[];
}

export interface PlatformAdapter {
  platform: Platform;
  homeUrl: string;
  loginUrl: string;
  /** Called on homeUrl. Must not throw on a logged-out page: return false. */
  isLoggedIn(env: AdapterEnv): Promise<boolean>;
  post?(env: AdapterEnv, input: { text: string; media: string[]; title?: string }): Promise<SendResult>;
  /** first message to someone (to.handle / to.url / to.phone) */
  dm?(env: AdapterEnv, input: { to: Recipient; text: string; media: string[] }): Promise<SendResult>;
  /** answer in an existing thread; adapters without a special path fall back to dm */
  reply?(env: AdapterEnv, input: { to: Recipient; text: string; media: string[] }): Promise<SendResult>;
  comment?(env: AdapterEnv, input: { url: string; text: string }): Promise<SendResult>;
  connect?(env: AdapterEnv, input: { to: Recipient; note?: string }): Promise<SendResult>;
  /** web-mail adapters (Gmail) */
  email?(env: AdapterEnv, input: { to: Recipient; subject: string; text: string }): Promise<SendResult>;
  readInbox?(env: AdapterEnv, input: { limit: number; unreadOnly: boolean }): Promise<InboxThread[]>;
}

/** Thrown by adapters: `step` names what failed so the agent fallback knows where to pick up. */
export class AdapterError extends Error {
  constructor(
    public step: string,
    message: string,
    public screenshot?: string,
  ) {
    super(`${step}: ${message}`);
  }
}
