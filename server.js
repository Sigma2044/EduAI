import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import multer from "multer";
import fs from "fs";

const app = express();
app.use(cors());
app.use(express.json({ limit: "20mb" }));

const upload = multer({ dest: "uploads/" });

const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;

/* -----------------------------------------
   CHAT — Nur Mistral
------------------------------------------ */
app.post("/chat", async (req, res) => {
  const { message } = req.body;

  try {
    const r = await fetch("https://api.mistral.ai/v1/chat/completions", {
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

    const data = await r.json();

    if (r.ok && data?.choices?.[0]?.message?.content) {
      return res.json({ reply: data.choices[0].message.content });
    }

    console.log("❌ Mistral Chat Error:", data);
    return res.status(500).json({ reply: "❌ Fehler bei Mistral." });

  } catch (err) {
    console.log("❌ Chat Server Error:", err);
    return res.status(500).json({ reply: "❌ Serverfehler." });
  }
});

/* -----------------------------------------
   VISION — Mistral Vision (neues Format)
------------------------------------------ */
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
              { type: "image_base64", image_base64: file }
            ]
          }
        ]
      })
    });

    const data = await response.json();

    if (response.ok && data?.choices?.[0]?.message?.content) {
      return res.json({ reply: data.choices[0].message.content });
    }

    console.log("❌ Vision Error:", data);
    return res.status(500).json({ error: "Vision failed", details: data });

  } catch (err) {
    console.log("❌ Vision Server Error:", err);
    return res.status(500).json({ error: "Server crashed", details: err });
  }
});

/* -----------------------------------------
   PORT (Render fix)
------------------------------------------ */
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`EduAI Backend läuft auf Port ${PORT}`);
});

