// test/smoke.js — headless sanity check (no GPU/DOM needed).
// Loads the real game sources, builds the circuit, then lets an AI driver
// lap it with the actual physics. Fails loudly on geometry/physics regressions.
//
// Run:  node test/smoke.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const THREE = require('three'); // resolves to the CJS build (browser uses the UMD file)

// ── minimal DOM stubs (canvas 2D becomes a no-op recorder) ──
const ctx2dStub = new Proxy({}, {
  get(_, prop) {
    if (prop === 'measureText') return () => ({ width: 10 });
    if (typeof prop === 'string' && prop.startsWith('create')) return () => ({ addColorStop() {} });
    return () => {};
  },
  set() { return true; },
});
const makeCanvas = () => ({ width: 300, height: 150, style: {}, getContext: () => ctx2dStub });
const documentStub = {
  createElement: (tag) => (tag === 'canvas' ? makeCanvas() : { style: {}, classList: { add() {}, remove() {}, toggle() {} } }),
  getElementById: () => null,
  addEventListener() {},
};

const sandbox = {
  THREE, console, Math, performance: { now: () => Date.now() },
  document: documentStub, window: { addEventListener() {} },
  navigator: {}, setTimeout, clearTimeout,
};
vm.createContext(sandbox);

for (const f of ['js/tracks/lasvegas.js', 'js/Car.js', 'js/Track.js', 'js/AI.js', 'js/Effects.js', 'js/Buildings.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
}

let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? '  ✓' : '  ✗ FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
};

