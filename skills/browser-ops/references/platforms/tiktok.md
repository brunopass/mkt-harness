# TikTok playbook

Adapter: `src/browser/adapters/tiktok.ts` handles `post` (one video + caption through TikTok Studio). DMs, comments
and inbox are not automated: do them by hand under a claim with this playbook, sparingly.

## Before you start

1. `outbox_claim {id}` → keep the `token`.
2. `browser_open {account, url: "https://www.tiktok.com/tiktokstudio/upload?from=webapp"}`, `browser_snapshot`.
3. Logged in = TikTok Studio upload page: "Select video" / "Selecionar vídeo" / "Seleccionar video" and a drop zone.
   Logged out = redirect to `/login`, "Log in to TikTok" / "Entre no TikTok" / "Inicia sesión en TikTok".
4. Slider/rotate/"verify you are human" puzzle → stop, `ok:false`. We never solve captchas; the human does.

## Post a video

1. `browser_upload {ref: <file-input accepting video>, files: [<mp4>]}` (or click "Select video" to get the chooser).
2. Wait for the editor. The progress shows "Uploading…" then "Uploaded" / "Carregado" / "Subido" with the size.
3. Caption editor (Draft.js box, pre-filled with the file name): select all, delete, type the approved caption.
   Typing `#` or `@` opens a suggestion list: press Escape (or a space) so it closes without picking the wrong tag.
4. Settings to check against the brief, leave the rest default:
   - Cover: pick the frame the brief names ("Edit cover" / "Editar capa" / "Editar portada").
   - "Who can watch this video" / "Quem pode assistir" / "Quién puede ver este video": Everyone.
   - Allow comments / Duet / Stitch: on unless the brief says otherwise.
   - "Disclose post content" (branded content): turn on if the video promotes a third party or is paid. Our own
     brand's product on our own account = "Your brand".
   - "AI-generated content" label: turn on if the video uses realistic AI imagery or voice.
5. Content checks ("Copyright check" / "Content check lite") may run; wait for them when they show a result.
6. Click "Post" / "Publicar" (enabled only after upload + processing). If "Continue to post?" / "Post now" /
   "Publicar agora" / "Publicar ahora" appears, confirm.
7. Verify: redirect to TikTok Studio "Posts" / "Gerenciar posts" / "Administrar publicaciones", or "Your video has been
   uploaded". Open the newest post, copy its `https://www.tiktok.com/@<handle>/video/<id>` link as `url`.

## Comment (by hand)

Open the video URL → comment box "Add comment…" / "Adicionar comentário…" / "Añadir comentario…" → type → "Post" /
"Publicar" → verify it appears. Only on videos where the brand has something useful to add.

## Direct message (by hand, rare)

TikTok DMs require mutual follows or open DM settings and are heavily rate-limited for new accounts. Profile →
"Message" / "Mensagem" / "Mensaje" → type → Enter → verify. No link in the first message.

## Stop conditions (never loop)

- "You're posting too fast" / "Você está postando rápido demais" / "Estás publicando demasiado rápido".
- "Your account was temporarily banned from…" / "Couldn't upload. Try again later" twice.
- Upload stuck for more than 5 minutes → `ok:false` with a screenshot.

## Platform norms

- Video 9:16, 1080×1920, ≥ 720p; hook in the first 1–2 s; on-screen text inside safe zones (avoid the right-side
  buttons and bottom 20% where the caption sits).
- Caption ≤ 4,000 chars but short works best: 1 line hook + 3–5 hashtags (1–2 niche, 1 broad).
- Links are not clickable in captions; use the bio link (business accounts) or a keyword CTA.
- Trending sounds: only use ones licensed for business accounts (Commercial Music Library).
- Defaults: 3 posts/day, 1 h gap.

## Calibration checklist

- [ ] `mkt browser open <account>`, log in (QR from the phone app is the easiest), open TikTok Studio once.
- [ ] Dry run a short test video (`mkt send <id> --dry-run`): upload finishes, caption replaced (not appended to
      the file name), Post button visible, screenshot, not posted.
- [ ] One real post to a test/private account if available; confirm the redirect and the URL step.
- [ ] Record failing steps and dates here.
