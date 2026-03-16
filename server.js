import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import multer from "multer";
import fs from "fs";

const app = express();
app.use(cors());
app.use(express.json({ limit: "20mb" }));

const upload = multer({ dest: "uploads/" });

const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;

/* -----------------------------------------
   Unified Chat + Vision (mistral-small-2506)
------------------------------------------ */
app.post("/chat", upload.single("image"), async (req, res) => {
  const { message } = req.body;

  // Basis: Text
  let content = [{ type: "text", text: message }];

  // Falls ein Bild hochgeladen wurde → hinzufügen
  if (req.file) {
    try {
      const file = fs.readFileSync(req.file.path, { encoding: "base64" });
      content.push({
        type: "image_base64",
        image_base64: file
      });
    } catch (err) {
      console.log("❌ Fehler beim Lesen des Bildes:", err);
    }
  }

  try {
    const r = await fetch("https://api.mistral.ai/v1/chat/completions", {
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
            content
          }
        ]
      })
    });

    const data = await r.json();

    if (r.ok && data?.choices?.[0]?.message?.content) {
      return res.json({ reply: data.choices[0].message.content });
    }

    console.log("❌ Mistral Fehler:", data);
    return res.status(500).json({ reply: "❌ Fehler bei Mistral." });

  } catch (err) {
    console.log("❌ Serverfehler:", err);
    return res.status(500).json({ reply: "❌ Serverfehler." });
  }
});

/* -----------------------------------------
   PORT (Render fix)
------------------------------------------ */
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`EduAI Backend läuft auf Port ${PORT}`);
});
