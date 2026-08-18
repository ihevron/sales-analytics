"use strict";

const STORAGE_KEYS = {
  rules: "health-ministry-customer-rules-v2",
  fixed: "health-ministry-fixed-fields-v2",
};

const LEGACY_FIXED_KEYS = [
  "health-ministry-fixed-fields",
  "healthMinistryFixedFields",
  "health_ministry_fixed_fields",
];

const CORPORATE_SUFFIXES = [
  "חברהבעמ",
  "שותפותבעמ",
  "בעמישראל",
  "בעמבעמ",
  "בעמ",
];

const state = {
  customers: [],
  cities: [],
  shipments: [],
  customerRows: null,
  cityRows: null,
  shipmentRows: null,
  rules: [],
  result: null,
  reportBlob: null,
  reportFileName: "",
  activityBlob: null,
  activityFileName: "",
};

const OUTPUT_COLUMNS = {
  supplierName: 0,
  supplierVat: 1,
  healthLicense: 2,
  reportDate: 3,
  vehicleNumber: 4,
  driverName: 5,
  driverPhone: 6,
  customerName: 7,
  customerType: 8,
  cityCode: 9,
  address: 10,
  customerVat: 11,
  deliveryNumber: 13,
  readyToEatWeight: 22,
  totalWeight: 26,
  dailyRound: 27,
};

function text(value) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toLocaleDateString("he-IL");
  }
  if (typeof value === "number" && Number.isFinite(value) && Number.isInteger(value)) return String(value);
  return String(value).trim();
}

function identifierText(value, padTo = 0) {
  let valueText = text(value).replace(/\.0$/, "").trim();
  if (!valueText) return "";
  const compact = valueText.replace(/[\s-]/g, "");
  if (padTo && /^\d+$/.test(compact) && compact.length <= padTo) return compact.padStart(padTo, "0");
  return valueText;
}

function normalizeKey(value) {
  return text(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u0591-\u05c7]/g, "")
    .replace(/&/g, "ו")
    .replace(/[^0-9a-z\u05d0-\u05ea]+/gi, "");
}

function normalizeCustomerKey(value, loose = false) {
  let key = normalizeKey(value);
  if (!loose) return key;
  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of CORPORATE_SUFFIXES) {
      if (key.endsWith(suffix) && key.length > suffix.length + 2) {
        key = key.slice(0, -suffix.length);
        changed = true;
      }
    }
  }
  return key;
}

function escapeHtml(value) {
  return text(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);
}

