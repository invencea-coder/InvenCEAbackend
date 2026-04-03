// src/controllers/request.controller.js
const { validationResult } = require('express-validator');
const requestService = require('../services/request.service');
const notificationService = require('../services/notification.service');
const { broadcast } = require('../config/socket');
const { success, created, badRequest } = require('../utils/apiResponse');

const createRequest = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return badRequest(res, 'Validation failed', errors.array());

    const { room_id, purpose, items, scheduled_time, pickup_datetime, pickup_start, pickup_end, return_deadline, borrower_id } = req.body;

    const requester_id = (req.user.role === 'admin' && borrower_id) ? borrower_id : req.user.id;
    const requester_type = (req.user.role === 'admin' && borrower_id) ? 'student' : req.user.role;

    const data = await requestService.createRequest({
      requester_type,
      requester_id,
      requester_email: req.user.email,
      room_id,
      purpose,
      items,
      scheduled_time,
      pickup_datetime,
      pickup_start,
      pickup_end,
      return_deadline,
    });

    broadcast('new-request', { id: data.id, room_id: data.room_id, requester_type });
    broadcast('inventory-updated', { message: 'New request created' });

    return created(res, data, 'Request created successfully');
  } catch (e) {
    next(e);
  }
};

const getRequest = async (req, res, next) => {
  try {
    const data = await requestService.getRequest(req.params.id);
    
    // Admins can only view requests for their assigned room
    if (req.user.role === 'admin' && String(data.room_id) !== String(req.user.room_id)) {
      throw Object.assign(new Error('Forbidden: Access restricted to your room'), { status: 403 });
    }
    // Students and Faculty can only view their own requests
    if (['student', 'faculty'].includes(req.user.role) && String(data.requester_id) !== String(req.user.id)) {
      throw Object.assign(new Error('Forbidden: Access restricted to your own requests'), { status: 403 });
    }

    return success(res, data);
  } catch (e) { next(e); }
};

const getRequestByQR = async (req, res, next) => {
  try {
    const data = await requestService.getRequestByQR(req.params.code);
    
    // Admins can only scan requests for their assigned room
    if (req.user.role === 'admin' && String(data.room_id) !== String(req.user.room_id)) {
      throw Object.assign(new Error('Forbidden: Access restricted to your room'), { status: 403 });
    }
    // Students and Faculty can only view their own QR codes
    if (['student', 'faculty'].includes(req.user.role) && String(data.requester_id) !== String(req.user.id)) {
      throw Object.assign(new Error('Forbidden: Access restricted to your own requests'), { status: 403 });
    }

    return success(res, data);
  } catch (e) { next(e); }
};

const listRequests = async (req, res, next) => {
  try {
    const { status, requester_type, requester_id, room_id } = req.query;
    const filters = { status };

    if (req.user.role === 'admin') {
      // Admins are locked to their specific room
      filters.room_id = req.user.room_id;
      if (requester_id) filters.requester_id = requester_id;
      if (requester_type) filters.requester_type = requester_type;
    } else {
      // Students and Faculty only see their own requests
      filters.requester_id = req.user.id;
      // Allow them to filter their own history by room if requested
      if (room_id) filters.room_id = room_id;
    }

    const data = await requestService.listRequests(filters);
    return success(res, data);
  } catch (e) { next(e); }
};

const approveRequest = async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') throw Object.assign(new Error('Forbidden'), { status: 403 });
    
    const requestRow = await requestService.getRequest(req.params.id);
    if (requestRow.room_id && String(requestRow.room_id) !== String(req.user.room_id)) {
      return res.status(403).json({ message: 'Forbidden: Access restricted to your room' });
    }

    const data = await requestService.approveRequest(req.params.id);
    broadcast('request-updated', { id: req.params.id, status: 'APPROVED' });
    return success(res, data, 'Request approved');
  } catch (e) {
    console.error(`❌ Approval Error for Request #${req.params.id}:`, e.message);
    return res.status(e.status || 500).json({ success: false, message: e.message || 'Internal Server Error' });
  }
};

