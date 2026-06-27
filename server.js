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

function trimHistory(history) {
  if (!Array.isArray(history)) return [];
  return history.slice(-6);
}

async function runLLM(messages) {
  try {
    const res = await groq.chat.completions.create({
      model: "groq/compound",
      messages
    });
    return res.choices?.[0]?.message?.content;
  } catch (err) {
    console.error("Qwen Error → Fallback:", err.message);
  }
}

app.post("/chat", upload.single("image"), async (req, res) => {
  try {
    const { message, history } = req.body;

    let chatHistory = [];
    if (history) {
      try {
        chatHistory = trimHistory(JSON.parse(history));
      } catch {}
    }

    let imageContext = "";

   if (req.file) {
      const base64Image = fs.readFileSync(req.file.path).toString("base64");

      try {
        const visionRes = await groq.chat.completions.create({
          // Hinweis: Stelle sicher, dass dieses Modell auf Groq für Vision freigeschaltet ist (z.B. llama-3.2-11b-vision-preview)
          model: "meta-llama/llama-4-scout-17b-16e-instruct", 
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "Beschreibe dieses Bild präzise und strukturiert für eine Hausaufgabenhilfe."
                },
                {
                  type: "image_url",
                  image_url: {
                    url: `data:${req.file.mimetype};base64,${base64Image}`
                  }
                }
              ]
            }
          ]
        });

        imageContext = visionRes.choices?.[0]?.message?.content || "";
      } catch (err) {
        console.error("Vision Error:", err.message);
      }

      // Löscht das temporäre Bild wieder sauber vom Server
      fs.unlinkSync(req.file.path);
    }

    const messages = [
      {
        role: "system",
        content: "Du bist EduAI. Erkläre klar, strukturiert und hilfreich (mittlekurz)schreibe deutsch."
      },
      ...chatHistory,
      {
        role: "user",
        content: imageContext
          ? `Bildbeschreibung:\n${imageContext}\n\nFrage:\n${message}`
          : message
      }
    ];

    const reply = await runLLM(messages);

    return res.json({ reply });

  } catch (error) {
    console.error("Server Error:", error);
    return res.status(500).json({ reply: "Fehler im Backend." });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 EduAI läuft auf http://localhost:${PORT}`);
});
