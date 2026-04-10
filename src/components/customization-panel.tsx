"use client";

import { useRef, useState, useEffect } from "react";
import { COLOR_PRESETS, STYLE_PRESETS, DEFAULT_WAVE_CONFIG } from "@/types/lyrics";
import type { StyleConfig, EffectIntensity, AnimationVariant, VisualizerMode, PostEffect, WaveConfig } from "@/types/lyrics";

interface CustomizationPanelProps {
  style: StyleConfig;
  onChange: (style: StyleConfig) => void;
  lyricsActive: boolean;
}

type TabId = "text" | "visualizer" | "background" | "effects" | "logo";

interface Tab {
  id: TabId;
  label: string;
  icon: string;
}

const TABS: Tab[] = [
  { id: "text", label: "Text", icon: "A" },
  { id: "visualizer", label: "Visualizer", icon: "♫" },
  { id: "background", label: "Hintergrund", icon: "◻" },
  { id: "effects", label: "Effekte", icon: "✦" },
  { id: "logo", label: "Logo", icon: "◆" },
];

const ANIMATION_OPTIONS: { value: AnimationVariant; label: string }[] = [
  { value: "fade-drift", label: "Drift" },
  { value: "zoom", label: "Zoom" },
  { value: "slide-horizontal", label: "Slide" },
  { value: "typewriter", label: "Tippen" },
  { value: "handwritten", label: "Handschrift" },
  { value: "karaoke", label: "Karaoke" },
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
  { value: "wave", label: "Trap Nation" },
];

const POST_EFFECT_OPTIONS: { value: PostEffect; label: string }[] = [
  { value: "none", label: "Aus" },
  { value: "glitch", label: "Glitch" },
  { value: "vhs", label: "VHS" },
  { value: "film-grain", label: "Film-Korn" },
  { value: "chromatic-aberration", label: "Chrom. Aberr." },
  { value: "camera-shake", label: "Kamera-Shake" },
];

