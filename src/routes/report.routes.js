const express = require('express');
const router = express.Router();

// 1. Import the controller correctly as reportCtrl
const reportCtrl = require('../controllers/report.controller');

// 2. Import only the specific middleware functions you need
const { protect, authorize } = require('../middleware/authMiddleware');

// 3. (REMOVED the global router.use() that was blocking Deans and Managers)

// 4. Define the routes with the correct authorization array for all 3 roles
router.get('/issued', protect, authorize('admin', 'manager', 'dean'), reportCtrl.getReports);
router.get('/export', protect, authorize('admin', 'manager', 'dean'), reportCtrl.exportReports);
router.delete('/',    protect, authorize('admin', 'manager', 'dean'), reportCtrl.deleteReports);

module.exports = router;