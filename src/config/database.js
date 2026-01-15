const { Pool } = require('pg');
const logger = require('../utils/logger');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'rescuemesh_sos',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  logger.error('Unexpected error on idle client', err);
});

// Initialize database schema
async function initializeDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sos_requests (
        request_id VARCHAR(255) PRIMARY KEY,
        disaster_id VARCHAR(255) NOT NULL,
        requested_by VARCHAR(255) NOT NULL,
        required_skills JSONB,
        required_resources JSONB,
        urgency VARCHAR(50) NOT NULL,
        number_of_people INTEGER,
        location JSONB NOT NULL,
        description TEXT,
        contact_phone VARCHAR(20),
        status VARCHAR(50) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        matched_at TIMESTAMP,
        resolved_at TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_sos_disaster_id ON sos_requests(disaster_id);
      CREATE INDEX IF NOT EXISTS idx_sos_status ON sos_requests(status);
      CREATE INDEX IF NOT EXISTS idx_sos_urgency ON sos_requests(urgency);
      CREATE INDEX IF NOT EXISTS idx_sos_created_at ON sos_requests(created_at);
      CREATE INDEX IF NOT EXISTS idx_sos_location ON sos_requests USING GIN(location);
    `);

    logger.info('Database schema initialized');
  } catch (error) {
    logger.error('Database initialization error', error);
    throw error;
  }
}

module.exports = {
  pool,
  initializeDatabase,
};
