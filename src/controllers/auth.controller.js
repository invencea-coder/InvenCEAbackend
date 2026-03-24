const { validationResult } = require('express-validator');
const authService = require('../services/auth.service');
const { success, badRequest, unauthorized } = require('../utils/apiResponse');

/**
 * Faculty OTP - Send Code
 */
const sendOTP = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return badRequest(res, 'Validation failed', errors.array());
    }

    const { email } = req.body;
    const result = await authService.sendFacultyOTP(email);

    return success(res, result, 'OTP sent');
  } catch (err) {
    next(err);
  }
};

/**
 * Faculty OTP - Verify Code
 */
const verifyOTP = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return badRequest(res, 'Validation failed', errors.array());
    }

    const { email, code } = req.body;
    const result = await authService.verifyFacultyOTP(email, code);

    return success(res, result, 'Login successful');
  } catch (err) {
    next(err);
  }
};

/**
 * Student Login
 */
// ─── Student Auth ─────────────────────────────────────────────────────────────
const studentLogin = async (student_id, pin) => {
  const { rows } = await query(
    `SELECT id, full_name, student_id, department, pin_hash FROM students WHERE student_id = $1`,
    [student_id]
  );

  // 1. Strict Check: If they don't exist, block them.
  if (!rows.length) {
    throw Object.assign(new Error('Account not found. Please visit the System Manager to register.'), { status: 404 });
  } 

  const student = rows[0];

  // (The Name Check block has been completely removed from here!)

  // 2. PIN Check
  if (!student.pin_hash) {
      throw Object.assign(new Error('Your account requires a PIN setup. Please contact the System Manager.'), { status: 401 });
  }
  const match = await bcrypt.compare(pin, student.pin_hash);
  if (!match) {
      throw Object.assign(new Error('Invalid 4-Digit PIN'), { status: 401 });
  }

  // 3. Issue Token
  const token = jwt.sign(
    { id: student.id, role: 'student', name: student.full_name, student_id: student.student_id },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );

  return { token, user: { id: student.id, full_name: student.full_name, student_id: student.student_id, department: student.department, role: 'student' } };
};

/**
 * Student — Change PIN
 */
const changeStudentPin = async (req, res, next) => {
  try {
    const { current_pin, new_pin } = req.body;

    if (!current_pin || !new_pin) {
      return badRequest(res, 'Current PIN and New PIN are required.');
    }
    if (new_pin.length !== 4) {
      return badRequest(res, 'New PIN must be exactly 4 digits.');
    }

    await authService.changeStudentPin(req.user.id, current_pin, new_pin);

    return success(res, null, 'PIN updated successfully.');
  } catch (err) {
    next(err);
  }
};

/**
 * Admin Login
 */
const adminLogin = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return badRequest(res, 'Validation failed', errors.array());
    }

    const { email, password } = req.body;
    const result = await authService.adminLogin(email, password);

    return success(
      res,
      {
        token: result.token,
        user: result.user,
        needs_password_reset: result.user?.needs_password_reset ?? false,
      },
      'Login successful'
    );
  } catch (err) {
    next(err);
  }
};

/**
 * Admin — Change Password on First Login
 */
const changePassword = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return badRequest(res, 'Validation failed', errors.array());
    }

    const { current_password, new_password } = req.body;

    if (!current_password || !new_password) {
      return badRequest(res, 'current_password and new_password are required.');
    }

    if (new_password.length < 8) {
      return badRequest(res, 'New password must be at least 8 characters.');
    }

    await authService.changeAdminPassword(req.user.id, current_password, new_password);

    return success(res, null, 'Password updated successfully.');
  } catch (err) {
    next(err);
  }
};

/**
 * Logout
 */
const logout = async (_req, res) => {
  return success(res, null, 'Logged out');
};

/**
 * Get current authenticated user
 */
const getMe = async (req, res, next) => {
  try {
    if (!req.user) {
      return unauthorized(res, 'Not authenticated');
    }

    const user = await authService.getMe(req.user.id, req.user.role);

    return success(res, user, 'User retrieved');
  } catch (err) {
    next(err);
  }
};

module.exports = {
  sendOTP,
  verifyOTP,
  studentLogin,
  changeStudentPin, // <--- Exported here
  adminLogin,
  changePassword,
  logout,
  getMe,
};