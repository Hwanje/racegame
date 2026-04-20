// Las Vegas Grand Prix Street Circuit
// Counter-clockwise | ~6.2 km | 14 turns | Night race
// Scale: 1 unit ≈ 8 real metres.  X=East  Z=South  Y=Up
// trackWidthHalf 2.0 = 16 m total width (F1 street circuit)
// Circuit shape: "pill" — main straight on The Strip (west, heading south),
// east section on Harmon/Koval, MSG Sphere hairpin (SE corner),
// back straight heading north, two left turns return to start.

const LAS_VEGAS = {
  name: 'Las Vegas Street Circuit',
  country: 'USA',
  laps: 50,
  trackWidthHalf : 2.0,
  kerbWidth      : 0.25,
  startPosition  : { x: 0, y: 0.15, z: 8 },
  startHeading   : 0,

  // Waypoints may be [x, z] (ground) or [x, z, y] for elevated sections (bridges)
  waypoints: [
    // ── SECTOR 1 – MAIN STRIP STRAIGHT (heading south, x=0) ~1.5 km ──
    [0,   0], [0,  20], [0,  40], [0,  60], [0,  80],
    [0, 100], [0, 120], [0, 140], [0, 160], [0, 178],

    // T1-T2 – chicane at south end of Strip (right-left)
    [3, 190], [10, 200], [14, 210], [10, 218],

    // Link SE toward Harmon
    [14, 228], [24, 236], [38, 240], [54, 243],

    // ── SECTOR 2 – Harmon Ave (heading east) ──
    [72, 245], [90, 244],

    // T3 – right onto Koval (east → south)
    [106, 246], [118, 254], [124, 268], [124, 284],

    // Koval south (ground level — goes UNDER the T6 flyover)
    [124, 300], [126, 316],

    // T4 – right, heading east toward the Sphere
    [134, 328], [148, 336],

    // T5 – MSG Sphere hairpin (U-turn left, 180°)
    [164, 340], [178, 334], [184, 320], [180, 306], [168, 298],

    // Exit hairpin — ramp UP onto T6 flyover bridge
    [152, 296, 0.8], [138, 291, 2.4],

    // T6 – ELEVATED BRIDGE over Koval south (heading NW then N)
    [126, 286, 3.2], [118, 278, 3.0], [115, 268, 1.8], [114, 258, 0.4],

    // ── SECTOR 3 – BACK STRAIGHT (heading north, x=114) ~1.3 km ──
    [114, 242], [114, 218], [114, 194], [114, 170], [114, 146],
    [114, 122], [114,  98], [114,  74], [114,  50],

    // T7 – left at top, heading west
    [112, 32], [106, 16], [96, 6],

    // West along the northern edge (above start/finish)
    [80, -2], [62, -8], [44, -12], [26, -14],

    // T8 – left, heading south back to start
    [14, -10], [6, -4],
  ],

  drsZones: [
    // Indices scale with waypoint count (56 points → t = index/56)
    { name: 'Main Straight', startT: 0.955, endT: 0.155 }, // wraps start
    { name: 'Back Straight', startT: 0.680, endT: 0.820 },
    { name: 'Harmon Ave',    startT: 0.305, endT: 0.355 },
  ],

  // Buildings placed clear of the track (trackWidthHalf=2 + margin)
  landmarks: [
    // MSG Sphere – inside the hairpin loop (track wraps around it)
    { x: 172, y: 0, z: 318, type: 'sphere', radius: 10, color: 0x080810, emissive: 0x3300cc, label: 'MSG Sphere' },

    // West side of The Strip (main straight)
    { x: -26, y: 0, z:  30, type: 'casino',  w: 24, h: 20, d: 20, color: 0xff2222, label: 'Circus Circus' },
    { x: -26, y: 0, z:  70, type: 'casino',  w: 28, h: 24, d: 22, color: 0xe0c840, label: 'Wynn' },
    { x: -26, y: 0, z: 110, type: 'casino',  w: 32, h: 26, d: 22, color: 0xd4b896, label: 'Caesars' },
    { x: -26, y: 0, z: 155, type: 'casino',  w: 28, h: 22, d: 20, color: 0xdce8f0, label: 'Bellagio', fountain: true },

    // South end of Strip
    { x: -40, y: 0, z: 210, type: 'casino',  w: 40, h: 26, d: 30, color: 0x8899bb, label: 'NY-NY' },

    // Inside the loop (visible from Harmon / main straight)
    { x:  58, y: 0, z: 210, type: 'casino',  w: 26, h: 19, d: 20, color: 0xff5599, label: 'Flamingo' },

    // East side near Koval/Sphere
    { x: 150, y: 0, z: 270, type: 'tower',   w: 22, h: 36, d: 18, color: 0x7aaabb, label: 'Aria' },

    // Far background
    { x: -20, y: 0, z: -60, type: 'tower',   w:  4, h: 120, d:  4, color: 0xcc2222, label: 'Stratosphere' },
    { x:  60, y: 0, z: 420, type: 'pyramid', size: 34, color: 0x997700, label: 'Luxor' },
  ],

  gridPositions: [
    { x:  0.7, z: -2 }, { x: -0.7, z: -2 },
    { x:  0.7, z: -5 }, { x: -0.7, z: -5 },
    { x:  0.7, z: -8 }, { x: -0.7, z: -8 },
  ],
};

