/**
 * YouTube (YouTube Studio uploader). BEST EFFORT across the board: Studio is a heavy Polymer app and changes often.
 *
 * Supported: post = upload one video (vertical <= 3 min becomes a Short automatically). Title = input.title or the
 * first line of the text (max 100 chars), description = the text, audience "Not made for kids", visibility Public.
 * Not supported: comments, community posts, inbox.
 * Selectors written 2026-09-27. Calibrate with: mkt send <id> --dry-run
 */
import { attachFiles, clickFirst, clickWhenEnabled, dryRunStop, firstVisible, maybeVisible, typeText, type Candidate, loginState } from "./helpers.js";
import { AdapterError, type PlatformAdapter } from "./types.js";

const STUDIO = "https://studio.youtube.com/";

const LOGGED_IN: Candidate[] = ["#create-icon", "ytcp-button#create-icon", "#upload-icon", (p) => p.getByRole("button", { name: /^(create|criar|crear)$/i })];
const LOGGED_OUT: Candidate[] = ["input[type='email']", (p) => p.getByText(/^(sign in|fazer login|iniciar sesión)$/i)];

const NEXT: Candidate[] = ["ytcp-uploads-dialog #next-button", (p) => p.getByRole("button", { name: /^(next|avançar|próximo|siguiente)$/i })];

export const youtube: PlatformAdapter = {
  platform: "youtube",
  homeUrl: STUDIO,
  loginUrl: "https://accounts.google.com/ServiceLogin?service=youtube",

  async isLoggedIn(env) {
    return loginState(env.page, { loggedIn: LOGGED_IN, loggedOut: LOGGED_OUT, outUrl: /accounts\.google\.com/, timeoutMs: 20_000 });
  },

  async post(env, { text, media, title }) {
    const page = env.page;
    const video = media.find((m) => /\.(mp4|mov|webm|m4v|avi|mkv)$/i.test(m));
    if (!video) throw new AdapterError("media", "YouTube uploads need a video file");
    const t = (title ?? text.split("\n").find((l) => l.trim()) ?? "").trim();
    if (!t) throw new AdapterError("title", "a video title is required (outbox subject or the first line of the text)");
    if (t.length > 100) throw new AdapterError("title", `title is ${t.length} chars; YouTube allows 100`);
    if (/[<>]/.test(t + text)) throw new AdapterError("text", "YouTube rejects < and > in titles and descriptions");
    if (text.length > 5000) throw new AdapterError("description", `description is ${text.length} chars; YouTube allows 5000`);

    const upload = await maybeVisible(page, ["#upload-icon"], 3_000);
    if (upload) await upload.click();
    else {
      await clickFirst(page, "create", ["#create-icon", (p) => p.getByRole("button", { name: /^(create|criar|crear)$/i })]);
      await clickFirst(page, "upload-menu", [
        "#text-item-0",
        (p) => p.getByRole("menuitem", { name: /upload videos?|enviar vídeos?|carregar vídeos?|subir vídeos?|subir videos?/i }),
      ]);
    }
    await attachFiles(page, "upload", [video], { input: "ytcp-uploads-dialog input[type='file'], input[type='file'][name='Filedata']" });

    const TITLE: Candidate[] = ["ytcp-uploads-dialog #title-textarea #textbox", (p) => p.getByRole("textbox", { name: /add a title|adicione um título|agrega un título|añade un título/i })];
    await firstVisible(page, "details", TITLE, 120_000);
    await typeText(page, "title", TITLE, t, { clear: true });
    await typeText(
      page,
      "description",
      ["ytcp-uploads-dialog #description-textarea #textbox", (p) => p.getByRole("textbox", { name: /tell viewers about your video|conte aos espectadores|cuéntales a los usuarios/i })],
      text,
      { newline: "enter" },
    );
    await clickFirst(page, "not-for-kids", [
      "tp-yt-paper-radio-button[name='VIDEO_MADE_FOR_KIDS_NOT_MFK']",
      (p) => p.getByRole("radio", { name: /not made for kids|não é conteúdo para crianças|no es contenido para niños|no, no está creado para niños/i }),
    ]);
    for (const step of ["next-elements", "next-checks", "next-visibility"]) {
      await clickWhenEnabled(page, step, NEXT, 60_000);
      await page.waitForTimeout(800);
    }
    await clickFirst(page, "public", ["tp-yt-paper-radio-button[name='PUBLIC']", (p) => p.getByRole("radio", { name: /^(public|público)$/i })]);
    const DONE: Candidate[] = ["ytcp-uploads-dialog #done-button", (p) => p.getByRole("button", { name: /^(publish|publicar|save|salvar|guardar)$/i })];
    await firstVisible(page, "publish-button", DONE, 30_000);
    if (env.dryRun) return dryRunStop(env, "youtube-upload");
    await clickWhenEnabled(page, "publish", DONE, 600_000);
    const published = await maybeVisible(
      page,
      ["ytcp-video-share-dialog, ytcp-uploads-still-processing-dialog", (p) => p.getByText(/video published|vídeo publicado|video publicado|still processing|ainda em processamento|aún se está procesando/i)],
      180_000,
    );
    if (!published) throw new AdapterError("verify", "no 'published' confirmation", await env.shot("verify"));
    const link = await page.locator("ytcp-video-share-dialog a[href*='youtu'], a.ytcp-video-info[href*='youtu']").first().getAttribute("href").catch(() => null);
    return { url: link ?? undefined, note: "video published (processing may continue on YouTube's side)", screenshot: await env.shot("sent") };
  },
};
