const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { createPriceAuditService, isAuthorized: isPriceAuditAuthorized } = require("./price-audit-core");

const root = __dirname;
const dataDir = path.resolve(process.env.DATA_DIR || path.join(root, "data"));
const dbPath = path.join(dataDir, "sales-analytics.sqlite");
const legacyDbPath = path.join(root, "sales-analytics.sqlite");
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "0.0.0.0";
const maxDbBytes = Number(process.env.MAX_DB_BYTES || 1024 * 1024 * 1024);
const supabaseUrl = normalizeSupabaseUrl(process.env.SUPABASE_URL || "");
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const supabaseBucket = process.env.SUPABASE_BUCKET || "sales-analytics";
const supabaseDbObject = process.env.SUPABASE_DB_OBJECT || "sales-analytics.sqlite";
const useSupabase = Boolean(supabaseUrl && supabaseServiceRoleKey);
const postgresPreviewUrl = normalizeSupabaseUrl(process.env.SUPABASE_POSTGRES_URL || "");
const postgresPreviewKey = process.env.SUPABASE_POSTGRES_SERVICE_ROLE_KEY || "";
const usePostgresPreview = Boolean(postgresPreviewUrl && postgresPreviewKey);
const priceAuditApiKey = process.env.PRICE_AUDIT_API_KEY || "";
const customerSessionSecret = process.env.CUSTOMER_SESSION_SECRET || supabaseServiceRoleKey || "local-customer-session-secret";
const dbCacheTtlMs = Number(process.env.DB_CACHE_TTL_MS || 60 * 60 * 1000);
let SQLRuntimePromise = null;
let dbMutationQueue = Promise.resolve();
let databaseBufferCache = null;
let databaseBufferCacheLoadedAt = 0;
const priceAuditService = createPriceAuditService({
  supabaseUrl: postgresPreviewUrl || supabaseUrl,
  serviceKey: postgresPreviewKey || supabaseServiceRoleKey,
});

const CUSTOMER_APP_SETTING_DEFAULTS = {
  customer_login_title: "כניסה למערכת ההזמנות",
  customer_login_subtitle: "מזמינים בקלות, רואים מוצרים מומלצים ומבצעים, ושולחים הזמנה ישירות לחברון שיווק סלטים בע\"מ.",
  customer_terms_text: [
    "השימוש באתר מיועד לביצוע הזמנות מול חברון שיווק סלטים בע\"מ בלבד.",
    "המחירים, הזמינות והאישור הסופי של ההזמנה כפופים לבדיקת החברה ולאישור ההזמנה בפועל.",
    "שליחת הזמנה מהווה בקשה להזמנה. ייתכנו שינויים בכמות, בזמינות, במחיר ובמועד האספקה לפי מלאי ותיאום מול הלקוח.",
    "פרטי הלקוח נשמרים לצורך טיפול בהזמנות, שירות ותיאום אספקה. אין להזין פרטי כרטיס אשראי במסך זה.",
  ].join("\n\n"),
  customer_warranty_text: [
    "האחריות לאיכות המוצרים ניתנת בהתאם לדין, לתנאי הספקים ולנהלי החברה.",
    "יש לבדוק את הסחורה בעת קבלתה ולעדכן את החברה בסמוך לקבלה במקרה של חוסר, פגם או אי התאמה.",
  ].join("\n\n"),
};

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".png": "image/png",
};

fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(dbPath) && fs.existsSync(legacyDbPath)) {
  fs.copyFileSync(legacyDbPath, dbPath);
}

function normalizeSupabaseUrl(rawUrl) {
  const trimmed = rawUrl.trim();
  if (!trimmed) return "";

  try {
    const parsed = new URL(trimmed);
    const dashboardProject = parsed.pathname.match(/\/dashboard\/project\/([^/]+)/);
    if (dashboardProject) {
      return `https://${dashboardProject[1]}.supabase.co`;
    }
    return `${parsed.protocol}//${parsed.host}`.replace(/\/+$/, "");
  } catch (error) {
    return trimmed.replace(/\/+$/, "");
  }
}