function formatNumber(value, digits = 3) {
  return new Intl.NumberFormat("he-IL", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(Number(value) || 0);
}

function todayIsraelISO() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function displayDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return text(value);
  return date.toLocaleString("he-IL", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function issue(severity, category, message, details = {}) {
  return { severity, category, message, ...details };
}

function headerScore(row, type) {
  const keys = Array.from({ length: type === "customers" ? 16 : 7 }, (_, index) => normalizeKey(row[index]));
  if (type === "cities") {
    return Number(keys[0].includes("עיר")) + Number(keys[1].includes("קוד"));
  }
  if (type === "customers") {
    return Number(keys[0].includes("לקוח"))
      + Number(keys[1].includes("לקוח") || keys[1].includes("שם"))
      + Number(keys[4].includes("חפ") || keys[4].includes("עוסק"))
      + Number(keys[14].includes("כתובת"))
      + Number(keys[15].includes("עיר") || keys[15].includes("ישוב"));
  }
  return Number(keys[0].includes("תעודה") || keys[0].includes("משלוח"))
    + Number(keys[1].includes("לקוח"))
    + Number(keys[4].includes("משקל"))
    + Number(keys[6].includes("כמות"));
}

function detectHeaderIndex(rows, type) {
  let bestIndex = 0;
  let bestScore = -1;
  rows.slice(0, 30).forEach((row, index) => {
    const score = headerScore(row || [], type);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });
  const minimum = type === "cities" ? 2 : 3;
  return bestScore >= minimum ? bestIndex : 0;
}

function parseFlexibleNumber(value, fieldName, mode = "decimal") {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${fieldName} אינו מספר תקין`);
    return value;
  }
  let raw = text(value).replace(/\u00a0/g, "").replace(/−/g, "-").replace(/\s+/g, "");
  raw = raw.replace(/[^0-9.,+\-]/g, "");
  if (!raw || !/[0-9]/.test(raw)) throw new Error(`${fieldName} אינו מספר תקין: ${text(value)}`);

  const commaCount = (raw.match(/,/g) || []).length;
  const dotCount = (raw.match(/\./g) || []).length;
  if (commaCount && dotCount) {
    const decimalSeparator = raw.lastIndexOf(",") > raw.lastIndexOf(".") ? "," : ".";
    const thousandSeparator = decimalSeparator === "," ? "." : ",";
    raw = raw.split(thousandSeparator).join("");
    if (decimalSeparator === ",") raw = raw.replace(",", ".");
  } else if (commaCount || dotCount) {
    const separator = commaCount ? "," : ".";
    const count = commaCount || dotCount;
    const parts = raw.split(separator);
    if (count > 1) {
      const last = parts.pop();
      const treatLastAsDecimal = last.length > 0 && last.length <= 2;
      raw = parts.join("") + (treatLastAsDecimal ? `.${last}` : last);
    } else {
      const [before, after = ""] = parts;
      const likelyThousands = mode === "weightGrams" && after.length === 3 && before.replace(/[+\-]/g, "").length <= 3;
      raw = likelyThousands ? `${before}${after}` : `${before}.${after}`;
    }
  }

  const number = Number(raw);
  if (!Number.isFinite(number)) throw new Error(`${fieldName} אינו מספר תקין: ${text(value)}`);
  return number;
}

function parseWeightKg(value) {
  const rawText = text(value).toLowerCase();
  const amount = parseFlexibleNumber(value, "משקל", "weightGrams");
  if (amount < 0) throw new Error("משקל שלילי אינו תקין");
  const unit = normalizeKey(rawText);
  const explicitlyKg = unit.includes("קג") || unit.includes("קילוגרם") || unit.includes("kg");
  return explicitlyKg ? amount : amount / 1000;
}

function parseQuantity(value) {
  const quantity = parseFlexibleNumber(value, "כמות", "decimal");
  if (quantity < 0) throw new Error("כמות שלילית אינה תקינה");
  return quantity;
}

function parseCustomers(rows) {
  const issues = [];
  const customers = [];
  const start = detectHeaderIndex(rows, "customers") + 1;
  rows.slice(start).forEach((row, offset) => {
    const sourceRow = start + offset + 1;
    const customerNumber = identifierText(row?.[0]);
    const name = text(row?.[1]);
    const vat = identifierText(row?.[4], 9);
    const address = text(row?.[14]);
    const city = text(row?.[15]);
    if (![customerNumber, name, vat, address, city].some(Boolean)) return;
    if (!name) {
      issues.push(issue("warning", "לקוחות", "שורת לקוח ללא שם דולגה.", { row: sourceRow }));
      return;
    }
    customers.push({
      sourceRow,
      customerNumber,
      name,
      vat,
      address,
      city,
      strictKey: normalizeCustomerKey(name),
      looseKey: normalizeCustomerKey(name, true),
    });
  });
  return { customers, issues };
}

function parseCities(rows) {
  const issues = [];
  const cities = [];
  const start = detectHeaderIndex(rows, "cities") + 1;
  rows.slice(start).forEach((row, offset) => {
    const sourceRow = start + offset + 1;
    const name = text(row?.[0]);
    const code = identifierText(row?.[1]);
    if (!name && !code) return;
    if (!name || !code) {
      issues.push(issue("warning", "ערים", "שורת עיר חסרה שם או קוד ולכן דולגה.", { row: sourceRow }));
      return;
    }
    cities.push({ sourceRow, name, code, key: normalizeKey(name) });
  });
  return { cities, issues };
}

function parseShipments(rows) {
  const issues = [];
  const groups = new Map();
  const start = detectHeaderIndex(rows, "shipments") + 1;
  let lastDelivery = "";
  let lastCustomer = "";
  let validLineCount = 0;

  rows.slice(start).forEach((row, offset) => {
    const sourceRow = start + offset + 1;
    let delivery = identifierText(row?.[0]);
    let customer = text(row?.[1]);
    const rawWeight = row?.[4];
    const rawQuantity = row?.[6];
    const hasWeight = text(rawWeight) !== "";
    const hasQuantity = text(rawQuantity) !== "";
    if (!delivery && !customer && !hasWeight && !hasQuantity) return;

    if (delivery) lastDelivery = delivery;
    else if (hasWeight || hasQuantity) delivery = lastDelivery;
    if (customer) lastCustomer = customer;
    else if (delivery && groups.get(delivery)?.customerName) customer = groups.get(delivery).customerName;
    else if (hasWeight || hasQuantity) customer = lastCustomer;

    if (!delivery) {
      issues.push(issue("error", "משלוחים", "לא ניתן לשייך את שורת המוצר למספר תעודת משלוח.", {
        row: sourceRow,
        rawValue: `משקל=${text(rawWeight)}, כמות=${text(rawQuantity)}`,
      }));
      return;
    }

    if (!groups.has(delivery)) {
      groups.set(delivery, { deliveryNumber: delivery, customerName: "", totalWeightKg: 0, lineCount: 0, sourceRows: [] });
    }
    const aggregate = groups.get(delivery);
    aggregate.sourceRows.push(sourceRow);
    if (customer) {
      if (aggregate.customerName && normalizeCustomerKey(aggregate.customerName) !== normalizeCustomerKey(customer)) {
        issues.push(issue("error", "משלוחים", `לאותה תעודה נמצאו שני שמות לקוח שונים: '${aggregate.customerName}' ו-'${customer}'.`, {
          row: sourceRow,
          deliveryNumber: delivery,
        }));
      } else if (!aggregate.customerName) {
        aggregate.customerName = customer;
      }
    }

    if (!hasWeight && !hasQuantity) return;
    if (!hasWeight || !hasQuantity) {
      issues.push(issue("error", "משלוחים", `חסר ערך ${hasWeight ? "כמות" : "משקל"} בשורת מוצר.`, {
        row: sourceRow,
        deliveryNumber: delivery,
        rawValue: `משקל=${text(rawWeight)}, כמות=${text(rawQuantity)}`,
      }));
      return;
    }

    try {
      const weightKg = parseWeightKg(rawWeight);
      const quantity = parseQuantity(rawQuantity);
      aggregate.totalWeightKg += weightKg * quantity;
      aggregate.lineCount += 1;
      validLineCount += 1;
    } catch (error) {
      issues.push(issue("error", "משלוחים", error.message, {
        row: sourceRow,
        deliveryNumber: delivery,
        rawValue: `משקל=${text(rawWeight)}, כמות=${text(rawQuantity)}`,
      }));
    }
  });

  const shipments = [...groups.values()];
  shipments.forEach((shipment) => {
    shipment.totalWeightKg = Math.round(shipment.totalWeightKg * 1e6) / 1e6;
    if (!shipment.customerName) issues.push(issue("error", "משלוחים", "לתעודה אין שם לקוח.", { deliveryNumber: shipment.deliveryNumber }));
    if (!shipment.lineCount) issues.push(issue("warning", "משלוחים", "לתעודה לא נמצאו שורות מוצר תקינות; המשקל יהיה 0.", { deliveryNumber: shipment.deliveryNumber }));
  });
  return { shipments, issues, validLineCount };
}

function groupUnique(records, keyName, signature) {
  const groups = new Map();
  records.forEach((record) => {
    const key = record[keyName];
    if (!key) return;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  });
  const unique = new Map();
  groups.forEach((group, key) => {
    const signatures = new Set(group.map(signature));
    if (signatures.size === 1) unique.set(key, group[0]);
  });
  return unique;
}

function bigrams(value) {
  const key = normalizeCustomerKey(value, true);
  if (key.length < 2) return new Set([key]);
  const set = new Set();
  for (let index = 0; index < key.length - 1; index += 1) set.add(key.slice(index, index + 2));
  return set;
}

function diceSimilarity(left, right) {
  const a = bigrams(left);
  const b = bigrams(right);
  if (!a.size && !b.size) return 1;
  let intersection = 0;
  a.forEach((item) => { if (b.has(item)) intersection += 1; });
  return (2 * intersection) / (a.size + b.size || 1);
}

function buildCustomerIndex(customers) {
  return {
    byNumber: groupUnique(customers, "customerNumber", (r) => `${r.name}|${r.vat}|${r.address}|${r.city}`),
    byStrict: groupUnique(customers, "strictKey", (r) => `${r.customerNumber}|${r.vat}|${r.address}|${r.city}`),
    byLoose: groupUnique(customers, "looseKey", (r) => `${r.customerNumber}|${r.vat}|${r.address}|${r.city}`),
    customers,
  };
}

function matchCustomer(nameOrNumber, index, allowFuzzy = true) {
  const raw = text(nameOrNumber);
  const numeric = raw.replace(/[^0-9]/g, "");
  if (numeric && index.byNumber.has(numeric)) return { record: index.byNumber.get(numeric), method: "מספר לקוח", confidence: 1 };
  const strict = normalizeCustomerKey(raw);
  if (strict && index.byStrict.has(strict)) return { record: index.byStrict.get(strict), method: "שם מדויק", confidence: 1 };
  const loose = normalizeCustomerKey(raw, true);
  if (loose && index.byLoose.has(loose)) return { record: index.byLoose.get(loose), method: "שם מנורמל", confidence: 0.98 };
  if (!allowFuzzy || loose.length < 4) return { record: null, method: "לא נמצא", confidence: 0 };

  let best = null;
  let bestScore = 0;
  let secondScore = 0;
  index.customers.forEach((customer) => {
    const score = diceSimilarity(loose, customer.looseKey);
    if (score > bestScore) {
      secondScore = bestScore;
      bestScore = score;
      best = customer;
    } else if (score > secondScore) {
      secondScore = score;
    }
  });
  if (best && bestScore >= 0.88 && bestScore - secondScore >= 0.04) {
    return { record: best, method: "התאמה חכמה", confidence: bestScore };
  }
  return { record: null, method: "לא נמצא", confidence: bestScore };
}

function buildCityIndex(cities) {
  return {
    byKey: groupUnique(cities, "key", (r) => r.code),
    cities,
  };
}

function matchCity(cityName, index) {
  const key = normalizeKey(cityName);
  if (key && index.byKey.has(key)) return { record: index.byKey.get(key), method: "מדויק", confidence: 1 };
  if (!key || key.length < 3) return { record: null, method: "לא נמצא", confidence: 0 };
  let best = null;
  let bestScore = 0;
  let secondScore = 0;
  index.cities.forEach((city) => {
    const score = diceSimilarity(key, city.key);
    if (score > bestScore) {
      secondScore = bestScore;
      bestScore = score;
      best = city;
    } else if (score > secondScore) secondScore = score;
  });
  if (best && bestScore >= 0.9 && bestScore - secondScore >= 0.05) return { record: best, method: "התאמה חכמה", confidence: bestScore };
  return { record: null, method: "לא נמצא", confidence: bestScore };
}

function customerChoiceLabel(customer) {
  return `${customer.customerNumber ? `${customer.customerNumber} · ` : ""}${customer.name}`;
}

function parseCustomerChoice(rawValue, customers = state.customers) {
  const raw = text(rawValue);
  if (!raw) return null;
  const exactLabel = customers.find((customer) => customerChoiceLabel(customer) === raw);
  if (exactLabel) return exactLabel;
  const numericPrefix = raw.match(/^\s*([^·|\-]+)\s*[·|]\s*(.+)$/);
  if (numericPrefix) {
    const number = identifierText(numericPrefix[1]);
    const byNumber = customers.find((customer) => customer.customerNumber === number);
    if (byNumber) return byNumber;
  }
  const byNumber = customers.find((customer) => customer.customerNumber && customer.customerNumber === identifierText(raw));
  if (byNumber) return byNumber;
  const strict = normalizeCustomerKey(raw);
  const sameName = customers.filter((customer) => customer.strictKey === strict);
  return sameName.length === 1 ? sameName[0] : null;
}

function sanitizeRule(rule) {
  if (!rule || typeof rule !== "object") return null;
  const sourceName = text(rule.sourceName || rule.customerName || rule.source || "");
  const sourceNumber = identifierText(rule.sourceNumber || rule.customerNumber || "");
  if (!sourceName && !sourceNumber) return null;
  const action = rule.action === "replace" || /החל/.test(text(rule.action)) ? "replace" : "exclude";
  return {
    id: text(rule.id) || `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    sourceNumber,
    sourceName,
    sourceKey: normalizeCustomerKey(rule.sourceKey || sourceName, true),
    action,
    replacementNumber: identifierText(rule.replacementNumber || rule.targetNumber || ""),
    replacementName: text(rule.replacementName || rule.targetName || ""),
    notes: text(rule.notes || rule.note || ""),
    active: rule.active === false || String(rule.active).toLowerCase() === "false" || String(rule.active) === "0" ? false : true,
    createdAt: text(rule.createdAt) || new Date().toISOString(),
    updatedAt: text(rule.updatedAt) || new Date().toISOString(),
  };
}

function loadRules() {
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

function ruleMatches(rule, shipmentName, matchedCustomer) {
  if (!rule.active) return false;
  if (rule.sourceNumber && matchedCustomer?.customerNumber === rule.sourceNumber) return true;
  const shipmentLoose = normalizeCustomerKey(shipmentName, true);
  const matchedLoose = normalizeCustomerKey(matchedCustomer?.name || "", true);
  return Boolean(rule.sourceKey && (rule.sourceKey === shipmentLoose || rule.sourceKey === matchedLoose));
}

function resolveRule(shipmentName, matchedCustomer) {
  return state.rules.find((rule) => ruleMatches(rule, shipmentName, matchedCustomer)) || null;
}

function resolveReplacement(rule, customerIndex) {
  if (rule.replacementNumber && customerIndex.byNumber.has(rule.replacementNumber)) return customerIndex.byNumber.get(rule.replacementNumber);
  const match = matchCustomer(rule.replacementName, customerIndex, false);
  return match.record;
}

function processData(fixed, customers, shipments, cities, rules = state.rules) {
  const issues = [];
  const outputRows = [];
  const activities = [];
  const customerIndex = buildCustomerIndex(customers);
  const cityIndex = buildCityIndex(cities);
  const previousRules = state.rules;
  state.rules = rules;

  shipments.forEach((shipment) => {
    const originalMatch = matchCustomer(shipment.customerName, customerIndex, true);
    const rule = resolveRule(shipment.customerName, originalMatch.record);
    if (rule?.action === "exclude") {
      activities.push({
        deliveryNumber: shipment.deliveryNumber,
        sourceCustomerName: shipment.customerName,
        action: "exclude",
        replacementCustomerName: "",
        totalWeightKg: shipment.totalWeightKg,
        status: "לא נכלל בדיווח",
        notes: rule.notes,
      });
      return;
    }

    let effectiveCustomer = originalMatch.record;
    let outputCustomerName = shipment.customerName;
    let ruleAction = "";
    if (rule?.action === "replace") {
      effectiveCustomer = resolveReplacement(rule, customerIndex);
      ruleAction = "replace";
      if (!effectiveCustomer) {
        issues.push(issue("error", "לקוחות חליפיים", `לא נמצא הלקוח החליפי שהוגדר עבור '${shipment.customerName}'.`, {
          deliveryNumber: shipment.deliveryNumber,
          rawValue: rule.replacementNumber || rule.replacementName,
        }));
        activities.push({
          deliveryNumber: shipment.deliveryNumber,
          sourceCustomerName: shipment.customerName,
          action: "replace",
          replacementCustomerName: rule.replacementName || rule.replacementNumber,
          totalWeightKg: shipment.totalWeightKg,
          status: "החלפה נכשלה – לקוח חליפי לא נמצא",
          notes: rule.notes,
        });
        return;
      }
      outputCustomerName = effectiveCustomer.name;
      activities.push({
        deliveryNumber: shipment.deliveryNumber,
        sourceCustomerName: shipment.customerName,
        action: "replace",
        replacementCustomerName: effectiveCustomer.name,
        totalWeightKg: shipment.totalWeightKg,
        status: "הוחלף ונכלל בדיווח",
        notes: rule.notes,
      });
    }

    if (!effectiveCustomer) {
      issues.push(issue("error", "התאמת לקוח", `לא נמצא לקוח מתאים לשם '${shipment.customerName}'.`, {
        deliveryNumber: shipment.deliveryNumber,
        rawValue: shipment.customerName,
      }));
      return;
    }
    if (!ruleAction && originalMatch.method === "התאמה חכמה") {
      issues.push(issue("warning", "התאמת לקוח", `הלקוח '${shipment.customerName}' הותאם באופן חכם ל-'${effectiveCustomer.name}'.`, {
        deliveryNumber: shipment.deliveryNumber,
      }));
    }

    const cityMatch = matchCity(effectiveCustomer.city, cityIndex);
    if (!effectiveCustomer.city) {
      issues.push(issue("error", "התאמת עיר", `ללקוח '${effectiveCustomer.name}' אין עיר בקובץ הלקוחות.`, {
        deliveryNumber: shipment.deliveryNumber,
      }));
    } else if (!cityMatch.record) {
      issues.push(issue("error", "התאמת עיר", `לא נמצא קוד לעיר '${effectiveCustomer.city}'.`, {
        deliveryNumber: shipment.deliveryNumber,
        rawValue: effectiveCustomer.city,
      }));
    } else if (cityMatch.method === "התאמה חכמה") {
      issues.push(issue("warning", "התאמת עיר", `העיר '${effectiveCustomer.city}' הותאמה ל-'${cityMatch.record.name}'.`, {
        deliveryNumber: shipment.deliveryNumber,
      }));
    }
    if (!effectiveCustomer.address) {
      issues.push(issue("warning", "לקוחות", `ללקוח '${effectiveCustomer.name}' חסרה כתובת.`, { deliveryNumber: shipment.deliveryNumber }));
    }
    if (!effectiveCustomer.vat) {
      issues.push(issue("warning", "לקוחות", `ללקוח '${effectiveCustomer.name}' חסר ח״פ.`, { deliveryNumber: shipment.deliveryNumber }));
    }

    outputRows.push({
      deliveryNumber: shipment.deliveryNumber,
      shipmentCustomerName: shipment.customerName,
      outputCustomerName,
      matchedCustomerName: effectiveCustomer.name,
      customerNumber: effectiveCustomer.customerNumber,
      customerVat: effectiveCustomer.vat,
      address: effectiveCustomer.address,
      cityName: effectiveCustomer.city,
      cityCode: cityMatch.record?.code || "",
      totalWeightKg: shipment.totalWeightKg,
      lineCount: shipment.lineCount,
      customerMatchMethod: ruleAction === "replace" ? "לקוח חליפי" : originalMatch.method,
      ruleAction,
    });
  });
  state.rules = previousRules;
  return { fixed, outputRows, activities, issues };
}

function fixedFieldsFromForm() {
  return {
    supplierName: text(document.getElementById("supplier-name").value),
    supplierVat: identifierText(document.getElementById("supplier-vat").value),
    healthLicense: identifierText(document.getElementById("health-license").value),
    reportDate: document.getElementById("report-date").value,
    vehicleNumber: text(document.getElementById("vehicle-number").value),
    driverName: text(document.getElementById("driver-name").value),
    driverPhone: identifierText(document.getElementById("driver-phone").value),
    customerType: document.getElementById("customer-type").value,
    dailyRound: text(document.getElementById("daily-round").value),
  };
}

function validateFixedFields(fixed) {
  const labels = {
    supplierName: "שם הספק",
    supplierVat: "ח״פ ספק",
    healthLicense: "מספר משרד הבריאות",
    reportDate: "תאריך",
    vehicleNumber: "מספר רכב",
    driverName: "שם הנהג",
    driverPhone: "טלפון נהג",
    customerType: "סוג לקוח",
    dailyRound: "סבב יומי",
  };
  return Object.entries(labels).filter(([key]) => !fixed[key]).map(([, label]) => label);
}

function setCellPreserveStyle(sheet, rowIndex, columnIndex, value, type = "s", numberFormat = null) {
  const address = XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex });
  const existing = sheet[address] || {};
  const next = { ...existing, t: type, v: value };
  if (numberFormat) next.z = numberFormat;
  sheet[address] = next;
}

