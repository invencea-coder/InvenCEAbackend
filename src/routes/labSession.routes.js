// src/routes/labSession.routes.js
const express = require('express');
const { body, param } = require('express-validator');
const router  = express.Router();
const { protect, authorize } = require('../middleware/authMiddleware');
const { validationResult } = require('express-validator');
const labSessionService = require('../services/labSession.service');
const authService       = require('../services/auth.service');
const { createRequest } = require('../services/request.service'); // your existing service
const { success, badRequest, notFound } = require('../utils/apiResponse');
const logger = require('../utils/logger');

// ── Faculty: create a lab session ─────────────────────────────────────────────
router.post(
  '/',
  protect,
  authorize('faculty', 'manager'),
  [
    body('room_id').isInt().withMessage('room_id must be an integer'),
    body('purpose').notEmpty().withMessage('purpose is required'),
    body('start_time').isISO8601().withMessage('start_time must be a valid datetime'),
    body('end_time').isISO8601().withMessage('end_time must be a valid datetime'),
    body('items').isArray().withMessage('items must be an array'),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return badRequest(res, 'Validation failed', errors.array());

      const session = await labSessionService.createLabSession(req.user.id, req.body);
      return success(res, session, 'Lab session created');
    } catch (err) { next(err); }
  }
);

// ── Faculty: list my sessions ─────────────────────────────────────────────────
router.get(
  '/my',
  protect,
  authorize('faculty', 'manager'),
  async (req, res, next) => {
    try {
      const sessions = await labSessionService.listFacultySessions(req.user.id);
      return success(res, sessions, 'Sessions retrieved');
    } catch (err) { next(err); }
  }
);

// ── Faculty: deactivate a session ─────────────────────────────────────────────
router.put(
  '/:id/deactivate',
  protect,
  authorize('faculty', 'manager'),
  async (req, res, next) => {
    try {
      const session = await labSessionService.deactivateSession(req.params.id, req.user.id);
      return success(res, session, 'Session deactivated');
    } catch (err) { next(err); }
  }
);

// ── Student: validate a session code (preview before claiming) ────────────────
router.post(
  '/validate',
  protect,
  authorize('student'),
  [body('code').notEmpty().withMessage('Session code is required')],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return badRequest(res, 'Validation failed', errors.array());

      const { session } = await labSessionService.claimSession(req.body.code, req.user.id);

      // Return preview info only — no request created yet
      return success(res, {
        session_id:   session.id,
        code:         session.code,
        purpose:      session.purpose,
        room_name:    session.room_name,
        faculty_name: session.faculty_name,
        end_time:     session.end_time,
        items:        session.items,
      }, 'Session valid');
    } catch (err) { next(err); }
  }
);

// ── Student: claim a session (creates approved request) ───────────────────────
router.post(
  '/claim',
  protect,
  authorize('student'),
  [body('code').notEmpty().withMessage('Session code is required')],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return badRequest(res, 'Validation failed', errors.array());

      const { session, student } = await labSessionService.claimSession(req.body.code, req.user.id);

      // Build request payload from session items
      const items = (session.items || []).map(i => ({
        inventory_type_id: i.inventory_type_id,
        quantity:          i.quantity || 1,
        assigned_to:       'Requester',
      }));

      // Create request directly as APPROVED (skips approval queue)
      const request = await createRequest({
        requester_id:     req.user.id,
        requester_type:   'student',
        room_id:          session.room_id,
        purpose:          session.purpose,
        items,
        lab_session_id:   session.id,
        scheduled_time:   session.end_time,
        status:           'APPROVED',  // pre-approved by faculty session
      });

      // Record the claim to prevent duplicate use
      await labSessionService.recordClaim(session.id, req.user.id, request.id);

      logger.info(`Student ${student.student_id} claimed session ${session.code} → request #${request.id}`);

      return success(res, {
        request_id: request.id,
        qr_code:    request.qr_code,
        session: {
          code:         session.code,
          purpose:      session.purpose,
          faculty_name: session.faculty_name,
          end_time:     session.end_time,
        },
      }, 'Session claimed — request approved');
    } catch (err) { next(err); }
  }
);

// ── Admin: get overdue session requests ───────────────────────────────────────
router.get(
  '/overdue',
  protect,
  authorize('admin', 'manager'),
  async (req, res, next) => {
    try {
      const overdue = await labSessionService.getOverdueSessions();
      return success(res, overdue, 'Overdue sessions retrieved');
    } catch (err) { next(err); }
  }
);

module.exports = router;