function send(res, status, body = "", headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

function sendJson(res, status, body) {
  send(res, status, JSON.stringify(body), { "Content-Type": "application/json; charset=utf-8" });
}

function supabaseObjectUrl() {
  const objectPath = supabaseDbObject.split("/").map(encodeURIComponent).join("/");
  return `${supabaseUrl}/storage/v1/object/${encodeURIComponent(supabaseBucket)}/${objectPath}`;
}

function supabaseHeaders(extra = {}) {
  const headers = {
    apikey: supabaseServiceRoleKey,
    ...extra,
  };

  if (!supabaseServiceRoleKey.startsWith("sb_secret_")) {
    headers.Authorization = `Bearer ${supabaseServiceRoleKey}`;
  }

  return headers;
}

function postgresHeaders(extra = {}) {
  return {
    apikey: postgresPreviewKey,
    Authorization: `Bearer ${postgresPreviewKey}`,
    ...extra,
  };
}

async function postgresRest(pathname, options = {}) {
  const response = await fetch(`${postgresPreviewUrl}/rest/v1/${pathname}`, {
    ...options,
    headers: postgresHeaders(options.headers || {}),
  });
  if (!response.ok) {
    throw new Error(`postgres preview failed: ${response.status} ${await response.text()}`);
  }
  return response;
}

async function postgresCount(table) {
  const response = await postgresRest(`${table}?select=*`, {
    method: "HEAD",
    headers: { Prefer: "count=exact" },
  });
  const range = response.headers.get("content-range") || "*/0";
  return Number(range.split("/").pop()) || 0;
}

async function postgresRows(pathname) {
  const response = await postgresRest(pathname);
  return response.json();
}

async function handlePostgresPreview(res) {
  if (!usePostgresPreview) {
    sendJson(res, 200, {
      ok: false,
      configured: false,
      message: "SUPABASE_POSTGRES_URL and SUPABASE_POSTGRES_SERVICE_ROLE_KEY are required",
    });
    return;
  }

  const [counts, recentOrders, recentCalls, topProducts] = await Promise.all([
    Promise.all([
      postgresCount("products"),
      postgresCount("sales_raw"),
      postgresCount("customer_orders"),
      postgresCount("customer_order_items"),
      postgresCount("customer_calls"),
      postgresCount("customer_call_profiles"),
      postgresCount("sales_recommendations"),
    ]),
    postgresRows("customer_orders?select=id,order_date,customer_no,customer_name,status,estimated_total&order=id.desc&limit=8"),
    postgresRows("customer_calls?select=id,call_date,customer_no,customer_name,status,call_again_time&order=id.desc&limit=8"),
    postgresRows("products?select=sku,description,category,supplier,sale_price,pick_order&order=description.asc&limit=8"),
  ]);

  sendJson(res, 200, {
    ok: true,
    configured: true,
    projectHost: new URL(postgresPreviewUrl).host,
    counts: {
      products: counts[0],
      sales_raw: counts[1],
      customer_orders: counts[2],
      customer_order_items: counts[3],
      customer_calls: counts[4],
      customer_call_profiles: counts[5],
      sales_recommendations: counts[6],
    },
    recentOrders,
    recentCalls,
    topProducts,
  });
}

function requirePostgres(res) {
  if (usePostgresPreview) return true;
  sendJson(res, 200, {
    ok: false,
    configured: false,
    message: "SUPABASE_POSTGRES_URL and SUPABASE_POSTGRES_SERVICE_ROLE_KEY are required",
  });
  return false;
}

function requirePriceAudit(req, res) {
  if (!priceAuditService.isConfigured() && !useSupabase && !fs.existsSync(dbPath)) {
    sendJson(res, 503, {
      ok: false,
      error: "Supabase server credentials are not configured",
      required_env: ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"],
    });
    return false;
  }
  if (!isPriceAuditAuthorized(req, priceAuditApiKey)) {
    sendJson(res, 401, { ok: false, error: "unauthorized" });
    return false;
  }
  return true;
}

async function handlePriceAuditProduct(req, res) {
  if (!requirePriceAudit(req, res)) return;
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const barcode = (url.searchParams.get("barcode") || "").trim();
  const itemCode = (url.searchParams.get("itemCode") || "").trim();
  if (!barcode && !itemCode) {
    sendJson(res, 400, { ok: false, error: "barcode or itemCode is required" });
    return;
  }

  const result = await findPriceAuditProduct({ barcode, itemCode });
  if (!result.product) {
    sendJson(res, 404, { ok: false, match_type: "not_found" });
    return;
  }
  sendJson(res, 200, result.product);
}

async function handlePriceAuditProductsBatch(payload, req, res) {
  if (!requirePriceAudit(req, res)) return;
  const items = Array.isArray(payload.items) ? payload.items.slice(0, 100) : [];
  const inputs = items.map((item) => ({
    barcode: String(item?.barcode || "").trim(),
    itemCode: String(item?.itemCode || item?.item_code || "").trim(),
  }));
  const results = inputs.map((input) => ({ input, match_type: "not_found", product: null }));
  const postgresMisses = [];

  try {
    await withCurrentSqliteDatabase((db) => {
      inputs.forEach((input, index) => {
        const result = findPriceAuditProductInSqliteDb(db, input);
        results[index] = { input, match_type: result.match_type, product: result.product };
        if (!result.product) postgresMisses.push(index);
      });
    });
  } catch (error) {
    console.error("price audit sqlite batch lookup failed", error);
    postgresMisses.push(...inputs.map((_, index) => index));
  }

  if (priceAuditService.isConfigured()) {
    for (const index of postgresMisses) {
      const input = inputs[index];
      try {
        const result = await priceAuditService.findProduct(input);
        results[index] = { input, match_type: result.match_type, product: result.product };
      } catch (error) {
        console.error("price audit postgres lookup failed", error);
      }
    }
  }
  sendJson(res, 200, { results });
}

async function handlePriceAuditSupplierRules(req, res) {
  if (!requirePriceAudit(req, res)) return;
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const supplier = (url.searchParams.get("supplier") || "").trim();
  const rules = await priceAuditService.supplierRules(supplier);
  sendJson(res, 200, { rules });
}

async function findPriceAuditProduct(input) {
  const normalizedInput = {
    barcode: String(input?.barcode || "").trim(),
    itemCode: String(input?.itemCode || input?.item_code || "").trim(),
  };
  try {
    const sqliteResult = await findPriceAuditProductInSqlite(normalizedInput);
    if (sqliteResult.product) return sqliteResult;
  } catch (error) {
    console.error("price audit sqlite lookup failed", error);
  }

  return findPriceAuditProductInPostgres(normalizedInput);
}

async function findPriceAuditProductInPostgres(input) {
  if (priceAuditService.isConfigured()) {
    try {
      const result = await priceAuditService.findProduct(input);
      if (result.product) return result;
    } catch (error) {
      console.error("price audit postgres lookup failed", error);
    }
  }
  return { match_type: "not_found", product: null };
}

async function handlePriceAuditDiagnostics(req, res) {
  if (!requirePriceAudit(req, res)) return;
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const input = {
    barcode: (url.searchParams.get("barcode") || "").trim(),
    itemCode: (url.searchParams.get("itemCode") || "").trim(),
  };
  const diagnostics = {
    input,
    storage: {
      configured: useSupabase,
      host: supabaseUrl ? new URL(supabaseUrl).host : "",
      bucket: supabaseBucket,
      object: supabaseDbObject,
      ok: false,
      products_count: null,
      product: null,
      error: "",
    },
    postgres: {
      configured: priceAuditService.isConfigured(),
      host: (postgresPreviewUrl || supabaseUrl) ? new URL(postgresPreviewUrl || supabaseUrl).host : "",
      table: "products",
      product: null,
      error: "",
    },
  };

  try {
    await withCurrentSqliteDatabase((db) => {
      diagnostics.storage.ok = true;
      diagnostics.storage.products_count = Number(sqliteSingleRow(db, "SELECT COUNT(*) AS count FROM products", []).count || 0);
      diagnostics.storage.product = findPriceAuditProductInSqliteDb(db, input);
    });
  } catch (error) {
    diagnostics.storage.error = error.message || "sqlite diagnostics failed";
  }

  try {
    diagnostics.postgres.product = await findPriceAuditProductInPostgres(input);
  } catch (error) {
    diagnostics.postgres.error = error.message || "postgres diagnostics failed";
  }

  sendJson(res, 200, diagnostics);
}

async function findPriceAuditProductInSqlite(input = {}) {
  return withCurrentSqliteDatabase((db) => findPriceAuditProductInSqliteDb(db, input));
}

async function withCurrentSqliteDatabase(task) {
  const SQL = await initServerSql();
  const buffer = await readCurrentDatabaseBuffer();
  const db = new SQL.Database(buffer);
  try {
    return await task(db);
  } finally {
    db.close();
  }
}

function customerTermsVersion(values = {}) {
  return crypto.createHash("sha256")
    .update(String(values.customer_terms_text || ""))
    .update("\n---\n")
    .update(String(values.customer_warranty_text || ""))
    .digest("hex")
    .slice(0, 16);
}

async function loadCustomerSettingsValues() {
  const values = { ...CUSTOMER_APP_SETTING_DEFAULTS };
  try {
    await withCurrentSqliteDatabase((db) => {
      db.run(`
        CREATE TABLE IF NOT EXISTS app_metadata (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )
      `);
      sqliteRows(db, "SELECT key, value FROM app_metadata WHERE key IN (?, ?, ?, ?)", [
        "customer_login_title",
        "customer_login_subtitle",
        "customer_terms_text",
        "customer_warranty_text",
      ]).forEach((row) => {
        if (row.key && typeof row.value === "string" && row.value.trim()) values[row.key] = row.value;
      });
    });
  } catch (error) {
    console.error("customer settings lookup failed", error);
  }
  return values;
}

async function getCustomerTermsVersion() {
  return customerTermsVersion(await loadCustomerSettingsValues());
}

async function handleCustomerSettings(res) {
  const values = await loadCustomerSettingsValues();
  sendJson(res, 200, {
    ok: true,
    settings: {
      loginTitle: values.customer_login_title,
      loginSubtitle: values.customer_login_subtitle,
      termsText: values.customer_terms_text,
      warrantyText: values.customer_warranty_text,
      termsVersion: customerTermsVersion(values),
    },
  });
}

async function handleCustomerSettingsSave(payload, res) {
  const allowedKeys = [
    "customer_login_title",
    "customer_login_subtitle",
    "customer_terms_text",
    "customer_warranty_text",
  ];
  const values = {};
  allowedKeys.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(payload || {}, key)) {
      values[key] = String(payload[key] ?? "");
    }
  });
  if (!Object.keys(values).length) {
    sendJson(res, 400, { ok: false, error: "missing settings" });
    return;
  }

  const SQL = await initServerSql();
  const data = await readCurrentDatabaseBuffer();
  const db = new SQL.Database(new Uint8Array(data));
  try {
    db.run(`
      CREATE TABLE IF NOT EXISTS app_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);
    Object.entries(values).forEach(([key, value]) => {
      db.run(`
        INSERT INTO app_metadata (key, value)
        VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `, [key, value]);
    });
    const exported = Buffer.from(db.export());
    await writeCurrentDatabaseBuffer(exported);
  } finally {
    db.close();
  }

  const merged = { ...CUSTOMER_APP_SETTING_DEFAULTS, ...values };
  sendJson(res, 200, {
    ok: true,
    settings: {
      loginTitle: merged.customer_login_title,
      loginSubtitle: merged.customer_login_subtitle,
      termsText: merged.customer_terms_text,
      warrantyText: merged.customer_warranty_text,
      termsVersion: customerTermsVersion(merged),
    },
  });
}

function findPriceAuditProductInSqliteDb(db, input = {}) {
  const barcode = String(input.barcode || "").trim();
  const itemCode = String(input.itemCode || input.item_code || "").trim();
  if (!barcode && !itemCode) return { match_type: "not_found", product: null };

  const columns = sqliteColumns(db, "products");
  let row = null;
  if (barcode && columns.has("barcode")) {
    row = sqliteSingleRow(db, "SELECT sku, barcode, description, standard_cost, supplier FROM products WHERE barcode = ? LIMIT 1", [barcode]);
    if (row) return { match_type: "barcode_exact", product: normalizeSqlitePriceAuditProduct(row) };
  }
  if (itemCode && columns.has("sku")) {
    row = sqliteSingleRow(db, "SELECT sku, barcode, description, standard_cost, supplier FROM products WHERE sku = ? LIMIT 1", [itemCode]);
    if (row) return { match_type: "item_code", product: normalizeSqlitePriceAuditProduct(row) };
  }
  return { match_type: "not_found", product: null };
}

function sqliteColumns(db, table) {
  const columns = new Set();
  const stmt = db.prepare(`PRAGMA table_info(${table})`);
  try {
    while (stmt.step()) {
      const row = stmt.getAsObject();
      if (row.name) columns.add(String(row.name));
    }
  } finally {
    stmt.free();
  }
  return columns;
}

function sqliteSingleRow(db, sql, values) {
  const stmt = db.prepare(sql);
  try {
    stmt.bind(values);
    return stmt.step() ? stmt.getAsObject() : null;
  } finally {
    stmt.free();
  }
}

function normalizeSqlitePriceAuditProduct(row) {
  return {
    item_code: String(row.sku || "").trim(),
    barcode: String(row.barcode || "").trim(),
    product_name: String(row.description || "").trim(),
    standard_cost: numberValue(row.standard_cost),
    supplier_name: String(row.supplier || "").trim(),
  };
}

async function handlePostgresProducts(req, res) {
  if (!requirePostgres(res)) return;
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const query = (url.searchParams.get("q") || "").trim();
  const supplier = (url.searchParams.get("supplier") || "").trim();
  const category = (url.searchParams.get("category") || "").trim();
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 500), 1), 5000);
  const filters = [];
  if (query) filters.push(`or=(sku.ilike.*${encodeURIComponent(query)}*,description.ilike.*${encodeURIComponent(query)}*)`);
  if (supplier) filters.push(`supplier=eq.${encodeURIComponent(supplier)}`);
  if (category) filters.push(`category=eq.${encodeURIComponent(category)}`);
  const filterString = filters.length ? `&${filters.join("&")}` : "";
  let rows;
  try {
    rows = await postgresRows(`products?select=sku,description,category,supplier,standard_cost,purchase_price,sale_price,promo_price,promo_discount_percent,weight&order=description.asc&limit=${limit}${filterString}`);
  } catch (error) {
    if (!/promo_price|promo_discount_percent|schema cache|column/i.test(error.message || "")) throw error;
    rows = await postgresRows(`products?select=sku,description,category,supplier,standard_cost,purchase_price,sale_price,weight&order=description.asc&limit=${limit}${filterString}`);
  }
  sendJson(res, 200, { ok: true, source: "postgres", rows });
}

async function handlePostgresProductFilters(res) {
  if (!requirePostgres(res)) return;
  const [suppliers, categories] = await Promise.all([
    postgresRows("products?select=supplier&supplier=not.is.null&order=supplier.asc"),
    postgresRows("products?select=category&category=not.is.null&order=category.asc"),
  ]);
  sendJson(res, 200, {
    ok: true,
    source: "postgres",
    suppliers: uniqueValues(suppliers.map((row) => row.supplier)),
    categories: uniqueValues(categories.map((row) => row.category)),
  });
}

async function handlePostgresProductsImport(payload, res) {
  if (!requirePostgres(res)) return;
  await assertProductsImportSchema();
  const products = Array.isArray(payload.products) ? payload.products : [];
  const now = new Date().toISOString();
  const rows = [...new Map(products
    .map((product) => {
      const sku = String(product.sku || "").trim();
      const category = String(product.category || "").trim();
      const standardCost = numberValue(product.standard_cost);
      return {
        sku,
        barcode: String(product.barcode || "").trim(),
        image_url: String(product.image_url || "").trim(),
        description: String(product.description || "").trim(),
        family_description: category,
        category,
        standard_cost: standardCost,
        purchase_price: standardCost,
        sale_price: numberValue(product.base_price) || numberValue(product.sale_price),
        promo_price: numberValue(product.sale_price),
        promo_discount_percent: numberValue(product.promo_discount_percent),
        weight: numberValue(product.weight),
        supplier: String(product.supplier || "").trim(),
        pick_order: numberValue(product.pick_order) || 999999,
        units_per_carton: numberValue(product.units_per_carton) || 1,
        hidden: numberValue(product.hidden) ? 1 : 0,
        customer_recommended: numberValue(product.customer_recommended) ? 1 : 0,
        updated_at: now,
      };
    })
    .filter((row) => row.sku)
    .map((row) => [row.sku, row])).values()];

  if (rows.length) {
    const existingSettings = await existingPostgresProductSettings(rows.map((row) => row.sku));
    rows.forEach((row) => {
      const saved = existingSettings.get(String(row.sku || "")) || {};
      row.sale_price = numberValue(saved.promo_price) > 0 ? numberValue(saved.promo_price) : row.sale_price;
      row.promo_price = numberValue(saved.promo_price) > 0 ? numberValue(saved.promo_price) : row.promo_price;
      row.promo_discount_percent = numberValue(saved.promo_discount_percent) > 0 ? numberValue(saved.promo_discount_percent) : row.promo_discount_percent;
      row.hidden = numberValue(saved.hidden) ? 1 : row.hidden;
      row.customer_recommended = numberValue(saved.customer_recommended) ? 1 : row.customer_recommended;
    });
    await postgresRest("products?sku=not.is.null", {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    });
    try {
      for (let index = 0; index < rows.length; index += 500) {
        await postgresUpsert("products", rows.slice(index, index + 500), "sku");
      }
    } catch (error) {
      if (!/image_url|promo_price|promo_discount_percent|customer_recommended|hidden|schema cache|column/i.test(error.message || "")) throw error;
      const rowsWithoutImages = rows.map(({ image_url, promo_price, promo_discount_percent, customer_recommended, hidden, ...row }) => row);
      for (let index = 0; index < rowsWithoutImages.length; index += 500) {
        await postgresUpsert("products", rowsWithoutImages.slice(index, index + 500), "sku");
      }
    }
  }
  sendJson(res, 200, { ok: true, source: "postgres", imported: rows.length });
}

async function existingPostgresProductSettings(skus) {
  const settings = new Map();
  for (let index = 0; index < skus.length; index += 150) {
    const chunk = skus.slice(index, index + 150).map((sku) => `"${String(sku).replaceAll('"', '\\"')}"`).join(",");
    try {
      const rows = await postgresRows(`products?select=sku,promo_price,promo_discount_percent,customer_recommended,hidden&sku=in.(${chunk})&limit=1000`);
      rows.forEach((row) => settings.set(String(row.sku), row));
    } catch (error) {
      if (!/customer_recommended|hidden|schema cache|column/i.test(error.message || "")) throw error;
      const rows = await postgresRows(`products?select=sku,promo_price,promo_discount_percent&sku=in.(${chunk})&limit=1000`);
      rows.forEach((row) => settings.set(String(row.sku), row));
    }
  }
  return settings;
}

async function assertProductsImportSchema() {
  try {
    await postgresRows("products?select=sku,barcode&limit=1");
  } catch (error) {
    if (/barcode/i.test(error.message || "")) {
      error.status = 400;
      error.message = "בסופאבייס חסרה עמודת barcode בטבלת products. יש להריץ שוב את outputs/sales-analytics/supabase/schema.sql ואז לייבא מחדש את קובץ המוצרים.";
    }
    throw error;
  }
}

async function handlePostgresCalls(req, res) {
  if (!requirePostgres(res)) return;
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const day = (url.searchParams.get("day") || "").trim();
  const callDate = (url.searchParams.get("call_date") || "").trim();
  if (!day || !callDate) {
    sendJson(res, 400, { ok: false, error: "day and call_date are required" });
    return;
  }

  const encodedDay = encodeURIComponent(day);
  const [profiles, calls] = await Promise.all([
    postgresRows(`customer_call_profiles?select=customer_no,customer_name,phone,address,call_days,source&source=eq.calls&call_days=ilike.*${encodedDay}*&order=customer_name.asc&limit=1000`),
    postgresRows(`customer_calls?select=id,call_date,customer_no,customer_name,status,call_again_time,whatsapp_sent_at,manual_order_id,notes,updated_at&call_date=eq.${encodeURIComponent(callDate)}&limit=2000`),
  ]);
  const callByCustomer = new Map(calls.map((row) => [String(row.customer_no), row]));
  const priority = { pending: 1, call_again: 2, no_answer: 3, no_need: 4, ordered: 5 };
  const rows = profiles.map((profile) => {
    const call = callByCustomer.get(String(profile.customer_no)) || {};
    const status = call.status || "pending";
    return {
      customer_no: profile.customer_no,
      customer_name: profile.customer_name || call.customer_name || "",
      contact: "",
      phone: profile.phone || "",
      phone2: "",
      city: "",
      address: profile.address || "",
      days: profile.call_days || "",
      status,
      call_again_time: call.call_again_time || "",
      whatsapp_sent_at: call.whatsapp_sent_at || "",
      manual_order_id: call.manual_order_id || null,
      notes: call.notes || "",
      updated_at: call.updated_at || "",
    };
  }).sort((a, b) => {
    const statusCompare = (priority[a.status] || 6) - (priority[b.status] || 6);
    if (statusCompare) return statusCompare;
    return String(a.customer_name || "").localeCompare(String(b.customer_name || ""), "he");
  });
  sendJson(res, 200, { ok: true, source: "postgres", rows });
}

async function handlePostgresCallStatus(payload, res) {
  if (!requirePostgres(res)) return;
  const now = new Date().toISOString();
  const row = {
    call_date: String(payload.call_date || ""),
    customer_no: String(payload.customer_no || ""),
    customer_name: String(payload.customer_name || ""),
    status: String(payload.status || "pending"),
    call_again_time: payload.call_again_time || null,
    whatsapp_sent_at: payload.whatsapp_sent_at || null,
    manual_order_id: payload.manual_order_id || null,
    notes: payload.notes || "",
    updated_at: now,
  };
  if (!row.call_date || !row.customer_no) {
    sendJson(res, 400, { ok: false, error: "call_date and customer_no are required" });
    return;
  }
  const response = await postgresRest("customer_calls?on_conflict=call_date,customer_no", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify(row),
  });
  const rows = await response.json();
  sendJson(res, 200, { ok: true, source: "postgres", row: rows[0] || row });
}

async function handlePostgresCallsReset(payload, res) {
  if (!requirePostgres(res)) return;
  const dates = [...new Set((Array.isArray(payload.call_dates) ? payload.call_dates : [])
    .map((date) => String(date || "").trim())
    .filter(Boolean))];
  if (!dates.length) {
    sendJson(res, 400, { ok: false, error: "call_dates are required" });
    return;
  }

  for (const date of dates) {
    await postgresRest(`customer_calls?call_date=eq.${encodeURIComponent(date)}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    });
  }

  sendJson(res, 200, { ok: true, source: "postgres", reset_dates: dates });
}

