"use client";

import dynamic from "next/dynamic";
import type { VideoConfig } from "@/types/lyrics";

const Player = dynamic(
  () => import("@remotion/player").then((mod) => mod.Player),
  { ssr: false }
);

const LyricsVideoLazy = dynamic(
  () => import("@/remotion/lyrics-video").then((mod) => mod.LyricsVideo),
  { ssr: false }
) as never;

interface PreviewPlayerProps {
  config: VideoConfig;
}

export function PreviewPlayer({ config }: PreviewPlayerProps) {
  return (
    <div className="w-full overflow-hidden rounded-2xl border border-white/10">
      <div className="relative w-full" style={{ aspectRatio: "16/9" }}>
        <Player
          component={LyricsVideoLazy}
          inputProps={config}
          durationInFrames={config.durationInFrames}
          fps={config.fps}
          compositionWidth={config.width}
          compositionHeight={config.height}
          style={{ width: "100%", height: "100%" }}
          controls
          autoPlay={false}
        />
      </div>
    </div>
  );
}
