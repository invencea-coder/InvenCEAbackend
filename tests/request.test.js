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

jest.mock('../src/services/notification.service', () => ({
  notifyApproved: jest.fn().mockResolvedValue(undefined),
  notifyIssued: jest.fn().mockResolvedValue(undefined),
  notifyExpired: jest.fn().mockResolvedValue(undefined),
  createNotification: jest.fn().mockResolvedValue(undefined),
}));

process.env.JWT_SECRET = 'test-secret';

const makeToken = (payload) => jwt.sign(payload, 'test-secret');

const db = require('../src/config/db');

describe('Request Routes', () => {
  const adminToken = makeToken({ id: 1, role: 'admin', email: 'admin@test.com' });
  const facultyToken = makeToken({ id: 2, role: 'faculty', email: 'fac@test.com' });

  beforeEach(() => jest.clearAllMocks());

  describe('POST /api/v1/requests', () => {
    it('should return 401 without token', async () => {
      const res = await request(app).post('/api/v1/requests').send({});
      expect(res.status).toBe(401);
    });

    it('should return 400 if items missing', async () => {
      const res = await request(app)
        .post('/api/v1/requests')
        .set('Authorization', `Bearer ${facultyToken}`)
        .send({ purpose: 'Test' });
      expect(res.status).toBe(400);
    });

    it('should create a request', async () => {
      db.withTransaction.mockResolvedValueOnce({ id: 1, status: 'PENDING' });

      const res = await request(app)
        .post('/api/v1/requests')
        .set('Authorization', `Bearer ${facultyToken}`)
        .send({
          room_id: 1,
          purpose: 'Lecture',
          items: [{ inventory_type_id: 1, quantity: 1 }],
        });
      expect(res.status).toBe(201);
      expect(res.body.data).toHaveProperty('status', 'PENDING');
    });
  });

  describe('PUT /api/v1/requests/:id/approve', () => {
    it('should return 403 for non-admin', async () => {
      const res = await request(app)
        .put('/api/v1/requests/1/approve')
        .set('Authorization', `Bearer ${facultyToken}`);
      expect(res.status).toBe(403);
    });

    it('should approve request as admin', async () => {
      db.query.mockResolvedValueOnce({ rows: [{ id: 1, status: 'APPROVED', requester_id: 2, requester_type: 'faculty' }] });

      const res = await request(app)
        .put('/api/v1/requests/1/approve')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('APPROVED');
    });
  });

  describe('PUT /api/v1/requests/:id/issue', () => {
    it('should issue request with transactional allocation', async () => {
      db.withTransaction.mockResolvedValueOnce({ id: 1, status: 'ISSUED', issued_time: new Date() });

      const res = await request(app)
        .put('/api/v1/requests/1/issue')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('ISSUED');
    });
  });
});
