import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import crypto from "crypto";

const app = express();
app.use(express.json());
app.use(cors());

// --- SIMPLE CACHE ---
const cache = {};
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 Stunden

function getCacheKey(text) {
  return crypto.createHash("sha256").update(text.toLowerCase().trim()).digest("hex");
}

function getFromCache(key) {
  const entry = cache[key];
  if (!entry) return null;

  const isExpired = Date.now() - entry.timestamp > CACHE_TTL;
  if (isExpired) {
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

// --- CHAT ENDPOINT ---
app.post("/chat", async (req, res) => {
  const userMessage = req.body.message;
  const key = getCacheKey(userMessage);

  // 1. CHECK CACHE
  const cached = getFromCache(key);
  if (cached) {
    return res.json({ reply: cached, cached: true });
  }

  // 2. FETCH FROM MISTRAL
  try {
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

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content || "Fehler: Keine Antwort erhalten.";

    // 3. SAVE TO CACHE
    saveToCache(key, reply);

    res.json({ reply, cached: false });

  } catch (err) {
    console.error(err);
    res.status(500).json({ reply: "Serverfehler." });
  }
});

// --- PORT ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Backend läuft auf Port " + PORT));
