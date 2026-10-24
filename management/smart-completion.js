(function () {
  "use strict";

  const MAX_SELECTED = 4;
  let smartState = null;

  function ensureModal() {
    if (document.getElementById("smart-completion-backdrop")) return;
    const wrap = document.createElement("div");
    wrap.innerHTML =
      '<div id="smart-completion-backdrop" class="modal-backdrop hidden smart-completion-backdrop" role="dialog" aria-modal="true" aria-labelledby="smart-completion-title">' +
        '<div class="modal smart-completion-modal">' +
          '<div class="panel-header">' +
            '<div><h2 id="smart-completion-title">השלמת הזמנה חכמה</h2><p id="smart-completion-subtitle"></p></div>' +
            '<button id="smart-completion-close" class="icon-button modal-close" aria-label="סגירה">×</button>' +
          '</div>' +
          '<p class="smart-completion-help">בחר את המוצרים שיופיעו בהודעה. הסרת מוצר תעלה אוטומטית את המועמד הבא.</p>' +
          '<div id="smart-completion-list" class="smart-completion-list"></div>' +
          '<label class="smart-message-label">תצוגה מקדימה של ההודעה<textarea id="smart-completion-message" rows="8"></textarea></label>' +
          '<div id="smart-completion-status" class="muted-note"></div>' +
          '<div class="form-actions modal-actions">' +
            '<button id="smart-completion-send" class="primary-action" type="button">פתח WhatsApp</button>' +
            '<button id="smart-completion-copy" class="secondary-action" type="button">העתק הודעה</button>' +
            '<button id="smart-completion-cancel" class="secondary-action" type="button">סגור</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrap.firstElementChild);

    document.getElementById("smart-completion-close").addEventListener("click", closeModal);
    document.getElementById("smart-completion-cancel").addEventListener("click", closeModal);
    document.getElementById("smart-completion-copy").addEventListener("click", copyMessage);
    document.getElementById("smart-completion-send").addEventListener("click", sendWhatsapp);
    document.getElementById("smart-completion-backdrop").addEventListener("click", function (event) {
      if (event.target.id === "smart-completion-backdrop") closeModal();
    });
  }

  function candidatesFor(customerNo, currentItems) {
    const orderedSkus = new Set(
      (currentItems || [])
        .filter(function (item) { return !item.is_return && number(item.quantity) > 0; })
        .map(function (item) { return String(item.sku || "").trim(); })
        .filter(Boolean)
    );

    const sql = [
      "WITH customer_days AS (",
      " SELECT COUNT(DISTINCT sale_date) AS order_days",
      " FROM sales_raw",
      " WHERE customer_no = ? AND sale_date >= DATE('now', '-180 day') AND COALESCE(quantity, 0) > 0",
      "), product_history AS (",
      " SELECT s.sku, COALESCE(MAX(NULLIF(s.product_desc, '')), MAX(p.description), s.sku) AS product_desc,",
      " COUNT(DISTINCT s.sale_date) AS purchase_days, MAX(s.sale_date) AS last_sale_date,",
      " SUM(CASE WHEN s.quantity > 0 THEN s.quantity ELSE 0 END) AS purchase_units,",
      " COALESCE(MAX(p.hidden), 0) AS product_hidden, COALESCE(MAX(pcs.hidden), 0) AS settings_hidden,",
      " (SELECT order_days FROM customer_days) AS order_days",
      " FROM sales_raw s",
      " LEFT JOIN products p ON p.sku = s.sku",
      " LEFT JOIN product_customer_settings pcs ON pcs.sku = s.sku",
      " WHERE s.customer_no = ? AND s.sale_date >= DATE('now', '-180 day')",
      " AND COALESCE(s.quantity, 0) > 0 AND COALESCE(s.sku, '') <> ''",
      " GROUP BY s.sku",
      ")",
      "SELECT * FROM product_history",
      "WHERE product_hidden = 0 AND settings_hidden = 0 AND purchase_days >= 2",
      "ORDER BY purchase_days DESC, last_sale_date DESC, purchase_units DESC LIMIT 60"
    ].join(" ");

    const rows = queryRows(sql, [customerNo, customerNo]);
    const maxUnits = Math.max.apply(null, [1].concat(rows.map(function (row) { return number(row.purchase_units); })));

    return rows
      .filter(function (row) { return !orderedSkus.has(String(row.sku || "")); })
      .map(function (row) {
        const orderDays = Math.max(1, number(row.order_days));
        const frequency = Math.min(1, number(row.purchase_days) / orderDays);
        const lastDate = Date.parse(row.last_sale_date || "");
        const daysSince = Number.isFinite(lastDate) ? Math.max(0, (Date.now() - lastDate) / 86400000) : 365;
        const recency = Math.max(0, 1 - Math.min(daysSince, 90) / 90);
        const volume = Math.min(1, number(row.purchase_units) / maxUnits);
        return {
          sku: String(row.sku || ""),
          product_desc: text(row.product_desc || row.sku),
          purchase_days: number(row.purchase_days),
          order_days: orderDays,
          last_sale_date: text(row.last_sale_date),
          score: Math.round((frequency * 55 + recency * 30 + volume * 15) * 100) / 100
        };
      })
      .sort(function (a, b) {
        return b.score - a.score || b.purchase_days - a.purchase_days || String(b.last_sale_date).localeCompare(String(a.last_sale_date));
      })
      .slice(0, 10);
  }

  function contactFor(customerNo) {
    const profile = firstRow(
      "SELECT phone, phone2, contact FROM customer_call_profiles WHERE customer_no = ? LIMIT 1",
      [customerNo]
    );
    return {
      phone: String(profile.phone || profile.phone2 || "").replace(/\D/g, "").replace(/^0/, "972"),
      contact: text(profile.contact || "")
    };
  }

  function autoFill() {
    if (!smartState) return;
    smartState.candidates.forEach(function (item) {
      if (smartState.selected.size >= MAX_SELECTED) return;
      if (!smartState.excluded.has(item.sku) && !smartState.selected.has(item.sku)) smartState.selected.add(item.sku);
    });
  }

  function messageText() {
    if (!smartState) return "";
    const selected = smartState.candidates.filter(function (item) { return smartState.selected.has(item.sku); });
    const greeting = smartState.contact || smartState.customer.customer_name || "";
    const lines = selected.map(function (item) { return "• " + item.product_desc; });
    return [
      "היי " + greeting + ", קיבלנו את ההזמנה שלך 👍",
      "שמנו לב שבדרך כלל אתה מזמין גם:",
      "",
      lines.join("\n"),
      "",
      "תרצה להוסיף משהו מהם להזמנה? כתוב לנו איזה מוצר ובאיזו כמות."
    ].join("\n");
  }

  function render() {
    if (!smartState) return;
    autoFill();
    const list = document.getElementById("smart-completion-list");
    document.getElementById("smart-completion-title").textContent = "השלמת הזמנה חכמה · #" + (smartState.orderId || "");
    document.getElementById("smart-completion-subtitle").textContent =
      (smartState.customer.customer_name || "") + " · " + smartState.selected.size + " מוצרים בהודעה מתוך " + smartState.candidates.length + " מועמדים";

    list.innerHTML = smartState.candidates.map(function (item, index) {
      const selected = smartState.selected.has(item.sku);
      const excluded = smartState.excluded.has(item.sku);
      const confidence = Math.max(1, Math.min(99, Math.round(item.score)));
      return '<div class="smart-completion-row ' + (selected ? "selected " : "") + (excluded ? "excluded" : "") + '">' +
        '<label class="smart-completion-check">' +
          '<input type="checkbox" data-smart-select="' + escapeAttr(item.sku) + '" ' + (selected ? "checked" : "") + ' ' + (excluded ? "disabled" : "") + ' />' +
          '<span class="smart-rank">' + (index + 1) + '</span>' +
          '<span class="smart-product-main"><strong>' + escapeHtml(item.product_desc) + '</strong>' +
          '<small>מק״ט ' + escapeHtml(item.sku) + ' · נקנה ב-' + integer(item.purchase_days) + ' מתוך ' + integer(item.order_days) +
          ' ימי רכישה · רכישה אחרונה ' + escapeHtml(item.last_sale_date || "—") + '</small></span>' +
        '</label>' +
        '<div class="smart-completion-score">' + integer(confidence) + '%</div>' +
        '<button type="button" class="secondary-action" data-smart-skip="' + escapeAttr(item.sku) + '">' + (excluded ? "הוחרג" : "דלג / חסר") + '</button>' +
      '</div>';
    }).join("");

    list.querySelectorAll("[data-smart-select]").forEach(function (input) {
      input.addEventListener("change", function () {
        const sku = input.dataset.smartSelect;
        if (input.checked) {
          if (smartState.selected.size >= MAX_SELECTED) {
            input.checked = false;
            alert("בשלב הניסיון ניתן לשלוח עד 4 מוצרים בהודעה.");
            return;
          }
          smartState.selected.add(sku);
        } else {
          smartState.selected.delete(sku);
          autoFill();
        }
        smartState.messageEdited = false;
        render();
      });
    });

    list.querySelectorAll("[data-smart-skip]").forEach(function (button) {
      button.addEventListener("click", function () {
        const sku = button.dataset.smartSkip;
        smartState.selected.delete(sku);
        smartState.excluded.add(sku);
        autoFill();
        smartState.messageEdited = false;
        render();
      });
    });

    const textarea = document.getElementById("smart-completion-message");
    if (!smartState.messageEdited) textarea.value = messageText();
    textarea.oninput = function () { smartState.messageEdited = true; };

    const send = document.getElementById("smart-completion-send");
    send.disabled = !smartState.phone || smartState.selected.size === 0;
    send.textContent = smartState.phone ? "פתח WhatsApp" : "אין מספר WhatsApp";
    document.getElementById("smart-completion-status").textContent = smartState.phone
      ? "לא נשלח אוטומטית — WhatsApp ייפתח רק לאחר אישור."
      : "לא נמצא מספר טלפון ללקוח. ניתן להעתיק את ההודעה.";
  }

  function closeModal() {
    const modal = document.getElementById("smart-completion-backdrop");
    if (modal) modal.classList.add("hidden");
    smartState = null;
  }

  async function copyMessage() {
    const textarea = document.getElementById("smart-completion-message");
    if (!textarea || !textarea.value) return;
    try {
      await navigator.clipboard.writeText(textarea.value);
      document.getElementById("smart-completion-status").textContent = "ההודעה הועתקה.";
    } catch (error) {
      textarea.select();
      document.execCommand("copy");
    }
  }

  function sendWhatsapp() {
    if (!smartState || !smartState.phone) return;
    const textarea = document.getElementById("smart-completion-message");
    const message = textarea && textarea.value ? textarea.value : messageText();
    window.open(whatsappUrl(smartState.phone, message), "_blank", "noopener");
    document.getElementById("smart-completion-status").textContent = "WhatsApp נפתח. בדוק ושלח את ההודעה.";
  }

  window.openSmartCompletionAfterOrder = function (context) {
    ensureModal();
    if (!context || !context.customer || !context.customer.customer_no) return;
    const candidates = candidatesFor(context.customer.customer_no, context.items || []);
    if (!candidates.length) return;
    const contact = contactFor(context.customer.customer_no);
    smartState = {
      orderId: context.orderId || "",
      customer: context.customer,
      items: context.items || [],
      candidates: candidates,
      selected: new Set(candidates.slice(0, Math.min(MAX_SELECTED, candidates.length)).map(function (item) { return item.sku; })),
      excluded: new Set(),
      phone: contact.phone,
      contact: contact.contact,
      messageEdited: false
    };
    document.getElementById("smart-completion-backdrop").classList.remove("hidden");
    render();
  };

  document.addEventListener("DOMContentLoaded", ensureModal);
})();