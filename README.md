# InvenCEA Backend

Production-ready **Node.js + Express** REST API for the InvenCEA Inventory Management System.

## Stack
- **Runtime**: Node.js (v18+)
- **Framework**: Express.js
- **Database**: PostgreSQL (pg pool + raw SQL)
- **Auth**: JWT + OTP via Gmail SMTP (Nodemailer)
- **Real-time**: Socket.IO
- **Jobs**: node-cron
- **Export**: ExcelJS (.xlsx)
- **Docs**: Swagger UI (OpenAPI 3.0)
- **Tests**: Jest + Supertest

---

## Quick Start

### 1. Prerequisites
- Node.js >= 18
- PostgreSQL >= 14

### 2. Install dependencies
```bash
cd backend
npm install
```

### 3. Configure environment
```bash
cp .env.example .env
# Edit .env with your values
```

### 4. Create database
```bash
createdb invencea
```

### 5. Run migrations
```bash
psql $DATABASE_URL -f migrations/001_initial_schema.sql
```

### 6. Seed sample data
```bash
npm run seed
```

### 7. Start the server
```bash
npm run dev       # development (nodemon)
npm start         # production
```

---

## API Base URL
```
http://localhost:4000/api/v1
```

## Swagger Docs
```
http://localhost:4000/api/docs
```

## Health Check
```
GET http://localhost:4000/health
```

---

## Authentication

| Role    | Method                              |
|---------|-------------------------------------|
| Admin   | Pre-seeded, needs JWT (manual issue)|
| Faculty | OTP via Gmail → JWT                 |
| Student | Full name + Student ID → JWT        |

### Faculty Login Flow
```
POST /api/v1/auth/faculty/send-otp   { email }
POST /api/v1/auth/faculty/verify-otp { email, code }  → { token }
```

### Student Login Flow
```
POST /api/v1/auth/student/login  { full_name, student_id }  → { token }
```

Use `Authorization: Bearer <token>` for all protected routes.

---

## Key Features

### Inventory Rules
- **Borrowable items**: one physical item per barcode (e.g., `INV-0001`). Assigned to a request at issue time.
- **Consumables**: quantity-based per barcode (e.g., `CON-0001`). Stock deducted on issue.

### Concurrency Safety
- Issue flow uses `SELECT ... FOR UPDATE` + `SKIP LOCKED` inside a PostgreSQL transaction.
- `issued_time` is recorded with `clock_timestamp()` inside the transaction — precise and serialized.
- Two admins issuing simultaneously for the same room are handled safely without deadlocks.

### Reports
- Only rows where `issued_time IS NOT NULL` appear in reports.
- Filter by requester type (`faculty` / `student`) and date range.
- Export to `.xlsx` with styled columns, freeze pane, and auto-filter.
- Delete filtered rows (requires at least one filter to prevent accidental full wipe).

### Background Jobs
| Job | Schedule | Description |
|-----|----------|-------------|
| `expireRequests` | Every 15 min | Expire PENDING requests older than `REQUEST_EXPIRY_HOURS` |
| `reminder` | Every hour | Send overdue reminders for ISSUED requests |

### Socket.IO Events
| Event | Trigger |
|-------|---------|
| `request-approved` | Request approved by admin |
| `request-issued` | Items issued |
| `inventory-updated` | Item returned / new request |
| `reminder` | Overdue reminder fired |

---

## Folder Structure
```
backend/
├── src/
│   ├── config/        db, mailer, socket
│   ├── routes/        express routers
│   ├── controllers/   request handlers
│   ├── services/      business logic
│   ├── middleware/    auth, role, rateLimit, errorHandler
│   ├── jobs/          node-cron background jobs
│   ├── utils/         logger, apiResponse, excelExporter
│   └── server.js / app.js
├── migrations/        SQL migration files
├── seeds/             seed script
├── tests/             Jest + Supertest tests
└── docs/              openapi.yaml
```

---

## Running Tests
```bash
npm test
npm run test:coverage
```

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Secret for signing JWTs |
| `JWT_EXPIRES_IN` | Token expiry (e.g. `7d`) |
| `GMAIL_USER` | Gmail address for SMTP |
| `GMAIL_PASS` | Gmail App Password |
| `OTP_EXPIRY_SECONDS` | OTP TTL in seconds (default: 120) |
| `REQUEST_EXPIRY_HOURS` | Auto-expire pending requests (default: 24) |
| `REMINDER_OVERDUE_HOURS` | Overdue reminder threshold (default: 2) |

---

## Security
- `helmet` for HTTP headers
- `express-rate-limit` on all `/api/` routes; stricter on auth routes (10 req/10min)
- Input validation via `express-validator`
- JWT expiry enforced
- OTP single-use and short TTL (2 min default)