function cloneRowStyle(sheet, sourceRowIndex, targetRowIndex, maxColumns = 30) {
  for (let columnIndex = 0; columnIndex < maxColumns; columnIndex += 1) {
    const sourceAddress = XLSX.utils.encode_cell({ r: sourceRowIndex, c: columnIndex });
    const targetAddress = XLSX.utils.encode_cell({ r: targetRowIndex, c: columnIndex });
    const source = sheet[sourceAddress];
    if (!source) continue;
    const target = sheet[targetAddress] || { t: "s", v: "" };
    if (source.s !== undefined) target.s = JSON.parse(JSON.stringify(source.s));
    if (source.z !== undefined) target.z = source.z;
    sheet[targetAddress] = target;
  }
  if (sheet["!rows"]?.[sourceRowIndex]) {
    sheet["!rows"][targetRowIndex] = { ...sheet["!rows"][sourceRowIndex] };
  }
}

function buildOfficialWorkbook(result) {
  if (!window.HEALTH_MINISTRY_TEMPLATE_BASE64) throw new Error("תבנית משרד הבריאות לא נטענה.");
  const workbook = XLSX.read(window.HEALTH_MINISTRY_TEMPLATE_BASE64, {
    type: "base64",
    cellStyles: true,
    cellDates: true,
  });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const originalRange = XLSX.utils.decode_range(sheet["!ref"] || "A1:AD21");
  const maxDataRow = Math.max(1, result.outputRows.length + 1);

  result.outputRows.forEach((row, index) => {
    const rowIndex = index + 1;
    if (rowIndex > originalRange.e.r) cloneRowStyle(sheet, 2, rowIndex, 30);
    const fixed = result.fixed;
    setCellPreserveStyle(sheet, rowIndex, OUTPUT_COLUMNS.supplierName, fixed.supplierName);
    setCellPreserveStyle(sheet, rowIndex, OUTPUT_COLUMNS.supplierVat, fixed.supplierVat, "s", "@");
    setCellPreserveStyle(sheet, rowIndex, OUTPUT_COLUMNS.healthLicense, fixed.healthLicense, "s", "@");
    const [year, month, day] = fixed.reportDate.split("-").map(Number);
    setCellPreserveStyle(sheet, rowIndex, OUTPUT_COLUMNS.reportDate, new Date(Date.UTC(year, month - 1, day, 12)), "d", "dd/mm/yyyy");
    setCellPreserveStyle(sheet, rowIndex, OUTPUT_COLUMNS.vehicleNumber, fixed.vehicleNumber, "s", "@");
    setCellPreserveStyle(sheet, rowIndex, OUTPUT_COLUMNS.driverName, fixed.driverName);
    setCellPreserveStyle(sheet, rowIndex, OUTPUT_COLUMNS.driverPhone, fixed.driverPhone, "s", "@");
    setCellPreserveStyle(sheet, rowIndex, OUTPUT_COLUMNS.customerName, row.outputCustomerName);
    setCellPreserveStyle(sheet, rowIndex, OUTPUT_COLUMNS.customerType, fixed.customerType);
    setCellPreserveStyle(sheet, rowIndex, OUTPUT_COLUMNS.cityCode, row.cityCode, "s", "@");
    setCellPreserveStyle(sheet, rowIndex, OUTPUT_COLUMNS.address, row.address);
    setCellPreserveStyle(sheet, rowIndex, OUTPUT_COLUMNS.customerVat, row.customerVat, "s", "@");
    setCellPreserveStyle(sheet, rowIndex, OUTPUT_COLUMNS.deliveryNumber, row.deliveryNumber, "s", "@");
    setCellPreserveStyle(sheet, rowIndex, OUTPUT_COLUMNS.readyToEatWeight, row.totalWeightKg, "n", "0.000");
    setCellPreserveStyle(sheet, rowIndex, OUTPUT_COLUMNS.totalWeight, row.totalWeightKg, "n", "0.000");
    setCellPreserveStyle(sheet, rowIndex, OUTPUT_COLUMNS.dailyRound, fixed.dailyRound, "s", "@");
  });

  originalRange.e.r = Math.max(originalRange.e.r, maxDataRow);
  sheet["!ref"] = XLSX.utils.encode_range(originalRange);
  workbook.Workbook = workbook.Workbook || {};
  workbook.Workbook.Views = [{ RTL: true }];
  return workbook;
}

