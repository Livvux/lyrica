import { AbsoluteFill, Img, staticFile } from "remotion";

export const Background: React.FC<{
  src: string;
  brightness?: number;
  scale?: number;
}> = ({ src, brightness = 1, scale = 1 }) => {
  const resolvedSrc = src.startsWith("/") ? staticFile(src.slice(1)) : src;
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <Img
        src={resolvedSrc}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          filter: brightness !== 1 ? `brightness(${brightness})` : undefined,
          transform: scale !== 1 ? `scale(${scale})` : undefined,
        }}
      />
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
