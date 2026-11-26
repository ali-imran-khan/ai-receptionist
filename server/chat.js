import http from "http";
import { GoogleGenerativeAI } from "@google/generative-ai";

// local fallback if Gemini isn't available
async function callOllama(prompt, model = process.env.OLLAMA_MODEL || "llama3.1") {
  const body = JSON.stringify({ model, prompt, stream: false });
  const requestOptions = {
    hostname: (process.env.OLLAMA_HOST || "localhost:11434").replace(/^https?:\/\//, ""),
    path: "/api/generate",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
    },
  };

  return new Promise((resolve, reject) => {
    const req = http.request(requestOptions, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          resolve(json.response || "");
        } catch {
          resolve("");
        }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// last resort: regex parsing, no model needed
function ruleBasedIntent(userText) {
  const text = userText || "";
  const bookingRegex = /\b(book|appointment|schedule|reserve|set up|arrange)\b/i;
  const hasBook = bookingRegex.test(text);

  // Handle greetings naturally
  if (/^(hi|hello|hey|good morning|good afternoon|good evening)\b/i.test(text)) {
    return {
      type: "smalltalk",
      reply: "Hey! How can I help you?",
    };
  }

  // Handle thanks
  if (/\b(thank you|thanks|appreciate)\b/i.test(text)) {
    return {
      type: "smalltalk",
      reply: "You're welcome! Anything else?",
    };
  }

  if (!hasBook) {
    return {
      type: "smalltalk",
      reply: "I can help you book an appointment. What time works for you?",
    };
  }

  const now = new Date();
  let start = null;

  const timeMatch = text.match(/(today|tomorrow)\s*(?:at)?\s*(\d{1,2})(:(\d{2}))?\s*(am|pm)?/i);
  if (timeMatch) {
    const [_, day, hourStr, , minuteStr, ampm] = timeMatch;
    const hour = parseInt(hourStr, 10);
    const minute = parseInt(minuteStr || "0", 10);
    const base = new Date(now);
    if (day.toLowerCase() === "tomorrow") base.setDate(base.getDate() + 1);
    base.setHours(ampm?.toLowerCase() === "pm" && hour < 12 ? hour + 12 : hour, minute, 0, 0);
    start = base;
  }

  if (!start) {
    const inX = text.match(/in\s+(\d+)\s+(minutes?|hours?)/i);
    if (inX) {
      const n = parseInt(inX[1], 10);
      const unit = inX[2].toLowerCase();
      const base = new Date(now);
      if (unit.startsWith("hour")) base.setHours(base.getHours() + n);
      else base.setMinutes(base.getMinutes() + n);
      start = base;
    }
  }

  if (start) {
    const end = new Date(start);
    end.setMinutes(end.getMinutes() + 30);
    return {
      type: "book",
      start_iso: start.toISOString(),
      end_iso: end.toISOString(),
      reply: "Perfect! Can I get your name?",
    };
  }

  return {
    type: "ask_time",
    reply: "Sure! What day and time works? Like tomorrow at 3 PM.",
  };
}

export async function generateIntent(userText, context = {}) {
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) {
    return {
      type: "smalltalk",
      reply: "I'm having technical trouble. Can you try again?",
    };
  }

  try {
    const genAI = new GoogleGenerativeAI(geminiKey);
    const modelName = process.env.GEMINI_MODEL || "gemini-2.0-flash";
    const model = genAI.getGenerativeModel({ model: modelName });

    const kb = Array.isArray(context.knowledge) ? context.knowledge : [];
    const companyContext = kb.map((item) => `${item.title}: ${item.text}`).join("\n");

    const prompt = `You are "Sarah", a friendly AI receptionist for NeoFlow Automations.

CRITICAL RULES:
- Keep responses SHORT (5-15 words max)
- Sound natural and conversational
- Use contractions: "I'll", "you're", "that's"
- Be warm but brief
- ONE sentence only unless absolutely necessary

COMPANY INFO:
${companyContext || "NeoFlow Automations - AI workflow automation"}

NOW: ${new Date().toString()} (resolve "today"/"tomorrow" from this)
CONTEXT: ${JSON.stringify(context)}
USER SAID: "${userText}"

Respond with JSON only:

For booking with time:
{"type":"book","start_iso":"2025-10-07T15:00:00Z","end_iso":"2025-10-07T15:30:00Z","name":"John","reply":"Perfect! I'll book that for you."}

For asking time:
{"type":"ask_time","reply":"What time works for you?"}

For asking name:
{"type":"ask_name","reply":"Great! What's your name?"}

For general chat:
{"type":"smalltalk","reply":"We do AI automation for small businesses."}

EXAMPLES OF GOOD REPLIES:
- "Sure! What time?"
- "Got it. Your name?"
- "Perfect! You're all set."
- "That's taken. Another time?"
- "We automate workflows with AI."

Return ONLY the JSON. Keep replies under 15 words.`;

    const resp = await model.generateContent(prompt);
    const text = resp?.response?.text() || "";

    const match = text.match(/\{[\s\S]*?\}/);
    if (match) {
      try {
        const intent = JSON.parse(match[0]);
        // it still rambles sometimes, cut to first sentence
        if (intent.reply && intent.reply.split(' ').length > 20) {
          intent.reply = intent.reply.split('.')[0] + '.';
        }
        return intent;
      } catch {
        console.error("Invalid JSON from Gemini:", text);
      }
    }
  } catch (error) {
    console.error("Gemini error:", error);
  }

  try {
    const ollamaResp = await callOllama(userText);
    if (ollamaResp) {
      const short = ollamaResp.split('.')[0] + '.';
      return { type: "smalltalk", reply: short };
    }
  } catch {}

  return ruleBasedIntent(userText);
}