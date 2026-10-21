const express = require("express");
const crypto = require("crypto");
const { requireAuth } = require("./auth");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { PDFDocument, rgb } = require("pdf-lib");
const fontkit = require("@pdf-lib/fontkit");
const XLSX = require("xlsx");

const app = express();
const port = process.env.PORT || 3000;
const host = process.env.HOST || "0.0.0.0";
const uploadDir = resolveWritableDir("uploads");
const dataDir = resolveWritableDir("data");
const orderStorePath = path.join(dataDir, "orders.json");
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

ensureStoreFile();

// Keep uploads in memory until the signature has been verified; never serve attacker-supplied filenames.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// Only the platform health probe is public; it must not disclose filesystem paths or business data.
app.get("/healthz", (_req, res) => res.status(200).json({ ok: true }));
app.use(requireAuth);

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(uploadDir));

app.get("/api/config", (_req, res) => {
  res.json({
    accountingEnabled: true,
    excelExportEnabled: true,
    totalOrders: readOrders().length,
  });
});

app.post("/api/seal", upload.single("sealImage"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "印影画像を選択してください。" });

  // File extension and Content-Type are untrusted. Accept only actual PNG/JPEG bytes.
  const bytes = req.file.buffer;
  const isPng = bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const isJpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (!isPng && !isJpeg) return res.status(415).json({ error: "PNGまたはJPEG画像を選択してください。" });

  const fileName = `seal-${crypto.randomUUID()}.${isPng ? "png" : "jpg"}`;
  fs.writeFileSync(path.join(uploadDir, fileName), bytes, { flag: "wx" });
  res.json({
    fileName,
    originalName: req.file.originalname,
    url: `/uploads/${fileName}`,
  });
});

app.post("/api/orders", async (req, res) => {
  try {
    const payload = sanitizePayload(req.body || {});
    validateOrderPayload(payload);

    const pdfBytes = await createOrderPdf(payload);
    const timestamp = Date.now();
    const pdfFileName = `purchase-order-${timestamp}.pdf`;
    const pdfPath = path.join(uploadDir, pdfFileName);
    fs.writeFileSync(pdfPath, pdfBytes);

    const orderRecord = {
      id: `ord_${timestamp}`,
      createdAt: new Date().toISOString(),
      ...payload,
      pdfFileName,
      pdfUrl: `/uploads/${pdfFileName}`,
      sealImageUrl: payload.sealImageFileName ? `/uploads/${payload.sealImageFileName}` : "",
    };

    const orders = readOrders();
    orders.unshift(orderRecord);
    writeOrders(orders);

    res.json({
      message: "発注書を作成しました。",
      pdfUrl: orderRecord.pdfUrl,
      order: summarizeOrder(orderRecord),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "書類作成に失敗しました。",
      details: error.message,
    });
  }
});

app.get("/api/orders", (req, res) => {
  const { from = "", to = "" } = req.query;
  const orders = filterOrdersByPeriod(readOrders(), String(from), String(to));

  res.json({
    summary: buildSummary(orders),
    orders: orders.map(summarizeOrder),
  });
});

app.get("/api/orders/export", (req, res) => {
  const { from = "", to = "" } = req.query;
  const orders = filterOrdersByPeriod(readOrders(), String(from), String(to));
  const workbook = XLSX.utils.book_new();
  const rows = orders.map((order) => ({
    発行日: order.issueDate,
    納期: order.dueDate,
    案件名: order.orderTitle,
    宛先: order.clientName,
    発注元: order.yourCompanyName,
    金額: order.amount,
    消費税率: order.taxRate,
    発注内容: order.itemDescription,
    備考: order.notes,
    PDF_URL: order.pdfUrl,
    作成日時: order.createdAt,
  }));

  const worksheet = XLSX.utils.json_to_sheet(rows.length ? rows : [{
    発行日: "",
    納期: "",
    案件名: "該当データなし",
    宛先: "",
    発注元: "",
    金額: "",
    消費税率: "",
    発注内容: "",
    備考: "",
    PDF_URL: "",
    作成日時: "",
  }]);

  worksheet["!cols"] = [
    { wch: 12 }, { wch: 12 }, { wch: 24 }, { wch: 22 }, { wch: 22 },
    { wch: 12 }, { wch: 10 }, { wch: 36 }, { wch: 28 }, { wch: 42 }, { wch: 22 },
  ];

  XLSX.utils.book_append_sheet(workbook, worksheet, "Orders");
  const fileName = `orders-${from || "all"}-${to || "latest"}.xlsx`;
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
  res.send(buffer);
});

function sanitizePayload(body) {
  const amount = Number(body.amount || 0);
  const taxRate = Number(body.taxRate || 10);
  const sealImageFileName = body.sealImagePath ? path.basename(String(body.sealImagePath)) : "";

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
    amount: Number.isFinite(amount) ? amount : 0,
    taxRate: Number.isFinite(taxRate) ? taxRate : 10,
    itemDescription: String(body.itemDescription || "").trim(),
    notes: String(body.notes || "").trim(),
    sealImageFileName,
    sealImagePath: sealImageFileName ? path.join(uploadDir, sealImageFileName) : "",
  };
}

