const { Server } = require('socket.io');
const logger = require('../utils/logger');

let io;

const initSocket = (server) => {
  io = new Server(server, {
    path: process.env.SOCKET_PATH || '/socket.io',
    cors: { origin: process.env.BASE_URL || '*', credentials: true },
  });

  io.on('connection', (socket) => {
    logger.info(`Socket connected: ${socket.id}`);

    // Join a room by userId for targeted notifications
    socket.on('join', (userId) => {
      socket.join(`user:${userId}`);
      logger.debug(`Socket ${socket.id} joined room user:${userId}`);
    });

    socket.on('disconnect', () => {
      logger.info(`Socket disconnected: ${socket.id}`);
    });
  });

  return io;
};

const getIO = () => {
  if (!io) throw new Error('Socket.io not initialized');
  return io;
};

/**
 * Emit event to a specific user
 */
const emitToUser = (userId, event, data) => {
  try {
    getIO().to(`user:${userId}`).emit(event, data);
  } catch (e) {
    logger.warn(`Could not emit to user ${userId}:`, e.message);
  }
};

/**
 * Broadcast event to all connected clients
 */
const broadcast = (event, data) => {
  try {
    getIO().emit(event, data);
  } catch (e) {
    logger.warn('Broadcast failed:', e.message);
  }
};

module.exports = { initSocket, getIO, emitToUser, broadcast };
