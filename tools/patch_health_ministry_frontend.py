from pathlib import Path

HTML_PATH = Path("health-ministry-src/health-ministry.html")
CSS_PATH = Path("health-ministry-src/health-ministry.css")
JS_PATH = Path("health-ministry-src/health-ministry.js")


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f"{label}: marker not found")
    return text.replace(old, new, 1)


def replace_between(text, start, end, replacement, label):
    start_index = text.find(start)
    if start_index < 0:
        raise SystemExit(f"{label}: start marker not found")
    end_index = text.find(end, start_index)
    if end_index < 0:
        raise SystemExit(f"{label}: end marker not found")
    return text[:start_index] + replacement + text[end_index:]


html = HTML_PATH.read_text(encoding="utf-8")
html = html.replace("20260818b", "20260818c")

old_notice = '''        <section class="notice-card">
          <strong>הקבצים מעובדים בדפדפן בלבד.</strong>
          <span>קובצי הלקוחות והמשלוחים אינם נשמרים בשרת. רשימת החסימות נשמרת בדפדפן עד שתשנה או תמחק אותה.</span>
        </section>'''
new_notice = '''        <section class="notice-card cloud-notice">
          <div>
            <strong>הנתונים הקבועים נשמרים ב־Supabase ומשותפים לכל המחשבים.</strong>
            <span>רשימת הלקוחות, רשימת הערים, פרטי הדיווח וכללי החסימה נשמרים במערכת. קובץ המשלוחים בלבד מעובד בדפדפן ואינו נשמר.</span>
          </div>
          <div class="cloud-toolbar">
            <span id="cloud-status" class="cloud-status loading">מתחבר ל־Supabase...</span>
            <button id="reload-cloud-button" class="ghost-button" type="button">רענון נתונים</button>
          </div>
        </section>'''
html = replace_once(html, old_notice, new_notice, "notice")

html = html.replace(
    "<p>התאריך מתמלא אוטומטית לפי שעון ישראל. שאר הפרטים נשמרים לפעם הבאה בדפדפן זה.</p>",
    "<p>התאריך מתמלא אוטומטית לפי שעון ישראל. שאר הפרטים נשמרים ב־Supabase וזמינים בכל מחשב.</p>",
    1,
)

fixed_form_end = '''            <label>סבב יומי<input id="daily-round" type="text" required /></label>
          </form>'''
fixed_form_replacement = '''            <label>סבב יומי<input id="daily-round" type="text" required /></label>
          </form>
          <div class="cloud-actions">
            <button id="save-fixed-button" class="secondary-button" type="button">שמירת הנתונים הקבועים</button>
            <span id="fixed-cloud-status" class="cloud-status">השינויים נשמרים אוטומטית לאחר ההקלדה</span>
          </div>'''
html = replace_once(html, fixed_form_end, fixed_form_replacement, "fixed form actions")

html = html.replace(
    "<p>ניתן להעלות XLSX, XLS או CSV. האפליקציה מאתרת אוטומטית את שורת הכותרות.</p>",
    "<p>את קובצי הלקוחות והערים מעלים פעם אחת או בכל עדכון; הם נשמרים ב־Supabase. בכל הפקה חדשה צריך לבחור רק קובץ משלוחים.</p>",
    1,
)
html = html.replace(
    "<small>A מספר לקוח · B שם · E ח״פ · O כתובת · P עיר</small>",
    "<small>A מספר לקוח · B שם · E ח״פ · O כתובת · P עיר · נשמר ב־Supabase</small>",
    1,
)
html = html.replace(
    "<small>A שם עיר · B קוד עיר</small>",
    "<small>A שם עיר · B קוד עיר · נשמר ב־Supabase</small>",
    1,
)
html = html.replace(
    "<p>חסימה פעילה תחול על כל תעודות המשלוח של הלקוח. אפשר להוציא אותו מהדוח לחלוטין או לדווח במקומו לקוח חליפי.</p>",
    "<p>הכללים נשמרים ב־Supabase וזמינים בכל מחשב. חסימה פעילה תחול על כל תעודות המשלוח של הלקוח, או תחליף אותו בלקוח אחר.</p>",
    1,
)
HTML_PATH.write_text(html, encoding="utf-8")

