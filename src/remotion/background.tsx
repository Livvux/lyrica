import { AbsoluteFill, Img, OffthreadVideo, Loop, staticFile, useVideoConfig } from "remotion";
import type { BgType } from "@/types/lyrics";

const VIDEO_EXTS = new Set([".mp4", ".webm"]);

function isVideoSrc(src: string, bgType?: BgType): boolean {
  if (bgType === "video") return true;
  const ext = src.split(".").pop()?.toLowerCase() ?? "";
  return VIDEO_EXTS.has(`.${ext}`);
}

export const Background: React.FC<{
  src: string;
  brightness?: number;
  scale?: number;
  bgType?: BgType;
}> = ({ src, brightness = 1, scale = 1, bgType }) => {
  const resolvedSrc = src.startsWith("/") ? src : (src ? staticFile(src) : src);
  const isVideo = isVideoSrc(src, bgType);
  const { durationInFrames } = useVideoConfig();

  const mediaStyle: React.CSSProperties = {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    filter: brightness !== 1 ? `brightness(${brightness})` : undefined,
    transform: scale !== 1 ? `scale(${scale})` : undefined,
  };

  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      {isVideo ? (
        <Loop durationInFrames={durationInFrames}>
          <OffthreadVideo
            src={resolvedSrc}
            style={mediaStyle}
            muted
          />
        </Loop>
      ) : (
        <Img src={resolvedSrc} style={mediaStyle} />
      )}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(0,0,0,0.3)",
        }}
      />
    </AbsoluteFill>
  );
};
