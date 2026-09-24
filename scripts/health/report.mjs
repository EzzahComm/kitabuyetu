#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Codebase health report — the measurement half of the continuous-optimization
// loop (see docs/health/README.md).
//
// Collects, without adding dependencies:
//   accuracy   → jest coverage totals        (coverage/coverage-summary.json)
//   efficiency → client JS shipped, server output size   (.next/ after a build)
//   security   → production dependency vulnerabilities   (npm audit)
//   hygiene    → type-safety escapes, lint suppressions, TODOs, oversized files
//
// Each section is optional: a missing input is reported as "not measured",
// never as zero, so a partial run can't masquerade as an improvement.
//
// Usage:
//   node scripts/health/report.mjs                       # write .health/report.{json,md}
//   node scripts/health/report.mjs --baseline <file>     # add deltas vs a baseline
//   node scripts/health/report.mjs --baseline <file> --strict
//                                                        # exit 1 on any regression
//   node scripts/health/report.mjs --write-baseline <file>
//                                                        # promote this run to baseline
// ─────────────────────────────────────────────────────────────────────────────
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

const ROOT = process.cwd();
const OUT_DIR = join(ROOT, '.health');
const SOURCE_DIRS = ['app', 'components', 'lib', 'hooks', 'providers', 'types'];
const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs)$/;
const LARGE_FILE_LINES = 600;

// Direction each metric should move. Used for delta arrows and --strict.
// `tolerance` absorbs noise (build hashes, minifier drift) before calling it a regression.
const METRICS = {
  'coverage.lines': { better: 'up', tolerance: 0.5, unit: '%' },
  'coverage.branches': { better: 'up', tolerance: 0.5, unit: '%' },
  'coverage.functions': { better: 'up', tolerance: 0.5, unit: '%' },
  'bundle.clientJsKb': { better: 'down', tolerance: 5, unit: ' KB' },
  'bundle.largestChunkKb': { better: 'down', tolerance: 5, unit: ' KB' },
  'bundle.serverKb': { better: 'down', tolerance: 50, unit: ' KB' },
  'audit.critical': { better: 'down', tolerance: 0, unit: '' },
  'audit.high': { better: 'down', tolerance: 0, unit: '' },
  'audit.moderate': { better: 'down', tolerance: 0, unit: '' },
  'hygiene.explicitAny': { better: 'down', tolerance: 0, unit: '' },
  'hygiene.tsSuppressions': { better: 'down', tolerance: 0, unit: '' },
  'hygiene.eslintSuppressions': { better: 'down', tolerance: 0, unit: '' },
  'hygiene.consoleLog': { better: 'down', tolerance: 0, unit: '' },
  'hygiene.todos': { better: 'down', tolerance: 0, unit: '' },
  'hygiene.largeFiles': { better: 'down', tolerance: 0, unit: '' },
};

const args = process.argv.slice(2);
const argValue = (flag) => {
  const i = args.indexOf(flag);
  return i === -1 ? undefined : args[i + 1];
};

// ── Collectors ───────────────────────────────────────────────────────────────

function collectCoverage() {
  const file = join(ROOT, 'coverage', 'coverage-summary.json');
  if (!existsSync(file)) return null;
  const { total } = JSON.parse(readFileSync(file, 'utf8'));
  return {
    lines: total.lines.pct,
    branches: total.branches.pct,
    functions: total.functions.pct,
    statements: total.statements.pct,
  };
}

function walk(dir, visit) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, visit);
    else visit(full);
  }
}

function dirSizeKb(dir, filter = () => true) {
  let bytes = 0;
  walk(dir, (f) => {
    if (filter(f)) bytes += statSync(f).size;
  });
  return Math.round(bytes / 1024);
}

function collectBundle() {
  const nextDir = join(ROOT, '.next');
  if (!existsSync(join(nextDir, 'BUILD_ID'))) return null;
  const chunks = [];
  walk(join(nextDir, 'static'), (f) => {
    if (f.endsWith('.js')) chunks.push({ file: relative(nextDir, f), kb: statSync(f).size / 1024 });
  });
  chunks.sort((a, b) => b.kb - a.kb);
  return {
    clientJsKb: Math.round(chunks.reduce((sum, c) => sum + c.kb, 0)),
    largestChunkKb: Math.round(chunks[0]?.kb ?? 0),
    serverKb: dirSizeKb(join(nextDir, 'server'), (f) => f.endsWith('.js')),
    topChunks: chunks.slice(0, 5).map((c) => ({ file: c.file, kb: Math.round(c.kb) })),
  };
}

