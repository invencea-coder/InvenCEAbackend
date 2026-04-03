// backend/controllers/admin.controller.js
const { query, getClient } = require('../config/db');
const { success, badRequest, notFound } = require('../utils/apiResponse');
const bcrypt = require('bcrypt');
const { sendMail } = require('../config/mailer');
const { broadcast } = require('../config/socket'); 

// ── Search Students (For Autocomplete Modal) ──────────────────────────────
const searchStudents = async (req, res, next) => {
  try {
    const { q } = req.query;

    if (!q || q.trim().length < 2) {
      return success(res, []);
    }

    const { rows } = await query(
      `SELECT id, full_name, student_id, department 
       FROM students 
       WHERE full_name ILIKE $1 OR student_id ILIKE $1 
       LIMIT 10`,
      [`%${q.trim()}%`]
    );

    return success(res, rows);
  } catch (error) {
    next(error);
  }
};

// ── Dashboard (⚡ FIXED: Room Filtering & Correct Status Counts) ───────────

const getDashboardStats = async (req, res, next) => {
  try {
    const roomId = req.user?.room_id;
    const params = roomId ? [roomId] : [];
    
    // Filter by room if the admin is assigned to one
    const reqWhere = roomId ? `WHERE room_id = $1` : ``;
    const invWhere = roomId ? `AND location_room_id = $1` : ``;

    const { rows } = await query(`
      SELECT
        COUNT(*) FILTER (WHERE status IN ('PENDING', 'PENDING APPROVAL')) AS pending,
        COUNT(*) FILTER (WHERE status IN ('ISSUED', 'PARTIALLY RETURNED')) AS active,
        -- Due today or Overdue (deadline is today or earlier)
        COUNT(*) FILTER (WHERE status IN ('ISSUED', 'PARTIALLY RETURNED') AND return_deadline::date <= CURRENT_DATE) AS due_today
      FROM requests
      ${reqWhere}
    `, params);

    const { rows: stock } = await query(`
      SELECT COUNT(*) AS low_stock
      FROM inventory_consumables
      WHERE quantity_available <= 5 ${invWhere}
    `, params);

    return success(res, {
      pending:   parseInt(rows[0].pending) || 0,
      active:    parseInt(rows[0].active) || 0,
      due_today: parseInt(rows[0].due_today) || 0,
      low_stock: parseInt(stock[0].low_stock) || 0,
    });
  } catch (e) { next(e); }
};

const getRecentRequests = async (req, res, next) => {
  try {
    const roomId = req.user?.room_id;
    const params = roomId ? [roomId] : [];
    const whereClause = roomId ? `WHERE r.room_id = $1` : ``;

    const { rows } = await query(`
      SELECT
        r.id,
        r.requester_type,
        r.requester_id,
        COALESCE(u.name, s.full_name) AS requester_name,
        s.student_id AS student_id,
        rm.code AS room_code,
        r.purpose,
        r.status,
        r.requested_time,
        r.created_at
      FROM requests r
      LEFT JOIN rooms rm    ON rm.id = r.room_id
      LEFT JOIN users u     ON u.id::text = r.requester_id::text AND r.requester_type IN ('faculty', 'admin')
      LEFT JOIN students s  ON (s.id::text = r.requester_id::text OR s.student_id::text = r.requester_id::text) AND r.requester_type = 'student'
      ${whereClause}
      ORDER BY r.created_at DESC
      LIMIT 10
    `, params);
    return success(res, rows);
  } catch (e) { next(e); }
};

// ── Inventory ─────────────────────────────────────────────────────────────

const getInventory = async (req, res, next) => {
  try {
    const { rows: borrowable } = await query(`
      SELECT
        ii.id,
        it.name,
        it.sku,
        it.category,
        it.type,
        ii.barcode,
        ii.status,
        it.id AS inventory_type_id
      FROM inventory_items ii
      JOIN inventory_types it ON it.id = ii.inventory_type_id
      WHERE it.type = 'borrowable'
      ORDER BY it.name, ii.barcode
    `);

    const { rows: consumable } = await query(`
      SELECT
        ic.id,
        it.name,
        it.sku,
        it.category,
        it.type,
        ic.barcode,
        ic.quantity_total,
        ic.quantity_available,
        it.id AS inventory_type_id
      FROM inventory_consumables ic
      JOIN inventory_types it ON it.id = ic.inventory_type_id
      WHERE it.type = 'consumable'
      ORDER BY it.name
    `);

    return success(res, [...borrowable, ...consumable]);
  } catch (e) { next(e); }
};

