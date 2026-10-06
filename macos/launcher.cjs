const { spawn } = require('node:child_process');
const path = require('node:path');

// All renderer descendants share this group; EOF also handles native-app crashes.
const child = spawn(process.execPath, [path.join(__dirname, 'server.cjs')], {
  detached: true,
  stdio: ['ignore', 'inherit', 'inherit'],
});
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  if (!child.pid) return process.exit(1);
  try { process.kill(-child.pid, 'SIGTERM'); } catch { /* Already exited. */ }
  setTimeout(() => {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Already exited. */ }
    process.exit(0);
  }, 1500);
}
process.stdin.resume();
process.stdin.on('end', stop);
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
child.on('error', (error) => { console.error(error.message); stop(); });
child.on('exit', stop);
