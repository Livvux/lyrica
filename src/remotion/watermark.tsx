import { AbsoluteFill, Img, staticFile } from "remotion";

interface WatermarkProps {
  show: boolean;
}

export const Watermark: React.FC<WatermarkProps> = ({ show }) => {
  if (!show) return null;
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
