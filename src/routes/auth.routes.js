const express = require('express');
const { body } = require('express-validator');
const router = express.Router();

const ctrl = require('../controllers/auth.controller');
const { authRateLimiter } = require('../middleware/rateLimiter');
const authMiddleware = require('../middleware/authMiddleware');

// Faculty OTP
router.post(
  '/faculty/send-otp',
  authRateLimiter,
  [body('email').isEmail().normalizeEmail()],
  ctrl.sendOTP
);

router.post(
  '/faculty/verify-otp',
  authRateLimiter,
  [
    body('email').isEmail().normalizeEmail(),
    body('code').isLength({ min: 6, max: 6 }).isNumeric(),
  ],
  ctrl.verifyOTP
);

// Student login
router.post(
  '/student/login',
  authRateLimiter,
  [
    body('full_name').notEmpty().trim(),
    body('student_id').notEmpty().trim(),
  ],
  ctrl.studentLogin
);

// Admin login
router.post(
  '/admin/login',
  authRateLimiter,
  [
    body('email').isEmail().normalizeEmail(),
    body('password').notEmpty().trim(),
  ],
  ctrl.adminLogin
);

// ✅ Authenticated route to get current user (FIXED: use authMiddleware.protect)
router.get('/me', authMiddleware.protect, ctrl.getMe);

module.exports = router;