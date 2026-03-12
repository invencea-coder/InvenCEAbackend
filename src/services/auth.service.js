// backend/services/auth.service.js
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { query } = require('../config/db');
const { sendMail } = require('../config/mailer');
const logger = require('../utils/logger');

const OTP_EXPIRY = parseInt(process.env.OTP_EXPIRY_SECONDS || '120');

// ─── OTP Helpers ──────────────────────────────────────────────────────────────
const generateOTP = () => String(Math.floor(100000 + Math.random() * 900000));

// ─── Faculty & Manager Auth ───────────────────────────────────────────────────
const sendFacultyOTP = async (email) => {
  const { rows } = await query(
    `SELECT id, email, name, role FROM users WHERE email = $1 AND role IN ('faculty', 'manager')`,
    [email]
  );
  if (!rows.length) throw Object.assign(new Error('Account not found'), { status: 404 });

  const code = generateOTP();
  const expiresAt = new Date(Date.now() + OTP_EXPIRY * 1000);

  // Invalidate old OTPs
  await query(`UPDATE otp_codes SET used = TRUE WHERE user_email = $1 AND used = FALSE`, [email]);

  await query(
    `INSERT INTO otp_codes (user_email, code, expires_at) VALUES ($1, $2, $3)`,
    [email, code, expiresAt]
  );

  await sendMail({
    to: email,
    subject: 'InvenCEA — Your Login OTP',
    html: `
      <div style="font-family:sans-serif;max-width:400px">
        <h2 style="color:#1F4E79">InvenCEA Login</h2>
        <p>Hello ${rows[0].name},</p>
        <p>Your one-time password is:</p>
        <h1 style="letter-spacing:8px;color:#1F4E79">${code}</h1>
        <p>This OTP expires in <strong>${OTP_EXPIRY} seconds</strong>.</p>
        <p style="color:#999;font-size:12px">If you did not request this, please ignore.</p>
      </div>`,
  });

  logger.info(`OTP sent to ${email}`);
  return { message: 'OTP sent to email' };
};

const verifyFacultyOTP = async (email, code) => {
  // 1. Check OTP validity
  const { rows: otpRows } = await query(
    `SELECT * FROM otp_codes
     WHERE user_email = $1 AND code = $2 AND used = FALSE AND expires_at > now()
     ORDER BY created_at DESC LIMIT 1`,
    [email, code]
  );

  if (!otpRows.length) throw Object.assign(new Error('Invalid or expired OTP'), { status: 401 });

  // 2. Mark OTP as used
  await query(`UPDATE otp_codes SET used = TRUE WHERE id = $1`, [otpRows[0].id]);

  // 3. Get User Details
  const { rows: userRows } = await query(
    `SELECT id, email, name, role, room_id FROM users WHERE email = $1 AND role IN ('faculty', 'manager')`,
    [email]
  );
  if (!userRows.length) throw Object.assign(new Error('User not found'), { status: 404 });

  const user = userRows[0];

  // 4. Sign JWT Payload
  const token = jwt.sign(
    {
      id: user.id,
      role: user.role,
      email: user.email,
      name: user.name,
      room_id: user.room_id,
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );

  return { token, user };
};

// ─── Student Auth ─────────────────────────────────────────────────────────────
const studentLogin = async (full_name, student_id) => {
  let { rows } = await query(
    `SELECT id, full_name, student_id, department FROM students WHERE student_id = $1`,
    [student_id]
  );

  if (!rows.length) {
    const insert = await query(
      `INSERT INTO students (full_name, student_id) VALUES ($1, $2) RETURNING id, full_name, student_id`,
      [full_name, student_id]
    );
    rows = insert.rows;
  } else if (rows[0].full_name.toLowerCase() !== full_name.toLowerCase()) {
    throw Object.assign(new Error('Name does not match student ID'), { status: 401 });
  }

  const student = rows[0];
  const token = jwt.sign(
    { id: student.id, role: 'student', name: student.full_name, student_id: student.student_id },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );

  return { token, user: { ...student, role: 'student' } };
};

// ─── Admin Auth ───────────────────────────────────────────────────────────────
const adminLogin = async (email, password) => {
  const { rows } = await query(
    // Fetch needs_password_reset alongside the other fields
    `SELECT id, email, name, password_hash, role, room_id, needs_password_reset
     FROM users
     WHERE email = $1`,
    [email]
  );

  if (!rows.length) throw Object.assign(new Error('Invalid credentials'), { status: 401 });

  const user = rows[0];

  if (user.role !== 'admin') throw Object.assign(new Error('Not an administrator'), { status: 403 });
  if (!user.password_hash)   throw Object.assign(new Error('No password set for this account'), { status: 401 });

  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) throw Object.assign(new Error('Invalid credentials'), { status: 401 });

  const token = jwt.sign(
    {
      id: user.id,
      role: user.role,
      email: user.email,
      name: user.name,
      room_id: user.room_id,
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );

  return {
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      room_id: user.room_id,
      needs_password_reset: user.needs_password_reset ?? false,
    },
  };
};

// ─── Admin — Change Password ──────────────────────────────────────────────────
const changeAdminPassword = async (userId, currentPassword, newPassword) => {
  // 1. Fetch current hash
  const { rows } = await query(
    `SELECT password_hash FROM users WHERE id = $1 AND role = 'admin'`,
    [userId]
  );

  if (!rows.length) throw Object.assign(new Error('Admin account not found'), { status: 404 });
  if (!rows[0].password_hash) throw Object.assign(new Error('No password set for this account'), { status: 401 });

  // 2. Verify the current (temporary) password
  const match = await bcrypt.compare(currentPassword, rows[0].password_hash);
  if (!match) throw Object.assign(new Error('Current password is incorrect'), { status: 401 });

  // 3. Hash and save the new password, clear the reset flag in one query
  const SALT_ROUNDS = 12;
  const newHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

  await query(
    `UPDATE users
     SET password_hash = $1, needs_password_reset = FALSE
     WHERE id = $2`,
    [newHash, userId]
  );

  logger.info(`Admin ${userId} changed their password successfully.`);
};

// ─── Get current user info ────────────────────────────────────────────────────
const getMe = async (userId, role) => {
  if (role === 'student') {
    const { rows } = await query(
      `SELECT id, full_name, student_id, department FROM students WHERE id = $1`,
      [userId]
    );
    return rows[0] ? { ...rows[0], role: 'student' } : null;
  }

  const { rows } = await query(
    // Include needs_password_reset so session restores on page-refresh
    // preserve the gate correctly for admins
    `SELECT id, email, name, role, room_id, needs_password_reset FROM users WHERE id = $1`,
    [userId]
  );
  return rows[0] || null;
};

// ─── Export ───────────────────────────────────────────────────────────────────
module.exports = {
  sendFacultyOTP,
  verifyFacultyOTP,
  studentLogin,
  adminLogin,
  changeAdminPassword,
  getMe,
};
