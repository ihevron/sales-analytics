from pathlib import Path

SERVER_PATH = Path("server.js")
server = SERVER_PATH.read_text(encoding="utf-8")

BACKEND_MARKER = "\nfunction handleStatic(req, res) {"
ROUTE_MARKER = '  if (requestPath === "/api/postgres-preview" && req.method === "GET") {'

backend = r'''
function healthMinistryText(value) {
  return String(value ?? "").trim();
}

function healthMinistryNormalizedKey(value) {
  return healthMinistryText(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u0591-\u05c7]/g, "")
    .replace(/&/g, "ו")
    .replace(/[^0-9a-z\u05d0-\u05ea]+/gi, "");
}

function healthMinistryIsoDate(value, fallback = new Date().toISOString()) {
  const raw = healthMinistryText(value);
  return raw && Number.isFinite(Date.parse(raw)) ? new Date(raw).toISOString() : fallback;
}

function healthMinistryActive(value) {
  if (value === false || value === 0) return false;
  const normalized = healthMinistryText(value).toLowerCase();
  return !["false", "0", "no", "לא", "לאפעיל", "כבוי"].includes(normalized);
}

async function healthMinistryRowsAll(table, select, order = "") {
  const pageSize = 1000;
  const rows = [];
  for (let offset = 0; offset < 100000; offset += pageSize) {
    const ordering = order ? `&order=${order}` : "";
    const batch = await postgresRows(`${table}?select=${select}${ordering}&limit=${pageSize}&offset=${offset}`);
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }
  return rows;
}

async function healthMinistryRpc(functionName, payload) {
  const response = await postgresRest(`rpc/${functionName}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(payload),
  });
  const body = await response.text();
  if (!body) return null;
  try {
    return JSON.parse(body);
  } catch (error) {
    return body;
  }
}

function healthMinistrySettingsFromRow(row = {}) {
  return {
    supplierName: healthMinistryText(row.supplier_name),
    supplierVat: healthMinistryText(row.supplier_vat),
    healthLicense: healthMinistryText(row.health_license),
    vehicleNumber: healthMinistryText(row.vehicle_number),
    driverName: healthMinistryText(row.driver_name),
    driverPhone: healthMinistryText(row.driver_phone),
    customerType: healthMinistryText(row.customer_type) || "קמעונאי",
    dailyRound: healthMinistryText(row.daily_round),
    updatedAt: row.updated_at || "",
  };
}

function healthMinistryCustomerFromRow(row = {}, index = 0) {
  const name = healthMinistryText(row.customer_name);
  return {
    sourceRow: index + 2,
    customerNumber: healthMinistryText(row.customer_number),
    name,
    vat: healthMinistryText(row.vat_number),
    address: healthMinistryText(row.address),
    city: healthMinistryText(row.city_name),
    strictKey: healthMinistryNormalizedKey(name),
    looseKey: healthMinistryText(row.normalized_name) || healthMinistryNormalizedKey(name),
    updatedAt: row.updated_at || "",
  };
}

function healthMinistryCityFromRow(row = {}, index = 0) {
  const name = healthMinistryText(row.city_name);
  return {
    sourceRow: index + 2,
    name,
    code: healthMinistryText(row.city_code),
    key: healthMinistryText(row.city_key) || healthMinistryNormalizedKey(name),
    updatedAt: row.updated_at || "",
  };
}

function healthMinistryRuleFromRow(row = {}) {
  return {
    id: healthMinistryText(row.id),
    sourceNumber: healthMinistryText(row.source_number),
    sourceName: healthMinistryText(row.source_name),
    sourceKey: healthMinistryText(row.source_key),
    action: row.action === "replace" ? "replace" : "exclude",
    replacementNumber: healthMinistryText(row.replacement_number),
    replacementName: healthMinistryText(row.replacement_name),
    notes: healthMinistryText(row.notes),
    active: row.active !== false,
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
  };
}

function normalizeHealthMinistryCustomer(input = {}) {
  const customerNumber = healthMinistryText(input.customerNumber || input.customer_number);
  const customerName = healthMinistryText(input.name || input.customerName || input.customer_name);
  const normalizedName = healthMinistryText(input.looseKey || input.normalizedName || input.normalized_name)
    || healthMinistryNormalizedKey(customerName);
  const customerKey = healthMinistryText(input.customerKey || input.customer_key)
    || (customerNumber ? `number:${customerNumber}` : `name:${normalizedName}`);
  if (!customerKey || !customerName || !normalizedName) return null;
  return {
    customer_key: customerKey,
    customer_number: customerNumber,
    customer_name: customerName,
    vat_number: healthMinistryText(input.vat || input.vatNumber || input.vat_number),
    address: healthMinistryText(input.address),
    city_name: healthMinistryText(input.city || input.cityName || input.city_name),
    normalized_name: normalizedName,
  };
}

function normalizeHealthMinistryCity(input = {}) {
  const cityName = healthMinistryText(input.name || input.cityName || input.city_name);
  const cityCode = healthMinistryText(input.code || input.cityCode || input.city_code);
  const cityKey = healthMinistryText(input.key || input.cityKey || input.city_key)
    || healthMinistryNormalizedKey(cityName);
  if (!cityKey || !cityName || !cityCode) return null;
  return {
    city_key: cityKey,
    city_name: cityName,
    city_code: cityCode,
  };
}

function normalizeHealthMinistryRule(input = {}) {
  const now = new Date().toISOString();
  const sourceName = healthMinistryText(input.sourceName || input.source_name);
  const sourceNumber = healthMinistryText(input.sourceNumber || input.source_number);
  const sourceKey = healthMinistryText(input.sourceKey || input.source_key)
    || healthMinistryNormalizedKey(sourceName || sourceNumber);
  const id = healthMinistryText(input.id) || `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  if (!sourceKey) return null;
  return {
    id,
    source_number: sourceNumber,
    source_name: sourceName,
    source_key: sourceKey,
    action: input.action === "replace" ? "replace" : "exclude",
    replacement_number: healthMinistryText(input.replacementNumber || input.replacement_number),
    replacement_name: healthMinistryText(input.replacementName || input.replacement_name),
    notes: healthMinistryText(input.notes),
    active: healthMinistryActive(input.active),
    created_at: healthMinistryIsoDate(input.createdAt || input.created_at, now),
    updated_at: healthMinistryIsoDate(input.updatedAt || input.updated_at, now),
  };
}

async function handleHealthMinistryBootstrap(res) {
  if (!requirePostgres(res)) return;
  const [settingsRows, customerRows, cityRows, ruleRows, metaRows] = await Promise.all([
    postgresRows("health_ministry_settings?select=*&scope=eq.default&limit=1"),
    healthMinistryRowsAll(
      "health_ministry_customers",
      "customer_number,customer_name,vat_number,address,city_name,normalized_name,updated_at",
      "customer_name.asc",
    ),
    healthMinistryRowsAll(
      "health_ministry_cities",
      "city_key,city_name,city_code,updated_at",
      "city_name.asc",
    ),
    healthMinistryRowsAll(
      "health_ministry_customer_rules",
      "id,source_number,source_name,source_key,action,replacement_number,replacement_name,notes,active,created_at,updated_at",
      "updated_at.desc",
    ),
    postgresRows("health_ministry_dataset_meta?select=dataset_type,file_name,row_count,updated_at"),
  ]);

  const meta = { customers: null, cities: null };
  metaRows.forEach((row) => {
    if (!Object.prototype.hasOwnProperty.call(meta, row.dataset_type)) return;
    meta[row.dataset_type] = {
      fileName: healthMinistryText(row.file_name),
      rowCount: Number(row.row_count) || 0,
      updatedAt: row.updated_at || "",
    };
  });

  sendJson(res, 200, {
    ok: true,
    source: "supabase",
    settings: healthMinistrySettingsFromRow(settingsRows[0] || {}),
    customers: customerRows.map(healthMinistryCustomerFromRow),
    cities: cityRows.map(healthMinistryCityFromRow),
    rules: ruleRows.map(healthMinistryRuleFromRow),
    meta,
  });
}

async function handleHealthMinistrySettingsSave(payload, res) {
  if (!requirePostgres(res)) return;
  const input = payload?.settings || payload || {};
  const row = {
    scope: "default",
    supplier_name: healthMinistryText(input.supplierName || input.supplier_name),
    supplier_vat: healthMinistryText(input.supplierVat || input.supplier_vat),
    health_license: healthMinistryText(input.healthLicense || input.health_license),
    vehicle_number: healthMinistryText(input.vehicleNumber || input.vehicle_number),
    driver_name: healthMinistryText(input.driverName || input.driver_name),
    driver_phone: healthMinistryText(input.driverPhone || input.driver_phone),
    customer_type: healthMinistryText(input.customerType || input.customer_type) || "קמעונאי",
    daily_round: healthMinistryText(input.dailyRound || input.daily_round),
    updated_at: new Date().toISOString(),
  };
  await postgresUpsert("health_ministry_settings", [row], "scope");
  sendJson(res, 200, { ok: true, source: "supabase", settings: healthMinistrySettingsFromRow(row) });
}

async function handleHealthMinistryCustomersReplace(payload, res) {
  if (!requirePostgres(res)) return;
  const input = Array.isArray(payload?.customers) ? payload.customers : [];
  if (!input.length) {
    sendJson(res, 400, { ok: false, error: "customers are required" });
    return;
  }
  if (input.length > 50000) {
    sendJson(res, 413, { ok: false, error: "too many customers" });
    return;
  }
  const rows = [...new Map(input.map(normalizeHealthMinistryCustomer)
    .filter(Boolean)
    .map((row) => [row.customer_key, row])).values()];
  if (!rows.length) {
    sendJson(res, 400, { ok: false, error: "no valid customers" });
    return;
  }
  const result = await healthMinistryRpc("replace_health_ministry_customers", {
    p_rows: rows,
    p_file_name: healthMinistryText(payload?.fileName || payload?.file_name),
  });
  const imported = Number(Array.isArray(result) ? result[0] : result);
  sendJson(res, 200, { ok: true, source: "supabase", imported: Number.isFinite(imported) ? imported : rows.length });
}

async function handleHealthMinistryCitiesReplace(payload, res) {
  if (!requirePostgres(res)) return;
  const input = Array.isArray(payload?.cities) ? payload.cities : [];
  if (!input.length) {
    sendJson(res, 400, { ok: false, error: "cities are required" });
    return;
  }
  if (input.length > 10000) {
    sendJson(res, 413, { ok: false, error: "too many cities" });
    return;
  }
  const rows = [...new Map(input.map(normalizeHealthMinistryCity)
    .filter(Boolean)
    .map((row) => [row.city_key, row])).values()];
  if (!rows.length) {
    sendJson(res, 400, { ok: false, error: "no valid cities" });
    return;
  }
  const result = await healthMinistryRpc("replace_health_ministry_cities", {
    p_rows: rows,
    p_file_name: healthMinistryText(payload?.fileName || payload?.file_name),
  });
  const imported = Number(Array.isArray(result) ? result[0] : result);
  sendJson(res, 200, { ok: true, source: "supabase", imported: Number.isFinite(imported) ? imported : rows.length });
}

async function handleHealthMinistryRuleUpsert(payload, res) {
  if (!requirePostgres(res)) return;
  const rule = normalizeHealthMinistryRule(payload?.rule || payload || {});
  if (!rule) {
    sendJson(res, 400, { ok: false, error: "invalid rule" });
    return;
  }
  await postgresUpsert("health_ministry_customer_rules", [rule], "id");
  sendJson(res, 200, { ok: true, source: "supabase", rule: healthMinistryRuleFromRow(rule) });
}

async function handleHealthMinistryRuleDelete(payload, res) {
  if (!requirePostgres(res)) return;
  const id = healthMinistryText(payload?.id);
  if (!id) {
    sendJson(res, 400, { ok: false, error: "rule id is required" });
    return;
  }
  await postgresRest(`health_ministry_customer_rules?id=eq.${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
  sendJson(res, 200, { ok: true, source: "supabase", id });
}

async function handleHealthMinistryRulesReplace(payload, res) {
  if (!requirePostgres(res)) return;
  const input = Array.isArray(payload?.rules) ? payload.rules : [];
  if (input.length > 10000) {
    sendJson(res, 413, { ok: false, error: "too many rules" });
    return;
  }
  const rows = [...new Map(input.map(normalizeHealthMinistryRule)
    .filter(Boolean)
    .map((row) => [row.id, row])).values()];
  const result = await healthMinistryRpc("replace_health_ministry_customer_rules", { p_rows: rows });
  const imported = Number(Array.isArray(result) ? result[0] : result);
  sendJson(res, 200, { ok: true, source: "supabase", imported: Number.isFinite(imported) ? imported : rows.length });
}
'''