function collectAudit() {
  let raw;
  try {
    raw = execFileSync('npm', ['audit', '--omit=dev', '--json'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    // npm audit exits non-zero when it finds anything; the JSON is still on stdout.
    raw = err.stdout;
  }
  try {
    const v = JSON.parse(raw).metadata.vulnerabilities;
    return { critical: v.critical, high: v.high, moderate: v.moderate, low: v.low };
  } catch {
    return null; // offline, registry error, or no lockfile
  }
}

function collectHygiene() {
  const counts = {
    explicitAny: 0,
    tsSuppressions: 0,
    eslintSuppressions: 0,
    consoleLog: 0,
    todos: 0,
    largeFiles: 0,
  };
  const largest = [];
  for (const dir of SOURCE_DIRS) {
    walk(join(ROOT, dir), (f) => {
      if (!SOURCE_EXT.test(f) || f.endsWith('.d.ts')) return;
      const text = readFileSync(f, 'utf8');
      const count = (re) => (text.match(re) ?? []).length;
      counts.explicitAny += count(/:\s*any\b|\bas any\b|<any>/g);
      counts.tsSuppressions += count(/@ts-(ignore|nocheck|expect-error)/g);
      counts.eslintSuppressions += count(/eslint-disable/g);
      counts.consoleLog += count(/console\.log\(/g);
      counts.todos += count(/\b(TODO|FIXME|HACK|XXX)\b/g);
      const lines = text.split('\n').length;
      if (lines > LARGE_FILE_LINES) {
        counts.largeFiles += 1;
        largest.push({ file: relative(ROOT, f), lines });
      }
    });
  }
  largest.sort((a, b) => b.lines - a.lines);
  return { ...counts, largestFiles: largest.slice(0, 10) };
}

// ── Comparison ───────────────────────────────────────────────────────────────

const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

function compare(current, baseline) {
  const rows = [];
  for (const [path, spec] of Object.entries(METRICS)) {
    const now = get(current, path);
    const before = get(baseline, path);
    if (typeof now !== 'number' || typeof before !== 'number') continue;
    const delta = +(now - before).toFixed(2);
    const signed = spec.better === 'up' ? delta : -delta;
    const status = signed > 0 ? 'improved' : signed < -spec.tolerance ? 'regressed' : 'unchanged';
    rows.push({ metric: path, before, now, delta, status, unit: spec.unit });
  }
  return rows;
}

// ── Rendering ────────────────────────────────────────────────────────────────

const fmt = (v, unit = '') => (v == null ? '_not measured_' : `${v}${unit}`);

function renderMarkdown(report, deltas) {
  const { coverage: c, bundle: b, audit: a, hygiene: h } = report;
  const out = [
    `# Codebase health — ${report.generatedAt.slice(0, 10)}`,
    '',
    `Commit \`${report.commit}\``,
    '',
    '| Area | Metric | Value |',
    '|---|---|---|',
    `| Accuracy | Line coverage (lib/) | ${fmt(c?.lines, '%')} |`,
    `| Accuracy | Branch coverage (lib/) | ${fmt(c?.branches, '%')} |`,
    `| Accuracy | Function coverage (lib/) | ${fmt(c?.functions, '%')} |`,
    `| Efficiency | Client JS total | ${fmt(b?.clientJsKb, ' KB')} |`,
    `| Efficiency | Largest client chunk | ${fmt(b?.largestChunkKb, ' KB')} |`,
    `| Efficiency | Server output | ${fmt(b?.serverKb, ' KB')} |`,
    `| Security | Prod vulns critical / high / moderate | ${
      a ? `${a.critical} / ${a.high} / ${a.moderate}` : '_not measured_'
    } |`,
    `| Hygiene | Explicit \`any\` | ${h.explicitAny} |`,
    `| Hygiene | \`@ts-*\` suppressions | ${h.tsSuppressions} |`,
    `| Hygiene | \`eslint-disable\` | ${h.eslintSuppressions} |`,
    `| Hygiene | \`console.log\` | ${h.consoleLog} |`,
    `| Hygiene | TODO / FIXME | ${h.todos} |`,
    `| Hygiene | Files > ${LARGE_FILE_LINES} lines | ${h.largeFiles} |`,
  ];
  if (deltas) {
    const icon = { improved: '🟢', regressed: '🔴', unchanged: '⚪' };
    out.push('', '## Change vs baseline', '', '| | Metric | Baseline | Now | Δ |', '|---|---|---|---|---|');
    for (const d of deltas) {
      out.push(
        `| ${icon[d.status]} | ${d.metric} | ${d.before}${d.unit} | ${d.now}${d.unit} | ${d.delta > 0 ? '+' : ''}${d.delta} |`,
      );
    }
  }
  if (b?.topChunks?.length) {
    out.push('', '## Largest client chunks', '');
    for (const ch of b.topChunks) out.push(`- \`${ch.file}\` — ${ch.kb} KB`);
  }
  if (h.largestFiles.length) {
    out.push('', '## Largest source files (split candidates)', '');
    for (const f of h.largestFiles) out.push(`- \`${f.file}\` — ${f.lines} lines`);
  }
  return out.join('\n') + '\n';
}

// ── Main ─────────────────────────────────────────────────────────────────────

function gitCommit() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  commit: gitCommit(),
  coverage: collectCoverage(),
  bundle: collectBundle(),
  audit: args.includes('--no-audit') ? null : collectAudit(),
  hygiene: collectHygiene(),
};

const baselinePath = argValue('--baseline');
const baseline = baselinePath && existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, 'utf8')) : null;
const deltas = baseline ? compare(report, baseline) : null;

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, 'report.json'), JSON.stringify({ ...report, deltas }, null, 2) + '\n');
const markdown = renderMarkdown(report, deltas);
writeFileSync(join(OUT_DIR, 'report.md'), markdown);
process.stdout.write(markdown);

const baselineOut = argValue('--write-baseline');
if (baselineOut) {
  mkdirSync(dirname(baselineOut), { recursive: true });
  writeFileSync(baselineOut, JSON.stringify(report, null, 2) + '\n');
  console.error(`Baseline written to ${baselineOut}`);
}

if (args.includes('--strict') && deltas?.some((d) => d.status === 'regressed')) {
  const bad = deltas.filter((d) => d.status === 'regressed').map((d) => d.metric);
  console.error(`Health regression vs baseline: ${bad.join(', ')}`);
  process.exit(1);
}