const addInventoryItem = async (req, res, next) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const { name, sku, category, type, barcode, quantity_total, quantity_available } = req.body;

    if (!name || !sku || !barcode || !type) {
      await client.query('ROLLBACK');
      return badRequest(res, 'name, sku, barcode, and type are required');
    }

    const { rows: typeRows } = await client.query(
      `INSERT INTO inventory_types (name, sku, category, type)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (sku) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category
       RETURNING id`,
      [name, sku, category ?? 'Other', type]
    );
    const typeId = typeRows[0].id;

    if (type === 'borrowable') {
      await client.query(
        `INSERT INTO inventory_items (inventory_type_id, barcode) VALUES ($1, $2)`,
        [typeId, barcode]
      );
    } else {
      await client.query(
        `INSERT INTO inventory_consumables (inventory_type_id, barcode, quantity_total, quantity_available)
         VALUES ($1, $2, $3, $4)`,
        [typeId, barcode, quantity_total ?? 0, quantity_available ?? 0]
      );
    }

    await client.query('COMMIT');
    return success(res, null, 'Item added');
  } catch (e) {
    await client.query('ROLLBACK');
    next(e);
  } finally {
    client.release();
  }
};

const updateInventoryItem = async (req, res, next) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const { id } = req.params;
    const { name, sku, category, type, barcode, status, quantity_total, quantity_available } = req.body;

    if (type === 'borrowable') {
      await client.query(
        `UPDATE inventory_items SET barcode = COALESCE($1, barcode), status = COALESCE($2, status) WHERE id = $3`,
        [barcode, status, id]
      );
      await client.query(
        `UPDATE inventory_types SET name = COALESCE($1, name), sku = COALESCE($2, sku), category = COALESCE($3, category)
         WHERE id = (SELECT inventory_type_id FROM inventory_items WHERE id = $4)`,
        [name, sku, category, id]
      );
    } else {
      await client.query(
        `UPDATE inventory_consumables
         SET barcode = COALESCE($1, barcode),
             quantity_total = COALESCE($2, quantity_total),
             quantity_available = COALESCE($3, quantity_available)
         WHERE id = $4`,
        [barcode, quantity_total, quantity_available, id]
      );
      await client.query(
        `UPDATE inventory_types SET name = COALESCE($1, name), sku = COALESCE($2, sku), category = COALESCE($3, category)
         WHERE id = (SELECT inventory_type_id FROM inventory_consumables WHERE id = $4)`,
        [name, sku, category, id]
      );
    }

    await client.query('COMMIT');
    return success(res, null, 'Item updated');
  } catch (e) {
    await client.query('ROLLBACK');
    next(e);
  } finally {
    client.release();
  }
};

const deleteInventoryItem = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { type } = req.query;

    if (type === 'consumable') {
      await query(`DELETE FROM inventory_consumables WHERE id = $1`, [id]);
    } else {
      await query(`DELETE FROM inventory_items WHERE id = $1`, [id]);
    }

    return success(res, null, 'Item deleted');
  } catch (e) { next(e); }
};

// ── Reports ───────────────────────────────────────────────────────────────

