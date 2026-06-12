// Game.js — game loop, race control, cameras, collisions and timing.
// States: idle → grid → lights → racing → finished (paused overlays racing).

const CAR_HALF_WIDTH = 0.125;   // units, wall collision
const CAR_CIRCLE_R = 0.155;     // units, car-car collision circles
const CAR_CIRCLE_OFF = 0.17;    // units, fore/aft circle offsets

class Game {
  constructor() {
    this.canvas = document.getElementById('game-canvas');
    this.state = 'idle';
    this.clock = new THREE.Clock(false);
    this.cameraMode = 0;        // 0 chase · 1 cockpit · 2 TV · 3 drone
    this.totalLaps = 3;
    this.cars = [];
    this.aiDrivers = [];
    this.standings = [];
    this.audio = new AudioManager();
    this.hud = new HUD();
    this.shake = 0;

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
    this.renderer.toneMappingExposure = 1.18;
    window.addEventListener('resize', () => {
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
    });
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x080b16, 0.0022);
    this.camera = new THREE.PerspectiveCamera(66, window.innerWidth / window.innerHeight, 0.05, 1900);
    this.camera.position.set(0, 6, 12);
    this._camPos = new THREE.Vector3(0, 6, 12);
    this._camLook = new THREE.Vector3();

    this.scene.add(new THREE.AmbientLight(0x3a4470, 1.7));
    this.scene.add(new THREE.HemisphereLight(0x55639e, 0x6b4434, 0.95));
    const moon = new THREE.DirectionalLight(0xa9b9f0, 0.75);
    moon.position.set(220, 320, -140);
    this.scene.add(moon);
  }

  _initInput() {
    this.keys = {};
    this._steerIn = 0; this._thrIn = 0; this._brkIn = 0;
    document.addEventListener('pointerdown', () => this.audio.ensure());
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
    this._buildTvPods();

    // cars: player starts last; AI take the other teams in pace order
    const playerTeam = options.team || 'redbull';
    const aiTeams = TEAMS.filter(t => t.id !== playerTeam).slice(0, 7);
    const grid = this.track.getGridPoses(aiTeams.length + 1);
    this.cars = [];
    this.aiDrivers = [];

    aiTeams.forEach((t, i) => {
      const car = new Car(this.scene, t.id, { tire: i % 3 === 0 ? 'soft' : 'medium' });
      const gp = grid[i];
      car.setPose(gp.x, gp.z, gp.heading);
      this.aiDrivers.push(new AIDriver(car, this.track, 0.965 - i * 0.009));
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
      car._crossedStart = false;
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
    this._steerIn = this._thrIn = this._brkIn = 0;

    this.hud.show(this.track, this.player);
    this.hud.hideResults();
    this._updateStandings();

    this.state = 'grid';
    this.stateTimer = 0;
    this.lightsCount = 0;
    this.raceTime = -99;
    this.track.setStartLights(0);
    this.hud.setLights(0);
    this.clock.start();
  }

  _buildTvPods() {
    // one static broadcast camera at every corner, mounted outside the wall
    this.tvPods = this.track.data.corners.map(c => {
      const t = this.track.tFromWp(c.wp);
      const s = this.track.posAt(t);
      const side = -(Math.sign(this.track.lineOffsetAt(t)) || 1);   // outside of the corner
      const lat = (this.track.wallHalfAt(t) + 2.0) * side;
      return { t, x: s.x + s.nx * lat, y: 1.7, z: s.z + s.nz * lat };
    });
    this._tvPod = null;
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
    car.setPose(s.x, s.z, Math.atan2(s.tx, s.tz));
    car._skidLast = null;
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
          for (const c of this.cars) { c.totalTime = 0; c.lapTime = 0; }
          if (this._jumpStart) {
            this.player.penalty += 5;
            this.hud.toast('JUMP START — +5s 페널티', 'bad', 3);
          }
        }
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
        if (!this._resultsShown && this.stateTimer > 1.8) {
          this._resultsShown = true;
          this.hud.showResults(this.standings, this.player, this.totalLaps);
        }
        break;
      }
    }

    this.renderer.render(this.scene, this.camera);
  }

  _stepRace(dt, preStart) {
    if (dt <= 0) return;
    if (this.state !== 'finished') this._readPlayerInput(dt, preStart);

    for (const car of this.cars) {
      car._prevT = car._trackInfo ? car._trackInfo.t : 0;
      car._trackInfo = this.track.getTrackInfo(car.pos.x, car.pos.z);
      car.drsAvailable = !preStart && this.track.inDrs(car._trackInfo.t) && car.speed > 25;
    }
    this._computeSlipstream();

    for (const ai of this.aiDrivers) {
      ai.update(dt, this.state === 'lights' ? -1 : this.raceTime, this.cars);
      if (ai.isStuck) { this.resetCar(ai.car); ai.reset(); ai.launched = true; }
    }

    for (const car of this.cars) {
      car.update(dt, car._trackInfo);
      this._wallCollision(car);
      this._lapProgress(car);
      this._carEffects(car);
    }
    this._carCollisions();

    if (preStart) {
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
    let analogSteer = false;

    const gp = (navigator.getGamepads && navigator.getGamepads()[0]) || null;
    if (gp) {
      const ax = gp.axes[0] || 0;
      if (Math.abs(ax) > 0.08) { steer = ax; analogSteer = true; }
      if (gp.buttons[7] && gp.buttons[7].value > 0.05) thr = gp.buttons[7].value;
      if (gp.buttons[6] && gp.buttons[6].value > 0.05) brk = gp.buttons[6].value;
      if (gp.buttons[0] && gp.buttons[0].pressed && this.player.drsAvailable) this.player.drsActive = true;
    }

    const ramp = (cur, target, up, down) =>
      cur + THREE.MathUtils.clamp(target - cur, -down * dt, up * dt);
    this._steerIn = analogSteer ? steer : ramp(this._steerIn, steer, 5.0, 7.0);
    this._thrIn = ramp(this._thrIn, thr, 5, 9);
    this._brkIn = ramp(this._brkIn, brk, 7, 11);

    // stability assist: blend in counter-steer against yaw so keyboard
    // driving stays catchable at speed (input.steer + counters yaw +)
    const assist = THREE.MathUtils.clamp(
      (this.player.yawRate || 0) * 0.16 * Math.min(1, this.player.speed / 30), -0.4, 0.4);
    this.player.input.steer = THREE.MathUtils.clamp(this._steerIn + assist, -1, 1);
    this.player.input.throttle = this._thrIn;
    this.player.input.brake = this._brkIn;
  }

  _computeSlipstream() {
    const lenM = this.track.lengthM;
    for (const car of this.cars) {
      car.slipstream = 0;
      for (const other of this.cars) {
        if (other === car) continue;
        const distM = ((other._trackInfo.t - car._trackInfo.t) % 1 + 1) % 1 * lenM;
        if (distM > 1 && distM < 22) {
          const latDiff = Math.abs(car._trackInfo.lateral - other._trackInfo.lateral);
          if (latDiff < 0.35) car.slipstream = Math.max(car.slipstream, 1 - distM / 22);
        }
      }
    }
  }

  _wallCollision(car) {
    const info = car._trackInfo;
    const limit = info.wallHalf - CAR_HALF_WIDTH;
    if (info.absLateral <= limit) return;

    const side = Math.sign(info.lateral);
    const over = info.absLateral - limit;
    car.pos.x -= info.nx * side * over;
    car.pos.z -= info.nz * side * over;

    const nx = info.nx * side, nz = info.nz * side;
    const vN = car.vx * nx + car.vz * nz;
    if (vN > 0) {
      const impact = vN;
      car.vx -= nx * vN * 1.25;          // keep -0.25·vN bounce
      car.vz -= nz * vN * 1.25;
      car.vx *= 0.93; car.vz *= 0.93;    // scrape
      let dh = info.tangentAngle - car.heading;
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

  // car-car: two circles per car (nose/tail) so cars can't visually overlap
  _carCollisions() {
    const circles = this.cars.map(car => {
      const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
      return [
        { car, x: car.pos.x + fx * CAR_CIRCLE_OFF, z: car.pos.z + fz * CAR_CIRCLE_OFF },
        { car, x: car.pos.x - fx * CAR_CIRCLE_OFF, z: car.pos.z - fz * CAR_CIRCLE_OFF },
      ];
    });
    const minD = CAR_CIRCLE_R * 2;
    for (let i = 0; i < this.cars.length; i++) {
      for (let j = i + 1; j < this.cars.length; j++) {
        const a = this.cars[i], b = this.cars[j];
        // quick reject
        const ddx = b.pos.x - a.pos.x, ddz = b.pos.z - a.pos.z;
        if (ddx * ddx + ddz * ddz > 1.2) continue;
        for (const ca of circles[i]) for (const cb of circles[j]) {
          const dx = cb.x - ca.x, dz = cb.z - ca.z;
          const d2 = dx * dx + dz * dz;
          if (d2 >= minD * minD || d2 === 0) continue;
          const d = Math.sqrt(d2);
          const nx = dx / d, nz = dz / d;
          const push = (minD - d) / 2;
          a.pos.x -= nx * push; a.pos.z -= nz * push;
          b.pos.x += nx * push; b.pos.z += nz * push;
          const rel = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
          if (rel > 0) {
            const k = rel * 0.5;
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
  }

  _lapProgress(car) {
    const t = car._trackInfo.t;
    if (car._prevT > 0.82 && t < 0.18 && !car.finished) {
      if (!car._crossedStart) {
        car._crossedStart = true;        // grid sits behind the line
        car.lapTime = 0;
      } else if (car.lapTime > 20) {
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

    const idx = Math.min(200, Math.floor(t * 200));
    if (this._lapSamples[idx] < 0) this._lapSamples[idx] = car.lapTime;
    if (this._bestSamples && this._bestSamples[idx] >= 0 && car.lapTime > 1) {
      this.hud.setDelta(car.lapTime - this._bestSamples[idx]);
    }

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
    let cum = 0;
    this.standings.forEach((s, i) => { cum += s.gap; if (i > 0) s.gap = cum; });
  }

  // ════════ per-car effects ════════
  _carEffects(car) {
    const camD2 = this.camera.position.distanceToSquared(car.group.position);
    if (camD2 > 80 * 80) { car._skidLast = null; return; }

    const cos = Math.cos(car.heading), sin = Math.sin(car.heading);
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
        this.effects.smoke(w.x, 0.05, w.z, car.vx / SCALE, car.vz / SCALE, 0.5 + car.sliding * 0.8);
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
    this.camera.fov = 56;
    this.camera.updateProjectionMatrix();
  }

  _pickTvPod(t) {
    let best = null, bestScore = 1e9;
    for (const pod of this.tvPods) {
      let d = ((pod.t - t) % 1 + 1) % 1;       // distance ahead to the pod
      if (d > 0.5) d = (1 - d) * 2.5;          // pods behind get penalized
      if (d < bestScore) { bestScore = d; best = pod; }
    }
    return best;
  }

  _raceCamera(dt) {
    const car = this.player;
    const fwdX = Math.sin(car.heading), fwdZ = Math.cos(car.heading);
    const sideX = Math.cos(car.heading), sideZ = -Math.sin(car.heading);
    const v = car.speed;
    let target, look, fov = 66, stiff = 6, roll = 0, snap = false;

    switch (this.cameraMode) {
      case 1: { // cockpit / T-cam (above the halo)
        target = new THREE.Vector3(car.pos.x - fwdX * 0.06, 0.30, car.pos.z - fwdZ * 0.06);
        const lookSide = -car.steerAngle * 3.0;
        look = new THREE.Vector3(
          car.pos.x + fwdX * 10 + sideX * lookSide, 0.18,
          car.pos.z + fwdZ * 10 + sideZ * lookSide);
        fov = 72 + 10 * (v / PHYS.maxSpeed);
        snap = true;
        break;
      }
      case 2: { // TV broadcast pods
        const pod = this._pickTvPod(car._trackInfo.t);
        if (pod !== this._tvPod) { this._tvPod = pod; this._camPos.set(pod.x, pod.y, pod.z); }
        target = new THREE.Vector3(pod.x, pod.y, pod.z);
        look = new THREE.Vector3(car.pos.x, 0.15, car.pos.z);
        fov = THREE.MathUtils.clamp(900 / (this.camera.position.distanceTo(car.pos) * SCALE) * 8, 18, 52);
        snap = true;
        break;
      }
      case 3: { // drone
        target = new THREE.Vector3(car.pos.x - fwdX * 4, 17, car.pos.z - fwdZ * 4);
        look = car.pos.clone();
        fov = 55; stiff = 3.2;
        break;
      }
      default: { // chase
        const dist = 3.4 + v * 0.015;
        const h = 1.18 + v * 0.0035;
        const lag = -car.steerAngle * 6 * Math.min(1, v / 40);   // swing out of corners
        target = new THREE.Vector3(
          car.pos.x - fwdX * dist + sideX * lag * 0.12, h,
          car.pos.z - fwdZ * dist + sideZ * lag * 0.12);
        look = new THREE.Vector3(car.pos.x + fwdX * 4.6, 0.38, car.pos.z + fwdZ * 4.6);
        fov = 63 + 17 * Math.pow(v / PHYS.maxSpeed, 2) + (car.drsActive ? 2 : 0);
        stiff = 5.5;
        roll = car.steerAngle * Math.min(1, v / 50) * 0.55;
      }
    }

    const k = 1 - Math.exp(-stiff * dt);
    this._camPos.lerp(target, snap ? 1 : k);
    this._camLook.lerp(look, snap ? 1 : Math.min(1, k * 1.6));
    this.camera.position.copy(this._camPos);

    if (this.shake > 0.001 && this.cameraMode !== 2) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake;
      this.camera.position.y += (Math.random() - 0.5) * this.shake * 0.6;
      this.shake *= Math.pow(0.05, dt);
    }
    if (car.surface === 'kerb' && v > 15 && this.cameraMode !== 2) {
      this.camera.position.y += (Math.random() - 0.5) * 0.012 * (v / 50);
    }

    this.camera.lookAt(this._camLook);
    if (roll) this.camera.rotateZ(roll);
    this.camera.fov += (fov - this.camera.fov) * Math.min(1, dt * 5);
    this.camera.updateProjectionMatrix();
  }
}
