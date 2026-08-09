/**
 * Wiring: files in, one clock, one picture out.
 *
 * The media topology is decided by what was dropped. A single music video is
 * the good case — one element supplies both the sound and the picture, so there
 * is nothing to keep in sync. Separate files mean two elements, and then the
 * audio owns the clock and the video is nudged to follow it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { paletteNames, resolvePalette, PALETTES } from "@core/palette.js";
import { stepPreset, type GridOptions } from "@core/layout.js";
import type { Envelope, VideoSource } from "@core/ports.js";
import type { LyricsDoc } from "@core/types.js";
import { ObjectUrl, classify, readLyrics, trackTitle } from "./media/files.js";
import { Transport } from "./media/transport.js";
import { DomVideoSource, captureSizeFor } from "./media/videoSource.js";
import { analyzeAudioFile } from "./media/envelope.js";
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from "./state/settings.js";
import { DropZone, EmptyState } from "./ui/DropZone.js";
import { Panel } from "./ui/Panel.js";
import { Stage, type PerfSample } from "./ui/Stage.js";
import { TransportBar } from "./ui/Transport.js";
import { useShortcuts } from "./ui/shortcuts.js";

interface Loaded {
  audio: File | null;
  video: File | null;
  lyrics: File | null;
}

type Status =
  | { kind: "idle" }
  | { kind: "working"; message: string }
  | { kind: "error"; message: string };

export default function App() {
  const [files, setFiles] = useState<Loaded>({ audio: null, video: null, lyrics: null });
  const [doc, setDoc] = useState<LyricsDoc | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [perf, setPerf] = useState<PerfSample | null>(null);
  const [transport, setTransport] = useState<Transport | null>(null);
  const [envelope, setEnvelope] = useState<Envelope | null>(null);
  const [videoSource, setVideoSource] = useState<VideoSource | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);

  const audioRef = useRef<HTMLAudioElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const audioUrl = useRef(new ObjectUrl());
  const videoUrl = useRef(new ObjectUrl());

  useEffect(() => saveSettings(settings), [settings]);

  const patch = useCallback((p: Partial<Settings>) => setSettings((s) => ({ ...s, ...p })), []);
  const patchGrid = useCallback(
    (p: Partial<GridOptions>) => setSettings((s) => ({ ...s, grid: { ...s.grid, ...p } })),
    [],
  );

  // The video file is the master only when there is no separate audio track.
  const videoIsMaster = files.video != null && files.audio == null;
  const hasSeparateVideo = files.video != null && files.audio != null;

  // --- intake -------------------------------------------------------------
  const accept = useCallback(async (incoming: File[]) => {
    const next: Partial<Loaded> = {};
    let lyricsFile: File | null = null;

    for (const file of incoming) {
      switch (classify(file)) {
        case "audio": next.audio = file; break;
        case "video": next.video = file; break;
        case "lyrics": lyricsFile = file; break;
        default:
          setStatus({ kind: "error", message: `Not a media or lyrics file: ${file.name}` });
      }
    }
    if (lyricsFile) next.lyrics = lyricsFile;

    if (lyricsFile) {
      try {
        setDoc(await readLyrics(lyricsFile));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setStatus({ kind: "error", message: `Could not read ${lyricsFile.name}: ${message}` });
        return;
      }
    }
    setFiles((f) => ({ ...f, ...next }));
    setStatus({ kind: "idle" });
  }, []);

  // --- media elements follow the loaded files ------------------------------
  useEffect(() => {
    const url = audioUrl.current.set(files.audio);
    if (audioRef.current) audioRef.current.src = url ?? "";
  }, [files.audio]);

  useEffect(() => {
    const url = videoUrl.current.set(files.video);
    if (videoRef.current) videoRef.current.src = url ?? "";
  }, [files.video]);

  useEffect(() => () => {
    audioUrl.current.release();
    videoUrl.current.release();
  }, []);

  // --- one transport over whichever element owns the clock -----------------
  useEffect(() => {
    const master = videoIsMaster ? videoRef.current : audioRef.current;
    if (!master || (!files.audio && !files.video)) {
      setTransport(null);
      return;
    }
    const follower = videoIsMaster ? null : videoRef.current;
    const ctl = new Transport(master, follower);
    setTransport(ctl);
    return () => ctl.destroy();
  }, [files.audio, files.video, videoIsMaster]);

  useEffect(() => {
    if (transport) transport.offset = settings.avOffset;
  }, [transport, settings.avOffset]);

  useEffect(() => {
    for (const el of [audioRef.current, videoRef.current]) {
      if (!el) continue;
      el.volume = settings.volume;
      el.loop = settings.loop;
    }
    // A follower video must stay silent or the track plays twice.
    if (videoRef.current) videoRef.current.muted = !videoIsMaster;
  }, [settings.volume, settings.loop, videoIsMaster]);

  // --- the picture ---------------------------------------------------------
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !files.video || !settings.videoEnabled) {
      setVideoSource(null);
      return;
    }
    const { width, height } = captureSizeFor(160, 45, 16 / 9);
    const source = new DomVideoSource(el, width, height);
    setVideoSource(source);
    return () => source.close();
  }, [files.video, settings.videoEnabled]);

  // Keep the capture in step with the grid: sampling cost scales with source
  // pixels, so a coarse grid should not be reading back a 720p frame.
  useEffect(() => {
    if (!(videoSource instanceof DomVideoSource) || !perf) return;
    const { width, height } = captureSizeFor(perf.cols, perf.rows, 16 / 9);
    videoSource.resize(width, height);
  }, [videoSource, perf?.cols, perf?.rows]);

  // --- loudness, analysed once before playback ----------------------------
  useEffect(() => {
    const source = files.audio ?? files.video;
    if (!source || settings.react === "off") {
      setEnvelope(null);
      return;
    }
    const abort = new AbortController();
    setStatus({ kind: "working", message: "Analysing audio…" });
    void analyzeAudioFile(source, abort.signal).then((env) => {
      if (abort.signal.aborted) return;
      setEnvelope(env);
      setStatus({ kind: "idle" });
    });
    return () => abort.abort();
  }, [files.audio, files.video, settings.react]);

  // --- controls ------------------------------------------------------------
  const toggle = useCallback(() => {
    if (!transport) return;
    void transport.toggle().catch(() => {
      setStatus({ kind: "error", message: "The browser blocked playback — press play again." });
    });
  }, [transport]);

  const fullscreen = useCallback(() => {
    const el = shellRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.().catch(() => {});
  }, []);

  const actions = useMemo(
    () => ({
      toggle,
      seekBy: (d: number) => transport?.seekBy(d),
      stop: () => transport?.stop(),
      fullscreen,
      lyricScale: (d: number) =>
        setSettings((s) => ({ ...s, lyricScale: Math.min(6, Math.max(1, s.lyricScale + d)) })),
      density: (d: number) =>
        setSettings((s) => ({ ...s, grid: { ...s.grid, preset: stepPreset(s.grid.preset, d) } })),
      cyclePalette: () =>
        setSettings((s) => {
          const names = paletteNames();
          return { ...s, palette: names[(names.indexOf(s.palette) + 1) % names.length] };
        }),
      paletteAt: (i: number) =>
        setSettings((s) => ({ ...s, palette: paletteNames()[i] ?? s.palette })),
    }),
    [toggle, transport, fullscreen],
  );

  useShortcuts(actions, transport != null);

  const ready = doc != null && transport != null;
  const title = trackTitle(doc, files.audio ?? files.video);
  const palette = resolvePalette(settings.palette) ?? PALETTES.phosphor;

  return (
    <DropZone onFiles={accept}>
      <div
        className="shell"
        ref={shellRef}
        style={{ ["--stage-bg" as string]: `rgb(${palette.bg.join(",")})` }}
      >
        <header className="head">
          <span className="brand">coded·lyrics</span>
          {title && <span className="head-title">{title}</span>}
          <span className="head-spacer" />
          <FileChips files={files} onClear={() => { setFiles({ audio: null, video: null, lyrics: null }); setDoc(null); }} />
          <button className="btn btn-ghost" onClick={fullscreen} title="Fullscreen (f)">
            ⛶
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => setPanelOpen((v) => !v)}
            aria-expanded={panelOpen}
          >
            {panelOpen ? "hide controls" : "controls"}
          </button>
        </header>

        <main className="body">
          <div className="viewport">
            {ready ? (
              <Stage
                lines={doc.lines}
                title={title}
                transport={transport}
                video={settings.videoEnabled ? videoSource : null}
                envelope={envelope}
                settings={settings}
                onPerf={setPerf}
              />
            ) : (
              <EmptyState onPick={accept} />
            )}
            {status.kind !== "idle" && (
              <div className={`banner banner-${status.kind}`}>
                {status.message}
                {status.kind === "error" && (
                  <button className="btn btn-ghost" onClick={() => setStatus({ kind: "idle" })}>
                    dismiss
                  </button>
                )}
              </div>
            )}
          </div>

          {panelOpen && (
            <aside className="panel">
              <Panel
                settings={settings}
                onChange={patch}
                onGrid={patchGrid}
                perf={perf}
                hasVideo={files.video != null}
                hasSeparateVideo={hasSeparateVideo}
              />
              <button
                className="btn btn-ghost panel-reset"
                onClick={() => setSettings({ ...DEFAULT_SETTINGS })}
              >
                reset to defaults
              </button>
            </aside>
          )}
        </main>

        <TransportBar
          transport={transport}
          onSeek={(s) => transport?.seekTo(s)}
          onToggle={toggle}
          onStop={() => transport?.stop()}
          disabled={!ready}
        />

        {/* The elements that actually decode. The video is on-page but hidden:
            a `display:none` video is allowed to stop producing frames. */}
        <audio ref={audioRef} preload="auto" hidden />
        <video ref={videoRef} className="offscreen-video" preload="auto" playsInline muted />
      </div>
    </DropZone>
  );
}

function FileChips({ files, onClear }: { files: Loaded; onClear: () => void }) {
  const chips = [
    files.audio && { kind: "audio", name: files.audio.name },
    files.video && { kind: "video", name: files.video.name },
    files.lyrics && { kind: "lyrics", name: files.lyrics.name },
  ].filter(Boolean) as { kind: string; name: string }[];

  if (chips.length === 0) return null;
  return (
    <span className="chips">
      {chips.map((c) => (
        <span className="chip" key={c.kind} title={c.name}>
          <b>{c.kind}</b>
          {c.name}
        </span>
      ))}
      <button className="btn btn-ghost" onClick={onClear} title="Clear all">
        ×
      </button>
    </span>
  );
}
