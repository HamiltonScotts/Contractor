const sealForm = document.getElementById("sealForm");
const orderForm = document.getElementById("orderForm");
const sealStatus = document.getElementById("sealStatus");
const appStatus = document.getElementById("appStatus");
const configStatus = document.getElementById("configStatus");
const sealPreview = document.getElementById("sealPreview");
const sealImagePathInput = document.getElementById("sealImagePath");
const pdfLink = document.getElementById("pdfLink");
const pdfFrame = document.getElementById("pdfFrame");
const pdfEmptyState = document.getElementById("pdfEmptyState");

loadConfig();
seedDates();

sealForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setSealStatus("印影をアップロードしています...");

  try {
    const formData = new FormData(sealForm);
    const response = await fetch("/api/seal", {
      method: "POST",
      body: formData,
    });
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || "印影アップロードに失敗しました。");
    }

    sealImagePathInput.value = result.fileName;
    setSealStatus(`登録済み: ${result.originalName}`);
    sealPreview.src = result.url;
    sealPreview.classList.remove("hidden");
  } catch (error) {
    setSealStatus(error.message, true);
  }
});

orderForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setAppStatus("PDFを生成しています...");
  pdfLink.classList.add("hidden");

  try {
    const formData = new FormData(orderForm);
    const payload = Object.fromEntries(formData.entries());
    const response = await fetch("/api/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.details || result.error || "書類作成に失敗しました。");
    }

    const previewUrl = `${result.pdfUrl}#toolbar=1&navpanes=0&view=FitH&t=${Date.now()}`;
    setAppStatus(`${result.message} ${result.spreadsheet.message}`);
    pdfLink.href = result.pdfUrl;
    pdfLink.classList.remove("hidden");
    pdfFrame.src = previewUrl;
    pdfFrame.classList.remove("hidden");
    pdfEmptyState.classList.add("hidden");
  } catch (error) {
    setAppStatus(error.message, true);
  }
});

async function loadConfig() {
  try {
    const response = await fetch("/api/config");
    const result = await response.json();
    configStatus.textContent = result.spreadsheetWebhookConfigured
      ? "Spreadsheet連携: 接続済み"
      : "Spreadsheet連携: 未設定";
  } catch (_error) {
    configStatus.textContent = "設定の読み込みに失敗しました。";
  }
}

function seedDates() {
  const today = new Date().toISOString().slice(0, 10);
  const issueDate = orderForm.querySelector('input[name="issueDate"]');
  if (issueDate && !issueDate.value) {
    issueDate.value = today;
  }
}

function setAppStatus(message, isError = false) {
  appStatus.textContent = message;
  appStatus.classList.toggle("is-error", isError);
}

function setSealStatus(message, isError = false) {
  sealStatus.textContent = message;
  sealStatus.classList.toggle("is-error", isError);
}