const getReports = async (req, res, next) => {
  try {
    const { role, from, to } = req.query;

    const conditions = [`r.issued_time IS NOT NULL`];
    const params = [];
    let p = 1;

    if (role && role !== 'all') {
      conditions.push(`r.requester_type = $${p++}`);
      params.push(role);
    }
    if (from) {
      conditions.push(`r.issued_time >= $${p++}`);
      params.push(new Date(from).toISOString());
    }
    if (to) {
      conditions.push(`r.issued_time <= $${p++}`);
      params.push(new Date(to + 'T23:59:59').toISOString());
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const { rows } = await query(`
      SELECT
        r.id AS request_id,
        r.requester_type,
        COALESCE(u.name, s.full_name) AS requester_name,
        rm.code AS room_code,
        r.requested_time,
        r.approved_time,
        r.issued_time,
        json_agg(
          json_build_object(
            'name',    it.name,
            'barcode', COALESCE(ii.barcode, ic.barcode),
            'quantity', ri.quantity
          )
        ) AS items
      FROM requests r
      LEFT JOIN rooms rm   ON rm.id = r.room_id
      LEFT JOIN users u    ON u.id = r.requester_id AND r.requester_type = 'faculty'
      LEFT JOIN students s ON s.id = r.requester_id AND r.requester_type = 'student'
      JOIN request_items ri          ON ri.request_id = r.id
      JOIN inventory_types it        ON it.id = ri.inventory_type_id
      LEFT JOIN inventory_items ii   ON ii.id = ri.inventory_item_id
      LEFT JOIN inventory_consumables ic ON ic.id = ri.consumable_id
      ${where}
      GROUP BY r.id, r.requester_type, requester_name, rm.code, r.requested_time, r.approved_time, r.issued_time
      ORDER BY r.issued_time DESC
    `, params);

    return success(res, rows);
  } catch (e) { next(e); }
};

const exportReports = async (req, res, next) => {
  try {
    const { role, from, to, format } = req.body;

    const conditions = [`r.issued_time IS NOT NULL`];
    const params = [];
    let p = 1;

    if (role && role !== 'all') {
      conditions.push(`r.requester_type = $${p++}`);
      params.push(role);
    }
    if (from) {
      conditions.push(`r.issued_time >= $${p++}`);
      params.push(new Date(from).toISOString());
    }
    if (to) {
      conditions.push(`r.issued_time <= $${p++}`);
      params.push(new Date(to + 'T23:59:59').toISOString());
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const { rows } = await query(`
      SELECT
        r.id AS request_id,
        r.requester_type,
        COALESCE(u.name, s.full_name) AS requester_name,
        rm.code AS room_code,
        r.requested_time,
        r.approved_time,
        r.issued_time,
        json_agg(
          json_build_object(
            'name',    it.name,
            'barcode', COALESCE(ii.barcode, ic.barcode),
            'quantity', ri.quantity
          )
        ) AS items
      FROM requests r
      LEFT JOIN rooms rm   ON rm.id = r.room_id
      LEFT JOIN users u    ON u.id = r.requester_id AND r.requester_type = 'faculty'
      LEFT JOIN students s ON s.id = r.requester_id AND r.requester_type = 'student'
      JOIN request_items ri          ON ri.request_id = r.id
      JOIN inventory_types it        ON it.id = ri.inventory_type_id
      LEFT JOIN inventory_items ii   ON ii.id = ri.inventory_item_id
      LEFT JOIN inventory_consumables ic ON ic.id = ri.consumable_id
      ${where}
      GROUP BY r.id, r.requester_type, requester_name, rm.code, r.requested_time, r.approved_time, r.issued_time
      ORDER BY r.issued_time DESC
    `, params);

    if ((format || 'csv').toLowerCase() === 'json') {
      return res.json(rows);
    }

    const header = [
      'request_id',
      'requester_type',
      'requester_name',
      'room_code',
      'requested_time',
      'approved_time',
      'issued_time',
      'items_json'
    ];

    const escapeCsv = (val) => {
      if (val === null || val === undefined) return '';
      const s = typeof val === 'string' ? val : (val instanceof Date ? val.toISOString() : String(val));
      return `"${s.replace(/"/g, '""')}"`;
    };

    const lines = [header.join(',')];

    for (const r of rows) {
      const itemsJson = r.items ? JSON.stringify(r.items) : '[]';
      lines.push([
        escapeCsv(r.request_id),
        escapeCsv(r.requester_type),
        escapeCsv(r.requester_name),
        escapeCsv(r.room_code),
        escapeCsv(r.requested_time),
        escapeCsv(r.approved_time),
        escapeCsv(r.issued_time),
        escapeCsv(itemsJson),
      ].join(','));
    }

    const csv = lines.join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="reports.csv"');
    return res.send(csv);
  } catch (e) { next(e); }
};

const deleteReports = async (req, res, next) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const { from, to, role } = req.body;

    const conditions = [`issued_time IS NOT NULL`];
    const params = [];
    let p = 1;

    if (role && role !== 'all') {
      conditions.push(`requester_type = $${p++}`);
      params.push(role);
    }
    if (from) {
      conditions.push(`issued_time >= $${p++}`);
      params.push(new Date(from).toISOString());
    }
    if (to) {
      conditions.push(`issued_time <= $${p++}`);
      params.push(new Date(to + 'T23:59:59').toISOString());
    }

    await client.query(
      `DELETE FROM requests WHERE ${conditions.join(' AND ')}`,
      params
    );

    await client.query('COMMIT');
    return success(res, null, 'Records deleted');
  } catch (e) {
    await client.query('ROLLBACK');
    next(e);
  } finally {
    client.release();
  }
};

