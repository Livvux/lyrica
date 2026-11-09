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
      <section className="panel flex items-center gap-3" aria-label="Lyrics-Abgleich">
        <span className="spinner" aria-hidden="true" />
        <span role="status" className="flex-1 text-sm text-white/70">
          {phase === "identifying" && "Song wird erkannt …"}
          {phase === "fetching" && "Lyrics werden gesucht …"}
          {phase === "validating" && "Lyrics werden verglichen …"}
        </span>
        <button type="button" onClick={onSkip} className="btn-quiet">
          Überspringen
        </button>
      </section>
    );
  }

  const hasReference = result.reference !== null;
  const hasIssues = result.lineValidations.some((v) => v.issue);

  return (
    <section className="panel" aria-label="Lyrics-Abgleich">
      {result.songMatch ? (
        <div className="mb-4">
          <h2 className="text-sm font-semibold text-white">
            {result.songMatch.title}{" "}
            <span className="font-normal text-white/50">· {result.songMatch.artist}</span>
          </h2>
          {hasReference && (
            <p className="mt-1 text-xs tabular-nums text-white/45">
              {result.overallScore}% Übereinstimmung
            </p>
          )}
        </div>
      ) : (
        <div className="mb-4">
          <h2 className="text-sm font-semibold text-white">Song nicht erkannt</h2>
          <p className="mt-1 text-xs tabular-nums text-white/45">
            Qualität {result.overallScore}/100
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
                className="flex items-start gap-2.5 rounded-lg bg-white/[0.03] px-3 py-1.5 text-xs"
              >
                <span
                  className={`mt-1 size-2 shrink-0 rounded-full ${similarityColor(v.similarity)}`}
                  role="img"
                  aria-label={`${Math.round(v.similarity * 100)}%`}
                />
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
              <p key={v.lineIndex} className="text-xs text-warn">
                Zeile {v.lineIndex + 1}: {issueLabel(v.issue!)}
              </p>
            ))}
          {result.lineValidations.filter((v) => v.issue).length > 5 && (
            <p className="text-xs text-white/40">
              +{result.lineValidations.filter((v) => v.issue).length - 5} weitere
            </p>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2">
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
        <button type="button" onClick={onSkip} className="btn-quiet">
          Überspringen
        </button>
      </div>
    </section>
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
      type="button"
      onClick={onClick}
      className={primary ? "btn-solid" : "btn"}
    >
      {label}
    </button>
  );
}

function similarityColor(score: number): string {
  if (score >= 0.8) return "bg-ok";
  if (score >= 0.5) return "bg-warn";
  return "bg-danger";
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
