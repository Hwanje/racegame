// Car.js — F1 car: parametric 3D model + vector-based vehicle dynamics.
// Physics runs in METRES (SI); world/scene positions are game units (1 u = 8 m).

const SCALE = 8; // metres per game unit

const PHYS = {
  maxSpeed: 88.9,        // m/s = 320 km/h
  drsSpeedMult: 1.05,    // DRS: +5% top speed
  enginePower: 735000,   // W ≈ 1000 hp
  drivelineEff: 0.85,
  mass: 798,             // kg, car + driver
  dragCoeff: 0.001114,   // a = c·v² → terminal speed 88.9 m/s
  drsDragMult: 0.84,
  rollResist: 1.1,       // m/s²
  engineBrake: 6.0,      // m/s² at zero throttle
  gripBase: 17.0,        // m/s² grip at μ = 1, no downforce (≈ 1.73 g)
  downforceK: 0.00060,   // grip factor = 1 + k·v²  (capped below)
  downforceMax: 3.2,     // → ~54 m/s² peak lateral (5.5 g)
  maxBrake: 54,          // m/s² absolute braking cap (5.5 g)
  wheelbase: 3.6,        // m
  maxSteerLock: 0.30,    // rad, front wheel angle at standstill
  maxSlipAngle: 0.38,    // rad, heading may lead velocity by this much
  slideGripMult: 0.80,   // lateral grip while sliding
  launchTraction: 0.92,  // fraction of grip usable for drive traction

  surfaces: {
    tarmac: { mu: 1.00, drag: 0.0, speedMult: 1.00 },
    kerb:   { mu: 0.75, drag: 0.8, speedMult: 1.00 },
    runoff: { mu: 0.55, drag: 6.0, speedMult: 0.60 },
    gravel: { mu: 0.25, drag: 14., speedMult: 0.35 },
    grass:  { mu: 0.35, drag: 10., speedMult: 0.40 },
  },

  tires: {
    soft:   { grip: 1.15, wearRate: 1.7, optTemp: 95, color: 0xe01020 },
    medium: { grip: 1.00, wearRate: 1.0, optTemp: 90, color: 0xffd012 },
    hard:   { grip: 0.88, wearRate: 0.5, optTemp: 85, color: 0xf2f2f2 },
  },

  // Top speed per gear (m/s); gear 8 reaches past DRS top speed
  gearVmax: [16, 25, 34, 44, 54, 65, 77, 95],
  rpmIdle: 4000,
  rpmMax: 13000,
  shiftCutTime: 0.07,    // s of torque cut on upshift
};

const TEAMS = [
  { id: 'redbull',  name: 'Red Bull',     driver: 'VER', primary: 0x20307a, accent: 0xffb800, wing: 0xd11030 },
  { id: 'ferrari',  name: 'Ferrari',      driver: 'LEC', primary: 0xe00400, accent: 0xffe900, wing: 0x151515 },
  { id: 'mercedes', name: 'Mercedes',     driver: 'HAM', primary: 0x6a7479, accent: 0x00d2be, wing: 0x101417 },
  { id: 'mclaren',  name: 'McLaren',      driver: 'NOR', primary: 0xff8000, accent: 0x47c7fc, wing: 0x202020 },
  { id: 'aston',    name: 'Aston Martin', driver: 'ALO', primary: 0x00786e, accent: 0xc5ff45, wing: 0x0a3833 },
  { id: 'alpine',   name: 'Alpine',       driver: 'GAS', primary: 0x10256e, accent: 0xff5fa0, wing: 0x0090ff },
  { id: 'williams', name: 'Williams',     driver: 'ALB', primary: 0x0a55d4, accent: 0xffffff, wing: 0x07306e },
  { id: 'rb',       name: 'RB',           driver: 'TSU', primary: 0x2244e0, accent: 0xffffff, wing: 0xc8102e },
  { id: 'sauber',   name: 'Kick Sauber',  driver: 'BOT', primary: 0x101010, accent: 0x00e701, wing: 0x00e701 },
  { id: 'haas',     name: 'Haas',         driver: 'MAG', primary: 0xeaeaea, accent: 0xda291c, wing: 0x1a1c22 },
];

function teamById(id) { return TEAMS.find(t => t.id === id) || TEAMS[0]; }

