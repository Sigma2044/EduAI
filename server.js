import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import multer from "multer";
import fs from "fs";
import path from "path";

const app = express();
app.use(cors());
app.use(express.json({ limit: "20mb" }));

// Upload-Ordner
const upload = multer({ dest: "uploads/" });

// Static Serving für Bilder
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;

/* -----------------------------------------
   Unified Chat + Vision (mistral-small-2506)
------------------------------------------ */
app.post("/chat", upload.single("image"), async (req, res) => {
  const { message } = req.body;

  if (!message || typeof message !== "string") {
    return res.status(400).json({ reply: "❌ message fehlt oder ist ungültig." });
  }

  // Basis: Text
  const content = [{ type: "text", text: message }];

  // Falls ein Bild hochgeladen wurde → als URL einbinden
  if (req.file) {
    try {
      const imageUrl = `${req.protocol}://${req.get("host")}/uploads/${req.file.filename}`;
      content.push({
        type: "image_url",
        image_url: imageUrl
      });
    } catch (err) {
      console.log("❌ Fehler beim Verarbeiten des Bildes:", err);
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
    return res.status(500).json({ reply: "❌ Fehler bei Mistral.", details: data });

  } catch (err) {
    console.log("❌ Serverfehler:", err);
    return res.status(500).json({ reply: "❌ Serverfehler.", details: String(err) });
  }
});

/* -----------------------------------------
   Healthcheck (optional, nice für Render)
------------------------------------------ */
app.get("/", (req, res) => {
  res.send("EduAI Backend läuft ✅");
});

/* -----------------------------------------
   PORT (Render)
------------------------------------------ */
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`EduAI Backend läuft auf Port ${PORT}`);
});