const rejectRequest = async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') throw Object.assign(new Error('Forbidden'), { status: 403 });

    const requestRow = await requestService.getRequest(req.params.id);
    if (String(requestRow.room_id) !== String(req.user.room_id)) {
      throw Object.assign(new Error('Forbidden'), { status: 403 });
    }

    const data = await requestService.rejectRequest(req.params.id);
    broadcast('request-updated', { id: req.params.id, status: 'REJECTED' });
    return success(res, data, 'Request rejected');
  } catch (e) { next(e); }
};

const issueRequest = async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') throw Object.assign(new Error('Forbidden'), { status: 403 });

    const { items, return_deadline } = req.body;
    const data = await requestService.issueRequest(req.params.id, items, return_deadline);
    return success(res, data, 'Request issued successfully');
  } catch (e) { next(e); }
};

const returnItemByBarcode = async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') throw Object.assign(new Error('Forbidden'), { status: 403 });

    const { barcode, condition, qtyReturned, requestId } = req.body;
    if (!barcode) return badRequest(res, "Barcode is required");

    const result = await requestService.returnItemByBarcode(barcode, condition, req.user.room_id, qtyReturned, requestId);

    broadcast('inventory-updated', { message: 'Item returned via barcode' });
    broadcast('request-updated', { id: result.requestId });

    return success(res, result, result.message);
  } catch (e) { next(e); }
};

const returnRequest = async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') throw Object.assign(new Error('Forbidden'), { status: 403 });

    const requestRow = await requestService.getRequest(req.params.id);
    if (String(requestRow.room_id) !== String(req.user.room_id)) {
      throw Object.assign(new Error('Forbidden: You may only operate on requests in your room'), { status: 403 });
    }

    const data = await requestService.returnRequest(req.params.id);
    broadcast('inventory-updated', { message: 'Full request returned' });
    return success(res, data, 'Items returned successfully');
  } catch (e) { next(e); }
};

const getCalendarEvents = async (req, res, next) => {
  try {
    let { room_id } = req.query;
    const db = require('../config/db');

    // 🚨 FIX: Only force the room_id override if the user is explicitly an ADMIN.
    // Faculty and Students are allowed to pass `room_id` in the query to view any room's calendar.
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
           'name', it.name, 'inventory_mode', it.inventory_mode, 'item_type', it.type, 'quantity', COALESCE(ri.qty_requested, ri.quantity, 1)
         )) FILTER (WHERE it.id IS NOT NULL) AS items
       FROM requests r
       LEFT JOIN rooms rm ON rm.id = r.room_id
       LEFT JOIN users u ON u.id::text = r.requester_id::text AND r.requester_type IN ('faculty', 'admin')
       LEFT JOIN students s ON (s.id::text = r.requester_id::text OR s.student_id::text = r.requester_id::text) AND r.requester_type = 'student'
       LEFT JOIN request_items ri ON ri.request_id = r.id AND ri.status NOT IN ('CANCELLED', 'RETURNED')
       LEFT JOIN inventory_types it ON it.id = ri.inventory_type_id
       WHERE r.room_id = $1 AND r.status IN ('PENDING', 'PENDING APPROVAL', 'APPROVED', 'ISSUED', 'PARTIALLY RETURNED')
         AND (r.pickup_start IS NOT NULL OR r.pickup_datetime IS NOT NULL OR r.issued_time IS NOT NULL OR r.scheduled_time IS NOT NULL)
       GROUP BY r.id, rm.code, u.name, s.full_name
       ORDER BY COALESCE(r.pickup_start, r.pickup_datetime, r.issued_time, r.scheduled_time) ASC`,
      [room_id]
    );

    return res.status(200).json({ success: true, data: rows });
  } catch (error) { next(error); }
};

module.exports = {
  createRequest, getRequest, getRequestByQR, listRequests, approveRequest,
  rejectRequest, issueRequest, returnItemByBarcode, returnRequest, getCalendarEvents,
};