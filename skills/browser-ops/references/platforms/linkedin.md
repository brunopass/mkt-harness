# LinkedIn playbook

Adapter: `src/browser/adapters/linkedin.ts` handles `post`, `dm`, `reply`, `connect`, `comment`, `readInbox`.
Use this playbook when the adapter fails, or for company-page posts, InMail, documents (PDF carousels) and polls.

## Before you start

1. `outbox_claim {id}` → keep the `token`. One claim = one action.
2. `browser_open {account, url: "https://www.linkedin.com/feed/"}` then `browser_snapshot`.
3. Logged in = top nav with Home / My Network / Messaging, and "Start a post" / "Começar publicação" /
   "Comenzar una publicación". Logged out = `/login`, `/authwall` or "Sign in" / "Entrar" / "Iniciar sesión".
4. `/checkpoint/` URL (security check, "Let's do a quick security check") → stop, `ok:false`, human must solve it.

## Post (member profile)

1. Click "Start a post" (or open `https://www.linkedin.com/feed/?shareActive=true`).
2. Dialog "Create a post" / "Criar publicação" / "Crear publicación". Editor textbox "Text editor for creating
   content" / "What do you want to talk about?" / "Sobre o que você quer falar?" / "¿Sobre qué quieres hablar?".
3. `browser_type {ref: <editor>, text, newline: "enter"}` (Enter makes a new paragraph here, it does not post).
4. Media: "Add media" / "Adicionar mídia" / "Añadir contenido multimedia" → `browser_upload` → media editor →
   "Next" / "Avançar" / "Siguiente" (or "Done" / "Concluído" / "Listo").
5. Check the preview: text intact, hashtags at the end, no stray "see more" cut in the first 2 lines' hook.
6. Click "Post" / "Publicar". Wait for the dialog to close and the toast "Post successful. View post" / "Ver
   publicação" / "Ver publicación". Copy that link as `url`.

### Company page

Go to the page admin view (`https://www.linkedin.com/company/<id>/admin/`), "Create" / "Start a post", check the
author switcher shows the page, then as above.

## Direct message (1st-degree connections)

1. Open the profile URL (`to.url` or `https://www.linkedin.com/in/<handle>/`).
2. Click "Message" / "Mensagem" / "Enviar mensagem" / "Mensaje". No Message button → not connected: stop,
   `ok:false error:"not connected: needs connect with a note"`. Never buy/use InMail credits without the human.
3. Overlay composer "Write a message…" / "Escreva uma mensagem…" / "Escribe un mensaje…". Type with Shift+Enter for
   newlines. Click "Send" / "Enviar".
4. Verify the message appears at the bottom of the thread; `url` = the thread URL.

## Connection request

1. Profile → "Connect" / "Conectar". If absent, open "More" / "Mais" / "Más" and pick "Connect" there. "Follow" as
   the only option = creator mode; "Pending" / "Pendente" / "Pendiente" = already invited (stop, `ok:false`).
2. "Add a note" / "Adicionar nota" / "Añadir una nota". Free accounts: 200 chars and a small monthly quota of
   personalised invites (Premium: 300). An upsell instead of the note box = quota used: `ok:false`, say so.
3. Paste the approved note exactly. "Send" / "Enviar". Verify the button turns into "Pending".

## Comment

Open the post URL → "Comment" / "Comentar" → editor "Add a comment…" / "Adicionar um comentário…" /
"Añadir un comentario…" → type → "Comment" / "Post" / "Publicar" → verify it shows under the post.

## Read the inbox

`https://www.linkedin.com/messaging/` → bold threads with a blue dot are unread → open, `browser_text`, log with
`conversation_log` (profile link in the thread header gives the handle). Opening marks them read.

## Stop conditions (never loop)

- "You've reached the weekly invitation limit" / "limite semanal de convites" / "límite semanal de invitaciones".
- "We've restricted your account" / "Your account has been temporarily restricted" → stop all LinkedIn work.
- "Something went wrong. Try again later" twice → stop, `ok:false`.
- A CAPTCHA or email PIN → human only.

## Platform norms

- Post: 3,000 chars. Only the first ~210 chars show before "…see more": the hook lives there.
- Links in the post body cut reach; put the link in the first comment when the brand prefers reach.
- 3–5 hashtags at the end. Images 1200×1200 or 1080×1350; PDF documents make good carousels.
- Connection notes: specific, no pitch. DMs: no attachments or links in the first message.
- Limits (defaults): 15 invites/day, 25 DMs/day, generous gaps. LinkedIn's hard cap is ~100 invites/week.

## Calibration checklist

- [ ] `mkt browser open <account>`, log in, tick "Remember me", solve any checkpoint.
- [ ] Post dry run (`mkt send <id> --dry-run`): dialog open, text in the editor, screenshot, not posted.
- [ ] Post with one image, dry run: media editor passed, back in the composer.
- [ ] Connect dry run on a colleague's profile: note filled, Send visible, not clicked.
- [ ] DM dry run to a 1st-degree connection.
- [ ] `mkt inbox sync <account>`: threads appear in `conversation_list` with the right direction.
- [ ] Record failed step names + dates here.
