from pathlib import Path


def replace_between(text, start_marker, end_marker, replacement, label):
    start = text.find(start_marker)
    if start < 0:
        raise SystemExit(f"missing start marker: {label}")
    end = text.find(end_marker, start)
    if end < 0:
        raise SystemExit(f"missing end marker: {label}")
    return text[:start] + replacement + "\n\n" + text[end:]


def insert_before_once(text, anchor, insertion, label):
    if insertion.strip() in text:
        return text
    pos = text.find(anchor)
    if pos < 0:
        raise SystemExit(f"missing anchor: {label}")
    return text[:pos] + insertion + "\n" + text[pos:]


# --- HTML: add one persistent fast-action bar ---
index_path = Path("management/index.html")
index = index_path.read_text()
fast_bar = '''            <div id="process-fast-actions" class="process-fast-actions">
              <div class="process-fast-summary">
                <strong id="process-selected-count">0</strong>
                <span id="process-selected-label">הזמנות נבחרו</span>
              </div>
              <div class="process-fast-buttons">
                <button class="secondary-action" id="process-select-visible" type="button">בחר הכל שמוצג</button>
                <button class="primary-action" id="process-advance-selected" type="button" disabled>העבר לשלב הבא</button>
                <button class="secondary-action" id="process-stage-picked" type="button" disabled>לוקט</button>
                <button class="secondary-action" id="process-stage-shipping" type="button" disabled>מוכן למשלוח</button>
                <button class="primary-action" id="process-stage-shipped" type="button" disabled>נשלח</button>
                <button class="secondary-action" id="process-export-selected" type="button" disabled>יצוא לפריוריטי</button>
                <button class="secondary-action" id="process-clear-selection" type="button" disabled>בטל בחירה</button>
              </div>
            </div>'''
index = insert_before_once(
    index,
    '            <div class="process-pane active" data-process-pane="orders">',
    fast_bar,
    "process fast action bar",
)
index_path.write_text(index)


# --- CSS: sticky action bar + easy row selection ---
styles_path = Path("management/styles.css")
styles = styles_path.read_text()
css = r'''

/* Fast workflow for order processing */
.process-fast-actions {
  position: sticky;
  top: 8px;
  z-index: 18;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin: 12px 0;
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.97);
  border: 1px solid #d7dde5;
  border-radius: 12px;
  box-shadow: 0 5px 18px rgba(15, 23, 42, 0.08);
  backdrop-filter: blur(8px);
}

.process-fast-summary {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 120px;
  font-weight: 700;
}

.process-fast-summary strong {
  font-size: 1.35rem;
}

.process-fast-buttons {
  display: flex;
  align-items: center;
  gap: 7px;
  flex-wrap: wrap;
}

#order-history tr.process-row-selectable {
  cursor: pointer;
}

#order-history tr.process-row-selectable:hover td {
  background: rgba(59, 130, 246, 0.045);
}

#order-history tr.process-row-selected td {
  background: rgba(59, 130, 246, 0.12) !important;
}

#order-history [data-process-select] {
  width: 19px;
  height: 19px;
  cursor: pointer;
}

@media (max-width: 760px) {
  .process-fast-actions {
    top: 4px;
    align-items: stretch;
  }
  .process-fast-buttons {
    width: 100%;
  }
  .process-fast-buttons button {
    flex: 1 1 calc(50% - 7px);
    min-height: 42px;
  }
}
'''
if "/* Fast workflow for order processing */" not in styles:
    styles += css
styles_path.write_text(styles)


# --- JS: fast selection + true batch transitions ---
app_path = Path("management/app.js")
app = app_path.read_text()

