const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/app');

jest.mock('../src/config/db', () => ({
  query: jest.fn(),
  withTransaction: jest.fn(),
  pool: { connect: jest.fn(), end: jest.fn() },
}));

jest.mock('../src/config/socket', () => ({
  initSocket: jest.fn(),
  emitToUser: jest.fn(),
  broadcast: jest.fn(),
}));

process.env.JWT_SECRET = 'test-secret';

const db = require('../src/config/db');
const makeToken = (payload) => jwt.sign(payload, 'test-secret');

describe('Report Routes', () => {
  const adminToken = makeToken({ id: 1, role: 'admin', email: 'admin@test.com' });
  const studentToken = makeToken({ id: 10, role: 'student' });

  beforeEach(() => jest.clearAllMocks());

  describe('GET /api/v1/reports/issued', () => {
    it('should deny non-admins', async () => {
      const res = await request(app)
        .get('/api/v1/reports/issued')
        .set('Authorization', `Bearer ${studentToken}`);
      expect(res.status).toBe(403);
    });

    it('should return issued rows for admin', async () => {
      db.query.mockResolvedValueOnce({
        rows: [
          { request_id: 1, requester_type: 'faculty', item_name: 'Projector', issued_time: new Date() }
        ]
      });

      const res = await request(app)
        .get('/api/v1/reports/issued')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  describe('GET /api/v1/reports/export', () => {
    it('should return xlsx buffer', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .get('/api/v1/reports/export')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('spreadsheetml');
    });
  });

  describe('DELETE /api/v1/reports', () => {
    it('should require at least one filter', async () => {
      const res = await request(app)
        .delete('/api/v1/reports')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(400);
    });

    it('should delete filtered rows', async () => {
      db.query.mockResolvedValueOnce({ rowCount: 5 });

      const res = await request(app)
        .delete('/api/v1/reports?from=2024-01-01&to=2024-01-31')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.deleted).toBe(5);
    });
  });
});
