// src/controllers/request.controller.js
const { validationResult } = require('express-validator');
const requestService = require('../services/request.service');
const notificationService = require('../services/notification.service');
const { broadcast } = require('../config/socket');
const { success, created, badRequest } = require('../utils/apiResponse');
const { query } = require('../config/db');

const createRequest = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return badRequest(res, 'Validation failed', errors.array());

    const { room_id, purpose, items, scheduled_time, pickup_datetime, pickup_start, pickup_end, return_deadline, borrower_id, email } = req.body;

    let actual_requester_id = req.user.id;
    let actual_requester_type = req.user.role;
    let final_email = email || req.user.email;

    if (req.user.role === 'admin' && borrower_id) {
      const { rows: stuRows } = await query(`SELECT id FROM students WHERE student_id = $1`, [borrower_id]);
      
      if (stuRows.length > 0) {
        actual_requester_id = stuRows[0].id;
        actual_requester_type = 'student';
      } else {
        const { rows: facRows } = await query(
          `SELECT id, email FROM users WHERE (name ILIKE $1 OR email ILIKE $1) AND role = 'faculty'`, 
          [borrower_id]
        );
        
        if (facRows.length > 0) {
          actual_requester_id = facRows[0].id;
          actual_requester_type = 'faculty';
          final_email = facRows[0].email || final_email;
        } else {
          return res.status(400).json({ success: false, message: 'Borrower ID not found in the student or faculty directory.' });
        }
      }
    }

    const data = await requestService.createRequest({
      requester_type: actual_requester_type,
      requester_id: actual_requester_id,
      requester_email: final_email,
      room_id,
      purpose,
      items,
      scheduled_time,
      pickup_datetime,
      pickup_start,
      pickup_end,
      return_deadline,
    });

    broadcast('new-request', { id: data.id, room_id: data.room_id, requester_type: actual_requester_type });
    broadcast('inventory-updated', { message: 'New request created' });

    return created(res, data, 'Request created successfully');
  } catch (e) {
    console.error("❌ Create Request Error:", e);
    return res.status(e.status || 500).json({ success: false, message: e.message || 'Internal Server Error' });
  }
};

