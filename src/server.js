require('dotenv').config();
const http = require('http');
const app = require('./app');
const { initSocket } = require('./config/socket');
const logger = require('./utils/logger');
const { startAutoCleaner } = require('./utils/cronJobs');

const PORT = process.env.PORT || 4000;

// 1. Create the HTTP server
const server = http.createServer(app);

// 2. Initialize Socket.io and Cron Jobs
initSocket(server);
startAutoCleaner();

// 3. START THE SERVER
server.listen(PORT, '0.0.0.0', () => {
  logger.info(`InvenCEA backend running on port ${PORT} [${process.env.NODE_ENV || 'development'}]`);
});

// Handle errors
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Rejection:', reason);
});

module.exports = server;