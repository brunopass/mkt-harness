# X (Twitter) playbook

Adapter: `src/browser/adapters/x.ts` handles `post`, `comment` (reply under a post URL), and best-effort `dm` /
`reply` (DMs). Use this playbook when it fails, for threads (multi-post), polls, quote posts and community posts.

## Before you start

1. `outbox_claim {id}` → keep the `token`.
2. `browser_open {account, url: "https://x.com/home"}`, `browser_snapshot`.
3. Logged in = side nav with "Post" button, Home, Explore, Notifications, Messages/Chat, profile switcher.
   Logged out = `/i/flow/login`, "Sign in" / "Entrar" / "Iniciar sesión", "Create account".
4. "Access denied", HTTP 403 page, or "Something went wrong. Try reloading." twice → stop, `ok:false`.
5. Arkose/"Authenticate your account" challenges, "Your account is locked" → human only.

## Post

1. Open `https://x.com/compose/post` (modal) or use the home composer "What is happening?!" / "O que está
   acontecendo?" / "¿Qué está pasando?".
2. `browser_type {ref: <textbox "Post text">, text, newline: "enter"}` (Enter = newline in the composer).
3. Media: the composer's hidden file input (`fileInput`, shown as `file-input` in snapshots) → `browser_upload`.
   Up to 4 images, or 1 video/GIF. Wait until thumbnails finish processing.
4. Length: the ring counter turns red and the "Post" button disables past the limit (280 weighted chars without
   Premium; URLs count 23; emoji/CJK count 2). Never cut the approved text yourself: `ok:false` with "over limit",
   the copywriter splits it into a thread.
5. Click "Post" / "Postar" / "Publicar". A toast "Your post was sent. View" / "Seu post foi enviado" / "Se envió tu
   post" appears; its "View" link is the `url`.

### Thread

In the composer, use the "+" ("Add post" / "Adicionar post" / "Añadir post") to add each part in order, then
"Post all" / "Postar tudo" / "Publicar todo". The adapter only posts single posts: a thread (numbered parts
like `1/`, `2/`) is always done by hand under the claim, with the parts exactly as approved.

## Reply to a post (comment)

Open the post URL → inline box "Post your reply" / "Poste sua resposta" / "Publica tu respuesta" → type → "Reply" /
"Responder". Verify the reply appears under the post (or the toast link).

## Direct message (best effort)

1. Profile `https://x.com/<handle>` → envelope button "Message" / "Mensagem" / "Mensaje". Missing = they do not accept
   DMs from you: `ok:false`, never try workarounds.
2. Since 2025 DMs may open in "Chat" (`/i/chat/…`), which can ask for an encryption passcode. A passcode prompt
   means the human must unlock chat once in this profile: `ok:false`.
3. Composer "Start a message" / "Inicie uma mensagem" / "Escribe un mensaje" → type → "Send" / "Enviar" or Enter.
4. Verify the bubble appears.

## Stop conditions (never loop)

- "You are over the daily limit for sending posts" / "limite diário" / "límite diario".
- "This request looks like it might be automated" → stop the account for the day, tell the human.
- Any "Your account is temporarily limited" banner → stop, `ok:false`.

## Platform norms

- Hook in the first line; line breaks help. 1–2 hashtags max, or none.
- Links reduce reach on X: put the link in a reply to your own post when reach matters.
- Images 1600×900 (16:9) or 1080×1350; video ≤ 2 min 20 s for non-Premium.
- Replies from brand accounts: add something (a data point, an answer), never generic praise.
- Defaults: 8 posts/day, 20 DMs/day, 40 replies/day.

## Calibration checklist

- [ ] `mkt browser open <account>`, log in (2FA).
- [ ] Post dry run: modal open, text in the box, Post button enabled, screenshot, not posted.
- [ ] Over-limit dry run (a 300-char test text): fails with the "over limit" reason, nothing truncated.
- [ ] Image post dry run: thumbnail uploaded.
- [ ] Reply dry run on your own post.
- [ ] DM dry run to an account you own; note whether it opened legacy DMs or Chat.
- [ ] Record failing steps and dates here.
