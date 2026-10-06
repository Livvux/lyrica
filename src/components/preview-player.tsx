"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Player } from "@remotion/player";
import type { CallbackListener, PlayerRef } from "@remotion/player";
import { LyricsVideo } from "@/remotion/lyrics-video";
import { adaptPreviewQuality, initialPreviewQuality } from "@/lib/preview-quality";
import type { PreviewQuality, PreviewQualityMode, QualitySample } from "@/lib/preview-quality";
import type { VideoConfig } from "@/types/lyrics";

const LABELS: Record<PreviewQualityMode, string> = {
  auto: "Automatisch", low: "Sparsam", balanced: "Ausgewogen", high: "Volle Details",
};

function PreviewPlayerComponent({ config }: { config: VideoConfig }) {
  const player = useRef<PlayerRef>(null);
  const [mode, setMode] = useState<PreviewQualityMode>("auto");
  const [automatic, setAutomatic] = useState<PreviewQuality>("balanced");
  const [fps, setFps] = useState<number | null>(null);
  const quality = mode === "auto" ? automatic : mode;
  const inputProps = useMemo(() => ({ ...config, previewQuality: quality }), [config, quality]);

  useEffect(() => {
    const instance = player.current;
    if (!instance) return;
    const memory = "deviceMemory" in navigator && typeof navigator.deviceMemory === "number"
      ? navigator.deviceMemory : undefined;
    let state: QualitySample = {
      quality: initialPreviewQuality(navigator.hardwareConcurrency || 4, memory),
      slowWindows: 0, healthyWindows: 0,
    };
    setAutomatic(state.quality);
    let start = 0;
    let delivered = 0;
    let lastFrame = -1;
    let buffering = false;
    let rate = 1;
    const reset = () => { start = 0; delivered = 0; lastFrame = -1; };
    const suspend = () => { reset(); setFps(null); };
    const waiting = () => { buffering = true; suspend(); };
    const resume = () => { buffering = false; reset(); };
    const ratechange: CallbackListener<"ratechange"> = ({ detail }) => { rate = detail.playbackRate; reset(); };
    const frameupdate: CallbackListener<"frameupdate"> = ({ detail }) => {
      if (!instance.isPlaying() || buffering || document.hidden) { reset(); return; }
      const now = performance.now();
      if (!start || detail.frame <= lastFrame) { reset(); start = now; }
      if (detail.frame !== lastFrame) delivered++;
      lastFrame = detail.frame;
      const elapsed = now - start;
      if (elapsed < 3000) return;
      const measured = (delivered - 1) * 1000 / elapsed;
      setFps(Math.round(measured));
      if (mode === "auto") {
        state = adaptPreviewQuality(state, measured / (config.fps * rate));
        setAutomatic(state.quality);
      }
      reset();
    };
    instance.addEventListener("frameupdate", frameupdate);
    instance.addEventListener("play", reset);
    instance.addEventListener("pause", suspend);
    instance.addEventListener("seeked", reset);
    instance.addEventListener("waiting", waiting);
    instance.addEventListener("resume", resume);
    instance.addEventListener("ratechange", ratechange);
    document.addEventListener("visibilitychange", suspend);
    return () => {
      instance.removeEventListener("frameupdate", frameupdate);
      instance.removeEventListener("play", reset);
      instance.removeEventListener("pause", suspend);
      instance.removeEventListener("seeked", reset);
      instance.removeEventListener("waiting", waiting);
      instance.removeEventListener("resume", resume);
      instance.removeEventListener("ratechange", ratechange);
      document.removeEventListener("visibilitychange", suspend);
    };
  }, [config.audioUrl, config.fps, mode]);

  return (
    <section className="w-full overflow-hidden rounded-2xl border border-white/10" aria-label="Video-Vorschau">
      <div className="relative w-full" style={{ aspectRatio: `${config.width}/${config.height}` }}>
        <Player
          ref={player}
          component={LyricsVideo}
          inputProps={inputProps}
          durationInFrames={config.durationInFrames}
          fps={config.fps}
          compositionWidth={config.width}
          compositionHeight={config.height}
          style={{ width: "100%", height: "100%" }}
          controls
          autoPlay={false}
          acknowledgeRemotionLicense
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white/5 px-4 py-3">
        <div>
          <p className="text-xs text-white/80">Vorschau · {LABELS[quality]}{fps !== null ? ` · ${fps} fps` : ""}</p>
          <p className="mt-1 text-xs text-white/45">Auto passt Details an dein Gerät an. Exportqualität bleibt separat.</p>
        </div>
        <select aria-label="Vorschauqualität" value={mode}
          onChange={(event) => setMode(event.target.value as PreviewQualityMode)}
          className="rounded-lg border border-white/15 bg-neutral-900 px-3 py-2 text-xs text-white">
          {Object.entries(LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>
    </section>
  );
}

export const PreviewPlayer = memo(PreviewPlayerComponent);
