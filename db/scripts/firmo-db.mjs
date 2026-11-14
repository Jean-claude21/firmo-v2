#!/usr/bin/env node
// firmo-db — base locale (PostgreSQL 17, sans conteneur), migrations et tests
// pgTAP. Contrat : specs/001-socle/contracts/db-cli.md.
//
//   node db/scripts/firmo-db.mjs local start|stop|reset|status
//   node db/scripts/firmo-db.mjs migrate [--url <url>] [--neon-shims]
//   node db/scripts/firmo-db.mjs test [--url <url>] [fichier…]
//   node db/scripts/firmo-db.mjs grant-staff <email> admin|support [--url <url>]
//
// Aucune dépendance npm : Node ≥ 22 et les binaires psql, initdb, pg_ctl.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DB_DIR = path.join(ROOT, 'db');
const LOCAL = path.join(ROOT, '.local');
const PGDATA = path.join(LOCAL, 'pgdata');
const PORT = Number(process.env.FIRMO_DB_PORT ?? 54330);
const DB_NAME = 'firmo';
const LOCAL_URL = `postgresql://postgres@localhost:${PORT}/${DB_NAME}`;
const PGTAP_VERSION = '1.3.4';
const isWindows = process.platform === 'win32';

// ---------------------------------------------------------------- utilitaires

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

function bin(name) {
  const exe = isWindows ? `${name}.exe` : name;
  const candidates = [
    process.env.PG_BIN && path.join(process.env.PG_BIN, exe),
    isWindows && path.join('C:\\Program Files\\PostgreSQL\\17\\bin', exe),
  ].filter(Boolean);
  return candidates.find((p) => existsSync(p)) ?? exe;
}

