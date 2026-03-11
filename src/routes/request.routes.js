// src/routes/request.routes.js
const express = require('express');
const { body } = require('express-validator');
const router = express.Router();
const ctrl = require('../controllers/request.controller');
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');


router.get('/public/qr-status/:code', async (req, res, next) => {
  try {
    const { code } = req.params;
    // Reuse your existing getRequestByQR logic, but perhaps scrub sensitive data if needed
    const result = await require('../controllers/request.controller').getRequestByQR(req, res, next);
    // Note: If your controller calls `res.json()`, it will handle the response itself.
  } catch (err) {
    next(err);
  }
});
// Protect all routes – authentication required
router.use(authMiddleware.protect);

// QR lookup
router.get('/qr/:code', ctrl.getRequestByQR);

// Create request 
router.post(
  '/',
  [
    body('items').isArray({ min: 1 }).withMessage('At least one item is required'),
    body('items.*.inventory_type_id').isInt(),
    body('items.*.consumable_id').optional({ nullable: true }).isInt(),
    body('items.*.quantity').optional().isInt({ min: 1 }),
    body('companions').optional().isArray(),
    body('companions.*.student_id').isString().notEmpty(),
    // Added validation for the new start/end times
    body('companions.*.start_time').optional({ nullable: true }).isISO8601(),
    body('companions.*.end_time').optional({ nullable: true }).isISO8601(),
    body('scheduled_time').optional().isISO8601(),
  ],
  ctrl.createRequest
);

router.get('/', ctrl.listRequests);
router.get('/:id', ctrl.getRequest);

// Admin-only actions
router.put('/:id/approve', roleMiddleware('admin'), ctrl.approveRequest);
router.put('/:id/reject', roleMiddleware('admin'), ctrl.rejectRequest);
router.put('/:id/issue', roleMiddleware('admin'), ctrl.issueRequest);

// --- NEW: Barcode Return Route ---
router.post('/return-barcode', roleMiddleware('admin'), ctrl.returnItemByBarcode);

// Legacy Manual Return
router.put('/:id/return', roleMiddleware('admin'), ctrl.returnRequest);

module.exports = router;