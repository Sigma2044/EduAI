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

      console.log(`🎨 Generiere Bild direkt via Fetch für Prompt: ${prompt}`);

      try {
        // Nativer Fetch-Aufruf direkt an das Hugging Face API-Gateway
        const hfResponse = await fetch(
          "https://api-inference.huggingface.co/models/black-forest-labs/FLUX.1-schnell",
          {
            headers: { 
              "Authorization": `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
              "Content-Type": "application/json",
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
              "Accept": "*/*"
            },
            method: "POST",
            body: JSON.stringify({ inputs: prompt }),
          }
        );

        // Falls die API überlastet ist oder der Key nicht stimmt, Fehler abfangen
        if (!hfResponse.ok) {
          const errText = await hfResponse.text().catch(() => "Keine Fehlerdetails");
          throw new Error(`HF-Status: ${hfResponse.status} - ${errText}`);
        }

        // Bilddaten aus dem Response-Stream ziehen
        const arrayBuffer = await hfResponse.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const base64Image = buffer.toString("base64");
        
        const generatedImageUrl = `data:image/jpeg;base64,${base64Image}`;

        return res.json({ 
          reply: `Hier ist dein generiertes Bild für: **${prompt}**`, 
          generatedImage: generatedImageUrl 
        });

      } catch (err) {
        console.error("Bildgenerierung fehlgeschlagen:", err.message);
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
