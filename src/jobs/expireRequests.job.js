const cron = require('node-cron');
const { query } = require('../config/db');
const notificationService = require('../services/notification.service');
const logger = require('../utils/logger');

const EXPIRY_HOURS = parseInt(process.env.REQUEST_EXPIRY_HOURS || '24');

/**
 * Expire PENDING requests older than EXPIRY_HOURS
 * Runs every 15 minutes
 */
const expireRequestsJob = cron.schedule('*/15 * * * *', async () => {
  try {
    const { rows } = await query(`
      UPDATE requests
      SET status = 'EXPIRED'
      WHERE status = 'PENDING'
        AND requested_time < now() - INTERVAL '${EXPIRY_HOURS} hours'
      RETURNING *
    `);

    for (const req of rows) {
      await notificationService.notifyExpired(req);
    }

    if (rows.length > 0) {
      logger.info(`[Job] Expired ${rows.length} pending requests`);
    }
  } catch (err) {
    logger.error('[Job] expireRequests error:', err.message);
  }
}, { scheduled: false });

module.exports = expireRequestsJob;