# Add event bindings once near existing history controls.
bind_anchor = '''  document.querySelectorAll("#export-selected-priority").forEach((button) => button.addEventListener("click", exportSelectedPriorityOrders));'''
bind_insert = '''  document.getElementById("process-select-visible")?.addEventListener("click", selectVisibleProcessOrders);
  document.getElementById("process-clear-selection")?.addEventListener("click", clearProcessOrderSelection);
  document.getElementById("process-advance-selected")?.addEventListener("click", advanceSelectedProcessOrders);
  document.getElementById("process-stage-picked")?.addEventListener("click", () => markSelectedProcessOrdersPicked());
  document.getElementById("process-stage-shipping")?.addEventListener("click", () => markSelectedPickedOrdersInvoicesPrinted());
  document.getElementById("process-stage-shipped")?.addEventListener("click", () => markSelectedProcessOrdersShippedBatch());
  document.getElementById("process-export-selected")?.addEventListener("click", exportSelectedPriorityOrders);
'''
if 'document.getElementById("process-select-visible")' not in app:
    pos = app.find(bind_anchor)
    if pos < 0:
        raise SystemExit("missing history bind anchor")
    app = app[:pos] + bind_insert + app[pos:]

# Add a checkbox to the pending-only table as well.
pending_anchor = '''  renderTable("process-pending-table", pendingRows, [
    { key: "id", label: "מספר הזמנה", render: (row) => `<button class="table-link-button" data-view-process-order="${row.id}">${integer(row.id)}</button>` },'''
pending_replacement = '''  renderTable("process-pending-table", pendingRows, [
    { key: "select", label: "", sortable: false, render: (row) => `<input type="checkbox" data-process-select="${row.id}" ${state.selectedProcessOrders.has(String(row.id)) ? "checked" : ""} />` },
    { key: "id", label: "מספר הזמנה", render: (row) => `<button class="table-link-button" data-view-process-order="${row.id}">${integer(row.id)}</button>` },'''
if pending_anchor in app:
    app = app.replace(pending_anchor, pending_replacement, 1)
elif 'renderTable("process-pending-table", pendingRows' not in app:
    raise SystemExit("missing pending table render")

# Replace lightweight selection binding with row-click selection and persistent action bar state.
selection_code = r'''function processSelectedRows() {
  const ids = [...state.selectedProcessOrders].map((id) => String(id));
  if (!ids.length) return [];
  const placeholders = ids.map(() => "?").join(",");
  return queryRows(`
    SELECT id, status, invoice_printed, shipped_at
    FROM customer_orders
    WHERE CAST(id AS TEXT) IN (${placeholders})
      AND COALESCE(process_hidden, 0) = 0
  `, ids);
}

function updateProcessSelectionUi() {
  const count = state.selectedProcessOrders.size;
  const countEl = document.getElementById("process-selected-count");
  const labelEl = document.getElementById("process-selected-label");
  if (countEl) countEl.textContent = integer(count);
  if (labelEl) labelEl.textContent = count === 1 ? "הזמנה נבחרה" : "הזמנות נבחרו";

  ["process-advance-selected", "process-stage-picked", "process-stage-shipping", "process-stage-shipped", "process-export-selected", "process-clear-selection"].forEach((id) => {
    const button = document.getElementById(id);
    if (button) button.disabled = count === 0;
  });

  document.querySelectorAll("#order-history [data-process-select]").forEach((input) => {
    const selected = state.selectedProcessOrders.has(String(input.dataset.processSelect));
    input.checked = selected;
    input.closest("tr")?.classList.toggle("process-row-selected", selected);
  });

  const rows = processSelectedRows();
  const pending = rows.filter((row) => String(row.status || "") === ORDER_STATUSES[0]).length;
  const picked = rows.filter((row) => String(row.status || "") === "picked").length;
  const shipping = rows.filter((row) => String(row.status || "") === ORDER_STATUSES[2]).length;
  const advance = document.getElementById("process-advance-selected");
  if (advance && count) {
    const parts = [];
    if (pending) parts.push(`${integer(pending)} ללוקט`);
    if (picked) parts.push(`${integer(picked)} למשלוח`);
    if (shipping) parts.push(`${integer(shipping)} לנשלח`);
    advance.textContent = parts.length ? `העבר לשלב הבא · ${parts.join(" · ")}` : "העבר לשלב הבא";
  } else if (advance) {
    advance.textContent = "העבר לשלב הבא";
  }
}

function bindProcessOrderSelection() {
  document.querySelectorAll("#order-history [data-process-select]").forEach((input) => input.addEventListener("change", () => {
    if (input.checked) state.selectedProcessOrders.add(String(input.dataset.processSelect));
    else state.selectedProcessOrders.delete(String(input.dataset.processSelect));
    updateProcessSelectionUi();
  }));

  document.querySelectorAll("#order-history [data-process-pane] table tbody tr").forEach((row) => {
    const checkbox = row.querySelector("[data-process-select]");
    if (!checkbox) return;
    row.classList.add("process-row-selectable");
    row.addEventListener("click", (event) => {
      if (event.target.closest("button, input, select, a, label")) return;
      checkbox.checked = !checkbox.checked;
      checkbox.dispatchEvent(new Event("change", { bubbles: true }));
    });
  });
  updateProcessSelectionUi();
}

function visibleProcessSelectionInputs() {
  const pane = document.querySelector('#order-history [data-process-pane].active');
  if (!pane) return [];
  return [...pane.querySelectorAll('[data-process-select]')].filter((input) => !input.disabled);
}

function selectVisibleProcessOrders() {
  const inputs = visibleProcessSelectionInputs();
  if (!inputs.length) return alert("אין הזמנות לבחירה בתצוגה הנוכחית.");
  inputs.forEach((input) => state.selectedProcessOrders.add(String(input.dataset.processSelect)));
  updateProcessSelectionUi();
}

function clearProcessOrderSelection() {
  state.selectedProcessOrders.clear();
  updateProcessSelectionUi();
}
'''
app = replace_between(app, "function bindProcessOrderSelection() {", "function missedOrdersCount(", selection_code, "process selection")