async function handlePostgresCallProfile(payload, res) {
  if (!requirePostgres(res)) return;
  const customerNo = String(payload.customer_no || "");
  if (!customerNo) {
    sendJson(res, 400, { ok: false, error: "customer_no is required" });
    return;
  }
  const row = {
    phone: payload.phone || "",
    address: payload.address || "",
    call_days: payload.call_days || "",
    source: "calls",
    updated_at: new Date().toISOString(),
  };
  await postgresRest(`customer_call_profiles?customer_no=eq.${encodeURIComponent(customerNo)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(row),
  });
  sendJson(res, 200, { ok: true, source: "postgres" });
}

async function handlePostgresCallProfilesImport(payload, res) {
  if (!requirePostgres(res)) return;
  const profiles = Array.isArray(payload.profiles) ? payload.profiles : [];
  const now = new Date().toISOString();
  const rows = profiles
    .map((profile) => {
      const customerNo = String(profile.customer_no || "").trim();
      const customerName = String(profile.customer_name || "").trim() || customerNo;
      const phone = String(profile.phone || profile.phone2 || "").trim();
      const addressParts = [
        String(profile.address || "").trim(),
        String(profile.city || "").trim(),
      ].filter(Boolean);
      return {
        customer_no: customerNo,
        customer_name: customerName,
        phone,
        address: [...new Set(addressParts)].join(", "),
        company_id: String(profile.company_id || "").trim(),
        terms_accepted_at: profile.terms_accepted_at || null,
        terms_version_accepted: profile.terms_version_accepted || null,
        customer_type: String(profile.customer_type || "existing").trim() || "existing",
        call_days: String(profile.call_days || profile.days || "").trim(),
        source: "calls",
        updated_at: now,
      };
    })
    .filter((row) => row.customer_no && row.customer_name);

  if (rows.length) {
    const customerNos = rows.map((row) => row.customer_no).filter(Boolean);
    const existingByCustomer = new Map();
    for (let index = 0; index < customerNos.length; index += 150) {
      const chunk = customerNos.slice(index, index + 150).map((customerNo) => `"${String(customerNo).replaceAll('"', '\\"')}"`).join(",");
      try {
        const existingRows = await postgresRows(`customer_call_profiles?select=customer_no,terms_accepted_at,terms_version_accepted,customer_type&customer_no=in.(${chunk})&limit=1000`);
        existingRows.forEach((row) => existingByCustomer.set(String(row.customer_no), row));
      } catch (error) {
        if (!/terms_accepted_at|terms_version_accepted|customer_type|schema cache|column/i.test(error.message || "")) throw error;
      }
    }
    rows.forEach((row) => {
      const existing = existingByCustomer.get(String(row.customer_no)) || {};
      if (!row.terms_accepted_at && existing.terms_accepted_at) row.terms_accepted_at = existing.terms_accepted_at;
      if (!row.terms_version_accepted && existing.terms_version_accepted) row.terms_version_accepted = existing.terms_version_accepted;
      if ((row.customer_type === "existing" || !row.customer_type) && existing.customer_type) row.customer_type = existing.customer_type;
    });
    for (let index = 0; index < customerNos.length; index += 150) {
      const chunk = customerNos.slice(index, index + 150).map((customerNo) => `"${String(customerNo).replaceAll('"', '\\"')}"`).join(",");
      await postgresRest(`customer_call_profiles?customer_no=in.(${chunk})`, {
        method: "DELETE",
        headers: { Prefer: "return=minimal" },
      });
    }
    await postgresRest("customer_call_profiles?source=eq.calls", {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    });
    try {
      await postgresUpsert("customer_call_profiles", rows, "customer_no");
    } catch (error) {
      if (!/company_id|terms_accepted_at|terms_version_accepted|customer_type|schema cache|column/i.test(error.message || "")) throw error;
      await postgresUpsert("customer_call_profiles", rows.map(({ company_id, terms_accepted_at, terms_version_accepted, customer_type, ...row }) => row), "customer_no");
    }
  }
  sendJson(res, 200, { ok: true, source: "postgres", imported: rows.length });
}

async function handlePostgresOrderHistory(req, res) {
  if (!requirePostgres(res)) return;
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const query = (url.searchParams.get("q") || "").trim().toLowerCase();
  const allOrders = await postgresRows("customer_orders?select=id,order_date,customer_no,customer_name,status,notes,estimated_total,estimated_profit,picked_by,picked_at,invoice_printed,shipped_at,process_hidden,client_order_key,updated_at&order=id.desc&limit=1000");
  const relevantStatuses = new Set(["מוכן לאיסוף", "picked", "מוכן למשלוח", "נשלחה"]);
  const orders = allOrders
    .filter((row) => relevantStatuses.has(String(row.status || "")))
    .filter((row) => !query
      || String(row.customer_name || "").toLowerCase().includes(query)
      || String(row.customer_no || "").toLowerCase().includes(query)
      || String(row.id || "").includes(query))
    .slice(0, 500);
  const orderIds = orders.map((row) => Number(row.id)).filter(Boolean);
  const items = orderIds.length
    ? await postgresRows(`customer_order_items?select=id,order_id,sku,product_desc,quantity,picked_quantity,note,item_status,substitute_product_id,action_sequence,entry_sequence,is_carton,units_per_carton,shortage_dismissed,estimated_price,estimated_profit&order_id=in.(${orderIds.join(",")})&order=order_id.desc,id.asc&limit=5000`)
    : [];
  sendJson(res, 200, { ok: true, source: "postgres", counts: { all: allOrders.length, visible: orders.length }, orders, items });
}

async function handlePostgresOrderPatch(payload, res) {
  const orderId = Number(payload.order_id || payload.id || 0);
  if (!orderId) {
    sendJson(res, 400, { ok: false, error: "order_id is required" });
    return;
  }
  const allowed = new Set(["status", "invoice_printed", "shipped_at", "process_hidden", "picked_by", "picked_at", "updated_at"]);
  const row = {};
  Object.entries(payload.values || {}).forEach(([key, value]) => {
    if (!allowed.has(key)) return;
    if (key === "invoice_printed" || key === "process_hidden") {
      row[key] = value === true || value === 1 || value === "1" ? 1 : 0;
      return;
    }
    row[key] = value;
  });
  row.updated_at = row.updated_at || new Date().toISOString();
  let postgresResult = { ok: true, skipped: true };
  if (usePostgresPreview) {
    await postgresPatch("customer_orders", `id=eq.${encodeURIComponent(orderId)}`, row);
    postgresResult = { ok: true, skipped: false };
  }
  const sqliteResult = await patchSqliteOrder(orderId, row);
  sendJson(res, 200, { ok: true, source: "sqlite+postgres", sqlite: sqliteResult, postgres: postgresResult });
}

async function patchSqliteOrder(orderId, values) {
  const keys = Object.keys(values || {});
  if (!keys.length) return { ok: true, skipped: true };
  const SQL = await initServerSql();
  const data = await readCurrentDatabaseBuffer();
  const db = new SQL.Database(new Uint8Array(data));
  try {
    ensureServerColumn(db, "customer_orders", "invoice_printed", "INTEGER NOT NULL DEFAULT 0");
    ensureServerColumn(db, "customer_orders", "shipped_at", "TEXT");
    ensureServerColumn(db, "customer_orders", "process_hidden", "INTEGER NOT NULL DEFAULT 0");
    ensureServerColumn(db, "customer_orders", "picked_by", "TEXT");
    ensureServerColumn(db, "customer_orders", "picked_at", "TEXT");
    ensureServerColumn(db, "customer_orders", "updated_at", "TEXT");
    const assignments = keys.map((key) => `${key} = ?`).join(", ");
    db.run(`UPDATE customer_orders SET ${assignments} WHERE id = ?`, [...keys.map((key) => values[key]), orderId]);
    const exported = Buffer.from(db.export());
    await writeCurrentDatabaseBuffer(exported);
    return { ok: true, updated: db.getRowsModified ? db.getRowsModified() : 1 };
  } finally {
    db.close();
  }
}

function uniqueValues(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "he"));
}

async function readDatabaseFromSupabase() {
  const now = Date.now();
  if (databaseBufferCache && now - databaseBufferCacheLoadedAt < dbCacheTtlMs) {
    return Buffer.from(databaseBufferCache);
  }
  const response = await fetch(supabaseObjectUrl(), {
    headers: supabaseHeaders(),
  });

  if (!response.ok) {
    const error = new Error(`supabase read failed: ${response.status}`);
    error.status = response.status;
    throw error;
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  updateDatabaseBufferCache(buffer);
  return Buffer.from(buffer);
}

async function writeDatabaseToSupabase(body) {
  const response = await fetch(supabaseObjectUrl(), {
    method: "POST",
    headers: supabaseHeaders({
      "Content-Type": "application/octet-stream",
      "x-upsert": "true",
    }),
    body,
  });

  if (!response.ok) {
    throw new Error(`supabase write failed: ${response.status} ${await response.text()}`);
  }
  updateDatabaseBufferCache(body);
}

function updateDatabaseBufferCache(body) {
  databaseBufferCache = Buffer.from(body);
  databaseBufferCacheLoadedAt = Date.now();
}

function initServerSql() {
  if (!SQLRuntimePromise) {
    const initSqlJs = require("sql.js");
    SQLRuntimePromise = initSqlJs({
      locateFile: (file) => path.join(root, "node_modules", "sql.js", "dist", file),
    });
  }
  return SQLRuntimePromise;
}

async function readCurrentDatabaseBuffer() {
  if (useSupabase) return readDatabaseFromSupabase();
  if (databaseBufferCache && Date.now() - databaseBufferCacheLoadedAt < dbCacheTtlMs) {
    return Buffer.from(databaseBufferCache);
  }
  const buffer = await fs.promises.readFile(dbPath);
  updateDatabaseBufferCache(buffer);
  return Buffer.from(buffer);
}

async function writeCurrentDatabaseBuffer(body) {
  if (useSupabase) return writeDatabaseToSupabase(body);
  await fs.promises.writeFile(`${dbPath}.tmp`, body);
  await fs.promises.rename(`${dbPath}.tmp`, dbPath);
  updateDatabaseBufferCache(body);
}

function enqueueDbMutation(task) {
  const run = dbMutationQueue.then(task, task);
  dbMutationQueue = run.catch(() => {});
  return run;
}

async function handleDatabaseGet(res) {
  try {
    const data = await readCurrentDatabaseBuffer();
    send(res, 200, data, {
      "Content-Type": "application/octet-stream",
      "Cache-Control": "no-store",
    });
  } catch (error) {
    send(res, error.status === 404 ? 404 : 500, error.status === 404 ? "" : "database read failed");
  }
}

function writeDatabaseToDisk(body, callback) {
  const tempPath = `${dbPath}.tmp`;
  fs.writeFile(tempPath, body, (writeError) => {
    if (writeError) {
      callback(writeError);
      return;
    }
    fs.rename(tempPath, dbPath, callback);
  });
}

function handleDatabasePost(req, res) {
  const chunks = [];
  let size = 0;

  req.on("data", (chunk) => {
    size += chunk.length;
    if (size > maxDbBytes) {
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });

  req.on("end", () => {
    const body = Buffer.concat(chunks);
    if (!body.subarray(0, 16).toString("utf8").startsWith("SQLite format 3")) {
      send(res, 400, "invalid sqlite database");
      return;
    }

    if (useSupabase) {
      enqueueDbMutation(() => writeDatabaseToSupabase(body))
        .then(() => send(res, 204))
        .catch((error) => {
          console.error(error);
          send(res, 500, error.message || "save failed");
        });
      return;
    }

    enqueueDbMutation(() => writeCurrentDatabaseBuffer(body))
      .then(() => send(res, 204))
      .catch((error) => {
        console.error(error);
        send(res, 500, "save failed");
      });
  });

  req.on("error", () => send(res, 500, "request failed"));
}

function handleJsonPost(req, res, callback) {
  const chunks = [];
  let size = 0;

  req.on("data", (chunk) => {
    size += chunk.length;
    if (size > 10 * 1024 * 1024) {
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });

  req.on("end", () => {
    let payload;
    try {
      payload = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    } catch {
      sendJson(res, 400, { ok: false, error: "invalid json" });
      return;
    }
    callback(payload).catch((error) => {
      console.error(error);
      sendJson(res, error.status || 500, { ok: false, error: error.message || "save failed" });
    });
  });

  req.on("error", () => sendJson(res, 500, { ok: false, error: "request failed" }));
}

async function handlePickingChanges(payload, res) {
  const changes = Array.isArray(payload.changes) ? payload.changes : [];
  if (!changes.length) {
    sendJson(res, 200, { ok: true, applied: 0 });
    return;
  }

  const SQL = await initServerSql();
  const data = await readCurrentDatabaseBuffer();
  const db = new SQL.Database(new Uint8Array(data));
  const now = new Date().toISOString();

  try {
    db.run("BEGIN TRANSACTION");
    changes.forEach((change) => {
      const type = String(change.type || "");
      if (type === "itemQuantity") {
        db.run("UPDATE customer_order_items SET picked_quantity = ? WHERE id = ?", [numberValue(change.pickedQuantity), numberValue(change.itemId)]);
      }
      if (type === "itemSubstitute") {
        db.run("UPDATE customer_order_items SET substitute_product_id = ?, picked_quantity = ? WHERE id = ?", [
          String(change.substituteProductId || ""),
          numberValue(change.pickedQuantity),
          numberValue(change.itemId),
        ]);
      }
      if (type === "itemAdd") {
        const item = change.item || {};
        db.run(`
          INSERT OR REPLACE INTO customer_order_items (id, order_id, sku, product_desc, quantity, picked_quantity, note, item_status, substitute_product_id, action_sequence, entry_sequence, is_carton, units_per_carton, shortage_dismissed, estimated_price, estimated_profit)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          numberValue(item.id),
          numberValue(item.order_id),
          String(item.sku || ""),
          String(item.product_desc || ""),
          numberValue(item.quantity),
          numberValue(item.picked_quantity),
          String(item.note || ""),
          String(item.item_status || "pending"),
          item.substitute_product_id || null,
          item.action_sequence === null || item.action_sequence === undefined ? null : numberValue(item.action_sequence),
          item.entry_sequence === null || item.entry_sequence === undefined ? null : numberValue(item.entry_sequence),
          numberValue(item.is_carton) ? 1 : 0,
          numberValue(item.units_per_carton) || 1,
          numberValue(item.shortage_dismissed) ? 1 : 0,
          numberValue(item.estimated_price),
          numberValue(item.estimated_profit),
        ]);
      }
      if (type === "itemStatus") {
        db.run(`
          UPDATE customer_order_items
          SET item_status = ?, picked_quantity = ?, action_sequence = ?
          WHERE id = ?
        `, [String(change.itemStatus || "pending"), numberValue(change.pickedQuantity), numberValue(change.actionSequence), numberValue(change.itemId)]);
      }
      if (type === "itemPending") {
        db.run(`
          UPDATE customer_order_items
          SET item_status = 'pending', picked_quantity = ?, action_sequence = NULL, shortage_dismissed = 0
          WHERE id = ?
        `, [numberValue(change.pickedQuantity), numberValue(change.itemId)]);
      }
      if (type === "productUnits") {
        db.run("UPDATE customer_order_items SET units_per_carton = ? WHERE id = ?", [numberValue(change.unitsPerCarton) || 1, numberValue(change.itemId)]);
        if (change.sku) {
          db.run("UPDATE products SET units_per_carton = ?, updated_at = ? WHERE sku = ?", [numberValue(change.unitsPerCarton) || 1, now, String(change.sku)]);
        }
      }
      if (type === "completeOrder") {
        db.run("UPDATE customer_orders SET status = 'picked', picked_by = ?, picked_at = ?, updated_at = ? WHERE id = ?", [
          String(change.pickedBy || "מלקט"),
          String(change.pickedAt || now),
          String(change.updatedAt || now),
          numberValue(change.orderId),
        ]);
      }
    });
    db.run("COMMIT");
    const exported = Buffer.from(db.export());
    await writeCurrentDatabaseBuffer(exported);
    const postgresResult = await mirrorPickingChangesToPostgres(changes);
    sendJson(res, 200, { ok: true, applied: changes.length, postgres: postgresResult });
  } catch (error) {
    try {
      db.run("ROLLBACK");
    } catch {}
    throw error;
  } finally {
    db.close();
  }
}

