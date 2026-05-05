-- Database-backed roster for dashboard and snapshot tracking.
CREATE TABLE IF NOT EXISTS players (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('ea', 'steam', 'epic', 'psn', 'xbox')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  display_order INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (name, platform)
);

CREATE INDEX IF NOT EXISTS idx_players_active_order
  ON players (active, display_order, created_at);

INSERT INTO players (name, display_name, platform, display_order)
VALUES
  ('redFrog40', 'Nic', 'steam', 10),
  ('magicpinoy650', 'Jamal', 'ea', 20),
  ('jaimehra2000', 'Jai', 'ea', 30),
  ('STATnMELO650', 'Adi', 'ea', 40),
  ('CastingC0uch945', 'Ryan', 'ea', 50),
  ('nmetzger123', 'Metz', 'ea', 60),
  ('ra1ca', 'Nathan', 'steam', 70),
  ('Coffeesquirts89', 'Poo', 'ea', 80),
  ('mrnudebanana', 'MrBanana', 'ea', 90)
ON CONFLICT (name, platform) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  display_order = EXCLUDED.display_order,
  active = TRUE,
  updated_at = NOW();