# Batch helpers. One local transaction + one persistence cycle instead of N full cycles.
batch_helpers = r'''async function markProcessOrdersPickedBatch(orderIds, options = {}) {
  const ids = [...new Set((orderIds || []).map((id) => String(id)).filter(Boolean))];
  if (!ids.length) return { ok: true, updated: 0 };
  const placeholders = ids.map(() => "?").join(",");
  const pendingItems = queryRows(`
    SELECT id, order_id, quantity, picked_quantity, substitute_product_id
    FROM customer_order_items
    WHERE CAST(order_id AS TEXT) IN (${placeholders})
      AND COALESCE(item_status, 'pending') = 'pending'
    ORDER BY order_id, id
  `, ids);
  const now = new Date().toISOString();
  const sequenceStart = nextActionSequence();
  state.db.run("BEGIN TRANSACTION");
  pendingItems.forEach((item, index) => {
    const itemStatus = item.substitute_product_id ? "substituted" : "picked";
    const pickedQuantity = number(item.picked_quantity) > 0 ? number(item.picked_quantity) : number(item.quantity);
    state.db.run(
      "UPDATE customer_order_items SET item_status = ?, picked_quantity = ?, action_sequence = ? WHERE id = ?",
      [itemStatus, pickedQuantity, sequenceStart + index, item.id]
    );
  });
  ids.forEach((orderId) => {
    state.db.run(
      "UPDATE customer_orders SET status = 'picked', picked_by = ?, picked_at = ?, updated_at = ? WHERE id = ?",
      ["ליקוט מרוכז", now, now, orderId]
    );
  });
  state.db.run("COMMIT");

  pendingItems.forEach((item, index) => {
    const itemStatus = item.substitute_product_id ? "substituted" : "picked";
    const pickedQuantity = number(item.picked_quantity) > 0 ? number(item.picked_quantity) : number(item.quantity);
    queuePickingChange({ type: "itemStatus", itemId: item.id, itemStatus, pickedQuantity, actionSequence: sequenceStart + index });
  });
  ids.forEach((orderId) => queuePickingChange({ type: "completeOrder", orderId, pickedBy: "ליקוט מרוכז", pickedAt: now, updatedAt: now }));

  await savePickingNow({ silent: true });
  state.forceSqliteOrderHistoryUntil = Date.now() + 10 * 60 * 1000;
  if (options.clearSelection !== false) ids.forEach((id) => state.selectedProcessOrders.delete(String(id)));
  if (options.render !== false) {
    renderPicking();
    renderOrderHistory();
  }
  return { ok: true, updated: ids.length };
}

async function markProcessOrdersReadyForShippingBatch(orderIds, options = {}) {
  const ids = [...new Set((orderIds || []).map((id) => String(id)).filter(Boolean))];
  if (!ids.length) return { ok: true, updated: 0 };
  const placeholders = ids.map(() => "?").join(",");
  const rows = queryRows(`SELECT id, status FROM customer_orders WHERE CAST(id AS TEXT) IN (${placeholders})`, ids);
  const pendingIds = rows.filter((row) => String(row.status || "") === ORDER_STATUSES[0]).map((row) => String(row.id));
  if (pendingIds.length) {
    await markProcessOrdersPickedBatch(pendingIds, { clearSelection: false, render: false });
  }

  const now = new Date().toISOString();
  state.db.run("BEGIN TRANSACTION");
  ids.forEach((orderId) => {
    state.db.run("UPDATE customer_orders SET invoice_printed = 1, status = ?, updated_at = ? WHERE id = ?", [ORDER_STATUSES[2], now, orderId]);
  });
  state.db.run("COMMIT");
  await writeBrowserDatabase(state.db.export());
  const result = await writeOrdersBatchPatch(ids, { invoice_printed: true, status: ORDER_STATUSES[2], updated_at: now });
  state.forceSqliteOrderHistoryUntil = Date.now() + 10 * 60 * 1000;
  if (options.clearSelection !== false) ids.forEach((id) => state.selectedProcessOrders.delete(String(id)));
  if (!result.ok) alert(`השמירה לשרת נכשלה: ${result.error || "שגיאה לא ידועה"}`);
  if (options.render !== false) renderOrderHistory();
  return result;
}

async function markProcessOrdersShippedBatchByIds(orderIds, options = {}) {
  const ids = [...new Set((orderIds || []).map((id) => String(id)).filter(Boolean))];
  if (!ids.length) return { ok: true, updated: 0 };
  const placeholders = ids.map(() => "?").join(",");
  const rows = queryRows(`SELECT id, status FROM customer_orders WHERE CAST(id AS TEXT) IN (${placeholders})`, ids);
  const notReady = rows.filter((row) => String(row.status || "") !== ORDER_STATUSES[2] && String(row.status || "") !== "נשלחה").map((row) => String(row.id));
  if (notReady.length) {
    await markProcessOrdersReadyForShippingBatch(notReady, { clearSelection: false, render: false });
  }
  const now = new Date().toISOString();
  state.db.run("BEGIN TRANSACTION");
  ids.forEach((orderId) => {
    state.db.run("UPDATE customer_orders SET invoice_printed = 1, status = 'נשלחה', shipped_at = ?, process_hidden = 0, updated_at = ? WHERE id = ?", [now, now, orderId]);
  });
  state.db.run("COMMIT");
  await writeBrowserDatabase(state.db.export());
  const result = await writeOrdersBatchPatch(ids, { invoice_printed: true, status: "נשלחה", shipped_at: now, process_hidden: false, updated_at: now });
  state.forceSqliteOrderHistoryUntil = Date.now() + 10 * 60 * 1000;
  if (options.clearSelection !== false) ids.forEach((id) => state.selectedProcessOrders.delete(String(id)));
  if (!result.ok) alert(`השמירה לשרת נכשלה: ${result.error || "שגיאה לא ידועה"}`);
  if (options.render !== false) renderOrderHistory();
  return result;
}

async function advanceSelectedProcessOrders() {
  const ids = selectedActiveProcessOrderIds();
  if (!ids.length) return alert("יש לבחור לפחות הזמנה פעילה אחת.");
  const placeholders = ids.map(() => "?").join(",");
  const rows = queryRows(`SELECT id, status FROM customer_orders WHERE CAST(id AS TEXT) IN (${placeholders})`, ids);
  const pendingIds = rows.filter((row) => String(row.status || "") === ORDER_STATUSES[0]).map((row) => String(row.id));
  const pickedIds = rows.filter((row) => String(row.status || "") === "picked").map((row) => String(row.id));
  const shippingIds = rows.filter((row) => String(row.status || "") === ORDER_STATUSES[2]).map((row) => String(row.id));
  const summary = [
    pendingIds.length ? `${integer(pendingIds.length)} ללוקט` : "",
    pickedIds.length ? `${integer(pickedIds.length)} למוכן למשלוח` : "",
    shippingIds.length ? `${integer(shippingIds.length)} לנשלח` : "",
  ].filter(Boolean).join(" · ");
  if (!confirm(`להעביר את הנבחרות שלב אחד קדימה?${summary ? `\n${summary}` : ""}`)) return;

  if (pendingIds.length) await markProcessOrdersPickedBatch(pendingIds, { clearSelection: false, render: false });
  if (pickedIds.length) await markProcessOrdersReadyForShippingBatch(pickedIds, { clearSelection: false, render: false });
  if (shippingIds.length) await markProcessOrdersShippedBatchByIds(shippingIds, { clearSelection: false, render: false });
  ids.forEach((id) => state.selectedProcessOrders.delete(String(id)));
  renderPicking();
  renderOrderHistory();
}
'''
app = insert_before_once(app, "function selectAllPickedProcessOrders() {", batch_helpers, "process batch helpers")