const createRetroactiveLog = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Forbidden: Admin access required.' });
    }

    const {
      student_id_number,
      full_name,
      room_id,
      purpose,
      barcodes,
      requester_type,
      created_at,        
      approved_time,
      issued_time,
      return_deadline,
      returned_time // We will use this to set the status, but NOT insert it into a missing column
    } = req.body;

    if (!barcodes || barcodes.length === 0) {
      return badRequest(res, 'At least one barcode is required.');
    }

    // 1. Resolve Requester ID based on type
    let actual_requester_id = null;
    if (requester_type === 'student') {
      const { rows: stuRows } = await query(`SELECT id FROM students WHERE student_id = $1`, [student_id_number]);
      if (stuRows.length > 0) {
        actual_requester_id = stuRows[0].id;
      } else {
        // Create a temporary student record if they don't exist yet
        const defaultPinHash = await require('bcrypt').hash('1234', 10);
        const { rows: newStu } = await query(
          `INSERT INTO students (student_id, full_name, pin_hash) VALUES ($1, $2, $3) RETURNING id`,
          [student_id_number, full_name, defaultPinHash]
        );
        actual_requester_id = newStu[0].id;
      }
    } else {
      // Faculty resolution
      const { rows: facRows } = await query(
        `SELECT id FROM users WHERE email = $1 AND role = 'faculty'`,
        [student_id_number]
      );
      if (facRows.length > 0) {
        actual_requester_id = facRows[0].id;
      } else {
        return badRequest(res, `Faculty member with email/ID ${student_id_number} not found in system.`);
      }
    }

    // 2. Resolve Barcodes into Physical Inventory Items
    const { rows: invItems } = await query(
      `SELECT id, inventory_type_id, barcode FROM inventory_items WHERE barcode = ANY($1::text[])`,
      [barcodes]
    );

    if (invItems.length !== barcodes.length) {
      const foundBarcodes = invItems.map(i => i.barcode);
      const missing = barcodes.filter(b => !foundBarcodes.includes(b));
      return badRequest(res, `The following barcodes were not found in inventory: ${missing.join(', ')}`);
    }

    // 3. Create the Main Request Row
    const finalStatus = returned_time ? 'RETURNED' : 'ISSUED';
    
    // 👇 FIX: Use the correct column name "last_return_time"
    const { rows: reqRows } = await query(
      `INSERT INTO requests 
        (requester_id, requester_type, room_id, purpose, status, created_at, approved_time, issued_time, return_deadline, last_return_time) 
       VALUES 
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) 
       RETURNING id`,
      [
        actual_requester_id,
        requester_type,
        room_id,
        purpose,
        finalStatus,
        created_at,        
        approved_time,
        issued_time,
        return_deadline || null,
        returned_time || null  // <--- This now accurately saves your 07:53 PM
      ]
    );
    const newRequestId = reqRows[0].id;

    // 4. Create the Request Items Links & Update Physical Inventory
    const itemPromises = invItems.map(async (item) => {
      // Add link table row
      await query(
        `INSERT INTO request_items (request_id, inventory_type_id, inventory_item_id, quantity, status, assigned_to) 
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [newRequestId, item.inventory_type_id, item.id, 1, finalStatus, 'Requester']
      );

      // Update physical item status
      const itemStatus = returned_time ? 'available' : 'borrowed';
      await query(
        `UPDATE inventory_items SET status = $1 WHERE id = $2`,
        [itemStatus, item.id]
      );
      
      // If the item is marked as RETURNED, we should insert a record into `return_logs` or similar history table if you use one.
      // E.g., if you have an `item_returns` table:
      if (returned_time) {
          // You might need to adjust this depending on your database schema for return logs.
          // This is a common pattern to log the specific return timestamp for an item.
          try {
              await query(
                  `INSERT INTO item_returns (request_item_id, returned_at, condition_upon_return, receiver_id)
                   VALUES ((SELECT id FROM request_items WHERE request_id = $1 AND inventory_item_id = $2 LIMIT 1), $3, 'Good', $4)`,
                  [newRequestId, item.id, returned_time, req.user.id]
              );
          } catch(logErr) {
               console.warn("Could not log to item_returns table, skipping return log insertion.", logErr.message);
          }
      }
    });

    await Promise.all(itemPromises);

    // 5. Tell the frontend to refresh
    const { broadcast } = require('../config/socket');
    broadcast('inventory-updated', { message: 'Retroactive log processed' });

    return success(res, { id: newRequestId }, 'Retroactive log injected successfully.');
  } catch (e) {
    console.error("❌ Retroactive Log Error:", e);
    return res.status(500).json({ success: false, message: e.message || 'Internal Server Error' });
  }
};

const getRequest = async (req, res) => {
  try {
    const data = await requestService.getRequest(req.params.id);
    
    if (req.user.role === 'admin' && data.room_id && String(data.room_id) !== String(req.user.room_id)) {
      return res.status(403).json({ success: false, message: 'Forbidden: Access restricted to your room' });
    }
    if (['student', 'faculty'].includes(req.user.role) && String(data.requester_id) !== String(req.user.id)) {
      return res.status(403).json({ success: false, message: 'Forbidden: Access restricted to your own requests' });
    }

    return success(res, data);
  } catch (e) { 
    return res.status(e.status || 500).json({ success: false, message: e.message || 'Internal Server Error' });
  }
};

const getRequestByQR = async (req, res) => {
  try {
    const data = await requestService.getRequestByQR(req.params.code);
    
    if (req.user.role === 'admin' && data.room_id && String(data.room_id) !== String(req.user.room_id)) {
      return res.status(403).json({ success: false, message: 'Forbidden: Access restricted to your room' });
    }
    if (['student', 'faculty'].includes(req.user.role) && String(data.requester_id) !== String(req.user.id)) {
      return res.status(403).json({ success: false, message: 'Forbidden: Access restricted to your own requests' });
    }

    return success(res, data);
  } catch (e) { 
    return res.status(e.status || 500).json({ success: false, message: e.message || 'Internal Server Error' });
  }
};

const listRequests = async (req, res) => {
  try {
    const { status, requester_type, requester_id, room_id } = req.query;
    const filters = { status };

    if (req.user.role === 'admin') {
      filters.room_id = req.user.room_id;
      if (requester_id) filters.requester_id = requester_id;
      if (requester_type) filters.requester_type = requester_type;
    } else {
      filters.requester_id = req.user.id;
      if (room_id) filters.room_id = room_id;
    }

    const data = await requestService.listRequests(filters);
    return success(res, data);
  } catch (e) { 
    return res.status(e.status || 500).json({ success: false, message: e.message || 'Internal Server Error' });
  }
};

const approveRequest = async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'Forbidden' });
    
    const requestRow = await requestService.getRequest(req.params.id);
    if (requestRow.room_id && String(requestRow.room_id) !== String(req.user.room_id)) {
      return res.status(403).json({ success: false, message: 'Forbidden: Access restricted to your room' });
    }

    const targetEmail = req.body.email;
    const data = await requestService.approveRequest(req.params.id, targetEmail);
    broadcast('request-updated', { id: req.params.id, status: 'APPROVED' });
    
    return success(res, data, 'Request approved');
  } catch (e) {
    console.error(`❌ Approval Error for Request #${req.params.id}:`, e.message);
    return res.status(e.status || 500).json({ success: false, message: e.message || 'Internal Server Error' });
  }
};

const rejectRequest = async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'Forbidden' });

    const requestRow = await requestService.getRequest(req.params.id);
    if (requestRow.room_id && String(requestRow.room_id) !== String(req.user.room_id)) {
      return res.status(403).json({ success: false, message: 'Forbidden: Access restricted to your room' });
    }

    const targetEmail = req.body.email;
    const reason = req.body.reason || 'No specific reason provided by administrator.';

    const data = await requestService.rejectRequest(req.params.id, targetEmail, reason);
    broadcast('request-updated', { id: req.params.id, status: 'REJECTED' });
    
    return success(res, data, 'Request rejected');
  } catch (e) { 
    console.error(`❌ Reject Error for Request #${req.params.id}:`, e.message);
    return res.status(e.status || 500).json({ success: false, message: e.message || 'Internal Server Error' });
  }
};

