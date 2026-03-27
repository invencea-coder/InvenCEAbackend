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

    const { room_id, purpose, items, companions, scheduled_time } = req.body;

    const data = await requestService.createRequest({
      requester_type: req.user.role,
      requester_id: req.user.id,
      requester_email: req.user.email,
      room_id,
      purpose,
      items,
      companions,
      scheduled_time,
    });

    // BROADCAST: Specific event for Admin global notifications
    broadcast('new-request', { 
      id: data.id, 
      room_id: data.room_id, 
      requester_type: req.user.role 
    });

    broadcast('inventory-updated', { message: 'New request created' });
    
    return created(res, data, 'Request created successfully');
  } catch (e) {
    next(e);
  }
};

const getRequest = async (req, res, next) => {
  try {
    const data = await requestService.getRequest(req.params.id);

    // Security: strict room-level access — the caller can only see requests for their own room
    if (String(data.room_id) !== String(req.user.room_id)) {
      // return 403
      throw Object.assign(new Error('Forbidden: Access restricted to your room'), { status: 403 });
    }

    return success(res, data);
  } catch (e) {
    next(e);
  }
};

const getRequestByQR = async (req, res, next) => {
  try {
    const data = await requestService.getRequestByQR(req.params.code);

    // Security: strict room-level access
    if (String(data.room_id) !== String(req.user.room_id)) {
      throw Object.assign(new Error('Forbidden: Access restricted to your room'), { status: 403 });
    }

    return success(res, data);
  } catch (e) {
    next(e);
  }
};

const listRequests = async (req, res, next) => {
  try {
    const { status, requester_type, requester_id } = req.query;

    const filters = {
      status,
      requester_type,
    };

    // SECURITY ENFORCEMENT:
    // If the caller is a student, FORCE the requester_id to be their own ID.
    // They cannot override this by sending a different ID in the query.
    if (req.user.role === 'student') {
      filters.requester_id = req.user.id;
      // Do not scope students by room_id, they can see their requests across all rooms
    } else {
      // If the caller is Faculty/Admin, enforce room scoping
      filters.room_id = req.user.room_id;
      // Admins/Faculty can filter by a specific student if they want
      filters.requester_id = requester_id; 
    }

    const data = await requestService.listRequests(filters);
    return success(res, data);
  } catch (e) {
    next(e);
  }
};

const approveRequest = async (req, res, next) => {
  try {
    const requestRow = await requestService.getRequest(req.params.id);
    
    // V2 Graceful Check: Allow approval if it belongs to your room
    if (requestRow.room_id && String(requestRow.room_id) !== String(req.user.room_id)) {
      return res.status(403).json({ message: 'Forbidden: Access restricted to your room' });
    }

    const data = await requestService.approveRequest(req.params.id);
    
    // BROADCAST: notify client to refresh
    broadcast('request-updated', { id: req.params.id, status: 'APPROVED' });
    
    return success(res, data, 'Request approved');
  } catch (e) {
    // Intercept the database error and send it cleanly to the frontend toast
    console.error(`❌ Approval Error for Request #${req.params.id}:`, e.message);
    return res.status(e.status || 500).json({ 
      success: false, 
      message: e.message || 'Internal Server Error' 
    });
  }
};

const rejectRequest = async (req, res, next) => {
  try {
    const requestRow = await requestService.getRequest(req.params.id);
    if (String(requestRow.room_id) !== String(req.user.room_id)) {
      throw Object.assign(new Error('Forbidden'), { status: 403 });
    }

    const data = await requestService.rejectRequest(req.params.id);
    
    // BROADCAST: notify client to refresh
    broadcast('request-updated', { id: req.params.id, status: 'REJECTED' });
    
    return success(res, data, 'Request rejected');
  } catch (e) {
    next(e);
  }
};

