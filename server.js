import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "fs";
import Groq from "groq-sdk";
import { HfInference } from "@huggingface/inference"; // NEU: Hugging Face Bibliothek

const app = express();
const PORT = process.env.PORT || 3000;

// Initialisierung der APIs
// Initialisierung der APIs mit benutzerdefinierten Headern für Stabilität
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const hf = new HfInference(process.env.HUGGINGFACE_API_KEY, {
  headers: {
    "User-Agent": "EduAI-Application/1.0",
    "Accept": "application/json"
  }
});

app.use(cors({ origin: "*", methods: ["POST", "OPTIONS"] }));
app.use(express.json({ limit: "50mb" }));

const upload = multer({
  dest: "uploads/",
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) return cb(null, false);
    cb(null, true);
  }
});

function trimHistory(history) {
  if (!Array.isArray(history)) return [];
  return history.slice(-6);
}

async function runLLM(messages) {
  try {
    const res = await groq.chat.completions.create({
      model: "groq/compound", 
      messages
    });
    return res.choices?.[0]?.message?.content;
  } catch (err) {
    console.error("LLM Error → Fallback:", err.message);
    return "Fehler bei der Textgenerierung.";
  }
}

app.post("/chat", upload.single("image"), async (req, res) => {
  try {
    const { message, history } = req.body;

    // --- NEUER, STABILER BLOCK FÜR HUGGING FACE BILDGENERIERUNG ---
    const msgLower = message ? message.toLowerCase() : "";
    const isImageGeneration = msgLower.startsWith("/image") || msgLower.startsWith("generiere ein bild");

if (isImageGeneration) {
      let prompt = message.replace(/^\/image\s*/i, "").replace(/^generiere ein bild\s*(von\s*)?/i, "");
      
      if (!prompt.trim()) {
        return res.json({ reply: "Bitte gib an, was ich zeichnen soll! (z.B. `/image eine Katze`)" });
      }

      console.log(`🎨 Backend generiert Bild für: ${prompt}`);

      try {
        const response = await fetch(
          "https://api-inference.huggingface.co/models/black-forest-labs/FLUX.1-schnell",
          {
            headers: { 
              "Authorization": `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
              "Content-Type": "application/json"
            },
            method: "POST",
            body: JSON.stringify({ inputs: prompt }),
          }
        );

        if (!response.ok) {
          throw new Error(`Hugging Face API meldet Status ${response.status}`);
        }

        // Bilddaten im Server abfangen und in Base64-Text umwandeln
        const arrayBuffer = await response.arrayBuffer();
        const base64 = Buffer.from(arrayBuffer).toString("base64");

        return res.json({ 
          reply: `Hier ist dein generiertes Bild für: **${prompt}**`, 
          generatedImage: `data:image/jpeg;base64,${base64}` 
        });

      } catch (err) {
        console.error("❌ Fehler im Backend:", err.message);
        return res.status(500).json({ reply: `Fehler bei der Bildgenerierung: ${err.message}` });
      }
    }
    // --- LOGIK FÜR TEXT- UND VISION-CHATS (Unverändert) ---
    let chatHistory = [];
    if (history) {
      try { chatHistory = trimHistory(JSON.parse(history)); } catch {}
    }

    let imageContext = "";
    if (req.file) {
      const base64Image = fs.readFileSync(req.file.path).toString("base64");
      try {
        const visionRes = await groq.chat.completions.create({
          model: "meta-llama/llama-4-scout-17b-16e-instruct", 
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: "Beschreibe dieses Bild präzise und strukturiert." },
                { type: "image_url", image_url: { url: `data:${req.file.mimetype};base64,${base64Image}` } }
              ]
            }
          ]
        });
        imageContext = visionRes.choices?.[0]?.message?.content || "";
      } catch (err) { console.error("Vision Error:", err.message); }
      fs.unlinkSync(req.file.path);
    }

    const messages = [
      { role: "system", content: "Du bist EduAI. Erkläre klar, strukturiert und hilfreich (mittlekurz)schreibe deutsch." },
      ...chatHistory,
      { role: "user", content: imageContext ? `Bildbeschreibung:\n${imageContext}\n\nFrage:\n${message}` : message }
    ];

    const reply = await runLLM(messages);
    return res.json({ reply });

  } catch (error) {
    console.error("Server Error:", error);
    return res.status(500).json({ reply: "Fehler im Backend." });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 EduAI Backend mit Hugging Face Bibliothek läuft auf Port ${PORT}`);
});
