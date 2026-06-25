const DB_KEY = "hebrew-sales-analytics-db";
const SQL_WASM = "https://cdn.jsdelivr.net/npm/sql.js@1.10.3/dist/";

const state = {
  db: null,
  sort: {},
  databaseVersion: "",
  analysisMonths: 6,
  customerSearchMonths: 6,
  supplierMonths: 6,
  selectedCustomer: null,
};

const screens = {
  dashboard: { title: "דשבורד", subtitle: "ברירת מחדל: 6 חודשים מלאים אחרונים" },
  "customer-search": { title: "חיפוש לקוח", subtitle: "חיפוש לפי שם לקוח או מס' לקוח" },
  "customer-analysis": { title: "ניתוח לקוחות", subtitle: "השוואת לקוחות לפי תקופה" },
  products: { title: "מוצרים", subtitle: "חיפוש וסינון מוצרים" },
  "supplier-analysis": { title: "ניתוח ספקים", subtitle: "ניתוח מכירות ורווחיות לפי ספק ומוצר" },
  recommendations: { title: "המלצות מכירה", subtitle: "ניהול המלצות פעילות לכרטיס לקוח" },
};

const salesColumns = {
  customer_no: ["מס' לקוח", "מספר לקוח"],
  customer_name: ["שם לקוח"],
  sku: ['מק"ט', "מקט"],
  product_desc: ["תאור מוצר", "תיאור מוצר"],
  quantity: ["כמות"],
  sales_amount: ['סכום (ש"ח)', 'סכום ש"ח', "סכום"],
  cost: ["עלות"],
  profit: ["רווח"],
  supplier: ["ספק"],
  category: ["קטגוריה"],
  return_units: ["יח' חזרות", "יחידות חזרות"],
  purchase_units: ["יח' קניות", "יחידות קניות"],
  agent: ["סוכן"],
  sale_date: ["תאריך", "תאריך מכירה", "חודש", "תאריך חשבונית"],
};

const productColumns = {
  sku: ['מק"ט', "מקט"],
  barcode: ["ברקוד", "בר קוד", "קוד ברקוד", "ברקוד מוצר", "ברקוד פריט", "barcode", "bar code", "Barcode", "BARCODE", "EAN", "ean", "EAN13", "EAN-13", "UPC", "GTIN"],
  description: ["תאור", "תיאור"],
  category: ["תאור משפחה", "תיאור משפחה"],
  standard_cost: ['עלות תקן ש"ח', "עלות תקן"],
  base_price: ["מחיר מחירון בסיס"],
  weight: ["משקל"],
  supplier: ["שם ספק"],
};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  setStatus("טוען בסיס נתונים");
  await initDatabase();
  if (!state.db) return;
  bindEvents();
  await refreshAll();
  setStatus("מוכן לייבוא נתונים");
}

async function initDatabase() {
  if (!window.initSqlJs) {
    setStatus("ספריית SQL לא נטענה. יש לבדוק חיבור רשת");
    return;
  }
  const SQL = await window.initSqlJs({ locateFile: (file) => SQL_WASM + file });
  const saved = await readSavedDatabase(SQL);
  state.db = saved?.data ? new SQL.Database(saved.data) : new SQL.Database();
  createSchema();
  const repairedDates = repairShiftedMonthData();
  if (!saved?.data) {
    seedRecommendations();
  }
  if (!saved?.data || repairedDates || saved.source === "browser") {
    rebuildSummaryTables();
    await persistDatabase();
  }
}

function createSchema() {
  state.db.run(`
    PRAGMA journal_mode = MEMORY;
    CREATE TABLE IF NOT EXISTS sales_raw (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_no TEXT,
      customer_name TEXT,
      sku TEXT,
      product_desc TEXT,
      quantity REAL DEFAULT 0,
      sales_amount REAL DEFAULT 0,
      cost REAL DEFAULT 0,
      profit REAL DEFAULT 0,
      supplier TEXT,
      category TEXT,
      return_units REAL DEFAULT 0,
      purchase_units REAL DEFAULT 0,
      agent TEXT,
      sale_date TEXT NOT NULL,
      imported_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS products (
      sku TEXT PRIMARY KEY,
      barcode TEXT,
      description TEXT,
      category TEXT,
      standard_cost REAL DEFAULT 0,
      base_price REAL DEFAULT 0,
      weight REAL DEFAULT 0,
      supplier TEXT,
      display_order REAL DEFAULT 999999,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sales_recommendations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS app_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS customer_product_summary (
      customer_no TEXT,
      customer_name TEXT,
      sku TEXT,
      product_desc TEXT,
      quantity REAL,
      sales_amount REAL,
      profit REAL,
      return_units REAL,
      purchase_units REAL,
      last_sale_date TEXT,
      PRIMARY KEY (customer_no, sku)
    );
    CREATE TABLE IF NOT EXISTS customer_profitability_summary (
      customer_no TEXT PRIMARY KEY,
      customer_name TEXT,
      sales_amount REAL,
      profit REAL,
      return_units REAL,
      purchase_units REAL,
      last_sale_date TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_sales_date ON sales_raw (sale_date);
    CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales_raw (customer_no, customer_name);
    CREATE INDEX IF NOT EXISTS idx_sales_sku ON sales_raw (sku);
    CREATE INDEX IF NOT EXISTS idx_sales_period_customer ON sales_raw (sale_date, customer_no);
    CREATE INDEX IF NOT EXISTS idx_products_supplier ON products (supplier);
    CREATE INDEX IF NOT EXISTS idx_products_category ON products (category);
  `);
  rebuildSummaryTables();
}

