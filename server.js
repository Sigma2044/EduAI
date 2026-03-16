import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import multer from "multer";
import fs from "fs";
import path from "path";
import FormData from "form-data";

const app = express();
const PORT = process.env.PORT || 3000;
const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;

// Middleware
app.use(cors());
app.use(express.json({ limit: "50mb" }));

// Multer Setup
const upload = multer({ dest: "uploads/" });

/* ---------------------------------------------------------
   Hilfsfunktion: Bild-Upload zu Mistral
--------------------------------------------------------- */
async function uploadToMistral(filePath) {
  const formData = new FormData();
  formData.append("file", fs.createReadStream(filePath));
  // "ocr" ist notwendig für Bild-Inputs bei vielen Mistral-Keys
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
   Haupt-Endpoint
--------------------------------------------------------- */
app.post("/chat", upload.single("image"), async (req, res) => {
  const { message } = req.body;
  let fileId = null;

  if (!message) {
    return res.status(400).json({ reply: "❌ Keine Nachricht erhalten." });
  }

  try {
    // 1. Bild hochladen, falls vorhanden
    if (req.file) {
      console.log("📸 Bild wird zu Mistral hochgeladen...");
      fileId = await uploadToMistral(req.file.path);
      console.log("✅ Erfolgreich hochgeladen. ID:", fileId);
      
      // Lokal löschen
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    }

    // 2. Nachrichten-Array bauen
    const userContent = [{ type: "text", text: message }];
    
    if (fileId) {
      userContent.push({
        type: "image_url",
        image_url: {
          url: `https://api.mistral.ai/v1/files/${fileId}/content`
        }
      });
    }

    // 3. Warten (Wichtig gegen Fehler 3310 - File not fetched)
    if (fileId) {
      console.log("⏳ Warte kurz auf Datei-Indizierung...");
      await new Promise(resolve => setTimeout(resolve, 1500));
    }

    // 4. Mistral Chat Call
    console.log("🤖 Anfrage an mistral-small-2506...");
    const mistralResponse = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${MISTRAL_API_KEY}`
      },
      body: JSON.stringify({
        model: "mistral-small-2506",
        messages: [
          {
            role: "user",
            content: userContent
          }
        ],
        temperature: 0.1
      })
    });

    const result = await mistralResponse.json();

    if (mistralResponse.ok) {
      console.log("✅ Antwort von Mistral erhalten.");
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
    res.status(500).json({ 
      reply: "❌ Interner Server Fehler", 
      error: error.message 
    });

    // Sicherheitshalber lokale Datei löschen
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
  }
});

// Start
app.get("/", (req, res) => res.send("EduAI Backend Online ✅"));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Backend läuft auf Port ${PORT}`);
});
   
