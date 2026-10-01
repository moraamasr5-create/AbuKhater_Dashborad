import { execSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://htpnxizfqmnnkhemvmdz.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh0cG54aXpmcW1ubmtoZW12bWR6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4MTMzODAsImV4cCI6MjA5NDM4OTM4MH0.HFhoKhyf5VrfAXLGdg1I8ndSgiWBSm6fRXMs56V8rjU';

function runSql(sql) {
  const tmpFile = 'scratch/tmp_audit_' + Date.now() + '.sql';
  writeFileSync(tmpFile, sql);
  try {
    const out = execSync(`supabase db query --linked -f ${tmpFile}`, { encoding: 'utf-8' });
    return out;
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}

async function audit() {
  console.log('================================================================');
  console.log('🔍 Comprehensive System & Security Audit Execution');
  console.log('================================================================\n');

  // 1. Audit RLS Status on All Public Tables
  console.log('--- 1. RLS Status on Tables in public schema ---');
  const rlsQuery = `
    SELECT tablename, rowsecurity 
    FROM pg_tables 
    WHERE schemaname = 'public' 
    ORDER BY tablename;
  `;
  console.log(runSql(rlsQuery));

  // 2. Audit All Policies on public schema
  console.log('\n--- 2. Active RLS Policies ---');
  const policiesQuery = `
    SELECT tablename, policyname, permissive, roles, cmd, qual, with_check 
    FROM pg_policies 
    WHERE schemaname = 'public' 
    ORDER BY tablename, policyname;
  `;
  console.log(runSql(policiesQuery));

  // 3. Audit Function Privileges & Security Definer
  console.log('\n--- 3. RPC Functions Security & Search Path ---');
  const funcQuery = `
    SELECT 
      p.proname AS function_name,
      p.prosecdef AS is_security_definer,
      p.provolatile,
      array_to_string(p.proconfig, ', ') AS search_path_config,
      pg_get_userbyid(p.proowner) AS owner
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'create_order', 'create_manual_order', 'submit_reservation', 'submit_feedback',
        'get_customer_order_tracking', 'verify_order_payment', 'calculate_shift_stats',
        'close_shift', 'update_order_status', 'assign_order_pilot', 'update_menu_item_status',
        'toggle_menu_item_availability', 'send_telegram_message', '_require_staff_role', '_is_staff'
      )
    ORDER BY p.proname;
  `;
  console.log(runSql(funcQuery));

  // 4. Audit Table Grants for Anon and Authenticated
  console.log('\n--- 4. Anon & Authenticated Grants on Public Tables ---');
  const grantsQuery = `
    SELECT 
      table_name, 
      grantee, 
      string_agg(privilege_type, ', ') AS privileges
    FROM information_schema.role_table_grants 
    WHERE table_schema = 'public' 
      AND grantee IN ('anon', 'authenticated')
    GROUP BY table_name, grantee
    ORDER BY table_name, grantee;
  `;
  console.log(runSql(grantsQuery));

  // 5. Audit Storage Buckets & Policies
  console.log('\n--- 5. Storage Buckets and Storage Policies ---');
  const storageQuery = `
    SELECT id, name, public, file_size_limit, allowed_mime_types 
    FROM storage.buckets;
  `;
  console.log(runSql(storageQuery));

  const storagePoliciesQuery = `
    SELECT policyname, roles, cmd, qual, with_check 
    FROM pg_policies 
    WHERE schemaname = 'storage' AND tablename = 'objects';
  `;
  console.log(runSql(storagePoliciesQuery));
}

audit().catch(console.error);
