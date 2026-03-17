import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import multer from "multer";
import fs from "fs";
import Groq from "groq-sdk";

const app = express();
const PORT = process.env.PORT || 3000;

const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY || "DEIN_MISTRAL_KEY";
const GROQ_API_KEY = process.env.GROQ_API_KEY || "DEIN_GROQ_KEY";

const groq = new Groq({ apiKey: GROQ_API_KEY });

app.use(cors());
app.use(express.json({ limit: "50mb" }));

const upload = multer({ dest: "uploads/" });

app.post("/chat", upload.single("image"), async (req, res) => {
  // Wir erwarten jetzt auch "history" vom Frontend
  const { message, history } = req.body; 
  
  // Falls history nicht mitgeschickt wurde, starten wir mit einem leeren Array
  let chatHistory = history ? JSON.parse(history) : [];

  try {
    let imageContext = "";

    if (req.file) {
      console.log("📸 Bild-Analyse läuft...");
      const base64Image = fs.readFileSync(req.file.path).toString("base64");
      
      try {
        const visionCompletion = await groq.chat.completions.create({
          model: "meta-llama/llama-4-scout-17b-16e-instruct",
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: "Beschreibe dieses Bild kurz und präzise für den Kontext." },
                { type: "image_url", image_url: { url: `data:${req.file.mimetype};base64,${base64Image}` } }
              ]
            }
          ]
        });
        imageContext = visionCompletion.choices[0].message.content;
      } catch (err) {
        console.error("Groq Vision Fehler:", err.message);
      }
      fs.unlinkSync(req.file.path);
    }

    // 2. Mistral Chat-Logik mit Gedächtnis
    console.log("🤖 Mistral denkt nach...");

    // Wenn ein Bild da ist, fügen wir die Info als versteckten Hinweis ein
    if (imageContext) {
      chatHistory.push({ 
        role: "system", 
        content: `KONTEXT: Der User hat ein Bild hochgeladen. Beschreibung: ${imageContext}` 
      });
    }

    // Die aktuelle Nachricht des Users zur History hinzufügen
    chatHistory.push({ role: "user", content: message });

    const mistralResponse = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${MISTRAL_API_KEY}`
      },
      body: JSON.stringify({
        model: "mistral-small-latest",
        messages: [
          { role: "system", content: "Du bist ein hilfreicher Lern-Assistent namens EduAI.Bei einfachen Fragen antworte nicht zu lange bei komplexen fragen ausführlicher " },
          ...chatHistory // Hier wird der gesamte bisherige Chat mitgeschickt!
        ]
      })
    });

    const result = await mistralResponse.json();

    if (mistralResponse.ok) {
      const aiReply = result.choices[0].message.content;
      
      // Wir schicken die Antwort zurück
      res.json({ reply: aiReply });
    } else {
      res.status(500).json({ reply: "Mistral Fehler", details: result });
    }

  } catch (error) {
    console.error("Server Fehler:", error);
    res.status(500).json({ reply: "Interner Server Fehler" });
  }
});

app.listen(PORT, "0.0.0.0", () => console.log(`🚀 Server auf Port ${PORT}`));
