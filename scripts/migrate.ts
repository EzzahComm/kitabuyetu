#!/usr/bin/env tsx
import fs from 'fs';
import path from 'path';
import pg from 'pg';

const { Client } = pg;

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version     VARCHAR(10) PRIMARY KEY,
        filename    TEXT        NOT NULL,
        applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const applied = new Set(
      (await client.query<{ version: string }>('SELECT version FROM schema_migrations ORDER BY version'))
        .rows.map((r) => r.version)
    );

    const migrationsDir = path.join(process.cwd(), 'migrations');
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();

    let ran = 0;
    for (const file of files) {
      const version = file.split('_')[0];
      if (applied.has(version)) continue;

      console.log(`Applying ${file}...`);
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');

      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (version, filename) VALUES ($1, $2)', [version, file]);
      await client.query('COMMIT');
      console.log(`  ok ${file}`);
      ran++;
    }

    console.log(ran === 0 ? 'All migrations already applied.' : `\n${ran} migration(s) applied.`);
  } finally {
    await client.end();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
