# F1 Racing Game

## Stack
- Three.js r160 (CDN, no bundler)
- Vanilla JS, multi-file, traditional script tags
- Entry: `index.html`

## Architecture
```
index.html → css/style.css
           → js/main.js (entry, initializes Menu/Game)
           → js/Menu.js (circuit select screen)
           → js/Game.js (game loop, state machine)
           → js/Track.js (mesh generation from waypoints)
           → js/Car.js (model + physics)
           → js/Buildings.js (Las Vegas scenery)
           → js/HUD.js (speed/gear/tire overlay)
           → js/tracks/lasvegas.js (waypoints, DRS zones, surface zones)
```

## Track Format
Waypoints `[x, z]` in game units (1 unit = 8 real meters), counter-clockwise, CatmullRomCurve3 closed=true.
Track width: 1.5 units inner tarmac, +0.15 kerb each side.

## Physics Key Values
- maxSpeed: 88.9 m/s (320 km/h), DRS: +5%
- maxBraking: 54 m/s² (5.5g)
- Tarmac friction: 1.0, Kerb: 0.75, Gravel: 0.25, Grass: 0.35
- Tire grip multiplier: Soft 1.15, Medium 1.0, Hard 0.88

## Active Circuits
Only Las Vegas is playable. All others render as locked in menu.

## Las Vegas Notes
- Night race, Strip runs N–S, 17 corners, 3 DRS zones
- Key landmarks: MSG Sphere (T11), Caesars (T3), Bellagio (T7-8), Stratosphere (north)
- Counter-clockwise, 6.12 km
