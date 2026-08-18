// Installs the Ministry of Health Excel page during the Docker build.
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const payloadFiles = Array.from({ length: 9 }, (_, index) =>
  `health-ministry-payload-${String(index).padStart(2, "0")}.txt`,
);
const payload = payloadFiles
  .map((fileName) => fs.readFileSync(path.join(__dirname, fileName), "utf8").trim())
  .join("");
const files = JSON.parse(zlib.gunzipSync(Buffer.from(payload, "base64")).toString("utf8"));

for (const [relativePath, content] of Object.entries(files)) {
  const target = path.join(__dirname, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
}

const indexPath = path.join(__dirname, "management", "index.html");
let html = fs.readFileSync(indexPath, "utf8");

if (!html.includes("health-ministry-nav.css")) {
  const marker = "  </head>";
  if (!html.includes(marker)) throw new Error("Could not find </head> in management/index.html");
  html = html.replace(marker, `    <link rel="stylesheet" href="./health-ministry-nav.css?v=20260818b" />\n${marker}`);
}

if (!html.includes("data-health-ministry-link")) {
  const marker = "        </nav>";
  if (!html.includes(marker)) throw new Error("Could not find </nav> in management/index.html");
  const link = `          <a class="health-ministry-nav-item" data-health-ministry-link href="./health-ministry.html"><span>🧾</span>קובץ משרד הבריאות</a>`;
  html = html.replace(marker, `${link}\n${marker}`);
}

fs.writeFileSync(indexPath, html, "utf8");
for (const fileName of payloadFiles) fs.rmSync(path.join(__dirname, fileName), { force: true });
console.log(`Installed Ministry of Health page (${Object.keys(files).length} assets)`);