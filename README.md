# Plainsong

A Hemingway-style readability tool. One small, dependency-free engine; two front
ends. It highlights what makes prose hard to read: dense sentences, passive
voice, adverbs, qualifiers, and complex words.

It is a clean-room reimplementation based on the public reverse-engineering of
the Hemingway Editor (its sentence grading is the Automated Readability Index),
with one real improvement: passive-voice detection catches irregular past
participles ("was written", "was taken") that the original silently misses.

## Layout

```
core/      plainsong.js   — the analyzer: pure, DOM-free, zero-dependency
           wordlists.js   — the curated lists (adverb whitelist, qualifiers, complex words)
           plainsong.test.mjs — node test suite
web/       a beautiful single-page editor (transparent textarea over a highlight backdrop)
obsidian/  the Obsidian plugin (CodeMirror 6 live decorations + side panel + status bar)
```

The `core/` engine is the single source of truth. The web app imports it
directly as an ES module; the Obsidian plugin bundles it with esbuild. Neither
front end re-implements any analysis.

## The engine

`analyze(text)` returns `{ sentences, marks, stats }`:

- `marks` — `[{ from, to, type, suggestion? }]`, character offsets into the text.
  Types: `hard`, `veryHard` (sentences); `adverb`, `passive`, `qualifier`,
  `complex` (words/phrases).
- `sentences` — per-sentence `{ from, to, words, grade, level }`.
- `stats` — words, sentences, reading time, document grade, Flesch-Kincaid, and
  per-category counts.

Sentence difficulty is ARI: `grade = 4.71·(chars/word) + 0.5·(words/sentence) − 21.43`.
A sentence must run **14+ words** before it can be flagged (the length gate the
original uses, which people often miss).

```
node core/plainsong.test.mjs   # 18 assertions
```

## Web app

```
python3 -m http.server 5020 --bind 127.0.0.1
# open http://127.0.0.1:5020/web/index.html
```

No build step. Edit live; highlights update on every keystroke. Toggle them on
and off; load a sample.

## Obsidian plugin

```
cd obsidian
npm install --legacy-peer-deps   # Obsidian pins exact CodeMirror versions
npm run build                    # emits obsidian/main.js
# copy main.js, manifest.json, styles.css into <vault>/.obsidian/plugins/plainsong/
```

Live in-editor highlighting via CM6 decorations, a readability side panel
(ribbon icon / "Open readability panel" command), and a status-bar grade.
Category visibility and underline-vs-background style are pure CSS toggles, so
changing a setting is instant with no re-analysis. Code blocks, inline code, and
YAML frontmatter are skipped.

## Credit

Sentence grading and the curated word lists derive from the Hemingway Editor, as
documented in Sam W's "Deconstructing the Hemingway App." This project is an
independent reimplementation for personal use.
