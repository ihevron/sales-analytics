from pathlib import Path

# Patch customer app to prefer current Postgres customer-product settings over stale SQLite settings.

server_path = Path('server.js')
server = server_path.read_text()

helper_marker = 'async function handleCustomerProducts(req, res) {'
helper_code = '''async function loadCustomerProductSettingsOverride() {
  if (!usePostgresPreview) return null;
  try {
    const rows = await postgresRows("product_customer_settings?select=sku,sale_price,promo_discount_percent,hidden,customer_recommended,updated_at&limit=10000");
    return new Map(rows.map((row) => [String(row.sku || ""), row]));
  } catch (error) {
    console.warn("customer product settings override unavailable", error.message || error);
    return null;
  }
}

function applyCustomerProductSettingsOverride(row, settings) {
  if (!settings) return row;
  const saved = settings.get(String(row.sku || ""));
  if (!saved) {
    return { ...row, sale_price: 0, promo_discount_percent: 0 };
  }
  return {
    ...row,
    sale_price: numberValue(saved.sale_price),
    promo_discount_percent: numberValue(saved.promo_discount_percent),
    hidden: numberValue(saved.hidden) ? 1 : 0,
    customer_recommended: numberValue(saved.customer_recommended) ? 1 : 0,
  };
}

'''
if 'async function loadCustomerProductSettingsOverride()' not in server:
    if helper_marker not in server:
        raise SystemExit('handleCustomerProducts marker missing')
    server = server.replace(helper_marker, helper_code + helper_marker, 1)

limit_line = '  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 200), 1), 3000);\n'
if 'const postgresCustomerProductSettings = await loadCustomerProductSettingsOverride();' not in server:
    if limit_line not in server:
        raise SystemExit('customer products limit line missing')
    server = server.replace(limit_line, limit_line + '  const postgresCustomerProductSettings = await loadCustomerProductSettingsOverride();\n', 1)

visible_line = '    const visibleProducts = all.filter((row) => numberValue(row.hidden) !== 1);\n'
if 'const effectiveProducts = all.map((row) => applyCustomerProductSettingsOverride(row, postgresCustomerProductSettings));' not in server:
    if visible_line not in server:
        raise SystemExit('visibleProducts line missing')
    server = server.replace(
        visible_line,
        '    const effectiveProducts = all.map((row) => applyCustomerProductSettingsOverride(row, postgresCustomerProductSettings));\n'
        '    const visibleProducts = effectiveProducts.filter((row) => numberValue(row.hidden) !== 1);\n',
        1,
    )

terms_block = '''  if (shouldRequireTermsAcceptance(profile, termsVersion)) {
    sendJson(res, 403, { ok: false, error: "terms_required" });
    return;
  }

  const products = await withCurrentDatabase((db) => {
'''
if 'const postgresOrderProductSettings = await loadCustomerProductSettingsOverride();' not in server:
    if terms_block not in server:
        raise SystemExit('customer order terms block missing')
    server = server.replace(
        terms_block,
        '''  if (shouldRequireTermsAcceptance(profile, termsVersion)) {
    sendJson(res, 403, { ok: false, error: "terms_required" });
    return;
  }

  const postgresOrderProductSettings = await loadCustomerProductSettingsOverride();
  const products = await withCurrentDatabase((db) => {
''',
        1,
    )

by_sku_line = '  const bySku = new Map(products.map((product) => [String(product.sku || ""), product]));\n'
if 'const effectiveOrderProducts = products.map((product) => applyCustomerProductSettingsOverride(product, postgresOrderProductSettings));' not in server:
    if by_sku_line not in server:
        raise SystemExit('order bySku line missing')
    server = server.replace(
        by_sku_line,
        '  const effectiveOrderProducts = products.map((product) => applyCustomerProductSettingsOverride(product, postgresOrderProductSettings));\n'
        '  const bySku = new Map(effectiveOrderProducts.map((product) => [String(product.sku || ""), product]));\n',
        1,
    )

server_path.write_text(server)
print('patched customer promotions runtime source-of-truth')
