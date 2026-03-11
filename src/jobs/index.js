const expireRequestsJob = require('./expireRequests.job');
const reminderJob = require('./reminder.job');
const logger = require('../utils/logger');

const initJobs = () => {
  expireRequestsJob.start();
  reminderJob.start();
  logger.info('Background jobs initialized');
};

module.exports = { initJobs };
