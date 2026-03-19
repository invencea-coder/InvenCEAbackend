const rateLimit = require('express-rate-limit');

const isDev = process.env.NODE_ENV === 'development';

// ── General limiter (all routes) ──────────────────────────────────────────────
const rateLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'), // 15 min
  max: parseInt(process.env.RATE_LIMIT_MAX || (isDev ? '5000' : '1000')),
  standardHeaders: true,
  legacyHeaders: false,
  // Never rate-limit session restoration — it fires on every page load
  skip: (req) => req.path === '/api/v1/auth/me' || req.path.endsWith('/auth/me'),
  message: { success: false, message: 'Too many requests, please try again later.' },
});

// ── Auth limiter — ONLY for actual login and OTP submission ───────────────────
// DO NOT apply this to /auth/me — that is session restore, not a login attempt.
// Routes to apply this to:
//   POST /auth/admin/login
//   POST /auth/student/login
//   POST /auth/otp/send
//   POST /auth/otp/verify
const authRateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 min
  max: isDev ? 500 : 20,     // raised prod limit to 20 — 10 was too low for shared lab PCs
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Exempt session restore and change-password (not brute-force targets)
    const exempt = ['/auth/me', '/auth/change-password'];
    return exempt.some(p => req.path.includes(p));
  },
  message: { success: false, message: 'Too many login attempts, please try again in 10 minutes.' },
});

module.exports = rateLimiter;
module.exports.authRateLimiter = authRateLimiter;