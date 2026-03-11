require('dotenv').config();
const http = require('http');
const app = require('./app');
const { initSocket } = require('./config/socket');
const { initJobs } = require('./jobs');
const logger = require('./utils/logger');

const PORT = process.env.PORT || 4000; // Use Render's port, fallback to 4000
app.listen(PORT, () => {
  console.log(`InvenCEA backend running on port ${PORT}`);
});

const server = http.createServer(app);
initSocket(server);
initJobs();

server.listen(PORT, () => {
  logger.info(`InvenCEA backend running on port ${PORT} [${process.env.NODE_ENV}]`);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Rejection:', reason);
  server.close(() => process.exit(1));
});

module.exports = server;
