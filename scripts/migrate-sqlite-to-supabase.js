const fs = require("fs");
const path = require("path");
const initSqlJs = require("sql.js");

const root = path.resolve(__dirname, "..");
const dbPath = path.resolve(process.env.SQLITE_DB_PATH || path.join(root, "data", "sales-analytics.sqlite"));
const supabaseUrl = normalizeUrl(process.env.SUPABASE_URL || "");
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const batchSize = Number(process.env.SUPABASE_MIGRATION_BATCH || 1000);

const tableOrder = [
  "products",
  "sales_recommendations",
  "customer_call_profiles",
  "customer_orders",
  "customer_order_items",
  "customer_calls",
  "sales_raw",
];

const tableColumns = {
  products: ["sku", "description", "category", "standard_cost", "sale_price", "weight", "supplier", "updated_at"],
  sales_recommendations: ["id", "text", "active"],
  customer_call_profiles: ["customer_no", "customer_name", "phone", "address", "call_days", "source", "updated_at"],
  customer_orders: ["id", "order_date", "customer_no", "customer_name", "status", "notes", "estimated_total", "estimated_profit", "picked_by", "picked_at", "invoice_printed", "shipped_at", "process_hidden", "client_order_key", "updated_at"],
  customer_order_items: ["id", "order_id", "sku", "product_desc", "quantity", "picked_quantity", "note", "item_status", "substitute_product_id", "action_sequence", "entry_sequence", "is_carton", "units_per_carton", "shortage_dismissed", "estimated_price", "estimated_profit"],
  customer_calls: ["id", "call_date", "customer_no", "customer_name", "status", "call_again_time", "whatsapp_sent_at", "manual_order_id", "notes", "updated_at"],
  sales_raw: ["id", "sale_date", "customer_no", "customer_name", "sku", "product_desc", "quantity", "amount", "cost", "profit", "supplier", "category", "return_units", "purchase_units", "agent"],
};

const columnAliases = {
  products: {
    sale_price: "base_price",
  },
  customer_call_profiles: {
    call_days: "days",
  },
  sales_raw: {
    amount: "sales_amount",
  },
};

const upsertKeys = {
  products: "sku",
  sales_recommendations: "id",
  customer_call_profiles: "customer_no",
  customer_orders: "id",
  customer_order_items: "id",
  customer_calls: "id",
  sales_raw: "id",
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  if (!supabaseUrl || !serviceKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  if (!fs.existsSync(dbPath)) {
    throw new Error(`SQLite DB not found: ${dbPath}`);
  }

  const SQL = await initSqlJs({
    locateFile: (file) => path.join(root, "node_modules", "sql.js", "dist", file),
  });
  const db = new SQL.Database(new Uint8Array(fs.readFileSync(dbPath)));

  try {
    for (const table of tableOrder) {
      if (!tableExists(db, table)) {
        console.log(`skip ${table}: missing in SQLite`);
        continue;
      }
      const rows = queryRows(db, `SELECT * FROM ${table}`);
      console.log(`migrating ${table}: ${rows.length} rows`);
      for (let index = 0; index < rows.length; index += batchSize) {
        const batch = rows.slice(index, index + batchSize).map((row) => normalizeRow(table, row));
        await upsertRows(table, batch);
        console.log(`  ${table}: ${Math.min(index + batch.length, rows.length)}/${rows.length}`);
      }
    }
  } finally {
    db.close();
  }
}

function normalizeUrl(value) {
  return value.trim().replace(/\/+$/, "");
}

function tableExists(db, table) {
  const result = queryRows(db, "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", [table]);
  return result.length > 0;
}

function queryRows(db, sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function normalizeRow(table, row) {
  const aliases = columnAliases[table] || {};
  const columns = tableColumns[table] || Object.keys(row);
  return Object.fromEntries(columns.map((key) => {
    const sourceKey = aliases[key] || key;
    const value = row[sourceKey];
    if (value === undefined || value === "") return [key, null];
    return [key, value];
  }));
}

async function upsertRows(table, rows) {
  if (!rows.length) return;
  const conflictKey = upsertKeys[table];
  const tableUrl = `${supabaseUrl}/rest/v1/${table}${conflictKey ? `?on_conflict=${encodeURIComponent(conflictKey)}` : ""}`;
  const response = await fetch(tableUrl, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(rows),
  });

  if (!response.ok) {
    throw new Error(`${table} upsert failed: ${response.status} ${await response.text()}`);
  }
}
