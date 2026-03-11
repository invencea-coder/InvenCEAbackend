const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/report.controller');
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');

// Use protect middleware explicitly
router.use(authMiddleware.protect, roleMiddleware('admin'));

router.get('/issued', ctrl.getReports);
router.get('/export', ctrl.exportReports);
router.delete('/', ctrl.deleteReports);

module.exports = router;