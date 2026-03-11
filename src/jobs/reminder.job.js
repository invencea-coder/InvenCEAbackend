const cron = require('node-cron');
const { query } = require('../config/db');
const notificationService = require('../services/notification.service');
const logger = require('../utils/logger');

const OVERDUE_HOURS = parseInt(process.env.REMINDER_OVERDUE_HOURS || '2');

/**
 * Send reminders for ISSUED requests that are overdue
 * Runs every hour
 */
const reminderJob = cron.schedule('0 * * * *', async () => {
  try {
    // Find requests ISSUED for longer than OVERDUE_HOURS with no return
    const { rows } = await query(`
      SELECT r.*, COALESCE(u.email, NULL) AS requester_email
      FROM requests r
      LEFT JOIN users u ON u.id = r.requester_id AND r.requester_type = 'faculty'
      WHERE r.status = 'ISSUED'
        AND r.issued_time < now() - INTERVAL '${OVERDUE_HOURS} hours'
    `);

    for (const req of rows) {
      await notificationService.createNotification({
        user_id: req.requester_id,
        email: req.requester_email || null,
        title: 'Overdue Item Reminder',
        message: `Request #${req.id} items are overdue for return. Please return them as soon as possible.`,
        event: 'reminder',
        userId: req.requester_id,
      });
    }

    if (rows.length > 0) {
      logger.info(`[Job] Sent ${rows.length} overdue reminders`);
    }
  } catch (err) {
    logger.error('[Job] reminder error:', err.message);
  }
}, { scheduled: false });

module.exports = reminderJob;
