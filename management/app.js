const DB_KEY = "hebrew-sales-analytics-db";
const SQL_WASM = "https://cdn.jsdelivr.net/npm/sql.js@1.10.3/dist/";
const ORDER_STATUSES = ["מוכן לאיסוף", "נאסף", "מוכן למשלוח"];
const CALL_DAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי"];
const CALL_DAY_INDEX = { "ראשון": 0, "שני": 1, "שלישי": 2, "רביעי": 3, "חמישי": 4 };
const CALL_DAY_SHORT = { "ראשון": "א׳", "שני": "ב׳", "שלישי": "ג׳", "רביעי": "ד׳", "חמישי": "ה׳" };
const WEEKLY_CALL_RESET_HOUR = 23;
const CALL_DAY_ALIASES = {
  "א": "ראשון",
  "א׳": "ראשון",
  "א'": "ראשון",
  "ראשון": "ראשון",
  "ב": "שני",
  "ב׳": "שני",
  "ב'": "שני",
  "שני": "שני",
  "ג": "שלישי",
  "ג׳": "שלישי",
  "ג'": "שלישי",
  "שלישי": "שלישי",
  "ד": "רביעי",
  "ד׳": "רביעי",
  "ד'": "רביעי",
  "רביעי": "רביעי",
  "ה": "חמישי",
  "ה׳": "חמישי",
  "ה'": "חמישי",
  "חמישי": "חמישי",
};
const CALL_STATUS_META = {
  pending: { label: "בטיפול", className: "pending" },
  ordered: { label: "ביצע הזמנה", className: "ordered" },
  no_need: { label: "לא צריך", className: "no-need" },
  no_answer: { label: "לא ענה", className: "no-answer" },
  call_again: { label: "לחזור", className: "call-again" },
};
const CALL_MESSAGE_TEMPLATES = [
  { id: "weekly", title: "הזמנה שבועית", text: "היי {שם}, מתקשרים ממעדניית רנה לגבי ההזמנה השבועית." },
  { id: "no-answer", title: "לא ענה", text: "היי {שם}, ניסינו להשיג אותך ממעדניית רנה. תרצה לבצע הזמנה לשבוע?" },
  { id: "order-until", title: "אפשר להזמין עד שעה", text: "היי {שם}, מזכירים שאפשר לשלוח הזמנה עד שעה 16:00. תודה, מעדניית רנה" },
  { id: "missing", title: "השלמת חוסרים", text: "היי {שם}, רצינו לעדכן לגבי חוסרים מההזמנה ולבדוק אם תרצה השלמה." },
];

const state = {
  db: null,
  productsSource: "sqlite",
  callsSource: "sqlite",
  postgresCallRows: [],
  sort: {},
  dashboardMonths: 6,
  analysisMonths: 6,
  customerMonths: 6,
  selectedCustomer: null,
  orderCustomer: null,
  orderItems: [],
  removedOrderSkus: new Set(),
  pendingProduct: null,
  suppressProductFocusResults: false,
  expandedPickingOrderId: null,
  selectedPickingOrderId: null,
  substituteItemId: null,
  pickingProductMode: null,
  selectedPickingProduct: null,
  addPickingCustomerNo: "",
  processDetailOrderId: null,
  nextOrderLineId: 1,
  cartonItemId: null,
  pickingMode: "orders",
  selectedPickingProductSku: "",
  selectedPickingCategory: "",
  pickingProductQuery: "",
  orderProductActiveIndex: -1,
  callsDay: "ראשון",
  callsFilter: "",
  expandedCallCustomerNo: "",
  selectedCallCustomers: new Set(),
  selectedProcessOrders: new Set(),
  selectedMissedOrders: new Set(),
  processTab: "pending",
  invoiceRows: [],
  manualInvoiceProduct: null,
  persistTimer: null,
  serverSaveInProgress: false,
  pendingPickingChanges: [],
  callTemplates: loadCallTemplates(),
  selectedCallTemplateId: "weekly",
  callResetTimer: null,
};

const screens = {
  dashboard: { title: "דשבורד", subtitle: "ברירת מחדל: 6 חודשים מלאים אחרונים" },
  "customer-search": { title: "ניתוח לקוחות", subtitle: "ניתוח לקוחות לפי 3 / 6 / 12 חודשים מלאים, ספק, קטגוריה ומוצר" },
  "customer-analysis": { title: "ניתוח לקוחות", subtitle: "ברירת מחדל: 6 חודשים אחרונים" },
  "order-create": { title: "יצירת הזמנה", subtitle: "חישוב לפי מחיר ממוצע ללקוח" },
  picking: { title: "ליקוט הזמנות", subtitle: "עדכון כמות יחידות שלוקטו" },
  "order-history": { title: "הזמנות בתהליך", subtitle: "שלבי יצוא, חשבונית ומשלוח" },
  calls: { title: "ניהול שיחות", subtitle: "תיעוד שיחות לקוח" },
  products: { title: "מוצרים", subtitle: "חיפוש וסינון מוצרים" },
  reports: { title: "דוחות", subtitle: "בדיקת חשבוניות ודוחות תפעוליים" },
  recommendations: { title: "המלצות מכירה", subtitle: "ניהול המלצות פעילות לכרטיס לקוח" },
};

const screenIcons = {
  dashboard: "🏠",
  "customer-search": "👥",
  "customer-analysis": "📊",
  "order-create": "📦",
  picking: "📋",
  "order-history": "🚚",
  calls: "📞",
  products: "📦",
  reports: "📊",
  recommendations: "📊",
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
  address: ["כתובת", "כתובת לקוח", "מען"],
  sale_date: ["תאריך", "תאריך מכירה", "חודש", "תאריך חשבונית"],
};

const productColumns = {
  sku: ['מק"ט', "מקט"],
  description: ["תאור", "תיאור"],
  category: ["תאור משפחה", "תיאור משפחה"],
  standard_cost: ['עלות תקן ש"ח', "עלות תקן"],
  purchase_price: ["מחיר קניה אחרון", "מחיר קניה", "מחיר קנייה"],
  base_price: ["מחיר מחירון בסיס"],
  weight: ["משקל"],
  supplier: ["שם ספק"],
  pick_order: ["סדר ליקוט", "סדר", "M", "קוד מיון"],
  units_per_carton: ["יחידות בקרטון", "כמות בקרטון", "יח' בקרטון", "מספר יחידות בקרטון"],
};

const callCustomerColumns = {
  customer_no: ["מס' לקוח", "מספר לקוח", "לקוח", "קוד לקוח"],
  customer_name: ["שם לקוח", "שם הלקוח", "שם עסק", "שם העסק", "שם"],
  contact: ["איש קשר", "שם איש קשר"],
  phone: ["טלפון", "נייד", "פלאפון"],
  phone2: ["טלפון נוסף", "נייד נוסף"],
  city: ["עיר"],
  address: ["כתובת", "כתובת לקוח", "מען"],
  days: ["ימי שיחה", "יום שיחה", "יום", "ימים"],
};

function loadCallTemplates() {
  try {
    const saved = JSON.parse(localStorage.getItem("callMessageTemplatesV1") || "null");
    return Array.isArray(saved) && saved.length ? saved : CALL_MESSAGE_TEMPLATES;
  } catch {
    return CALL_MESSAGE_TEMPLATES;
  }
}

function saveCallTemplates() {
  localStorage.setItem("callMessageTemplatesV1", JSON.stringify(state.callTemplates));
}

document.addEventListener("DOMContentLoaded", init);

async function init() {
  setStatus("טוען בסיס נתונים");
  await initDatabase();
  if (!state.db) return;
  bindEvents();
  await refreshAll();
  await runScheduledCallReset({ refresh: true });
  startWeeklyCallResetTimer();
  setStatus("מוכן לעבודה");
}

async function initDatabase() {
  setStatus("טוען ספריית SQL");
  if (!window.initSqlJs) {
    setStatus("ספריית SQL לא נטענה");
    return;
  }
  const SQL = await window.initSqlJs({ locateFile: (file) => SQL_WASM + file });
  setStatus("קורא בסיס נתונים");
  const saved = await readSavedDatabase(SQL);
  setStatus("פותח בסיס נתונים");
  state.db = saved?.data ? new SQL.Database(saved.data) : new SQL.Database();
  setStatus("בודק מבנה נתונים");
  createSharedSchema();
  createManagementSchema();
  ensureSummaryTables();
  if (!saved?.data) seedRecommendations();
}

function ensureSummaryTables() {
  state.db.run(`
    CREATE TABLE IF NOT EXISTS customer_product_summary (
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
    CREATE TABLE IF NOT EXISTS customer_profitability_summary (
      customer_no TEXT PRIMARY KEY,
      customer_name TEXT,
      sales_amount REAL,
      profit REAL,
      return_units REAL,
      purchase_units REAL,
      last_sale_date TEXT
    );
  `);
}

