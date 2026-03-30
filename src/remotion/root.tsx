import { Composition } from "remotion";
import { LyricsVideo } from "./lyrics-video";
import { DEFAULT_STYLE } from "@/types/lyrics";
import type { VideoConfig } from "@/types/lyrics";

export const RemotionRoot: React.FC = () => {
  const defaultProps: VideoConfig = {
    lines: [],
    audioUrl: "",
    style: DEFAULT_STYLE,
    durationInFrames: 900,
    fps: 30,
    width: 1920,
    height: 1080,
  };

  return (
    <Composition
      id="LyricsVideo"
      component={LyricsVideo as never}
      durationInFrames={defaultProps.durationInFrames}
      fps={defaultProps.fps}
      width={defaultProps.width}
      height={defaultProps.height}
      defaultProps={defaultProps as unknown as Record<string, unknown>}
      calculateMetadata={async ({ props }) => {
        const p = props as unknown as VideoConfig;
        return {
          durationInFrames: p.durationInFrames || 900,
          fps: p.fps || 30,
          width: p.width || 1920,
          height: p.height || 1080,
        };
      }}
    />
  );
};
