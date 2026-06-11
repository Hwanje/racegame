# F1 — Las Vegas Grand Prix

Browser F1 night-race game. Three.js + vanilla JS, no bundler, no build step.
Player + 7 AI race the Las Vegas Strip Circuit (17 corners, ~6.46 km) at night.

## Commands
- `npm run dev` — serve at localhost:3000 (any static server works; do not open `index.html` via `file://`)
- `npm test` — headless smoke test (`test/smoke.js`): loads the real game sources in Node,
  builds the circuit, and lets an AI lap it with the actual physics. Run this after ANY change
  to Car/Track/AI/tracks data. Needs `npm install` once (pulls `three` for its CJS build).

## Stack constraints
- Three.js **r158 UMD vendored** at `js/lib/three.min.js`. Do NOT bump to r160+ or switch to a
  CDN — the UMD build was removed from the npm package in r160 and CDN tags 404.
- Classic `<script>` tags; load order matters: `tracks/lasvegas.js → Car.js (PHYS, SCALE, TEAMS)
  → Track.js → AI.js → Effects.js → Buildings.js → HUD.js (fmtTime) → AudioManager.js →
  Game.js → Menu.js → main.js`.
- No assets: every texture is a runtime `<canvas>`, all audio is WebAudio synthesis.

## Architecture (one class per file, globals, no modules)
| File | Owns |
|---|---|
| `js/tracks/lasvegas.js` | `LAS_VEGAS` waypoints/corners/DRS/runoff/landmarks, `F1_CIRCUITS` calendar |
| `js/Car.js` | `SCALE`, `PHYS`, `TEAMS`, car mesh + vehicle dynamics (`update(dt, trackInfo)`) |
| `js/Track.js` | curve sampling, `getTrackInfo(x,z)` surface query, racing line + speed profile, all track meshes |
| `js/AI.js` | `AIDriver`: pure pursuit + yaw damping, launch staging, traffic, overtakes |
| `js/Effects.js` | pooled particles: smoke/sparks (shader Points), skid marks (quad ring buffer) |
| `js/Buildings.js` | sky, ground, neon canyon, landmarks, lamp pooling (`update(dt, playerPos)`) |
| `js/HUD.js` | `fmtTime`, broadcast HUD (tower/sectors/delta/minimap), results overlay |
| `js/Game.js` | state machine `idle→grid→lights→racing→finished`, collisions, cameras, timing |
| `js/Menu.js` | calendar/team/tire/laps setup; reuses `new Track(null, data)` for the preview map |

## Units & conventions (get these wrong and everything breaks)
- 1 game unit = **8 m** (`SCALE`). Physics is SI (m/s, m/s²); scene positions are units.
  Position integration: `pos += v * dt / SCALE`.
- Heading θ: forward = `(sin θ, cos θ)` in XZ. X = East, Z = South (CCW circuit).
- `input.steer` **+1 = screen-right = heading decreases** (camera looks along +heading).
  Car physics applies `targetSteer = -input.steer * lock`. AI compensates with `-err`.
- Track param `t ∈ [0,1)` is **arc-length fraction**. CatmullRom's native parameter is NOT
  arc length (waypoint spacing varies) — always go through `Track._idxAt(t)` (LUT) to index
  `samples` / `linePts` / `lineSpeed`. Never `floor(t * N)` directly.
- `car.progress` = `(lap-1) + t` once the start line is first crossed; before that it is `t - 1`
  (the grid sits *behind* the line — the first crossing only starts lap 1, it must not count
  as a completed lap).

## Physics key values (PHYS in Car.js)
- maxSpeed 88.9 m/s (320 km/h), DRS +5%; engine 735 kW power-limited above ~45 m/s
- grip = `gripBase 17 m/s² × μ(surface) × tire × downforce(1 + 0.0006·v², cap 3.2)` → ~5.5 g peak
- maxBrake 54 m/s²; friction circle couples long/lat; slip angle lets heading lead velocity
  (drift), `sliding/lockup/wheelspin` flags drive effects + audio
- Surfaces: tarmac 1.0 · kerb 0.75 · runoff 0.55 · gravel 0.25 · grass 0.35
- Tires: soft 1.15 / medium 1.0 / hard 0.88 grip, plus wear (−18% at 100%) and temp window
- `car.yawRate` is exposed for AI damping and the player stability assist in Game

## Race rules implemented
- 5 start lights at 0.9 s + random hold; physics runs during lights (revs, creep) — player
  moving > 1.2 m/s before lights-out = jump start (+5 s)
- Walls are hard (street circuit): clamp + reflect normal velocity, sparks/thump/shake
- Car-car: two collision circles per car (nose/tail) so cars never visually overlap
- AI hold their grid lane for the first 4 s (`laneHold`), then merge onto the racing line;
  overtakes are committed side-latches for a few seconds, not per-frame dithering
- Sectors at t = ⅓ / ⅔; live delta = current lap vs stored best-lap time-at-t samples

## Performance rules
- ≤ ~12 real PointLights, pooled and re-seated near the player every 0.4 s (Buildings)
- Everything repeated is InstancedMesh (towers, lamps, palms) or a single Points/quad pool
  (lamp glows, smoke, sparks, skids); animated canvas textures redraw at ≤ 8 fps
- Effects are skipped for cars > 80 u from the camera

## Known traps (already fixed once — don't reintroduce)
- jsdelivr `three@0.160/build/three.min.js` does not exist (UMD removed in r160)
- `floor(t * N)` index mapping bent the AI's braking points and pursuit targets off-track
- Counting the grid's first start-line crossing as a lap end ended races instantly
- Gantry boards/beams: plane width is local X; with `rotation.y = a`, X maps to
  `(cos a, -sin a)` in XZ — derive `a` from the tangent/normal, don't guess signs
