// src/config/mailer.js
const axios  = require('axios');
const logger = require('../utils/logger');

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';

// ── Core send function (HTTP API — not blocked by Render) ─────────────────────
const sendMail = async ({ to, subject, html, text }) => {
  if (!process.env.BREVO_API_KEY) {
    logger.warn('BREVO_API_KEY not set — skipping email');
    return;
  }

  try {
    const payload = {
      sender:      { name: 'InvenCEA System', email: process.env.BREVO_SENDER_EMAIL || process.env.BREVO_USER },
      to:          [{ email: to }],
      subject,
      htmlContent: html,
    };
    if (text) payload.textContent = text;

    const res = await axios.post(BREVO_API_URL, payload, {
      headers: {
        'api-key':      process.env.BREVO_API_KEY,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    });

    logger.info(`Email sent to ${to}: messageId=${res.data?.messageId || res.status}`);
    return res.data;
  } catch (err) {
    const msg = err.response?.data?.message || err.message;
    logger.error(`Failed to send email to ${to}: ${msg}`);
    throw err;
  }
};

// ── Status Email Template ─────────────────────────────────────────────────────
const sendStatusEmail = async (email, request, status) => {
  if (!email) return;

  const isApproved = status === 'APPROVED';
  const color      = isApproved ? '#10b981' : '#ef4444';
  const title      = isApproved ? 'Request Approved!' : 'Request Denied';

  const html = `
    <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #eaeaea;
                border-top: 5px solid ${color}; border-radius: 8px; max-width: 600px;">
      <h2 style="color: ${color};">${title}</h2>
      <p>Hello,</p>
      <p>Your equipment request (<strong>#${request.id}</strong>) has been
         <strong>${status}</strong> by the administrator.</p>

      <div style="background-color: #f9fafb; padding: 15px; border-radius: 5px; margin: 20px 0;">
        <p style="margin: 0 0 10px 0;"><strong>Purpose:</strong> ${request.purpose || 'N/A'}</p>
        <p style="margin: 0;"><strong>Scheduled Deadline:</strong>
          ${request.return_deadline
            ? new Date(request.return_deadline).toLocaleString()
            : 'Walk-in / End of Day'}
        </p>
      </div>

      ${isApproved
        ? '<p>Please present your Kiosk QR code at the admin counter to claim your items.</p>'
        : '<p>Please contact your department admin if you have any questions regarding this rejection.</p>'}
      <br/>
      <p style="color: #666; font-size: 12px;">
        This is an automated message from the InvenCEA Inventory System.
      </p>
    </div>
  `;

  return sendMail({
    to:      email,
    subject: `InvenCEA Request #${request.id} — ${title}`,
    html,
  });
};

module.exports = { sendMail, sendStatusEmail };