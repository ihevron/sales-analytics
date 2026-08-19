"use strict";

const { URL } = require("url");

const TABLE = "health_ministry_app_state";
const SCOPES = new Set(["settings", "customers", "cities", "rules"]);
const MAX_BODY_BYTES = Math.max(1024 * 1024, Number(process.env.HEALTH_MINISTRY_MAX_BODY_BYTES || 25 * 1024 * 1024));

function normalizeSupabaseUrl(rawUrl) {
  const trimmed = String(rawUrl || "").trim();
  if (!trimmed) return "";
  try {
    const parsed = new URL(trimmed);
    const dashboardProject = parsed.pathname.match(/\/dashboard\/project\/([^/]+)/);
    if (dashboardProject) return `https://${dashboardProject[1]}.supabase.co`;
    return `${parsed.protocol}//${parsed.host}`.replace(/\/+$/, "");
  } catch {
    return trimmed.replace(/\/+$/, "");
  }
}

function configuration() {
  const url = normalizeSupabaseUrl(process.env.SUPABASE_URL || process.env.SUPABASE_POSTGRES_URL || "");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_POSTGRES_SERVICE_ROLE_KEY || "";
  return { url, serviceKey, configured: Boolean(url && serviceKey) };
}

function sendJson(res, status, body, extraHeaders = {}) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(json),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...extraHeaders,
  });
  res.end(json);
}

function cleanText(value, maxLength = 500) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function cleanIdentifier(value, maxLength = 80) {
  return cleanText(value, maxLength).replace(/[\u0000-\u001f\u007f]/g, "");
}

function cleanIso(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
}

function sanitizeSettings(payload) {
  const data = payload?.data && typeof payload.data === "object" ? payload.data : payload || {};
  const allowed = [
    "supplierName", "supplierVat", "healthLicense", "vehicleNumber",
    "driverName", "driverPhone", "customerType", "dailyRound",
  ];
  const sanitized = {};
  for (const key of allowed) sanitized[key] = cleanText(data[key], 250);
  return {
    version: 2,
    data: sanitized,
    updatedAt: cleanIso(payload?.updatedAt),
    migratedFromBrowser: Boolean(payload?.migratedFromBrowser),
  };
}

function sanitizeCustomers(payload) {
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  if (rows.length > 100000) throw new Error("קובץ הלקוחות גדול מהמגבלה המותרת");
  return {
    version: 2,
    fileName: cleanText(payload?.fileName, 255),
    uploadedAt: cleanIso(payload?.uploadedAt),
    rows: rows.map((row, index) => ({
      sourceRow: Math.max(1, Math.trunc(Number(row?.sourceRow) || index + 2)),
      customerNumber: cleanIdentifier(row?.customerNumber, 100),
      name: cleanText(row?.name || row?.customerName, 500),
      vatNumber: cleanIdentifier(row?.vatNumber, 100),
      address: cleanText(row?.address, 1000),
      city: cleanText(row?.city, 500),
    })).filter((row) => row.name),
  };
}

function sanitizeCities(payload) {
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  if (rows.length > 25000) throw new Error("רשימת הערים גדולה מהמגבלה המותרת");
  return {
    version: 2,
    fileName: cleanText(payload?.fileName, 255),
    uploadedAt: cleanIso(payload?.uploadedAt),
    rows: rows.map((row, index) => ({
      sourceRow: Math.max(1, Math.trunc(Number(row?.sourceRow) || index + 2)),
      name: cleanText(row?.name, 500),
      code: cleanIdentifier(row?.code, 100),
    })).filter((row) => row.name && row.code),
  };
}

function sanitizeRules(payload) {
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  if (rows.length > 10000) throw new Error("רשימת החסומים גדולה מהמגבלה המותרת");
  return {
    version: 2,
    updatedAt: cleanIso(payload?.updatedAt),
    migratedFromBrowser: Boolean(payload?.migratedFromBrowser),
    rows: rows.map((row, index) => ({
      id: cleanIdentifier(row?.id, 150) || `rule-${Date.now()}-${index}`,
      sourceCustomerName: cleanText(row?.sourceCustomerName, 500),
      sourceCustomerNumber: cleanIdentifier(row?.sourceCustomerNumber, 100),
      sourceKey: cleanIdentifier(row?.sourceKey, 1000),
      action: row?.action === "replace" ? "replace" : "exclude",
      replacementCustomerNumber: cleanIdentifier(row?.replacementCustomerNumber, 100),
      replacementCustomerName: cleanText(row?.replacementCustomerName, 500),
      active: row?.active !== false,
      note: cleanText(row?.note, 1000),
      createdAt: cleanIso(row?.createdAt),
      updatedAt: cleanIso(row?.updatedAt),
    })).filter((row) => row.sourceCustomerName || row.sourceKey),
  };
}