// Shared materials (created once, cached per team)
const CarMats = {
  _cache: {},
  forTeam(team) {
    if (!this.carbon) {
      this.carbon = new THREE.MeshStandardMaterial({ color: 0x16161a, roughness: 0.5, metalness: 0.4 });
      this.tire   = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.92 });
      this.rim    = new THREE.MeshStandardMaterial({ color: 0xd4dae2, roughness: 0.2, metalness: 0.95 });
    }
    if (!this._cache[team.id]) {
      this._cache[team.id] = {
        body:   new THREE.MeshStandardMaterial({ color: team.primary, roughness: 0.28, metalness: 0.6 }),
        accent: new THREE.MeshStandardMaterial({ color: team.accent,  roughness: 0.3,  metalness: 0.55,
                  emissive: team.accent, emissiveIntensity: 0.18 }),
        wing:   new THREE.MeshStandardMaterial({ color: team.wing,    roughness: 0.32, metalness: 0.55 }),
        glow:   new THREE.MeshBasicMaterial({ color: team.accent }),
      };
    }
    return this._cache[team.id];
  },
};

class Car {
  constructor(scene, teamId, opts = {}) {
    this.scene = scene;
    this.team = teamById(teamId);
    this.isPlayer = !!opts.isPlayer;
    this.code = opts.code || this.team.driver;

    // ── physics state (SI; pos in game units) ──
    this.pos = new THREE.Vector3(0, 0.04, 0);
    this.heading = 0;            // rad; forward = (sin h, cos h) in XZ
    this.vx = 0; this.vz = 0;    // world velocity, m/s
    this.steerAngle = 0;         // actual front wheel angle (rad); +ve → heading increases
    this.yawRate = 0;            // rad/s, exposed for AI damping / player assist
    this.currentLock = PHYS.maxSteerLock;
    this.gear = 1;
    this.rpm = PHYS.rpmIdle;
    this.shiftCut = 0;

    this.tireCompound = opts.tire || 'medium';
    this.tireWear = 0;           // 0..1
    this.tireTemp = 70;
    this._tireUse = 0;

    this.drsAvailable = false;
    this.drsActive = false;
    this.surface = 'tarmac';
    this.sliding = 0;            // 0..1 (for fx/audio)
    this.lockup = false;
    this.wheelspin = false;
    this.offTrack = false;
    this.slipstream = 0;         // 0..1 drag reduction from running in tow

    // race bookkeeping (managed by Game)
    this.lap = 1;
    this.progress = 0;
    this.lapTime = 0;
    this.lastLap = 0;
    this.bestLap = Infinity;
    this.totalTime = 0;
    this.penalty = 0;
    this.finished = false;
    this.finishTime = 0;

    // input.steer: +1 = steer screen-right (decreases heading)
    this.input = { throttle: 0, brake: 0, steer: 0 };

    this._blinkT = 0;
    this.wheels = [];
    this.group = new THREE.Group();
    this._buildModel();
    if (scene) scene.add(this.group);
  }

  // ════════ 3D model (nose faces +Z in local space; car ≈ 0.7 u long) ════════
  _buildModel() {
    const M = CarMats.forTeam(this.team);
    const g = this.group;
    const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
      g.add(m); return m;
    };

