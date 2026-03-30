import { AbsoluteFill, Img, staticFile } from "remotion";

export const Watermark: React.FC = () => {
  return (
    <AbsoluteFill
      style={{
        justifyContent: "flex-end",
        alignItems: "center",
        paddingBottom: 50,
      }}
    >
      <Img
        src={staticFile("logo.svg")}
        style={{
          height: 50,
          opacity: 0.8,
        }}
      />
    </AbsoluteFill>
  );
};
