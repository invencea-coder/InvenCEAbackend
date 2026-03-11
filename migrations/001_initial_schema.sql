-- Migration: 001_initial_schema.sql
-- Run with: psql $DATABASE_URL -f migrations/001_initial_schema.sql

BEGIN;

-- Users (admin & faculty)
CREATE TABLE IF NOT EXISTS users (
  id          BIGSERIAL PRIMARY KEY,
  email       TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  password_hash TEXT,
  role        TEXT NOT NULL CHECK (role IN ('admin','faculty')),
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Students
CREATE TABLE IF NOT EXISTS students (
  id          BIGSERIAL PRIMARY KEY,
  full_name   TEXT NOT NULL,
  student_id  VARCHAR(50) NOT NULL UNIQUE,
  department  TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Rooms
CREATE TABLE IF NOT EXISTS rooms (
  id           BIGSERIAL PRIMARY KEY,
  code         TEXT NOT NULL UNIQUE,
  name         TEXT,
  is_available BOOLEAN DEFAULT TRUE,
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- Inventory types (catalog)
CREATE TABLE IF NOT EXISTS inventory_types (
  id         BIGSERIAL PRIMARY KEY,
  sku        TEXT UNIQUE NOT NULL,
  name       TEXT NOT NULL,
  category   TEXT,
  type       TEXT NOT NULL CHECK (type IN ('borrowable','consumable')),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Physical borrowable items
CREATE TABLE IF NOT EXISTS inventory_items (
  id                  BIGSERIAL PRIMARY KEY,
  inventory_type_id   BIGINT NOT NULL REFERENCES inventory_types(id) ON DELETE RESTRICT,
  barcode             TEXT UNIQUE NOT NULL,
  status              TEXT NOT NULL DEFAULT 'available'
                        CHECK (status IN ('available','borrowed','maintenance')),
  location_room_id    BIGINT REFERENCES rooms(id),
  created_at          TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_items_barcode ON inventory_items(barcode);
CREATE INDEX IF NOT EXISTS idx_inventory_items_type_status ON inventory_items(inventory_type_id, status);

-- Consumable stock
CREATE TABLE IF NOT EXISTS inventory_consumables (
  id                  BIGSERIAL PRIMARY KEY,
  inventory_type_id   BIGINT NOT NULL REFERENCES inventory_types(id) ON DELETE RESTRICT,
  barcode             TEXT UNIQUE NOT NULL,
  quantity_total      INTEGER NOT NULL DEFAULT 0 CHECK (quantity_total >= 0),
  quantity_available  INTEGER NOT NULL DEFAULT 0 CHECK (quantity_available >= 0),
  created_at          TIMESTAMPTZ DEFAULT now()
);

-- Requests
CREATE TABLE IF NOT EXISTS requests (
  id              BIGSERIAL PRIMARY KEY,
  requester_type  TEXT NOT NULL CHECK (requester_type IN ('faculty','student')),
  requester_id    BIGINT NOT NULL,
  room_id         BIGINT REFERENCES rooms(id),
  purpose         TEXT,
  status          TEXT NOT NULL DEFAULT 'PENDING'
                    CHECK (status IN ('PENDING','APPROVED','REJECTED','ISSUED','RETURNED','EXPIRED')),
  requested_time  TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_time   TIMESTAMPTZ,
  issued_time     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status);
CREATE INDEX IF NOT EXISTS idx_requests_requester ON requests(requester_type, requester_id);
CREATE INDEX IF NOT EXISTS idx_requests_issued_time ON requests(issued_time);
CREATE INDEX IF NOT EXISTS idx_requests_created_at ON requests(created_at);

-- Request line items
CREATE TABLE IF NOT EXISTS request_items (
  id                  BIGSERIAL PRIMARY KEY,
  request_id          BIGINT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  inventory_type_id   BIGINT REFERENCES inventory_types(id),
  inventory_item_id   BIGINT REFERENCES inventory_items(id),
  consumable_id       BIGINT REFERENCES inventory_consumables(id),
  quantity            INTEGER DEFAULT 1 CHECK (quantity > 0),
  status              TEXT DEFAULT 'PENDING'
                        CHECK (status IN ('PENDING','ALLOCATED','ISSUED','RETURNED')),
  created_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_request_items_request_id ON request_items(request_id);

-- OTP codes for faculty login
CREATE TABLE IF NOT EXISTS otp_codes (
  id          BIGSERIAL PRIMARY KEY,
  user_email  TEXT NOT NULL,
  code        CHAR(6) NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  used        BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_otp_user_email ON otp_codes(user_email);

-- Notifications
CREATE TABLE IF NOT EXISTS notifications (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT,
  email      TEXT,
  title      TEXT,
  message    TEXT,
  is_read    BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);

-- Issued reports view
CREATE OR REPLACE VIEW issued_reports AS
SELECT
  r.id              AS request_id,
  r.requester_type,
  r.requester_id,
  COALESCE(u.name, s.full_name) AS requester_name,
  r.room_id,
  rm.code           AS room_code,
  ri.inventory_item_id,
  ii.barcode,
  ic.barcode        AS consumable_barcode,
  it.name           AS item_name,
  it.type           AS item_type,
  ri.quantity,
  r.requested_time,
  r.approved_time,
  r.issued_time,
  r.status
FROM requests r
JOIN request_items ri    ON ri.request_id = r.id
JOIN inventory_types it  ON it.id = ri.inventory_type_id
LEFT JOIN inventory_items ii  ON ii.id = ri.inventory_item_id
LEFT JOIN inventory_consumables ic ON ic.id = ri.consumable_id
LEFT JOIN rooms rm        ON rm.id = r.room_id
LEFT JOIN users u         ON u.id = r.requester_id AND r.requester_type = 'faculty'
LEFT JOIN students s      ON s.id = r.requester_id AND r.requester_type = 'student'
WHERE r.issued_time IS NOT NULL;

COMMIT;
