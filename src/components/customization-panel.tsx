"use client";

import { useRef, useState, useEffect } from "react";
import { COLOR_PRESETS } from "@/types/lyrics";
import type { StyleConfig, EffectIntensity, AnimationVariant, VisualizerMode } from "@/types/lyrics";

interface CustomizationPanelProps {
  style: StyleConfig;
  onChange: (style: StyleConfig) => void;
  lyricsActive: boolean;
}

const ANIMATION_OPTIONS: { value: AnimationVariant; label: string }[] = [
  { value: "fade-drift", label: "Drift" },
  { value: "zoom", label: "Zoom" },
  { value: "slide-horizontal", label: "Slide" },
  { value: "typewriter", label: "Tippen" },
  { value: "handwritten", label: "Handschrift" },
];

const INTENSITY_OPTIONS: { value: EffectIntensity; label: string }[] = [
  { value: "off", label: "Aus" },
  { value: "subtle", label: "Subtil" },
  { value: "strong", label: "Stark" },
];

const VISUALIZER_OPTIONS: { value: VisualizerMode; label: string }[] = [
  { value: "none", label: "Aus" },
  { value: "rainbow", label: "Regenbogen" },
  { value: "mono", label: "Einfarbig" },
];

export function CustomizationPanel({ style, onChange, lyricsActive }: CustomizationPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fonts, setFonts] = useState<string[]>([]);
  const [fontsLoading, setFontsLoading] = useState(false);
  const [bgError, setBgError] = useState<string | null>(null);

  function loadFonts() {
    setFontsLoading(true);
    fetch("/api/fonts", { cache: "no-cache" })
      .then((r) => r.json())
      .then(setFonts)
      .catch(() => setFonts(["Inter", "Arial", "Helvetica"]))
      .finally(() => setFontsLoading(false));
  }

  useEffect(() => { loadFonts(); }, []);

  function update(partial: Partial<StyleConfig>) {
    onChange({ ...style, ...partial });
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg bg-white/5 p-4">
      <h3 className="text-sm font-medium text-white/60">Anpassungen</h3>

      {lyricsActive && (
        <>
          {/* Font Family */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-white/40">Schriftart</label>
            <div className="flex gap-2">
              <select
                value={style.fontFamily}
                onChange={(e) => update({ fontFamily: e.target.value })}
                className="flex-1 rounded-md bg-white/10 px-3 py-1.5 text-sm text-white outline-none"
                style={{ fontFamily: `"${style.fontFamily}", sans-serif` }}
              >
                {fonts.map((font) => (
                  <option key={font} value={font} style={{ fontFamily: `"${font}", sans-serif` }}>
                    {font}
                  </option>
                ))}
              </select>
              <button
                onClick={loadFonts}
                disabled={fontsLoading}
                className="shrink-0 rounded-md bg-white/10 px-2.5 py-1.5 text-xs text-white/50 transition hover:bg-white/15 hover:text-white/70 disabled:opacity-40"
                title="Fonts neu laden"
              >
                {fontsLoading ? "..." : "↻"}
              </button>
            </div>
          </div>

          {/* Animation Variant */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-white/40">Animation</label>
            <select
              value={style.animationVariant}
              onChange={(e) => update({ animationVariant: e.target.value as AnimationVariant })}
              className="rounded-md bg-white/10 px-3 py-1.5 text-sm text-white outline-none"
            >
              {ANIMATION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Font Size */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-white/40">
              Schriftgröße: {style.fontSize}px
            </label>
            <input
              type="range"
              min={60}
              max={100}
              value={style.fontSize}
              onChange={(e) => update({ fontSize: Number(e.target.value) })}
              className="w-full accent-white"
            />
          </div>

          {/* Text Color */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-white/40">Textfarbe</label>
            <div className="flex gap-2">
              {COLOR_PRESETS.map((color) => (
                <button
                  key={color}
                  onClick={() => update({ textColor: color })}
                  className="h-8 w-8 rounded-full border-2 transition"
                  style={{
                    backgroundColor: color,
                    borderColor:
                      style.textColor === color
                        ? "white"
                        : "rgba(255,255,255,0.15)",
                  }}
                />
              ))}
            </div>
          </div>
        </>
      )}

      {/* Audio Visualizer */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-white/40">Audio-Visualizer</label>
        <div className="flex rounded-md bg-white/10 p-0.5">
          {VISUALIZER_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => update({ visualizerMode: opt.value })}
              className={`flex-1 rounded px-3 py-1.5 text-xs transition ${
                style.visualizerMode === opt.value
                  ? "bg-white/20 text-white"
                  : "text-white/50 hover:text-white/70"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Logo Size (only when visualizer is active) */}
      {style.visualizerMode !== "none" && (
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-white/40">
            Logo-Größe: {style.logoScale}%
          </label>
          <input
            type="range"
            min={50}
            max={250}
            value={style.logoScale}
            onChange={(e) => update({ logoScale: Number(e.target.value) })}
            className="w-full accent-white"
          />
        </div>
      )}

      {/* Background */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-white/40">Hintergrund</label>
        <div className="flex gap-2">
          <button
            onClick={() => update({ bgImage: "/bg-default.jpg" })}
            className="rounded-md bg-white/10 px-3 py-1.5 text-xs text-white/70 transition hover:bg-white/15"
          >
            Standard
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="rounded-md bg-white/10 px-3 py-1.5 text-xs text-white/70 transition hover:bg-white/15"
          >
            Eigenes Bild
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setBgError(null);
              try {
                const formData = new FormData();
                formData.append("image", file);
                const res = await fetch("/api/upload-bg", { method: "POST", body: formData });
                if (!res.ok) {
                  const data = await res.json();
                  setBgError(data.error ?? "Upload fehlgeschlagen");
                  return;
                }
                const data = await res.json();
                if (data.filename) {
                  update({ bgImage: `/api/audio/${data.filename}` });
                }
              } catch {
                setBgError("Bild-Upload fehlgeschlagen.");
              }
            }}
          />
        </div>
        {bgError && <p className="text-xs text-red-400">{bgError}</p>}
      </div>

      {/* Effect Intensity */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-white/40">Effekt-Intensität</label>
        <div className="flex rounded-md bg-white/10 p-0.5">
          {INTENSITY_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => update({ effectIntensity: opt.value })}
              className={`flex-1 rounded px-3 py-1.5 text-xs transition ${
                style.effectIntensity === opt.value
                  ? "bg-white/20 text-white"
                  : "text-white/50 hover:text-white/70"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Beat Reactive Toggle */}
      <div className="flex items-center justify-between">
        <label className="text-xs text-white/40">Beat-Reaktiv</label>
        <button
          onClick={() => update({ beatReactive: !style.beatReactive })}
          className={`relative h-6 w-10 shrink-0 rounded-full transition ${
            style.beatReactive ? "bg-white/30" : "bg-white/10"
          }`}
        >
          <span
            className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
              style.beatReactive ? "translate-x-4" : "translate-x-0"
            }`}
          />
        </button>
      </div>
    </div>
  );
}
