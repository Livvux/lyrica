"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { Player, Thumbnail } from "@remotion/player";
import type { CallbackListener, PlayerRef } from "@remotion/player";
import { LyricsVideo } from "@/remotion/lyrics-video";
import { adaptPreviewQuality, initialPreviewQuality } from "@/lib/preview-quality";
import type { PreviewQuality, QualitySample } from "@/lib/preview-quality";
import type { VideoConfig } from "@/types/lyrics";

function PreviewPlayerComponent({ config, playerRef, onFrameChange }: { config: VideoConfig; playerRef?: RefObject<PlayerRef | null>; onFrameChange?: (frame: number) => void }) {
  const localPlayer = useRef<PlayerRef>(null);
  const player = playerRef ?? localPlayer;
  // Detail level follows measured playback smoothness; no manual knob.
  const [quality, setQuality] = useState<PreviewQuality>("balanced");
  const inputProps = useMemo(() => ({ ...config, previewQuality: quality }), [config, quality]);
  const singleFrame = (config.clipEndFrame ?? config.durationInFrames) - (config.clipStartFrame ?? 0) === 1;

  useEffect(() => {
    const instance = player.current;
    if (!instance) return;
    const update: CallbackListener<"frameupdate"> = ({ detail }) => onFrameChange?.(detail.frame);
    instance.addEventListener("frameupdate", update);
    const start = config.clipStartFrame ?? 0;
    const end = (config.clipEndFrame ?? config.durationInFrames) - 1;
    if (instance.getCurrentFrame() < start || instance.getCurrentFrame() > end) instance.seekTo(start);
    return () => instance.removeEventListener("frameupdate", update);
  }, [player, onFrameChange, config.clipStartFrame, config.clipEndFrame, config.durationInFrames]);

  useEffect(() => {
    const instance = player.current;
    if (!instance) return;
    const memory = "deviceMemory" in navigator && typeof navigator.deviceMemory === "number"
      ? navigator.deviceMemory : undefined;
    let state: QualitySample = {
      quality: initialPreviewQuality(navigator.hardwareConcurrency || 4, memory),
      slowWindows: 0, healthyWindows: 0,
    };
    let disposed = false;
    queueMicrotask(() => { if (!disposed) setQuality(state.quality); });
    let start = 0;
    let delivered = 0;
    let lastFrame = -1;
    let buffering = false;
    let rate = 1;
    const reset = () => { start = 0; delivered = 0; lastFrame = -1; };
    const suspend = reset;
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
      state = adaptPreviewQuality(state, measured / (config.fps * rate));
      setQuality(state.quality);
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
      disposed = true;
      instance.removeEventListener("frameupdate", frameupdate);
      instance.removeEventListener("play", reset);
      instance.removeEventListener("pause", suspend);
      instance.removeEventListener("seeked", reset);
      instance.removeEventListener("waiting", waiting);
      instance.removeEventListener("resume", resume);
      instance.removeEventListener("ratechange", ratechange);
      document.removeEventListener("visibilitychange", suspend);
    };
  }, [config.audioUrl, config.fps, player, singleFrame]);

  return (
    <section className="overflow-hidden rounded-2xl border border-white/10 bg-black" aria-label="Vorschau">
      <div className="relative mx-auto w-full" style={{ aspectRatio: `${config.width}/${config.height}`, maxHeight: "60vh", maxWidth: `min(100%, ${60 * config.width / config.height}vh)` }}>
        {singleFrame ? <Thumbnail component={LyricsVideo} inputProps={inputProps}
          frameToDisplay={config.clipStartFrame ?? 0} durationInFrames={config.durationInFrames}
          fps={config.fps} compositionWidth={config.width} compositionHeight={config.height}
          style={{ width: "100%", height: "100%" }} /> : <Player
          ref={player}
          component={LyricsVideo}
          inputProps={inputProps}
          durationInFrames={config.durationInFrames}
          inFrame={config.clipStartFrame ?? 0}
          outFrame={(config.clipEndFrame ?? config.durationInFrames) - 1}
          fps={config.fps}
          compositionWidth={config.width}
          compositionHeight={config.height}
          style={{ width: "100%", height: "100%" }}
          controls
          autoPlay={false}
          acknowledgeRemotionLicense
        />}
      </div>
    </section>
  );
}

export const PreviewPlayer = memo(PreviewPlayerComponent);
