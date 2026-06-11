// Game.js — game loop, race control, cameras, collisions and timing.
// States: idle → grid → lights → racing → finished (paused overlays racing).

const CAR_HALF_WIDTH = 0.125;  // units, for wall collision
const CAR_RADIUS = 0.20;       // units, for car-car collision

class Game {
  constructor() {
    this.canvas = document.getElementById('game-canvas');
    this.state = 'idle';
    this.clock = new THREE.Clock(false);
    this.cameraMode = 0;
    this.totalLaps = 3;
    this.cars = [];
    this.aiDrivers = [];
    this.standings = [];
    this.audio = new AudioManager();
    this.hud = new HUD();
    this.shake = 0;
    this.onRaceEnd = null;

    this._initRenderer();
    this._initScene();
    this._initInput();
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    window.addEventListener('resize', () => {
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
    });
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x070a14, 0.0026);
    this.camera = new THREE.PerspectiveCamera(66, window.innerWidth / window.innerHeight, 0.05, 1900);
    this.camera.position.set(0, 6, 12);
    this._camPos = new THREE.Vector3(0, 6, 12);
    this._camLook = new THREE.Vector3();

    this.scene.add(new THREE.AmbientLight(0x32395c, 1.5));
    const hemi = new THREE.HemisphereLight(0x46538c, 0x57352c, 0.85);
    this.scene.add(hemi);
    const moon = new THREE.DirectionalLight(0x9fb0e8, 0.7);
    moon.position.set(220, 320, -140);
    this.scene.add(moon);
  }

  _initInput() {
    this.keys = {};
    this._steerIn = 0; this._thrIn = 0; this._brkIn = 0;
    document.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.audio.ensure();
      this.keys[e.code] = true;
      if (e.code === 'KeyC') this.cameraMode = (this.cameraMode + 1) % 4;
      if (e.code === 'KeyM') { this._muted = !this._muted; this.audio.setMuted(this._muted); }
      if (e.code === 'Escape') this.togglePause();
      if (e.code === 'KeyR' && this.state === 'racing') this.resetCar(this.player);
      if (e.code === 'KeyE' && this.player && this.player.drsAvailable && this.state === 'racing') {
        this.player.drsActive = !this.player.drsActive;
      }
      // tire choice only while stationary on the grid
      if (this.player && this.player.speed < 1 && this.state !== 'racing') {
        if (e.code === 'Digit1') this.player.setTireCompound('soft');
        if (e.code === 'Digit2') this.player.setTireCompound('medium');
        if (e.code === 'Digit3') this.player.setTireCompound('hard');
      }
    });
    document.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
  }

  // ════════ race setup ════════
  load(trackData, options = {}) {
    this._disposeRace();
    this.totalLaps = options.laps || 3;

    this.track = new Track(this.scene, trackData);
    this.buildings = new Buildings(this.scene);
    this.buildings.build(trackData.landmarks, this.track);
    this.effects = new Effects(this.scene);

    // cars: player starts last (P8); AI take the other teams in pace order
    const playerTeam = options.team || 'redbull';
    const aiTeams = TEAMS.filter(t => t.id !== playerTeam).slice(0, 7);
    const grid = this.track.getGridPoses(aiTeams.length + 1);
    this.cars = [];
    this.aiDrivers = [];

    aiTeams.forEach((t, i) => {
      const car = new Car(this.scene, t.id, { tire: i % 3 === 0 ? 'soft' : 'medium' });
      const gp = grid[i];
      car.setPose(gp.x, gp.z, gp.heading);
      const skill = 0.965 - i * 0.009;     // front of grid = quicker
      this.aiDrivers.push(new AIDriver(car, this.track, skill));
      this.cars.push(car);
    });

    this.player = new Car(this.scene, playerTeam, { isPlayer: true, code: 'YOU', tire: options.tire || 'medium' });
    const pg = grid[grid.length - 1];
    this.player.setPose(pg.x, pg.z, pg.heading);
    this.cars.push(this.player);

    for (const car of this.cars) {
      car._trackInfo = this.track.getTrackInfo(car.pos.x, car.pos.z);
      car._prevT = car._trackInfo.t;
      car._skidLast = null;
      car.progress = car._trackInfo.t - 1;   // grid is just before the line
    }

    // timing state
    this._lapSamples = new Float32Array(201).fill(-1);
    this._bestSamples = null;
    this._bestSectors = [Infinity, Infinity, Infinity];
    this._sectorStart = 0;
    this._jumpStart = false;
    this._resultsShown = false;
    this.shake = 0;

    this.hud.show(this.track, this.player);
    this.hud.hideResults();
    this._updateStandings();

    // grid intro, then lights
    this.state = 'grid';
    this.stateTimer = 0;
    this.lightsCount = 0;
    this.raceTime = -99;
    this.track.setStartLights(0);
    this.hud.setLights(0);
    this.clock.start();
  }

  _disposeRace() {
    if (this.track) this.track.dispose();
    if (this.buildings) this.buildings.dispose();
    if (this.effects) this.effects.dispose();
    this.cars.forEach(c => c.dispose());
    this.cars = [];
    this.aiDrivers = [];
    this.player = null;
  }

  exitToMenu() {
    this.state = 'idle';
    this.clock.stop();
    this.audio.stopEngine();
    this.hud.hide();
    this.hud.hideResults();
    document.getElementById('pause-overlay').style.display = 'none';
    this._disposeRace();
  }

  togglePause() {
    if (this.state === 'racing' || this.state === 'lights') {
      this._pausedFrom = this.state;
      this.state = 'paused';
      this.clock.stop();
      this.audio.stopEngine();
      document.getElementById('pause-overlay').style.display = 'flex';
    } else if (this.state === 'paused') {
      this.state = this._pausedFrom || 'racing';
      this.clock.start();
      document.getElementById('pause-overlay').style.display = 'none';
    }
  }

  resetCar(car) {
    const info = this.track.getTrackInfo(car.pos.x, car.pos.z);
    const s = this.track.posAt(info.t);
    car.pos.set(s.x, 0.04, s.z);
    car.heading = Math.atan2(s.tx, s.tz);
    car.vx = car.vz = 0;
    car.steerAngle = 0;
  }

  // ════════ main loop ════════
  _loop() {
    requestAnimationFrame(this._loop);
    const dt = Math.min(this.clock.running ? this.clock.getDelta() : 0, 0.05);

    switch (this.state) {
      case 'grid': {
        this.stateTimer += dt;
        this._gridCamera(dt);
        if (this.stateTimer > 2.2) {
          this.state = 'lights';
          this.stateTimer = 0;
          this.lightsCount = 0;
          this._lightsHold = null;
          this.raceTime = -10;
        }
        break;
      }
      case 'lights': {
        this.stateTimer += dt;
        if (this.lightsCount < 5 && this.stateTimer > (this.lightsCount + 1) * 0.9) {
          this.lightsCount++;
          this.track.setStartLights(this.lightsCount);
          this.hud.setLights(this.lightsCount);
          this.audio.beep(420, 0.12, 0.15);
          if (this.lightsCount === 5) this._lightsHold = 0.4 + Math.random() * 1.2;
        }
        if (this.lightsCount === 5 && this.stateTimer > 4.5 + this._lightsHold) {
          // LIGHTS OUT!
          this.track.setStartLights(0);
          this.hud.setLights(0, true);
          this.audio.beep(880, 0.5, 0.22);
          this.state = 'racing';
          this.raceTime = 0;
          // race clock starts now
          for (const c of this.cars) { c.totalTime = 0; c.lapTime = 0; }
          if (this._jumpStart) {
            this.player.penalty += 5;
            this.hud.toast('JUMP START — +5s 페널티', 'bad', 3);
          }
        }
        // physics runs so cars sit revving; player creeping = jump start
        this._stepRace(dt, true);
        break;
      }
      case 'racing': {
        this.raceTime += dt;
        this._stepRace(dt, false);
        break;
      }
      case 'finished': {
        this.raceTime += dt;
        this._stepRace(dt, false);
        this.stateTimer += dt;
        if (!this._resultsShown && this.stateTimer > 1.6) {
          this._resultsShown = true;
          this.hud.showResults(this.standings, this.player, this.totalLaps);
          if (this.onRaceEnd) this.onRaceEnd();
        }
        break;
      }
      case 'paused':
      case 'idle':
        break;
    }

    this.renderer.render(this.scene, this.camera);
  }

  _stepRace(dt, preStart) {
    if (dt <= 0) { return; }
    // player input (after the flag an AI cruiser drives the cooldown lap)
    if (this.state !== 'finished') this._readPlayerInput(dt, preStart);

    // track info + slipstream
    for (const car of this.cars) {
      car._prevT = car._trackInfo ? car._trackInfo.t : 0;
      car._trackInfo = this.track.getTrackInfo(car.pos.x, car.pos.z);
      car.drsAvailable = !preStart && this.track.inDrs(car._trackInfo.t) && car.speed > 25;
    }
    this._computeSlipstream();

    // AI
    for (const ai of this.aiDrivers) {
      ai.update(dt, this.state === 'lights' ? -1 : this.raceTime, this.cars);
      if (ai.isStuck) { this.resetCar(ai.car); ai.stuckTime = 0; }
    }

    // physics + per-car events
    for (const car of this.cars) {
      car.update(dt, car._trackInfo);
      this._wallCollision(car, dt);
      this._lapProgress(car);
      this._carEffects(car, dt);
    }
    this._carCollisions();

    if (preStart) {
      // creeping off the grid before lights out = jump start
      if (this.player.speed > 1.2) this._jumpStart = true;
    } else {
      this._playerTiming();
    }

    this._updateStandings();

    this.audio.update(this.player, dt);
    this.effects.update(dt);
    this.buildings.update(dt, this.player.pos);
    this._raceCamera(dt);
    this.hud.update(dt, this);
  }

  _readPlayerInput(dt, preStart) {
    const k = this.keys;
    let thr = (k['KeyW'] || k['ArrowUp']) ? 1 : 0;
    let brk = (k['KeyS'] || k['ArrowDown']) ? 1 : 0;
    let steer = ((k['KeyD'] || k['ArrowRight']) ? 1 : 0) - ((k['KeyA'] || k['ArrowLeft']) ? 1 : 0);

    // gamepad
    const gp = (navigator.getGamepads && navigator.getGamepads()[0]) || null;
    if (gp) {
      const ax = gp.axes[0] || 0;
      if (Math.abs(ax) > 0.08) steer = ax;
      if (gp.buttons[7] && gp.buttons[7].value > 0.05) thr = gp.buttons[7].value;
      if (gp.buttons[6] && gp.buttons[6].value > 0.05) brk = gp.buttons[6].value;
      if (gp.buttons[0] && gp.buttons[0].pressed && this.player.drsAvailable) this.player.drsActive = true;
    }

    // keyboard feel: fast attack, faster release
    const ramp = (cur, target, up, down) =>
      cur + THREE.MathUtils.clamp(target - cur, -down * dt, up * dt);
    this._steerIn = typeof steer === 'number' && Math.abs(steer) <= 1 && gp
      ? steer : ramp(this._steerIn, steer, 3.6, 5.5);
    this._thrIn = ramp(this._thrIn, thr, 4.5, 8);
    this._brkIn = ramp(this._brkIn, brk, 6, 10);

    this.player.input.steer = THREE.MathUtils.clamp(this._steerIn, -1, 1);
    this.player.input.throttle = this._thrIn;
    this.player.input.brake = preStart ? Math.max(this._brkIn, 0) : this._brkIn;
  }

  _computeSlipstream() {
    const lenM = this.track.lengthM;
    for (const car of this.cars) {
      car.slipstream = 0;
      for (const other of this.cars) {
        if (other === car) continue;
        const dProg = ((other.progress - car.progress) % 1 + 1) % 1;
        const distM = dProg * lenM;
        if (distM > 1 && distM < 22) {
          const latDiff = Math.abs(car._trackInfo.lateral - other._trackInfo.lateral);
          if (latDiff < 0.35) car.slipstream = Math.max(car.slipstream, 1 - distM / 22);
        }
      }
    }
  }

  _wallCollision(car, dt) {
    const info = car._trackInfo;
    const limit = info.wallHalf - CAR_HALF_WIDTH;
    if (info.absLateral <= limit) return;

    const side = Math.sign(info.lateral);
    // clamp back inside the wall
    const over = info.absLateral - limit;
    car.pos.x -= info.nx * side * over;
    car.pos.z -= info.nz * side * over;

    // reflect the outward velocity component (m/s; normal is unit in XZ)
    const nx = info.nx * side, nz = info.nz * side;
    const vN = car.vx * nx + car.vz * nz;
    if (vN > 0) {
      const impact = vN;
      car.vx -= nx * vN * 1.25;          // bounce: keep -0.25·vN
      car.vz -= nz * vN * 1.25;
      car.vx *= 0.93; car.vz *= 0.93;     // scrape
      // align heading a touch toward the track direction
      const tAng = info.tangentAngle;
      let dh = tAng - car.heading;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      car.heading += THREE.MathUtils.clamp(dh, -0.4, 0.4) * Math.min(1, impact / 12);

      if (impact > 2) {
        const px = car.pos.x + info.nx * side * CAR_HALF_WIDTH;
        const pz = car.pos.z + info.nz * side * CAR_HALF_WIDTH;
        this.effects.sparks(px, 0.06, pz, -nx, -nz, Math.min(16, 4 + impact));
        if (car === this.player) {
          this.audio.thump(impact / 8);
          this.shake = Math.min(0.3, impact / 60);
        }
      }
    }
  }

  _carCollisions() {
    for (let i = 0; i < this.cars.length; i++) {
      for (let j = i + 1; j < this.cars.length; j++) {
        const a = this.cars[i], b = this.cars[j];
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const d2 = dx * dx + dz * dz;
        const minD = CAR_RADIUS * 2;
        if (d2 > minD * minD || d2 === 0) continue;
        const d = Math.sqrt(d2);
        const nx = dx / d, nz = dz / d;
        const push = (minD - d) / 2;
        a.pos.x -= nx * push; a.pos.z -= nz * push;
        b.pos.x += nx * push; b.pos.z += nz * push;
        // exchange momentum along the contact normal (m/s)
        const rel = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
        if (rel > 0) {
          const k = rel * 0.55;
          a.vx -= nx * k; a.vz -= nz * k;
          b.vx += nx * k; b.vz += nz * k;
          if ((a === this.player || b === this.player) && rel > 3) {
            this.audio.thump(rel / 10);
            this.shake = Math.min(0.25, rel / 70);
          }
        }
      }
    }
  }

  _lapProgress(car) {
    const t = car._trackInfo.t;
    // lap line crossing (t wraps 0.9x → 0.0x while moving forward)
    if (car._prevT > 0.82 && t < 0.18 && !car.finished) {
      if (!car._crossedStart) {
        // grid sits behind the line: first crossing just starts lap 1
        car._crossedStart = true;
        car.lapTime = 0;
      } else if (car.lapTime > 20) {  // sanity: no instant re-cross
        car.completeLap();
        if (car === this.player) this._onPlayerLap();
        if (car.lap > this.totalLaps) {
          car.finished = true;
          car.finishTime = car.totalTime + car.penalty;
          if (car === this.player && this.state === 'racing') this._onPlayerFinish();
        }
      }
    }
    car.progress = car._crossedStart ? (car.lap - 1) + t : t - 1;
  }

  _onPlayerLap() {
    const car = this.player;
    if (car.lastLap === car.bestLap) {
      this._bestSamples = this._lapSamples.slice();
      if (this.standings.every(s => s.car === car || s.car.bestLap > car.lastLap)) {
        this.hud.toast(`FASTEST LAP  ${fmtTime(car.lastLap)}`, 'purple', 2.6);
      } else {
        this.hud.toast(`LAP  ${fmtTime(car.lastLap)}`, '', 2);
      }
    }
    this._lapSamples.fill(-1);
    this._sectorStart = 0;
    this.hud.setSector(-1);
    if (car.lap === this.totalLaps) this.hud.toast('FINAL LAP', 'final', 2.6);
  }

  _onPlayerFinish() {
    this.state = 'finished';
    this.stateTimer = 0;
    // hand the cooldown lap to an AI driver
    const cruiser = new AIDriver(this.player, this.track, 0.80);
    cruiser.launched = true;
    cruiser.reaction = -1;
    this.aiDrivers.push(cruiser);
    this.hud.toast('🏁 체커기!', 'final', 3);
  }

  _playerTiming() {
    const car = this.player;
    if (car.finished) return;
    const t = car._trackInfo.t;

    // live delta vs best lap
    const idx = Math.min(200, Math.floor(t * 200));
    if (this._lapSamples[idx] < 0) this._lapSamples[idx] = car.lapTime;
    if (this._bestSamples && this._bestSamples[idx] >= 0 && car.lapTime > 1) {
      this.hud.setDelta(car.lapTime - this._bestSamples[idx]);
    }

    // sectors at t = 1/3, 2/3, 1.0(lap line handled above)
    for (let s = 0; s < 2; s++) {
      const bound = (s + 1) / 3;
      if (car._prevT < bound && t >= bound && t - car._prevT < 0.2) {
        const secTime = car.lapTime - this._sectorStart;
        this._sectorStart = car.lapTime;
        const better = secTime < this._bestSectors[s];
        if (better) this._bestSectors[s] = secTime;
        this.hud.setSector(s, better ? 'green' : 'yellow');
      }
    }
    // S3 closes on lap completion: handled implicitly by reset
  }

  _updateStandings() {
    const lenM = this.track ? this.track.lengthM : 6000;
    const order = [...this.cars].sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      return b.progress - a.progress;
    });
    this.standings = order.map((car, i) => {
      let gap = 0;
      if (i > 0) {
        const ahead = order[i - 1];
        const dProg = Math.max(0, ahead.progress - car.progress);
        gap = dProg * lenM / Math.max(ahead.speed, 30);
        if (car._gapSmooth == null) car._gapSmooth = gap;
        gap = car._gapSmooth = car._gapSmooth + (gap - car._gapSmooth) * 0.15;
      }
      return { car, gap };
    });
    // cumulative gaps to leader for the tower
    let cum = 0;
    this.standings.forEach((s, i) => { cum += s.gap; if (i > 0) s.gap = cum; });
  }

  // ════════ effects per car ════════
  _carEffects(car, dt) {
    const camD2 = this.camera.position.distanceToSquared(car.group.position);
    if (camD2 > 80 * 80) { car._skidLast = null; return; }

    const h = car.heading;
    const cos = Math.cos(h), sin = Math.sin(h);
    const wheelWorld = (lx, lz) => ({
      x: car.pos.x + lx * cos + lz * sin,
      z: car.pos.z - lx * sin + lz * cos,
    });
    const marking = car.sliding > 0.35 || car.lockup || (car.wheelspin && car.speed > 3);
    if (marking) {
      const rl = wheelWorld(-0.21, -0.235), rr = wheelWorld(0.21, -0.235);
      if (car._skidLast) {
        this.effects.skid(car._skidLast.rl.x, car._skidLast.rl.z, rl.x, rl.z);
        this.effects.skid(car._skidLast.rr.x, car._skidLast.rr.z, rr.x, rr.z);
      }
      car._skidLast = { rl, rr };
      if (Math.random() < 0.5) {
        const w = Math.random() < 0.5 ? rl : rr;
        this.effects.smoke(w.x, 0.05, w.z, car.vx / SCALE, car.vz / SCALE,
          0.5 + car.sliding * 0.8);
      }
    } else {
      car._skidLast = null;
    }
    if (car.surface === 'kerb' && car.speed > 30 && Math.random() < 0.12) {
      const r = wheelWorld(Math.random() < 0.5 ? -0.21 : 0.21, -0.235);
      this.effects.sparks(r.x, 0.03, r.z, -car.vx / 40, -car.vz / 40, 2);
    }
  }

  // ════════ cameras ════════
  _gridCamera(dt) {
    if (!this.player) return;
    const p = this.player.pos;
    const a = this.stateTimer * 0.5 + 2.2;
    const target = new THREE.Vector3(p.x + Math.sin(a) * 3.2, 1.1 - this.stateTimer * 0.18, p.z + Math.cos(a) * 3.2);
    this._camPos.lerp(target, Math.min(1, dt * 2.5));
    this.camera.position.copy(this._camPos);
    this.camera.lookAt(p.x, 0.12, p.z);
    this.camera.fov = 58; this.camera.updateProjectionMatrix();
  }

  _raceCamera(dt) {
    const car = this.player;
    const fwdX = Math.sin(car.heading), fwdZ = Math.cos(car.heading);
    const v = car.speed;
    let target, look, fov = 66, stiff = 6;

    switch (this.cameraMode) {
      case 1: // cockpit
        target = new THREE.Vector3(car.pos.x + fwdX * 0.04, 0.245, car.pos.z + fwdZ * 0.04);
        look = new THREE.Vector3(car.pos.x + fwdX * 9, 0.18, car.pos.z + fwdZ * 9);
        fov = 74 + 9 * (v / PHYS.maxSpeed); stiff = 22;
        break;
      case 2: // nose
        target = new THREE.Vector3(car.pos.x + fwdX * 0.42, 0.13, car.pos.z + fwdZ * 0.42);
        look = new THREE.Vector3(car.pos.x + fwdX * 11, 0.10, car.pos.z + fwdZ * 11);
        fov = 78 + 9 * (v / PHYS.maxSpeed); stiff = 22;
        break;
      case 3: { // drone
        target = new THREE.Vector3(car.pos.x - fwdX * 4, 17, car.pos.z - fwdZ * 4);
        look = car.pos.clone();
        fov = 55; stiff = 3.2;
        break;
      }
      default: { // chase
        const dist = 3.6 + v * 0.016;
        const h = 1.35 + v * 0.004;
        target = new THREE.Vector3(car.pos.x - fwdX * dist, h, car.pos.z - fwdZ * dist);
        look = new THREE.Vector3(car.pos.x + fwdX * 4.5, 0.42, car.pos.z + fwdZ * 4.5);
        fov = 64 + 16 * Math.pow(v / PHYS.maxSpeed, 2) + (car.drsActive ? 2 : 0);
        stiff = 5.5;
      }
    }

    const k = 1 - Math.exp(-stiff * dt);
    this._camPos.lerp(target, this.cameraMode === 1 || this.cameraMode === 2 ? 1 : k);
    this._camLook.lerp(look, Math.min(1, k * 1.6));
    this.camera.position.copy(this._camPos);

    if (this.shake > 0.001) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake;
      this.camera.position.y += (Math.random() - 0.5) * this.shake * 0.6;
      this.shake *= Math.pow(0.05, dt);
    }
    // kerb buzz
    if (car.surface === 'kerb' && v > 15) {
      this.camera.position.y += (Math.random() - 0.5) * 0.012 * (v / 50);
    }

    this.camera.lookAt(this._camLook);
    this.camera.fov += (fov - this.camera.fov) * Math.min(1, dt * 5);
    this.camera.updateProjectionMatrix();
  }
}
