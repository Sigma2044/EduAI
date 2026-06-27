import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "fs";
import Groq from "groq-sdk";

const app = express();
const PORT = process.env.PORT || 3000;

// Initialisierung der Groq-API
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

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

    // --- NEUER BLOCK FÜR POLLINATIONS AI BILDGENERIERUNG ---
    const msgLower = message ? message.toLowerCase() : "";
    const isImageGeneration = msgLower.startsWith("/image") || msgLower.startsWith("generiere ein bild");

   if (isImageGeneration) {
      let prompt = message.replace(/^\/image\s*/i, "").replace(/^generiere ein bild\s*(von\s*)?/i, "");
      
      if (!prompt.trim()) {
        return res.json({ reply: "Bitte gib an, was ich zeichnen soll! (z.B. `/image eine Katze`)" });
      }

      console.log(`🎨 Originaler Prompt (Deutsch): ${prompt}`);

      let finalEnglishPrompt = prompt;

      // KI-Übersetzer via Groq vorschalten
      try {
        const translationRes = await groq.chat.completions.create({
          model: "groq/compound", // Nutzt dein Standard-Modell aus dem Code
          messages: [
            { 
              role: "system", 
              content: "You are a prompt translator. Translate the user's image prompt from German to English. Enhance it slightly with vivid descriptive keywords for high quality (e.g., photorealistic, detailed). Reply ONLY with the final English prompt. No conversational text, no quotes." 
            },
            { role: "user", content: prompt }
          ]
        });

        const translatedText = translationRes.choices?.[0]?.message?.content?.trim();
        if (translatedText) {
          finalEnglishPrompt = translatedText;
          console.log(`🌍 Automatische Übersetzung & Optimierung: ${finalEnglishPrompt}`);
        }
      } catch (transErr) {
        console.error("⚠️ Übersetzungs-Fallback aktiv:", transErr.message);
        // Falls Groq mal hakt, nutzen wir einfach das deutsche Original + Standard-Keywords
        finalEnglishPrompt = `${prompt}, photorealistic, highly detailed, 8k resolution`;
      }

      // Prompt für die URL codieren
      const encodedPrompt = encodeURIComponent(finalEnglishPrompt);
      const randomSeed = Math.floor(Math.random() * 100000);
      
      // Bild-URL mit dem englischen, optimierten Prompt bauen
      const generatedImageUrl = `https://image.pollinations.ai/p/${encodedPrompt}?model=flux&width=1024&height=768&seed=${randomSeed}`;

      return res.json({ 
        reply: `Hier ist dein generiertes Bild für: **${prompt}**`, 
        generatedImage: generatedImageUrl 
      });
    }

    // --- LOGIK FÜR TEXT- UND VISION-CHATS ---
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
  console.log(`🚀 EduAI Backend läuft stabil auf Port ${PORT}`);
});