picked_public = r'''async function markSelectedProcessOrdersPicked(options = {}) {
  const ids = selectedPickedOrderIds();
  if (!ids.length) return alert("יש לבחור לפחות הזמנה אחת.");
  const rows = queryRows(`SELECT id, status FROM customer_orders WHERE CAST(id AS TEXT) IN (${ids.map(() => "?").join(",")})`, ids);
  const pendingIds = rows.filter((row) => String(row.status) === ORDER_STATUSES[0]).map((row) => String(row.id));
  if (!pendingIds.length) return alert("אין הזמנות ממתינות לליקוט בין הנבחרות.");
  if (!options.skipConfirm && !confirm(`לסמן ${integer(pendingIds.length)} הזמנות כשלוקטו?`)) return;
  return markProcessOrdersPickedBatch(pendingIds);
}'''
app = replace_between(app, "async function markSelectedProcessOrdersPicked() {", "async function markSelectedPickedOrdersInvoicesPrinted() {", picked_public, "picked batch public")

shipping_public = r'''async function markSelectedPickedOrdersInvoicesPrinted(options = {}) {
  const ids = selectedPickedOrderIds();
  if (!ids.length) return alert("יש לבחור לפחות הזמנה אחת.");
  if (!options.skipConfirm && !confirm(`להעביר ${integer(ids.length)} הזמנות למוכן למשלוח?`)) return;
  return markProcessOrdersReadyForShippingBatch(ids);
}'''
app = replace_between(app, "async function markSelectedPickedOrdersInvoicesPrinted() {", "function selectAllShippingProcessOrders() {", shipping_public, "ready shipping public")

shipped_public = r'''async function markSelectedProcessOrdersShippedBatch(options = {}) {
  const ids = selectedActiveProcessOrderIds();
  if (!ids.length) return alert("יש לבחור לפחות הזמנה אחת.");
  if (!options.skipConfirm && !confirm(`לסמן ${integer(ids.length)} הזמנות כנשלחו?`)) return;
  return markProcessOrdersShippedBatchByIds(ids);
}'''
app = replace_between(app, "async function markSelectedProcessOrdersShippedBatch() {", "async function hideSelectedShippingOrders() {", shipped_public, "shipped batch public")

app_path.write_text(app)
print("optimized order process UX and batch transitions")
