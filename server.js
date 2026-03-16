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

// Multer für temporäre Speicherung
const upload = multer({ dest: "uploads/" });

/* ---------------------------------------------------------
   Hilfsfunktion: Bild zu Mistral hochladen (Files API)
--------------------------------------------------------- */
async function uploadToMistral(filePath) {
  const formData = new FormData();
  formData.append("file", fs.createReadStream(filePath));
  
  // Geändert von 'vision' auf 'ocr', da 'vision' laut Fehlermeldung nicht erlaubt ist
  formData.append("purpose", "ocr"); 

  const response = await fetch("https://api.mistral.ai/v1/files", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${MISTRAL_API_KEY}`,
      ...formData.getHeaders(),
    },
    body: formData,
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(`Mistral Upload Fehler: ${JSON.stringify(err)}`);
  }

  const data = await response.json();
  return data.id;
}

/* ---------------------------------------------------------
   Haupt-Endpoint
--------------------------------------------------------- */
app.post("/chat", upload.single("image"), async (req, res) => {
  const { message } = req.body;
  let fileId = null;

  if (!message) return res.status(400).json({ reply: "❌ Keine Nachricht erhalten." });

  try {
    // 1. Bild-Upload (falls vorhanden)
    if (req.file) {
      fileId = await uploadToMistral(req.file.path);
      fs.unlinkSync(req.file.path); // Lokale Kopie sofort löschen
    }

    // 2. Chat-Struktur vorbereiten
    const content = [{ type: "text", text: message }];
    
    if (fileId) {
      content.push({
        type: "image_url",
        image_url: `https://api.mistral.ai/v1/files/${fileId}/content`
      });
    }

    // 3. Anfrage an Mistral Small 2506
    const mistralResponse = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${MISTRAL_API_KEY}`
      },
      body: JSON.stringify({
        model: "mistral-small-2506",
        messages: [{ role: "user", content }],
        temperature: 0.2 // Für präzisere Analysen
      })
    });

    const result = await mistralResponse.json();

    if (mistralResponse.ok) {
      res.json({ reply: result.choices[0].message.content });
    } else {
      res.status(500).json({ reply: "❌ Mistral API Fehler", details: result });
    }

  } catch (error) {
    console.error("Fehler:", error);
    res.status(500).json({ reply: "❌ Interner Fehler", error: error.message });
    
    // Aufräumen falls nötig
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
  }
});

app.get("/", (req, res) => res.send("EduAI Online ✅"));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server läuft auf Port ${PORT}`);
});