function ensureColumn(table, column, definition) {
  const exists = queryRows(`PRAGMA table_info(${table})`).some((row) => row.name === column);
  if (!exists) state.db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function repairShiftedMonthData() {
  const repairKey = "shift_month_data_forward_v2";

  const previousMonthStart = firstDayOfPreviousMonth();
  const monthBeforePreviousStart = addMonths(previousMonthStart, -1);
  const previousMonth = monthKey(previousMonthStart);
  const monthBeforePrevious = monthKey(monthBeforePreviousStart);
  const currentMonth = monthKey(firstDayOfCurrentMonth());
  const currentMonthStart = toSqlDate(firstDayOfCurrentMonth());
  const stats = firstRow(`
    SELECT
      COUNT(*) AS row_count,
      MAX(CASE WHEN SUBSTR(sale_date, 1, 7) < ? THEN SUBSTR(sale_date, 1, 7) ELSE NULL END) AS max_completed_month,
      SUM(CASE WHEN SUBSTR(sale_date, 1, 7) = ? THEN 1 ELSE 0 END) AS previous_month_rows,
      SUM(CASE WHEN SUBSTR(sale_date, 1, 7) = ? THEN 1 ELSE 0 END) AS month_before_previous_rows
    FROM sales_raw
  `, [currentMonth, previousMonth, monthBeforePrevious]);

  if (
    number(stats.row_count) > 0 &&
    text(stats.max_completed_month) === monthBeforePrevious &&
    number(stats.previous_month_rows) === 0 &&
    number(stats.month_before_previous_rows) > 0
  ) {
    state.db.run(`
      UPDATE sales_raw
      SET sale_date = DATE(SUBSTR(sale_date, 1, 7) || '-01', '+1 month')
      WHERE sale_date < ?
    `, [currentMonthStart]);
    state.db.run("INSERT OR REPLACE INTO app_metadata (key, value) VALUES (?, ?)", [repairKey, new Date().toISOString()]);
    return true;
  }

  return false;
}

function seedRecommendations() {
  const count = scalar("SELECT COUNT(*) FROM sales_recommendations");
  if (count > 0) return;
  const stmt = state.db.prepare("INSERT INTO sales_recommendations (text, active) VALUES (?, 1)");
  ["בדוק מוצרים משלימים לפי הקניות האחרונות", "הצע חידוש מלאי למוצרים עם כמות רכישה גבוהה", "בדוק מוצרים דומים מקטגוריות עם רווחיות גבוהה"].forEach((text) => {
    stmt.run([text]);
  });
  stmt.free();
}

function rebuildSummaryTables() {
  state.db.run(`
    DROP TABLE IF EXISTS customer_product_summary;
    CREATE TABLE customer_product_summary (
      customer_no TEXT,
      customer_name TEXT,
      product_key TEXT,
      sku TEXT,
      product_desc TEXT,
      quantity REAL,
      sales_amount REAL,
      profit REAL,
      return_units REAL,
      purchase_units REAL,
      last_sale_date TEXT,
      PRIMARY KEY (customer_no, product_key)
    );

    DROP TABLE IF EXISTS customer_profitability_summary;
    CREATE TABLE customer_profitability_summary (
      customer_no TEXT PRIMARY KEY,
      customer_name TEXT,
      sales_amount REAL,
      profit REAL,
      return_units REAL,
      purchase_units REAL,
      last_sale_date TEXT
    );

    DELETE FROM customer_product_summary;
    INSERT INTO customer_product_summary
    SELECT
      customer_no,
      MAX(customer_name),
      COALESCE(NULLIF(TRIM(sku), ''), NULLIF(TRIM(product_desc), ''), 'ללא מוצר'),
      MAX(sku),
      MAX(product_desc),
      SUM(quantity),
      SUM(sales_amount),
      SUM(profit),
      SUM(return_units),
      SUM(purchase_units),
      MAX(sale_date)
    FROM sales_raw
    GROUP BY customer_no, COALESCE(NULLIF(TRIM(sku), ''), NULLIF(TRIM(product_desc), ''), 'ללא מוצר');

    DELETE FROM customer_profitability_summary;
    INSERT INTO customer_profitability_summary
    SELECT
      customer_no,
      MAX(customer_name),
      SUM(sales_amount),
      SUM(profit),
      SUM(return_units),
      SUM(purchase_units),
      MAX(sale_date)
    FROM sales_raw
    GROUP BY customer_no;
  `);
}

function bindEvents() {
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.addEventListener("click", () => showScreen(button.dataset.screen));
  });
  document.getElementById("menu-toggle").addEventListener("click", () => {
    document.querySelector(".sidebar").classList.toggle("open");
  });
  document.getElementById("import-sales").addEventListener("click", () => document.getElementById("sales-file").click());
  document.getElementById("import-products").addEventListener("click", () => document.getElementById("products-file").click());
  document.getElementById("sales-file").addEventListener("change", (event) => importFile(event, "sales"));
  document.getElementById("products-file").addEventListener("change", (event) => importFile(event, "products"));
  document.getElementById("customer-search-button").addEventListener("click", searchCustomers);
  document.getElementById("customer-query").addEventListener("input", debounce(searchCustomers, 250));
  document.getElementById("analysis-query").addEventListener("input", debounce(renderCustomerAnalysis, 250));
  document.querySelectorAll(".segmented button").forEach((button) => {
    button.addEventListener("click", () => {
      const group = button.closest(".segmented");
      const target = group.dataset.periodTarget || "customer";
      group.querySelectorAll("button").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      if (target === "supplier") {
        state.supplierMonths = Number(button.dataset.months);
        renderSupplierAnalysis();
      } else if (target === "customer-search") {
        state.customerSearchMonths = Number(button.dataset.months);
        searchCustomers();
      } else {
        state.analysisMonths = Number(button.dataset.months);
        renderCustomerAnalysis();
      }
    });
  });
  ["product-query", "supplier-filter", "category-filter"].forEach((id) => {
    document.getElementById(id).addEventListener("input", renderProducts);
  });
  ["supplier-analysis-query", "supplier-analysis-filter"].forEach((id) => {
    document.getElementById(id).addEventListener("input", renderSupplierAnalysis);
  });
  document.getElementById("recommendation-form").addEventListener("submit", saveRecommendation);
  document.getElementById("recommendation-reset").addEventListener("click", resetRecommendationForm);
}

async function refreshAll() {
  renderDashboard();
  searchCustomers();
  renderCustomerAnalysis();
  refreshProductFilters();
  renderProducts();
  refreshSupplierAnalysisFilters();
  renderSupplierAnalysis();
  renderRecommendations();
}

function showScreen(id) {
  document.querySelectorAll(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.screen === id));
  document.querySelectorAll(".screen").forEach((screen) => screen.classList.toggle("active-screen", screen.id === id));
  document.getElementById("screen-title").textContent = screens[id].title;
  document.getElementById("screen-subtitle").textContent = screens[id].subtitle;
  document.querySelector(".sidebar").classList.remove("open");
  if (id === "dashboard") renderDashboard();
  if (id === "customer-analysis") renderCustomerAnalysis();
  if (id === "products") renderProducts();
  if (id === "supplier-analysis") renderSupplierAnalysis();
  if (id === "recommendations") renderRecommendations();
}

