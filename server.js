const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const multer = require("multer");
const fs = require("fs");

const app = express();
app.use(cors());
app.use(express.json({ limit: "20mb" }));

const upload = multer({ dest: "uploads/" });

const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

/* ---------------------------------------------------
   CHAT — Mistral → Fallback zu OpenRouter
--------------------------------------------------- */
app.post("/chat", async (req, res) => {
  const { message } = req.body;

  /* 1️⃣ Versuch: Mistral */
  try {
    const r1 = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${MISTRAL_API_KEY}`
      },
      body: JSON.stringify({
        model: "mistral-small-latest",
        messages: [{ role: "user", content: message }]
      })
    });

    if (r1.ok) {
      const data = await r1.json();
      return res.json({ reply: data.choices[0].message.content });
    }
  } catch (e) {
    console.log("⚠️ Mistral Chat Error:", e);
  }

  /* 2️⃣ Fallback: OpenRouter */
  try {
    const r2 = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
        "HTTP-Referer": "https://eduai.de",
        "X-Title": "EduAI Chat"
      },
      body: JSON.stringify({
        model: "mistralai/mistral-small",
        messages: [{ role: "user", content: message }]
      })
    });

    if (r2.ok) {
      const data = await r2.json();
      return res.json({ reply: data.choices[0].message.content });
    }
  } catch (e) {
    console.log("❌ OpenRouter Chat Error:", e);
  }

  return res.json({
    reply: "❌ Beide Provider sind momentan nicht erreichbar."
  });
});

/* ---------------------------------------------------
   BILDANALYSE — Pixtral Vision
--------------------------------------------------- */
app.post("/vision", upload.single("image"), async (req, res) => {
  try {
    const file = fs.readFileSync(req.file.path, { encoding: "base64" });

    const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${MISTRAL_API_KEY}`
      },
      body: JSON.stringify({
        model: "mistral-small-latest",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Beschreibe dieses Bild." },
              {
                type: "image_base64",
                image_base64: file
              }
            ]
          }
        ]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.log("❌ Vision Error:", data);
      return res.status(500).json({ error: "Vision failed", details: data });
    }

    return res.json({ reply: data.choices[0].message.content });

  } catch (err) {
    console.log("❌ Vision Server Error:", err);
    return res.status(500).json({ error: "Server crashed", details: err });
  }
});


/* ---------------------------------------------------
   RENDER PORT FIX
--------------------------------------------------- */
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`EduAI Backend läuft auf Port ${PORT}`);
});
