// src/config/db.js
const { Pool } = require('pg');
const logger = require('../utils/logger');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // ✅ THE FIX: Automatically apply SSL if using Neon, disable if local
  ssl: process.env.DATABASE_URL?.includes('neon.tech') 
    ? { rejectUnauthorized: false } 
    : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  logger.error('Unexpected DB pool error:', err);
});

pool.on('connect', () => {
  logger.debug('New DB client connected');
});

/**
 * Execute a query
 */
const query = (text, params) => pool.query(text, params);

/**
 * Get a client for transactions
 */
const getClient = () => pool.connect();

/**
 * Run a function within a transaction
 */
const withTransaction = async (fn) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

module.exports = { pool, query, getClient, withTransaction };