function setWorksheetWidths(sheet, widths) {
  sheet["!cols"] = widths.map((wch) => ({ wch }));
}

function buildRulesWorkbook(rules = state.rules) {
  const headers = ["פעיל", "מספר לקוח מקור", "שם לקוח מקור", "פעולה", "מספר לקוח חליפי", "שם לקוח חליפי", "הערה", "עודכן בתאריך"];
  const rows = rules.map((rule) => [
    rule.active ? "כן" : "לא",
    rule.sourceNumber,
    rule.sourceName,
    rule.action === "replace" ? "החלפה" : "חסימה",
    rule.replacementNumber,
    rule.replacementName,
    rule.notes,
    displayDateTime(rule.updatedAt),
  ]);
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  setWorksheetWidths(sheet, [9, 18, 30, 14, 20, 30, 32, 20]);
  XLSX.utils.book_append_sheet(workbook, sheet, "לקוחות חסומים");
  workbook.Workbook = { Views: [{ RTL: true }] };
  return workbook;
}

function buildActivityWorkbook(activities) {
  const headers = ["מספר תעודה", "לקוח מקור", "פעולה", "לקוח חליפי", "משקל ק״ג", "סטטוס", "הערה"];
  const rows = activities.map((activity) => [
    activity.deliveryNumber,
    activity.sourceCustomerName,
    activity.action === "replace" ? "החלפה" : "חסימה",
    activity.replacementCustomerName,
    activity.totalWeightKg,
    activity.status,
    activity.notes,
  ]);
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  setWorksheetWidths(sheet, [18, 32, 12, 32, 14, 28, 32]);
  XLSX.utils.book_append_sheet(workbook, sheet, "חסומים והחלפות");
  workbook.Workbook = { Views: [{ RTL: true }] };
  return workbook;
}

