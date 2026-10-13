# Launch video: Polychoron AI, AML Detection & Filing

`brag.mp4` (48.5s) and `brag-20s.mp4` (23.3s social cut), poster `brag.jpg`,
share text in `share-copy.txt`. Storyboard and decisions: `brag-plan.md`.

The videos are generated, not committed. Rebuild them from the running
local stack after updating this branch from develop:

    cd work
    npm ci && npx playwright install chromium-headless-shell   # first time only
    ./build.sh

`build.sh` takes about 10 minutes. It loads capture data into the dev
database: synthetic case volume, six months of sampling reviews, clean
fictitious names and one incomplete-evidence case. It then captures every
screen from the real app, renders the composition frame by frame,
synthesises the music and encodes both cuts. At the end it resets the demo
environment to its clean two-case state.

| Path | What it is |
|---|---|
| `composition/index.html` | The video: every frame is `render(t)`, scene timings in `S` |
| `work/capture.mjs`, `capture2.mjs` | Screen captures (2× resolution) into `work/shots/` |
| `work/prep.sh`, `prep.sql`, `rebuild-data.sh` | Capture dataset; re-rolls the agent until its narrative has no clock times |
| `work/render.mjs` | Frames (`frames`) or review stills (`stills 12.5 30 …`) |
| `work/synth2.mjs` | The 120 BPM soundtrack (original, synthesised) |
| `work/boxes.json` | Element positions from the last capture, used by the composition |

If a screen's layout changes, check the hand-set coordinates in
`composition/index.html` (queue rows, checkbox positions, crop offsets)
against `work/boxes.json`. Then run `node render.mjs stills …` before a
full build.
