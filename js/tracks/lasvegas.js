// Las Vegas Grand Prix Street Circuit — track data
// Counter-clockwise | ~6.1 km | 17 turns | Night race
// Scale: 1 unit = 8 real metres.  X = East,  Z = South,  Y = Up
// Start/finish is on the Strip, heading south (+Z) toward Turn 1.

const LAS_VEGAS = {
  id: 'lasvegas',
  name: 'Las Vegas Strip Circuit',
  country: 'USA',
  city: 'Las Vegas, Nevada',
  flag: '🇺🇸',
  cornerCount: 17,

  widthHalf: 1.10,   // tarmac half-width (8.8 m each side)
  kerbWidth: 0.22,   // kerb strip beyond tarmac, each side
  wallOffset: 0.50,  // wall distance beyond kerb edge (street circuit: tight!)

  gridRows: 8,

  // [x, z] waypoints, closed CatmullRom loop. Index 0 = start/finish line.
  waypoints: [
    [0, 30],                                            //  0  S/F line (the Strip)
    [0, 52], [0, 74], [0, 96], [0, 116], [0, 128],      //  1-5   Strip straight
    [0, 138],                                           //  6     T1 braking
    [2, 146], [7, 151], [14, 153],                      //  7-9   T1 (left 90°, heavy stop)
    [24, 154], [36, 155], [48, 156],                    // 10-12  Harmon Ave
    [55, 158], [60, 161],                               // 13-14  T2 (right)
    [66, 162],                                          // 15
    [71, 159], [76, 157],                               // 16-17  T3 (left, chicane exit)
    [86, 156], [98, 156], [108, 156],                   // 18-20  Harmon Ave
    [114, 155], [119, 152], [122, 146],                 // 21-23  T4 (left, onto Koval)
    [123, 138], [124, 128],                             // 24-25
    [126, 118], [128, 109],                             // 26-27  T5 (right kink)
    [128, 94], [128, 76], [128, 58], [128, 40],         // 28-31  Koval Lane straight
    [128, 22], [128, 4], [128, -14], [128, -30],        // 32-35  Koval Lane straight
    [129, -42], [132, -51], [138, -58],                 // 36-38  T6 (right)
    [146, -61], [155, -63],                             // 39-40  run to the Sphere
    [164, -66], [172, -68],                             // 41-42  T7 (left, Sphere loop)
    [180, -72], [185, -79],                             // 43-44  T8 (Sphere apex east)
    [184, -88], [178, -94],                             // 45-46  T9
    [169, -96], [161, -93],                             // 47-48  T10 (exit west onto Sands)
    [152, -90], [143, -88], [133, -88], [124, -88],     // 49-52  Sands Ave
    [117, -89], [111, -92], [105, -94],                 // 53-55  T11 (right, bus stop)
    [99, -94], [93, -91], [87, -89],                    // 56-58  T12 (left, bus stop exit)
    [78, -88], [66, -89],                               // 59-60
    [58, -91], [52, -94],                               // 61-62  T13 (right, S-bend)
    [45, -95],                                          // 63
    [38, -93], [33, -90],                               // 64-65  T14 (left, S-bend exit)
    [27, -86], [21, -81], [15, -75],                    // 66-68  T15 (left sweep)
    [10, -68], [6, -60], [3, -52],                      // 69-71  T16 (left, onto the Strip)
    [1, -42],                                           // 72     T17 (flat kink)
    [0, -32], [0, -20], [0, -8], [0, 4], [0, 17],       // 73-77  Strip straight to S/F
  ],

  // Corner markers: waypoint index → label (used by minimap / AI tuning)
  corners: [
    { wp: 8,  name: 'T1'  }, { wp: 14, name: 'T2'  }, { wp: 16, name: 'T3'  },
    { wp: 22, name: 'T4'  }, { wp: 26, name: 'T5'  }, { wp: 37, name: 'T6'  },
    { wp: 42, name: 'T7'  }, { wp: 44, name: 'T8'  }, { wp: 45, name: 'T9'  },
    { wp: 47, name: 'T10' }, { wp: 54, name: 'T11' }, { wp: 57, name: 'T12' },
    { wp: 62, name: 'T13' }, { wp: 64, name: 'T14' }, { wp: 67, name: 'T15' },
    { wp: 70, name: 'T16' }, { wp: 72, name: 'T17' },
  ],

  // DRS zones by waypoint index (resolved to arc-length t at build time)
  drsZones: [
    { name: 'The Strip',  fromWp: 74, toWp: 5  },  // wraps the start line
    { name: 'Koval Lane', fromWp: 28, toWp: 35 },
    { name: 'Harmon Ave', fromWp: 17, toWp: 20 },
  ],

  // Paved run-off pockets: wall pushed out, surface = 'runoff'
  runoffZones: [
    { fromWp: 4,  toWp: 9,  extra: 2.2 },   // T1 escape road
    { fromWp: 35, toWp: 38, extra: 1.8 },   // T6
    { fromWp: 59, toWp: 64, extra: 1.4 },   // T13-T14
  ],

  // Las Vegas landmarks (consumed by Buildings.js).  Strip resorts are west
  // of the track (x < 0); the Sphere sits inside its own loop.
  landmarks: [
    { type: 'sphere',  x: 174, z: -82, r: 7.5, label: 'SPHERE' },
    { type: 'casino',  x: -26, z: 42,  w: 26, h: 22, d: 22, color: 0xdce9f2, sign: 'BELLAGIO', fountain: true },
    { type: 'casino',  x: -28, z: -8,  w: 30, h: 26, d: 24, color: 0xd9c08e, sign: 'CAESARS PALACE' },
    { type: 'casino',  x: -24, z: 80,  w: 22, h: 30, d: 20, color: 0x8fa8c8, sign: 'COSMOPOLITAN' },
    { type: 'casino',  x: -30, z: 120, w: 24, h: 34, d: 20, color: 0x9bb0bb, sign: 'ARIA' },
    { type: 'casino',  x: -26, z: -58, w: 26, h: 24, d: 22, color: 0xe8d9b8, sign: 'VENETIAN' },
    { type: 'casino',  x: -28, z: -108,w: 26, h: 28, d: 22, color: 0xc8a060, sign: 'WYNN' },
    { type: 'casino',  x: -22, z: 168, w: 34, h: 22, d: 26, color: 0x90a0c0, sign: 'NEW YORK NY' },
    { type: 'casino',  x: 64,  z: 178, w: 34, h: 24, d: 24, color: 0x3a6e4f, sign: 'MGM GRAND' },
    { type: 'eiffel',  x: 26,  z: 78,  h: 20, label: 'PARIS' },
    { type: 'casino',  x: 40,  z: 96,  w: 20, h: 18, d: 16, color: 0xc89ab8, sign: 'PARIS LV' },
    { type: 'casino',  x: 44,  z: 22,  w: 20, h: 14, d: 16, color: 0xff7fa8, sign: 'FLAMINGO' },
    { type: 'casino',  x: 56,  z: -22, w: 18, h: 16, d: 14, color: 0xb080ff, sign: 'THE LINQ' },
    { type: 'casino',  x: 96,  z: -122,w: 28, h: 26, d: 22, color: 0xe0c8a0, sign: 'PALAZZO' },
    { type: 'tower',   x: -14, z: -210, h: 64, label: 'STRAT' },
    { type: 'pyramid', x: -44, z: 235, size: 30, label: 'LUXOR' },
    { type: 'wheel',   x: 78,  z: -52, r: 14, label: 'HIGH ROLLER' },
  ],
};

