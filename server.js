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
            { 
              role: "system", 
              content: "You are a translation assistant. Translate the user prompt to English, optimize it with cinematic keywords for smooth motion. Crucial: Reply ONLY with the final prompt string. Do not include markdown headers, do not include reasoning, do not explain. Just the raw string." 
            },
            { role: "user", content: prompt }
          ]
        });
        
        let translatedText = translationRes.choices?.[0]?.message?.content?.trim();
        if (translatedText) {
          translatedText = translatedText.replace(/^["']|["']$/g, "");
          finalEnglishPrompt = translatedText;
        }
      } catch (transErr) {
        console.error("Translation failed, using original prompt:", transErr);
      }

      // 2. Video-Generierung via LTX 2.3 Studio (/handler)
      try {
        console.log(`🎬 Verbinde mit LTX2.3-Studio Space für: "${finalEnglishPrompt}"...`);
       // Vorher: const client = await Client.connect("nsfwalex/LTX2.3-Studio");
// Nachher: Ersetze diese Zeile mit dem folgenden Code:
const hfToken = process.env.HUGGINGFACE_API_KEY; // Je nachdem, wie du die Variable auf Render genannt hast
const client = await Client.connect("nsfwalex/LTX2.3-Studio", hfToken ? { hf_token: hfToken } : {});
       
        const result = await client.predict("/handler", { 		
          param_0: finalEnglishPrompt, 
          param_1: "Fast",              
          param_2: 768,                 
          param_3: 512,                 
          param_4: 3,                   
          param_5: 24,                  
          param_6: 0,                   
          param_7: true,                
          param_8: "low quality, worst quality, deformed, blurry, watermark", 
          param_9: "none",              
          param_10: 0,                  
          param_11: false,              
          param_12: 0,                  
          param_13: "mp4",              
        });

        console.log("📦 LTX API-Antwort empfangen:", JSON.stringify(result.data));

        let videoUrl = "";
        if (result.data && result.data.length > 0) {
          for (const item of result.data) {
            if (!item) continue;

            // Holt die URL aus dem verschachtelten video-Objekt
            if (item.video && item.video.url) {
              videoUrl = item.video.url;
              break;
            }
            else if (item.url) {
              videoUrl = item.url;
              break;
            }
            else if (typeof item === "string" && item.startsWith("http")) {
              videoUrl = item;
              break;
            }
          }
        }
        
        if (!videoUrl) {
          throw new Error("Keine Video-URL in den empfangenen Daten gefunden.");
        }
        
        return res.json({ 
          reply: `Hier ist dein generiertes Video für: **${prompt}** (LTX 2.3 Studio) ⚡`, 
          generatedVideo: videoUrl
        });

      } catch (videoErr) {
        console.error("❌ Video-Generierungsfehler:", videoErr.message || videoErr);
        return res.json({ reply: "Die Video-Generierung ist fehlgeschlagen oder der Space ist überlastet. Bitte versuche es gleich noch einmal!" });
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
