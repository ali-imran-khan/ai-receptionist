# ai-receptionist

A browser-based voice receptionist for small businesses. You talk to it, it answers questions about the business and books 30-minute appointments without double-booking. It can also push the booking to Google Calendar.

Built as a demo for the receptionist service I sell through my automation agency. "NeoFlow Automations" in `server/knowledge.json` is a made-up company for the demo.

## How it works

```
mic → Web Speech API (STT, in the browser)
    → POST /api/chat → Gemini (intent as JSON: book / ask_time / ask_name / smalltalk)
                       ↳ falls back to Ollama, then to regex parsing if no model is available
    → booking → SQLite (overlap check) → optional Google Calendar insert
    → reply → speechSynthesis (TTS, in the browser)
```

- `server/chat.js`: prompt + the Gemini → Ollama → regex fallback chain
- `server/db.js`: SQLite, refuses overlapping slots (returns 409)
- `server/google.js`: OAuth + Calendar insert/list
- `server/knowledge.json`: what the bot knows about the business. You can edit it from `/admin`
- `public/`: the call UI (`index.html`) and admin page (`admin.html`)

Speech runs fully in the browser, so there's no telephony cost. The catch is that callers use the web page, not a phone number. For real phone calls, the next step is Twilio (`<Gather>` or Media Streams) hitting the same `/api/chat` and `/api/appointments` endpoints.

## Run

Needs Node 18+ and Chrome or Edge (Firefox doesn't support the Web Speech recognition API).

```bash
npm install
cp .env.example .env    # add GEMINI_API_KEY
npm start               # http://localhost:3000
```

Without a Gemini key it still works on the regex fallback ("book tomorrow at 3 pm", "in 30 minutes"), it just can't hold a conversation.

For Google Calendar, create an OAuth client in Google Cloud, fill in the `GOOGLE_*` values, then open `/api/google/authurl` once and approve.

## API

| method | path | |
|---|---|---|
| POST | `/api/chat` | `{text, context}` → `{intent}` |
| GET | `/api/appointments` | list, or `?start=&end=` for a range |
| POST | `/api/appointments` | `{customer_name, start_iso, end_iso, customer_phone?, notes?}`, 409 on overlap |
| POST | `/api/appointments/google` | same, plus Calendar sync |
| DELETE | `/api/appointments/:id` | |
| GET/POST | `/api/knowledge` | read / replace the knowledge base |

## Not production-ready

- `/admin`, `DELETE /appointments` and `POST /knowledge` have no auth. Anyone who can reach the server can wipe bookings or rewrite what the bot says.
- No business hours. It will happily book 3 am on a Sunday.
- Times are handled in the server's timezone and stored as UTC ISO strings. A business in another timezone needs that set properly.
- User text goes straight into the prompt, so prompt injection is possible. It can only affect the bot's reply and the JSON it returns, but that JSON is trusted when booking.
