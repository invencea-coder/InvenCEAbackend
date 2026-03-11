const rateLimit = require('express-rate-limit');

// Check if we are in development mode
const isDev = process.env.NODE_ENV === 'development';

const rateLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'), // 15 min
  // In dev mode, allow 5000. In production, default to 1000 (100 is far too low for an SPA)
  max: parseInt(process.env.RATE_LIMIT_MAX || (isDev ? '5000' : '1000')),
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later.' },
});

// Stricter limiter for auth routes (Login/OTP)
const authRateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 min
  // Relax auth limit slightly in dev mode so you don't lock yourself out while testing
  max: isDev ? 100 : 10, 
  message: { success: false, message: 'Too many auth attempts, please try again later.' },
});

module.exports = rateLimiter;
module.exports.authRateLimiter = authRateLimiter;