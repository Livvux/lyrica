"use client";

import { memo, useEffect, useId, useRef, useState } from "react";
import { COLOR_PRESETS, STYLE_PRESETS, VISUALIZER_PRESETS, DEFAULT_STYLE, DEFAULT_WAVE_CONFIG } from "@/types/lyrics";
import type { StyleConfig, EffectIntensity, AnimationVariant, PostEffect, WaveConfig, StylePreset } from "@/types/lyrics";

interface CustomizationPanelProps {
  style: StyleConfig;
  onChange: (update: (style: StyleConfig) => StyleConfig) => void;
  lyricsActive: boolean;
}

type TabId = "text" | "visualizer" | "scene" | "logo";

const TABS: { id: TabId; label: string }[] = [
  { id: "text", label: "Text" },
  { id: "visualizer", label: "Visualizer" },
  { id: "scene", label: "Szene" },
  { id: "logo", label: "Logo" },
];

type Options<T> = { value: T; label: string }[];

const ANIMATION_OPTIONS: Options<AnimationVariant> = [
  { value: "fade-drift", label: "Drift" },
  { value: "zoom", label: "Zoom" },
  { value: "slide-horizontal", label: "Slide" },
  { value: "typewriter", label: "Tippen" },
  { value: "handwritten", label: "Handschrift" },
  { value: "karaoke", label: "Karaoke" },
];

const INTENSITY_OPTIONS: Options<EffectIntensity> = [
  { value: "off", label: "Aus" },
  { value: "subtle", label: "Subtil" },
  { value: "strong", label: "Stark" },
];

const POST_EFFECT_OPTIONS: Options<PostEffect> = [
  { value: "none", label: "Aus" },
  { value: "glitch", label: "Glitch" },
  { value: "vhs", label: "VHS" },
  { value: "film-grain", label: "Filmkorn" },
  { value: "chromatic-aberration", label: "Chromatische Aberration" },
  { value: "camera-shake", label: "Kamera-Wackeln" },
];

const FALLBACK_FONTS = ["Inter", "Arial", "Helvetica"];
let fontCache: string[] | null = null; // survives tab switches; fonts don't change mid-session

async function uploadAsset(endpoint: string, field: string, file: File): Promise<string> {
  const formData = new FormData();
  formData.append(field, file);
  const res = await fetch(endpoint, { method: "POST", body: formData });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.filename) throw new Error(data.error ?? "Upload fehlgeschlagen.");
  return `/api/audio/${data.filename}`;
}

function isPresetActive(style: StyleConfig, preset: StylePreset) {
  return Object.entries(preset.style).every(([key, value]) =>
    JSON.stringify(style[key as keyof StyleConfig]) === JSON.stringify(value));
}

function CustomizationPanelComponent({ style, onChange, lyricsActive }: CustomizationPanelProps) {
  const [activeTab, setActiveTab] = useState<TabId>(lyricsActive ? "text" : "visualizer");
  const tabs = lyricsActive ? TABS : TABS.filter((t) => t.id !== "text");
  const tab = tabs.some((t) => t.id === activeTab) ? activeTab : "visualizer";
  const baseId = useId();

  const update = (partial: Partial<StyleConfig>) => onChange((s) => ({ ...s, ...partial }));

  function handleTabKey(e: React.KeyboardEvent) {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    const next = tabs[(tabs.findIndex((t) => t.id === tab) + step + tabs.length) % tabs.length];
    setActiveTab(next.id);
    document.getElementById(`${baseId}-tab-${next.id}`)?.focus();
  }

  return (
    <section className="panel flex flex-col gap-5" aria-label="Gestaltung">
      <div role="tablist" aria-label="Gestaltung" className="segmented" onKeyDown={handleTabKey}>
        {tabs.map((t) => (
          <button
            key={t.id}
            id={`${baseId}-tab-${t.id}`}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            aria-controls={`${baseId}-panel`}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => setActiveTab(t.id)}
            className="segment min-h-9 text-sm"
          >
            {t.label}
          </button>
        ))}
      </div>

      <div id={`${baseId}-panel`} role="tabpanel" aria-labelledby={`${baseId}-tab-${tab}`} className="flex flex-col gap-5">
        {tab === "text" && <TextTab style={style} update={update} />}
        {tab === "visualizer" && <VisualizerTab style={style} update={update} />}
        {tab === "scene" && <SceneTab style={style} update={update} />}
        {tab === "logo" && <LogoTab style={style} update={update} />}
      </div>
    </section>
  );
}

