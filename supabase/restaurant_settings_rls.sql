-- Migration: Enable RLS and permissions for restaurant_settings
-- Project: htpnxizfqmnnkhemvmdz (Abu Khater)
-- Description: Sets up restaurant_settings table with RLS read for anon and write access for dashboard, plus Realtime.

CREATE TABLE IF NOT EXISTS public.restaurant_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,
  value text NOT NULL,
  description text,
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.restaurant_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow anon read restaurant_settings" ON public.restaurant_settings;
CREATE POLICY "Allow anon read restaurant_settings"
  ON public.restaurant_settings
  FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "Allow dashboard modify restaurant_settings" ON public.restaurant_settings;
CREATE POLICY "Allow dashboard modify restaurant_settings"
  ON public.restaurant_settings
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

-- Enable Realtime
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'restaurant_settings'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.restaurant_settings;
  END IF;
END $$;

-- Seed / Sync from app_config
INSERT INTO public.restaurant_settings (key, value, description, updated_at)
SELECT key, value, description, updated_at
FROM public.app_config
WHERE key IN (
  'max_delivery_distance_km',
  'min_delivery_fee',
  'delivery_per_km_rate',
  'min_order_amount',
  'is_restaurant_open',
  'payment_instapay_ipa',
  'payment_wallet_number',
  'payment_account_name',
  'fixed_delivery_zones'
)
ON CONFLICT (key) DO UPDATE SET
  value = EXCLUDED.value,
  description = EXCLUDED.description,
  updated_at = EXCLUDED.updated_at;
