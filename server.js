import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import multer from "multer";
import fs from "fs";
import Groq from "groq-sdk";

const app = express();
const PORT = process.env.PORT || 3000;

// HIER DEINE KEYS EINTRAGEN ODER ÜBER UMGEBUNGSVARIABLEN NUTZEN
const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY || "DEIN_MISTRAL_KEY";
const GROQ_API_KEY = process.env.GROQ_API_KEY || "DEIN_GROQ_KEY";

const groq = new Groq({ apiKey: GROQ_API_KEY });

app.use(cors());
app.use(express.json({ limit: "50mb" }));

// Multer Setup für Bilder
const upload = multer({ dest: "uploads/" });

app.post("/chat", upload.single("image"), async (req, res) => {
  const { message } = req.body;

  try {
    let imageContext = "";

    // 1. SCHRITT: BILD-ANALYSE MIT GROQ (Llama 4 Scout)
    if (req.file) {
      console.log("📸 Llama 4 Scout (Groq) analysiert das Bild...");
      const base64Image = fs.readFileSync(req.file.path).toString("base64");
      
      try {
        const visionCompletion = await groq.chat.completions.create({
          model: "meta-llama/llama-4-scout-17b-16e-instruct",
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: "Beschreibe dieses Bild sehr genau, damit ich diese Infos einer anderen KI geben kann. Erfasse Texte, Objekte und Zusammenhänge." },
                { 
                  type: "image_url", 
                  image_url: { url: `data:${req.file.mimetype};base64,${base64Image}` } 
                }
              ]
            }
          ]
        });
        imageContext = visionCompletion.choices[0].message.content;
      } catch (err) {
        console.error("❌ Groq Vision Fehler:", err.message);
      }
      
      // Datei löschen
      fs.unlinkSync(req.file.path);
    }

    // 2. SCHRITT: ANTWORT ERSTELLEN MIT MISTRAL SMALL
    console.log("🤖 Mistral Small erstellt finale Antwort...");
    
    // Wir bauen den Prompt so, dass Mistral vom Bild "weiß"
    const systemPrompt = imageContext 
      ? `Du bist ein hilfreicher Assistent. Dem User liegt ein Bild vor, das du nicht direkt sehen kannst, aber hier ist eine exakte Beschreibung davon: "${imageContext}". Nutze diese Info, um die Frage des Users zu beantworten.`
      : "Du bist ein hilfreicher Assistent.";

    const mistralResponse = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${MISTRAL_API_KEY}`
      },
      body: JSON.stringify({
        model: "mistral-small-latest",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: message }
        ]
      })
    });

    const result = await mistralResponse.json();

    if (mistralResponse.ok) {
      res.json({ reply: result.choices[0].message.content });
    } else {
      console.error("❌ Mistral Fehler:", result);
      res.status(500).json({ reply: "Mistral hat ein Problem.", details: result });
    }

  } catch (error) {
    console.error("❌ Allgemeiner Fehler:", error);
    res.status(500).json({ reply: "Server-Fehler im Hybrid-Mode." });
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
  }
});

app.get("/", (req, res) => res.send("EduAI Hybrid Backend Online 🚀"));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server läuft auf Port ${PORT}`);
});
