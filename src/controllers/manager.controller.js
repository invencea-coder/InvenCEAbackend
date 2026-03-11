// backend/src/controllers/manager.controller.js
const { query } = require('../config/db');
const { success, badRequest, notFound } = require('../utils/apiResponse');
const { sendMail } = require('../config/mailer');

// ── Dashboard Stats ────────────────────────────────────────────────────────

const getManagerStats = async (req, res, next) => {
  try {
    const { rows: userStats } = await query(`
      SELECT 
        COUNT(*) FILTER (WHERE role = 'admin') AS total_admins,
        COUNT(*) FILTER (WHERE role = 'faculty') AS total_faculty
      FROM users
    `);
    
    const { rows: roomStats } = await query(`SELECT COUNT(*) AS total_rooms FROM rooms`);

    return success(res, {
      admins: parseInt(userStats[0].total_admins),
      faculty: parseInt(userStats[0].total_faculty),
      rooms: parseInt(roomStats[0].total_rooms)
    });
  } catch (e) { next(e); }
};

// ── User Management ───────────────────────────────────────────────────────

const getAllSystemUsers = async (req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT u.id, u.email, u.name, u.role, u.room_id, r.name AS room_name, r.code AS room_code, u.created_at 
      FROM users u
      LEFT JOIN rooms r ON r.id = u.room_id
      WHERE u.role IN ('admin', 'faculty', 'manager')
      ORDER BY u.role, u.name
    `);
    return success(res, rows);
  } catch (e) { next(e); }
};

const provisionUser = async (req, res, next) => {
  try {
    const { email, name, role, room_id } = req.body;

    if (!email || !name || !role) {
      return badRequest(res, 'Email, name, and role are required.');
    }

    if (role !== 'admin' && role !== 'faculty') {
      return badRequest(res, 'Invalid role. Must be admin or faculty.');
    }

    if (role === 'admin' && !room_id) {
      return badRequest(res, 'Admins must be assigned to a specific room_id.');
    }

    // Insert the new user
    const { rows } = await query(
      `INSERT INTO users (email, name, role, room_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, name, role, room_id, created_at`,
      [email, name, role, role === 'admin' ? room_id : null]
    );

    // Send Welcome Email
    try {
      const roleTitle = role === 'admin' ? 'Laboratory Administrator' : 'Faculty Member';
      await sendMail({
        to: email,
        subject: `InvenCEA — ${roleTitle} Account Created`,
        html: `
          <div style="font-family:sans-serif;max-width:400px">
            <h2 style="color:#800000">Welcome to InvenCEA</h2>
            <p>Hello ${name},</p>
            <p>Your <strong>${roleTitle}</strong> account has been provisioned by the System Manager.</p>
            <p>You can now log in to the system using the One-Time Password (OTP) sent to this email address.</p>
          </div>`,
      });
    } catch (mailErr) {
      console.warn('Welcome email failed:', mailErr.message);
    }

    return success(res, rows[0], `${role} account provisioned successfully.`);
  } catch (e) {
    if (e.code === '23505') return badRequest(res, 'A user with this email already exists.');
    next(e);
  }
};

const removeUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    
    // Prevent the manager from deleting themselves!
    if (String(id) === String(req.user.id)) {
      return badRequest(res, 'You cannot delete your own manager account.');
    }

    const { rows } = await query(
      `DELETE FROM users WHERE id = $1 AND role IN ('admin', 'faculty') RETURNING id`,
      [id]
    );

    if (!rows.length) return notFound(res, 'User not found or cannot be deleted.');
    return success(res, null, 'User securely removed from the system.');
  } catch (e) { next(e); }
};

module.exports = {
  getManagerStats,
  getAllSystemUsers,
  provisionUser,
  removeUser
};