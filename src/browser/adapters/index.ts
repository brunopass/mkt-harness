import type { Platform } from "../../core/schemas.js";
import { facebook } from "./facebook.js";
import { gmail } from "./gmail.js";
import { instagram } from "./instagram.js";
import { linkedin } from "./linkedin.js";
import { threads } from "./threads.js";
import { tiktok } from "./tiktok.js";
import type { PlatformAdapter } from "./types.js";
import { whatsapp } from "./whatsapp.js";
import { x } from "./x.js";
import { youtube } from "./youtube.js";

export const ADAPTERS: Record<Platform, PlatformAdapter> = {
  whatsapp, linkedin, instagram, x, tiktok, threads, facebook, youtube, email: gmail,
};

export function adapterFor(platform: Platform): PlatformAdapter {
  return ADAPTERS[platform];
}

export type { AdapterEnv, InboxThread, PlatformAdapter, SendResult } from "./types.js";
export { AdapterError } from "./types.js";
