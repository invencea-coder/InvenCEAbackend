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
// 0. Auto-Cleanup (Strict Stock Boundaries & Robust Expiration)
// ─────────────────────────────────────────────────────────────────────────────
const autoVoidExpiredRequests = async () => {
  return withTransaction(async (client) => {
    const { rows: expired } = await client.query(`
      SELECT id FROM requests 
      WHERE status IN ('PENDING', 'PENDING APPROVAL', 'APPROVED')
      AND (
        (pickup_datetime IS NOT NULL AND pickup_datetime + interval '15 minutes' < NOW())
        OR
        (pickup_end IS NOT NULL AND pickup_end < NOW())
        OR
        (pickup_start IS NOT NULL AND pickup_end IS NULL AND pickup_start + interval '1 day' < NOW())
        OR
        (return_deadline IS NOT NULL AND return_deadline < NOW())
        OR
        (expires_at IS NOT NULL AND expires_at < NOW())
      )
      FOR UPDATE SKIP LOCKED
    `);

    for (const req of expired) {
      const id = req.id;
      // ⚡ FIX: Use 'VOIDED' instead of 'CANCELLED' for system expirations
      await client.query(`UPDATE request_items SET status = 'VOIDED' WHERE request_id = $1`, [id]);
      await client.query(`UPDATE requests SET status = 'VOIDED' WHERE id = $1`, [id]);
    }
    return expired.length;
  });
};

