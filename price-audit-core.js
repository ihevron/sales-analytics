const PRODUCT_BARCODE_COLUMNS = ["barcode", "bar_code", "product_barcode", "ברקוד"];
const PRODUCT_ITEM_CODE_COLUMNS = ["sku", "item_code", "itemCode", "מק\"ט", "מקט"];

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

function createPriceAuditService(options = {}) {
  const supabaseUrl = normalizeSupabaseUrl(options.supabaseUrl || process.env.SUPABASE_POSTGRES_URL || process.env.SUPABASE_URL || "");
  const serviceKey = options.serviceKey || process.env.SUPABASE_POSTGRES_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";

  function isConfigured() {
    return Boolean(supabaseUrl && serviceKey);
  }

  function headers(extra = {}) {
    const result = {
      apikey: serviceKey,
      ...extra,
    };
    if (!serviceKey.startsWith("sb_secret_")) {
      result.Authorization = `Bearer ${serviceKey}`;
    }
    return result;
  }

  async function rest(pathname, fetchOptions = {}) {
    if (!isConfigured()) {
      const error = new Error("Supabase server credentials are not configured");
      error.status = 503;
      throw error;
    }

    const response = await fetch(`${supabaseUrl}/rest/v1/${pathname}`, {
      ...fetchOptions,
      headers: headers(fetchOptions.headers || {}),
    });
    if (!response.ok) {
      const error = new Error(`Supabase request failed: ${response.status} ${await response.text()}`);
      error.status = response.status;
      throw error;
    }
    return response;
  }

  async function rows(pathname) {
    const response = await rest(pathname);
    return response.json();
  }

  async function findProductByColumn(column, value) {
    if (!value) return null;
    const encodedColumn = encodeURIComponent(column);
    const encodedValue = encodeURIComponent(String(value).trim());
    try {
      const result = await rows(`products?select=*&${encodedColumn}=eq.${encodedValue}&limit=1`);
      return result[0] || null;
    } catch (error) {
      if (error.status === 400 || error.status === 404) return null;
      throw error;
    }
  }

  async function findProduct(input = {}) {
    const barcode = String(input.barcode || "").trim();
    const itemCode = String(input.itemCode || input.item_code || "").trim();

    if (barcode) {
      for (const column of PRODUCT_BARCODE_COLUMNS) {
        const row = await findProductByColumn(column, barcode);
        if (row) return { match_type: "barcode_exact", product: normalizeProduct(row) };
      }
    }

    if (itemCode) {
      for (const column of PRODUCT_ITEM_CODE_COLUMNS) {
        const row = await findProductByColumn(column, itemCode);
        if (row) return { match_type: "item_code", product: normalizeProduct(row) };
      }
    }

    return { match_type: "not_found", product: null };
  }

  async function batchProducts(items) {
    const safeItems = Array.isArray(items) ? items.slice(0, 100) : [];
    const results = [];
    for (const item of safeItems) {
      const input = {
        barcode: String(item?.barcode || "").trim(),
        itemCode: String(item?.itemCode || item?.item_code || "").trim(),
      };
      const result = await findProduct(input);
      results.push({ input, match_type: result.match_type, product: result.product });
    }
    return results;
  }

  async function supplierRules(supplier) {
    const supplierName = String(supplier || "").trim();
    const supplierFilter = supplierName ? `&supplier_name=eq.${encodeURIComponent(supplierName)}` : "";
    return rows(`supplier_rules?select=*&is_active=eq.true${supplierFilter}&order=priority.asc,rule_name.asc`);
  }

  return { isConfigured, findProduct, batchProducts, supplierRules };
}

function normalizeProduct(row = {}) {
  return {
    item_code: valueFrom(row, ["sku", "item_code", "itemCode", "מק\"ט", "מקט"]),
    barcode: valueFrom(row, PRODUCT_BARCODE_COLUMNS),
    product_name: valueFrom(row, ["description", "product_name", "name", "תיאור", "תאור", "שם מוצר"]),
    standard_cost: numberValue(valueFrom(row, ["standard_cost", "standardCost", "עלות תקן", "עלות תקן ש\"ח"])),
    supplier_name: valueFrom(row, ["supplier", "supplier_name", "שם ספק", "ספק"]),
  };
}

function valueFrom(row, keys) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null) return String(row[key]).trim();
  }
  return "";
}

function numberValue(value) {
  const parsed = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function isAuthorized(req, apiKey) {
  if (!apiKey) return true;
  const headerKey = req.headers["x-api-key"];
  const auth = String(req.headers.authorization || "");
  return headerKey === apiKey || auth === `Bearer ${apiKey}`;
}

module.exports = {
  createPriceAuditService,
  isAuthorized,
};
