process.env.PDF_PARSE_IGNORE_DATA_DIRECTORY = "true";

import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "fs";
import Groq from "groq-sdk";
import pdfParse from "pdf-parse"; // NEU: PDF Parser importieren

const app = express();
const PORT = process.env.PORT || 3000;

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

app.use(cors({ origin: "*", methods: ["POST", "OPTIONS"] }));
app.use(express.json({ limit: "50mb" }));

// Multer anpassen, damit Bilder, Audio UND PDFs akzeptiert werden
const upload = multer({
  dest: "uploads/",
  fileFilter: (req, file, cb) => {
    if (
      file.mimetype.startsWith("image/") || 
      file.mimetype.startsWith("audio/") || 
      file.mimetype === "application/pdf" // NEU: PDF erlauben
    ) {
      return cb(null, true);
    }
    cb(null, false);
  }
});

function trimHistory(history) {
  if (!Array.isArray(history)) return [];
  return history.slice(-6);
}

async function runLLM(messages) {
  try {
    // 1. Versuch: Mit deinem Wunsch-Hauptmodell
    const res = await groq.chat.completions.create({
      model: "groq/compound", 
      messages
    });
    return res.choices?.[0]?.message?.content;
  } catch (err) {
    console.error("⚠️ Hauptmodell-Fehler (429/413):", err.message);
    console.log("🔄 Wechsle automatisch auf stabiles Fallback-Modell...");
    
    try {
      // 2. Versuch: Fallback auf ein schnelles Modell mit extrem hohen Limits
      const fallbackRes = await groq.chat.completions.create({
        model: "llama-3.3-70b-versatile", // Sehr robust gegen Überlastung und große Datenmengen
        messages
      });
     return fallbackRes.choices?.[0]?.message?.content;
    } catch (fallbackErr) {
      console.error("❌ Auch das Fallback-Modell ist gescheitert:", fallbackErr.message);
      
      // Spezifische Fehlermeldung für den User, falls das PDF einfach astronomisch riesig war
      if (err.message.includes("large") || fallbackErr.message.includes("large")) {
        return "Das hochgeladene Dokument enthält leider zu viel Text für die KI. Bitte versuche es mit einer kleineren Datei.";
      }
      return "Der Server ist aktuell stark überlastet. Bitte versuche es in wenigen Sekunden noch einmal.";
    }
  }
}

// ROUTE FÜR AUDIO-TRANSKRIPTION (Bleibt gleich)
app.post("/transcribe", upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Keine Audiodatei." });
    const transcription = await groq.audio.transcriptions.create({
      file: fs.createReadStream(req.file.path),
      model: "whisper-large-v3",
      language: "de",
      response_format: "json",
    });
    fs.unlinkSync(req.file.path);
    return res.json({ text: transcription.text });
  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    return res.status(500).json({ error: "Fehler bei der Spracherkennung." });
  }
});

// CHAT ROUTE (Unterstützt jetzt Text, Bild-Generierung, Vision-Bilder UND PDFs)
app.post("/chat", upload.single("image"), async (req, res) => {
  try {
    const { message, history } = req.body;

    // --- POLLINATIONS AI BILDGENERIERUNG ---
    const msgLower = message ? message.toLowerCase() : "";
    const isImageGeneration = msgLower.startsWith("/image") || msgLower.startsWith("generiere ein bild");

    if (isImageGeneration) {
      let prompt = message.replace(/^\/image\s*/i, "").replace(/^generiere ein bild\s*(von\s*)?/i, "");
      if (!prompt.trim()) return res.json({ reply: "Bitte gib an, was ich zeichnen soll!" });

      let finalEnglishPrompt = prompt;
      try {
        const translationRes = await groq.chat.completions.create({
          model: "groq/compound",
          messages: [
            { role: "system", content: "Translate the user's image prompt from German to English. Enhance it with vivid descriptive keywords for high quality. Reply ONLY with the final English prompt." },
            { role: "user", content: prompt }
          ]
        });
        const translatedText = translationRes.choices?.[0]?.message?.content?.trim();
        if (translatedText) finalEnglishPrompt = translatedText;
      } catch {}

      const encodedPrompt = encodeURIComponent(finalEnglishPrompt);
      const randomSeed = Math.floor(Math.random() * 100000);
      const generatedImageUrl = `https://image.pollinations.ai/p/${encodedPrompt}?model=flux&width=1024&height=768&seed=${randomSeed}`;

      return res.json({ 
        reply: `Hier ist dein generiertes Bild für: **${prompt}**`, 
        generatedImage: generatedImageUrl 
      });
    }

    // --- LOGIK FÜR TEXT-, VISION- UND PDF-CHATS ---
    let chatHistory = [];
    if (history) {
      try { chatHistory = trimHistory(JSON.parse(history)); } catch {}
    }

    let extraContext = "";

    // Wenn eine Datei hochgeladen wurde
    if (req.file) {
      if (req.file.mimetype === "application/pdf") {
        // 📄 PDF VERARBEITUNG
        console.log(`📄 PDF hochgeladen: ${req.file.originalname}`);
        try {
          const dataBuffer = fs.readFileSync(req.file.path);
          const pdfData = await pdfParse(dataBuffer);
          extraContext = `[Inhalt der hochgeladenen PDF-Datei "${req.file.originalname}":]\n${pdfData.text}\n[Ende des PDF-Inhalts]`;
        } catch (pdfErr) {
          console.error("Fehler beim PDF-Parsen:", pdfErr.message);
          extraContext = "Hinweis: Eine PDF-Datei wurde hochgeladen, konnte aber nicht gelesen werden.";
          // Sicherstellen, dass die Datei bei einem Parse-Fehler trotzdem gelöscht wird:
          if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path); 
        }
      } else if (req.file.mimetype.startsWith("image/")) {
        // 📸 BILD VERARBEITUNG (Vision)
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
          extraContext = `Bildbeschreibung:\n${visionRes.choices?.[0]?.message?.content || ""}`;
        } catch (err) { console.error("Vision Error:", err.message); }
      }
      
      // Temporäre Datei löschen
      fs.unlinkSync(req.file.path);
    }

    const messages = [
      { role: "system", content: "Du bist KanoAI. Erkläre klar, strukturiert und hilfreich und agiere wie ein mensch antwortet würde (mittelkurz) auf Deutsch. Wenn der Benutzer ein Dokument oder Bild bereitstellt, beziehe dich bei der Beantwortung seiner Frage direkt auf dessen Inhalt." },
      ...chatHistory,
      { role: "user", content: extraContext ? `${extraContext}\n\nFrage des Users:\n${message || "Fasse das Dokument zusammen."}` : message }
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