function run(command, args, { input, quiet = false, detached = false, cwd } = {}) {
  const result = spawnSync(command, args, {
    input,
    cwd,
    // Serveur lancé en arrière-plan : il ne doit pas hériter des tubes, sinon
    // l'appel attend sa fin (Windows).
    ...(detached ? { stdio: 'ignore' } : {}),
    encoding: 'utf8',
    env: { ...process.env, PGCLIENTENCODING: 'UTF8' },
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) fail(`${path.basename(command)} introuvable : ${result.error.message}`);
  if (!quiet && result.status !== 0 && result.stderr) process.stderr.write(result.stderr);
  return result;
}

/** Exécute du SQL (ou un script psql) sur `url`. */
function psql(url, input, extra = []) {
  return run(bin('psql'), [url, '-X', '-q', '-v', 'ON_ERROR_STOP=1', ...extra], {
    input,
    quiet: true,
  });
}

/** Valeur scalaire d'une requête. */
function scalar(url, sql) {
  const r = psql(url, sql, ['-tA']);
  if (r.status !== 0) fail(r.stderr.trim());
  return r.stdout.trim();
}

function option(args, name) {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const value = args[i + 1];
  args.splice(i, 2);
  return value;
}

function flag(args, name) {
  const i = args.indexOf(name);
  if (i === -1) return false;
  args.splice(i, 1);
  return true;
}

const slash = (p) => p.replaceAll('\\', '/');
const sha256 = (text) => createHash('sha256').update(text).digest('hex');

function targetUrl(args) {
  return option(args, '--url') ?? process.env.DATABASE_URL ?? LOCAL_URL;
}

function describe(url) {
  try {
    const u = new URL(url);
    return `${u.hostname}:${u.port || 5432}${u.pathname}`;
  } catch {
    return 'base cible';
  }
}

// ---------------------------------------------------------------- base locale

function serverUrl() {
  return `postgresql://postgres@localhost:${PORT}/postgres`;
}

function isRunning() {
  return run(bin('pg_ctl'), ['status', '-D', PGDATA], { quiet: true }).status === 0;
}

function applyShims(url) {
  const r = psql(url, `\\i '${slash(path.join(DB_DIR, 'local', 'neon_shims.sql'))}'`);
  if (r.status !== 0) fail(`imitations Neon : ${r.stderr.trim()}`);
}

function createDatabase() {
  const exists = scalar(serverUrl(), `select 1 from pg_database where datname = '${DB_NAME}'`);
  if (!exists) {
    const r = psql(serverUrl(), `create database ${DB_NAME}`);
    if (r.status !== 0) fail(r.stderr.trim());
  }
  applyShims(LOCAL_URL);
}

function localStart() {
  if (!existsSync(path.join(PGDATA, 'PG_VERSION'))) {
    mkdirSync(LOCAL, { recursive: true });
    const r = run(bin('initdb'), [
      '-D', PGDATA, '-U', 'postgres', '-A', 'trust', '-E', 'UTF8', '--locale=C',
    ]);
    if (r.status !== 0) fail('initdb a échoué');
    appendFileSync(
      path.join(PGDATA, 'postgresql.conf'),
      `\n# firmo-db\nport = ${PORT}\nlisten_addresses = 'localhost'\n`,
    );
    console.log(`• cluster créé dans ${path.relative(ROOT, PGDATA)}`);
  }
  if (!isRunning()) {
    const log = path.join(LOCAL, 'pg.log');
    const r = run(bin('pg_ctl'), ['-D', PGDATA, '-l', log, '-w', 'start'], {
      quiet: true,
      detached: true,
    });
    if (r.status !== 0) {
      const tail = existsSync(log) ? readFileSync(log, 'utf8').split('\n').slice(-8).join('\n') : '';
      fail(`démarrage impossible (port ${PORT} déjà pris ?)\n${tail}`);
    }
  }
  createDatabase();
  console.log(`✓ base locale prête : ${LOCAL_URL}`);
}

function localStop() {
  if (!isRunning()) return console.log('• déjà arrêtée');
  run(bin('pg_ctl'), ['-D', PGDATA, '-m', 'fast', '-w', 'stop']);
  console.log('✓ base locale arrêtée');
}

function localReset() {
  if (!isRunning()) fail('base locale arrêtée : lancer `local start`');
  const r = psql(serverUrl(), `drop database if exists ${DB_NAME} with (force)`);
  if (r.status !== 0) fail(r.stderr.trim());
  createDatabase();
  console.log('✓ base locale réinitialisée');
}

function localStatus() {
  if (isRunning()) {
    console.log(`✓ en marche : ${LOCAL_URL}`);
  } else {
    console.log('• arrêtée');
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------- migrations

function migrationFiles() {
  const dir = path.join(DB_DIR, 'migrations');
  return readdirSync(dir)
    .filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f))
    .sort()
    .map((f) => ({
      version: f.slice(0, 4),
      name: f,
      file: path.join(dir, f),
      checksum: sha256(readFileSync(path.join(dir, f), 'utf8').replaceAll('\r\n', '\n')),
    }));
}

function migrate(args) {
  const shims = flag(args, '--neon-shims');
  const url = targetUrl(args);
  if (shims) applyShims(url);

  const meta = psql(
    url,
    `create schema if not exists firmo_meta;
     create table if not exists firmo_meta.schema_migrations (
       version text primary key,
       name text not null,
       checksum text not null,
       applied_at timestamptz not null default now()
     );`,
  );
  if (meta.status !== 0) fail(meta.stderr.trim());

  const applied = new Map(
    scalar(url, 'select version, checksum from firmo_meta.schema_migrations')
      .split(/\r?\n/) // psql sous Windows : fins de ligne CRLF
      .filter(Boolean)
      .map((line) => line.trim().split('|')),
  );

  let count = 0;
  for (const m of migrationFiles()) {
    const known = applied.get(m.version);
    if (known) {
      if (known !== m.checksum) {
        fail(`${m.name} a changé après application : créer une nouvelle migration`);
      }
      continue;
    }
    const script = [
      'begin;',
      `\\i '${slash(m.file)}'`,
      `insert into firmo_meta.schema_migrations (version, name, checksum)
       values ('${m.version}', '${m.name}', '${m.checksum}');`,
      'commit;',
    ].join('\n');
    const r = psql(url, script);
    if (r.status !== 0) fail(`${m.name}\n${r.stderr.trim()}`);
    console.log(`✓ ${m.name}`);
    count += 1;
  }
  // La Data API garde un cache du schéma : nouvelles fonctions visibles tout
  // de suite (sans effet si personne n'écoute, en local par exemple).
  if (count > 0) psql(url, "notify pgrst, 'reload schema';");
  console.log(
    count === 0
      ? `• aucune migration à appliquer (${describe(url)})`
      : `✓ ${count} migration(s) appliquée(s) sur ${describe(url)}`,
  );
}

// ---------------------------------------------------------------- pgTAP

async function localPgtapSql() {
  const out = path.join(LOCAL, 'pgtap.sql');
  if (existsSync(out)) return out;
  mkdirSync(LOCAL, { recursive: true });
  console.log(`• téléchargement de pgTAP ${PGTAP_VERSION}…`);
  const res = await fetch(`https://api.github.com/repos/theory/pgtap/tarball/v${PGTAP_VERSION}`);
  if (!res.ok) fail(`téléchargement de pgTAP : HTTP ${res.status}`);
  const tarball = path.join(LOCAL, 'pgtap.tar.gz');
  writeFileSync(tarball, Buffer.from(await res.arrayBuffer()));
  const src = path.join(LOCAL, 'pgtap-src');
  mkdirSync(src, { recursive: true });
  // Chemins relatifs : le tar de Git Bash lit « C: » comme un hôte distant.
  const r = run('tar', ['-xzf', 'pgtap.tar.gz', '-C', 'pgtap-src', '--strip-components=1'], { cwd: LOCAL });
  if (r.status !== 0) fail('extraction de pgTAP impossible');
  const sql = readFileSync(path.join(src, 'sql', 'pgtap.sql.in'), 'utf8')
    .replaceAll('MODULE_PATHNAME', 'pgtap')
    .replaceAll('__OS__', process.platform)
    .replaceAll('__VERSION__', PGTAP_VERSION.split('.').slice(0, 2).join('.'));
  writeFileSync(out, sql);
  return out;
}

async function ensurePgtap(url) {
  const installed = scalar(url, "select to_regproc('tap.plan') is not null");
  if (installed === 't') return;
  const available = scalar(
    url,
    "select count(*) from pg_available_extensions where name = 'pgtap'",
  );
  const script =
    available === '1'
      ? 'create schema if not exists tap; create extension if not exists pgtap schema tap;'
      : `create schema if not exists tap; set search_path = tap; \\i '${slash(await localPgtapSql())}'`;
  const r = psql(url, script);
  if (r.status !== 0) fail(`installation de pgTAP : ${r.stderr.trim()}`);
}

function parseTap(output) {
  const lines = output.split(/\r?\n/);
  const plan = lines.map((l) => /^1\.\.(\d+)/.exec(l)).find(Boolean);
  const ok = lines.filter((l) => /^ok \d+/.test(l)).length;
  const notOk = lines.filter((l) => /^not ok \d+/.test(l));
  const diag = lines.filter((l) => l.startsWith('#'));
  return { planned: plan ? Number(plan[1]) : undefined, ok, notOk, diag };
}

async function test(args) {
  const url = targetUrl(args);
  await ensurePgtap(url);

  const dir = path.join(DB_DIR, 'tests');
  const files = args.length
    ? args.map((f) => path.resolve(f))
    : readdirSync(dir)
        .filter((f) => f.endsWith('.sql') && !f.startsWith('_'))
        .sort()
        .map((f) => path.join(dir, f));

  let passed = 0;
  let failed = 0;
  for (const file of files) {
    const script = [
      'begin;',
      'grant usage on schema tap to authenticated, anonymous;',
      'grant execute on all functions in schema tap to authenticated, anonymous;',
      'set local search_path = tap, public;',
      `\\i '${slash(path.join(dir, '_helpers.sql'))}'`,
      `\\i '${slash(file)}'`,
      'rollback;',
    ].join('\n');
    const r = psql(url, script, ['-tA']);
    const tap = parseTap(r.stdout);
    const name = path.basename(file);
    const complete = tap.planned !== undefined && tap.planned === tap.ok + tap.notOk.length;
    if (r.status === 0 && tap.notOk.length === 0 && complete) {
      passed += tap.ok;
      console.log(`✓ ${name} (${tap.ok})`);
      continue;
    }
    failed += Math.max(1, tap.notOk.length);
    passed += tap.ok;
    console.log(`✗ ${name}`);
    for (const line of [...tap.notOk, ...tap.diag]) console.log(`    ${line}`);
    if (!complete && tap.notOk.length === 0) {
      console.log(`    plan ${tap.planned ?? '?'} ≠ ${tap.ok} exécutés`);
    }
    if (r.status !== 0) console.log(`    ${r.stderr.trim().split('\n').join('\n    ')}`);
  }
  console.log(`\n${failed === 0 ? '✓' : '✗'} pgTAP : ${passed} réussis, ${failed} en échec (${describe(url)})`);
  if (failed > 0) process.exit(1);
}

// ---------------------------------------------------------------- équipe

// Rôle d'équipe (admin, support) d'un compte Neon Auth existant. Passe par
// `app.grant_staff` : l'attribution est auditée.
function grantStaff(args) {
  const url = targetUrl(args);
  const [email, role = 'admin'] = args;
  if (!email || !email.includes('@') || !['admin', 'support'].includes(role)) {
    fail('usage : grant-staff <email> admin|support [--url <url>]');
  }
  const r = psql(
    url,
    `select app.grant_staff(
       (select id from neon_auth."user" where lower(email) = lower(:'email')),
       :'role', null);`,
    ['-v', `email=${email}`, '-v', `role=${role}`],
  );
  if (r.status !== 0) fail(`compte introuvable ou refus : ${r.stderr.trim()}`);
  console.log(`✓ rôle ${role} accordé (${describe(url)})`);
}

// ---------------------------------------------------------------- entrée

const [command, ...rest] = process.argv.slice(2);
switch (command) {
  case 'local': {
    const action = rest[0];
    const actions = { start: localStart, stop: localStop, reset: localReset, status: localStatus };
    if (!actions[action]) fail('usage : local start|stop|reset|status');
    actions[action]();
    break;
  }
  case 'migrate':
    migrate(rest);
    break;
  case 'test':
    await test(rest);
    break;
  case 'grant-staff':
    grantStaff(rest);
    break;
  default:
    console.log('usage : firmo-db local start|stop|reset|status · migrate [--url] [--neon-shims] · test [--url] [fichier…] · grant-staff <email> admin|support [--url]');
    process.exitCode = command ? 1 : 0;
}
