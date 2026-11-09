import * as z from "zod";
import { ENVELOPE_RATE, MAX_ANALYSIS_DURATION, SPECTRUM_BANDS } from "./audio-analysis";

const energy = z.array(z.number().min(0).max(1)).max(MAX_ANALYSIS_DURATION * ENVELOPE_RATE);
const events = z.array(z.number().min(0).max(MAX_ANALYSIS_DURATION)).max(60000);

export const AudioAnalysisSchema = z.object({
  version: z.literal(1),
  durationSec: z.number().positive().max(MAX_ANALYSIS_DURATION),
  sampleRate: z.number().int().min(8000).max(192000),
  envelopeRate: z.literal(ENVELOPE_RATE),
  waveform: z.array(z.number().min(0).max(1)).min(1).max(2000),
  low: energy,
  mid: energy,
  high: energy,
  spectrum: z.array(z.number().min(0).max(1)).max(MAX_ANALYSIS_DURATION * ENVELOPE_RATE * SPECTRUM_BANDS),
  onsets: events,
  beats: events,
  bpm: z.number().min(60).max(200).nullable(),
  bpmConfidence: z.number().min(0).max(1),
}).superRefine((analysis, context) => {
  const expected = Math.ceil(analysis.durationSec * analysis.envelopeRate);
  if (analysis.low.length !== expected || analysis.mid.length !== expected || analysis.high.length !== expected || analysis.spectrum.length !== expected * SPECTRUM_BANDS) {
    context.addIssue({ code: "custom", message: "Audioanalyse hat ungültige Envelope-Längen." });
  }
  for (const key of ["onsets", "beats"] as const) {
    if (analysis[key].some((event, index, values) => event >= analysis.durationSec || (index > 0 && event <= values[index - 1]))) {
      context.addIssue({ code: "custom", path: [key], message: "Audioereignisse müssen sortiert innerhalb des Songs liegen." });
    }
  }
});