function ensureServerColumn(db, table, column, definition) {
  const result = db.exec(`PRAGMA table_info(${table})`);
  const columns = result[0]?.values?.map((row) => row[1]) || [];
  if (!columns.includes(column)) db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function ensureServerCustomerPortalSchema(db) {
  db.run(`
    CREATE TABLE IF NOT EXISTS customer_call_profiles (
      customer_no TEXT PRIMARY KEY,
      customer_name TEXT,
      contact TEXT,
      phone TEXT,
      phone2 TEXT,
      city TEXT,
      address TEXT,
      company_id TEXT,
      terms_accepted_at TEXT,
      terms_version_accepted TEXT,
      customer_type TEXT DEFAULT 'existing',
      days TEXT,
      source TEXT DEFAULT 'calls',
      updated_at TEXT
    );
  `);
}

function sqliteRows(db, sql, params = []) {
  const result = db.exec(sql, params);
  if (!result.length) return [];
  const columns = result[0].columns;
  return result[0].values.map((values) => Object.fromEntries(columns.map((column, index) => [column, values[index]])));
}

async function postgresUpsert(table, rows, conflictKey) {
  if (!usePostgresPreview || !rows.length) return { ok: true, skipped: true };
  const conflict = conflictKey ? conflictKey.split(",").map((key) => encodeURIComponent(key.trim())).join(",") : "";
  await postgresRest(`${table}${conflict ? `?on_conflict=${conflict}` : ""}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(rows),
  });
  return { ok: true, rows: rows.length };
}

async function postgresPatch(table, filter, row) {
  if (!usePostgresPreview) return { ok: true, skipped: true };
  await postgresRest(`${table}?${filter}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(row),
  });
  return { ok: true };
}

