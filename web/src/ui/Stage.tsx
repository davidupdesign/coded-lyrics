/**
 * The screen.
 *
 * Owns the canvas, the compositor and the frame loop. The loop reads the
 * transport's clock every tick and composes from that alone — it never
 * accumulates its own time — so a dropped frame or a seek costs nothing but the
 * frame it was on, and pausing freezes on exactly the right picture.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { FrameCompositor, type ComposeConfig } from "@core/compose.js";
import { computeGrid, type GridSpec } from "@core/layout.js";
import { resolvePalette, PALETTES } from "@core/palette.js";
import type { Envelope, VideoSource } from "@core/ports.js";
import type { LineCue } from "@core/types.js";
import {
  BigGlyphCache,
  buildAtlas,
  maxCellForBudget,
  atlasKey,
  type GlyphAtlas,
} from "../render/atlas.js";
import { Canvas2DPainter } from "../render/painter2d.js";
import type { Transport } from "../media/transport.js";
import type { Settings } from "../state/settings.js";

export interface PerfSample {
  cols: number;
  rows: number;
  cellW: number;
  cellH: number;
  cells: number;
  drawn: number;
  frameMs: number;
  fps: number;
}

interface StageProps {
  lines: LineCue[];
  title: string;
  transport: Transport | null;
  video: VideoSource | null;
  envelope: Envelope | null;
  settings: Settings;
  onPerf?: (p: PerfSample) => void;
}

export function Stage({
  lines, title, transport, video, envelope, settings, onPerf,
}: StageProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const painterRef = useRef<Canvas2DPainter | null>(null);
  const atlasRef = useRef<GlyphAtlas | null>(null);
  const bigGlyphsRef = useRef<BigGlyphCache | null>(null);
  const compositorRef = useRef<FrameCompositor | null>(null);
  const [grid, setGrid] = useState<GridSpec | null>(null);

  const palette = resolvePalette(settings.palette) ?? PALETTES.phosphor;
  const footerRows = settings.terminalFooter ? 2 : 0;

  // --- painter ------------------------------------------------------------
  useLayoutEffect(() => {
    if (!canvasRef.current) return;
    const painter = new Canvas2DPainter(canvasRef.current);
    painterRef.current = painter;
    return () => {
      painter.dispose();
      painterRef.current = null;
    };
  }, []);

  // --- grid, remeasured whenever the box or the options change ------------
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;

    let queued = 0;
    const measure = () => {
      queued = 0;
      const rect = box.getBoundingClientRect();
      const glyphs = Math.max(64, compositorRef.current?.charset.size ?? 64);
      const spec = computeGrid(
        rect.width,
        rect.height,
        {
          ...settings.grid,
          footerRows,
          maxCellPx: maxCellForBudget(glyphs, settings.grid.cellAspect || 2),
        },
        window.devicePixelRatio || 1,
      );
      setGrid((prev) =>
        prev &&
        prev.cols === spec.cols &&
        prev.rows === spec.rows &&
        prev.cellW === spec.cellW &&
        prev.cellH === spec.cellH
          ? prev
          : spec,
      );
    };

    // Coalesce bursts of resize callbacks — dragging a window edge fires them
    // faster than there is any point regridding.
    const observer = new ResizeObserver(() => {
      if (queued) return;
      queued = requestAnimationFrame(measure);
    });
    observer.observe(box);
    measure();

    return () => {
      observer.disconnect();
      if (queued) cancelAnimationFrame(queued);
    };
  }, [settings.grid, footerRows]);

  // --- compositor ---------------------------------------------------------
  useEffect(() => {
    const cfg: ComposeConfig = {
      palette,
      transition: settings.transition,
      react: settings.react,
      titleCard: settings.titleCard,
      title,
      plate: settings.plate,
      videoGain: settings.videoGain,
      cellAspect: grid?.cellAspect ?? settings.grid.cellAspect,
      lyricMaxChars: settings.lyricMaxChars,
      lyricScale: settings.lyricScale,
      subcell: settings.subcell,
      footerRows,
      flashCap: settings.reducedMotion ? 0 : 1,
    };
    if (!compositorRef.current) compositorRef.current = new FrameCompositor(cfg);
    else compositorRef.current.reconfigure(cfg);
    // Both glyph caches are tinted per palette, so a palette change drops them.
    atlasRef.current = null;
    bigGlyphsRef.current = null;
  }, [
    palette, title, footerRows, grid?.cellAspect,
    settings.transition, settings.react, settings.titleCard, settings.plate,
    settings.videoGain, settings.lyricMaxChars, settings.lyricScale, settings.subcell,
    settings.reducedMotion,
    settings.grid.cellAspect,
  ]);

  // --- resize the painter to the grid -------------------------------------
  useLayoutEffect(() => {
    if (!grid || !painterRef.current) return;
    painterRef.current.resize(grid.cols, grid.rows, grid.cellW, grid.cellH);
    atlasRef.current = null;
    bigGlyphsRef.current = null;
  }, [grid]);

  // --- frame loop ---------------------------------------------------------
  useEffect(() => {
    let raf = 0;
    let lastPaint = 0;
    let smoothedMs = 0;
    let smoothedFps = 0;
    let lastTick = performance.now();

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);

      const painter = painterRef.current;
      const compositor = compositorRef.current;
      if (!painter || !compositor || !grid) return;

      // An fps cap is a matter of skipping ticks: rAF is refresh-locked, so
      // there is no way to ask for frames faster or at an arbitrary rate.
      const minGap = 1000 / Math.max(1, settings.fpsCap);
      if (settings.fpsCap < 240 && now - lastPaint < minGap - 0.5) return;
      const sinceLast = now - lastPaint;
      lastPaint = now;

      const started = performance.now();
      const position = transport?.position() ?? 0;

      const frame = compositor.compose({
        cols: grid.cols,
        rows: grid.rows,
        lines,
        elapsed: position,
        status: {
          paused: transport?.paused() ?? true,
          position,
          duration: transport?.duration() ?? null,
        },
        video,
        envelope,
      });

      // Interning a lyric glyph the atlas has never seen invalidates it, so the
      // check has to come after composing, not before.
      const key = atlasKey({
        cellW: grid.cellW,
        cellH: grid.cellH,
        palette,
        chars: compositor.charset.chars(),
      });
      if (!atlasRef.current || atlasRef.current.key !== key) {
        atlasRef.current = buildAtlas({
          cellW: grid.cellW,
          cellH: grid.cellH,
          palette,
          chars: compositor.charset.chars(),
        });
        painter.setAtlas(atlasRef.current);
      }

      if (!bigGlyphsRef.current) {
        bigGlyphsRef.current = new BigGlyphCache(palette);
        painter.setBigGlyphs(bigGlyphsRef.current);
      }

      painter.draw(frame);

      const elapsedMs = performance.now() - started;
      smoothedMs += (elapsedMs - smoothedMs) * 0.1;
      if (sinceLast > 0 && sinceLast < 1000) {
        smoothedFps += (1000 / sinceLast - smoothedFps) * 0.1;
      }
      if (now - lastTick > 250) {
        lastTick = now;
        onPerf?.({
          cols: grid.cols,
          rows: grid.rows,
          cellW: grid.cellW,
          cellH: grid.cellH,
          cells: grid.cells,
          drawn: painter.drawnCells,
          frameMs: smoothedMs,
          fps: smoothedFps,
        });
      }
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [grid, lines, transport, video, envelope, palette, settings.fpsCap, onPerf]);

  return (
    <div className="stage" ref={boxRef}>
      <canvas
        ref={canvasRef}
        className="stage-canvas"
        style={grid ? { width: `${grid.cssW}px`, height: `${grid.cssH}px` } : undefined}
      />
    </div>
  );
}
