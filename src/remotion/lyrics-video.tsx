import { AbsoluteFill, Audio, staticFile, useCurrentFrame } from "remotion";
import { Background } from "./background";
import { BeatParticles } from "./beat-particles";
import { AudioVisualizer } from "./audio-visualizer";
import { Watermark } from "./watermark";
import { LyricsLineComponent } from "./lyrics-line";
import { useBeatPulse } from "./use-beat-pulse";
import {
  FilmGrainEffect,
  ChromaticAberrationEffect,
  VhsEffect,
  GlitchEffect,
  useCameraShake,
} from "./effects";
import type { VideoConfig } from "@/types/lyrics";

export const LyricsVideo: React.FC<VideoConfig> = ({
  lines,
  audioUrl,
  style,
  renderQuality,
}) => {
  const isDraft = renderQuality === "draft";
  // Preview (client): audioUrl starts with "/" (e.g. "/api/audio/abc.mp3") -> use directly
  // Render (server): audioUrl is just filename (e.g. "abc.mp3") -> use staticFile (served from publicDir)
  const resolvedAudioUrl =
    audioUrl.startsWith("/") || audioUrl.startsWith("blob:") || audioUrl.startsWith("http")
      ? audioUrl
      : staticFile(audioUrl);

  const frame = useCurrentFrame();

  const beat = useBeatPulse(
    resolvedAudioUrl,
    style.effectIntensity,
    style.beatReactive
  );

  const shake = useCameraShake(
    frame,
    beat.bassEnergy,
    style.postEffect === "camera-shake" ? style.effectIntensity : "off",
  );

  const postEffect = style.postEffect;

  return (
    <AbsoluteFill style={{ transform: `translate(${shake.x}px, ${shake.y}px)` }}>
      <Background src={style.bgImage} brightness={beat.bgBrightness} scale={beat.bgScale} bgType={style.bgType} />
      <BeatParticles bassEnergy={beat.bassEnergy} isDraft={isDraft} />
      <AudioVisualizer
        frequencyData={beat.frequencyData}
        bassEnergy={beat.bassEnergy}
        mode={style.visualizerMode}
        monoColor={style.textColor}
        logoScale={style.logoScale}
        isDraft={isDraft}
        waveConfig={style.waveConfig}
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
      {postEffect === "film-grain" && (
        <FilmGrainEffect intensity={style.effectIntensity} />
      )}
      {postEffect === "chromatic-aberration" && (
        <ChromaticAberrationEffect intensity={style.effectIntensity} bassEnergy={beat.bassEnergy} />
      )}
      {postEffect === "vhs" && (
        <VhsEffect intensity={style.effectIntensity} />
      )}
      {postEffect === "glitch" && (
        <GlitchEffect intensity={style.effectIntensity} bassEnergy={beat.bassEnergy} />
      )}
      <Watermark
        show={style.showWatermark}
        customLogo={style.customLogo}
        logoScale={style.logoScale}
      />
    </AbsoluteFill>
  );
};
