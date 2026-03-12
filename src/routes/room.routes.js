// backend/src/routes/room.routes.js
const express = require('express');
const router = express.Router();
const { getRooms, updateRoomAvailability } = require('../controllers/room.controller');
const authMiddleware = require('../middleware/authMiddleware');

// All authenticated users can view rooms
router.get('/', authMiddleware.protect, getRooms);

// Only admins can toggle room availability
router.put('/:id/availability', authMiddleware.protect, updateRoomAvailability);

module.exports = router;
