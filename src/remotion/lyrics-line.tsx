import { useCurrentFrame, interpolate } from "remotion";
import type { LyricLine, StyleConfig, TranscriptionWord } from "@/types/lyrics";

interface BeatValues {
  scale: number;
  glowOpacity: number;
}

function getAnimationValues(
  frame: number,
  line: LyricLine,
  fade: number,
  variant: StyleConfig["animationVariant"]
) {
  if (fade === 0) {
    return { opacity: 1, transform: "" };
  }

  const keyframes = [
    line.startFrame,
    line.startFrame + fade,
    line.endFrame - fade,
    line.endFrame,
  ];
  const clamp = { extrapolateLeft: "clamp" as const, extrapolateRight: "clamp" as const };

  const opacity = interpolate(frame, keyframes, [0, 1, 1, 0], clamp);

  switch (variant) {
    case "zoom": {
      const scale = interpolate(frame, keyframes, [0.6, 1.0, 1.0, 0.6], clamp);
      return { opacity, transform: `scale(${scale})` };
    }
    case "slide-horizontal": {
      const tx = interpolate(frame, keyframes, [-100, 0, 0, 100], clamp);
      return { opacity, transform: `translateX(${tx}px)` };
    }
    case "typewriter":
    case "handwritten": {
      return { opacity, transform: "" };
    }
    case "fade-drift":
    default: {
      const ty = interpolate(frame, keyframes, [30, 0, 0, -30], clamp);
      return { opacity, transform: `translateY(${ty}px)` };
    }
  }
}

function TypewriterText({
  text,
  frame,
  line,
  fade,
  handwritten,
}: {
  text: string;
  frame: number;
  line: LyricLine;
  fade: number;
  handwritten: boolean;
}) {
  const progress = fade === 0
    ? 1
    : interpolate(
        frame,
        [line.startFrame, line.startFrame + fade * 2],
        [0, 1],
        { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
      );

  const visibleCount = Math.floor(progress * text.length);

  return (
    <>
      {text.split("").map((char, i) => {
        const visible = i < visibleCount;
        if (!visible) return <span key={i} style={{ opacity: 0 }}>{char}</span>;

        if (!handwritten) {
          return <span key={i}>{char}</span>;
        }

        const isNew = i >= visibleCount - 2 && i < visibleCount;
        const charScale = isNew
          ? interpolate(
              frame,
              [line.startFrame + (i / text.length) * fade * 2, line.startFrame + (i / text.length) * fade * 2 + 3],
              [1.2, 1.0],
              { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
            )
          : 1.0;

        const offsetY = Math.sin(i * 7.3) * 3;
        const rotation = Math.cos(i * 4.1) * 4;

        return (
          <span
            key={i}
            style={{
              display: "inline-block",
              transform: `translateY(${offsetY}px) rotate(${rotation}deg) scale(${charScale})`,
            }}
          >
            {char}
          </span>
        );
      })}
    </>
  );
}

function KaraokeText({
  words,
  frame,
  activeColor,
  inactiveColor,
}: {
  words: TranscriptionWord[];
  frame: number;
  activeColor: string;
  inactiveColor: string;
}) {
  const FPS = 30;
  return (
    <>
      {words.map((word, i) => {
        const wordStartFrame = Math.round(word.startSec * FPS);
        const wordEndFrame = Math.round(word.endSec * FPS);
        const isActive = frame >= wordStartFrame && frame <= wordEndFrame;
        const isPast = frame > wordEndFrame;

        const progress = interpolate(
          frame,
          [wordStartFrame, wordEndFrame],
          [0, 1],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
        );

        const scale = isActive ? 1 + progress * 0.08 : 1;
        const color = isActive || isPast ? activeColor : inactiveColor;

        return (
          <span
            key={i}
            style={{
              color,
              display: "inline-block",
              transform: `scale(${scale})`,
              transition: "color 0.1s",
              marginRight: i < words.length - 1 ? "0.3em" : 0,
            }}
          >
            {word.word}
          </span>
        );
      })}
    </>
  );
}

export const LyricsLineComponent: React.FC<{
  line: LyricLine;
  style: StyleConfig;
  beat: BeatValues;
}> = ({ line, style, beat }) => {
  const frame = useCurrentFrame();
  const lineDuration = line.endFrame - line.startFrame;

  if (frame < line.startFrame || frame > line.endFrame) {
    return null;
  }

  const fade = lineDuration >= 6 ? Math.min(10, Math.floor(lineDuration / 3)) : 0;
  const variant = style.animationVariant ?? "fade-drift";
  const { opacity, transform } = getAnimationValues(frame, line, fade, variant);

  const glowShadow =
    beat.glowOpacity > 0
      ? `, 0 0 20px ${style.textColor}${Math.round(beat.glowOpacity * 255).toString(16).padStart(2, "0")}`
      : "";

  const isCharAnim = variant === "typewriter" || variant === "handwritten";
  const isKaraoke = variant === "karaoke";
  const beatTransform = `scale(${beat.scale})`;
  const combinedTransform = transform ? `${beatTransform} ${transform}` : beatTransform;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        opacity,
      }}
    >
      <span
        style={{
          color: style.textColor,
          fontSize: style.fontSize,
          fontFamily: `"${style.fontFamily}", sans-serif`,
          fontWeight: 700,
          textAlign: "center",
          textShadow: `2px 2px 10px rgba(0,0,0,0.5)${glowShadow}`,
          maxWidth: "80%",
          lineHeight: 1.2,
          transform: combinedTransform,
        }}
      >
        {isKaraoke && line.words && line.words.length > 0 ? (
          <KaraokeText
            words={line.words}
            frame={frame}
            activeColor={style.textColor}
            inactiveColor={`${style.textColor}55`}
          />
        ) : isCharAnim ? (
          <TypewriterText
            text={line.text}
            frame={frame}
            line={line}
            fade={fade}
            handwritten={variant === "handwritten"}
          />
        ) : (
          line.text
        )}
      </span>
    </div>
  );
};
