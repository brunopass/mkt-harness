# Facebook playbook

Adapter: `src/browser/adapters/facebook.ts` handles `post` (profile, or a Page when the account handle is the Page
URL) and `comment`. Messenger DMs, Groups and Reels are by hand with this playbook. For Pages at scale, Meta
Business Suite (`https://business.facebook.com/latest/composer`) is steadier than the profile UI.

## Before you start

1. `outbox_claim {id}` → keep the `token`.
2. `browser_open {account, url: "https://www.facebook.com/"}`, `browser_snapshot`.
3. Logged in = "What's on your mind, <name>?" / "No que você está pensando?" / "¿Qué estás pensando?", "Your profile"
   / "Seu perfil" / "Tu perfil". Logged out = email + password fields, "Log In" / "Entrar" / "Iniciar sesión".
4. `/checkpoint/` or "Confirm your identity" / "Confirme sua identidade" → stop, `ok:false`, human only.
5. The EU cookie dialog is not a login state; the human chooses once in `mkt browser open`.

## Post to a Page

1. Confirm you are acting as the Page: the top-right avatar menu shows the Page, or switch ("Switch to <Page>" /
   "Mudar para" / "Cambiar a"). Posting as the person instead of the Page is a wrong-account post: stop if unsure.
2. Open the Page URL (the account `handle`), click "What's on your mind?" / "Create post" / "Criar publicação" /
   "Crear publicación".
3. Dialog: type in the textbox (Enter = newline).
4. Media: "Photo/video" / "Foto/vídeo" / "Foto/video" → `browser_upload`.
5. Some flows show "Next" / "Avançar" / "Siguiente" (audience, boost offers): keep the default audience, never
   click "Boost" / "Turbinar" / "Promocionar".
6. "Post" / "Publicar". Verify the dialog closes and the post appears at the top of the Page feed; copy its
   timestamp link (`/posts/…` or `/permalink/…`) as `url`.

## Post to the member profile

Same flow from `https://www.facebook.com/`. Check the audience selector shows what the brief expects ("Public" /
"Público").

## Comment

Post URL → "Write a comment…" / "Escreva um comentário…" / "Escribe un comentario…" (or "Comment as <Page>" /
"Comentar como") → type (Shift+Enter for a new line, Enter submits) → verify it appears. When commenting as a Page,
check the "Comment as" avatar first.

## Messenger (by hand)

`https://www.facebook.com/messages/` (or Page inbox in Business Suite) → open the conversation → "Aa" / "Message"
composer → type → Enter → verify. Pages may reply freely within 24 h of the person's last message; after that only
with message tags Meta allows. Log inbound messages with `conversation_log`.

## Stop conditions (never loop)

- "You're temporarily blocked" / "Você está temporariamente bloqueado" / "Estás bloqueado temporalmente".
- "This content isn't available" for our own Page → permissions changed, human.
- "Your post couldn't be shared" twice → `ok:false` with screenshot.

## Platform norms

- Posts: up to 63k chars but 1–3 short paragraphs work; first 2 lines are visible before "See more".
- Links are fine on Facebook (link preview); one link, placed at the end.
- Images 1080×1350 or 1200×630 for link-style; video 4:5 or 9:16.
- Groups: follow each group's rules; no promotional posts where they are banned.
- Defaults: 3 posts/day, 20 DMs/day.

## Calibration checklist

- [ ] `mkt browser open <account>`, log in (2FA), pick cookies, switch to the Page once if posting as a Page.
- [ ] Post dry run: dialog open, text present, Post visible, screenshot, not posted.
- [ ] Image post dry run.
- [ ] Comment dry run on the brand's own post (check the "Comment as" avatar).
- [ ] Record failing steps and dates here.