css = CSS_PATH.read_text(encoding="utf-8")
cloud_css = r'''

/* Shared Supabase state */
.cloud-notice {
  align-items: center;
  justify-content: space-between;
  gap: 18px;
}

.cloud-notice > div:first-child {
  display: grid;
  gap: 5px;
}

.cloud-toolbar,
.cloud-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.cloud-toolbar {
  justify-content: flex-end;
  flex: 0 0 auto;
}

.cloud-actions {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--line, #e2e8f0);
}

.cloud-status {
  display: inline-flex;
  align-items: center;
  min-height: 34px;
  padding: 7px 11px;
  border-radius: 999px;
  background: #f1f5f9;
  color: #475569;
  font-size: 13px;
  font-weight: 700;
}

.cloud-status.loading {
  background: #eff6ff;
  color: #1d4ed8;
}

.cloud-status.ok {
  background: #dcfce7;
  color: #166534;
}

.cloud-status.warn {
  background: #fef3c7;
  color: #92400e;
}

.cloud-status.error {
  background: #fee2e2;
  color: #991b1b;
}

@media (max-width: 760px) {
  .cloud-notice {
    align-items: flex-start;
  }

  .cloud-toolbar,
  .cloud-actions {
    width: 100%;
    justify-content: flex-start;
  }
}
'''
if "/* Shared Supabase state */" not in css:
    css += cloud_css
CSS_PATH.write_text(css, encoding="utf-8")

js = JS_PATH.read_text(encoding="utf-8")
js = replace_once(
    js,
    '''  shipmentRows: null,
  rules: [],''',
    '''  shipmentRows: null,
  customerIssues: [],
  cityIssues: [],
  rules: [],
  datasetMeta: { customers: null, cities: null },
  cloudLoaded: false,
  fixedSaveTimer: null,''',
    "state cloud fields",
)

