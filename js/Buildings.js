// Buildings.js – Las Vegas night scenery
// Perf targets: <80 draw calls total, ≤5 PointLights, no SpotLights, no per-face multi-material

class Buildings {
  constructor(scene) {
    this.scene  = scene;
    this.group  = new THREE.Group();
    this.anim   = [];
    this.time   = 0;
    scene.add(this.group);
  }

  buildLasVegas(landmarks, track) {
    this.track = track;  // optional — used by arc-length-placed detail
    // ── Shared materials (defined once, reused) ─────────────────────────────
    this.mats = {
      concrete : new THREE.MeshStandardMaterial({ color: 0x888899, roughness: 0.8 }),
      glass    : new THREE.MeshStandardMaterial({ color: 0x7aaabb, roughness: 0.2, metalness: 0.6, emissive: 0x112233, emissiveIntensity: 0.4 }),
      gold     : new THREE.MeshStandardMaterial({ color: 0xd4b060, roughness: 0.5, metalness: 0.4, emissive: 0x442200, emissiveIntensity: 0.3 }),
      white    : new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.6 }),
      dark     : new THREE.MeshStandardMaterial({ color: 0x222233, roughness: 0.8 }),
      pole     : new THREE.MeshStandardMaterial({ color: 0x888899, roughness: 0.6, metalness: 0.4 }),
      neonHead : new THREE.MeshBasicMaterial({ color: 0xfff4cc }),
      road     : new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.95 }),
      water    : new THREE.MeshBasicMaterial({ color: 0x2255aa, transparent: true, opacity: 0.7 }),
    };

    this._buildSky();
    this._buildStripRoad();
    landmarks.forEach(lm => this._dispatchLandmark(lm));
    this._buildPoles();           // InstancedMesh for all light poles
    this._buildLights();          // 5 strategic PointLights
    this._buildDecoNeon();        // cheap billboard neon
    this._buildBridgeSupports();  // columns under the T6 flyover
    this._buildPitBuilding();     // pit lane garage on main straight
    this._buildStartGantry();     // start/finish overhead gantry
    this._buildGrandstands();     // spectator stands
    this._buildAdHoardings();     // trackside sponsor boards
    this._buildTyreStacks();      // tyre barriers at corner apices
    this._buildMarshalPosts();    // yellow-flag huts around the lap
    this._buildPalmTrees();       // Strip palms (instanced)
  }

  // ─── Dispatch ─────────────────────────────────────────────────────────────
  _dispatchLandmark(lm) {
    switch (lm.type) {
      case 'sphere':  this._buildSphere(lm);  break;
      case 'casino':  this._buildCasino(lm);  break;
      case 'tower':   this._buildTower(lm);   break;
      case 'pyramid': this._buildPyramid(lm); break;
      default:        this._buildCasino(lm);
    }
  }

  // ─── Sky + Stars ─────────────────────────────────────────────────────────
  _buildSky() {
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(880, 20, 10),
      new THREE.MeshBasicMaterial({ color: 0x030308, side: THREE.BackSide })
    );
    sky.position.set(60, 0, 220);
    this.group.add(sky);

    const N = 1600, pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(0.15 + Math.random() * 0.8);
      pos[i*3]   = 860 * Math.sin(ph) * Math.cos(th) + 60;
      pos[i*3+1] = 860 * Math.cos(ph);
      pos[i*3+2] = 860 * Math.sin(ph) * Math.sin(th) + 180;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.group.add(new THREE.Points(g,
      new THREE.PointsMaterial({ color: 0xffffff, size: 1.4, sizeAttenuation: true })));
  }

  // ─── MSG Sphere ───────────────────────────────────────────────────────────
  _buildSphere(lm) {
    const R = lm.radius;

    // Animated canvas LED texture
    this._ledCanvas = document.createElement('canvas');
    this._ledCanvas.width = this._ledCanvas.height = 512;
    this._ledCtx = this._ledCanvas.getContext('2d');
    this._ledTex = new THREE.CanvasTexture(this._ledCanvas);
    this._drawLED(0);

    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(R, 36, 24),
      new THREE.MeshStandardMaterial({
        map: this._ledTex, emissiveMap: this._ledTex,
        emissive: new THREE.Color(0xffffff), emissiveIntensity: 0.85,
        roughness: 0.15, metalness: 0.05,
      })
    );
    sphere.position.set(lm.x, R + 2, lm.z);
    this.group.add(sphere);
    this.anim.push({ type: 'sphere' });

    // Pillar
    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(R * 0.16, R * 0.2, R + 2, 10),
      this.mats.concrete
    );
    pillar.position.set(lm.x, (R + 2) / 2, lm.z);
    this.group.add(pillar);

    this._label(lm.label, lm.x, R * 2 + 5, lm.z);
  }

  _drawLED(t) {
    const ctx = this._ledCtx, S = 512;
    ctx.fillStyle = '#000010';
    ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 10; i++) {
      const hue = (t * 50 + i * 36) % 360;
      ctx.strokeStyle = `hsl(${hue},100%,55%)`;
      ctx.lineWidth = 24;
      ctx.beginPath();
      const x = (i / 10) * S;
      const w = Math.sin(t * 1.2 + i * 0.65) * S * 0.07;
      ctx.moveTo(x, 0);
      ctx.bezierCurveTo(x + w, S / 3, x - w, S * 2 / 3, x, S);
      ctx.stroke();
    }
    // scanlines
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    for (let y = 0; y < S; y += 4) ctx.fillRect(0, y, S, 2);
    this._ledTex.needsUpdate = true;
  }

  // ─── Casino buildings ─────────────────────────────────────────────────────
  _buildCasino(lm) {
    const mat = this._casinoMat(lm.color);

    // Main body
    const body = new THREE.Mesh(new THREE.BoxGeometry(lm.w, lm.h, lm.d), mat);
    body.position.set(lm.x, lm.h / 2, lm.z);
    this.group.add(body);

    // Wide podium
    const podium = new THREE.Mesh(
      new THREE.BoxGeometry(lm.w * 1.15, 2.5, lm.d * 1.1),
      this.mats.concrete
    );
    podium.position.set(lm.x, 1.25, lm.z);
    this.group.add(podium);

    // Rooftop neon bar
    const neon = new THREE.Mesh(
      new THREE.BoxGeometry(lm.w * 0.65, 1.0, 0.4),
      new THREE.MeshBasicMaterial({ color: this._brighten(lm.color) })
    );
    neon.position.set(lm.x, lm.h + 1.5, lm.z - lm.d * 0.5);
    this.group.add(neon);
    this.anim.push({ type: 'neon', mesh: neon, phase: Math.random() * Math.PI * 2 });

    if (lm.label === 'Caesars') this._caesarsColumns(lm);
    if (lm.fountain) this._buildFountain(lm.x, lm.z - lm.d / 2 - 8);
  }

  _casinoMat(color) {
    // Return a simple emissive material derived from the landmark color
    const c = new THREE.Color(color);
    const mat = new THREE.MeshStandardMaterial({
      color: c.clone(),
      emissive: c.clone().multiplyScalar(0.18),
      roughness: 0.65,
      metalness: 0.15,
    });
    return mat;
  }

  _brighten(hex) {
    const c = new THREE.Color(hex);
    c.offsetHSL(0.02, 0.2, 0.25);
    return c;
  }

  _caesarsColumns(lm) {
    const mat = this.mats.white;
    const count = Math.floor(lm.w / 5);
    const geo = new THREE.CylinderGeometry(0.4, 0.5, lm.h * 0.65, 8);
    const inst = new THREE.InstancedMesh(geo, mat, count);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < count; i++) {
      m4.setPosition(
        lm.x - lm.w / 2 + (i + 0.5) * (lm.w / count),
        lm.h * 0.325,
        lm.z - lm.d * 0.5 - 0.5
      );
      inst.setMatrixAt(i, m4);
    }
    inst.instanceMatrix.needsUpdate = true;
    this.group.add(inst);
  }

  // ─── Towers ───────────────────────────────────────────────────────────────
  _buildTower(lm) {
    if (lm.label === 'Stratosphere') {
      this._buildStratosphere(lm);
      return;
    }
    // Stepped glass tower (3 boxes, 1 shared material)
    const steps = [
      { fy: 0.00, fh: 0.55, fw: 1.00 },
      { fy: 0.55, fh: 0.30, fw: 0.78 },
      { fy: 0.85, fh: 0.15, fw: 0.56 },
    ];
    steps.forEach(s => {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(lm.w * s.fw, lm.h * s.fh, lm.d * s.fw),
        this.mats.glass
      );
      mesh.position.set(lm.x, lm.h * s.fy + lm.h * s.fh / 2, lm.z);
      this.group.add(mesh);
    });
    // Antenna
    const ant = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.12, 7, 5),
      this.mats.concrete
    );
    ant.position.set(lm.x, lm.h + 3.5, lm.z);
    this.group.add(ant);
  }

  _buildStratosphere(lm) {
    const segH = lm.h / 10;
    const matR = new THREE.MeshStandardMaterial({ color: 0xcc2222, roughness: 0.4, emissive: 0x660000, emissiveIntensity: 0.5 });
    const matW = this.mats.white;
    for (let i = 0; i < 10; i++) {
      const r0 = lm.w / 2 * Math.max(0.08, 1 - (i + 1) * 0.058);
      const r1 = lm.w / 2 * (1 - i * 0.058);
      const seg = new THREE.Mesh(
        new THREE.CylinderGeometry(r0, r1, segH, 10),
        i % 2 === 0 ? matR : matW
      );
      seg.position.set(lm.x, i * segH + segH / 2, lm.z);
      this.group.add(seg);
    }
    const pod = new THREE.Mesh(
      new THREE.CylinderGeometry(lm.w * 1.7, lm.w * 1.5, 5, 14),
      this.mats.glass
    );
    pod.position.set(lm.x, lm.h - 2.5, lm.z);
    this.group.add(pod);

    const beacon = new THREE.Mesh(
      new THREE.SphereGeometry(0.6, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xff2200 })
    );
    beacon.position.set(lm.x, lm.h + 1.2, lm.z);
    this.group.add(beacon);
    this.anim.push({ type: 'beacon', mesh: beacon });
  }

  // ─── Luxor Pyramid ────────────────────────────────────────────────────────
  _buildPyramid(lm) {
    const mat = new THREE.MeshStandardMaterial({
      color: lm.color, roughness: 0.45, metalness: 0.2,
      emissive: lm.color, emissiveIntensity: 0.08,
    });
    const pyramid = new THREE.Mesh(new THREE.ConeGeometry(lm.size, lm.size, 4), mat);
    pyramid.position.set(lm.x, lm.size / 2, lm.z);
    pyramid.rotation.y = Math.PI / 4;
    this.group.add(pyramid);

    // Sky beam (cheap emissive cylinder)
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.4, 0.9, 400, 5),
      new THREE.MeshBasicMaterial({ color: 0xffffdd, transparent: true, opacity: 0.06 })
    );
    beam.position.set(lm.x, lm.size + 200, lm.z);
    this.group.add(beam);

    this._label(lm.label, lm.x, lm.size + 4, lm.z);
  }

  // ─── Bellagio Fountain ────────────────────────────────────────────────────
  _buildFountain(x, z) {
    // Pool
    const pool = new THREE.Mesh(
      new THREE.CylinderGeometry(8, 8, 0.4, 20),
      new THREE.MeshStandardMaterial({ color: 0x003366, roughness: 0.15, metalness: 0.2 })
    );
    pool.position.set(x, 0.2, z);
    this.group.add(pool);

    // Animated water plane
    const water = new THREE.Mesh(new THREE.CircleGeometry(7.5, 20), this.mats.water);
    water.rotation.x = -Math.PI / 2;
    water.position.set(x, 0.42, z);
    this.group.add(water);
    this.anim.push({ type: 'water', mesh: water });

    // Jet lines – one Line per arc (16 arcs, each 7 pts)
    const lineMat = new THREE.LineBasicMaterial({ color: 0x88ccff, transparent: true, opacity: 0.7 });
    const jets = [];
    for (let i = 0; i < 16; i++) {
      const angle = (i / 16) * Math.PI * 2;
      const h = 4 + Math.sin(i * 1.1) * 1.5;
      const pts = [];
      for (let s = 0; s <= 6; s++) {
        const tt = s / 6;
        pts.push(new THREE.Vector3(
          x + Math.cos(angle) * 5 * (1 - tt * 0.25),
          tt * h * Math.sin(tt * Math.PI) + 0.4,
          z + Math.sin(angle) * 5 * (1 - tt * 0.25)
        ));
      }
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        lineMat.clone()
      );
      jets.push(line);
      this.group.add(line);
    }
    this.anim.push({ type: 'fountain', jets });
  }

  // ─── Floodlight poles (InstancedMesh) ────────────────────────────────────
  _buildPoles() {
    // Pole positions: ±2.5 units from track centre
    // Main straight (x=0, z=0→180), Back straight (x=114, z=50→242)
    // Harmon (z≈244, x=14→94), Koval (x=124, z=268→316)
    const positions = [];
    for (let z = 0; z <= 180; z += 22) { positions.push([-2.5, z], [2.5, z]); }
    for (let z = 50; z <= 240; z += 22) { positions.push([111.5, z], [116.5, z]); }
    for (let x = 14; x <= 94; x += 20) { positions.push([x, 247]); }
    for (let z = 268; z <= 316; z += 20) { positions.push([121.5, z], [126.5, z]); }

    const N    = positions.length;
    const m4   = new THREE.Matrix4();
    const poleH = 13;

    // Shared pole body instances
    const poleInst = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.13, 0.17, poleH, 6),
      this.mats.pole, N
    );
    const headInst = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1.4, 0.32, 0.5),
      this.mats.neonHead, N
    );

    positions.forEach(([x, z], i) => {
      m4.setPosition(x, poleH / 2, z);
      poleInst.setMatrixAt(i, m4);
      m4.setPosition(x, poleH + 0.16, z);
      headInst.setMatrixAt(i, m4);
    });
    poleInst.instanceMatrix.needsUpdate = true;
    headInst.instanceMatrix.needsUpdate = true;
    this.group.add(poleInst, headInst);
  }

  // ─── Strategic PointLights (5 total) ─────────────────────────────────────
  _buildLights() {
    const defs = [
      { x:   0, y: 22, z:  50, c: 0xffeedd, i: 4.0, d: 160 }, // main straight north
      { x:   0, y: 22, z: 140, c: 0xffeedd, i: 3.5, d: 150 }, // main straight south
      { x: 114, y: 22, z: 140, c: 0xffeedd, i: 4.0, d: 160 }, // back straight middle
      { x:  70, y: 22, z: 244, c: 0xffeedd, i: 3.0, d: 140 }, // Harmon Ave
      { x: 172, y: 35, z: 318, c: 0x6633ff, i: 5.0, d: 130 }, // MSG Sphere glow
    ];
    defs.forEach(d => {
      const l = new THREE.PointLight(d.c, d.i, d.d);
      l.position.set(d.x, d.y, d.z);
      this.group.add(l);
    });
    // Store last one for sphere color animation
    this._sphereLight = this.group.children[this.group.children.length - 1];
    this.anim.push({ type: 'sphereLight', mesh: this._sphereLight });
  }

  // ─── Neon billboard panels ────────────────────────────────────────────────
  _buildDecoNeon() {
    const colors = [0xff0066, 0x00ffcc, 0xff6600, 0x9900ff, 0x00ccff, 0xffee00];
    const slots = [
      [-8, 50, 5], [-8, 130, 5], [118, 100, 5], [118, 180, 5], [40, 238, 5], [90, 238, 4]
    ];
    slots.forEach(([x, z, h], i) => {
      const col = colors[i % colors.length];
      const w = 9;
      const frame = new THREE.Mesh(
        new THREE.BoxGeometry(w + 0.6, h + 0.6, 0.3),
        new THREE.MeshBasicMaterial({ color: col })
      );
      frame.position.set(x, 9 + h / 2, z);
      this.group.add(frame);

      const face = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.5 })
      );
      face.position.set(x, 9 + h / 2, z + 0.22);
      this.group.add(face);
      this.anim.push({ type: 'neon', mesh: face, phase: i * 1.05 });
    });
  }

  // ─── Strip road ───────────────────────────────────────────────────────────
  _buildStripRoad() {
    // Wide ground strip along the main straight (Las Vegas Blvd)
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(30, 300), this.mats.road);
    strip.rotation.x = -Math.PI / 2;
    strip.position.set(-2, 0.001, 90);
    this.group.add(strip);
  }

  // ─── Bridge supports (T6 flyover over Koval) ─────────────────────────────
  _buildBridgeSupports() {
    // Bridge goes from ~(138, 291) up to (126, 286)/(118, 278) and back down.
    // Place concrete pier columns + a girder deck underneath the apex.
    const matPier = new THREE.MeshStandardMaterial({ color: 0x555560, roughness: 0.9 });
    const matGirder = new THREE.MeshStandardMaterial({ color: 0x33333a, roughness: 0.8, metalness: 0.4 });

    // Pier column pairs straddle the bridge centreline (offset ≥ 3 so they
    // clear both the ~4-unit-wide deck and the Koval road below it).
    const piers = [
      { cx: 130, cz: 291, off: 3.2, h: 2.2, dir: 'x' },
      { cx: 124, cz: 283, off: 3.4, h: 2.8, dir: 'x' },
      { cx: 118, cz: 275, off: 3.3, h: 2.3, dir: 'x' },
    ];
    piers.forEach(p => {
      for (const s of [-1, 1]) {
        const dx = p.dir === 'x' ? s * p.off : 0;
        const dz = p.dir === 'x' ? 0         : s * p.off;
        const col = new THREE.Mesh(
          new THREE.BoxGeometry(0.9, p.h, 0.9),
          matPier
        );
        col.position.set(p.cx + dx, p.h / 2, p.cz + dz);
        this.group.add(col);
      }
      // Cross-brace girder tucked just under the deck span
      const girder = new THREE.Mesh(
        new THREE.BoxGeometry(p.off * 2 + 0.8, 0.35, 1.1),
        matGirder
      );
      girder.position.set(p.cx, p.h + 0.18, p.cz);
      this.group.add(girder);
    });

    // Warning chevron under the bridge (where Koval passes underneath)
    const warnMat = new THREE.MeshBasicMaterial({ color: 0xffcc00 });
    const warn = new THREE.Mesh(
      new THREE.PlaneGeometry(3, 0.7),
      warnMat
    );
    warn.rotation.x = -Math.PI / 2;
    warn.position.set(124, 0.02, 300);
    this.group.add(warn);
  }

  // ─── Pit building + garages (east side of main straight) ─────────────────
  _buildPitBuilding() {
    const baseX = 8;    // east of track (track at x=0)
    // Start at z=0 so pit wall doesn't intrude on T8 return (which sweeps
    // from [14,-10] through [6,-4] back to the start line at [0,0]).
    const z0 = 0, z1 = 110;      // length along main straight
    const len = z1 - z0;

    // Long pit wall (2 floors)
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xe8e8ee, roughness: 0.65 });
    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(6, 5, len),
      wallMat
    );
    wall.position.set(baseX + 4, 2.5, (z0 + z1) / 2);
    this.group.add(wall);

    // Roof with red stripe
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(6.8, 0.4, len),
      new THREE.MeshStandardMaterial({ color: 0xcc2222, roughness: 0.6 })
    );
    roof.position.set(baseX + 4, 5.2, (z0 + z1) / 2);
    this.group.add(roof);

    // Garage doors — one slot every 10 units, alternating team colors (InstancedMesh)
    const doorW = 5, doorH = 3;
    const teamCols = [0x1c2d5c, 0xcc0000, 0xff6b00, 0x00a38c, 0xd6c400, 0xaa00cc];
    const doorGeo = new THREE.BoxGeometry(0.15, doorH, doorW);
    const slots = Math.floor(len / 10);
    for (let i = 0; i < slots; i++) {
      const z = z0 + 5 + i * 10;
      const col = teamCols[i % teamCols.length];
      const door = new THREE.Mesh(
        doorGeo,
        new THREE.MeshStandardMaterial({
          color: col, roughness: 0.5, metalness: 0.3,
          emissive: col, emissiveIntensity: 0.15,
        })
      );
      door.position.set(baseX + 1.1, doorH / 2 + 0.2, z);
      this.group.add(door);
    }

    // Pit wall (low barrier between pit lane and track) with TV screens
    const pitWall = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 1.1, len),
      new THREE.MeshStandardMaterial({ color: 0x222233, roughness: 0.8 })
    );
    pitWall.position.set(baseX - 3.5, 0.55, (z0 + z1) / 2);
    this.group.add(pitWall);

    // Advertising panels on top of pit wall
    const adColors = [0xff0066, 0x00ccff, 0xffee00, 0x66ff33];
    for (let i = 0; i < 8; i++) {
      const z = z0 + 8 + i * 14;
      const col = adColors[i % adColors.length];
      const ad = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 1.0, 10),
        new THREE.MeshBasicMaterial({ color: col })
      );
      ad.position.set(baseX - 3.65, 1.6, z);
      this.group.add(ad);
    }
  }

  // ─── Start / finish overhead gantry ──────────────────────────────────────
  _buildStartGantry() {
    const matFrame = new THREE.MeshStandardMaterial({ color: 0x1a1a22, roughness: 0.6, metalness: 0.5 });
    // Vertical pylons either side of the track
    for (const sx of [-3.2, 3.2]) {
      const pylon = new THREE.Mesh(
        new THREE.BoxGeometry(0.7, 8, 0.7),
        matFrame
      );
      pylon.position.set(sx, 4, 2);
      this.group.add(pylon);
    }
    // Horizontal truss
    const truss = new THREE.Mesh(
      new THREE.BoxGeometry(7.5, 1.2, 1.2),
      matFrame
    );
    truss.position.set(0, 8.5, 2);
    this.group.add(truss);

    // "LAS VEGAS" banner face
    const c = document.createElement('canvas');
    c.width = 512; c.height = 96;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, 512, 96);
    ctx.fillStyle = '#e8c443';
    ctx.font = 'bold 52px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('LAS  VEGAS  GP', 256, 64);
    const banner = new THREE.Mesh(
      new THREE.PlaneGeometry(7.4, 1.1),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c) })
    );
    banner.position.set(0, 8.5, 1.39);
    this.group.add(banner);

    // Five start lights row (decorative — actual start-light uses DOM overlay)
    const lightGeo = new THREE.SphereGeometry(0.3, 10, 6);
    for (let i = 0; i < 5; i++) {
      const red = new THREE.Mesh(
        lightGeo,
        new THREE.MeshBasicMaterial({ color: 0x220000 })
      );
      red.position.set(-2 + i * 1, 7.3, 1.45);
      this.group.add(red);
    }
  }

  // ─── Grandstands ──────────────────────────────────────────────────────────
  _buildGrandstands() {
    // Each entry: (cx, cz, yaw, length along stand, rows)
    // yaw is rotation around Y; the stand's "front" (lowest row) faces -Z local
    // Default stand faces -Z (local); yaw rotates the whole stand around Y.
    // yaw = +π/2 makes it face -X (west)  | yaw = -π/2 → +X (east)
    // yaw = π            faces +Z (south) | yaw =   0  → -Z (north)
    const stands = [
      { x:  22, z:  50, yaw:  Math.PI / 2, len: 50, rows: 10, col: 0xcc1122 }, // east of main straight → faces west toward pit straight
      { x:  22, z: 130, yaw:  Math.PI / 2, len: 40, rows:  8, col: 0x1166cc }, // east of main straight (south end)
      { x:  75, z: 260, yaw:  0,           len: 34, rows:  8, col: 0xdd9900 }, // south of Harmon (inside loop) → faces north
      { x: 200, z: 318, yaw:  Math.PI / 2, len: 44, rows: 12, col: 0x9900cc }, // outside MSG Sphere hairpin → faces west
      { x: 130, z: 150, yaw:  Math.PI / 2, len: 46, rows:  9, col: 0x00aa66 }, // east of back straight → faces west
      { x:  50, z: -22, yaw:  Math.PI,     len: 34, rows:  7, col: 0xff6600 }, // north of NW curve → faces south toward track
    ];
    stands.forEach(s => this._buildOneGrandstand(s));
  }

  _buildOneGrandstand({ x, z, yaw, len, rows, col }) {
    const g = new THREE.Group();

    const stepDepth = 0.9, stepRise = 0.55;
    const stepMat = new THREE.MeshStandardMaterial({ color: 0x2a2a33, roughness: 0.95 });
    const seatMat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.7, emissive: col, emissiveIntensity: 0.1 });

    // Concrete substructure
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(len, 0.8, rows * stepDepth + 1),
      this.mats.concrete
    );
    base.position.set(0, 0.4, rows * stepDepth / 2);
    g.add(base);

    // Stepped rows — one Box per row (cheap, ~12 rows max)
    for (let r = 0; r < rows; r++) {
      const zLocal = 0.6 + r * stepDepth;
      const y = 0.8 + r * stepRise;
      const step = new THREE.Mesh(
        new THREE.BoxGeometry(len, stepRise, stepDepth),
        stepMat
      );
      step.position.set(0, y + stepRise / 2, zLocal);
      g.add(step);

      // Seat strip (colored band on top of step)
      const seat = new THREE.Mesh(
        new THREE.BoxGeometry(len - 0.6, 0.2, 0.35),
        seatMat
      );
      seat.position.set(0, y + stepRise + 0.1, zLocal - 0.25);
      g.add(seat);
    }

    // Crowd — instanced small boxes representing heads in the stands
    const crowdCount = rows * Math.floor(len / 1.2);
    const crowdGeo = new THREE.BoxGeometry(0.35, 0.5, 0.35);
    const crowdMat = new THREE.MeshStandardMaterial({ color: 0x333344, roughness: 0.8 });
    const crowd = new THREE.InstancedMesh(crowdGeo, crowdMat, crowdCount);
    const m4 = new THREE.Matrix4();
    const color = new THREE.Color();
    let ci = 0;
    for (let r = 0; r < rows; r++) {
      const zLocal = 0.6 + r * stepDepth - 0.1;
      const y = 0.8 + r * stepRise + stepRise + 0.35;
      const perRow = Math.floor(len / 1.2);
      for (let i = 0; i < perRow; i++) {
        const xLocal = -len / 2 + 0.6 + i * 1.2 + (Math.random() - 0.5) * 0.15;
        m4.setPosition(xLocal, y, zLocal + (Math.random() - 0.5) * 0.1);
        crowd.setMatrixAt(ci, m4);
        color.setHSL(Math.random(), 0.55, 0.45);
        crowd.setColorAt(ci, color);
        ci++;
      }
    }
    crowd.count = ci;
    crowd.instanceMatrix.needsUpdate = true;
    if (crowd.instanceColor) crowd.instanceColor.needsUpdate = true;
    g.add(crowd);

    // Canopy roof (shade) over top two-thirds of seating
    const roofDepth = rows * stepDepth * 0.7;
    const roofY = 0.8 + rows * stepRise + 1.8;
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(len + 1, 0.25, roofDepth),
      new THREE.MeshStandardMaterial({ color: 0x18181e, roughness: 0.8 })
    );
    roof.position.set(0, roofY, rows * stepDepth - roofDepth / 2 + 0.5);
    g.add(roof);

    // Red stripe along front edge of roof
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(len + 1.05, 0.32, 0.35),
      new THREE.MeshBasicMaterial({ color: col })
    );
    stripe.position.set(0, roofY, rows * stepDepth - roofDepth + 0.5);
    g.add(stripe);

    // Roof support pillars (4 along length)
    const pillarMat = this.mats.concrete;
    const pillarH = roofY;
    for (let i = 0; i < 4; i++) {
      const xL = -len / 2 + 1 + (i / 3) * (len - 2);
      const pillar = new THREE.Mesh(
        new THREE.BoxGeometry(0.35, pillarH, 0.35),
        pillarMat
      );
      pillar.position.set(xL, pillarH / 2, rows * stepDepth + 0.2);
      g.add(pillar);
    }

    g.position.set(x, 0, z);
    g.rotation.y = yaw;
    this.group.add(g);
  }

  // ─── Label sprite ─────────────────────────────────────────────────────────
  _label(text, x, y, z) {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 56;
    const ctx = c.getContext('2d');
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(2, 2, 252, 52);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 18px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(text, 128, 36);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true }));
    sp.position.set(x, y, z);
    sp.scale.set(14, 3, 1);
    this.group.add(sp);
  }

  // ─── Animation ────────────────────────────────────────────────────────────
  update(dt) {
    this.time += dt;
    const t = this.time;

    // LED sphere – update every 4th frame only
    if (this._ledCanvas && (Math.round(t * 60) % 4 === 0)) {
      this._drawLED(t);
    }

    this.anim.forEach(a => {
      switch (a.type) {
        case 'beacon':
          a.mesh.material.color.setHex(Math.sin(t * 2.8) > 0 ? 0xff2200 : 0x110000);
          break;
        case 'neon':
          a.mesh.material.opacity = 0.3 + 0.3 * Math.abs(Math.sin(t * 1.1 + a.phase));
          break;
        case 'water':
          a.mesh.material.opacity = 0.5 + 0.2 * Math.sin(t * 1.8);
          break;
        case 'fountain':
          a.jets.forEach((j, i) => {
            j.scale.y = 0.4 + 0.7 * Math.abs(Math.sin(t * 0.9 + i * 0.38));
            j.material.opacity = 0.3 + 0.45 * Math.abs(Math.sin(t * 1.1 + i * 0.5));
          });
          break;
        case 'sphereLight':
          a.mesh.color.setHSL((t * 0.04) % 1, 1, 0.55);
          a.mesh.intensity = 3.5 + 1.5 * Math.sin(t * 0.7);
          break;
      }
    });
  }

  // ─── Trackside advertising hoardings ──────────────────────────────────────
  _buildAdHoardings() {
    // Canvas atlas with 4 sponsor panels stacked vertically
    const c = document.createElement('canvas');
    c.width = 256; c.height = 256;
    const ctx = c.getContext('2d');
    const panels = [
      { bg: '#008844', fg: '#ffffff', text: 'Heineken' },
      { bg: '#ffcc00', fg: '#000000', text: 'PIRELLI' },
      { bg: '#003366', fg: '#ffffff', text: 'ROLEX' },
      { bg: '#cc0000', fg: '#ffffff', text: 'DHL' },
    ];
    panels.forEach((p, i) => {
      ctx.fillStyle = p.bg; ctx.fillRect(0, i * 64, 256, 64);
      ctx.fillStyle = p.fg;
      ctx.font = 'bold 42px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(p.text, 128, i * 64 + 32);
    });
    const tex = new THREE.CanvasTexture(c);
    const matAd = new THREE.MeshBasicMaterial({ map: tex });
    const matFrame = new THREE.MeshStandardMaterial({ color: 0x333340, roughness: 0.8 });

    // Positions: (x, z, yaw, faceIdx 0-3) — placed just outside barrier line
    // (trackWidthHalf=2 + kerb=0.25 + barrier=0.18 → ~2.6; use 3 for clearance)
    const spots = [];
    // Main straight east side (track at x=0, yaw so board faces west toward track)
    for (let z = 18; z <= 160; z += 24) spots.push({ x:  2.95, z, yaw: -Math.PI/2, face: (z/24|0) % 4 });
    // Main straight west side
    for (let z = 18; z <= 160; z += 24) spots.push({ x: -2.95, z, yaw:  Math.PI/2, face: ((z/24|0)+1) % 4 });
    // Back straight east side (track at x=114)
    for (let z = 50; z <= 190; z += 24) spots.push({ x: 116.95, z, yaw: -Math.PI/2, face: ((z/24|0)+2) % 4 });

    const boardW = 4, boardH = 1.3;
    const geo = new THREE.PlaneGeometry(boardW, boardH);
    const frameGeo = new THREE.BoxGeometry(boardW + 0.2, boardH + 0.2, 0.15);
    const instAd    = new THREE.InstancedMesh(geo,      matAd,    spots.length);
    const instFrame = new THREE.InstancedMesh(frameGeo, matFrame, spots.length);

    const m4 = new THREE.Matrix4();
    const pos = new THREE.Vector3(), q = new THREE.Quaternion(), scl = new THREE.Vector3(1,1,1);
    const yAxis = new THREE.Vector3(0, 1, 0);

    // Per-face UV remap through a dummy mesh: because InstancedMesh shares one
    // geometry, vary the panel by drawing 4 stripes and adjusting V offset via
    // geometry duplication would cost more.  Simpler: pick a single composite
    // texture with all 4 panels in a horizontal band and let yaw distribute.
    // (We accept that all boards show the full 4-panel atlas — still colourful.)

    spots.forEach((s, i) => {
      q.setFromAxisAngle(yAxis, s.yaw);
      pos.set(s.x, boardH / 2 + 0.8, s.z);
      m4.compose(pos, q, scl);
      instAd.setMatrixAt(i, m4);
      instFrame.setMatrixAt(i, m4);
    });
    instAd.instanceMatrix.needsUpdate = true;
    instFrame.instanceMatrix.needsUpdate = true;
    this.group.add(instFrame, instAd);
  }

  // ─── Tyre-barrier stacks at key apices ────────────────────────────────────
  _buildTyreStacks() {
    // Stack = 3 high × 3 deep cluster of tyres at each apex
    const matBlack = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.95 });
    const geo = new THREE.CylinderGeometry(0.35, 0.35, 0.28, 10);
    // Apex spots (just outside barrier line, trackside)
    const apices = [
      { x:  16,  z: 214, yaw:  0.6 },  // T1-T2 chicane exit
      { x: 186,  z: 320, yaw: -0.8 },  // MSG Sphere hairpin apex
      { x:   4,  z:  -6, yaw:  1.2 },  // T8 return
      { x: 110,  z:  18, yaw: -0.4 },  // T7 north
      { x: 148,  z: 336, yaw:  0.2 },  // Sphere approach
    ];
    const perStack = 3 * 3; // rows × columns
    const inst = new THREE.InstancedMesh(geo, matBlack, apices.length * perStack);
    const m4 = new THREE.Matrix4();
    const pos = new THREE.Vector3(), q = new THREE.Quaternion(), scl = new THREE.Vector3(1,1,1);
    const yAxis = new THREE.Vector3(0, 1, 0);
    let idx = 0;
    apices.forEach(a => {
      q.setFromAxisAngle(yAxis, a.yaw);
      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 3; col++) {
          const dx = (col - 1) * 0.75;
          const dz = row * 0.35;
          const y  = 0.14 + row * 0.28;
          // rotate offset by yaw
          const rx = dx * Math.cos(a.yaw) - dz * Math.sin(a.yaw);
          const rz = dx * Math.sin(a.yaw) + dz * Math.cos(a.yaw);
          pos.set(a.x + rx, y, a.z + rz);
          m4.compose(pos, q, scl);
          inst.setMatrixAt(idx++, m4);
        }
      }
    });
    inst.instanceMatrix.needsUpdate = true;
    this.group.add(inst);
  }

  // ─── Marshal posts (yellow-flag huts) ────────────────────────────────────
  _buildMarshalPosts() {
    if (!this.track) return;
    const count = 6;
    const step  = this.track.totalLength / count;
    // Hut = cube with sloped roof painted orange
    const matHut  = new THREE.MeshStandardMaterial({ color: 0xff7700, roughness: 0.7 });
    const matRoof = new THREE.MeshStandardMaterial({ color: 0x222233, roughness: 0.8 });
    const hutGeo  = new THREE.BoxGeometry(1.4, 1.4, 1.0);
    const roofGeo = new THREE.BoxGeometry(1.6, 0.15, 1.2);
    const instHut  = new THREE.InstancedMesh(hutGeo,  matHut,  count);
    const instRoof = new THREE.InstancedMesh(roofGeo, matRoof, count);

    const m4 = new THREE.Matrix4();
    const pos = new THREE.Vector3(), q = new THREE.Quaternion(), scl = new THREE.Vector3(1,1,1);
    const yAxis = new THREE.Vector3(0, 1, 0);
    const W = this.track.data.trackWidthHalf + this.track.data.kerbWidth + 1.2;

    for (let i = 0; i < count; i++) {
      const { point: p, tangent } = this.track._sampleAtArc(i * step);
      const right = new THREE.Vector3(tangent.z, 0, -tangent.x).normalize();
      const ang = Math.atan2(tangent.x, tangent.z);
      q.setFromAxisAngle(yAxis, ang);
      // Always on the outside-left (consistent with race-control side)
      pos.set(p.x - right.x * W, p.y + 0.7, p.z - right.z * W);
      m4.compose(pos, q, scl);
      instHut.setMatrixAt(i, m4);
      const pos2 = pos.clone(); pos2.y += 0.775;
      m4.compose(pos2, q, scl);
      instRoof.setMatrixAt(i, m4);
    }
    instHut.instanceMatrix.needsUpdate = true;
    instRoof.instanceMatrix.needsUpdate = true;
    this.group.add(instHut, instRoof);
  }

  // ─── Palm trees along the Strip ──────────────────────────────────────────
  _buildPalmTrees() {
    const trunks = [
      { x: -5, z:  25 }, { x: -5, z:  55 }, { x: -5, z:  85 },
      { x: -5, z: 115 }, { x: -5, z: 145 }, { x: -5, z: 175 },
    ];
    const matTrunk = new THREE.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 0.9 });
    const matFrond = new THREE.MeshBasicMaterial({ color: 0x2a7a2a });

    const trunkGeo = new THREE.CylinderGeometry(0.12, 0.18, 3.2, 6);
    const frondGeo = new THREE.ConeGeometry(1.1, 0.8, 6, 1, true);
    const instTrunk = new THREE.InstancedMesh(trunkGeo, matTrunk, trunks.length);
    const instFrond = new THREE.InstancedMesh(frondGeo, matFrond, trunks.length * 4);

    const m4 = new THREE.Matrix4();
    const pos = new THREE.Vector3(), q = new THREE.Quaternion(), scl = new THREE.Vector3(1,1,1);
    const axis = new THREE.Vector3(0, 1, 0);
    let fi = 0;

    trunks.forEach((t, i) => {
      pos.set(t.x, 1.6, t.z);
      q.setFromAxisAngle(axis, 0);
      m4.compose(pos, q, scl);
      instTrunk.setMatrixAt(i, m4);
      // 4 fronds radiating from the top
      for (let f = 0; f < 4; f++) {
        const a = (f / 4) * Math.PI * 2;
        pos.set(t.x + Math.cos(a) * 0.7, 3.3, t.z + Math.sin(a) * 0.7);
        // tilt the cone outward
        const tilt = new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(-Math.sin(a), 0, Math.cos(a)), 0.9
        );
        m4.compose(pos, tilt, scl);
        instFrond.setMatrixAt(fi++, m4);
      }
    });
    instTrunk.instanceMatrix.needsUpdate = true;
    instFrond.instanceMatrix.needsUpdate = true;
    this.group.add(instTrunk, instFrond);
  }
}
