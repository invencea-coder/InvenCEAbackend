const request = require('supertest');
const app = require('../src/app');

// Mock DB and mailer for unit tests
jest.mock('../src/config/db', () => ({
  query: jest.fn(),
  withTransaction: jest.fn((fn) => fn({ query: jest.fn() })),
  pool: { connect: jest.fn(), end: jest.fn() },
}));

jest.mock('../src/config/mailer', () => ({
  sendMail: jest.fn().mockResolvedValue({ messageId: 'mock-id' }),
}));

jest.mock('../src/config/socket', () => ({
  initSocket: jest.fn(),
  emitToUser: jest.fn(),
  broadcast: jest.fn(),
}));

const db = require('../src/config/db');

describe('Auth Routes', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('POST /api/v1/auth/faculty/send-otp', () => {
    it('should return 400 for invalid email', async () => {
      const res = await request(app)
        .post('/api/v1/auth/faculty/send-otp')
        .send({ email: 'not-an-email' });
      expect(res.status).toBe(400);
    });

    it('should return 404 if faculty not found', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });
      const res = await request(app)
        .post('/api/v1/auth/faculty/send-otp')
        .send({ email: 'unknown@test.com' });
      expect(res.status).toBe(404);
    });

    it('should send OTP for valid faculty email', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [{ id: 1, name: 'Test Faculty' }] }) // faculty check
        .mockResolvedValueOnce({ rows: [] }) // invalidate old OTPs
        .mockResolvedValueOnce({ rows: [{ id: 1 }] }); // insert OTP

      const res = await request(app)
        .post('/api/v1/auth/faculty/send-otp')
        .send({ email: 'faculty@test.com' });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('POST /api/v1/auth/student/login', () => {
    it('should return 400 for missing fields', async () => {
      const res = await request(app)
        .post('/api/v1/auth/student/login')
        .send({ full_name: '' });
      expect(res.status).toBe(400);
    });

    it('should auto-register and log in new student', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [] }) // student not found
        .mockResolvedValueOnce({ rows: [{ id: 1, full_name: 'John Doe', student_id: 'S001' }] }); // insert

      const res = await request(app)
        .post('/api/v1/auth/student/login')
        .send({ full_name: 'John Doe', student_id: 'S001' });
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('token');
    });

    it('should reject if name does not match student_id', async () => {
      db.query.mockResolvedValueOnce({
        rows: [{ id: 1, full_name: 'Jane Doe', student_id: 'S001' }],
      });

      const res = await request(app)
        .post('/api/v1/auth/student/login')
        .send({ full_name: 'Wrong Name', student_id: 'S001' });
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/v1/auth/me', () => {
    it('should return 401 without token', async () => {
      const res = await request(app).get('/api/v1/auth/me');
      expect(res.status).toBe(401);
    });
  });
});