// ── Rooms ─────────────────────────────────────────────────────────────────

const getRooms = async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT * FROM rooms ORDER BY code`);
    return success(res, rows);
  } catch (e) { next(e); }
};

const setRoomAvailability = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { is_available, reason } = req.body;
    if (typeof is_available !== 'boolean') return badRequest(res, 'is_available must be boolean');

    const { rows } = await query(
      `UPDATE rooms SET is_available = $1, unavailable_reason = $2 WHERE id = $3 RETURNING *`,
      [is_available, is_available ? null : reason || null, id]
    );
    if (!rows.length) return notFound(res, 'Room not found');

    broadcast('room-updated', { 
      roomId: id, 
      is_available: is_available, 
      reason: is_available ? null : reason || null 
    });

    return success(res, rows[0], 'Room updated');
  } catch (e) { next(e); }
};

// ── Faculty management ────────────────────────────────────────────────────

const getFaculty = async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, email, name, role, created_at FROM users WHERE role = 'faculty' ORDER BY name`
    );
    return success(res, rows);
  } catch (e) { next(e); }
};

const addFaculty = async (req, res, next) => {
  try {
    const { email, name, password } = req.body;
    if (!email || !name) return badRequest(res, 'email and name are required');

    const password_hash = password ? await bcrypt.hash(password, 10) : null;

    const { rows } = await query(
      `INSERT INTO users (email, name, password_hash, role)
       VALUES ($1, $2, $3, 'faculty')
       RETURNING id, email, name, role, created_at`,
      [email, name, password_hash]
    );

    try {
      await sendMail({
        to: email,
        subject: 'InvenCEA — Faculty Account Created',
        html: `
          <div style="font-family:sans-serif;max-width:400px">
            <h2 style="color:#800000">InvenCEA</h2>
            <p>Hello ${name},</p>
            <p>Your faculty account has been created. You can now log in using OTP sent to this email.</p>
          </div>`,
      });
    } catch (mailErr) {
      console.warn('Welcome email failed:', mailErr.message);
    }

    return success(res, rows[0], 'Faculty added');
  } catch (e) {
    if (e.code === '23505') return badRequest(res, 'Email already exists');
    next(e);
  }
};

const updateFaculty = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { email, name } = req.body;
    const { rows } = await query(
      `UPDATE users SET email = COALESCE($1, email), name = COALESCE($2, name)
       WHERE id = $3 AND role = 'faculty'
       RETURNING id, email, name, role`,
      [email, name, id]
    );
    if (!rows.length) return notFound(res, 'Faculty not found');
    return success(res, rows[0], 'Faculty updated');
  } catch (e) { next(e); }
};

const deleteFaculty = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { rows } = await query(
      `DELETE FROM users WHERE id = $1 AND role = 'faculty' RETURNING id`,
      [id]
    );
    if (!rows.length) return notFound(res, 'Faculty not found');
    return success(res, null, 'Faculty deleted');
  } catch (e) { next(e); }
};

const notifyFacultyApproval = async (requestId) => {
  try {
    const { rows } = await query(`
      SELECT r.id, u.email, u.name, rm.code AS room_code, r.purpose
      FROM requests r
      JOIN users u   ON u.id = r.requester_id AND r.requester_type = 'faculty'
      LEFT JOIN rooms rm ON rm.id = r.room_id
      WHERE r.id = $1
    `, [requestId]);

    if (!rows.length) return;
    const { email, name, room_code, purpose } = rows[0];

    await sendMail({
      to: email,
      subject: 'InvenCEA — Your Request Has Been Approved',
      html: `
        <div style="font-family:sans-serif;max-width:480px">
          <h2 style="color:#800000">InvenCEA</h2>
          <p>Hello ${name},</p>
          <p>Your borrow request <strong>#${requestId}</strong> has been <strong style="color:#800000">approved</strong>.</p>
          ${room_code ? `<p>Room: <strong>${room_code}</strong></p>` : ''}
          ${purpose   ? `<p>Purpose: ${purpose}</p>` : ''}
          <p>Please proceed to the counter with your QR code to collect your items.</p>
          <p style="color:#999;font-size:12px">InvenCEA — CEA Inventory System</p>
        </div>`,
    });
  } catch (err) {
    console.warn(`Approval email failed for request ${requestId}:`, err.message);
  }
};