export const CustomizationPanel = memo(CustomizationPanelComponent);

interface TabProps {
  style: StyleConfig;
  update: (partial: Partial<StyleConfig>) => void;
}

function TextTab({ style, update }: TabProps) {
  const [fonts, setFonts] = useState<string[]>(fontCache ?? FALLBACK_FONTS);
  const fontId = useId();

  useEffect(() => {
    if (fontCache) return;
    let cancelled = false;
    fetch("/api/fonts")
      .then((r) => r.json())
      .then((data: unknown) => {
        if (!Array.isArray(data) || !data.length) return;
        fontCache = data;
        if (!cancelled) setFonts(data);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const fontOptions = fonts.includes(style.fontFamily) ? fonts : [style.fontFamily, ...fonts];

  return (
    <>
      <Field label="Preset">
        <div className="flex flex-wrap gap-1.5">
          {STYLE_PRESETS.map((preset) => (
            <button
              key={preset.name}
              type="button"
              title={preset.description}
              aria-pressed={isPresetActive(style, preset)}
              onClick={() => update(preset.style)}
              className="btn min-h-8 text-xs aria-pressed:border-white/40 aria-pressed:bg-white/15"
            >
              {preset.name}
            </button>
          ))}
        </div>
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Schrift" htmlFor={fontId}>
          <select
            id={fontId}
            value={style.fontFamily}
            onChange={(e) => update({ fontFamily: e.target.value })}
            className="input"
            style={{ fontFamily: `"${style.fontFamily}", sans-serif` }}
          >
            {fontOptions.map((font) => (
              <option key={font} value={font} style={{ fontFamily: `"${font}", sans-serif` }}>{font}</option>
            ))}
          </select>
        </Field>
        <Select label="Animation" options={ANIMATION_OPTIONS} value={style.animationVariant} onChange={(animationVariant) => update({ animationVariant })} />
      </div>

      <Slider label="Größe" unit="px" min={60} max={100} value={style.fontSize} onChange={(fontSize) => update({ fontSize })} />

      <Field label="Farbe" group>
        <div className="flex items-center gap-2">
          {COLOR_PRESETS.map((color) => (
            <button
              key={color}
              type="button"
              aria-label={color}
              aria-pressed={style.textColor === color}
              onClick={() => update({ textColor: color })}
              className="size-8 rounded-full border-2 border-white/15 transition aria-pressed:border-white"
              style={{ backgroundColor: color }}
            />
          ))}
          <input
            type="color"
            aria-label="Eigene Farbe"
            value={style.textColor}
            onChange={(e) => update({ textColor: e.target.value })}
          />
        </div>
      </Field>
    </>
  );
}

function VisualizerTab({ style, update }: TabProps) {
  const wc = style.waveConfig ?? DEFAULT_WAVE_CONFIG;
  const isWave = style.visualizerMode === "wave" || style.visualizerMode === "waves";
  const updateWave = (partial: Partial<WaveConfig>) => update({ waveConfig: { ...wc, ...partial } });

  return (
    <>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {VISUALIZER_PRESETS.map((preset) => (
          <button
            key={preset.name}
            type="button"
            title={preset.description}
            aria-pressed={isPresetActive(style, preset)}
            onClick={() => update(preset.style)}
            className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-left transition hover:border-white/25 hover:bg-white/[0.06] aria-pressed:border-accent/60 aria-pressed:bg-accent/10"
          >
            <PresetThumb preset={preset} />
            <span className="text-sm font-medium text-white">{preset.name}</span>
          </button>
        ))}
      </div>

      {style.visualizerMode !== "none" && (
        <button type="button" onClick={() => update({ visualizerMode: "none" })} className="btn-quiet self-start">
          Visualizer ausschalten
        </button>
      )}

      {isWave && (
        <>
          <Field label="Farben" group>
            <div className="flex flex-wrap items-center gap-2">
              {wc.colors.map((color, i) => (
                <input
                  key={i}
                  type="color"
                  aria-label={`Farbe ${i + 1}`}
                  value={color}
                  onChange={(e) => {
                    const colors = [...wc.colors] as WaveConfig["colors"];
                    colors[i] = e.target.value;
                    updateWave({ colors });
                  }}
                />
              ))}
              <button
                type="button"
                onClick={() => updateWave({ colors: [...DEFAULT_WAVE_CONFIG.colors] as WaveConfig["colors"] })}
                className="btn-quiet"
              >
                Zurücksetzen
              </button>
            </div>
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Slider label="Amplitude" min={100} max={500} step={10} value={wc.gain} onChange={(gain) => updateWave({ gain })} />
            {style.visualizerMode === "wave" && (
              <Slider label="Radius" unit="px" min={80} max={250} step={5} value={wc.radius} onChange={(radius) => updateWave({ radius })} />
            )}
            <Slider label="Glätte" min={12} max={64} step={2} value={wc.points} onChange={(points) => updateWave({ points })} />
            <Slider label="Verteilung" min={0.2} max={1} step={0.05} value={wc.spread} format={(v) => v.toFixed(2)} onChange={(spread) => updateWave({ spread })} />
          </div>
        </>
      )}
    </>
  );
}

function SceneTab({ style, update }: TabProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isDefault = style.bgImage === DEFAULT_STYLE.bgImage;

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const url = await uploadAsset("/api/upload-bg", "image", file);
      update({ bgImage: url, bgType: file.type.startsWith("video/") ? "video" : "image" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload fehlgeschlagen.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <>
      <Field label="Hintergrund" group>
        <div className="segmented">
          <button
            type="button"
            aria-pressed={isDefault}
            onClick={() => update({ bgImage: DEFAULT_STYLE.bgImage, bgType: "image" })}
            className="segment"
          >
            Standard
          </button>
          <button
            type="button"
            aria-pressed={!isDefault}
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
            className="segment disabled:opacity-50"
          >
            {uploading ? "Lädt …" : isDefault ? "Bild oder Video …" : style.bgType === "video" ? "Eigenes Video" : "Eigenes Bild"}
          </button>
        </div>
        <input ref={inputRef} type="file" accept="image/*,video/mp4,video/webm" className="hidden" onChange={handleUpload} />
        {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      </Field>

      <Select label="Effekt" options={POST_EFFECT_OPTIONS} value={style.postEffect} onChange={(postEffect) => update({ postEffect })} />
      <Segmented label="Intensität" options={INTENSITY_OPTIONS} value={style.effectIntensity} onChange={(effectIntensity) => update({ effectIntensity })} />
      <Switch label="Beat-reaktiv" checked={style.beatReactive} onChange={(beatReactive) => update({ beatReactive })} />
    </>
  );
}

function LogoTab({ style, update }: TabProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      update({ customLogo: await uploadAsset("/api/upload-logo", "logo", file) });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload fehlgeschlagen.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <>
      <div className="flex items-center gap-4">
        <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-white/5 p-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- user upload served by our own API */}
          <img src={style.customLogo ?? "/logo.svg"} alt="Logo" className="max-h-full max-w-full object-contain" />
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => inputRef.current?.click()} disabled={uploading} className="btn">
            {uploading ? "Lädt …" : "Logo hochladen"}
          </button>
          {style.customLogo && (
            <button type="button" onClick={() => update({ customLogo: null })} className="btn-quiet">
              Zurücksetzen
            </button>
          )}
        </div>
        <input ref={inputRef} type="file" accept="image/png,image/svg+xml,image/jpeg,image/webp" className="hidden" onChange={handleUpload} />
      </div>
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      <Slider label="Größe" unit="%" min={50} max={250} value={style.logoScale} onChange={(logoScale) => update({ logoScale })} />
      <Switch label="Wasserzeichen" checked={style.showWatermark} onChange={(showWatermark) => update({ showWatermark })} />
    </>
  );
}

// --- Primitives ---

function Field({ label, htmlFor, group, children }: { label: string; htmlFor?: string; group?: boolean; children: React.ReactNode }) {
  const id = useId();
  if (group) {
    return (
      <div role="group" aria-labelledby={id} className="field">
        <span id={id} className="label">{label}</span>
        {children}
      </div>
    );
  }
  return (
    <div className="field">
      <label htmlFor={htmlFor} className="label">{label}</label>
      {children}
    </div>
  );
}

function Segmented<T extends string>({ label, options, value, onChange }: { label: string; options: Options<T>; value: T; onChange: (value: T) => void }) {
  return (
    <Field label={label} group>
      <div className="segmented">
        {options.map((opt) => (
          <button key={opt.value} type="button" aria-pressed={value === opt.value} onClick={() => onChange(opt.value)} className="segment">
            {opt.label}
          </button>
        ))}
      </div>
    </Field>
  );
}

function Select<T extends string>({ label, options, value, onChange }: { label: string; options: Options<T>; value: T; onChange: (value: T) => void }) {
  const id = useId();
  return (
    <Field label={label} htmlFor={id}>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value as T)} className="input">
        {options.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
      </select>
    </Field>
  );
}

function Slider({ label, unit = "", format = String, onChange, ...range }: {
  label: string; unit?: string; min: number; max: number; step?: number; value: number;
  format?: (value: number) => string; onChange: (value: number) => void;
}) {
  const id = useId();
  return (
    <div className="field">
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="label">{label}</label>
        <output htmlFor={id} className="text-xs tabular-nums text-white/60">{format(range.value)}{unit}</output>
      </div>
      <input id={id} type="range" {...range} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

function Switch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="group flex min-h-9 items-center justify-between rounded-lg text-left"
    >
      <span className="label">{label}</span>
      <span className="relative h-6 w-10 shrink-0 rounded-full bg-white/10 transition group-aria-checked:bg-white/40">
        <span className="absolute top-0.5 left-0.5 size-5 rounded-full bg-white transition-transform group-aria-checked:translate-x-4" />
      </span>
    </button>
  );
}

function PresetThumb({ preset }: { preset: StylePreset }) {
  const { visualizerMode, waveConfig } = preset.style;
  return (
    <svg viewBox="0 0 160 36" className="mb-2 h-9 w-full" aria-hidden="true">
      {visualizerMode === "waves" ? [0, 1, 2].map((i) => (
        <path key={i} d={`M0 ${18 + i * 3} Q20 ${-8 + i * 8} 40 18 T80 18 T120 18 T160 18`}
          fill="none" stroke={waveConfig?.colors[i + 1]} strokeWidth="2" opacity={1 - i * 0.2} />
      )) : visualizerMode === "spectrum" ? Array.from({ length: 20 }, (_, i) => (
        <rect key={i} x={i * 8} y={18 - Math.sin(i * 0.65) ** 2 * 14} width="4" height={4 + Math.sin(i * 0.65) ** 2 * 28} rx="2" fill={preset.style.textColor ?? "#22d3ee"} />
      )) : [0, 1, 2].map((i) => (
        <ellipse key={i} cx="80" cy="18" rx={12 + i * 6} ry={8 + i * 4} fill="none"
          stroke={waveConfig?.colors[i] ?? (visualizerMode === "rainbow" ? ["#22d3ee", "#c084fc", "#fb7185"][i] : preset.style.textColor ?? "#ffffff")}
          opacity={1 - i * 0.2} />
      ))}
    </svg>
  );
}
