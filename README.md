# Next Toppers Chat

Standalone replacement chat website. `src/Chat.tsx` is a new implementation; it does not use the previous website Chat.tsx.

It connects to the existing Firebase contract used by the main repo:
- `users/{uid}`
- `communityMessages`
- `privateChatMeta`
- `privateChats/{chatId}/messages`

Private chat IDs use `[uidA, uidB].sort().join("_")`.

The site signs in with Firebase Google Authentication and verifies any entered UID against the currently authenticated Firebase account. A plain UID is not treated as authentication.

Setup: copy `.env.example` to `.env`, fill the same Firebase Web App configuration, enable Google sign-in, then `npm install && npm run build`.
