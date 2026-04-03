// src/config/mailer.js
const https  = require('https');
const logger = require('../utils/logger');

// ── Core send function (Brevo HTTP API — SAFE FOR RENDER) ─────────────────────
const sendMail = async ({ to, subject, html, text }) => {
  if (!process.env.BREVO_API_KEY) {
    logger.warn('BREVO_API_KEY not set — skipping email');
    return;
  }

  const body = JSON.stringify({
    sender:      { name: 'InvenCEA Request System', email: process.env.BREVO_SENDER_EMAIL || 'noreply@invencea.com' },
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

// ── Status Email Template (Beautiful HTML with embedded QR) ───────────────────
const sendStatusEmail = async (email, request, status) => {
  if (!email) return;

  const isApproved = status === 'APPROVED';
  const themeColor = isApproved ? '#10b981' : '#ef4444';
  const title      = isApproved ? 'Equipment Request Approved' : 'Equipment Request Denied';
  
  // Format the pickup window gracefully
  let pickupText = 'Ready for immediate pickup (Walk-in)';
  if (request.pickup_start && request.pickup_end) {
    pickupText = `${new Date(request.pickup_start).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} - ${new Date(request.pickup_end).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`;
  } else if (request.pickup_datetime) {
    const start = new Date(request.pickup_datetime);
    const end = new Date(start.getTime() + 15 * 60000); // 15 min window
    pickupText = `${start.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} - ${end.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`;
  }

  // Use a reliable, fast external API to generate the QR code image on the fly
  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${request.qr_code || request.id}&margin=10`;

  const html = `
    <!DOCTYPE html>
    <html>
    <body style="margin: 0; padding: 0; background-color: #f3f4f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f3f4f6; padding: 40px 20px;">
        <tr>
          <td align="center">
            <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);">
              
              <tr>
                <td style="background-color: ${themeColor}; padding: 30px 20px; text-align: center;">
                  <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 800; letter-spacing: 0.5px;">${title}</h1>
                </td>
              </tr>

              <tr>
                <td style="padding: 40px 30px;">
                  <p style="margin: 0 0 20px 0; font-size: 16px; color: #374151; line-height: 1.5;">
                    Hello,
                  </p>
                  <p style="margin: 0 0 30px 0; font-size: 16px; color: #374151; line-height: 1.5;">
                    Your equipment request (<strong>#${request.id}</strong>) for <em>"${request.purpose || 'General Use'}"</em> has been 
                    <strong style="color: ${themeColor};">${status}</strong> by the administration.
                  </p>

                  <div style="background-color: #f9fafb; border: 1px solid #e5e7eb; border-radius: 12px; padding: 20px; margin-bottom: 30px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding-bottom: 10px;">
                          <p style="margin: 0; font-size: 11px; font-weight: bold; color: #6b7280; text-transform: uppercase; letter-spacing: 1px;">Your Pickup Window</p>
                          <p style="margin: 4px 0 0 0; font-size: 15px; font-weight: 600; color: #111827;">${pickupText}</p>
                        </td>
                      </tr>
                    </table>
                  </div>

                  ${isApproved ? `
                  <div style="text-align: center; margin-top: 10px;">
                    <p style="margin: 0 0 15px 0; font-size: 14px; font-weight: 600; color: #374151;">Present this QR code at the counter to claim your items:</p>
                    <div style="display: inline-block; padding: 15px; background-color: #ffffff; border: 2px solid #e5e7eb; border-radius: 16px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
                      <img src="${qrCodeUrl}" alt="Request QR Code" width="200" height="200" style="display: block; margin: 0 auto; border: none;" />
                    </div>
                  </div>
                  ` : `
                  <div style="background-color: #fef2f2; border-left: 4px solid #ef4444; padding: 15px; margin-top: 20px;">
                    <p style="margin: 0; font-size: 14px; color: #991b1b;">Please contact your department administrator or professor if you have any questions regarding this denied request.</p>
                  </div>
                  `}
                </td>
              </tr>

              <tr>
                <td style="background-color: #f9fafb; padding: 20px; text-align: center; border-top: 1px solid #e5e7eb;">
                  <p style="margin: 0; font-size: 12px; color: #6b7280;">
                    This is an automated message from the <strong>InvenCEA Equipment System</strong>.<br/>
                    Please do not reply directly to this email.
                  </p>
                </td>
              </tr>

            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;

  return sendMail({
    to:      email,
    subject: `InvenCEA Request #${request.id} — ${title}`,
    html,
  });
};

module.exports = { sendMail, sendStatusEmail };