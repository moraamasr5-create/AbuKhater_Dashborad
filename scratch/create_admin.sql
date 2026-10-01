DO $$
DECLARE
  v_uid uuid := 'a1111111-1111-1111-1111-111111111111';
BEGIN
  -- Delete any old .local entries
  DELETE FROM public.staff_roles WHERE email LIKE '%@abukhater.local';
  DELETE FROM auth.identities WHERE email LIKE '%@abukhater.local';
  DELETE FROM auth.users WHERE email LIKE '%@abukhater.local';

  INSERT INTO auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    is_super_admin,
    created_at,
    updated_at,
    is_sso_user,
    is_anonymous
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',
    v_uid,
    'authenticated',
    'authenticated',
    'admin@abukhater.com',
    extensions.crypt('SecureStaffPass123!', extensions.gen_salt('bf', 10)),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Admin User"}',
    false,
    now(),
    now(),
    false,
    false
  ) ON CONFLICT (id) DO UPDATE
  SET email = 'admin@abukhater.com',
      encrypted_password = extensions.crypt('SecureStaffPass123!', extensions.gen_salt('bf', 10)),
      email_confirmed_at = now();

  INSERT INTO auth.identities (
    id,
    user_id,
    provider_id,
    identity_data,
    provider,
    last_sign_in_at,
    created_at,
    updated_at
  ) VALUES (
    v_uid,
    v_uid,
    'a1111111-1111-1111-1111-111111111111',
    '{"sub":"a1111111-1111-1111-1111-111111111111","email":"admin@abukhater.com","email_verified":true}'::jsonb,
    'email',
    now(),
    now(),
    now()
  ) ON CONFLICT (provider, provider_id) DO UPDATE
  SET identity_data = '{"sub":"a1111111-1111-1111-1111-111111111111","email":"admin@abukhater.com","email_verified":true}'::jsonb;

  INSERT INTO public.staff_roles (user_id, email, role, display_name, is_active)
  VALUES (v_uid, 'admin@abukhater.com', 'admin', 'Super Admin', true)
  ON CONFLICT (user_id) DO UPDATE
  SET email = 'admin@abukhater.com', role = 'admin', is_active = true;
END;
$$;
