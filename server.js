import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "fs";
import Groq from "groq-sdk";

// Falls du .env Dateien nutzt, stelle sicher, dass sie geladen werden
// import 'dotenv/config'; 

const app = express();
const PORT = process.env.PORT || 3000;

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// CORS aktivieren, damit das Frontend zugreifen kann
app.use(cors({ origin: "*", methods: ["POST", "OPTIONS"] }));
app.use(express.json({ limit: "50mb" }));

// Multer für Dateiuploads (Bilder für Vision) konfigurieren
const upload = multer({
  dest: "uploads/",
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) return cb(null, false);
    cb(null, true);
  }
});

// Funktion zum Kürzen der Chat-Historie
function trimHistory(history) {
  if (!Array.isArray(history)) return [];
  return history.slice(-6);
}

// Funktion zum Ausführen des LLM für Textantworten
async function runLLM(messages) {
  try {
    const res = await groq.chat.completions.create({
      model: "groq/compound", // Passe das Modell ggf. an
      messages
    });
    return res.choices?.[0]?.message?.content;
  } catch (err) {
    console.error("LLM Error → Fallback:", err.message);
    return "Fehler bei der Textgenerierung.";
  }
}

// Der Haupt-Chat-Endpunkt
app.post("/chat", upload.single("image"), async (req, res) => {
  try {
    const { message, history } = req.body;

    // --- LOGIK FÜR BILDGENERIERUNG ---
    const msgLower = message ? message.toLowerCase() : "";
    const isImageGeneration = msgLower.startsWith("/image") || msgLower.startsWith("generiere ein bild");

    if (isImageGeneration) {
      // Prompt säubern (z.B. "/image eine Katze" -> "eine Katze")
      let prompt = message.replace(/^\/image\s*/i, "").replace(/^generiere ein bild\s*(von\s*)?/i, "");
      
      if (!prompt.trim()) {
        return res.json({ reply: "Bitte gib an, was ich zeichnen soll! (z.B. `/image eine Katze`)" });
      }

      console.log(`🎨 Generiere Bild für Prompt: ${prompt}`);

      try {
        // Aufruf der Hugging Face Inference API mit FLUX.1-schnell
        const hfResponse = await fetch(
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

        if (!hfResponse.ok) {
          throw new Error(`Hugging Face API Fehler: ${hfResponse.statusText}`);
        }

        // Das Bild als ArrayBuffer empfangen und in Base64 konvertieren
        const arrayBuffer = await hfResponse.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const base64Image = buffer.toString("base64");
        
        // Data-URL für das Frontend zusammenbauen
        const generatedImageUrl = `data:image/jpeg;base64,${base64Image}`;

        // Wir senden die Bild-URL mit einem speziellen Flag zurück
        return res.json({ 
          reply: `Hier ist dein generiertes Bild für: **${prompt}**`, 
          generatedImage: generatedImageUrl 
        });

      } catch (err) {
        console.error("Bildgenerierung Fehler:", err.message);
        return res.status(500).json({ reply: "Fehler bei der Bildgenerierung. Überprüfe den Hugging Face API-Key." });
      }
    }

    // --- LOGIK FÜR TEXT- UND VISION-CHATS (Unverändert) ---
    let chatHistory = [];
    if (history) {
      try {
        chatHistory = trimHistory(JSON.parse(history));
      } catch {}
    }

    let imageContext = "";

    // Wenn ein Bild hochgeladen wurde (Vision), analysieren wir es
    if (req.file) {
      console.log(`👁️ Analysiere hochgeladenes Bild...`);
      const base64Image = fs.readFileSync(req.file.path).toString("base64");

      try {
        const visionRes = await groq.chat.completions.create({
          model: "meta-llama/llama-4-scout-17b-16e-instruct", // Passe das Vision-Modell ggf. an
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "Beschreibe dieses Bild präzise und strukturiert für eine Hausaufgabenhilfe."
                },
                {
                  type: "image_url",
                  image_url: {
                    url: `data:${req.file.mimetype};base64,${base64Image}`
                  }
                }
              ]
            }
          ]
        });

        imageContext = visionRes.choices?.[0]?.message?.content || "";
      } catch (err) {
        console.error("Vision Error:", err.message);
      }

      // Löscht das temporäre Bild wieder sauber vom Server
      fs.unlinkSync(req.file.path);
    }

    // Zusammenbauen der Nachrichten für das LLM
    const messages = [
      {
        role: "system",
        content: "Du bist EduAI. Erkläre klar, strukturiert und hilfreich (mittlekurz)schreibe deutsch."
      },
      ...chatHistory,
      {
        role: "user",
        content: imageContext
          ? `Bildbeschreibung:\n${imageContext}\n\nFrage:\n${message}`
          : message
      }
    ];

    // Textantwort generieren
    const reply = await runLLM(messages);
    
    // Textantwort zur Historie hinzufügen (im Frontend wird das auch gemacht)
    // addToHistory("assistant", reply); // Das Backend speichert die Historie nicht, es sendet nur die Antwort

    return res.json({ reply });

  } catch (error) {
    console.error("Server Error:", error);
    return res.status(500).json({ reply: "Fehler im Backend." });
  }
});

// Server starten
app.listen(PORT, () => {
  console.log(`🚀 EduAI Backend läuft auf http://localhost:${PORT}`);
});
