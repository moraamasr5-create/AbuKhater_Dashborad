import { execSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';

function runSql(sql) {
  const tmpFile = 'scratch/tmp_auth_all_cols_' + Date.now() + '.sql';
  writeFileSync(tmpFile, sql);
  try {
    const out = execSync(`supabase db query --linked -f ${tmpFile}`, { encoding: 'utf-8' });
    return out;
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}

async function checkAllAuthCols() {
  const sql = `
    SELECT table_name, column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'auth'
    ORDER BY table_name, ordinal_position;
  `;
  console.log(runSql(sql));
}

checkAllAuthCols().catch(console.error);
