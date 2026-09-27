# WhatsApp Web playbook

Adapter: `src/browser/adapters/whatsapp.ts` handles `dm`, `reply` and `readInbox` automatically. Use this playbook
when the adapter fails (UI changed) or for things it does not do (voice notes, documents, groups).

## Before you start

1. `outbox_claim {id}` → keep the `token`. No claim, no send. One claim = one message to one person.
2. `browser_open {account}` (opens `https://web.whatsapp.com/`). Wait ~10 s: WhatsApp Web boots slowly.
3. `browser_snapshot`. Logged in = chat list (grid "Chat list" / "Lista de conversas" / "Lista de chats") and a
   search box. Logged out = QR code / "Log into WhatsApp Web" / "Entrar no WhatsApp Web" / "Inicia sesión".
   Logged out → stop: `outbox_complete {id, token, ok: false, error: "not logged in"}` and tell the human to run
   `mkt browser open <account>` and scan the QR code with the phone.

## Send a message (dm / reply)

1. `browser_navigate {account, url: "https://web.whatsapp.com/send?phone=<digits only, with country code>"}`.
   Example: `+55 11 99999-0000` → `5511999990000`. Never guess a country code.
2. If a dialog says "Phone number shared via url is invalid" / "O número de telefone compartilhado por url é
   inválido" / "El número de teléfono compartido a través de la dirección URL no es válido": the number is not on
   WhatsApp. Close it, `outbox_complete ok:false error:"not on WhatsApp"`. Do not try other formats.
3. Wait for the composer at the bottom: textbox "Type a message" / "Digite uma mensagem" / "Escribe un mensaje".
4. `browser_type {ref: <composer>, text}`. Newlines are sent as Shift+Enter (Enter alone would send early).
5. Re-read the composer value in the snapshot: it must be the approved text, exactly.
6. Send: button "Send" / "Enviar" (icon `send`), or `browser_press {key: "Enter"}` with focus in the composer.

### With media (image / video / PDF)

1. Click "Attach" / "Anexar" / "Adjuntar" (the `+` icon left of the composer).
2. Pick "Photos & videos" / "Fotos e vídeos" / "Fotos y videos" (or "Document" / "Documento").
3. `browser_upload {ref: <file-input or the menu item>, files: [...]}`.
4. A preview opens with "Add a caption" / "Adicione uma legenda" / "Añade un comentario": type the text there.
5. Click the send button in the preview.

## Verify

- `browser_snapshot {text: true}` and check the last outgoing bubble contains the first line of the text.
- A clock icon means "pending": wait 5 s and check again. A red "!" means it failed.
- `outbox_complete {id, token, ok: true, url: "https://web.whatsapp.com/send?phone=<digits>"}`.

## Read the inbox (for `conversation_log`)

1. Chat list rows with a green unread counter ("1 unread message" / "1 mensagem não lida" / "1 mensaje no leído").
2. Open each one, `browser_text`, log inbound and outbound messages with `conversation_log` (phone from the chat
   header or contact info). Opening a chat marks it read on the phone too.
3. Never answer from here without a drafted, approved outbox item.

## Stop conditions (do not retry in a loop)

- "Phone not connected" / "Telefone não conectado" / "Teléfono no conectado" banner → human must open WhatsApp
  on the phone. `ok:false`.
- "WhatsApp is open in another window" → click "Use here" / "Usar aqui" / "Usar aquí" once; if it comes back, stop.
- Any "your account has been restricted/banned" / "sua conta foi restringida" screen → stop everything on this
  account, `ok:false`, tell the human immediately.
- Messages failing with "!" repeatedly → stop; too many new chats too fast is how numbers get banned.

## Platform norms

- First contact only with opt-in (`consent.whatsapp: opt_in`); the policy enforces this. Replies are fine.
- Short messages. One idea, one question. No link-only first messages (spam signal).
- Personal accounts: keep new conversations per day low (default limit 30/day, 2 min gap). WhatsApp bans numbers
  that many people block or report.
- Formatting: `*bold*`, `_italic_`, `~strike~`, ```` ```mono``` ````. Links show a preview.
- Media: images ≤ 16 MB, video ≤ 16 MB (≈ 90 s), documents ≤ 2 GB.
- The Business app supports labels and quick replies, but the web UI is the same for our purposes.

## Calibration checklist

- [ ] `mkt browser open <account>`, scan QR, tick "Keep me signed in".
- [ ] Draft a dm to your own second number (with opt-in on the lead), approve it, `mkt send <id> --dry-run`:
      the chat opens with the text in the composer, screenshot saved, nothing sent.
- [ ] Real send to your own number; check the bubble appears with double ticks.
- [ ] Media dry run with one image.
- [ ] `mkt inbox sync <account>` after replying from the other phone: the reply shows up in `conversation_list`.
- [ ] Note any selector that failed (step name in the error) in this file with the date.
