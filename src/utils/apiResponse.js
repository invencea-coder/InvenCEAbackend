/**
 * Standardized API responses
 */

const success = (res, data = null, message = 'Success', statusCode = 200) => {
  return res.status(statusCode).json({ success: true, message, data });
};

const created = (res, data = null, message = 'Created') => {
  return success(res, data, message, 201);
};

const error = (res, message = 'An error occurred', statusCode = 500, errors = null) => {
  const payload = { success: false, message };
  if (errors) payload.errors = errors;
  return res.status(statusCode).json(payload);
};

const notFound = (res, message = 'Not found') => error(res, message, 404);
const forbidden = (res, message = 'Forbidden') => error(res, message, 403);
const unauthorized = (res, message = 'Unauthorized') => error(res, message, 401);
const badRequest = (res, message = 'Bad request', errors = null) => error(res, message, 400, errors);

module.exports = { success, created, error, notFound, forbidden, unauthorized, badRequest };