function workbookToBlob(workbook) {
  const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "array", cellStyles: true, compression: true });
  return new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function readFileRows(file) {
  if (!file) throw new Error("לא נבחר קובץ.");
  if (!window.XLSX) throw new Error("רכיב קריאת Excel לא נטען. יש לרענן את העמוד.");
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true, raw: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("לא נמצא גיליון בקובץ.");
  return XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
    header: 1,
    defval: "",
    raw: true,
    blankrows: false,
  });
}

function loadFixedFields() {
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
  const mapping = {
    "supplier-name": saved?.supplierName || saved?.supplier_name || "",
    "supplier-vat": saved?.supplierVat || saved?.supplier_vat || "",
    "health-license": saved?.healthLicense || saved?.health_license || "",
    "vehicle-number": saved?.vehicleNumber || saved?.vehicle_number || "",
    "driver-name": saved?.driverName || saved?.driver_name || "",
    "driver-phone": saved?.driverPhone || saved?.driver_phone || "",
    "customer-type": saved?.customerType || saved?.customer_type || "קמעונאי",
    "daily-round": saved?.dailyRound || saved?.daily_round || "",
  };
  Object.entries(mapping).forEach(([id, value]) => {
    const element = document.getElementById(id);
    if (element && value !== undefined) element.value = value;
  });
  document.getElementById("report-date").value = todayIsraelISO();
}

