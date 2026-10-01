import { execSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';

function runSql(sql) {
  const tmpFile = 'scratch/tmp_test_' + Date.now() + '.sql';
  writeFileSync(tmpFile, sql);
  try {
    return execSync(`supabase db query --linked -f ${tmpFile}`, { encoding: 'utf-8' });
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}

async function traceAdminQueries() {
  const sql = `
    DO $$
    DECLARE
      v_user auth.users%ROWTYPE;
      v_ident auth.identities%ROWTYPE;
      v_factor auth.mfa_factors%ROWTYPE;
      v_sess auth.sessions%ROWTYPE;
      v_ott auth.one_time_tokens%ROWTYPE;
      v_webauthn auth.webauthn_credentials%ROWTYPE;
    BEGIN
      -- Set role to supabase_auth_admin
      SET LOCAL ROLE supabase_auth_admin;
      RAISE NOTICE 'Role is supabase_auth_admin';

      -- 1. Query user
      SELECT * INTO v_user FROM auth.users WHERE lower(email) = 'admin@abukhater.com' AND aud = 'authenticated';
      RAISE NOTICE '1. User query OK, id = %', v_user.id;

      -- 2. Query identities
      FOR v_ident IN SELECT * FROM auth.identities WHERE user_id = v_user.id LOOP
        RAISE NOTICE '2. Identity found: %', v_ident.id;
      END LOOP;
      RAISE NOTICE '2. Identities query OK';

      -- 3. Query mfa_factors
      FOR v_factor IN SELECT * FROM auth.mfa_factors WHERE user_id = v_user.id LOOP
        RAISE NOTICE '3. MFA Factor found: %', v_factor.id;
      END LOOP;
      RAISE NOTICE '3. MFA factors query OK';

      -- 4. Query sessions
      FOR v_sess IN SELECT * FROM auth.sessions WHERE user_id = v_user.id LOOP
        RAISE NOTICE '4. Session found: %', v_sess.id;
      END LOOP;
      RAISE NOTICE '4. Sessions query OK';

      -- 5. Query one_time_tokens
      FOR v_ott IN SELECT * FROM auth.one_time_tokens WHERE user_id = v_user.id LOOP
        RAISE NOTICE '5. OTT found: %', v_ott.id;
      END LOOP;
      RAISE NOTICE '5. OTT query OK';

      -- 6. Query webauthn_credentials
      FOR v_webauthn IN SELECT * FROM auth.webauthn_credentials WHERE user_id = v_user.id LOOP
        RAISE NOTICE '6. WebAuthn found: %', v_webauthn.id;
      END LOOP;
      RAISE NOTICE '6. WebAuthn query OK';

      -- 7. Query sso_providers
      PERFORM * FROM auth.sso_providers;
      RAISE NOTICE '7. SSO providers query OK';

      -- 8. Query saml_providers
      PERFORM * FROM auth.saml_providers;
      RAISE NOTICE '8. SAML providers query OK';

      -- 9. Query flow_state
      PERFORM * FROM auth.flow_state;
      RAISE NOTICE '9. Flow state query OK';
    END;
    $$;
  `;
  console.log(runSql(sql));
}

traceAdminQueries().catch(console.error);
