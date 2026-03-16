import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import multer from "multer";
import fs from "fs";

const app = express();
app.use(cors());
app.use(express.json({ limit: "20mb" }));

const upload = multer({ dest: "uploads/" });

const API_KEY = process.env.MISTRAL_API_KEY;

/* --- normaler Chat: mistral-small --- */
app.post("/chat", async (req, res) => {
  const { message } = req.body;

  const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${API_KEY}`
    },
    body: JSON.stringify({
      model: "mistral-small-latest",
      messages: [
        { role: "user", content: message }
      ]
    })
  });

  const data = await response.json();
  res.json({ reply: data.choices[0].message.content });
});

/* --- Vision: Pixtral Vision --- */
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

/* --- Bildgenerierung: Pixtral Image --- */
app.post("/generate", async (req, res) => {
  const { prompt } = req.body;

  const response = await fetch("https://api.mistral.ai/v1/images/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${API_KEY}`
    },
    body: JSON.stringify({
      model: "pixtral-image-latest",
      prompt
    })
  });

  const data = await response.json();
  res.json({ url: data.data[0].url });
});

/* --- Render PORT FIX --- */
const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`EduAI Backend läuft auf Port ${PORT}`);
});