function saveFixedFields() {
  const fixed = fixedFieldsFromForm();
  const { reportDate, ...persistent } = fixed;
  localStorage.setItem(STORAGE_KEYS.fixed, JSON.stringify(persistent));
}

function updateCustomerDatalist() {
  const datalist = document.getElementById("customers-datalist");
  datalist.innerHTML = state.customers
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, "he"))
    .map((customer) => `<option value="${escapeHtml(customerChoiceLabel(customer))}"></option>`)
    .join("");
}

function setFileStatus(kind, message, statusClass = "") {
  const element = document.getElementById(`${kind}-file-status`);
  element.textContent = message;
  element.className = `file-status ${statusClass}`.trim();
}

async function handleFileChange(kind) {
  const file = document.getElementById(`${kind}-file`).files[0];
  if (!file) {
    setFileStatus(kind, "לא נבחר קובץ");
    return;
  }
  setFileStatus(kind, "קורא קובץ...");
  try {
    const rows = await readFileRows(file);
    if (kind === "customers") {
      state.customerRows = rows;
      const parsed = parseCustomers(rows);
      state.customers = parsed.customers;
      updateCustomerDatalist();
      setFileStatus(kind, `${file.name} · ${state.customers.length} לקוחות`, "ok");
    } else if (kind === "cities") {
      state.cityRows = rows;
      const parsed = parseCities(rows);
      state.cities = parsed.cities;
      setFileStatus(kind, `${file.name} · ${state.cities.length} ערים`, "ok");
    } else {
      state.shipmentRows = rows;
      const parsed = parseShipments(rows);
      state.shipments = parsed.shipments;
      setFileStatus(kind, `${file.name} · ${state.shipments.length} תעודות`, "ok");
    }
  } catch (error) {
    setFileStatus(kind, error.message || "קריאת הקובץ נכשלה", "error");
  }
}

function resetRuleForm() {
  document.getElementById("rule-id").value = "";
  document.getElementById("rule-source").value = "";
  document.getElementById("rule-action").value = "exclude";
  document.getElementById("rule-replacement").value = "";
  document.getElementById("rule-notes").value = "";
  document.getElementById("replacement-field").classList.add("hidden");
  document.getElementById("rule-save-label").textContent = "הוספת כלל";
  document.getElementById("rule-cancel-edit").classList.add("hidden");
}

