const http = require("http");
const fs = require("fs");
const path = require("path");

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
let SQLRuntimePromise = null;
let dbMutationQueue = Promise.resolve();

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

async function readDatabaseFromSupabase() {
  const response = await fetch(supabaseObjectUrl(), {
    headers: supabaseHeaders(),
  });

  if (!response.ok) {
    const error = new Error(`supabase read failed: ${response.status}`);
    error.status = response.status;
    throw error;
  }

  return Buffer.from(await response.arrayBuffer());
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
  return fs.promises.readFile(dbPath);
}

async function writeCurrentDatabaseBuffer(body) {
  if (useSupabase) return writeDatabaseToSupabase(body);
  await fs.promises.writeFile(`${dbPath}.tmp`, body);
  await fs.promises.rename(`${dbPath}.tmp`, dbPath);
}

function enqueueDbMutation(task) {
  const run = dbMutationQueue.then(task, task);
  dbMutationQueue = run.catch(() => {});
  return run;
}

async function handleDatabaseGet(res) {
  if (useSupabase) {
    try {
      const data = await readDatabaseFromSupabase();
      send(res, 200, data, {
        "Content-Type": "application/octet-stream",
        "Cache-Control": "no-store",
      });
    } catch (error) {
      send(res, error.status === 404 ? 404 : 500, error.status === 404 ? "" : "database read failed");
    }
    return;
  }

  fs.readFile(dbPath, (error, data) => {
    if (error) {
      send(res, 404);
      return;
    }
    send(res, 200, data, {
      "Content-Type": "application/octet-stream",
      "Cache-Control": "no-store",
    });
  });
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
    if (size > 1024 * 1024) {
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
      sendJson(res, 500, { ok: false, error: error.message || "save failed" });
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
    sendJson(res, 200, { ok: true, applied: changes.length });
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
    const exported = Buffer.from(db.export());
    await writeCurrentDatabaseBuffer(exported);
    sendJson(res, 200, { ok: true, orderId, applied: 1 });
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
    const immutable = ext === ".js" || ext === ".css";
    send(res, 200, data, {
      "Content-Type": types[ext] || "application/octet-stream",
      "Cache-Control": immutable ? "public, max-age=300" : "no-store",
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
