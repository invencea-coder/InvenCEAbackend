const { forbidden } = require('../utils/apiResponse');

/**
 * Restrict route to specific roles
 * Usage: roleMiddleware('admin') or roleMiddleware('admin', 'faculty')
 */
const roleMiddleware = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) return forbidden(res, 'Not authenticated');
    if (!allowedRoles.includes(req.user.role)) {
      return forbidden(res, `Access denied. Required role: ${allowedRoles.join(' or ')}`);
    }
    next();
  };
};

module.exports = roleMiddleware;
