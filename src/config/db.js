// src/config/db.js
const { Pool } = require('pg');
const logger = require('../utils/logger');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  
  // UPDATED SSL LOGIC: 
  // If we are NOT on localhost, we assume SSL is required (Render, Neon, Supabase, etc.)
  ssl: process.env.DATABASE_URL?.includes('localhost') || process.env.DATABASE_URL?.includes('127.0.0.1')
    ? false 
    : { rejectUnauthorized: false },

  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000, // Increased to 5s to give Render a bit more breathing room
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