cloud_block = r'''function loadRules() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEYS.rules) || "[]");
    return Array.isArray(parsed) ? parsed.map(sanitizeRule).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function saveRules() {
  localStorage.setItem(STORAGE_KEYS.rules, JSON.stringify(state.rules));
}

const HEALTH_MINISTRY_API = "/api/health-ministry";

async function healthMinistryApi(pathname, options = {}) {
  const response = await fetch(`${HEALTH_MINISTRY_API}${pathname}`, {
    cache: "no-store",
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  const raw = await response.text();
  let body = null;
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    body = { error: raw };
  }
  if (!response.ok || body?.ok === false) {
    throw new Error(body?.error || body?.message || `שגיאת שרת ${response.status}`);
  }
  return body || {};
}

function setCloudStatus(message, statusClass = "") {
  const element = document.getElementById("cloud-status");
  if (!element) return;
  element.textContent = message;
  element.className = `cloud-status ${statusClass}`.trim();
}

function setFixedCloudStatus(message, statusClass = "") {
  const element = document.getElementById("fixed-cloud-status");
  if (!element) return;
  element.textContent = message;
  element.className = `cloud-status ${statusClass}`.trim();
}

function hasMeaningfulFixedFields(value = {}) {
  return [
    value.supplierName,
    value.supplierVat,
    value.healthLicense,
    value.vehicleNumber,
    value.driverName,
    value.driverPhone,
    value.dailyRound,
  ].some((item) => text(item));
}

function hydrateCloudCustomer(row, index = 0) {
  const name = text(row?.name || row?.customerName || row?.customer_name);
  return {
    sourceRow: Number(row?.sourceRow) || index + 2,
    customerNumber: identifierText(row?.customerNumber || row?.customer_number),
    name,
    vat: identifierText(row?.vat || row?.vatNumber || row?.vat_number, 9),
    address: text(row?.address),
    city: text(row?.city || row?.cityName || row?.city_name),
    strictKey: normalizeCustomerKey(name),
    looseKey: normalizeCustomerKey(row?.looseKey || row?.normalizedName || row?.normalized_name || name, true),
  };
}

function hydrateCloudCity(row, index = 0) {
  const name = text(row?.name || row?.cityName || row?.city_name);
  return {
    sourceRow: Number(row?.sourceRow) || index + 2,
    name,
    code: identifierText(row?.code || row?.cityCode || row?.city_code),
    key: normalizeKey(row?.key || row?.cityKey || row?.city_key || name),
  };
}

function refreshCloudDatasetStatuses() {
  const customerMeta = state.datasetMeta.customers;
  const cityMeta = state.datasetMeta.cities;
  if (state.customers.length) {
    const suffix = customerMeta?.fileName ? ` · ${customerMeta.fileName}` : "";
    setFileStatus("customers", `Supabase · ${state.customers.length} לקוחות${suffix}`, "ok");
  } else {
    setFileStatus("customers", "אין רשימת לקוחות שמורה – יש להעלות פעם אחת", "error");
  }
  if (state.cities.length) {
    const suffix = cityMeta?.fileName ? ` · ${cityMeta.fileName}` : "";
    setFileStatus("cities", `Supabase · ${state.cities.length} ערים${suffix}`, "ok");
  } else {
    setFileStatus("cities", "אין רשימת ערים שמורה – יש להעלות פעם אחת", "error");
  }
}

async function saveFixedFieldsToCloud({ silent = false } = {}) {
  if (state.fixedSaveTimer) {
    clearTimeout(state.fixedSaveTimer);
    state.fixedSaveTimer = null;
  }
  saveFixedFieldsLocal();
  const { reportDate, ...settings } = fixedFieldsFromForm();
  if (!silent) setFixedCloudStatus("שומר ב־Supabase...", "loading");
  try {
    const response = await healthMinistryApi("/settings", {
      method: "POST",
      body: JSON.stringify({ settings }),
    });
    state.cloudLoaded = true;
    const time = new Date().toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
    setFixedCloudStatus(`נשמר ב־Supabase בשעה ${time}`, "ok");
    return response.settings || settings;
  } catch (error) {
    setFixedCloudStatus(`השמירה נכשלה: ${error.message}`, "error");
    if (!silent) throw error;
    return null;
  }
}

async function replaceCustomersInCloud(customers, fileName) {
  const response = await healthMinistryApi("/customers/replace", {
    method: "POST",
    body: JSON.stringify({ customers, fileName }),
  });
  state.datasetMeta.customers = {
    fileName: text(fileName),
    rowCount: Number(response.imported) || customers.length,
    updatedAt: new Date().toISOString(),
  };
  return response;
}

async function replaceCitiesInCloud(cities, fileName) {
  const response = await healthMinistryApi("/cities/replace", {
    method: "POST",
    body: JSON.stringify({ cities, fileName }),
  });
  state.datasetMeta.cities = {
    fileName: text(fileName),
    rowCount: Number(response.imported) || cities.length,
    updatedAt: new Date().toISOString(),
  };
  return response;
}

async function upsertRuleInCloud(rule) {
  const response = await healthMinistryApi("/rules/upsert", {
    method: "POST",
    body: JSON.stringify({ rule }),
  });
  return sanitizeRule(response.rule || rule);
}

async function deleteRuleFromCloud(id) {
  return healthMinistryApi("/rules/delete", {
    method: "POST",
    body: JSON.stringify({ id }),
  });
}

async function replaceRulesInCloud(rules) {
  return healthMinistryApi("/rules/replace", {
    method: "POST",
    body: JSON.stringify({ rules }),
  });
}

function applyCloudPayload(payload = {}) {
  state.customers = (Array.isArray(payload.customers) ? payload.customers : [])
    .map(hydrateCloudCustomer)
    .filter((customer) => customer.name);
  state.cities = (Array.isArray(payload.cities) ? payload.cities : [])
    .map(hydrateCloudCity)
    .filter((city) => city.name && city.code);
  state.rules = (Array.isArray(payload.rules) ? payload.rules : [])
    .map(sanitizeRule)
    .filter(Boolean);
  state.datasetMeta = {
    customers: payload.meta?.customers || null,
    cities: payload.meta?.cities || null,
  };
  if (payload.settings) applyFixedFields(payload.settings);
  saveRules();
  updateCustomerDatalist();
  renderRules();
  refreshCloudDatasetStatuses();
}

async function loadCloudData({ migrateLocal = true } = {}) {
  const localFixed = readLocalFixedFields();
  const localRules = state.rules.slice();
  setCloudStatus("טוען נתונים מ־Supabase...", "loading");
  const payload = await healthMinistryApi("/bootstrap");

  if (migrateLocal && !hasMeaningfulFixedFields(payload.settings) && hasMeaningfulFixedFields(localFixed)) {
    try {
      const saved = await healthMinistryApi("/settings", {
        method: "POST",
        body: JSON.stringify({ settings: localFixed }),
      });
      payload.settings = saved.settings || localFixed;
    } catch (error) {
      console.warn("לא ניתן היה להעביר את הנתונים הקבועים המקומיים ל-Supabase", error);
    }
  }

  if (migrateLocal && (!Array.isArray(payload.rules) || !payload.rules.length) && localRules.length) {
    try {
      await replaceRulesInCloud(localRules);
      payload.rules = localRules;
    } catch (error) {
      console.warn("לא ניתן היה להעביר את רשימת החסומים המקומית ל-Supabase", error);
    }
  }

  applyCloudPayload(payload);
  state.cloudLoaded = true;
  const updated = [payload.meta?.customers?.updatedAt, payload.meta?.cities?.updatedAt]
    .filter(Boolean)
    .sort()
    .pop();
  setCloudStatus(
    `מחובר ל־Supabase · ${state.customers.length} לקוחות · ${state.cities.length} ערים${updated ? ` · עודכן ${displayDateTime(updated)}` : ""}`,
    state.customers.length && state.cities.length ? "ok" : "warn",
  );
  setFixedCloudStatus(hasMeaningfulFixedFields(payload.settings) ? "הנתונים הקבועים נטענו מ־Supabase" : "טרם נשמרו נתונים קבועים", hasMeaningfulFixedFields(payload.settings) ? "ok" : "warn");
  return payload;
}

'''
js = replace_between(js, "function loadRules() {", "function ruleMatches(", cloud_block + "function ruleMatches(", "cloud functions")

