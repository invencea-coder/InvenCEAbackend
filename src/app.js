const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const swaggerUi = require('swagger-ui-express');
const YAML = require('yamljs');
const path = require('path');

const routes = require('./routes');
const errorHandler = require('./middleware/errorHandler');
const rateLimiter = require('./middleware/rateLimiter');
const logger = require('./utils/logger');
const managerRoutes = require('./routes/manager.routes');

const app = express();

// ─── Security & Parsing ───────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: false,
}));

// ✅ FIXED CORS CONFIGURATION
const allowedOrigins = [
  "http://localhost:5173",
  "https://invencea-frontend-2yj9.vercel.app" 
];

const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps/Postman) or if in allowed list
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  optionsSuccessStatus: 200 // Important for legacy browser support
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions)); // ✅ Robust Pre-flight handling

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ─── Logging ───────────────────────────────
app.use(morgan('combined', { stream: { write: (msg) => logger.http(msg.trim()) } }));

// ─── Rate Limiting ───────────────────────────────
app.use('/api/', rateLimiter);

// ─── Swagger Docs ───────────────────────────────
try {
  const swaggerDoc = YAML.load(path.join(__dirname, '../docs/openapi.yaml'));
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerDoc));
} catch (e) {
  logger.warn('OpenAPI spec not found, skipping Swagger UI');
}

// ─── API Routes ───────────────────────────────
// Mount manager routes separately if they are outside the standard v1 index
app.use('/api/v1/manager', managerRoutes); 
app.use('/api/v1', routes);

// ─── Health Check ───────────────────────────────
app.get('/health', (_req, res) => res.json({
  status: 'ok',
  env: process.env.NODE_ENV || 'production',
}));

// ─── 404 Handler ───────────────────────────────
app.use((_req, res) => res.status(404).json({
  success: false,
  message: 'Route not found',
}));

// ─── Global Error Handler ──────────────────────
app.use(errorHandler);

module.exports = app;