# coded-lyrics

Play an audio file in the terminal while lyrics appear **word by word** in a Brat-style layout (lowercase, centered, irregular gaps) — like [Brat Generator](https://www.bratgenerator.com/), rendered as half-block type on a CRT phosphor ground.

Each timed **line** from your LRC replaces the previous one. Words wipe in as they land, the outgoing line dissolves out behind them, and the type breathes with the track.

## Requirements

- Node.js 18+
- An audio player on your PATH:
  - **macOS**: `afplay` (built-in)
  - **elsewhere**: `ffplay` (ffmpeg) or `mpv`
- **ffmpeg** (optional) — enables audio-reactive motion. Without it everything still runs, just unreactive.

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
npm run dev -- ./2TONE/2TONE.mp3 ./2TONE/2TONE.lrc --palette brat
npm run dev -- ./song.mp3 ./song.lrc --palette vhs --transition glitch --react full
```

After building:

```bash
npm run build
npx coded-lyrics ./song.mp3 ./examples/sample.json
```

### Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--palette <name>` | `phosphor` | See [Palettes](#palettes) |
| `--transition <kind>` | `wipe` | `wipe`, `dissolve`, `glitch`, or `none` |
| `--react <level>` | `subtle` | `off`, `subtle`, or `full` — how hard the audio drives the visuals |
| `--no-title` | | Skip the opening title card |
| `--no-color` | | Render without colour (also honours `NO_COLOR`) |
| `--fps <n>` | `30` | Render frame rate |
| `--theme <name>` | | Deprecated alias for `--palette`; `white` → `360`, `black` → `mono` |

### Palettes

| Name | Look |
|------|------|
| `phosphor` | Green CRT terminal on black, scanlines — the default |
| `amber` | Amber CRT on black, scanlines |
| `brat` | Black on brat green `#8ACE00`, flat ground |
| `360` | Black on white |
| `vhs` | Hot pink on deep purple, scanlines |
| `mono` | White on black |

Colour is emitted as truecolor where the terminal advertises it (`COLORTERM=truecolor`), quantised to the 256-colour cube otherwise.

### Controls

| Key | Action |
|-----|--------|
| `space` | Play / pause |
| `←` / `→` | Seek −5s / +5s |
| `s` | Stop (pause and jump to the start) |
| `q` / Ctrl+C | Quit |

Needs a seekable player: **ffplay** (ffmpeg) or **mpv**. On this machine `ffplay` is preferred over `afplay` so pause/seek work.

Playback runs in the terminal's alternate screen buffer, so quitting restores whatever was on screen before.

## Lyrics format

**LRC** (one screen per timestamped line; words within the line reveal in a short burst, then hold until the next line):

```lrc
[ti: 2 tone]
[00:09.83] Nobody wants to be cool as her
[00:11.93] Popped out with my jeweler, yeah
```

Plain LRC has no per-word times — words are front-loaded (~280ms apart) so they don’t lag when the vocal finishes early. Lines longer than six words are broken into consecutive screens. For true karaoke word sync, use enhanced LRC (`<mm:ss.xx>word`) or JSON word timestamps.

A `[ti:]` tag (or `title` in JSON) shows as a title card for the first two seconds.

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

## How it renders

Text is laid out in a Brat-style block: short rows, wide uneven gaps between words, every row stretched to the same outer edges, and a lone word on a row centered rather than left-hung.

Letters are drawn with the Unicode half blocks `▀ ▄ █`, so two glyph pixels fit in one terminal cell. Since a cell is roughly twice as tall as it is wide, that makes a glyph pixel square — letterforms come out wide and correctly proportioned instead of stretched vertically.

There are two hand-drawn glyph sizes rather than one that gets resampled: downscaling merges the rows carrying a letter's identity, and `a`, `c`, `e` and `o` all collapse into the same blob. The renderer walks a ladder — large, large-condensed, small, small-condensed — and picks the biggest size whose block fits your terminal, so lyrics are never clipped.

Frames are diffed row by row and only changed rows are rewritten, so nothing flickers.

With ffmpeg present, the file is decoded once at startup into a 50 Hz loudness envelope. Kicks fatten the strokes for a beat, the ground texture brightens with the energy, and the whole screen flashes fractionally on a hit. Every effect is a pure function of playback position, so scrubbing lands on exactly the frame it should.

## License

MIT
