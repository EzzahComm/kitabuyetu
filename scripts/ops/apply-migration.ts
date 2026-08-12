/**
 * Apply a single migration file to the database in DATABASE_URL and record it
 * in supabase_migrations.schema_migrations.
 *
 * Migrations on this project are NOT applied automatically — a green Vercel
 * deploy proves the code shipped, never that the schema moved. Anything that
 * depends on new DDL (a new column, a new constraint an ON CONFLICT names)
 * must be applied here first, or the deploy starts throwing on the live path.
 *
 *   npx tsx --env-file=.env.local scripts/ops/apply-migration.ts <file>
 *   npx tsx --env-file=.env.local scripts/ops/apply-migration.ts <file> --apply
 *
 * Without --apply it prints the SQL and reports whether the version is already
 * recorded, changing nothing. The whole file runs inside one transaction, so a
 * failure part-way leaves the schema untouched.
 *
 * The version recorded is the file's own numeric prefix, so the tracking table
 * agrees with what is in the repo.
 */
import { readFileSync } from 'fs';
import { basename } from 'path';
import { pool } from '../../lib/db';

function parseName(file: string): { version: string; name: string } {
  const base  = basename(file).replace(/\.sql$/, '');
  const match = base.match(/^(\d+)_(.+)$/);
  if (!match) {
    throw new Error(`Migration filename must be <version>_<name>.sql — got "${base}"`);
  }
  return { version: match[1], name: match[2] };
}

async function main() {
  const file  = process.argv[2];
  const apply = process.argv.includes('--apply');
  if (!file) {
    console.error('Usage: apply-migration.ts <path-to-migration.sql> [--apply]');
    process.exit(1);
  }

  const { version, name } = parseName(file);
  const sql = readFileSync(file, 'utf8');

  const client = await pool.connect();
  try {
    const { rows: already } = await client.query<{ version: string }>(
      `SELECT version FROM supabase_migrations.schema_migrations WHERE version = $1`,
      [version],
    );
    if (already[0]) {
      console.log(`Version ${version} (${name}) is already recorded — nothing to do.`);
      return;
    }

    if (!apply) {
      console.log(`Would apply version ${version} (${name}):\n`);
      console.log(sql);
      console.log('\nDry run — re-run with --apply to execute.');
      return;
    }

    await client.query('BEGIN');
    await client.query(sql);
    await client.query(
      `INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
       VALUES ($1, $2, $3)`,
      [version, name, [sql]],
    );
    await client.query('COMMIT');
    console.log(`Applied and recorded ${version} (${name}).`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