function normalizePostgresOrder(row) {
  return {
    id: numberValue(row.id),
    order_date: row.order_date || null,
    customer_no: String(row.customer_no || ""),
    customer_name: String(row.customer_name || ""),
    status: String(row.status || ""),
    notes: row.notes || "",
    estimated_total: numberValue(row.estimated_total),
    estimated_profit: numberValue(row.estimated_profit),
    picked_by: row.picked_by || null,
    picked_at: row.picked_at || null,
    invoice_printed: Boolean(numberValue(row.invoice_printed)),
    shipped_at: row.shipped_at || null,
    process_hidden: Boolean(numberValue(row.process_hidden)),
    client_order_key: row.client_order_key || null,
    updated_at: row.updated_at || new Date().toISOString(),
  };
}

function normalizePostgresOrderItem(row) {
  return {
    id: numberValue(row.id),
    order_id: numberValue(row.order_id),
    sku: String(row.sku || ""),
    product_desc: String(row.product_desc || ""),
    quantity: numberValue(row.quantity),
    picked_quantity: numberValue(row.picked_quantity),
    note: row.note || "",
    item_status: row.item_status || "pending",
    substitute_product_id: row.substitute_product_id || null,
    action_sequence: row.action_sequence === null || row.action_sequence === undefined ? null : numberValue(row.action_sequence),
    entry_sequence: numberValue(row.entry_sequence),
    is_carton: Boolean(numberValue(row.is_carton)),
    units_per_carton: numberValue(row.units_per_carton) || 1,
    shortage_dismissed: Boolean(numberValue(row.shortage_dismissed)),
    estimated_price: numberValue(row.estimated_price),
    estimated_profit: numberValue(row.estimated_profit),
  };
}

async function mirrorOrderToPostgres(orderRow, itemRows, callRow = null) {
  if (!usePostgresPreview || !orderRow?.id) return { ok: true, skipped: true };
  try {
    await postgresUpsert("customer_orders", [normalizePostgresOrder(orderRow)], "id");
    await postgresUpsert("customer_order_items", itemRows.map(normalizePostgresOrderItem), "id");
    if (callRow) await postgresUpsert("customer_calls", [callRow], "call_date,customer_no");
    return { ok: true, orderId: numberValue(orderRow.id), items: itemRows.length };
  } catch (error) {
    console.error("postgres order mirror failed", error);
    return { ok: false, error: error.message || "postgres order mirror failed" };
  }
}

async function mirrorPickingChangesToPostgres(changes) {
  if (!usePostgresPreview) return { ok: true, skipped: true };
  try {
    for (const change of changes) {
      const type = String(change.type || "");
      if (type === "itemQuantity") {
        await postgresPatch("customer_order_items", `id=eq.${encodeURIComponent(numberValue(change.itemId))}`, {
          picked_quantity: numberValue(change.pickedQuantity),
        });
      }
      if (type === "itemSubstitute") {
        await postgresPatch("customer_order_items", `id=eq.${encodeURIComponent(numberValue(change.itemId))}`, {
          substitute_product_id: String(change.substituteProductId || ""),
          picked_quantity: numberValue(change.pickedQuantity),
        });
      }
      if (type === "itemAdd") {
        const item = change.item || {};
        await postgresUpsert("customer_order_items", [normalizePostgresOrderItem(item)], "id");
      }
      if (type === "itemStatus") {
        await postgresPatch("customer_order_items", `id=eq.${encodeURIComponent(numberValue(change.itemId))}`, {
          item_status: String(change.itemStatus || "pending"),
          picked_quantity: numberValue(change.pickedQuantity),
          action_sequence: numberValue(change.actionSequence),
        });
      }
      if (type === "itemPending") {
        await postgresPatch("customer_order_items", `id=eq.${encodeURIComponent(numberValue(change.itemId))}`, {
          item_status: "pending",
          picked_quantity: numberValue(change.pickedQuantity),
          action_sequence: null,
          shortage_dismissed: false,
        });
      }
      if (type === "productUnits") {
        await postgresPatch("customer_order_items", `id=eq.${encodeURIComponent(numberValue(change.itemId))}`, {
          units_per_carton: numberValue(change.unitsPerCarton) || 1,
        });
        if (change.sku) {
          await postgresPatch("products", `sku=eq.${encodeURIComponent(String(change.sku))}`, {
            units_per_carton: numberValue(change.unitsPerCarton) || 1,
            updated_at: new Date().toISOString(),
          });
        }
      }
      if (type === "completeOrder") {
        await postgresPatch("customer_orders", `id=eq.${encodeURIComponent(numberValue(change.orderId))}`, {
          status: "picked",
          picked_by: String(change.pickedBy || "מלקט"),
          picked_at: String(change.pickedAt || new Date().toISOString()),
          updated_at: String(change.updatedAt || new Date().toISOString()),
        });
      }
    }
    return { ok: true, applied: changes.length };
  } catch (error) {
    console.error("postgres picking mirror failed", error);
    return { ok: false, error: error.message || "postgres picking mirror failed" };
  }
}

