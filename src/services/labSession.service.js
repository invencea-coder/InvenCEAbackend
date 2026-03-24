// src/services/labSession.service.js
const crypto  = require('crypto');
const { query } = require('../config/db');
const logger  = require('../utils/logger');

// ── Generate a unique LAB-XXXX code ──────────────────────────────────────────
const generateCode = async () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I confusion
  let code, exists;
  do {
    code = 'LAB-' + Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    const { rows } = await query('SELECT id FROM lab_sessions WHERE code = $1', [code]);
    exists = rows.length > 0;
  } while (exists);
  return code;
};

// ── Create a lab session ──────────────────────────────────────────────────────
const createLabSession = async (facultyId, { room_id, purpose, items, start_time, end_time }) => {
  if (!room_id || !purpose || !start_time || !end_time) {
    throw Object.assign(new Error('room_id, purpose, start_time, end_time are required'), { status: 400 });
  }
  if (new Date(end_time) <= new Date(start_time)) {
    throw Object.assign(new Error('end_time must be after start_time'), { status: 400 });
  }

  // Faculty must belong to this room
  const { rows: roomRows } = await query(
    `SELECT id FROM users WHERE id = $1 AND room_id = $2`,
    [facultyId, room_id]
  );
  if (!roomRows.length) {
    throw Object.assign(new Error('You are not assigned to this room'), { status: 403 });
  }

  const code = await generateCode();

  const { rows } = await query(
    `INSERT INTO lab_sessions (code, faculty_id, room_id, purpose, items, start_time, end_time)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [code, facultyId, room_id, purpose, JSON.stringify(items || []), start_time, end_time]
  );

  logger.info(`Lab session created: ${code} by faculty ${facultyId}`);
  return rows[0];
};

// ── List faculty's sessions ───────────────────────────────────────────────────
const listFacultySessions = async (facultyId) => {
  const { rows } = await query(
    `SELECT ls.*,
            r.name AS room_name, r.code AS room_code,
            COUNT(lsc.id)::int AS claim_count
     FROM lab_sessions ls
     JOIN rooms r ON r.id = ls.room_id
     LEFT JOIN lab_session_claims lsc ON lsc.session_id = ls.id
     WHERE ls.faculty_id = $1
     GROUP BY ls.id, r.name, r.code
     ORDER BY ls.created_at DESC`,
    [facultyId]
  );
  return rows;
};

// ── Deactivate a session ──────────────────────────────────────────────────────
const deactivateSession = async (sessionId, facultyId) => {
  const { rows } = await query(
    `UPDATE lab_sessions SET is_active = FALSE
     WHERE id = $1 AND faculty_id = $2
     RETURNING *`,
    [sessionId, facultyId]
  );
  if (!rows.length) throw Object.assign(new Error('Session not found or not yours'), { status: 404 });
  logger.info(`Lab session deactivated: ${rows[0].code}`);
  return rows[0];
};

// ── Validate + claim a session code (student) ─────────────────────────────────
const claimSession = async (code, studentId) => {
  const now = new Date();

  // 1. Find session
  const { rows: sessionRows } = await query(
    `SELECT ls.*, r.name AS room_name, r.code AS room_code,
            u.name AS faculty_name
     FROM lab_sessions ls
     JOIN rooms r ON r.id = ls.room_id
     JOIN users u ON u.id = ls.faculty_id
     WHERE ls.code = $1`,
    [code.toUpperCase().trim()]
  );

  if (!sessionRows.length) {
    throw Object.assign(new Error('Invalid session code'), { status: 404 });
  }

  const session = sessionRows[0];

  if (!session.is_active) {
    throw Object.assign(new Error('This session has been deactivated by the faculty'), { status: 400 });
  }
  if (now < new Date(session.start_time)) {
    throw Object.assign(new Error('This session has not started yet'), { status: 400 });
  }
  if (now > new Date(session.end_time)) {
    throw Object.assign(new Error('This session has already ended'), { status: 400 });
  }

  // 2. Check if student already claimed
  const { rows: claimRows } = await query(
    `SELECT id FROM lab_session_claims WHERE session_id = $1 AND student_id = $2`,
    [session.id, studentId]
  );
  if (claimRows.length) {
    throw Object.assign(new Error('You have already claimed this session'), { status: 409 });
  }

  // 3. Get student info
  const { rows: studentRows } = await query(
    `SELECT id, full_name, student_id FROM students WHERE id = $1`,
    [studentId]
  );
  if (!studentRows.length) throw Object.assign(new Error('Student not found'), { status: 404 });

  return { session, student: studentRows[0] };
};

// ── Record the claim after request is created ─────────────────────────────────
const recordClaim = async (sessionId, studentId, requestId) => {
  await query(
    `INSERT INTO lab_session_claims (session_id, student_id, request_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (session_id, student_id) DO NOTHING`,
    [sessionId, studentId, requestId]
  );
};

// ── Get sessions nearing end time (for cron notifications) ───────────────────
const getSessionsDueSoon = async (minutesBefore = 10) => {
  const { rows } = await query(
    `SELECT ls.*,
            u.email AS faculty_email, u.name AS faculty_name,
            r.name AS room_name,
            json_agg(json_build_object(
              'student_id', s.id,
              'student_name', s.full_name,
              'request_id', lsc.request_id
            )) AS claimants
     FROM lab_sessions ls
     JOIN users u ON u.id = ls.faculty_id
     JOIN rooms r ON r.id = ls.room_id
     LEFT JOIN lab_session_claims lsc ON lsc.session_id = ls.id
     LEFT JOIN students s ON s.id = lsc.student_id
     WHERE ls.is_active = TRUE
       AND ls.end_time BETWEEN NOW() AND NOW() + ($1 || ' minutes')::interval
     GROUP BY ls.id, u.email, u.name, r.name`,
    [minutesBefore]
  );
  return rows;
};

// ── Get overdue sessions (past end time, still has ISSUED requests) ───────────
const getOverdueSessions = async () => {
  const { rows } = await query(
    `SELECT ls.code, ls.purpose, ls.end_time,
            u.name AS faculty_name,
            r.name AS room_name,
            json_agg(json_build_object(
              'request_id', req.id,
              'student_name', s.full_name,
              'student_id_no', s.student_id
            )) AS overdue_requests
     FROM lab_sessions ls
     JOIN users u ON u.id = ls.faculty_id
     JOIN rooms r ON r.id = ls.room_id
     JOIN lab_session_claims lsc ON lsc.session_id = ls.id
     JOIN requests req ON req.id = lsc.request_id AND req.status = 'ISSUED'
     JOIN students s ON s.id = lsc.student_id
     WHERE ls.end_time < NOW()
     GROUP BY ls.id, u.name, r.name`,
  );
  return rows;
};

module.exports = {
  createLabSession,
  listFacultySessions,
  deactivateSession,
  claimSession,
  recordClaim,
  getSessionsDueSoon,
  getOverdueSessions,
};