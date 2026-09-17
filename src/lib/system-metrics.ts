import os from "os";
import { readFile } from "fs/promises";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export interface SystemMetrics {
  cpuPercent: number;
  memUsedMb: number;
  memTotalMb: number;
  memPercent: number;
}

let prevCpuIdle = 0;
let prevCpuTotal = 0;

function getCpuUsage(): number {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    idle += cpu.times.idle;
    total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.irq + cpu.times.idle;
  }

  const idleDelta = idle - prevCpuIdle;
  const totalDelta = total - prevCpuTotal;
  prevCpuIdle = idle;
  prevCpuTotal = total;

  if (totalDelta === 0) return 0;
  return Math.round((1 - idleDelta / totalDelta) * 100);
}

async function getContainerMemory(): Promise<{ used: number; total: number } | null> {
  try {
    // cgroup v2 (modern Docker)
    const [usageStr, limitStr] = await Promise.all([
      readFile("/sys/fs/cgroup/memory.current", "utf-8").catch(() => null),
      readFile("/sys/fs/cgroup/memory.max", "utf-8").catch(() => null),
    ]);
    if (usageStr && limitStr && limitStr.trim() !== "max") {
      return {
        used: parseInt(usageStr.trim(), 10),
        total: parseInt(limitStr.trim(), 10),
      };
    }

    // cgroup v1 fallback
    const [usageV1, limitV1] = await Promise.all([
      readFile("/sys/fs/cgroup/memory/memory.usage_in_bytes", "utf-8").catch(() => null),
      readFile("/sys/fs/cgroup/memory/memory.limit_in_bytes", "utf-8").catch(() => null),
    ]);
    if (usageV1 && limitV1) {
      return {
        used: parseInt(usageV1.trim(), 10),
        total: parseInt(limitV1.trim(), 10),
      };
    }
  } catch {
    // Not in a container
  }
  return null;
}

async function getDarwinMemory(): Promise<{ used: number; total: number } | null> {
  if (process.platform !== "darwin") return null;

  try {
    const { stdout } = await execFileAsync("vm_stat");
    const pageSizeMatch = stdout.match(/page size of (\d+) bytes/);
    const pageSize = pageSizeMatch ? Number.parseInt(pageSizeMatch[1], 10) : 16384;

    const readPages = (label: string): number => {
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const match = stdout.match(new RegExp(`${escaped}:\\s+(\\d+)\\.`));
      return match ? Number.parseInt(match[1], 10) : 0;
    };

    const activePages = readPages("Pages active");
    const wiredPages = readPages("Pages wired down");
    const compressorPages = readPages("Pages occupied by compressor");
    const used = (activePages + wiredPages + compressorPages) * pageSize;

    return { used, total: os.totalmem() };
  } catch {
    return null;
  }
}

export async function collectMetrics(): Promise<SystemMetrics> {
  const cpuPercent = getCpuUsage();

  const container = await getContainerMemory();
  if (container) {
    const memUsedMb = Math.round(container.used / 1024 / 1024);
    const memTotalMb = Math.round(container.total / 1024 / 1024);
    return {
      cpuPercent,
      memUsedMb,
      memTotalMb,
      memPercent: Math.round((container.used / container.total) * 100),
    };
  }

  const darwin = await getDarwinMemory();
  if (darwin) {
    const memUsedMb = Math.round(darwin.used / 1024 / 1024);
    const memTotalMb = Math.round(darwin.total / 1024 / 1024);
    return {
      cpuPercent,
      memUsedMb,
      memTotalMb,
      memPercent: Math.round((darwin.used / darwin.total) * 100),
    };
  }

  // Fallback: OS-level memory
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  return {
    cpuPercent,
    memUsedMb: Math.round(usedMem / 1024 / 1024),
    memTotalMb: Math.round(totalMem / 1024 / 1024),
    memPercent: Math.round((usedMem / totalMem) * 100),
  };
}

export interface RenderSummary {
  totalFrames: number;
  totalTimeSec: number;
  avgFps: number;
  concurrency: number;
  cpuCount: number;
  peakCpuPercent: number;
  peakMemMb: number;
  memTotalMb: number;
  resolution: string;
  quality: string;
  hints: string[];
}

export function generateHints(summary: RenderSummary): string[] {
  const hints: string[] = [];

  const memPercent = Math.round((summary.peakMemMb / summary.memTotalMb) * 100);

  if (summary.peakCpuPercent < 50) {
    if (memPercent > 70) {
      hints.push(`CPU nur ${summary.peakCpuPercent}% — RAM (${memPercent}%) ist der Engpass, nicht CPU. Concurrency bewusst begrenzt (${summary.concurrency} Worker)`);
    } else {
      hints.push(`CPU nur ${summary.peakCpuPercent}% ausgelastet — Concurrency könnte höher sein (aktuell ${summary.concurrency} Worker, ${summary.cpuCount} CPUs verfügbar)`);
    }
  } else if (summary.peakCpuPercent > 90) {
    hints.push(`CPU bei ${summary.peakCpuPercent}% — voll ausgelastet, mehr CPUs würden helfen`);
  } else {
    hints.push(`CPU-Auslastung: ${summary.peakCpuPercent}% — gute Nutzung`);
  }

  if (memPercent < 30) {
    hints.push(`RAM nur ${memPercent}% genutzt (${summary.peakMemMb} MB / ${summary.memTotalMb} MB) — Concurrency könnte höher sein`);
  } else if (memPercent > 80) {
    hints.push(`RAM bei ${memPercent}% — zu knapp, Concurrency reduzieren`);
  } else {
    hints.push(`RAM-Nutzung: ${memPercent}% (${summary.peakMemMb} MB / ${summary.memTotalMb} MB) — passt`);
  }

  if (summary.avgFps < 5) {
    hints.push(`Render-Speed: ${summary.avgFps.toFixed(1)} fps — langsam. Effekte (SVG-Filter, Particles) prüfen`);
  } else if (summary.avgFps < 15) {
    hints.push(`Render-Speed: ${summary.avgFps.toFixed(1)} fps — akzeptabel`);
  } else {
    hints.push(`Render-Speed: ${summary.avgFps.toFixed(1)} fps — schnell`);
  }

  const ratio = summary.totalTimeSec / (summary.totalFrames / 30);
  if (ratio > 3) {
    hints.push(`Render dauert ${ratio.toFixed(1)}× länger als Videodauer — GPU-Server würde massiv helfen`);
  } else if (ratio > 1.5) {
    hints.push(`Render dauert ${ratio.toFixed(1)}× länger als Videodauer — ok für CPU-Rendering`);
  } else {
    hints.push(`Render schneller als Echtzeit — exzellent`);
  }

  return hints;
}
