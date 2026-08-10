/**
 * Keyboard control.
 *
 * The terminal's bindings come first — space, arrows, `s`, `q` all mean what
 * they mean there — with the browser-only ones layered on top. Anything typed
 * into a field is left alone, or the density keys would fight the sliders.
 */
import { useEffect } from "react";

export interface ShortcutActions {
  toggle: () => void;
  seekBy: (delta: number) => void;
  stop: () => void;
  fullscreen: () => void;
  lyricScale: (delta: number) => void;
  density: (delta: number) => void;
  cyclePalette: () => void;
  paletteAt: (index: number) => void;
}

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

export function useShortcuts(actions: ShortcutActions, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;

      switch (e.key) {
        case " ":
          e.preventDefault();
          actions.toggle();
          return;
        case "ArrowLeft":
        case "h":
        case ",":
          e.preventDefault();
          actions.seekBy(-5);
          return;
        case "ArrowRight":
        case "l":
        case ".":
          e.preventDefault();
          actions.seekBy(5);
          return;
        case "s":
          actions.stop();
          return;
        case "f":
          actions.fullscreen();
          return;
        case "q":
          // Matches the terminal's "get me out of here" without closing the tab.
          if (document.fullscreenElement) void document.exitFullscreen();
          else actions.stop();
          return;
        case "[":
          actions.lyricScale(-1);
          return;
        case "]":
          actions.lyricScale(1);
          return;
        case "-":
        case "_":
          actions.density(-1);
          return;
        case "=":
        case "+":
          actions.density(1);
          return;
        case "p":
          actions.cyclePalette();
          return;
      }

      if (e.key >= "1" && e.key <= "6") actions.paletteAt(Number(e.key) - 1);
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [actions, enabled]);
}
