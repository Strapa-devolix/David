# David

David is the full project. Davis is the service identity used by the running assistant.

This uses [WhiskeySockets/Baileys](https://github.com/WhiskeySockets/Baileys), which connects as a WhatsApp Web linked device. It is not the official WhatsApp Business API, so use it gently: allowlist chats, rate-limit replies, and avoid spammy behavior.

## What It Does

- Connects to your WhatsApp via QR login.
- Watches only allowed group/contact IDs.
- Observes chat IDs without replying until you allowlist them.
- Replies when a message is a question or mentions the bot.
- Uses Groq or OpenAI for AI replies.
- Falls back to local answers from `data/knowledge.md` if no AI key is set.
- Exposes Render-friendly endpoints:
  - `GET /health`
  - `GET /qr?token=ADMIN_TOKEN`
  - `GET /chats?token=ADMIN_TOKEN`

## Local Setup

```bash
npm install
cp .env.example .env
npm start
```

Open:

```text
http://localhost:3000/qr?token=change-me-long-random-value
```

Scan the QR with WhatsApp: Settings -> Linked devices -> Link a device.

## Render Setup

1. Push this repo to GitHub.
2. Create a Render Blueprint from `render.yaml`, or create a paid Node web service manually.
3. Keep the persistent disk mounted at `/var/data`.
4. Set these environment variables:
   - `NODE_VERSION`: `24.14.1`
   - `ADMIN_TOKEN`: long random secret
   - `OWNER_NAME`: your name
   - `AI_PROVIDER`: `groq`
   - `GROQ_API_KEY`: your primary Groq key
   - `GROQ_API_KEYS`: optional comma-separated fallback Groq keys
   - `ALLOWED_CHAT_IDS`: comma-separated WhatsApp chat IDs after you observe them
5. Deploy.
6. Visit `https://YOUR-SERVICE.onrender.com/qr?token=YOUR_ADMIN_TOKEN` and scan the QR.
7. Let messages arrive, then visit `/chats?token=YOUR_ADMIN_TOKEN` to see chat IDs.
8. Add the right group IDs to `ALLOWED_CHAT_IDS` and redeploy.

## Environment Variables

| Name | Default | Notes |
| --- | --- | --- |
| `ADMIN_TOKEN` | empty | Required for `/qr` and `/chats`. |
| `SESSION_DIR` | `./sessions` | Use `/var/data/session` on Render. |
| `DATA_DIR` | `./data` | Use `/var/data/data` on Render. |
| `AUTO_REPLY` | `true` | Set `false` to observe only. |
| `REPLY_TRIGGER` | `question_or_mention` | `all`, `mention_only`, `question_only`, or `question_or_mention`. |
| `ONLY_GROUPS` | `true` | Set `false` to allow direct chats too. |
| `ALLOW_ALL_CHATS` | `false` | Dangerous convenience switch. Keep false for normal use. |
| `ALLOWED_CHAT_IDS` | empty | The bot observes chats but replies only to IDs listed here unless `ALLOW_ALL_CHATS=true`. |
| `BLOCKED_CHAT_IDS` | empty | Comma-separated chat IDs to ignore. |
| `AI_PROVIDER` | auto | `groq`, `openai`, or `local`. Auto-selects Groq when Groq keys exist. |
| `GROQ_API_KEY` | empty | Primary Groq key for AI replies. |
| `GROQ_API_KEYS` | empty | Optional comma-separated fallback Groq keys. |
| `GROQ_MODEL` | `llama-3.1-8b-instant` | Groq model for text replies. |
| `OPENAI_API_KEY` | empty | Optional OpenAI key if `AI_PROVIDER=openai`. |
| `OPENAI_MODEL` | `gpt-5.4-mini` | OpenAI model if using OpenAI. |
| `KNOWLEDGE_PATH` | `data/knowledge.md` | Markdown knowledge base. |

## Safer Operating Mode

Start with:

```text
AUTO_REPLY=false
```

Or keep `AUTO_REPLY=true` and leave `ALLOW_ALL_CHATS=false`; the bot will still observe chats without replying until `ALLOWED_CHAT_IDS` is set. Then watch `/chats`, configure `ALLOWED_CHAT_IDS`, and redeploy.

For groups, a good production setting is:

```text
REPLY_TRIGGER=question_or_mention
ONLY_GROUPS=true
ALLOW_ALL_CHATS=false
MIN_SECONDS_BETWEEN_REPLIES=30
```

## Notes

- Your WhatsApp session is sensitive. Do not share `/var/data/session`.
- If login breaks, delete the persistent session directory and scan a fresh QR.
- Do not install random forks of WhatsApp libraries. Session-stealing packages exist.
