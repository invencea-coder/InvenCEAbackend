const express = require('express');
const router = express.Router();

router.use('/auth', require('./auth.routes'));
router.use('/admin', require('./admin.routes'));
router.use('/inventory', require('./inventory.routes'));
router.use('/requests', require('./request.routes'));
router.use('/reports', require('./report.routes'));
router.use('/rooms', require('./room.routes')); // new

module.exports = router;