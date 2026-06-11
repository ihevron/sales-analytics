const countLabels = {
  products: "מוצרים",
  sales_raw: "שורות מכירה",
  customer_orders: "הזמנות",
  customer_order_items: "שורות הזמנה",
  customer_calls: "שיחות",
  customer_call_profiles: "לקוחות שיחות",
  sales_recommendations: "המלצות",
};

init();

async function init() {
  const status = document.getElementById("preview-status");
  try {
    const response = await fetch("/api/postgres-preview", { cache: "no-store" });
    const data = await response.json();
    if (!data.ok) {
      status.textContent = data.message || "חיבור Postgres לא מוגדר בשרת";
      renderEmpty();
      return;
    }

    status.textContent = `מחובר אל ${data.projectHost}`;
    renderCounts(data.counts);
    renderTable("postgres-orders", data.recentOrders, [
      ["id", "מספר"],
      ["order_date", "תאריך"],
      ["customer_name", "לקוח"],
      ["status", "סטטוס"],
      ["estimated_total", "סכום"],
    ]);
    renderTable("postgres-calls", data.recentCalls, [
      ["call_date", "תאריך"],
      ["customer_name", "לקוח"],
      ["status", "סטטוס"],
      ["call_again_time", "שעת חזרה"],
    ]);
    renderTable("postgres-products", data.topProducts, [
      ["sku", "מק״ט"],
      ["description", "מוצר"],
      ["category", "קטגוריה"],
      ["supplier", "ספק"],
      ["sale_price", "מחיר"],
      ["pick_order", "סדר ליקוט"],
    ]);
  } catch (error) {
    status.textContent = `שגיאה בטעינת Postgres: ${error.message}`;
    renderEmpty();
  }
}

function renderCounts(counts = {}) {
  document.getElementById("postgres-counts").innerHTML = Object.entries(countLabels).map(([key, label]) => `
    <div class="metric-card">
      <strong>${formatNumber(counts[key] || 0)}</strong>
      <span>${label}</span>
    </div>
  `).join("");
}

function renderTable(id, rows = [], columns = []) {
  const table = document.getElementById(id);
  table.innerHTML = `
    <thead><tr>${columns.map(([, label]) => `<th>${escapeHtml(label)}</th>`).join("")}</tr></thead>
    <tbody>
      ${rows.length ? rows.map((row) => `
        <tr>${columns.map(([key]) => `<td>${escapeHtml(formatCell(row[key]))}</td>`).join("")}</tr>
      `).join("") : `<tr><td colspan="${columns.length}" class="empty-state">אין נתונים להצגה</td></tr>`}
    </tbody>
  `;
}

function renderEmpty() {
  renderCounts({});
  renderTable("postgres-orders", [], [["empty", ""]]);
  renderTable("postgres-calls", [], [["empty", ""]]);
  renderTable("postgres-products", [], [["empty", ""]]);
}

function formatCell(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return formatNumber(value);
  return value;
}

function formatNumber(value) {
  return Number(value).toLocaleString("he-IL", { maximumFractionDigits: 2 });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
