require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { pool } = require('../src/config/db');
const logger = require('../src/utils/logger');

const seed = async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Room Archi & CE admins
    const archiAdmins = [
      { email: 'aceadmin1@gmail.com', name: 'Ace Admin 1' },
      { email: 'aceadmin2@gmail.com', name: 'Ace Admin 2' },
    ];

    // Room EcE admins
    const eceAdmins = [
      { email: 'eceadmin@gmail.com', name: 'ECE Admin' },
    ];

    // Room CpE admins
    const cpeAdmins = [
      { email: 'cpeadmin@gmail.com', name: 'CPE Admin' },
    ];

    // Faculty account (recognized by every room)
    const faculty = [
      { email: 'invencea@gmail.com', name: 'Faculty User' },
    ];

    const admins = [...archiAdmins, ...eceAdmins, ...cpeAdmins];

    // Insert admins
    for (const a of admins) {
      await client.query(
        `INSERT INTO users (email, name, role)
         VALUES ($1, $2, 'admin')
         ON CONFLICT (email) DO NOTHING`,
        [a.email, a.name]
      );
    }

    // Insert faculty
    for (const f of faculty) {
      await client.query(
        `INSERT INTO users (email, name, role)
         VALUES ($1, $2, 'faculty')
         ON CONFLICT (email) DO NOTHING`,
        [f.email, f.name]
      );
    }

    await client.query('COMMIT');
    logger.info('Admin and faculty seed completed successfully');
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('Seed failed:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
};

seed().catch(() => process.exit(1));