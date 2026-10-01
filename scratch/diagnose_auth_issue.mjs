import { execSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';

function runSql(sql) {
  const tmpFile = 'scratch/tmp_auth_diag_' + Date.now() + '.sql';
  writeFileSync(tmpFile, sql);
  try {
    const out = execSync(`supabase db query --linked -f ${tmpFile}`, { encoding: 'utf-8' });
    return out;
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}

async function diagnoseAuth() {
  console.log('================================================================');
  console.log('🕵️‍♂️ Deep Auth Diagnosis: Database Error Querying Schema');
  console.log('================================================================\n');

  // 1. Check all triggers on auth.users
  console.log('--- 1. Triggers on auth.users ---');
  const triggersSql = `
    SELECT 
      tgname AS trigger_name,
      relname AS table_name,
      proname AS function_name,
      tgtype,
      tgenabled,
      pg_get_triggerdef(t.oid) AS trigger_definition
    FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    JOIN pg_proc p ON t.tgfoid = p.oid
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE n.nspname = 'auth' AND c.relname = 'users';
  `;
  console.log(runSql(triggersSql));

  // 2. Check all triggers in auth schema
  console.log('\n--- 2. All Triggers in auth schema ---');
  const allAuthTriggersSql = `
    SELECT 
      tgname AS trigger_name,
      c.relname AS table_name,
      p.proname AS function_name,
      pg_get_triggerdef(t.oid) AS trigger_definition
    FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    JOIN pg_proc p ON t.tgfoid = p.oid
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE n.nspname = 'auth';
  `;
  console.log(runSql(allAuthTriggersSql));

  // 3. Check existing users in auth.users
  console.log('\n--- 3. Users in auth.users ---');
  const usersSql = `
    SELECT 
      id, 
      aud, 
      role, 
      email, 
      encrypted_password IS NOT NULL AS has_encrypted_password,
      email_confirmed_at, 
      confirmed_at,
      last_sign_in_at, 
      raw_app_meta_data, 
      raw_user_meta_data, 
      is_super_admin, 
      created_at, 
      updated_at,
      banned_until,
      deleted_at
    FROM auth.users
    ORDER BY created_at;
  `;
  console.log(runSql(usersSql));

  // 4. Check identities in auth.identities
  console.log('\n--- 4. Identities in auth.identities ---');
  const identitiesSql = `
    SELECT id, user_id, provider, identity_data, last_sign_in_at, created_at, updated_at
    FROM auth.identities;
  `;
  console.log(runSql(identitiesSql));

  // 5. Check staff_roles table
  console.log('\n--- 5. Records in public.staff_roles ---');
  const staffRolesSql = `
    SELECT user_id, email, role, display_name, is_active, created_at
    FROM public.staff_roles;
  `;
  console.log(runSql(staffRolesSql));

  // 6. Check profiles table
  console.log('\n--- 6. Records in public.profiles ---');
  const profilesSql = `
    SELECT *
    FROM public.profiles;
  `;
  console.log(runSql(profilesSql));

  // 7. Check delivery table (pilots)
  console.log('\n--- 7. Records in public.delivery ---');
  const deliverySql = `
    SELECT id, name, phone, state, shift_started_at, total_minutes, orders_count, shift_used
    FROM public.delivery;
  `;
  console.log(runSql(deliverySql));

  // 8. Check Database & Role Settings (search_path, etc.)
  console.log('\n--- 8. Database & Role Settings ---');
  const dbSettingsSql = `
    SELECT r.rolname, d.setdatabase, d.setrole, unnest(d.setconfig) AS config
    FROM pg_db_role_setting d
    LEFT JOIN pg_roles r ON d.setrole = r.oid;
  `;
  console.log(runSql(dbSettingsSql));

  // 9. Check permissions on auth schema for supabase_auth_admin, anon, authenticated, postgres
  console.log('\n--- 9. Permissions on auth schema ---');
  const schemaPermsSql = `
    SELECT 
      grantee, 
      privilege_type
    FROM information_schema.schema_privileges
    WHERE schema_name = 'auth';
  `;
  console.log(runSql(schemaPermsSql));

  // 10. Check permissions on auth tables
  console.log('\n--- 10. Table Permissions in auth schema ---');
  const authTablePermsSql = `
    SELECT 
      table_name, 
      grantee, 
      string_agg(privilege_type, ', ') AS privileges
    FROM information_schema.role_table_grants 
    WHERE table_schema = 'auth'
    GROUP BY table_name, grantee
    ORDER BY table_name, grantee;
  `;
  console.log(runSql(authTablePermsSql));
}

diagnoseAuth().catch(console.error);
