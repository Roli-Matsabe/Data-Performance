import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createHmac, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';

// Disposable real PostgreSQL, Supabase Auth and PostgREST. Never uses a cloud DB.
const name = `tsogo-test-${process.pid}`;
const secret = randomBytes(32).toString('hex');
const password = randomBytes(20).toString('hex');
const containers = [];
let gateway;
const run = (command, args, input) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  child.on('error', reject);
  child.on('close', code => code === 0 ? resolve(output.trim()) : reject(new Error(`${command} failed: ${output}`)));
  child.stdin.end(input);
});
const docker = (...args) => run('docker', args);
const sql = value => run('docker', ['exec', '-i', `${name}-db`, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'], value);
const token = role => {
  const head = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ role, iss: 'supabase', iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000)+3600 })).toString('base64url');
  const signature = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${signature}`;
};
async function ready(check, label) {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    try { if (await check()) return; } catch { /* Process is starting. */ }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`${label} did not become ready`);
}
async function container(suffix, args) {
  const id = `${name}-${suffix}`;
  containers.push(id);
  await docker('run', '--detach', '--name', id, '--network', name, ...args);
}
async function port(suffix, inner) {
  return (await docker('port', `${name}-${suffix}`, inner)).trim().split(':').at(-1);
}
try {
  await docker('network', 'create', name);
  await container('db', ['--network-alias', 'db', '-e', `POSTGRES_PASSWORD=${password}`, 'postgres:17-alpine@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24']);
  await ready(async () => (await docker('exec', `${name}-db`, 'pg_isready', '-U', 'postgres')).includes('accepting'), 'PostgreSQL');
  await sql(`create schema auth; create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create role authenticator login password '${password}' noinherit;
    grant anon, authenticated, service_role to authenticator;
    grant usage on schema public to anon, authenticated, service_role;
    create extension if not exists pgcrypto;`);
  await container('auth', ['-p', '127.0.0.1::9999',
    '-e', 'GOTRUE_API_HOST=0.0.0.0', '-e', 'GOTRUE_API_PORT=9999',
    '-e', 'API_EXTERNAL_URL=http://127.0.0.1:9999/auth/v1', '-e', 'GOTRUE_SITE_URL=http://127.0.0.1:3000',
    '-e', 'GOTRUE_DB_DRIVER=postgres', '-e', `GOTRUE_DB_DATABASE_URL=postgres://postgres:${password}@db:5432/postgres?search_path=auth`,
    '-e', `GOTRUE_JWT_SECRET=${secret}`, '-e', 'GOTRUE_JWT_EXP=3600', '-e', 'GOTRUE_JWT_AUD=authenticated',
    '-e', 'GOTRUE_JWT_ADMIN_ROLES=service_role', '-e', 'GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated',
    '-e', 'GOTRUE_EXTERNAL_EMAIL_ENABLED=true', '-e', 'GOTRUE_MAILER_AUTOCONFIRM=true', '-e', 'GOTRUE_DISABLE_SIGNUP=true',
    'supabase/gotrue:v2.177.0@sha256:6a916b47af0386b7e0152ca84f3d45d050bf056e449a75a5460b48742fd67822']);
  const authUrl = `http://127.0.0.1:${await port('auth', '9999/tcp')}`;
  await ready(async () => (await fetch(authUrl + '/health')).ok, 'Supabase Auth');
  await sql(await readFile(new URL('../supabase/migrations/202610140001_dashboard.sql', import.meta.url), 'utf8'));
  await sql("insert into dashboard_private.approved_emails values ('alice@example.test'), ('bob@example.test');");
  await container('rest', ['-p', '127.0.0.1::3000', '-e', `PGRST_DB_URI=postgres://authenticator:${password}@db:5432/postgres`,
    '-e', 'PGRST_DB_SCHEMAS=public', '-e', 'PGRST_DB_ANON_ROLE=anon', '-e', `PGRST_JWT_SECRET=${secret}`, 'postgrest/postgrest:v13.0.7@sha256:0a46780309a604cdc8b56c776c6e5e15788ce58174d709e40459ab5a2d44d228']);
  const restUrl = `http://127.0.0.1:${await port('rest', '3000/tcp')}`;
  await ready(async () => (await fetch(restUrl + '/')).ok, 'PostgREST');
  gateway = createServer(async (request, response) => {
    try {
      const isAuth = request.url.startsWith('/auth/v1/');
      const target = (isAuth ? authUrl : restUrl) + request.url.replace(isAuth ? '/auth/v1' : '/rest/v1', '');
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const headers = new Headers(request.headers);
      headers.delete('host'); headers.delete('connection'); headers.delete('content-length');
      const upstream = await fetch(target, { method: request.method, headers,
        ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) });
      response.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') || 'application/json' });
      response.end(Buffer.from(await upstream.arrayBuffer()));
    } catch { response.writeHead(502); response.end('Local test service unavailable'); }
  });
  gateway.listen(0, '127.0.0.1');
  await once(gateway, 'listening');
  const env = { ...process.env, SUPABASE_URL: `http://127.0.0.1:${gateway.address().port}`, SUPABASE_PUBLISHABLE_KEY: token('anon'),
    TEST_SUPABASE_ADMIN_KEY: token('service_role'), TEST_DATABASE_CONTAINER: `${name}-db`,
    SITE_ORIGIN: 'https://dashboard.example', ALLOWED_EMAILS: 'alice@example.test,bob@example.test' };
  console.log('Running against disposable PostgreSQL, Supabase Auth and PostgREST.');
  const tests = spawn('node', ['--import', 'tsx', '--test', 'tests/reporting.test.mjs', 'tests/supabase.test.mjs'], { env, stdio: 'inherit' });
  const [code] = await once(tests, 'close');
  process.exitCode = code || 0;
} catch (error) {
  console.error(error.message);
  for (const id of containers) {
    try { console.error(await docker('logs', '--tail', '15', id)); } catch { /* Container did not start. */ }
  }
  process.exitCode = 1;
} finally {
  if (gateway) { gateway.closeAllConnections(); gateway.close(); }
  for (const id of containers.reverse()) { try { await docker('rm', '--force', '--volumes', id); } catch { /* Already stopped. */ } }
  try { await docker('network', 'rm', name); } catch { /* Already removed. */ }
}