function createSharedSchema() {
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
      description TEXT,
      category TEXT,
      standard_cost REAL DEFAULT 0,
      base_price REAL DEFAULT 0,
      weight REAL DEFAULT 0,
      supplier TEXT,
      pick_order REAL DEFAULT 999999,
      units_per_carton REAL DEFAULT 1,
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
    CREATE INDEX IF NOT EXISTS idx_sales_date ON sales_raw (sale_date);
    CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales_raw (customer_no, customer_name);
    CREATE INDEX IF NOT EXISTS idx_sales_sku ON sales_raw (sku);
    CREATE INDEX IF NOT EXISTS idx_sales_period_customer ON sales_raw (sale_date, customer_no);
    CREATE INDEX IF NOT EXISTS idx_products_supplier ON products (supplier);
    CREATE INDEX IF NOT EXISTS idx_products_category ON products (category);
  `);
}

function createManagementSchema() {
  state.db.run(`
    CREATE TABLE IF NOT EXISTS customer_calls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      call_date TEXT NOT NULL,
      customer_no TEXT,
      customer_name TEXT,
      status TEXT,
      call_again_time TEXT,
      whatsapp_sent_at TEXT,
      manual_order_id INTEGER,
      notes TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS customer_call_profiles (
      customer_no TEXT PRIMARY KEY,
      customer_name TEXT,
      contact TEXT,
      phone TEXT,
      phone2 TEXT,
      city TEXT,
      address TEXT,
      days TEXT,
      source TEXT DEFAULT 'calls',
      updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS customer_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_date TEXT NOT NULL,
      customer_no TEXT,
      customer_name TEXT,
      status TEXT NOT NULL,
      notes TEXT,
      estimated_total REAL DEFAULT 0,
      estimated_profit REAL DEFAULT 0,
      picked_by TEXT,
      picked_at TEXT,
      invoice_printed INTEGER NOT NULL DEFAULT 0,
      shipped_at TEXT,
      process_hidden INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS customer_order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      sku TEXT,
      product_desc TEXT,
      quantity REAL DEFAULT 0,
      picked_quantity REAL DEFAULT 0,
      note TEXT,
      item_status TEXT NOT NULL DEFAULT 'pending',
      substitute_product_id TEXT,
      action_sequence INTEGER,
      entry_sequence INTEGER,
      is_carton INTEGER NOT NULL DEFAULT 0,
      units_per_carton REAL DEFAULT 1,
      shortage_dismissed INTEGER NOT NULL DEFAULT 0,
      estimated_price REAL DEFAULT 0,
      estimated_profit REAL DEFAULT 0,
      FOREIGN KEY (order_id) REFERENCES customer_orders(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_calls_customer ON customer_calls (customer_no, call_date);
    CREATE INDEX IF NOT EXISTS idx_calls_day ON customer_calls (customer_no, call_date);
    CREATE INDEX IF NOT EXISTS idx_orders_customer ON customer_orders (customer_no, order_date);
    CREATE INDEX IF NOT EXISTS idx_order_items_order ON customer_order_items (order_id);
  `);
  ensureColumn("products", "pick_order", "REAL DEFAULT 999999");
  ensureColumn("products", "units_per_carton", "REAL DEFAULT 1");
  ensureColumn("customer_calls", "call_again_time", "TEXT");
  ensureColumn("customer_calls", "whatsapp_sent_at", "TEXT");
  ensureColumn("customer_calls", "manual_order_id", "INTEGER");
  ensureColumn("customer_call_profiles", "address", "TEXT");
  ensureColumn("customer_call_profiles", "source", "TEXT DEFAULT 'calls'");
  ensureColumn("customer_orders", "notes", "TEXT");
  ensureColumn("customer_orders", "picked_by", "TEXT");
  ensureColumn("customer_orders", "picked_at", "TEXT");
  ensureColumn("customer_orders", "invoice_printed", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("customer_orders", "shipped_at", "TEXT");
  ensureColumn("customer_orders", "process_hidden", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("customer_orders", "client_order_key", "TEXT");
  state.db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_client_key ON customer_orders (client_order_key)");
  ensureColumn("customer_order_items", "item_status", "TEXT NOT NULL DEFAULT 'pending'");
  ensureColumn("customer_order_items", "substitute_product_id", "TEXT");
  ensureColumn("customer_order_items", "action_sequence", "INTEGER");
  ensureColumn("customer_order_items", "entry_sequence", "INTEGER");
  ensureColumn("customer_order_items", "is_carton", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("customer_order_items", "units_per_carton", "REAL DEFAULT 1");
  ensureColumn("customer_order_items", "shortage_dismissed", "INTEGER NOT NULL DEFAULT 0");
  state.db.run("CREATE INDEX IF NOT EXISTS idx_order_items_status ON customer_order_items (order_id, item_status)");
}

function ensureColumn(table, column, definition) {
  const exists = queryRows(`PRAGMA table_info(${table})`).some((row) => row.name === column);
  if (!exists) state.db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
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

function seedRecommendations() {
  if (scalar("SELECT COUNT(*) FROM sales_recommendations") > 0) return;
  const stmt = state.db.prepare("INSERT INTO sales_recommendations (text, active) VALUES (?, 1)");
  ["בדוק מוצרים משלימים לפי הקניות האחרונות", "הצע חידוש מלאי למוצרים קבועים", "בדוק מוצרים רווחיים אצל לקוחות דומים"].forEach((textValue) => stmt.run([textValue]));
  stmt.free();
}

function bindEvents() {
  document.querySelectorAll(".nav-item").forEach((button) => button.addEventListener("click", () => showScreen(button.dataset.screen)));
  document.getElementById("menu-toggle").addEventListener("click", () => document.querySelector(".sidebar").classList.toggle("open"));
  document.getElementById("import-sales").addEventListener("click", () => document.getElementById("sales-file").click());
  document.getElementById("import-products").addEventListener("click", () => document.getElementById("products-file").click());
  document.getElementById("sales-file").addEventListener("change", (event) => importFile(event, "sales"));
  document.getElementById("products-file").addEventListener("change", (event) => importFile(event, "products"));
  document.getElementById("import-call-customers").addEventListener("click", () => document.getElementById("calls-customers-file").click());
  document.getElementById("calls-customers-file").addEventListener("change", importCallCustomersFile);
  document.getElementById("toggle-call-templates").addEventListener("click", toggleCallTemplateEditor);
  document.getElementById("reset-call-day").addEventListener("click", resetCurrentCallDay);
  document.getElementById("call-template-select").addEventListener("change", () => loadSelectedCallTemplate(document.getElementById("call-template-select").value));
  document.getElementById("save-call-template").addEventListener("click", saveCurrentCallTemplate);
  document.getElementById("new-call-template").addEventListener("click", startNewCallTemplate);
  document.getElementById("delete-call-template").addEventListener("click", deleteCurrentCallTemplate);
  document.getElementById("customer-search-button").addEventListener("click", searchCustomers);
  document.getElementById("customer-query").addEventListener("input", debounce(searchCustomers, 250));
  ["customer-supplier-filter", "customer-category-filter", "customer-product-filter"].forEach((id) => document.getElementById(id).addEventListener("input", () => {
    searchCustomers();
    if (state.selectedCustomer) renderCustomerProducts(state.selectedCustomer.customer_no);
  }));
  document.getElementById("customer-card-order").addEventListener("click", startOrderFromCustomerCard);
  document.getElementById("analysis-query").addEventListener("input", debounce(renderCustomerAnalysis, 250));
  document.querySelectorAll(".segmented button").forEach((button) => {
    button.addEventListener("click", () => {
      const target = button.closest(".segmented").dataset.periodTarget;
      if (!target) return;
      button.closest(".segmented").querySelectorAll("button").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      if (target === "dashboard") {
        state.dashboardMonths = Number(button.dataset.months);
        renderDashboard();
      } else if (target === "customers") {
        state.customerMonths = Number(button.dataset.months);
        searchCustomers();
        if (state.selectedCustomer) renderCustomerProducts(state.selectedCustomer.customer_no);
      } else {
        state.analysisMonths = Number(button.dataset.months);
        renderCustomerAnalysis();
      }
    });
  });
  ["product-query", "supplier-filter", "category-filter"].forEach((id) => document.getElementById(id).addEventListener("input", () => renderProducts()));
  document.getElementById("compare-products-button").addEventListener("click", renderProductComparison);
  document.getElementById("compare-product-a").addEventListener("change", renderProductComparison);
  document.getElementById("compare-product-b").addEventListener("change", renderProductComparison);
  document.getElementById("invoice-product-query").addEventListener("input", debounce(renderInvoiceProductResults, 120));
  document.getElementById("invoice-product-query").addEventListener("focus", renderInvoiceProductResults);
  document.getElementById("invoice-product-query").addEventListener("keydown", handleInvoiceProductKeydown);
  document.getElementById("invoice-product-results").addEventListener("mousedown", handleInvoiceProductResult);
  document.getElementById("invoice-manual-discount").addEventListener("input", renderManualInvoiceComparison);
  document.getElementById("invoice-manual-price").addEventListener("input", renderManualInvoiceComparison);
  document.getElementById("returns-report-run").addEventListener("click", renderSupplierReturnsReport);
  ["returns-report-period", "returns-report-supplier"].forEach((id) => document.getElementById(id).addEventListener("change", renderSupplierReturnsReport));
  document.getElementById("recommendation-form").addEventListener("submit", saveRecommendation);
  document.getElementById("recommendation-reset").addEventListener("click", resetRecommendationForm);
  document.getElementById("order-customer-query").addEventListener("input", debounce(renderOrderCustomerResults, 150));
  document.getElementById("order-customer-query").addEventListener("focus", renderOrderCustomerResults);
  document.getElementById("order-product-query").addEventListener("input", debounce(renderOrderProductResults, 150));
  document.getElementById("order-product-query").addEventListener("focus", renderOrderProductResults);
  document.getElementById("order-product-query").addEventListener("keydown", handleOrderProductKeydown);
  document.getElementById("order-customer-results").addEventListener("mousedown", handleOrderCustomerResult);
  document.getElementById("order-product-results").addEventListener("mousedown", handleOrderProductResult);
  document.getElementById("product-modal-confirm").addEventListener("click", confirmProductDialog);
  document.getElementById("modal-product-quantity").addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    confirmProductDialog();
  });
  document.getElementById("product-modal-cancel").addEventListener("click", closeProductDialog);
  document.getElementById("product-modal-close").addEventListener("click", closeProductDialog);
  document.getElementById("substitute-modal-cancel").addEventListener("click", closeSubstituteDialog);
  document.getElementById("substitute-modal-close").addEventListener("click", closeSubstituteDialog);
  document.getElementById("substitute-modal-confirm").addEventListener("click", confirmPickingProductDialog);
  document.getElementById("carton-modal-cancel").addEventListener("click", closeCartonDialog);
  document.getElementById("carton-modal-close").addEventListener("click", closeCartonDialog);
  document.getElementById("carton-modal-confirm").addEventListener("click", confirmCartonPicking);
  document.getElementById("substitute-query").addEventListener("input", debounce(renderSubstituteResults, 150));
  document.getElementById("substitute-results").addEventListener("mousedown", handleSubstituteResult);
  document.querySelectorAll("[data-picking-mode]").forEach((button) => button.addEventListener("click", () => {
    state.pickingMode = button.dataset.pickingMode;
    renderPicking();
  }));
  document.getElementById("picking-product-query").addEventListener("input", debounce((event) => {
    state.pickingProductQuery = event.target.value.trim();
    state.selectedPickingProductSku = "";
    renderPickingByProduct();
  }, 150));
  document.getElementById("picking-product-select").addEventListener("change", (event) => {
    state.selectedPickingProductSku = event.target.value;
    renderPickingByProduct();
  });
  document.getElementById("picking-category-select").addEventListener("change", (event) => {
    state.selectedPickingCategory = event.target.value;
    state.selectedPickingProductSku = "";
    renderPickingByProduct();
  });
  document.getElementById("picking-save").addEventListener("click", () => savePickingNow());
  document.getElementById("order-save").addEventListener("click", saveOrder);
  document.getElementById("order-reset").addEventListener("click", resetOrder);
  document.getElementById("history-query").addEventListener("input", debounce(renderOrderHistory, 250));
  document.getElementById("export-selected-priority").addEventListener("click", exportSelectedPriorityOrders);
  document.getElementById("select-all-picked-orders").addEventListener("click", selectAllPickedProcessOrders);
  document.getElementById("clear-selected-orders").addEventListener("click", () => {
    state.selectedProcessOrders.clear();
    renderOrderHistory();
  });
  document.getElementById("select-all-shipping-orders").addEventListener("click", selectAllShippingProcessOrders);
  document.getElementById("clear-selected-shipping-orders").addEventListener("click", () => {
    state.selectedProcessOrders.clear();
    renderOrderHistory();
  });
  document.getElementById("mark-selected-shipped").addEventListener("click", markSelectedShippingOrdersShipped);
  document.getElementById("hide-selected-shipping-orders").addEventListener("click", hideSelectedShippingOrders);
  document.querySelectorAll("[data-process-tab]").forEach((button) => button.addEventListener("click", () => {
    state.processTab = button.dataset.processTab;
    renderOrderHistory();
  }));
  document.getElementById("call-form").addEventListener("submit", saveCall);
  document.getElementById("call-reset").addEventListener("click", resetCallForm);
  document.getElementById("call-customer-query").addEventListener("input", debounce(refreshCallCustomerSelect, 200));
  document.addEventListener("click", closeAutocompleteOnOutsideClick);
  bindPullToRefresh();
}

async function refreshAll() {
  renderDashboard();
  refreshCustomerAnalysisFilters();
  searchCustomers();
  renderCustomerAnalysis();
  await refreshProductFilters();
  refreshProductCompareOptions();
  refreshReportFilters();
  await renderProducts();
  renderSupplierReturnsReport();
  refreshOrderSelectors();
  renderOrderTables();
  await renderPicking();
  await renderOrderHistory();
  refreshCallCustomerSelect();
  await renderCalls();
  renderRecommendations();
}

function showScreen(id) {
  document.querySelectorAll(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.screen === id));
  document.querySelectorAll(".screen").forEach((screen) => screen.classList.toggle("active-screen", screen.id === id));
  document.getElementById("screen-title").textContent = screens[id].title;
  document.getElementById("screen-subtitle").textContent = screens[id].subtitle;
  const icon = document.getElementById("screen-icon");
  if (icon) icon.textContent = screenIcons[id] || "📊";
  document.querySelector(".sidebar").classList.remove("open");
  if (id === "dashboard") renderDashboard();
  if (id === "customer-search") searchCustomers();
  if (id === "customer-analysis") renderCustomerAnalysis();
  if (id === "products") renderProducts();
  if (id === "reports") {
    refreshReportFilters();
    renderSupplierReturnsReport();
  }
  if (id === "order-create") refreshOrderSelectors();
  if (id === "picking") renderPicking();
  if (id === "order-history") renderOrderHistory();
  if (id === "calls") renderCalls();
  if (id === "recommendations") renderRecommendations();
}

async function importFile(event, type) {
  const file = event.target.files[0];
  if (!file) return;
  try {
    setStatus("קורא קובץ");
    const rows = await readWorkbook(file);
    if (type === "sales") importSalesRows(rows);
    if (type === "products") {
      const importedProducts = importProductRows(rows);
      await importProductsToPostgres(importedProducts);
    }
    rebuildSummaryTables();
    const persisted = await persistDatabase();
    await refreshAll();
    setStatus(persisted.server.ok ? `הייבוא הסתיים: ${rows.length.toLocaleString("he-IL")} שורות` : "הייבוא נשמר בדפדפן בלבד");
    if (!persisted.server.ok) alert("הנתונים נשמרו בדפדפן בלבד. יש לבדוק שמירה לשרת.");
  } catch (error) {
    console.error(error);
    setStatus("שגיאה בייבוא הקובץ");
    alert("שגיאה בייבוא הקובץ. יש לבדוק שהעמודות תואמות למפרט.");
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

function readWorkbookAllSheets(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const workbook = XLSX.read(reader.result, { type: "array", cellDates: true });
        resolve(workbook.SheetNames.map((name) => ({
          name,
          rows: XLSX.utils.sheet_to_json(workbook.Sheets[name], { defval: "", header: 1, raw: false }),
        })));
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
      text(mapped.customer_no), text(mapped.customer_name), text(mapped.sku), text(mapped.product_desc),
      number(mapped.quantity), number(mapped.sales_amount), number(mapped.cost), number(mapped.profit),
      text(mapped.supplier), text(mapped.category), number(mapped.return_units), number(mapped.purchase_units),
      text(mapped.agent), parseDate(mapped.sale_date) || defaultDate, now,
    ]);
  });
  state.db.run("COMMIT");
  stmt.free();
}

function importProductRows(rows) {
  const now = new Date().toISOString();
  const products = [];
  const stmt = state.db.prepare(`
    INSERT INTO products
    (sku, description, category, standard_cost, base_price, weight, supplier, pick_order, units_per_carton, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(sku) DO UPDATE SET
      description = excluded.description,
      category = excluded.category,
      standard_cost = excluded.standard_cost,
      base_price = excluded.base_price,
      weight = excluded.weight,
      supplier = excluded.supplier,
      pick_order = excluded.pick_order,
      units_per_carton = excluded.units_per_carton,
      updated_at = excluded.updated_at
  `);
  state.db.run("BEGIN TRANSACTION");
  state.db.run("DELETE FROM products");
  rows.forEach((row) => {
    const mapped = mapRow(row, productColumns);
    if (!mapped.sku) return;
    const product = {
      sku: text(mapped.sku),
      description: text(mapped.description),
      category: text(mapped.category),
      standard_cost: number(mapped.standard_cost),
      sale_price: number(mapped.base_price),
      weight: number(mapped.weight),
      supplier: text(mapped.supplier),
      pick_order: pickOrderValue(row, mapped),
      units_per_carton: number(mapped.units_per_carton) || 1,
      updated_at: now,
    };
    product.purchase_price = product.standard_cost;
    products.push(product);
    stmt.run([product.sku, product.description, product.category, product.standard_cost, product.sale_price, product.weight, product.supplier, product.pick_order, product.units_per_carton, now]);
  });
  state.db.run("COMMIT");
  stmt.free();
  return [...new Map(products.map((product) => [product.sku, product])).values()];
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

async function importCallCustomersFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  try {
    document.getElementById("calls-import-status").textContent = "קורא קובץ...";
    const sheets = await readWorkbookAllSheets(file);
    const importedProfiles = importCallCustomerSheets(sheets);
    const imported = importedProfiles.length;
    await importCallCustomerProfilesToPostgres(importedProfiles);
    await persistDatabase();
    await renderCalls();
    document.getElementById("calls-import-status").textContent = `נטענו ${integer(imported)} לקוחות לשיחות`;
  } catch (error) {
    console.error(error);
    document.getElementById("calls-import-status").textContent = "שגיאה בטעינת לקוחות";
    alert("לא הצלחתי לטעון את קובץ הלקוחות לשיחות. יש לבדוק עמודות מספר לקוח ושם לקוח.");
  } finally {
    event.target.value = "";
  }
}

function importCallCustomerSheets(sheets) {
  const now = new Date().toISOString();
  const byCustomer = new Map();
  sheets.forEach((sheet) => {
    const sheetDay = dayFromText(sheet.name);
    const parsed = parseCallCustomerSheet(sheet.rows);
    parsed.rows.forEach((row) => {
      const customerNo = text(row.customer_no);
      const customerName = text(row.customer_name);
      if (!customerNo) return;
      const key = customerNo;
      const existing = byCustomer.get(key) || {};
      const days = new Set([...(existing.days || []), ...normalizeCallDays(row.days), ...(sheetDay ? [sheetDay] : [])]);
      byCustomer.set(key, {
        customer_no: customerNo,
        customer_name: customerName || existing.customer_name || customerNo,
        contact: text(row.contact) || existing.contact || "",
        phone: text(row.phone) || existing.phone || "",
        phone2: text(row.phone2) || existing.phone2 || "",
        city: text(row.city) || existing.city || "",
        address: text(row.address) || existing.address || "",
        days: [...days],
      });
    });
  });
  const stmt = state.db.prepare(`
    INSERT INTO customer_call_profiles (customer_no, customer_name, contact, phone, phone2, city, address, days, source, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'calls', ?)
    ON CONFLICT(customer_no) DO UPDATE SET
      customer_name = excluded.customer_name,
      contact = excluded.contact,
      phone = excluded.phone,
      phone2 = excluded.phone2,
      city = excluded.city,
      address = excluded.address,
      days = excluded.days,
      source = 'calls',
      updated_at = excluded.updated_at
  `);
  state.db.run("BEGIN TRANSACTION");
  state.db.run("DELETE FROM customer_call_profiles WHERE COALESCE(source, 'calls') = 'calls'");
  byCustomer.forEach((customer) => {
    stmt.run([
      customer.customer_no,
      customer.customer_name,
      customer.contact,
      customer.phone,
      customer.phone2,
      customer.city,
      customer.address,
      customer.days.filter((day) => CALL_DAYS.includes(day)).join(","),
      now,
    ]);
  });
  state.db.run("COMMIT");
  stmt.free();
  return [...byCustomer.values()].map((customer) => ({
    ...customer,
    days: customer.days.filter((day) => CALL_DAYS.includes(day)).join(","),
  }));
}

async function importCallCustomerProfilesToPostgres(profiles) {
  if (!profiles.length) return { ok: true, imported: 0 };
  const response = await fetch("/api/postgres/call-profiles-import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profiles }),
  });
  const data = await response.json().catch(() => ({}));
  if (data.configured === false) return data;
  if (!response.ok || !data.ok) {
    throw new Error(data.error || "ייבוא הלקוחות ל-Supabase נכשל");
  }
  return data;
}

function parseCallCustomerSheet(rows) {
  const headerIndex = rows.findIndex((row) => {
    const values = row.map((value) => normalizeHeader(value));
    return values.some((value) => ["מספרלקוח", "קוד", "קודלקוח"].includes(value)) && values.includes("שםלקוח");
  });
  if (headerIndex < 0) return { rows: [] };
  const headers = rows[headerIndex].map((value) => normalizeHeader(value));
  const indexFor = (...names) => {
    const normalized = names.map(normalizeHeader);
    return headers.findIndex((header) => normalized.includes(header));
  };
  const indexes = {
    customer_no: indexFor("מספר לקוח", "קוד", "קוד לקוח", "מס' לקוח"),
    customer_name: indexFor("שם לקוח", "שם הלקוח", "שם עסק", "שם העסק"),
    contact: indexFor("איש קשר", "שם איש קשר"),
    phone: indexFor("טלפון ראשי", "טלפון", "נייד", "פלאפון"),
    phone2: indexFor("טלפון נוסף", "נייד נוסף"),
    city: indexFor("עיר"),
    address: indexFor("כתובת", "כתובת לקוח", "מען"),
    days: indexFor("ימי שיחה", "יום שיחה", "יום", "ימים"),
  };
  const valueAt = (row, key) => indexes[key] >= 0 ? text(row[indexes[key]]) : "";
  const parsedRows = rows.slice(headerIndex + 1).map((row) => ({
    customer_no: valueAt(row, "customer_no"),
    customer_name: valueAt(row, "customer_name"),
    contact: valueAt(row, "contact"),
    phone: valueAt(row, "phone"),
    phone2: valueAt(row, "phone2"),
    city: valueAt(row, "city"),
    address: valueAt(row, "address"),
    days: valueAt(row, "days"),
  })).filter((row) => row.customer_no || row.customer_name);
  return { rows: parsedRows };
}

function normalizeCallDays(value) {
  const raw = String(value || "");
  const compact = raw.replace(/[״"]/g, "").replace(/\s+/g, " ").trim();
  const days = new Set();
  CALL_DAYS.forEach((day) => {
    if (compact.includes(day) || compact.includes(`יום ${day}`)) days.add(day);
  });
  Object.entries(CALL_DAY_ALIASES).forEach(([alias, day]) => {
    const pattern = new RegExp(`(^|\\s|,|/|-)יום?\\s*${alias.replace("'", "\\'")}(?=$|\\s|,|/|-)`);
    if (pattern.test(compact) || compact === alias) days.add(day);
  });
  return [...days];
}

function dayFromText(value) {
  const raw = String(value || "").replace(/[״"]/g, "").replace(/\s+/g, " ").trim();
  const fullDay = CALL_DAYS.find((day) => raw.includes(day) || raw.includes(`יום ${day}`));
  if (fullDay) return fullDay;
  const aliasMatch = raw.match(/יום\s*([אבגדה])(?:׳|')?/);
  if (aliasMatch) return CALL_DAY_ALIASES[aliasMatch[1]] || "";
  return CALL_DAY_ALIASES[raw] || "";
}

function pickOrderValue(row, mapped) {
  const mappedValue = number(mapped.pick_order);
  if (text(mapped.pick_order) !== "") return mappedValue;
  const values = Object.values(row);
  return number(values[12]) || 999999;
}

function renderDashboard() {
  const months = state.dashboardMonths;
  const range = dateRange(months);
  const totals = firstRow(`
    SELECT
      COUNT(DISTINCT customer_no) AS active_customers,
      COALESCE(SUM(sales_amount), 0) AS total_sales,
      COALESCE(SUM(profit), 0) AS total_profit,
      CASE WHEN COALESCE(SUM(sales_amount), 0) = 0 THEN 0 ELSE SUM(profit) / SUM(sales_amount) END AS profit_percent,
      CASE WHEN COALESCE(SUM(purchase_units), 0) = 0 THEN 0 ELSE ABS(SUM(return_units) / SUM(purchase_units)) END AS returns_percent
    FROM sales_raw
    WHERE sale_date >= ? AND sale_date < ?
  `, [range.start, range.end]);
  const cards = [
    ["לקוחות פעילים", integer(totals.active_customers)],
    ["ממוצע מכירות חודשי", currency(number(totals.total_sales) / months)],
    ["ממוצע רווח חודשי", currency(number(totals.total_profit) / months)],
    ["% רווח ממוצע", percent(totals.profit_percent)],
    ["% חזרות ממוצע", percent(totals.returns_percent)],
  ];
  document.getElementById("dashboard-cards").innerHTML = cards.map(([label, value]) => `<div class="metric-card"><span>${label}</span><strong>${value}</strong></div>`).join("");

  renderTable("monthly-table", monthlyRows(), [
    { key: "month", label: "חודש" },
    { key: "total_sales", label: "סכום מכירות", format: currency },
    { key: "total_profit", label: "סכום רווח", format: currency },
    { key: "profit_percent", label: "% רווח", format: percent },
    { key: "returns_percent", label: "% חזרות", render: returnPercentCell },
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
    { key: "average_monthly_profit", label: "רווח ממוצע חודשי", format: currency },
  ], "topProfit", "average_monthly_profit", "desc");

  renderTable("top-returns-table", queryRows(`
    SELECT customer_name AS customer,
      CASE WHEN COALESCE(SUM(purchase_units), 0) = 0 THEN 0 ELSE ABS(SUM(return_units) / SUM(purchase_units)) END AS returns_percent
    FROM sales_raw
    WHERE sale_date >= ? AND sale_date < ?
    GROUP BY customer_no
    ORDER BY returns_percent DESC
    LIMIT 10
  `, [range.start, range.end]), [
    { key: "customer", label: "לקוח" },
    { key: "returns_percent", label: "% חזרות", render: returnPercentCell },
  ], "topReturns", "returns_percent", "desc");

  renderTable("customer-decline-table", declineRows("customer"), [
    { key: "label", label: "לקוח" },
    { key: "previous_sales", label: "3 חודשים קודמים", format: currency },
    { key: "current_sales", label: "3 חודשים אחרונים", format: currency },
    { key: "change_amount", label: "ירידה", format: currency },
  ], "customerDecline", "change_amount", "asc");

  renderTable("product-decline-table", declineRows("product"), [
    { key: "label", label: "מוצר" },
    { key: "previous_sales", label: "3 חודשים קודמים", format: currency },
    { key: "current_sales", label: "3 חודשים אחרונים", format: currency },
    { key: "change_amount", label: "ירידה", format: currency },
  ], "productDecline", "change_amount", "asc");
}

function monthlyRows() {
  const range = dateRange(state.dashboardMonths);
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
  `, [range.start, range.end]);
}

function declineRows(type) {
  const current = dateRange(3);
  const currentStart = new Date(`${current.start}T00:00:00`);
  const previousStart = new Date(currentStart.getFullYear(), currentStart.getMonth() - 3, 1);
  const previous = { start: toSqlDate(previousStart), end: current.start };
  const groupKey = type === "product" ? "s.sku" : "s.customer_no";
  const labelExpr = type === "product"
    ? "COALESCE(MAX(NULLIF(s.product_desc, '')), MAX(p.description), s.sku)"
    : "MAX(s.customer_name)";
  return queryRows(`
    WITH previous_period AS (
      SELECT ${groupKey} AS entity_key, ${labelExpr} AS label, COALESCE(SUM(s.sales_amount), 0) AS previous_sales
      FROM sales_raw s
      LEFT JOIN products p ON p.sku = s.sku
      WHERE s.sale_date >= ? AND s.sale_date < ?
      GROUP BY ${groupKey}
    ),
    current_period AS (
      SELECT ${groupKey} AS entity_key, COALESCE(SUM(s.sales_amount), 0) AS current_sales
      FROM sales_raw s
      LEFT JOIN products p ON p.sku = s.sku
      WHERE s.sale_date >= ? AND s.sale_date < ?
      GROUP BY ${groupKey}
    )
    SELECT previous_period.label,
      previous_period.previous_sales,
      COALESCE(current_period.current_sales, 0) AS current_sales,
      COALESCE(current_period.current_sales, 0) - previous_period.previous_sales AS change_amount
    FROM previous_period
    LEFT JOIN current_period ON current_period.entity_key = previous_period.entity_key
    WHERE previous_period.previous_sales > 0
      AND COALESCE(current_period.current_sales, 0) < previous_period.previous_sales
    ORDER BY change_amount ASC
    LIMIT 10
  `, [previous.start, previous.end, current.start, current.end]);
}

function searchCustomers() {
  const query = `%${document.getElementById("customer-query").value.trim()}%`;
  const months = state.customerMonths;
  const range = dateRange(months);
  const supplier = document.getElementById("customer-supplier-filter").value;
  const category = document.getElementById("customer-category-filter").value;
  const sku = document.getElementById("customer-product-filter").value;
  const rows = queryRows(`
    SELECT s.customer_no, MAX(s.customer_name) AS customer_name,
      COALESCE(SUM(s.sales_amount), 0) / ? AS average_monthly_sales,
      COALESCE(SUM(s.profit), 0) / ? AS average_monthly_profit,
      CASE WHEN COALESCE(SUM(s.sales_amount), 0) = 0 THEN 0 ELSE SUM(s.profit) / SUM(s.sales_amount) END AS profit_percent,
      CASE WHEN COALESCE(SUM(s.purchase_units), 0) = 0 THEN 0 ELSE ABS(SUM(s.return_units) / SUM(s.purchase_units)) END AS returns_percent,
      MAX(s.sale_date) AS last_sale_date
    FROM sales_raw s
    LEFT JOIN products p ON p.sku = s.sku
    WHERE s.sale_date >= ? AND s.sale_date < ?
      AND (s.customer_name LIKE ? OR s.customer_no LIKE ?)
      AND (? = '' OR COALESCE(NULLIF(s.supplier, ''), p.supplier, '') = ?)
      AND (? = '' OR COALESCE(NULLIF(s.category, ''), p.category, '') = ?)
      AND (? = '' OR s.sku = ?)
    GROUP BY s.customer_no
    ORDER BY average_monthly_profit DESC
    LIMIT 100
  `, [months, months, range.start, range.end, query, query, supplier, supplier, category, category, sku, sku]);
  renderTable("customers-results-table", rows, [
    { key: "customer_no", label: "מספר לקוח" },
    { key: "customer_name", label: "שם לקוח" },
    { key: "average_monthly_sales", label: "ממוצע מכירות חודשי", format: currency },
    { key: "average_monthly_profit", label: "ממוצע רווח חודשי", format: currency },
    { key: "profit_percent", label: "% רווח", format: percent },
    { key: "returns_percent", label: "% חזרות", render: returnPercentCell },
    { key: "actions", label: "פעולה", sortable: false, render: (row) => `<button class="small-action" data-select-customer="${escapeAttr(row.customer_no)}">בחירה</button>` },
  ], "customers", "average_monthly_profit", "desc");
  document.querySelectorAll("[data-select-customer]").forEach((button) => button.addEventListener("click", () => selectCustomer(button.dataset.selectCustomer)));
}

function refreshCustomerAnalysisFilters() {
  fillSelect("customer-supplier-filter", "כל הספקים", queryRows(`
    SELECT DISTINCT COALESCE(NULLIF(s.supplier, ''), p.supplier, '') AS value
    FROM sales_raw s LEFT JOIN products p ON p.sku = s.sku
    WHERE COALESCE(NULLIF(s.supplier, ''), p.supplier, '') <> ''
    ORDER BY value
  `));
  fillSelect("customer-category-filter", "כל הקטגוריות", queryRows(`
    SELECT DISTINCT COALESCE(NULLIF(s.category, ''), p.category, '') AS value
    FROM sales_raw s LEFT JOIN products p ON p.sku = s.sku
    WHERE COALESCE(NULLIF(s.category, ''), p.category, '') <> ''
    ORDER BY value
  `));
  fillSelect("customer-product-filter", "כל המוצרים", queryRows(`
    SELECT DISTINCT s.sku AS value, COALESCE(MAX(NULLIF(s.product_desc, '')), MAX(p.description), s.sku) AS label
    FROM sales_raw s LEFT JOIN products p ON p.sku = s.sku
    WHERE s.sku <> ''
    GROUP BY s.sku
    ORDER BY label
    LIMIT 1000
  `), "value", "label");
}

function selectCustomer(customerNo) {
  const customer = firstRow("SELECT * FROM customer_profitability_summary WHERE customer_no = ?", [customerNo]);
  if (!customer.customer_no) return;
  state.selectedCustomer = customer;
  document.getElementById("customer-card").classList.remove("hidden");
  document.getElementById("customer-card-title").textContent = customer.customer_name || "כרטיס לקוח";
  document.getElementById("customer-card-subtitle").textContent = `מספר לקוח: ${customer.customer_no}`;
  renderCustomerProducts(customer.customer_no);
  renderCustomerRecommendations(customer.customer_no);
  renderCustomerCalls(customer.customer_no);
  renderCustomerOrders(customer.customer_no);
}

function renderCustomerProducts(customerNo) {
  const months = state.customerMonths;
  const range = dateRange(months);
  const supplier = document.getElementById("customer-supplier-filter").value;
  const category = document.getElementById("customer-category-filter").value;
  const sku = document.getElementById("customer-product-filter").value;
  const rows = queryRows(`
    SELECT COALESCE(NULLIF(s.product_desc, ''), p.description, s.sku, 'ללא מוצר') AS product,
      COALESCE(SUM(s.quantity), 0) AS quantity,
      CASE WHEN COALESCE(SUM(s.sales_amount), 0) = 0 THEN 0 ELSE SUM(s.profit) / SUM(s.sales_amount) END AS profit_percent,
      CASE WHEN COALESCE(SUM(s.purchase_units), 0) = 0 THEN 0 ELSE ABS(SUM(s.return_units) / SUM(s.purchase_units)) END AS returns_percent
    FROM sales_raw s
    LEFT JOIN products p ON p.sku = s.sku
    WHERE s.customer_no = ?
      AND s.sale_date >= ? AND s.sale_date < ?
      AND (? = '' OR COALESCE(NULLIF(s.supplier, ''), p.supplier, '') = ?)
      AND (? = '' OR COALESCE(NULLIF(s.category, ''), p.category, '') = ?)
      AND (? = '' OR s.sku = ?)
    GROUP BY s.sku, COALESCE(NULLIF(s.product_desc, ''), p.description, s.sku)
    ORDER BY quantity DESC
    LIMIT 500
  `, [customerNo, range.start, range.end, supplier, supplier, category, category, sku, sku]);
  renderTable("customer-products-table", rows, [
    { key: "product", label: "מוצר" },
    { key: "quantity", label: "כמות", format: numberDisplay },
    { key: "profit_percent", label: "% רווח", format: percent },
    { key: "returns_percent", label: "% חזרות", render: returnPercentCell },
  ], "customerProducts", "quantity", "desc");
}

function renderCustomerRecommendations(customerNo) {
  const manual = queryRows("SELECT text FROM sales_recommendations WHERE active = 1 ORDER BY id DESC").map((row) => row.text);
  const automatic = automaticRecommendations(customerNo);
  const items = [...manual, ...automatic];
  document.getElementById("customer-recommendations").innerHTML = items.length
    ? items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")
    : "<li>אין המלצות פעילות</li>";
}

function automaticRecommendations(customerNo) {
  const categories = queryRows(`
    SELECT LOWER(COALESCE(s.category, p.category, s.product_desc, '')) AS text_value
    FROM sales_raw s LEFT JOIN products p ON p.sku = s.sku
    WHERE s.customer_no = ?
    GROUP BY LOWER(COALESCE(s.category, p.category, s.product_desc, ''))
  `, [customerNo]).map((row) => row.text_value || "");
  const has = (needle) => categories.some((value) => value.includes(needle));
  const recs = [];
  if (has("גבינ") && !has("קרקר")) recs.push("הלקוח קונה גבינות. מומלץ להציע קרקרים.");
  if (has("סלט") && !has("אנטיפסט")) recs.push("הלקוח קונה סלטים. מומלץ להציע אנטיפסטי.");

  queryRows(`
    SELECT COALESCE(product_desc, sku) AS product
    FROM customer_product_summary
    WHERE customer_no = ? AND last_sale_date < DATE('now', '-90 day')
    ORDER BY quantity DESC
    LIMIT 5
  `, [customerNo]).forEach((row) => recs.push(`המוצר ${row.product} לא נרכש 90 יום. מומלץ להחזיר אותו להזמנה.`));

  queryRows(`
    WITH customer_categories AS (
      SELECT DISTINCT COALESCE(category, '') AS category FROM sales_raw WHERE customer_no = ?
    ),
    peer_products AS (
      SELECT s.sku, COALESCE(MAX(s.product_desc), MAX(p.description), s.sku) AS product, SUM(s.profit) AS profit, SUM(s.sales_amount) AS sales
      FROM sales_raw s
      LEFT JOIN products p ON p.sku = s.sku
      WHERE COALESCE(s.category, p.category, '') IN (SELECT category FROM customer_categories)
        AND s.sku NOT IN (SELECT sku FROM sales_raw WHERE customer_no = ? AND sku <> '')
      GROUP BY s.sku
      HAVING sales > 0 AND profit / sales > 0.25
      ORDER BY profit DESC
      LIMIT 3
    )
    SELECT product FROM peer_products
  `, [customerNo, customerNo]).forEach((row) => recs.push(`לקוחות דומים קונים את ${row.product}. מומלץ להציע אותו.`));
  return recs;
}

function renderCustomerCalls(customerNo) {
  renderTable("customer-calls-table", queryRows(`
    SELECT call_date, status, notes FROM customer_calls WHERE customer_no = ? ORDER BY call_date DESC, id DESC LIMIT 5
  `, [customerNo]), [
    { key: "call_date", label: "תאריך" },
    { key: "status", label: "סטטוס" },
    { key: "notes", label: "הערות" },
  ], "customerCalls", "call_date", "desc");
}

function renderCustomerOrders(customerNo) {
  renderTable("customer-orders-table", queryRows(`
    SELECT id, order_date, status, estimated_total FROM customer_orders WHERE customer_no = ? ORDER BY order_date DESC, id DESC LIMIT 5
  `, [customerNo]), [
    { key: "id", label: "מספר" },
    { key: "order_date", label: "תאריך" },
    { key: "status", label: "סטטוס" },
    { key: "estimated_total", label: "סכום", format: currency },
  ], "customerOrders", "order_date", "desc");
}

function renderCustomerAnalysis() {
  const months = state.analysisMonths;
  const range = dateRange(months);
  const query = `%${document.getElementById("analysis-query").value.trim()}%`;
  const rows = queryRows(`
    SELECT customer_name,
      COALESCE(SUM(sales_amount), 0) / ? AS average_monthly_sales,
      COALESCE(SUM(profit), 0) / ? AS average_monthly_profit,
      CASE WHEN COALESCE(SUM(sales_amount), 0) = 0 THEN 0 ELSE SUM(profit) / SUM(sales_amount) END AS profit_percent,
      CASE WHEN COALESCE(SUM(purchase_units), 0) = 0 THEN 0 ELSE ABS(SUM(return_units) / SUM(purchase_units)) END AS returns_percent
    FROM sales_raw
    WHERE sale_date >= ? AND sale_date < ? AND customer_name LIKE ?
    GROUP BY customer_no
    ORDER BY average_monthly_profit DESC
    LIMIT 500
  `, [months, months, range.start, range.end, query]);
  renderTable("analysis-table", rows, [
    { key: "customer_name", label: "שם לקוח" },
    { key: "average_monthly_sales", label: "ממוצע מכירות חודשי", format: currency },
    { key: "average_monthly_profit", label: "ממוצע רווח חודשי", format: currency },
    { key: "profit_percent", label: "% רווח", format: percent },
    { key: "returns_percent", label: "% חזרות", render: returnPercentCell },
  ], "analysis", "average_monthly_profit", "desc");
}

async function refreshProductFilters() {
  if (await refreshProductFiltersFromPostgres()) return;
  state.productsSource = "sqlite";
  fillSelect("supplier-filter", "כל הספקים", queryRows("SELECT DISTINCT supplier AS value FROM products WHERE supplier <> '' ORDER BY supplier"));
  fillSelect("category-filter", "כל הקטגוריות", queryRows("SELECT DISTINCT category AS value FROM products WHERE category <> '' ORDER BY category"));
}

async function refreshProductFiltersFromPostgres() {
  try {
    const response = await fetch("/api/postgres/product-filters", { cache: "no-store" });
    if (!response.ok) return false;
    const data = await response.json();
    if (!data.ok) return false;
    state.productsSource = "postgres";
    fillSelect("supplier-filter", "כל הספקים", (data.suppliers || []).map((value) => ({ value })));
    fillSelect("category-filter", "כל הקטגוריות", (data.categories || []).map((value) => ({ value })));
    return true;
  } catch (error) {
    console.warn("Postgres product filters unavailable, using SQLite", error);
    return false;
  }
}

async function renderProducts() {
  if (await renderProductsFromPostgres()) return;
  state.productsSource = "sqlite";
  const query = `%${document.getElementById("product-query").value.trim()}%`;
  const supplier = document.getElementById("supplier-filter").value;
  const category = document.getElementById("category-filter").value;
  const rows = queryRows(`
    SELECT p.sku, p.description, p.category, p.supplier, p.standard_cost,
      p.standard_cost AS purchase_price,
      p.base_price AS sale_price,
      p.weight
    FROM products p
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

async function renderProductsFromPostgres() {
  try {
    const params = new URLSearchParams();
    params.set("q", document.getElementById("product-query").value.trim());
    params.set("supplier", document.getElementById("supplier-filter").value);
    params.set("category", document.getElementById("category-filter").value);
    const response = await fetch(`/api/postgres/products?${params.toString()}`, { cache: "no-store" });
    if (!response.ok) return false;
    const data = await response.json();
    if (!data.ok) return false;
    state.productsSource = "postgres";
    renderProductsTable(data.rows || []);
    return true;
  } catch (error) {
    console.warn("Postgres products unavailable, using SQLite", error);
    return false;
  }
}

function renderProductsTable(rows) {
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

function refreshProductCompareOptions() {
  const rows = queryRows(`
    SELECT sku AS value, COALESCE(NULLIF(description, ''), sku) AS label
    FROM products
    WHERE sku <> ''
    ORDER BY label
    LIMIT 2000
  `);
  fillSelect("compare-product-a", "מוצר ראשון", rows, "value", "label");
  fillSelect("compare-product-b", "מוצר שני", rows, "value", "label");
}

function productComparisonRow(sku) {
  if (!sku) return null;
  const range = dateRange(6);
  const product = firstRow(`
    SELECT sku, description, category, supplier, standard_cost,
      standard_cost AS purchase_price,
      base_price AS sale_price,
      weight
    FROM products
    WHERE sku = ?
  `, [sku]);
  if (!product.sku) return null;
  const sales = firstRow(`
    SELECT
      CASE WHEN COALESCE(SUM(purchase_units), 0) = 0 THEN 0 ELSE ABS(SUM(return_units) / SUM(purchase_units)) END AS returns_percent,
      COALESCE(SUM(quantity), 0) AS quantity,
      COALESCE(SUM(sales_amount), 0) AS sales_amount
    FROM sales_raw
    WHERE sku = ? AND sale_date >= ? AND sale_date < ?
  `, [sku, range.start, range.end]);
  return { ...product, ...sales };
}

function renderProductComparison() {
  const rows = [
    productComparisonRow(document.getElementById("compare-product-a").value),
    productComparisonRow(document.getElementById("compare-product-b").value),
  ].filter(Boolean);
  renderTable("product-compare-table", rows, [
    { key: "sku", label: 'מק"ט' },
    { key: "description", label: "תיאור" },
    { key: "category", label: "קטגוריה" },
    { key: "supplier", label: "ספק" },
    { key: "standard_cost", label: "עלות תקן", format: currency2 },
    { key: "purchase_price", label: "מחיר קניה", format: currency2 },
    { key: "sale_price", label: "מחיר מכירה", format: currency2 },
    { key: "returns_percent", label: "% חזרות", render: returnPercentCell },
    { key: "quantity", label: "כמות 6 חודשים", format: numberDisplay },
    { key: "sales_amount", label: "מכירות 6 חודשים", format: currency },
  ], "productCompare", "description", "asc");
}

function refreshReportFilters() {
  const suppliers = queryRows(`
    SELECT DISTINCT COALESCE(NULLIF(s.supplier, ''), p.supplier, '') AS value
    FROM sales_raw s
    LEFT JOIN products p ON p.sku = s.sku
    WHERE COALESCE(NULLIF(s.supplier, ''), p.supplier, '') <> ''
    ORDER BY value
  `);
  fillSelect("returns-report-supplier", "כל הספקים", suppliers);
}

function renderSupplierReturnsReport() {
  const months = number(document.getElementById("returns-report-period").value) || 1;
  const supplier = document.getElementById("returns-report-supplier").value;
  const range = dateRange(months);
  const rows = queryRows(`
    SELECT
      s.sku,
      COALESCE(MAX(NULLIF(s.product_desc, '')), MAX(p.description), s.sku) AS product,
      COALESCE(NULLIF(s.supplier, ''), p.supplier, '') AS supplier,
      ABS(COALESCE(SUM(s.return_units), 0)) AS return_units,
      COALESCE(SUM(s.purchase_units), 0) AS purchase_units,
      CASE WHEN COALESCE(SUM(s.purchase_units), 0) = 0 THEN 0 ELSE ABS(SUM(s.return_units) / SUM(s.purchase_units)) END AS returns_percent
    FROM sales_raw s
    LEFT JOIN products p ON p.sku = s.sku
    WHERE s.sale_date >= ? AND s.sale_date < ?
      AND (? = '' OR COALESCE(NULLIF(s.supplier, ''), p.supplier, '') = ?)
    GROUP BY s.sku, COALESCE(NULLIF(s.supplier, ''), p.supplier, '')
    HAVING ABS(COALESCE(SUM(s.return_units), 0)) > 0
    ORDER BY return_units DESC
    LIMIT 500
  `, [range.start, range.end, supplier, supplier]);
  renderTable("returns-supplier-table", rows, [
    { key: "supplier", label: "ספק" },
    { key: "sku", label: 'מק"ט' },
    { key: "product", label: "מוצר" },
    { key: "return_units", label: "יחידות חזרות", format: numberDisplay },
    { key: "purchase_units", label: "יחידות קניה", format: numberDisplay },
    { key: "returns_percent", label: "% חזרות", render: returnPercentCell },
  ], "returnsSupplier", "return_units", "desc");
}

function renderInvoiceProductResults() {
  const queryInput = document.getElementById("invoice-product-query");
  const results = document.getElementById("invoice-product-results");
  const rawQuery = queryInput.value.trim();
  if (!rawQuery) {
    results.classList.add("hidden");
    results.innerHTML = "";
    return;
  }
  const query = `%${rawQuery}%`;
  const rows = queryRows(`
    SELECT sku, description, category, supplier, standard_cost
    FROM products
    WHERE sku LIKE ? OR description LIKE ?
    ORDER BY
      CASE WHEN sku = ? THEN 0 WHEN sku LIKE ? THEN 1 ELSE 2 END,
      description
    LIMIT 30
  `, [query, query, rawQuery, `${rawQuery}%`]);
  results.innerHTML = rows.length ? rows.map((row) => `
    <button type="button" data-invoice-product="${escapeAttr(row.sku)}">
      <strong>${escapeHtml(row.description || row.sku)}</strong>
      <small>${escapeHtml(row.sku)} · ${escapeHtml(row.supplier || "")} · ${currency2(row.standard_cost)}</small>
    </button>
  `).join("") : `<div class="autocomplete-empty">לא נמצאו מוצרים</div>`;
  results.classList.remove("hidden");
}

function handleInvoiceProductResult(event) {
  const button = event.target.closest("[data-invoice-product]");
  if (!button) return;
  event.preventDefault();
  selectInvoiceProduct(button.dataset.invoiceProduct);
}

function handleInvoiceProductKeydown(event) {
  if (event.key !== "Enter") return;
  const first = document.querySelector("#invoice-product-results [data-invoice-product]");
  if (!first) return;
  event.preventDefault();
  selectInvoiceProduct(first.dataset.invoiceProduct);
}

function selectInvoiceProduct(sku) {
  const product = firstRow(`
    SELECT sku, description, category, supplier, standard_cost
    FROM products
    WHERE sku = ?
  `, [sku]);
  if (!product.sku) return;
  state.manualInvoiceProduct = product;
  document.getElementById("invoice-product-query").value = `${product.description || product.sku} ${product.sku}`;
  document.getElementById("invoice-product-results").classList.add("hidden");
  document.getElementById("invoice-manual-price").value = "";
  const productBox = document.getElementById("invoice-selected-product");
  productBox.classList.remove("hidden");
  productBox.innerHTML = `
    <strong>${escapeHtml(product.description || product.sku)}</strong>
    <span>מק״ט: ${escapeHtml(product.sku)}</span>
    <span>ספק: ${escapeHtml(product.supplier || "-")}</span>
    <span>עלות תקן: ${currency2(product.standard_cost)}</span>
  `;
  document.getElementById("invoice-compare-status").textContent = "הזן מחיר חשבונית כדי לראות פער מול עלות התקן.";
  document.getElementById("invoice-compare-table").innerHTML = "";
  const priceInput = document.getElementById("invoice-manual-price");
  priceInput.focus();
  priceInput.select();
}

function renderManualInvoiceComparison() {
  const product = state.manualInvoiceProduct;
  const invoicePrice = number(document.getElementById("invoice-manual-price").value);
  const discount = normalizeDiscountPercent(document.getElementById("invoice-manual-discount").value);
  if (!product?.sku) {
    document.getElementById("invoice-compare-status").textContent = "בחר מוצר כדי להתחיל בדיקה.";
    return;
  }
  if (!invoicePrice) {
    document.getElementById("invoice-compare-status").textContent = "הזן מחיר חשבונית כדי לראות פער מול עלות התקן.";
    document.getElementById("invoice-compare-table").innerHTML = "";
    return;
  }
  const netPrice = Math.max(0, invoicePrice * (1 - discount));
  const systemCost = number(product.standard_cost);
  const gap = netPrice - systemCost;
  const gapPercent = systemCost === 0 ? 0 : gap / systemCost;
  const row = {
    sku: product.sku,
    description: product.description,
    supplier: product.supplier,
    invoice_price: invoicePrice,
    discount_percent: discount,
    invoice_net_price: netPrice,
    system_cost: systemCost,
    gap,
    gap_percent: gapPercent,
    status: Math.abs(gap) < 0.01 ? "תקין" : gap > 0 ? "יקר יותר" : "זול יותר",
  };
  document.getElementById("invoice-compare-status").textContent = `מחיר נטו אחרי הנחה: ${currency2(netPrice)}. פער מול המערכת: ${currency2(gap)}.`;
  renderTable("invoice-compare-table", [row], [
    { key: "sku", label: 'מק"ט' },
    { key: "description", label: "מוצר" },
    { key: "supplier", label: "ספק" },
    { key: "invoice_price", label: "מחיר חשבונית", format: currency2 },
    { key: "discount_percent", label: "הנחה", format: percent },
    { key: "invoice_net_price", label: "מחיר נטו", format: currency2 },
    { key: "system_cost", label: "עלות תקן", format: currency2 },
    { key: "gap", label: "פער", format: currency2 },
    { key: "gap_percent", label: "% פער", format: percent },
    { key: "status", label: "סטטוס", render: invoiceStatusCell },
  ], "manualInvoice", "gap", "desc");
}

const invoiceColumns = {
  sku: ['מק"ט', "מקט", "קוד מוצר", "קוד פריט", "פריט"],
  description: ["תיאור", "תאור", "שם מוצר", "מוצר", "תיאור מוצר"],
  quantity: ["כמות", "כמות יחידות"],
  unit_price: ["מחיר", "מחיר יחידה", "מחיר קניה", "מחיר לפני הנחה", "עלות"],
  discount_percent: ["הנחה", "% הנחה", "אחוז הנחה", "הנחת שורה"],
  discount_amount: ["סכום הנחה", "הנחה בשח", "הנחה שורה"],
  line_total: ['סה"כ', "סהכ", "סכום שורה", "סכום"],
};

async function compareSupplierInvoice() {
  const file = document.getElementById("invoice-file").files[0];
  const status = document.getElementById("invoice-compare-status");
  if (!file) {
    alert("יש לבחור קובץ חשבונית");
    return;
  }
  const lowerName = file.name.toLowerCase();
  try {
    status.textContent = "קורא חשבונית...";
    if (file.type.startsWith("image/")) {
      const extractedText = await readInvoiceImageText(file);
      state.invoiceRows = invoiceRowsFromText(extractedText);
    } else if (file.type === "application/pdf" || lowerName.endsWith(".pdf")) {
      const extractedText = await readInvoicePdfText(file);
      state.invoiceRows = invoiceRowsFromText(extractedText);
    } else {
      const rows = await readWorkbook(file);
      state.invoiceRows = rows.map((row) => mapRow(row, invoiceColumns)).filter((row) => text(row.sku) || text(row.description));
    }
    if (!state.invoiceRows.length) {
      status.textContent = "החשבונית נקראה, אבל לא זוהו שורות מוצר. אם זה PDF/תמונה, נסה צילום חד וברור יותר או ודא שמופיעים מק״ט, כמות ומחיר.";
      document.getElementById("invoice-compare-table").innerHTML = "";
      return;
    }
    renderInvoiceComparisonRows();
  } catch (error) {
    console.error(error);
    status.textContent = "שגיאה בקריאת החשבונית. ניתן לטעון Excel/CSV, תמונה חדה או PDF קריא.";
  }
}

async function readInvoiceImageText(file) {
  if (!window.Tesseract) throw new Error("Tesseract OCR is not loaded");
  const status = document.getElementById("invoice-compare-status");
  const result = await Tesseract.recognize(file, "heb+eng", {
    logger: (message) => {
      if (message.status === "recognizing text") {
        status.textContent = `מזהה טקסט בתמונה... ${Math.round((message.progress || 0) * 100)}%`;
      }
    },
  });
  return result?.data?.text || "";
}

async function readInvoicePdfText(file) {
  if (!window.pdfjsLib) throw new Error("PDF reader is not loaded");
  const status = document.getElementById("invoice-compare-status");
  pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const chunks = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    status.textContent = `קורא PDF... עמוד ${pageNumber} מתוך ${pdf.numPages}`;
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const pageText = pdfTextContentToLines(textContent.items);
    if (pageText.trim().length > 80) {
      chunks.push(pageText);
    } else {
      chunks.push(await ocrPdfPage(page, pageNumber, pdf.numPages));
    }
  }
  return chunks.join("\n");
}

function pdfTextContentToLines(items) {
  const rows = items
    .map((item) => ({
      text: item.str,
      x: item.transform?.[4] || 0,
      y: Math.round(item.transform?.[5] || 0),
    }))
    .filter((item) => text(item.text))
    .sort((a, b) => b.y - a.y || a.x - b.x);
  const grouped = [];
  rows.forEach((item) => {
    const row = grouped.find((candidate) => Math.abs(candidate.y - item.y) <= 3);
    if (row) row.items.push(item);
    else grouped.push({ y: item.y, items: [item] });
  });
  return grouped.map((row) => row.items.sort((a, b) => a.x - b.x).map((item) => item.text).join(" ")).join("\n");
}

async function ocrPdfPage(page, pageNumber, totalPages) {
  if (!window.Tesseract) throw new Error("Tesseract OCR is not loaded");
  const status = document.getElementById("invoice-compare-status");
  const viewport = page.getViewport({ scale: 1.8 });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  await page.render({ canvasContext: context, viewport }).promise;
  const result = await Tesseract.recognize(canvas, "heb+eng", {
    logger: (message) => {
      if (message.status === "recognizing text") {
        status.textContent = `מזהה טקסט ב-PDF... עמוד ${pageNumber}/${totalPages} ${Math.round((message.progress || 0) * 100)}%`;
      }
    },
  });
  return result?.data?.text || "";
}

function invoiceRowsFromText(rawText) {
  const lines = String(rawText || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 4);
  return lines.map(invoiceLineToRow).filter((row) => text(row.sku) && number(row.quantity) > 0 && (number(row.unit_price) > 0 || number(row.line_total) > 0));
}

function invoiceLineToRow(line) {
  const skuMatch = line.match(/(?:מק[״"']?ט|מקט|קוד\s*מוצר|פריט)?\s*([A-Z0-9][A-Z0-9./-]{2,})/i);
  const numbers = [...line.matchAll(/-?\d+(?:[.,]\d{1,2})?/g)].map((match) => ({
    raw: match[0],
    value: quantityNumber(match[0]),
    index: match.index || 0,
  }));
  const moneyNumbers = numbers.filter((item) => item.value >= 0);
  const quantityCandidate = findInvoiceQuantity(line, numbers, skuMatch?.[1]);
  const priceInfo = findInvoicePrices(line, moneyNumbers, quantityCandidate);
  const discountMatch = line.match(/(?:הנחה|discount)\D{0,8}(\d+(?:[.,]\d{1,2})?)\s*%?/i);
  const description = cleanInvoiceDescription(line, skuMatch?.[1], numbers);
  return {
    sku: skuMatch?.[1] || "",
    description,
    quantity: quantityCandidate || 1,
    unit_price: priceInfo.unit_price,
    discount_percent: discountMatch ? discountMatch[1] : "",
    discount_amount: "",
    line_total: priceInfo.line_total,
  };
}

function findInvoicePrices(line, numbers, quantity) {
  const priceLabel = line.match(/(?:מחיר|price)\D{0,10}(\d+(?:[.,]\d{1,2})?)/i);
  if (priceLabel) return { unit_price: quantityNumber(priceLabel[1]), line_total: "" };
  const usable = numbers.filter((item) => item.value > 0);
  if (usable.length >= 3) {
    const lineTotal = usable[usable.length - 1].value;
    const unitPrice = usable[usable.length - 2].value;
    return { unit_price: unitPrice, line_total: lineTotal };
  }
  if (usable.length === 2 && quantity > 1 && Math.abs(usable[1].value / quantity - usable[0].value) < 0.05) {
    return { unit_price: usable[0].value, line_total: usable[1].value };
  }
  return { unit_price: usable.length ? usable[usable.length - 1].value : 0, line_total: "" };
}

function findInvoiceQuantity(line, numbers, sku) {
  const quantityLabel = line.match(/(?:כמות|qty)\D{0,8}(\d+(?:[.,]\d{1,2})?)/i);
  if (quantityLabel) return quantityNumber(quantityLabel[1]);
  const candidates = numbers
    .filter((item) => item.value > 0 && item.value < 10000 && String(item.raw).replace(/[.,]/g, "").length <= 5)
    .filter((item) => !sku || !String(sku).includes(String(item.raw).replace(/[.,]/g, "")));
  return candidates.length > 1 ? candidates[0].value : 1;
}

function cleanInvoiceDescription(line, sku, numbers) {
  let description = line;
  if (sku) description = description.replace(sku, " ");
  numbers.slice(-3).forEach((item) => {
    description = description.replace(item.raw, " ");
  });
  description = description
    .replace(/מק[״"']?ט|מקט|קוד\s*מוצר|פריט|כמות|מחיר|הנחה|סהכ|סה"כ/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return description;
}

function renderInvoiceComparisonRows() {
  const globalDiscount = Math.max(0, number(document.getElementById("invoice-global-discount").value)) / 100;
  const rows = state.invoiceRows.map((row) => invoiceComparisonRow(row, globalDiscount));
  const gaps = rows.filter((row) => row.status === "פער").length;
  const missing = rows.filter((row) => row.status === "לא נמצא").length;
  document.getElementById("invoice-compare-status").textContent = `נבדקו ${rows.length} שורות. נמצאו ${gaps} פערים ו-${missing} מוצרים שלא זוהו.`;
  renderTable("invoice-compare-table", rows, [
    { key: "sku", label: 'מק"ט' },
    { key: "description", label: "מוצר בחשבונית" },
    { key: "system_description", label: "מוצר במערכת" },
    { key: "quantity", label: "כמות", format: numberDisplay },
    { key: "invoice_unit_price", label: "מחיר חשבונית נטו", format: currency2 },
    { key: "system_cost", label: "עלות תקן במערכת", format: currency2 },
    { key: "gap", label: "פער ליחידה", format: currency2 },
    { key: "gap_percent", label: "% פער", format: percent },
    { key: "status", label: "סטטוס", render: invoiceStatusCell },
  ], "invoiceCompare", "gap", "desc");
}

function invoiceComparisonRow(row, globalDiscount) {
  const sku = text(row.sku);
  const quantity = Math.max(1, number(row.quantity));
  const product = findInvoiceProduct(sku, text(row.description));
  const rawUnitPrice = invoiceUnitPrice(row, quantity);
  const lineDiscountPercent = normalizeDiscountPercent(row.discount_percent);
  const lineDiscountAmountPerUnit = number(row.discount_amount) / quantity;
  const invoiceUnitPrice = Math.max(0, (rawUnitPrice * (1 - lineDiscountPercent) - lineDiscountAmountPerUnit) * (1 - globalDiscount));
  const systemCost = number(product.standard_cost);
  const gap = product.sku ? invoiceUnitPrice - systemCost : 0;
  const gapPercent = systemCost === 0 ? 0 : gap / systemCost;
  const status = product.sku ? (Math.abs(gap) >= 0.01 ? "פער" : "תקין") : "לא נמצא";
  return {
    sku: sku || product.sku,
    description: text(row.description),
    system_description: product.description || "",
    quantity,
    invoice_unit_price: invoiceUnitPrice,
    system_cost: systemCost,
    gap,
    gap_percent: gapPercent,
    status,
  };
}

function findInvoiceProduct(sku, description) {
  if (sku) {
    const bySku = firstRow("SELECT sku, description, standard_cost FROM products WHERE sku = ?", [sku]);
    if (bySku.sku) return bySku;
  }
  if (description) {
    const byDescription = firstRow("SELECT sku, description, standard_cost FROM products WHERE description LIKE ? ORDER BY LENGTH(description) LIMIT 1", [`%${description}%`]);
    if (byDescription.sku) return byDescription;
  }
  return {};
}

function invoiceUnitPrice(row, quantity) {
  const unitPrice = number(row.unit_price);
  if (unitPrice > 0) return unitPrice;
  const lineTotal = number(row.line_total);
  return lineTotal > 0 ? lineTotal / quantity : 0;
}

function normalizeDiscountPercent(value) {
  const discount = number(value);
  if (discount <= 0) return 0;
  return discount > 1 ? discount / 100 : discount;
}

function invoiceStatusCell(row) {
  const cls = row.status === "תקין" ? "return-low" : row.status === "פער" ? "return-mid" : "return-high";
  return `<span class="${cls}">${escapeHtml(row.status)}</span>`;
}

function startOrderFromCustomerCard() {
  if (!state.selectedCustomer) return;
  state.orderCustomer = { customer_no: state.selectedCustomer.customer_no, customer_name: state.selectedCustomer.customer_name };
  showScreen("order-create");
  refreshOrderSelectors();
  renderOrderTables();
}

function startOrderFromCallCustomer(customerNo) {
  const customer = callCustomerByNo(customerNo);
  if (!customer.customer_no) return;
  state.orderCustomer = { customer_no: customer.customer_no, customer_name: customer.customer_name };
  document.getElementById("order-customer-query").value = `${customer.customer_name} ${customer.customer_no}`;
  document.getElementById("order-customer-label").textContent = `${customer.customer_name} (${customer.customer_no})`;
  showScreen("order-create");
  refreshOrderSelectors();
  renderOrderTables();
}

function refreshOrderSelectors() {
  renderOrderCustomerResults();
  renderOrderProductResults();
  renderOrderTables();
}

function renderOrderCustomerResults() {
  const input = document.getElementById("order-customer-query");
  const list = document.getElementById("order-customer-results");
  const rawQuery = input.value.trim();
  const query = `%${rawQuery}%`;
  const rows = queryRows(`
    SELECT customer_no, customer_name FROM customer_profitability_summary
    WHERE customer_name LIKE ? OR customer_no LIKE ?
    ORDER BY customer_name LIMIT 80
  `, [query, query]);
  list.innerHTML = rows.length
    ? rows.map((row) => `
      <button class="autocomplete-option" data-order-customer="${escapeAttr(row.customer_no)}">
        <strong>${escapeHtml(row.customer_name)}</strong>
        <small>${escapeHtml(row.customer_no)}</small>
      </button>
    `).join("")
    : `<div class="empty-state">אין לקוחות מתאימים</div>`;
  list.classList.toggle("hidden", !rawQuery && !document.activeElement.isSameNode(input));
  document.getElementById("order-customer-label").textContent = state.orderCustomer ? `${state.orderCustomer.customer_name} (${state.orderCustomer.customer_no})` : "לא נבחר לקוח";
}

function renderOrderProductResults() {
  const input = document.getElementById("order-product-query");
  const list = document.getElementById("order-product-results");
  const rawQuery = input.value.trim();
  const query = `%${rawQuery}%`;
  state.orderProductActiveIndex = -1;
  if (state.suppressProductFocusResults) {
    list.classList.add("hidden");
    return;
  }
  if (!state.orderCustomer) {
    list.innerHTML = `<div class="empty-state">יש לבחור לקוח לפני בחירת מוצר</div>`;
    list.classList.toggle("hidden", !rawQuery && !document.activeElement.isSameNode(input));
    return;
  }
  const rows = queryRows(`
    SELECT sku, description, source_rank, quantity
    FROM (
      SELECT cps.sku, COALESCE(cps.product_desc, p.description, cps.sku) AS description, 0 AS source_rank, cps.quantity
      FROM customer_product_summary cps
      LEFT JOIN products p ON p.sku = cps.sku
      WHERE cps.customer_no = ? AND (cps.sku LIKE ? OR cps.product_desc LIKE ? OR p.description LIKE ?)
      UNION
      SELECT p.sku, COALESCE(p.description, p.sku) AS description, 1 AS source_rank, 0 AS quantity
      FROM products p
      WHERE p.sku LIKE ? OR p.description LIKE ?
    )
    WHERE sku <> ''
    GROUP BY sku
    ORDER BY source_rank, quantity DESC, description
    LIMIT 80
  `, [state.orderCustomer.customer_no, query, query, query, query, query]);
  list.innerHTML = rows.length
    ? rows.map((row) => `
      <button class="autocomplete-option" data-order-product="${escapeAttr(row.sku)}">
        <strong>${escapeHtml(row.description || row.sku)}</strong>
        <small>${escapeHtml(row.sku)}${row.source_rank === 0 ? " · נרכש בעבר" : ""}</small>
      </button>
    `).join("")
    : `<div class="empty-state">אין מוצרים מתאימים</div>`;
  list.classList.toggle("hidden", !rawQuery && !document.activeElement.isSameNode(input));
}

function setActiveOrderProductOption(list, index) {
  const options = [...list.querySelectorAll("[data-order-product]")];
  if (!options.length) return;
  state.orderProductActiveIndex = Math.max(0, Math.min(index, options.length - 1));
  options.forEach((option, optionIndex) => option.classList.toggle("active", optionIndex === state.orderProductActiveIndex));
  options[state.orderProductActiveIndex].scrollIntoView({ block: "nearest" });
}

function handleOrderProductKeydown(event) {
  const list = document.getElementById("order-product-results");
  const options = [...list.querySelectorAll("[data-order-product]")];
  if (!options.length || list.classList.contains("hidden")) return;
  if (event.key === "ArrowDown") {
    event.preventDefault();
    setActiveOrderProductOption(list, state.orderProductActiveIndex + 1);
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    setActiveOrderProductOption(list, state.orderProductActiveIndex <= 0 ? options.length - 1 : state.orderProductActiveIndex - 1);
  }
  if (event.key === "Enter" && state.orderProductActiveIndex >= 0) {
    event.preventDefault();
    const option = options[state.orderProductActiveIndex];
    if (option) openProductDialog(option.dataset.orderProduct);
  }
  if (event.key === "Escape") {
    list.classList.add("hidden");
  }
}

function closeAutocompleteOnOutsideClick(event) {
  if (!event.target.closest(".autocomplete-field")) {
    document.getElementById("order-customer-results").classList.add("hidden");
    document.getElementById("order-product-results").classList.add("hidden");
    document.getElementById("invoice-product-results").classList.add("hidden");
  }
}

function bindPullToRefresh() {
  let startY = 0;
  let tracking = false;
  document.addEventListener("touchstart", (event) => {
    if (window.scrollY > 2) return;
    startY = event.touches[0]?.clientY || 0;
    tracking = true;
  }, { passive: true });
  document.addEventListener("touchend", async (event) => {
    if (!tracking) return;
    tracking = false;
    const endY = event.changedTouches[0]?.clientY || 0;
    if (endY - startY < 90 || window.scrollY > 2) return;
    setStatus("מרענן נתונים");
    if (state.persistTimer) await persistDatabase();
    window.location.reload();
  }, { passive: true });
}

function handleOrderCustomerResult(event) {
  const button = event.target.closest("[data-order-customer]");
  if (!button) return;
  event.preventDefault();
  chooseOrderCustomer(button.dataset.orderCustomer);
}

function handleOrderProductResult(event) {
  const button = event.target.closest("[data-order-product]");
  if (!button) return;
  event.preventDefault();
  openProductDialog(button.dataset.orderProduct);
}

function chooseOrderCustomer(customerNo) {
  const row = firstRow("SELECT customer_no, customer_name FROM customer_profitability_summary WHERE customer_no = ?", [customerNo]);
  state.orderCustomer = row.customer_no ? row : null;
  state.orderItems = [];
  state.removedOrderSkus = new Set();
  document.getElementById("order-customer-query").value = state.orderCustomer ? `${state.orderCustomer.customer_name} ${state.orderCustomer.customer_no}` : "";
  document.getElementById("order-customer-results").classList.add("hidden");
  document.getElementById("order-product-query").value = "";
  document.getElementById("order-customer-label").textContent = state.orderCustomer ? `${state.orderCustomer.customer_name} (${state.orderCustomer.customer_no})` : "לא נבחר לקוח";
  renderOrderProductResults();
  renderOrderTables();
}

function openProductDialog(sku) {
  if (!state.orderCustomer || !sku) return;
  const details = productDetailsForOrder(state.orderCustomer.customer_no, sku);
  state.pendingProduct = details;
  document.getElementById("modal-product-name").value = details.product_desc;
  document.getElementById("modal-product-price").value = currency2(details.last_price);
  const returnsEl = document.getElementById("modal-product-returns");
  returnsEl.textContent = percent(details.returns_percent);
  returnsEl.className = `readonly-value ${returnPercentClass(details.returns_percent)}`;
  const quantityInput = document.getElementById("modal-product-quantity");
  quantityInput.value = "1";
  document.getElementById("modal-product-note").value = "";
  document.getElementById("modal-product-return").checked = false;
  document.getElementById("modal-product-carton").checked = false;
  document.getElementById("product-modal").classList.remove("hidden");
  document.getElementById("order-product-results").classList.add("hidden");
  quantityInput.focus();
  quantityInput.select();
}

function closeProductDialog() {
  state.pendingProduct = null;
  document.getElementById("product-modal").classList.add("hidden");
}

function confirmProductDialog() {
  const quantity = number(document.getElementById("modal-product-quantity").value);
  const note = text(document.getElementById("modal-product-note").value);
  const isReturn = document.getElementById("modal-product-return").checked;
  const isCarton = document.getElementById("modal-product-carton").checked;
  if (!state.pendingProduct || quantity <= 0) return;
  addSkuToOrder(state.pendingProduct.sku, quantity, isReturn, isCarton, note);
  closeProductDialog();
  document.getElementById("order-product-query").value = "";
  renderOrderTables();
  focusOrderProductSearch();
}

function focusOrderProductSearch() {
  if (window.matchMedia("(max-width: 760px)").matches) return;
  requestAnimationFrame(() => {
    const input = document.getElementById("order-product-query");
    state.suppressProductFocusResults = true;
    input.focus();
    input.select();
    document.getElementById("order-product-results").classList.add("hidden");
    setTimeout(() => {
      state.suppressProductFocusResults = false;
    }, 180);
  });
}

function productDetailsForOrder(customerNo, sku) {
  const product = firstRow("SELECT sku, description, base_price, standard_cost, units_per_carton FROM products WHERE sku = ?", [sku]);
  const history = firstRow(`
    SELECT
      MAX(sku) AS sku,
      COALESCE(MAX(product_desc), ?) AS product_desc,
      CASE WHEN SUM(quantity) = 0 THEN 0 ELSE SUM(sales_amount) / SUM(quantity) END AS last_price,
      CASE WHEN SUM(quantity) = 0 THEN 0 ELSE SUM(profit) / SUM(quantity) END AS profit_per_unit,
      CASE WHEN COALESCE(SUM(purchase_units), 0) = 0 THEN 0 ELSE ABS(SUM(return_units) / SUM(purchase_units)) END AS returns_percent
    FROM sales_raw
    WHERE customer_no = ? AND sku = ?
  `, [sku, customerNo, sku]);
  const fallbackPrice = number(product.base_price);
  const lastPrice = number(history.last_price) || fallbackPrice;
  const profitPerUnit = number(history.last_price) ? number(history.profit_per_unit) : fallbackPrice - number(product.standard_cost);
  return {
    sku,
    product_desc: product.description || history.product_desc || sku,
    last_price: lastPrice,
    profit_per_unit: profitPerUnit,
    returns_percent: number(history.returns_percent),
    units_per_carton: number(product.units_per_carton) || 1,
  };
}

function addSkuToOrder(sku, quantity, isReturn = false, isCarton = false, note = "") {
  const details = productDetailsForOrder(state.orderCustomer.customer_no, sku);
  state.orderItems.push({
    line_id: state.nextOrderLineId++,
    sku,
    product_desc: details.product_desc,
    quantity,
    note,
    is_return: Boolean(isReturn),
    is_carton: Boolean(isCarton),
    units_per_carton: details.units_per_carton || 1,
    entry_sequence: state.orderItems.length + 1,
    estimated_price: details.last_price,
    estimated_profit_per_unit: details.profit_per_unit,
  });
}

function renderOrderTables() {
  const totals = state.orderItems.reduce((acc, item) => {
    const signedUnits = item.is_return ? -orderLineUnits(item) : orderLineUnits(item);
    acc.total += signedUnits * number(item.estimated_price);
    acc.profit += signedUnits * number(item.estimated_profit_per_unit);
    return acc;
  }, { total: 0, profit: 0 });
  document.getElementById("order-total").textContent = currency(totals.total);
  document.getElementById("order-profit").textContent = currency(totals.profit);
  const summaryItems = state.orderItems.filter((item) => !item.is_return && String(item.sku).trim() !== "999");
  document.getElementById("order-lines-total").textContent = integer(summaryItems.length);
  document.getElementById("order-units-total").textContent = numberDisplay(summaryItems.reduce((sum, item) => sum + orderLineUnits(item), 0));
  const duplicateKeys = new Set();
  const skuModeCounts = state.orderItems.reduce((acc, item) => {
    const key = `${item.sku}::${item.is_return ? "return" : "order"}`;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  Object.entries(skuModeCounts).forEach(([key, count]) => {
    if (count > 1) duplicateKeys.add(key);
  });
  const displayRows = [...state.orderItems].sort(compareOrderLineDisplay).map((item, index) => ({ ...item, display_sort: index + 1 }));
  state.sort.orderItems = { key: "display_sort", direction: "asc" };

  renderTable("order-items-table", displayRows, [
    { key: "product_desc", label: "מוצר", render: (row) => `
      <span>${escapeHtml(row.product_desc)}</span>
      ${row.is_return ? `<small class="order-line-note">החזרה</small>` : ""}
      ${row.is_carton ? `<small class="order-line-note">קרטון · ${numberDisplay(row.units_per_carton || 1)} יחידות בקרטון</small>` : ""}
      ${duplicateKeys.has(`${row.sku}::${row.is_return ? "return" : "order"}`) ? `<small class="order-line-note warning">מוצר מופיע בהזמנה</small>` : ""}
    ` },
    { key: "quantity", label: "כמות", render: (row) => `<input class="order-qty-input" type="number" inputmode="numeric" pattern="[0-9]*" min="0" step="1" value="${escapeAttr(row.quantity)}" data-order-qty="${escapeAttr(row.line_id)}" />` },
    { key: "note", label: "הערה", render: (row) => `<input value="${escapeAttr(row.note)}" data-order-note="${escapeAttr(row.line_id)}" />` },
    { key: "actions", label: "פעולה", sortable: false, render: (row) => `<button class="danger-action" data-remove-order="${escapeAttr(row.line_id)}">מחיקה</button>` },
  ], "orderItems", "display_sort", "asc");
  document.querySelectorAll("[data-order-qty]").forEach((input) => {
    input.addEventListener("focus", () => input.select());
    input.addEventListener("change", () => updateOrderItem(input.dataset.orderQty, "quantity", number(input.value)));
  });
  document.querySelectorAll("[data-order-note]").forEach((input) => input.addEventListener("change", () => updateOrderItem(input.dataset.orderNote, "note", input.value)));
  document.querySelectorAll("[data-remove-order]").forEach((button) => button.addEventListener("click", () => removeOrderItem(button.dataset.removeOrder)));
  renderSuggestedProducts();
  renderOrderRecommendations();
}

function orderLineUnits(item) {
  const multiplier = item.is_carton || number(item.is_carton) ? (number(item.units_per_carton) || 1) : 1;
  return Math.abs(number(item.quantity)) * multiplier;
}

function pickingCategoryClass(category) {
  const value = String(category || "").trim();
  if (value.includes("קפוא") || value.includes("בצק")) return "pick-category-cold";
  if (value.includes("יבש")) return "pick-category-dry";
  return "";
}

function compareOrderLineDisplay(a, b) {
  if (Boolean(a.is_return) !== Boolean(b.is_return)) return a.is_return ? 1 : -1;
  if (a.is_return && b.is_return) {
    const aIs999 = String(a.sku).trim() === "999";
    const bIs999 = String(b.sku).trim() === "999";
    if (aIs999 !== bIs999) return aIs999 ? -1 : 1;
  }
  return number(a.entry_sequence) - number(b.entry_sequence);
}

function renderSuggestedProducts() {
  const customerNo = state.orderCustomer?.customer_no || "";
  const selected = new Set(state.orderItems.map((item) => item.sku));
  const blocked = [...selected, ...state.removedOrderSkus];
  const customerRows = customerNo ? queryRows(`
    SELECT
      sku,
      COALESCE(MAX(product_desc), sku) AS product,
      SUM(quantity) AS quantity,
      CASE
        WHEN julianday(MAX(sale_date)) > julianday(MIN(sale_date))
          THEN SUM(quantity) / MAX(1, ((julianday(MAX(sale_date)) - julianday(MIN(sale_date)) + 1) / 7.0))
        ELSE SUM(quantity) / 26.0
      END AS weekly_quantity,
      CASE WHEN COALESCE(SUM(purchase_units), 0) = 0 THEN 0 ELSE ABS(SUM(return_units) / SUM(purchase_units)) END AS returns_percent
    FROM sales_raw
    WHERE customer_no = ?
    GROUP BY sku
    ORDER BY quantity DESC
    LIMIT 200
  `, [customerNo]).filter((row) => row.sku && !blocked.includes(row.sku)).slice(0, 30) : [];
  const used = new Set([...blocked, ...customerRows.map((row) => row.sku)]);
  const fillerRows = customerRows.length < 30 ? queryRows(`
    SELECT p.sku, COALESCE(p.description, p.sku) AS product, COALESCE(s.quantity, 0) AS quantity, COALESCE(s.weekly_quantity, 0) AS weekly_quantity, COALESCE(s.returns_percent, 0) AS returns_percent
    FROM products p
    LEFT JOIN (
      SELECT
        sku,
        SUM(quantity) AS quantity,
        CASE
          WHEN julianday(MAX(sale_date)) > julianday(MIN(sale_date))
            THEN SUM(quantity) / MAX(1, ((julianday(MAX(sale_date)) - julianday(MIN(sale_date)) + 1) / 7.0))
          ELSE SUM(quantity) / 26.0
        END AS weekly_quantity,
        CASE WHEN COALESCE(SUM(purchase_units), 0) = 0 THEN 0 ELSE ABS(SUM(return_units) / SUM(purchase_units)) END AS returns_percent
      FROM sales_raw
      GROUP BY sku
    ) s ON s.sku = p.sku
    WHERE p.sku <> ''
    ORDER BY COALESCE(s.quantity, 0) DESC, p.description
    LIMIT 300
  `).filter((row) => row.sku && !used.has(row.sku)).slice(0, 30 - customerRows.length) : [];
  const rows = [...customerRows, ...fillerRows];
  renderTable("order-suggested-table", rows, [
    { key: "product", label: "מוצר", render: (row) => `<button class="suggested-product-button" data-suggested-sku="${escapeAttr(row.sku)}">${escapeHtml(row.product)}</button>` },
    { key: "weekly_quantity", label: "ממוצע שבועי", format: numberDisplay },
    { key: "returns_percent", label: "% חזרות", render: (row) => `<span class="${returnPercentClass(row.returns_percent)}">${percent(row.returns_percent)}</span>` },
    { key: "actions", label: "פעולה", sortable: false, render: (row) => `
      <div class="suggested-actions">
        <button class="icon-button suggested-remove" data-dismiss-suggested="${escapeAttr(row.sku)}" title="הסרה מהרשימה">X</button>
      </div>
    ` },
  ], "suggested", "weekly_quantity", "desc");
  document.querySelectorAll("[data-suggested-sku]").forEach((button) => button.addEventListener("click", () => {
    openProductDialog(button.dataset.suggestedSku);
  }));
  document.querySelectorAll("[data-dismiss-suggested]").forEach((button) => button.addEventListener("click", () => {
    state.removedOrderSkus.add(button.dataset.dismissSuggested);
    renderOrderTables();
    focusOrderProductSearch();
  }));
}

function renderOrderRecommendations() {
  const list = document.getElementById("order-recommendations");
  if (!list) return;
  if (!state.orderCustomer?.customer_no) {
    list.innerHTML = `<li>יש לבחור לקוח להצגת המלצות</li>`;
    return;
  }
  const manual = queryRows("SELECT text FROM sales_recommendations WHERE active = 1 ORDER BY id DESC LIMIT 8").map((row) => row.text);
  const automatic = automaticRecommendations(state.orderCustomer.customer_no);
  const items = [...manual, ...automatic].slice(0, 12);
  list.innerHTML = items.length ? items.map((item) => `<li>${escapeHtml(item)}</li>`).join("") : `<li>אין המלצות פעילות</li>`;
}

function updateOrderItem(lineId, key, value) {
  const item = state.orderItems.find((entry) => String(entry.line_id) === String(lineId));
  if (item) item[key] = value;
  renderOrderTables();
}

function removeOrderItem(lineId) {
  const item = state.orderItems.find((entry) => String(entry.line_id) === String(lineId));
  state.orderItems = state.orderItems.filter((entry) => String(entry.line_id) !== String(lineId));
  if (item) state.removedOrderSkus.add(item.sku);
  renderOrderTables();
}

async function saveOrder() {
  if (!state.orderCustomer || !state.orderItems.length) return alert("יש לבחור לקוח ולהוסיף מוצרים להזמנה.");
  const now = new Date().toISOString();
  const orderDate = toSqlDate(new Date());
  const hasPickableItems = state.orderItems.some((item) => !item.is_return && number(item.quantity) > 0);
  const status = hasPickableItems ? "מוכן לאיסוף" : "picked";
  const notes = text(document.getElementById("order-notes").value);
  const clientOrderKey = createClientOrderKey();
  const totals = state.orderItems.reduce((acc, item) => {
    const signedUnits = item.is_return ? -orderLineUnits(item) : orderLineUnits(item);
    acc.total += signedUnits * number(item.estimated_price);
    acc.profit += signedUnits * number(item.estimated_profit_per_unit);
    return acc;
  }, { total: 0, profit: 0 });
  state.db.run(`
    INSERT INTO customer_orders (order_date, customer_no, customer_name, status, notes, estimated_total, estimated_profit, updated_at, client_order_key)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [orderDate, state.orderCustomer.customer_no, state.orderCustomer.customer_name, status, notes, totals.total, totals.profit, now, clientOrderKey]);
  const orderId = scalar("SELECT last_insert_rowid()");
  const stmt = state.db.prepare(`
    INSERT INTO customer_order_items (order_id, sku, product_desc, quantity, picked_quantity, note, item_status, entry_sequence, is_carton, units_per_carton, estimated_price, estimated_profit)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  state.orderItems.forEach((item) => {
    if (number(item.quantity) > 0) {
      const status = item.is_return ? "return" : "pending";
      const pickedQuantity = item.is_return ? number(item.quantity) : 0;
      const signedUnits = item.is_return ? -orderLineUnits(item) : orderLineUnits(item);
      stmt.run([
        orderId,
        item.sku,
        item.product_desc,
        number(item.quantity),
        pickedQuantity,
        text(item.note),
        status,
        number(item.entry_sequence),
        item.is_carton ? 1 : 0,
        number(item.units_per_carton) || 1,
        number(item.estimated_price),
        number(item.estimated_profit_per_unit) * signedUnits,
      ]);
    }
  });
  stmt.free();
  markCustomerOrderedCall(state.orderCustomer.customer_no, state.orderCustomer.customer_name, orderDate);
  const serverResult = await writeOrderDelta(buildCurrentOrderDelta({ orderDate, status, notes, totals, now, clientOrderKey }));
  await writeBrowserDatabase(state.db.export());
  if (serverResult.ok) {
    await reloadDatabaseFromServer();
  } else {
    alert(`השמירה לשרת נכשלה: ${serverResult.error || "שגיאה לא ידועה"}. ההזמנה נשמרה בדפדפן הזה בלבד.`);
  }
  alert(`הזמנה ${serverResult.orderId || orderId} נשמרה`);
  resetOrder({ clearCustomer: true });
  renderPicking();
  renderOrderHistory();
}

function resetOrder(options = {}) {
  state.orderItems = [];
  state.removedOrderSkus = new Set();
  if (options.clearCustomer) state.orderCustomer = null;
  document.getElementById("order-product-query").value = "";
  document.getElementById("order-notes").value = "";
  document.getElementById("order-customer-query").value = state.orderCustomer ? `${state.orderCustomer.customer_name} ${state.orderCustomer.customer_no}` : "";
  document.getElementById("order-customer-label").textContent = state.orderCustomer ? `${state.orderCustomer.customer_name} (${state.orderCustomer.customer_no})` : "לא נבחר לקוח";
  renderOrderTables();
}

function createClientOrderKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `order-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function buildCurrentOrderDelta({ orderDate, status, notes, totals, now, clientOrderKey }) {
  const customerNo = state.orderCustomer.customer_no;
  const customerName = state.orderCustomer.customer_name;
  const callDay = nearestCallDayForOrder(customerNo, orderDate);
  const callDate = callDateForDay(callDay, new Date(orderDate));
  return {
    order: {
      client_order_key: clientOrderKey,
      order_date: orderDate,
      customer_no: customerNo,
      customer_name: customerName,
      status,
      notes,
      estimated_total: totals.total,
      estimated_profit: totals.profit,
      updated_at: now,
    },
    items: state.orderItems.filter((item) => number(item.quantity) > 0).map((item) => {
      const signedUnits = item.is_return ? -orderLineUnits(item) : orderLineUnits(item);
      return {
        sku: item.sku,
        product_desc: item.product_desc,
        quantity: number(item.quantity),
        picked_quantity: item.is_return ? number(item.quantity) : 0,
        note: text(item.note),
        item_status: item.is_return ? "return" : "pending",
        entry_sequence: number(item.entry_sequence),
        is_carton: item.is_carton ? 1 : 0,
        units_per_carton: number(item.units_per_carton) || 1,
        estimated_price: number(item.estimated_price),
        estimated_profit: number(item.estimated_profit_per_unit) * signedUnits,
      };
    }),
    call: {
      call_date: callDate,
      customer_no: customerNo,
      customer_name: customerName,
      status: "ordered",
      notes: "סומן אוטומטית לאחר שידור הזמנה",
      updated_at: now,
    },
  };
}

function exportCurrentOrder() {
  if (!state.orderCustomer || !state.orderItems.length) return alert("אין הזמנה לייצוא.");
  exportPriorityRows({ ...state.orderCustomer, notes: document.getElementById("order-notes").value }, state.orderItems);
}

function exportPriorityRows(customer, items) {
  const rows = priorityFlatRowsForOrders([{ customer, items }]);
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, sheet, "Priority");
  XLSX.writeFile(workbook, `priority-${customer.customer_no}-${toSqlDate(new Date())}.xlsx`);
}

function priorityFlatRowsForOrders(orders) {
  const rows = [];
  let sequence = 1;
  orders.forEach(({ customer, items }) => {
    rows.push([sequence, customer.customer_no, "", "", 1]);
    sequence += 1;
    priorityExportItems(items).forEach((item) => {
      const sku = String(item.export_sku || item.sku || "").trim();
      const quantity = exportQuantityForPriority(item);
      const isReturnMarker = sku === "999" || item.is_return_marker;
      if (!sku || (!isReturnMarker && quantity === 0)) return;
      rows.push([sequence, "", sku, isReturnMarker ? 0 : quantity, 2]);
      sequence += 1;
    });
  });
  return rows;
}

function priorityRowsForCustomer(customer, items) {
  return priorityFlatRowsForOrders([{ customer, items }]);
}

function priorityExportItems(items) {
  const normalized = [...items];
  const hasReturns = normalized.some((item) => Boolean(item.is_return) || item.item_status === "return" || exportQuantityForPriority(item) < 0);
  const hasReturnMarker = normalized.some((item) => String(item.export_sku || item.sku).trim() === "999");
  if (hasReturns && !hasReturnMarker) {
    normalized.push({
      sku: "999",
      export_sku: "999",
      product_desc: "החזרות",
      export_product_desc: "החזרות",
      export_quantity: 1,
      is_return_marker: true,
      action_sequence: 999999999,
      export_sequence: -1,
    });
  }
  return normalized.sort(comparePriorityExportItems);
}

function exportQuantityForPriority(item) {
  if (item.is_return_marker) return 0;
  const rawQuantity = number(item.export_quantity ?? (item.is_return ? -Math.abs(number(item.quantity)) : item.quantity));
  const multiplier = (item.is_carton || number(item.is_carton)) ? (number(item.units_per_carton) || 1) : 1;
  return rawQuantity * multiplier;
}

function comparePriorityExportItems(a, b) {
  const aReturn = exportQuantityForPriority(a) < 0 || Boolean(a.is_return) || a.item_status === "return" || Boolean(a.is_return_marker);
  const bReturn = exportQuantityForPriority(b) < 0 || Boolean(b.is_return) || b.item_status === "return" || Boolean(b.is_return_marker);
  if (aReturn !== bReturn) return aReturn ? 1 : -1;
  if (aReturn && bReturn) {
    const aIs999 = String(a.export_sku || a.sku).trim() === "999";
    const bIs999 = String(b.export_sku || b.sku).trim() === "999";
    if (aIs999 !== bIs999) return aIs999 ? -1 : 1;
    return number(a.export_sequence ?? a.entry_sequence ?? a.action_sequence ?? 0) - number(b.export_sequence ?? b.entry_sequence ?? b.action_sequence ?? 0);
  }
  const actionDiff = number(a.action_sequence ?? a.export_sequence ?? a.entry_sequence ?? 0) - number(b.action_sequence ?? b.export_sequence ?? b.entry_sequence ?? 0);
  if (actionDiff !== 0) return actionDiff;
  const pickOrderDiff = number(a.export_pick_order ?? 999999) - number(b.export_pick_order ?? 999999);
  if (pickOrderDiff !== 0) return pickOrderDiff;
  return number(a.export_sequence ?? a.entry_sequence ?? 0) - number(b.export_sequence ?? b.entry_sequence ?? 0);
}

async function renderPicking() {
  normalizeClosedOrderStatuses();
  if (!state.pendingPickingChanges.length && !state.serverSaveInProgress) await syncOrderHistoryFromPostgres();
  document.querySelectorAll("[data-picking-mode]").forEach((button) => button.classList.toggle("active", button.dataset.pickingMode === state.pickingMode));
  document.getElementById("product-picking-controls").classList.toggle("hidden", state.pickingMode !== "product");
  if (state.pickingMode === "product") {
    renderPickingByProduct();
    return;
  }
  const orders = queryRows(`
    SELECT
      o.id AS order_id,
      o.order_date,
      o.customer_name,
      o.status,
      COUNT(CASE WHEN COALESCE(i.item_status, 'pending') <> 'return' THEN i.id END) AS item_count,
      COALESCE(SUM(CASE WHEN COALESCE(i.item_status, 'pending') <> 'return' THEN i.quantity ELSE 0 END), 0) AS total_quantity,
      COALESCE(SUM(CASE WHEN COALESCE(i.item_status, 'pending') <> 'return' THEN i.picked_quantity ELSE 0 END), 0) AS picked_quantity,
      COALESCE(SUM(CASE WHEN COALESCE(i.item_status, 'pending') <> 'return' THEN i.quantity * COALESCE(NULLIF(i.units_per_carton, 0), 1) ELSE 0 END), 0) AS total_units
    FROM customer_orders o
    LEFT JOIN customer_order_items i ON i.order_id = o.id
    WHERE o.status IN ('מוכן לאיסוף')
      AND COALESCE(o.shipped_at, '') = ''
      AND COALESCE(o.process_hidden, 0) = 0
    GROUP BY o.id
    ORDER BY o.id DESC
    LIMIT 250
  `);
  const list = document.getElementById("picking-list");
  if (!orders.length) {
    state.selectedPickingOrderId = null;
    list.innerHTML = `<div class="empty-state">אין הזמנות לליקוט</div>`;
    return;
  }
  if (!state.selectedPickingOrderId || !orders.some((order) => String(order.order_id) === String(state.selectedPickingOrderId))) {
    state.selectedPickingOrderId = orders[0].order_id;
  }
  const selected = orders.find((order) => String(order.order_id) === String(state.selectedPickingOrderId)) || orders[0];
  list.innerHTML = `
    <div class="picking-tabs">
      ${orders.map((order) => `
        <button class="picking-tab ${String(order.order_id) === String(selected.order_id) ? "active" : ""}" data-picking-tab="${order.order_id}">
          ${escapeHtml(order.customer_name)}
        </button>
      `).join("")}
    </div>
    <div class="picking-workspace">
      <div class="picking-order">
        <div class="picking-order-header">
          <strong>הזמנה ${integer(selected.order_id)}</strong>
          <span>${escapeHtml(selected.customer_name)}</span>
          <span>${escapeHtml(selected.order_date)}</span>
          <span>${escapeHtml(selected.status)}</span>
          <span>${integer(selected.item_count)} שורות</span>
          <span>${numberDisplay(selected.total_units)} יחידות</span>
          <span>${numberDisplay(selected.picked_quantity)} / ${numberDisplay(selected.total_quantity)} לוקטו</span>
        </div>
      </div>
      ${pickingOrderItemsHtml(selected.order_id)}
    </div>
  `;
  document.querySelectorAll("[data-picking-tab]").forEach((button) => button.addEventListener("click", () => {
    state.selectedPickingOrderId = button.dataset.pickingTab;
    renderPicking();
  }));
  bindPickingActions();
}

function normalizeClosedOrderStatuses() {
  state.db.run("UPDATE customer_orders SET status = 'נשלחה' WHERE COALESCE(shipped_at, '') <> '' AND status <> 'נשלחה'");
  state.db.run("UPDATE customer_orders SET status = 'picked' WHERE COALESCE(picked_at, '') <> '' AND COALESCE(shipped_at, '') = '' AND status = 'מוכן לאיסוף'");
  state.db.run(`
    UPDATE customer_orders
    SET status = 'picked',
        picked_by = COALESCE(picked_by, 'מלקט'),
        picked_at = COALESCE(picked_at, ?),
        updated_at = ?
    WHERE status = 'מוכן לאיסוף'
      AND EXISTS (
        SELECT 1 FROM customer_order_items i
        WHERE i.order_id = customer_orders.id
          AND COALESCE(i.item_status, 'pending') <> 'return'
      )
      AND NOT EXISTS (
        SELECT 1 FROM customer_order_items i
        WHERE i.order_id = customer_orders.id
          AND COALESCE(i.item_status, 'pending') = 'pending'
          AND COALESCE(i.item_status, 'pending') <> 'return'
      )
  `, [new Date().toISOString(), new Date().toISOString()]);
}

function refreshPickingProductControls() {
  const category = state.selectedPickingCategory || "";
  const rawQuery = state.pickingProductQuery || "";
  const productQuery = `%${rawQuery}%`;
  const productQueryFilter = rawQuery ? `AND (i.sku LIKE ? OR i.product_desc LIKE ? OR p.description LIKE ?)` : "";
  const productRows = queryRows(`
    SELECT i.sku, COALESCE(MAX(p.description), MAX(i.product_desc), i.sku) AS description, COALESCE(MAX(p.pick_order), 999999) AS pick_order
    FROM customer_order_items i
    JOIN customer_orders o ON o.id = i.order_id
    LEFT JOIN products p ON p.sku = i.sku
    WHERE o.status = 'מוכן לאיסוף'
      AND COALESCE(o.shipped_at, '') = ''
      AND COALESCE(o.process_hidden, 0) = 0
      AND COALESCE(i.item_status, 'pending') = 'pending'
      AND (? = '' OR COALESCE(p.category, '') = ?)
      ${productQueryFilter}
    GROUP BY i.sku
    ORDER BY pick_order, description
  `, rawQuery ? [category, category, productQuery, productQuery, productQuery] : [category, category]);
  const productQueryInput = document.getElementById("picking-product-query");
  if (productQueryInput && productQueryInput.value !== rawQuery) productQueryInput.value = rawQuery;
  const productSelect = document.getElementById("picking-product-select");
  productSelect.innerHTML = `<option value="">בחירת מוצר</option>` + productRows.map((row) => `<option value="${escapeAttr(row.sku)}">${escapeHtml(row.description)} - ${escapeHtml(row.sku)}</option>`).join("");
  productSelect.value = productRows.some((row) => row.sku === state.selectedPickingProductSku) ? state.selectedPickingProductSku : "";
  state.selectedPickingProductSku = productSelect.value;

  const categoryRows = queryRows(`
    SELECT DISTINCT COALESCE(p.category, '') AS category
    FROM customer_order_items i
    JOIN customer_orders o ON o.id = i.order_id
    LEFT JOIN products p ON p.sku = i.sku
    WHERE o.status = 'מוכן לאיסוף'
      AND COALESCE(o.shipped_at, '') = ''
      AND COALESCE(o.process_hidden, 0) = 0
      AND COALESCE(i.item_status, 'pending') = 'pending'
      AND COALESCE(p.category, '') <> ''
    ORDER BY category
  `);
  const categorySelect = document.getElementById("picking-category-select");
  categorySelect.innerHTML = `<option value="">כל הקטגוריות</option>` + categoryRows.map((row) => `<option value="${escapeAttr(row.category)}">${escapeHtml(row.category)}</option>`).join("");
  categorySelect.value = categoryRows.some((row) => row.category === state.selectedPickingCategory) ? state.selectedPickingCategory : "";
  state.selectedPickingCategory = categorySelect.value;
}

function renderPickingByProduct() {
  refreshPickingProductControls();
  const list = document.getElementById("picking-list");
  if (!state.selectedPickingProductSku && !state.selectedPickingCategory && !state.pickingProductQuery) {
    list.innerHTML = `<div class="empty-state">יש לבחור מוצר או קטגוריה לליקוט</div>`;
    return;
  }
  const productQuery = `%${state.pickingProductQuery || ""}%`;
  const rows = queryRows(`
    SELECT
      i.id,
      i.sku,
      i.product_desc,
      i.quantity,
      i.picked_quantity,
      i.note,
      i.is_carton,
      i.units_per_carton,
      p.category,
      o.id AS order_id,
      o.customer_name,
      o.notes AS order_notes
    FROM customer_order_items i
    JOIN customer_orders o ON o.id = i.order_id
    LEFT JOIN products p ON p.sku = i.sku
    WHERE o.status = 'מוכן לאיסוף'
      AND COALESCE(o.shipped_at, '') = ''
      AND COALESCE(o.process_hidden, 0) = 0
      AND COALESCE(i.item_status, 'pending') = 'pending'
      AND (? = '' OR i.sku = ?)
      AND (? = '' OR COALESCE(p.category, '') = ?)
      AND (? = '%%' OR i.sku LIKE ? OR i.product_desc LIKE ? OR p.description LIKE ?)
    ORDER BY COALESCE(p.pick_order, 999999), i.product_desc, o.customer_name, o.id
  `, [state.selectedPickingProductSku, state.selectedPickingProductSku, state.selectedPickingCategory, state.selectedPickingCategory, productQuery, productQuery, productQuery, productQuery]);
  const totalUnits = rows.reduce((sum, row) => sum + orderLineUnits(row), 0);
  const showProductColumn = !state.selectedPickingProductSku;
  list.innerHTML = `
    <div class="order-pick-note">סך הכל לקוחות: ${integer(rows.length)} · סך הכל יחידות: ${numberDisplay(totalUnits)}</div>
    <div class="table-wrap">
      <table class="compact-table product-picking-table">
        <thead><tr>${showProductColumn ? "<th>מוצר</th>" : ""}<th>שם לקוח</th><th>כמות</th><th>פעולות</th></tr></thead>
        <tbody>
          ${rows.length ? rows.map((row) => `
            <tr class="${pickingCategoryClass(row.category)}">
              ${showProductColumn ? `<td><strong>${escapeHtml(row.product_desc)}</strong><small class="pick-note">${escapeHtml(row.sku)}</small></td>` : ""}
              <td>
                <strong>${escapeHtml(row.customer_name)}</strong>
                <small class="pick-note">הזמנה ${integer(row.order_id)}</small>
                ${row.order_notes ? `<small class="pick-note">הערות הזמנה: ${escapeHtml(row.order_notes)}</small>` : ""}
                ${row.note ? `<small class="pick-note">הערת מוצר: ${escapeHtml(row.note)}</small>` : ""}
              </td>
              <td>
                <input class="pick-quantity-input" type="number" inputmode="decimal" min="0" step="0.01" value="${escapeAttr(row.picked_quantity || row.quantity || 0)}" data-pick-qty="${row.id}" />
                ${row.is_carton ? `<small class="pick-note">${numberDisplay(row.quantity)} קרטון · ${numberDisplay(row.units_per_carton || 1)} יחידות בקרטון</small>` : ""}
              </td>
              <td>
                <button class="pick-action pick-ok" data-pick-ok="${row.id}" title="אישור ליקוט">V</button>
                <button class="pick-action pick-missing" data-pick-missing="${row.id}" title="חסר במלאי">X</button>
              </td>
            </tr>
          `).join("") : `<tr><td colspan="${showProductColumn ? 4 : 3}" class="empty-state">אין פריטים פתוחים לבחירה הזו</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
  bindPickingActions();
}

function pickingOrderItemsHtml(orderId) {
  const pending = queryRows(`
    SELECT i.id, i.sku, i.product_desc, i.quantity, i.picked_quantity, i.note, i.is_carton, i.units_per_carton, p.category, o.notes AS order_notes
    FROM customer_order_items i
    JOIN customer_orders o ON o.id = i.order_id
    LEFT JOIN products p ON p.sku = i.sku
    WHERE i.order_id = ? AND COALESCE(i.item_status, 'pending') = 'pending'
    ORDER BY COALESCE(p.pick_order, 999999), i.id
  `, [orderId]);
  const done = queryRows(`
    SELECT i.id, i.sku, i.product_desc, i.quantity, i.picked_quantity, i.note, i.item_status, i.substitute_product_id, i.is_carton, i.units_per_carton,
      COALESCE(sp.description, i.substitute_product_id) AS substitute_desc
    FROM customer_order_items i
    LEFT JOIN products sp ON sp.sku = i.substitute_product_id
    WHERE i.order_id = ? AND COALESCE(i.item_status, 'pending') IN ('picked', 'substituted')
    ORDER BY COALESCE(i.action_sequence, i.id), i.id
  `, [orderId]);
  const pickableRows = [...pending, ...done];
  const totalLines = pickableRows.length;
  const totalUnits = pickableRows.reduce((sum, row) => sum + orderLineUnits(row), 0);
  const pendingRows = pending.length ? pending.map((row) => `
    <tr class="${pickingCategoryClass(row.category)}">
      <td><input class="pick-quantity-input" type="number" inputmode="decimal" min="0" step="0.01" value="${escapeAttr(row.picked_quantity || row.quantity || 0)}" data-pick-qty="${row.id}" /></td>
      <td>
        <button class="pick-product-button" data-substitute-item="${row.id}">${escapeHtml(row.product_desc)}</button>
        ${row.is_carton ? `<small class="pick-note">כמות בקרטונים: ${numberDisplay(row.quantity)} קרטון · ${numberDisplay(row.units_per_carton || 1)} יחידות בקרטון</small>` : ""}
        ${row.substitute_product_id ? `<small class="pick-note">חלופי נבחר: ${escapeHtml(row.substitute_product_id)}</small>` : ""}
        ${row.note ? `<small class="pick-note">הערת מוצר: ${escapeHtml(row.note)}</small>` : ""}
      </td>
      <td>
        <button class="pick-action pick-ok" data-pick-ok="${row.id}" title="אישור ליקוט">V</button>
        <button class="pick-action pick-missing" data-pick-missing="${row.id}" title="חסר במלאי">X</button>
      </td>
    </tr>
  `).join("") : `<tr><td colspan="3" class="empty-state">אין מוצרים ממתינים לליקוט</td></tr>`;
  const orderNotes = pending[0]?.order_notes || firstRow("SELECT notes FROM customer_orders WHERE id = ?", [orderId]).notes || "";
  const pickedRows = done.length ? done.map((row) => `
    <li class="picked-list-item" draggable="true" data-picked-item="${row.id}">
      <span class="drag-handle" title="גרירה לשינוי סדר">⋮⋮</span>
      ${escapeHtml(row.product_desc)} - כמות לוקטה: ${numberDisplay(row.picked_quantity)}
      ${row.is_carton ? ` קרטון (${numberDisplay(row.units_per_carton || 1)} יחידות בקרטון)` : ""}
      ${row.item_status === "substituted" ? ` - חלופי: ${escapeHtml(row.substitute_desc || row.substitute_product_id || "")}` : ""}
      ${row.note ? ` - הערה: ${escapeHtml(row.note)}` : ""}
      <input class="picked-qty-inline" type="number" inputmode="decimal" min="0" step="0.01" value="${escapeAttr(row.picked_quantity)}" data-picked-inline-qty="${row.id}" />
      <button class="small-action" data-edit-picked="${row.id}">החזר לליקוט</button>
    </li>
  `).join("") : `<li>אין מוצרים שלוקטו עדיין</li>`;
  const canComplete = pending.length === 0 && done.length > 0;
  const order = firstRow("SELECT status FROM customer_orders WHERE id = ?", [orderId]);
  return `
    <div class="picking-order-items">
      <h3 class="picking-section-title">ליקוט פעיל</h3>
      ${orderNotes ? `<div class="order-pick-note">הערות להזמנה: ${escapeHtml(orderNotes)}</div>` : ""}
      <div class="order-pick-note">סך הכל שורות: ${integer(totalLines)} · סך הכל יחידות: ${numberDisplay(totalUnits)}</div>
      <div class="table-wrap">
        <table class="compact-table">
          <thead><tr><th>כמות</th><th>מוצר</th><th>פעולות</th></tr></thead>
          <tbody>${pendingRows}</tbody>
        </table>
      </div>
      <div class="picked-list">
        <h3 class="picking-section-title">לוקט</h3>
        <ol>${pickedRows}</ol>
      </div>
      <div class="picking-complete-bar">
        <button class="secondary-action" data-add-picking-product="${orderId}">הוספת מוצר</button>
        <button class="secondary-action" data-pick-all="${orderId}" ${pending.length ? "" : "disabled"}>סמן שלוקט הכל</button>
        <button class="primary-action" data-complete-picking="${orderId}" ${canComplete && order.status !== "picked" ? "" : "disabled"}>אשר ליקוט</button>
        ${order.status === "picked" ? `<button class="secondary-action" data-export-picked="${orderId}">יצוא לפריוריטי</button>` : ""}
      </div>
    </div>
  `;
}

function bindPickingActions() {
  document.querySelectorAll("[data-pick-qty]").forEach((input) => {
    input.addEventListener("focus", () => input.select());
    input.addEventListener("change", () => {
      const pickedQuantity = quantityNumber(input.value);
      state.db.run("UPDATE customer_order_items SET picked_quantity = ? WHERE id = ?", [pickedQuantity, input.dataset.pickQty]);
      queuePickingChange({ type: "itemQuantity", itemId: input.dataset.pickQty, pickedQuantity });
      savePickingNow({ silent: true });
    });
  });
  document.querySelectorAll("[data-pick-ok]").forEach((button) => button.addEventListener("click", () => markPickingItem(button.dataset.pickOk, "picked")));
  document.querySelectorAll("[data-pick-missing]").forEach((button) => button.addEventListener("click", () => markPickingItem(button.dataset.pickMissing, "missing")));
  document.querySelectorAll("[data-substitute-item]").forEach((button) => button.addEventListener("click", () => openSubstituteDialog(button.dataset.substituteItem)));
  document.querySelectorAll("[data-edit-picked]").forEach((button) => button.addEventListener("click", () => editPickedItem(button.dataset.editPicked)));
  document.querySelectorAll("[data-picked-inline-qty]").forEach((input) => {
    input.addEventListener("focus", () => input.select());
    input.addEventListener("change", () => updatePickedInlineQuantity(input.dataset.pickedInlineQty, input.value));
  });
  document.querySelectorAll("[data-picked-item]").forEach((item) => {
    item.addEventListener("dragstart", (event) => {
      event.dataTransfer?.setData("text/plain", item.dataset.pickedItem);
      item.classList.add("dragging");
    });
    item.addEventListener("dragend", () => item.classList.remove("dragging"));
    item.addEventListener("dragover", (event) => event.preventDefault());
    item.addEventListener("drop", (event) => {
      event.preventDefault();
      const sourceId = event.dataTransfer?.getData("text/plain");
      if (sourceId && sourceId !== item.dataset.pickedItem) reorderPickedItems(sourceId, item.dataset.pickedItem);
    });
  });
  document.querySelectorAll("[data-add-picking-product]").forEach((button) => button.addEventListener("click", () => openAddPickingProductDialog(button.dataset.addPickingProduct)));
  document.querySelectorAll("[data-pick-all]").forEach((button) => button.addEventListener("click", () => pickAllPendingItems(button.dataset.pickAll)));
  document.querySelectorAll("[data-complete-picking]").forEach((button) => button.addEventListener("click", () => completePickingOrder(button.dataset.completePicking)));
  document.querySelectorAll("[data-export-picked]").forEach((button) => button.addEventListener("click", () => exportSavedOrder(button.dataset.exportPicked)));
}

async function updatePickedInlineQuantity(itemId, rawValue) {
  const pickedQuantity = quantityNumber(rawValue);
  const row = firstRow("SELECT item_status, quantity, action_sequence FROM customer_order_items WHERE id = ?", [itemId]);
  state.db.run("UPDATE customer_order_items SET picked_quantity = ? WHERE id = ?", [pickedQuantity, itemId]);
  queuePickingChange({
    type: "itemStatus",
    itemId,
    itemStatus: row.item_status || "picked",
    pickedQuantity,
    actionSequence: number(row.action_sequence) || nextActionSequence(),
  });
  await savePickingNow({ silent: true });
  renderPicking();
}

async function reorderPickedItems(sourceId, targetId) {
  const source = firstRow("SELECT order_id FROM customer_order_items WHERE id = ?", [sourceId]);
  if (!source.order_id) return;
  const rows = queryRows(`
    SELECT id, item_status, picked_quantity, quantity
    FROM customer_order_items
    WHERE order_id = ? AND COALESCE(item_status, 'pending') IN ('picked', 'substituted')
    ORDER BY COALESCE(action_sequence, id), id
  `, [source.order_id]);
  const ids = rows.map((row) => String(row.id));
  const sourceIndex = ids.indexOf(String(sourceId));
  const targetIndex = ids.indexOf(String(targetId));
  if (sourceIndex < 0 || targetIndex < 0) return;
  const [moved] = rows.splice(sourceIndex, 1);
  rows.splice(targetIndex, 0, moved);
  const sequenceStart = nextActionSequence();
  rows.forEach((row, index) => {
    const sequence = sequenceStart + index;
    const pickedQuantity = number(row.picked_quantity) || number(row.quantity);
    state.db.run("UPDATE customer_order_items SET action_sequence = ? WHERE id = ?", [sequence, row.id]);
    queuePickingChange({ type: "itemStatus", itemId: row.id, itemStatus: row.item_status || "picked", pickedQuantity, actionSequence: sequence });
  });
  renderPicking();
  await savePickingNow({ silent: true });
}

async function markPickingItem(itemId, status, skipCartonDialog = false) {
  const row = firstRow("SELECT quantity, picked_quantity, substitute_product_id, is_carton, units_per_carton FROM customer_order_items WHERE id = ?", [itemId]);
  if (status === "picked" && row.is_carton && !skipCartonDialog) {
    openCartonDialog(itemId, row.units_per_carton);
    return;
  }
  const pickedQuantity = status === "missing" ? 0 : (number(row.picked_quantity) || number(row.quantity));
  const itemStatus = status === "picked" && row.substitute_product_id ? "substituted" : status;
  state.db.run(`
    UPDATE customer_order_items
    SET item_status = ?, picked_quantity = ?, action_sequence = ?
    WHERE id = ?
  `, [itemStatus, pickedQuantity, nextActionSequence(), itemId]);
  queuePickingChange({
    type: "itemStatus",
    itemId,
    itemStatus,
    pickedQuantity,
    actionSequence: nextActionSequence() - 1,
  });
  renderPicking();
  await savePickingNow({ silent: true });
}

function openCartonDialog(itemId, unitsPerCarton) {
  state.cartonItemId = itemId;
  const input = document.getElementById("carton-units-input");
  input.value = number(unitsPerCarton) || 1;
  document.getElementById("carton-modal").classList.remove("hidden");
  input.focus();
  input.select();
}

function closeCartonDialog() {
  state.cartonItemId = null;
  document.getElementById("carton-modal").classList.add("hidden");
}

async function confirmCartonPicking() {
  const itemId = state.cartonItemId;
  if (!itemId) return closeCartonDialog();
  const units = number(document.getElementById("carton-units-input").value) || 1;
  const row = firstRow("SELECT sku FROM customer_order_items WHERE id = ?", [itemId]);
  state.db.run("UPDATE customer_order_items SET units_per_carton = ? WHERE id = ?", [units, itemId]);
  if (row.sku) state.db.run("UPDATE products SET units_per_carton = ?, updated_at = ? WHERE sku = ?", [units, new Date().toISOString(), row.sku]);
  queuePickingChange({ type: "productUnits", itemId, sku: row.sku || "", unitsPerCarton: units });
  closeCartonDialog();
  await markPickingItem(itemId, "picked", true);
}

async function pickAllPendingItems(orderId) {
  const rows = queryRows("SELECT id, quantity, picked_quantity, substitute_product_id FROM customer_order_items WHERE order_id = ? AND COALESCE(item_status, 'pending') = 'pending'", [orderId]);
  const sequenceStart = nextActionSequence();
  state.db.run("BEGIN TRANSACTION");
  rows.forEach((row, index) => {
    const status = row.substitute_product_id ? "substituted" : "picked";
    const pickedQuantity = number(row.picked_quantity) || number(row.quantity);
    state.db.run("UPDATE customer_order_items SET item_status = ?, picked_quantity = ?, action_sequence = ? WHERE id = ?", [status, pickedQuantity, sequenceStart + index, row.id]);
    queuePickingChange({ type: "itemStatus", itemId: row.id, itemStatus: status, pickedQuantity, actionSequence: sequenceStart + index });
  });
  state.db.run("COMMIT");
  renderPicking();
  await savePickingNow({ silent: true });
}

function nextActionSequence() {
  return number(scalar("SELECT COALESCE(MAX(action_sequence), 0) + 1 FROM customer_order_items"));
}

function openSubstituteDialog(itemId) {
  state.substituteItemId = itemId;
  state.pickingProductMode = "substitute";
  state.selectedPickingProduct = null;
  document.getElementById("substitute-query").value = "";
  document.getElementById("substitute-quantity").value = number(firstRow("SELECT picked_quantity, quantity FROM customer_order_items WHERE id = ?", [itemId]).picked_quantity) || number(firstRow("SELECT quantity FROM customer_order_items WHERE id = ?", [itemId]).quantity) || 1;
  document.getElementById("substitute-modal-title").textContent = "חפש מוצר חלופי";
  document.getElementById("substitute-modal").classList.remove("hidden");
  renderSubstituteResults();
  document.getElementById("substitute-query").focus();
}

function closeSubstituteDialog() {
  state.substituteItemId = null;
  state.pickingProductMode = null;
  state.selectedPickingProduct = null;
  document.getElementById("substitute-modal").classList.add("hidden");
}

function renderSubstituteResults() {
  const query = `%${document.getElementById("substitute-query").value.trim()}%`;
  const rows = queryRows(`
    SELECT sku, description
    FROM products
    WHERE sku LIKE ? OR description LIKE ?
    ORDER BY description
    LIMIT 80
  `, [query, query]);
  document.getElementById("substitute-results").innerHTML = rows.length ? rows.map((row) => `
    <button class="autocomplete-option" data-substitute-product="${escapeAttr(row.sku)}">
      <strong>${escapeHtml(row.description || row.sku)}</strong>
      <small>${escapeHtml(row.sku)}</small>
    </button>
  `).join("") : `<div class="empty-state">אין מוצרים מתאימים</div>`;
}

function handleSubstituteResult(event) {
  const button = event.target.closest("[data-substitute-product]");
  if (!button) return;
  event.preventDefault();
  state.selectedPickingProduct = button.dataset.substituteProduct;
  const label = button.querySelector("strong")?.textContent || button.dataset.substituteProduct;
  document.getElementById("substitute-query").value = label;
  document.getElementById("substitute-results").innerHTML = "";
  const quantityInput = document.getElementById("substitute-quantity");
  quantityInput.focus();
  quantityInput.select();
}

async function confirmPickingProductDialog() {
  const sku = state.selectedPickingProduct;
  const quantity = quantityNumber(document.getElementById("substitute-quantity").value);
  if (!sku || quantity <= 0) return alert("יש לבחור מוצר וכמות.");
  if (state.pickingProductMode === "substitute") {
    state.db.run(`
      UPDATE customer_order_items
      SET substitute_product_id = ?, picked_quantity = ?
      WHERE id = ?
    `, [sku, quantity, state.substituteItemId]);
    queuePickingChange({ type: "itemSubstitute", itemId: state.substituteItemId, substituteProductId: sku, pickedQuantity: quantity });
  }
  if (state.pickingProductMode === "add") {
    const product = firstRow("SELECT sku, description, base_price, standard_cost FROM products WHERE sku = ?", [sku]);
    const details = productDetailsForOrder(state.addPickingCustomerNo || "", sku);
    state.db.run(`
      INSERT INTO customer_order_items (order_id, sku, product_desc, quantity, picked_quantity, note, item_status, entry_sequence, is_carton, units_per_carton, estimated_price, estimated_profit)
      VALUES (?, ?, ?, ?, ?, '', 'pending', ?, 0, 1, ?, ?)
    `, [state.selectedPickingOrderId, sku, product.description || details.product_desc || sku, quantity, quantity, nextActionSequence(), details.last_price, details.profit_per_unit * quantity]);
    const itemId = number(scalar("SELECT last_insert_rowid()"));
    const item = firstRow("SELECT * FROM customer_order_items WHERE id = ?", [itemId]);
    queuePickingChange({ type: "itemAdd", item });
  }
  await savePickingNow({ silent: true });
  closeSubstituteDialog();
  renderPicking();
}

function openAddPickingProductDialog(orderId) {
  const order = firstRow("SELECT customer_no FROM customer_orders WHERE id = ?", [orderId]);
  state.selectedPickingOrderId = orderId;
  state.addPickingCustomerNo = order.customer_no || "";
  state.pickingProductMode = "add";
  state.substituteItemId = null;
  state.selectedPickingProduct = null;
  document.getElementById("substitute-modal-title").textContent = "הוסף מוצר לליקוט";
  document.getElementById("substitute-query").value = "";
  document.getElementById("substitute-quantity").value = "1";
  document.getElementById("substitute-modal").classList.remove("hidden");
  renderSubstituteResults();
  document.getElementById("substitute-query").focus();
}

function editPickedItem(itemId) {
  const row = firstRow("SELECT quantity, picked_quantity FROM customer_order_items WHERE id = ?", [itemId]);
  const pickedQuantity = number(row.picked_quantity) || number(row.quantity);
  state.db.run("UPDATE customer_order_items SET item_status = 'pending', picked_quantity = ? WHERE id = ?", [pickedQuantity, itemId]);
  queuePickingChange({ type: "itemPending", itemId, pickedQuantity });
  renderPicking();
  savePickingNow({ silent: true });
}

async function completePickingOrder(orderId) {
  const pending = scalar("SELECT COUNT(*) FROM customer_order_items WHERE order_id = ? AND COALESCE(item_status, 'pending') = 'pending'", [orderId]);
  if (number(pending) > 0) return;
  const now = new Date().toISOString();
  state.db.run("UPDATE customer_orders SET status = 'picked', picked_by = ?, picked_at = ?, updated_at = ? WHERE id = ?", ["מלקט", now, now, orderId]);
  queuePickingChange({ type: "completeOrder", orderId, pickedBy: "מלקט", pickedAt: now, updatedAt: now });
  await savePickingNow();
  renderPicking();
  renderOrderHistory();
}

async function manualCompletePickingOrder(orderId) {
  const now = new Date().toISOString();
  const pendingItems = queryRows(`
    SELECT id, quantity, picked_quantity
    FROM customer_order_items
    WHERE order_id = ? AND COALESCE(item_status, 'pending') = 'pending'
  `, [orderId]);
  const actionSequence = nextActionSequence();
  state.db.run("UPDATE customer_order_items SET item_status = 'picked', picked_quantity = CASE WHEN COALESCE(picked_quantity, 0) > 0 THEN picked_quantity ELSE quantity END, action_sequence = COALESCE(action_sequence, ?) WHERE order_id = ? AND COALESCE(item_status, 'pending') = 'pending'", [actionSequence, orderId]);
  state.db.run("UPDATE customer_orders SET status = 'picked', picked_by = ?, picked_at = ?, updated_at = ? WHERE id = ?", ["ליקוט ידני", now, now, orderId]);
  pendingItems.forEach((item) => queuePickingChange({
    type: "itemStatus",
    itemId: item.id,
    itemStatus: "picked",
    pickedQuantity: number(item.picked_quantity) > 0 ? number(item.picked_quantity) : number(item.quantity),
    actionSequence,
  }));
  queuePickingChange({ type: "completeOrder", orderId, pickedBy: "ליקוט ידני", pickedAt: now, updatedAt: now });
  await savePickingNow();
  state.processTab = "picked";
  renderPicking();
  renderOrderHistory();
}

async function syncOrderHistoryFromPostgres() {
  try {
    const rawQuery = document.getElementById("history-query")?.value?.trim() || "";
    const params = new URLSearchParams({ q: rawQuery });
    const response = await fetch(`/api/postgres/order-history?${params.toString()}`, { cache: "no-store" });
    if (!response.ok) return false;
    const data = await response.json();
    if (!data.ok) return false;
    const orders = data.orders || [];
    const items = data.items || [];
    state.db.run("BEGIN TRANSACTION");
    orders.forEach((order) => {
      state.db.run("DELETE FROM customer_orders WHERE id = ?", [number(order.id)]);
      state.db.run(`
        INSERT INTO customer_orders (id, order_date, customer_no, customer_name, status, notes, estimated_total, estimated_profit, picked_by, picked_at, invoice_printed, shipped_at, process_hidden, updated_at, client_order_key)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        number(order.id),
        order.order_date || toSqlDate(new Date()),
        text(order.customer_no),
        text(order.customer_name),
        text(order.status),
        text(order.notes),
        number(order.estimated_total),
        number(order.estimated_profit),
        order.picked_by || null,
        order.picked_at || null,
        order.invoice_printed ? 1 : 0,
        order.shipped_at || null,
        order.process_hidden ? 1 : 0,
        order.updated_at || new Date().toISOString(),
        order.client_order_key || null,
      ]);
    });
    const orderIds = [...new Set(items.map((item) => number(item.order_id)).filter(Boolean))];
    orderIds.forEach((orderId) => state.db.run("DELETE FROM customer_order_items WHERE order_id = ?", [orderId]));
    items.forEach((item) => {
      state.db.run(`
        INSERT INTO customer_order_items (id, order_id, sku, product_desc, quantity, picked_quantity, note, item_status, substitute_product_id, action_sequence, entry_sequence, is_carton, units_per_carton, shortage_dismissed, estimated_price, estimated_profit)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        number(item.id),
        number(item.order_id),
        text(item.sku),
        text(item.product_desc),
        number(item.quantity),
        number(item.picked_quantity),
        text(item.note),
        text(item.item_status || "pending"),
        item.substitute_product_id || null,
        item.action_sequence === null || item.action_sequence === undefined ? null : number(item.action_sequence),
        number(item.entry_sequence),
        item.is_carton ? 1 : 0,
        number(item.units_per_carton) || 1,
        item.shortage_dismissed ? 1 : 0,
        number(item.estimated_price),
        number(item.estimated_profit),
      ]);
    });
    state.db.run("COMMIT");
    return true;
  } catch (error) {
    try {
      state.db.run("ROLLBACK");
    } catch {}
    console.warn("Postgres order history unavailable, using SQLite", error);
    return false;
  }
}

async function renderOrderHistory() {
  normalizeClosedOrderStatuses();
  await syncOrderHistoryFromPostgres();
  const query = `%${document.getElementById("history-query").value.trim()}%`;
  document.querySelectorAll("[data-process-tab]").forEach((button) => button.classList.toggle("active", button.dataset.processTab === state.processTab));
  document.querySelectorAll("[data-process-pane]").forEach((pane) => pane.classList.toggle("active", pane.dataset.processPane === state.processTab));
  const pendingRows = queryRows(`
    SELECT id, order_date, customer_no, customer_name, status, estimated_total, estimated_profit
    FROM customer_orders
    WHERE status = ? AND COALESCE(process_hidden, 0) = 0 AND (customer_name LIKE ? OR customer_no LIKE ? OR CAST(id AS TEXT) LIKE ?)
    ORDER BY id DESC
    LIMIT 500
  `, [ORDER_STATUSES[0], query, query, query]);
  renderTable("process-pending-table", pendingRows, [
    { key: "id", label: "מספר הזמנה", render: (row) => `<button class="table-link-button" data-view-process-order="${row.id}">${integer(row.id)}</button>` },
    { key: "order_date", label: "תאריך" },
    { key: "customer_name", label: "לקוח" },
    { key: "status", label: "סטטוס" },
    { key: "estimated_total", label: "סכום משוער", format: currency },
    { key: "estimated_profit", label: "רווח משוער", format: currency },
    { key: "actions", label: "פעולות", sortable: false, render: (row) => `
      <button class="small-action" data-open-picking-order="${row.id}">פתח בליקוט</button>
      <button class="pick-action pick-ok" data-manual-complete-picking="${row.id}" title="אשר ליקוט">V</button>
      <button class="danger-action process-remove" data-hide-process-order="${row.id}" title="הסר מהרשימה">X</button>
    ` },
  ], "processPending", "id", "desc");

  const pickedRows = queryRows(`
    SELECT id, order_date, customer_no, customer_name, status, estimated_total, estimated_profit, invoice_printed
    FROM customer_orders
    WHERE status = 'picked' AND COALESCE(process_hidden, 0) = 0 AND (customer_name LIKE ? OR customer_no LIKE ? OR CAST(id AS TEXT) LIKE ?)
    ORDER BY id DESC
    LIMIT 500
  `, [query, query, query]);
  renderTable("history-table", pickedRows, [
    { key: "select", label: "", sortable: false, render: (row) => `<input type="checkbox" data-process-select="${row.id}" ${state.selectedProcessOrders.has(String(row.id)) ? "checked" : ""} />` },
    { key: "id", label: "מספר הזמנה", render: (row) => `<button class="table-link-button" data-view-process-order="${row.id}">${integer(row.id)}</button>` },
    { key: "order_date", label: "תאריך" },
    { key: "customer_name", label: "לקוח" },
    { key: "status", label: "סטטוס" },
    { key: "estimated_total", label: "סכום משוער", format: currency },
    { key: "estimated_profit", label: "רווח משוער", format: currency },
    { key: "actions", label: "פעולות", sortable: false, render: (row) => `
      <button class="small-action" data-export-order="${row.id}">יצוא לפריוריטי</button>
      <button class="small-action" data-return-picking="${row.id}">החזר לליקוט</button>
      <label class="inline-check"><input type="checkbox" data-invoice-printed="${row.id}" ${row.invoice_printed ? "checked" : ""} /> חשבונית הודפסה</label>
      <button class="danger-action process-remove" data-hide-process-order="${row.id}" title="הסר מהרשימה">X</button>
    ` },
  ], "history", "id", "desc");
  document.querySelectorAll("[data-return-picking]").forEach((button) => button.addEventListener("click", () => returnOrderToPicking(button.dataset.returnPicking)));
  document.querySelectorAll("[data-export-order]").forEach((button) => button.addEventListener("click", () => exportSavedOrder(button.dataset.exportOrder)));
  document.querySelectorAll("[data-invoice-printed]").forEach((input) => input.addEventListener("change", () => markInvoicePrinted(input.dataset.invoicePrinted)));

  const shippingRows = queryRows(`
    SELECT id, order_date, customer_no, customer_name, status, estimated_total
    FROM customer_orders
    WHERE status = 'מוכן למשלוח' AND COALESCE(process_hidden, 0) = 0 AND (customer_name LIKE ? OR customer_no LIKE ? OR CAST(id AS TEXT) LIKE ?)
    ORDER BY id DESC
    LIMIT 500
  `, [query, query, query]);
  renderTable("shipping-table", shippingRows, [
    { key: "select", label: "", sortable: false, render: (row) => `<input type="checkbox" data-process-select="${row.id}" ${state.selectedProcessOrders.has(String(row.id)) ? "checked" : ""} />` },
    { key: "id", label: "מספר הזמנה", render: (row) => `<button class="table-link-button" data-view-process-order="${row.id}">${integer(row.id)}</button>` },
    { key: "order_date", label: "תאריך" },
    { key: "customer_name", label: "לקוח" },
    { key: "estimated_total", label: "סכום משוער", format: currency },
    { key: "actions", label: "פעולות", sortable: false, render: (row) => `
      <button class="small-action" data-view-process-order="${row.id}">צפייה</button>
      <button class="primary-action" data-mark-shipped="${row.id}">נשלחה</button>
      <button class="danger-action process-remove" data-hide-process-order="${row.id}" title="הסר מהרשימה">X</button>
    ` },
  ], "shipping", "id", "desc");
  document.querySelectorAll("[data-open-picking-order]").forEach((button) => button.addEventListener("click", () => {
    state.expandedPickingOrderId = Number(button.dataset.openPickingOrder);
    showScreen("picking");
  }));
  document.querySelectorAll("[data-manual-complete-picking]").forEach((button) => button.addEventListener("click", () => manualCompletePickingOrder(button.dataset.manualCompletePicking)));
  document.querySelectorAll("[data-view-process-order]").forEach((button) => button.addEventListener("click", () => viewProcessOrder(button.dataset.viewProcessOrder, button)));
  document.querySelectorAll("[data-mark-shipped]").forEach((button) => button.addEventListener("click", () => markOrderShipped(button.dataset.markShipped)));
  document.querySelectorAll("[data-hide-process-order]").forEach((button) => button.addEventListener("click", () => hideProcessOrder(button.dataset.hideProcessOrder)));
  bindProcessOrderSelection();
  const missedCount = renderMissedOrders(query);
  updateProcessTabCounts({ pending: pendingRows.length, picked: pickedRows.length, shipping: shippingRows.length, missed: missedCount });
}

function bindProcessOrderSelection() {
  document.querySelectorAll("[data-process-select]").forEach((input) => input.addEventListener("change", () => {
    if (input.checked) state.selectedProcessOrders.add(String(input.dataset.processSelect));
    else state.selectedProcessOrders.delete(String(input.dataset.processSelect));
  }));
}

function renderMissedOrders(query) {
  const rows = queryRows(`
    SELECT
      o.id AS order_id,
      o.order_date,
      o.customer_name,
      i.id AS item_id,
      i.sku,
      i.product_desc,
      i.quantity,
      i.picked_quantity,
      i.item_status,
      CASE
        WHEN COALESCE(i.item_status, 'pending') = 'missing' THEN COALESCE(i.quantity, 0)
        WHEN COALESCE(i.item_status, 'pending') IN ('picked', 'substituted') AND COALESCE(i.picked_quantity, 0) < COALESCE(i.quantity, 0)
          THEN COALESCE(i.quantity, 0) - COALESCE(i.picked_quantity, 0)
        ELSE 0
      END AS missing_quantity
    FROM customer_orders o
    JOIN customer_order_items i ON i.order_id = o.id
    WHERE COALESCE(i.shortage_dismissed, 0) = 0
      AND o.status IN ('picked', 'מוכן למשלוח', 'נשלחה')
      AND (o.customer_name LIKE ? OR o.customer_no LIKE ? OR CAST(o.id AS TEXT) LIKE ?)
      AND (
        COALESCE(i.item_status, 'pending') = 'missing'
        OR (COALESCE(i.item_status, 'pending') IN ('picked', 'substituted') AND COALESCE(i.picked_quantity, 0) < COALESCE(i.quantity, 0))
      )
    ORDER BY o.id DESC, i.action_sequence, i.id
  `, [query, query, query]);
  const grouped = new Map();
  rows.filter((row) => number(row.missing_quantity) > 0).forEach((row) => {
    if (!grouped.has(row.order_id)) grouped.set(row.order_id, { order: row, items: [] });
    grouped.get(row.order_id).items.push(row);
  });
  const container = document.getElementById("missed-orders-list");
  container.innerHTML = grouped.size ? `
    <div class="missed-orders-toolbar">
      <button class="danger-action" data-delete-selected-missed ${state.selectedMissedOrders.size ? "" : "disabled"}>מחיקת נבחרים</button>
      <button class="secondary-action" data-export-all-missed-word>יצוא כל החוסרים לוורד</button>
    </div>
    ${[...grouped.values()].map((group) => `
    <div class="missed-order">
      <div class="missed-order-header">
        <label class="inline-check"><input type="checkbox" data-missed-select="${group.order.order_id}" ${state.selectedMissedOrders.has(String(group.order.order_id)) ? "checked" : ""} /> בחירה</label>
        <strong>הזמנת חוסרים ${integer(group.order.order_id)}</strong>
        <span>${escapeHtml(group.order.customer_name)}</span>
        <span>${escapeHtml(group.order.order_date)}</span>
        <div class="missed-order-actions">
          <button class="danger-action" data-delete-missed="${group.order.order_id}">מחיקה</button>
        </div>
      </div>
      <div class="table-wrap">
        <table class="compact-table">
          <thead><tr><th>מוצר</th><th>כמות חסרה</th><th>מקור</th></tr></thead>
          <tbody>
            ${group.items.map((item) => `
              <tr>
                <td>${escapeHtml(item.product_desc)}</td>
                <td>${numberDisplay(item.missing_quantity)}</td>
                <td>${item.item_status === "missing" ? "חסר במלאי" : "כמות חלקית"}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `).join("")}` : `<div class="empty-state">אין הזמנות שהוחמצו</div>`;
  document.querySelectorAll("[data-missed-select]").forEach((input) => input.addEventListener("change", () => {
    if (input.checked) state.selectedMissedOrders.add(String(input.dataset.missedSelect));
    else state.selectedMissedOrders.delete(String(input.dataset.missedSelect));
    renderMissedOrders(query);
  }));
  document.querySelectorAll("[data-export-all-missed-word]").forEach((button) => button.addEventListener("click", () => exportAllMissedOrdersWord(query)));
  document.querySelectorAll("[data-delete-missed]").forEach((button) => button.addEventListener("click", () => deleteMissedOrder(button.dataset.deleteMissed)));
  document.querySelectorAll("[data-delete-selected-missed]").forEach((button) => button.addEventListener("click", deleteSelectedMissedOrders));
  return grouped.size;
}

function updateProcessTabCounts(counts) {
  const labels = {
    pending: "ממתינות לליקוט",
    picked: "הזמנות שלוקטו",
    shipping: "מוכן למשלוח",
    missed: "הזמנות שהוחמצו",
  };
  document.querySelectorAll("[data-process-tab]").forEach((button) => {
    const key = button.dataset.processTab;
    button.textContent = `${labels[key] || button.textContent} (${integer(counts[key] || 0)})`;
  });
}

async function deleteSelectedMissedOrders() {
  const ids = [...state.selectedMissedOrders];
  if (!ids.length) return;
  if (!confirm(`למחוק ${integer(ids.length)} הזמנות חוסרים?`)) return;
  ids.forEach((orderId) => {
    state.db.run(`
      UPDATE customer_order_items
      SET shortage_dismissed = 1
      WHERE order_id = ? AND (
        COALESCE(item_status, 'pending') = 'missing'
        OR (COALESCE(item_status, 'pending') IN ('picked', 'substituted') AND COALESCE(picked_quantity, 0) < COALESCE(quantity, 0))
      )
    `, [orderId]);
  });
  state.selectedMissedOrders.clear();
  await persistDatabase();
  renderOrderHistory();
}

async function deleteMissedOrder(orderId) {
  if (!confirm("למחוק את הזמנת החוסרים?")) return;
  state.db.run(`
    UPDATE customer_order_items
    SET shortage_dismissed = 1
    WHERE order_id = ? AND (
      COALESCE(item_status, 'pending') = 'missing'
      OR (COALESCE(item_status, 'pending') IN ('picked', 'substituted') AND COALESCE(picked_quantity, 0) < COALESCE(quantity, 0))
    )
  `, [orderId]);
  await persistDatabase();
  renderOrderHistory();
}

function missedItemsForOrder(orderId) {
  return queryRows(`
    SELECT
      o.id AS order_id,
      o.order_date,
      o.customer_no,
      o.customer_name,
      o.notes,
      i.sku,
      i.product_desc,
      i.quantity,
      i.picked_quantity,
      i.item_status,
      i.note,
      CASE
        WHEN COALESCE(i.item_status, 'pending') = 'missing' THEN COALESCE(i.quantity, 0)
        WHEN COALESCE(i.item_status, 'pending') IN ('picked', 'substituted') AND COALESCE(i.picked_quantity, 0) < COALESCE(i.quantity, 0)
          THEN COALESCE(i.quantity, 0) - COALESCE(i.picked_quantity, 0)
        ELSE 0
      END AS missing_quantity
    FROM customer_orders o
    JOIN customer_order_items i ON i.order_id = o.id
    WHERE o.id = ?
      AND COALESCE(i.shortage_dismissed, 0) = 0
      AND (
        COALESCE(i.item_status, 'pending') = 'missing'
        OR (COALESCE(i.item_status, 'pending') IN ('picked', 'substituted') AND COALESCE(i.picked_quantity, 0) < COALESCE(i.quantity, 0))
      )
    ORDER BY i.action_sequence, i.id
  `, [orderId]).filter((row) => number(row.missing_quantity) > 0);
}

function exportMissedOrderWord(orderId) {
  const rows = missedItemsForOrder(orderId);
  if (!rows.length) return alert("אין חוסרים לייצוא בהזמנה הזו.");
  const order = rows[0];
  const html = `<!doctype html>
<html dir="rtl" lang="he">
<head>
  <meta charset="utf-8" />
  <style>
    body { direction: rtl; font-family: Arial, sans-serif; color: #111827; }
    h1 { font-size: 22px; margin: 0 0 12px; }
    p { margin: 4px 0; }
    table { width: 100%; border-collapse: collapse; margin-top: 16px; }
    th, td { border: 1px solid #9ca3af; padding: 8px; text-align: right; }
    th { background: #eef2f7; }
  </style>
</head>
<body>
  <h1>הזמנת חוסרים ${integer(order.order_id)}</h1>
  <p><strong>מספר לקוח:</strong> ${escapeHtml(order.customer_no)}</p>
  <p><strong>שם לקוח:</strong> ${escapeHtml(order.customer_name)}</p>
  <p><strong>תאריך הזמנה:</strong> ${escapeHtml(order.order_date)}</p>
  ${order.notes ? `<p><strong>הערות להזמנה:</strong> ${escapeHtml(order.notes)}</p>` : ""}
  <table>
    <thead>
      <tr><th>קוד מוצר</th><th>מוצר</th><th>כמות חסרה</th><th>מקור</th><th>הערת מוצר</th></tr>
    </thead>
    <tbody>
      ${rows.map((item) => `
        <tr>
          <td>${escapeHtml(item.sku)}</td>
          <td>${escapeHtml(item.product_desc)}</td>
          <td>${numberDisplay(item.missing_quantity)}</td>
          <td>${item.item_status === "missing" ? "חסר במלאי" : "כמות חלקית"}</td>
          <td>${escapeHtml(item.note || "")}</td>
        </tr>
      `).join("")}
    </tbody>
  </table>
</body>
</html>`;
  const blob = new Blob(["\ufeff", html], { type: "application/msword;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `missed-order-${order.order_id}-${toSqlDate(new Date())}.doc`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function exportAllMissedOrdersWord(query = "%%") {
  const orders = queryRows(`
    SELECT DISTINCT o.id AS order_id
    FROM customer_orders o
    JOIN customer_order_items i ON i.order_id = o.id
    WHERE COALESCE(i.shortage_dismissed, 0) = 0
      AND o.status IN ('picked', 'מוכן למשלוח', 'נשלחה')
      AND (o.customer_name LIKE ? OR o.customer_no LIKE ? OR CAST(o.id AS TEXT) LIKE ?)
      AND (
        COALESCE(i.item_status, 'pending') = 'missing'
        OR (COALESCE(i.item_status, 'pending') IN ('picked', 'substituted') AND COALESCE(i.picked_quantity, 0) < COALESCE(i.quantity, 0))
      )
    ORDER BY o.id DESC
  `, [query, query, query]);
  const groups = orders
    .map((order) => missedItemsForOrder(order.order_id))
    .filter((items) => items.length);
  if (!groups.length) return alert("אין חוסרים לייצוא.");
  const html = `<!doctype html>
<html dir="rtl" lang="he">
<head>
  <meta charset="utf-8" />
  <style>
    body { direction: rtl; font-family: Arial, sans-serif; color: #111827; }
    h1 { font-size: 24px; margin: 0 0 18px; }
    h2 { font-size: 18px; margin: 22px 0 8px; }
    p { margin: 4px 0; }
    table { width: 100%; border-collapse: collapse; margin: 12px 0 22px; }
    th, td { border: 1px solid #9ca3af; padding: 8px; text-align: right; }
    th { background: #eef2f7; }
  </style>
</head>
<body>
  <h1>הזמנות שהוחמצו</h1>
  ${groups.map((items) => {
    const order = items[0];
    return `
      <h2>הזמנת חוסרים ${integer(order.order_id)}</h2>
      <p><strong>מספר לקוח:</strong> ${escapeHtml(order.customer_no)}</p>
      <p><strong>שם לקוח:</strong> ${escapeHtml(order.customer_name)}</p>
      <p><strong>תאריך הזמנה:</strong> ${escapeHtml(order.order_date)}</p>
      ${order.notes ? `<p><strong>הערות להזמנה:</strong> ${escapeHtml(order.notes)}</p>` : ""}
      <table>
        <thead><tr><th>קוד מוצר</th><th>מוצר</th><th>כמות חסרה</th><th>מקור</th><th>הערת מוצר</th></tr></thead>
        <tbody>
          ${items.map((item) => `
            <tr>
              <td>${escapeHtml(item.sku)}</td>
              <td>${escapeHtml(item.product_desc)}</td>
              <td>${numberDisplay(item.missing_quantity)}</td>
              <td>${item.item_status === "missing" ? "חסר במלאי" : "כמות חלקית"}</td>
              <td>${escapeHtml(item.note || "")}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  }).join("")}
</body>
</html>`;
  const blob = new Blob(["\ufeff", html], { type: "application/msword;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `missed-orders-${toSqlDate(new Date())}.doc`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function orderDetailHtml(order, items) {
  return `
    <div class="order-detail-header">
      <div>
        <h3>הזמנה ${integer(order.id)} - ${escapeHtml(order.customer_name)}</h3>
        <p>${escapeHtml(order.order_date)} · ${escapeHtml(order.status)}</p>
        ${order.notes ? `<p>הערות להזמנה: ${escapeHtml(order.notes)}</p>` : ""}
      </div>
      <button class="icon-button" data-close-process-order aria-label="סגירה">×</button>
    </div>
    <div class="table-wrap">
      <table class="compact-table">
        <thead><tr><th>מוצר</th><th>כמות הזמנה</th><th>כמות שלוקטה</th><th>סטטוס</th><th>הערה</th></tr></thead>
        <tbody>
          ${items.length ? items.map((item) => `
            <tr>
              <td>
                ${escapeHtml(item.product_desc)}
                ${item.item_status === "substituted" ? `<small class="pick-note">חלופי: ${escapeHtml(item.substitute_desc || item.substitute_product_id || "")}</small>` : ""}
              </td>
              <td>${numberDisplay(item.quantity)}</td>
              <td>${item.item_status === "return" ? "החזרה" : numberDisplay(item.picked_quantity)}</td>
              <td>${item.item_status === "return" ? "החזרה" : escapeHtml(item.item_status || "pending")}</td>
              <td>${escapeHtml(item.note || "")}</td>
            </tr>
          `).join("") : `<tr><td colspan="5" class="empty-state">אין פריטים בהזמנה</td></tr>`}
        </tbody>
      </table>
    </div>
    ${order.status === "picked" ? `<button class="secondary-action" data-return-picking="${order.id}">החזר לליקוט ועריכה מחדש</button>` : ""}
  `;
}

function viewProcessOrder(orderId, triggerButton = null) {
  if (String(state.processDetailOrderId || "") === String(orderId)) {
    document.querySelectorAll(".inline-order-detail-row").forEach((row) => row.remove());
    document.getElementById("process-order-detail")?.classList.add("hidden");
    state.processDetailOrderId = null;
    return;
  }
  const order = firstRow("SELECT * FROM customer_orders WHERE id = ?", [orderId]);
  const items = queryRows(`
    SELECT
      i.*,
      COALESCE(sp.description, i.substitute_product_id) AS substitute_desc
    FROM customer_order_items i
    LEFT JOIN products sp ON sp.sku = i.substitute_product_id
    WHERE i.order_id = ?
    ORDER BY COALESCE(i.action_sequence, 999999), i.id
  `, [orderId]);
  if (!order.id) {
    state.processDetailOrderId = null;
    return;
  }
  state.processDetailOrderId = orderId;
  document.querySelectorAll(".inline-order-detail-row").forEach((row) => row.remove());
  const panel = document.getElementById("process-order-detail");
  panel.classList.add("hidden");
  panel.innerHTML = "";
  const sourceRow = triggerButton?.closest("tr");
  if (!sourceRow) return;
  const detailRow = document.createElement("tr");
  detailRow.className = "inline-order-detail-row";
  detailRow.innerHTML = `<td colspan="${sourceRow.children.length}"><div class="order-detail-panel inline">${orderDetailHtml(order, items)}</div></td>`;
  sourceRow.insertAdjacentElement("afterend", detailRow);
  detailRow.querySelector("[data-close-process-order]").addEventListener("click", () => {
    detailRow.remove();
    state.processDetailOrderId = null;
  });
  detailRow.querySelectorAll("[data-return-picking]").forEach((button) => button.addEventListener("click", () => returnOrderToPicking(button.dataset.returnPicking)));
}

async function returnOrderToPicking(orderId) {
  if (!confirm("להחזיר את ההזמנה לליקוט לעריכה מחדש?")) return;
  const now = new Date().toISOString();
  const items = queryRows(`
    SELECT id, picked_quantity, quantity
    FROM customer_order_items
    WHERE order_id = ? AND COALESCE(item_status, 'pending') <> 'return'
  `, [orderId]);
  state.db.run(`
    UPDATE customer_orders
    SET status = 'מוכן לאיסוף', invoice_printed = 0, picked_by = NULL, picked_at = NULL, shipped_at = NULL, updated_at = ?
    WHERE id = ?
  `, [now, orderId]);
  state.db.run(`
    UPDATE customer_order_items
    SET item_status = 'pending',
        picked_quantity = CASE WHEN COALESCE(picked_quantity, 0) > 0 THEN picked_quantity ELSE quantity END,
        action_sequence = NULL,
        shortage_dismissed = 0
    WHERE order_id = ? AND COALESCE(item_status, 'pending') <> 'return'
  `, [orderId]);
  items.forEach((item) => queuePickingChange({
    type: "itemPending",
    itemId: item.id,
    pickedQuantity: number(item.picked_quantity) > 0 ? number(item.picked_quantity) : number(item.quantity),
  }));
  await patchPostgresOrder(orderId, {
    status: "מוכן לאיסוף",
    invoice_printed: false,
    picked_by: null,
    picked_at: null,
    shipped_at: null,
    updated_at: now,
  });
  await savePickingNow();
  document.getElementById("process-order-detail").classList.add("hidden");
  renderOrderHistory();
  renderPicking();
}

function exportSavedOrder(orderId) {
  const order = firstRow("SELECT * FROM customer_orders WHERE id = ?", [orderId]);
  const items = savedOrderExportItems(orderId);
  exportPriorityRows(order, items);
}

function savedOrderExportItems(orderId) {
  return queryRows(`
    SELECT
      CASE WHEN i.item_status = 'substituted' THEN i.substitute_product_id ELSE i.sku END AS export_sku,
      CASE WHEN i.item_status = 'substituted' THEN COALESCE(sp.description, i.substitute_product_id) ELSE i.product_desc END AS export_product_desc,
      i.sku,
      i.product_desc,
      i.note,
      i.item_status,
      i.action_sequence,
      i.is_carton,
      i.units_per_carton,
      CASE WHEN i.item_status = 'return' THEN -ABS(COALESCE(i.quantity, 0)) ELSE i.picked_quantity END AS export_quantity,
      CASE WHEN i.item_status = 'return' THEN 1 ELSE 0 END AS export_sort_group,
      CASE
        WHEN i.item_status = 'substituted' THEN COALESCE(sp.pick_order, 999999)
        ELSE COALESCE(p.pick_order, 999999)
      END AS export_pick_order,
      COALESCE(i.entry_sequence, i.id) AS export_sequence
    FROM customer_order_items i
    LEFT JOIN products p ON p.sku = i.sku
    LEFT JOIN products sp ON sp.sku = i.substitute_product_id
    WHERE i.order_id = ?
      AND (
        (COALESCE(i.item_status, 'pending') IN ('picked', 'substituted') AND COALESCE(i.picked_quantity, 0) > 0)
        OR COALESCE(i.item_status, 'pending') = 'return'
      )
    ORDER BY export_sort_group, COALESCE(i.action_sequence, 999999), export_pick_order, export_sequence
  `, [orderId]);
}

function exportSelectedPriorityOrders() {
  const orderIds = [...state.selectedProcessOrders];
  if (!orderIds.length) return alert("יש לבחור לפחות הזמנה אחת ליצוא.");
  const rows = [];
  let sequence = 1;
  orderIds.forEach((orderId) => {
    const order = firstRow("SELECT * FROM customer_orders WHERE id = ?", [orderId]);
    if (!order.id) return;
    rows.push([sequence, order.customer_no, "", "", 1]);
    sequence += 1;
    priorityExportItems(savedOrderExportItems(orderId)).forEach((item) => {
      const sku = String(item.export_sku || item.sku || "").trim();
      const quantity = exportQuantityForPriority(item);
      const isReturnMarker = sku === "999" || item.is_return_marker;
      if (!sku || (!isReturnMarker && quantity === 0)) return;
      rows.push([sequence, "", sku, isReturnMarker ? 0 : quantity, 2]);
      sequence += 1;
    });
  });
  if (!rows.length) return alert("לא נמצאו הזמנות ליצוא.");
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, sheet, "Priority");
  XLSX.writeFile(workbook, `priority-v2-selected-${toSqlDate(new Date())}.xlsx`);
}

function selectAllPickedProcessOrders() {
  const query = `%${document.getElementById("history-query").value.trim()}%`;
  const rows = queryRows(`
    SELECT id
    FROM customer_orders
    WHERE status = 'picked'
      AND COALESCE(process_hidden, 0) = 0
      AND (customer_name LIKE ? OR customer_no LIKE ? OR CAST(id AS TEXT) LIKE ?)
    ORDER BY id DESC
    LIMIT 500
  `, [query, query, query]);
  rows.forEach((row) => state.selectedProcessOrders.add(String(row.id)));
  renderOrderHistory();
}

function selectAllShippingProcessOrders() {
  const query = `%${document.getElementById("history-query").value.trim()}%`;
  const rows = queryRows(`
    SELECT id
    FROM customer_orders
    WHERE status = 'מוכן למשלוח'
      AND COALESCE(process_hidden, 0) = 0
      AND (customer_name LIKE ? OR customer_no LIKE ? OR CAST(id AS TEXT) LIKE ?)
    ORDER BY id DESC
    LIMIT 500
  `, [query, query, query]);
  rows.forEach((row) => state.selectedProcessOrders.add(String(row.id)));
  renderOrderHistory();
}

function selectedShippingOrderIds() {
  const ids = [...state.selectedProcessOrders].map((id) => String(id));
  if (!ids.length) return [];
  const placeholders = ids.map(() => "?").join(",");
  return queryRows(`
    SELECT id
    FROM customer_orders
    WHERE CAST(id AS TEXT) IN (${placeholders})
      AND status = 'מוכן למשלוח'
      AND COALESCE(process_hidden, 0) = 0
  `, ids).map((row) => String(row.id));
}

async function markSelectedShippingOrdersShipped() {
  const ids = selectedShippingOrderIds();
  if (!ids.length) return alert("יש לבחור לפחות הזמנה אחת בלשונית מוכן למשלוח.");
  if (!confirm(`לסמן ${integer(ids.length)} הזמנות כנשלחו?`)) return;
  const now = new Date().toISOString();
  const results = await Promise.all(ids.map(async (orderId) => {
    state.db.run("UPDATE customer_orders SET status = 'נשלחה', shipped_at = ?, process_hidden = 1, updated_at = ? WHERE id = ?", [now, now, orderId]);
    return patchPostgresOrder(orderId, { status: "נשלחה", shipped_at: now, process_hidden: true, updated_at: now });
  }));
  ids.forEach((orderId) => state.selectedProcessOrders.delete(String(orderId)));
  await writeBrowserDatabase(state.db.export());
  const failed = results.filter((result) => !result.ok);
  if (failed.length) alert(`${integer(failed.length)} הזמנות לא נשמרו לשרת.`);
  renderOrderHistory();
}

async function hideSelectedShippingOrders() {
  const ids = selectedShippingOrderIds();
  if (!ids.length) return alert("יש לבחור לפחות הזמנה אחת בלשונית מוכן למשלוח.");
  if (!confirm(`להסיר ${integer(ids.length)} הזמנות מהרשימה?`)) return;
  const now = new Date().toISOString();
  const results = await Promise.all(ids.map(async (orderId) => {
    state.db.run("UPDATE customer_orders SET process_hidden = 1, updated_at = ? WHERE id = ?", [now, orderId]);
    return patchPostgresOrder(orderId, { process_hidden: true, updated_at: now });
  }));
  ids.forEach((orderId) => state.selectedProcessOrders.delete(String(orderId)));
  await writeBrowserDatabase(state.db.export());
  const failed = results.filter((result) => !result.ok);
  if (failed.length) alert(`${integer(failed.length)} הזמנות לא נשמרו לשרת.`);
  renderOrderHistory();
  renderPicking();
}

async function patchPostgresOrder(orderId, values) {
  try {
    const response = await fetch("/api/postgres/order-patch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order_id: orderId, values }),
    });
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok && data.ok !== false, error: data.error || "" };
  } catch (error) {
    console.warn("Postgres order patch failed", error);
    return { ok: false, error: error.message };
  }
}

async function markInvoicePrinted(orderId) {
  const now = new Date().toISOString();
  state.db.run("UPDATE customer_orders SET invoice_printed = 1, status = 'מוכן למשלוח', updated_at = ? WHERE id = ?", [now, orderId]);
  const result = await patchPostgresOrder(orderId, { invoice_printed: true, status: "מוכן למשלוח", updated_at: now });
  if (!result.ok) alert(`השמירה לשרת נכשלה: ${result.error || "שגיאה לא ידועה"}`);
  await writeBrowserDatabase(state.db.export());
  renderOrderHistory();
}

async function markOrderShipped(orderId) {
  const now = new Date().toISOString();
  state.db.run("UPDATE customer_orders SET status = 'נשלחה', shipped_at = ?, process_hidden = 1, updated_at = ? WHERE id = ?", [now, now, orderId]);
  state.selectedProcessOrders.delete(String(orderId));
  const result = await patchPostgresOrder(orderId, { status: "נשלחה", shipped_at: now, process_hidden: true, updated_at: now });
  if (!result.ok) alert(`השמירה לשרת נכשלה: ${result.error || "שגיאה לא ידועה"}`);
  await writeBrowserDatabase(state.db.export());
  renderOrderHistory();
}

async function hideProcessOrder(orderId) {
  const now = new Date().toISOString();
  state.db.run("UPDATE customer_orders SET process_hidden = 1, updated_at = ? WHERE id = ?", [now, orderId]);
  state.selectedProcessOrders.delete(String(orderId));
  const result = await patchPostgresOrder(orderId, { process_hidden: true, updated_at: now });
  if (!result.ok) alert(`השמירה לשרת נכשלה: ${result.error || "שגיאה לא ידועה"}`);
  await writeBrowserDatabase(state.db.export());
  renderOrderHistory();
  renderPicking();
}

function refreshCallCustomerSelect() {
  const query = `%${document.getElementById("call-customer-query").value.trim()}%`;
  const rows = queryRows(`
    SELECT customer_no, customer_name FROM customer_profitability_summary
    WHERE customer_name LIKE ? OR customer_no LIKE ?
    ORDER BY customer_name LIMIT 80
  `, [query, query]);
  document.getElementById("call-customer-select").innerHTML = `<option value="">בחירת לקוח</option>` + rows.map((row) => `<option value="${escapeAttr(row.customer_no)}">${escapeHtml(row.customer_name)} - ${escapeHtml(row.customer_no)}</option>`).join("");
}

function callWeekReferenceDate(referenceDate = new Date()) {
  const date = new Date(referenceDate);
  if (date.getDay() > 4 || (date.getDay() === 4 && date.getHours() >= WEEKLY_CALL_RESET_HOUR)) {
    date.setDate(date.getDate() + 7);
  }
  date.setHours(0, 0, 0, 0);
  return date;
}

function callWeekKey(referenceDate = new Date()) {
  const weekReference = callWeekReferenceDate(referenceDate);
  const sunday = new Date(weekReference);
  sunday.setHours(0, 0, 0, 0);
  sunday.setDate(sunday.getDate() - sunday.getDay());
  return toSqlDate(sunday);
}

function callWeekDates(referenceDate = new Date()) {
  const weekReference = callWeekReferenceDate(referenceDate);
  return CALL_DAYS.map((day) => callDateForDay(day, weekReference));
}

function callDateForDay(day, referenceDate = new Date()) {
  const date = callWeekReferenceDate(referenceDate);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - date.getDay() + (CALL_DAY_INDEX[day] ?? 0));
  return toSqlDate(date);
}

function callDaysForCustomer(customerNo) {
  const profile = firstRow("SELECT days FROM customer_call_profiles WHERE customer_no = ? AND COALESCE(source, 'calls') = 'calls'", [customerNo]);
  return String(profile.days || "").split(",").map((day) => day.trim()).filter(Boolean);
}

function nearestCallDayForOrder(customerNo, orderDateValue) {
  const orderDate = orderDateValue ? new Date(orderDateValue) : new Date();
  const orderDayIndex = Math.min(Math.max(orderDate.getDay(), 0), 4);
  const days = callDaysForCustomer(customerNo);
  const candidates = days.length ? days : CALL_DAYS;
  return candidates
    .filter((day) => day in CALL_DAY_INDEX)
    .sort((a, b) => Math.abs(CALL_DAY_INDEX[a] - orderDayIndex) - Math.abs(CALL_DAY_INDEX[b] - orderDayIndex))[0] || CALL_DAYS[orderDayIndex] || "חמישי";
}

function upsertCallStatus(customerNo, customerName, day, status, options = {}) {
  const callDate = callDateForDay(day, options.referenceDate ? new Date(options.referenceDate) : new Date());
  const now = new Date().toISOString();
  const existing = firstRow("SELECT whatsapp_sent_at, manual_order_id FROM customer_calls WHERE customer_no = ? AND call_date = ?", [customerNo, callDate]);
  state.db.run("DELETE FROM customer_calls WHERE customer_no = ? AND call_date = ?", [customerNo, callDate]);
  state.db.run(`
    INSERT INTO customer_calls (call_date, customer_no, customer_name, status, call_again_time, whatsapp_sent_at, manual_order_id, notes, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [callDate, customerNo, customerName, status, options.callAgainTime || null, options.whatsappSentAt ?? existing.whatsapp_sent_at ?? null, options.manualOrderId ?? existing.manual_order_id ?? null, options.notes || "", now]);
}

async function upsertPostgresCallStatus(row, status, options = {}) {
  const existing = state.postgresCallRows.find((item) => String(item.customer_no) === String(row.customer_no)) || {};
  const payload = {
    call_date: callDateForDay(state.callsDay, options.referenceDate ? new Date(options.referenceDate) : new Date()),
    customer_no: row.customer_no,
    customer_name: row.customer_name,
    status,
    call_again_time: options.callAgainTime ?? existing.call_again_time ?? null,
    whatsapp_sent_at: options.whatsappSentAt ?? existing.whatsapp_sent_at ?? null,
    manual_order_id: options.manualOrderId ?? existing.manual_order_id ?? null,
    notes: options.notes ?? existing.notes ?? "",
  };
  const response = await fetch("/api/postgres/call-status", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) throw new Error(data.error || "שמירת השיחה ל-Postgres נכשלה");
  const updated = {
    ...existing,
    ...payload,
    ...(data.row || {}),
    call_again_time: payload.call_again_time || "",
    whatsapp_sent_at: payload.whatsapp_sent_at || "",
    notes: payload.notes || "",
  };
  const index = state.postgresCallRows.findIndex((item) => String(item.customer_no) === String(row.customer_no));
  if (index >= 0) state.postgresCallRows[index] = updated;
  else state.postgresCallRows.push(updated);
  return updated;
}

function markCustomerOrderedCall(customerNo, customerName, orderDateValue) {
  if (!customerNo) return;
  const day = nearestCallDayForOrder(customerNo, orderDateValue);
  upsertCallStatus(customerNo, customerName, day, "ordered", { referenceDate: orderDateValue, notes: "סומן אוטומטית לאחר שידור הזמנה" });
}

function createManualOrderFromCall(customerNo, customerName) {
  const orderDate = toSqlDate(new Date());
  const exists = scalar(`
    SELECT COUNT(*)
    FROM customer_orders
    WHERE customer_no = ?
      AND order_date = ?
      AND status IN ('מוכן לאיסוף', 'picked', 'מוכן למשלוח')
  `, [customerNo, orderDate]);
  if (number(exists) > 0) return 0;
  const now = new Date().toISOString();
  const clientOrderKey = createClientOrderKey();
  state.db.run(`
    INSERT INTO customer_orders (order_date, customer_no, customer_name, status, notes, estimated_total, estimated_profit, updated_at, client_order_key)
    VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?)
  `, [orderDate, customerNo, customerName, ORDER_STATUSES[0], "הזמנה ידנית מניהול שיחות", now, clientOrderKey]);
  return { orderId: number(scalar("SELECT last_insert_rowid()")), clientOrderKey, orderDate, now };
}

async function saveCall(event) {
  event.preventDefault();
  const id = document.getElementById("call-id").value;
  const customerNo = document.getElementById("call-customer-select").value;
  const customer = firstRow("SELECT customer_no, customer_name FROM customer_profitability_summary WHERE customer_no = ?", [customerNo]);
  if (!customer.customer_no) return alert("יש לבחור לקוח.");
  const values = [
    document.getElementById("call-date").value || toSqlDate(new Date()),
    customer.customer_no,
    customer.customer_name,
    text(document.getElementById("call-status").value),
    null,
    text(document.getElementById("call-notes").value),
    new Date().toISOString(),
  ];
  if (id) {
    state.db.run("UPDATE customer_calls SET call_date = ?, customer_no = ?, customer_name = ?, status = ?, call_again_time = ?, notes = ?, updated_at = ? WHERE id = ?", [...values, id]);
  } else {
    state.db.run("INSERT INTO customer_calls (call_date, customer_no, customer_name, status, call_again_time, notes, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)", values);
  }
  await persistDatabase();
  resetCallForm();
  renderCalls();
  if (state.selectedCustomer) renderCustomerCalls(state.selectedCustomer.customer_no);
}

async function renderCalls() {
  renderCallTemplateEditor();
  renderCallDayTabs();
  const day = state.callsDay;
  const callDate = callDateForDay(day);
  if (await renderCallsFromPostgres(day, callDate)) return;
  state.callsSource = "sqlite";
  state.postgresCallRows = [];
  const rows = queryRows(`
    SELECT
      p.customer_no,
      MAX(p.customer_name) AS customer_name,
      COALESCE(p.contact, '') AS contact,
      COALESCE(p.phone, '') AS phone,
      COALESCE(p.phone2, '') AS phone2,
      COALESCE(p.city, '') AS city,
      COALESCE(p.address, '') AS address,
      COALESCE(p.days, '') AS days,
      COALESCE(call.status, 'pending') AS status,
      COALESCE(call.call_again_time, '') AS call_again_time,
      COALESCE(call.whatsapp_sent_at, '') AS whatsapp_sent_at,
      COALESCE(call.notes, '') AS notes,
      COALESCE(call.updated_at, '') AS updated_at
    FROM customer_call_profiles p
    LEFT JOIN customer_calls call ON call.customer_no = p.customer_no AND call.call_date = ?
    WHERE COALESCE(p.source, 'calls') = 'calls'
      AND ',' || REPLACE(COALESCE(p.days, ''), ' ', '') || ',' LIKE ?
    GROUP BY p.customer_no
    ORDER BY
      CASE COALESCE(call.status, 'pending')
        WHEN 'pending' THEN 1
        WHEN 'call_again' THEN 2
        WHEN 'no_answer' THEN 3
        WHEN 'no_need' THEN 4
        WHEN 'ordered' THEN 5
        ELSE 6
      END,
      customer_name
    LIMIT 800
  `, [callDate, `%,${day},%`]);
  renderCallRows(rows);
}

async function renderCallsFromPostgres(day, callDate) {
  try {
    const params = new URLSearchParams({ day, call_date: callDate });
    const response = await fetch(`/api/postgres/calls?${params.toString()}`, { cache: "no-store" });
    if (!response.ok) return false;
    const data = await response.json();
    if (!data.ok) return false;
    state.callsSource = "postgres";
    state.postgresCallRows = data.rows || [];
    renderCallRows(state.postgresCallRows);
    return true;
  } catch (error) {
    console.warn("Postgres calls unavailable, using SQLite", error);
    return false;
  }
}

async function resetCurrentCallDay() {
  const callDate = callDateForDay(state.callsDay);
  if (!confirm(`לאפס את כל הלקוחות של יום ${state.callsDay} לסטטוס בטיפול?`)) return;
  const result = await resetCallDates([callDate]);
  if (state.callsSource === "postgres" && !result.server) {
    alert("האיפוס בענן נכשל. יש לבדוק חיבור לשרת ולנסות שוב.");
    return;
  }
  state.expandedCallCustomerNo = "";
  state.selectedCallCustomers.clear();
  document.getElementById("calls-import-status").textContent = "הסטטוסים של היום אופסו";
  await renderCalls();
}

function startWeeklyCallResetTimer() {
  if (state.callResetTimer) clearInterval(state.callResetTimer);
  state.callResetTimer = setInterval(() => {
    runScheduledCallReset({ refresh: true }).catch((error) => console.warn("Scheduled call reset failed", error));
  }, 60 * 1000);
}

async function runScheduledCallReset(options = {}) {
  const now = new Date();
  if (now.getDay() < 4 || (now.getDay() === 4 && now.getHours() < WEEKLY_CALL_RESET_HOUR)) return false;
  const resetKey = `weeklyCallReset:${callWeekKey(now)}`;
  if (localStorage.getItem(resetKey)) return false;
  const result = await resetCallDates(callWeekDates(now), { silent: true });
  if (state.callsSource === "postgres" && !result.server) return false;
  localStorage.setItem(resetKey, new Date().toISOString());
  if (options.refresh) {
    state.expandedCallCustomerNo = "";
    state.selectedCallCustomers.clear();
    await renderCalls();
  }
  return true;
}

async function resetCallDates(callDates, options = {}) {
  const dates = [...new Set(callDates.filter(Boolean))];
  if (!dates.length) return { server: false, local: false };
  const resetOnServer = await resetCallDatesInPostgres(dates);
  const placeholders = dates.map(() => "?").join(",");
  state.db.run(`DELETE FROM customer_calls WHERE call_date IN (${placeholders})`, dates);
  if (!resetOnServer) await persistDatabase();
  state.postgresCallRows = state.postgresCallRows.filter((row) => !dates.includes(String(row.call_date || "")));
  if (!options.silent && state.selectedCustomer) renderCustomerCalls(state.selectedCustomer.customer_no);
  return { server: resetOnServer, local: true };
}

async function resetCallDatesInPostgres(callDates) {
  try {
    const response = await fetch("/api/postgres/calls-reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ call_dates: callDates }),
    });
    const data = await response.json().catch(() => ({}));
    return response.ok && data.ok;
  } catch (error) {
    console.warn("Postgres call reset unavailable, using SQLite", error);
    return false;
  }
}

function renderCallRows(rows) {
  const visibleRows = state.callsFilter ? rows.filter((row) => normalizeCallStatus(row.status) === state.callsFilter) : rows;
  renderCallSummary(rows);
  const table = document.getElementById("calls-table");
  const body = visibleRows.length ? visibleRows.map((row) => callRowHtml(row)).join("") : `<tr><td colspan="4" class="empty-state">אין לקוחות להצגה. יש לטעון לקוחות באקסל במסך ניהול שיחות.</td></tr>`;
  table.innerHTML = `
    <thead><tr><th class="call-select-col"></th><th>לקוח</th><th>סטטוס</th><th>שעה</th></tr></thead>
    <tbody>${body}</tbody>
  `;
  renderCallBulkActions(visibleRows);
  table.querySelectorAll("[data-call-select]").forEach((input) => input.addEventListener("change", () => {
    if (input.checked) state.selectedCallCustomers.add(input.dataset.callSelect);
    else state.selectedCallCustomers.delete(input.dataset.callSelect);
    renderCallBulkActions(visibleRows);
  }));
  table.querySelectorAll("[data-call-toggle]").forEach((button) => button.addEventListener("click", () => {
    state.expandedCallCustomerNo = state.expandedCallCustomerNo === button.dataset.callToggle ? "" : button.dataset.callToggle;
    renderCalls();
  }));
  table.querySelectorAll("[data-call-status]").forEach((button) => button.addEventListener("click", () => updateCustomerCallFromButton(button)));
  table.querySelectorAll("[data-call-time]").forEach((input) => input.addEventListener("change", () => updateCustomerCallTime(input)));
  table.querySelectorAll("[data-order-from-call]").forEach((button) => button.addEventListener("click", () => startOrderFromCallCustomer(button.dataset.orderFromCall)));
  table.querySelectorAll("[data-toggle-call-whatsapp]").forEach((button) => button.addEventListener("click", () => toggleCallWhatsappPanel(button.dataset.toggleCallWhatsapp)));
  table.querySelectorAll("[data-call-template]").forEach((select) => select.addEventListener("change", () => updateCallMessagePreview(select)));
  table.querySelectorAll("[data-call-message]").forEach((textarea) => textarea.addEventListener("input", () => updateCallWhatsappLink(textarea.dataset.callMessage)));
  table.querySelectorAll("[data-call-whatsapp-send]").forEach((link) => link.addEventListener("click", () => markWhatsappSent(link.dataset.callWhatsappSend)));
  table.querySelectorAll("[data-mark-whatsapp-sent]").forEach((button) => button.addEventListener("click", () => markWhatsappSent(button.dataset.markWhatsappSent)));
  table.querySelectorAll("[data-save-call-note]").forEach((button) => button.addEventListener("click", () => saveExpandedCallNote(button.dataset.saveCallNote)));
  table.querySelectorAll("[data-save-call-profile]").forEach((button) => button.addEventListener("click", () => saveCallProfile(button.dataset.saveCallProfile)));
}

function renderCallDayTabs() {
  document.getElementById("calls-day-tabs").innerHTML = CALL_DAYS.map((day) => `
    <button class="${state.callsDay === day ? "active" : ""}" data-call-day="${day}">יום ${CALL_DAY_SHORT[day] || day}<small>${displayShortDate(callDateForDay(day))}</small></button>
  `).join("");
  document.querySelectorAll("[data-call-day]").forEach((button) => button.addEventListener("click", () => {
    state.callsDay = button.dataset.callDay;
    state.callsFilter = "";
    state.expandedCallCustomerNo = "";
    renderCalls();
  }));
}

function renderCallSummary(rows) {
  const counts = { ordered: 0, no_need: 0, no_answer: 0, call_again: 0, pending: 0 };
  rows.forEach((row) => {
    const status = normalizeCallStatus(row.status);
    counts[status] = (counts[status] || 0) + 1;
  });
  const items = [
    ["ordered", "ביצעו הזמנה", counts.ordered],
    ["no_need", "לא צריכים", counts.no_need],
    ["pending", "עדיין בטיפול", counts.pending],
    ["no_answer", "לא ענו", counts.no_answer],
    ["call_again", "לחזור", counts.call_again],
  ];
  document.getElementById("calls-summary").innerHTML = items.map(([status, label, count]) => `
    <button class="call-summary-card ${state.callsFilter === status ? "active" : ""}" data-call-filter="${status}">
      <span>${label}</span><strong>${integer(count)}</strong>
    </button>
  `).join("");
  document.querySelectorAll("[data-call-filter]").forEach((button) => button.addEventListener("click", () => {
    state.callsFilter = state.callsFilter === button.dataset.callFilter ? "" : button.dataset.callFilter;
    renderCalls();
  }));
}

function renderCallBulkActions(rows = []) {
  const container = document.getElementById("call-bulk-actions");
  if (!container) return;
  const selectedRows = rows.filter((row) => state.selectedCallCustomers.has(String(row.customer_no)));
  container.classList.toggle("hidden", selectedRows.length === 0);
  if (!selectedRows.length) {
    container.innerHTML = "";
    return;
  }
  container.innerHTML = `
    <span>${integer(selectedRows.length)} לקוחות נבחרו</span>
    <select id="bulk-call-template">
      ${state.callTemplates.map((template) => `<option value="${escapeAttr(template.id)}">${escapeHtml(template.title)}</option>`).join("")}
    </select>
    <button class="primary-action" id="bulk-whatsapp-send" type="button">פתיחת WhatsApp לנבחרים</button>
    <button class="secondary-action" id="bulk-call-clear" type="button">ניקוי בחירה</button>
  `;
  document.getElementById("bulk-whatsapp-send").addEventListener("click", () => openBulkWhatsapp(selectedRows));
  document.getElementById("bulk-call-clear").addEventListener("click", () => {
    state.selectedCallCustomers.clear();
    renderCalls();
  });
}

async function openBulkWhatsapp(rows) {
  const templateId = document.getElementById("bulk-call-template")?.value;
  const template = state.callTemplates.find((item) => item.id === templateId) || state.callTemplates[0] || CALL_MESSAGE_TEMPLATES[0];
  const sentTasks = [];
  rows.forEach((row, index) => {
    const phone = String(row.phone || row.phone2 || "").replace(/\D/g, "").replace(/^0/, "972");
    if (!phone) return;
    const url = whatsappUrl(phone, templateText(template.text, row));
    setTimeout(() => window.open(url, "_blank", "noopener"), index * 180);
    sentTasks.push(markWhatsappSent(row.customer_no, false));
  });
  await Promise.all(sentTasks);
  if (state.callsSource !== "postgres") await persistDatabase();
  state.selectedCallCustomers.clear();
  renderCalls();
}

function renderCallTemplateEditor() {
  const select = document.getElementById("call-template-select");
  if (!select) return;
  select.innerHTML = state.callTemplates.map((template) => `<option value="${escapeAttr(template.id)}">${escapeHtml(template.title)}</option>`).join("");
  if (!state.callTemplates.some((template) => template.id === state.selectedCallTemplateId)) {
    state.selectedCallTemplateId = state.callTemplates[0]?.id || "";
  }
  select.value = state.selectedCallTemplateId;
  loadSelectedCallTemplate(state.selectedCallTemplateId);
}

function toggleCallTemplateEditor() {
  document.getElementById("call-template-editor").classList.toggle("hidden");
  renderCallTemplateEditor();
}

function loadSelectedCallTemplate(templateId) {
  state.selectedCallTemplateId = templateId;
  const template = state.callTemplates.find((item) => item.id === templateId) || { title: "", text: "" };
  document.getElementById("call-template-title").value = template.title || "";
  document.getElementById("call-template-text").value = template.text || "";
}

function saveCurrentCallTemplate() {
  const title = text(document.getElementById("call-template-title").value);
  const templateTextValue = text(document.getElementById("call-template-text").value);
  if (!title || !templateTextValue) return alert("יש למלא שם נוסח וטקסט הודעה.");
  const id = state.selectedCallTemplateId || `template-${Date.now()}`;
  const existing = state.callTemplates.find((item) => item.id === id);
  if (existing) {
    existing.title = title;
    existing.text = templateTextValue;
  } else {
    state.callTemplates.push({ id, title, text: templateTextValue });
    state.selectedCallTemplateId = id;
  }
  saveCallTemplates();
  renderCalls();
}

function startNewCallTemplate() {
  state.selectedCallTemplateId = `template-${Date.now()}`;
  document.getElementById("call-template-select").value = "";
  document.getElementById("call-template-title").value = "";
  document.getElementById("call-template-text").value = "";
  document.getElementById("call-template-title").focus();
}

function deleteCurrentCallTemplate() {
  if (state.callTemplates.length <= 1) return alert("צריך להשאיר לפחות נוסח אחד.");
  if (!confirm("למחוק את הנוסח?")) return;
  state.callTemplates = state.callTemplates.filter((item) => item.id !== state.selectedCallTemplateId);
  state.selectedCallTemplateId = state.callTemplates[0]?.id || "";
  saveCallTemplates();
  renderCalls();
}

function callRowHtml(row) {
  const status = normalizeCallStatus(row.status);
  const meta = CALL_STATUS_META[status] || CALL_STATUS_META.pending;
  const expanded = state.expandedCallCustomerNo === String(row.customer_no);
  const timeText = status === "call_again" ? row.call_again_time : (status === "no_answer" ? timeFromIso(row.updated_at) : "");
  const selected = state.selectedCallCustomers.has(String(row.customer_no));
  const whatsappBadge = row.whatsapp_sent_at ? `<span class="call-message-sent" title="נשלחה הודעת WhatsApp">נשלחה הודעה</span>` : "";
  return `
    <tr class="call-row status-${meta.className}">
      <td class="call-select-col"><input type="checkbox" data-call-select="${escapeAttr(row.customer_no)}" ${selected ? "checked" : ""} /></td>
      <td><button class="call-customer-button" data-call-toggle="${escapeAttr(row.customer_no)}"><span>${escapeHtml(row.customer_name)} ${whatsappBadge}</span><small>${escapeHtml(row.customer_no)}${row.city ? ` · ${escapeHtml(row.city)}` : ""}</small></button></td>
      <td><span class="call-status-pill ${meta.className}">${meta.label}</span></td>
      <td>${escapeHtml(timeText)}</td>
    </tr>
    ${expanded ? `<tr class="call-detail-row"><td colspan="4">${callDetailHtml(row)}</td></tr>` : ""}
  `;
}

function callDetailHtml(row) {
  const phone = String(row.phone || row.phone2 || "").replace(/\D/g, "");
  const whatsappPhone = phone ? phone.replace(/^0/, "972") : "";
  const wazeQuery = encodeURIComponent(row.address || row.customer_name || "");
  const firstTemplate = state.callTemplates[0] || CALL_MESSAGE_TEMPLATES[0];
  const messagePreview = templateText(firstTemplate.text, row);
  const recentOrders = queryRows(`
    SELECT id, order_date, status, estimated_total
    FROM customer_orders
    WHERE customer_no = ?
    ORDER BY order_date DESC, id DESC
    LIMIT 5
  `, [row.customer_no]);
  const recentCalls = queryRows(`
    SELECT call_date, status, call_again_time, notes, updated_at
    FROM customer_calls
    WHERE customer_no = ?
    ORDER BY call_date DESC, id DESC
    LIMIT 5
  `, [row.customer_no]);
  return `
    <div class="call-detail-card">
      <div class="call-mobile-head">
        <div>
          <h3>${escapeHtml(row.customer_name)}</h3>
          <p>${escapeHtml(row.customer_no)} · ${escapeHtml(row.contact || "ללא איש קשר")}</p>
          <p>${escapeHtml(row.phone || row.phone2 || "ללא טלפון")}${row.address ? ` · ${escapeHtml(row.address)}` : ""}</p>
        </div>
        <span class="call-status-pill ${(CALL_STATUS_META[normalizeCallStatus(row.status)] || CALL_STATUS_META.pending).className}">${callStatusLabel(row.status)}</span>
      </div>
      <div class="call-detail-actions">
        <button data-call-status="ordered" data-call-customer="${escapeAttr(row.customer_no)}">V הזמין</button>
        <button data-call-status="no_need" data-call-customer="${escapeAttr(row.customer_no)}">לא צריך</button>
        <button data-call-status="no_answer" data-call-customer="${escapeAttr(row.customer_no)}">לא ענה</button>
        <button data-call-status="call_again" data-call-customer="${escapeAttr(row.customer_no)}">לחזור</button>
        <input class="call-time-picker" id="call-time-${escapeAttr(row.customer_no)}" data-call-time="${escapeAttr(row.customer_no)}" type="time" value="${escapeAttr(row.call_again_time || "")}" aria-label="שעת חזרה" />
        <button type="button" data-mark-whatsapp-sent="${escapeAttr(row.customer_no)}">נשלחה הודעה</button>
      </div>
      <div class="call-contact-actions">
        <button class="call-icon-action order" data-order-from-call="${escapeAttr(row.customer_no)}" title="יצירת הזמנה" aria-label="יצירת הזמנה"><span>+</span><b>הזמנה</b></button>
        ${phone ? `<a class="call-icon-action phone" href="tel:${escapeAttr(phone)}" title="חיוג" aria-label="חיוג"><span>☎</span><b>חייג</b></a>` : ""}
        <a class="call-icon-action waze" href="https://waze.com/ul?q=${wazeQuery}" target="_blank" rel="noopener" title="ניווט ב-Waze" aria-label="ניווט ב-Waze"><span>W</span><b>Waze</b></a>
        <button class="call-icon-action whatsapp" data-toggle-call-whatsapp="${escapeAttr(row.customer_no)}" title="WhatsApp" aria-label="WhatsApp"><span>☏</span><b>WhatsApp</b></button>
      </div>
      <div class="whatsapp-template-box hidden" id="call-whatsapp-panel-${escapeAttr(row.customer_no)}">
        <label>הודעת WhatsApp מוכנה
          <select data-call-template="${escapeAttr(row.customer_no)}">
            ${state.callTemplates.map((template) => `<option value="${escapeAttr(template.id)}">${escapeHtml(template.title)}</option>`).join("")}
          </select>
        </label>
        <textarea id="call-message-${escapeAttr(row.customer_no)}" data-call-message="${escapeAttr(row.customer_no)}" rows="2">${escapeHtml(messagePreview)}</textarea>
        ${whatsappPhone ? `<a class="primary-action" id="call-whatsapp-${escapeAttr(row.customer_no)}" data-call-whatsapp-send="${escapeAttr(row.customer_no)}" href="${whatsappUrl(whatsappPhone, messagePreview)}" target="_blank" rel="noopener">שליחת WhatsApp</a>` : ""}
      </div>
      <div class="call-profile-editor">
        <label>טלפון<input id="call-edit-phone-${escapeAttr(row.customer_no)}" value="${escapeAttr(row.phone || "")}" /></label>
        <label>כתובת<input id="call-edit-address-${escapeAttr(row.customer_no)}" value="${escapeAttr(row.address || "")}" /></label>
        <label>ימי שיחה<input id="call-edit-days-${escapeAttr(row.customer_no)}" value="${escapeAttr(row.days || "")}" placeholder="ראשון,שלישי" /></label>
        <button class="secondary-action" data-save-call-profile="${escapeAttr(row.customer_no)}" type="button">שמירת לקוח</button>
      </div>
      <label class="call-note-editor">הערת שיחה
        <textarea id="call-note-${escapeAttr(row.customer_no)}" rows="3">${escapeHtml(row.notes || "")}</textarea>
      </label>
      <button class="primary-action" data-save-call-note="${escapeAttr(row.customer_no)}">שמירת הערה</button>
      <div class="two-column call-history-columns">
        <section>
          <h3>שיחות אחרונות</h3>
          <div class="mini-list">${recentCalls.length ? recentCalls.map((call) => `<div><b>${escapeHtml(call.call_date)}</b><span>${escapeHtml(callStatusLabel(call.status))}${call.call_again_time ? ` · ${escapeHtml(call.call_again_time)}` : ""}</span><small>${escapeHtml(call.notes || "")}</small></div>`).join("") : "<p>אין שיחות קודמות</p>"}</div>
        </section>
        <section>
          <h3>הזמנות אחרונות</h3>
          <div class="mini-list">${recentOrders.length ? recentOrders.map((order) => `<div><b>#${integer(order.id)}</b><span>${escapeHtml(order.order_date)} · ${escapeHtml(order.status)}</span><small>${currency(order.estimated_total)}</small></div>`).join("") : "<p>אין הזמנות קודמות</p>"}</div>
        </section>
      </div>
    </div>
  `;
}

function templateText(template, row) {
  return String(template || "")
    .replaceAll("{שם}", row.contact || row.customer_name || "")
    .replaceAll("{לקוח}", row.customer_name || "");
}

function whatsappUrl(phone, message) {
  return `https://wa.me/${escapeAttr(phone)}?text=${encodeURIComponent(message)}`;
}

function callCustomerByNo(customerNo) {
  if (state.callsSource === "postgres") {
    const row = state.postgresCallRows.find((item) => String(item.customer_no) === String(customerNo));
    if (row) return row;
  }
  return firstRow(`
    SELECT customer_no, customer_name FROM customer_profitability_summary WHERE customer_no = ?
    UNION
    SELECT customer_no, customer_name FROM customer_call_profiles WHERE customer_no = ? AND COALESCE(source, 'calls') = 'calls'
    LIMIT 1
  `, [customerNo, customerNo]);
}

function updateCallMessagePreview(select) {
  const customerNo = select.dataset.callTemplate;
  const row = firstRow(`
    WITH call_customers AS (
      SELECT customer_no, customer_name FROM customer_profitability_summary
      UNION
      SELECT customer_no, customer_name FROM customer_call_profiles WHERE COALESCE(source, 'calls') = 'calls'
    )
    SELECT c.customer_no, MAX(c.customer_name) AS customer_name, COALESCE(p.contact, '') AS contact
    FROM call_customers c
    LEFT JOIN customer_call_profiles p ON p.customer_no = c.customer_no
    WHERE c.customer_no = ?
    GROUP BY c.customer_no
  `, [customerNo]);
  const template = state.callTemplates.find((item) => item.id === select.value) || state.callTemplates[0] || CALL_MESSAGE_TEMPLATES[0];
  const message = templateText(template.text, row);
  const textarea = document.getElementById(`call-message-${customerNo}`);
  if (textarea) textarea.value = message;
  const profile = firstRow("SELECT phone, phone2 FROM customer_call_profiles WHERE customer_no = ?", [customerNo]);
  const phone = String(profile.phone || profile.phone2 || "").replace(/\D/g, "").replace(/^0/, "972");
  const link = document.getElementById(`call-whatsapp-${customerNo}`);
  if (link && phone) link.href = whatsappUrl(phone, message);
}

function toggleCallWhatsappPanel(customerNo) {
  const panel = document.getElementById(`call-whatsapp-panel-${customerNo}`);
  if (!panel) return;
  panel.classList.toggle("hidden");
}

function updateCallWhatsappLink(customerNo) {
  const profile = firstRow("SELECT phone, phone2 FROM customer_call_profiles WHERE customer_no = ? AND COALESCE(source, 'calls') = 'calls'", [customerNo]);
  const phone = String(profile.phone || profile.phone2 || "").replace(/\D/g, "").replace(/^0/, "972");
  const message = document.getElementById(`call-message-${customerNo}`)?.value || "";
  const link = document.getElementById(`call-whatsapp-${customerNo}`);
  if (link && phone) link.href = whatsappUrl(phone, message);
}

async function markWhatsappSent(customerNo, shouldPersist = true) {
  const row = callCustomerByNo(customerNo);
  if (!row.customer_no) return;
  if (state.callsSource === "postgres") {
    await upsertPostgresCallStatus(row, normalizeCallStatus(row.status), {
      callAgainTime: row.call_again_time,
      notes: row.notes || "",
      whatsappSentAt: new Date().toISOString(),
    });
    if (shouldPersist) renderCalls();
    return;
  }
  const existing = firstRow("SELECT status, call_again_time, notes FROM customer_calls WHERE customer_no = ? AND call_date = ?", [customerNo, callDateForDay(state.callsDay)]);
  upsertCallStatus(row.customer_no, row.customer_name, state.callsDay, normalizeCallStatus(existing.status), {
    callAgainTime: existing.call_again_time,
    notes: existing.notes || "",
    whatsappSentAt: new Date().toISOString(),
  });
  if (shouldPersist) {
    await persistDatabase();
    renderCalls();
  }
}

async function saveCallProfile(customerNo) {
  const phone = text(document.getElementById(`call-edit-phone-${customerNo}`)?.value);
  const address = text(document.getElementById(`call-edit-address-${customerNo}`)?.value);
  const days = normalizeCallDays(document.getElementById(`call-edit-days-${customerNo}`)?.value || state.callsDay);
  if (state.callsSource === "postgres") {
    const response = await fetch("/api/postgres/call-profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customer_no: customerNo, phone, address, call_days: days.join(",") }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) return alert(data.error || "שמירת הלקוח נכשלה");
    const row = state.postgresCallRows.find((item) => String(item.customer_no) === String(customerNo));
    if (row) Object.assign(row, { phone, address, days: days.join(",") });
    renderCalls();
    return;
  }
  const profile = firstRow("SELECT * FROM customer_call_profiles WHERE customer_no = ? AND COALESCE(source, 'calls') = 'calls'", [customerNo]);
  if (!profile.customer_no) return;
  state.db.run(`
    UPDATE customer_call_profiles
    SET phone = ?, address = ?, days = ?, updated_at = ?
    WHERE customer_no = ?
  `, [phone, address, days.join(","), new Date().toISOString(), customerNo]);
  await persistDatabase();
  renderCalls();
}

async function updateCustomerCallFromButton(button) {
  const customerNo = button.dataset.callCustomer;
  const status = button.dataset.callStatus;
  const row = callCustomerByNo(customerNo);
  if (!row.customer_no) return;
  const callDate = callDateForDay(state.callsDay);
  const existingCall = state.callsSource === "postgres"
    ? (state.postgresCallRows.find((item) => String(item.customer_no) === String(customerNo)) || {})
    : firstRow("SELECT status, manual_order_id FROM customer_calls WHERE customer_no = ? AND call_date = ?", [customerNo, callDate]);
  const options = {};
  if (status === "call_again") {
    const timeInput = document.getElementById(`call-time-${customerNo}`);
    if (timeInput && !timeInput.value) {
      timeInput.focus();
      if (typeof timeInput.showPicker === "function") timeInput.showPicker();
      return;
    }
    if (!timeInput?.value) return;
    options.callAgainTime = timeInput.value;
  }
  if (status === "no_answer") options.notes = `לא ענה ${new Date().toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })}`;
  let manualOrder = null;
  if (status === "ordered" && normalizeCallStatus(existingCall.status) !== "ordered" && !number(existingCall.manual_order_id)) {
    manualOrder = createManualOrderFromCall(row.customer_no, row.customer_name);
    if (manualOrder?.orderId) options.manualOrderId = manualOrder.orderId;
  } else if (number(existingCall.manual_order_id)) {
    options.manualOrderId = number(existingCall.manual_order_id);
  }
  if (state.callsSource === "postgres") {
    await upsertPostgresCallStatus(row, status, options);
  } else {
    upsertCallStatus(row.customer_no, row.customer_name, state.callsDay, status, options);
  }
  if (manualOrder?.orderId) {
    const delta = {
      order: {
        client_order_key: manualOrder.clientOrderKey,
        order_date: manualOrder.orderDate,
        customer_no: row.customer_no,
        customer_name: row.customer_name,
        status: ORDER_STATUSES[0],
        notes: "הזמנה ידנית מניהול שיחות",
        estimated_total: 0,
        estimated_profit: 0,
        updated_at: manualOrder.now,
      },
      items: [],
      call: {
        call_date: callDate,
        customer_no: row.customer_no,
        customer_name: row.customer_name,
        status,
        call_again_time: options.callAgainTime || null,
        manual_order_id: manualOrder.orderId,
        notes: options.notes || "",
        updated_at: new Date().toISOString(),
      },
    };
    const serverResult = await writeOrderDelta(delta);
    await writeBrowserDatabase(state.db.export());
    if (serverResult.ok) await reloadDatabaseFromServer();
  } else if (state.callsSource !== "postgres") {
    await persistDatabase();
  }
  renderCalls();
  renderOrderHistory();
  if (state.selectedCustomer) renderCustomerCalls(state.selectedCustomer.customer_no);
}

async function updateCustomerCallTime(input) {
  const customerNo = input.dataset.callTime;
  const row = callCustomerByNo(customerNo);
  if (!row.customer_no || !input.value) return;
  if (state.callsSource === "postgres") {
    await upsertPostgresCallStatus(row, "call_again", { callAgainTime: input.value });
    renderCalls();
    if (state.selectedCustomer) renderCustomerCalls(state.selectedCustomer.customer_no);
    return;
  }
  upsertCallStatus(row.customer_no, row.customer_name, state.callsDay, "call_again", { callAgainTime: input.value });
  await persistDatabase();
  renderCalls();
  if (state.selectedCustomer) renderCustomerCalls(state.selectedCustomer.customer_no);
}

async function saveExpandedCallNote(customerNo) {
  const row = callCustomerByNo(customerNo);
  const note = document.getElementById(`call-note-${customerNo}`)?.value || "";
  if (state.callsSource === "postgres") {
    await upsertPostgresCallStatus(row, normalizeCallStatus(row.status), { callAgainTime: row.call_again_time, notes: note });
    renderCalls();
    return;
  }
  const existing = firstRow("SELECT status, call_again_time FROM customer_calls WHERE customer_no = ? AND call_date = ?", [customerNo, callDateForDay(state.callsDay)]);
  upsertCallStatus(row.customer_no, row.customer_name, state.callsDay, normalizeCallStatus(existing.status), { callAgainTime: existing.call_again_time, notes: note });
  await persistDatabase();
  renderCalls();
}

function normalizeCallStatus(status) {
  const value = String(status || "").trim();
  return CALL_STATUS_META[value] ? value : "pending";
}

function callStatusLabel(status) {
  return (CALL_STATUS_META[normalizeCallStatus(status)] || CALL_STATUS_META.pending).label;
}

function timeFromIso(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
}

function editCall(id) {
  const row = firstRow("SELECT * FROM customer_calls WHERE id = ?", [id]);
  document.getElementById("call-id").value = row.id;
  document.getElementById("call-date").value = row.call_date;
  document.getElementById("call-customer-query").value = row.customer_name;
  refreshCallCustomerSelect();
  document.getElementById("call-customer-select").value = row.customer_no;
  document.getElementById("call-status").value = row.status || "";
  document.getElementById("call-notes").value = row.notes || "";
}

async function deleteCall(id) {
  if (!confirm("למחוק את השיחה?")) return;
  state.db.run("DELETE FROM customer_calls WHERE id = ?", [id]);
  await persistDatabase();
  renderCalls();
}

function resetCallForm() {
  document.getElementById("call-id").value = "";
  document.getElementById("call-date").value = toSqlDate(new Date());
  document.getElementById("call-customer-query").value = "";
  document.getElementById("call-status").value = "";
  document.getElementById("call-notes").value = "";
  refreshCallCustomerSelect();
}

async function saveRecommendation(event) {
  event.preventDefault();
  const id = document.getElementById("recommendation-id").value;
  const textValue = document.getElementById("recommendation-text").value.trim();
  const active = document.getElementById("recommendation-active").checked ? 1 : 0;
  if (!textValue) return;
  if (id) state.db.run("UPDATE sales_recommendations SET text = ?, active = ? WHERE id = ?", [textValue, active, id]);
  else state.db.run("INSERT INTO sales_recommendations (text, active) VALUES (?, ?)", [textValue, active]);
  await persistDatabase();
  resetRecommendationForm();
  renderRecommendations();
  if (state.selectedCustomer) renderCustomerRecommendations(state.selectedCustomer.customer_no);
}

function renderRecommendations() {
  const rows = queryRows("SELECT id, text, active FROM sales_recommendations ORDER BY id DESC");
  renderTable("recommendations-table", rows, [
    { key: "text", label: "טקסט המלצה" },
    { key: "active", label: "פעיל", render: (row) => row.active ? '<span class="badge">פעיל</span>' : "לא פעיל" },
    { key: "actions", label: "פעולות", sortable: false, render: (row) => `
      <button class="small-action" data-edit-rec="${row.id}">עריכה</button>
      <button class="small-action" data-toggle-rec="${row.id}">${row.active ? "ביטול" : "הפעלה"}</button>
      <button class="danger-action" data-delete-rec="${row.id}">מחיקה</button>
    ` },
  ], "recommendations", "id", "desc");
  document.querySelectorAll("[data-edit-rec]").forEach((button) => button.addEventListener("click", () => editRecommendation(button.dataset.editRec)));
  document.querySelectorAll("[data-toggle-rec]").forEach((button) => button.addEventListener("click", () => toggleRecommendation(button.dataset.toggleRec)));
  document.querySelectorAll("[data-delete-rec]").forEach((button) => button.addEventListener("click", () => deleteRecommendation(button.dataset.deleteRec)));
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
    const sortableClass = column.sortable === false ? "" : " class=\"sortable\"";
    return `<th${sortableClass} data-sort-id="${sortId}" data-key="${column.key}">${column.label}${marker}</th>`;
  }).join("");
  const body = sortedRows.length
    ? sortedRows.map((row) => `<tr>${columns.map((column) => `<td>${cellValue(row, column)}</td>`).join("")}</tr>`).join("")
    : `<tr><td colspan="${columns.length}" class="empty-state">אין נתונים להצגה</td></tr>`;
  table.innerHTML = `<thead><tr>${headers}</tr></thead><tbody>${body}</tbody>`;
  table.querySelectorAll("th.sortable").forEach((th) => {
    th.addEventListener("click", () => {
      const current = state.sort[sortId] || { key: defaultKey, direction: defaultDirection };
      state.sort[sortId] = { key: th.dataset.key, direction: current.key === th.dataset.key && current.direction === "asc" ? "desc" : "asc" };
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

function returnPercentCell(row) {
  const value = number(row.returns_percent);
  const cls = returnPercentClass(value);
  return `<span class="${cls}">${percent(value)}</span>`;
}

function returnPercentClass(value) {
  const numericValue = number(value);
  if (numericValue <= 0.07) return "return-low";
  if (numericValue <= 0.13) return "return-mid";
  return "return-high";
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
  return String(value ?? "").normalize("NFKC").replace(/[״"'`׳’‘]/g, "").replace(/[₪()]/g, "").replace(/\s+/g, "").trim();
}

function number(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const cleaned = String(value ?? "").replace(/[,\s₪]/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function quantityNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
  const cleaned = String(value ?? "").trim().replace(/\s/g, "").replace(",", ".");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

function text(value) {
  return String(value ?? "").trim();
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
  if (monthYear) return toSqlDate(new Date(Number(monthYear[2].length === 2 ? `20${monthYear[2]}` : monthYear[2]), Number(monthYear[1]) - 1, 1));
  const yearMonth = raw.match(/^(\d{4})[./-](\d{1,2})$/);
  if (yearMonth) return toSqlDate(new Date(Number(yearMonth[1]), Number(yearMonth[2]) - 1, 1));
  const parts = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (parts) return toSqlDate(new Date(Number(parts[3].length === 2 ? `20${parts[3]}` : parts[3]), Number(parts[2]) - 1, Number(parts[1])));
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? "" : toSqlDate(parsed);
}

function toSqlDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function displayShortDate(sqlDate) {
  const [year, month, day] = String(sqlDate || "").split("-");
  return day && month ? `${day}/${month}` : "";
}

function dateRange(months) {
  const end = firstDayOfCurrentMonth();
  const start = new Date(end.getFullYear(), end.getMonth() - months, 1);
  return { start: toSqlDate(start), end: toSqlDate(end) };
}

function firstDayOfCurrentMonth() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function compareValues(a, b, direction) {
  const left = typeof a === "number" ? a : String(a ?? "");
  const right = typeof b === "number" ? b : String(b ?? "");
  const result = typeof left === "number" && typeof right === "number" ? left - right : left.localeCompare(right, "he");
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

function fillSelect(id, placeholder, rows, valueKey = "value", labelKey = "value") {
  const select = document.getElementById(id);
  const current = select.value;
  select.innerHTML = `<option value="">${placeholder}</option>` + rows.map((row) => `<option value="${escapeAttr(row[valueKey])}">${escapeHtml(row[labelKey] || row[valueKey])}</option>`).join("");
  select.value = [...select.options].some((option) => option.value === current) ? current : "";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
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
  const serverData = await readServerDatabase();
  if (serverData) return { data: serverData, source: "server" };
  const browserData = await readBrowserDatabase();
  const serverScore = databaseScore(SQL, serverData);
  const browserScore = databaseScore(SQL, browserData);
  if (browserData) return { data: browserData, source: "browser" };
  return null;
}

function databaseScore(SQL, data) {
  if (!data) return -1;
  let db;
  try {
    db = new SQL.Database(data);
    return tableCount(db, "sales_raw") * 1000 + tableCount(db, "products") * 10 + tableCount(db, "customer_orders");
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
    const response = await fetch("/api/db", { cache: "no-store" });
    if (!response.ok) return null;
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
  if (state.persistTimer) {
    clearTimeout(state.persistTimer);
    state.persistTimer = null;
  }
  const data = state.db.export();
  const [, server] = await Promise.all([writeBrowserDatabase(data), writeServerDatabase(data)]);
  updateServerSaveStatus(server);
  return { server };
}

function schedulePersistDatabase(delay = 900) {
  const data = state.db.export();
  writeBrowserDatabase(data);
  setPickingSyncStatus("שמירה מקומית בוצעה, ממתין לשרת");
  if (state.persistTimer) clearTimeout(state.persistTimer);
  state.persistTimer = setTimeout(() => {
    state.persistTimer = null;
    writeServerDatabase(data).then(updateServerSaveStatus);
  }, delay);
}

async function savePickingNow(options = {}) {
  if (!state.db) return null;
  if (state.serverSaveInProgress) {
    setTimeout(() => savePickingNow({ silent: true }), 350);
    return null;
  }
  state.serverSaveInProgress = true;
  setPickingSyncStatus("שומר לשרת...");
  await writeBrowserDatabase(state.db.export());
  const changesToSend = state.pendingPickingChanges.slice();
  const result = changesToSend.length
    ? await writePickingChanges(changesToSend)
    : { ok: true, skipped: true };
  if (result.ok && changesToSend.length) state.pendingPickingChanges.splice(0, changesToSend.length);
  updateServerSaveStatus(result);
  state.serverSaveInProgress = false;
  if (result.ok && state.pendingPickingChanges.length) setTimeout(() => savePickingNow({ silent: true }), 50);
  if (!result.ok && !options.silent) alert(`השמירה לשרת נכשלה: ${result.error || "שגיאה לא ידועה"}. הנתונים נשמרו בדפדפן הזה בלבד.`);
  return { server: result };
}

function queuePickingChange(change) {
  state.pendingPickingChanges.push(change);
  setPickingSyncStatus("יש שינויי ליקוט שעדיין לא נשמרו לשרת");
}

function updateServerSaveStatus(server) {
  if (server?.ok) {
    const time = new Date().toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setPickingSyncStatus(server.skipped ? `אין שינויי ליקוט לשמירה ${time}` : `נשמר לשרת ${time}`);
    return;
  }
  setPickingSyncStatus(`נשמר בדפדפן בלבד - לא סונכרן לשרת${server?.error ? ` (${server.error})` : ""}`);
}

function setPickingSyncStatus(textValue) {
  const element = document.getElementById("picking-sync-status");
  if (element) element.textContent = textValue;
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
    const response = await fetch("/api/db", { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: data });
    if (response.ok) return { ok: true };
    return { ok: false, error: await response.text() };
  } catch (error) {
    console.warn("לא ניתן לשמור בסיס נתונים בשרת", error);
    return { ok: false, error: error.message };
  }
}

async function writePickingChanges(changes) {
  try {
    const response = await fetch("/api/picking-changes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ changes }),
    });
    if (response.ok) {
      const result = await response.json().catch(() => ({}));
      return { ok: result.ok !== false, applied: result.applied || changes.length };
    }
    const textValue = await response.text();
    return { ok: false, error: `${response.status} ${textValue}`.trim() };
  } catch (error) {
    console.warn("לא ניתן לשמור שינויי ליקוט בשרת", error);
    return { ok: false, error: error.message };
  }
}

async function writeOrderDelta(delta) {
  try {
    const response = await fetch("/api/order-delta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(delta),
    });
    if (response.ok) {
      const result = await response.json().catch(() => ({}));
      updateServerSaveStatus({ ok: result.ok !== false });
      return { ok: result.ok !== false, orderId: result.orderId };
    }
    const textValue = await response.text();
    updateServerSaveStatus({ ok: false, error: textValue });
    return { ok: false, error: `${response.status} ${textValue}`.trim() };
  } catch (error) {
    console.warn("לא ניתן לשמור הזמנה בשרת", error);
    updateServerSaveStatus({ ok: false, error: error.message });
    return { ok: false, error: error.message };
  }
}

async function reloadDatabaseFromServer() {
  const data = await readServerDatabase();
  if (!data) return false;
  const SQL = await window.initSqlJs({ locateFile: (file) => SQL_WASM + file });
  if (state.db) state.db.close();
  state.db = new SQL.Database(data);
  createSharedSchema();
  createManagementSchema();
  ensureSummaryTables();
  await writeBrowserDatabase(data);
  return true;
}
