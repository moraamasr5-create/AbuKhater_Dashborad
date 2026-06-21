-- Create app_config table
CREATE TABLE IF NOT EXISTS public.app_config (
    key text PRIMARY KEY,
    value jsonb NOT NULL,
    description text,
    updated_at timestamp with time zone DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;

-- Allow SELECT for all users
DROP POLICY IF EXISTS app_config_select ON public.app_config;
CREATE POLICY app_config_select ON public.app_config 
  FOR SELECT 
  USING (true);

-- Allow all actions for authenticated users (or standard admin access via studio)
DROP POLICY IF EXISTS app_config_all ON public.app_config;
CREATE POLICY app_config_all ON public.app_config 
  ALL 
  USING (true)
  WITH CHECK (true);

-- Insert default operational settings
INSERT INTO public.app_config (key, value, description) VALUES
('shift_open_time', '"06:00"', 'Shift start hour (24h format HH:MM)'),
('shift_close_time', '"04:00"', 'Shift end hour (24h format HH:MM)'),
('attendance_rate', '15', 'Attendance pay rate in EGP per unit'),
('attendance_minutes_unit', '35', 'Attendance minutes unit (e.g. 35 minutes per unit)'),
('delivery_fee_defaults', '{"tier_1": {"max_km": 3, "fee": 20}, "tier_2": {"max_km": 7, "fee": 30}, "tier_3": {"max_km": 10, "fee": 45}, "tier_4": {"max_km": 15, "fee": 70}, "fallback": 80}', 'Default delivery fees based on distance tiers')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
