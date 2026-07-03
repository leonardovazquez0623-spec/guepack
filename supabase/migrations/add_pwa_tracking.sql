-- Tracking de instalación PWA por cliente
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS pwa_instalada BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS pwa_prompt_pospuesto_at TIMESTAMPTZ;
