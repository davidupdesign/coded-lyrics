/**
 * Play/pause, scrubber and the current line, below the stage.
 *
 * The scrubber reads the transport on every animation frame rather than on
 * `timeupdate`, which only fires about four times a second and makes the head
 * visibly lurch.
 */
import { useEffect, useRef, useState } from "react";
import type { Transport as TransportCtl } from "../media/transport.js";

function clock(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const s = Math.floor(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

interface TransportBarProps {
  transport: TransportCtl | null;
  onSeek: (sec: number) => void;
  onToggle: () => void;
  onStop: () => void;
  disabled?: boolean;
}

export function TransportBar({
  transport, onSeek, onToggle, onStop, disabled,
}: TransportBarProps) {
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState<number | null>(null);
  const [paused, setPaused] = useState(true);
  const scrubbing = useRef(false);

  useEffect(() => {
    if (!transport) return;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (!scrubbing.current) setPosition(transport.position());
      setDuration(transport.duration());
      setPaused(transport.paused());
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [transport]);

  const max = duration ?? 0;

  return (
    <div className="transport">
      <button
        className="btn btn-icon"
        onClick={onToggle}
        disabled={disabled}
        aria-label={paused ? "Play" : "Pause"}
        title={paused ? "Play (space)" : "Pause (space)"}
      >
        {paused ? "▶" : "❚❚"}
      </button>
      <button
        className="btn btn-icon"
        onClick={onStop}
        disabled={disabled}
        aria-label="Stop"
        title="Stop (s)"
      >
        ■
      </button>

      <span className="transport-time">{clock(position)}</span>
      <input
        className="scrub"
        type="range"
        min={0}
        max={max || 1}
        step={0.01}
        value={Math.min(position, max || 1)}
        disabled={disabled || !duration}
        onPointerDown={() => (scrubbing.current = true)}
        onPointerUp={() => (scrubbing.current = false)}
        onChange={(e) => {
          const v = Number(e.target.value);
          setPosition(v);
          onSeek(v);
        }}
        aria-label="Seek"
      />
      <span className="transport-time transport-time-total">
        {duration != null ? clock(duration) : "--:--"}
      </span>
    </div>
  );
}