async function importFile(event, type) {
  const file = event.target.files[0];
  if (!file) return;
  try {
    setStatus("קורא קובץ");
    const rows = await readWorkbook(file);
    setStatus("מרענן בסיס נתונים לפני ייבוא");
    await reloadDatabaseFromServer();
    if (type === "sales") {
      importSalesRows(rows);
      repairShiftedMonthData();
    }
    if (type === "products") {
      const importedProducts = importProductRows(rows);
      await importProductsToPostgres(importedProducts);
    }
    rebuildSummaryTables();
    const persisted = await persistDatabase();
    await refreshAll();
    setStatus(persisted.server.ok
      ? `הייבוא הסתיים: ${rows.length.toLocaleString("he-IL")} שורות`
      : `הייבוא נשמר בדפדפן בלבד: ${rows.length.toLocaleString("he-IL")} שורות. יש לבדוק שמירה לענן.`);
    if (!persisted.server.ok) {
      alert(`הנתונים נשמרו בדפדפן הזה בלבד, אבל לא נשמרו לענן. לכן הם לא יופיעו במובייל.\n\nשגיאת שמירה: ${persisted.server.error || "לא ידוע"}`);
    }
  } catch (error) {
    console.error(error);
    setStatus("שגיאה בייבוא הקובץ");
    alert(`שגיאה בייבוא הקובץ:\n${error.message || "יש לבדוק שהעמודות תואמות למפרט."}`);
  } finally {
    event.target.value = "";
  }
}

