// backend/src/controllers/manager.controller.js
const bcrypt = require('bcrypt');
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
      rooms: parseInt(roomStats[0].total_rooms),
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
    const { email, name, role, room_id, password } = req.body;

    if (!email || !name || !role) {
      return badRequest(res, 'Email, name, and role are required.');
    }

    if (role !== 'admin' && role !== 'faculty') {
      return badRequest(res, 'Invalid role. Must be admin or faculty.');
    }

    if (role === 'admin' && !room_id) {
      return badRequest(res, 'Admins must be assigned to a specific room_id.');
    }

    if (role === 'admin' && !password) {
      return badRequest(res, 'A temporary password is required when provisioning an admin.');
    }

    // Hash the password for admin accounts; faculty use OTP so no password needed
    let hashedPassword = null;
    if (role === 'admin') {
      const SALT_ROUNDS = 12;
      hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
    }

    // Insert the new user — admins get a hashed password and must reset on first login
    const { rows } = await query(
      `INSERT INTO users (email, name, role, room_id, password_hash, needs_password_reset)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, email, name, role, room_id, needs_password_reset, created_at`,
      [
        email,
        name,
        role,
        role === 'admin' ? room_id : null,
        hashedPassword,
        role === 'admin' ? true : false,
      ]
    );

    // Send Welcome Email
    try {
      const roleTitle = role === 'admin' ? 'Laboratory Administrator' : 'Faculty Member';
      const adminPasswordNote =
        role === 'admin'
          ? `<p>Your temporary password is: <strong>${password}</strong></p>
             <p style="color:#800000"><strong>You will be required to change this password on your first login.</strong></p>`
          : `<p>You can log in using the One-Time Password (OTP) sent to this email address.</p>`;

      await sendMail({
        to: email,
        subject: `InvenCEA — ${roleTitle} Account Created`,
        html: `
          <div style="font-family:sans-serif;max-width:400px">
            <h2 style="color:#800000">Welcome to InvenCEA</h2>
            <p>Hello ${name},</p>
            <p>Your <strong>${roleTitle}</strong> account has been provisioned by the System Manager.</p>
            ${adminPasswordNote}
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

    // Prevent the manager from deleting themselves
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
  removeUser,
};
