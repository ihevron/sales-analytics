"use strict";

const assert = require("assert");
const fs = require("fs");
const hm = require("../health-ministry-src/health-ministry.js");

assert.strictEqual(hm.parseWeightKg(1000), 1, "1000 grams must equal 1 kg");
assert.strictEqual(hm.parseWeightKg("750 גרם"), 0.75, "gram text conversion failed");
assert.strictEqual(hm.parseWeightKg("1.5 קג"), 1.5, "explicit kg conversion failed");

const customerHeader = Array(16).fill("");
customerHeader[0] = "מספר לקוח";
customerHeader[1] = "שם לקוח";
customerHeader[4] = "חפ";
customerHeader[14] = "כתובת";
customerHeader[15] = "עיר";
const customerOne = Array(16).fill("");
customerOne[0] = "1";
customerOne[1] = "לקוח מקור בעמ";
customerOne[4] = "123456789";
customerOne[14] = "רחוב ראשון 1";
customerOne[15] = "תל אביב";
const customerTwo = Array(16).fill("");
customerTwo[0] = "2";
customerTwo[1] = "לקוח חליפי בעמ";
customerTwo[4] = "987654321";
customerTwo[14] = "רחוב שני 2";
customerTwo[15] = "חיפה";
const customers = hm.parseCustomers([customerHeader, customerOne, customerTwo]).customers;
assert.strictEqual(customers.length, 2, "customer parsing failed");

const cityHeader = ["שם עיר", "קוד עיר"];
const cities = hm.parseCities([cityHeader, ["תל אביב", "5000"], ["חיפה", "4000"]]).cities;
assert.strictEqual(cities.length, 2, "city parsing failed");

const shipmentHeader = ["מספר תעודה", "שם לקוח", "", "", "משקל", "", "כמות"];
const shipmentRows = [
  shipmentHeader,
  ["100", "לקוח מקור בעמ", "", "", 750, "", 2],
  ["", "", "", "", 250, "", 1],
];
const shipmentParsed = hm.parseShipments(shipmentRows);
assert.strictEqual(shipmentParsed.shipments.length, 1, "shipment grouping failed");
assert.strictEqual(shipmentParsed.shipments[0].totalWeightKg, 1.75, "shipment weight calculation failed");

const fixed = {
  supplierName: "ספק",
  supplierVat: "111111111",
  healthLicense: "123",
  reportDate: "2026-08-18",
  vehicleNumber: "12-345-67",
  driverName: "נהג",
  driverPhone: "0500000000",
  customerType: "קמעונאי",
  dailyRound: "1",
};

const normalResult = hm.processData(fixed, customers, shipmentParsed.shipments, cities, []);
assert.strictEqual(normalResult.outputRows.length, 1, "normal report row missing");
assert.strictEqual(normalResult.outputRows[0].cityCode, "5000", "city code mapping failed");

const excludeRule = hm.sanitizeRule({
  id: "exclude-1",
  sourceNumber: "1",
  sourceName: "לקוח מקור בעמ",
  sourceKey: hm.normalizeCustomerKey("לקוח מקור בעמ", true),
  action: "exclude",
  active: true,
});
const excluded = hm.processData(fixed, customers, shipmentParsed.shipments, cities, [excludeRule]);
assert.strictEqual(excluded.outputRows.length, 0, "excluded customer must not appear in report");
assert.strictEqual(excluded.activities.length, 1, "excluded activity missing");

const replaceRule = hm.sanitizeRule({
  id: "replace-1",
  sourceNumber: "1",
  sourceName: "לקוח מקור בעמ",
  sourceKey: hm.normalizeCustomerKey("לקוח מקור בעמ", true),
  action: "replace",
  replacementNumber: "2",
  replacementName: "לקוח חליפי בעמ",
  active: true,
});
const replaced = hm.processData(fixed, customers, shipmentParsed.shipments, cities, [replaceRule]);
assert.strictEqual(replaced.outputRows.length, 1, "replacement report row missing");
assert.strictEqual(replaced.outputRows[0].outputCustomerName, "לקוח חליפי בעמ", "replacement customer name failed");
assert.strictEqual(replaced.outputRows[0].cityCode, "4000", "replacement city mapping failed");

const html = fs.readFileSync("health-ministry-src/health-ministry.html", "utf8");
const frontend = fs.readFileSync("health-ministry-src/health-ministry.js", "utf8");
const server = fs.readFileSync("server.js", "utf8");
const dockerfile = fs.readFileSync("Dockerfile", "utf8");

for (const id of ["cloud-status", "reload-cloud-button", "save-fixed-button", "fixed-cloud-status"]) {
  assert(html.includes(`id="${id}"`), `missing HTML control ${id}`);
}
assert(frontend.includes('/api/health-ministry'), "frontend API base missing");
assert(frontend.includes('יש לבחור קובץ נתוני משלוח'), "shipment-only requirement missing");
assert(!frontend.includes('חסרים: קובץ לקוחות'), "customers must not be required for every run");
assert(server.includes('/api/health-ministry/bootstrap'), "bootstrap route missing");
assert(server.includes('replace_health_ministry_customers'), "customers RPC missing");
assert(server.includes('replace_health_ministry_cities'), "cities RPC missing");
assert(server.includes('replace_health_ministry_customer_rules'), "rules RPC missing");
assert(dockerfile.includes('COPY health-ministry-src ./health-ministry-src'), "Docker source copy missing");
assert(!dockerfile.includes('health-ministry-payload-00.txt'), "Docker must not depend on legacy payload chunks");

console.log("Health Ministry Supabase persistence tests passed");