const createRequest = async ({ requester_type, requester_id, requester_email, room_id, purpose, items, scheduled_time, pickup_datetime, pickup_start, pickup_end, return_deadline }) => {
  return withTransaction(async (client) => {
    let expiresAt = null;

    if (requester_type !== 'admin' && !pickup_datetime && !pickup_start && !scheduled_time) {
      expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + 15);
    }

    const groupQr = crypto.randomBytes(16).toString('hex');
    const initialStatus = 'PENDING';

    const { rows } = await client.query(
      `INSERT INTO requests 
        (requester_type, requester_id, requester_email, room_id, purpose, qr_code, qr_token, 
         scheduled_time, return_deadline, expires_at, status, pickup_datetime, pickup_start, pickup_end)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *`,
      [requester_type, requester_id, requester_email, room_id || null, purpose || null, groupQr, groupQr, scheduled_time || null, return_deadline || null, expiresAt, initialStatus, pickup_datetime || null, pickup_start || null, pickup_end || null]
    );

    const request = rows[0];
    request.requester_email = requester_email;

    if (Array.isArray(items)) {
      for (const item of items) {
        if (item.stock_id) {
          const q = item.qty_requested || item.quantity || 1;
          await client.query(
            `INSERT INTO request_items (request_id, inventory_type_id, stock_id, qty_requested, quantity, assigned_to) VALUES ($1, $2, $3, $4, $5, $6)`,
            [request.id, item.inventory_type_id, item.stock_id, q, q, item.assigned_to || 'Requester']
          );
        } else {
          await client.query(
            `INSERT INTO request_items (request_id, inventory_type_id, inventory_item_id, consumable_id, quantity, assigned_to) VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              request.id, 
              item.inventory_type_id, 
              item.inventory_item_id || null, 
              item.consumable_id || null, 
              item.quantity || 1, 
              item.assigned_to || 'Requester'
            ]
          );
        }
      }
    }
    return { ...request, qr_code: groupQr };
  });
};

const getRequest = async (id) => {
  const { rows } = await query(
    `SELECT r.*, rm.code AS room_code,
            COALESCE(u.name, s.full_name) AS requester_name,
            s.student_id AS student_id,
            COALESCE(r.requester_email, u.email) AS requester_email
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

const getRequestByQR = async (qrCode) => {
  const isNumeric = /^\d+$/.test(qrCode);

  const { rows } = await query(
    `SELECT r.*, rm.code AS room_code,
            COALESCE(u.name, s.full_name) AS requester_name,
            s.student_id AS student_id,
            COALESCE(r.requester_email, u.email) AS requester_email
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

const listRequests = async ({ room_id, status, requester_type, requester_id } = {}) => {
  try { await autoVoidExpiredRequests(); } catch (e) { console.error('Auto-void error:', e); }

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
      COALESCE(r.requester_email, u.email) AS requester_email,
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

const approveRequest = async (id, providedEmail) => {
  let request = null;
  let targetEmail = providedEmail;

  await withTransaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE requests SET status = 'APPROVED', approved_time = NOW() 
       WHERE id = $1 AND status IN ('PENDING', 'PENDING APPROVAL') RETURNING *`,
      [id]
    );

    if (!rows.length) throw Object.assign(new Error('Request not found or cannot be approved'), { status: 400 });

    request = rows[0];

    if (!targetEmail) {
      try {
        const { rows: reqRows } = await client.query(
          `SELECT requester_email FROM requests WHERE id = $1`, [id]
        );
        if (reqRows.length && reqRows[0].requester_email) {
            targetEmail = reqRows[0].requester_email;
        }
      } catch (e) {}
    }
  });

  if (targetEmail) {
    try {
      await sendStatusEmail(targetEmail, request, 'APPROVED');
    } catch (err) {
      console.error('Approve email failed:', err);
    }
  }

  return request;
};

const rejectRequest = async (id, providedEmail, reason) => {
  let request = null;
  let targetEmail = providedEmail;

  await withTransaction(async (client) => {
    const { rows: reqs } = await client.query(
      `SELECT status FROM requests WHERE id = $1 AND status IN ('PENDING APPROVAL', 'PENDING', 'APPROVED') FOR UPDATE`, [id]
    );
    if (!reqs.length) throw Object.assign(new Error('Request not found or already processed'), { status: 400 });
    
    // DANGEROUS CODE REMOVED: APPROVED items are not yet deducted from qty_available.
    
    await client.query(`UPDATE request_items SET status = 'REJECTED' WHERE request_id = $1`, [id]);
    
    const { rows } = await client.query(`UPDATE requests SET status = 'REJECTED' WHERE id = $1 RETURNING *`, [id]);
    request = rows[0];
    request.reject_reason = reason;

    if (!targetEmail) {
      try {
        const { rows: reqRows } = await client.query(
          `SELECT requester_email FROM requests WHERE id = $1`, [id]
        );
        if (reqRows.length && reqRows[0].requester_email) {
            targetEmail = reqRows[0].requester_email;
        }
      } catch (e) {}
    }
  });

  if (targetEmail) {
    try {
      await sendStatusEmail(targetEmail, request, 'REJECTED');
    } catch (err) {
      console.error('Reject email failed:', err);
    }
  }

  return request;
};

const cancelRequest = async (id) => {
  return withTransaction(async (client) => {
    const { rows: reqs } = await client.query(
      `SELECT status FROM requests WHERE id = $1 AND status IN ('PENDING', 'PENDING APPROVAL', 'APPROVED') FOR UPDATE`, [id]
    );
    if (!reqs.length) throw Object.assign(new Error('Request cannot be cancelled'), { status: 400 });
    
    // DANGEROUS CODE REMOVED: APPROVED items are not yet deducted from qty_available.

    await client.query(`UPDATE request_items SET status = 'CANCELLED' WHERE request_id = $1`, [id]);

    const { rows } = await client.query(`UPDATE requests SET status = 'CANCELLED' WHERE id = $1 RETURNING *`, [id]);
    return rows[0];
  });
};

const issueRequest = async (id, items, return_deadline) => {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE requests SET status = 'ISSUED', issued_time = NOW(), return_deadline = $2 
       WHERE id = $1 AND status = 'APPROVED' RETURNING *`,
      [id, return_deadline]
    );

    if (!rows.length) throw Object.assign(new Error('Request not found or not approved'), { status: 400 });
    const request = rows[0];

    for (const item of items) {
      if (item.id) {
        await client.query(
          `UPDATE request_items SET status = 'ISSUED', inventory_item_id = COALESCE($1, inventory_item_id) WHERE id = $2`,
          [item.inventory_item_id || null, item.id]
        );
      } else if (item.inventory_item_id) {
        await client.query(`UPDATE request_items SET status = 'ISSUED' WHERE request_id = $1 AND inventory_item_id = $2`, [id, item.inventory_item_id]);
      } else if (item.stock_id) {
        await client.query(`UPDATE request_items SET status = 'ISSUED' WHERE request_id = $1 AND stock_id = $2`, [id, item.stock_id]);
      } else if (item.consumable_id) {
        await client.query(`UPDATE request_items SET status = 'ISSUED' WHERE request_id = $1 AND consumable_id = $2`, [id, item.consumable_id]);
      } else {
        await client.query(`UPDATE request_items SET status = 'ISSUED' WHERE request_id = $1 AND inventory_type_id = $2`, [id, item.inventory_type_id]);
      }

      // This is the true point of stock deduction
      if (item.inventory_item_id) {
        await client.query(`UPDATE inventory_items SET status = 'borrowed' WHERE id = $1`, [item.inventory_item_id]);
      } else if (item.stock_id) {
        await client.query(`UPDATE inventory_type_stocks SET qty_available = GREATEST(0, qty_available - $1) WHERE id = $2`, [item.quantity || 1, item.stock_id]);
      } else if (item.consumable_id) {
        await client.query(`UPDATE inventory_consumables SET quantity_available = GREATEST(0, quantity_available - $1) WHERE id = $2`, [item.quantity || 1, item.consumable_id]);
      }
    }

    return request;
  });
};

const returnItemByBarcode = async (barcode, condition = 'Good', callerRoomId = null, qtyReturned = null, explicitRequestId = null) => {
  return withTransaction(async (client) => {
    
    // ==========================================
    // BULK / QUANTITY MODE RETURN
    // ==========================================
    const { rows: stockRows } = await client.query(
      `SELECT * FROM inventory_type_stocks WHERE barcode = $1`, [barcode]
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

      await client.query(`
        UPDATE inventory_type_stocks 
        SET qty_available = LEAST(qty_total, qty_available + $1) 
        WHERE id = $2
      `, [returnQty, stock.id]);

      if (condition === 'Damaged' || condition === 'Defective') {
        const colName = stock.hasOwnProperty('item_metadata') ? 'item_metadata' : 'metadata';
        let meta = {};
        try { meta = typeof stock[colName] === 'string' ? JSON.parse(stock[colName]) : (stock[colName] || {}); } catch(e) {}
        
        if (condition === 'Damaged') {
          meta.qty_damaged = (parseInt(meta.qty_damaged, 10) || 0) + returnQty;
        } else if (condition === 'Defective') {
          meta.qty_defective = (parseInt(meta.qty_defective, 10) || 0) + returnQty;
        }
        await client.query(`UPDATE inventory_type_stocks SET ${colName} = $1 WHERE id = $2`, [JSON.stringify(meta), stock.id]);
      }

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

    // ==========================================
    // UNIQUE UNIT MODE RETURN
    // ==========================================
    const { rows: invItems } = await client.query(`SELECT * FROM inventory_items WHERE barcode = $1`, [barcode]);
    if (!invItems.length) throw Object.assign(new Error('Invalid Barcode: Item not found in database'), { status: 404 });
    
    const physicalItem = invItems[0];
    const physicalItemId = physicalItem.id;

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

    const unitColName = physicalItem.hasOwnProperty('item_metadata') ? 'item_metadata' : 'metadata';
    let unitMeta = {};
    try { unitMeta = typeof physicalItem[unitColName] === 'string' ? JSON.parse(physicalItem[unitColName]) : (physicalItem[unitColName] || {}); } catch(e) {}
    unitMeta.condition = condition;

    await client.query(`UPDATE request_items SET status = 'RETURNED', returned_time = NOW(), return_condition = $1 WHERE id = $2`, [condition, reqItem.id]);
    await client.query(
      `UPDATE inventory_items SET status = 'available', ${unitColName} = $1 WHERE id = $2`, 
      [JSON.stringify(unitMeta), physicalItemId]
    );

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

const returnRequest = async (id) => {
  return withTransaction(async (client) => {
    const { rows: reqRows } = await client.query(
      `SELECT * FROM requests WHERE id = $1 AND status IN ('ISSUED', 'PARTIALLY RETURNED') FOR UPDATE`, [id]
    );
    if (!reqRows.length) throw Object.assign(new Error('Request not found or not issued'), { status: 400 });

    // Restore unit items
    const { rows: unitItems } = await client.query(
      `SELECT ri.inventory_item_id FROM request_items ri
       WHERE ri.request_id = $1 AND ri.inventory_item_id IS NOT NULL AND ri.status IN ('ISSUED', 'PENDING')`, [id]
    );
    for (const item of unitItems) {
      await client.query(`UPDATE inventory_items SET status = 'available' WHERE id = $1`, [item.inventory_item_id]);
    }

    // Restore quantity items securely (Subtracting whatever was already partially returned)
    const { rows: qtyItems } = await client.query(
      `SELECT ri.stock_id, ri.qty_requested, COALESCE(ri.qty_returned, 0) as qty_returned 
       FROM request_items ri
       WHERE ri.request_id = $1 AND ri.stock_id IS NOT NULL AND ri.status IN ('ISSUED', 'PENDING')`, [id]
    );
    for (const item of qtyItems) {
      const outstanding = Math.max(0, (item.qty_requested || 1) - item.qty_returned);
      if (outstanding > 0) {
        await client.query(
          `UPDATE inventory_type_stocks SET qty_available = LEAST(qty_total, qty_available + $1) WHERE id = $2`,
          [outstanding, item.stock_id]
        );
      }
    }

    // Restore consumable items securely
    const { rows: consItems } = await client.query(
      `SELECT ri.consumable_id, ri.quantity, COALESCE(ri.qty_returned, 0) as qty_returned 
       FROM request_items ri
       WHERE ri.request_id = $1 AND ri.consumable_id IS NOT NULL AND ri.status IN ('ISSUED', 'PENDING')`, [id]
    );
    for (const item of consItems) {
      const outstanding = Math.max(0, (item.quantity || 1) - item.qty_returned);
      if (outstanding > 0) {
        await client.query(
          `UPDATE inventory_consumables SET quantity_available = quantity_available + $1 WHERE id = $2`,
          [outstanding, item.consumable_id]
        );
      }
    }

    // Ensure qty_returned is explicitly logged as fulfilled
    await client.query(
      `UPDATE request_items 
       SET status = 'RETURNED', 
           returned_time = NOW(),
           qty_returned = COALESCE(qty_requested, quantity, 1)
       WHERE request_id = $1 AND status IN ('ISSUED', 'PENDING')`, [id]
    );
    
    const { rows } = await client.query(
      `UPDATE requests SET status = 'RETURNED', full_return_time = NOW(), last_return_time = NOW() WHERE id = $1 RETURNING *`, [id]
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
  cancelRequest,
  issueRequest,
  returnItemByBarcode,
  returnRequest,
};