// ── All 2024 F1 circuits ─────────────────────────────────────────────────────
const F1_CIRCUITS = [
  { name: 'Bahrain International Circuit',     country: 'Bahrain',       flag: '🇧🇭', active: false },
  { name: 'Jeddah Corniche Circuit',           country: 'Saudi Arabia',  flag: '🇸🇦', active: false },
  { name: 'Albert Park Circuit',               country: 'Australia',     flag: '🇦🇺', active: false },
  { name: 'Suzuka Circuit',                    country: 'Japan',         flag: '🇯🇵', active: false },
  { name: 'Shanghai International Circuit',    country: 'China',         flag: '🇨🇳', active: false },
  { name: 'Miami International Autodrome',     country: 'USA',           flag: '🇺🇸', active: false },
  { name: 'Autodromo Enzo e Dino Ferrari',     country: 'Italy',         flag: '🇮🇹', active: false },
  { name: 'Circuit de Monaco',                 country: 'Monaco',        flag: '🇲🇨', active: false },
  { name: 'Circuit de Barcelona-Catalunya',    country: 'Spain',         flag: '🇪🇸', active: false },
  { name: 'Circuit Gilles Villeneuve',         country: 'Canada',        flag: '🇨🇦', active: false },
  { name: 'Red Bull Ring',                     country: 'Austria',       flag: '🇦🇹', active: false },
  { name: 'Silverstone Circuit',               country: 'Great Britain', flag: '🇬🇧', active: false },
  { name: 'Hungaroring',                       country: 'Hungary',       flag: '🇭🇺', active: false },
  { name: 'Circuit de Spa-Francorchamps',      country: 'Belgium',       flag: '🇧🇪', active: false },
  { name: 'Circuit Park Zandvoort',            country: 'Netherlands',   flag: '🇳🇱', active: false },
  { name: 'Autodromo Nazionale Monza',         country: 'Italy',         flag: '🇮🇹', active: false },
  { name: 'Baku City Circuit',                 country: 'Azerbaijan',    flag: '🇦🇿', active: false },
  { name: 'Marina Bay Street Circuit',         country: 'Singapore',     flag: '🇸🇬', active: false },
  { name: 'Circuit of the Americas',           country: 'USA',           flag: '🇺🇸', active: false },
  { name: 'Autodromo Hermanos Rodriguez',      country: 'Mexico',        flag: '🇲🇽', active: false },
  { name: 'Autodromo Jose Carlos Pace',        country: 'Brazil',        flag: '🇧🇷', active: false },
  { name: 'Las Vegas Street Circuit',          country: 'USA',           flag: '🇺🇸', active: true  },
  { name: 'Lusail International Circuit',      country: 'Qatar',         flag: '🇶🇦', active: false },
  { name: 'Yas Marina Circuit',                country: 'Abu Dhabi',     flag: '🇦🇪', active: false },
];
