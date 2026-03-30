import { AbsoluteFill, Audio, staticFile } from "remotion";
import { Background } from "./background";
import { BeatParticles } from "./beat-particles";
import { AudioVisualizer } from "./audio-visualizer";
import { Watermark } from "./watermark";
import { LyricsLineComponent } from "./lyrics-line";
import { useBeatPulse } from "./use-beat-pulse";
import type { VideoConfig } from "@/types/lyrics";

export const LyricsVideo: React.FC<VideoConfig> = ({
  lines,
  audioUrl,
  style,
}) => {
  // Preview (client): audioUrl starts with "/" (e.g. "/api/audio/abc.mp3") -> use directly
  // Render (server): audioUrl is just filename (e.g. "abc.mp3") -> use staticFile (served from publicDir)
  const resolvedAudioUrl =
    audioUrl.startsWith("/") || audioUrl.startsWith("blob:") || audioUrl.startsWith("http")
      ? audioUrl
      : staticFile(audioUrl);

  const beat = useBeatPulse(
    resolvedAudioUrl,
    style.effectIntensity,
    style.beatReactive
  );

  return (
    <AbsoluteFill>
      <Background src={style.bgImage} brightness={beat.bgBrightness} scale={beat.bgScale} />
      <BeatParticles bassEnergy={beat.bassEnergy} />
      <AudioVisualizer
        frequencyData={beat.frequencyData}
        bassEnergy={beat.bassEnergy}
        mode={style.visualizerMode}
        monoColor={style.textColor}
        logoScale={style.logoScale}
      />
      {audioUrl && <Audio src={resolvedAudioUrl} />}
      {lines.map((line, i) => (
        <LyricsLineComponent
          key={i}
          line={line}
          style={style}
          beat={{ scale: beat.scale, glowOpacity: beat.glowOpacity }}
        />
      ))}
      <Watermark />
    </AbsoluteFill>
  );
};
