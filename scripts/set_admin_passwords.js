// backend/scripts/set_admin_passwords.js
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') }); // adjust path to your .env
const bcrypt = require('bcrypt');
const { pool } = require('../src/config/db');

const admins = [
  { email: 'aceadmin1@gmail.com', name: 'Ace Admin 1', password: 'AceAdmin@1' },
  { email: 'aceadmin2@gmail.com', name: 'Ace Admin 2', password: 'Admin2@Ace' },
  { email: 'eceadmin@gmail.com', name: 'ECE Admin', password: 'erl@admin' },
  { email: 'cpeadmin@gmail.com', name: 'CPE Admin', password: 'admin@rene' },
];

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const a of admins) {
      const hash = await bcrypt.hash(a.password, 12);
      await client.query(
        `INSERT INTO users (email, name, role, password_hash)
         VALUES ($1, $2, 'admin', $3)
         ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, password_hash = EXCLUDED.password_hash`,
        [a.email, a.name, hash]
      );
      console.log(`Set password for ${a.email}`);
    }
    await client.query('COMMIT');
    console.log('Admin passwords set.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error setting admin passwords', err);
  } finally {
    client.release();
    await pool.end();
  }
})();