const issueRequest = async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'Forbidden' });

    const requestRow = await requestService.getRequest(req.params.id);
    if (requestRow.room_id && String(requestRow.room_id) !== String(req.user.room_id)) {
      return res.status(403).json({ success: false, message: 'Forbidden: Access restricted to your room' });
    }

    const { items, return_deadline } = req.body;
    const data = await requestService.issueRequest(req.params.id, items, return_deadline);
    
    return success(res, data, 'Request issued successfully');
  } catch (e) { 
    return res.status(e.status || 500).json({ success: false, message: e.message || 'Internal Server Error' });
  }
};

const returnItemByBarcode = async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'Forbidden' });

    const { barcode, condition, qtyReturned, requestId } = req.body;
    if (!barcode) return res.status(400).json({ success: false, message: "Barcode is required" });

    const result = await requestService.returnItemByBarcode(barcode, condition, req.user.room_id, qtyReturned, requestId);

    broadcast('inventory-updated', { message: 'Item returned via barcode' });
    broadcast('request-updated', { id: result.requestId });

    return success(res, result, result.message);
  } catch (e) { 
    return res.status(e.status || 500).json({ success: false, message: e.message || 'Internal Server Error' });
  }
};

const returnRequest = async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'Forbidden' });

    const requestRow = await requestService.getRequest(req.params.id);
    if (requestRow.room_id && String(requestRow.room_id) !== String(req.user.room_id)) {
      return res.status(403).json({ success: false, message: 'Forbidden: You may only operate on requests in your room' });
    }

    const data = await requestService.returnRequest(req.params.id);
    broadcast('inventory-updated', { message: 'Full request returned' });
    
    return success(res, data, 'Items returned successfully');
  } catch (e) { 
    return res.status(e.status || 500).json({ success: false, message: e.message || 'Internal Server Error' });
  }
};

