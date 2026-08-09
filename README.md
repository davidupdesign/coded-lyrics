# coded-lyrics

Play a track with lyrics appearing **word by word** over an ASCII-art music video — in your
terminal, or in a browser.

The lyric is plain text, one cell per character. The background is a video decoded to a
density ramp (` .:-=+*#%@`), tinted in the active palette and dimmed well below the lyric so
the text always wins. Words wipe in as they land, the outgoing line dissolves out behind
them, and the picture breathes with the track.

Both front-ends draw the same frames from the same compositor — see
[Two front-ends](#two-front-ends).

- **[Terminal](#terminal)** — the CLI. Plain ASCII, nothing else.
- **[Browser](#browser)** — drop in audio, video and lyrics, and get a terminal that isn't
  limited to your terminal's font size. That is the interesting part: when the cell size is
  ours to pick, the picture can get much finer than any terminal allows.

## Browser

```bash
npm install
npm --prefix web install
npm run web            # http://localhost:5173
```

Drop an audio file, a lyrics file and (optionally) a video anywhere on the page. A single
music video works on its own — it supplies both the sound and the picture. **Nothing is
uploaded**: files are read in the tab via object URLs and never leave the machine, so the
whole thing deploys as static files.

### Making it look good

Two knobs that a terminal welds together are separate here, and that separation is the whole
point:

- **Density** — how many cells the picture is made of (80 → 480 columns).
- **Text size** — how many cells one lyric character spans (1× → 6×).

At one character per cell, a denser grid means a sharper picture *and* unreadable words. Set
density to 320 and text size to 4× and you get both: a finely resolved background with words
that stay large.

| Control | What it does |
|---|---|
| **Density** | Columns to aim for. The grid is derived from an integer cell size that fits, so it can never overflow the page. |
| **Cell shape** | 2.0 is a terminal cell; 1.0 is square. Square resolves roughly twice the rows and is where the picture gets sharp. |
| **Sub-cell detail** | Splits each cell with block characters: `▀` for 2×, quadrants for 4×, braille for 8×. |
| **Text size** | Cells per lyric character. Independent of density. |
| **Fit** | Fill the window, or letterbox to 16:9 / 4:3 / 1:1 / 9:16. |
| **Pixel density** | Render at the display's real pixel ratio for crisp glyphs on retina. |
| **Cell budget** | Hard cap on cell count, so a huge window can't tank the frame rate. |

**Reach for sub-cell detail before density.** Cost is one draw per non-blank cell, so it
tracks how much of the grid the picture fills — roughly 0.55 µs per drawn cell, which puts
60 fps at about 29 000 filled cells. Braille spends one cell on eight sub-samples instead of
one, so it buys resolution without buying cells. Measured on the same frame of the same
clip:

| Setting | Grid | Cells drawn | Frame time |
|---|---|---|---|
| 320 columns, no sub-cell | 366×141 | 49 356 | 29.3 ms |
| 160 columns, braille | 169×65 | 9 146 | **2.9 ms** |

The second resolves *more* picture (338×260 sub-samples against 366×141) for a tenth of the
work. The readout in the panel shows cells drawn, frame time and fps live, and turns amber
past 12 ms and red past 25 ms.

### Keys

`space` play/pause · `←`/`→` seek ±5s · `s` stop · `f` fullscreen · `[`/`]` text size ·
`-`/`=` density · `p` cycle palette · `1`–`6` palette

## Terminal

### Requirements

- Node.js 18+
- An audio player on your PATH:
  - **macOS**: `afplay` (built-in)
  - **elsewhere**: `ffplay` (ffmpeg) or `mpv`
- **ffmpeg** (optional) — enables the ASCII background and audio-reactive motion. Without
  it everything still runs, just with a plain ground and no reactivity.

### Usage

```bash
npm run dev -- <audio> <lyrics>
```

Examples:

```bash
npm run dev -- ./song.mp3 ./examples/sample.lrc
npm run dev -- ./song.mp3 ./song.lrc --video ./clip.mp4
npm run dev -- ./video.mp4 ./song.lrc                 # one file for both
npm run dev -- ./song.mp3 ./song.lrc --video ./clip.mp4 --palette vhs --transition glitch
```

After building:

```bash
npm run build
npx coded-lyrics ./song.mp3 ./examples/sample.json
```

### Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--video <path>` | the audio file | Clip to render as the ASCII background |
| `--no-video` | | Skip the background; fall back to the palette's ground |
| `--video-gain <n>` | `1` | Brightness multiplier — raise it for a dark clip |
| `--no-plate` | | Don't clear the background behind the lyric |
| `--palette <name>` | `phosphor` | See [Palettes](#palettes) |
| `--transition <kind>` | `wipe` | `wipe`, `dissolve`, `glitch`, or `none` |
| `--react <level>` | `subtle` | `off`, `subtle`, or `full` — how hard the audio drives the visuals |
| `--no-title` | | Skip the opening title card |
| `--no-color` | | Render without colour (also honours `NO_COLOR`) |
| `--fps <n>` | `30` | Render frame rate |
| `--theme <name>` | | Deprecated alias for `--palette`; `white` → `360`, `black` → `mono` |

### The background

`--video` takes any file ffmpeg can read. With no `--video`, the audio file is used when it
carries a video stream — so a music video plays as both the audio and the picture from a
single argument. An mp3's embedded cover art does *not* count as a video stream.

The clip is decoded once, in the background, into a 128×72 luminance grid at 12 fps.
Decoding runs far ahead of playback, so nothing waits on it at startup, and holding the
whole clip is what makes seeking exact — the frame shown is a pure function of the playback
position. Budget roughly 80 MB for a 12-minute clip; anything longer is capped there and
loops. A clip shorter than the track loops too.

`--video-gain` is the one knob worth reaching for. Dark footage turns to mush at the bottom
of the ramp; `--video-gain 1.8` opens it back up.

### Palettes

| Name | Look |
|------|------|
| `phosphor` | Green CRT terminal on black, scanlines — the default |
| `amber` | Amber CRT on black, scanlines |
| `brat` | Black on brat green `#8ACE00`, flat ground |
| `360` | Black on white |
| `vhs` | Hot pink on deep purple, scanlines |
| `mono` | White on black |

Colour is emitted as truecolor where the terminal advertises it (`COLORTERM=truecolor`),
quantised to the 256-colour cube otherwise.

### Controls

| Key | Action |
|-----|--------|
| `space` | Play / pause |
| `←` / `→` | Seek −5s / +5s |
| `s` | Stop (pause and jump to the start) |
| `q` / Ctrl+C | Quit |

Needs a seekable player: **ffplay** (ffmpeg) or **mpv**. On this machine `ffplay` is
preferred over `afplay` so pause/seek work.

Playback runs in the terminal's alternate screen buffer, so quitting restores whatever was
on screen before.

## Lyrics format

**LRC** (one screen per timestamped line; words within the line reveal in a short burst,
then hold until the next line):

```lrc
[ti: my track]
[00:09.83] first line of the song
[00:11.93] second line of the song
```

Plain LRC has no per-word times — words are front-loaded (~280ms apart) so they don't lag
when the vocal finishes early. Lines longer than twelve words are broken into consecutive
screens. For true karaoke word sync, use enhanced LRC (`<mm:ss.xx>word`) or JSON word
timestamps.

A `[ti:]` tag (or `title` in JSON) shows as a title card for the first two seconds.

**JSON** with explicit lines:

```json
{
  "title": "my track",
  "lines": [
    {
      "start": 0.0,
      "words": [
        { "text": "first", "start": 0.0 },
        { "text": "word", "start": 0.4 }
      ]
    }
  ]
}
```

See [examples/](./examples/) for more. The same parser reads them in both
front-ends, so a file that works in one works in the other.

## Two front-ends

Everything that decides what a frame looks like lives in `src/core/` — parsing, layout, the
transitions, the video resampling and the compositor that turns them into a grid of glyphs
and colour attributes. It imports nothing from Node and nothing from the DOM.

Around that sit two hosts. `src/node/` turns a frame into escape sequences and drives ffmpeg
and an audio player; `web/` turns the same frame into `drawImage` calls against a glyph atlas
and drives `<audio>`/`<video>`. Neither knows about the other.

This is checked rather than assumed. `npm run goldens:check` re-renders 59 terminal frames
and compares them byte for byte, and `src/dev/dump-cells.ts` prints the cell contents of a
frame so the same computation can be run in a browser and the two hashes compared — they
match, which is what "the same picture, drawn differently" has to mean.

```
npm run check          # typecheck (both packages) + tests + golden frames
npm test               # unit tests
npm run goldens:check  # terminal output, byte for byte
```

## How it renders

Each lyric line is wrapped to the terminal width and centred. Every character records which
word cue it came from, so words reveal one at a time and the word currently landing takes
the accent colour while the settled ones sit at the base ink.

Behind it, the video frame for the current position is box-averaged onto the cell grid. The
fit accounts for the cell's shape — a terminal cell is about twice as tall as it is wide, so
a region of `cols × rows` cells covers `cols × 2·rows` square units, and fitting against that
instead of `cols/rows` is the difference between a correct picture and a squashed one. In the
browser that ratio is a setting rather than a constant, which is why "cell shape" exists and
why getting it wrong is so visible. Brightness picks both the ramp character and one of four
colour tiers, so a whole run of similar cells costs a single escape sequence.

The lyric sits on a **plate**: a couple of cells either side are cleared back to the
background before the text is drawn. Plain text at one cell per character is genuinely
unreadable over a dense ASCII field without it — a stray `%` landing in a word gap is enough
to break the line. `--no-plate` shows you why.

In the terminal, frames are diffed row by row and only changed rows are rewritten, so nothing
flickers. Without a video roughly four rows of forty change per frame; with one, most of the
screen changes on each new video frame, which still comes to about 55 KB/s. The browser skips
blank cells instead, which is the same idea aimed at a different bottleneck.

The audio is also decoded once, up front, into a 50 Hz loudness envelope — by ffmpeg in the
terminal and by `decodeAudioData` in the browser. Kicks lift the picture's brightness, the
ground texture brightens with the energy, and the whole screen flashes fractionally on a hit.
A live analyser would have been the obvious browser answer and is the wrong one: its output
depends on *when* you ask, so seeking backwards would paint something different from playing
forwards through the same moment.

That is the property the whole design protects. Every effect draws its randomness from a hash
of the cell's coordinates rather than a frame counter, and the lyric state, the video frame
and the envelope are all keyed on seconds alone, so scrubbing to the same position twice
paints the same frame. The one place the browser cannot quite match this is the video layer,
which only has the frame the element is currently decoding; a short ring of recent captures
covers small scrubs, and a long seek resolves as soon as the element settles.

## License

MIT
