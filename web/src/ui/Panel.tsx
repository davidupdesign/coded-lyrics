/**
 * The controls panel: every terminal flag, plus the settings that only make
 * sense once the cell size is ours to choose.
 */
import type { ReactNode } from "react";
import {
  CELL_ASPECT_SQUARE,
  CELL_ASPECT_TERMINAL,
  DENSITY_ORDER,
  DENSITY_PRESETS,
  type DensityPreset,
  type GridOptions,
} from "@core/layout.js";
import { paletteNames } from "@core/palette.js";
import { SUBCELL_MODES } from "@core/subcell.js";
import { TRANSITION_KINDS } from "@core/transitions.js";
import { REACT_LEVELS } from "@core/types.js";
import type { Settings } from "../state/settings.js";
import type { PerfSample } from "./Stage.jsx";

// ------------------------------------------------------------------ widgets

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="group">
      <h3 className="group-title">{title}</h3>
      <div className="group-body">{children}</div>
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="row">
      <span className="row-label">
        {label}
        {hint && <em className="row-hint">{hint}</em>}
      </span>
      <span className="row-control">{children}</span>
    </label>
  );
}

function Segmented<T extends string>({
  value, options, onChange, labels,
}: {
  value: T;
  options: readonly T[];
  onChange: (v: T) => void;
  labels?: Record<string, string>;
}) {
  return (
    <span className="seg">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          className={`seg-item${o === value ? " is-on" : ""}`}
          onClick={() => onChange(o)}
        >
          {labels?.[o] ?? o}
        </button>
      ))}
    </span>
  );
}

function Slider({
  value, min, max, step, onChange, format,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  return (
    <span className="slider">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <output>{format ? format(value) : value}</output>
    </span>
  );
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      className={`toggle${value ? " is-on" : ""}`}
      role="switch"
      aria-checked={value}
      onClick={() => onChange(!value)}
    >
      <span className="toggle-knob" />
    </button>
  );
}

// -------------------------------------------------------------------- panel

interface PanelProps {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  onGrid: (patch: Partial<GridOptions>) => void;
  perf: PerfSample | null;
  hasVideo: boolean;
  hasSeparateVideo: boolean;
}

