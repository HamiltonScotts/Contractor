const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { PDFDocument, rgb } = require("pdf-lib");
const fontkit = require("@pdf-lib/fontkit");

const app = express();
const port = process.env.PORT || 3000;
const host = process.env.HOST || "0.0.0.0";
const uploadDir = resolveUploadDir();
const spreadsheetWebhookUrl = process.env.SPREADSHEET_WEBHOOK_URL || "";
const fontCandidates = [
  process.env.PDF_FONT_PATH,
  path.join(__dirname, "fonts", "NotoSansJP-Regular.ttf"),
  "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
  "/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc",
  "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
  "/usr/share/fonts/truetype/noto/NotoSansJP-Regular.otf",
  "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
  "/System/Library/Fonts/Hiragino Sans GB.ttc",
].filter(Boolean);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const safeName = `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    cb(null, safeName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
});

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(uploadDir));

app.get("/healthz", (_req, res) => {
  res.status(200).json({
    ok: true,
    uploadDir,
    spreadsheetWebhookConfigured: Boolean(spreadsheetWebhookUrl),
  });
});

app.get("/api/config", (_req, res) => {
  res.json({
    spreadsheetWebhookConfigured: Boolean(spreadsheetWebhookUrl),
  });
});

app.post("/api/seal", upload.single("sealImage"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "印影画像を選択してください。" });
  }

  res.json({
    fileName: req.file.filename,
    originalName: req.file.originalname,
    url: `/uploads/${req.file.filename}`,
  });
});

app.post("/api/orders", express.json({ limit: "1mb" }), async (req, res) => {
  try {
    const payload = sanitizePayload(req.body || {});
    const pdfBytes = await createOrderPdf(payload);
    const pdfFileName = `purchase-order-${Date.now()}.pdf`;
    const pdfPath = path.join(uploadDir, pdfFileName);

    fs.writeFileSync(pdfPath, pdfBytes);

    const spreadsheetResult = await appendToSpreadsheet(payload);

    res.json({
      message: "発注書を作成しました。",
      pdfUrl: `/uploads/${pdfFileName}`,
      spreadsheet: spreadsheetResult,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "書類作成に失敗しました。",
      details: error.message,
    });
  }
});

function sanitizePayload(body) {
  const amount = Number(body.amount || 0);

  return {
    orderTitle: String(body.orderTitle || "").trim(),
    issueDate: String(body.issueDate || "").trim(),
    dueDate: String(body.dueDate || "").trim(),
    clientName: String(body.clientName || "").trim(),
    clientAddress: String(body.clientAddress || "").trim(),
    clientContact: String(body.clientContact || "").trim(),
    yourCompanyName: String(body.yourCompanyName || "").trim(),
    yourCompanyAddress: String(body.yourCompanyAddress || "").trim(),
    yourCompanyContact: String(body.yourCompanyContact || "").trim(),
    amount,
    taxRate: Number(body.taxRate || 10),
    itemDescription: String(body.itemDescription || "").trim(),
    notes: String(body.notes || "").trim(),
    sealImagePath: body.sealImagePath ? path.join(uploadDir, path.basename(String(body.sealImagePath))) : "",
  };
}

function resolveUploadDir() {
  const candidates = [
    path.join(__dirname, "uploads"),
    path.join("/tmp", "gemini_test_uploads"),
  ];

  for (const candidate of candidates) {
    try {
      fs.mkdirSync(candidate, { recursive: true });
      return candidate;
    } catch (error) {
      if (error.code !== "ENOSPC") {
        throw error;
      }
    }
  }

  throw new Error("保存先ディレクトリを作成できませんでした。空き容量を確認してください。");
}

async function createOrderPdf(data) {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);
  const page = pdfDoc.addPage([595.28, 841.89]);
  const { width, height } = page.getSize();
  const margin = 48;
  const font = await loadJapaneseFont(pdfDoc);
  const fontBold = font;

  page.drawRectangle({
    x: 0,
    y: height - 120,
    width,
    height: 120,
    color: rgb(0.08, 0.18, 0.32),
  });

  page.drawText("発注書", {
    x: margin,
    y: height - 72,
    size: 28,
    font: fontBold,
    color: rgb(1, 1, 1),
  });

  page.drawText(data.orderTitle || "業務委託 / 制作発注", {
    x: margin,
    y: height - 102,
    size: 12,
    font,
    color: rgb(0.9, 0.94, 1),
  });

  drawLabelValue(page, font, "発行日", data.issueDate || "-", margin, height - 165);
  drawLabelValue(page, font, "納期", data.dueDate || "-", 300, height - 165);

  page.drawText("宛先", {
    x: margin,
    y: height - 220,
    size: 11,
    font,
    color: rgb(0.35, 0.38, 0.42),
  });
  page.drawText(data.clientName || "-", {
    x: margin,
    y: height - 245,
    size: 18,
    font: fontBold,
    color: rgb(0.1, 0.12, 0.15),
  });
  drawMultilineText(page, font, data.clientAddress || "", margin, height - 270, 11, 16, 240);
  drawMultilineText(page, font, data.clientContact || "", margin, height - 320, 11, 16, 240);

  page.drawText("発注元", {
    x: 330,
    y: height - 220,
    size: 11,
    font,
    color: rgb(0.35, 0.38, 0.42),
  });
  page.drawText(data.yourCompanyName || "-", {
    x: 330,
    y: height - 245,
    size: 16,
    font: fontBold,
    color: rgb(0.1, 0.12, 0.15),
  });
  drawMultilineText(page, font, data.yourCompanyAddress || "", 330, height - 270, 11, 16, 210);
  drawMultilineText(page, font, data.yourCompanyContact || "", 330, height - 320, 11, 16, 210);

  page.drawRectangle({
    x: margin,
    y: height - 420,
    width: width - margin * 2,
    height: 90,
    color: rgb(0.96, 0.97, 0.99),
    borderColor: rgb(0.8, 0.84, 0.9),
    borderWidth: 1,
  });

  page.drawText("発注金額", {
    x: margin + 20,
    y: height - 360,
    size: 12,
    font,
    color: rgb(0.35, 0.38, 0.42),
  });
  page.drawText(formatCurrency(data.amount), {
    x: margin + 20,
    y: height - 392,
    size: 26,
    font: fontBold,
    color: rgb(0.08, 0.18, 0.32),
  });

  page.drawText(`消費税率: ${data.taxRate}%`, {
    x: 360,
    y: height - 360,
    size: 11,
    font,
    color: rgb(0.35, 0.38, 0.42),
  });

  page.drawRectangle({
    x: margin,
    y: height - 610,
    width: width - margin * 2,
    height: 150,
    color: rgb(1, 1, 1),
    borderColor: rgb(0.8, 0.84, 0.9),
    borderWidth: 1,
  });

  page.drawText("発注内容", {
    x: margin + 16,
    y: height - 485,
    size: 12,
    font,
    color: rgb(0.1, 0.12, 0.15),
  });
  drawMultilineText(page, font, data.itemDescription || "-", margin + 16, height - 510, 11, 18, width - margin * 2 - 32);

  page.drawRectangle({
    x: margin,
    y: height - 770,
    width: width - margin * 2,
    height: 120,
    color: rgb(1, 1, 1),
    borderColor: rgb(0.8, 0.84, 0.9),
    borderWidth: 1,
  });
  page.drawText("備考", {
    x: margin + 16,
    y: height - 675,
    size: 12,
    font,
    color: rgb(0.1, 0.12, 0.15),
  });
  drawMultilineText(page, font, data.notes || "-", margin + 16, height - 700, 11, 18, width - margin * 2 - 32);

  if (data.sealImagePath && fs.existsSync(data.sealImagePath)) {
    const imageBytes = fs.readFileSync(data.sealImagePath);
    const extension = path.extname(data.sealImagePath).toLowerCase();
    const sealImage = extension === ".png"
      ? await pdfDoc.embedPng(imageBytes)
      : await pdfDoc.embedJpg(imageBytes);
    const imageDims = sealImage.scale(0.22);

    page.drawImage(sealImage, {
      x: width - margin - imageDims.width - 10,
      y: height - 315,
      width: imageDims.width,
      height: imageDims.height,
      opacity: 0.82,
    });
  }

  return pdfDoc.save();
}

async function loadJapaneseFont(pdfDoc) {
  const fontPath = fontCandidates.find((candidate) => fs.existsSync(candidate));
  if (!fontPath) {
    throw new Error("日本語フォントが見つかりませんでした。");
  }

  const fontBytes = fs.readFileSync(fontPath);
  return pdfDoc.embedFont(fontBytes, { subset: true });
}

function drawLabelValue(page, font, label, value, x, y) {
  page.drawText(label, {
    x,
    y,
    size: 11,
    font,
    color: rgb(0.35, 0.38, 0.42),
  });
  page.drawText(value, {
    x,
    y: y - 20,
    size: 14,
    font,
    color: rgb(0.1, 0.12, 0.15),
  });
}

function drawMultilineText(page, font, text, x, y, size, lineHeight, maxWidth) {
  const lines = wrapText(text || "-", 24);
  lines.forEach((line, index) => {
    page.drawText(line, {
      x,
      y: y - lineHeight * index,
      size,
      font,
      maxWidth,
      color: rgb(0.1, 0.12, 0.15),
    });
  });
}

function wrapText(text, maxChars) {
  const normalized = String(text || "").replace(/\r\n/g, "\n");
  const rawLines = normalized.split("\n");
  const output = [];

  for (const rawLine of rawLines) {
    if (!rawLine) {
      output.push("");
      continue;
    }

    for (let i = 0; i < rawLine.length; i += maxChars) {
      output.push(rawLine.slice(i, i + maxChars));
    }
  }

  return output.length ? output : ["-"];
}

function formatCurrency(amount) {
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(amount) ? amount : 0);
}

async function appendToSpreadsheet(data) {
  if (!spreadsheetWebhookUrl) {
    return {
      status: "skipped",
      message: "Webhook URL未設定のため、スプレッドシート追記はスキップしました。",
    };
  }

  const response = await fetch(spreadsheetWebhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      issueDate: data.issueDate,
      dueDate: data.dueDate,
      orderTitle: data.orderTitle,
      clientName: data.clientName,
      amount: data.amount,
      taxRate: data.taxRate,
      itemDescription: data.itemDescription,
      notes: data.notes,
    }),
  });

  if (!response.ok) {
    throw new Error(`スプレッドシート連携に失敗しました: ${response.status}`);
  }

  return {
    status: "ok",
    message: "スプレッドシートへ追記しました。",
  };
}

if (require.main === module) {
  app.listen(port, host, () => {
    console.log(`Server started on http://${host}:${port}`);
  });
}

module.exports = {
  app,
  createOrderPdf,
  sanitizePayload,
  resolveUploadDir,
};