fixed_block = r'''function readLocalFixedFields() {
  let saved = null;
  for (const key of [STORAGE_KEYS.fixed, ...LEGACY_FIXED_KEYS]) {
    try {
      const value = localStorage.getItem(key);
      if (value) {
        saved = JSON.parse(value);
        if (saved && typeof saved === "object") break;
      }
    } catch {
      saved = null;
    }
  }
  return {
    supplierName: saved?.supplierName || saved?.supplier_name || "",
    supplierVat: saved?.supplierVat || saved?.supplier_vat || "",
    healthLicense: saved?.healthLicense || saved?.health_license || "",
    vehicleNumber: saved?.vehicleNumber || saved?.vehicle_number || "",
    driverName: saved?.driverName || saved?.driver_name || "",
    driverPhone: saved?.driverPhone || saved?.driver_phone || "",
    customerType: saved?.customerType || saved?.customer_type || "קמעונאי",
    dailyRound: saved?.dailyRound || saved?.daily_round || "",
  };
}

function applyFixedFields(saved = {}) {
  const mapping = {
    "supplier-name": saved.supplierName || saved.supplier_name || "",
    "supplier-vat": saved.supplierVat || saved.supplier_vat || "",
    "health-license": saved.healthLicense || saved.health_license || "",
    "vehicle-number": saved.vehicleNumber || saved.vehicle_number || "",
    "driver-name": saved.driverName || saved.driver_name || "",
    "driver-phone": saved.driverPhone || saved.driver_phone || "",
    "customer-type": saved.customerType || saved.customer_type || "קמעונאי",
    "daily-round": saved.dailyRound || saved.daily_round || "",
  };
  Object.entries(mapping).forEach(([id, value]) => {
    const element = document.getElementById(id);
    if (element && value !== undefined) element.value = value;
  });
  const reportDate = document.getElementById("report-date");
  if (reportDate) reportDate.value = todayIsraelISO();
}

function loadFixedFields() {
  applyFixedFields(readLocalFixedFields());
}

function saveFixedFieldsLocal() {
  const fixed = fixedFieldsFromForm();
  const { reportDate, ...persistent } = fixed;
  localStorage.setItem(STORAGE_KEYS.fixed, JSON.stringify(persistent));
}

function scheduleFixedFieldsSave(delay = 900) {
  if (!state.cloudLoaded) return;
  if (state.fixedSaveTimer) clearTimeout(state.fixedSaveTimer);
  state.fixedSaveTimer = setTimeout(() => {
    state.fixedSaveTimer = null;
    saveFixedFieldsToCloud({ silent: true });
  }, delay);
  setFixedCloudStatus("ממתין לשמירה אוטומטית...", "loading");
}

function saveFixedFields() {
  saveFixedFieldsLocal();
  scheduleFixedFieldsSave();
}

'''
js = replace_between(js, "function loadFixedFields() {", "function updateCustomerDatalist() {", fixed_block + "function updateCustomerDatalist() {", "fixed fields functions")

