const sealForm = document.getElementById("sealForm");
const orderForm = document.getElementById("orderForm");
const sealStatus = document.getElementById("sealStatus");
const appStatus = document.getElementById("appStatus");
const configStatus = document.getElementById("configStatus");
const sealPreview = document.getElementById("sealPreview");
const sealImagePathInput = document.getElementById("sealImagePath");
const pdfLink = document.getElementById("pdfLink");

loadConfig();
seedDates();

sealForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  sealStatus.textContent = "印影をアップロードしています...";

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
    sealStatus.textContent = `登録済み: ${result.originalName}`;
    sealPreview.src = result.url;
    sealPreview.classList.remove("hidden");
  } catch (error) {
    sealStatus.textContent = error.message;
  }
});

orderForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  appStatus.textContent = "PDFを生成しています...";
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

    appStatus.textContent = `${result.message} ${result.spreadsheet.message}`;
    pdfLink.href = result.pdfUrl;
    pdfLink.classList.remove("hidden");
  } catch (error) {
    appStatus.textContent = error.message;
  }
});

async function loadConfig() {
  try {
    const response = await fetch("/api/config");
    const result = await response.json();
    configStatus.textContent = result.spreadsheetWebhookConfigured
      ? "Spreadsheet連携: Webhook設定あり"
      : "Spreadsheet連携: Webhook未設定のため、PDF生成のみ有効";
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