routes = r'''
  if (requestPath === "/api/health-ministry/bootstrap" && req.method === "GET") {
    handleHealthMinistryBootstrap(res).catch((error) => {
      console.error("health ministry bootstrap failed", error);
      sendJson(res, 500, { ok: false, error: error.message || "health ministry bootstrap failed" });
    });
    return;
  }

  if (requestPath === "/api/health-ministry/settings" && req.method === "POST") {
    handleJsonPost(req, res, (payload) => handleHealthMinistrySettingsSave(payload, res).catch((error) => {
      console.error("health ministry settings save failed", error);
      sendJson(res, 500, { ok: false, error: error.message || "health ministry settings save failed" });
    }));
    return;
  }

  if (requestPath === "/api/health-ministry/customers/replace" && req.method === "POST") {
    handleJsonPost(req, res, (payload) => handleHealthMinistryCustomersReplace(payload, res).catch((error) => {
      console.error("health ministry customers replace failed", error);
      sendJson(res, 500, { ok: false, error: error.message || "health ministry customers replace failed" });
    }));
    return;
  }

  if (requestPath === "/api/health-ministry/cities/replace" && req.method === "POST") {
    handleJsonPost(req, res, (payload) => handleHealthMinistryCitiesReplace(payload, res).catch((error) => {
      console.error("health ministry cities replace failed", error);
      sendJson(res, 500, { ok: false, error: error.message || "health ministry cities replace failed" });
    }));
    return;
  }

  if (requestPath === "/api/health-ministry/rules/upsert" && req.method === "POST") {
    handleJsonPost(req, res, (payload) => handleHealthMinistryRuleUpsert(payload, res).catch((error) => {
      console.error("health ministry rule upsert failed", error);
      sendJson(res, 500, { ok: false, error: error.message || "health ministry rule upsert failed" });
    }));
    return;
  }

  if (requestPath === "/api/health-ministry/rules/delete" && req.method === "POST") {
    handleJsonPost(req, res, (payload) => handleHealthMinistryRuleDelete(payload, res).catch((error) => {
      console.error("health ministry rule delete failed", error);
      sendJson(res, 500, { ok: false, error: error.message || "health ministry rule delete failed" });
    }));
    return;
  }

  if (requestPath === "/api/health-ministry/rules/replace" && req.method === "POST") {
    handleJsonPost(req, res, (payload) => handleHealthMinistryRulesReplace(payload, res).catch((error) => {
      console.error("health ministry rules replace failed", error);
      sendJson(res, 500, { ok: false, error: error.message || "health ministry rules replace failed" });
    }));
    return;
  }

'''

if "async function handleHealthMinistryBootstrap" not in server:
    if BACKEND_MARKER not in server:
        raise SystemExit("server backend insertion marker not found")
    server = server.replace(BACKEND_MARKER, "\n" + backend.strip() + "\n" + BACKEND_MARKER, 1)

if 'requestPath === "/api/health-ministry/bootstrap"' not in server:
    if ROUTE_MARKER not in server:
        raise SystemExit("server route insertion marker not found")
    server = server.replace(ROUTE_MARKER, routes + ROUTE_MARKER, 1)

SERVER_PATH.write_text(server, encoding="utf-8")
print("Patched server.js with Ministry of Health Supabase API")
