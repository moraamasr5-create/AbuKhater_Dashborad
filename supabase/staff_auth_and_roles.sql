-- ============================================================================
-- Phase 1A Migration: Staff Roles & Server-Side Authentication
-- Project: AbuKhater Restaurant Control Center (htpnxizfqmnnkhemvmdz)
-- ----------------------------------------------------------------------------
-- Purpose:
--   1. Create staff_roles table linking auth.users to roles (admin, casher, driver).
--   2. Establish RLS policies for staff profile self-read and admin management.
--   3. Create SECURITY DEFINER helpers (get_my_staff_profile, current_staff_role, has_role).
--   4. Support optional quick_pin for convenience lockscreen / quick-unlock.
-- ============================================================================

-- 1. Create staff_roles table
CREATE TABLE IF NOT EXISTS public.staff_roles (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email        text,
  role         text NOT NULL CHECK (role IN ('admin', 'casher', 'driver')),
  display_name text NOT NULL,
  quick_pin    text, -- Optional 4-6 digit convenience unlock PIN
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Index for fast user lookup
CREATE INDEX IF NOT EXISTS idx_staff_roles_user_id ON public.staff_roles (user_id);
CREATE INDEX IF NOT EXISTS idx_staff_roles_role ON public.staff_roles (role);

-- 2. Helper function to check if current user is admin (SECURITY DEFINER to avoid recursion)
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.staff_roles
    WHERE user_id = auth.uid()
      AND role = 'admin'
      AND is_active = true
  );
END;
$$;

-- 3. Helper function to get current user's role
CREATE OR REPLACE FUNCTION public.current_staff_role()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
BEGIN
  SELECT role INTO v_role
  FROM public.staff_roles
  WHERE user_id = auth.uid()
    AND is_active = true;
  RETURN v_role;
END;
$$;

-- 4. Helper function to verify specific role
CREATE OR REPLACE FUNCTION public.has_role(p_role text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.staff_roles
    WHERE user_id = auth.uid()
      AND role = p_role
      AND is_active = true
  );
END;
$$;

-- 5. RPC to get full staff profile of the authenticated caller
CREATE OR REPLACE FUNCTION public.get_my_staff_profile()
RETURNS TABLE (
  id           uuid,
  user_id      uuid,
  email        text,
  role         text,
  display_name text,
  quick_pin    text,
  is_active    boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.id,
    s.user_id,
    s.email,
    s.role,
    s.display_name,
    s.quick_pin,
    s.is_active
  FROM public.staff_roles s
  WHERE s.user_id = auth.uid();
END;
$$;

-- 6. Enable Row Level Security (RLS) on staff_roles
ALTER TABLE public.staff_roles ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read their own staff record
DROP POLICY IF EXISTS "Staff can read their own profile" ON public.staff_roles;
CREATE POLICY "Staff can read their own profile"
  ON public.staff_roles
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Allow Admins full access to manage all staff roles
DROP POLICY IF EXISTS "Admins can manage all staff roles" ON public.staff_roles;
CREATE POLICY "Admins can manage all staff roles"
  ON public.staff_roles
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- 7. Grants
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.current_staff_role() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.has_role(text) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_my_staff_profile() TO authenticated, anon;
GRANT SELECT ON public.staff_roles TO authenticated;

-- 8. Add staff_roles to realtime publication
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.staff_roles;
    EXCEPTION WHEN duplicate_object THEN
      NULL;
    END;
  END IF;
END;
$$;
