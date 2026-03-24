require('dotenv').config();
const http = require('http');
const app = require('./app');
const { initSocket, getIO } = require('./config/socket');
const { initJobs } = require('./jobs');
const logger = require('./utils/logger');
const { startAutoCleaner } = require('./utils/cronJobs');
const { initLabSessionNotifier } = require('./jobs/labSessionNotifier');

const PORT = process.env.PORT || 4000;

// 1. Create the HTTP server
const server = http.createServer(app);

// 2. Initialize Socket.io
initSocket(server);

// 3. Initialize existing jobs
initJobs();
startAutoCleaner();

// 4. Initialize lab session notifier (needs io instance)
const io = getIO();
initLabSessionNotifier(io);

// 5. Start the server
server.listen(PORT, '0.0.0.0', () => {
  logger.info(`InvenCEA backend running on port ${PORT} [${process.env.NODE_ENV || 'development'}]`);
});

// Handle errors
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Rejection:', reason);
  server.close(() => process.exit(1));
});

module.exports = server;
