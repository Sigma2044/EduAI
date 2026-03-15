import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import crypto from "crypto";

const app = express();
app.use(express.json());
app.use(cors());

// ---------------------------
// SIMPLE CACHE (RAM)
// ---------------------------
const cache = {};
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 Stunden

function getCacheKey(text) {
  return crypto.createHash("sha256")
    .update(text.toLowerCase().trim())
    .digest("hex");
}

function getFromCache(key) {
  const entry = cache[key];
  if (!entry) return null;

  if (Date.now() - entry.timestamp > CACHE_TTL) {
    delete cache[key];
    return null;
  }

  return entry.data;
}

function saveToCache(key, data) {
  cache[key] = {
    data,
    timestamp: Date.now()
  };
}

// ---------------------------
// MISTRAL REQUEST
// ---------------------------
async function askMistral(userMessage) {
  const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.MISTRAL_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "mistral-small",
      messages: [
        { role: "user", content: userMessage }
      ]
    })
  });

  if (!response.ok) throw new Error("Mistral failed");
  const data = await response.json();
  return data.choices?.[0]?.message?.content;
}

// ---------------------------
// OPENROUTER BACKUP
// ---------------------------
async function askOpenRouter(userMessage) {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "mistralai/mistral-small-3.1-24b-instruct:free",
      messages: [
        { role: "user", content: userMessage }
      ]
    })
  });

  if (!response.ok) throw new Error("OpenRouter failed");
  const data = await response.json();
  return data.choices?.[0]?.message?.content;
}

// ---------------------------
// CHAT ENDPOINT
// ---------------------------
app.post("/chat", async (req, res) => {
  const userMessage = req.body.message;
  const key = getCacheKey(userMessage);

  // 1. Cache check
  const cached = getFromCache(key);
  if (cached) {
    return res.json({ reply: cached, cached: true });
  }

  let reply;

  try {
    // 2. Versuch: Mistral
    reply = await askMistral(userMessage);
  } catch (err) {
    console.log("Mistral failed → Backup OpenRouter");
    try {
      // 3. Backup: OpenRouter
      reply = await askOpenRouter(userMessage);
    } catch (err2) {
      return res.status(500).json({ reply: "Alle Anbieter sind gerade ausgelastet." });
    }
  }

  // 4. Save to cache
  saveToCache(key, reply);

  res.json({ reply, cached: false });
});

// ---------------------------
// PORT
// ---------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Backend läuft auf Port " + PORT));
