type PerfMetaValue = string | number | boolean | null | undefined;
type PerfMeta = Record<string, PerfMetaValue>;

const PERF_ENABLED =
  process.env.PERF_LOGS === "1" || process.env.NODE_ENV === "development";

function formatMemDelta(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb >= 0 ? "+" : ""}${mb.toFixed(1)}MB`;
}

function formatMeta(meta?: PerfMeta): string {
  if (!meta) return "";
  const entries = Object.entries(meta).filter(([, value]) => value !== undefined);
  if (entries.length === 0) return "";
  return entries.map(([key, value]) => `${key}=${String(value)}`).join(" ");
}

export function startServerPerf(label: string, meta?: PerfMeta): (endMeta?: PerfMeta) => void {
  if (!PERF_ENABLED) {
    return () => {};
  }

  const startNs = process.hrtime.bigint();
  const startRss = process.memoryUsage().rss;

  return (endMeta?: PerfMeta) => {
    const elapsedMs = Number(process.hrtime.bigint() - startNs) / 1_000_000;
    const rssDelta = process.memoryUsage().rss - startRss;
    const details = formatMeta({ ...meta, ...endMeta });
    const suffix = details ? ` ${details}` : "";
    console.log(
      `[perf] ${label} ${elapsedMs.toFixed(1)}ms rss=${formatMemDelta(rssDelta)}${suffix}`
    );
  };
}
