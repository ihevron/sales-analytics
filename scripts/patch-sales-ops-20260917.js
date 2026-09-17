const fs = require('fs');

function replaceOnce(source, before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected 1 match, found ${count}`);
  return source.replace(before, after);
}

function patchServer() {
  const file = 'server.js';
  let s = fs.readFileSync(file, 'utf8');

  s = replaceOnce(
    s,
    'sourceRows = sortProducts(baseRows.filter((row) => productPromoPrice(row) > 0 || numberValue(row.customer_recommended) > 0));',
    'sourceRows = sortProducts(baseRows.filter((row) => productPromoPrice(row) > 0));',
    'customer deals must contain actual promotions only',
  );

  s = replaceOnce(
    s,
`async function mirrorOrderToPostgres(orderRow, itemRows, callRow = null) {
  if (!usePostgresPreview || !orderRow?.id) return { ok: true, skipped: true };
  try {
    await postgresUpsert("customer_orders", [normalizePostgresOrder(orderRow)], "id");
    await postgresUpsert("customer_order_items", itemRows.map(normalizePostgresOrderItem), "id");
    if (callRow) await postgresUpsert("customer_calls", [callRow], "call_date,customer_no");
    return { ok: true, orderId: numberValue(orderRow.id), items: itemRows.length };
  } catch (error) {
    console.error("postgres order mirror failed", error);
    return { ok: false, error: friendlyPostgresError(error), rawError: error.message || "postgres order mirror failed" };
  }
}`,
`async function mirrorOrderToPostgres(orderRow, itemRows, callRows = []) {
  if (!usePostgresPreview || !orderRow?.id) return { ok: true, skipped: true };
  const normalizedCallRows = Array.isArray(callRows) ? callRows.filter(Boolean) : (callRows ? [callRows] : []);
  try {
    await postgresUpsert("customer_orders", [normalizePostgresOrder(orderRow)], "id");
    await postgresUpsert("customer_order_items", itemRows.map(normalizePostgresOrderItem), "id");
    if (normalizedCallRows.length) await postgresUpsert("customer_calls", normalizedCallRows, "call_date,customer_no");
    return { ok: true, orderId: numberValue(orderRow.id), items: itemRows.length, calls: normalizedCallRows.length };
  } catch (error) {
    console.error("postgres order mirror failed", error);
    return { ok: false, error: friendlyPostgresError(error), rawError: error.message || "postgres order mirror failed" };
  }
}`,
    'mirror order calls array',
  );

  s = replaceOnce(
    s,
`  const items = Array.isArray(payload?.items) ? payload.items : [];
  if (!order) {`,
`  const items = Array.isArray(payload?.items) ? payload.items : [];
  const calls = Array.isArray(payload?.calls) ? payload.calls.filter(Boolean) : (payload?.call ? [payload.call] : []);
  if (!order) {`,
    'order delta calls normalization',
  );

  s = replaceOnce(
    s,
`    if (payload.call) {
      const call = payload.call;
      db.run("DELETE FROM customer_calls WHERE customer_no = ? AND call_date = ?", [String(call.customer_no || order.customer_no || ""), String(call.call_date || "")]);
      db.run(\`
        INSERT INTO customer_calls (call_date, customer_no, customer_name, status, call_again_time, whatsapp_sent_at, manual_order_id, notes, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      \`, [
        String(call.call_date || ""),
        String(call.customer_no || order.customer_no || ""),
        String(call.customer_name || order.customer_name || ""),
        String(call.status || "ordered"),
        call.call_again_time || null,
        call.whatsapp_sent_at || null,
        numberValue(call.manual_order_id) || orderId || null,
        String(call.notes || ""),
        String(call.updated_at || now),
      ]);
    }`,
`    calls.forEach((call) => {
      db.run("DELETE FROM customer_calls WHERE customer_no = ? AND call_date = ?", [String(call.customer_no || order.customer_no || ""), String(call.call_date || "")]);
      db.run(\`
        INSERT INTO customer_calls (call_date, customer_no, customer_name, status, call_again_time, whatsapp_sent_at, manual_order_id, notes, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      \`, [
        String(call.call_date || ""),
        String(call.customer_no || order.customer_no || ""),
        String(call.customer_name || order.customer_name || ""),
        String(call.status || "ordered"),
        call.call_again_time || null,
        call.whatsapp_sent_at || null,
        numberValue(call.manual_order_id) || orderId || null,
        String(call.notes || ""),
        String(call.updated_at || now),
      ]);
    });`,
    'order delta sqlite calls loop',
  );

  s = replaceOnce(
    s,
`    let postgresCall = null;
    if (payload.call) {
      const call = payload.call;
      postgresCall = {
        call_date: String(call.call_date || ""),
        customer_no: String(call.customer_no || order.customer_no || ""),
        customer_name: String(call.customer_name || order.customer_name || ""),
        status: String(call.status || "ordered"),
        call_again_time: call.call_again_time || null,
        whatsapp_sent_at: call.whatsapp_sent_at || null,
        manual_order_id: numberValue(call.manual_order_id) || orderId || null,
        notes: String(call.notes || ""),
        updated_at: String(call.updated_at || now),
      };
    }
    const postgresResult = await mirrorOrderToPostgres(savedOrderRows[0], savedItemRows, postgresCall);`,
`    const postgresCalls = calls.map((call) => ({
      call_date: String(call.call_date || ""),
      customer_no: String(call.customer_no || order.customer_no || ""),
      customer_name: String(call.customer_name || order.customer_name || ""),
      status: String(call.status || "ordered"),
      call_again_time: call.call_again_time || null,
      whatsapp_sent_at: call.whatsapp_sent_at || null,
      manual_order_id: numberValue(call.manual_order_id) || orderId || null,
      notes: String(call.notes || ""),
      updated_at: String(call.updated_at || now),
    }));
    const postgresResult = await mirrorOrderToPostgres(savedOrderRows[0], savedItemRows, postgresCalls);`,
    'order delta postgres calls loop',
  );

  s = replaceOnce(
    s,
`      call: postgresCall,
      postgres: postgresResult,`,
`      call: postgresCalls[0] || null,
      calls: postgresCalls,
      postgres: postgresResult,`,
    'order delta response calls',
  );

  const callHelpers = `function jerusalemCalendarNow() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day), Number(values.hour) || 0));
}

function customerCallDayIndexes(raw) {
  const aliases = new Map([
    ["א", 0], ["א׳", 0], ["א'", 0], ["ראשון", 0],
    ["ב", 1], ["ב׳", 1], ["ב'", 1], ["שני", 1],
    ["ג", 2], ["ג׳", 2], ["ג'", 2], ["שלישי", 2],
    ["ד", 3], ["ד׳", 3], ["ד'", 3], ["רביעי", 3],
    ["ה", 4], ["ה׳", 4], ["ה'", 4], ["חמישי", 4],
  ]);
  return [...new Set(String(raw || "").split(/[,;|/\\s]+/).map((value) => aliases.get(value.trim())).filter((value) => Number.isInteger(value)))];
}

async function customerPortalCallRows(customerNo, customerName, nowIso) {
  const rawDays = await withCurrentDatabase((db) => {
    if (!tableExists(db, "customer_call_profiles")) return "";
    const columns = columnsFor(db, "customer_call_profiles");
    const dayColumn = columns.has("call_days") ? "call_days" : (columns.has("days") ? "days" : "NULL");
    const rows = sqliteRows(db, \`SELECT \${dayColumn} AS call_days FROM customer_call_profiles WHERE customer_no = ? LIMIT 1\`, [customerNo]);
    return String(rows[0]?.call_days || "");
  });
  const dayIndexes = customerCallDayIndexes(rawDays);
  if (!dayIndexes.length) {
    return [{ call_date: currentDateIso(), customer_no: customerNo, customer_name: customerName, status: "ordered", manual_order_id: null, notes: "הזמנה מהאפליקציה", updated_at: nowIso }];
  }
  const reference = jerusalemCalendarNow();
  if (reference.getUTCDay() > 4 || (reference.getUTCDay() === 4 && reference.getUTCHours() >= 23)) {
    reference.setUTCDate(reference.getUTCDate() + 7);
  }
  reference.setUTCHours(0, 0, 0, 0);
  const sunday = new Date(reference);
  sunday.setUTCDate(sunday.getUTCDate() - sunday.getUTCDay());
  return dayIndexes.map((dayIndex) => {
    const date = new Date(sunday);
    date.setUTCDate(date.getUTCDate() + dayIndex);
    return {
      call_date: date.toISOString().slice(0, 10),
      customer_no: customerNo,
      customer_name: customerName,
      status: "ordered",
      manual_order_id: null,
      notes: "הזמנה מהאפליקציה",
      updated_at: nowIso,
    };
  });
}

`;

  s = replaceOnce(
    s,
    'async function handleCustomerOrder(payload, req, res) {',
    callHelpers + 'async function handleCustomerOrder(payload, req, res) {',
    'customer portal weekly call helpers',
  );

  s = replaceOnce(
    s,
`  return handleOrderDelta({
    order: {
      client_order_key: \`customer-\${session.customer_no}-\${Date.now()}\`,
      order_date: currentDateIso(),
      customer_no: session.customer_no,
      customer_name: customerName,
      status: "מוכן לאיסוף",
      notes: note ? \`הזמנה מאזור לקוח. \${note}\` : "הזמנה מאזור לקוח",
      estimated_total: subtotal,
      estimated_profit: profit,
      updated_at: now,
    },
    items: orderItems,
    call: {
      call_date: currentDateIso(),
      customer_no: session.customer_no,
      customer_name: customerName,
      status: "ordered",
      manual_order_id: null,
      notes: "הזמנה מאזור לקוח",
      updated_at: now,
    },
  }, res);`,
`  const callRows = await customerPortalCallRows(session.customer_no, customerName, now);
  return handleOrderDelta({
    order: {
      client_order_key: \`customer-\${session.customer_no}-\${Date.now()}\`,
      order_date: currentDateIso(),
      customer_no: session.customer_no,
      customer_name: customerName,
      status: "מוכן לאיסוף",
      notes: note ? \`הזמנה מהאפליקציה. \${note}\` : "הזמנה מהאפליקציה",
      estimated_total: subtotal,
      estimated_profit: profit,
      updated_at: now,
    },
    items: orderItems,
    calls: callRows,
  }, res);`,
    'customer portal active weekly call rows',
  );

  const mergeFunction = `async function handleOrdersMerge(payload, res) {
  const targetId = numberValue(payload?.targetOrderId);
  const sourceId = numberValue(payload?.sourceOrderId);
  if (!targetId || !sourceId || targetId === sourceId) {
    sendJson(res, 400, { ok: false, error: "יש לבחור שתי הזמנות שונות" });
    return;
  }

  const SQL = await initServerSql();
  const data = await readCurrentDatabaseBuffer();
  const db = new SQL.Database(new Uint8Array(data));
  const now = new Date().toISOString();
  try {
    ensureServerColumn(db, "customer_orders", "process_hidden", "INTEGER NOT NULL DEFAULT 0");
    const orders = sqliteRows(db, "SELECT * FROM customer_orders WHERE id IN (?, ?)", [targetId, sourceId]);
    const target = orders.find((row) => numberValue(row.id) === targetId);
    const source = orders.find((row) => numberValue(row.id) === sourceId);
    if (!target || !source) {
      sendJson(res, 404, { ok: false, error: "אחת ההזמנות לא נמצאה" });
      return;
    }
    if (String(target.customer_no || "") !== String(source.customer_no || "")) {
      sendJson(res, 409, { ok: false, error: "אפשר לאחד רק הזמנות של אותו לקוח" });
      return;
    }
    if (String(target.status || "") !== "מוכן לאיסוף" || String(source.status || "") !== "מוכן לאיסוף" || target.shipped_at || source.shipped_at || numberValue(target.process_hidden) || numberValue(source.process_hidden)) {
      sendJson(res, 409, { ok: false, error: "אפשר לאחד רק הזמנות פתוחות שעדיין בליקוט" });
      return;
    }
    const sourceStarted = numberValue(sqliteRows(db, \`
      SELECT COUNT(*) AS count
      FROM customer_order_items
      WHERE order_id = ?
        AND COALESCE(item_status, 'pending') NOT IN ('pending', 'return')
    \`, [sourceId])[0]?.count)
      + numberValue(sqliteRows(db, "SELECT COUNT(*) AS count FROM customer_order_items WHERE order_id = ? AND COALESCE(picked_quantity, 0) > 0 AND COALESCE(item_status, 'pending') <> 'return'", [sourceId])[0]?.count);
    if (sourceStarted > 0) {
      sendJson(res, 409, { ok: false, error: "אי אפשר לאחד את ההזמנה הנוספת אחרי שהתחילו ללקט אותה" });
      return;
    }

    db.run("BEGIN TRANSACTION");
    const targetItems = sqliteRows(db, "SELECT * FROM customer_order_items WHERE order_id = ? ORDER BY id", [targetId]);
    const sourceItems = sqliteRows(db, "SELECT * FROM customer_order_items WHERE order_id = ? ORDER BY id", [sourceId]);
    const deletedSourceItemIds = [];
    sourceItems.forEach((item) => {
      const itemStatus = String(item.item_status || "pending");
      const match = targetItems.find((candidate) =>
        String(candidate.sku || "") === String(item.sku || "")
        && String(candidate.item_status || "pending") === itemStatus
        && numberValue(candidate.is_carton) === numberValue(item.is_carton)
        && numberValue(candidate.units_per_carton || 1) === numberValue(item.units_per_carton || 1)
        && !String(candidate.substitute_product_id || "")
        && !String(item.substitute_product_id || "")
      );
      if (match) {
        const mergedNote = [String(match.note || "").trim(), String(item.note || "").trim(), \`תוספת מהזמנה #\${sourceId}\`].filter(Boolean).join(" | ");
        db.run(\`
          UPDATE customer_order_items
          SET quantity = ?, estimated_price = ?, estimated_profit = ?, note = ?
          WHERE id = ?
        \`, [
          numberValue(match.quantity) + numberValue(item.quantity),
          numberValue(match.estimated_price) + numberValue(item.estimated_price),
          numberValue(match.estimated_profit) + numberValue(item.estimated_profit),
          mergedNote,
          numberValue(match.id),
        ]);
        match.quantity = numberValue(match.quantity) + numberValue(item.quantity);
        match.estimated_price = numberValue(match.estimated_price) + numberValue(item.estimated_price);
        match.estimated_profit = numberValue(match.estimated_profit) + numberValue(item.estimated_profit);
        match.note = mergedNote;
        db.run("DELETE FROM customer_order_items WHERE id = ?", [numberValue(item.id)]);
        deletedSourceItemIds.push(numberValue(item.id));
      } else {
        db.run("UPDATE customer_order_items SET order_id = ? WHERE id = ?", [targetId, numberValue(item.id)]);
        targetItems.push({ ...item, order_id: targetId });
      }
    });

    const totals = sqliteRows(db, \`
      SELECT COALESCE(SUM(estimated_price), 0) AS total, COALESCE(SUM(estimated_profit), 0) AS profit
      FROM customer_order_items WHERE order_id = ?
    \`, [targetId])[0] || {};
    const targetNotes = [String(target.notes || "").trim(), \`אוחדה עם הזמנה #\${sourceId}\`].filter(Boolean).join(" | ");
    const sourceNotes = [String(source.notes || "").trim(), \`אוחדה להזמנה #\${targetId}\`].filter(Boolean).join(" | ");
    db.run("UPDATE customer_orders SET notes = ?, estimated_total = ?, estimated_profit = ?, updated_at = ? WHERE id = ?", [targetNotes, numberValue(totals.total), numberValue(totals.profit), now, targetId]);
    db.run("UPDATE customer_orders SET process_hidden = 1, notes = ?, updated_at = ? WHERE id = ?", [sourceNotes, now, sourceId]);
    db.run("COMMIT");

    const targetOrderRows = sqliteRows(db, "SELECT * FROM customer_orders WHERE id = ?", [targetId]);
    const targetItemRows = sqliteRows(db, "SELECT * FROM customer_order_items WHERE order_id = ? ORDER BY id", [targetId]);
    const exported = Buffer.from(db.export());
    await writeCurrentDatabaseBuffer(exported);

    if (usePostgresPreview) {
      await postgresUpsert("customer_orders", [normalizePostgresOrder(targetOrderRows[0])], "id");
      await postgresUpsert("customer_order_items", targetItemRows.map(normalizePostgresOrderItem), "id");
      await postgresPatchWithColumnFallback("customer_orders", \`id=eq.\${encodeURIComponent(sourceId)}\`, { process_hidden: 1, notes: sourceNotes, updated_at: now }, ["process_hidden", "updated_at"]);
      if (deletedSourceItemIds.length) {
        await postgresRest(\`customer_order_items?id=in.(\${deletedSourceItemIds.join(",")})\`, { method: "DELETE" });
      }
    }

    sendJson(res, 200, { ok: true, targetOrderId: targetId, sourceOrderId: sourceId, mergedItems: sourceItems.length });
  } catch (error) {
    try { db.run("ROLLBACK"); } catch {}
    console.error("merge orders failed", error);
    sendJson(res, 500, { ok: false, error: error.message || "איחוד ההזמנות נכשל" });
  } finally {
    db.close();
  }
}

`;

  s = replaceOnce(
    s,
    'function handleStatic(req, res) {',
    mergeFunction + 'function handleStatic(req, res) {',
    'merge orders handler',
  );

  s = replaceOnce(
    s,
`  if (requestPath === "/api/orders-batch-patch" && req.method === "POST") {
    handleJsonPost(req, res, (payload) => enqueueDbMutation(() => handleOrdersBatchPatch(payload, res)));
    return;
  }`,
`  if (requestPath === "/api/orders-merge" && req.method === "POST") {
    handleJsonPost(req, res, (payload) => enqueueDbMutation(() => handleOrdersMerge(payload, res)));
    return;
  }

  if (requestPath === "/api/orders-batch-patch" && req.method === "POST") {
    handleJsonPost(req, res, (payload) => enqueueDbMutation(() => handleOrdersBatchPatch(payload, res)));
    return;
  }`,
    'merge orders route',
  );

  fs.writeFileSync(file, s);
}

function patchManagement() {
  const file = 'management/app.js';
  let s = fs.readFileSync(file, 'utf8');

  s = replaceOnce(
    s,
`      o.order_date,
      o.customer_name,
      o.status,`,
`      o.order_date,
      o.customer_no,
      o.customer_name,
      o.status,`,
    'picking customer number',
  );

  s = replaceOnce(
    s,
`    ORDER BY o.id DESC
    LIMIT 250`,
`    ORDER BY o.order_date ASC, o.id ASC
    LIMIT 250`,
    'picking oldest first',
  );

  s = replaceOnce(
    s,
`  const selected = orders.find((order) => String(order.order_id) === String(state.selectedPickingOrderId)) || orders[0];
  list.innerHTML = \``,
`  const selected = orders.find((order) => String(order.order_id) === String(state.selectedPickingOrderId)) || orders[0];
  const sameCustomerOrders = orders.filter((order) => String(order.customer_no || "") === String(selected.customer_no || ""));
  const mergeTarget = sameCustomerOrders.length > 1 ? sameCustomerOrders[0] : null;
  const mergeSource = sameCustomerOrders.length > 1 ? sameCustomerOrders[sameCustomerOrders.length - 1] : null;
  list.innerHTML = \``,
    'picking merge candidates',
  );

  s = replaceOnce(
    s,
`          <span>${numberDisplay(selected.picked_quantity)} / ${numberDisplay(selected.total_quantity)} לוקטו</span>
        </div>`,
`          <span>${numberDisplay(selected.picked_quantity)} / ${numberDisplay(selected.total_quantity)} לוקטו</span>
          ${mergeTarget && mergeSource ? \`<button class="secondary-action" type="button" data-merge-order-target="${escapeAttr(mergeTarget.order_id)}" data-merge-order-source="${escapeAttr(mergeSource.order_id)}">אחד 2 הזמנות</button>\` : ""}
        </div>`,
    'picking merge button',
  );

  s = replaceOnce(
    s,
`  document.getElementById("picking-order-select")?.addEventListener("change", (event) => {
    state.selectedPickingOrderId = event.target.value;
    renderPicking();
  });
  bindPickingActions();`,
`  document.getElementById("picking-order-select")?.addEventListener("change", (event) => {
    state.selectedPickingOrderId = event.target.value;
    renderPicking();
  });
  document.querySelector("[data-merge-order-source]")?.addEventListener("click", (event) => mergePickingOrders(
    event.currentTarget.dataset.mergeOrderTarget,
    event.currentTarget.dataset.mergeOrderSource,
  ));
  bindPickingActions();`,
    'picking merge binding',
  );

  const mergeClientFunction = `async function mergePickingOrders(targetOrderId, sourceOrderId) {
  if (!targetOrderId || !sourceOrderId) return;
  if (!confirm(\`לאחד את הזמנה #\${sourceOrderId} לתוך הזמנה #\${targetOrderId}?\`)) return;
  try {
    const response = await fetch("/api/orders-merge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetOrderId: number(targetOrderId), sourceOrderId: number(sourceOrderId) }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.error || "איחוד ההזמנות נכשל");
    state.selectedPickingOrderId = String(data.targetOrderId || targetOrderId);
    if (typeof reloadDatabaseFromServer === "function") {
      await reloadDatabaseFromServer();
    } else {
      window.location.reload();
      return;
    }
    await renderPicking();
    await renderOrderHistory();
    alert(\`הזמנה #\${sourceOrderId} אוחדה בהצלחה להזמנה #\${targetOrderId}\`);
  } catch (error) {
    alert(error.message || "איחוד ההזמנות נכשל");
  }
}

`;

  s = replaceOnce(
    s,
    'function normalizeClosedOrderStatuses() {',
    mergeClientFunction + 'function normalizeClosedOrderStatuses() {',
    'picking merge client function',
  );

  s = replaceOnce(
    s,
`  const whatsappBadge = row.whatsapp_sent_at ? \`<span class="call-message-sent" title="נשלחה הודעת WhatsApp">נשלחה הודעה</span>\` : "";
  return \``,
`  const whatsappBadge = row.whatsapp_sent_at ? \`<span class="call-message-sent" title="נשלחה הודעת WhatsApp">נשלחה הודעה</span>\` : "";
  const appOrderBadge = normalizeCallStatus(row.status) === "ordered" && String(row.notes || "").includes("הזמנה מהאפליקציה")
    ? \`<span class="call-message-sent" title="הלקוח שלח הזמנה דרך אפליקציית הלקוחות">הזמנה מהאפליקציה</span>\`
    : "";
  return \``,
    'customer app order call badge',
  );

  s = replaceOnce(
    s,
`<span>${escapeHtml(row.customer_name)} ${whatsappBadge}</span>`,
`<span>${escapeHtml(row.customer_name)} ${whatsappBadge} ${appOrderBadge}</span>`,
    'customer app order badge display',
  );

  fs.writeFileSync(file, s);
}

patchServer();
patchManagement();
console.log('Sales operations patch applied successfully');
