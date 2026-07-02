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
    console.log("⚡ Stufe 1: Kimi K2 wird angefragt...");
    const res = await groq.chat.completions.create({
      model: "moonshotai/Kimi-K2-Instruct-0905", 
      messages: messages
    });
    return res.choices?.[0]?.message?.content;
  } catch (err) {
    console.error("⚠️ Hauptmodell-Fehler (429/413):", err.message);
    console.log("🔄 Wechsle automatisch auf stabiles Fallback-Modell...");
  }

  // --- STUFE 2: LLAMA 3.3 70B (Dein stabiles Groq-Backup) ---
  try {
    console.log("🔄 Stufe 2: Compunand via Groq wird angefragt...");
    const fallbackRes = await groq.chat.completions.create({
      model: "groq/compound",
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

import { toFile } from "groq-sdk"; // Falls das oben importiert werden kann
// Alternativ: falls du kein toFile importieren willst, nutzen wir das native Node 'File'

// ROUTE FÜR AUDIO-TRANSKRIPTION
app.post("/transcribe", upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Keine Audiodatei empfangen." });
    }

    console.log("🎙️ Verarbeite Audio für Groq Whisper...");

    // Wir erstellen ein standardkonformes File-Objekt direkt aus dem Multer-Buffer.
    // Das ist sicherer und verhindert Streaming-Abbrüche.
    const audioFile = new File([req.file.buffer], req.file.originalname || "audio.wav", {
      type: req.file.mimetype || "audio/wav",
    });

    const transcription = await groq.audio.transcriptions.create({
      file: audioFile,
      model: "whisper-large-v3-turbo", // Das Turbo-Modell spart dir wertvolle Millisekunden!
      language: "de",
      response_format: "json",
    });

    return res.json({ text: transcription.text });

  } catch (error) {
    console.error("❌ Fehler bei der Spracherkennung:", error.message || error);
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
  const isImageGeneration = msgLower.startsWith("/bild") || msgLower.startsWith("generiere ein bild");

    if (isImageGeneration) {
      let prompt = message.replace(/^\/bild\s*/i, "").replace(/^generiere ein bild\s*(von\s*)?/i, "");
      if (!prompt.trim()) return res.json({ reply: "Bitte gib an, was auf dem Bild zu sehen sein soll!" });

      console.log("⚡ Stufe 1: Groq Compound wird für die Bild-Übersetzung angefragt...");
      let finalEnglishPrompt = "";
      
      try {
        const translationRes = await groq.chat.completions.create({
          model: "groq/compound",
          messages: [
            { 
              role: "system", 
              content: "You are a translation assistant. Translate the user's input from German to English and add short descriptive art keywords (e.g., highly detailed, cinematic lighting). Output ONLY the final English translation. Do NOT repeat the German input. Do NOT write 'Translation:'." 
            },
            { role: "user", content: prompt }
          ]
        });
        
        let translatedText = translationRes.choices?.[0]?.message?.content?.trim() || "";
        
        // Bereinigung von eventuellen Resten
        if (translatedText.includes("->") || translatedText.includes("→")) {
          translatedText = translatedText.split(/[->→]/).pop();
        }
        finalEnglishPrompt = translatedText.replace(/[“”*'`"»«]/g, "").trim();

      } catch (transErr) {
        console.error("Translation failed, using original prompt:", transErr);
        finalEnglishPrompt = prompt; // Fallback auf Originaltext
      }

      // 2. Bild-Generierung via deinem ZeroGPU Space
      try {
        const spaceId = "max3244363/Stable-Diffusion-1.5"; 
        console.log(`🎨 Verbinde mit ZeroGPU Space ${spaceId} für: "${finalEnglishPrompt}"...`);
        
        // Holt deinen Token aus den Render-Umgebungsvariablen
        const hfToken = process.env.HF_TOKEN; 
        
        // Token wird beim Verbindungsaufbau übergeben, um das Kontingent zu erhöhen
      const client = await Client.connect(spaceId, hfToken ? { hf_token: hfToken } : {});

        // Aufruf des Endpunkts mit den exakten Parametern aus deiner Doku
        const result = await client.predict("/generate_image", { 		
          prompt: finalEnglishPrompt, 
          negative_prompt: "low quality, bad anatomy, blurry, deformed", 
          steps: 1, 
          guidance_scale: 0.0, 
        });

        console.log("📦 API-Antwort empfangen:", JSON.stringify(result.data));

        // Das Bild-Objekt oder die URL aus der Antwort extrahieren
        let imageUrl = "";
        if (result.data && result.data.length > 0) {
          const item = result.data[0];
          if (item && item.url) {
            imageUrl = item.url;
          } else if (typeof item === "string" && item.startsWith("http")) {
            imageUrl = item;
          }
        }
        
        if (!imageUrl) {
          throw new Error("Keine Bild-URL in den empfangenen Daten gefunden.");
        }
        
        return res.json({ 
          reply: `Hier ist dein generiertes Bild für: **${prompt}** 🎨`, 
          generatedImage: imageUrl
        });

      } catch (imgErr) {
        console.error("❌ Bild-Generierungsfehler:", imgErr.message || imgErr);
        return res.json({ reply: "Die Bild-Generierung auf dem ZeroGPU-Server ist fehlgeschlagen oder das Kontingent ist erschöpft. Versuche es bitte gleich noch einmal!" });
      }
    }
    // --- ALIBABA COGVIDEOX-FUN VIDEO-GENERIERUNG (Kostenloser Space-Hack) ---
const isVideoGeneration = msgLower.startsWith("/video") || msgLower.startsWith("animiere das bild");

if (isVideoGeneration) {
  // 1. Unterscheidung: Ist es Text-to-Video oder Image-to-Video?
  const isImageToVideo = msgLower.startsWith("animiere das bild");
  
  // Falls es eine Bildanimation ist, müsste hier die URL des zu animierenden Bildes dynamisch herkommen.
  let inputImageUrl = isImageToVideo ? "https://raw.githubusercontent.com/gradio-app/gradio/main/test/test_files/bus.png" : null; 
  
  let prompt = message.replace(/^\/video\s*/i, "").replace(/^animiere das bild\s*(mit\s*)?/i, "");
  if (!prompt.trim()) {
    prompt = "Make this image come alive with cinematic motion, smooth animation"; 
  }

  console.log("⚡ Stufe 1: Groq Compound wird für die Video-Übersetzung angefragt...");
  let finalEnglishPrompt = "";
  try {
    const translationRes = await groq.chat.completions.create({
      model: "groq/compound",
      messages: [
        { 
          role: "system", 
          content: "You are a translation assistant. Translate the user's input from German to English and add short cinematic motion keywords. Output ONLY the final English translation." 
        },
        { role: "user", content: prompt }
      ]
    });
    finalEnglishPrompt = translationRes.choices?.[0]?.message?.content?.trim() || prompt;
  } catch (transErr) {
    console.error("Translation failed, using fallback:", transErr);
    finalEnglishPrompt = prompt;
  }

  // 2. Verbindung zum neuen LTX-2-3 First-Last-Frame Space
  try {
    const spaceId = "linoyts/LTX-2-3-First-Last-Frame"; 
    console.log(`🎬 Verbinde mit ZeroGPU Space ${spaceId}...`);
    
    const hfToken = process.env.HF_TOKEN; 
    const client = await Client.connect(spaceId, hfToken ? { hf_token: hfToken } : {});

    // Optionale Bilder und Audio vorbereiten
    let firstImageBlob = null;
    let lastImageBlob = null;
    let dummyAudioBlob = null;

    // Nur wenn der Befehl "animiere das bild" war, laden wir das Bild als Blob herunter
    if (isImageToVideo && inputImageUrl) {
      console.log("🖼️ Lade Bild für Image-to-Video herunter...");
      const imageResponse = await fetch(inputImageUrl);
      const imgBlob = await imageResponse.blob();
      // Trick: Wir übergeben dasselbe Bild für Anfang und Ende, um einen sauberen Loop zu erzeugen
      firstImageBlob = imgBlob;
      lastImageBlob = imgBlob;
    }

    // Da Audio laut Doku 'Required' ist, holen wir uns ein stummes Standard-Audio-Sample als Dummy
    try {
      const audioResponse = await fetch("https://github.com/gradio-app/gradio/raw/main/test/test_files/audio_sample.wav");
      dummyAudioBlob = await audioResponse.blob();
    } catch (audErr) {
      console.error("Konnte Dummy-Audio nicht laden:", audErr);
    }

    console.log(`🚀 Sende Anfrage an ${spaceId}. Modus: ${isImageToVideo ? 'I2V-Loop' : 'Reines T2V'}`);
    
    // Aufruf exakt nach der API-Spezifikation des linoyst-Spaces
    const result = await client.predict("/generate_video", {
      first_image: firstImageBlob,   // Blob bei I2V, null bei reinem T2V
      last_image: lastImageBlob,     // Blob bei I2V, null bei reinem T2V
      input_audio: dummyAudioBlob,   // Dummy-Audio-Blob
      prompt: finalEnglishPrompt,
      duration: 3.0,                 // Standardmäßig 3 Sekunden für ZeroGPU Stabilität
      enhance_prompt: false,
      seed: 10,
      randomize_seed: true,
      height: 1024,                  // Auflösungen aus der Dokumentation
      width: 1536,
    });

    console.log("📦 LTX-2-3 API-Antwort empfangen:", JSON.stringify(result.data));

    // Video-URL extrahieren (Index [0] laut Doku)
    let videoUrl = "";
    if (result.data && result.data.length > 0) {
      const item = result.data[0];
      if (item && item.url) {
        videoUrl = item.url;
      } else if (typeof item === "string" && item.startsWith("http")) {
        videoUrl = item;
      }
    }
    
    if (!videoUrl) {
      throw new Error("Keine Video-URL in den empfangenen Daten gefunden.");
    }
    
    return res.json({ 
      reply: isImageToVideo ? `Hier ist dein animiertes Video als Loop! 🎬` : `Hier ist dein generiertes Video aus Text! 🎬`, 
      generatedVideo: videoUrl
    });

  } catch (videoErr) {
    console.error("❌ Video-Generierungsfehler:", videoErr.message || videoErr);
    return res.json({ reply: "Die Video-Generierung über LTX-2-3 ist fehlgeschlagen oder das Kontingent des Ziel-Spaces ist erschöpft." });
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
