// Car.js - F1 car 3D model + physics engine

const CAR_PHYSICS = {
  // Engine
  maxSpeed: 88.9,       // m/s = 320 km/h
  maxAccel: 22,         // m/s²
  engineBrake: 8,       // m/s² coast decel
  maxBrake: 52,         // m/s² = 5.3g
  // Aero
  dragBase: 0.0012,
  dragDRS: 0.0007,
  downforceCoeff: 0.00035, // adds to grip at speed
  // Steering
  maxSteerAngle: 0.042,  // rad/frame at low speed
  steerSpeedFactor: 0.72, // reduction at high speed
  // Surface friction
  surfaces: {
    tarmac:     { mu: 1.00, maxSpeedMult: 1.00 },
    kerb:       { mu: 0.72, maxSpeedMult: 0.95 },
    gravel:     { mu: 0.22, maxSpeedMult: 0.35 },
    outOfBounds:{ mu: 0.15, maxSpeedMult: 0.25 },
  },
  // Tire compounds
  tires: {
    soft:   { gripMult: 1.15, wearRate: 0.014, optTemp: 95 },
    medium: { gripMult: 1.00, wearRate: 0.008, optTemp: 85 },
    hard:   { gripMult: 0.88, wearRate: 0.004, optTemp: 75 },
  },
  // Gearbox: [rpm_up, rpm_down, ratio_mult]
  gears: [
    null,
    { minRPM: 4000, maxRPM: 12000, ratio: 3.2 },
    { minRPM: 5000, maxRPM: 12500, ratio: 2.5 },
    { minRPM: 5500, maxRPM: 13000, ratio: 2.0 },
    { minRPM: 6000, maxRPM: 13500, ratio: 1.6 },
    { minRPM: 6500, maxRPM: 14000, ratio: 1.3 },
    { minRPM: 7000, maxRPM: 14500, ratio: 1.05 },
    { minRPM: 7500, maxRPM: 15000, ratio: 0.85 },
    { minRPM: 8000, maxRPM: 15000, ratio: 0.70 },
  ]
};

// Team livery definitions
const LIVERIES = {
  redbull:   { primary: 0x1E3A8A, secondary: 0xFFD700, accent: 0xFF6B00, driver: 'Verstappen' },
  mercedes:  { primary: 0x00D2BE, secondary: 0xC0C0C0, accent: 0x000000, driver: 'Hamilton' },
  ferrari:   { primary: 0xDC0000, secondary: 0xFFFFFF, accent: 0xFFD700, driver: 'Leclerc' },
  mclaren:   { primary: 0xFF8000, secondary: 0x000000, accent: 0x0090FF, driver: 'Norris' },
  aston:     { primary: 0x006F62, secondary: 0xCEA14E, accent: 0xFFFFFF, driver: 'Alonso' },
};

class Car {
  constructor(scene, livery = 'redbull', isPlayer = true) {
    this.scene = scene;
    this.livery = LIVERIES[livery] || LIVERIES.redbull;
    this.isPlayer = isPlayer;
    this.group = new THREE.Group();
    // modelPivot flips the model 180° so nose faces +Z (south = track direction)
    this.modelPivot = new THREE.Group();
    this.modelPivot.rotation.y = Math.PI;
    this.group.add(this.modelPivot);

    // Physics state
    this.pos = new THREE.Vector3(0, 0.15, 0);
    this.heading = 0;           // radians, 0=south (+Z)
    this.speed = 0;             // m/s
    this.gear = 1;
    this.rpm = 3000;
    this.tireCompound = 'medium';
    this.tireWear = 0;          // 0-100
    this.tireTemp = 75;         // Celsius
    this.drsActive = false;
    this.drsAvailable = false;
    this.surface = 'tarmac';
    this.lapTime = 0;
    this.lap = 1;
    this.lastCheckpoint = -1;
    this.bestLap = Infinity;
    this.totalTime = 0;
    this.finished = false;

    // Input state
    this.input = { throttle: 0, brake: 0, steer: 0, drs: false };

    // Visual state
    this.wheelAngle = 0;   // front wheel steer angle (visual)
    this.wheelRot = 0;     // rolling rotation

    this._buildModel();
    scene.add(this.group);
  }

