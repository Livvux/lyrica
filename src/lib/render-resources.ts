import os from "node:os";
import { readFile } from "node:fs/promises";

export function cpuQuotaLimit(quota: string | null, period?: string | null): number | undefined {
  if (!quota) return undefined;
  const parts = quota.trim().split(/\s+/);
  const budget = Number(parts[0]);
  const interval = Number(period ?? parts[1]);
  return budget > 0 && interval > 0 ? Math.max(1, Math.floor(budget / interval)) : undefined;
}

export async function availableRenderCpus(): Promise<number> {
  const available = os.availableParallelism();
  const read = (file: string) => readFile(file, "utf8").catch(() => null);
  const v2 = cpuQuotaLimit(await read("/sys/fs/cgroup/cpu.max"));
  if (v2) return Math.min(available, v2);
  const [quota, period] = await Promise.all([
    read("/sys/fs/cgroup/cpu/cpu.cfs_quota_us"),
    read("/sys/fs/cgroup/cpu/cpu.cfs_period_us"),
  ]);
  return Math.min(available, cpuQuotaLimit(quota, period) ?? available);
}

export function chooseRenderConcurrency({ cpus, totalMb, availableMb, workerMb, durationSec, hardCap, override }: {
  cpus: number; totalMb: number; availableMb: number; workerMb: number;
  durationSec: number; hardCap: number; override?: string;
}): { concurrency: number; budgetMb: number; workerBudgetMb: number; overridden: boolean } {
  // Decoded stereo PCM plus analysis overhead is retained in every renderer tab.
  const workerBudgetMb = workerMb + Math.ceil(durationSec * 48000 * 2 * 4 * 2 / 1024 / 1024);
  const budgetMb = Math.max(0, Math.min(totalMb * 0.7, availableMb - 768));
  const memoryCap = Math.max(1, Math.floor(budgetMb / workerBudgetMb));
  const auto = Math.max(1, Math.min(Math.max(1, cpus - 1), hardCap, memoryCap));
  const requested = override && /^[1-9]\d*$/.test(override) ? Number(override) : 0;
  const overridden = Number.isSafeInteger(requested) && requested > 0;
  return { concurrency: overridden ? requested : auto, budgetMb, workerBudgetMb, overridden };
}
