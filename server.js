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

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
};

fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(dbPath) && fs.existsSync(legacyDbPath)) {
  fs.copyFileSync(legacyDbPath, dbPath);
}

function send(res, status, body = "", headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

function sendJson(res, status, body) {
  send(res, status, JSON.stringify(body), { "Content-Type": "application/json; charset=utf-8" });
}

function handleDatabaseGet(res) {
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

    const tempPath = `${dbPath}.tmp`;
    fs.writeFile(tempPath, body, (writeError) => {
      if (writeError) {
        send(res, 500, "save failed");
        return;
      }
      fs.rename(tempPath, dbPath, (renameError) => {
        if (renameError) {
          send(res, 500, "save failed");
          return;
        }
        send(res, 204);
      });
    });
  });

  req.on("error", () => send(res, 500, "request failed"));
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
  if (req.url === "/healthz") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.url === "/api/db" && req.method === "GET") {
    handleDatabaseGet(res);
    return;
  }

  if (req.url === "/api/db" && req.method === "POST") {
    handleDatabasePost(req, res);
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
  console.log(`Database path: ${dbPath}`);
});
