// Game.js - Main game loop and state management

class Game {
  constructor() {
    this.state = 'idle'; // idle | countdown | racing | paused | finished
    this.canvas = document.getElementById('game-canvas');
    this.clock = new THREE.Clock(false);
    this.totalLaps = 5; // default race length
    this.cameraMode = 0; // 0=chase, 1=hood, 2=cockpit, 3=overhead

    // Minimap track bounds (computed after track build)
    this.trackBounds = { minX: 0, maxX: 220, minZ: -10, maxZ: 400 };

    this._initRenderer();
    this._initScene();
    this._initLighting();
    this._initInput();

    this.track = null;
    this.car = null;
    this.buildings = null;
    this.hud = null;
    this.audio = new AudioManager();

    this.countdown = 3;
    this.countdownTimer = 0;

    // Lap checkpoint system (every 10% of track is a checkpoint)
    this.checkpoints = [];
    this.lastCheckpointT = -1;

    // Screen shake state
    this.shakeAmount = 0;
  }

  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = false;   // disabled – major perf win
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.9;

    window.addEventListener('resize', () => {
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
    });
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x0a0a18, 0.0018);

    // Camera
    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 1200);
    this.cameraTarget = new THREE.Vector3();
    this.cameraPos = new THREE.Vector3();
  }

  _initLighting() {
    // Ambient – night city sky (brighter so track surface is always visible)
    const ambient = new THREE.AmbientLight(0x223355, 1.2);
    this.scene.add(ambient);

    // Hemisphere – warm neon glow from below, cool sky from above
    const hemi = new THREE.HemisphereLight(0x334466, 0xff6633, 0.6);
    this.scene.add(hemi);

    // Moonlight directional
    const moon = new THREE.DirectionalLight(0x99aadd, 0.5);
    moon.position.set(200, 300, -100);
    this.scene.add(moon);

    // Neon strip glow – warm low directional from east (buildings side)
    const neon = new THREE.DirectionalLight(0xff4422, 0.25);
    neon.position.set(120, 20, 200);
    this.scene.add(neon);
  }

  _initInput() {
    this.keys = {};
    document.addEventListener('keydown', (e) => {
      this.audio.start(); // Web Audio requires user gesture
      this.keys[e.code] = true;

      if (e.code === 'KeyC') this._cycleCamera();
      if (e.code === 'Escape') this._togglePause();

      if (e.code === 'Digit1' && this.car) this.car.setTireCompound('soft');
      if (e.code === 'Digit2' && this.car) this.car.setTireCompound('medium');
      if (e.code === 'Digit3' && this.car) this.car.setTireCompound('hard');
    });
    document.addEventListener('keyup', (e) => { this.keys[e.code] = false; });

    // Gamepad
    this.gamepad = null;
    window.addEventListener('gamepadconnected', (e) => { this.gamepad = e.gamepad; });
    window.addEventListener('gamepaddisconnected', () => { this.gamepad = null; });
  }

  load(trackData, options = {}) {
    // Clear previous
    while (this.scene.children.length > 0) {
      this.scene.remove(this.scene.children[0]);
    }
    this._initLighting();

    this.totalLaps = options.laps || 5;

    // Build track
    this.track = new Track(this.scene, trackData);

    // Compute minimap bounds
    const pts = this.track.cachedPoints;
    this.trackBounds = {
      minX: Math.min(...pts.map(p => p.x)) - 10,
      maxX: Math.max(...pts.map(p => p.x)) + 10,
      minZ: Math.min(...pts.map(p => p.z)) - 10,
      maxZ: Math.max(...pts.map(p => p.z)) + 10,
    };

    // Build scenery
    this.buildings = new Buildings(this.scene);
    this.buildings.buildLasVegas(trackData.landmarks, this.track);

    // Spawn car
    const livery = options.livery || 'redbull';
    this.car = new Car(this.scene, livery, true);
    this.car.setTireCompound(options.tire || 'medium');

    const sp = trackData.startPosition;
    this.car.setPosition(sp.x, sp.y, sp.z, trackData.startHeading != null ? trackData.startHeading : 0);

    // Build checkpoints (every 10% of track)
    this.checkpoints = [];
    for (let i = 0; i < 10; i++) {
      this.checkpoints.push({ t: (i / 10), passed: false });
    }

    // HUD
    this.hud = new HUD();
    this.hud.show();

    // Reset lap system
    this.lastCheckpointT = -1;

    this.state = 'countdown';
    this.countdown = 3;
    this.countdownTimer = 0;
    this.shakeAmount = 0;
    this.clock.start();
    // Reset start lights
    for (let i = 0; i < 5; i++) {
      const l = document.getElementById(`sl${i}`);
      if (l) l.className = 'start-light';
    }
    this._showCountdown(3);
  }

  _showCountdown(n) {
    const el = document.getElementById('countdown-display');
    if (!el) return;

    const lightsEl = document.getElementById('start-lights');

    if (n > 0) {
      // Light up lights one by one: 3→light1, 2→lights1-2, 1→lights1-3
      if (lightsEl) lightsEl.style.display = 'flex';
      const litCount = 4 - n; // n=3→1 lit, n=2→2 lit, n=1→3 lit
      for (let i = 0; i < 5; i++) {
        const light = document.getElementById(`sl${i}`);
        if (light) light.className = i < litCount ? 'start-light on' : 'start-light';
      }
    } else {
      // GO! - all lights off
      el.style.display = 'block';
      el.textContent = 'GO!';
      el.className = 'countdown-num';
      void el.offsetWidth;
      el.className = 'countdown-num countdown-anim';
      setTimeout(() => { el.style.display = 'none'; }, 900);
      // Flash lights off
      if (lightsEl) {
        for (let i = 0; i < 5; i++) {
          const l = document.getElementById(`sl${i}`);
          if (l) l.className = 'start-light';
        }
        setTimeout(() => { lightsEl.style.display = 'none'; }, 600);
      }
    }
  }

  _togglePause() {
    if (this.state === 'racing') {
      this.state = 'paused';
      this.clock.stop();
      document.getElementById('pause-overlay').style.display = 'flex';
    } else if (this.state === 'paused') {
      this.state = 'racing';
      this.clock.start();
      document.getElementById('pause-overlay').style.display = 'none';
    }
  }

  resume() { this._togglePause(); }

  _cycleCamera() {
    this.cameraMode = (this.cameraMode + 1) % 4;
  }

  _readInput() {
    if (!this.car) return;
    const k = this.keys;
    const inp = this.car.input;

    // Keyboard
    inp.throttle = (k['KeyW'] || k['ArrowUp'])    ? 1.0 : 0;
    inp.brake    = (k['KeyS'] || k['ArrowDown'])   ? 1.0 : 0;
    const steerL = (k['KeyA'] || k['ArrowLeft'])  ? 1.0 : 0;
    const steerR = (k['KeyD'] || k['ArrowRight']) ? 1.0 : 0;
    inp.steer    = steerR - steerL;

    // DRS
    if (k['KeyE'] && this.car.drsAvailable) {
      this.car.drsActive = !this.car.drsActive;
      k['KeyE'] = false; // consume press
    }
    if (!this.car.drsAvailable) this.car.drsActive = false;

    // Gamepad override
    const gp = navigator.getGamepads ? navigator.getGamepads()[0] : null;
    if (gp) {
      inp.throttle = Math.max(inp.throttle, gp.axes[5] !== undefined ? (gp.axes[5] + 1) / 2 : 0);
      inp.brake    = Math.max(inp.brake,    gp.axes[4] !== undefined ? (gp.axes[4] + 1) / 2 : 0);
      const gpSteer = gp.axes[0] || 0;
      if (Math.abs(gpSteer) > 0.08) inp.steer = gpSteer;
    }
  }

  _updateCamera(dt) {
    if (!this.car) {
      // Default idle view of the start line
      this.camera.position.set(0, 8, -20);
      this.camera.lookAt(0, 0, 20);
      return;
    }
    const car = this.car;

    const mode = this.cameraMode;
    let targetPos = new THREE.Vector3();
    let lookAt = new THREE.Vector3();

    const fwd = new THREE.Vector3(Math.sin(car.heading), 0, Math.cos(car.heading));

    if (mode === 0) {
      // Chase cam
      const back = fwd.clone().multiplyScalar(-5.5);
      targetPos.copy(car.pos).add(back).add(new THREE.Vector3(0, 2.2, 0));
      lookAt.copy(car.pos).add(fwd.clone().multiplyScalar(5)).add(new THREE.Vector3(0, 0.4, 0));
    } else if (mode === 1) {
      // Hood cam
      targetPos.copy(car.pos).add(fwd.clone().multiplyScalar(0.3)).add(new THREE.Vector3(0, 0.55, 0));
      lookAt.copy(car.pos).add(fwd.clone().multiplyScalar(10)).add(new THREE.Vector3(0, 0.3, 0));
    } else if (mode === 2) {
      // Cockpit cam
      targetPos.copy(car.pos).add(new THREE.Vector3(0, 0.42, 0));
      lookAt.copy(car.pos).add(fwd.clone().multiplyScalar(8)).add(new THREE.Vector3(0, 0.25, 0));
    } else {
      // Overhead
      targetPos.copy(car.pos).add(new THREE.Vector3(0, 40, 0));
      lookAt.copy(car.pos);
    }

    // Smooth camera
    const lerpSpeed = mode === 3 ? 3 : 8;
    this.camera.position.lerp(targetPos, Math.min(1, dt * lerpSpeed));
    this.cameraTarget.lerp(lookAt, Math.min(1, dt * lerpSpeed));

    // Screen shake for kerbs/gravel
    if (this.shakeAmount > 0) {
      this.camera.position.x += (Math.random() - 0.5) * this.shakeAmount;
      this.camera.position.y += (Math.random() - 0.5) * this.shakeAmount * 0.5;
      this.shakeAmount *= 0.85;
      if (this.shakeAmount < 0.001) this.shakeAmount = 0;
    }

    this.camera.lookAt(this.cameraTarget);
  }

  _checkDRS(t) {
    const zones = LAS_VEGAS.drsZones;
    for (const zone of zones) {
      if (zone.startT > zone.endT) {
        // Wraps around start
        if (t >= zone.startT || t <= zone.endT) return true;
      } else {
        if (t >= zone.startT && t <= zone.endT) return true;
      }
    }
    return false;
  }

  _checkLapProgress() {
    if (!this.car || !this.track) return;
    const car = this.car;
    const surfInfo = this.track.getSurfaceAt(car.pos.x, car.pos.z, car.pos.y);
    const t = surfInfo.tParam;

    // Lap completion: car crosses start (t near 0 or 1) after having passed t=0.5
    if (this.lastCheckpointT > 0.4 && t < 0.15) {
      car.completeLap();
      this.lastCheckpointT = 0;
      if (car.lap > this.totalLaps) {
        this.state = 'finished';
        this.hud.showRaceFinished(car.totalTime, this.totalLaps);
        return;
      }
      this.hud.showLapComplete(car.bestLap === car.lapTime ? car.lapTime : car.lapTime + 1e-9, car.bestLap, car.lap - 1);
    }
    if (t > 0.1) this.lastCheckpointT = Math.max(this.lastCheckpointT, t);

    car.drsAvailable = this._checkDRS(t);

    return surfInfo;
  }

  start() {
    this._loop();
  }

  _loop() {
    requestAnimationFrame(() => this._loop());

    const dt = Math.min(this.clock.getDelta(), 0.05);

    if (this.state === 'countdown') {
      this.countdownTimer += dt;
      if (this.countdownTimer >= 1) {
        this.countdownTimer = 0;
        this.countdown--;
        if (this.countdown === 0) {
          this._showCountdown(0); // shows "GO!"
          this.state = 'racing';  // start immediately on GO!
        } else if (this.countdown > 0) {
          this._showCountdown(this.countdown);
        }
      }
    }

    if (this.state === 'racing') {
      this._readInput();

      const surfInfo = this._checkLapProgress() || this.track.getSurfaceAt(this.car.pos.x, this.car.pos.z, this.car.pos.y);
      this.car.update(dt, surfInfo);

      // ── Hard wall: prevent leaving the circuit ───────────────────────────
      const WALL = this.track.data.trackWidthHalf + this.track.data.kerbWidth + 0.15;
      if (surfInfo.distFromCenter > WALL) {
        const pts = this.track.cachedPoints;
        const center = pts[surfInfo.closestIdx] || pts[0];
        const dx = this.car.pos.x - center.x;
        const dz = this.car.pos.z - center.z;
        const d  = Math.sqrt(dx * dx + dz * dz) || 1;
        // Snap back into tarmac so car is never stuck in the gravel zone
        const snapDist = this.track.data.trackWidthHalf * 0.85;
        this.car.pos.x = center.x + (dx / d) * snapDist;
        this.car.pos.z = center.z + (dz / d) * snapDist;
        this.car.speed *= 0.30;
        this.shakeAmount = Math.max(this.shakeAmount, 0.18);
      }

      // ── Follow track elevation (bridges/flyovers) ────────────────────────
      if (surfInfo.surfaceY != null) {
        const targetY = surfInfo.surfaceY + 0.15;
        // Smooth vertical follow so car doesn't jolt across ramp seams
        this.car.pos.y += (targetY - this.car.pos.y) * Math.min(1, dt * 10);
      }

      // Screen shake on rough surfaces
      if (surfInfo.surface === 'kerb' && this.car.speed > 10) {
        this.shakeAmount = Math.max(this.shakeAmount, 0.03 * (this.car.speed / 50));
      } else if (surfInfo.surface === 'gravel') {
        this.shakeAmount = Math.max(this.shakeAmount, 0.10);
      }

      // Audio
      this.audio.update(this.car.rpm, this.car.input.throttle, surfInfo.surface);

      this._updateCamera(dt);
      this.buildings.update(dt);

      this.hud.update(this.car, this.totalLaps);
      this.hud.updateMinimap(this.car, this.track.cachedPoints, this.trackBounds);
    } else if (this.state === 'paused') {
      // Don't update physics but still render
    } else {
      // idle / countdown - still render scene
      this._updateCamera(dt);
    }

    this.renderer.render(this.scene, this.camera);
  }
}