export function Panel({
  settings, onChange, onGrid, perf, hasVideo, hasSeparateVideo,
}: PanelProps) {
  const g = settings.grid;

  return (
    <div className="panel-scroll">
      <PerfReadout perf={perf} />

      <Group title="Resolution">
        <Row label="Sizing">
          <Segmented
            value={g.mode}
            options={["preset", "cellPx", "autoFit"] as const}
            labels={{ preset: "preset", cellPx: "cell size", autoFit: "auto-fit" }}
            onChange={(mode) => onGrid({ mode })}
          />
        </Row>

        {g.mode === "preset" && (
          <Row label="Density" hint={`${DENSITY_PRESETS[g.preset]} cols`}>
            <Segmented
              value={g.preset}
              options={DENSITY_ORDER}
              labels={Object.fromEntries(
                DENSITY_ORDER.map((p: DensityPreset) => [p, String(DENSITY_PRESETS[p])]),
              )}
              onChange={(preset) => onGrid({ preset })}
            />
          </Row>
        )}

        {g.mode === "cellPx" && (
          <Row label="Cell width" hint="css px">
            <Slider
              value={g.cellPx}
              min={3}
              max={40}
              step={1}
              onChange={(cellPx) => onGrid({ cellPx })}
              format={(v) => `${v}px`}
            />
          </Row>
        )}

        {g.mode === "autoFit" && (
          <Row label="Smallest cell" hint="legibility floor">
            <Slider
              value={g.autoFitMinCellPx}
              min={2}
              max={20}
              step={1}
              onChange={(autoFitMinCellPx) => onGrid({ autoFitMinCellPx })}
              format={(v) => `${v}px`}
            />
          </Row>
        )}

        <Row label="Cell shape" hint={aspectName(g.cellAspect)}>
          <Slider
            value={g.cellAspect}
            min={1}
            max={2.4}
            step={0.05}
            onChange={(cellAspect) => onGrid({ cellAspect })}
            format={(v) => v.toFixed(2)}
          />
        </Row>
        <Row label="" hint="square cells resolve the most detail">
          <span className="seg">
            <button
              type="button"
              className="seg-item"
              onClick={() => onGrid({ cellAspect: CELL_ASPECT_SQUARE })}
            >
              square
            </button>
            <button
              type="button"
              className="seg-item"
              onClick={() => onGrid({ cellAspect: CELL_ASPECT_TERMINAL })}
            >
              terminal
            </button>
          </span>
        </Row>

        <Row label="Fit">
          <Segmented
            value={g.fit}
            options={["fill", "letterbox"] as const}
            onChange={(fit) => onGrid({ fit })}
          />
        </Row>
        {g.fit === "letterbox" && (
          <Row label="Aspect">
            <Segmented
              value={aspectKey(g.lockAspect)}
              options={["16:9", "4:3", "1:1", "9:16"] as const}
              onChange={(k) => onGrid({ lockAspect: ASPECTS[k] })}
            />
          </Row>
        )}

        <Row label="Pixel density" hint="sharpness on retina">
          <Segmented
            value={g.dprMode}
            options={["css", "native", "2x"] as const}
            labels={{ css: "1×", native: "auto", "2x": "2×" }}
            onChange={(dprMode) => onGrid({ dprMode })}
          />
        </Row>

        <Row label="Cell budget" hint="caps the grid to protect the frame rate">
          <Slider
            value={g.maxCells}
            min={5000}
            max={150000}
            step={5000}
            onChange={(maxCells) => onGrid({ maxCells })}
            format={(v) => `${Math.round(v / 1000)}k`}
          />
        </Row>
      </Group>

      <Group title="Lyrics">
        <Row label="Text size" hint="cells per character">
          <Slider
            value={settings.lyricScale}
            min={1}
            max={6}
            step={1}
            onChange={(lyricScale) => onChange({ lyricScale })}
            format={(v) => `${v}×`}
          />
        </Row>
        <Row label="Line width" hint="characters">
          <Slider
            value={settings.lyricMaxChars}
            min={20}
            max={200}
            step={2}
            onChange={(lyricMaxChars) => onChange({ lyricMaxChars })}
          />
        </Row>
        <Row label="Entrance">
          <Segmented
            value={settings.transition}
            options={TRANSITION_KINDS}
            onChange={(transition) => onChange({ transition })}
          />
        </Row>
        <Row label="Title card">
          <Toggle value={settings.titleCard} onChange={(titleCard) => onChange({ titleCard })} />
        </Row>
        <Row label="Plate" hint="clear the background behind the words">
          <Toggle value={settings.plate} onChange={(plate) => onChange({ plate })} />
        </Row>
      </Group>

      <Group title="Look">
        <Row label="Palette">
          <select
            className="select"
            value={settings.palette}
            onChange={(e) => onChange({ palette: e.target.value })}
          >
            {paletteNames().map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </Row>
        <Row label="React to audio">
          <Segmented
            value={settings.react}
            options={REACT_LEVELS}
            onChange={(react) => onChange({ react })}
          />
        </Row>
        <Row label="Terminal footer" hint="progress bar inside the grid">
          <Toggle
            value={settings.terminalFooter}
            onChange={(terminalFooter) => onChange({ terminalFooter })}
          />
        </Row>
        <Row label="Reduce motion" hint="removes the beat flash">
          <Toggle
            value={settings.reducedMotion}
            onChange={(reducedMotion) => onChange({ reducedMotion })}
          />
        </Row>
      </Group>

      <Group title="Video">
        <Row label="Background">
          <Toggle
            value={settings.videoEnabled}
            onChange={(videoEnabled) => onChange({ videoEnabled })}
          />
        </Row>
        <Row label="Sub-cell detail" hint="split each cell into finer pieces">
          <Segmented
            value={settings.subcell}
            options={SUBCELL_MODES}
            labels={{ off: "off", half: "2×", quadrant: "4×", braille: "8×" }}
            onChange={(subcell) => onChange({ subcell })}
          />
        </Row>
        <Row label="Brightness">
          <Slider
            value={settings.videoGain}
            min={0.2}
            max={5}
            step={0.1}
            onChange={(videoGain) => onChange({ videoGain })}
            format={(v) => `${v.toFixed(1)}×`}
          />
        </Row>
        {hasSeparateVideo && (
          <Row label="A/V offset" hint="nudge the picture against the sound">
            <Slider
              value={settings.avOffset}
              min={-2}
              max={2}
              step={0.05}
              onChange={(avOffset) => onChange({ avOffset })}
              format={(v) => `${v > 0 ? "+" : ""}${v.toFixed(2)}s`}
            />
          </Row>
        )}
        {!hasVideo && <p className="group-note">No clip loaded — drop a video to use one.</p>}
      </Group>

      <Group title="Playback">
        <Row label="Frame rate">
          <Slider
            value={settings.fpsCap}
            min={10}
            max={120}
            step={5}
            onChange={(fpsCap) => onChange({ fpsCap })}
            format={(v) => `${v} fps`}
          />
        </Row>
        <Row label="Volume">
          <Slider
            value={settings.volume}
            min={0}
            max={1}
            step={0.01}
            onChange={(volume) => onChange({ volume })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
        </Row>
        <Row label="Loop">
          <Toggle value={settings.loop} onChange={(loop) => onChange({ loop })} />
        </Row>
      </Group>

      <Group title="Keys">
        <dl className="keys">
          <dt>space</dt><dd>play / pause</dd>
          <dt>← →</dt><dd>seek ±5s</dd>
          <dt>s</dt><dd>stop</dd>
          <dt>f</dt><dd>fullscreen</dd>
          <dt>[ ]</dt><dd>text size</dd>
          <dt>- =</dt><dd>density</dd>
          <dt>p</dt><dd>cycle palette</dd>
        </dl>
      </Group>
    </div>
  );
}

const ASPECTS: Record<string, number> = {
  "16:9": 16 / 9,
  "4:3": 4 / 3,
  "1:1": 1,
  "9:16": 9 / 16,
};

function aspectKey(v: number | null): "16:9" | "4:3" | "1:1" | "9:16" {
  if (v == null) return "16:9";
  let best: keyof typeof ASPECTS = "16:9";
  for (const k of Object.keys(ASPECTS)) {
    if (Math.abs(ASPECTS[k] - v) < Math.abs(ASPECTS[best] - v)) best = k;
  }
  return best as "16:9" | "4:3" | "1:1" | "9:16";
}

function aspectName(v: number): string {
  if (Math.abs(v - 1) < 0.06) return "square";
  if (Math.abs(v - 2) < 0.06) return "terminal";
  return v < 1.5 ? "tall pixels" : "wide pixels";
}

function PerfReadout({ perf }: { perf: PerfSample | null }) {
  if (!perf) return null;
  const level = perf.frameMs > 25 ? "bad" : perf.frameMs > 12 ? "warn" : "good";
  return (
    <div className={`perf perf-${level}`}>
      <div className="perf-grid">
        {perf.cols}×{perf.rows}
      </div>
      <div className="perf-meta">
        {/* Drawn cells, not grid cells: blanks are skipped, so a dark frame is
            far cheaper than a bright one and this is what the cost tracks. */}
        <span>
          {perf.drawn.toLocaleString()} / {perf.cells.toLocaleString()} drawn
        </span>
        <span>
          {perf.cellW}×{perf.cellH}px
        </span>
        <span>{perf.frameMs.toFixed(1)} ms</span>
        <span>{Math.round(perf.fps)} fps</span>
      </div>
    </div>
  );
}
