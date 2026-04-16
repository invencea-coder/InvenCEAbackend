// src/routes/request.routes.js
const express = require('express');
const { body } = require('express-validator');
const router = express.Router();
const ctrl = require('../controllers/request.controller');
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC ROUTES (No login required)
// ─────────────────────────────────────────────────────────────────────────────

router.get('/qr/public/:code', async (req, res, next) => {
  try {
    const { code } = req.params;
    const requestService = require('../services/request.service');
    const { success } = require('../utils/apiResponse');

    // getRequestByQR already handles both QR string and numeric ID lookup.
    const data = await requestService.getRequestByQR(code);

    // Scrub any sensitive fields before sending to the public kiosk
    const safeData = {
      id:              data.id,
      status:          data.status,
      requester_type:  data.requester_type,
      requester_name:  data.requester_name  || null,
      room_code:       data.room_code       || null,
      created_at:      data.created_at,
      return_deadline: data.return_deadline || null,
      items: (data.items || []).map(i => ({
        item_name:              i.item_name,
        quantity:               i.quantity,
        item_status:            i.item_status || i.status || null,
        inventory_item_barcode: i.inventory_item_barcode || null,
      })),
      members: (data.members || []).map(m => ({
        full_name:  m.full_name,
        student_id: m.student_id,
      })),
    };

    return success(res, safeData);
  } catch (e) {
    next(e);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PROTECTED ROUTES (Authentication Required)
// ─────────────────────────────────────────────────────────────────────────────
router.use(authMiddleware.protect);

// 🔥 CRITICAL FIX: Static routes MUST go before the dynamic parameter routes (/:id)
router.get('/calendar', ctrl.getCalendarEvents); 
router.get('/qr/:code', ctrl.getRequestByQR);
router.get('/', ctrl.listRequests);

// Create request 
router.post(
  '/',
  [
    body('items').isArray({ min: 1 }).withMessage('At least one item is required'),
    body('items.*.inventory_type_id').isInt(),
    body('items.*.consumable_id').optional({ nullable: true }).isInt(),
    body('items.*.stock_id').optional({ nullable: true }).isInt(),
    body('items.*.qty_requested').optional().isInt({ min: 1 }),
    body('items.*.quantity').optional().isInt({ min: 1 }),
    body('borrower_id').optional().isString(), // Allows Admin to log on behalf of student
    body('scheduled_time').optional().isISO8601(),
  ],
  ctrl.createRequest
);

// 🔥 Dynamic ID route MUST go LAST among the GET routes!
router.get('/:id', ctrl.getRequest);

// ⚡ ADDED CANCELLATION ROUTE HERE ⚡
// Students/Faculty can cancel their own requests, Admins can cancel any
router.put('/:id/cancel', ctrl.cancelRequest);

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN-ONLY ROUTES
// ─────────────────────────────────────────────────────────────────────────────
router.put('/:id/approve', roleMiddleware('admin'), ctrl.approveRequest);
router.put('/:id/reject', roleMiddleware('admin'), ctrl.rejectRequest);
router.put('/:id/issue', roleMiddleware('admin'), ctrl.issueRequest);

// Barcode Return Route
router.post('/return-barcode', roleMiddleware('admin'), ctrl.returnItemByBarcode);

// Legacy Manual Return
router.put('/:id/return', roleMiddleware('admin'), ctrl.returnRequest);

module.exports = router;