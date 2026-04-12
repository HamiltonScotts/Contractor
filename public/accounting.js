const filterForm = document.getElementById("filterForm");
const fromDateInput = document.getElementById("fromDate");
const toDateInput = document.getElementById("toDate");
const exportButton = document.getElementById("exportButton");
const totalAmount = document.getElementById("totalAmount");
const totalCount = document.getElementById("totalCount");
const avgAmount = document.getElementById("avgAmount");
const latestIssueDate = document.getElementById("latestIssueDate");
const tableStatus = document.getElementById("tableStatus");
const ordersTableBody = document.getElementById("ordersTableBody");

loadOrders();

filterForm.addEventListener("submit", (event) => {
  event.preventDefault();
  loadOrders();
});

exportButton.addEventListener("click", () => {
  const params = new URLSearchParams();
  if (fromDateInput.value) {
    params.set("from", fromDateInput.value);
  }
  if (toDateInput.value) {
    params.set("to", toDateInput.value);
  }
  const query = params.toString();
  window.location.href = `/api/orders/export${query ? `?${query}` : ""}`;
});

async function loadOrders() {
  tableStatus.textContent = "読み込み中...";
  ordersTableBody.innerHTML = "";

  const params = new URLSearchParams();
  if (fromDateInput.value) {
    params.set("from", fromDateInput.value);
  }
  if (toDateInput.value) {
    params.set("to", toDateInput.value);
  }

  try {
    const response = await fetch(`/api/orders${params.toString() ? `?${params.toString()}` : ""}`);
    const result = await response.json();
    renderSummary(result.summary);
    renderOrders(result.orders);
    tableStatus.textContent = `${result.orders.length}件`;
  } catch (_error) {
    tableStatus.textContent = "読み込みに失敗しました";
    ordersTableBody.innerHTML = `
      <tr>
        <td colspan="6" class="empty-row">履歴を読み込めませんでした。</td>
      </tr>
    `;
  }
}

function renderSummary(summary) {
  totalAmount.textContent = formatCurrency(summary.totalAmount);
  totalCount.textContent = String(summary.count);
  avgAmount.textContent = formatCurrency(summary.avgAmount);
  latestIssueDate.textContent = summary.latestIssueDate || "-";
}

function renderOrders(orders) {
  if (!orders.length) {
    ordersTableBody.innerHTML = `
      <tr>
        <td colspan="6" class="empty-row">この期間の発注履歴はありません。</td>
      </tr>
    `;
    return;
  }

  ordersTableBody.innerHTML = orders.map((order) => `
    <tr>
      <td>${escapeHtml(order.issueDate || "-")}</td>
      <td>
        <strong>${escapeHtml(order.orderTitle)}</strong>
        <div class="row-subcopy">${escapeHtml(order.notes || "")}</div>
      </td>
      <td>${escapeHtml(order.clientName)}</td>
      <td>${escapeHtml(order.yourCompanyName)}</td>
      <td>${formatCurrency(order.amount)}</td>
      <td><a class="text-link" href="${order.pdfUrl}" target="_blank" rel="noreferrer">PDFを見る</a></td>
    </tr>
  `).join("");
}

function formatCurrency(value) {
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
