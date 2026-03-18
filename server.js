// backend.js
import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "fs";
import Groq from "groq-sdk";

const app = express();
const PORT = process.env.PORT || 3000;

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

app.use(cors({ origin: "*", methods: ["POST", "OPTIONS"] }));
app.use(express.json({ limit: "50mb" }));

const upload = multer({
  dest: "uploads/",
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) return cb(null, false);
    cb(null, true);
  }
});

app.post("/chat", upload.single("image"), async (req, res) => {
  try {
    const { message, history } = req.body;

    let chatHistory = [];
    if (history) {
      try {
        chatHistory = JSON.parse(history);
      } catch {}
    }

    let imageContext = "";

    // ⭐ AUTOMATISCHE VISION-ERKENNUNG
    if (req.file) {
      const base64Image = fs.readFileSync(req.file.path).toString("base64");

      try {
        const visionRes = await groq.chat.completions.create({
          model: "meta-llama/llama-4-scout-17b-16e-instruct",
          messages: [
            {
              role: "user",
              content: [
                "Beschreibe dieses Bild präzise und strukturiert wenn schrift zu sehen ist lese sie :",
                `data:${req.file.mimetype};base64,${base64Image}`
              ]
            }
          ]
        });

        imageContext = visionRes.choices?.[0]?.message?.content || "";
      } catch (err) {
        console.error("Vision Error:", err.message);
      }

      fs.unlinkSync(req.file.path);
    }

    // ⭐ AUTOMATISCHES TEXTMODELL (405B)
    const messages = [
      {
        role: "system",
        content: "Du bist EduAI. Erkläre klar, strukturiert und hilfreichaber nicht zu lange (mittelkurz."
      },
      ...chatHistory,
      {
        role: "user",
        content: imageContext
          ? `Bildbeschreibung:\n${imageContext}\n\nFrage:\n${message}`
          : message
      }
    ];

    const completion = await groq.chat.completions.create({
      model: "openai/gpt-oss-120b",
      messages
    });

    const reply = completion.choices?.[0]?.message?.content || "Keine Antwort.";
    return res.json({ reply });

  } catch (error) {
    console.error("Server Error:", error);
    return res.status(500).json({ reply: "Fehler im Backend." });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 EduAI läuft auf http://localhost:${PORT}`);
});
