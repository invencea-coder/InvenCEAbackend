const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const swaggerUi = require('swagger-ui-express');
const YAML = require('yamljs');
const path = require('path');

const routes = require('./routes'); // your main routes index
const errorHandler = require('./middleware/errorHandler');
const rateLimiter = require('./middleware/rateLimiter');
const logger = require('./utils/logger');
const managerRoutes = require('./routes/manager.routes'); // <-- Manager routes imported
const app = express();

// ─── Security & parsing ───────────────────────────────
app.use(helmet());
app.use(cors({
  origin: [
    "http://localhost:5173", // For local testing
    "https://your-frontend-name.vercel.app" // Your future Vercel URL
  ],
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ─── Logging ───────────────────────────────
app.use(
  morgan('combined', { stream: { write: (msg) => logger.http(msg.trim()) } })
);

// ─── Rate limiting ───────────────────────────────
app.use('/api/', rateLimiter);

// ─── Swagger docs ───────────────────────────────
try {
  const swaggerDoc = YAML.load(path.join(__dirname, '../docs/openapi.yaml'));
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerDoc));
} catch (e) {
  logger.warn('OpenAPI spec not found, skipping Swagger UI');
}

// ─── API Routes ───────────────────────────────
// ✅ THE FIX: Mount the manager routes exactly here
app.use('/api/v1/manager', managerRoutes); 

// Your existing main routes (Auth, Admin, Faculty, etc.)
app.use('/api/v1', routes);

// ─── Health check ───────────────────────────────
app.get('/health', (_req, res) => res.json({
  status: 'ok',
  env: process.env.NODE_ENV || 'development',
}));

// ─── 404 Handler ───────────────────────────────
app.use((_req, res) => res.status(404).json({
  success: false,
  message: 'Route not found',
}));

// ─── Global error handler (must be last) ───────────────
app.use(errorHandler);

module.exports = app;