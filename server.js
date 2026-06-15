const http = require("http");
const fs = require("fs");
const path = require("path");
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
const dbCacheTtlMs = Number(process.env.DB_CACHE_TTL_MS || 60 * 60 * 1000);
let SQLRuntimePromise = null;
let dbMutationQueue = Promise.resolve();
let databaseBufferCache = null;
let databaseBufferCacheLoadedAt = 0;
const priceAuditService = createPriceAuditService({
  supabaseUrl: postgresPreviewUrl || supabaseUrl,
  serviceKey: postgresPreviewKey || supabaseServiceRoleKey,
});

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
  const rows = await postgresRows(`products?select=sku,description,category,supplier,standard_cost,purchase_price,sale_price,weight&order=description.asc&limit=${limit}${filterString}`);
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
        description: String(product.description || "").trim(),
        family_description: category,
        category,
        standard_cost: standardCost,
        purchase_price: standardCost,
        sale_price: numberValue(product.sale_price),
        weight: numberValue(product.weight),
        supplier: String(product.supplier || "").trim(),
        pick_order: numberValue(product.pick_order) || 999999,
        units_per_carton: numberValue(product.units_per_carton) || 1,
        updated_at: now,
      };
    })
    .filter((row) => row.sku)
    .map((row) => [row.sku, row])).values()];

  if (rows.length) {
    await postgresRest("products?sku=not.is.null", {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    });
    for (let index = 0; index < rows.length; index += 500) {
      await postgresUpsert("products", rows.slice(index, index + 500), "sku");
    }
  }
  sendJson(res, 200, { ok: true, source: "postgres", imported: rows.length });
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
        call_days: String(profile.call_days || profile.days || "").trim(),
        source: "calls",
        updated_at: now,
      };
    })
    .filter((row) => row.customer_no && row.customer_name);

  if (rows.length) {
    await postgresRest("customer_call_profiles?source=eq.calls", {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    });
    await postgresUpsert("customer_call_profiles", rows, "customer_no");
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
