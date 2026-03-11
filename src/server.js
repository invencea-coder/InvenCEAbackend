require('dotenv').config();
const http = require('http');
const app = require('./app');
const { initSocket } = require('./config/socket');
const { initJobs } = require('./jobs');
const logger = require('./utils/logger');

const PORT = process.env.PORT || 4000;

// 1. Create the HTTP server using the Express app
const server = http.createServer(app);

// 2. Initialize Socket.io and Cron Jobs
initSocket(server);
initJobs();

// 3. START THE SERVER (Only call .listen ONCE)
server.listen(PORT, '0.0.0.0', () => {
  logger.info(`InvenCEA backend running on port ${PORT} [${process.env.NODE_ENV || 'development'}]`);
});

// Handle errors
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Rejection:', reason);
  server.close(() => process.exit(1));
});

module.exports = server;