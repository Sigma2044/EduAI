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

      console.log(`🎨 Generiere Bild über Hugging Face (Flux) für Prompt: ${prompt}`);

      try {
        // Nutzung der offiziellen Bibliothek für maximale Stabilität
        const response = await hf.textToImage({
          model: "black-forest-labs/FLUX.1-schnell",
          inputs: prompt,
          parameters: {
            width: 1024,
            height: 1024,
          }
        });

        // Die Bibliothek gibt einen Blob zurück, den wir in Buffer -> Base64 wandeln
        const buffer = Buffer.from(await response.arrayBuffer());
        const base64Image = buffer.toString("base64");
        
        const generatedImageUrl = `data:image/jpeg;base64,${base64Image}`;

        return res.json({ 
          reply: `Hier ist dein generiertes Bild über Hugging Face für: **${prompt}**`, 
          generatedImage: generatedImageUrl 
        });

      } catch (err) {
        console.error("Hugging Face Generation Error:", err.message);
        
        // Spezifische Fehlermeldung für Gating/Berechtigung
        if (err.message.includes("403") || err.message.includes("gated")) {
            return res.status(500).json({ reply: "Fehler: Dein HF-Token hat keine Berechtigung für Flux. Bitte akzeptiere die Nutzungsbedingungen auf der Hugging Face Website für dieses Modell." });
        }
        
        return res.status(500).json({ reply: `Fehler bei Hugging Face: ${err.message}` });
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
