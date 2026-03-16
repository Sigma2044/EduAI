import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import multer from "multer";
import fs from "fs";
import FormData from "form-data";

const app = express();
const PORT = process.env.PORT || 3000;
const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;

app.use(cors());
app.use(express.json({ limit: "50mb" }));

// Multer für temporäre Dateien
const upload = multer({ dest: "uploads/" });

/* ---------------------------------------------------------
   Hilfsfunktion: Bild-Upload zu Mistral
--------------------------------------------------------- */
async function uploadToMistral(filePath) {
  const formData = new FormData();
  formData.append("file", fs.createReadStream(filePath));
  // "ocr" ist laut deiner Fehlermeldung der korrekte Zweck für Bildverarbeitung
  formData.append("purpose", "ocr"); 

  const response = await fetch("https://api.mistral.ai/v1/files", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${MISTRAL_API_KEY}`,
      ...formData.getHeaders(),
    },
    body: formData,
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`Mistral Upload Fehler: ${JSON.stringify(data)}`);
  }

  return data.id;
}

/* ---------------------------------------------------------
   Haupt-Endpoint: Chat
--------------------------------------------------------- */
app.post("/chat", upload.single("image"), async (req, res) => {
  const { message } = req.body;
  let fileId = null;

  if (!message) return res.status(400).json({ reply: "❌ Keine Nachricht erhalten." });

  try {
    // 1. Datei-Upload falls vorhanden
    if (req.file) {
      console.log("📸 Lade Bild hoch...");
      fileId = await uploadToMistral(req.file.path);
      console.log("✅ Bild hochgeladen, ID:", fileId);
      
      // Lokale Datei löschen
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    }

    // 2. Content-Array bauen
    const userContent = [{ type: "text", text: message }];
    
    if (fileId) {
      userContent.push({
        type: "image_url",
        image_url: {
          url: `https://api.mistral.ai/v1/files/${fileId}/content`
        }
      });
    }

    // 3. Request an Mistral
    console.log("🤖 Frage Mistral-Small an...");
    const mistralResponse = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${MISTRAL_API_KEY}`
      },
      body: JSON.stringify({
        model: "mistral-small-2506", // Oder "mistral-small-2506"
        messages: [
          {
            role: "user",
            content: userContent
          }
        ]
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
    res.status(500).json({ reply: "❌ Interner Server Fehler", error: error.message });
    
    // Cleanup im Fehlerfall
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
  }
});

app.get("/", (req, res) => res.send("EduAI Backend Online 🚀"));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server läuft auf Port ${PORT}`);
});
