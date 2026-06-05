-- Sevana — initial schema (Postgres 15+)
-- Every per-tenant table carries tenant_id and an index on it.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Tenants
-- ---------------------------------------------------------------------------
CREATE TABLE tenants (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  enabled_channels JSONB NOT NULL,
  persona         JSONB NOT NULL,
  merchandising   JSONB NOT NULL,
  guardrails      JSONB NOT NULL,
  connectors      JSONB NOT NULL,
  credentials     JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Customer profiles
-- ---------------------------------------------------------------------------
CREATE TABLE customer_profiles (
  id          TEXT NOT NULL,
  tenant_id   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  identity    JSONB NOT NULL DEFAULT '{}'::jsonb,
  locale      TEXT,
  consent     JSONB NOT NULL,
  preferences JSONB NOT NULL,
  sizes       JSONB,
  taste_graph JSONB NOT NULL DEFAULT '{"nodes":[],"edges":[]}'::jsonb,
  history     JSONB NOT NULL DEFAULT '{"pastOrderIds":[],"pastSessionIds":[]}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX customer_profiles_tenant_id_idx ON customer_profiles (tenant_id);

-- ---------------------------------------------------------------------------
-- Sessions
-- ---------------------------------------------------------------------------
CREATE TABLE sessions (
  id              TEXT NOT NULL,
  tenant_id       TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id     TEXT,
  channel         TEXT NOT NULL,
  locale          TEXT,
  state           TEXT NOT NULL DEFAULT 'greeting',
  brief           JSONB NOT NULL DEFAULT '{"constraints":[]}'::jsonb,
  transcript      JSONB NOT NULL DEFAULT '[]'::jsonb,
  cart            JSONB NOT NULL DEFAULT '[]'::jsonb,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_touched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, customer_id)
    REFERENCES customer_profiles(tenant_id, id) ON DELETE SET NULL
);
CREATE INDEX sessions_tenant_id_idx ON sessions (tenant_id);
CREATE INDEX sessions_tenant_last_touched_idx ON sessions (tenant_id, last_touched_at DESC);

-- ---------------------------------------------------------------------------
-- Recommendations / Looks
-- ---------------------------------------------------------------------------
CREATE TABLE recommendations (
  id              TEXT NOT NULL,
  tenant_id       TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  session_id      TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('single','look')),
  items           JSONB NOT NULL,
  rationale       TEXT NOT NULL,
  hero_image_url  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, session_id) REFERENCES sessions(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX recommendations_tenant_session_idx ON recommendations (tenant_id, session_id);

-- ---------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------
CREATE TABLE orders (
  id              TEXT NOT NULL,
  tenant_id       TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  session_id      TEXT NOT NULL,
  sender          JSONB NOT NULL,
  recipients      JSONB NOT NULL,
  lines           JSONB NOT NULL,
  currency        TEXT NOT NULL,
  total           JSONB NOT NULL,
  delivery_date   TIMESTAMPTZ,
  gift_message    TEXT,
  status          TEXT NOT NULL,
  pay_link        TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, session_id) REFERENCES sessions(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX orders_tenant_status_idx ON orders (tenant_id, status);

-- ---------------------------------------------------------------------------
-- Events (conversation, recommendation, order, payment, fulfilment)
-- ---------------------------------------------------------------------------
CREATE TABLE events (
  id          TEXT NOT NULL,
  tenant_id   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('conversation','recommendation','order','payment','fulfilment')),
  payload     JSONB NOT NULL,
  at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX events_tenant_at_idx ON events (tenant_id, at DESC);
CREATE INDEX events_tenant_kind_idx ON events (tenant_id, kind);

COMMIT;
