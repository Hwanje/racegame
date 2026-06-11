// Track.js — circuit geometry, surface queries, racing line & speed profile.
// All world distances are game units (1 u = 8 m); speeds are m/s.

const TRACK_SAMPLES = 2400;

class Track {
  constructor(scene, data) {
    this.scene = scene;
    this.data = data;
    this.meshes = [];

    this._buildSamples();
    this._buildSpatialHash();
    this._resolveZones();
    this._buildRacingLine();
    this._buildSpeedProfile();

    if (scene) {
      this._texCache = {};
      this._buildRoad();
      this._buildKerbs();
      this._buildWalls();
      this._buildRunoffPatches();
      this._buildStartFinish();
      this._buildGridSlots();
      this._buildDrsBoards();
      this._buildPitLane();
    }
  }

  // ════════ centerline sampling ════════
  _buildSamples() {
    const pts = this.data.waypoints.map(([x, z]) => new THREE.Vector3(x, 0, z));
    this.curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal', 0.5);

    const N = TRACK_SAMPLES;
    const raw = [];
    for (let i = 0; i < N; i++) raw.push(this.curve.getPoint(i / N));

    this.samples = [];
    let cum = 0;
    for (let i = 0; i < N; i++) {
      const p = raw[i], q = raw[(i + 1) % N], o = raw[(i - 1 + N) % N];
      let tx = q.x - o.x, tz = q.z - o.z;
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl; tz /= tl;
      if (i > 0) cum += Math.hypot(p.x - raw[i - 1].x, p.z - raw[i - 1].z);
      this.samples.push({ x: p.x, z: p.z, tx, tz, nx: -tz, nz: tx, curv: 0, cum });
    }
    this.lengthU = cum + Math.hypot(raw[0].x - raw[N - 1].x, raw[0].z - raw[N - 1].z);
    this.lengthM = this.lengthU * SCALE;

    // CatmullRom parameter is NOT arc length (waypoint spacing varies), so
    // build an arc-length-t → sample-index lookup table.
    const M = this._lutM = 4096;
    this.idxLUT = new Uint16Array(M);
    let j = 0;
    for (let k = 0; k < M; k++) {
      const target = (k / M) * this.lengthU;
      while (j < N - 1 && this.samples[j + 1].cum <= target) j++;
      this.idxLUT[k] = j;
    }

    // signed curvature (1/units) from tangent rotation rate, then smooth
    const curv = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = this.samples[i], b = this.samples[(i + 1) % N];
      const cross = a.tx * b.tz - a.tz * b.tx;
      const dot = a.tx * b.tx + a.tz * b.tz;
      const dAng = Math.atan2(cross, Math.max(dot, 1e-6));
      const ds = this._ds(i);
      curv[i] = dAng / Math.max(ds, 1e-6);
    }
    const sm = this._smoothWrap(curv, 9);
    for (let i = 0; i < N; i++) this.samples[i].curv = sm[i];
    this.curvSmooth = this._smoothWrap(curv, 61); // wide window for racing line
  }

  _ds(i) {
    const N = this.samples.length;
    const a = this.samples[i], b = this.samples[(i + 1) % N];
    return Math.hypot(b.x - a.x, b.z - a.z) || this.lengthU / N;
  }

  _smoothWrap(arr, win) {
    const N = arr.length, half = win >> 1, out = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      let s = 0;
      for (let j = -half; j <= half; j++) s += arr[(i + j + N) % N];
      out[i] = s / win;
    }
    return out;
  }

  // ════════ spatial hash for nearest-sample lookup ════════
  _buildSpatialHash() {
    this.cellSize = 6;
    this.hash = new Map();
    this.samples.forEach((s, i) => {
      const key = `${Math.floor(s.x / this.cellSize)},${Math.floor(s.z / this.cellSize)}`;
      if (!this.hash.has(key)) this.hash.set(key, []);
      this.hash.get(key).push(i);
    });
  }

  // Surface & lateral info at world (x, z)
  getTrackInfo(x, z) {
    const cs = this.cellSize;
    const cx = Math.floor(x / cs), cz = Math.floor(z / cs);
    let best = -1, bestD2 = Infinity;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const list = this.hash.get(`${cx + i},${cz + j}`);
      if (!list) continue;
      for (const idx of list) {
        const s = this.samples[idx];
        const d2 = (s.x - x) ** 2 + (s.z - z) ** 2;
        if (d2 < bestD2) { bestD2 = d2; best = idx; }
      }
    }
    if (best < 0) { // far off track — coarse global scan
      for (let idx = 0; idx < this.samples.length; idx += 12) {
        const s = this.samples[idx];
        const d2 = (s.x - x) ** 2 + (s.z - z) ** 2;
        if (d2 < bestD2) { bestD2 = d2; best = idx; }
      }
    }
    const s = this.samples[best];
    const dx = x - s.x, dz = z - s.z;
    const lateral = dx * s.nx + dz * s.nz;             // signed, units
    const along = dx * s.tx + dz * s.tz;
    let t = (s.cum + along) / this.lengthU;
    t = ((t % 1) + 1) % 1;

    const aL = Math.abs(lateral);
    const D = this.data;
    const wallHalf = this.wallHalfAt(t);
    let surface;
    if (aL <= D.widthHalf) surface = 'tarmac';
    else if (aL <= D.widthHalf + D.kerbWidth) surface = 'kerb';
    else surface = 'runoff';

    return {
      t, idx: best, lateral, absLateral: aL, surface, wallHalf,
      curvature: s.curv,
      tangentAngle: Math.atan2(s.tx, s.tz), // matches heading convention fwd=(sin,cos)
      nx: s.nx, nz: s.nz, cx: s.x, cz: s.z,
    };
  }

  wallHalfAt(t) {
    const D = this.data;
    let w = D.widthHalf + D.kerbWidth + D.wallOffset;
    for (const z of this._runoffT) {
      if (this._inRange(t, z.from, z.to)) w = Math.max(w, D.widthHalf + D.kerbWidth + z.extra);
    }
    return w;
  }

  // ════════ zones (waypoint indices → t ranges) ════════
  tFromWp(wpIdx) {
    const [wx, wz] = this.data.waypoints[wpIdx];
    let best = 0, bd = Infinity;
    for (let i = 0; i < this.samples.length; i++) {
      const s = this.samples[i];
      const d = (s.x - wx) ** 2 + (s.z - wz) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    return this.samples[best].cum / this.lengthU;
  }

  _resolveZones() {
    this._drsT = this.data.drsZones.map(z => ({ name: z.name, from: this.tFromWp(z.fromWp), to: this.tFromWp(z.toWp) }));
    this._runoffT = (this.data.runoffZones || []).map(z => ({ from: this.tFromWp(z.fromWp), to: this.tFromWp(z.toWp), extra: z.extra }));
  }

  _inRange(t, from, to) {
    return from <= to ? (t >= from && t <= to) : (t >= from || t <= to);
  }

  inDrs(t) { return this._drsT.some(z => this._inRange(t, z.from, z.to)); }

  // ════════ racing line (offset from center) + speed profile ════════
  _buildRacingLine() {
    const N = this.samples.length;
    const maxOff = Math.max(0.15, this.data.widthHalf - 0.30);
    const kMax = 0.075; // curvature mapped to full offset

    const buildOffsets = (sign) => {
      const off = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        off[i] = sign * THREE.MathUtils.clamp(this.curvSmooth[i] / kMax, -1, 1) * maxOff;
      }
      return this._smoothWrap(off, 41);
    };
    const lineCurvSq = (off) => {
      // curvature energy of the offset polyline
      const px = [], pz = [];
      for (let i = 0; i < N; i += 4) {
        const s = this.samples[i];
        px.push(s.x + s.nx * off[i]); pz.push(s.z + s.nz * off[i]);
      }
      const M = px.length;
      let sum = 0;
      for (let i = 0; i < M; i++) {
        const ax = px[(i + 1) % M] - px[i], az = pz[(i + 1) % M] - pz[i];
        const bx = px[(i + 2) % M] - px[(i + 1) % M], bz = pz[(i + 2) % M] - pz[(i + 1) % M];
        const la = Math.hypot(ax, az) || 1, lb = Math.hypot(bx, bz) || 1;
        const ang = Math.atan2(ax / la * bz / lb - az / la * bx / lb, (ax * bx + az * bz) / (la * lb));
        sum += Math.pow(ang / la, 2);
      }
      return sum;
    };
    // auto-pick offset direction: the racing line must REDUCE curvature
    const offA = buildOffsets(1), offB = buildOffsets(-1);
    this.lineOffset = lineCurvSq(offA) < lineCurvSq(offB) ? offA : offB;

    this.linePts = [];
    for (let i = 0; i < N; i++) {
      const s = this.samples[i];
      this.linePts.push({ x: s.x + s.nx * this.lineOffset[i], z: s.z + s.nz * this.lineOffset[i] });
    }
    // curvature of the racing line itself (1/units)
    const lc = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = this.linePts[(i - 1 + N) % N], b = this.linePts[i], c = this.linePts[(i + 1) % N];
      const ax = b.x - a.x, az = b.z - a.z, bx = c.x - b.x, bz = c.z - b.z;
      const la = Math.hypot(ax, az) || 1e-6, lb = Math.hypot(bx, bz) || 1e-6;
      const ang = Math.atan2((ax * bz - az * bx) / (la * lb), (ax * bx + az * bz) / (la * lb));
      lc[i] = ang / ((la + lb) / 2);
    }
    this.lineCurv = this._smoothWrap(lc, 15);
  }

  _buildSpeedProfile() {
    const N = this.samples.length;
    const v = new Float32Array(N);
    const vTop = PHYS.maxSpeed * 1.02;
    const aLat = (s) => PHYS.gripBase * Math.min(1 + PHYS.downforceK * s * s, PHYS.downforceMax) * 0.95;
    const aBrk = (s) => Math.min(PHYS.maxBrake, aLat(s) * 1.02) * 0.90;
    const aAcc = (s) => {
      const power = PHYS.enginePower * PHYS.drivelineEff / (PHYS.mass * Math.max(s, 6));
      return Math.min(power, PHYS.gripBase * PHYS.launchTraction) * 0.95 -
             PHYS.dragCoeff * s * s - PHYS.rollResist;
    };
    // corner-limited speed: v² = aLat(v)·R, fixed-point iterate
    for (let i = 0; i < N; i++) {
      const R = SCALE / Math.max(Math.abs(this.lineCurv[i]), 1e-5); // metres
      let s = 60;
      for (let k = 0; k < 5; k++) s = Math.min(vTop, Math.sqrt(aLat(s) * R));
      v[i] = s;
    }
    // backward pass — braking limits (two wraps to settle the seam)
    for (let pass = 0; pass < 2; pass++) {
      for (let i = N - 1; i >= 0; i--) {
        const nxt = v[(i + 1) % N];
        const ds = this._ds(i) * SCALE;
        v[i] = Math.min(v[i], Math.sqrt(nxt * nxt + 2 * aBrk(nxt) * ds));
      }
    }
    // forward pass — acceleration limits
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < N; i++) {
        const prv = v[(i - 1 + N) % N];
        const ds = this._ds((i - 1 + N) % N) * SCALE;
        v[i] = Math.min(v[i], Math.sqrt(prv * prv + 2 * Math.max(aAcc(prv), 0.5) * ds));
      }
    }
    this.lineSpeed = v;
    // ideal lap estimate (s)
    let lap = 0;
    for (let i = 0; i < N; i++) lap += (this._ds(i) * SCALE) / Math.max(v[i], 5);
    this.idealLap = lap;
  }

  // sampled accessors (t = arc-length fraction 0..1)
  _idxAt(t) {
    t = ((t % 1) + 1) % 1;
    return this.idxLUT[Math.min(this._lutM - 1, Math.floor(t * this._lutM))];
  }
  posAt(t) { return this.samples[this._idxAt(t)]; }
  linePointAt(t) { return this.linePts[this._idxAt(t)]; }
  lineSpeedAt(t) { return this.lineSpeed[this._idxAt(t)]; }
  lineOffsetAt(t) { return this.lineOffset[this._idxAt(t)]; }

  // ════════ meshes ════════
  _canvasTex(key, w, h, draw, repX = 1, repY = 1) {
    if (this._texCache[key]) return this._texCache[key];
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    draw(cv.getContext('2d'), w, h);
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repX, repY);
    tex.anisotropy = 4;
    this._texCache[key] = tex;
    return tex;
  }

  // Generic ribbon between lateral offsets [latA, latB] (units)
  _ribbon(latA, latB, y, material, step = 4, vScale = 0.35) {
    const N = this.samples.length;
    const segs = Math.floor(N / step);
    const pos = [], uv = [], idx = [];
    for (let k = 0; k <= segs; k++) {
      const i = (k * step) % N;
      const s = this.samples[i];
      pos.push(s.x + s.nx * latA, y, s.z + s.nz * latA);
      pos.push(s.x + s.nx * latB, y, s.z + s.nz * latB);
      const vv = (k === segs ? this.lengthU : s.cum) * vScale;
      uv.push(0, vv, 1, vv);
      if (k < segs) {
        const o = k * 2;
        idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, material);
    this.scene.add(mesh);
    this.meshes.push(mesh);
    return mesh;
  }

  _buildRoad() {
    const tex = this._canvasTex('asphalt', 256, 256, (c, w, h) => {
      c.fillStyle = '#1d1f24'; c.fillRect(0, 0, w, h);
      for (let i = 0; i < 1600; i++) {
        const g = 22 + Math.random() * 26;
        c.fillStyle = `rgb(${g},${g + 2},${g + 7})`;
        c.fillRect(Math.random() * w, Math.random() * h, 1.6, 1.6);
      }
      // racing groove (darker band, slightly off-center)
      const grad = c.createLinearGradient(0, 0, w, 0);
      grad.addColorStop(0, 'rgba(0,0,0,0)'); grad.addColorStop(0.34, 'rgba(0,0,0,0.36)');
      grad.addColorStop(0.62, 'rgba(0,0,0,0.36)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = grad; c.fillRect(0, 0, w, h);
      // edge lines
      c.fillStyle = '#e8e8ee';
      c.fillRect(3, 0, 5, h); c.fillRect(w - 8, 0, 5, h);
    });
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.42, metalness: 0.42, color: 0xb9c0cc });
    const W = this.data.widthHalf;
    this._ribbon(-W, W, 0, mat, 3, 0.5);
  }

  _buildKerbs() {
    const tex = this._canvasTex('kerb', 64, 128, (c, w, h) => {
      c.fillStyle = '#d8202a'; c.fillRect(0, 0, w, h / 2);
      c.fillStyle = '#e9e9ec'; c.fillRect(0, h / 2, w, h / 2);
    });
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, metalness: 0.15 });
    const W = this.data.widthHalf, K = this.data.kerbWidth;
    this._ribbon(W, W + K, 0.013, mat, 4, 0.9);
    this._ribbon(-W - K, -W, 0.013, mat, 4, 0.9);
  }

  _buildWalls() {
    const tex = this._canvasTex('wall', 512, 64, (c, w, h) => {
      c.fillStyle = '#2c3038'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#454c58'; c.fillRect(0, 0, w, 14);
      c.fillStyle = '#c4cad4'; c.fillRect(0, 22, w, 18);
      c.fillStyle = '#b01020';
      for (let x = 0; x < w; x += 128) c.fillRect(x, 22, 64, 18);
      c.fillStyle = '#0b0d12'; c.fillRect(0, h - 12, w, 12);
    });
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, metalness: 0.2, side: THREE.DoubleSide });

    const N = this.samples.length, step = 4, H = 0.22;
    [1, -1].forEach(side => {
      const pos = [], uv = [], idx = [];
      const segs = Math.floor(N / step);
      for (let k = 0; k <= segs; k++) {
        const i = (k * step) % N;
        const s = this.samples[i];
        const t = s.cum / this.lengthU;
        const w = this.wallHalfAt(t) * side;
        pos.push(s.x + s.nx * w, 0, s.z + s.nz * w);
        pos.push(s.x + s.nx * w, H, s.z + s.nz * w);
        const vv = (k === segs ? this.lengthU : s.cum) * 0.25;
        uv.push(vv, 0, vv, 1);
        if (k < segs) { const o = k * 2; idx.push(o, o + 2, o + 1, o + 1, o + 2, o + 3); }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, mat);
      this.scene.add(mesh); this.meshes.push(mesh);

      // neon strip along wall top — vertex-coloured, Vegas palette
      const npos = [], ncol = [], nidx = [];
      const palette = [[0.1, 0.9, 1], [1, 0.2, 0.8], [1, 0.7, 0.1], [0.4, 0.4, 1]];
      for (let k = 0; k <= segs; k++) {
        const i = (k * step) % N;
        const s = this.samples[i];
        const t = s.cum / this.lengthU;
        const w = this.wallHalfAt(t) * side;
        const col = palette[Math.floor(s.cum / 30) % palette.length];
        npos.push(s.x + s.nx * (w - 0.03 * side), H + 0.005, s.z + s.nz * (w - 0.03 * side));
        npos.push(s.x + s.nx * (w + 0.03 * side), H + 0.005, s.z + s.nz * (w + 0.03 * side));
        ncol.push(...col, ...col);
        if (k < segs) { const o = k * 2; nidx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2); }
      }
      const ngeo = new THREE.BufferGeometry();
      ngeo.setAttribute('position', new THREE.Float32BufferAttribute(npos, 3));
      ngeo.setAttribute('color', new THREE.Float32BufferAttribute(ncol, 3));
      ngeo.setIndex(nidx);
      const nmesh = new THREE.Mesh(ngeo, new THREE.MeshBasicMaterial({ vertexColors: true }));
      this.scene.add(nmesh); this.meshes.push(nmesh);
    });
  }

  _buildRunoffPatches() {
    const mat = new THREE.MeshStandardMaterial({ color: 0x3a4046, roughness: 0.85 });
    const W = this.data.widthHalf, K = this.data.kerbWidth;
    for (const z of this._runoffT) {
      [1, -1].forEach(side => {
        this._ribbonRange(z.from, z.to, side * (W + K), (t) => side * this.wallHalfAt(t), 0.004, mat);
      });
    }
  }

  // ribbon over a t-range with dynamic outer edge
  _ribbonRange(tFrom, tTo, latIn, latOutFn, y, material) {
    const N = this.samples.length;
    const i0 = this._idxAt(tFrom), i1 = this._idxAt(tTo);
    const count = (i1 - i0 + N) % N;
    const pos = [], idx = [];
    const step = 4;
    let k = 0;
    for (let off = 0; off <= count; off += step, k++) {
      const i = (i0 + off) % N;
      const s = this.samples[i];
      const t = s.cum / this.lengthU;
      const out = latOutFn(t);
      pos.push(s.x + s.nx * latIn, y, s.z + s.nz * latIn);
      pos.push(s.x + s.nx * out, y, s.z + s.nz * out);
      if (off + step <= count) { const o = k * 2; idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, material);
    this.scene.add(mesh); this.meshes.push(mesh);
  }

  _buildStartFinish() {
    const s0 = this.samples[0];
    const W = this.data.widthHalf;
    // checkered line
    const tex = this._canvasTex('finish', 128, 32, (c, w, h) => {
      const n = 8, sz = w / n;
      for (let i = 0; i < n; i++) for (let j = 0; j < 4; j++) {
        c.fillStyle = (i + j) % 2 ? '#101014' : '#f4f4f8';
        c.fillRect(i * sz, j * (h / 4), sz, h / 4);
      }
    });
    const line = new THREE.Mesh(new THREE.PlaneGeometry(W * 2, 0.55),
      new THREE.MeshBasicMaterial({ map: tex }));
    line.rotation.x = -Math.PI / 2;
    line.rotation.z = -Math.atan2(s0.tx, s0.tz);
    line.position.set(s0.x, 0.015, s0.z);
    this.scene.add(line); this.meshes.push(line);

    // gantry: pillars + beam + name board + start lights
    const pillarMat = new THREE.MeshStandardMaterial({ color: 0x22262e, roughness: 0.6, metalness: 0.4 });
    const beamY = 1.15, span = this.wallHalfAt(0) + 0.25;
    [1, -1].forEach(side => {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.14, beamY, 0.14), pillarMat);
      p.position.set(s0.x + s0.nx * span * side, beamY / 2, s0.z + s0.nz * span * side);
      this.scene.add(p); this.meshes.push(p);
    });
    const beam = new THREE.Mesh(new THREE.BoxGeometry(span * 2 + 0.3, 0.22, 0.22), pillarMat);
    beam.position.set(s0.x, beamY, s0.z);
    beam.rotation.y = Math.atan2(-s0.nz, s0.nx);  // box X-axis along the track normal
    this.scene.add(beam); this.meshes.push(beam);

    const boardTex = this._canvasTex('gantryboard', 512, 64, (c, w, h) => {
      c.fillStyle = '#08080c'; c.fillRect(0, 0, w, h);
      c.font = 'bold 38px Arial'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillStyle = '#ff2d6f'; c.fillText('LAS VEGAS GRAND PRIX', w / 2, h / 2);
    });
    [1, -1].forEach(dir => {
      const board = new THREE.Mesh(new THREE.PlaneGeometry(span * 1.9, 0.24),
        new THREE.MeshBasicMaterial({ map: boardTex }));
      board.position.set(s0.x + s0.tx * 0.13 * dir, beamY + 0.24, s0.z + s0.tz * 0.13 * dir);
      // plane face (+Z local) points along ±tangent
      board.rotation.y = Math.atan2(s0.tx * dir, s0.tz * dir);
      this.scene.add(board); this.meshes.push(board);
    });

    // start lights: 5 columns of 2, hanging from the beam, facing the grid
    this.lightMats = [];
    const lightsGroup = new THREE.Group();
    const housing = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.30, 0.07),
      new THREE.MeshStandardMaterial({ color: 0x0a0a0e, roughness: 0.5 }));
    lightsGroup.add(housing);
    for (let i = 0; i < 5; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0x2a0406 });
      this.lightMats.push(mat);
      for (let row = 0; row < 2; row++) {
        const bulb = new THREE.Mesh(new THREE.CircleGeometry(0.052, 12), mat);
        bulb.position.set(-0.44 + i * 0.22, 0.065 - row * 0.13, -0.038);
        bulb.rotation.y = Math.PI;
        lightsGroup.add(bulb);
      }
    }
    lightsGroup.position.set(s0.x, beamY - 0.42, s0.z);
    // board faces -tangent (toward the approaching grid)
    lightsGroup.rotation.y = Math.atan2(s0.tx, s0.tz);
    this.scene.add(lightsGroup); this.meshes.push(lightsGroup);
  }

  setStartLights(n) {
    if (!this.lightMats) return;
    this.lightMats.forEach((m, i) => m.color.setHex(i < n ? 0xff1622 : 0x2a0406));
  }

  _buildGridSlots() {
    const mat = new THREE.MeshBasicMaterial({ color: 0xcfd6e0 });
    const geoH = new THREE.PlaneGeometry(0.46, 0.035);
    const geoV = new THREE.PlaneGeometry(0.035, 0.18);
    this.getGridPoses(this.data.gridRows).forEach(gp => {
      [geoH, geoV, geoV].forEach((g, i) => {
        const m = new THREE.Mesh(g, mat);
        m.rotation.x = -Math.PI / 2;
        m.rotation.z = -gp.heading;
        const ox = i === 0 ? 0 : (i === 1 ? -0.21 : 0.21);
        const fx = Math.sin(gp.heading), fz = Math.cos(gp.heading);
        const nx = Math.cos(gp.heading), nz = -Math.sin(gp.heading);
        const back = i === 0 ? 0.30 : 0.22;
        m.position.set(gp.x + fx * back + nx * ox, 0.012, gp.z + fz * back + nz * ox);
        this.scene.add(m); this.meshes.push(m);
      });
    });
  }

  // staggered grid behind the start line
  getGridPoses(count) {
    const poses = [];
    for (let i = 0; i < count; i++) {
      const back = (1.4 + i * 1.25) / this.lengthU;
      const t = ((0 - back) % 1 + 1) % 1;
      const s = this.posAt(t);
      const side = (i % 2 === 0 ? -1 : 1) * 0.42;
      poses.push({
        x: s.x + s.nx * side, z: s.z + s.nz * side,
        heading: Math.atan2(s.tx, s.tz), t,
      });
    }
    return poses;
  }

  _buildDrsBoards() {
    const tex = this._canvasTex('drs', 128, 64, (c, w, h) => {
      c.fillStyle = '#04140a'; c.fillRect(0, 0, w, h);
      c.strokeStyle = '#19f56e'; c.lineWidth = 4; c.strokeRect(3, 3, w - 6, h - 6);
      c.font = 'bold 40px Arial'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillStyle = '#19f56e'; c.fillText('DRS', w / 2, h / 2);
    });
    const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide });
    this._drsT.forEach(z => {
      const s = this.posAt(z.from);
      const w = this.wallHalfAt(z.from) + 0.3;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.7, 6),
        new THREE.MeshStandardMaterial({ color: 0x333a44 }));
      pole.position.set(s.x + s.nx * w, 0.35, s.z + s.nz * w);
      const board = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.28), mat);
      board.position.set(s.x + s.nx * w, 0.84, s.z + s.nz * w);
      board.rotation.y = Math.atan2(s.tx, s.tz) + Math.PI;
      this.scene.add(pole, board); this.meshes.push(pole, board);
    });
  }

  _buildPitLane() {
    // simple pit complex east of the S/F straight (track is at x=0 there)
    const road = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 70),
      new THREE.MeshStandardMaterial({ color: 0x23262c, roughness: 0.7 }));
    road.rotation.x = -Math.PI / 2;
    road.position.set(3.0, 0.003, 28);
    this.scene.add(road); this.meshes.push(road);

    const bTex = this._canvasTex('pitbld', 512, 128, (c, w, h) => {
      c.fillStyle = '#15171d'; c.fillRect(0, 0, w, h);
      for (let x = 8; x < w; x += 52) {
        c.fillStyle = '#2e3540'; c.fillRect(x, 38, 40, 80);
        c.fillStyle = '#ffd76a'; c.fillRect(x + 4, 44, 32, 30);
      }
      c.fillStyle = '#ff2d6f'; c.font = 'bold 26px Arial'; c.textAlign = 'center';
      c.fillText('PIT  LANE', w / 2, 26);
    }, 4, 1);
    const bld = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.0, 64),
      new THREE.MeshStandardMaterial({ map: bTex, color: 0xffffff, roughness: 0.7 }));
    bld.position.set(5.3, 0.5, 28);
    this.scene.add(bld); this.meshes.push(bld);
  }

  get bounds() {
    if (!this._bounds) {
      let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
      for (const s of this.samples) {
        minX = Math.min(minX, s.x); maxX = Math.max(maxX, s.x);
        minZ = Math.min(minZ, s.z); maxZ = Math.max(maxZ, s.z);
      }
      this._bounds = { minX, maxX, minZ, maxZ };
    }
    return this._bounds;
  }

  dispose() {
    this.meshes.forEach(m => this.scene && this.scene.remove(m));
    this.meshes = [];
  }
}
