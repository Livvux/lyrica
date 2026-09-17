import { AbsoluteFill, Img, staticFile } from "remotion";

interface WatermarkProps {
  show: boolean;
  customLogo: string | null;
  logoScale: number;
}

export const Watermark: React.FC<WatermarkProps> = ({ show, customLogo, logoScale }) => {
  if (!show) return null;

  const baseHeight = 50;
  const height = baseHeight * (logoScale / 100);
  const logoSrc = customLogo ?? staticFile("logo.svg");

  return (
    <AbsoluteFill
      style={{
        justifyContent: "flex-end",
        alignItems: "center",
        paddingBottom: 50,
      }}
    >
      <Img
        src={logoSrc}
        style={{
          height,
          opacity: 0.8,
        }}
      />
    </AbsoluteFill>
  );
};
