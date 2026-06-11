// Buildings.js — Las Vegas night scenery: sky, city, landmarks, lamps.
// Static scenery is instanced/merged where possible; ~10 pooled PointLights
// follow the player to give the wet asphalt its specular streaks.

class Buildings {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.time = 0;
    this._lampTimer = 0;
    scene.add(this.group);
  }

  _tex(w, h, draw) {
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    draw(cv.getContext('2d'), w, h);
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  build(landmarks, track) {
    this.track = track;
    this._sky();
    this._ground();
    this._cityBlocks(track);
    this._streetLamps(track);
    this._palms(track);
    this._grandstands();
    this._searchlights();
    for (const lm of landmarks) {
      if (lm.type === 'sphere') this._msgSphere(lm);
      else if (lm.type === 'casino') this._casino(lm);
      else if (lm.type === 'eiffel') this._eiffel(lm);
      else if (lm.type === 'tower') this._strat(lm);
      else if (lm.type === 'pyramid') this._luxor(lm);
      else if (lm.type === 'wheel') this._highRoller(lm);
    }
  }

  // ════════ environment ════════
  _sky() {
    const tex = this._tex(64, 256, (c, w, h) => {
      const g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#04050d');
      g.addColorStop(0.55, '#0a0d22');
      g.addColorStop(0.82, '#2a1638');
      g.addColorStop(1, '#5a2a3c');     // city glow at the horizon
      c.fillStyle = g; c.fillRect(0, 0, w, h);
    });
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(900, 24, 12),
      new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false }));
    dome.position.y = -40;
    this.group.add(dome);

    // stars
    const N = 700, pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const a = Math.random() * Math.PI * 2, e = 0.15 + Math.random() * 1.3;
      const r = 820;
      pos[i * 3] = Math.cos(a) * Math.cos(e) * r;
      pos[i * 3 + 1] = Math.sin(e) * r - 40;
      pos[i * 3 + 2] = Math.sin(a) * Math.cos(e) * r;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const stars = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0x9aa6cc, size: 1.6, sizeAttenuation: false, fog: false }));
    this.group.add(stars);
  }

  _ground() {
    const tex = this._tex(512, 512, (c, w, h) => {
      c.fillStyle = '#0a0b10'; c.fillRect(0, 0, w, h);
      c.strokeStyle = '#181a26'; c.lineWidth = 3;
      for (let i = 0; i <= 4; i++) {
        c.beginPath(); c.moveTo(i * w / 4, 0); c.lineTo(i * w / 4, h); c.stroke();
        c.beginPath(); c.moveTo(0, i * h / 4); c.lineTo(w, i * h / 4); c.stroke();
      }
    });
    tex.repeat.set(60, 60);
    const g = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600),
      new THREE.MeshLambertMaterial({ map: tex, color: 0x666a78 }));
    g.rotation.x = -Math.PI / 2;
    g.position.set(80, -0.02, 30);
    this.group.add(g);
  }

  _windowTex(seed, tint = '#ffd9a0') {
    return this._tex(64, 128, (c, w, h) => {
      c.fillStyle = '#06070b'; c.fillRect(0, 0, w, h);
      const rnd = this._rng(seed);
      for (let y = 4; y < h - 6; y += 9) for (let x = 4; x < w - 6; x += 8) {
        if (rnd() < 0.55) {
          c.fillStyle = rnd() < 0.85 ? tint : '#9fd4ff';
          c.globalAlpha = 0.4 + rnd() * 0.6;
          c.fillRect(x, y, 5, 6);
        }
      }
      c.globalAlpha = 1;
    });
  }

  _rng(seed) {
    let s = seed >>> 0 || 1;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  }

  _cityBlocks(track) {
    const tex = this._windowTex(7);
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshLambertMaterial({ color: 0x14161f, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.85 });
    const COUNT = 150;
    const mesh = new THREE.InstancedMesh(geo, mat, COUNT);
    const dummy = new THREE.Object3D();
    const rnd = this._rng(42);
    let placed = 0, guard = 0;
    while (placed < COUNT && guard++ < 2000) {
      const x = -180 + rnd() * 480, z = -300 + rnd() * 620;
      const info = track.getTrackInfo(x, z);
      const dx = x - info.cx, dz = z - info.cz;
      if (dx * dx + dz * dz < 18 * 18) continue;          // keep clear of circuit
      const h = 4 + rnd() * rnd() * 30;
      dummy.position.set(x, h / 2, z);
      dummy.scale.set(4 + rnd() * 9, h, 4 + rnd() * 9);
      dummy.rotation.y = rnd() * Math.PI;
      dummy.updateMatrix();
      mesh.setMatrixAt(placed, dummy.matrix);
      placed++;
    }
    mesh.count = placed;
    mesh.instanceMatrix.needsUpdate = true;
    this.group.add(mesh);
  }

  _streetLamps(track) {
    this.lampHeads = [];
    const every = 36;                          // sample stride between lamps
    const N = track.samples.length;
    const count = Math.floor(N / every);
    const poleGeo = new THREE.CylinderGeometry(0.022, 0.03, 0.95, 6);
    const headGeo = new THREE.SphereGeometry(0.055, 8, 6);
    const poles = new THREE.InstancedMesh(poleGeo,
      new THREE.MeshLambertMaterial({ color: 0x2a2e38 }), count);
    const heads = new THREE.InstancedMesh(headGeo,
      new THREE.MeshBasicMaterial({ color: 0xffe3b0 }), count);
    const dummy = new THREE.Object3D();
    for (let k = 0; k < count; k++) {
      const s = track.samples[(k * every) % N];
      const t = s.cum / track.lengthU;
      const side = k % 2 === 0 ? 1 : -1;
      const off = (track.wallHalfAt(t) + 0.45) * side;
      const x = s.x + s.nx * off, z = s.z + s.nz * off;
      dummy.position.set(x, 0.475, z);
      dummy.rotation.y = 0; dummy.scale.set(1, 1, 1);
      dummy.updateMatrix(); poles.setMatrixAt(k, dummy.matrix);
      dummy.position.set(x, 0.97, z);
      dummy.updateMatrix(); heads.setMatrixAt(k, dummy.matrix);
      this.lampHeads.push({ x, y: 0.95, z });
    }
    this.group.add(poles, heads);

    // pooled real lights — repositioned near the player in update()
    this.poolLights = [];
    for (let i = 0; i < 10; i++) {
      const L = new THREE.PointLight(0xffdfa8, 2.4, 11, 2);
      L.position.set(0, 1.0, i * 4);
      this.group.add(L);
      this.poolLights.push(L);
    }
  }

  _palms(track) {
    // palms flanking the Strip straight (x = 0, z -40..135)
    const spots = [];
    for (let z = -40; z < 135; z += 9) {
      spots.push([-3.4 - Math.random(), z + Math.random() * 2]);
      spots.push([3.4 + Math.random(), z + Math.random() * 2]);
    }
    const trunkGeo = new THREE.CylinderGeometry(0.035, 0.055, 1.0, 5);
    const frondGeo = new THREE.ConeGeometry(0.42, 0.34, 7);
    const trunks = new THREE.InstancedMesh(trunkGeo,
      new THREE.MeshLambertMaterial({ color: 0x4a3b28 }), spots.length);
    const fronds = new THREE.InstancedMesh(frondGeo,
      new THREE.MeshLambertMaterial({ color: 0x1d4d28 }), spots.length);
    const dummy = new THREE.Object3D();
    spots.forEach(([x, z], i) => {
      const h = 0.85 + Math.random() * 0.45;
      dummy.position.set(x, h / 2, z); dummy.scale.set(1, h, 1);
      dummy.rotation.y = Math.random() * Math.PI;
      dummy.updateMatrix(); trunks.setMatrixAt(i, dummy.matrix);
      dummy.position.set(x, h + 0.12, z); dummy.scale.set(1, 1, 1);
      dummy.updateMatrix(); fronds.setMatrixAt(i, dummy.matrix);
    });
    this.group.add(trunks, fronds);
  }

  _grandstands() {
    const crowd = this._tex(256, 64, (c, w, h) => {
      c.fillStyle = '#101218'; c.fillRect(0, 0, w, h);
      const cols = ['#c33', '#36c', '#dc3', '#3a3', '#caa', '#a5c'];
      for (let i = 0; i < 1100; i++) {
        c.fillStyle = cols[(Math.random() * cols.length) | 0];
        c.fillRect(Math.random() * w, Math.random() * h, 2, 2.5);
      }
    });
    const mat = new THREE.MeshLambertMaterial({ map: crowd, emissive: 0x555560, emissiveMap: crowd, emissiveIntensity: 0.55 });
    const frame = new THREE.MeshLambertMaterial({ color: 0x1c2026 });
    // [x, z, length, rotY] — along the Strip, at T1, on Koval
    [[-4.5, 80, 30, 0], [-4.5, 40, 30, 0], [14, 167, 18, Math.PI / 2 + 0.45], [132.5, 60, 26, Math.PI]].forEach(([x, z, len, rot]) => {
      const g = new THREE.Group();
      const base = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.1, len), frame);
      base.position.y = 0.05; g.add(base);
      const tier = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.0, len), mat);
      tier.position.set(-0.4, 0.55, 0);
      tier.rotation.z = 0.42;
      g.add(tier);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.06, len), frame);
      roof.position.set(-0.7, 1.35, 0); g.add(roof);
      g.position.set(x, 0, z); g.rotation.y = rot;
      this.group.add(g);
    });
  }

  _searchlights() {
    this.beams = [];
    const geo = new THREE.CylinderGeometry(0.18, 1.6, 38, 10, 1, true);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x86b6ff, transparent: true, opacity: 0.07,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false, fog: false });
    [[-30, 0], [40, 110], [120, -110], [190, -40], [-40, 180]].forEach(([x, z], i) => {
      const beam = new THREE.Mesh(geo, mat);
      beam.position.set(x, 19, z);
      beam.rotation.set(0.45, i * 1.3, 0);
      this.group.add(beam);
      this.beams.push({ mesh: beam, speed: 0.12 + i * 0.05, phase: i * 1.7 });
    });
  }

  // ════════ landmarks ════════
  _msgSphere(lm) {
    this.sphereCanvas = document.createElement('canvas');
    this.sphereCanvas.width = 128; this.sphereCanvas.height = 64;
    this.sphereCtx = this.sphereCanvas.getContext('2d');
    this.sphereTex = new THREE.CanvasTexture(this.sphereCanvas);
    this._drawSphereFrame(0);
    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(lm.r, 36, 24),
      new THREE.MeshBasicMaterial({ map: this.sphereTex }));
    ball.position.set(lm.x, lm.r * 0.82, lm.z);
    this.group.add(ball);
    this.sphereMode = 0;
  }

  _drawSphereFrame(t) {
    const c = this.sphereCtx, w = 128, h = 64;
    const mode = Math.floor(t / 7) % 3;
    c.fillStyle = '#020208'; c.fillRect(0, 0, w, h);
    if (mode === 0) {
      // pulsing concentric rings
      for (let r = 7; r >= 0; r--) {
        const hue = (t * 40 + r * 38) % 360;
        c.fillStyle = `hsl(${hue},95%,${28 + r * 5}%)`;
        c.beginPath();
        c.ellipse(w / 2, h / 2, (r + 1) * 8 + Math.sin(t * 2.2) * 4, ((r + 1) * 8 + Math.sin(t * 2.2) * 4) / 2, 0, 0, Math.PI * 2);
        c.fill();
      }
    } else if (mode === 1) {
      // the eye
      c.fillStyle = '#dfe8f2';
      c.beginPath(); c.ellipse(w / 2, h / 2, 44, 26, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#2c8fe0';
      c.beginPath(); c.arc(w / 2 + Math.sin(t * 0.9) * 12, h / 2, 15, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#06070d';
      c.beginPath(); c.arc(w / 2 + Math.sin(t * 0.9) * 12, h / 2, 7, 0, Math.PI * 2); c.fill();
    } else {
      // checker sweep
      const sz = 16, off = (t * 30) % (sz * 2);
      for (let y = 0; y < h; y += sz) for (let x = -sz * 2; x < w; x += sz) {
        const hue = (x * 2 + t * 60) % 360;
        c.fillStyle = ((x / sz + y / sz) | 0) % 2 ? `hsl(${hue},90%,45%)` : '#0a0a12';
        c.fillRect(x + off, y, sz, sz);
      }
    }
    this.sphereTex.needsUpdate = true;
  }

  _casino(lm) {
    const tex = this._windowTex(lm.x * 31 + lm.z * 7);
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(lm.w, lm.h, lm.d),
      new THREE.MeshLambertMaterial({
        color: new THREE.Color(lm.color).multiplyScalar(0.16),
        emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.9 }));
    body.position.set(lm.x, lm.h / 2, lm.z);
    this.group.add(body);

    // rooftop accent strip
    const strip = new THREE.Mesh(
      new THREE.BoxGeometry(lm.w + 0.3, 0.25, lm.d + 0.3),
      new THREE.MeshBasicMaterial({ color: lm.color }));
    strip.position.set(lm.x, lm.h + 0.1, lm.z);
    this.group.add(strip);

    if (lm.sign) this._neonSign(lm.sign, lm.x, lm.h + 2.2, lm.z, lm.color);
    if (lm.fountain) this._fountain(lm.x + lm.w / 2 + 5, lm.z);
  }

  _neonSign(text, x, y, z, color) {
    const col = '#' + new THREE.Color(color).getHexString();
    const tex = this._tex(512, 96, (c, w, h) => {
      c.clearRect(0, 0, w, h);
      c.font = 'bold 56px Arial';
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.shadowColor = col; c.shadowBlur = 22;
      c.fillStyle = '#fff';
      c.fillText(text, w / 2, h / 2);
      c.shadowBlur = 0;
      c.strokeStyle = col; c.lineWidth = 2;
      c.strokeText(text, w / 2, h / 2);
    });
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, fog: false }));
    sp.scale.set(11, 2.1, 1);
    sp.position.set(x, y, z);
    this.group.add(sp);
  }

  _fountain(x, z) {
    this.fountainJets = this.fountainJets || [];
    const pool = new THREE.Mesh(new THREE.CircleGeometry(3.2, 20),
      new THREE.MeshStandardMaterial({ color: 0x16324a, roughness: 0.15, metalness: 0.7 }));
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(x, 0.01, z);
    this.group.add(pool);
    const jetMat = new THREE.MeshBasicMaterial({
      color: 0xbfe8ff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false });
    for (let i = 0; i < 7; i++) {
      const jet = new THREE.Mesh(new THREE.ConeGeometry(0.09, 1, 6), jetMat);
      jet.position.set(x - 2.2 + i * 0.75, 0.5, z);
      this.group.add(jet);
      this.fountainJets.push({ mesh: jet, phase: i * 0.9 });
    }
  }

  _eiffel(lm) {
    const mat = new THREE.MeshLambertMaterial({ color: 0x6b5638, emissive: 0xc89a4a, emissiveIntensity: 0.5 });
    const g = new THREE.Group();
    const tiers = [[3.2, 0.30], [2.2, 0.55], [1.2, 0.78]];
    tiers.forEach(([w, yF]) => {
      const t = new THREE.Mesh(new THREE.BoxGeometry(w, 0.18, w), mat);
      t.position.y = lm.h * yF;
      g.add(t);
    });
    const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 1.6, lm.h, 4, 1, true), mat);
    spire.position.y = lm.h / 2;
    g.add(spire);
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.09, lm.h * 0.22, 4), mat);
    tip.position.y = lm.h * 1.08;
    g.add(tip);
    g.position.set(lm.x, 0, lm.z);
    this.group.add(g);
  }

  _strat(lm) {
    const g = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.6, lm.h, 8),
      new THREE.MeshLambertMaterial({ color: 0x232733 }));
    shaft.position.y = lm.h / 2; g.add(shaft);
    const pod = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 2.4, 4.5, 12),
      new THREE.MeshLambertMaterial({ color: 0x2a2f3d, emissive: 0xff4444, emissiveIntensity: 0.25 }));
    pod.position.y = lm.h + 2; g.add(pod);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.0, 0.14, 6, 20),
      new THREE.MeshBasicMaterial({ color: 0xff3344 }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = lm.h + 4.2; g.add(ring);
    const needle = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.18, 9, 6),
      new THREE.MeshLambertMaterial({ color: 0x333a48 }));
    needle.position.y = lm.h + 8.5; g.add(needle);
    g.position.set(lm.x, 0, lm.z);
    this.group.add(g);
  }

  _luxor(lm) {
    const pyr = new THREE.Mesh(new THREE.ConeGeometry(lm.size * 0.7, lm.size * 0.8, 4),
      new THREE.MeshLambertMaterial({ color: 0x16140e, emissive: 0x86641e, emissiveIntensity: 0.35 }));
    pyr.position.set(lm.x, lm.size * 0.4, lm.z);
    pyr.rotation.y = Math.PI / 4;
    this.group.add(pyr);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.9, 130, 8, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xfff2c0, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    beam.position.set(lm.x, lm.size * 0.8 + 60, lm.z);
    this.group.add(beam);
  }

  _highRoller(lm) {
    const g = new THREE.Group();
    const rim = new THREE.Mesh(new THREE.TorusGeometry(lm.r, 0.18, 8, 40),
      new THREE.MeshBasicMaterial({ color: 0xc23cff }));
    g.add(rim);
    const spokeMat = new THREE.MeshLambertMaterial({ color: 0x3a3f4c });
    for (let i = 0; i < 8; i++) {
      const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, lm.r * 2, 4), spokeMat);
      sp.rotation.z = i * Math.PI / 8;
      g.add(sp);
    }
    const cabGeo = new THREE.SphereGeometry(0.5, 8, 6);
    const cabs = new THREE.InstancedMesh(cabGeo,
      new THREE.MeshBasicMaterial({ color: 0xe8f4ff }), 14);
    g.add(cabs);
    this._wheelCabs = cabs;
    // support legs
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, lm.r + 2, 6), spokeMat);
    leg.position.set(0, -(lm.r + 2) / 2 + 0.5, 0);
    leg.rotation.x = 0.0;
    g.position.set(lm.x, lm.r + 2, lm.z);
    g.rotation.y = Math.PI / 2;        // face the Strip
    this.group.add(g);
    const legW = leg.clone(); legW.position.set(lm.x, (lm.r + 2) / 2, lm.z + 1.5); legW.rotation.x = 0.12;
    const legE = leg.clone(); legE.position.set(lm.x, (lm.r + 2) / 2, lm.z - 1.5); legE.rotation.x = -0.12;
    this.group.add(legW, legE);
    this.wheel = { group: g, r: lm.r };
  }

  // ════════ per-frame ════════
  update(dt, playerPos) {
    this.time += dt;
    const t = this.time;

    // animated Sphere screen (~8 fps is plenty)
    if (this.sphereCtx && (this._sphereFrame = (this._sphereFrame || 0) + dt) > 0.12) {
      this._sphereFrame = 0;
      this._drawSphereFrame(t);
    }
    // searchlights sweep
    if (this.beams) for (const b of this.beams) {
      b.mesh.rotation.y = b.phase + t * b.speed * 4;
      b.mesh.rotation.x = 0.42 + Math.sin(t * b.speed * 3) * 0.18;
    }
    // High Roller rotation + cabins
    if (this.wheel && this._wheelCabs) {
      this.wheel.group.rotation.x += dt * 0.04;
      const dummy = new THREE.Object3D();
      for (let i = 0; i < 14; i++) {
        const a = i / 14 * Math.PI * 2 + this.wheel.group.rotation.x;
        dummy.position.set(0, Math.cos(a) * this.wheel.r, Math.sin(a) * this.wheel.r);
        dummy.rotation.x = -this.wheel.group.rotation.x;
        dummy.updateMatrix();
        this._wheelCabs.setMatrixAt(i, dummy.matrix);
      }
      this._wheelCabs.instanceMatrix.needsUpdate = true;
    }
    // fountain jets
    if (this.fountainJets) for (const j of this.fountainJets) {
      const s = 0.6 + Math.abs(Math.sin(t * 1.4 + j.phase)) * 1.7;
      j.mesh.scale.y = s;
      j.mesh.position.y = s / 2;
    }
    // pooled street lights follow the player
    if (playerPos && this.poolLights && (this._lampTimer -= dt) <= 0) {
      this._lampTimer = 0.4;
      const sorted = this.lampHeads
        .map(l => ({ l, d: (l.x - playerPos.x) ** 2 + (l.z - playerPos.z) ** 2 }))
        .sort((a, b) => a.d - b.d)
        .slice(0, this.poolLights.length);
      sorted.forEach((s, i) => this.poolLights[i].position.set(s.l.x, s.l.y, s.l.z));
    }
  }

  dispose() {
    this.scene.remove(this.group);
  }
}