file_change_block = r'''async function handleFileChange(kind) {
  const file = document.getElementById(`${kind}-file`).files[0];
  if (!file) {
    if (kind === "customers" || kind === "cities") refreshCloudDatasetStatuses();
    else setFileStatus(kind, "לא נבחר קובץ");
    return;
  }
  setFileStatus(kind, "קורא קובץ...");
  try {
    const rows = await readFileRows(file);
    if (kind === "customers") {
      state.customerRows = rows;
      const parsed = parseCustomers(rows);
      if (!parsed.customers.length) throw new Error("לא נמצאו לקוחות תקינים בקובץ.");
      state.customers = parsed.customers;
      state.customerIssues = parsed.issues;
      updateCustomerDatalist();
      setFileStatus(kind, `${file.name} · ${state.customers.length} לקוחות · שומר ב־Supabase...`, "loading");
      await replaceCustomersInCloud(state.customers, file.name);
      setFileStatus(kind, `נשמר ב־Supabase · ${state.customers.length} לקוחות · ${file.name}`, "ok");
      setCloudStatus(`רשימת הלקוחות עודכנה ב־Supabase (${state.customers.length})`, "ok");
    } else if (kind === "cities") {
      state.cityRows = rows;
      const parsed = parseCities(rows);
      if (!parsed.cities.length) throw new Error("לא נמצאו ערים תקינות בקובץ.");
      state.cities = parsed.cities;
      state.cityIssues = parsed.issues;
      setFileStatus(kind, `${file.name} · ${state.cities.length} ערים · שומר ב־Supabase...`, "loading");
      await replaceCitiesInCloud(state.cities, file.name);
      setFileStatus(kind, `נשמר ב־Supabase · ${state.cities.length} ערים · ${file.name}`, "ok");
      setCloudStatus(`רשימת הערים עודכנה ב־Supabase (${state.cities.length})`, "ok");
    } else {
      state.shipmentRows = rows;
      const parsed = parseShipments(rows);
      state.shipments = parsed.shipments;
      setFileStatus(kind, `${file.name} · ${state.shipments.length} תעודות · לא נשמר בשרת`, "ok");
    }
  } catch (error) {
    setFileStatus(kind, error.message || "קריאת הקובץ נכשלה", "error");
  }
}

'''
js = replace_between(js, "async function handleFileChange(kind) {", "function resetRuleForm() {", file_change_block + "function resetRuleForm() {", "file change")

