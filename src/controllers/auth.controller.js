const { validationResult } = require('express-validator');
const authService = require('../services/auth.service');
const { success, badRequest, unauthorized } = require('../utils/apiResponse');

const sendOTP = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return badRequest(res, 'Validation failed', errors.array());

    const { email } = req.body;
    const result = await authService.sendFacultyOTP(email);
    return success(res, result, 'OTP sent');
  } catch (err) { next(err); }
};

const verifyOTP = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return badRequest(res, 'Validation failed', errors.array());

    const { email, code } = req.body;
    const result = await authService.verifyFacultyOTP(email, code);

    // ⚡ ADDED: Audit Logging
    await authService.logAuditAction(result.user.id, result.user.name, result.user.role, 'LOGIN', req.ip);

    return success(res, result, 'Login successful');
  } catch (err) { next(err); }
};

const studentLogin = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return badRequest(res, 'Validation failed', errors.array());

    const { student_id, pin } = req.body; 
    const result = await authService.studentLogin(student_id, pin); 

    // ⚡ ADDED: Audit Logging
    await authService.logAuditAction(result.user.student_id, result.user.full_name, 'student', 'LOGIN', req.ip);

    return success(res, result, 'Login successful');
  } catch (err) { next(err); }
};

const changeStudentPin = async (req, res, next) => {
  try {
    const { current_pin, new_pin } = req.body;
    if (!current_pin || !new_pin) return badRequest(res, 'Current PIN and New PIN are required.');
    if (new_pin.length !== 4) return badRequest(res, 'New PIN must be exactly 4 digits.');

    await authService.changeStudentPin(req.user.id, current_pin, new_pin);
    return success(res, null, 'PIN updated successfully.');
  } catch (err) { next(err); }
};

const adminLogin = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return badRequest(res, 'Validation failed', errors.array());

    const { email, password } = req.body;
    const result = await authService.adminLogin(email, password);

    // ⚡ ADDED: Audit Logging
    await authService.logAuditAction(result.user.id, result.user.name, result.user.role, 'LOGIN', req.ip);

    return success(res, {
        token: result.token,
        user: result.user,
        needs_password_reset: result.user?.needs_password_reset ?? false,
      }, 'Login successful');
  } catch (err) { next(err); }
};

const changePassword = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return badRequest(res, 'Validation failed', errors.array());

    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) return badRequest(res, 'current_password and new_password are required.');
    if (new_password.length < 8) return badRequest(res, 'New password must be at least 8 characters.');

    await authService.changeAdminPassword(req.user.id, current_password, new_password);
    return success(res, null, 'Password updated successfully.');
  } catch (err) { next(err); }
};

const logout = async (req, res) => {
  // ⚡ ADDED: Audit Logging for Logout
  if (req.user) {
    const userId = req.user.role === 'student' ? req.user.student_id : req.user.id;
    const name = req.user.name || req.user.full_name || 'Unknown';
    await authService.logAuditAction(userId, name, req.user.role, 'LOGOUT', req.ip);
  }
  return success(res, null, 'Logged out');
};

const getMe = async (req, res, next) => {
  try {
    if (!req.user) return unauthorized(res, 'Not authenticated');
    const user = await authService.getMe(req.user.id, req.user.role);
    return success(res, user, 'User retrieved');
  } catch (err) { next(err); }
};

module.exports = {
  sendOTP, verifyOTP, studentLogin, changeStudentPin, adminLogin, changePassword, logout, getMe,
};