function renderRules() {
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

  body.querySelectorAll("[data-rule-toggle]").forEach((button) => button.addEventListener("click", () => {
    const rule = state.rules.find((item) => item.id === button.dataset.ruleToggle);
    if (!rule) return;
    rule.active = !rule.active;
    rule.updatedAt = new Date().toISOString();
    saveRules();
    renderRules();
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
  body.querySelectorAll("[data-rule-delete]").forEach((button) => button.addEventListener("click", () => {
    const rule = state.rules.find((item) => item.id === button.dataset.ruleDelete);
    if (!rule || !confirm(`למחוק את הכלל עבור ${rule.sourceName || rule.sourceNumber}?`)) return;
    state.rules = state.rules.filter((item) => item.id !== rule.id);
    saveRules();
    renderRules();
    if (document.getElementById("rule-id").value === rule.id) resetRuleForm();
  }));
}

function saveRuleFromForm(event) {
  event.preventDefault();
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
  if (existingIndex >= 0) state.rules[existingIndex] = nextRule;
  else if (duplicateIndex >= 0) state.rules[duplicateIndex] = nextRule;
  else state.rules.push(nextRule);
  saveRules();
  renderRules();
  resetRuleForm();
}

function normalizeImportHeader(value) {
  return normalizeKey(value);
}

function readImportedRules(rows) {
  const issues = [];
  if (!rows.length) return { rules: [], issues: ["הקובץ ריק"] };
  const headerIndex = rows.slice(0, 20).findIndex((row) => row.some((value) => /לקוח|פעיל|פעולה/.test(text(value))));
  const start = headerIndex >= 0 ? headerIndex : 0;
  const headers = (rows[start] || []).map(normalizeImportHeader);
  const findColumn = (...tokens) => headers.findIndex((header) => tokens.some((token) => header.includes(normalizeKey(token))));
  const columns = {
    active: findColumn("פעיל", "סטטוס"),
    sourceNumber: findColumn("מספרלקוחמקור", "מספרלקוח"),
    sourceName: findColumn("שםלקוחמקור", "שםלקוח"),
    action: findColumn("פעולה"),
    replacementNumber: findColumn("מספרלקוחחליפי", "מספרחליפי"),
    replacementName: findColumn("שםלקוחחליפי", "לקוחחליפי"),
    notes: findColumn("הערה"),
  };
  if (columns.sourceName < 0 && columns.sourceNumber < 0) {
    columns.active = 0;
    columns.sourceNumber = 1;
    columns.sourceName = 2;
    columns.action = 3;
    columns.replacementNumber = 4;
    columns.replacementName = 5;
    columns.notes = 6;
  }
  const rules = [];
  rows.slice(start + 1).forEach((row, offset) => {
    const get = (column) => column >= 0 ? row?.[column] : "";
    const sourceName = text(get(columns.sourceName));
    const sourceNumber = identifierText(get(columns.sourceNumber));
    if (!sourceName && !sourceNumber) return;
    const actionText = text(get(columns.action));
    const activeText = normalizeKey(get(columns.active));
    const active = !["לא", "לאפעיל", "0", "false", "כבוי"].includes(activeText);
    const rule = sanitizeRule({
      sourceName,
      sourceNumber,
      action: /החל|replace/.test(actionText.toLowerCase()) ? "replace" : "exclude",
      replacementNumber: identifierText(get(columns.replacementNumber)),
      replacementName: text(get(columns.replacementName)),
      notes: text(get(columns.notes)),
      active,
      updatedAt: new Date().toISOString(),
    });
    if (rule.action === "replace" && !rule.replacementName && !rule.replacementNumber) {
      issues.push(`שורה ${start + offset + 2}: כלל החלפה ללא לקוח חליפי דולג.`);
      return;
    }
    rules.push(rule);
  });
  return { rules, issues };
}

async function importRulesFile() {
  const input = document.getElementById("rules-import-file");
  const file = input.files[0];
  if (!file) return;
  try {
    const rows = await readFileRows(file);
    const imported = readImportedRules(rows);
    imported.rules.forEach((rule) => {
      const index = state.rules.findIndex((existing) => (
        (rule.sourceNumber && existing.sourceNumber === rule.sourceNumber)
        || (rule.sourceKey && existing.sourceKey === rule.sourceKey)
      ));
      if (index >= 0) {
        rule.id = state.rules[index].id;
        rule.createdAt = state.rules[index].createdAt;
        state.rules[index] = rule;
      } else state.rules.push(rule);
    });
    saveRules();
    renderRules();
    alert(`יובאו ${imported.rules.length} כללים.${imported.issues.length ? `\n${imported.issues.join("\n")}` : ""}`);
  } catch (error) {
    alert(`ייבוא רשימת החסומים נכשל: ${error.message}`);
  } finally {
    input.value = "";
  }
}

function renderSimpleTable(tableId, rows, columns, emptyMessage) {
  const table = document.getElementById(tableId);
  const header = `<thead><tr>${columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join("")}</tr></thead>`;
  const body = rows.length
    ? rows.map((row) => `<tr>${columns.map((column) => `<td>${column.render ? column.render(row) : escapeHtml(row[column.key])}</td>`).join("")}</tr>`).join("")
    : `<tr><td colspan="${columns.length}" class="empty-row">${escapeHtml(emptyMessage)}</td></tr>`;
  table.innerHTML = `${header}<tbody>${body}</tbody>`;
}

function renderResults(result, allIssues, shipmentStats) {
  const errorCount = allIssues.filter((item) => item.severity === "error").length;
  const warningCount = allIssues.filter((item) => item.severity === "warning").length;
  const excludedCount = result.activities.filter((item) => item.action === "exclude").length;
  const replacedCount = result.activities.filter((item) => item.action === "replace" && item.status.includes("נכלל")).length;
  const totalWeight = result.outputRows.reduce((sum, row) => sum + row.totalWeightKg, 0);
  document.getElementById("results-section").classList.remove("hidden");
  document.getElementById("results-subtitle").textContent = errorCount
    ? `העיבוד הסתיים עם ${errorCount} שגיאות ו-${warningCount} אזהרות.`
    : `העיבוד הסתיים בהצלחה עם ${warningCount} אזהרות.`;
  const metrics = [
    ["תעודות בקלט", shipmentStats.deliveryCount, ""],
    ["שורות מוצר תקינות", shipmentStats.validLineCount, ""],
    ["תעודות בדוח", result.outputRows.length, "ok"],
    ["נחסמו", excludedCount, excludedCount ? "warn" : ""],
    ["הוחלפו", replacedCount, replacedCount ? "ok" : ""],
    ["סה״כ משקל בק״ג", formatNumber(totalWeight), ""],
    ["שגיאות", errorCount, errorCount ? "error" : "ok"],
    ["אזהרות", warningCount, warningCount ? "warn" : ""],
  ];
  document.getElementById("metrics-grid").innerHTML = metrics.map(([label, value, className]) => `
    <div class="metric-card ${className}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>
  `).join("");

  renderSimpleTable("preview-table", result.outputRows, [
    { key: "deliveryNumber", label: "מספר תעודה" },
    { key: "shipmentCustomerName", label: "לקוח במשלוח" },
    { key: "outputCustomerName", label: "שם בדיווח" },
    { key: "customerMatchMethod", label: "אופן התאמה" },
    { key: "cityName", label: "עיר" },
    { key: "cityCode", label: "קוד עיר" },
    { key: "address", label: "כתובת" },
    { key: "customerVat", label: "ח״פ לקוח" },
    { key: "totalWeightKg", label: "משקל ק״ג", render: (row) => formatNumber(row.totalWeightKg) },
  ], "אין תעודות להצגה.");

  renderSimpleTable("blocked-table", result.activities, [
    { key: "deliveryNumber", label: "מספר תעודה" },
    { key: "sourceCustomerName", label: "לקוח מקור" },
    { key: "action", label: "פעולה", render: (row) => `<span class="activity-pill ${row.action}">${row.action === "replace" ? "החלפה" : "חסימה"}</span>` },
    { key: "replacementCustomerName", label: "לקוח חליפי" },
    { key: "totalWeightKg", label: "משקל ק״ג", render: (row) => formatNumber(row.totalWeightKg) },
    { key: "status", label: "סטטוס" },
    { key: "notes", label: "הערה" },
  ], "בקובץ הנוכחי לא הופעלו כללי חסימה או החלפה.");

  renderSimpleTable("issues-table", allIssues, [
    { key: "severity", label: "חומרה", render: (row) => `<span class="issue-pill ${row.severity}">${row.severity === "error" ? "שגיאה" : row.severity === "warning" ? "אזהרה" : "מידע"}</span>` },
    { key: "category", label: "קטגוריה" },
    { key: "message", label: "פירוט" },
    { key: "deliveryNumber", label: "מספר תעודה" },
    { key: "row", label: "שורת מקור" },
    { key: "rawValue", label: "ערך מקור" },
  ], "לא נמצאו שגיאות או אזהרות.");

  const allowErrors = document.getElementById("allow-errors").checked;
  document.getElementById("download-report").disabled = !state.reportBlob || (errorCount > 0 && !allowErrors);
  document.getElementById("download-blocked-activity").disabled = !state.activityBlob;
  if (errorCount > 0 && !allowErrors) {
    document.getElementById("process-status").textContent = "הקובץ נוצר לבדיקה, אך ההורדה חסומה עד לתיקון השגיאות או סימון האפשרות להורדה עם שגיאות.";
    document.getElementById("process-status").className = "process-status error";
  }
}

async function ensureParsedData() {
  const files = {
    customers: document.getElementById("customers-file").files[0],
    shipments: document.getElementById("shipments-file").files[0],
    cities: document.getElementById("cities-file").files[0],
  };
  const missing = Object.entries(files).filter(([, file]) => !file).map(([key]) => ({ customers: "קובץ לקוחות", shipments: "קובץ משלוחים", cities: "רשימת ערים" })[key]);
  if (missing.length) throw new Error(`חסרים: ${missing.join(", ")}.`);
  if (!state.customerRows) state.customerRows = await readFileRows(files.customers);
  if (!state.shipmentRows) state.shipmentRows = await readFileRows(files.shipments);
  if (!state.cityRows) state.cityRows = await readFileRows(files.cities);
  return {
    customerParsed: parseCustomers(state.customerRows),
    shipmentParsed: parseShipments(state.shipmentRows),
    cityParsed: parseCities(state.cityRows),
  };
}

async function processFiles() {
  const button = document.getElementById("process-button");
  const status = document.getElementById("process-status");
  button.disabled = true;
  status.textContent = "קורא, מתאים ומחשב את הנתונים...";
  status.className = "process-status";
  state.reportBlob = null;
  state.activityBlob = null;
  try {
    const fixed = fixedFieldsFromForm();
    const missingFixed = validateFixedFields(fixed);
    if (missingFixed.length) throw new Error(`יש להשלים: ${missingFixed.join(", ")}.`);
    saveFixedFields();
    const parsed = await ensureParsedData();
    state.customers = parsed.customerParsed.customers;
    state.shipments = parsed.shipmentParsed.shipments;
    state.cities = parsed.cityParsed.cities;
    updateCustomerDatalist();
    const result = processData(fixed, state.customers, state.shipments, state.cities, state.rules);
    const allIssues = [
      ...parsed.customerParsed.issues,
      ...parsed.shipmentParsed.issues,
      ...parsed.cityParsed.issues,
      ...result.issues,
    ];
    state.result = { ...result, issues: allIssues };
    if (result.outputRows.length) {
      state.reportBlob = workbookToBlob(buildOfficialWorkbook(result));
      state.reportFileName = `דיווח_משרד_הבריאות_${fixed.reportDate}.xlsx`;
    }
    if (result.activities.length) {
      state.activityBlob = workbookToBlob(buildActivityWorkbook(result.activities));
      state.activityFileName = `דוח_לקוחות_חסומים_והחלפות_${fixed.reportDate}.xlsx`;
    }
    const errorCount = allIssues.filter((item) => item.severity === "error").length;
    status.textContent = errorCount ? `העיבוד הסתיים עם ${errorCount} שגיאות.` : "העיבוד הסתיים בהצלחה והקובץ מוכן להורדה.";
    status.className = `process-status ${errorCount ? "error" : "ok"}`;
    renderResults(result, allIssues, {
      deliveryCount: state.shipments.length,
      validLineCount: parsed.shipmentParsed.validLineCount,
    });
    document.getElementById("results-section").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    status.textContent = error.message || "העיבוד נכשל.";
    status.className = "process-status error";
  } finally {
    button.disabled = false;
  }
}

function bindResultTabs() {
  document.querySelectorAll("[data-result-tab]").forEach((button) => button.addEventListener("click", () => {
    const tab = button.dataset.resultTab;
    document.querySelectorAll("[data-result-tab]").forEach((item) => item.classList.toggle("active", item === button));
    document.querySelectorAll(".result-tab").forEach((panel) => panel.classList.toggle("active", panel.id === `${tab}-tab`));
  }));
}

function init() {
  loadFixedFields();
  state.rules = loadRules();
  renderRules();
  bindResultTabs();

  document.getElementById("fixed-fields-form").addEventListener("input", saveFixedFields);
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
}

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", init);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    normalizeKey,
    normalizeCustomerKey,
    parseFlexibleNumber,
    parseWeightKg,
    parseQuantity,
    parseCustomers,
    parseCities,
    parseShipments,
    buildCustomerIndex,
    matchCustomer,
    processData,
    sanitizeRule,
    readImportedRules,
  };
}
