const http = require("http");
const fs = require("fs");
const path = require("path");
const initSqlJs = require("sql.js");

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
let SQLRuntimePromise = null;

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
      writeDatabaseToSupabase(body)
        .then(() => send(res, 204))
        .catch((error) => {
          console.error(error);
          send(res, 500, error.message || "save failed");
        });
      return;
    }

    writeDatabaseToDisk(body, (error) => {
      if (error) {
        send(res, 500, "save failed");
        return;
      }
      send(res, 204);
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
    handleJsonPost(req, res, (payload) => handlePickingChanges(payload, res));
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
