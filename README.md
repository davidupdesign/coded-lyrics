# coded-lyrics

Play an audio file in the terminal while lyrics appear **word by word** in a Brat-style layout (lowercase, centered, irregular gaps) — like [Brat Generator](https://www.bratgenerator.com/).

Each timed **line** from your LRC replaces the previous one. Older lines leave the screen.

## Requirements

- Node.js 18+
- An audio player on your PATH:
  - **macOS**: `afplay` (built-in)
  - **elsewhere**: `ffplay` (ffmpeg) or `mpv`

## Install

```bash
npm install
```

## Usage

```bash
npm run dev -- <audio> <lyrics>
```

Examples:

```bash
npm run dev -- ./song.mp3 ./examples/sample.lrc
npm run dev -- ./2TONE/2TONE.mp3 ./2TONE/2TONE.lrc --theme white
```

After building:

```bash
npm run build
npx coded-lyrics ./song.mp3 ./examples/sample.json
```

### Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--theme` | `white` | `white` (black on white) or `black` |
| `--fps` | `30` | Render frame rate |

### Controls

| Key | Action |
|-----|--------|
| `space` | Play / pause |
| `←` / `→` | Seek −5s / +5s |
| `s` | Stop (pause and jump to the start) |
| `q` / Ctrl+C | Quit |

Needs a seekable player: **ffplay** (ffmpeg) or **mpv**. On this machine `ffplay` is preferred over `afplay` so pause/seek work.

## Lyrics format

**LRC** (one screen per timestamped line; words within the line reveal in a short burst, then hold until the next line):

```lrc
[00:09.83] Nobody wants to be cool as her
[00:11.93] Popped out with my jeweler, yeah
```

Plain LRC has no per-word times — words are front-loaded (~140ms apart) so they don’t lag when the vocal finishes early. For true karaoke word sync, use enhanced LRC (`<mm:ss.xx>word`) or JSON word timestamps.

Text is laid out in a Brat-style block: short rows, wide uneven gaps between words.

**JSON** with explicit lines:

```json
{
  "title": "my track",
  "lines": [
    {
      "start": 0.0,
      "words": [
        { "text": "brat", "start": 0.0 },
        { "text": "and", "start": 0.4 }
      ]
    }
  ]
}
```

See [examples/](./examples/) for more.

## License

MIT
