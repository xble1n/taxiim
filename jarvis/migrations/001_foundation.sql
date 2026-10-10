-- JARVIS foundation schema. PostgreSQL 15+ / PGlite compatible.
-- Money is stored as integer cents. EUR is the reporting currency.

CREATE TABLE IF NOT EXISTS schema_migrations (
  name TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- owner & auth
CREATE TABLE IF NOT EXISTS owner (
  id INTEGER PRIMARY KEY CHECK (id = 1),           -- single-owner system
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,                     -- scrypt, see server/security/crypto.ts
  totp_secret_enc TEXT,                            -- AES-256-GCM with JARVIS_MASTER_KEY
  totp_enabled BOOLEAN NOT NULL DEFAULT false,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  last_totp_step BIGINT NOT NULL DEFAULT 0,        -- replay protection for TOTP codes
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,                 -- sha256 of the cookie token; raw token never stored
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip TEXT,
  user_agent TEXT,
  mfa_verified BOOLEAN NOT NULL DEFAULT false,
  red_until TIMESTAMPTZ,                           -- RED PROTOCOL active while now() < red_until
  revoked_at TIMESTAMPTZ
);

-- Tamper-evident, append-only audit trail (hash chain).
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor TEXT NOT NULL,                             -- owner | jarvis | system | scheduler | anonymous
  action TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',        -- security | permission | finance | agent | data | general
  level INTEGER,
  target TEXT,
  outcome TEXT NOT NULL,                           -- success | denied | pending | failure
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,       -- always passed through redact()
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_log_ts_idx ON audit_log (ts DESC);
CREATE INDEX IF NOT EXISTS audit_log_category_idx ON audit_log (category);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- permissions
CREATE TABLE IF NOT EXISTS standing_authorizations (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tool TEXT NOT NULL,
  level INTEGER NOT NULL,
  max_uses INTEGER NOT NULL CHECK (max_uses > 0),
  uses INTEGER NOT NULL DEFAULT 0,
  max_amount_cents BIGINT,                         -- per-invocation monetary ceiling (EUR cents)
  expires_at TIMESTAMPTZ NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS approvals (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tool TEXT NOT NULL,
  level INTEGER NOT NULL,
  input JSONB NOT NULL,
  summary TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  requires_red BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'pending',          -- pending | approved | rejected | expired | executed | failed
  result JSONB,
  decision_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS approvals_status_idx ON approvals (status);

-- ---------------------------------------------------------------- memory & knowledge
CREATE TABLE IF NOT EXISTS memories (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind TEXT NOT NULL,                              -- preference | decision | project | config | lesson | fact | business
  content TEXT NOT NULL,
  tags TEXT[] NOT NULL DEFAULT '{}',
  source TEXT NOT NULL,                            -- owner | jarvis
  pinned BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  tsv TSVECTOR GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED
);
CREATE INDEX IF NOT EXISTS memories_tsv_idx ON memories USING GIN (tsv);

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title TEXT NOT NULL,
  source_url TEXT,
  source_type TEXT NOT NULL,                       -- url | note | research | file
  retrieved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ,
  license_note TEXT,
  content_chars INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS document_chunks (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  content TEXT NOT NULL,
  tsv TSVECTOR GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED
);
CREATE INDEX IF NOT EXISTS document_chunks_tsv_idx ON document_chunks USING GIN (tsv);

CREATE TABLE IF NOT EXISTS research_reports (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  question TEXT NOT NULL,
  status TEXT NOT NULL,                            -- running | complete | failed
  report TEXT,
  sources JSONB NOT NULL DEFAULT '[]'::jsonb,      -- [{url,title,page_age}]
  model TEXT,
  error TEXT,
  usage JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

-- ---------------------------------------------------------------- operator chat
CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,                              -- user | assistant (API content stored verbatim)
  content JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- projects
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',           -- active | paused | done | dropped
  priority INTEGER NOT NULL DEFAULT 3,             -- 1 (highest) .. 5
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'todo',             -- todo | in_progress | blocked | done
  priority INTEGER NOT NULL DEFAULT 3,
  due_on DATE,
  blocked_reason TEXT,
  created_by TEXT NOT NULL DEFAULT 'owner',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- business engine
CREATE TABLE IF NOT EXISTS opportunities (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title TEXT NOT NULL,
  segment TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price_cents BIGINT NOT NULL DEFAULT 0,           -- one-off sale price
  recurring_monthly_cents BIGINT NOT NULL DEFAULT 0,
  acquisition_cost_cents BIGINT NOT NULL DEFAULT 0,
  delivery_cost_cents BIGINT NOT NULL DEFAULT 0,
  probability REAL NOT NULL DEFAULT 0.1 CHECK (probability >= 0 AND probability <= 1),
  time_to_revenue_days INTEGER NOT NULL DEFAULT 30,
  conversion_assumptions TEXT NOT NULL DEFAULT '',
  evidence TEXT NOT NULL DEFAULT '',
  risks TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'idea',             -- idea | validating | active | paused | dropped
  created_by TEXT NOT NULL DEFAULT 'owner',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS leads (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company TEXT NOT NULL,
  contact_name TEXT,
  email TEXT,
  phone TEXT,
  website TEXT,
  segment TEXT,
  source TEXT NOT NULL,                            -- where the lead came from (URL, referral, inbound...)
  consent_basis TEXT NOT NULL DEFAULT 'none',      -- none | inbound | existing_relationship | legitimate_interest_b2b | explicit_consent
  stage TEXT NOT NULL DEFAULT 'new',               -- new | qualified | contacted | meeting | proposal | negotiation | won | lost
  est_value_cents BIGINT NOT NULL DEFAULT 0,
  probability REAL NOT NULL DEFAULT 0.1,
  opportunity_id INTEGER REFERENCES opportunities(id) ON DELETE SET NULL,
  next_action TEXT,
  next_action_due DATE,
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT 'owner',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS lead_activities (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                              -- note | stage_change | outreach_draft | email | call | meeting
  summary TEXT NOT NULL,
  actor TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Drafts (outreach, proposals) are LEVEL 2 artifacts: never sent by creating them.
CREATE TABLE IF NOT EXISTS drafts (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind TEXT NOT NULL,                              -- outreach | proposal | contract | other
  lead_id INTEGER REFERENCES leads(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',            -- draft | approved | sent | discarded
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  lead_id INTEGER REFERENCES leads(id) ON DELETE SET NULL,
  client_name TEXT NOT NULL,
  issue_date DATE NOT NULL,
  due_date DATE NOT NULL,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  currency TEXT NOT NULL DEFAULT 'EUR',
  status TEXT NOT NULL DEFAULT 'draft',            -- draft | sent | paid | void
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ledger. Only owner-verified rows count toward revenue.
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_on DATE NOT NULL,
  type TEXT NOT NULL,                              -- payment_received | expense | refund | chargeback | internal_transfer | adjustment
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  currency TEXT NOT NULL DEFAULT 'EUR',
  fx_rate_to_eur NUMERIC(18,8) NOT NULL DEFAULT 1, -- owner-supplied; never fetched silently
  eur_cents BIGINT NOT NULL,
  counterparty TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
  recurring BOOLEAN NOT NULL DEFAULT false,
  payment_method TEXT NOT NULL DEFAULT 'bank',     -- bank | card | crypto | cash | other
  tx_hash TEXT,                                    -- on-chain transactions
  network TEXT,
  confirmations INTEGER,
  verification_status TEXT NOT NULL DEFAULT 'unverified', -- unverified | verified | rejected
  verification_method TEXT,                        -- bank_statement | processor_dashboard | onchain_explorer | receipt | other
  verification_evidence TEXT,
  verified_at TIMESTAMPTZ,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS transactions_month_idx ON transactions (occurred_on);

CREATE TABLE IF NOT EXISTS monthly_cycles (
  month TEXT PRIMARY KEY,                          -- YYYY-MM
  target_cents BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',           -- active | met | review | closed
  plan JSONB NOT NULL DEFAULT '{}'::jsonb,
  review JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ
);

-- Owner-designated crypto destinations. Never stores keys or seed phrases.
CREATE TABLE IF NOT EXISTS crypto_destinations (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  address TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL DEFAULT '',
  network TEXT,                                    -- e.g. ethereum, bsc, arbitrum — confirmed by owner
  asset TEXT,                                      -- e.g. USDT, USDC, ETH
  status TEXT NOT NULL DEFAULT 'unverified',       -- unverified | verified | disabled
  notes TEXT NOT NULL DEFAULT '',
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- operations
CREATE TABLE IF NOT EXISTS jobs (
  name TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  interval_seconds INTEGER NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_status TEXT,
  last_error TEXT,
  last_duration_ms INTEGER
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  severity TEXT NOT NULL DEFAULT 'info',           -- info | warning | critical
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  link TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS system_events (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  severity TEXT NOT NULL,                          -- debug | info | warning | error
  source TEXT NOT NULL,
  message TEXT NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS system_events_ts_idx ON system_events (ts DESC);

CREATE TABLE IF NOT EXISTS llm_usage (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  purpose TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  web_searches INTEGER NOT NULL DEFAULT 0,
  est_cost_usd NUMERIC(12,6) NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  ok BOOLEAN NOT NULL
);
