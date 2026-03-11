const express = require('express');
const router = express.Router();
const { getRooms } = require('../controllers/room.controller');
const authMiddleware = require('../middleware/authMiddleware');

// All authenticated users can view rooms
router.get('/', authMiddleware.protect, getRooms);

module.exports = router;