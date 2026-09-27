/**
 * TikTok (TikTok Studio web uploader).
 *
 * Supported: post (one video, caption; waits for upload + processing before Post is clickable).
 * Not supported on the web in a reliable way: dm, comment, inbox (do those by hand with the browser tools).
 * Best effort: photo-mode posts (images) are not handled here; schedule/visibility options stay at defaults (Everyone).
 * Selectors written 2026-09-27. Calibrate with: mkt send <id> --dry-run
 */
import { attachFiles, clickWhenEnabled, dryRunStop, firstVisible, maybeVisible, typeText, type Candidate, loginState } from "./helpers.js";
import { AdapterError, type PlatformAdapter } from "./types.js";

const UPLOAD = "https://www.tiktok.com/tiktokstudio/upload?from=webapp";

const LOGGED_IN: Candidate[] = [
  "input[type='file'][accept*='video']",
  (p) => p.getByRole("button", { name: /^(select (video|file)s?|selecionar (vídeo|arquivo)s?|seleccionar (video|archivo)s?)$/i }),
  "[data-e2e='select_video_button']",
];
const LOGGED_OUT: Candidate[] = [
  "[data-e2e='top-login-button']",
  (p) => p.getByRole("button", { name: /^(log in|entrar|iniciar sesión)$/i }),
  (p) => p.getByText(/log in to tiktok|entre no tiktok|inicia sesión en tiktok/i),
];

const CAPTION: Candidate[] = [
  "[data-e2e='caption_container'] [contenteditable='true']",
  "div.public-DraftEditor-content[contenteditable='true']",
  ".caption-editor [contenteditable='true']",
  (p) => p.getByRole("combobox").filter({ has: p.locator("[contenteditable='true']") }),
];
const POST: Candidate[] = [
  "[data-e2e='post_video_button']",
  (p) => p.getByRole("button", { name: /^(post|publicar|postar)$/i }),
];

export const tiktok: PlatformAdapter = {
  platform: "tiktok",
  homeUrl: UPLOAD,
  loginUrl: "https://www.tiktok.com/login",

  async isLoggedIn(env) {
    return loginState(env.page, {
      loggedIn: LOGGED_IN,
      loggedOut: LOGGED_OUT,
      outUrl: /\/login/,
      // the upload input is hidden: its presence also means logged in
      alsoIn: async (p) => (await p.locator("input[type='file'][accept*='video']").count()) > 0,
    });
  },

  async post(env, { text, media }) {
    const page = env.page;
    const videos = media.filter((m) => /\.(mp4|mov|webm|m4v)$/i.test(m));
    if (!videos.length) throw new AdapterError("media", "TikTok posts need a video (.mp4/.mov/.webm)");
    if (text.length > 4000) throw new AdapterError("caption", `caption is ${text.length} chars; TikTok allows 4000`);
    if (!page.url().includes("tiktokstudio/upload")) await env.goto(UPLOAD);
    await attachFiles(page, "upload", [videos[0]], {
      input: "input[type='file'][accept*='video']",
      trigger: [(p) => p.getByRole("button", { name: /^(select (video|file)s?|selecionar (vídeo|arquivo)s?|seleccionar (video|archivo)s?)$/i })],
    });
    // the editor appears once the upload starts; TikTok pre-fills the caption with the file name
    await firstVisible(page, "editor", CAPTION, 120_000);
    await typeText(page, "caption", CAPTION, text, { newline: "enter", clear: true });
    // close a hashtag/mention suggestion popup if typing opened one
    await page.keyboard.press("Escape").catch(() => {});
    const uploaded = await maybeVisible(page, [(p) => p.getByText(/^(uploaded|carregado|enviado|subido)\b/i)], 300_000);
    if (!uploaded) throw new AdapterError("upload", "upload did not finish within 5 minutes", await env.shot("upload"));
    await firstVisible(page, "post-button", POST, 30_000);
    if (env.dryRun) return dryRunStop(env, "tiktok-post");
    await clickWhenEnabled(page, "post", POST, 300_000);
    // "Continue to post?" when content checks are still running
    const now = await maybeVisible(page, [(p) => p.getByRole("button", { name: /^(post now|publicar agora|publicar ahora)$/i })], 4_000);
    if (now) await now.click();
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      if (/tiktokstudio\/content/.test(page.url())) break;
      if (await maybeVisible(page, [(p) => p.getByText(/your video (has been|is being) (uploaded|posted)|vídeo (foi )?publicado|video (se ha )?publicado|manage your posts|gerenciar (seus )?posts|administrar (tus )?publicaciones/i)], 0)) break;
      await page.waitForTimeout(1_000);
    }
    if (Date.now() >= deadline) throw new AdapterError("verify", "no publish confirmation within 3 minutes", await env.shot("verify"));
    return { note: "video posted (check TikTok Studio > Posts for the URL once processed)", screenshot: await env.shot("sent") };
  },
};

