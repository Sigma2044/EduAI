// backend.js
import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "fs";
import Groq from "groq-sdk";

const app = express();
const PORT = process.env.PORT || 3000;

const GROQ_API_KEY = process.env.GROQ_API_KEY;
if (!GROQ_API_KEY) {
  console.error("❌ GROQ_API_KEY fehlt in den Umgebungsvariablen.");
  process.exit(1);
}

const groq = new Groq({ apiKey: GROQ_API_KEY });

app.use(cors({
  origin: "*",
  methods: ["POST", "OPTIONS"]
}));

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

    if (!message || typeof message !== "string") {
      return res.status(400).json({ reply: "❌ 'message' fehlt oder ist ungültig." });
    }

    let chatHistory = [];
    if (history) {
      try {
        const parsed = JSON.parse(history);
        if (Array.isArray(parsed)) chatHistory = parsed;
      } catch {
        chatHistory = [];
      }
    }

    let imageContext = "";

    if (req.file) {
      console.log("📸 Vision-Analyse startet...");
      const base64Image = fs.readFileSync(req.file.path).toString("base64");

      try {
        const visionRes = await groq.chat.completions.create({
          model: "meta-llama/llama-4-scout-17b-16e-instruct",
          messages: [
            {
              role: "user",
              content: [
                "Beschreibe dieses Bild präzise und strukturiert für eine andere KI wenn schrift zu erkennen ist lese sie :",
                `data:${req.file.mimetype};base64,${base64Image}`
              ]
            }
          ]
        });

        imageContext = visionRes.choices?.[0]?.message?.content || "";
      } catch (err) {
        console.error("Vision Error:", err?.message || err);
      } finally {
        try {
          fs.unlinkSync(req.file.path);
        } catch (e) {
          console.error("Fehler beim Löschen der Datei:", e?.message || e);
        }
      }
    }

    const messages = [
      {
        role: "system",
        content:
          "Du bist EduAI, ein hilfreicher Lernassistent. Erkläre klar, strukturiert und verständlich. Nutze Markdown, wenn sinnvoll."
      },
      ...chatHistory,
      {
        role: "user",
        content: imageContext
          ? `Bild-Analyse:\n${imageContext}\n\nFrage des Nutzers:\n${message}`
          : message
      }
    ];

    const completion = await groq.chat.completions.create({
      model: "openai/gpt-oss-120b",
      messages
    });

    const reply = completion.choices?.[0]?.message?.content || "Keine Antwort vom Modell.";
    return res.json({ reply });
  } catch (error) {
    console.error("Server Error:", error);
    return res.status(500).json({ reply: "Fehler im Backend." });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 EduAI (Groq-only) läuft auf http://localhost:${PORT}`);
});