const issueRequest = async (req, res, next) => {
  try {
    // Verify the target request belongs to caller's room
    const requestRow = await requestService.getRequest(req.params.id);
    if (String(requestRow.room_id) !== String(req.user.room_id)) {
      throw Object.assign(new Error('Forbidden: You may only operate on requests in your room'), { status: 403 });
    }

    const itemsToIssue = Array.isArray(req.body)
      ? req.body
      : (req.body?.items || req.body?.adjustedItems);

    if (!itemsToIssue) return badRequest(res, "No items provided for issuance");

    const data = await requestService.issueRequest(req.params.id, itemsToIssue);
    await notificationService.notifyIssued(data);

    broadcast('request-issued', { requestId: data.id });
    broadcast('inventory-updated', { message: 'Items issued' });

    return success(res, data, 'Items issued successfully');
  } catch (e) {
    next(e);
  }
};

/**
 * returnItemByBarcode
 * - only allows returning items for requests that belong to the caller's room
 * - note: route is admin-only in routes, but this controller enforces room scoping regardless of role
 */
const returnItemByBarcode = async (req, res, next) => {
  try {
    const { barcode, condition, qtyReturned } = req.body;
    if (!barcode) return badRequest(res, "Barcode is required");

    // Pass caller's room id to the service so it can enforce ownership inside the transaction
    const result = await requestService.returnItemByBarcode(barcode, condition, req.user.room_id, qtyReturned);

    broadcast('inventory-updated', { message: 'Item returned via barcode' });
    broadcast('request-updated', { id: result.requestId });

    return success(res, result, result.message);
  } catch (e) {
    next(e);
  }
};

const returnRequest = async (req, res, next) => {
  try {
    // Enforce room ownership for bulk return
    const requestRow = await requestService.getRequest(req.params.id);
    if (String(requestRow.room_id) !== String(req.user.room_id)) {
      throw Object.assign(new Error('Forbidden: You may only operate on requests in your room'), { status: 403 });
    }

    const data = await requestService.returnRequest(req.params.id);
    broadcast('inventory-updated', { message: 'Full request returned' });
    return success(res, data, 'Items returned successfully');
  } catch (e) {
    next(e);
  }
};

/**
 * Get Calendar Events
 * Fetches scheduled requests for a specific room. 
 * Masks names if the user is a student.
 */
const getCalendarEvents = async (req, res, next) => {
  try {
    const { room_id } = req.query;
    if (!room_id) {
      return badRequest(res, 'room_id is required to view the calendar');
    }

    // Grab all active requests for this room that have a schedule
    const { rows } = await query(
      `SELECT 
        r.id, 
        r.purpose, 
        r.scheduled_time, 
        r.status,
        u.name as faculty_name,
        s.full_name as student_name
       FROM requests r
       LEFT JOIN users u ON r.user_id = u.id AND r.user_type = 'faculty'
       LEFT JOIN students s ON r.user_id = s.id AND r.user_type = 'student'
       WHERE r.room_id = $1 
         AND r.status IN ('PENDING', 'APPROVED', 'ISSUED')
         AND r.scheduled_time IS NOT NULL`,
      [room_id]
    );

    // Format the events for the frontend calendar
    const events = rows.map(row => {
      // Data Privacy: Mask the name if the user asking is a student
      const isStudentViewer = req.user.role === 'student';
      let title = isStudentViewer ? 'Reserved' : (row.faculty_name || row.student_name || 'User');
      
      // If admin/faculty, show the purpose too
      if (!isStudentViewer) {
        title = `${title} - ${row.purpose}`;
      }

      // We assume a standard 2-hour block if an end time isn't explicitly set in your DB yet
      const startDate = new Date(row.scheduled_time);
      const endDate = new Date(startDate.getTime() + (2 * 60 * 60 * 1000)); 

      return {
        id: row.id,
        title: title,
        start: startDate,
        end: endDate,
        status: row.status
      };
    });

    return success(res, events, 'Calendar events retrieved');
  } catch (err) {
    next(err);
  }
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
  getCalendarEvents,
};