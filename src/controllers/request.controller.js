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
  rejectRequest, issueRequest, returnItemByBarcode, returnRequest, getCalendarEvents, cancelRequest
};