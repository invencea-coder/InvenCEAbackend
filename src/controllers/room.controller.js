// backend/src/controllers/room.controller.js
const { query } = require('../config/db');
const { success, badRequest, notFound } = require('../utils/apiResponse');
const { broadcast } = require('../config/socket');

const getRooms = async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM rooms ORDER BY code');
    return success(res, rows);
  } catch (err) {
    next(err);
  }
};

const updateRoomAvailability = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { is_available, reason } = req.body;

    if (typeof is_available !== 'boolean') {
      return badRequest(res, 'is_available must be a boolean.');
    }

    const { rows } = await query(
      `UPDATE rooms
       SET is_available = $1,
           unavailable_reason = $2
       WHERE id = $3
       RETURNING *`,
      [is_available, is_available ? null : (reason || null), id]
    );

    if (!rows.length) return notFound(res, 'Room not found.');

    // Broadcast to all connected clients so NewRequest updates instantly
    broadcast('room-updated', {
      roomId: id,
      is_available: rows[0].is_available,
      reason: rows[0].unavailable_reason,
    });

    return success(res, rows[0], `Room marked as ${is_available ? 'available' : 'unavailable'}.`);
  } catch (err) {
    next(err);
  }
};

module.exports = { getRooms, updateRoomAvailability };