// 2024-style calendar for the menu (only Las Vegas is playable)
const F1_CIRCUITS = [
  { name: 'Bahrain International Circuit',  country: 'Bahrain',        flag: '🇧🇭' },
  { name: 'Jeddah Corniche Circuit',        country: 'Saudi Arabia',   flag: '🇸🇦' },
  { name: 'Albert Park Circuit',            country: 'Australia',      flag: '🇦🇺' },
  { name: 'Suzuka Circuit',                 country: 'Japan',          flag: '🇯🇵' },
  { name: 'Shanghai International Circuit', country: 'China',          flag: '🇨🇳' },
  { name: 'Miami International Autodrome',  country: 'USA',            flag: '🇺🇸' },
  { name: 'Imola — Enzo e Dino Ferrari',    country: 'Italy',          flag: '🇮🇹' },
  { name: 'Circuit de Monaco',              country: 'Monaco',         flag: '🇲🇨' },
  { name: 'Circuit Gilles Villeneuve',      country: 'Canada',         flag: '🇨🇦' },
  { name: 'Circuit de Barcelona-Catalunya', country: 'Spain',          flag: '🇪🇸' },
  { name: 'Red Bull Ring',                  country: 'Austria',        flag: '🇦🇹' },
  { name: 'Silverstone Circuit',            country: 'Great Britain',  flag: '🇬🇧' },
  { name: 'Hungaroring',                    country: 'Hungary',        flag: '🇭🇺' },
  { name: 'Spa-Francorchamps',              country: 'Belgium',        flag: '🇧🇪' },
  { name: 'Circuit Zandvoort',              country: 'Netherlands',    flag: '🇳🇱' },
  { name: 'Autodromo Nazionale Monza',      country: 'Italy',          flag: '🇮🇹' },
  { name: 'Baku City Circuit',              country: 'Azerbaijan',     flag: '🇦🇿' },
  { name: 'Marina Bay Street Circuit',      country: 'Singapore',      flag: '🇸🇬' },
  { name: 'Circuit of the Americas',        country: 'USA',            flag: '🇺🇸' },
  { name: 'Autodromo Hermanos Rodriguez',   country: 'Mexico',         flag: '🇲🇽' },
  { name: 'Interlagos — Jose Carlos Pace',  country: 'Brazil',         flag: '🇧🇷' },
  { name: 'Las Vegas Strip Circuit',        country: 'USA',            flag: '🇺🇸', active: true, data: () => LAS_VEGAS },
  { name: 'Lusail International Circuit',   country: 'Qatar',          flag: '🇶🇦' },
  { name: 'Yas Marina Circuit',             country: 'Abu Dhabi',      flag: '🇦🇪' },
];
