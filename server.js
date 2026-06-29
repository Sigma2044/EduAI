process.env.PDF_PARSE_IGNORE_DATA_DIRECTORY = "true";

import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "fs";
import Groq from "groq-sdk";
import pdfParse from "pdf-parse";
import axios from "axios";
import OpenAI from "openai";
import { Client } from "@gradio/client"; // <-- Wichtig: Gradio Client für die Video-KI

const app = express();
const PORT = process.env.PORT || 3000;

// API Clients initialisieren
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const nvidiaClient = new OpenAI({
  apiKey: process.env.NVIDIA_API_KEY || "dummy_key_until_env_loads",
  baseURL: 'https://integrate.api.nvidia.com/v1',
});

app.use(cors({ origin: "*", methods: ["POST", "OPTIONS"] }));
app.use(express.json({ limit: "50mb" }));

// Multer-Konfiguration für Uploads
const upload = multer({
  dest: "uploads/",
  fileFilter: (req, file, cb) => {
    if (
      file.mimetype.startsWith("image/") || 
      file.mimetype.startsWith("audio/") || 
      file.mimetype === "application/pdf"
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

// 4-stufige intelligente KI-Kaskade (Groq -> Backup)
async function runLLM(messages) {
  // --- STUFE 1: GROQ COMPOUND (Dein primäres Hauptmodell) ---
  try {
    console.log("⚡ Stufe 1: Groq Compound wird angefragt...");
    const res = await groq.chat.completions.create({
      model: "groq/compound", 
      messages: messages
    });
    return res.choices?.[0]?.message?.content;
  } catch (err) {
    console.error("⚠️ Hauptmodell-Fehler (429/413):", err.message);
    console.log("🔄 Wechsle automatisch auf stabiles Fallback-Modell...");
  }

  // --- STUFE 2: LLAMA 3.3 70B (Dein stabiles Groq-Backup) ---
  try {
    console.log("🔄 Stufe 2: Llama 3.3 via Groq wird angefragt...");
    const fallbackRes = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: messages
    });
    return fallbackRes.choices?.[0]?.message?.content;
  } catch (fallbackErr) {
    console.error("❌ Auch das Fallback-Modell ist gescheitert:", fallbackErr.message);
    
    if (fallbackErr.message.includes("large")) {
      return "Das hochgeladene Dokument enthält leider zu viel Text für die KI. Bitte versuche es mit einer kleineren Datei.";
    }
    return "Der Server ist aktuell stark überlastet. Bitte versuche es in wenigen Sekunden noch einmal.";
  }
}

// ROUTE FÜR AUDIO-TRANSKRIPTION
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

// CHAT ROUTE (Inklusive Wetter, Krypto, Wiki, Bild- und Video-Generierung)
app.post("/chat", upload.single("image"), async (req, res) => {
  try {
    const { message, history } = req.body;
    const msgLower = message ? message.toLowerCase() : "";

    // ==========================================
    // SYSTEM-APIS DIREKT ABFANGEN
    // ==========================================

    // WETTER
    if (msgLower.includes("wetter")) {
      const url = 'https://api.open-meteo.com/v1/forecast?latitude=52.52&longitude=13.41&current=temperature_2m,weather_code&timezone=Europe%2FBerlin';
      try {
        const response = await axios.get(url, { headers: { 'User-Agent': 'EduAI-Bot/1.0' } });
        const data = response.data;
        const temp = data.current.temperature_2m;
        const code = data.current.weather_code;
        
        let zustand = "klarer Himmel";
        if (code >= 1 && code <= 3) zustand = "leicht bewölkt";
        if (code >= 61 && code <= 65) zustand = "Regen 🌧️";
        if (code >= 71 && code <= 75) zustand = "Schnee ❄️";
        if (code === 45 || code === 48) zustand = "Nebel 🌫️";
        if (code >= 95) zustand = "Gewitter ⚡";

        return res.json({ reply: `[WEATHER_SYS]: In Berlin sind es gerade **${temp}°C** (${zustand}).` });
      } catch (error) {
        console.error("❌ Detaillierter Wetter-Fehler:", error.message);
        return res.json({ reply: "[WEATHER_SYS]: Wetterdaten temporär nicht erreichbar." });
      }
    }

    // KRYPTO
    if (msgLower.includes("crypto") || msgLower.includes("krypto") || msgLower.includes("btc")) {
      const url = 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=eur';
      try {
        const response = await axios.get(url, { headers: { 'User-Agent': 'EduAI-Bot/1.0' } });
        const data = response.data;
        return res.json({ reply: `[CRYPTO_SYS]: BTC: ${data.bitcoin.eur.toLocaleString()} € | ETH: ${data.ethereum.eur.toLocaleString()} €` });
      } catch (error) {
        console.error("❌ Krypto-Fehler:", error.message);
        return res.json({ reply: "[CRYPTO_SYS]: Fehler beim Laden der Krypto-Kurse." });
      }
    }

    // WIKIPEDIA
    if (msgLower.startsWith("was ist") || msgLower.startsWith("wer ist") || msgLower.includes("wiki")) {
      const suchbegriff = msgLower.replace("was ist", "").replace("wer ist", "").replace("wiki", "").trim();
      const url = `https://de.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(suchbegriff)}`;
      try {
        const response = await axios.get(url, { headers: { 'User-Agent': 'EduAI-Bot/1.0' } });
        if (response.data && response.data.extract) {
          return res.json({ reply: `[WIKI_SYS]: ${response.data.extract}` });
        }
      } catch (error) {
        console.error("❌ Wiki-Fehler:", error.message);
      }
    }

    // NEWS (Tagesschau)
    if (msgLower.includes("news") || msgLower.includes("nachrichten")) {
      const url = 'https://www.tagesschau.de/api/v1/homepage';
      try {
        const response = await axios.get(url, { headers: { 'User-Agent': 'EduAI-Bot/1.0' } });
        const topNews = response.data.news.slice(0, 3).map(n => `• ${n.title}`).join('\n');
        return res.json({ reply: `[NEWS_SYS] Aktuelle Top-Meldungen:\n${topNews}` });
      } catch (error) {
        console.error("❌ News-Fehler:", error.message);
        return res.json({ reply: "[NEWS_SYS]: Nachrichten-Feed konnte nicht geladen werden." });
      }
    }

    // --- POLLINATIONS AI BILDGENERIERUNG ---
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

    // --- ALIBABA COGVIDEOX-FUN VIDEO-GENERIERUNG (Kostenloser Space-Hack) ---
const isVideoGeneration = msgLower.startsWith("/video") || msgLower.startsWith("generiere ein video");

    if (isVideoGeneration) {
      let prompt = message.replace(/^\/video\s*/i, "").replace(/^generiere ein video\s*(von\s*)?/i, "");
      if (!prompt.trim()) return res.json({ reply: "Bitte gib an, was im Video zu sehen sein soll!" });

      // 1. Prompt übersetzen und optimieren
      let finalEnglishPrompt = prompt;
      try {
        const translationRes = await groq.chat.completions.create({
          model: "groq/compound",
          messages: [
            { role: "system", content: "Translate the user's video prompt from German to English. Enhance it with cinematic keywords for high quality and smooth movement. Reply ONLY with the final English prompt." },
            { role: "user", content: prompt }
          ]
        });
        const translatedText = translationRes.choices?.[0]?.message?.content?.trim();
        if (translatedText) finalEnglishPrompt = translatedText;
      } catch (transErr) {
        console.error("Translation failed:", transErr);
      }

      // 2. Video-Generierung über den offiziellen Wan-AI/Wan2.1 Space
      try {
        console.log(`🎬 Verbinde mit offiziellem Wan-AI Space für: "${finalEnglishPrompt}"...`);
        
        const client = await Client.connect("Wan-AI/Wan2.1");

        // Da der offizielle Space asynchron arbeitet, nutzen wir client.submit() statt .predict()
        const job = client.submit("/t2v_generation", [         
          finalEnglishPrompt,  // Prompt Textbox
          "832*480",           // Resolution Dropdown ("832*480" oder "480*832")
          true,                // Watermark Checkbox (true/false)
          -1,                  // Seed (-1 für Random)
        ]);

        // Wir warten auf das finale Ergebnis des Gradio-Jobs
        const result = await new Promise((resolve, reject) => {
          job.on("status", (status) => {
            if (status.stage === "error") {
              reject(new Error(status.message || "Fehler in der HF-Warteschlange"));
            }
          });

          job.on("data", (data) => {
            resolve(data);
          });
        });

        let videoUrl = "";
        if (result.data && result.data[0]) {
          // Das offizielle Modell liefert ein JSON-Objekt mit der URL zurück
          videoUrl = result.data[0].url || result.data[0];
        }
        
        if (!videoUrl) {
          throw new Error("Keine Video-URL im Resultat von Wan2.1 gefunden.");
        }
        
        return res.json({ 
          reply: `Hier ist dein generiertes Video für: **${prompt}** (Generiert mit dem offiziellen SOTA Wan 2.1 Modell! 🚀)`, 
          generatedVideo: videoUrl
        });

      } catch (videoErr) {
        console.error("❌ Video-Generierungsfehler:", videoErr.message || videoErr);
        return res.json({ reply: "Der offizielle Wan-AI Space ist wegen der vielen Likes extrem ausgelastet oder die Warteschlange ist voll. Bitte versuche es in wenigen Augenblicken noch einmal!" });
      }
    }
    // --- LOGIK FÜR TEXT-, VISION- UND PDF-CHATS ---
    let chatHistory = [];
    if (history) {
      try { chatHistory = trimHistory(JSON.parse(history)); } catch {}
    }

    let extraContext = "";

    if (req.file) {
      if (req.file.mimetype === "application/pdf") {
        console.log(`📄 PDF hochgeladen: ${req.file.originalname}`);
        try {
          const dataBuffer = fs.readFileSync(req.file.path);
          const pdfData = await pdfParse(dataBuffer);
          extraContext = `[Inhalt der hochgeladenen PDF-Datei "${req.file.originalname}":]\n${pdfData.text}\n[Ende des PDF-Inhalts]`;
        } catch (pdfErr) {
          console.error("Fehler beim PDF-Parsen:", pdfErr.message);
          extraContext = "Hinweis: Eine PDF-Datei wurde hochgeladen, konnte aber nicht gelesen werden.";
          if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path); 
        }
      } else if (req.file.mimetype.startsWith("image/")) {
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
      
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    }

    const messages = [
      { role: "system", content: "Du bist KanoAI niemand anders du basierst auf Kano 3.14. Wirke wie ein Freund, wiederhole dich nur wenn verlangt. Erkläre klar, strukturiert und hilfreich und agiere wie ein Mensch antworten würde (mittelkurz) auf Deutsch. Wenn der Benutzer ein Dokument oder Bild bereitstellt, beziehe dich bei der Beantwortung seiner Frage direkt auf dessen Inhalt." },
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
