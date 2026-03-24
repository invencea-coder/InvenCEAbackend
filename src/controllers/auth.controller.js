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
const studentLogin = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return badRequest(res, 'Validation failed', errors.array());
    }

    // Extract exactly what the frontend is sending
    const { student_id, pin } = req.body; 
    
    // Pass those directly to your service
    const result = await authService.studentLogin(student_id, pin); 

    return success(res, result, 'Login successful');
  } catch (err) {
    next(err);
  }
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
  changeStudentPin,
  adminLogin,
  changePassword,
  logout,
  getMe,
};