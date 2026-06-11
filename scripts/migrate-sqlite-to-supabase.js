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
        const batch = rows.slice(index, index + batchSize).map((row) => normalizeRow(row));
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

function normalizeRow(row) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => {
    if (value === undefined || value === "") return [key, null];
    return [key, value];
  }));
}

async function upsertRows(table, rows) {
  if (!rows.length) return;
  const response = await fetch(`${supabaseUrl}/rest/v1/${table}`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify(rows),
  });

  if (!response.ok) {
    throw new Error(`${table} upsert failed: ${response.status} ${await response.text()}`);
  }
}