function readWorkbook(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const workbook = XLSX.read(reader.result, { type: "array", cellDates: true });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        resolve(XLSX.utils.sheet_to_json(sheet, { defval: "" }));
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

function importSalesRows(rows) {
  const now = new Date().toISOString();
  const defaultDate = toSqlDate(new Date());
  const stmt = state.db.prepare(`
    INSERT INTO sales_raw
    (customer_no, customer_name, sku, product_desc, quantity, sales_amount, cost, profit, supplier, category, return_units, purchase_units, agent, sale_date, imported_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  state.db.run("BEGIN TRANSACTION");
  state.db.run("DELETE FROM sales_raw");
  rows.forEach((row) => {
    const mapped = mapRow(row, salesColumns);
    if (!mapped.customer_no && !mapped.customer_name && !mapped.sku) return;
    stmt.run([
      text(mapped.customer_no),
      text(mapped.customer_name),
      text(mapped.sku),
      text(mapped.product_desc),
      number(mapped.quantity),
      number(mapped.sales_amount),
      number(mapped.cost),
      number(mapped.profit),
      text(mapped.supplier),
      text(mapped.category),
      number(mapped.return_units),
      number(mapped.purchase_units),
      text(mapped.agent),
      parseDate(mapped.sale_date) || defaultDate,
      now,
    ]);
  });
  state.db.run("COMMIT");
  stmt.free();
}

function importProductRows(rows) {
  const now = new Date().toISOString();
  const products = [];
  ensureColumn("products", "barcode", "TEXT");
  ensureColumn("products", "display_order", "REAL DEFAULT 999999");
  const stmt = state.db.prepare(`
    INSERT INTO products
    (sku, barcode, description, category, standard_cost, base_price, weight, supplier, display_order, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(sku) DO UPDATE SET
      barcode = excluded.barcode,
      description = excluded.description,
      category = excluded.category,
      standard_cost = excluded.standard_cost,
      base_price = excluded.base_price,
      weight = excluded.weight,
      supplier = excluded.supplier,
      display_order = excluded.display_order,
      updated_at = excluded.updated_at
  `);
  state.db.run("BEGIN TRANSACTION");
  state.db.run("DELETE FROM products");
  rows.forEach((row) => {
    const mapped = mapRow(row, productColumns);
    if (!mapped.sku) return;
    const product = {
      sku: text(mapped.sku),
      barcode: barcodeValue(mapped.barcode || inferBarcode(row)),
      description: text(mapped.description),
      category: text(mapped.category),
      standard_cost: number(mapped.standard_cost),
      sale_price: number(mapped.base_price),
      weight: number(mapped.weight),
      supplier: text(mapped.supplier),
      display_order: displayOrderValue(row),
      updated_at: now,
    };
    product.purchase_price = product.standard_cost;
    products.push(product);
    stmt.run([product.sku, product.barcode, product.description, product.category, product.standard_cost, product.sale_price, product.weight, product.supplier, product.display_order, now]);
  });
  state.db.run("COMMIT");
  stmt.free();
  return [...new Map(products.map((product) => [product.sku, product])).values()];
}

function displayOrderValue(row) {
  const values = Object.values(row);
  return number(values[10]) || 999999;
}

async function importProductsToPostgres(products) {
  if (!products.length) return { ok: true, imported: 0 };
  const response = await fetch("/api/postgres/products-import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ products }),
  });
  const data = await response.json().catch(() => ({}));
  if (data.configured === false) return data;
  if (!response.ok || !data.ok) {
    throw new Error(data.error || "ייבוא המוצרים ל-Supabase נכשל");
  }
  return data;
}

function renderDashboard() {
  const months = 6;
  const range = dateRange(months);
  const returnsRange = currentInclusiveRange(months);
  const totals = firstRow(`
    SELECT
      COUNT(DISTINCT customer_no) AS active_customers,
      COALESCE(SUM(sales_amount), 0) AS total_sales,
      COALESCE(SUM(profit), 0) AS total_profit,
      CASE WHEN COALESCE(SUM(sales_amount), 0) = 0 THEN 0 ELSE SUM(profit) / SUM(sales_amount) END AS profit_percent
    FROM sales_raw
    WHERE sale_date >= ? AND sale_date < ?
  `, [range.start, range.end]);
  const returnTotals = firstRow(`
    SELECT
      CASE WHEN COALESCE(SUM(purchase_units), 0) = 0 THEN 0 ELSE ABS(SUM(return_units) / SUM(purchase_units)) END AS returns_percent
    FROM sales_raw
    WHERE sale_date >= ? AND sale_date < ?
  `, [returnsRange.start, returnsRange.end]);
  const cards = [
    ["לקוחות פעילים", integer(totals.active_customers)],
    ["ממוצע מכירות חודשי", currency(number(totals.total_sales) / months)],
    ["ממוצע רווח חודשי", currency(number(totals.total_profit) / months)],
    ["% רווח ממוצע", percent(totals.profit_percent)],
    ["% חזרות ממוצע", percent(returnTotals.returns_percent)],
  ];
  document.getElementById("dashboard-cards").innerHTML = cards.map(([label, value]) => `
    <div class="metric-card"><span>${label}</span><strong>${value}</strong></div>
  `).join("");

  renderTable("monthly-table", monthlyRows(), [
    { key: "month", label: "חודש" },
    { key: "total_sales", label: "סכום מכירות", format: currency },
    { key: "total_profit", label: "סכום רווח", format: currency },
    { key: "profit_percent", label: "% רווח", format: percent },
    { key: "returns_percent", label: "% חזרות", format: percent },
  ], "monthly", "month", "desc");

  renderTable("top-profit-table", queryRows(`
    SELECT customer_name AS customer, COALESCE(SUM(profit), 0) / ? AS average_monthly_profit
    FROM sales_raw
    WHERE sale_date >= ? AND sale_date < ?
    GROUP BY customer_no
    ORDER BY average_monthly_profit DESC
    LIMIT 10
  `, [months, range.start, range.end]), [
    { key: "customer", label: "לקוח" },
    { key: "average_monthly_profit", label: "ממוצע רווח חודשי", format: currency },
  ], "topProfit", "average_monthly_profit", "desc");

  renderTable("top-returns-table", queryRows(`
    SELECT
      customer_name AS customer,
      CASE WHEN COALESCE(SUM(purchase_units), 0) = 0 THEN 0 ELSE ABS(SUM(return_units) / SUM(purchase_units)) END AS returns_percent
    FROM sales_raw
    WHERE sale_date >= ? AND sale_date < ?
    GROUP BY customer_no
    ORDER BY returns_percent DESC
    LIMIT 10
  `, [returnsRange.start, returnsRange.end]), [
    { key: "customer", label: "לקוח" },
    { key: "returns_percent", label: "% חזרות", format: percent },
  ], "topReturns", "returns_percent", "desc");

  renderTable("top-products-table", queryRows(`
    SELECT
      COALESCE(NULLIF(TRIM(product_desc), ''), NULLIF(TRIM(sku), ''), 'ללא מוצר') AS product,
      COALESCE(SUM(profit), 0) / ? AS average_monthly_profit
    FROM sales_raw
    WHERE sale_date >= ? AND sale_date < ?
    GROUP BY COALESCE(NULLIF(TRIM(sku), ''), NULLIF(TRIM(product_desc), ''), 'ללא מוצר')
    ORDER BY average_monthly_profit DESC
    LIMIT 10
  `, [months, range.start, range.end]), [
    { key: "product", label: "פריט" },
    { key: "average_monthly_profit", label: "ממוצע רווח חודשי", format: currency },
  ], "topProducts", "average_monthly_profit", "desc");
}

function monthlyRows() {
  const range = dateRange(12);
  return queryRows(`
    SELECT
      SUBSTR(sale_date, 1, 7) AS month,
      COALESCE(SUM(sales_amount), 0) AS total_sales,
      COALESCE(SUM(profit), 0) AS total_profit,
      CASE WHEN COALESCE(SUM(sales_amount), 0) = 0 THEN 0 ELSE SUM(profit) / SUM(sales_amount) END AS profit_percent,
      CASE WHEN COALESCE(SUM(purchase_units), 0) = 0 THEN 0 ELSE ABS(SUM(return_units) / SUM(purchase_units)) END AS returns_percent
    FROM sales_raw
    WHERE sale_date >= ? AND sale_date < ?
    GROUP BY SUBSTR(sale_date, 1, 7)
    ORDER BY month DESC
    LIMIT 12
  `, [range.start, range.end]);
}

function searchCustomers() {
  const rawQuery = document.getElementById("customer-query").value.trim();
  const months = state.customerSearchMonths;
  const range = dateRange(months);
  if (!rawQuery) {
    renderTable("customers-results-table", [], [
      { key: "customer_no", label: "מס' לקוח" },
      { key: "customer_name", label: "שם לקוח" },
      { key: "sales_amount", label: "סכום מכירות", format: currency },
      { key: "profit", label: "רווח", format: currency },
      { key: "average_monthly_sales", label: "ממוצע מכירות חודשי", format: currency },
      { key: "average_monthly_profit", label: "ממוצע רווח חודשי", format: currency },
      { key: "action", label: "פעולה" },
    ], "customers", "profit", "desc");
    return;
  }
  const query = `%${rawQuery}%`;
  const rows = queryRows(`
    SELECT
      customer_no,
      MAX(customer_name) AS customer_name,
      COALESCE(SUM(sales_amount), 0) AS sales_amount,
      COALESCE(SUM(profit), 0) AS profit,
      COALESCE(SUM(sales_amount), 0) / ? AS average_monthly_sales,
      COALESCE(SUM(profit), 0) / ? AS average_monthly_profit
    FROM sales_raw
    WHERE sale_date >= ? AND sale_date < ?
      AND (customer_name LIKE ? OR customer_no LIKE ?)
    GROUP BY customer_no
    ORDER BY profit DESC
    LIMIT 100
  `, [months, months, range.start, range.end, query, query]);
  renderTable("customers-results-table", rows, [
    { key: "customer_no", label: "מס' לקוח" },
    { key: "customer_name", label: "שם לקוח" },
    { key: "sales_amount", label: "סכום מכירות", format: currency },
    { key: "profit", label: "רווח", format: currency },
    { key: "average_monthly_sales", label: "ממוצע מכירות חודשי", format: currency },
    { key: "average_monthly_profit", label: "ממוצע רווח חודשי", format: currency },
    { key: "action", label: "פעולה", render: (row) => `<button class="small-action" data-customer="${escapeAttr(row.customer_no)}">בחירה</button>` },
  ], "customers", "profit", "desc");
  document.querySelectorAll("#customers-results-table [data-customer]").forEach((button) => {
    button.addEventListener("click", () => selectCustomer(button.dataset.customer));
  });
}

function selectCustomer(customerNo) {
  state.selectedCustomer = customerNo;
  const months = state.customerSearchMonths || 6;
  const range = dateRange(months);
  const returnsRange = currentInclusiveRange(months);
  const customer = firstRow("SELECT customer_no, MAX(customer_name) AS customer_name FROM sales_raw WHERE customer_no = ? GROUP BY customer_no", [customerNo]);
  document.getElementById("customer-card").classList.remove("hidden");
  document.getElementById("customer-card-title").textContent = customer.customer_name || "כרטיס לקוח";
  document.getElementById("customer-card-subtitle").textContent = `מס' לקוח: ${customer.customer_no || ""}`;
  renderTable("customer-products-table", queryRows(`
    SELECT
      COALESCE(NULLIF(TRIM(product_desc), ''), NULLIF(TRIM(sku), ''), 'ללא מוצר') AS product,
      COALESCE(SUM(CASE WHEN sale_date >= ? AND sale_date < ? THEN quantity ELSE 0 END), 0) AS quantity,
      CASE
        WHEN COALESCE(SUM(CASE WHEN sale_date >= ? AND sale_date < ? THEN sales_amount ELSE 0 END), 0) = 0 THEN 0
        ELSE
          SUM(CASE WHEN sale_date >= ? AND sale_date < ? THEN profit ELSE 0 END) /
          SUM(CASE WHEN sale_date >= ? AND sale_date < ? THEN sales_amount ELSE 0 END)
      END AS profit_percent,
      CASE
        WHEN COALESCE(SUM(CASE WHEN sale_date >= ? AND sale_date < ? THEN purchase_units ELSE 0 END), 0) = 0 THEN 0
        ELSE ABS(
          SUM(CASE WHEN sale_date >= ? AND sale_date < ? THEN return_units ELSE 0 END) /
          SUM(CASE WHEN sale_date >= ? AND sale_date < ? THEN purchase_units ELSE 0 END)
        )
      END AS returns_percent
    FROM sales_raw
    WHERE customer_no = ? AND sale_date >= ? AND sale_date < ?
    GROUP BY COALESCE(NULLIF(TRIM(sku), ''), NULLIF(TRIM(product_desc), ''), 'ללא מוצר')
    ORDER BY quantity DESC
  `, [
    range.start, range.end,
    range.start, range.end,
    range.start, range.end,
    range.start, range.end,
    returnsRange.start, returnsRange.end,
    returnsRange.start, returnsRange.end,
    returnsRange.start, returnsRange.end,
    customerNo, returnsRange.start, returnsRange.end,
  ]), [
    { key: "product", label: "מוצר" },
    { key: "quantity", label: "כמות", format: numberDisplay },
    { key: "profit_percent", label: "% רווח", format: percent },
    { key: "returns_percent", label: "% חזרות", format: percent },
  ], "customerProducts", "quantity", "desc");
  const recommendations = queryRows("SELECT text FROM sales_recommendations WHERE active = 1 ORDER BY id DESC");
  document.getElementById("customer-recommendations").innerHTML = recommendations.length
    ? recommendations.map((row) => `<li>${escapeHtml(row.text)}</li>`).join("")
    : "<li>אין המלצות פעילות</li>";
}

function renderCustomerAnalysis() {
  const months = state.analysisMonths;
  const range = dateRange(months);
  const returnsRange = currentInclusiveRange(months);
  const query = `%${document.getElementById("analysis-query").value.trim()}%`;
  const rows = queryRows(`
    SELECT
      customer_name,
      COALESCE(SUM(CASE WHEN sale_date >= ? AND sale_date < ? THEN sales_amount ELSE 0 END), 0) / ? AS average_monthly_sales,
      COALESCE(SUM(CASE WHEN sale_date >= ? AND sale_date < ? THEN profit ELSE 0 END), 0) / ? AS average_monthly_profit,
      CASE
        WHEN COALESCE(SUM(CASE WHEN sale_date >= ? AND sale_date < ? THEN sales_amount ELSE 0 END), 0) = 0 THEN 0
        ELSE
          SUM(CASE WHEN sale_date >= ? AND sale_date < ? THEN profit ELSE 0 END) /
          SUM(CASE WHEN sale_date >= ? AND sale_date < ? THEN sales_amount ELSE 0 END)
      END AS profit_percent,
      CASE
        WHEN COALESCE(SUM(CASE WHEN sale_date >= ? AND sale_date < ? THEN purchase_units ELSE 0 END), 0) = 0 THEN 0
        ELSE ABS(
          SUM(CASE WHEN sale_date >= ? AND sale_date < ? THEN return_units ELSE 0 END) /
          SUM(CASE WHEN sale_date >= ? AND sale_date < ? THEN purchase_units ELSE 0 END)
        )
      END AS returns_percent
    FROM sales_raw
    WHERE sale_date >= ? AND sale_date < ? AND customer_name LIKE ?
    GROUP BY customer_no
    ORDER BY average_monthly_profit DESC
    LIMIT 500
  `, [
    range.start, range.end, months,
    range.start, range.end, months,
    range.start, range.end,
    range.start, range.end,
    range.start, range.end,
    returnsRange.start, returnsRange.end,
    returnsRange.start, returnsRange.end,
    returnsRange.start, returnsRange.end,
    returnsRange.start, returnsRange.end, query,
  ]);
  renderTable("analysis-table", rows, [
    { key: "customer_name", label: "שם לקוח" },
    { key: "average_monthly_sales", label: "ממוצע מכירות חודשי", format: currency },
    { key: "average_monthly_profit", label: "ממוצע רווח חודשי", format: currency },
    { key: "profit_percent", label: "% רווח", format: percent },
    { key: "returns_percent", label: "% חזרות", format: percent },
  ], "analysis", "average_monthly_profit", "desc");
}

function refreshProductFilters() {
  fillSelect("supplier-filter", "כל הספקים", queryRows("SELECT DISTINCT supplier AS value FROM products WHERE supplier <> '' ORDER BY supplier"));
  fillSelect("category-filter", "כל הקטגוריות", queryRows("SELECT DISTINCT category AS value FROM products WHERE category <> '' ORDER BY category"));
}

function renderProducts() {
  const query = `%${document.getElementById("product-query").value.trim()}%`;
  const supplier = document.getElementById("supplier-filter").value;
  const category = document.getElementById("category-filter").value;
  const rows = queryRows(`
    SELECT
      p.sku,
      p.description,
      p.category,
      p.supplier,
      p.standard_cost,
      COALESCE(s.purchase_price, 0) AS purchase_price,
      p.base_price AS sale_price,
      p.weight
    FROM products p
    LEFT JOIN (
      SELECT sku, CASE WHEN SUM(quantity) = 0 THEN 0 ELSE SUM(cost) / SUM(quantity) END AS purchase_price
      FROM sales_raw
      GROUP BY sku
    ) s ON s.sku = p.sku
    WHERE (p.sku LIKE ? OR p.description LIKE ?)
      AND (? = '' OR p.supplier = ?)
      AND (? = '' OR p.category = ?)
    ORDER BY p.description
    LIMIT 500
  `, [query, query, supplier, supplier, category, category]);
  renderTable("products-table", rows, [
    { key: "sku", label: 'מק"ט' },
    { key: "description", label: "תיאור" },
    { key: "category", label: "קטגוריה" },
    { key: "supplier", label: "ספק" },
    { key: "standard_cost", label: "עלות תקן", format: currency2 },
    { key: "purchase_price", label: "מחיר קניה", format: currency2 },
    { key: "sale_price", label: "מחיר מכירה", format: currency2 },
    { key: "weight", label: "משקל", format: numberDisplay },
  ], "products", "description", "asc");
}

function refreshSupplierAnalysisFilters() {
  fillSelect("supplier-analysis-filter", "כל הספקים", queryRows(`
    SELECT DISTINCT supplier AS value
    FROM (
      SELECT supplier FROM sales_raw WHERE supplier <> ''
      UNION
      SELECT supplier FROM products WHERE supplier <> ''
    )
    WHERE value <> ''
    ORDER BY value
  `));
}

function renderSupplierAnalysis() {
  const months = state.supplierMonths;
  const weeks = months * 4.345;
  const range = dateRange(months);
  const returnsRange = currentInclusiveRange(months);
  const rawQuery = document.getElementById("supplier-analysis-query").value.trim();
  const query = `%${rawQuery}%`;
  const supplier = document.getElementById("supplier-analysis-filter").value;
  const baseColumns = [
    { key: "supplier", label: "ספק" },
    { key: "average_monthly_sales", label: "הכנסה ממוצעת לחודש", format: currency },
    { key: "average_monthly_profit", label: "רווח ממוצע לחודש", format: currency },
    { key: "profit_percent", label: "% רווחיות", format: percent },
    { key: "returns_percent", label: "% חזרות", format: percent },
    { key: "average_weekly_quantity", label: "כמות מכירות שבועית ממוצעת", format: numberDisplay },
  ];

  if (!supplier) {
    const rows = queryRows(`
      SELECT
        COALESCE(NULLIF(TRIM(s.supplier), ''), NULLIF(TRIM(p.supplier), ''), 'ללא ספק') AS supplier,
        COALESCE(SUM(CASE WHEN s.sale_date >= ? AND s.sale_date < ? THEN s.sales_amount ELSE 0 END), 0) / ? AS average_monthly_sales,
        COALESCE(SUM(CASE WHEN s.sale_date >= ? AND s.sale_date < ? THEN s.profit ELSE 0 END), 0) / ? AS average_monthly_profit,
        CASE
          WHEN COALESCE(SUM(CASE WHEN s.sale_date >= ? AND s.sale_date < ? THEN s.sales_amount ELSE 0 END), 0) = 0 THEN 0
          ELSE
            SUM(CASE WHEN s.sale_date >= ? AND s.sale_date < ? THEN s.profit ELSE 0 END) /
            SUM(CASE WHEN s.sale_date >= ? AND s.sale_date < ? THEN s.sales_amount ELSE 0 END)
        END AS profit_percent,
        CASE
          WHEN COALESCE(SUM(CASE WHEN s.sale_date >= ? AND s.sale_date < ? THEN s.purchase_units ELSE 0 END), 0) = 0 THEN 0
          ELSE ABS(
            SUM(CASE WHEN s.sale_date >= ? AND s.sale_date < ? THEN s.return_units ELSE 0 END) /
            SUM(CASE WHEN s.sale_date >= ? AND s.sale_date < ? THEN s.purchase_units ELSE 0 END)
          )
        END AS returns_percent,
        COALESCE(SUM(CASE WHEN s.sale_date >= ? AND s.sale_date < ? THEN s.quantity ELSE 0 END), 0) / ? AS average_weekly_quantity
      FROM sales_raw s
      LEFT JOIN products p ON p.sku = s.sku
      WHERE s.sale_date >= ? AND s.sale_date < ?
        AND COALESCE(s.supplier, p.supplier, '') LIKE ?
      GROUP BY COALESCE(NULLIF(TRIM(s.supplier), ''), NULLIF(TRIM(p.supplier), ''), 'ללא ספק')
      ORDER BY average_monthly_profit DESC
      LIMIT 500
    `, [
      range.start, range.end, months,
      range.start, range.end, months,
      range.start, range.end,
      range.start, range.end,
      range.start, range.end,
      returnsRange.start, returnsRange.end,
      returnsRange.start, returnsRange.end,
      returnsRange.start, returnsRange.end,
      range.start, range.end, weeks,
      returnsRange.start, returnsRange.end, query,
    ]);
    renderTable("supplier-analysis-table", rows, baseColumns, "supplierAnalysis", "average_monthly_profit", "desc");
    return;
  }

  const rows = queryRows(`
    SELECT
      COALESCE(NULLIF(TRIM(s.supplier), ''), NULLIF(TRIM(p.supplier), ''), 'ללא ספק') AS supplier,
      COALESCE(NULLIF(TRIM(s.product_desc), ''), NULLIF(TRIM(p.description), ''), NULLIF(TRIM(s.sku), ''), 'ללא מוצר') AS product,
      COALESCE(SUM(CASE WHEN s.sale_date >= ? AND s.sale_date < ? THEN s.sales_amount ELSE 0 END), 0) / ? AS average_monthly_sales,
      COALESCE(SUM(CASE WHEN s.sale_date >= ? AND s.sale_date < ? THEN s.profit ELSE 0 END), 0) / ? AS average_monthly_profit,
      CASE
        WHEN COALESCE(SUM(CASE WHEN s.sale_date >= ? AND s.sale_date < ? THEN s.sales_amount ELSE 0 END), 0) = 0 THEN 0
        ELSE
          SUM(CASE WHEN s.sale_date >= ? AND s.sale_date < ? THEN s.profit ELSE 0 END) /
          SUM(CASE WHEN s.sale_date >= ? AND s.sale_date < ? THEN s.sales_amount ELSE 0 END)
      END AS profit_percent,
      CASE
        WHEN COALESCE(SUM(CASE WHEN s.sale_date >= ? AND s.sale_date < ? THEN s.purchase_units ELSE 0 END), 0) = 0 THEN 0
        ELSE ABS(
          SUM(CASE WHEN s.sale_date >= ? AND s.sale_date < ? THEN s.return_units ELSE 0 END) /
          SUM(CASE WHEN s.sale_date >= ? AND s.sale_date < ? THEN s.purchase_units ELSE 0 END)
        )
      END AS returns_percent,
      COALESCE(SUM(CASE WHEN s.sale_date >= ? AND s.sale_date < ? THEN s.quantity ELSE 0 END), 0) / ? AS average_weekly_quantity
    FROM sales_raw s
    LEFT JOIN products p ON p.sku = s.sku
    WHERE s.sale_date >= ? AND s.sale_date < ?
      AND COALESCE(s.supplier, p.supplier, '') = ?
      AND COALESCE(s.product_desc, p.description, s.sku, '') LIKE ?
    GROUP BY
      COALESCE(NULLIF(TRIM(s.supplier), ''), NULLIF(TRIM(p.supplier), ''), 'ללא ספק'),
      COALESCE(NULLIF(TRIM(s.sku), ''), NULLIF(TRIM(s.product_desc), ''), NULLIF(TRIM(p.description), ''), 'ללא מוצר')
    ORDER BY average_monthly_profit DESC
    LIMIT 500
  `, [
    range.start, range.end, months,
    range.start, range.end, months,
    range.start, range.end,
    range.start, range.end,
    range.start, range.end,
    returnsRange.start, returnsRange.end,
    returnsRange.start, returnsRange.end,
    returnsRange.start, returnsRange.end,
    range.start, range.end, weeks,
    returnsRange.start, returnsRange.end, supplier, query,
  ]);

  renderTable("supplier-analysis-table", rows, [
    baseColumns[0],
    { key: "product", label: "מוצר" },
    ...baseColumns.slice(1),
  ], "supplierAnalysis", "average_monthly_profit", "desc");
}

function renderRecommendations() {
  const rows = queryRows("SELECT id, text, active FROM sales_recommendations ORDER BY id DESC");
  renderTable("recommendations-table", rows, [
    { key: "text", label: "טקסט המלצה" },
    { key: "active", label: "פעיל", render: (row) => row.active ? '<span class="badge">פעיל</span>' : "לא פעיל" },
    { key: "actions", label: "פעולות", render: (row) => `
      <button class="small-action" data-edit="${row.id}">עריכה</button>
      <button class="small-action" data-toggle="${row.id}">${row.active ? "ביטול" : "הפעלה"}</button>
      <button class="danger-action" data-delete="${row.id}">מחיקה</button>
    ` },
  ], "recommendations", "id", "desc");
  document.querySelectorAll("[data-edit]").forEach((button) => button.addEventListener("click", () => editRecommendation(button.dataset.edit)));
  document.querySelectorAll("[data-toggle]").forEach((button) => button.addEventListener("click", () => toggleRecommendation(button.dataset.toggle)));
  document.querySelectorAll("[data-delete]").forEach((button) => button.addEventListener("click", () => deleteRecommendation(button.dataset.delete)));
}

async function saveRecommendation(event) {
  event.preventDefault();
  const id = document.getElementById("recommendation-id").value;
  const textValue = document.getElementById("recommendation-text").value.trim();
  const active = document.getElementById("recommendation-active").checked ? 1 : 0;
  if (!textValue) return;
  if (id) {
    state.db.run("UPDATE sales_recommendations SET text = ?, active = ? WHERE id = ?", [textValue, active, id]);
  } else {
    state.db.run("INSERT INTO sales_recommendations (text, active) VALUES (?, ?)", [textValue, active]);
  }
  await persistDatabase();
  resetRecommendationForm();
  renderRecommendations();
  if (state.selectedCustomer) selectCustomer(state.selectedCustomer);
}

function editRecommendation(id) {
  const row = firstRow("SELECT * FROM sales_recommendations WHERE id = ?", [id]);
  document.getElementById("recommendation-id").value = row.id;
  document.getElementById("recommendation-text").value = row.text;
  document.getElementById("recommendation-active").checked = Boolean(row.active);
}

async function toggleRecommendation(id) {
  state.db.run("UPDATE sales_recommendations SET active = CASE active WHEN 1 THEN 0 ELSE 1 END WHERE id = ?", [id]);
  await persistDatabase();
  renderRecommendations();
  if (state.selectedCustomer) selectCustomer(state.selectedCustomer);
}

async function deleteRecommendation(id) {
  if (!confirm("למחוק את ההמלצה?")) return;
  state.db.run("DELETE FROM sales_recommendations WHERE id = ?", [id]);
  await persistDatabase();
  renderRecommendations();
}

function resetRecommendationForm() {
  document.getElementById("recommendation-id").value = "";
  document.getElementById("recommendation-text").value = "";
  document.getElementById("recommendation-active").checked = true;
}

function renderTable(tableId, rows, columns, sortId, defaultKey, defaultDirection) {
  const table = document.getElementById(tableId);
  const sort = state.sort[sortId] || { key: defaultKey, direction: defaultDirection };
  const sortedRows = [...rows].sort((a, b) => compareValues(a[sort.key], b[sort.key], sort.direction));
  const headers = columns.map((column) => {
    const marker = sort.key === column.key ? (sort.direction === "asc" ? " ▲" : " ▼") : "";
    return `<th class="sortable" data-sort-id="${sortId}" data-key="${column.key}">${column.label}${marker}</th>`;
  }).join("");
  const body = sortedRows.length
    ? sortedRows.map((row) => `<tr>${columns.map((column) => `<td>${cellValue(row, column)}</td>`).join("")}</tr>`).join("")
    : `<tr><td colspan="${columns.length}" class="empty-state">אין נתונים להצגה</td></tr>`;
  table.innerHTML = `<thead><tr>${headers}</tr></thead><tbody>${body}</tbody>`;
  table.querySelectorAll("th.sortable").forEach((th) => {
    th.addEventListener("click", () => {
      const current = state.sort[sortId] || { key: defaultKey, direction: defaultDirection };
      const direction = current.key === th.dataset.key && current.direction === "asc" ? "desc" : "asc";
      state.sort[sortId] = { key: th.dataset.key, direction };
      renderTable(tableId, rows, columns, sortId, defaultKey, defaultDirection);
    });
  });
}

function cellValue(row, column) {
  if (column.render) return column.render(row);
  const value = row[column.key];
  if (column.format) return column.format(value);
  return escapeHtml(value ?? "");
}

function queryRows(sql, params = []) {
  const stmt = state.db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function firstRow(sql, params = []) {
  return queryRows(sql, params)[0] || {};
}

function scalar(sql, params = []) {
  const row = firstRow(sql, params);
  return Object.values(row)[0] || 0;
}

function mapRow(row, mapping) {
  return Object.fromEntries(Object.entries(mapping).map(([key, names]) => [key, rowValue(row, names)]));
}

function rowValue(row, names) {
  const keys = Object.keys(row);
  const wanted = names.map(normalizeHeader);
  const match = keys.find((key) => wanted.includes(normalizeHeader(key)));
  return match ? row[match] : "";
}

function normalizeHeader(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[״"'`׳’‘]/g, "")
    .replace(/[₪()]/g, "")
    .replace(/\s+/g, "")
    .trim();
}

function number(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const cleaned = String(value ?? "").replace(/[,\s₪]/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function text(value) {
  return String(value ?? "").trim();
}

function barcodeValue(value) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(Math.trunc(value)) : "";
  return String(value).trim().replace(/[^\dA-Za-z]/g, "");
}

function inferBarcode(row) {
  const skip = new Set(["sku", "מק\"ט", "מקט", "description", "תאור", "תיאור", "supplier", "ספק", "שם ספק"]);
  return Object.entries(row).find(([key, value]) => {
    if (skip.has(normalizeHeader(key))) return false;
    const candidate = barcodeValue(value);
    return /^\d{8,14}$/.test(candidate);
  })?.[1] || "";
}

function parseDate(value) {
  if (!value) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) return toSqlDate(value);
  if (typeof value === "number") {
    const date = XLSX.SSF.parse_date_code(value);
    if (!date) return "";
    return toSqlDate(new Date(date.y, date.m - 1, date.d));
  }
  const raw = String(value).trim();
  const monthYear = raw.match(/^(\d{1,2})[./-](\d{2,4})$/);
  if (monthYear) {
    const year = Number(monthYear[2].length === 2 ? `20${monthYear[2]}` : monthYear[2]);
    return toSqlDate(new Date(year, Number(monthYear[1]) - 1, 1));
  }
  const yearMonth = raw.match(/^(\d{4})[./-](\d{1,2})$/);
  if (yearMonth) {
    return toSqlDate(new Date(Number(yearMonth[1]), Number(yearMonth[2]) - 1, 1));
  }
  const parts = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (parts) {
    const year = Number(parts[3].length === 2 ? `20${parts[3]}` : parts[3]);
    return toSqlDate(new Date(year, Number(parts[2]) - 1, Number(parts[1])));
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? "" : toSqlDate(parsed);
}

function toSqlDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateRange(months) {
  const end = firstDayOfCurrentMonth();
  const start = addMonths(end, -months);
  return { start: toSqlDate(start), end: toSqlDate(end) };
}

function currentInclusiveRange(months) {
  const start = addMonths(firstDayOfCurrentMonth(), -months);
  const end = addMonths(firstDayOfCurrentMonth(), 1);
  return { start: toSqlDate(start), end: toSqlDate(end) };
}

function firstDayOfCurrentMonth() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function firstDayOfPreviousMonth() {
  return addMonths(firstDayOfCurrentMonth(), -1);
}

function addMonths(date, months) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function monthKey(date) {
  return toSqlDate(date).slice(0, 7);
}

function compareValues(a, b, direction) {
  const left = typeof a === "number" ? a : String(a ?? "");
  const right = typeof b === "number" ? b : String(b ?? "");
  const result = typeof left === "number" && typeof right === "number"
    ? left - right
    : left.localeCompare(right, "he");
  return direction === "asc" ? result : -result;
}

function currency(value) {
  return new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS", maximumFractionDigits: 0 }).format(number(value));
}

function currency2(value) {
  return new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(number(value));
}

function percent(value) {
  return `${new Intl.NumberFormat("he-IL", { maximumFractionDigits: 1 }).format(number(value) * 100)}%`;
}

function integer(value) {
  return new Intl.NumberFormat("he-IL", { maximumFractionDigits: 0 }).format(number(value));
}

function numberDisplay(value) {
  return new Intl.NumberFormat("he-IL", { maximumFractionDigits: 2 }).format(number(value));
}

function fillSelect(id, placeholder, rows) {
  const select = document.getElementById(id);
  const current = select.value;
  select.innerHTML = `<option value="">${placeholder}</option>${rows.map((row) => `<option value="${escapeAttr(row.value)}">${escapeHtml(row.value)}</option>`).join("")}`;
  select.value = [...select.options].some((option) => option.value === current) ? current : "";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

function debounce(fn, delay) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), delay);
  };
}

function setStatus(textValue) {
  document.getElementById("import-status").textContent = textValue;
}

async function readSavedDatabase(SQL) {
  const browserData = await readBrowserDatabase();
  const browserVersion = await databaseVersionFromBytes(browserData);
  if (browserVersion) {
    state.databaseVersion = browserVersion;
    localStorage.setItem("databaseVersion", browserVersion);
  }
  const serverData = await readServerDatabase();
  if (serverData) return { data: serverData, source: "server" };
  if (browserData) return { data: browserData, source: "browser" };
  return null;
}

async function databaseVersionFromBytes(data) {
  if (!data || !globalThis.crypto?.subtle) return "";
  try {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", data);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  } catch {
    return "";
  }
}

function databaseScore(SQL, data) {
  if (!data) return -1;
  let db;
  try {
    db = new SQL.Database(data);
    return tableCount(db, "sales_raw") * 1000 + tableCount(db, "products") * 10 + tableCount(db, "sales_recommendations");
  } catch (error) {
    return -1;
  } finally {
    if (db) db.close();
  }
}

function tableCount(db, table) {
  try {
    const result = db.exec(`SELECT COUNT(*) AS count FROM ${table}`);
    return Number(result[0]?.values?.[0]?.[0] || 0);
  } catch (error) {
    return 0;
  }
}

async function readServerDatabase() {
  try {
    const knownVersion = state.databaseVersion || localStorage.getItem("databaseVersion") || "";
    const headers = knownVersion ? { "If-None-Match": `"${knownVersion}"` } : {};
    const response = await fetch("/api/db", { cache: "no-store", headers });
    if (response.status === 304) return null;
    if (!response.ok) return null;
    state.databaseVersion = response.headers.get("X-Database-Version") || "";
    if (state.databaseVersion) localStorage.setItem("databaseVersion", state.databaseVersion);
    return new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    console.warn("לא ניתן לטעון בסיס נתונים מהשרת", error);
    return null;
  }
}

function readBrowserDatabase() {
  return new Promise((resolve) => {
    const request = indexedDB.open(DB_KEY, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("files");
    request.onsuccess = () => {
      const tx = request.result.transaction("files", "readonly");
      const get = tx.objectStore("files").get("db");
      get.onsuccess = () => resolve(get.result || null);
      get.onerror = () => resolve(null);
    };
    request.onerror = () => resolve(null);
  });
}

async function persistDatabase() {
  const data = state.db.export();
  const [, server] = await Promise.all([writeBrowserDatabase(data), writeServerDatabase(data)]);
  return { server };
}

function writeBrowserDatabase(data) {
  return new Promise((resolve) => {
    const request = indexedDB.open(DB_KEY, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("files");
    request.onsuccess = () => {
      const tx = request.result.transaction("files", "readwrite");
      tx.objectStore("files").put(data, "db");
      tx.oncomplete = resolve;
      tx.onerror = resolve;
    };
    request.onerror = resolve;
  });
}

async function writeServerDatabase(data) {
  try {
    const headers = { "Content-Type": "application/octet-stream" };
    if (state.databaseVersion) headers["If-Match"] = state.databaseVersion;
    const response = await fetch("/api/db", {
      method: "POST",
      headers,
      body: data,
    });
    const nextVersion = response.headers.get("X-Database-Version") || "";
    if (response.ok) {
      if (nextVersion) state.databaseVersion = nextVersion;
      if (nextVersion) localStorage.setItem("databaseVersion", nextVersion);
      return { ok: true };
    }
    if (response.status === 409) {
      if (nextVersion) state.databaseVersion = nextVersion;
      return { ok: false, conflict: true, error: "הנתונים בשרת השתנו. צריך לרענן לפני שמירה כדי לא לדרוס עבודה ממחשב אחר." };
    }
    return { ok: false, error: await response.text() };
  } catch (error) {
    console.warn("לא ניתן לשמור בסיס נתונים בשרת", error);
    return { ok: false, error: error.message };
  }
}

async function reloadDatabaseFromServer() {
  const data = await readServerDatabase();
  if (!data) return false;
  const SQL = await window.initSqlJs({ locateFile: (file) => SQL_WASM + file });
  if (state.db) state.db.close();
  state.db = new SQL.Database(data);
  createSchema();
  rebuildSummaryTables();
  await writeBrowserDatabase(data);
  return true;
}
