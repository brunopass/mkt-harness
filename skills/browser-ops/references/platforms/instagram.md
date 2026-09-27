# Instagram playbook

Adapter: `src/browser/adapters/instagram.ts` handles `post` (feed image/video/carousel), `dm`, `reply`, `comment`,
and a best-effort `readInbox`. Use this playbook when it fails and for stories, collab posts, product tags, reel
covers and audio (web supports few of these: some need the phone app, say so instead of improvising).

## Before you start

1. `outbox_claim {id}` → keep the `token`.
2. `browser_open {account, url: "https://www.instagram.com/"}`, `browser_snapshot`.
3. Logged in = left nav: Home / Search / Explore / Reels / Messages / Notifications / Create ("Criar" / "Crear").
   Logged out = "Log into Instagram", email/password fields, "Log in" / "Entrar" / "Iniciar sesión".
4. A cookie dialog ("Allow the use of cookies…") can cover the page in the EU: that is not a login state. The human
   picks the choice once in `mkt browser open`; do not accept optional cookies on their behalf.
5. `/challenge/` URL, "Suspicious login attempt", "Confirm it's you" → stop, `ok:false`, human only.
6. Dismiss "Turn on notifications" / "Save your login info" with "Not now" / "Agora não" / "Ahora no".

## Feed post (media required)

1. Click "Create" / "New post" / "Criar" / "Nova publicação" / "Crear". If a small menu opens, pick "Post" /
   "Publicação" / "Publicación".
2. Dialog "Create new post": `browser_upload` on its file input (or "Select from computer" / "Selecionar do
   computador" / "Seleccionar del ordenador"). Several files = carousel (max 20).
3. Video → "Video posts are now shared as reels" → "OK".
4. Crop step: choose ratio if the brief says so (4:5 portrait is the default we design for) → "Next" /
   "Avançar" / "Siguiente".
5. Edit/filters step → "Next".
6. Caption textbox "Write a caption…" / "Escreva uma legenda…" / "Escribe un pie de foto…". Paste the approved
   caption (Enter = newline here). Optional: location, alt text under "Accessibility" (use `media` alt if given).
7. "Share" / "Compartilhar" / "Compartir". Wait for "Your post has been shared" / "Sua publicação foi
   compartilhada" / "Se ha compartido tu publicación" (videos can take minutes).
8. URL: open the profile, newest grid item, copy its `/p/<code>/` or `/reel/<code>/` link for `outbox_complete`.

## Direct message

1. `https://www.instagram.com/<handle>/` → "Message" / "Enviar mensagem" / "Mensaje". Not there (private account,
   restricted DMs) → `https://www.instagram.com/direct/new/`, search the handle in "To:" / "Para:", pick the exact
   handle (check the avatar/name), "Chat" / "Bate-papo".
2. Composer "Message…" / "Mensagem…" / "Mensaje…". Shift+Enter for newlines, Enter sends.
3. Verify the bubble appears on the right side of the thread. First messages to non-followers land in their
   "Requests" folder: that is expected, not a failure.

## Comment

Post URL → "Add a comment…" / "Adicione um comentário…" / "Añade un comentario…" → type (single paragraph) →
"Post" / "Publicar" → verify it shows under the post.

## Read the inbox

`https://www.instagram.com/direct/inbox/` → unread threads are bold with a blue dot → open → `browser_text` →
`conversation_log` each message (handle = the profile link in the thread header). Check the "Requests" tab too:
new leads often write there first.

## Stop conditions (never loop)

- "Try again later" / "Tente novamente mais tarde" / "Inténtalo de nuevo más tarde" / "We restrict certain
  activity to protect our community" → stop ALL actions on this account for the day, `ok:false`, tell the human.
- "Action blocked" → same, and do not retry tomorrow without the human's go-ahead.
- Upload spinner > 5 min → `ok:false`, attach a screenshot.

## Platform norms

- Caption ≤ 2,200 chars; first line is the hook (≈125 chars visible). ≤ 30 hashtags (3–8 relevant ones work better).
- Links are not clickable in captions: "link in bio" or a DM keyword CTA ("comment GUIDE and we'll DM it").
- Feed: 1080×1350 (4:5) best; carousel slides share the first slide's ratio. Reels 1080×1920, ≤ 90 s for reach.
- Cold DMs from a brand account are sensitive: keep to people who engaged (commented, followed, asked).
- Defaults: 20 DMs/day, 30 comments/day, gaps of minutes, not seconds.

## Calibration checklist

- [ ] `mkt browser open <account>`, log in (2FA), choose cookies, "Save info".
- [ ] Carousel dry run with 2 rendered slides (`mkt render <content-id>` → outbox post): reaches the caption step,
      Share visible, not clicked.
- [ ] Single video dry run: reel notice handled.
- [ ] DM dry run to a test account you own.
- [ ] Comment dry run on your own post.
- [ ] `mkt inbox sync <account>`: check directions (in/out) look right; readInbox is best effort.
- [ ] Note failing steps here with the date.
