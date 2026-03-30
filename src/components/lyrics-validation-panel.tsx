"use client";

import type { LyricLine, ValidationResult } from "@/types/lyrics";
import {
  applyCorrections,
  applyAllReference,
  autoFixLines,
} from "@/lib/lyrics-validation";

type ValidationPhase = "identifying" | "fetching" | "validating" | "done";

interface LyricsValidationPanelProps {
  lines: LyricLine[];
  phase: ValidationPhase;
  result: ValidationResult | null;
  onAccept: (lines: LyricLine[]) => void;
  onSkip: () => void;
}

export function LyricsValidationPanel({
  lines,
  phase,
  result,
  onAccept,
  onSkip,
}: LyricsValidationPanelProps) {
  if (phase !== "done" || !result) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 p-6">
        <div className="flex items-center gap-3">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          <span className="text-sm text-white/60">
            {phase === "identifying" && "Song wird erkannt..."}
            {phase === "fetching" && "Lyrics werden gesucht..."}
            {phase === "validating" && "Lyrics werden verglichen..."}
          </span>
        </div>
        <button
          onClick={onSkip}
          className="mt-3 text-xs text-white/30 transition hover:text-white/50"
        >
          Überspringen
        </button>
      </div>
    );
  }

  const hasReference = result.reference !== null;
  const hasIssues = result.lineValidations.some((v) => v.issue);

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-6">
      {/* Header */}
      {result.songMatch ? (
        <div className="mb-4">
          <p className="text-sm font-medium text-white">
            {result.songMatch.title}{" "}
            <span className="text-white/50">— {result.songMatch.artist}</span>
          </p>
          {hasReference && (
            <p className="mt-1 text-xs text-white/40">
              Übereinstimmung: {result.overallScore}%
            </p>
          )}
        </div>
      ) : (
        <div className="mb-4">
          <p className="text-sm text-white/60">
            Song nicht erkannt
          </p>
          <p className="mt-1 text-xs text-white/40">
            Qualitäts-Score: {result.overallScore}/100
          </p>
        </div>
      )}

      {/* Line comparison (only if reference available) */}
      {hasReference && (
        <div className="mb-4 flex max-h-60 flex-col gap-1 overflow-y-auto pr-1">
          {result.lineValidations.map((v) => {
            if (!v.referenceLine) return null;
            const line = lines[v.lineIndex];
            if (!line) return null;
            return (
              <div
                key={v.lineIndex}
                className="flex items-start gap-2 rounded-lg bg-white/5 px-3 py-1.5 text-xs"
              >
                <span className="mt-0.5 shrink-0">
                  {similarityDot(v.similarity)}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-white/70 truncate">{line.text}</p>
                  {v.similarity < 0.95 && (
                    <p className="text-white/40 truncate">{v.referenceLine}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Quality issues (only if no reference) */}
      {!hasReference && hasIssues && (
        <div className="mb-4 flex flex-col gap-1">
          {result.lineValidations
            .filter((v) => v.issue)
            .slice(0, 5)
            .map((v) => (
              <p key={v.lineIndex} className="text-xs text-amber-400/80">
                Zeile {v.lineIndex + 1}: {issueLabel(v.issue!)}
              </p>
            ))}
          {result.lineValidations.filter((v) => v.issue).length > 5 && (
            <p className="text-xs text-white/30">
              +{result.lineValidations.filter((v) => v.issue).length - 5} weitere
            </p>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        {hasReference ? (
          <>
            <ActionButton
              label="Transkription behalten"
              onClick={() => onAccept(lines)}
            />
            <ActionButton
              label="Referenz übernehmen"
              primary
              onClick={() =>
                onAccept(applyAllReference(lines, result.lineValidations))
              }
            />
            <ActionButton
              label="Nur Korrekturen"
              onClick={() =>
                onAccept(applyCorrections(lines, result.lineValidations, 0.5))
              }
            />
          </>
        ) : hasIssues ? (
          <>
            <ActionButton
              label="Weiter zum Editor"
              onClick={() => onAccept(lines)}
            />
            <ActionButton
              label="Probleme auto-fixen"
              primary
              onClick={() =>
                onAccept(autoFixLines(lines, result.lineValidations))
              }
            />
          </>
        ) : (
          <ActionButton
            label="Weiter zum Editor"
            primary
            onClick={() => onAccept(lines)}
          />
        )}
        <button
          onClick={onSkip}
          className="text-xs text-white/30 transition hover:text-white/50 px-3 py-2"
        >
          Überspringen
        </button>
      </div>
    </div>
  );
}

function ActionButton({
  label,
  primary,
  onClick,
}: {
  label: string;
  primary?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg px-4 py-2 text-xs font-medium transition ${
        primary
          ? "bg-white/15 text-white hover:bg-white/25"
          : "border border-white/10 text-white/60 hover:bg-white/5 hover:text-white/80"
      }`}
    >
      {label}
    </button>
  );
}

function similarityDot(score: number): string {
  if (score >= 0.8) return "\u{1F7E2}";
  if (score >= 0.5) return "\u{1F7E1}";
  return "\u{1F534}";
}

function issueLabel(issue: string): string {
  switch (issue) {
    case "hallucination": return "Mögliche Halluzination";
    case "empty": return "Leere Zeile";
    case "repeated": return "Wiederholte Zeile";
    case "short": return "Sehr kurze Zeile";
    default: return issue;
  }
}
