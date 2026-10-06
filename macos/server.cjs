const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { createRequire } = require('node:module');

async function main() {
  const { LYRICA_RESOURCES: resources, LYRICA_DATA: data, LYRICA_TOKEN: token } = process.env;
  if (!resources || !data || !token) throw new Error('Missing desktop launch configuration');
  const runtime = path.join(resources, 'runtime');
  const buildID = fs.readFileSync(path.join(runtime, '.next/BUILD_ID'), 'utf8').trim();
  const workspace = path.join(data, 'runtime', buildID);
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(path.join(data, 'tmp'), { recursive: true });
  for (const name of ['node_modules', 'src', 'public', 'package.json', 'tsconfig.json']) {
    const target = path.join(workspace, name);
    // Refresh links after moving the app (e.g. Downloads -> Applications).
    try { fs.unlinkSync(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    fs.symlinkSync(path.join(runtime, name), target);
  }
  // Next and the Remotion bundler may write caches; never write inside the signed app.
  if (!fs.existsSync(path.join(workspace, '.next'))) {
    fs.cpSync(path.join(runtime, '.next'), path.join(workspace, '.next'), { recursive: true, verbatimSymlinks: true });
  }
  // Keep external-package links relative on subsequent launches after relocation.
  const externalPackages = path.join(runtime, '.next/node_modules');
  if (fs.existsSync(externalPackages)) {
    const destination = path.join(workspace, '.next/node_modules');
    fs.rmSync(destination, { recursive: true, force: true });
    fs.cpSync(externalPackages, destination, { recursive: true, verbatimSymlinks: true });
  }
  if (!fs.existsSync(path.join(workspace, 'tmp'))) fs.symlinkSync(path.join(data, 'tmp'), path.join(workspace, 'tmp'));
  process.chdir(workspace);
  const settings = path.join(data, '.env.local');
  if (fs.existsSync(settings)) process.loadEnvFile(settings);
  const requireRuntime = createRequire(path.join(runtime, 'package.json'));
  const config = JSON.parse(fs.readFileSync(path.join(workspace, '.next/required-server-files.json'), 'utf8')).config;
  const port = Number(process.env.LYRICA_PORT || 47831);
  const origin = `http://127.0.0.1:${port}`;
  const app = requireRuntime('next')({ dev: false, dir: workspace, conf: config, hostname: '127.0.0.1', port });
  await app.prepare();
  const handler = app.getRequestHandler();
  const server = http.createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.headers.host !== `127.0.0.1:${port}` ||
        (req.headers.origin && req.headers.origin !== origin) || req.headers['sec-fetch-site'] === 'cross-site') {
      res.writeHead(403).end('Forbidden'); return;
    }
    const bearer = req.headers.authorization === `Bearer ${token}`;
    if (req.url === '/_desktop/session' && bearer) {
      res.writeHead(303, { Location: '/', 'Set-Cookie': `lyrica-desktop=${token}; HttpOnly; SameSite=Strict; Path=/` }).end();
      return;
    }
    const cookie = (req.headers.cookie || '').split(';').some((value) => value.trim() === `lyrica-desktop=${token}`);
    if (!bearer && !cookie) { res.writeHead(401).end('Unauthorized'); return; }
    if (req.url === '/_desktop/health') { res.writeHead(200).end('ready'); return; }
    Promise.resolve(handler(req, res)).catch((error) => {
      console.error(error);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  server.on('error', (error) => { console.error(error.message); process.exit(1); });
  server.listen(port, '127.0.0.1', () => console.log(`Lyrica desktop ready on ${origin}`));
}
main().catch((error) => { console.error(error); process.exit(1); });
