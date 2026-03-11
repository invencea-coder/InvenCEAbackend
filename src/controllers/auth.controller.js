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
    // should return { token, user }

    return success(res, result, 'Login successful');
  } catch (err) {
    next(err);
  }
};

/**
 * Student Login
 */
const studentLogin = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return badRequest(res, 'Validation failed', errors.array());
    }

    const { full_name, student_id } = req.body;

    const result = await authService.studentLogin(full_name, student_id);
    // should return { token, user }

    return success(res, result, 'Login successful');
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
    // must return { token, user }

    return success(res, result, 'Login successful');
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
 * Used by frontend session restoration
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
  adminLogin,
  logout,
  getMe
};