function sanitizePayload(scope, payload) {
  if (scope === "settings") return sanitizeSettings(payload);
  if (scope === "customers") return sanitizeCustomers(payload);
  if (scope === "cities") return sanitizeCities(payload);
  if (scope === "rules") return sanitizeRules(payload);
  throw new Error("סוג נתונים לא נתמך");
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("הבקשה גדולה מהמגבלה המותרת"), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(Object.assign(new Error("גוף הבקשה אינו JSON תקין"), { statusCode: 400 }));
      }
    });
    req.on("error", reject);
  });
}

function supabaseHeaders(serviceKey, extra = {}) {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    Accept: "application/json",
    ...extra,
  };
}

async function supabaseRequest(path, options = {}) {
  const config = configuration();
  if (!config.configured) throw Object.assign(new Error("חיבור Supabase אינו מוגדר בשרת"), { statusCode: 503 });
  const response = await fetch(`${config.url}${path}`, {
    ...options,
    headers: supabaseHeaders(config.serviceKey, options.headers || {}),
  });
  const raw = await response.text();
  let body = null;
  try { body = raw ? JSON.parse(raw) : null; } catch { body = raw; }
  if (!response.ok) {
    const message = body?.message || body?.hint || body?.error || raw || `Supabase ${response.status}`;
    const error = new Error(message);
    error.statusCode = response.status >= 400 && response.status < 500 ? 400 : 502;
    error.details = body;
    throw error;
  }
  return body;
}

async function loadState() {
  const rows = await supabaseRequest(`/rest/v1/${TABLE}?select=scope,payload,updated_at&order=scope.asc`, { method: "GET" });
  const result = {};
  for (const scope of SCOPES) result[scope] = { payload: {}, updatedAt: null };
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!SCOPES.has(row.scope)) continue;
    result[row.scope] = { payload: row.payload || {}, updatedAt: row.updated_at || null };
  }
  return result;
}

async function saveState(scope, payload) {
  const updatedAt = new Date().toISOString();
  const rows = await supabaseRequest(`/rest/v1/${TABLE}?on_conflict=scope`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify([{ scope, payload, updated_at: updatedAt }]),
  });
  const row = Array.isArray(rows) ? rows[0] : null;
  return { scope, payload: row?.payload || payload, updatedAt: row?.updated_at || updatedAt };
}

function isWriteAllowed(req) {
  const origin = String(req.headers.origin || "");
  if (!origin) return true;
  try {
    const originUrl = new URL(origin);
    const host = String(req.headers.host || "").toLowerCase();
    return originUrl.host.toLowerCase() === host;
  } catch {
    return false;
  }
}

async function handleHealthMinistryRequest(req, res) {
  const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  if (!requestUrl.pathname.startsWith("/api/health-ministry")) return false;

  try {
    if (req.method === "GET" && requestUrl.pathname === "/api/health-ministry/status") {
      const config = configuration();
      sendJson(res, config.configured ? 200 : 503, { ok: config.configured, configured: config.configured });
      return true;
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/health-ministry/state") {
      sendJson(res, 200, { ok: true, state: await loadState() });
      return true;
    }

    const scopeMatch = requestUrl.pathname.match(/^\/api\/health-ministry\/state\/([a-z]+)$/);
    if (req.method === "PUT" && scopeMatch) {
      if (!isWriteAllowed(req)) {
        sendJson(res, 403, { ok: false, error: "origin_not_allowed", message: "מקור הבקשה אינו מורשה" });
        return true;
      }
      const scope = scopeMatch[1];
      if (!SCOPES.has(scope)) {
        sendJson(res, 404, { ok: false, error: "unknown_scope", message: "סוג הנתונים אינו נתמך" });
        return true;
      }
      const input = await readJsonBody(req);
      const payload = sanitizePayload(scope, input?.payload);
      const saved = await saveState(scope, payload);
      sendJson(res, 200, { ok: true, ...saved });
      return true;
    }

    if (req.method === "OPTIONS") {
      res.writeHead(204, { Allow: "GET, PUT, OPTIONS", "Cache-Control": "no-store" });
      res.end();
      return true;
    }

    sendJson(res, 404, { ok: false, error: "not_found", message: "נתיב API לא נמצא" });
    return true;
  } catch (error) {
    console.error("Health Ministry API error", error);
    const status = Number(error.statusCode) || 500;
    sendJson(res, status, {
      ok: false,
      error: status >= 500 ? "server_error" : "request_error",
      message: error.message || "שגיאה לא ידועה",
    });
    return true;
  }
}

module.exports = {
  handleHealthMinistryRequest,
  sanitizePayload,
  sanitizeSettings,
  sanitizeCustomers,
  sanitizeCities,
  sanitizeRules,
  configuration,
};
