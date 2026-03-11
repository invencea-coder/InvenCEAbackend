// backend/src/controllers/room.controller.js
const { query } = require('../config/db');
const { success } = require('../utils/apiResponse');

const getRooms = async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM rooms ORDER BY code');
    return success(res, rows);
  } catch (err) {
    next(err);
  }
};

module.exports = { getRooms };