const { createPriceAuditService, isAuthorized } = require("../../../price-audit-core");

const service = createPriceAuditService();

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "method not allowed" });
    return;
  }
  if (!isAuthorized(req, process.env.PRICE_AUDIT_API_KEY || "")) {
    res.status(401).json({ ok: false, error: "unauthorized" });
    return;
  }

  try {
    const results = await service.batchProducts(req.body?.items);
    res.status(200).json({ results });
  } catch (error) {
    res.status(error.status || 500).json({ ok: false, error: error.message || "batch lookup failed" });
  }
};