const getCalendarEvents = async (req, res) => {
  try {
    let { room_id } = req.query;
    const db = require('../config/db');

    if (req.user && req.user.role === 'admin') {
      room_id = req.user.room_id;
    }
    
    if (!room_id || room_id === 'null' || room_id === 'undefined') {
      return res.status(400).json({ success: false, message: 'room_id is required' });
    }

    const { rows } = await db.query(
      `SELECT
         r.id, r.status, r.purpose, r.pickup_start, r.pickup_end, r.pickup_datetime,
         r.scheduled_time, r.issued_time, r.approved_time, r.return_deadline,
         rm.code AS room_code, COALESCE(u.name, s.full_name) AS requester_name,
         json_agg(json_build_object(
           'name',              it.name,
           'inventory_type_id', ri.inventory_type_id,
           'inventory_mode',    it.inventory_mode,
           'item_type',         it.type,
           'quantity',          COALESCE(ri.qty_requested, ri.quantity, 1),
           'inventory_item_id', ri.inventory_item_id,
           'stock_id',          ri.stock_id,
           'consumable_id',     ri.consumable_id
         )) FILTER (WHERE it.id IS NOT NULL) AS items
       FROM requests r
       LEFT JOIN rooms rm ON rm.id = r.room_id
       LEFT JOIN users u
         ON u.id::text = r.requester_id::text
        AND r.requester_type IN ('faculty', 'admin')
       LEFT JOIN students s
         ON (s.id::text = r.requester_id::text OR s.student_id::text = r.requester_id::text)
        AND r.requester_type = 'student'
       LEFT JOIN request_items ri
         ON ri.request_id = r.id
        AND ri.status NOT IN ('CANCELLED', 'RETURNED')
       LEFT JOIN inventory_types it ON it.id = ri.inventory_type_id
       WHERE r.room_id = $1
         AND r.status IN ('PENDING', 'PENDING APPROVAL', 'APPROVED', 'ISSUED', 'PARTIALLY RETURNED')
         AND (
           r.pickup_start    IS NOT NULL OR
           r.pickup_datetime IS NOT NULL OR
           r.issued_time     IS NOT NULL OR
           r.scheduled_time  IS NOT NULL
         )
       GROUP BY r.id, rm.code, u.name, s.full_name
       ORDER BY COALESCE(r.pickup_start, r.pickup_datetime, r.issued_time, r.scheduled_time) ASC`,
      [room_id]
    );

    return res.status(200).json({ success: true, data: rows });
  } catch (e) { 
    return res.status(e.status || 500).json({ success: false, message: e.message || 'Internal Server Error' });
  }
};

// src/controllers/request.controller.js
const cancelRequest = async (req, res) => {
  try {
    const requestRow = await requestService.getRequest(req.params.id);
    
    if (['student', 'faculty'].includes(req.user.role) && String(requestRow.requester_id) !== String(req.user.id)) {
      return res.status(403).json({ success: false, message: 'Forbidden: You can only cancel your own requests' });
    }

    const data = await requestService.cancelRequest(req.params.id);
    
    const { broadcast } = require('../config/socket');
    // ⚡ FIX: Added room_id so the Admin Dashboard properly filters and auto-removes it
    broadcast('request-updated', { id: req.params.id, status: 'CANCELLED', room_id: requestRow.room_id });
    broadcast('inventory-updated', { message: 'Items freed from cancellation', room_id: requestRow.room_id });

    return success(res, data, 'Request cancelled successfully');
  } catch (e) { 
    return res.status(e.status || 500).json({ success: false, message: e.message || 'Internal Server Error' });
  }
};

module.exports = {
  createRequest, getRequest, getRequestByQR, listRequests, approveRequest,
  rejectRequest, issueRequest, returnItemByBarcode, returnRequest, getCalendarEvents, cancelRequest, createRetroactiveLog
};