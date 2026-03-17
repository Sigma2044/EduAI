import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import multer from "multer";
import fs from "fs";
import Groq from "groq-sdk";

const app = express();
const PORT = process.env.PORT || 3000;

// API KEYS (Ersetze diese durch deine echten Keys)
const MISTRAL_API_KEY = "DEIN_MISTRAL_KEY";
const GROQ_API_KEY = "DEIN_GROQ_KEY";

const groq = new Groq({ apiKey: GROQ_API_KEY });

app.use(cors());
app.use(express.json({ limit: "50mb" }));

// Multer für Bilder-Uploads
const upload = multer({ dest: "uploads/" });

app.post("/chat", upload.single("image"), async (req, res) => {
  const { message, history, mode } = req.body; 
  let chatHistory = history ? JSON.parse(history) : [];

  try {
    let imageContext = "";

    // 1. VISION: Llama 4 Scout analysiert das Bild (immer, wenn eins da ist)
    if (req.file) {
      console.log("📸 Vision-Analyse startet...");
      const base64Image = fs.readFileSync(req.file.path).toString("base64");
      
      try {
        const visionRes = await groq.chat.completions.create({
          model: "meta-llama/llama-4-scout-17b-16e-instruct",
          messages: [{
            role: "user",
            content: [
              { type: "text", text: "Beschreibe das Bild/den Code präzise für eine andere KI." },
              { type: "image_url", image_url: { url: `data:${req.file.mimetype};base64,${base64Image}` } }
            ]
          }]
        });
        imageContext = visionRes.choices[0].message.content;
      } catch (err) {
        console.error("Vision Error:", err.message);
      }
      fs.unlinkSync(req.file.path);
    }

    // 2. LOGIK: Welches Modell wurde gewählt?
    let finalReply = "";

    if (mode === "codex") {
      // CODEX: Qwen3 32B via Groq
      console.log("🚀 Modus: CODEX (Qwen3)");
      const completion = await groq.chat.completions.create({
        model: "qwen/qwen3-32b",
        messages: [
          { role: "system", content: "Du bist der Codex-Modus. Ein Coding-Experte. Nutze Markdown für Code." },
          ...chatHistory,
          { role: "user", content: imageContext ? `Bild-Info: ${imageContext}\nFrage: ${message}` : message }
        ]
      });
      finalReply = completion.choices[0].message.content;

    } else {
      // FLASH: Mistral Small via API
      console.log("⚡ Modus: FLASH (Mistral)");
      const mistralRes = await fetch("https://api.mistral.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${MISTRAL_API_KEY}`
        },
        body: JSON.stringify({
          model: "mistral-small-latest",
          messages: [
            { role: "system", content: "Du bist der Flash-Modus. Antworte kurz und präzise." },
            ...chatHistory,
            { role: "user", content: imageContext ? `Bild-Info: ${imageContext}\nFrage: ${message}` : message }
          ]
        })
      });
      const data = await mistralRes.json();
      finalReply = data.choices[0].message.content;
    }

    res.json({ reply: finalReply });

  } catch (error) {
    console.error("Server Error:", error);
    res.status(500).json({ reply: "Fehler im Backend." });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 EduAI läuft auf http://localhost:${PORT}`);
});
