// src/utils/mailer.js
const nodemailer = require('nodemailer');
const logger = require('../utils/logger'); // Adjust path if logger is in the same folder, or '../utils/logger'

let transporter;

const getTransporter = () => {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      // ✅ FIX 1: Force Port 465 for cloud deployments
      port: parseInt(process.env.SMTP_PORT || '465'), 
      // ✅ FIX 2: Secure must be TRUE for port 465
      secure: true, 
      auth: {
        // ✅ FIX 3: Fallbacks just in case Render variables are named differently
        user: process.env.GMAIL_USER || process.env.EMAIL_USER,
        pass: process.env.GMAIL_PASS || process.env.EMAIL_PASS,
      },
      tls: {
        rejectUnauthorized: false, 
      },
      // ✅ FIX 4: Explicit timeouts (10 seconds) so the server doesn't hang indefinitely
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    });
  }
  return transporter;
};

const sendMail = async ({ to, subject, html, text }) => {
  try {
    const fromEmail = process.env.GMAIL_USER || process.env.EMAIL_USER;
    const info = await getTransporter().sendMail({
      from: `"InvenCEA" <${fromEmail}>`,
      to,
      subject,
      html,
      text,
    });
    logger.info(`Email sent to ${to}: ${info.messageId}`);
    return info;
  } catch (err) {
    logger.error(`Failed to send email to ${to}: ${err.message}`);
    throw err;
  }
};

// --- NEW: Status Email Template ---
const sendStatusEmail = async (email, request, status) => {
  if (!email) return;

  const isApproved = status === 'APPROVED';
  const color = isApproved ? '#10b981' : '#ef4444'; // Green or Red
  const title = isApproved ? 'Request Approved!' : 'Request Denied';

  const html = `
    <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #eaeaea; border-top: 5px solid ${color}; border-radius: 8px; max-width: 600px;">
      <h2 style="color: ${color};">${title}</h2>
      <p>Hello,</p>
      <p>Your equipment request (<strong>#${request.id}</strong>) has been <strong>${status}</strong> by the administrator.</p>
      
      <div style="background-color: #f9fafb; padding: 15px; border-radius: 5px; margin: 20px 0;">
        <p style="margin: 0 0 10px 0;"><strong>Purpose:</strong> ${request.purpose || 'N/A'}</p>
        <p style="margin: 0;"><strong>Scheduled Deadline:</strong> ${request.return_deadline ? new Date(request.return_deadline).toLocaleString() : 'Walk-in / End of Day'}</p>
      </div>

      ${isApproved ? '<p>Please present your Kiosk QR code at the admin counter to claim your items.</p>' : '<p>Please contact your department admin if you have any questions regarding this rejection.</p>'}
      <br/>
      <p style="color: #666; font-size: 12px;">This is an automated message from the InvenCEA Inventory System.</p>
    </div>
  `;

  return sendMail({
    to: email,
    subject: `InvenCEA Request #${request.id} - ${title}`,
    html
  });
};

module.exports = { sendMail, sendStatusEmail };