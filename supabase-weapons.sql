-- Optional but recommended for weapon Ask tools.
-- Run in the Supabase SQL Editor, then call POST /api/weapons/import with CRON_SECRET.

CREATE TABLE IF NOT EXISTS weapon_catalog (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  game TEXT NOT NULL DEFAULT 'BF6-BR',
  rpm REAL NOT NULL DEFAULT 0,
  bv REAL NOT NULL DEFAULT 0,
  mag_size REAL NOT NULL DEFAULT 0,
  hipfire REAL NOT NULL DEFAULT 0,
  reload REAL NOT NULL DEFAULT 0,
  ads REAL NOT NULL DEFAULT 0,
  control REAL NOT NULL DEFAULT 0,
  mobility REAL NOT NULL DEFAULT 0,
  precision REAL NOT NULL DEFAULT 0,
  headshot_multiplier REAL NOT NULL DEFAULT 1,
  obd REAL NOT NULL DEFAULT 0,
  damage_json JSONB NOT NULL DEFAULT '[]',
  source TEXT NOT NULL DEFAULT 'codmunity',
  source_version TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS weapon_attachments (
  id TEXT PRIMARY KEY,
  weapon_name TEXT NOT NULL,
  name TEXT NOT NULL,
  slot TEXT NOT NULL,
  game TEXT NOT NULL DEFAULT 'BF6-BR',
  mods_json JSONB NOT NULL DEFAULT '{}',
  range_mod REAL,
  damage_profile_json JSONB,
  source TEXT NOT NULL DEFAULT 'codmunity',
  source_version TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_weapon_catalog_game_name ON weapon_catalog (game, name);
CREATE INDEX IF NOT EXISTS idx_weapon_catalog_category ON weapon_catalog (category);
CREATE INDEX IF NOT EXISTS idx_weapon_attachments_weapon ON weapon_attachments (weapon_name);
CREATE INDEX IF NOT EXISTS idx_weapon_attachments_game ON weapon_attachments (game);

ALTER TABLE weapon_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE weapon_attachments ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS trg_weapon_catalog_updated_at ON weapon_catalog;
CREATE TRIGGER trg_weapon_catalog_updated_at
  BEFORE UPDATE ON weapon_catalog
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_weapon_attachments_updated_at ON weapon_attachments;
CREATE TRIGGER trg_weapon_attachments_updated_at
  BEFORE UPDATE ON weapon_attachments
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();
