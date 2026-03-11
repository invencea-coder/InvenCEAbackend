const { query } = require('../config/db');
const { sendMail } = require('../config/mailer');
const { emitToUser } = require('../config/socket');
const logger = require('../utils/logger');

/**
 * Persist a notification record + optionally send email + emit socket event
 */
const createNotification = async ({ user_id, email, title, message, event, userId }) => {
  // Persist to DB
  try {
    await query(
      `INSERT INTO notifications (user_id, email, title, message) VALUES ($1, $2, $3, $4)`,
      [user_id || null, email || null, title, message]
    );
  } catch (e) {
    logger.warn('Failed to persist notification:', e.message);
  }

  // Send email if address known
  if (email) {
    sendMail({
      to: email,
      subject: `InvenCEA — ${title}`,
      html: `<div style="font-family:sans-serif"><h3>${title}</h3><p>${message}</p></div>`,
    }).catch((e) => logger.warn('Notification email failed:', e.message));
  }

  // Socket push
  if (userId && event) {
    emitToUser(userId, event, { title, message });
  }
};

const notifyApproved = async (req) => {
  let email = null;
  let userId = req.requester_id;

  if (req.requester_type === 'faculty') {
    const { rows } = await query(`SELECT email, name FROM users WHERE id = $1`, [req.requester_id]);
    if (rows.length) email = rows[0].email;
  }

  await createNotification({
    user_id: req.requester_id,
    email,
    title: 'Request Approved',
    message: `Your request #${req.id} has been approved.`,
    event: 'request-approved',
    userId,
  });
};

const notifyIssued = async (req) => {
  let email = null;
  if (req.requester_type === 'faculty') {
    const { rows } = await query(`SELECT email FROM users WHERE id = $1`, [req.requester_id]);
    if (rows.length) email = rows[0].email;
  }

  await createNotification({
    user_id: req.requester_id,
    email,
    title: 'Items Issued',
    message: `Items for request #${req.id} have been issued.`,
    event: 'request-issued',
    userId: req.requester_id,
  });
};

const notifyExpired = async (req) => {
  await createNotification({
    user_id: req.requester_id,
    title: 'Request Expired',
    message: `Request #${req.id} has expired due to inactivity.`,
    event: 'request-expired',
    userId: req.requester_id,
  });
};

module.exports = { createNotification, notifyApproved, notifyIssued, notifyExpired };
