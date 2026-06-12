const { createPriceAuditService, isAuthorized } = require("../../price-audit-core");

const service = createPriceAuditService();

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ ok: false, error: "method not allowed" });
    return;
  }
  if (!isAuthorized(req, process.env.PRICE_AUDIT_API_KEY || "")) {
    res.status(401).json({ ok: false, error: "unauthorized" });
    return;
  }
  const { barcode = "", itemCode = "" } = req.query || {};
  if (!barcode && !itemCode) {
    res.status(400).json({ ok: false, error: "barcode or itemCode is required" });
    return;
  }

  try {
    const result = await service.findProduct({ barcode, itemCode });
    if (!result.product) {
      res.status(404).json({ ok: false, match_type: "not_found" });
      return;
    }
    res.status(200).json(result.product);
  } catch (error) {
    res.status(error.status || 500).json({ ok: false, error: error.message || "price audit lookup failed" });
  }
};
