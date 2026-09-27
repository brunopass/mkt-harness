# Threads playbook

Adapter: `src/browser/adapters/threads.ts` handles `post` (text ≤ 500 + optional media) and `comment` (reply to a
post URL). Use this playbook when it fails and for multi-part threads, polls, topic tags and quotes.

## Before you start

1. `outbox_claim {id}` → keep the `token`.
2. `browser_open {account, url: "https://www.threads.com/"}` (threads.net redirects there), `browser_snapshot`.
3. Logged in = feed with the composer prompt "What's new?" / "O que há de novo?" / "¿Qué novedades hay?", nav with
   Home / Search / Create / Activity / Profile. Logged out = `/login`, "Log in" / "Entrar" / "Iniciar sesión",
   "Continue with Instagram" / "Continuar com o Instagram" / "Continuar con Instagram".
4. The account is tied to the brand's Instagram. An Instagram checkpoint blocks Threads too: stop, `ok:false`.

## Post

1. Click the "What's new?" prompt or "Create" / "Criar" / "Crear" (the `+` in the nav).
2. Dialog "New thread" / "Novo thread" / "Nuevo hilo": type in the textbox (Enter = newline).
3. Media: the dialog's file input (paperclip / image icon) → `browser_upload`. Up to 20 images/videos.
4. Optional topic tag ("Add a topic" / "Adicionar tópico" / "Añadir tema"): one, from the brief.
5. Click "Post" / "Publicar". Wait for the dialog to close; a toast "Posted" / "Publicado" with "View" / "Ver"
   gives the `url`.

### Multi-part thread

In the dialog, "Add to thread" / "Adicionar ao thread" / "Añadir al hilo" adds a part under the first. Paste each
approved part in order; post all at once. The adapter only posts single posts: threads are always manual.

## Reply (comment)

Open the post URL → reply icon ("Reply" / "Responder") under the main post → dialog → type → "Post" / "Publicar" →
verify the reply shows under the post.

## Read activity

"Activity" shows replies and mentions. There is no DM inbox on the Threads web app (DMs live in Instagram): log
relevant replies with `conversation_log` using platform `threads`.

## Stop conditions (never loop)

- "Try again later" / "Tente novamente mais tarde" / "Inténtalo más tarde" → stop Threads and Instagram actions
  for this brand today, `ok:false`.
- "We limit how often you can do certain things" → same.

## Platform norms

- 500 chars per post. Conversational, first-person, questions do well; hashtags don't work like on Instagram (use
  one topic tag instead).
- Links are clickable and allowed, but a link-only post underperforms: put the point in the text.
- Images 1080×1350 or 1080×1080; video ≤ 5 min.
- Replying to people who reply to us is the main growth lever: keep the community skill on it.
- Defaults: 6 posts/day, 30 min gap.

## Calibration checklist

- [ ] `mkt browser open <account>`, log in with the brand's Instagram.
- [ ] Post dry run: dialog open, text in the box, Post visible, screenshot, not posted.
- [ ] Post with one image, dry run.
- [ ] Reply dry run on the brand's own post.
- [ ] A 600-char test text fails with the 500-char reason before typing.
- [ ] Record failing steps and dates here.
