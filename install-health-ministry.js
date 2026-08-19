// Installs the Ministry of Health Excel page during the Docker build.
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

function joinPayload(fileNames) {
  return fileNames
    .map((fileName) => fs.readFileSync(path.join(__dirname, fileName), "utf8").trim())
    .join("");
}

const legacyPayloadFiles = Array.from({ length: 9 }, (_, index) =>
  `health-ministry-payload-${String(index).padStart(2, "0")}.txt`,
);
const legacyPayload = joinPayload(legacyPayloadFiles);
const legacyFiles = JSON.parse(zlib.gunzipSync(Buffer.from(legacyPayload, "base64")).toString("utf8"));

for (const [relativePath, content] of Object.entries(legacyFiles)) {
  const target = path.join(__dirname, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
}

const v3PayloadFiles = Array.from({ length: 7 }, (_, index) =>
  `health-ministry-v3-assets-${String(index).padStart(2, "0")}.txt`,
);
const v3Payload = joinPayload(v3PayloadFiles);
const v3Files = JSON.parse(zlib.gunzipSync(Buffer.from(v3Payload, "base64")).toString("utf8"));
for (const [relativePath, content] of Object.entries(v3Files)) {
  const target = path.join(__dirname, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
}

const templatePayloadFiles = Array.from({ length: 5 }, (_, index) =>
  `health-ministry-template-gzip-${String(index).padStart(2, "0")}.txt`,
);
const templateGzipBase64 = joinPayload(templatePayloadFiles);
fs.writeFileSync(
  path.join(__dirname, "management", "health-ministry-template.xlsx"),
  zlib.gunzipSync(Buffer.from(templateGzipBase64, "base64")),
);

const indexPath = path.join(__dirname, "management", "index.html");
let html = fs.readFileSync(indexPath, "utf8");

if (!html.includes("health-ministry-nav.css")) {
  const marker = "  </head>";
  if (!html.includes(marker)) throw new Error("Could not find </head> in management/index.html");
  html = html.replace(marker, `    <link rel="stylesheet" href="./health-ministry-nav.css?v=20260819supabase1" />\n${marker}`);
}

if (!html.includes("data-health-ministry-link")) {
  const marker = "        </nav>";
  if (!html.includes(marker)) throw new Error("Could not find </nav> in management/index.html");
  const link = `          <a class="health-ministry-nav-item" data-health-ministry-link href="./health-ministry.html"><span>🧾</span>קובץ משרד הבריאות</a>`;
  html = html.replace(marker, `${link}\n${marker}`);
}

fs.writeFileSync(indexPath, html, "utf8");
for (const fileName of [...legacyPayloadFiles, ...v3PayloadFiles, ...templatePayloadFiles]) {
  fs.rmSync(path.join(__dirname, fileName), { force: true });
}
console.log(`Installed Ministry of Health page (${Object.keys(legacyFiles).length} legacy assets + ${Object.keys(v3Files).length} Supabase v3 assets)`);
