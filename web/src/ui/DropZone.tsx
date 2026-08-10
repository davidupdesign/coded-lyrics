/**
 * Whole-window drop target, plus the empty state that explains what to drop.
 *
 * Listens on the window rather than on a box so a drop anywhere lands, and
 * tracks a counter instead of a boolean because dragenter/dragleave fire for
 * every nested element the pointer crosses.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";

interface DropZoneProps {
  onFiles: (files: File[]) => void;
  children: ReactNode;
}

export function DropZone({ onFiles, children }: DropZoneProps) {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);

  useEffect(() => {
    const over = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    };
    const enter = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      e.preventDefault();
      depth.current++;
      setDragging(true);
    };
    const leave = () => {
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      if (!e.dataTransfer?.files.length) return;
      e.preventDefault();
      depth.current = 0;
      setDragging(false);
      onFiles([...e.dataTransfer.files]);
    };

    window.addEventListener("dragover", over);
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, [onFiles]);

  return (
    <>
      {children}
      {dragging && (
        <div className="drop-veil">
          <div className="drop-veil-inner">drop audio · video · lyrics</div>
        </div>
      )}
    </>
  );
}

export function EmptyState({ onPick }: { onPick: (files: File[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="empty">
      <pre className="empty-art" aria-hidden="true">{
`░█▀▀░█▀█░█▀▄░█▀▀░█▀▄   ░█░░░█░█░█▀▄░▀█▀░█▀▀░█▀▀
░█░░░█░█░█░█░█▀▀░█░█   ░█░░░░█░░█▀▄░░█░░█░░░▀▀█
░▀▀▀░▀▀▀░▀▀░░▀▀▀░▀▀░   ░▀▀▀░░▀░░▀░▀░▀▀▀░▀▀▀░▀▀▀`
      }</pre>
      <p className="empty-lead">Drop your files anywhere, or pick them.</p>
      <ul className="empty-list">
        <li>
          <b>audio</b> <span>mp3 · wav · m4a · flac · ogg</span>
        </li>
        <li>
          <b>video</b> <span>mp4 · webm · mov — optional, becomes the background</span>
        </li>
        <li>
          <b>lyrics</b> <span>lrc · json — plain or word-timed</span>
        </li>
      </ul>
      <p className="empty-note">
        A single music video works on its own: it supplies both the sound and the picture.
      </p>
      <button className="btn btn-primary" onClick={() => input.current?.click()}>
        Choose files
      </button>
      <input
        ref={input}
        id="file-picker"
        name="files"
        type="file"
        multiple
        hidden
        accept="audio/*,video/*,.lrc,.txt,.json"
        onChange={(e) => {
          if (e.target.files) onPick([...e.target.files]);
          e.target.value = "";
        }}
      />
      <p className="empty-privacy">
        Nothing is uploaded. Files are read in this tab and never leave your machine.
      </p>
    </div>
  );
}