async function handleOrderDelta(payload, res) {
  const order = payload && typeof payload.order === "object" ? payload.order : null;
  const items = Array.isArray(payload?.items) ? payload.items : [];
  if (!order) {
    sendJson(res, 400, { ok: false, error: "missing order" });
    return;
  }

  const SQL = await initServerSql();
  const data = await readCurrentDatabaseBuffer();
  const db = new SQL.Database(new Uint8Array(data));
  const now = new Date().toISOString();
  const clientOrderKey = String(order.client_order_key || "");

  try {
    ensureServerColumn(db, "customer_orders", "client_order_key", "TEXT");
    db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_client_key ON customer_orders (client_order_key)");
    db.run("BEGIN TRANSACTION");

    let orderId = 0;
    if (clientOrderKey) {
      const existing = db.exec("SELECT id FROM customer_orders WHERE client_order_key = ? LIMIT 1", [clientOrderKey]);
      orderId = Number(existing[0]?.values?.[0]?.[0] || 0);
    }

    if (!orderId) {
      db.run(`
        INSERT INTO customer_orders (order_date, customer_no, customer_name, status, notes, estimated_total, estimated_profit, updated_at, client_order_key)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        String(order.order_date || ""),
        String(order.customer_no || ""),
        String(order.customer_name || ""),
        String(order.status || "מוכן לאיסוף"),
        String(order.notes || ""),
        numberValue(order.estimated_total),
        numberValue(order.estimated_profit),
        String(order.updated_at || now),
        clientOrderKey || null,
      ]);
      orderId = Number(db.exec("SELECT last_insert_rowid()")[0]?.values?.[0]?.[0] || 0);

      items.forEach((item) => {
        db.run(`
          INSERT INTO customer_order_items (order_id, sku, product_desc, quantity, picked_quantity, note, item_status, entry_sequence, is_carton, units_per_carton, estimated_price, estimated_profit)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          orderId,
          String(item.sku || ""),
          String(item.product_desc || ""),
          numberValue(item.quantity),
          numberValue(item.picked_quantity),
          String(item.note || ""),
          String(item.item_status || "pending"),
          numberValue(item.entry_sequence),
          numberValue(item.is_carton) ? 1 : 0,
          numberValue(item.units_per_carton) || 1,
          numberValue(item.estimated_price),
          numberValue(item.estimated_profit),
        ]);
      });
    }

    if (payload.call) {
      const call = payload.call;
      db.run("DELETE FROM customer_calls WHERE customer_no = ? AND call_date = ?", [String(call.customer_no || order.customer_no || ""), String(call.call_date || "")]);
      db.run(`
        INSERT INTO customer_calls (call_date, customer_no, customer_name, status, call_again_time, whatsapp_sent_at, manual_order_id, notes, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        String(call.call_date || ""),
        String(call.customer_no || order.customer_no || ""),
        String(call.customer_name || order.customer_name || ""),
        String(call.status || "ordered"),
        call.call_again_time || null,
        call.whatsapp_sent_at || null,
        numberValue(call.manual_order_id) || orderId || null,
        String(call.notes || ""),
        String(call.updated_at || now),
      ]);
    }

    db.run("COMMIT");
    const savedOrderRows = sqliteRows(db, "SELECT * FROM customer_orders WHERE id = ?", [orderId]);
    const savedItemRows = sqliteRows(db, "SELECT * FROM customer_order_items WHERE order_id = ? ORDER BY id", [orderId]);
    const exported = Buffer.from(db.export());
    await writeCurrentDatabaseBuffer(exported);
    let postgresCall = null;
    if (payload.call) {
      const call = payload.call;
      postgresCall = {
        call_date: String(call.call_date || ""),
        customer_no: String(call.customer_no || order.customer_no || ""),
        customer_name: String(call.customer_name || order.customer_name || ""),
        status: String(call.status || "ordered"),
        call_again_time: call.call_again_time || null,
        whatsapp_sent_at: call.whatsapp_sent_at || null,
        manual_order_id: numberValue(call.manual_order_id) || orderId || null,
        notes: String(call.notes || ""),
        updated_at: String(call.updated_at || now),
      };
    }
    const postgresResult = await mirrorOrderToPostgres(savedOrderRows[0], savedItemRows, postgresCall);
    sendJson(res, 200, { ok: true, orderId, applied: 1, postgres: postgresResult });
  } catch (error) {
    try {
      db.run("ROLLBACK");
    } catch {}
    throw error;
  } finally {
    db.close();
  }
}

function numberValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dbFlag(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0 || value === null || value === undefined) return false;
  const normalized = String(value).trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function customerTokenSignature(payload) {
  return crypto.createHmac("sha256", customerSessionSecret).update(payload).digest("base64url");
}

function createCustomerToken(customerNo) {
  const payload = Buffer.from(JSON.stringify({
    customer_no: String(customerNo || ""),
    issued_at: Date.now(),
  })).toString("base64url");
  return `${payload}.${customerTokenSignature(payload)}`;
}

function verifyCustomerToken(req) {
  const header = String(req.headers.authorization || "");
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const [payload, signature] = token.split(".");
  if (!payload || !signature || customerTokenSignature(payload) !== signature) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!parsed.customer_no) return null;
    if (Date.now() - Number(parsed.issued_at || 0) > 1000 * 60 * 60 * 24 * 14) return null;
    return { customer_no: String(parsed.customer_no) };
  } catch {
    return null;
  }
}

function normalizeLoginValue(value) {
  return String(value || "").replace(/[^\dA-Za-zא-ת]/g, "").trim();
}

function currentDateIso() {
  return new Date().toISOString().slice(0, 10);
}

function columnsFor(db, table) {
  return new Set(sqliteRows(db, `PRAGMA table_info(${table})`).map((row) => String(row.name || "")));
}

function tableExists(db, table) {
  return sqliteRows(db, "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1", [table]).length > 0;
}

async function withCurrentDatabase(callback) {
  const SQL = await initServerSql();
  const data = await readCurrentDatabaseBuffer();
  const db = new SQL.Database(new Uint8Array(data));
  try {
    return await callback(db);
  } finally {
    db.close();
  }
}

async function findCustomerProfile(customerNo) {
  return withCurrentDatabase((db) => {
    ensureServerCustomerPortalSchema(db);
    ensureServerColumn(db, "customer_call_profiles", "company_id", "TEXT");
    ensureServerColumn(db, "customer_call_profiles", "terms_accepted_at", "TEXT");
    ensureServerColumn(db, "customer_call_profiles", "terms_version_accepted", "TEXT");
    ensureServerColumn(db, "customer_call_profiles", "customer_type", "TEXT DEFAULT 'existing'");
    const rows = sqliteRows(db, `
      SELECT customer_no, customer_name, phone, phone2, address, company_id, terms_accepted_at, terms_version_accepted, customer_type
      FROM customer_call_profiles
      WHERE customer_no = ? AND COALESCE(source, 'calls') IN ('calls', 'customer_portal')
      LIMIT 1
    `, [String(customerNo || "").trim()]);
    return rows[0] || null;
  });
}

function normalizeCustomerProfile(profile) {
  return {
    customer_no: String(profile.customer_no || ""),
    customer_name: String(profile.customer_name || ""),
    address: String(profile.address || ""),
    phone: String(profile.phone || profile.phone2 || ""),
    customer_type: String(profile.customer_type || "existing"),
    terms_accepted_at: profile.terms_accepted_at || "",
    terms_version_accepted: profile.terms_version_accepted || "",
  };
}

function shouldRequireTermsAcceptance(profile, termsVersion = "") {
  const acceptedAt = Date.parse(profile?.terms_accepted_at || "");
  if (!acceptedAt) return true;
  if (Date.now() - acceptedAt > 1000 * 60 * 60 * 24 * 30) return true;
  const acceptedVersion = String(profile?.terms_version_accepted || "").trim();
  return Boolean(termsVersion && acceptedVersion && acceptedVersion !== termsVersion);
}

async function handleCustomerLogin(payload, res) {
  const customerNo = String(payload?.customerNo || payload?.customer_no || "").trim();
  const companyId = String(payload?.companyId || payload?.company_id || "").trim();
  if (!customerNo || !companyId) {
    sendJson(res, 400, { ok: false, error: "missing credentials" });
    return;
  }

  const profile = await findCustomerProfile(customerNo);
  if (!profile || !normalizeLoginValue(profile.company_id) || normalizeLoginValue(profile.company_id) !== normalizeLoginValue(companyId)) {
    sendJson(res, 401, { ok: false, error: "unauthorized" });
    return;
  }

  const termsVersion = await getCustomerTermsVersion();
  sendJson(res, 200, {
    ok: true,
    token: createCustomerToken(profile.customer_no),
    requires_terms: shouldRequireTermsAcceptance(profile, termsVersion),
    customer: normalizeCustomerProfile(profile),
  });
}

async function handleCustomerRegister(payload, res) {
  const customerName = String(payload?.customerName || payload?.customer_name || "").trim();
  const companyId = String(payload?.companyId || payload?.company_id || "").trim();
  const phone = String(payload?.phone || "").trim();
  const address = String(payload?.address || "").trim();
  const termsAccepted = payload?.termsAccepted === true || payload?.terms_accepted === true;
  if (!customerName || !companyId || !phone || !termsAccepted) {
    sendJson(res, 400, { ok: false, error: "missing registration fields" });
    return;
  }

  const now = new Date().toISOString();
  const termsVersion = await getCustomerTermsVersion();
  const customerNo = `NEW-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
  const profile = {
    customer_no: customerNo,
    customer_name: customerName,
    phone,
    phone2: "",
    city: "",
    address,
    company_id: companyId,
    days: "",
    call_days: "",
    source: "customer_portal",
    customer_type: "new",
    terms_accepted_at: now,
    terms_version_accepted: termsVersion,
    updated_at: now,
  };

  const SQL = await initServerSql();
  const data = await readCurrentDatabaseBuffer();
  const db = new SQL.Database(new Uint8Array(data));
  try {
    ensureServerCustomerPortalSchema(db);
    ensureServerColumn(db, "customer_call_profiles", "company_id", "TEXT");
    ensureServerColumn(db, "customer_call_profiles", "terms_accepted_at", "TEXT");
    ensureServerColumn(db, "customer_call_profiles", "terms_version_accepted", "TEXT");
    ensureServerColumn(db, "customer_call_profiles", "customer_type", "TEXT DEFAULT 'existing'");
    ensureServerColumn(db, "customer_call_profiles", "phone2", "TEXT");
    ensureServerColumn(db, "customer_call_profiles", "city", "TEXT");
    ensureServerColumn(db, "customer_call_profiles", "days", "TEXT");
    ensureServerColumn(db, "customer_call_profiles", "source", "TEXT DEFAULT 'calls'");
    db.run(`
      INSERT INTO customer_call_profiles (customer_no, customer_name, phone, phone2, city, address, company_id, days, source, customer_type, terms_accepted_at, terms_version_accepted, updated_at)
      VALUES (?, ?, ?, '', '', ?, ?, '', 'customer_portal', 'new', ?, ?, ?)
    `, [customerNo, customerName, phone, address, companyId, now, termsVersion, now]);
    const exported = Buffer.from(db.export());
    await writeCurrentDatabaseBuffer(exported);
  } finally {
    db.close();
  }

  if (usePostgresPreview) {
    try {
      const postgresProfile = {
        customer_no: profile.customer_no,
        customer_name: profile.customer_name,
        phone: profile.phone,
        address: profile.address,
        company_id: profile.company_id,
        call_days: "",
        source: profile.source,
        customer_type: profile.customer_type,
        terms_accepted_at: profile.terms_accepted_at,
        terms_version_accepted: profile.terms_version_accepted,
        updated_at: profile.updated_at,
      };
      try {
        await postgresUpsert("customer_call_profiles", [postgresProfile], "customer_no");
      } catch (error) {
        if (!/terms_version_accepted|schema cache|column/i.test(error.message || "")) throw error;
        const { terms_version_accepted, ...fallbackProfile } = postgresProfile;
        await postgresUpsert("customer_call_profiles", [fallbackProfile], "customer_no");
      }
    } catch (error) {
      console.error("customer registration postgres mirror failed", error);
    }
  }

  sendJson(res, 200, {
    ok: true,
    token: createCustomerToken(customerNo),
    requires_terms: false,
    customer: normalizeCustomerProfile(profile),
  });
}

async function handleCustomerTerms(payload, req, res) {
  const session = verifyCustomerToken(req);
  if (!session) {
    sendJson(res, 401, { ok: false, error: "unauthorized" });
    return;
  }
  const accepted = payload?.accepted === true || payload?.termsAccepted === true;
  if (!accepted) {
    sendJson(res, 400, { ok: false, error: "terms acceptance is required" });
    return;
  }

  const now = new Date().toISOString();
  const termsVersion = await getCustomerTermsVersion();
  const SQL = await initServerSql();
  const data = await readCurrentDatabaseBuffer();
  const db = new SQL.Database(new Uint8Array(data));
  let profile = null;
  try {
    ensureServerCustomerPortalSchema(db);
    ensureServerColumn(db, "customer_call_profiles", "terms_accepted_at", "TEXT");
    ensureServerColumn(db, "customer_call_profiles", "terms_version_accepted", "TEXT");
    ensureServerColumn(db, "customer_call_profiles", "customer_type", "TEXT DEFAULT 'existing'");
    db.run("UPDATE customer_call_profiles SET terms_accepted_at = ?, terms_version_accepted = ?, updated_at = ? WHERE customer_no = ?", [now, termsVersion, now, session.customer_no]);
    profile = sqliteRows(db, `
      SELECT customer_no, customer_name, phone, phone2, address, company_id, terms_accepted_at, terms_version_accepted, customer_type
      FROM customer_call_profiles
      WHERE customer_no = ?
      LIMIT 1
    `, [session.customer_no])[0] || null;
    const exported = Buffer.from(db.export());
    await writeCurrentDatabaseBuffer(exported);
  } finally {
    db.close();
  }

  if (usePostgresPreview) {
    try {
      await postgresPatch("customer_call_profiles", `customer_no=eq.${encodeURIComponent(session.customer_no)}`, {
        terms_accepted_at: now,
        terms_version_accepted: termsVersion,
        updated_at: now,
      });
    } catch (error) {
      try {
        if (!/terms_accepted_at|terms_version_accepted|schema cache|column/i.test(error.message || "")) throw error;
        await postgresPatch("customer_call_profiles", `customer_no=eq.${encodeURIComponent(session.customer_no)}`, {
          terms_accepted_at: now,
          updated_at: now,
        });
      } catch (mirrorError) {
        console.error("customer terms postgres mirror failed", mirrorError);
      }
    }
  }

  sendJson(res, 200, { ok: true, customer: profile ? normalizeCustomerProfile(profile) : null });
}

function productListPrice(row) {
  return numberValue(row.base_price) || numberValue(row.purchase_price) || numberValue(row.standard_cost);
}

function productPromoPrice(row) {
  const listPrice = productListPrice(row);
  const explicitSalePrice = numberValue(row.sale_price);
  if (explicitSalePrice > 0) return explicitSalePrice;

  const discountPercent = numberValue(row.promo_discount_percent);
  if (discountPercent > 0 && listPrice > 0) {
    return Math.max(0, listPrice * (1 - discountPercent / 100));
  }
  return 0;
}

function productPrice(row) {
  return productPromoPrice(row) || productListPrice(row);
}

function productPromoNote(row) {
  const explicitSalePrice = numberValue(row.sale_price);
  if (explicitSalePrice > 0) return `מבצע: מחיר ${explicitSalePrice.toFixed(2)}`;
  const discountPercent = numberValue(row.promo_discount_percent);
  return discountPercent > 0 ? `מבצע: ${discountPercent}% הנחה` : "";
}

async function handleCustomerProducts(req, res) {
  const session = verifyCustomerToken(req);
  if (!session) {
    sendJson(res, 401, { ok: false, error: "unauthorized" });
    return;
  }
  const profile = await findCustomerProfile(session.customer_no);
  if (!profile) {
    sendJson(res, 404, { ok: false, error: "customer not found" });
    return;
  }
  const termsVersion = await getCustomerTermsVersion();
  if (shouldRequireTermsAcceptance(profile, termsVersion)) {
    sendJson(res, 403, { ok: false, error: "terms_required" });
    return;
  }

  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const query = String(url.searchParams.get("q") || "").trim().toLowerCase();
  const supplier = String(url.searchParams.get("supplier") || "").trim();
  const category = String(url.searchParams.get("category") || "").trim();
  const section = String(url.searchParams.get("section") || "recommended").trim();
  const sort = String(url.searchParams.get("sort") || "customer").trim();
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 200), 1), 500);
  const result = await withCurrentDatabase((db) => {
    const columns = columnsFor(db, "products");
    const select = [
      "p.sku",
      "p.description",
      "p.category",
      "p.supplier",
      "p.standard_cost",
      columns.has("base_price") ? "p.base_price" : "0 AS base_price",
      columns.has("purchase_price") ? "p.purchase_price" : "0 AS purchase_price",
      columns.has("sale_price") ? "p.sale_price" : "0 AS sale_price",
      columns.has("promo_discount_percent") ? "p.promo_discount_percent" : "0 AS promo_discount_percent",
      columns.has("weight") ? "p.weight" : "0 AS weight",
      columns.has("barcode") ? "p.barcode" : "'' AS barcode",
      columns.has("image_url") ? "p.image_url" : "'' AS image_url",
      columns.has("hidden") ? "p.hidden" : "0 AS hidden",
      columns.has("customer_recommended") ? "p.customer_recommended" : "0 AS customer_recommended",
      "COALESCE(cu.customer_quantity, 0) AS customer_quantity",
      "COALESCE(gu.global_quantity, 0) AS global_quantity",
    ].join(", ");
    const hasCustomerSummary = tableExists(db, "customer_product_summary");
    const hasSalesRaw = tableExists(db, "sales_raw");
    const customerUsage = hasCustomerSummary
      ? "SELECT sku, SUM(quantity) AS customer_quantity FROM customer_product_summary WHERE customer_no = ? GROUP BY sku"
      : (hasSalesRaw ? "SELECT sku, SUM(quantity) AS customer_quantity FROM sales_raw WHERE customer_no = ? GROUP BY sku" : "SELECT '' AS sku, 0 AS customer_quantity WHERE 0");
    const globalUsage = hasCustomerSummary
      ? "SELECT sku, SUM(quantity) AS global_quantity FROM customer_product_summary GROUP BY sku"
      : (hasSalesRaw ? "SELECT sku, SUM(quantity) AS global_quantity FROM sales_raw GROUP BY sku" : "SELECT '' AS sku, 0 AS global_quantity WHERE 0");
    const all = sqliteRows(db, `
      SELECT ${select}
      FROM products p
      LEFT JOIN (${customerUsage}) cu ON cu.sku = p.sku
      LEFT JOIN (${globalUsage}) gu ON gu.sku = p.sku
      ORDER BY COALESCE(cu.customer_quantity, 0) DESC, COALESCE(gu.global_quantity, 0) DESC, p.description ASC
      LIMIT 3000
    `, hasCustomerSummary || hasSalesRaw ? [session.customer_no] : []);
    const visibleProducts = all.filter((row) => numberValue(row.hidden) !== 1);
    const suppliers = [...new Set(visibleProducts.map((row) => String(row.supplier || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "he"));
    const categories = [...new Set(visibleProducts.map((row) => String(row.category || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "he"));
    const rankBySku = new Map(visibleProducts
      .slice()
      .sort((a, b) => numberValue(b.global_quantity) - numberValue(a.global_quantity) || String(a.description || "").localeCompare(String(b.description || ""), "he"))
      .map((row, index) => [String(row.sku || ""), index + 1]));
    const hasRecommendedProducts = visibleProducts.some((candidate) => numberValue(candidate.customer_quantity) > 0 || numberValue(candidate.customer_recommended) > 0);
    const compareByCustomerSales = (a, b) =>
      numberValue(b.customer_quantity) - numberValue(a.customer_quantity)
      || numberValue(b.global_quantity) - numberValue(a.global_quantity)
      || String(a.description || "").localeCompare(String(b.description || ""), "he");
    const compareBySupplier = (a, b) =>
      String(a.supplier || "").localeCompare(String(b.supplier || ""), "he")
      || compareByCustomerSales(a, b);
    const compareByName = (a, b) => String(a.description || "").localeCompare(String(b.description || ""), "he");
    const sortProducts = (rows) => {
      const compare = sort === "supplier" ? compareBySupplier : (sort === "name" ? compareByName : compareByCustomerSales);
      return rows.slice().sort(compare);
    };
    const filtered = sortProducts(visibleProducts
      .filter((row) => {
        if (!query) return true;
        return [row.sku, row.description, row.category, row.supplier, row.barcode]
          .some((value) => String(value || "").toLowerCase().includes(query));
      })
      .filter((row) => !supplier || String(row.supplier || "") === supplier)
      .filter((row) => !category || String(row.category || "") === category)
      .filter((row) => section !== "recommended" || numberValue(row.customer_quantity) > 0 || numberValue(row.customer_recommended) > 0 || !hasRecommendedProducts)
      .filter((row) => section !== "deals" || productPromoPrice(row) > 0))
      .slice(0, limit)
      .map((row) => {
        const listPrice = productListPrice(row);
        const promoPrice = productPromoPrice(row);
        return {
          sku: String(row.sku || ""),
          barcode: String(row.barcode || ""),
          description: String(row.description || ""),
          category: String(row.category || ""),
          supplier: String(row.supplier || ""),
          price: promoPrice || listPrice,
          list_price: listPrice,
          promo_price: promoPrice,
          promo_discount_percent: numberValue(row.promo_discount_percent),
          standard_cost: numberValue(row.standard_cost),
          weight: numberValue(row.weight),
          image_url: String(row.image_url || ""),
          customer_recommended: numberValue(row.customer_quantity) > 0 || numberValue(row.customer_recommended) > 0,
          popularity_label: numberValue(row.global_quantity) <= 0
            ? ""
            : (rankBySku.get(String(row.sku || "")) <= 10 ? "Top 10" : (rankBySku.get(String(row.sku || "")) <= 100 ? "Top 100" : "")),
        };
      });
    return {
      rows: filtered,
      suppliers,
      categories,
      hasCustomerHistory: visibleProducts.some((row) => numberValue(row.customer_quantity) > 0 || numberValue(row.customer_recommended) > 0),
    };
  });

  sendJson(res, 200, { ok: true, ...result });
}

async function handleCustomerOrder(payload, req, res) {
  const session = verifyCustomerToken(req);
  if (!session) {
    sendJson(res, 401, { ok: false, error: "unauthorized" });
    return;
  }

  const inputItems = Array.isArray(payload?.items) ? payload.items.slice(0, 200) : [];
  const quantities = new Map(inputItems
    .map((item) => [String(item?.sku || "").trim(), numberValue(item?.quantity)])
    .filter(([sku, quantity]) => sku && quantity > 0));
  const itemNotes = new Map(inputItems
    .map((item) => [String(item?.sku || "").trim(), String(item?.note || "").trim()])
    .filter(([sku]) => sku));
  if (!quantities.size) {
    sendJson(res, 400, { ok: false, error: "empty order" });
    return;
  }

  const profile = await findCustomerProfile(session.customer_no);
  if (!profile) {
    sendJson(res, 404, { ok: false, error: "customer not found" });
    return;
  }
  const termsVersion = await getCustomerTermsVersion();
  if (shouldRequireTermsAcceptance(profile, termsVersion)) {
    sendJson(res, 403, { ok: false, error: "terms_required" });
    return;
  }

  const products = await withCurrentDatabase((db) => {
    const columns = columnsFor(db, "products");
    const select = [
      "sku",
      "description",
      "standard_cost",
      columns.has("base_price") ? "base_price" : "0 AS base_price",
      columns.has("purchase_price") ? "purchase_price" : "0 AS purchase_price",
      columns.has("sale_price") ? "sale_price" : "0 AS sale_price",
      columns.has("promo_discount_percent") ? "promo_discount_percent" : "0 AS promo_discount_percent",
      columns.has("units_per_carton") ? "units_per_carton" : "1 AS units_per_carton",
    ].join(", ");
    const placeholders = [...quantities.keys()].map(() => "?").join(",");
    return sqliteRows(db, `SELECT ${select} FROM products WHERE sku IN (${placeholders})`, [...quantities.keys()]);
  });
  const bySku = new Map(products.map((product) => [String(product.sku || ""), product]));
  const orderItems = [...quantities.entries()].map(([sku, quantity], index) => {
    const product = bySku.get(sku) || { sku, description: sku };
    const price = productPrice(product);
    const unitCost = numberValue(product.standard_cost);
    const notes = [itemNotes.get(sku), productPromoNote(product)].filter(Boolean).join(" | ");
    return {
      sku,
      product_desc: String(product.description || sku),
      quantity,
      picked_quantity: 0,
      note: notes,
      item_status: "pending",
      entry_sequence: index + 1,
      is_carton: 0,
      units_per_carton: numberValue(product.units_per_carton) || 1,
      estimated_price: price * quantity,
      estimated_profit: Math.max(0, (price - unitCost) * quantity),
    };
  });
  const subtotal = orderItems.reduce((sum, item) => sum + numberValue(item.estimated_price), 0);
  const profit = orderItems.reduce((sum, item) => sum + numberValue(item.estimated_profit), 0);
  const now = new Date().toISOString();
  const customerName = String(profile.customer_name || session.customer_no);
  const note = String(payload?.note || "").trim();

  return handleOrderDelta({
    order: {
      client_order_key: `customer-${session.customer_no}-${Date.now()}`,
      order_date: currentDateIso(),
      customer_no: session.customer_no,
      customer_name: customerName,
      status: "מוכן לאיסוף",
      notes: note ? `הזמנה מאזור לקוח. ${note}` : "הזמנה מאזור לקוח",
      estimated_total: subtotal,
      estimated_profit: profit,
      updated_at: now,
    },
    items: orderItems,
    call: {
      call_date: currentDateIso(),
      customer_no: session.customer_no,
      customer_name: customerName,
      status: "ordered",
      manual_order_id: null,
      notes: "הזמנה מאזור לקוח",
      updated_at: now,
    },
  }, res);
}

function handleStatic(req, res) {
  const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  const cleanPath = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
  let filePath = path.resolve(root, cleanPath);

  if (!filePath.startsWith(root) || filePath.startsWith(dataDir) || path.extname(filePath) === ".sqlite") {
    send(res, 403, "forbidden");
    return;
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, "index.html");
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      send(res, 404, "not found");
      return;
    }
    const ext = path.extname(filePath);
    send(res, 200, data, {
      "Content-Type": types[ext] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
  });
}

const server = http.createServer((req, res) => {
  const requestPath = (req.url || "/").split("?")[0];

  if (requestPath === "/healthz") {
    sendJson(res, 200, {
      ok: true,
      storage: useSupabase ? "supabase" : "disk",
      pickingChangesApi: true,
      postgresPreview: {
        configured: usePostgresPreview,
        host: postgresPreviewUrl ? new URL(postgresPreviewUrl).host : "",
      },
      supabase: {
        configured: useSupabase,
        host: supabaseUrl ? new URL(supabaseUrl).host : "",
        bucket: supabaseBucket,
        object: supabaseDbObject,
      },
      databaseCache: {
        loaded: Boolean(databaseBufferCache),
        bytes: databaseBufferCache ? databaseBufferCache.length : 0,
        ageSeconds: databaseBufferCacheLoadedAt ? Math.round((Date.now() - databaseBufferCacheLoadedAt) / 1000) : null,
        ttlSeconds: Math.round(dbCacheTtlMs / 1000),
      },
    });
    return;
  }

  if (requestPath === "/api/db" && req.method === "GET") {
    handleDatabaseGet(res).catch((error) => {
      console.error(error);
      send(res, 500, "database read failed");
    });
    return;
  }

  if (requestPath === "/api/db" && req.method === "POST") {
    handleDatabasePost(req, res);
    return;
  }

  if (requestPath === "/api/picking-changes" && req.method === "POST") {
    handleJsonPost(req, res, (payload) => enqueueDbMutation(() => handlePickingChanges(payload, res)));
    return;
  }

  if (requestPath === "/api/order-delta" && req.method === "POST") {
    handleJsonPost(req, res, (payload) => enqueueDbMutation(() => handleOrderDelta(payload, res)));
    return;
  }

  if (requestPath === "/api/customer/login" && req.method === "POST") {
    handleJsonPost(req, res, (payload) => handleCustomerLogin(payload, res).catch((error) => {
      console.error(error);
      sendJson(res, 500, { ok: false, error: error.message || "customer login failed" });
    }));
    return;
  }

  if (requestPath === "/api/customer/register" && req.method === "POST") {
    handleJsonPost(req, res, (payload) => enqueueDbMutation(() => handleCustomerRegister(payload, res)));
    return;
  }

  if (requestPath === "/api/customer/settings" && req.method === "GET") {
    handleCustomerSettings(res).catch((error) => {
      console.error(error);
      sendJson(res, 500, { ok: false, error: error.message || "customer settings failed" });
    });
    return;
  }

  if (requestPath === "/api/customer/settings" && req.method === "POST") {
    handleJsonPost(req, res, (payload) => enqueueDbMutation(() => handleCustomerSettingsSave(payload, res)));
    return;
  }

  if (requestPath === "/api/customer/terms" && req.method === "POST") {
    handleJsonPost(req, res, (payload) => enqueueDbMutation(() => handleCustomerTerms(payload, req, res)));
    return;
  }

  if (requestPath === "/api/customer/products" && req.method === "GET") {
    handleCustomerProducts(req, res).catch((error) => {
      console.error(error);
      sendJson(res, 500, { ok: false, error: error.message || "customer products failed" });
    });
    return;
  }

  if (requestPath === "/api/customer/order" && req.method === "POST") {
    handleJsonPost(req, res, (payload) => enqueueDbMutation(() => handleCustomerOrder(payload, req, res)));
    return;
  }

  if (requestPath === "/api/postgres-preview" && req.method === "GET") {
    handlePostgresPreview(res).catch((error) => {
      console.error(error);
      sendJson(res, 500, { ok: false, error: error.message || "postgres preview failed" });
    });
    return;
  }

  if (requestPath === "/api/price-audit/product" && req.method === "GET") {
    handlePriceAuditProduct(req, res).catch((error) => {
      console.error(error);
      sendJson(res, error.status || 500, { ok: false, error: error.message || "price audit lookup failed" });
    });
    return;
  }

  if (requestPath === "/api/price-audit/products/batch" && req.method === "POST") {
    handleJsonPost(req, res, (payload) => handlePriceAuditProductsBatch(payload, req, res));
    return;
  }

  if (requestPath === "/api/price-audit/supplier-rules" && req.method === "GET") {
    handlePriceAuditSupplierRules(req, res).catch((error) => {
      console.error(error);
      sendJson(res, error.status || 500, { ok: false, error: error.message || "supplier rules lookup failed" });
    });
    return;
  }

  if (requestPath === "/api/price-audit/diagnostics/product" && req.method === "GET") {
    handlePriceAuditDiagnostics(req, res).catch((error) => {
      console.error(error);
      sendJson(res, error.status || 500, { ok: false, error: error.message || "price audit diagnostics failed" });
    });
    return;
  }

  if (requestPath === "/api/postgres/products" && req.method === "GET") {
    handlePostgresProducts(req, res).catch((error) => {
      console.error(error);
      sendJson(res, 500, { ok: false, error: error.message || "postgres products failed" });
    });
    return;
  }

  if (requestPath === "/api/postgres/product-filters" && req.method === "GET") {
    handlePostgresProductFilters(res).catch((error) => {
      console.error(error);
      sendJson(res, 500, { ok: false, error: error.message || "postgres product filters failed" });
    });
    return;
  }

  if (requestPath === "/api/postgres/products-import" && req.method === "POST") {
    handleJsonPost(req, res, (payload) => handlePostgresProductsImport(payload, res));
    return;
  }

  if (requestPath === "/api/postgres/calls" && req.method === "GET") {
    handlePostgresCalls(req, res).catch((error) => {
      console.error(error);
      sendJson(res, 500, { ok: false, error: error.message || "postgres calls failed" });
    });
    return;
  }

  if (requestPath === "/api/postgres/call-status" && req.method === "POST") {
    handleJsonPost(req, res, (payload) => handlePostgresCallStatus(payload, res));
    return;
  }

  if (requestPath === "/api/postgres/calls-reset" && req.method === "POST") {
    handleJsonPost(req, res, (payload) => handlePostgresCallsReset(payload, res));
    return;
  }

  if (requestPath === "/api/postgres/call-profile" && req.method === "POST") {
    handleJsonPost(req, res, (payload) => handlePostgresCallProfile(payload, res));
    return;
  }

  if (requestPath === "/api/postgres/call-profiles-import" && req.method === "POST") {
    handleJsonPost(req, res, (payload) => handlePostgresCallProfilesImport(payload, res));
    return;
  }

  if (requestPath === "/api/postgres/order-history" && req.method === "GET") {
    handlePostgresOrderHistory(req, res).catch((error) => {
      console.error(error);
      sendJson(res, 500, { ok: false, error: error.message || "postgres order history failed" });
    });
    return;
  }

  if (requestPath === "/api/postgres/order-patch" && req.method === "POST") {
    handleJsonPost(req, res, (payload) => enqueueDbMutation(() => handlePostgresOrderPatch(payload, res)));
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    send(res, 405, "method not allowed");
    return;
  }

  handleStatic(req, res);
});

server.listen(port, host, () => {
  console.log(`Sales Analytics is running on http://${host === "0.0.0.0" ? "localhost" : host}:${port}`);
  console.log(useSupabase ? `Database storage: Supabase ${supabaseBucket}/${supabaseDbObject}` : `Database path: ${dbPath}`);
});
