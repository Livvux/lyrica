import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import ts from 'typescript';

const origin = process.env.LYRICA_TEST_ORIGIN ?? 'http://127.0.0.1:47833';
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname), 'Use a disposable local server');
const quality = process.env.LYRICA_TEST_QUALITY ?? 'balanced';
assert.ok(['fast', 'balanced', 'quality'].includes(quality));
const destination = path.resolve('tmp/editor-qa');
mkdirSync(destination, { recursive: true });
const samples = Float32Array.from({ length: 4 * 22050 }, (_, i) => 0.35 * Math.sin(2 * Math.PI * (440 * (Math.floor(i / 22050) + 1)) * i / 22050));
const compiled = ts.transpileModule(readFileSync('src/lib/audio-analysis.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const { analyzeAudio } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`);
const analysisStarted = performance.now();
const audioAnalysis = analyzeAudio(samples, 22050);
const analysisMs = performance.now() - analysisStarted;
const audio = execFileSync('ffmpeg', ['-v', 'error', '-f', 'f32le', '-ar', '22050', '-ac', '1', '-i', 'pipe:0', '-f', 'wav', 'pipe:1'], { input: Buffer.from(samples.buffer) });
const form = new FormData();
form.append('audio', new Blob([audio], { type: 'audio/wav' }), 'editor-acceptance.wav');
const upload = await fetch(`${origin}/api/upload-audio`, { method: 'POST', body: form });
assert.equal(upload.status, 200);
const { audioFilename } = await upload.json();
const style = {
  fontSize: 76, fontFamily: 'Arial', textColor: '#ffffff', bgImage: '/bg-default.jpg', bgType: 'image',
  effectIntensity: 'subtle', beatReactive: true, animationVariant: 'karaoke', visualizerMode: 'waves',
  logoScale: 100, customLogo: null, postEffect: 'none', showWatermark: true,
  waveConfig: { colors: ['#164e63', '#0891b2', '#22d3ee', '#67e8f9', '#ecfeff'], gain: 220, radius: 140, points: 32, spread: 0.55 },
};
const measurements = [];
for (const [ratio, width, height] of [['16:9', 1920, 1080], ['9:16', 1080, 1920], ['1:1', 1080, 1080], ['4:5', 1080, 1350]]) {
  const config = { audioUrl: `/api/audio/${audioFilename}`, audioAnalysis, beatSensitivity: 1, manualBeats: [1, 1.5, 2, 2.5],
    lines: [{ text: 'Follow the night', startFrame: 30, endFrame: 90, startSec: 1, endSec: 3,
      words: [{ word: 'Follow', startSec: 1, endSec: 1.6 }, { word: 'the', startSec: 1.6, endSec: 2 }, { word: 'night', startSec: 2, endSec: 3 }] }],
    style, durationInFrames: 120, fps: 30, width, height, clipStartFrame: 30, clipEndFrame: 90, renderQuality: quality };
  let response;
  let started;
  for (let attempt = 0; attempt < 8; attempt++) {
    started = performance.now();
    response = await fetch(`${origin}/api/render`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) });
    if (response.status !== 429) break;
    await response.text();
    await delay(10000);
  }
  assert.equal(response.status, 200);
  const events = (await response.text()).split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6)));
  assert.ok(!events.some(event => event.phase === 'error'), JSON.stringify(events.slice(-3)));
  const filename = events.find(event => event.phase === 'done')?.filename;
  assert.ok(filename);
  const elapsedSec = (performance.now() - started) / 1000;
  const download = await fetch(`${origin}/api/render/${filename}`);
  assert.equal(download.status, 200);
  const file = path.join(destination, `${ratio.replace(':', '-')}-${quality}.mp4`);
  writeFileSync(file, Buffer.from(await download.arrayBuffer()));
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]));
  const video = probe.streams.find(stream => stream.codec_type === 'video');
  assert.equal(video.codec_name, 'h264');
  assert.equal(video.width, quality === 'fast' ? width * 2 / 3 : width);
  assert.equal(video.height, quality === 'fast' ? height * 2 / 3 : height);
  assert.equal(video.r_frame_rate, quality === 'fast' ? '24/1' : '30/1');
  assert.ok(Math.abs(Number(video.duration) - 2) < 0.05);
  assert.ok(probe.streams.some(stream => stream.codec_name === 'aac'));
  // The 1–3s clip must contain 880Hz then1320Hz, not the source's first440Hz second.
  const pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'f32le', '-ac', '1', '-ar', '22050', 'pipe:1']);
  function crossings(at) {
    let count = 0;
    for (let i = Math.round(at * 22050); i < Math.round((at + 0.2) * 22050); i++) {
      if (pcm.readFloatLE(i * 4) <= 0 && pcm.readFloatLE((i + 1) * 4) > 0) count++;
    }
    return count / 0.2;
  }
  assert.ok(Math.abs(crossings(0.2) - 880) < 30, 'Clip audio starts at source second1');
  assert.ok(Math.abs(crossings(1.2) - 1320) < 30, 'Clip audio follows source clock');
  measurements.push({ ratio, quality, width: video.width, height: video.height, fps: video.r_frame_rate, videoDuration: video.duration, elapsedSec: Number(elapsedSec.toFixed(2)), file });
  console.log(`PASS ${ratio} ${video.width}x${video.height} ${video.r_frame_rate} H264/AAC, clip audio sync, ${elapsedSec.toFixed(2)}s wall time`);
}
writeFileSync(path.join(destination, `report-${quality}.json`), JSON.stringify({ analysisMs, measurements }, null, 2));
console.log(`PASS analysis ${analysisMs.toFixed(2)}ms; artifacts ${destination}`);
