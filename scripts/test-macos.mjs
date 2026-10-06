import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readdirSync, readFileSync, readlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import http from 'node:http';

const resources = path.resolve(process.env.LYRICA_TEST_RESOURCES || 'dist/Lyrica.app/Contents/Resources');
const data = mkdtempSync(path.join(tmpdir(), 'lyrica-desktop-test-'));
const origin = 'http://127.0.0.1:47832';
// Isolated disposable QA server; never used by the desktop app itself.
const token = 'lyrica-disposable-build-test';
const headers = { Authorization: `Bearer ${token}` };
const child = spawn(path.join(resources, 'bin/node'), [path.join(resources, 'desktop/launcher.cjs')], {
  env: {
    HOME: process.env.HOME, TMPDIR: tmpdir(), NODE_ENV: 'production',
    PATH: `${resources}/bin:/usr/bin:/bin`, LYRICA_RESOURCES: resources,
    LYRICA_DATA: data, LYRICA_TOKEN: token, LYRICA_PORT: '47832',
    CHROME_EXECUTABLE: `${resources}/browser/chrome-headless-shell`,
    FFMPEG_PATH: `${resources}/bin/ffmpeg`, RENDER_CONCURRENCY: '2',
  },
  stdio: ['pipe', 'inherit', 'inherit'],
});

async function stop() {
  child.stdin.end();
  await delay(2200);
  assert.notEqual(child.exitCode, null, 'Supervisor must exit after native-app pipe closes');
  await assert.rejects(fetch(`${origin}/_desktop/health`, { headers }), 'Server must release its listener');
  rmSync(data, { recursive: true, force: true });
}

try {
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    try { ready = (await fetch(`${origin}/_desktop/health`, { headers })).ok; } catch { /* Starting. */ }
    if (ready) break;
    if (child.exitCode !== null) throw new Error('Desktop server exited during startup');
    await delay(500);
  }
  assert.ok(ready, 'Bundled server starts');
  const buildID = readFileSync(path.join(resources, 'runtime/.next/BUILD_ID'), 'utf8').trim();
  const externals = path.join(data, 'runtime', buildID, '.next/node_modules');
  for (const entry of readdirSync(externals, { recursive: true, withFileTypes: true })) {
    if (entry.isSymbolicLink()) {
      assert.ok(!path.isAbsolute(readlinkSync(path.join(entry.parentPath, entry.name))), 'Runtime links must survive moving the app');
    }
  }
  assert.equal((await fetch(origin)).status, 401);
  assert.equal((await fetch(origin, { headers: { ...headers, Origin: 'https://example.org' } })).status, 403);
  // fetch normalizes Host; use the HTTP client to exercise an actual foreign Host.
  const foreignHostStatus = await new Promise((resolve, reject) => {
    http.get(origin, { headers: { ...headers, Host: 'example.org:47832' } }, (response) => {
      response.resume();
      resolve(response.statusCode);
    }).on('error', reject);
  });
  assert.equal(foreignHostStatus, 403);
  assert.equal((await fetch(origin, { headers })).status, 200);
  const session = await fetch(`${origin}/_desktop/session`, { headers, redirect: 'manual' });
  assert.equal(session.status, 303);
  assert.match(session.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  const audio = execFileSync(`${resources}/bin/ffmpeg`, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-f', 'wav', 'pipe:1']);
  const form = new FormData();
  form.append('audio', new Blob([audio], { type: 'audio/wav' }), 'desktop-test.wav');
  const upload = await fetch(`${origin}/api/upload-audio`, { method: 'POST', headers, body: form });
  assert.equal(upload.status, 200);
  const { audioFilename } = await upload.json();
  const audioURL = `/api/audio/${audioFilename}`;
  assert.equal((await fetch(origin + audioURL, { headers: { ...headers, Range: 'bytes=0-31' } })).status, 206);
  const render = await fetch(`${origin}/api/render`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      audioUrl: audioURL, lines: [], durationInFrames: 60, fps: 30, width: 1280, height: 720, renderQuality: 'fast',
      style: { fontSize: 76, fontFamily: 'Arial', textColor: '#ffffff', bgImage: '/bg-default.jpg', bgType: 'image',
        effectIntensity: 'subtle', beatReactive: true, animationVariant: 'fade-drift', visualizerMode: 'spectrum',
        logoScale: 100, customLogo: null, postEffect: 'none', showWatermark: true,
        waveConfig: { colors: ['#164e63', '#0891b2', '#22d3ee', '#67e8f9', '#ecfeff'], gain: 220, radius: 140, points: 32, spread: 0.55 } },
    }),
  });
  assert.equal(render.status, 200);
  const events = (await render.text()).split('\n').filter((line) => line.startsWith('data: ')).map((line) => JSON.parse(line.slice(6)));
  assert.ok(!events.some((event) => event.error), JSON.stringify(events.filter((event) => event.error)));
  const done = events.find((event) => event.filename);
  assert.ok(done, JSON.stringify(events.slice(-4)));
  const video = await fetch(`${origin}/api/render/${done.filename}`, { headers });
  assert.equal(video.status, 200);
  assert.ok((await video.arrayBuffer()).byteLength > 1000);
  const probe = JSON.parse(execFileSync(`${resources}/bin/ffprobe`, ['-v', 'error', '-show_streams', '-of', 'json', path.join(data, 'tmp/lyrica', done.filename)], { encoding: 'utf8' }));
  assert.ok(probe.streams.some((stream) => stream.codec_name === 'h264' && stream.width === 1280 && stream.height === 720));
  assert.ok(probe.streams.some((stream) => stream.codec_type === 'audio'));
  console.log('PASS: packaged runtime, access isolation, upload, byte ranges, 720p H.264 + audio export');
  if (process.argv.includes('--serve')) {
    console.log('Disposable browser QA server ready on port 47832; stop with SIGINT.');
    await new Promise((resolve) => { process.once('SIGINT', resolve); process.once('SIGTERM', resolve); });
  }
} finally {
  await stop();
}
console.log('PASS: shutdown closes server and supervisor');
