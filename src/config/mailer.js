// src/config/mailer.js
const https  = require('https');
const logger = require('../utils/logger');

// ── Core send function (Brevo HTTP API — no SMTP, not blocked by Render) ──────
const sendMail = async ({ to, subject, html, text }) => {
  if (!process.env.BREVO_API_KEY) {
    logger.warn('BREVO_API_KEY not set — skipping email');
    return;
  }

  const body = JSON.stringify({
    sender:      { name: 'InvenCEA System', email: process.env.BREVO_SENDER_EMAIL || process.env.BREVO_USER },
    to:          [{ email: to }],
    subject,
    htmlContent: html,
    ...(text ? { textContent: text } : {}),
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.brevo.com',
      path:     '/v3/smtp/email',
      method:   'POST',
      headers:  {
        'api-key':        process.env.BREVO_API_KEY,
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          logger.info(`Email sent to ${to}: status=${res.statusCode}`);
          resolve(JSON.parse(data || '{}'));
        } else {
          const msg = (JSON.parse(data || '{}').message) || `HTTP ${res.statusCode}`;
          logger.error(`Failed to send email to ${to}: ${msg}`);
          reject(new Error(msg));
        }
      });
    });

    req.on('error', (err) => {
      logger.error(`Failed to send email to ${to}: ${err.message}`);
      reject(err);
    });

    req.setTimeout(10000, () => {
      req.destroy(new Error('Brevo API request timed out'));
    });

    req.write(body);
    req.end();
  });
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
