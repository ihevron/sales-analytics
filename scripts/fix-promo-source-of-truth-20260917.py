from pathlib import Path


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f"missing pattern: {label}")
    return text.replace(old, new, 1)

server_path = Path('server.js')
server = server_path.read_text()

server = replace_once(
    server,
    '      settingsSelect("sale_price", columns.has("sale_price") ? "p.sale_price" : "0"),\n      settingsSelect("promo_discount_percent", columns.has("promo_discount_percent") ? "p.promo_discount_percent" : "0"),',
    '      settingsSelect("sale_price", "0"),\n      settingsSelect("promo_discount_percent", "0"),',
    'customer product promo fallback',
)

old_existing = '''    if (!missingSkus.length) continue;
    const fallbackChunk = missingSkus.map((sku) => `"${sku.replaceAll('"', '\\\\"')}"`).join(",");
    try {
      const rows = await postgresRows(`products?select=sku,sale_price,promo_discount_percent,customer_recommended,hidden&sku=in.(${fallbackChunk})&limit=1000`);
      rows.forEach((row) => {
        if (!settings.has(String(row.sku))) settings.set(String(row.sku), row);
      });
    } catch (error) {
      if (!/promo_discount_percent|customer_recommended|hidden|schema cache|column/i.test(error.message || "")) throw error;
      const rows = await postgresRows(`products?select=sku,sale_price&sku=in.(${fallbackChunk})&limit=1000`);
      rows.forEach((row) => {
        if (!settings.has(String(row.sku))) settings.set(String(row.sku), row);
      });
    }
'''
new_existing = '''    if (!missingSkus.length) continue;
    const fallbackChunk = missingSkus.map((sku) => `"${sku.replaceAll('"', '\\\\"')}"`).join(",");
    try {
      const rows = await postgresRows(`products?select=sku,customer_recommended,hidden&sku=in.(${fallbackChunk})&limit=1000`);
      rows.forEach((row) => {
        if (!settings.has(String(row.sku))) settings.set(String(row.sku), {
          sku: row.sku,
          sale_price: 0,
          promo_discount_percent: 0,
          customer_recommended: numberValue(row.customer_recommended) ? 1 : 0,
          hidden: numberValue(row.hidden) ? 1 : 0,
        });
      });
    } catch (error) {
      if (!/customer_recommended|hidden|schema cache|column/i.test(error.message || "")) throw error;
      missingSkus.forEach((sku) => {
        if (!settings.has(String(sku))) settings.set(String(sku), {
          sku,
          sale_price: 0,
          promo_discount_percent: 0,
          customer_recommended: 0,
          hidden: 0,
        });
      });
    }
'''
server = replace_once(server, old_existing, new_existing, 'settings fallback')

old_patch = '''  const productPatch = { updated_at: input.updated_at };
  ["sale_price", "promo_discount_percent", "hidden", "customer_recommended"].forEach((key) => {
    if (hasInput(key)) productPatch[key] = input[key];
  });
'''
new_patch = '''  const productPatch = { updated_at: input.updated_at };
  if (hasInput("sale_price")) productPatch.promo_price = numberValue(input.sale_price);
  ["promo_discount_percent", "hidden", "customer_recommended"].forEach((key) => {
    if (hasInput(key)) productPatch[key] = input[key];
  });
'''
server = replace_once(server, old_patch, new_patch, 'products mirror patch')

old_order = '''  const products = await withCurrentDatabase((db) => {
    const columns = columnsFor(db, "products");
    const select = [
      "sku",
      "description",
      "standard_cost",
      columns.has("base_price") ? "base_price" : "0 AS base_price",
      columns.has("purchase_price") ? "purchase_price" : "0 AS purchase_price",
      columns.has("sale_price") ? "sale_price" : "0 AS sale_price",
      columns.has("promo_discount_percent") ? "promo_discount_percent" : "0 AS promo_discount_percent",
      columns.has("units_per_carton") ? "units_per_carton" : "1 AS units_per_carton",
    ].join(", ");
    const skus = [...new Set(normalizedItems.map((item) => item.sku))];
    const placeholders = skus.map(() => "?").join(",");
    return sqliteRows(db, `SELECT ${select} FROM products WHERE sku IN (${placeholders})`, skus);
  });
'''
new_order = '''  const products = await withCurrentDatabase((db) => {
    const columns = columnsFor(db, "products");
    const hasProductSettings = tableExists(db, "product_customer_settings");
    const select = [
      "p.sku",
      "p.description",
      "p.standard_cost",
      columns.has("base_price") ? "p.base_price" : "0 AS base_price",
      columns.has("purchase_price") ? "p.purchase_price" : "0 AS purchase_price",
      hasProductSettings ? "COALESCE(pcs.sale_price, 0) AS sale_price" : "0 AS sale_price",
      hasProductSettings ? "COALESCE(pcs.promo_discount_percent, 0) AS promo_discount_percent" : "0 AS promo_discount_percent",
      columns.has("units_per_carton") ? "p.units_per_carton" : "1 AS units_per_carton",
    ].join(", ");
    const skus = [...new Set(normalizedItems.map((item) => item.sku))];
    const placeholders = skus.map(() => "?").join(",");
    return sqliteRows(db, `
      SELECT ${select}
      FROM products p
      ${hasProductSettings ? "LEFT JOIN product_customer_settings pcs ON pcs.sku = p.sku" : ""}
      WHERE p.sku IN (${placeholders})
    `, skus);
  });
'''
server = replace_once(server, old_order, new_order, 'customer order product pricing')
server_path.write_text(server)

management_path = Path('management/app.js')
management = management_path.read_text()
count_sale = management.count('COALESCE(s.sale_price, p.sale_price, 0)')
count_disc = management.count('COALESCE(s.promo_discount_percent, p.promo_discount_percent, 0)')
if count_sale < 1 or count_disc < 1:
    raise SystemExit(f'expected management promo fallbacks not found: sale={count_sale} disc={count_disc}')
management = management.replace('COALESCE(s.sale_price, p.sale_price, 0)', 'COALESCE(s.sale_price, 0)')
management = management.replace('COALESCE(s.promo_discount_percent, p.promo_discount_percent, 0)', 'COALESCE(s.promo_discount_percent, 0)')
management_path.write_text(management)

print(f'patched server.js and management/app.js; management replacements sale={count_sale}, discount={count_disc}')