function validateOrderPayload(payload) {
  if (!payload.orderTitle || !payload.clientName || !payload.yourCompanyName) {
    throw new Error("必須項目が不足しています。");
  }
  if (!payload.issueDate) {
    throw new Error("発行日を入力してください。");
  }
}

function ensureStoreFile() {
  if (!fs.existsSync(orderStorePath)) {
    fs.writeFileSync(orderStorePath, "[]");
  }
}

function readOrders() {
  ensureStoreFile();
  try {
    const raw = fs.readFileSync(orderStorePath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    return [];
  }
}

function writeOrders(orders) {
  fs.writeFileSync(orderStorePath, JSON.stringify(orders, null, 2));
}

function filterOrdersByPeriod(orders, from, to) {
  return orders.filter((order) => {
    const issueDate = order.issueDate || "";
    if (from && issueDate < from) {
      return false;
    }
    if (to && issueDate > to) {
      return false;
    }
    return true;
  });
}

function buildSummary(orders) {
  const totalAmount = orders.reduce((sum, order) => sum + Number(order.amount || 0), 0);
  const avgAmount = orders.length ? Math.round(totalAmount / orders.length) : 0;
  const latestOrder = orders[0] || null;

  return {
    count: orders.length,
    totalAmount,
    avgAmount,
    latestIssueDate: latestOrder ? latestOrder.issueDate : "",
  };
}

function summarizeOrder(order) {
  return {
    id: order.id,
    orderTitle: order.orderTitle,
    issueDate: order.issueDate,
    dueDate: order.dueDate,
    clientName: order.clientName,
    yourCompanyName: order.yourCompanyName,
    amount: order.amount,
    taxRate: order.taxRate,
    itemDescription: order.itemDescription,
    notes: order.notes,
    pdfUrl: order.pdfUrl,
    createdAt: order.createdAt,
  };
}

function resolveWritableDir(name) {
  const candidates = [
    path.join(__dirname, name),
    path.join("/tmp", `gemini_test_${name}`),
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

  throw new Error(`保存先ディレクトリ ${name} を作成できませんでした。`);
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
    y: height - 122,
    width,
    height: 122,
    color: rgb(0.11, 0.12, 0.14),
  });

  page.drawText("発注書", {
    x: margin,
    y: height - 72,
    size: 28,
    font: fontBold,
    color: rgb(1, 1, 1),
  });

  page.drawText(data.orderTitle || "業務発注", {
    x: margin,
    y: height - 102,
    size: 12,
    font,
    color: rgb(0.8, 0.83, 0.88),
  });

  drawLabelValue(page, font, "発行日", data.issueDate || "-", margin, height - 165);
  drawLabelValue(page, font, "納期", data.dueDate || "-", 300, height - 165);

  page.drawText("宛先", {
    x: margin,
    y: height - 220,
    size: 11,
    font,
    color: rgb(0.42, 0.45, 0.5),
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
    color: rgb(0.42, 0.45, 0.5),
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
    color: rgb(0.97, 0.97, 0.98),
    borderColor: rgb(0.85, 0.87, 0.9),
    borderWidth: 1,
  });

  page.drawText("発注金額", {
    x: margin + 20,
    y: height - 360,
    size: 12,
    font,
    color: rgb(0.42, 0.45, 0.5),
  });
  page.drawText(formatCurrency(data.amount), {
    x: margin + 20,
    y: height - 392,
    size: 26,
    font: fontBold,
    color: rgb(0.1, 0.12, 0.15),
  });

  page.drawText(`消費税率: ${data.taxRate}%`, {
    x: 360,
    y: height - 360,
    size: 11,
    font,
    color: rgb(0.42, 0.45, 0.5),
  });

  page.drawRectangle({
    x: margin,
    y: height - 610,
    width: width - margin * 2,
    height: 150,
    color: rgb(1, 1, 1),
    borderColor: rgb(0.85, 0.87, 0.9),
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
    borderColor: rgb(0.85, 0.87, 0.9),
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
    const sealImage = extension === ".png" ? await pdfDoc.embedPng(imageBytes) : await pdfDoc.embedJpg(imageBytes);
    const imageDims = sealImage.scale(0.22);

    page.drawImage(sealImage, {
      x: width - margin - imageDims.width - 10,
      y: height - 315,
      width: imageDims.width,
      height: imageDims.height,
      opacity: 0.8,
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
    color: rgb(0.42, 0.45, 0.5),
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

if (require.main === module) {
  app.listen(port, host, () => {
    console.log(`Server started on http://${host}:${port}`);
  });
}

module.exports = {
  app,
  createOrderPdf,
  sanitizePayload,
  resolveWritableDir,
  readOrders,
};
