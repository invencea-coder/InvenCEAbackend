// src/jobs/labSessionNotifier.js
// Add this to your existing background jobs initializer

const cron    = require('node-cron');
const logger  = require('../utils/logger');
const { sendMail } = require('../config/mailer');
const labSessionService = require('../services/labSession.service');

// io instance must be passed in from server.js
const initLabSessionNotifier = (io) => {

  // ── Every minute: check sessions ending in ~10 minutes ───────────────────
  cron.schedule('* * * * *', async () => {
    try {
      const sessions = await labSessionService.getSessionsDueSoon(10);
      if (!sessions.length) return;

      for (const session of sessions) {
        const endTime = new Date(session.end_time).toLocaleTimeString('en-PH', {
          hour: '2-digit', minute: '2-digit', hour12: true,
          timeZone: 'Asia/Manila',
        });

        // 1. Socket: notify kiosk screens (student-facing)
        io.emit('session-due-soon', {
          session_id:   session.id,
          code:         session.code,
          purpose:      session.purpose,
          end_time:     session.end_time,
          room_name:    session.room_name,
          room_id:      session.room_id, // ⚡ ADDED: So frontend can filter by room!
          faculty_name: session.faculty_name,
          claimants:    session.claimants?.filter(Boolean) || [],
        });

        // 2. Socket: notify admin dashboard
        io.emit('admin-session-alert', {
          type:         'DUE_SOON',
          session_id:   session.id,
          code:         session.code,
          purpose:      session.purpose,
          end_time:     session.end_time,
          room_name:    session.room_name,
          room_id:      session.room_id, // ⚡ ADDED: So frontend can filter by room!
          faculty_name: session.faculty_name,
          claimants:    session.claimants?.filter(Boolean) || [],
        });

        // 3. Email: notify each student who claimed
        const claimants = session.claimants?.filter(Boolean) || [];
        for (const claimant of claimants) {
          if (!claimant?.student_name) continue;
          try {
            logger.info(`[LabNotifier] Would email student ${claimant.student_name} — return by ${endTime}`);
          } catch (e) {
            logger.error(`[LabNotifier] Email failed for ${claimant.student_name}: ${e.message}`);
          }
        }

        // 4. Email: notify faculty
        if (session.faculty_email) {
          try {
            await sendMail({
              to:      session.faculty_email,
              subject: `InvenCEA — Lab Session ${session.code} ends at ${endTime}`,
              html: `
                <div style="font-family:sans-serif;max-width:500px">
                  <h2 style="color:#1F4E79">Lab Session Reminder</h2>
                  <p>Hello ${session.faculty_name},</p>
                  <p>Your lab session <strong>${session.code}</strong> (${session.purpose}) ends at <strong>${endTime}</strong>.</p>
                  <p>${claimants.length} student(s) have borrowed items. Please remind them to return equipment to the admin counter.</p>
                  <p style="color:#999;font-size:12px">This is an automated message from InvenCEA.</p>
                </div>`,
            });
          } catch (e) {
            logger.error(`[LabNotifier] Faculty email failed: ${e.message}`);
          }
        }

        logger.info(`[LabNotifier] Notified for session ${session.code} — ${claimants.length} claimants`);
      }
    } catch (err) {
      logger.error(`[LabNotifier] Cron error: ${err.message}`);
    }
  });

  // ── Every minute: check overdue sessions → alert admin ───────────────────
  cron.schedule('* * * * *', async () => {
    try {
      const overdue = await labSessionService.getOverdueSessions();
      if (!overdue.length) return;

      io.emit('admin-session-alert', {
        type:    'OVERDUE',
        overdue,
      });

      logger.info(`[LabNotifier] Overdue alert sent — ${overdue.length} session(s)`);
    } catch (err) {
      logger.error(`[LabNotifier] Overdue cron error: ${err.message}`);
    }
  });

  logger.info('[LabNotifier] Lab session notifier initialized');
};

module.exports = { initLabSessionNotifier };