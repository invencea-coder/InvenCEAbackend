const logger = require('../utils/logger');

// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
  logger.error(err);

  // Validation errors from express-validator
  if (err.type === 'validation') {
    return res.status(400).json({ success: false, message: 'Validation error', errors: err.errors });
  }

  // PostgreSQL unique violation
  if (err.code === '23505') {
    return res.status(409).json({ success: false, message: 'Duplicate entry: ' + (err.detail || '') });
  }

  // PostgreSQL foreign key violation
  if (err.code === '23503') {
    return res.status(400).json({ success: false, message: 'Invalid reference: ' + (err.detail || '') });
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }

  const status = err.status || err.statusCode || 500;
  const message = status < 500 ? err.message : 'Internal server error';

  return res.status(status).json({ success: false, message });
};

module.exports = errorHandler;
