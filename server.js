import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import multer from "multer";
import fs from "fs";
import Groq from "groq-sdk";

const app = express();
const PORT = process.env.PORT || 3000;

// API Keys NUR aus Umgebungsvariablen
const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

if (!MISTRAL_API_KEY || !GROQ_API_KEY) {
  console.error("❌ MISTRAL_API_KEY oder GROQ_API_KEY fehlt in den Umgebungsvariablen.");
  process.exit(1);
}

const groq = new Groq({ apiKey: GROQ_API_KEY });

// CORS nur für deine Domain (bei Bedarf anpassen)
app.use(cors({
  origin: "*", // z.B. "https://deine-domain.com"
  methods: ["POST", "OPTIONS"]
}));

app.use(express.json({ limit: "50mb" }));

// Multer für Bilder-Uploads – nur Images erlauben
const upload = multer({
  dest: "uploads/",
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(null, false);
    }
    cb(null, true);
  }
});

app.post("/chat", upload.single("image"), async (req, res) => {
  const { message, history, mode } = req.body;

  if (!message || typeof message !== "string") {
    return res.status(400).json({ reply: "❌ 'message' fehlt oder ist ungültig." });
  }

  let chatHistory = [];
  if (history) {
    try {
      chatHistory = JSON.parse(history);
      if (!Array.isArray(chatHistory)) chatHistory = [];
    } catch {
      chatHistory = [];
    }
  }

  let imageContext = "";

  try {
    // 1. VISION: Llama 4 Scout analysiert das Bild (wenn vorhanden und gültig)
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
              {
                type: "image_url",
                image_url: `data:${req.file.mimetype};base64,${base64Image}`
              }
            ]
          }]
        });

        imageContext = visionRes.choices?.[0]?.message?.content || "";
      } catch (err) {
        console.error("Vision Error:", err.message || err);
      } finally {
        // Bild nach der Vision-Analyse löschen
        try {
          fs.unlinkSync(req.file.path);
        } catch (e) {
          console.error("Fehler beim Löschen der Datei:", e.message || e);
        }
      }
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
          {
            role: "user",
            content: imageContext
              ? `Bild-Info: ${imageContext}\nFrage: ${message}`
              : message
          }
        ]
      });
      finalReply = completion.choices?.[0]?.message?.content || "Keine Antwort vom Modell.";

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
          model: "mistral-small-2506",
          messages: [
            { role: "system", content: "Du bist der Flash-Modus von EduAI. Antworte kurz aber sinnvoll und präzise.Schreibe nicht zu lang allerdings auch nicht Zu kurz in etwas 3-12 zeilen gebe nötige details!" },
            ...chatHistory,
            {
              role: "user",
              content: imageContext
                ? `Bild-Info: ${imageContext}\nFrage: ${message}`
                : message
            }
          ]
        })
      });

      const data = await mistralRes.json();
      if (!mistralRes.ok) {
        console.error("Mistral API Error:", data);
        return res.status(500).json({ reply: "Fehler bei Mistral.", details: data });
      }

      finalReply = data.choices?.[0]?.message?.content || "Keine Antwort vom Modell.";
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
