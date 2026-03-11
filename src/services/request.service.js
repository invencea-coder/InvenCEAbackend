// src/services/request.service.js
const { query, withTransaction } = require('../config/db');
const notificationService = require('./notification.service');
const { sendStatusEmail } = require('../config/mailer');
const logger = require('../utils/logger');
const crypto = require('crypto');

/**
 * Utility: check if a given createdAt has expired (end of same day)
 */
const checkExpiration = (createdAt) => {
  const endOfDay = new Date(createdAt);
  endOfDay.setHours(23, 59, 59, 999);
  return new Date() > endOfDay;
};

// ─────────────────────────────────────────────────────────────────────────────
// 1. Smart Creation (Schedules & Status)
// ─────────────────────────────────────────────────────────────────────────────
const createRequest = async ({ requester_type, requester_id, requester_email, room_id, purpose, items, companions, scheduled_time }) => {
  return withTransaction(async (client) => {
    let returnDeadline = null;

    // Faculty Smart Scheduling: Find the absolute latest end_time among companions
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
    }

    const groupQr = crypto.randomBytes(16).toString('hex');
    const initialStatus = requester_type === 'faculty' ? 'PENDING APPROVAL' : 'PENDING';

    const { rows } = await client.query(
      `INSERT INTO requests (requester_type, requester_id, room_id, purpose, qr_code, scheduled_time, return_deadline, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [requester_type, requester_id, room_id || null, purpose || null, groupQr, scheduled_time || null, returnDeadline, initialStatus]
    );

    const request = rows[0];
    request.requester_email = requester_email; // attach for email notifications

    if (Array.isArray(items)) {
      for (const item of items) {
        await client.query(
          `INSERT INTO request_items (request_id, inventory_type_id, consumable_id, quantity, assigned_to)
           VALUES ($1, $2, $3, $4, $5)`,
          [
             request.id, 
             item.inventory_type_id, 
             item.consumable_id || null, 
             item.quantity || 1,
             item.assigned_to || item.assignTo || 'Shared Group'
          ]
        );
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
// 2. Get single request (with items & members)
// ─────────────────────────────────────────────────────────────────────────────
const getRequest = async (id) => {
  const { rows } = await query(
    `SELECT r.*, rm.code AS room_code
     FROM requests r LEFT JOIN rooms rm ON rm.id = r.room_id
     WHERE r.id = $1`, [id]
  );
  if (!rows.length) throw Object.assign(new Error('Request not found'), { status: 404 });

  const requestRow = rows[0];

  const { rows: items } = await query(
    `SELECT ri.*, it.name AS item_name, it.type AS item_type,
            ii.barcode AS inventory_item_barcode, ic.barcode AS consumable_barcode,
            COALESCE(ri.status, ii.status) AS item_status
     FROM request_items ri
     JOIN inventory_types it ON it.id = ri.inventory_type_id
     LEFT JOIN inventory_items ii ON ii.id = ri.inventory_item_id
     LEFT JOIN inventory_consumables ic ON ic.id = ri.consumable_id
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
// 3. Get request by QR or numeric ID
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
    `SELECT ri.*, it.name AS item_name, it.type AS item_type,
            ii.barcode AS inventory_item_barcode, ic.barcode AS consumable_barcode,
            COALESCE(ri.status, ii.status) AS item_status, ic.quantity_available
     FROM request_items ri
     JOIN inventory_types it ON it.id = ri.inventory_type_id
     LEFT JOIN inventory_items ii ON ii.id = ri.inventory_item_id
     LEFT JOIN inventory_consumables ic ON ic.id = ri.consumable_id
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
// 4. listRequests - returns richer item objects usable by frontend scanner
// ─────────────────────────────────────────────────────────────────────────────
const listRequests = async ({ room_id, status, requester_type, requester_id } = {}) => {
  const conditions = [];
  const values = [];
  let i = 1;

  if (room_id) { conditions.push(`r.room_id = $${i++}`); values.push(room_id); }
  
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

  if (requester_type) { conditions.push(`r.requester_type = $${i++}`); values.push(requester_type); }
  if (requester_id) {
    conditions.push(`(r.requester_id = $${i} OR r.id IN (SELECT request_id FROM request_group_members WHERE student_id = $${i}))`);
    values.push(requester_id);
    i++;
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await query(
    `SELECT r.*, rm.code AS room_code,
      (
        SELECT json_agg(json_build_object(
          'id', ri.id,
          'item_name', it.name,
          'inventory_type_id', ri.inventory_type_id,
          'quantity', ri.quantity,
          'consumable_id', ri.consumable_id,
          'inventory_item_id', ri.inventory_item_id,
          'inventory_item_barcode', ii.barcode,
          'item_status', COALESCE(ri.status, ii.status),
          'assigned_to', ri.assigned_to
        ))
        FROM request_items ri
        JOIN inventory_types it ON it.id = ri.inventory_type_id
        LEFT JOIN inventory_items ii ON ii.id = ri.inventory_item_id
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
// 5. Approvals
// ─────────────────────────────────────────────────────────────────────────────
const approveRequest = async (id, email) => {
  const { rows: reqs } = await query(`SELECT created_at FROM requests WHERE id = $1 AND status IN ('PENDING APPROVAL', 'PENDING')`, [id]);
  if (!reqs.length) throw Object.assign(new Error('Request not found or already processed'), { status: 400 });

  const { rows } = await query(`UPDATE requests SET status = 'APPROVED', approved_time = now() WHERE id = $1 RETURNING *`, [id]);
  if (email) await sendStatusEmail(email, rows[0], 'APPROVED');
  await notificationService.notifyApproved(rows[0]);
  return rows[0];
};

const rejectRequest = async (id, email) => {
  const { rows } = await query(`UPDATE requests SET status = 'REJECTED' WHERE id = $1 AND status IN ('PENDING APPROVAL', 'PENDING') RETURNING *`, [id]);
  if (!rows.length) throw Object.assign(new Error('Request not found or already processed'), { status: 400 });
  if (email) await sendStatusEmail(email, rows[0], 'REJECTED');
  return rows[0];
};

// ─────────────────────────────────────────────────────────────────────────────
// 6. Issue Request
// ─────────────────────────────────────────────────────────────────────────────
const issueRequest = async (id, itemsToIssue = []) => {
  return withTransaction(async (client) => {
    const { rows: reqRows } = await client.query(`SELECT * FROM requests WHERE id = $1 AND status IN ('APPROVED', 'PENDING') FOR UPDATE`, [id]);
    if (!reqRows.length) throw Object.assign(new Error('Request not found or cannot be issued'), { status: 400 });

    for (const item of itemsToIssue) {
      if (item.quantity <= 0) {
        if (item.id) await client.query(`UPDATE request_items SET status = 'CANCELLED', quantity = 0 WHERE id = $1`, [item.id]);
        continue;
      }

      let requestItemId = item.id;
      const assignedTo = item.assigned_to || 'Shared Group';

      if (!requestItemId) {
        const { rows: inserted } = await client.query(
          `INSERT INTO request_items (request_id, inventory_type_id, consumable_id, quantity, status, assigned_to)
           VALUES ($1, $2, $3, $4, 'ISSUED', $5) RETURNING id`,
          [id, item.inventory_type_id, item.consumable_id || null, item.quantity, assignedTo]
        );
        requestItemId = inserted[0].id;
      }

      if (!item.consumable_id) { // Borrowable
        for (let i = 0; i < item.quantity; i++) {
          const { rows: available } = await client.query(
            `SELECT id FROM inventory_items WHERE inventory_type_id = $1 AND status = 'available' FOR UPDATE SKIP LOCKED LIMIT 1`, [item.inventory_type_id]
          );
          if (!available.length) throw Object.assign(new Error(`Item out of stock`), { status: 409 });

          const physicalItemId = available[0].id;
          await client.query(`UPDATE inventory_items SET status = 'borrowed' WHERE id = $1`, [physicalItemId]);

          if (i === 0) {
            await client.query(`UPDATE request_items SET inventory_item_id = $1, status = 'ISSUED', quantity = 1, assigned_to = $3 WHERE id = $2`, [physicalItemId, requestItemId, assignedTo]);
          } else {
            await client.query(
              `INSERT INTO request_items (request_id, inventory_type_id, inventory_item_id, quantity, status, assigned_to) VALUES ($1, $2, $3, 1, 'ISSUED', $4)`,
              [id, item.inventory_type_id, physicalItemId, assignedTo]
            );
          }
        }
      } else { // Consumable
        const { rows: cons } = await client.query(`SELECT * FROM inventory_consumables WHERE id = $1 FOR UPDATE`, [item.consumable_id]);
        if (!cons.length || cons[0].quantity_available < item.quantity) throw Object.assign(new Error(`Insufficient consumable quantity`), { status: 409 });

        await client.query(`UPDATE inventory_consumables SET quantity_available = quantity_available - $1 WHERE id = $2`, [item.quantity, item.consumable_id]);
        await client.query(`UPDATE request_items SET status = 'ISSUED', quantity = $1, assigned_to = $3 WHERE id = $2`, [item.quantity, requestItemId, assignedTo]);
      }
    }

    const { rows: issued } = await client.query(`UPDATE requests SET status = 'ISSUED', issued_time = clock_timestamp() WHERE id = $1 RETURNING *`, [id]);
    return issued[0];
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// 7. Barcode Return Engine
// ─────────────────────────────────────────────────────────────────────────────
const returnItemByBarcode = async (barcode, condition = 'Good', callerRoomId = null) => {
  return withTransaction(async (client) => {
    // 1. Find the physical item by barcode
    const { rows: invItems } = await client.query(`SELECT id FROM inventory_items WHERE barcode = $1`, [barcode]);
    if (!invItems.length) throw Object.assign(new Error('Invalid Barcode: Item not found in database'), { status: 404 });
    const physicalItemId = invItems[0].id;

    // 2. Find the ACTIVE request_item referencing this physical item.
    //    Accept 'ISSUED' or 'PENDING' — 'PENDING' can occur when a request was
    //    marked ISSUED at the request level but the item row was never updated
    //    (e.g. legacy data or a failed issue transaction).
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

    // 2b. Security: ensure request belongs to callerRoomId (if provided)
    if (callerRoomId !== null && callerRoomId !== undefined) {
      const { rows: reqRows } = await client.query(`SELECT room_id FROM requests WHERE id = $1`, [requestId]);
      if (!reqRows.length) throw Object.assign(new Error('Request not found'), { status: 404 });

      const requestRoomId = reqRows[0].room_id;
      if (String(requestRoomId) !== String(callerRoomId)) {
        throw Object.assign(new Error('Forbidden: You may only return items that belong to your room'), { status: 403 });
      }
    }

    // 3. Mark the specific item as returned
    await client.query(
      `UPDATE request_items SET status = 'RETURNED', returned_time = NOW(), return_condition = $1 WHERE id = $2`,
      [condition, reqItem.id]
    );

    // 4. Restore physical inventory and log condition
    await client.query(
      `UPDATE inventory_items 
       SET status = 'available', metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{condition}', $1::jsonb) 
       WHERE id = $2`,
      [`"${condition}"`, physicalItemId]
    );

    // 5. Check if entire request is finished (ignoring consumables)
    const { rows: pendingItems } = await client.query(
      `SELECT id FROM request_items 
       WHERE request_id = $1 AND inventory_item_id IS NOT NULL AND status IN ('ISSUED', 'PENDING')`, 
      [requestId]
    );

    let finalStatus = 'PARTIALLY RETURNED';
    if (pendingItems.length === 0) {
      finalStatus = 'RETURNED';
      await client.query(`UPDATE requests SET status = 'RETURNED', full_return_time = NOW() WHERE id = $1`, [requestId]);
    } else {
      await client.query(`UPDATE requests SET status = 'PARTIALLY RETURNED' WHERE id = $1`, [requestId]);
    }

    return { 
      message: 'Item scanned and returned successfully!', 
      requestStatus: finalStatus, 
      requestId: requestId,
      itemsRemaining: pendingItems.length 
    };
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// 8. Legacy manual return
// ─────────────────────────────────────────────────────────────────────────────
const returnRequest = async (id) => {
  return withTransaction(async (client) => {
    const { rows: reqRows } = await client.query(
      `SELECT * FROM requests WHERE id = $1 AND status IN ('ISSUED', 'PARTIALLY RETURNED') FOR UPDATE`, [id]
    );
    if (!reqRows.length) throw Object.assign(new Error('Request not found or not issued'), { status: 400 });

    const { rows: reqItems } = await client.query(
      `SELECT ri.inventory_item_id FROM request_items ri
       WHERE ri.request_id = $1 AND ri.inventory_item_id IS NOT NULL AND ri.status IN ('ISSUED', 'PENDING')`, [id]
    );

    for (const item of reqItems) {
      await client.query(`UPDATE inventory_items SET status = 'available' WHERE id = $1`, [item.inventory_item_id]);
    }

    await client.query(
      `UPDATE request_items SET status = 'RETURNED', returned_time = NOW() 
       WHERE request_id = $1 AND status IN ('ISSUED', 'PENDING')`, [id]
    );
    const { rows } = await client.query(`UPDATE requests SET status = 'RETURNED', full_return_time = NOW() WHERE id = $1 RETURNING *`, [id]);

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
