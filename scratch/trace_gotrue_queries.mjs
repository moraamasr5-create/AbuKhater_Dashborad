import { execSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';

function runSql(sql) {
  const tmpFile = 'scratch/tmp_gotrue_trace_' + Date.now() + '.sql';
  writeFileSync(tmpFile, sql);
  try {
    const out = execSync(`supabase db query --linked -f ${tmpFile}`, { encoding: 'utf-8' });
    return out;
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}

async function traceGoTrueQueries() {
  console.log('--- Tracing GoTrue Simulation Queries ---');
  const testSql = `
    DO $$
    DECLARE
      v_user auth.users%ROWTYPE;
      v_identity auth.identities%ROWTYPE;
      v_session_id uuid := gen_random_uuid();
      v_refresh_id bigint;
    BEGIN
      -- Query 1: Find user by email
      SELECT * INTO v_user FROM auth.users 
      WHERE (instance_id = '00000000-0000-0000-0000-000000000000' OR instance_id IS NULL)
        AND lower(email) = 'admin@abukhater.com'
        AND aud = 'authenticated';
      RAISE NOTICE '1. Find user OK: id=%', v_user.id;

      -- Query 2: Find identities
      SELECT * INTO v_identity FROM auth.identities 
      WHERE user_id = v_user.id LIMIT 1;
      RAISE NOTICE '2. Find identity OK: id=%', v_identity.id;

      -- Query 3: MFA factors
      PERFORM * FROM auth.mfa_factors WHERE user_id = v_user.id;
      RAISE NOTICE '3. MFA factors OK';

      -- Query 4: Insert session
      INSERT INTO auth.sessions (id, user_id, created_at, updated_at, factor_id, aal, not_after)
      VALUES (v_session_id, v_user.id, now(), now(), NULL, 'aal1', now() + INTERVAL '1 hour');
      RAISE NOTICE '4. Insert session OK: id=%', v_session_id;

      -- Query 5: Insert refresh token
      INSERT INTO auth.refresh_tokens (session_id, token, user_id, revoked, created_at, updated_at, parent)
      VALUES (v_session_id, 'test_token_' || gen_random_uuid()::text, v_user.id, false, now(), now(), NULL)
      RETURNING id INTO v_refresh_id;
      RAISE NOTICE '5. Insert refresh token OK: id=%', v_refresh_id;

      -- Query 6: Update user last_sign_in_at
      UPDATE auth.users 
      SET last_sign_in_at = now(), updated_at = now()
      WHERE id = v_user.id;
      RAISE NOTICE '6. Update user OK';

      -- Query 7: Audit log entry
      INSERT INTO auth.audit_log_entries (instance_id, id, payload, created_at, ip_address)
      VALUES ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), '{"action":"login"}'::jsonb, now(), '127.0.0.1');
      RAISE NOTICE '7. Audit log OK';

      -- Rollback simulation changes
      DELETE FROM auth.refresh_tokens WHERE session_id = v_session_id;
      DELETE FROM auth.sessions WHERE id = v_session_id;
      DELETE FROM auth.audit_log_entries WHERE payload->>'action' = 'login';
      RAISE NOTICE 'ALL GOTRUE QUERIES SUCCEEDED!';
    END;
    $$;
  `;
  console.log(runSql(testSql));
}

traceGoTrueQueries().catch(console.error);
