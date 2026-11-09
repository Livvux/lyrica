import { AbsoluteFill, Img, staticFile, useVideoConfig } from "remotion";

interface WatermarkProps {
  show: boolean;
  customLogo: string | null;
  logoScale: number;
}

export const Watermark: React.FC<WatermarkProps> = ({ show, customLogo, logoScale }) => {
  const { width, height: sceneHeight } = useVideoConfig();
  if (!show) return null;

  const baseHeight = 50 * Math.min(width, sceneHeight) / 1080;
  const height = baseHeight * (logoScale / 100);
  const logoSrc = customLogo ?? staticFile("logo.svg");

  return (
    <AbsoluteFill
      style={{
        justifyContent: "flex-end",
        alignItems: "center",
        paddingBottom: sceneHeight * (width < sceneHeight ? 0.08 : 50 / 1080),
      }}
    >
      <Img
        alt="Logo"
        src={logoSrc}
        style={{
          height,
          maxWidth: "60%",
          objectFit: "contain",
          opacity: 0.8,
        }}
      />
    </AbsoluteFill>
  );
};
