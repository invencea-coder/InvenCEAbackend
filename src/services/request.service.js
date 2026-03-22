// src/services/request.service.js
const { query, withTransaction } = require('../config/db');
const notificationService = require('./notification.service');
const { sendStatusEmail } = require('../config/mailer');
const logger = require('../utils/logger');
const crypto = require('crypto');

// ─── Helper: is a request item a quantity-mode stock entry? ───────────────────
// An item is qty-mode when it has stock_id set (and no inventory_item_id).
const isQtyMode = (item) => !!item.stock_id;

/**
 * Utility: check if a given createdAt has expired (end of same day)
 */
const checkExpiration = (createdAt) => {
  const endOfDay = new Date(createdAt);
  endOfDay.setHours(23, 59, 59, 999);
  return new Date() > endOfDay;
};

// ─────────────────────────────────────────────────────────────────────────────
// 1. createRequest
// ─────────────────────────────────────────────────────────────────────────────
const createRequest = async ({ requester_type, requester_id, requester_email, room_id, purpose, items, companions, scheduled_time }) => {
  return withTransaction(async (client) => {
    let returnDeadline = null;
    let expiresAt = null;

    if (requester_type === 'faculty') {
      let latestTime = 0;
      if (scheduled_time) latestTime = new Date(scheduled_time).getTime();
      if (companions && companions.length > 0) {
        companions.forEach(comp => {
          if (comp.end_time) {
            const compTime = new Date(comp.end_time).getTime();
            if (compTime > latestTime) latestTime = compTime;
          }
        });
      }
      if (latestTime > 0) returnDeadline = new Date(latestTime);
    } else {
      expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + 15);
    }

    const groupQr = crypto.randomBytes(16).toString('hex');
    const initialStatus = requester_type === 'faculty' ? 'PENDING APPROVAL' : 'PENDING';

    const { rows } = await client.query(
      `INSERT INTO requests (requester_type, requester_id, room_id, purpose, qr_code, qr_token, scheduled_time, return_deadline, expires_at, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [requester_type, requester_id, room_id || null, purpose || null, groupQr, groupQr, scheduled_time || null, returnDeadline, expiresAt, initialStatus]
    );

    const request = rows[0];
    request.requester_email = requester_email;

    if (Array.isArray(items)) {
      for (const item of items) {
        // ── Quantity-mode item: has stock_id ──────────────────────────────
        if (item.stock_id) {
          await client.query(
            `INSERT INTO request_items (request_id, inventory_type_id, stock_id, qty_requested, assigned_to)
             VALUES ($1, $2, $3, $4, $5)`,
            [
              request.id,
              item.inventory_type_id,
              item.stock_id,
              item.qty_requested || item.quantity || 1,
              item.assigned_to || item.assignTo || 'Shared Group',
            ]
          );
        } else {
          // ── Unit-mode or consumable ───────────────────────────────────────
          await client.query(
            `INSERT INTO request_items (request_id, inventory_type_id, consumable_id, quantity, assigned_to)
             VALUES ($1, $2, $3, $4, $5)`,
            [
              request.id,
              item.inventory_type_id,
              item.consumable_id || null,
              item.quantity || 1,
              item.assigned_to || item.assignTo || 'Shared Group',
            ]
          );
        }
      }
    }

    if (companions && Array.isArray(companions) && companions.length > 0) {
      for (const comp of companions) {
        if (!comp.student_id || !comp.name) {
          throw Object.assign(new Error('Each companion must have a name and student ID'), { status: 400 });
        }
        await client.query(
          `INSERT INTO request_group_members (request_id, full_name, student_id_text, status, start_time, end_time)
           VALUES ($1, $2, $3, 'PENDING', $4, $5)`,
          [request.id, comp.name, comp.student_id, comp.start_time || null, comp.end_time || null]
        );
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
    `SELECT r.*, rm.code AS room_code
     FROM requests r LEFT JOIN rooms rm ON rm.id = r.room_id
     WHERE r.id = $1`, [id]
  );
  if (!rows.length) throw Object.assign(new Error('Request not found'), { status: 404 });

  const requestRow = rows[0];

  // Fetch items — join both inventory_items (unit) and inventory_type_stocks (qty)
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

  const { rows: members } = await query(
    `SELECT rgm.*, COALESCE(s.full_name, rgm.full_name) AS full_name,
            COALESCE(s.student_id, rgm.student_id_text) AS student_id, rgm.qr_code
     FROM request_group_members rgm
     LEFT JOIN students s ON s.id = rgm.student_id
     WHERE rgm.request_id = $1`, [id]
  );

  return { ...requestRow, items, members };
};

// ─────────────────────────────────────────────────────────────────────────────
// 3. getRequestByQR
// ─────────────────────────────────────────────────────────────────────────────
const getRequestByQR = async (qrCode) => {
  const isNumeric = /^\d+$/.test(qrCode);

  const { rows } = await query(
    `SELECT r.*, rm.code AS room_code
     FROM requests r LEFT JOIN rooms rm ON rm.id = r.room_id
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

  const { rows: members } = await query(
    `SELECT rgm.*, COALESCE(s.full_name, rgm.full_name) AS full_name,
            COALESCE(s.student_id, rgm.student_id_text) AS student_id,
            rgm.qr_code, rgm.status
     FROM request_group_members rgm
     LEFT JOIN students s ON s.id = rgm.student_id
     WHERE rgm.request_id = $1`, [requestRow.id]
  );

  return { ...requestRow, items, members };
};

// ─────────────────────────────────────────────────────────────────────────────
// 4. listRequests
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// 4. listRequests
// ─────────────────────────────────────────────────────────────────────────────
const listRequests = async ({ room_id, status, requester_type, requester_id } = {}) => {
  const conditions = [], values = [];
  let i = 1;

  // If a room_id is provided (by Faculty/Admin), scope it to that room
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

  // Securely filter by the requester ID (forced by the controller if it's a student)
  if (requester_id) {
    // This allows the user to see requests they made OR requests where they are a companion
    conditions.push(`(r.requester_id = $${i} OR r.id IN (SELECT request_id FROM request_group_members WHERE student_id = $${i}))`);
    values.push(requester_id); 
    i++;
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await query(
    `SELECT r.*, rm.code AS room_code,
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
      ) as items,
      (
        SELECT json_agg(json_build_object(
          'full_name', COALESCE(s.full_name, rgm.full_name),
          'student_id', COALESCE(s.student_id, rgm.student_id_text)
        ))
        FROM request_group_members rgm
        LEFT JOIN students s ON s.id = rgm.student_id
        WHERE rgm.request_id = r.id
      ) as members
     FROM requests r LEFT JOIN rooms rm ON rm.id = r.room_id
     ${where} ORDER BY r.created_at DESC`, values
  );

  return rows.map(r => ({ ...r, items: r.items || [], members: r.members || [] }));
};

// ─────────────────────────────────────────────────────────────────────────────
// 5. approveRequest
// ─────────────────────────────────────────────────────────────────────────────
const approveRequest = async (id, email) => {
  return withTransaction(async (client) => {
    const { rows: reqs } = await client.query(
      `SELECT * FROM requests WHERE id = $1 AND status IN ('PENDING APPROVAL', 'PENDING') FOR UPDATE`, [id]
    );
    if (!reqs.length) throw Object.assign(new Error('Request not found or already processed'), { status: 400 });

    const request = reqs[0];

    if (request.requester_type === 'faculty') {
      const { rows: reqItems } = await client.query(`SELECT * FROM request_items WHERE request_id = $1`, [id]);

      for (const item of reqItems) {

        // ── Quantity-mode: reserve from inventory_type_stocks ─────────────
        if (item.stock_id) {
          const qty = item.qty_requested || item.quantity || 1;
          const { rows: stock } = await client.query(
            `SELECT id, qty_available FROM inventory_type_stocks WHERE id = $1 FOR UPDATE`, [item.stock_id]
          );
          if (!stock.length || stock[0].qty_available < qty) {
            throw Object.assign(new Error('Not enough stock to approve this faculty request.'), { status: 409 });
          }
          await client.query(
            `UPDATE inventory_type_stocks SET qty_available = qty_available - $1 WHERE id = $2`, [qty, item.stock_id]
          );
          await client.query(`UPDATE request_items SET status = 'RESERVED' WHERE id = $1`, [item.id]);
          continue;
        }

        // ── Unit-mode borrowable ──────────────────────────────────────────
        if (!item.consumable_id) {
          for (let n = 0; n < item.quantity; n++) {
            const { rows: available } = await client.query(
              `SELECT id FROM inventory_items WHERE inventory_type_id = $1 AND status = 'available' FOR UPDATE SKIP LOCKED LIMIT 1`,
              [item.inventory_type_id]
            );
            if (!available.length) throw Object.assign(new Error('Not enough available stock to approve this faculty request.'), { status: 409 });
            const physicalItemId = available[0].id;
            await client.query(`UPDATE inventory_items SET status = 'reserved' WHERE id = $1`, [physicalItemId]);
            if (n === 0) {
              await client.query(
                `UPDATE request_items SET inventory_item_id = $1, status = 'RESERVED', quantity = 1 WHERE id = $2`,
                [physicalItemId, item.id]
              );
            } else {
              await client.query(
                `INSERT INTO request_items (request_id, inventory_type_id, inventory_item_id, quantity, status, assigned_to) VALUES ($1, $2, $3, 1, 'RESERVED', $4)`,
                [id, item.inventory_type_id, physicalItemId, item.assigned_to]
              );
            }
          }
        } else {
          // ── Consumable ────────────────────────────────────────────────────
          const { rows: cons } = await client.query(
            `SELECT quantity_available FROM inventory_consumables WHERE id = $1 FOR UPDATE`, [item.consumable_id]
          );
          if (!cons.length || cons[0].quantity_available < item.quantity) {
            throw Object.assign(new Error('Not enough consumable stock to approve this faculty request.'), { status: 409 });
          }
          await client.query(
            `UPDATE inventory_consumables SET quantity_available = quantity_available - $1 WHERE id = $2`,
            [item.quantity, item.consumable_id]
          );
          await client.query(`UPDATE request_items SET status = 'RESERVED' WHERE id = $1`, [item.id]);
        }
      }
    }

    const { rows } = await client.query(
      `UPDATE requests SET status = 'APPROVED', approved_time = clock_timestamp() WHERE id = $1 RETURNING *`, [id]
    );
    if (email) await sendStatusEmail(email, rows[0], 'APPROVED');
    await notificationService.notifyApproved(rows[0]);
    return rows[0];
  });
};

const rejectRequest = async (id, email) => {
  const { rows } = await query(
    `UPDATE requests SET status = 'REJECTED' WHERE id = $1 AND status IN ('PENDING APPROVAL', 'PENDING') RETURNING *`, [id]
  );
  if (!rows.length) throw Object.assign(new Error('Request not found or already processed'), { status: 400 });
  if (email) await sendStatusEmail(email, rows[0], 'REJECTED');
  return rows[0];
};

// ─────────────────────────────────────────────────────────────────────────────
// 6. issueRequest
// ─────────────────────────────────────────────────────────────────────────────
const issueRequest = async (id, itemsToIssue = []) => {
  return withTransaction(async (client) => {
    const { rows: reqRows } = await client.query(
      `SELECT * FROM requests WHERE id = $1 AND status IN ('APPROVED', 'PENDING', 'PENDING APPROVAL') FOR UPDATE`, [id]
    );
    if (!reqRows.length) throw Object.assign(new Error('Request not found or cannot be issued'), { status: 400 });
    const request = reqRows[0];

    for (const item of itemsToIssue) {
      if (item.quantity <= 0) {
        if (item.id) await client.query(`UPDATE request_items SET status = 'CANCELLED', quantity = 0 WHERE id = $1`, [item.id]);
        continue;
      }

      const assignedTo = item.assigned_to || 'Shared Group';

      // ── Quantity-mode stock item ──────────────────────────────────────────
      if (item.stock_id) {
        const qty = item.qty_requested || item.quantity || 1;

        // For students: deduct now. Faculty was already deducted at approval.
        if (request.requester_type !== 'faculty') {
          const { rows: stock } = await client.query(
            `SELECT qty_available FROM inventory_type_stocks WHERE id = $1 FOR UPDATE`, [item.stock_id]
          );
          if (!stock.length || stock[0].qty_available < qty) {
            throw Object.assign(new Error(`Insufficient quantity in stock for this item.`), { status: 409 });
          }
          await client.query(
            `UPDATE inventory_type_stocks SET qty_available = qty_available - $1 WHERE id = $2`, [qty, item.stock_id]
          );
        }

        if (item.id) {
          await client.query(
            `UPDATE request_items SET status = 'ISSUED', qty_requested = $1, assigned_to = $2 WHERE id = $3`,
            [qty, assignedTo, item.id]
          );
        } else {
          await client.query(
            `INSERT INTO request_items (request_id, inventory_type_id, stock_id, qty_requested, status, assigned_to)
             VALUES ($1, $2, $3, $4, 'ISSUED', $5)`,
            [id, item.inventory_type_id, item.stock_id, qty, assignedTo]
          );
        }
        continue;
      }

      // ── Consumable ────────────────────────────────────────────────────────
      if (item.consumable_id) {
        if (request.requester_type !== 'faculty') {
          const { rows: cons } = await client.query(
            `SELECT * FROM inventory_consumables WHERE id = $1 FOR UPDATE`, [item.consumable_id]
          );
          if (!cons.length || cons[0].quantity_available < item.quantity) {
            throw Object.assign(new Error(`Insufficient consumable quantity`), { status: 409 });
          }
          await client.query(
            `UPDATE inventory_consumables SET quantity_available = quantity_available - $1 WHERE id = $2`,
            [item.quantity, item.consumable_id]
          );
        }
        if (item.id) {
          await client.query(
            `UPDATE request_items SET status = 'ISSUED', quantity = $1, assigned_to = $2 WHERE id = $3`,
            [item.quantity, assignedTo, item.id]
          );
        } else {
          await client.query(
            `INSERT INTO request_items (request_id, inventory_type_id, consumable_id, quantity, status, assigned_to) VALUES ($1, $2, $3, $4, 'ISSUED', $5)`,
            [id, item.inventory_type_id, item.consumable_id, item.quantity, assignedTo]
          );
        }
        continue;
      }

      // ── Unit-mode borrowable (scan-verified) ──────────────────────────────
      let requestItemId = item.id;
      for (let n = 0; n < item.quantity; n++) {
        let physicalItemId;

        if (item.inventory_item_id) {
          const { rows: specificItem } = await client.query(
            `SELECT id FROM inventory_items WHERE id = $1 AND status IN ('available', 'reserved') FOR UPDATE`,
            [item.inventory_item_id]
          );
          if (!specificItem.length) throw Object.assign(new Error(`Scanned item is currently unavailable.`), { status: 409 });
          physicalItemId = specificItem[0].id;
        } else {
          let { rows: physItems } = await client.query(
            `SELECT inventory_item_id as id FROM request_items WHERE request_id = $1 AND inventory_type_id = $2 AND status = 'RESERVED' LIMIT 1`,
            [id, item.inventory_type_id]
          );
          if (!physItems.length) {
            const avail = await client.query(
              `SELECT id FROM inventory_items WHERE inventory_type_id = $1 AND status = 'available' FOR UPDATE SKIP LOCKED LIMIT 1`,
              [item.inventory_type_id]
            );
            physItems = avail.rows;
          }
          if (!physItems.length) throw Object.assign(new Error(`Item out of stock.`), { status: 409 });
          physicalItemId = physItems[0].id;
        }

        await client.query(`UPDATE inventory_items SET status = 'borrowed' WHERE id = $1`, [physicalItemId]);

        if (n === 0 && requestItemId) {
          await client.query(
            `UPDATE request_items SET inventory_item_id = $1, status = 'ISSUED', quantity = 1, assigned_to = $3 WHERE id = $2`,
            [physicalItemId, requestItemId, assignedTo]
          );
        } else {
          await client.query(
            `INSERT INTO request_items (request_id, inventory_type_id, inventory_item_id, quantity, status, assigned_to) VALUES ($1, $2, $3, 1, 'ISSUED', $4)`,
            [id, item.inventory_type_id, physicalItemId, assignedTo]
          );
        }
      }
    }

    // Release any leftover RESERVED unit items (not in qty-mode)
    const { rows: leftover } = await client.query(
      `SELECT inventory_item_id FROM request_items WHERE request_id = $1 AND status = 'RESERVED' AND inventory_item_id IS NOT NULL`, [id]
    );
    for (const left of leftover) {
      await client.query(`UPDATE inventory_items SET status = 'available' WHERE id = $1`, [left.inventory_item_id]);
    }
    // Also release any RESERVED qty-mode stock (if admin cancelled some items)
    const { rows: reservedStock } = await client.query(
      `SELECT stock_id, qty_requested FROM request_items WHERE request_id = $1 AND status = 'RESERVED' AND stock_id IS NOT NULL`, [id]
    );
    for (const rs of reservedStock) {
      await client.query(
        `UPDATE inventory_type_stocks SET qty_available = qty_available + $1 WHERE id = $2`,
        [rs.qty_requested || 1, rs.stock_id]
      );
    }
    await client.query(`UPDATE request_items SET status = 'CANCELLED' WHERE request_id = $1 AND status = 'RESERVED'`, [id]);

    const { rows: issued } = await client.query(
      `UPDATE requests
       SET status = 'ISSUED',
           issued_time = clock_timestamp(),
           approved_time = COALESCE(approved_time, clock_timestamp())
       WHERE id = $1 RETURNING *`, [id]
    );
    return issued[0];
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// 7. returnItemByBarcode
//    Now handles BOTH unit-mode (inventory_items) and qty-mode (inventory_type_stocks)
// ─────────────────────────────────────────────────────────────────────────────
const returnItemByBarcode = async (barcode, condition = 'Good', callerRoomId = null, qtyReturned = null) => {
  return withTransaction(async (client) => {

    // ── Try quantity-mode first (inventory_type_stocks) ───────────────────
    const { rows: stockRows } = await client.query(
      `SELECT its.id, its.type_id, its.room_id, its.qty_total, its.qty_available
       FROM inventory_type_stocks its WHERE its.barcode = $1`, [barcode]
    );

    if (stockRows.length) {
      const stock = stockRows[0];

      // Room check
      if (callerRoomId !== null && String(stock.room_id) !== String(callerRoomId)) {
        throw Object.assign(new Error('Forbidden: This item belongs to a different room'), { status: 403 });
      }

      // Find the active ISSUED request_item for this stock entry
      const { rows: reqItems } = await client.query(
        `SELECT ri.id, ri.request_id, ri.qty_requested
         FROM request_items ri
         JOIN requests r ON r.id = ri.request_id
         WHERE ri.stock_id = $1
           AND ri.status IN ('ISSUED', 'PENDING')
           AND r.status IN ('ISSUED', 'PARTIALLY RETURNED', 'PENDING')
         FOR UPDATE`,
        [stock.id]
      );
      if (!reqItems.length) throw Object.assign(new Error('This item is not currently issued to anyone.'), { status: 400 });

      const reqItem = reqItems[0];
      const requestId = reqItem.request_id;
      const returnQty = qtyReturned || reqItem.qty_requested || 1;

      // Room check via request
      if (callerRoomId !== null) {
        const { rows: reqRows } = await client.query(`SELECT room_id FROM requests WHERE id = $1`, [requestId]);
        if (!reqRows.length) throw Object.assign(new Error('Request not found'), { status: 404 });
        if (String(reqRows[0].room_id) !== String(callerRoomId)) {
          throw Object.assign(new Error('Forbidden: You may only return items that belong to your room'), { status: 403 });
        }
      }

      // Restore only the qty being returned now (not the full qty_requested)
      await client.query(
        `UPDATE inventory_type_stocks
         SET qty_available = LEAST(qty_total, qty_available + $1)
         WHERE id = $2`,
        [returnQty, stock.id]
      );

      // Accumulate qty_returned; only flip status to RETURNED when all qty is back
      await client.query(
        `UPDATE request_items
         SET qty_returned  = COALESCE(qty_returned, 0) + $1,
             returned_time = NOW(),
             status = CASE
               WHEN COALESCE(qty_returned, 0) + $1 >= qty_requested THEN 'RETURNED'
               ELSE status
             END
         WHERE id = $2`,
        [returnQty, reqItem.id]
      );

      // Pending = items still ISSUED/PENDING AND (unit items) or (qty items not fully returned)
      const { rows: pendingItems } = await client.query(
        `SELECT id FROM request_items
         WHERE request_id = $1
           AND status IN ('ISSUED', 'PENDING')
           AND (stock_id IS NULL OR COALESCE(qty_returned, 0) < qty_requested)`,
        [requestId]
      );

      let finalStatus = 'PARTIALLY RETURNED';
      if (pendingItems.length === 0) {
        finalStatus = 'RETURNED';
        await client.query(
          `UPDATE requests SET status = 'RETURNED', full_return_time = NOW(), last_return_time = NOW() WHERE id = $1`,
          [requestId]
        );
      } else {
        await client.query(
          `UPDATE requests SET status = 'PARTIALLY RETURNED', last_return_time = NOW() WHERE id = $1`,
          [requestId]
        );
      }

      return {
        message: `Returned ${returnQty}× item successfully!`,
        requestStatus: finalStatus,
        requestId,
        itemsRemaining: pendingItems.length,
        mode: 'quantity',
      };
    }

    // ── Unit-mode fallback (inventory_items) ──────────────────────────────
    const { rows: invItems } = await client.query(`SELECT id FROM inventory_items WHERE barcode = $1`, [barcode]);
    if (!invItems.length) throw Object.assign(new Error('Invalid Barcode: Item not found in database'), { status: 404 });
    const physicalItemId = invItems[0].id;

    const { rows: reqItems } = await client.query(
      `SELECT ri.id, ri.request_id FROM request_items ri
       JOIN requests r ON r.id = ri.request_id
       WHERE ri.inventory_item_id = $1
         AND ri.status IN ('ISSUED', 'PENDING')
         AND r.status IN ('ISSUED', 'PARTIALLY RETURNED', 'PENDING')
       FOR UPDATE`,
      [physicalItemId]
    );
    if (!reqItems.length) throw Object.assign(new Error('This item is not currently issued to anyone.'), { status: 400 });

    const reqItem = reqItems[0];
    const requestId = reqItem.request_id;

    if (callerRoomId !== null && callerRoomId !== undefined) {
      const { rows: reqRows } = await client.query(`SELECT room_id FROM requests WHERE id = $1`, [requestId]);
      if (!reqRows.length) throw Object.assign(new Error('Request not found'), { status: 404 });
      if (String(reqRows[0].room_id) !== String(callerRoomId)) {
        throw Object.assign(new Error('Forbidden: You may only return items that belong to your room'), { status: 403 });
      }
    }

    await client.query(
      `UPDATE request_items SET status = 'RETURNED', returned_time = NOW(), return_condition = $1 WHERE id = $2`,
      [condition, reqItem.id]
    );
    await client.query(
      `UPDATE inventory_items
       SET status = 'available', metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{condition}', $1::jsonb)
       WHERE id = $2`,
      [`"${condition}"`, physicalItemId]
    );

    const { rows: pendingItems } = await client.query(
      `SELECT id FROM request_items
       WHERE request_id = $1 AND inventory_item_id IS NOT NULL AND status IN ('ISSUED', 'PENDING')`, [requestId]
    );

    // Also check if any qty-mode items are still pending
    const { rows: pendingQty } = await client.query(
      `SELECT id FROM request_items
       WHERE request_id = $1 AND stock_id IS NOT NULL AND status IN ('ISSUED', 'PENDING')`, [requestId]
    );

    let finalStatus = 'PARTIALLY RETURNED';
    if (pendingItems.length === 0 && pendingQty.length === 0) {
      finalStatus = 'RETURNED';
      await client.query(
        `UPDATE requests SET status = 'RETURNED', full_return_time = NOW(), last_return_time = NOW() WHERE id = $1`,
        [requestId]
      );
    } else {
      await client.query(
        `UPDATE requests SET status = 'PARTIALLY RETURNED', last_return_time = NOW() WHERE id = $1`,
        [requestId]
      );
    }

    return {
      message: 'Item scanned and returned successfully!',
      requestStatus: finalStatus,
      requestId,
      itemsRemaining: pendingItems.length + pendingQty.length,
      mode: 'unit',
    };
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// 8. returnRequest (bulk / legacy manual)
// ─────────────────────────────────────────────────────────────────────────────
const returnRequest = async (id) => {
  return withTransaction(async (client) => {
    const { rows: reqRows } = await client.query(
      `SELECT * FROM requests WHERE id = $1 AND status IN ('ISSUED', 'PARTIALLY RETURNED') FOR UPDATE`, [id]
    );
    if (!reqRows.length) throw Object.assign(new Error('Request not found or not issued'), { status: 400 });

    // Return all unit-mode items
    const { rows: unitItems } = await client.query(
      `SELECT ri.inventory_item_id FROM request_items ri
       WHERE ri.request_id = $1 AND ri.inventory_item_id IS NOT NULL AND ri.status IN ('ISSUED', 'PENDING')`, [id]
    );
    for (const item of unitItems) {
      await client.query(`UPDATE inventory_items SET status = 'available' WHERE id = $1`, [item.inventory_item_id]);
    }

    // Return all qty-mode items
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
      `UPDATE requests SET status = 'RETURNED', full_return_time = NOW() WHERE id = $1 RETURNING *`, [id]
    );
    return rows[0];
  });
};

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