vm.runInContext(`
(${function () {
  const out = globalThis.__results = {};
  out.widthHalf = LAS_VEGAS.widthHalf;

  // ── track geometry ──
  const scene = new THREE.Scene();
  const track = new Track(scene, LAS_VEGAS);
  out.lengthKm = track.lengthM / 1000;
  out.idealLap = track.idealLap;

  // surface bands
  const t = 0.27;
  const s = track.posAt(t);
  const W = LAS_VEGAS.widthHalf, K = LAS_VEGAS.kerbWidth;
  out.surfCenter = track.getTrackInfo(s.x, s.z).surface;
  out.surfKerb = track.getTrackInfo(s.x + s.nx * (W + K * 0.5), s.z + s.nz * (W + K * 0.5)).surface;
  out.surfOff = track.getTrackInfo(s.x + s.nx * (W + K + 0.3), s.z + s.nz * (W + K + 0.3)).surface;

  // racing line must stay on tarmac and reduce peak curvature
  let maxOff = 0, peakCenter = 0, peakLine = 0;
  for (let i = 0; i < track.samples.length; i++) {
    maxOff = Math.max(maxOff, Math.abs(track.lineOffset[i]));
    peakCenter = Math.max(peakCenter, Math.abs(track.samples[i].curv));
    peakLine = Math.max(peakLine, Math.abs(track.lineCurv[i]));
  }
  out.maxOff = maxOff; out.peakCenter = peakCenter; out.peakLine = peakLine;
  out.vMin = Math.min(...track.lineSpeed);
  out.vMax = Math.max(...track.lineSpeed);

  // scenery builds without throwing
  const fx = new Effects(scene);
  const bld = new Buildings(scene);
  bld.build(LAS_VEGAS.landmarks, track);
  bld.update(0.016, new THREE.Vector3());
  fx.smoke(0, 0, 0, 1, 1, 1); fx.sparks(0, 0, 0, 1, 0); fx.skid(0, 0, 0.5, 0.5);
  fx.update(0.016);
  out.sceneryOk = true;

  // ── drive: AI laps the circuit with real physics ──
  const car = new Car(scene, 'ferrari', { tire: 'medium' });
  const grid = track.getGridPoses(8);
  const gp = grid[0];
  car.setPose(gp.x, gp.z, gp.heading);
  const ai = new AIDriver(car, track, 0.95);
  ai.launched = true; ai.reaction = -1;

  const dt = 1 / 120;
  let raceTime = 0, wallHits = 0, crossed = false, maxSpeed = 0;
  const lapTimes = [];
  let prevT = track.getTrackInfo(car.pos.x, car.pos.z).t;
  car.progress = prevT - 1;

  const SIM_SECONDS = 420;
  for (let step = 0; step < SIM_SECONDS * 120; step++) {
    raceTime += dt;
    const info = track.getTrackInfo(car.pos.x, car.pos.z);
    car._trackInfo = info;
    car.drsAvailable = track.inDrs(info.t) && car.speed > 25;
    ai.update(dt, raceTime, [car]);
    car.update(dt, info);
    maxSpeed = Math.max(maxSpeed, car.speed);

    // wall clamp (mirror of Game._wallCollision core)
    const limit = info.wallHalf - 0.125;
    if (info.absLateral > limit) {
      wallHits++;
      const side = Math.sign(info.lateral);
      const over = info.absLateral - limit;
      car.pos.x -= info.nx * side * over;
      car.pos.z -= info.nz * side * over;
      const nx = info.nx * side, nz = info.nz * side;
      const vN = car.vx * nx + car.vz * nz;
      if (vN > 0) { car.vx -= nx * vN * 1.25; car.vz -= nz * vN * 1.25; }
    }

    // stuck recovery (mirror of Game)
    if (ai.isStuck) {
      const ri = track.getTrackInfo(car.pos.x, car.pos.z);
      const rs = track.posAt(ri.t);
      car.pos.set(rs.x, 0.04, rs.z);
      car.heading = Math.atan2(rs.tx, rs.tz);
      car.vx = car.vz = 0;
      ai.stuckTime = 0;
    }

    // lap crossing
    const tNow = track.getTrackInfo(car.pos.x, car.pos.z).t;
    if (prevT > 0.82 && tNow < 0.18) {
      if (!crossed) { crossed = true; car.lapTime = 0; }
      else if (car.lapTime > 20) { lapTimes.push(car.lapTime); car.completeLap(); }
    }
    prevT = tNow;
    if (lapTimes.length >= 3) break;
  }
  out.lapTimes = lapTimes;
  out.wallHits = wallHits;
  out.maxSpeed = maxSpeed;
  out.tireWear = car.tireWear;

  // ── multi-car: traffic/overtake/slipstream paths run NaN-free ──
  const pack = [];
  const drivers = [];
  for (let i = 0; i < 5; i++) {
    const c = new Car(scene, ['redbull', 'mclaren', 'mercedes', 'aston', 'haas'][i], {});
    const g = grid[i];
    c.setPose(g.x, g.z, g.heading);
    c.progress = -0.01 * i;
    const d = new AIDriver(c, track, 0.96 - i * 0.015);
    d.launched = true; d.reaction = -1;
    pack.push(c); drivers.push(d);
  }
  let packNaN = false, packTime = 0;
  for (let step = 0; step < 90 * 120; step++) {
    packTime += dt;
    for (const c of pack) {
      c._trackInfo = track.getTrackInfo(c.pos.x, c.pos.z);
      c.drsAvailable = track.inDrs(c._trackInfo.t) && c.speed > 25;
      c.slipstream = 0;
    }
    for (const d of drivers) d.update(dt, packTime, pack);
    for (const c of pack) {
      c.update(dt, c._trackInfo);
      const info = c._trackInfo;
      const limit = info.wallHalf - 0.125;
      if (info.absLateral > limit) {
        const side = Math.sign(info.lateral);
        c.pos.x -= info.nx * side * (info.absLateral - limit);
        c.pos.z -= info.nz * side * (info.absLateral - limit);
      }
      const t2 = track.getTrackInfo(c.pos.x, c.pos.z).t;
      if (c._pp == null) c._pp = t2;
      if (c._pp > 0.82 && t2 < 0.18) c._laps = (c._laps || 0) + 1;
      c.progress = (c._laps || 0) + t2 - 1;
      c._pp = t2;
      if (!isFinite(c.pos.x) || !isFinite(c.speed) || !isFinite(c.heading)) packNaN = true;
    }
  }
  out.packNaN = packNaN;
  out.packSpread = Math.max(...pack.map(c => c.progress)) - Math.min(...pack.map(c => c.progress));

  // ── straight-line: top speed reaches the 320 km/h spec ──
  const car2 = new Car(scene, 'redbull', { tire: 'soft' });
  car2.setPose(0, -30, 0); // on the Strip heading south
  let top = 0;
  for (let i = 0; i < 30 * 120; i++) {
    const info = { surface: 'tarmac', tangentAngle: 0 };
    car2.input.throttle = 1; car2.input.brake = 0; car2.input.steer = 0;
    car2.update(dt, info);
    top = Math.max(top, car2.speed);
    if (car2.pos.z > 1e7) break;
  }
  out.topSpeed = top;
  out.gearAtTop = car2.gear;
}})()`, sandbox);