render_rules_block = r'''function renderRules() {
  const active = state.rules.filter((rule) => rule.active);
  document.getElementById("active-rules-count").textContent = active.length;
  document.getElementById("exclude-rules-count").textContent = active.filter((rule) => rule.action === "exclude").length;
  document.getElementById("replace-rules-count").textContent = active.filter((rule) => rule.action === "replace").length;
  const body = document.getElementById("rules-table-body");
  if (!state.rules.length) {
    body.innerHTML = `<tr><td colspan="7" class="empty-row">טרם הוגדרו לקוחות חסומים או חליפיים.</td></tr>`;
    return;
  }
  body.innerHTML = state.rules
    .slice()
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .map((rule) => `
      <tr>
        <td><span class="rule-status ${rule.active ? "active" : "inactive"}">${rule.active ? "פעיל" : "לא פעיל"}</span></td>
        <td>${escapeHtml(rule.sourceNumber ? `${rule.sourceNumber} · ${rule.sourceName}` : rule.sourceName)}</td>
        <td>${rule.action === "replace" ? "החלפה" : "לא לכלול"}</td>
        <td>${rule.action === "replace" ? escapeHtml(rule.replacementNumber ? `${rule.replacementNumber} · ${rule.replacementName}` : rule.replacementName) : "—"}</td>
        <td>${escapeHtml(rule.notes || "")}</td>
        <td>${escapeHtml(displayDateTime(rule.updatedAt))}</td>
        <td><div class="row-actions">
          <button class="small-button" type="button" data-rule-toggle="${escapeHtml(rule.id)}">${rule.active ? "השבתה" : "הפעלה"}</button>
          <button class="small-button" type="button" data-rule-edit="${escapeHtml(rule.id)}">עריכה</button>
          <button class="small-button danger" type="button" data-rule-delete="${escapeHtml(rule.id)}">מחיקה</button>
        </div></td>
      </tr>
    `).join("");

  body.querySelectorAll("[data-rule-toggle]").forEach((button) => button.addEventListener("click", async () => {
    const rule = state.rules.find((item) => item.id === button.dataset.ruleToggle);
    if (!rule) return;
    const previous = rule.active;
    rule.active = !rule.active;
    rule.updatedAt = new Date().toISOString();
    renderRules();
    try {
      const saved = await upsertRuleInCloud(rule);
      Object.assign(rule, saved || {});
      saveRules();
      renderRules();
      setCloudStatus("כלל החסימה נשמר ב־Supabase", "ok");
    } catch (error) {
      rule.active = previous;
      renderRules();
      alert(`שמירת הכלל נכשלה: ${error.message}`);
    }
  }));
  body.querySelectorAll("[data-rule-edit]").forEach((button) => button.addEventListener("click", () => {
    const rule = state.rules.find((item) => item.id === button.dataset.ruleEdit);
    if (!rule) return;
    document.getElementById("rule-id").value = rule.id;
    document.getElementById("rule-source").value = rule.sourceNumber ? `${rule.sourceNumber} · ${rule.sourceName}` : rule.sourceName;
    document.getElementById("rule-action").value = rule.action;
    document.getElementById("rule-replacement").value = rule.replacementNumber ? `${rule.replacementNumber} · ${rule.replacementName}` : rule.replacementName;
    document.getElementById("rule-notes").value = rule.notes;
    document.getElementById("replacement-field").classList.toggle("hidden", rule.action !== "replace");
    document.getElementById("rule-save-label").textContent = "שמירת שינויים";
    document.getElementById("rule-cancel-edit").classList.remove("hidden");
    document.getElementById("rule-source").focus();
  }));
  body.querySelectorAll("[data-rule-delete]").forEach((button) => button.addEventListener("click", async () => {
    const rule = state.rules.find((item) => item.id === button.dataset.ruleDelete);
    if (!rule || !confirm(`למחוק את הכלל עבור ${rule.sourceName || rule.sourceNumber}?`)) return;
    button.disabled = true;
    try {
      await deleteRuleFromCloud(rule.id);
      state.rules = state.rules.filter((item) => item.id !== rule.id);
      saveRules();
      renderRules();
      if (document.getElementById("rule-id").value === rule.id) resetRuleForm();
      setCloudStatus("הכלל נמחק מ־Supabase", "ok");
    } catch (error) {
      button.disabled = false;
      alert(`מחיקת הכלל נכשלה: ${error.message}`);
    }
  }));
}

async function saveRuleFromForm(event) {
  event.preventDefault();
  const submitButton = event.currentTarget.querySelector("button[type='submit']");
  const id = document.getElementById("rule-id").value;
  const sourceRaw = document.getElementById("rule-source").value;
  const action = document.getElementById("rule-action").value;
  const replacementRaw = document.getElementById("rule-replacement").value;
  const notes = document.getElementById("rule-notes").value;
  const sourceCustomer = parseCustomerChoice(sourceRaw);
  const replacementCustomer = action === "replace" ? parseCustomerChoice(replacementRaw) : null;
  const sourceName = sourceCustomer?.name || text(sourceRaw).replace(/^\s*[^·|]+\s*[·|]\s*/, "");
  const sourceNumber = sourceCustomer?.customerNumber || "";
  const replacementName = replacementCustomer?.name || text(replacementRaw).replace(/^\s*[^·|]+\s*[·|]\s*/, "");
  const replacementNumber = replacementCustomer?.customerNumber || "";

  if (!sourceName && !sourceNumber) return alert("יש להזין לקוח מקור.");
  if (action === "replace" && !replacementName && !replacementNumber) return alert("יש לבחור או להזין לקוח חליפי.");
  const sourceKey = normalizeCustomerKey(sourceName, true);
  const now = new Date().toISOString();
  const existingIndex = state.rules.findIndex((rule) => rule.id === id);
  const duplicateIndex = state.rules.findIndex((rule) => rule.id !== id && (
    (sourceNumber && rule.sourceNumber === sourceNumber)
    || (sourceKey && rule.sourceKey === sourceKey)
  ));
  const nextRule = sanitizeRule({
    id: id || state.rules[duplicateIndex]?.id,
    sourceNumber,
    sourceName,
    sourceKey,
    action,
    replacementNumber,
    replacementName,
    notes,
    active: true,
    createdAt: existingIndex >= 0 ? state.rules[existingIndex].createdAt : (duplicateIndex >= 0 ? state.rules[duplicateIndex].createdAt : now),
    updatedAt: now,
  });

  submitButton.disabled = true;
  try {
    const savedRule = await upsertRuleInCloud(nextRule);
    const finalRule = sanitizeRule(savedRule || nextRule);
    if (existingIndex >= 0) state.rules[existingIndex] = finalRule;
    else if (duplicateIndex >= 0) state.rules[duplicateIndex] = finalRule;
    else state.rules.push(finalRule);
    saveRules();
    renderRules();
    resetRuleForm();
    setCloudStatus("כלל החסימה נשמר ב־Supabase", "ok");
  } catch (error) {
    alert(`שמירת הכלל נכשלה: ${error.message}`);
  } finally {
    submitButton.disabled = false;
  }
}

'''
js = replace_between(js, "function renderRules() {", "function normalizeImportHeader(value) {", render_rules_block + "function normalizeImportHeader(value) {", "rules rendering")

