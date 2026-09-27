# YouTube playbook

Adapter: `src/browser/adapters/youtube.ts` handles `post` = upload one video/Short through YouTube Studio. It is
BEST EFFORT: Studio changes often. Comments, community posts, playlists, thumbnails and end screens are by hand.

## Before you start

1. `outbox_claim {id}` → keep the `token`.
2. `browser_open {account, url: "https://studio.youtube.com/"}`, `browser_snapshot`.
3. Logged in = Studio dashboard with "Create" / "Criar" / "Crear" and the upload arrow. Logged out = redirect to
   `accounts.google.com`, "Sign in" / "Fazer login" / "Iniciar sesión".
4. A channel picker means the Google account has several channels: pick the brand's channel (name in
   `accounts.yaml` label/handle). Wrong channel = stop.
5. "Verify it's you" / phone verification → human only, `ok:false`.

## Upload a video / Short

1. Upload arrow, or "Create" → "Upload videos" / "Enviar vídeos" / "Subir videos".
2. `browser_upload {ref: <file input "Filedata">, files: [<video>]}`.
3. Details step:
   - Title (required, ≤ 100 chars, no `<` `>`): the outbox `subject`, else the first line of the approved text.
   - Description (≤ 5,000 chars): the approved text.
   - Thumbnail: upload the brief's thumbnail if one exists (needs a verified channel).
   - Playlists: as the brief says.
   - Audience: "No, it's not made for kids" / "Não, não é conteúdo para crianças" / "No, no es contenido para
     niños" (unless it truly is: then stop and ask the human).
   - "Show more": altered/synthetic content disclosure = Yes if realistic AI footage or voice was used; paid
     promotion box if a third party paid.
4. "Next" / "Avançar" / "Siguiente" through Video elements and Checks. If Checks reports a copyright claim,
   stop and `ok:false` with the claim text.
5. Visibility: "Public" / "Público" (or "Schedule" if the item has a `scheduledFor` the human wants YouTube to hold).
6. "Publish" / "Publicar". Verify the "Video published" / "Vídeo publicado" dialog; copy its link (`youtu.be/…` or
   `youtube.com/shorts/…`) as `url`. "Still processing" is fine; the link is valid.

## Shorts

A vertical (9:16) video ≤ 3 minutes uploads as a Short automatically. Put the hook in the first second and the
title; `#shorts` in the title/description is optional.

## Reply to comments (by hand)

Studio → "Comments" / "Comentários" / "Comentarios" → filter "Unanswered" → reply → log with `conversation_log`
(platform `youtube`). Heart genuine comments; never argue.

## Stop conditions (never loop)

- "Daily upload limit reached" / "limite diário de envios" / "límite diario de subidas".
- "Processing abandoned" / "Processamento abandonado" → file problem: `ok:false`, attach the screenshot.
- Community Guidelines strike notice → stop all YouTube work, tell the human.

## Platform norms

- Title: promise + curiosity, key term early; description first 2 lines matter (shown in search).
- Long-form 16:9 1920×1080; Shorts 9:16 1080×1920.
- 3–5 relevant tags in the description as hashtags; the first three show above the title.
- Links in descriptions are fine and clickable (Shorts: links are not clickable; use pinned comment or channel links).

## Calibration checklist

- [ ] `mkt browser open <account>`, log in to the Google account, open Studio, pick the channel once.
- [ ] Dry run a 10-second test clip: details filled, "Not made for kids" selected, reached Visibility with Public
      selected, Publish visible, screenshot, not published.
- [ ] If a real test is possible, upload as Private first (change visibility by hand under the claim).
- [ ] Record failing steps and dates here.
