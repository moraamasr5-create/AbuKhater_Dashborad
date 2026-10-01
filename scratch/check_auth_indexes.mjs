import { execSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';

function runSql(sql) {
  const tmpFile = 'scratch/tmp_auth_idx_' + Date.now() + '.sql';
  writeFileSync(tmpFile, sql);
  try {
    const out = execSync(`supabase db query --linked -f ${tmpFile}`, { encoding: 'utf-8' });
    return out;
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}

async function checkIndexesAndConstraints() {
  console.log('--- 1. Indexes on auth.users ---');
  const userIdxSql = `
    SELECT indexname, indexdef 
    FROM pg_indexes 
    WHERE schemaname = 'auth' AND tablename = 'users';
  `;
  console.log(runSql(userIdxSql));

  console.log('\n--- 2. Constraints on auth.users ---');
  const userConSql = `
    SELECT conname, contype, pg_get_constraintdef(oid) 
    FROM pg_constraint 
    WHERE conrelid = 'auth.users'::regclass;
  `;
  console.log(runSql(userConSql));

  console.log('\n--- 3. Indexes on auth.identities ---');
  const identIdxSql = `
    SELECT indexname, indexdef 
    FROM pg_indexes 
    WHERE schemaname = 'auth' AND tablename = 'identities';
  `;
  console.log(runSql(identIdxSql));

  console.log('\n--- 4. Constraints on auth.identities ---');
  const identConSql = `
    SELECT conname, contype, pg_get_constraintdef(oid) 
    FROM pg_constraint 
    WHERE conrelid = 'auth.identities'::regclass;
  `;
  console.log(runSql(identConSql));

  console.log('\n--- 5. Foreign keys pointing to auth.users from other schemas ---');
  const fkeysSql = `
    SELECT 
      conname,
      conrelid::regclass AS table_name,
      pg_get_constraintdef(oid) AS def
    FROM pg_constraint 
    WHERE confrelid = 'auth.users'::regclass;
  `;
  console.log(runSql(fkeysSql));
}

checkIndexesAndConstraints().catch(console.error);
