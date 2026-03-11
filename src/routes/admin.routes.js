const express = require('express');
const { body } = require('express-validator');
const router = express.Router();
const ctrl = require('../controllers/admin.controller');
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');

// ==========================================
// 🔓 SHARED ROUTES (All Logged-in Users)
// ==========================================
// Placed ABOVE the admin middleware so Students/Faculty can load the dropdown!
router.get('/rooms', authMiddleware.protect, ctrl.getRooms);

// ==========================================
// 🔒 STRICT ADMIN ROUTES
// ==========================================
// The Bouncer: Everything below this line REQUIRES the 'admin' role
router.use(authMiddleware.protect, roleMiddleware('admin'));
router.post('/requests/retroactive', ctrl.logRetroactiveRequest);

// Dashboard
router.get('/dashboard/stats', ctrl.getDashboardStats);
router.get('/dashboard/recent', ctrl.getRecentRequests);

// Faculty management
router.post('/faculty', [
  body('email').isEmail().normalizeEmail(),
  body('name').notEmpty().trim(),
], ctrl.addFaculty);
router.get('/faculty', ctrl.getFaculty);

// Rooms (Admin Actions)
router.put('/rooms/:id/availability', [
  body('is_available').isBoolean(),
], ctrl.setRoomAvailability);

// Reports
router.get('/reports', ctrl.getReports);
router.post('/reports/export', ctrl.exportReports);
router.delete('/reports', ctrl.deleteReports);

// 🔁 Mount inventory routes under /admin/inventory
router.use('/inventory', require('./inventory.routes'));

module.exports = router;