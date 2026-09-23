// server.js — ücretsiz/açık kaynak sürüm
// Hive AI yerine, Hugging Face üzerindeki ücretsiz açık kaynak modelleri kullanır.
// Aylık sabit sunucu maliyeti dışında istek başına ödeme YOKTUR.
//
// Kullanılan modeller (topluluk tarafından eğitilmiş, ücretsiz):
//   Görüntü : prithivMLmods/Deep-Fake-Detector-v2-Model
//   Ses     : mo-thecreator/Deepfake-audio-detection
//   Video   : ffmpeg ile karelere + ses izine ayrılıp yukarıdaki iki model kullanılır.
//
// Gerekli: sunucuda ffmpeg kurulu olmalı (apt install ffmpeg / brew install ffmpeg)

const express = require("express");
const multer = require("multer");
const rateLimit = require("express-rate-limit");
const fetch = require("node-fetch");
const { execFile } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const util = require("util");

const execFileAsync = util.promisify(execFile);

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

// IP başına günlük limit — ücretsiz olduğun için bu ÇOK ÖNEMLİ,
// yoksa tek kişi sunucunu tıkayabilir.
const analyzeLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: 15,
  message: { error: "Günlük analiz limitine ulaştınız. Yarın tekrar deneyin." },
});

const HF_TOKEN = process.env.HF_TOKEN;
const IMAGE_MODEL = "prithivMLmods/Deepfake-Real-Class-Siglip2";
const AUDIO_MODEL = "mo-thecreator/Deepfake-audio-detection";
const HF_BASE = "https://router.huggingface.co/hf-inference/models/";

if (!HF_TOKEN) {
  console.warn("[UYARI] HF_TOKEN tanımlı değil. .env dosyasına HF_TOKEN=xxxx ekleyin.");
}

// --- Hugging Face Inference API'sine ham dosya (binary) gönderir ---
async function callHuggingFace(modelId, buffer, mimeType) {
  const res = await fetch(HF_BASE + modelId, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${HF_TOKEN}`,
      "Content-Type": mimeType,
    },
    body: buffer,
  });

  if (!res.ok) {
    const text = await res.text();
    // Model "soğuktan" ilk yüklenirken 503 dönebilir — birkaç saniye sonra tekrar dener.
    if (res.status === 503) {
      await new Promise((r) => setTimeout(r, 4000));
      return callHuggingFace(modelId, buffer, mimeType);
    }
    throw new Error(`Hugging Face hatası (${res.status}): ${text}`);
  }
  return res.json(); // örn: [{label:"Fake",score:0.9},{label:"Real",score:0.1}]
}

// --- [{label,score}] dizisinden "sahte olasılığı" (%0-100) çıkarır ---
function extractFakeProbability(predictions) {
  if (!Array.isArray(predictions)) return null;
  const fakeEntry = predictions.find((p) =>
    /fake|deepfake|spoof|synthetic|ai/i.test(p.label)
  );
  if (!fakeEntry) return null;
  return Math.round(fakeEntry.score * 100);
}

async function analyzeImageBuffer(buffer, mimeType) {
  const predictions = await callHuggingFace(IMAGE_MODEL, buffer, mimeType);
  return extractFakeProbability(predictions);
}

async function analyzeAudioBuffer(buffer, mimeType) {
  const predictions = await callHuggingFace(AUDIO_MODEL, buffer, mimeType);
  return extractFakeProbability(predictions);
}

// --- Videoyu ffmpeg ile N kareye ve bir ses dosyasına ayırır ---
async function extractFramesAndAudio(videoBuffer, workDir) {
  const videoPath = path.join(workDir, "input.mp4");
  fs.writeFileSync(videoPath, videoBuffer);

  // 5 kare, video boyunca eşit aralıklarla
  const framePattern = path.join(workDir, "frame_%02d.jpg");
  await execFileAsync("ffmpeg", [
    "-i", videoPath,
    "-vf", "fps=1/3", // her 3 saniyede bir kare (kısa videolarda birkaç kare alır)
    "-frames:v", "5",
    framePattern,
  ]);

  const audioPath = path.join(workDir, "audio.wav");
  let hasAudio = true;
  try {
    await execFileAsync("ffmpeg", [
      "-i", videoPath,
      "-vn", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1",
      audioPath,
    ]);
  } catch {
    hasAudio = false; // videoda ses izi yoksa
  }

  const frameFiles = fs
    .readdirSync(workDir)
    .filter((f) => f.startsWith("frame_"))
    .map((f) => path.join(workDir, f));

  return { frameFiles, audioPath: hasAudio ? audioPath : null };
}

async function analyzeVideoBuffer(buffer) {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "analyze-"));
  try {
    const { frameFiles, audioPath } = await extractFramesAndAudio(buffer, workDir);

    // Her kareyi görüntü modeline gönder, ortalamasını al
    const frameScores = [];
    for (const framePath of frameFiles) {
      const frameBuffer = fs.readFileSync(framePath);
      const score = await analyzeImageBuffer(frameBuffer, "image/jpeg");
      if (score !== null) frameScores.push(score);
    }
    const avgImageScore = frameScores.length
      ? Math.round(frameScores.reduce((a, b) => a + b, 0) / frameScores.length)
      : null;

    // Ses izi varsa ses modeline gönder
    let audioScore = null;
    if (audioPath) {
      const audioBuffer = fs.readFileSync(audioPath);
      audioScore = await analyzeAudioBuffer(audioBuffer, "audio/wav");
    }

    return { image_ai_probability: avgImageScore, audio_ai_probability: audioScore };
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true }); // geçici dosyaları temizle
  }
}

// --- Ana endpoint ---
app.post("/api/analyze", analyzeLimiter, upload.single("file"), async (req, res) => {
  try {
    let file = req.file;

    // Link verildiyse indir
    if (!file && req.body?.url) {
      const r = await fetch(req.body.url);
      if (!r.ok) throw new Error("Link indirilemedi: " + r.status);
      const buffer = Buffer.from(await r.arrayBuffer());
      const mimeType = r.headers.get("content-type") || "application/octet-stream";
      file = { buffer, mimetype: mimeType };
    }

    if (!file) {
      return res.status(400).json({ error: "Bir 'url' alanı ya da 'file' dosyası gerekli." });
    }

    let result;
    if (file.mimetype.startsWith("image/")) {
      const score = await analyzeImageBuffer(file.buffer, file.mimetype);
      result = { image_ai_probability: score, audio_ai_probability: null };
    } else if (file.mimetype.startsWith("audio/")) {
      const score = await analyzeAudioBuffer(file.buffer, file.mimetype);
      result = { image_ai_probability: null, audio_ai_probability: score };
    } else if (file.mimetype.startsWith("video/")) {
      result = await analyzeVideoBuffer(file.buffer);
    } else {
      return res.status(400).json({ error: "Desteklenmeyen dosya türü: " + file.mimetype });
    }

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Sunucu http://localhost:${PORT} adresinde çalışıyor`);
});