import_rules_block = r'''async function importRulesFile() {
  const input = document.getElementById("rules-import-file");
  const file = input.files[0];
  if (!file) return;
  try {
    const rows = await readFileRows(file);
    const imported = readImportedRules(rows);
    const merged = state.rules.slice();
    imported.rules.forEach((rule) => {
      const index = merged.findIndex((existing) => (
        (rule.sourceNumber && existing.sourceNumber === rule.sourceNumber)
        || (rule.sourceKey && existing.sourceKey === rule.sourceKey)
      ));
      if (index >= 0) {
        rule.id = merged[index].id;
        rule.createdAt = merged[index].createdAt;
        merged[index] = rule;
      } else merged.push(rule);
    });
    await replaceRulesInCloud(merged);
    state.rules = merged;
    saveRules();
    renderRules();
    setCloudStatus(`רשימת החסומים נשמרה ב־Supabase (${state.rules.length} כללים)`, "ok");
    alert(`יובאו ${imported.rules.length} כללים.${imported.issues.length ? `\n${imported.issues.join("\n")}` : ""}`);
  } catch (error) {
    alert(`ייבוא רשימת החסומים נכשל: ${error.message}`);
  } finally {
    input.value = "";
  }
}

'''
js = replace_between(js, "async function importRulesFile() {", "function renderSimpleTable(", import_rules_block + "function renderSimpleTable(", "rules import")

