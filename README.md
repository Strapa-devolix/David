# David

David is the project and the service identity used by the running assistant.

This uses [WhiskeySockets/Baileys](https://github.com/WhiskeySockets/Baileys), which connects as a WhatsApp Web linked device. It is not the official WhatsApp Business API, so use it gently: allowlist chats, rate-limit replies, and avoid spammy behavior.

## What It Does

- Connects to your WhatsApp via QR login.
- Watches only allowed group/contact IDs.
- Observes chat IDs without replying until you allowlist them.
- Replies when a message is a question or mentions the bot.
- Uses Groq or OpenAI for AI replies.
- Falls back to local answers from `data/knowledge.md` if no AI key is set.
- Provides a protected dashboard for behavior, allowlists, models, and knowledge.
- Exposes Render-friendly endpoints:
  - `GET /health`
  - `GET /dashboard?token=ADMIN_TOKEN`
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
   - `ADMIN_TOKEN`: long random secret
   - `GROQ_API_KEY`: your primary Groq key
   - `GROQ_API_KEYS`: optional comma-separated fallback Groq keys
   - `OPENAI_API_KEY`: optional, only if you want to use OpenAI instead of Groq
5. Deploy.
6. Visit `https://YOUR-SERVICE.onrender.com/dashboard?token=YOUR_ADMIN_TOKEN`.
7. Open the QR page from the dashboard and scan it.
8. Let messages arrive, refresh chats in the dashboard, allow the right groups, and save.

## Environment Variables

| Name | Default | Notes |
| --- | --- | --- |
| `ADMIN_TOKEN` | empty | Required for `/dashboard`, `/qr`, and `/chats`. |
| `GROQ_API_KEY` | empty | Primary Groq key for AI replies. |
| `GROQ_API_KEYS` | empty | Optional comma-separated fallback Groq keys. |
| `OPENAI_API_KEY` | empty | Optional OpenAI key if the dashboard provider is set to OpenAI. |

Behavior settings are stored on the persistent disk in `/var/data/data/settings.json` and edited from `/dashboard?token=ADMIN_TOKEN`.
Knowledge is stored on the persistent disk in `/var/data/data/knowledge.md` and edited from the dashboard.

## Safer Operating Mode

Open the dashboard, keep `Allow all chats` off, refresh observed chats, then allow only the team groups where David should answer.

## Notes

- Your WhatsApp session is sensitive. Do not share `/var/data/session`.
- If login breaks, delete the persistent session directory and scan a fresh QR.
- Do not install random forks of WhatsApp libraries. Session-stealing packages exist.