    // floor + plank
    add(new THREE.BoxGeometry(0.27, 0.016, 0.62), CarMats.carbon, 0, 0.028, 0.0);
    // monocoque, tapering into a long low nose
    add(new THREE.BoxGeometry(0.15, 0.08, 0.30), M.body, 0, 0.082, 0.06);
    add(new THREE.CylinderGeometry(0.022, 0.072, 0.30, 10), M.body, 0, 0.075, 0.34, Math.PI / 2);
    add(new THREE.SphereGeometry(0.022, 8, 6), M.body, 0, 0.075, 0.487);
    // nose stripe
    add(new THREE.BoxGeometry(0.05, 0.012, 0.26), M.accent, 0, 0.105, 0.30);
    // front wing: main plane + 2 flaps + endplates
    add(new THREE.BoxGeometry(0.47, 0.012, 0.10), M.wing, 0, 0.040, 0.45);
    add(new THREE.BoxGeometry(0.44, 0.010, 0.06), M.accent, 0, 0.060, 0.43, -0.25);
    add(new THREE.BoxGeometry(0.40, 0.009, 0.045), M.wing, 0, 0.076, 0.415, -0.42);
    add(new THREE.BoxGeometry(0.012, 0.075, 0.12), CarMats.carbon, -0.24, 0.065, 0.44);
    add(new THREE.BoxGeometry(0.012, 0.075, 0.12), CarMats.carbon,  0.24, 0.065, 0.44);
    // bargeboards
    add(new THREE.BoxGeometry(0.010, 0.05, 0.10), CarMats.carbon, -0.115, 0.06, 0.16);
    add(new THREE.BoxGeometry(0.010, 0.05, 0.10), CarMats.carbon,  0.115, 0.06, 0.16);
    // sidepods with accent shoulder
    add(new THREE.BoxGeometry(0.105, 0.07, 0.27), M.body, -0.135, 0.078, -0.05);
    add(new THREE.BoxGeometry(0.105, 0.07, 0.27), M.body,  0.135, 0.078, -0.05);
    add(new THREE.BoxGeometry(0.10, 0.018, 0.23), M.accent, -0.14, 0.120, -0.05);
    add(new THREE.BoxGeometry(0.10, 0.018, 0.23), M.accent,  0.14, 0.120, -0.05);
    // cockpit + halo + helmet (helmet in team accent)
    add(new THREE.BoxGeometry(0.115, 0.05, 0.17), CarMats.carbon, 0, 0.128, 0.08);
    add(new THREE.SphereGeometry(0.038, 10, 8), M.glow, 0, 0.165, 0.065);
    add(new THREE.TorusGeometry(0.052, 0.009, 6, 14, Math.PI), CarMats.carbon, 0, 0.172, 0.08, Math.PI / 2);
    add(new THREE.CylinderGeometry(0.0075, 0.0095, 0.07, 6), CarMats.carbon, 0, 0.145, 0.135);
    // engine cover spine + airbox + shark fin
    add(new THREE.BoxGeometry(0.08, 0.095, 0.32), M.body, 0, 0.108, -0.13);
    add(new THREE.CylinderGeometry(0.026, 0.038, 0.06, 8), CarMats.carbon, 0, 0.195, 0.01, Math.PI / 2 - 0.35);
    add(new THREE.BoxGeometry(0.011, 0.08, 0.17), M.accent, 0, 0.165, -0.21);
    // T-cam (red for the player, black for AI — like P1/P2 cars)
    add(new THREE.BoxGeometry(0.05, 0.02, 0.02), this.isPlayer ? M.glow : CarMats.carbon, 0, 0.212, 0.04);
    // rear wing: main + DRS flap + endplates + swan-neck struts
    add(new THREE.BoxGeometry(0.42, 0.015, 0.08), M.wing, 0, 0.235, -0.305, -0.14);
    this.drsFlap = add(new THREE.BoxGeometry(0.40, 0.012, 0.055), M.accent, 0, 0.268, -0.295, -0.72);
    add(new THREE.BoxGeometry(0.013, 0.12, 0.09), CarMats.carbon, -0.215, 0.222, -0.30);
    add(new THREE.BoxGeometry(0.013, 0.12, 0.09), CarMats.carbon,  0.215, 0.222, -0.30);
    add(new THREE.BoxGeometry(0.009, 0.125, 0.012), CarMats.carbon, -0.06, 0.165, -0.295);
    add(new THREE.BoxGeometry(0.009, 0.125, 0.012), CarMats.carbon,  0.06, 0.165, -0.295);
    // diffuser
    add(new THREE.BoxGeometry(0.25, 0.05, 0.09), CarMats.carbon, 0, 0.052, -0.32, 0.35);
    // rain light
    this.rainLight = add(new THREE.BoxGeometry(0.02, 0.05, 0.012),
      new THREE.MeshBasicMaterial({ color: 0xff2030 }), 0, 0.10, -0.352);
    // exhaust flame (flickers on upshift)
    this.flame = add(new THREE.ConeGeometry(0.018, 0.09, 6),
      new THREE.MeshBasicMaterial({ color: 0x66aaff, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false }), 0, 0.14, -0.36, Math.PI / 2);
    // underglow quad (fake neon — every car gets one, only the player gets a light)
    const glowTex = Car._glowTex || (Car._glowTex = (() => {
      const cv = document.createElement('canvas'); cv.width = cv.height = 64;
      const c = cv.getContext('2d');
      const grad = c.createRadialGradient(32, 32, 4, 32, 32, 32);
      grad.addColorStop(0, 'rgba(255,255,255,0.9)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = grad; c.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(cv);
    })());
    const under = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 1.0),
      new THREE.MeshBasicMaterial({ map: glowTex, color: this.team.accent, transparent: true,
        opacity: this.isPlayer ? 0.5 : 0.3, blending: THREE.AdditiveBlending, depthWrite: false }));
    under.rotation.x = -Math.PI / 2;
    under.position.y = 0.012 + Math.random() * 0.004;   // jitter avoids z-fighting between cars
    g.add(under);

    // wheels: steer pivot → spin group (tire, rim, compound band, brake glow)
    const tireGeo = new THREE.CylinderGeometry(0.057, 0.057, 0.062, 16);
    const rimGeo  = new THREE.CylinderGeometry(0.033, 0.033, 0.064, 10);
    const bandGeo = new THREE.CylinderGeometry(0.0578, 0.0578, 0.016, 16);
    const discGeo = new THREE.CylinderGeometry(0.026, 0.026, 0.066, 8);
    this.bandMat = new THREE.MeshBasicMaterial({ color: PHYS.tires[this.tireCompound].color });
    this.brakeMat = new THREE.MeshBasicMaterial({ color: 0x1a0c08 });
    [
      { x: -0.205, z:  0.225, front: true }, { x: 0.205, z:  0.225, front: true },
      { x: -0.215, z: -0.235, front: false }, { x: 0.215, z: -0.235, front: false },
    ].forEach(w => {
      const pivot = new THREE.Group();
      pivot.position.set(w.x, 0.057, w.z);
      const spin = new THREE.Group();
      [[tireGeo, CarMats.tire], [rimGeo, CarMats.rim], [bandGeo, this.bandMat], [discGeo, this.brakeMat]]
        .forEach(([geo, mat]) => {
          const m = new THREE.Mesh(geo, mat);
          m.rotation.z = Math.PI / 2;
          spin.add(m);
        });
      pivot.add(spin);
      g.add(pivot);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(Math.abs(w.x) - 0.06, 0.011, 0.034), CarMats.carbon);
      arm.position.set(w.x / 2, 0.072, w.z);
      g.add(arm);
      this.wheels.push({ pivot, spin, front: w.front });
    });

    if (this.isPlayer) {
      this.underglowLight = new THREE.PointLight(this.team.accent, 1.3, 6, 2);
      this.underglowLight.position.set(0, 0.10, 0);
      g.add(this.underglowLight);
    }
  }

  setTireCompound(c) {
    this.tireCompound = PHYS.tires[c] ? c : 'medium';
    this.tireWear = 0;
    this.tireTemp = 70;
    if (this.bandMat) this.bandMat.color.setHex(PHYS.tires[this.tireCompound].color);
  }

  setPose(xU, zU, heading) {
    this.pos.set(xU, 0.04, zU);
    this.heading = heading;
    this.vx = this.vz = 0;
    this.steerAngle = 0;
    this.yawRate = 0;
    this._sync();
  }

  // ════════ physics step ════════
  update(dt, trackInfo) {
    const surfName = trackInfo ? trackInfo.surface : 'tarmac';
    this.surface = surfName;
    this.offTrack = surfName !== 'tarmac' && surfName !== 'kerb';
    const surf = PHYS.surfaces[surfName] || PHYS.surfaces.tarmac;
    const tire = PHYS.tires[this.tireCompound];

    // grip budget
    const wearGrip = 1 - 0.18 * this.tireWear;
    const dTemp = Math.abs(this.tireTemp - tire.optTemp);
    const tempGrip = 1 - Math.min(0.12, Math.max(0, dTemp - 8) * 0.004);
    const tireGrip = tire.grip * wearGrip * tempGrip;

    const fwdX = Math.sin(this.heading), fwdZ = Math.cos(this.heading);
    let vLong = this.vx * fwdX + this.vz * fwdZ;
    const speed = Math.hypot(this.vx, this.vz);

    const df = Math.min(1 + PHYS.downforceK * speed * speed, PHYS.downforceMax);
    const grip = PHYS.gripBase * surf.mu * tireGrip * df;   // m/s² budget

    // steering: rate-limited toward target lock; lock shrinks with speed
    // (input.steer +1 = screen-right; camera looks along +heading → heading DECREASES)
    const lockNow = this.currentLock = Math.min(PHYS.maxSteerLock,
      grip * PHYS.wheelbase / Math.max(vLong * vLong, 25) + 0.02);
    const targetSteer = -this.input.steer * lockNow;
    const slew = (4.8 - 2.8 * Math.min(1, speed / PHYS.maxSpeed)) * PHYS.maxSteerLock;
    this.steerAngle += THREE.MathUtils.clamp(targetSteer - this.steerAngle, -slew * dt, slew * dt);

    // longitudinal forces
    this.shiftCut = Math.max(0, this.shiftCut - dt);
    const powerA = PHYS.enginePower * PHYS.drivelineEff / (PHYS.mass * Math.max(speed, 6));
    const traction = grip * PHYS.launchTraction;
    let aDrive = this.input.throttle * Math.min(powerA, traction);
    if (this.shiftCut > 0) aDrive *= 0.25;
    this.wheelspin = this.input.throttle > 0.5 && powerA > traction && speed < 30;

    const brakeCap = Math.min(PHYS.maxBrake, grip * 1.05);
    let aBrake = this.input.brake * brakeCap;
    this.lockup = (this.input.brake > 0.9 && speed > 20 && surf.mu < 0.9) ||
                  (this.input.brake > 0.97 && Math.abs(this.steerAngle) > 0.10 && speed > 40);
    if (this.lockup) aBrake *= 0.85;

    const dragMult = (this.drsActive ? PHYS.drsDragMult : 1) * (1 - 0.30 * this.slipstream);
    const aDrag = PHYS.dragCoeff * dragMult * speed * speed + surf.drag +
                  PHYS.rollResist + PHYS.engineBrake * (1 - this.input.throttle) * Math.min(1, speed / 30);

    const aLong = aDrive - aBrake - (vLong >= 0 ? aDrag : -aDrag);
    // friction circle: longitudinal usage reduces the lateral budget
    const aLongUsed = Math.min(Math.abs(aDrive - aBrake), grip);
    let latBudget = Math.sqrt(Math.max(0.15, 1 - Math.pow(aLongUsed / grip * 0.85, 2))) * grip;
    if (this.lockup) latBudget *= 0.5;

    vLong = Math.max(vLong + aLong * dt, this.input.brake > 0 ? 0 : -8);
    const vCap = PHYS.maxSpeed * surf.speedMult * (this.drsActive ? PHYS.drsSpeedMult : 1);
    if (vLong > vCap) vLong = Math.max(vCap, vLong - 25 * dt);

    // lateral / yaw: velocity direction rotates only as fast as grip allows;
    // heading may run ahead into a slip angle (drift)
    const yawDemand = vLong * Math.tan(this.steerAngle) / PHYS.wheelbase;
    const yawGripCap = latBudget / Math.max(Math.abs(vLong), 4);
    const yawVel = THREE.MathUtils.clamp(yawDemand, -yawGripCap, yawGripCap);
    let yawHead = yawDemand;
    const excess = Math.abs(yawDemand) - yawGripCap;
    this.sliding = THREE.MathUtils.clamp(excess / 1.4, 0, 1);
    if (this.lockup) this.sliding = Math.max(this.sliding, 0.4);
    if (this.wheelspin) this.sliding = Math.max(this.sliding, 0.35);

    let velAngle = speed > 1.5 ? Math.atan2(this.vx, this.vz) : this.heading;
    let slip = this._wrapAngle(this.heading - velAngle);
    if (excess > 0) {
      const room = PHYS.maxSlipAngle - slip * Math.sign(yawDemand);
      yawHead = yawVel + Math.sign(yawDemand) * Math.min(excess, Math.max(0, room) * 6);
    }
    this.heading = this._wrapAngle(this.heading + yawHead * dt);
    this.yawRate = yawHead;

    velAngle += yawVel * dt;
    slip = this._wrapAngle(this.heading - velAngle);
    const gripPull = (this.sliding > 0.05 ? PHYS.slideGripMult : 1) * latBudget / Math.max(speed, 5);
    velAngle += THREE.MathUtils.clamp(slip, -gripPull * dt * 3.2, gripPull * dt * 3.2);
    const vMag = Math.max(0, Math.abs(vLong) - Math.abs(slip) * latBudget * 0.25 * dt);
    this.vx = Math.sin(velAngle) * vMag * Math.sign(vLong || 1);
    this.vz = Math.cos(velAngle) * vMag * Math.sign(vLong || 1);

    // integrate position (m → game units)
    this.pos.x += this.vx * dt / SCALE;
    this.pos.z += this.vz * dt / SCALE;

    this._updateGearbox(vMag, dt);

    // tires
    const latUse = Math.min(1, Math.abs(yawVel) * Math.max(speed, 1) / Math.max(grip, 1));
    this.gripUse = latUse;
    const work = 0.0005 + 0.0030 * latUse * latUse + 0.005 * this.sliding +
                 0.007 * (this.lockup ? 1 : 0) + 0.004 * (this.wheelspin ? 1 : 0);
    this.tireWear = Math.min(1, this.tireWear + tire.wearRate * work * dt * (speed > 5 ? 1 : 0));
    this._tireUse += (latUse - this._tireUse) * Math.min(1, dt * 0.8);
    const tTarget = 65 + 42 * this._tireUse + 10 * this.sliding + (surfName === 'kerb' ? 4 : 0);
    this.tireTemp += (tTarget - this.tireTemp) * Math.min(1, dt * 0.25);

    // DRS auto-closes on braking / big steering / leaving the zone
    if (this.drsActive && (this.input.brake > 0.2 || Math.abs(this.input.steer) > 0.5 || !this.drsAvailable)) {
      this.drsActive = false;
    }

    if (!this.finished) { this.lapTime += dt; this.totalTime += dt; }

    this._updateVisuals(dt, vMag);
    this._sync();
  }

  _updateGearbox(speed, dt) {
    const v = Math.abs(speed);
    let g = this.gear;
    if (g < PHYS.gearVmax.length && v > PHYS.gearVmax[g - 1] * 0.985) {
      g++; this.shiftCut = PHYS.shiftCutTime;
      if (this.flame) this.flame.material.opacity = 0.9;   // exhaust pop
    } else if (g > 1 && v < PHYS.gearVmax[g - 2] * 0.86) {
      g--;
    }
    this.gear = g;
    const lo = g > 1 ? PHYS.gearVmax[g - 2] * 0.86 : 0;
    const hi = PHYS.gearVmax[g - 1];
    const frac = THREE.MathUtils.clamp((v - lo) / Math.max(hi - lo, 1), 0, 1);
    let target = PHYS.rpmIdle + frac * (PHYS.rpmMax - PHYS.rpmIdle);
    if (this.wheelspin) target = PHYS.rpmMax * 0.98;
    if (v < 2 && this.input.throttle > 0.1) target = PHYS.rpmIdle + this.input.throttle * 5000;
    this.rpm += (target - this.rpm) * Math.min(1, dt * 9);
  }

  _updateVisuals(dt, speed) {
    const spinRate = speed / (0.057 * SCALE);
    this.wheels.forEach(w => {
      w.spin.rotation.x -= spinRate * dt * (this.lockup ? 0.1 : 1);
      if (w.front) w.pivot.rotation.y = this.steerAngle * 1.15;
    });
    // brake discs glow with brake input at speed
    if (this.brakeMat) {
      const glow = this.input.brake * Math.min(1, speed / 40);
      this.brakeMat.color.setRGB(0.10 + glow * 0.9, 0.05 + glow * 0.22, 0.03);
    }
    // exhaust flame decays fast
    if (this.flame && this.flame.material.opacity > 0) {
      this.flame.material.opacity = Math.max(0, this.flame.material.opacity - dt * 7);
      this.flame.scale.setScalar(0.7 + Math.random() * 0.6);
    }
    if (this.drsFlap) {
      const t = this.drsFlap.rotation.x;
      this.drsFlap.rotation.x += ((this.drsActive ? -0.10 : -0.72) - t) * Math.min(1, dt * 12);
    }
    this._blinkT += dt;
    if (this.rainLight) this.rainLight.visible = (this._blinkT % 0.4) < 0.26;
    // body pitch under braking/throttle, roll into corners
    this.group.rotation.x = (this.input.brake * 0.7 - this.input.throttle * 0.45) * 0.03;
    this.group.rotation.z = this.steerAngle * Math.min(speed / 40, 1) * 0.26;
  }

  _wrapAngle(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }

  _sync() {
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.heading;
  }

  get speed() { return Math.hypot(this.vx, this.vz); }    // m/s
  get speedKmh() { return this.speed * 3.6; }

  completeLap() {
    this.lastLap = this.lapTime;
    if (this.lapTime < this.bestLap) this.bestLap = this.lapTime;
    this.lapTime = 0;
    this.lap++;
  }

  dispose() {
    if (this.scene) this.scene.remove(this.group);
  }
}