ensure_block = r'''async function ensureParsedData() {
  const shipmentFile = document.getElementById("shipments-file").files[0];
  if (!shipmentFile && !state.shipmentRows) throw new Error("יש לבחור קובץ נתוני משלוח.");
  if (!state.customers.length) throw new Error("לא קיימת רשימת לקוחות ב־Supabase. יש להעלות קובץ לקוחות פעם אחת.");
  if (!state.cities.length) throw new Error("לא קיימת רשימת ערים ב־Supabase. יש להעלות רשימת ערים פעם אחת.");
  if (!state.shipmentRows) state.shipmentRows = await readFileRows(shipmentFile);
  return {
    customerParsed: { customers: state.customers, issues: state.customerIssues || [] },
    shipmentParsed: parseShipments(state.shipmentRows),
    cityParsed: { cities: state.cities, issues: state.cityIssues || [] },
  };
}

'''
js = replace_between(js, "async function ensureParsedData() {", "async function processFiles() {", ensure_block + "async function processFiles() {", "ensure parsed data")

init_block = r'''async function init() {
  loadFixedFields();
  state.rules = loadRules();
  renderRules();
  bindResultTabs();

  const processButton = document.getElementById("process-button");
  processButton.disabled = true;
  document.getElementById("fixed-fields-form").addEventListener("input", saveFixedFields);
  document.getElementById("save-fixed-button").addEventListener("click", () => {
    saveFixedFieldsToCloud().catch((error) => alert(`שמירת הנתונים הקבועים נכשלה: ${error.message}`));
  });
  document.getElementById("reload-cloud-button").addEventListener("click", () => {
    loadCloudData({ migrateLocal: false }).catch((error) => {
      setCloudStatus(`טעינת הנתונים נכשלה: ${error.message}`, "error");
      alert(`טעינת הנתונים מ־Supabase נכשלה: ${error.message}`);
    });
  });
  ["customers", "shipments", "cities"].forEach((kind) => {
    document.getElementById(`${kind}-file`).addEventListener("change", () => handleFileChange(kind));
  });
  document.getElementById("rule-action").addEventListener("change", (event) => {
    document.getElementById("replacement-field").classList.toggle("hidden", event.target.value !== "replace");
  });
  document.getElementById("rule-form").addEventListener("submit", saveRuleFromForm);
  document.getElementById("rule-cancel-edit").addEventListener("click", resetRuleForm);
  document.getElementById("rules-import-button").addEventListener("click", () => document.getElementById("rules-import-file").click());
  document.getElementById("rules-import-file").addEventListener("change", importRulesFile);
  document.getElementById("rules-export-button").addEventListener("click", () => downloadBlob(workbookToBlob(buildRulesWorkbook()), "רשימת_לקוחות_חסומים.xlsx"));
  document.getElementById("download-rules-results").addEventListener("click", () => downloadBlob(workbookToBlob(buildRulesWorkbook()), "רשימת_לקוחות_חסומים.xlsx"));
  document.getElementById("process-button").addEventListener("click", processFiles);
  document.getElementById("download-report").addEventListener("click", () => {
    if (state.reportBlob) downloadBlob(state.reportBlob, state.reportFileName);
  });
  document.getElementById("download-blocked-activity").addEventListener("click", () => {
    if (state.activityBlob) downloadBlob(state.activityBlob, state.activityFileName);
  });
  document.getElementById("allow-errors").addEventListener("change", () => {
    if (state.result) renderResults(state.result, state.result.issues, {
      deliveryCount: state.shipments.length,
      validLineCount: state.shipments.reduce((sum, shipment) => sum + shipment.lineCount, 0),
    });
  });

  try {
    await loadCloudData({ migrateLocal: true });
  } catch (error) {
    console.error(error);
    setCloudStatus(`Supabase אינו זמין: ${error.message}`, "error");
    setFixedCloudStatus("עובד זמנית עם הנתונים המקומיים בדפדפן", "warn");
    refreshCloudDatasetStatuses();
  } finally {
    processButton.disabled = false;
  }
}

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => {
    init().catch((error) => {
      console.error(error);
      setCloudStatus(`אתחול האפליקציה נכשל: ${error.message}`, "error");
    });
  });
}

'''
js = replace_between(js, "function init() {", 'if (typeof module !== "undefined" && module.exports) {', init_block + 'if (typeof module !== "undefined" && module.exports) {', "init")

JS_PATH.write_text(js, encoding="utf-8")
print("Patched Ministry of Health frontend for shared Supabase persistence")
