const { query } = require('../config/db');

const startAutoCleaner = () => {
  // Run this check every 1 minute (60,000 milliseconds)
  setInterval(async () => {
    try {
      // Find and delete any 'pending' request where the 15-minute timer has passed
      // We use RETURNING id just so we can log it if we want to
      const { rows } = await query(`
        DELETE FROM requests 
        WHERE status = 'pending' AND expires_at < NOW() 
        RETURNING id
      `);

      if (rows.length > 0) {
        console.log(`[Auto-Cleaner] Deleted ${rows.length} expired ghost requests.`);
      }
    } catch (error) {
      console.error('[Auto-Cleaner] Failed to clean expired requests:', error.message);
    }
  }, 60 * 1000); 
};

module.exports = { startAutoCleaner };