import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import multer from "multer";
import fs from "fs";

const app = express();
app.use(cors());
app.use(express.json({ limit: "20mb" }));

const upload = multer({ dest: "uploads/" });

const API_KEY = "DEIN_MISTRAL_API_KEY";

/* TEXT CHAT */
app.post("/chat", async (req, res) => {
  const { message } = req.body;

  const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${API_KEY}`
    },
    body: JSON.stringify({
      model: "pixtral-large-latest",
      messages: [
        { role: "user", content: message }
      ]
    })
  });

  const data = await response.json();
  res.json({ reply: data.choices[0].message.content });
});

/* VISION */
app.post("/vision", upload.single("image"), async (req, res) => {
  const file = fs.readFileSync(req.file.path, { encoding: "base64" });

  const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${API_KEY}`
    },
    body: JSON.stringify({
      model: "pixtral-vision-latest",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Beschreibe dieses Bild." },
            { type: "image", image: file }
          ]
        }
      ]
    })
  });

  const data = await response.json();
  res.json({ reply: data.choices[0].message.content });
});

/* RAG HOOK (noch leer, aber vorbereitet) */
app.post("/rag", async (req, res) => {
  res.json({ status: "RAG endpoint ready" });
});

app.listen(3000, () => console.log("EduAI Server läuft auf Port 3000"));