  _buildModel() {
    const L = this.livery;

    const matBody     = new THREE.MeshStandardMaterial({ color: L.primary,    roughness: 0.4, metalness: 0.3 });
    const matSecond   = new THREE.MeshStandardMaterial({ color: L.secondary,  roughness: 0.4, metalness: 0.4 });
    const matAccent   = new THREE.MeshStandardMaterial({ color: L.accent,     roughness: 0.3, metalness: 0.5 });
    const matCarbon   = new THREE.MeshStandardMaterial({ color: 0x111111,     roughness: 0.5, metalness: 0.1 });

    const matHalo     = new THREE.MeshStandardMaterial({ color: L.primary,    roughness: 0.2, metalness: 0.8 });
    const matWing     = new THREE.MeshStandardMaterial({ color: L.primary,    roughness: 0.35, metalness: 0.2, side: THREE.DoubleSide });

    // All positions/sizes in game units where car length ~= 0.66 units (5.3m / 8m per unit)

    // --- Nose cone ---
    const nose = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.07, 0.18, 8),
      matBody
    );
    nose.rotation.z = Math.PI / 2;
    nose.position.set(0, 0.12, -0.39);
    this.modelPivot.add(nose);

    // --- Main body/chassis ---
    const chassis = new THREE.Mesh(
      new THREE.BoxGeometry(0.20, 0.12, 0.38),
      matBody
    );
    chassis.position.set(0, 0.14, -0.08);
    this.modelPivot.add(chassis);

    // Engine cover (rear)
    const engineCover = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.16, 0.28),
      matBody
    );
    engineCover.position.set(0, 0.16, 0.18);
    this.modelPivot.add(engineCover);

    // Sidepods (x2)
    [-1, 1].forEach((side) => {
      const sidepod = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 0.10, 0.28),
        matSecond
      );
      sidepod.position.set(side * 0.16, 0.12, 0.10);
      this.modelPivot.add(sidepod);

      // Sidepod air intake
      const intake = new THREE.Mesh(
        new THREE.BoxGeometry(0.05, 0.06, 0.02),
        matCarbon
      );
      intake.position.set(side * 0.16, 0.16, -0.05);
      this.modelPivot.add(intake);
    });

    // Cockpit
    const cockpit = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.08, 0.16),
      matCarbon
    );
    cockpit.position.set(0, 0.22, -0.08);
    this.modelPivot.add(cockpit);

    // Helmet (driver)
    const helmet = new THREE.Mesh(
      new THREE.SphereGeometry(0.055, 10, 8),
      matAccent
    );
    helmet.position.set(0, 0.295, -0.08);
    this.modelPivot.add(helmet);

    // Halo safety structure
    const haloShape = new THREE.TorusGeometry(0.065, 0.012, 6, 16, Math.PI);
    const halo = new THREE.Mesh(haloShape, matHalo);
    halo.rotation.x = Math.PI / 2;
    halo.position.set(0, 0.30, -0.06);
    this.modelPivot.add(halo);

    // Halo rear support
    const haloPost = new THREE.Mesh(
      new THREE.CylinderGeometry(0.01, 0.012, 0.08, 6),
      matHalo
    );
    haloPost.position.set(0, 0.26, 0.0);
    this.modelPivot.add(haloPost);

    // --- Front wing ---
    const frontWingMain = new THREE.Mesh(
      new THREE.BoxGeometry(0.50, 0.02, 0.08),
      matWing
    );
    frontWingMain.position.set(0, 0.08, -0.38);
    this.modelPivot.add(frontWingMain);

    // Front wing flap
    const frontFlap = new THREE.Mesh(
      new THREE.BoxGeometry(0.44, 0.015, 0.06),
      matAccent
    );
    frontFlap.position.set(0, 0.11, -0.35);
    frontFlap.rotation.x = 0.15;
    this.modelPivot.add(frontFlap);

    // Front wing endplates
    [-1, 1].forEach((side) => {
      const ep = new THREE.Mesh(
        new THREE.BoxGeometry(0.015, 0.09, 0.10),
        matCarbon
      );
      ep.position.set(side * 0.255, 0.11, -0.37);
      this.modelPivot.add(ep);
    });

    // --- Rear wing ---
    const rearWingMain = new THREE.Mesh(
      new THREE.BoxGeometry(0.48, 0.025, 0.07),
      matWing
    );
    rearWingMain.position.set(0, 0.38, 0.32);
    rearWingMain.rotation.x = -0.18;
    this.modelPivot.add(rearWingMain);

    // DRS flap (moveable upper element)
    this.drsFlap = new THREE.Mesh(
      new THREE.BoxGeometry(0.46, 0.018, 0.05),
      matAccent
    );
    this.drsFlap.position.set(0, 0.42, 0.31);
    this.modelPivot.add(this.drsFlap);

    // Rear wing endplates
    [-1, 1].forEach((side) => {
      const ep = new THREE.Mesh(
        new THREE.BoxGeometry(0.016, 0.14, 0.09),
        matCarbon
      );
      ep.position.set(side * 0.245, 0.36, 0.32);
      this.modelPivot.add(ep);
    });

    // Rear wing support struts
    [-1, 1].forEach((side) => {
      const strut = new THREE.Mesh(
        new THREE.BoxGeometry(0.012, 0.18, 0.012),
        matBody
      );
      strut.position.set(side * 0.12, 0.28, 0.30);
      this.modelPivot.add(strut);
    });

    // Floor/diffuser
    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(0.32, 0.02, 0.55),
      matCarbon
    );
    floor.position.set(0, 0.04, 0.02);
    this.modelPivot.add(floor);

    // --- Wheels ---
    this.wheels = [];
    const wheelPositions = [
      { x: -0.23, z: -0.26, front: true, side: -1 },  // FL
      { x:  0.23, z: -0.26, front: true, side:  1 },  // FR
      { x: -0.25, z:  0.24, front: false, side: -1 }, // RL
      { x:  0.25, z:  0.24, front: false, side:  1 }, // RR
    ];

    const tireColor = this._getTireColor();
    const matTire = new THREE.MeshStandardMaterial({ color: 0x181818, roughness: 0.95 });
    const matRim  = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.2, metalness: 0.8 });
    const matTireSidewall = new THREE.MeshStandardMaterial({ color: tireColor, roughness: 0.8 });

    wheelPositions.forEach((wp) => {
      const wheelGroup = new THREE.Group();

      // Tire (cylinder, axis along X)
      const tire = new THREE.Mesh(
        new THREE.CylinderGeometry(0.065, 0.065, 0.075, 16),
        matTire
      );
      tire.rotation.z = Math.PI / 2;
      wheelGroup.add(tire);

      // Sidewall color band
      const sidewall = new THREE.Mesh(
        new THREE.CylinderGeometry(0.062, 0.062, 0.005, 16),
        matTireSidewall
      );
      sidewall.rotation.z = Math.PI / 2;
      sidewall.position.x = wp.side * 0.04;
      wheelGroup.add(sidewall);

      // Rim
      const rim = new THREE.Mesh(
        new THREE.CylinderGeometry(0.045, 0.045, 0.07, 8),
        matRim
      );
      rim.rotation.z = Math.PI / 2;
      wheelGroup.add(rim);

      wheelGroup.position.set(wp.x, 0.065, wp.z);

      this.modelPivot.add(wheelGroup);
      this.wheels.push({ group: wheelGroup, front: wp.front });
    });

    // --- Exhaust ---
    const exhaust = new THREE.Mesh(
      new THREE.CylinderGeometry(0.018, 0.025, 0.06, 8),
      new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.6, metalness: 0.5 })
    );
    exhaust.position.set(0, 0.20, 0.35);
    exhaust.rotation.x = -0.3;
    this.modelPivot.add(exhaust);

    // Car number
    this._addCarNumber();

    // Headlights (only for player car, adds to scene via group)
    if (this.isPlayer) {
      [-0.08, 0.08].forEach((ox) => {
        const light = new THREE.SpotLight(0xffffff, 3, 18, Math.PI / 10, 0.25, 2);
        light.position.set(ox, 0.18, -0.42);
        light.target.position.set(ox, -0.1, -2);
        this.modelPivot.add(light);
        this.modelPivot.add(light.target);
      });
    }
  }

  _getTireColor() {
    const colors = { soft: 0xcc0000, medium: 0xddcc00, hard: 0xffffff };
    return colors[this.tireCompound] || 0xddcc00;
  }

  _addCarNumber() {
    // Simple car number plate
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 });
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 0.001), mat);
    plate.position.set(0, 0.16, -0.30);
    this.modelPivot.add(plate);
  }

  setPosition(x, y, z, heading) {
    this.pos.set(x, y, z);
    this.heading = heading;
    this._syncGroupTransform();
  }

  _syncGroupTransform() {
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.heading;
  }

  update(dt, surfaceInfo) {
    this.surface = surfaceInfo.surface;
    const surf = CAR_PHYSICS.surfaces[this.surface] || CAR_PHYSICS.surfaces.tarmac;
    const tireData = CAR_PHYSICS.tires[this.tireCompound];
    const grip = surf.mu * tireData.gripMult * (1 + CAR_PHYSICS.downforceCoeff * this.speed * this.speed);
    const maxSpd = CAR_PHYSICS.maxSpeed * surf.maxSpeedMult * (this.drsActive ? 1.05 : 1.0);

    // Engine force (simplified power curve)
    const rpmFactor = Math.min(1.0, this.rpm / 12000);
    const engineForce = this.input.throttle * CAR_PHYSICS.maxAccel * (0.6 + 0.4 * rpmFactor) * grip;

    // Braking
    const brakeForce = this.input.brake * CAR_PHYSICS.maxBrake;

    // Drag
    const dragCoeff = this.drsActive ? CAR_PHYSICS.dragDRS : CAR_PHYSICS.dragBase;
    const drag = dragCoeff * this.speed * this.speed + CAR_PHYSICS.engineBrake * (1 - this.input.throttle);

    // Net force
    let netAccel = engineForce - brakeForce - drag;

    // Enforce surface speed limit
    if (this.speed > maxSpd) {
      netAccel = Math.min(netAccel, -CAR_PHYSICS.engineBrake * 2);
    }

    this.speed = Math.max(0, this.speed + netAccel * dt);
    this.speed = Math.min(maxSpd, this.speed);

    // Steering
    const steerMax = CAR_PHYSICS.maxSteerAngle * (1 - (this.speed / CAR_PHYSICS.maxSpeed) * CAR_PHYSICS.steerSpeedFactor);
    const steerDelta = this.input.steer * steerMax;
    if (this.speed > 0.5) {
      this.heading -= steerDelta * (this.speed / (CAR_PHYSICS.maxSpeed * 0.15 + this.speed));
    }

    // Position update
    const vx = Math.sin(this.heading) * this.speed;
    const vz = Math.cos(this.heading) * this.speed;
    this.pos.x += vx * dt;
    this.pos.z += vz * dt;

    // RPM / gear
    this._updateGearRPM(dt);

    // DRS flap visual
    if (this.drsFlap) {
      this.drsFlap.rotation.x = this.drsActive ? -0.45 : -0.05;
    }

    // Tire wear / temp
    const wearBase = this.surface === 'tarmac' ? 1.0 : (this.surface === 'kerb' ? 0.5 : 2.5);
    this.tireWear += tireData.wearRate * dt * this.input.throttle * wearBase * (this.speed / CAR_PHYSICS.maxSpeed);
    this.tireWear = Math.min(100, this.tireWear);

    // Tire temp model
    const targetTemp = tireData.optTemp * (0.5 + 0.5 * this.speed / CAR_PHYSICS.maxSpeed);
    this.tireTemp += (targetTemp - this.tireTemp) * dt * 0.3;

    // Wheel visuals
    this.wheelRot += (this.speed / 0.065) * dt;
    const frontSteer = -this.input.steer * 0.35; // negate: modelPivot is rotated 180°
    this.wheels.forEach((w) => {
      if (w.front) {
        w.group.rotation.y = frontSteer;
      }
      // Rolling
      w.group.children[0].rotation.x = this.wheelRot;
    });

    // Lap timing
    this.lapTime += dt;
    this.totalTime += dt;

    this._syncGroupTransform();
  }

  _updateGearRPM(dt) {
    const gears = CAR_PHYSICS.gears;

    // RPM from speed + gear ratio: rpm = speed * (finalDrive/gearRatio) * (60 / 2πR)
    // Simplified: targetRPM = speed * 102.5 / ratio
    const ratio = gears[this.gear].ratio;
    const targetRPM = Math.max(800, this.speed * 102.5 / ratio);

    // Auto shift up / down
    if (this.gear < 8 && targetRPM > gears[this.gear].maxRPM * 0.93) {
      this.gear++;
    }
    if (this.gear > 1 && targetRPM < gears[this.gear].minRPM * 0.90 && this.speed > 2) {
      this.gear--;
    }

    this.rpm += (targetRPM - this.rpm) * Math.min(1, dt * 10);
    this.rpm = Math.max(800, Math.min(15000, this.rpm));
  }

  completeLap() {
    if (this.lapTime < this.bestLap) this.bestLap = this.lapTime;
    this.lapTime = 0;
    this.lap++;
  }

  setTireCompound(compound) {
    this.tireCompound = compound;
    this.tireWear = 0;
    // Update sidewall colors
    const color = this._getTireColor();
    this.wheels.forEach((w) => {
      if (w.group.children[1]) {
        w.group.children[1].material.color.setHex(color);
      }
    });
  }

  getSpeedKMH() { return this.speed * 3.6; }
  getThrottle() { return this.input.throttle; }
  getBrake()    { return this.input.brake; }
}
