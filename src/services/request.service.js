// src/services/request.service.js

const { query, withTransaction } = require('../config/db');
const notificationService = require('./notification.service');
const { sendStatusEmail } = require('../config/mailer');
const logger = require('../utils/logger');
const crypto = require('crypto');

// ─── Helper functions for reservations ──────────────────────────────────────
const isReservation = (request) => !!(request.pickup_datetime || request.pickup_start);

const getPickupWindow = (request) => {
  if (request.pickup_start) {
    return {
      start: new Date(request.pickup_start),
      end: new Date(request.pickup_end || request.pickup_start),
    };
  }
  if (request.pickup_datetime) {
    const start = new Date(request.pickup_datetime);
    const end = new Date(start.getTime() + 15 * 60 * 1000);
    return { start, end };
  }
  return null;
};

const isWindowOpen = (request) => {
  const window = getPickupWindow(request);
  if (!window) return false;
  const now = Date.now();
  return now >= (window.start.getTime() - 5 * 60000) && now <= window.end.getTime();
};

// ─────────────────────────────────────────────────────────────────────────────
// 1. createRequest
// ─────────────────────────────────────────────────────────────────────────────
const createRequest = async ({ requester_type, requester_id, requester_email, room_id, purpose, items, scheduled_time, pickup_datetime, pickup_start, pickup_end }) => {
  return withTransaction(async (client) => {
    let expiresAt = null;

    if (requester_type !== 'admin' && !pickup_datetime && !pickup_start && !scheduled_time) {
      expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + 15);
    }

    const groupQr = crypto.randomBytes(16).toString('hex');
    const initialStatus = requester_type === 'admin' ? 'APPROVED' : 'PENDING';

    const { rows } = await client.query(
      `INSERT INTO requests 
        (requester_type, requester_id, room_id, purpose, qr_code, qr_token, 
         scheduled_time, return_deadline, expires_at, status, pickup_datetime, pickup_start, pickup_end)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
      [requester_type, requester_id, room_id || null, purpose || null, groupQr, groupQr, scheduled_time || null, null, expiresAt, initialStatus, pickup_datetime || null, pickup_start || null, pickup_end || null]
    );

    const request = rows[0];
    request.requester_email = requester_email;

    if (Array.isArray(items)) {
      for (const item of items) {
        if (item.stock_id) {
          await client.query(
            `INSERT INTO request_items (request_id, inventory_type_id, stock_id, qty_requested, assigned_to) VALUES ($1, $2, $3, $4, $5)`,
            [request.id, item.inventory_type_id, item.stock_id, item.qty_requested || item.quantity || 1, item.assigned_to || 'Requester']
          );
        } else {
          await client.query(
            `INSERT INTO request_items (request_id, inventory_type_id, consumable_id, quantity, assigned_to) VALUES ($1, $2, $3, $4, $5)`,
            [request.id, item.inventory_type_id, item.consumable_id || null, item.quantity || 1, item.assigned_to || 'Requester']
          );
        }
      }
    }
    return { ...request, qr_code: groupQr };
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// 2. getRequest
// ─────────────────────────────────────────────────────────────────────────────
const getRequest = async (id) => {
  const { rows } = await query(
    `SELECT r.*, rm.code AS room_code,
            COALESCE(u.name, s.full_name) AS requester_name,
            s.student_id AS student_id
     FROM requests r 
     LEFT JOIN rooms rm ON rm.id = r.room_id
     LEFT JOIN users u ON u.id::text = r.requester_id::text AND r.requester_type IN ('faculty', 'admin')
     LEFT JOIN students s ON (s.id::text = r.requester_id::text OR s.student_id::text = r.requester_id::text) AND r.requester_type = 'student'
     WHERE r.id = $1`, [id]
  );
  if (!rows.length) throw Object.assign(new Error('Request not found'), { status: 404 });

  const requestRow = rows[0];

  const { rows: items } = await query(
    `SELECT
       ri.*,
       it.name AS item_name,
       it.type AS item_type,
       it.inventory_mode,
       ii.barcode  AS inventory_item_barcode,
       ic.barcode  AS consumable_barcode,
       its.barcode AS stock_barcode,
       its.qty_total,
       its.qty_available,
       COALESCE(ri.status, ii.status) AS item_status
     FROM request_items ri
     JOIN inventory_types it ON it.id = ri.inventory_type_id
     LEFT JOIN inventory_items ii        ON ii.id  = ri.inventory_item_id
     LEFT JOIN inventory_consumables ic  ON ic.id  = ri.consumable_id
     LEFT JOIN inventory_type_stocks its ON its.id = ri.stock_id
     WHERE ri.request_id = $1`, [id]
  );

  return { ...requestRow, items };
};

// ─────────────────────────────────────────────────────────────────────────────
// 3. getRequestByQR
// ─────────────────────────────────────────────────────────────────────────────
const getRequestByQR = async (qrCode) => {
  const isNumeric = /^\d+$/.test(qrCode);

  const { rows } = await query(
    `SELECT r.*, rm.code AS room_code,
            COALESCE(u.name, s.full_name) AS requester_name,
            s.student_id AS student_id
     FROM requests r 
     LEFT JOIN rooms rm ON rm.id = r.room_id
     LEFT JOIN users u ON u.id::text = r.requester_id::text AND r.requester_type IN ('faculty', 'admin')
     LEFT JOIN students s ON (s.id::text = r.requester_id::text OR s.student_id::text = r.requester_id::text) AND r.requester_type = 'student'
     WHERE r.qr_code = $1 OR (r.id = $2 AND $3 = true)`,
    [qrCode, isNumeric ? parseInt(qrCode, 10) : 0, isNumeric]
  );

  if (!rows.length) throw Object.assign(new Error('Request not found'), { status: 404 });
  const requestRow = rows[0];

  const { rows: items } = await query(
    `SELECT
       ri.*,
       it.name AS item_name,
       it.type AS item_type,
       it.inventory_mode,
       ii.barcode  AS inventory_item_barcode,
       ic.barcode  AS consumable_barcode,
       its.barcode AS stock_barcode,
       its.qty_total,
       its.qty_available,
       COALESCE(ri.status, ii.status) AS item_status
     FROM request_items ri
     JOIN inventory_types it ON it.id = ri.inventory_type_id
     LEFT JOIN inventory_items ii        ON ii.id  = ri.inventory_item_id
     LEFT JOIN inventory_consumables ic  ON ic.id  = ri.consumable_id
     LEFT JOIN inventory_type_stocks its ON its.id = ri.stock_id
     WHERE ri.request_id = $1`, [requestRow.id]
  );

  return { ...requestRow, items };
};

// ─────────────────────────────────────────────────────────────────────────────
// 4. listRequests
// ─────────────────────────────────────────────────────────────────────────────
const listRequests = async ({ room_id, status, requester_type, requester_id } = {}) => {
  const conditions = [], values = [];
  let i = 1;

  if (room_id) {
    conditions.push(`r.room_id = $${i++}`);
    values.push(room_id);
  }

  if (status) {
    if (status.includes(',')) {
      const statuses = status.split(',').map(s => s.trim());
      const placeholders = statuses.map(() => `$${i++}`).join(',');
      conditions.push(`r.status IN (${placeholders})`);
      values.push(...statuses);
    } else {
      conditions.push(`r.status = $${i++}`);
      values.push(status);
    }
  }

  if (requester_type) {
    conditions.push(`r.requester_type = $${i++}`);
    values.push(requester_type);
  }

  if (requester_id) {
    conditions.push(`r.requester_id = $${i}`);
    values.push(requester_id);
    i++;
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await query(
    `SELECT r.*, rm.code AS room_code,
      COALESCE(u.name, s.full_name) AS requester_name,
      s.student_id AS student_id,
      (
        SELECT json_agg(json_build_object(
          'id',                     ri.id,
          'item_name',              it.name,
          'inventory_type_id',      ri.inventory_type_id,
          'inventory_mode',         it.inventory_mode,
          'quantity',               ri.quantity,
          'qty_requested',          ri.qty_requested,
          'qty_returned',           COALESCE(ri.qty_returned, 0),
          'consumable_id',          ri.consumable_id,
          'stock_id',               ri.stock_id,
          'stock_barcode',          its.barcode,
          'inventory_item_id',      ri.inventory_item_id,
          'inventory_item_barcode', ii.barcode,
          'item_status',            COALESCE(ri.status, ii.status),
          'assigned_to',            ri.assigned_to
        ))
        FROM request_items ri
        JOIN inventory_types it ON it.id = ri.inventory_type_id
        LEFT JOIN inventory_items ii        ON ii.id  = ri.inventory_item_id
        LEFT JOIN inventory_type_stocks its ON its.id = ri.stock_id
        WHERE ri.request_id = r.id
      ) as items
     FROM requests r 
     LEFT JOIN rooms rm ON rm.id = r.room_id
     LEFT JOIN users u ON u.id::text = r.requester_id::text AND r.requester_type IN ('faculty', 'admin')
     LEFT JOIN students s ON (s.id::text = r.requester_id::text OR s.student_id::text = r.requester_id::text) AND r.requester_type = 'student'
     ${where} ORDER BY r.created_at DESC`, values
  );

  return rows.map(r => ({ ...r, items: r.items || [] }));
};

// ─────────────────────────────────────────────────────────────────────────────
// 5. approveRequest
// ─────────────────────────────────────────────────────────────────────────────
const approveRequest = async (id, email) => {
  return withTransaction(async (client) => {
    const { rows: reqs } = await client.query(`SELECT * FROM requests WHERE id = $1 FOR UPDATE`, [id]);
    if (!reqs.length) throw Object.assign(new Error('Request not found'), { status: 404 });
    const request = reqs[0];

    if (request.status === 'APPROVED') return request; 
    if (!['PENDING APPROVAL', 'PENDING'].includes(request.status)) {
      throw Object.assign(new Error('Request already processed'), { status: 400 });
    }

    if (!isReservation(request) && request.expires_at && new Date() > new Date(request.expires_at)) {
        await client.query(`UPDATE requests SET status = 'CANCELLED' WHERE id = $1`, [id]);
        throw Object.assign(new Error('QR expired — please resubmit'), { status: 400 });
    }

    const isResv = isReservation(request);

    if (isResv) {
      const { rows: reqItems } = await client.query(`SELECT * FROM request_items WHERE request_id = $1`, [id]);

      for (const item of reqItems) {
        if (item.stock_id) {
          const qty = item.qty_requested || item.quantity || 1;
          const { rows: stock } = await client.query(`SELECT id, qty_available FROM inventory_type_stocks WHERE id = $1 FOR UPDATE`, [item.stock_id]);
          
          if (!stock.length || stock[0].qty_available < qty) {
            throw Object.assign(new Error('Not enough stock to approve this request.'), { status: 409 });
          }
          await client.query(`UPDATE inventory_type_stocks SET qty_available = qty_available - $1 WHERE id = $2`, [qty, item.stock_id]);
          await client.query(`UPDATE request_items SET status = 'RESERVED' WHERE id = $1`, [item.id]);
          
        } else if (item.consumable_id) {
          const { rows: cons } = await client.query(`SELECT quantity_available FROM inventory_consumables WHERE id = $1 FOR UPDATE`, [item.consumable_id]);
          
          if (!cons.length || cons[0].quantity_available < item.quantity) {
            throw Object.assign(new Error('Not enough consumable stock to approve this request.'), { status: 409 });
          }
          await client.query(`UPDATE inventory_consumables SET quantity_available = quantity_available - $1 WHERE id = $2`, [item.quantity, item.consumable_id]);
          await client.query(`UPDATE request_items SET status = 'RESERVED' WHERE id = $1`, [item.id]);

        } else {
          for (let n = 0; n < item.quantity; n++) {
            const { rows: available } = await client.query(
              `SELECT id FROM inventory_items WHERE inventory_type_id = $1 AND status = 'available' FOR UPDATE SKIP LOCKED LIMIT 1`,
              [item.inventory_type_id]
            );
            if (!available.length) {
              throw Object.assign(new Error('Not enough available stock to approve this request.'), { status: 409 });
            }
            const physicalItemId = available[0].id;
            await client.query(`UPDATE inventory_items SET status = 'reserved' WHERE id = $1`, [physicalItemId]);
            if (n === 0) {
              await client.query(`UPDATE request_items SET inventory_item_id = $1, status = 'RESERVED', quantity = 1 WHERE id = $2`, [physicalItemId, item.id]);
            } else {
              await client.query(`INSERT INTO request_items (request_id, inventory_type_id, inventory_item_id, quantity, status, assigned_to) VALUES ($1, $2, $3, 1, 'RESERVED', $4)`, [id, item.inventory_type_id, physicalItemId, item.assigned_to]);
            }
          }
        }
      }
    }

    const { rows } = await client.query(`UPDATE requests SET status = 'APPROVED', approved_time = clock_timestamp() WHERE id = $1 RETURNING *`, [id]);
    if (email) await sendStatusEmail(email, rows[0], 'APPROVED');
    await notificationService.notifyApproved(rows[0]);
    return rows[0];
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// 6. rejectRequest (🚨 FIXED: Now cleans up inventory if request was APPROVED)
// ─────────────────────────────────────────────────────────────────────────────
const rejectRequest = async (id, email) => {
  return withTransaction(async (client) => {
    const { rows: reqs } = await client.query(
      `SELECT status FROM requests WHERE id = $1 AND status IN ('PENDING APPROVAL', 'PENDING', 'APPROVED') FOR UPDATE`, [id]
    );
    if (!reqs.length) throw Object.assign(new Error('Request not found or already processed'), { status: 400 });
    
    // If rejecting a request that was already approved (reserved), we must free the inventory!
    if (reqs[0].status === 'APPROVED') {
       const { rows: units } = await client.query(`SELECT inventory_item_id FROM request_items WHERE request_id = $1 AND inventory_item_id IS NOT NULL AND status = 'RESERVED'`, [id]);
       for (const u of units) { await client.query(`UPDATE inventory_items SET status = 'available' WHERE id = $1`, [u.inventory_item_id]); }
       
       const { rows: stocks } = await client.query(`SELECT stock_id, qty_requested FROM request_items WHERE request_id = $1 AND stock_id IS NOT NULL AND status = 'RESERVED'`, [id]);
       for (const s of stocks) { await client.query(`UPDATE inventory_type_stocks SET qty_available = qty_available + $1 WHERE id = $2`, [s.qty_requested || 1, s.stock_id]); }
       
       const { rows: cons } = await client.query(`SELECT consumable_id, quantity FROM request_items WHERE request_id = $1 AND consumable_id IS NOT NULL AND status = 'RESERVED'`, [id]);
       for (const c of cons) { await client.query(`UPDATE inventory_consumables SET quantity_available = quantity_available + $1 WHERE id = $2`, [c.quantity, c.consumable_id]); }
       
       await client.query(`UPDATE request_items SET status = 'CANCELLED' WHERE request_id = $1`, [id]);
    }
    
    const { rows } = await client.query(`UPDATE requests SET status = 'REJECTED' WHERE id = $1 RETURNING *`, [id]);
    if (email) await sendStatusEmail(email, rows[0], 'REJECTED');
    return rows[0];
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// 7. issueRequest (🚨 FIXED: Completely Bulletproof Atomic Reconstruction)
// ─────────────────────────────────────────────────────────────────────────────
const issueRequest = async (id, itemsToIssue = [], returnDeadline = null) => {
  return withTransaction(async (client) => {
    const { rows: reqRows } = await client.query(`SELECT * FROM requests WHERE id = $1 AND status IN ('APPROVED', 'PENDING', 'PENDING APPROVAL') FOR UPDATE`, [id]);
    if (!reqRows.length) throw Object.assign(new Error('Request not found or cannot be issued'), { status: 400 });
    const request = reqRows[0];

    if (isReservation(request)) {
      if (!isWindowOpen(request)) throw Object.assign(new Error(`Reservation window is not open.`), { status: 403 });
    }

    // ⚡ BULLETPROOF CLEANUP FIRST ⚡
    // We safely revert ALL prior reservations for this request back to the shelf inside this transaction. 
    // Then, we check out exactly what the Admin scanned in the UI. This prevents ANY orphaned items.
    
    // 1. Free Reserved Units
    const { rows: resUnits } = await client.query(`SELECT inventory_item_id FROM request_items WHERE request_id = $1 AND status = 'RESERVED' AND inventory_item_id IS NOT NULL`, [id]);
    for (const u of resUnits) {
      await client.query(`UPDATE inventory_items SET status = 'available' WHERE id = $1`, [u.inventory_item_id]);
    }
    // 2. Free Reserved Stocks
    const { rows: resStocks } = await client.query(`SELECT stock_id, qty_requested FROM request_items WHERE request_id = $1 AND status = 'RESERVED' AND stock_id IS NOT NULL`, [id]);
    for (const s of resStocks) {
      await client.query(`UPDATE inventory_type_stocks SET qty_available = qty_available + $1 WHERE id = $2`, [s.qty_requested || 1, s.stock_id]);
    }
    // 3. Free Reserved Consumables
    const { rows: resCons } = await client.query(`SELECT consumable_id, quantity FROM request_items WHERE request_id = $1 AND status = 'RESERVED' AND consumable_id IS NOT NULL`, [id]);
    for (const c of resCons) {
      await client.query(`UPDATE inventory_consumables SET quantity_available = quantity_available + $1 WHERE id = $2`, [c.quantity, c.consumable_id]);
    }
    // 4. Cancel all old placeholder request items
    await client.query(`UPDATE request_items SET status = 'CANCELLED' WHERE request_id = $1 AND status IN ('RESERVED', 'PENDING')`, [id]);


    // ⚡ NOW ISSUE EXACTLY WHAT WAS SCANNED ⚡
    for (const item of itemsToIssue) {
      if (item.quantity <= 0) continue;
      const assignedTo = item.assigned_to || 'Requester';

      // ── QUANTITY MODE ──
      if (item.stock_id) {
        const qtyToIssue = item.qty_requested || item.quantity || 1;
        const { rows: stock } = await client.query(`SELECT qty_available FROM inventory_type_stocks WHERE id = $1 FOR UPDATE`, [item.stock_id]);
        if (!stock.length || stock[0].qty_available < qtyToIssue) throw Object.assign(new Error(`Insufficient quantity in stock.`), { status: 409 });
        
        await client.query(`UPDATE inventory_type_stocks SET qty_available = qty_available - $1 WHERE id = $2`, [qtyToIssue, item.stock_id]);
        await client.query(`INSERT INTO request_items (request_id, inventory_type_id, stock_id, qty_requested, status, assigned_to) VALUES ($1, $2, $3, $4, 'ISSUED', $5)`, [id, item.inventory_type_id, item.stock_id, qtyToIssue, assignedTo]);
        continue;
      }

      // ── CONSUMABLE MODE ──
      if (item.consumable_id) {
        const { rows: cons } = await client.query(`SELECT quantity_available FROM inventory_consumables WHERE id = $1 FOR UPDATE`, [item.consumable_id]);
        if (!cons.length || cons[0].quantity_available < item.quantity) throw Object.assign(new Error(`Insufficient consumable quantity`), { status: 409 });
        
        await client.query(`UPDATE inventory_consumables SET quantity_available = quantity_available - $1 WHERE id = $2`, [item.quantity, item.consumable_id]);
        await client.query(`INSERT INTO request_items (request_id, inventory_type_id, consumable_id, quantity, status, assigned_to) VALUES ($1, $2, $3, $4, 'ISSUED', $5)`, [id, item.inventory_type_id, item.consumable_id, item.quantity, assignedTo]);
        continue;
      }

      // ── UNIT MODE ──
      for (let n = 0; n < item.quantity; n++) {
        let physicalItemId;
        if (item.inventory_item_id) {
          // They scanned a specific barcode
          const { rows: specificItem } = await client.query(`SELECT id FROM inventory_items WHERE id = $1 AND status = 'available' FOR UPDATE`, [item.inventory_item_id]);
          if (!specificItem.length) throw Object.assign(new Error(`Scanned item is currently unavailable.`), { status: 409 });
          physicalItemId = specificItem[0].id;
        } else {
          // They didn't scan a barcode, auto-grab an available one
          const avail = await client.query(`SELECT id FROM inventory_items WHERE inventory_type_id = $1 AND status = 'available' FOR UPDATE SKIP LOCKED LIMIT 1`, [item.inventory_type_id]);
          if (!avail.rows.length) throw Object.assign(new Error(`Insufficient quantity in stock.`), { status: 409 });
          physicalItemId = avail.rows[0].id;
        }

        await client.query(`UPDATE inventory_items SET status = 'borrowed' WHERE id = $1`, [physicalItemId]);
        await client.query(`INSERT INTO request_items (request_id, inventory_type_id, inventory_item_id, quantity, status, assigned_to) VALUES ($1, $2, $3, 1, 'ISSUED', $4)`, [id, item.inventory_type_id, physicalItemId, assignedTo]);
      }
    }

    const deadlineSql = returnDeadline ? `, return_deadline = $2` : ``;
    const params = returnDeadline ? [id, returnDeadline] : [id];
    const { rows: issued } = await client.query(`
      UPDATE requests
       SET status = 'ISSUED', issued_time = clock_timestamp(), approved_time = COALESCE(approved_time, clock_timestamp())${deadlineSql}
       WHERE id = $1 RETURNING *`, params);

    return issued[0];
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// 8. returnItemByBarcode
// ─────────────────────────────────────────────────────────────────────────────
const returnItemByBarcode = async (barcode, condition = 'Good', callerRoomId = null, qtyReturned = null, explicitRequestId = null) => {
  return withTransaction(async (client) => {
    const { rows: stockRows } = await client.query(
      `SELECT its.id, its.type_id, its.room_id, its.qty_total, its.qty_available
       FROM inventory_type_stocks its WHERE its.barcode = $1`, [barcode]
    );

    if (stockRows.length) {
      const stock = stockRows[0];
      if (callerRoomId !== null && String(stock.room_id) !== String(callerRoomId)) {
        throw Object.assign(new Error('Forbidden: This item belongs to a different room'), { status: 403 });
      }

      let reqFilter = explicitRequestId ? `AND r.id = ${parseInt(explicitRequestId, 10)}` : ``;

      const { rows: reqItems } = await client.query(
        `SELECT ri.id, ri.request_id, ri.qty_requested, COALESCE(ri.qty_returned, 0) as qty_returned
         FROM request_items ri
         JOIN requests r ON r.id = ri.request_id
         WHERE ri.stock_id = $1
           AND ri.status IN ('ISSUED', 'PENDING')
           AND r.status IN ('ISSUED', 'PARTIALLY RETURNED', 'PENDING')
           ${reqFilter}
         ORDER BY r.created_at ASC
         FOR UPDATE`,
        [stock.id]
      );
      if (!reqItems.length) throw Object.assign(new Error('This item is not currently issued to anyone.'), { status: 400 });

      const reqItem = reqItems[0];
      const requestId = reqItem.request_id;
      
      const outstanding = reqItem.qty_requested - reqItem.qty_returned;
      const returnQty = Math.min(qtyReturned || outstanding || 1, outstanding);

      if (callerRoomId !== null) {
        const { rows: reqRows } = await client.query(`SELECT room_id FROM requests WHERE id = $1`, [requestId]);
        if (String(reqRows[0].room_id) !== String(callerRoomId)) {
          throw Object.assign(new Error('Forbidden: You may only return items that belong to your room'), { status: 403 });
        }
      }

      await client.query(`UPDATE inventory_type_stocks SET qty_available = LEAST(qty_total, qty_available + $1) WHERE id = $2`, [returnQty, stock.id]);

      await client.query(
        `UPDATE request_items
         SET qty_returned  = COALESCE(qty_returned, 0) + $1,
             returned_time = NOW(),
             status = CASE WHEN COALESCE(qty_returned, 0) + $1 >= qty_requested THEN 'RETURNED' ELSE status END
         WHERE id = $2`,
        [returnQty, reqItem.id]
      );

      const { rows: pendingItems } = await client.query(
        `SELECT id FROM request_items
         WHERE request_id = $1 AND status IN ('ISSUED', 'PENDING') AND (stock_id IS NULL OR COALESCE(qty_returned, 0) < qty_requested)`,
        [requestId]
      );

      let finalStatus = 'PARTIALLY RETURNED';
      if (pendingItems.length === 0) {
        finalStatus = 'RETURNED';
        await client.query(`UPDATE requests SET status = 'RETURNED', full_return_time = NOW(), last_return_time = NOW() WHERE id = $1`, [requestId]);
      } else {
        await client.query(`UPDATE requests SET status = 'PARTIALLY RETURNED', last_return_time = NOW() WHERE id = $1`, [requestId]);
      }

      return { message: `Returned ${returnQty}× item successfully!`, requestStatus: finalStatus, requestId, itemsRemaining: pendingItems.length, mode: 'quantity' };
    }

    const { rows: invItems } = await client.query(`SELECT id FROM inventory_items WHERE barcode = $1`, [barcode]);
    if (!invItems.length) throw Object.assign(new Error('Invalid Barcode: Item not found in database'), { status: 404 });
    const physicalItemId = invItems[0].id;

    let unitReqFilter = explicitRequestId ? `AND r.id = ${parseInt(explicitRequestId, 10)}` : ``;
    const { rows: reqItems } = await client.query(
      `SELECT ri.id, ri.request_id FROM request_items ri
       JOIN requests r ON r.id = ri.request_id
       WHERE ri.inventory_item_id = $1
         AND ri.status IN ('ISSUED', 'PENDING')
         AND r.status IN ('ISSUED', 'PARTIALLY RETURNED', 'PENDING')
         ${unitReqFilter}
       FOR UPDATE`,
      [physicalItemId]
    );
    if (!reqItems.length) throw Object.assign(new Error('This item is not currently issued to anyone.'), { status: 400 });

    const reqItem = reqItems[0];
    const requestId = reqItem.request_id;

    if (callerRoomId !== null && callerRoomId !== undefined) {
      const { rows: reqRows } = await client.query(`SELECT room_id FROM requests WHERE id = $1`, [requestId]);
      if (String(reqRows[0].room_id) !== String(callerRoomId)) {
        throw Object.assign(new Error('Forbidden: You may only return items that belong to your room'), { status: 403 });
      }
    }

    await client.query(`UPDATE request_items SET status = 'RETURNED', returned_time = NOW(), return_condition = $1 WHERE id = $2`, [condition, reqItem.id]);
    await client.query(`UPDATE inventory_items SET status = 'available', metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{condition}', $1::jsonb) WHERE id = $2`, [`"${condition}"`, physicalItemId]);

    const { rows: pendingItems } = await client.query(`SELECT id FROM request_items WHERE request_id = $1 AND inventory_item_id IS NOT NULL AND status IN ('ISSUED', 'PENDING')`, [requestId]);
    const { rows: pendingQty } = await client.query(`SELECT id FROM request_items WHERE request_id = $1 AND stock_id IS NOT NULL AND status IN ('ISSUED', 'PENDING')`, [requestId]);

    let finalStatus = 'PARTIALLY RETURNED';
    if (pendingItems.length === 0 && pendingQty.length === 0) {
      finalStatus = 'RETURNED';
      await client.query(`UPDATE requests SET status = 'RETURNED', full_return_time = NOW(), last_return_time = NOW() WHERE id = $1`, [requestId]);
    } else {
      await client.query(`UPDATE requests SET status = 'PARTIALLY RETURNED', last_return_time = NOW() WHERE id = $1`, [requestId]);
    }

    return { message: 'Item scanned and returned successfully!', requestStatus: finalStatus, requestId, itemsRemaining: pendingItems.length + pendingQty.length, mode: 'unit' };
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// 9. returnRequest (bulk)
// ─────────────────────────────────────────────────────────────────────────────
const returnRequest = async (id) => {
  return withTransaction(async (client) => {
    const { rows: reqRows } = await client.query(
      `SELECT * FROM requests WHERE id = $1 AND status IN ('ISSUED', 'PARTIALLY RETURNED') FOR UPDATE`, [id]
    );
    if (!reqRows.length) throw Object.assign(new Error('Request not found or not issued'), { status: 400 });

    const { rows: unitItems } = await client.query(
      `SELECT ri.inventory_item_id FROM request_items ri
       WHERE ri.request_id = $1 AND ri.inventory_item_id IS NOT NULL AND ri.status IN ('ISSUED', 'PENDING')`, [id]
    );
    for (const item of unitItems) {
      await client.query(`UPDATE inventory_items SET status = 'available' WHERE id = $1`, [item.inventory_item_id]);
    }

    const { rows: qtyItems } = await client.query(
      `SELECT ri.stock_id, ri.qty_requested FROM request_items ri
       WHERE ri.request_id = $1 AND ri.stock_id IS NOT NULL AND ri.status IN ('ISSUED', 'PENDING')`, [id]
    );
    for (const item of qtyItems) {
      await client.query(
        `UPDATE inventory_type_stocks SET qty_available = LEAST(qty_total, qty_available + $1) WHERE id = $2`,
        [item.qty_requested || 1, item.stock_id]
      );
    }

    await client.query(
      `UPDATE request_items SET status = 'RETURNED', returned_time = NOW()
       WHERE request_id = $1 AND status IN ('ISSUED', 'PENDING')`, [id]
    );
    
    const { rows } = await client.query(
      `UPDATE requests SET status = 'RETURNED', full_return_time = NOW(), last_return_time = NOW() WHERE id = $1 RETURNING *`, [id]
    );
    return rows[0];
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
  createRequest,
  getRequest,
  getRequestByQR,
  listRequests,
  approveRequest,
  rejectRequest,
  issueRequest,
  returnItemByBarcode,
  returnRequest,
};
