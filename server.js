import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import multer from "multer";
import fs from "fs";

const app = express();
const PORT = process.env.PORT || 3000;
const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;

app.use(cors());
app.use(express.json({ limit: "50mb" }));

// Multer Setup (Speichert Bilder nur kurz im RAM/Temp)
const upload = multer({ dest: "uploads/" });

app.post("/chat", upload.single("image"), async (req, res) => {
  const { message } = req.body;

  if (!message) return res.status(400).json({ reply: "❌ Keine Nachricht erhalten." });

  try {
    const userContent = [{ type: "text", text: message }];

    // Falls ein Bild da ist: In Base64 umwandeln und direkt einbetten
    if (req.file) {
      console.log("📸 Verarbeite Bild für Mistral...");
      const imageBuffer = fs.readFileSync(req.file.path);
      const base64Image = imageBuffer.toString("base64");
      
      // Das Präfix MUSS exakt stimmen: data:image/jpeg;base64,...
      userContent.push({
        type: "image_url",
        image_url: {
          url: `data:${req.file.mimetype};base64,${base64Image}`
        }
      });

      // Datei sofort vom Server löschen
      fs.unlinkSync(req.file.path);
    }

    // Ändere nur diesen Teil in deiner server.js:
    console.log("🤖 Sende Request an pixtral-12b-2409...");
    const mistralResponse = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${MISTRAL_API_KEY}`
      },
      body: JSON.stringify({
        model: "pixtral-12b-2409", // Nutze das spezifische Vision-Modell aus deiner Liste
        messages: [{ role: "user", content: userContent }],
        max_tokens: 300, // Weniger Tokens verbrauchen = seltener Rate Limit
        temperature: 0.7
      })
    });

    const result = await mistralResponse.json();

    if (mistralResponse.ok) {
      console.log("✅ Antwort erhalten!");
      res.json({ reply: result.choices[0].message.content });
    } else {
      console.error("❌ Mistral API Fehler:", result);
      res.status(mistralResponse.status).json({ 
        reply: "❌ Mistral API Fehler", 
        details: result 
      });
    }

  } catch (error) {
    console.error("❌ Server Fehler:", error.message);
    res.status(500).json({ reply: "❌ Interner Fehler", error: error.message });
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
  }
});

app.get("/", (req, res) => res.send("EduAI Backend Online ✅"));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server läuft auf Port ${PORT}`);
});
