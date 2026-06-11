# F1 Racing Game — Las Vegas Grand Prix

## Stack
- Three.js r158, vendored UMD at `js/lib/three.min.js` (r160+ removed the UMD build — do not bump via CDN)
- Vanilla JS, multi-file, traditional script tags, no bundler
- Entry: `index.html`
- Test: `npm test` → `test/smoke.js` (headless Node sim: track math + AI laps the circuit with real physics)

## Architecture
```
index.html → css/style.css
           → js/lib/three.min.js  (vendored Three.js UMD)
           → js/tracks/lasvegas.js (waypoints, corners, DRS/runoff zones, landmarks)
           → js/Car.js       (PHYS constants, TEAMS, car model + vector vehicle dynamics)
           → js/Track.js     (arc-length sampling, surface query, racing line + AI speed profile, meshes)
           → js/AI.js        (pure-pursuit drivers, overtaking, start reactions)
           → js/Effects.js   (GPU particle pools: smoke, sparks, skid marks)
           → js/Buildings.js (Vegas scenery: sky, Sphere, casinos, lamps with pooled lights)
           → js/HUD.js       (broadcast HUD: tower, sectors, live delta, minimap, results)
           → js/AudioManager.js (WebAudio synth: engine, screech, wind, beeps)
           → js/Game.js      (state machine, race control, collisions, cameras)
           → js/Menu.js      (calendar, team/tire/laps setup, circuit preview)
           → js/main.js      (boot + overlay wiring)
```
Script load order matters: data → Car (defines PHYS/SCALE) → Track → the rest.

## Units & Conventions
- 1 game unit = 8 m (`SCALE` in Car.js). Physics runs in SI (m/s); positions in units.
- Heading θ: forward = (sin θ, cos θ) in XZ. X = East, Z = South.
- `input.steer` +1 = screen-right (camera looks along +heading → heading decreases).
- Track param `t` ∈ [0,1) is **arc-length** fraction; CatmullRom parameter is not —
  always map t → sample index via `Track._idxAt` (LUT), never linearly.

## Physics Key Values (PHYS in Car.js)
- maxSpeed: 88.9 m/s (320 km/h), DRS: +5%
- maxBraking: 54 m/s² (5.5 g, downforce-capped)
- gripBase 17 m/s² × downforce factor (1 + 0.0006·v², cap 3.2)
- Surface μ — Tarmac 1.0, Kerb 0.75, Runoff 0.55, Gravel 0.25, Grass 0.35
- Tire grip — Soft 1.15, Medium 1.0, Hard 0.88 (+ wear/temp effects)
- Friction-circle model with slip angle: heading may lead velocity → drift/slide/lockup states

## Race Format
- 8 cars: player (last on grid) + 7 AI (skill 0.90–0.97, pure pursuit on precomputed racing line)
- F1 start: 5 lights at 0.9 s + random hold; jump start = +5 s penalty
- Walls are hard (street circuit); paved runoff pockets at T1/T6/T13
- Laps counted on arc-t wrap with first-crossing exemption (grid sits behind the line)

## Active Circuits
Only Las Vegas is playable; the other 23 calendar rounds render locked in the menu.

## Las Vegas Notes
- Night race, 17 corners, ~6.46 km, counter-clockwise, S/F on the Strip
- Layout: Strip → T1 left → Harmon chicane (T2-T3) → T4 onto Koval (DRS) →
  T6 right → Sphere loop (T7-T10) → Sands bus stop (T11-T12) → S-bend (T13-T14) →
  T15-T16 onto the Strip (DRS, wraps S/F) → T17 kink
- Landmarks: animated MSG Sphere (inside T7-T10), Bellagio fountains, Caesars,
  half Eiffel (Paris), High Roller wheel, Strat tower, Luxor beam
- Performance: ≤10 pooled PointLights follow the player; scenery is instanced
