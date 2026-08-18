// Installs the Ministry of Health Excel page during the Docker build.
const fs = require("fs");
const path = require("path");

const sourceDir = path.join(__dirname, "health-ministry-src");
const managementDir = path.join(__dirname, "management");
const assetNames = fs.readdirSync(sourceDir).filter((name) => name.startsWith("health-ministry"));

for (const name of assetNames) {
  const source = path.join(sourceDir, name);
  const target = path.join(managementDir, name);
  if (!fs.statSync(source).isFile()) continue;
  fs.copyFileSync(source, target);
}

const indexPath = path.join(managementDir, "index.html");
let html = fs.readFileSync(indexPath, "utf8");

if (!html.includes("health-ministry-nav.css")) {
  const marker = "  </head>";
  if (!html.includes(marker)) throw new Error("Could not find </head> in management/index.html");
  html = html.replace(marker, `    <link rel="stylesheet" href="./health-ministry-nav.css?v=20260818c" />\n${marker}`);
}

if (!html.includes("data-health-ministry-link")) {
  const marker = "        </nav>";
  if (!html.includes(marker)) throw new Error("Could not find </nav> in management/index.html");
  const link = `          <a class="health-ministry-nav-item" data-health-ministry-link href="./health-ministry.html"><span>🧾</span>קובץ משרד הבריאות</a>`;
  html = html.replace(marker, `${link}\n${marker}`);
}

fs.writeFileSync(indexPath, html, "utf8");
console.log(`Installed Ministry of Health page (${assetNames.length} assets)`);
