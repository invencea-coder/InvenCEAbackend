// src/config/mailer.js
const logger = require('../utils/logger'); 

const sendMail = async ({ to, subject, html, text }) => {
  try {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': process.env.BREVO_API_KEY,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        sender: {
          name: 'InvenCEA System',
          email: process.env.EMAIL_USER // Must match your Brevo account email
        },
        to: [{ email: to }],
        subject: subject,
        htmlContent: html,
        textContent: text
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || 'Failed to send via Brevo API');
    }

    logger.info(`Email sent to ${to} via Brevo API: ${data.messageId}`);
    return data;
  } catch (err) {
    logger.error(`Failed to send email to ${to}: ${err.message}`);
    throw err;
  }
};

// --- NEW: Status Email Template ---
const sendStatusEmail = async (email, request, status) => {
  if (!email) return;

  const isApproved = status === 'APPROVED';
  const color = isApproved ? '#10b981' : '#ef4444'; 
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