// ── Retroactive Log (Manual Paper Backup) ─────────────────────────────────
const logRetroactiveRequest = async (req, res, next) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    
    const { 
      student_id_number, 
      full_name, 
      room_id, 
      purpose, 
      barcodes, 
      requester_type,
      requested_time, 
      approved_time, 
      issued_time, 
      returned_time,
      return_deadline
    } = req.body;

    if (!full_name || !room_id || !barcodes || !requested_time || !approved_time || !issued_time) {
      await client.query('ROLLBACK');
      return badRequest(res, 'Missing required fields for retroactive logging.');
    }

    let requester_id = null;

    if (requester_type === 'student') {
      const { rows: students } = await client.query(
        `INSERT INTO students (student_id, full_name) 
         VALUES ($1, $2)
         ON CONFLICT (student_id) DO UPDATE SET full_name = EXCLUDED.full_name
         RETURNING id`,
        [student_id_number, full_name]
      );
      requester_id = students[0].id;
    } else {
      let { rows: facultyRows } = await client.query(`SELECT id FROM users WHERE name = $1 AND role = 'faculty' LIMIT 1`, [full_name]);
      if (facultyRows.length > 0) {
        requester_id = facultyRows[0].id;
      } else {
        const dummyEmail = `manual_log_${Date.now()}@offline.local`;
        const { rows: newFaculty } = await client.query(`INSERT INTO users (name, email, role) VALUES ($1, $2, 'faculty') RETURNING id`, [full_name, dummyEmail]);
        requester_id = newFaculty[0].id;
      }
    }

    const finalStatus = returned_time ? 'RETURNED' : 'ISSUED';

    const { rows: reqRows } = await client.query(
      `INSERT INTO requests 
       (requester_type, requester_id, room_id, purpose, status, created_at, requested_time, approved_time, issued_time, pickup_datetime, full_return_time, return_deadline)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) 
       RETURNING id`,
      [
        requester_type || 'student', 
        requester_id, 
        room_id, 
        purpose || 'Blackout Manual Log', 
        finalStatus,
        requested_time,
        requested_time, 
        approved_time, 
        issued_time,
        issued_time, 
        returned_time || null,
        return_deadline || null
      ]
    );
    const requestId = reqRows[0].id;

    for (const code of barcodes) {
      const { rows: items } = await client.query(
        `SELECT id, inventory_type_id, status FROM inventory_items WHERE barcode = $1`,
        [code]
      );

      if (!items.length) {
        await client.query('ROLLBACK');
        return badRequest(res, `Barcode ${code} not found in the database.`);
      }

      const item = items[0];

      if (item.status === 'borrowed') {
        const { rows: conflict } = await client.query(
          `SELECT id FROM request_items
           WHERE inventory_item_id = $1 AND status = 'ISSUED'`,
          [item.id]
        );
        if (conflict.length) {
          await client.query('ROLLBACK');
          return badRequest(res, `Barcode ${code} is already issued in an existing active request.`);
        }
      }

      if (returned_time) {
        await client.query(
          `UPDATE inventory_items SET status = 'available' WHERE id = $1`,
          [item.id]
        );
      } else {
        await client.query(
          `UPDATE inventory_items SET status = 'borrowed' WHERE id = $1`,
          [item.id]
        );
      }

      await client.query(
        `INSERT INTO request_items (request_id, inventory_type_id, inventory_item_id, quantity, status) 
         VALUES ($1, $2, $3, 1, $4)`,
        [requestId, item.inventory_type_id, item.id, finalStatus]
      );
    }

    await client.query('COMMIT');
    broadcast('inventory-updated', { reason: 'Retroactive Log' });

    return success(res, { request_id: requestId }, 'Paper log successfully injected.');
  } catch (e) {
    await client.query('ROLLBACK');
    next(e);
  } finally {
    client.release();
  }
};

module.exports = {
  searchStudents,
  getDashboardStats,
  getRecentRequests,
  getInventory,
  addInventoryItem,
  updateInventoryItem,
  deleteInventoryItem,
  getReports,
  exportReports,
  deleteReports,
  getRooms,
  setRoomAvailability,
  getFaculty,
  addFaculty,
  updateFaculty,
  deleteFaculty,
  notifyFacultyApproval,
  logRetroactiveRequest,
};