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
import type { LyricLine } from "@/types/lyrics";

function findFirstCandidateIndex(lines: LyricLine[], frame: number): number {
  let low = 0;
  let high = lines.length - 1;
  let result = lines.length;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (lines[mid].endFrame >= frame) {
      result = mid;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }
  return result;
}

function getActiveLineIndices(lines: LyricLine[], frame: number): number[] {
  if (lines.length === 0) return [];
  const startIndex = findFirstCandidateIndex(lines, frame);
  if (startIndex >= lines.length) return [];
  const active: number[] = [];
  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i];
    if (line.startFrame > frame) break;
    if (line.endFrame >= frame) active.push(i);
  }
  return active;
}

export const LyricsVideo: React.FC<VideoConfig> = ({
  lines,
  audioUrl,
  style,
  renderQuality,
}) => {
  const reduceDetail = renderQuality === "fast";
  // Preview (client): audioUrl starts with "/" (e.g. "/api/audio/abc.mp3") -> use directly
  // Render (server): audioUrl is just filename (e.g. "abc.mp3") -> use staticFile (served from publicDir)
  const resolvedAudioUrl =
    audioUrl.startsWith("/") || audioUrl.startsWith("blob:") || audioUrl.startsWith("http")
      ? audioUrl
      : staticFile(audioUrl);

  const frame = useCurrentFrame();
  const activeLineIndices = getActiveLineIndices(lines, frame);

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
      <BeatParticles bassEnergy={beat.bassEnergy} isDraft={reduceDetail} />
      <AudioVisualizer
        frequencyData={beat.frequencyData}
        bassEnergy={beat.bassEnergy}
        mode={style.visualizerMode}
        monoColor={style.textColor}
        logoScale={style.logoScale}
        customLogo={style.customLogo}
        isDraft={reduceDetail}
        waveConfig={style.waveConfig}
      />
      {audioUrl && <Audio src={resolvedAudioUrl} />}
      {activeLineIndices.map((index) => (
        <LyricsLineComponent
          key={index}
          line={lines[index]}
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
