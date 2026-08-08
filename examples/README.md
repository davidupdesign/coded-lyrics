# Examples

```bash
npm run dev -- ./examples/your-song.mp3 ./examples/sample.lrc
```

## LRC

Each `[mm:ss.xx]` line is one screen. When the next timestamp hits, the previous line is cleared. Words on the current line appear one by one (evenly spaced until the next line, unless you use enhanced word tags).

## JSON

```json
{
  "title": "optional",
  "lines": [
    {
      "start": 0.0,
      "words": [
        { "text": "hello", "start": 0.0 },
        { "text": "world", "start": 0.45 }
      ]
    }
  ]
}
```

Text is lowercased at render time. Flat `"words"` arrays still work (treated as a single line).