export function CustomizationPanel({ style, onChange, lyricsActive }: CustomizationPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [fonts, setFonts] = useState<string[]>([]);
  const [fontsLoading, setFontsLoading] = useState(true);
  const [bgError, setBgError] = useState<string | null>(null);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [logoUploading, setLogoUploading] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>(lyricsActive ? "text" : "visualizer");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/fonts", { cache: "no-cache" })
      .then((r) => r.json())
      .then((data) => { if (!cancelled) setFonts(data); })
      .catch(() => { if (!cancelled) setFonts(["Inter", "Arial", "Helvetica"]); })
      .finally(() => { if (!cancelled) setFontsLoading(false); });
    return () => { cancelled = true; };
  }, []);

  function loadFonts() {
    setFontsLoading(true);
    fetch("/api/fonts", { cache: "no-cache" })
      .then((r) => r.json())
      .then(setFonts)
      .catch(() => setFonts(["Inter", "Arial", "Helvetica"]))
      .finally(() => setFontsLoading(false));
  }

  function update(partial: Partial<StyleConfig>) {
    onChange({ ...style, ...partial });
  }

  function handleBgUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBgError(null);
    const isVideo = file.type.startsWith("video/");
    (async () => {
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
          update({
            bgImage: `/api/audio/${data.filename}`,
            bgType: isVideo ? "video" : "image",
          });
        }
      } catch {
        setBgError("Upload fehlgeschlagen.");
      }
    })();
  }

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoError(null);
    setLogoUploading(true);
    try {
      const formData = new FormData();
      formData.append("logo", file);
      const res = await fetch("/api/upload-logo", { method: "POST", body: formData });
      if (!res.ok) {
        const data = await res.json();
        setLogoError(data.error ?? "Upload fehlgeschlagen");
        return;
      }
      const data = await res.json();
      if (data.filename) {
        update({ customLogo: `/api/audio/${data.filename}` });
      }
    } catch {
      setLogoError("Upload fehlgeschlagen.");
    } finally {
      setLogoUploading(false);
    }
  }

  const visibleTabs = lyricsActive
    ? TABS
    : TABS.filter((t) => t.id !== "text");

  return (
    <div className="flex flex-col gap-3 rounded-lg bg-white/5 p-4">
      {/* Tab Navigation */}
      <div className="flex gap-1 rounded-md bg-white/10 p-0.5">
        {visibleTabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 rounded px-3 py-2 text-xs font-medium transition ${
              activeTab === tab.id
                ? "bg-white/20 text-white"
                : "text-white/50 hover:text-white/70 hover:bg-white/10"
            }`}
          >
            <span className="mr-1">{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="flex flex-col gap-3">
        {/* ===== TEXT TAB ===== */}
        {activeTab === "text" && lyricsActive && (
          <>
            {/* Style Presets */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-white/40">Preset</label>
              <div className="flex flex-wrap gap-1.5">
                {STYLE_PRESETS.map((preset) => (
                  <button
                    key={preset.name}
                    onClick={() => update(preset.style)}
                    title={preset.description}
                    className="rounded-md bg-white/10 px-3 py-1.5 text-xs text-white/70 transition hover:bg-white/20 hover:text-white"
                  >
                    {preset.name}
                  </button>
                ))}
              </div>
            </div>

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
                <input
                  type="color"
                  value={style.textColor}
                  onChange={(e) => update({ textColor: e.target.value })}
                  className="h-8 w-8 cursor-pointer rounded-full border-2 border-white/15 bg-transparent"
                  title="Eigene Farbe"
                />
              </div>
            </div>
          </>
        )}

        {/* ===== VISUALIZER TAB ===== */}
        {activeTab === "visualizer" && (
          <>
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

            {/* Wave Config (Trap Nation) */}
            {style.visualizerMode === "wave" && (() => {
              const wc = style.waveConfig ?? DEFAULT_WAVE_CONFIG;
              const RING_LABELS = ["Ring 1 (außen)", "Ring 2", "Ring 3", "Ring 4", "Ring 5 (innen)"];
              function updateWave(partial: Partial<WaveConfig>) {
                update({ waveConfig: { ...wc, ...partial } });
              }
              function updateColor(index: number, color: string) {
                const colors = [...wc.colors] as WaveConfig["colors"];
                colors[index] = color;
                updateWave({ colors });
              }
              return (
                <div className="flex flex-col gap-3 rounded-md bg-white/5 p-3">
                  <label className="text-xs font-medium text-white/50">Trap Nation Einstellungen</label>

                  {/* Ring Colors */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs text-white/40">Ring-Farben</label>
                    {wc.colors.map((color, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <input
                          type="color"
                          value={color}
                          onChange={(e) => updateColor(i, e.target.value)}
                          className="h-6 w-6 cursor-pointer rounded border-0 bg-transparent"
                        />
                        <span className="text-xs text-white/30">{RING_LABELS[i]}</span>
                      </div>
                    ))}
                    <button
                      onClick={() => updateWave({ colors: [...DEFAULT_WAVE_CONFIG.colors] as WaveConfig["colors"] })}
                      className="mt-1 self-start rounded bg-white/10 px-2 py-1 text-xs text-white/50 hover:bg-white/15 hover:text-white/70"
                    >
                      Standard-Farben
                    </button>
                  </div>

                  {/* Amplitude */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs text-white/40">
                      Amplitude: {wc.gain}
                    </label>
                    <input
                      type="range"
                      min={100}
                      max={500}
                      step={10}
                      value={wc.gain}
                      onChange={(e) => updateWave({ gain: Number(e.target.value) })}
                      className="w-full accent-white"
                    />
                  </div>

                  {/* Radius */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs text-white/40">
                      Kreis-Radius: {wc.radius}px
                    </label>
                    <input
                      type="range"
                      min={80}
                      max={250}
                      step={5}
                      value={wc.radius}
                      onChange={(e) => updateWave({ radius: Number(e.target.value) })}
                      className="w-full accent-white"
                    />
                  </div>

                  {/* Wave Points */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs text-white/40">
                      Glätte: {wc.points}
                    </label>
                    <input
                      type="range"
                      min={12}
                      max={64}
                      step={2}
                      value={wc.points}
                      onChange={(e) => updateWave({ points: Number(e.target.value) })}
                      className="w-full accent-white"
                    />
                  </div>

                  {/* Spread / Frequency Distribution */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs text-white/40">
                      Verteilung: {wc.spread.toFixed(2)} {wc.spread < 0.4 ? "(gleichmäßig)" : wc.spread > 0.8 ? "(konzentriert)" : ""}
                    </label>
                    <input
                      type="range"
                      min={0.2}
                      max={1.0}
                      step={0.05}
                      value={wc.spread}
                      onChange={(e) => updateWave({ spread: Number(e.target.value) })}
                      className="w-full accent-white"
                    />
                  </div>
                </div>
              );
            })()}
          </>
        )}

        {/* ===== BACKGROUND TAB ===== */}
        {activeTab === "background" && (
          <>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-white/40">Hintergrund</label>
              <div className="flex gap-2">
                <button
                  onClick={() => update({ bgImage: "/bg-default.jpg", bgType: "image" })}
                  className="rounded-md bg-white/10 px-3 py-1.5 text-xs text-white/70 transition hover:bg-white/15"
                >
                  Standard
                </button>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="rounded-md bg-white/10 px-3 py-1.5 text-xs text-white/70 transition hover:bg-white/15"
                >
                  Eigenes Bild/Video
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,video/mp4,video/webm"
                  className="hidden"
                  onChange={handleBgUpload}
                />
              </div>
              {style.bgType === "video" && (
                <p className="text-xs text-white/30">Video-Hintergrund aktiv (Loop)</p>
              )}
              {bgError && <p className="text-xs text-red-400">{bgError}</p>}
            </div>
          </>
        )}

        {/* ===== EFFECTS TAB ===== */}
        {activeTab === "effects" && (
          <>
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

            {/* Post Effect */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-white/40">Post-Effekt</label>
              <div className="flex flex-wrap rounded-md bg-white/10 p-0.5">
                {POST_EFFECT_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => update({ postEffect: opt.value })}
                    className={`rounded px-2.5 py-1.5 text-xs transition ${
                      style.postEffect === opt.value
                        ? "bg-white/20 text-white"
                        : "text-white/50 hover:text-white/70"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {/* ===== LOGO TAB ===== */}
        {activeTab === "logo" && (
          <>
            {/* Logo Preview & Upload */}
            <div className="flex flex-col gap-3">
              <label className="text-xs text-white/40">Benutzerdefiniertes Logo</label>

              {/* Current Logo Preview */}
              <div className="flex items-center gap-4 rounded-md bg-white/5 p-3">
                <div className="flex h-16 w-16 items-center justify-center rounded bg-white/10 overflow-hidden">
                  {style.customLogo ? (
                    <img
                      src={style.customLogo}
                      alt="Logo-Vorschau"
                      className="h-full w-full object-contain"
                    />
                  ) : (
                    <span className="text-xs text-white/30">Standard</span>
                  )}
                </div>
                <div className="flex flex-col gap-1">
                  <p className="text-xs text-white/60">
                    {style.customLogo ? "Eigenes Logo aktiv" : "Standard-Logo wird verwendet"}
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => logoInputRef.current?.click()}
                      disabled={logoUploading}
                      className="rounded-md bg-white/10 px-3 py-1.5 text-xs text-white/70 transition hover:bg-white/15 disabled:opacity-40"
                    >
                      {logoUploading ? "Upload..." : "Logo hochladen"}
                    </button>
                    {style.customLogo && (
                      <button
                        onClick={() => update({ customLogo: null })}
                        className="rounded-md bg-white/5 px-3 py-1.5 text-xs text-white/40 transition hover:bg-white/10 hover:text-white/60"
                      >
                        Zurücksetzen
                      </button>
                    )}
                  </div>
                </div>
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleLogoUpload}
                />
              </div>

              {logoError && <p className="text-xs text-red-400">{logoError}</p>}
              <p className="text-xs text-white/25">PNG, SVG, JPG oder WebP, max. 5 MB</p>
            </div>

            {/* Watermark Toggle */}
            <div className="flex items-center justify-between">
              <label className="text-xs text-white/40">Wasserzeichen</label>
              <button
                onClick={() => update({ showWatermark: !style.showWatermark })}
                className={`relative h-6 w-10 shrink-0 rounded-full transition ${
                  style.showWatermark ? "bg-white/30" : "bg-white/10"
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                    style.showWatermark ? "translate-x-4" : "translate-x-0"
                  }`}
                />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