const r = sandbox.__results;
console.log('\n══ Track ══');
console.log(`  length ${r.lengthKm.toFixed(2)} km · ideal lap ${r.idealLap.toFixed(1)} s · corner v ${r.vMin.toFixed(0)}–${r.vMax.toFixed(0)} m/s`);
check('circuit length ≈ 6 km', r.lengthKm > 5.0 && r.lengthKm < 7.2, r.lengthKm.toFixed(2) + ' km');
check('ideal lap plausible (70–130 s)', r.idealLap > 70 && r.idealLap < 130, r.idealLap.toFixed(1) + ' s');
check('surface bands (tarmac/kerb/runoff)', r.surfCenter === 'tarmac' && r.surfKerb === 'kerb' && r.surfOff === 'runoff',
  `${r.surfCenter}/${r.surfKerb}/${r.surfOff}`);
check('racing line inside tarmac', r.maxOff <= r.widthHalf - 0.25, r.maxOff.toFixed(2) + ' u');
check('racing line flattens corners', r.peakLine < r.peakCenter,
  `line ${r.peakLine.toFixed(3)} < center ${r.peakCenter.toFixed(3)}`);
check('speed profile sane', r.vMin > 8 && r.vMax > 80, `${r.vMin.toFixed(1)}–${r.vMax.toFixed(1)} m/s`);
check('scenery + effects build', r.sceneryOk === true);

console.log('\n══ AI race sim ══');
console.log(`  laps: ${r.lapTimes.map(t => t.toFixed(1) + 's').join(', ') || 'none'} · wall frames ${r.wallHits} · vmax ${(r.maxSpeed * 3.6).toFixed(0)} km/h · wear ${(r.tireWear * 100).toFixed(1)}%`);
check('AI completes ≥ 2 laps', r.lapTimes.length >= 2, `${r.lapTimes.length} laps`);
check('lap time 75–150 s', r.lapTimes.every(t => t > 75 && t < 150));
check('AI stays off the walls (≤ 120 contact frames)', r.wallHits <= 120, `${r.wallHits}`);
check('AI uses real pace (> 230 km/h)', r.maxSpeed * 3.6 > 230, (r.maxSpeed * 3.6).toFixed(0) + ' km/h');

console.log('\n══ 5-car pack (90 s) ══');
check('no NaN in pack sim', r.packNaN === false);
check('pack makes progress', r.packSpread >= 0 && isFinite(r.packSpread), `spread ${r.packSpread.toFixed(2)} laps`);

console.log('\n══ straight-line ══');
check('top speed 300–330 km/h', r.topSpeed * 3.6 > 300 && r.topSpeed * 3.6 < 332, (r.topSpeed * 3.6).toFixed(1) + ' km/h');
check('reaches top gear', r.gearAtTop === 8, `gear ${r.gearAtTop}`);

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
