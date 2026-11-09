import { AbsoluteFill, Audio, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Background } from "./background";
import { BeatParticles } from "./beat-particles";
import { AudioVisualizer } from "./audio-visualizer";
import { Watermark } from "./watermark";
import { LyricsLineComponent } from "./lyrics-line";
import { useBeatPulse, analyzedBeat, IDLE_BEAT } from "./use-beat-pulse";
import type { BeatPulse } from "./use-beat-pulse";
import {
  FilmGrainEffect,
  ChromaticAberrationEffect,
  VhsEffect,
  GlitchEffect,
  useCameraShake,
} from "./effects";
import type { VideoConfig } from "@/types/lyrics";
import type { LyricLine } from "@/types/lyrics";

// Preview passes URLs ("/api/audio/x.mp3", blob:, http); render passes bundle-relative names.
function resolveAudioUrl(url: string): string {
  return url.startsWith("/") || url.startsWith("blob:") || url.startsWith("http") ? url : staticFile(url);
}

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

const VideoScene: React.FC<VideoConfig & { beat: BeatPulse }> = ({
  lines,
  audioUrl,
  style,
  renderQuality,
  previewQuality,
  beat,
}) => {
  const reduceDetail = renderQuality === "fast" || (previewQuality !== undefined && previewQuality !== "high");
  const minimal = previewQuality === "low";

  const frame = useCurrentFrame();
  const activeLineIndices = getActiveLineIndices(lines, frame);

  const shake = useCameraShake(
    frame,
    beat.bassEnergy,
    style.postEffect === "camera-shake" ? style.effectIntensity : "off",
  );

  const postEffect = style.postEffect;

  return (
    <AbsoluteFill style={{ transform: `translate(${shake.x}px, ${shake.y}px)` }}>
      <Background src={style.bgImage} brightness={beat.bgBrightness} scale={beat.bgScale} bgType={style.bgType} />
      {!minimal && <BeatParticles bassEnergy={beat.bassEnergy} isDraft={reduceDetail} />}
      <AudioVisualizer
        frequencyData={beat.frequencyData}
        bassEnergy={beat.bassEnergy}
        mode={style.visualizerMode}
        monoColor={style.textColor}
        logoScale={style.logoScale}
        customLogo={style.customLogo}
        isDraft={reduceDetail}
        minimal={minimal}
        waveConfig={style.waveConfig}
      />
      {audioUrl && <Audio src={resolveAudioUrl(audioUrl)} />}
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

const ReactiveVideo: React.FC<VideoConfig> = (config) => {
  const beat = useBeatPulse(resolveAudioUrl(config.audioUrl), config.style.effectIntensity, config.style.beatReactive, config.style.visualizerMode !== "none");
  return <VideoScene {...config} beat={beat} />;
};

const AnalyzedVideo: React.FC<VideoConfig> = (config) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const beat = config.audioAnalysis ? analyzedBeat(config.audioAnalysis, frame / fps,
    config.style.effectIntensity, config.style.beatReactive, config.style.visualizerMode !== "none",
    config.beatSensitivity, config.manualBeats) : IDLE_BEAT;
  return <VideoScene {...config} beat={beat} />;
};

export const LyricsVideo: React.FC<VideoConfig> = (config) => {
  const needsAnalysis = config.audioUrl && (config.style.visualizerMode !== "none" ||
    (config.style.beatReactive && config.style.effectIntensity !== "off"));
  if (!needsAnalysis) return <VideoScene {...config} beat={IDLE_BEAT} />;
  return config.audioAnalysis ? <AnalyzedVideo {...config} /> : <ReactiveVideo {...config} />;
};
