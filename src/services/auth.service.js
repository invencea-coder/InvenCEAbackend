// src/services/auth.service.js
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { query } = require('../config/db');
const { sendMail } = require('../config/mailer');
const logger = require('../utils/logger');

const OTP_EXPIRY = parseInt(process.env.OTP_EXPIRY_SECONDS || '120');

// ─── Audit Helper ─────────────────────────────────────────────────────────────
const logAuditAction = async (userId, name, role, action, ipAddress) => {
  try {
    await query(
      `INSERT INTO audit_logs (user_id, name, role, action, ip_address) VALUES ($1, $2, $3, $4, $5)`,
      [String(userId), name, role, action, ipAddress || 'Unknown']
    );
  } catch (err) {
    logger.error(`Failed to insert audit log: ${err.message}`);
  }
};

const generateOTP = () => String(Math.floor(100000 + Math.random() * 900000));

const sendFacultyOTP = async (email) => {
  const { rows } = await query(
    `SELECT id, email, name, role FROM users WHERE email = $1 AND role = 'faculty'`,
    [email]
  );
  if (!rows.length) throw Object.assign(new Error('Account not found'), { status: 404 });

  const code = generateOTP();
  const expiresAt = new Date(Date.now() + OTP_EXPIRY * 1000);

  await query(`UPDATE otp_codes SET used = TRUE WHERE user_email = $1 AND used = FALSE`, [email]);
  await query(`INSERT INTO otp_codes (user_email, code, expires_at) VALUES ($1, $2, $3)`, [email, code, expiresAt]);

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
  const currentTime = new Date();
  const { rows: otpRows } = await query(
    `SELECT * FROM otp_codes WHERE user_email = $1 AND code = $2 AND used = FALSE AND expires_at > $3 ORDER BY created_at DESC LIMIT 1`,
    [email, code, currentTime]
  );
  if (!otpRows.length) throw Object.assign(new Error('Invalid or expired OTP'), { status: 401 });

  await query(`UPDATE otp_codes SET used = TRUE WHERE id = $1`, [otpRows[0].id]);

  const { rows: userRows } = await query(`SELECT id, email, name, role, room_id FROM users WHERE email = $1 AND role = 'faculty'`, [email]);
  if (!userRows.length) throw Object.assign(new Error('User not found'), { status: 404 });

  const user = userRows[0];
  const token = jwt.sign({ id: user.id, role: user.role, email: user.email, name: user.name, room_id: user.room_id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });

  return { token, user };
};

const studentLogin = async (student_id, pin) => {
  const { rows } = await query(`SELECT id, full_name, student_id, department, pin_hash FROM students WHERE student_id = $1`, [student_id]);
  if (!rows.length) throw Object.assign(new Error('Account not found. Please visit the System Manager to register.'), { status: 404 });

  const student = rows[0];
  if (!student.pin_hash) throw Object.assign(new Error('Your account requires a PIN setup. Please contact the System Manager.'), { status: 401 });

  const match = await bcrypt.compare(pin, student.pin_hash);
  if (!match) throw Object.assign(new Error('Invalid 4-Digit PIN'), { status: 401 });

  // ⚡ FIX: Verify if the stored password corresponds to the default uninitialized credential profile string ('1234')
  const isDefaultPin = await bcrypt.compare('1234', student.pin_hash);

  const token = jwt.sign({ id: student.id, role: 'student', name: student.full_name, student_id: student.student_id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });

  return { 
    token, 
    user: { 
      id: student.id, 
      full_name: student.full_name, 
      student_id: student.student_id, 
      department: student.department, 
      role: 'student',
      is_default_pin: isDefaultPin // ⚡ FIX: Explicit parameter mapping to allow immediate client tracking checks
    } 
  };
};

const changeStudentPin = async (userId, currentPin, newPin) => {
  const { rows } = await query(`SELECT pin_hash FROM students WHERE id = $1`, [userId]);
  if (!rows.length) throw Object.assign(new Error('Student account not found'), { status: 404 });
  if (!rows[0].pin_hash) throw Object.assign(new Error('No PIN set for this account'), { status: 401 });

  const match = await bcrypt.compare(currentPin, rows[0].pin_hash);
  if (!match) throw Object.assign(new Error('Current PIN is incorrect'), { status: 401 });

  const SALT_ROUNDS = 10;
  const newHash = await bcrypt.hash(newPin, SALT_ROUNDS);

  await query(`UPDATE students SET pin_hash = $1 WHERE id = $2`, [newHash, userId]);
  logger.info(`Student ${userId} changed their PIN successfully.`);
};

const adminLogin = async (email, password) => {
  const { rows } = await query(
    `SELECT id, email, name, password_hash, role, room_id, needs_password_reset
     FROM users
     WHERE email = $1 AND role IN ('admin', 'manager', 'dean')`,
    [email]
  );
  if (!rows.length) throw Object.assign(new Error('Invalid credentials or unauthorized role'), { status: 401 });

  const user = rows[0];
  if (!user.password_hash) throw Object.assign(new Error('No password set for this account'), { status: 401 });

  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) throw Object.assign(new Error('Invalid credentials'), { status: 401 });

  const token = jwt.sign({ id: user.id, role: user.role, email: user.email, name: user.name, room_id: user.room_id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });

  return {
    token,
    user: { id: user.id, email: user.email, name: user.name, role: user.role, room_id: user.room_id, needs_password_reset: user.needs_password_reset ?? false },
  };
};

const changeAdminPassword = async (userId, currentPassword, newPassword) => {
  const { rows } = await query(`SELECT password_hash FROM users WHERE id = $1 AND role IN ('admin', 'manager', 'dean')`, [userId]);
  if (!rows.length) throw Object.assign(new Error('Account not found'), { status: 404 });
  if (!rows[0].password_hash) throw Object.assign(new Error('No password set for this account'), { status: 401 });

  const match = await bcrypt.compare(currentPassword, rows[0].password_hash);
  if (!match) throw Object.assign(new Error('Current password is incorrect'), { status: 401 });

  const SALT_ROUNDS = 12;
  const newHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

  await query(`UPDATE users SET password_hash = $1, needs_password_reset = FALSE WHERE id = $2`, [newHash, userId]);
  logger.info(`User ${userId} changed their password successfully.`);
};

const getMe = async (userId, role) => {
  if (role === 'student') {
    const { rows } = await query(`SELECT id, full_name, student_id, department FROM students WHERE id = $1`, [userId]);
    return rows[0] ? { ...rows[0], role: 'student' } : null;
  }
  const { rows } = await query(`SELECT id, email, name, role, room_id, needs_password_reset FROM users WHERE id = $1`, [userId]);
  return rows[0] || null;
};

module.exports = {
  sendFacultyOTP,
  verifyFacultyOTP,
  studentLogin,
  changeStudentPin,
  adminLogin,
  changeAdminPassword,
  getMe,
  logAuditAction 
};