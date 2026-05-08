// src/routes/auth.routes.js
const express = require('express');
const { body } = require('express-validator');
const router = express.Router();

const ctrl = require('../controllers/auth.controller');
const { authRateLimiter } = require('../middleware/rateLimiter');
const authMiddleware = require('../middleware/authMiddleware');

// 🚨 FIX: Create a wrapper that bypasses the strict auth rate limiter in development
const applyAuthLimiter = process.env.NODE_ENV === 'development' 
  ? (req, res, next) => next() 
  : authRateLimiter;

router.post(
  '/faculty/send-otp',
  applyAuthLimiter,
  [body('email').isEmail().toLowerCase()],  // just lowercase, no normalize
  ctrl.sendOTP
);

router.post(
  '/faculty/verify-otp',
  applyAuthLimiter,
  [
    body('email').isEmail().toLowerCase(),  // ← same as send-otp
    body('code').isLength({ min: 6, max: 6 }).isNumeric(),
  ],
  ctrl.verifyOTP
);

// Student login
router.post(
  '/student/login',
  applyAuthLimiter,
  [
    body('student_id').notEmpty().trim(),
    // Optional: add PIN validation here if you want express-validator to catch it early
    body('pin').isLength({ min: 4, max: 4 }).isNumeric().withMessage('PIN must be 4 digits'),
  ],
  ctrl.studentLogin
);

// Student - Change PIN
// Protected: must be an authenticated student
router.put(
  '/student/change-pin',
  authMiddleware.protect,
  ctrl.changeStudentPin
);

// Admin login
router.post(
  '/admin/login',
  applyAuthLimiter,
  [
    body('email').isEmail().normalizeEmail(),
    body('password').notEmpty().trim(),
  ],
  ctrl.adminLogin
);

// Admin — change password (first-login reset)
// Protected: must be authenticated; only admins will hit this in practice
router.post(
  '/change-password',
  authMiddleware.protect,
  [
    body('current_password').notEmpty().withMessage('Current password is required.'),
    body('new_password')
      .isLength({ min: 8 })
      .withMessage('New password must be at least 8 characters.'),
  ],
  ctrl.changePassword
);

// Get current authenticated user (session restore)
router.get('/me', authMiddleware.protect, ctrl.getMe);

// ⚡ ADDED: Logout route (Protected so it knows WHO is logging out)
router.post('/logout', authMiddleware.protect, ctrl.logout);

module.exports = router;