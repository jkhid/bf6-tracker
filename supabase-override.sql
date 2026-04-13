-- Run this in the Supabase SQL Editor
CREATE TABLE IF NOT EXISTS tracking_override (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  active_until TIMESTAMPTZ
);

-- Insert a single row (will always be id=1)
INSERT INTO tracking_override (id, active_until)
VALUES (1, NULL)
ON CONFLICT (id) DO NOTHING;
