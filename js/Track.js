// Track.js – 3D track mesh from CatmullRomCurve3 waypoints
// Optimised: merged geometry, InstancedMesh barriers, cached surface lookup

class Track {
  constructor(scene, trackData) {
    this.scene      = scene;
    this.data       = trackData;
    this.SAMPLES    = 800;          // reduced from 1200 for performance
    this.curve      = null;
    this.trackGroup = new THREE.Group();
    this.cachedPoints   = null;
    this.cachedTangents = null;
    this._lastBestIdx   = 0;        // surface-detection cache

    this._buildCurve();
    this._buildTrackSurface();
    this._buildKerbs();
    this._buildBarriers();
    this._buildStartLine();
    this._buildGround();

    scene.add(this.trackGroup);
  }

  // ─── Curve ─────────────────────────────────────────────────────────────────
  _buildCurve() {
    // Waypoint may carry optional y (elevation) for flyovers/bridges
    const pts = this.data.waypoints.map(w => new THREE.Vector3(w[0], w[2] || 0, w[1]));
    this.curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal', 0.5);
    this.cachedPoints   = this.curve.getPoints(this.SAMPLES);
    this.cachedTangents = [];
    for (let i = 0; i <= this.SAMPLES; i++) {
      this.cachedTangents.push(this.curve.getTangentAt(i / this.SAMPLES));
    }
    // Cumulative arc length at each cachedPoints index — used for uniform barrier spacing
    this.cachedLengths = new Array(this.cachedPoints.length);
    this.cachedLengths[0] = 0;
    for (let i = 1; i < this.cachedPoints.length; i++) {
      this.cachedLengths[i] = this.cachedLengths[i-1] +
        this.cachedPoints[i].distanceTo(this.cachedPoints[i-1]);
    }
    this.totalLength = this.cachedLengths[this.cachedLengths.length - 1];
  }

  _right(tangent) {
    return new THREE.Vector3(tangent.z, 0, -tangent.x).normalize();
  }

  // Sample the curve at a given cumulative arc length `s` — interpolates
  // between the two bracketing cachedPoints.  Returns {point, tangent}.
  _sampleAtArc(s) {
    const L = this.cachedLengths;
    const N = this.cachedPoints.length;
    s = ((s % this.totalLength) + this.totalLength) % this.totalLength;
    // Binary search for highest i with L[i] <= s
    let lo = 0, hi = N - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (L[mid] <= s) lo = mid; else hi = mid - 1;
    }
    const i = lo, j = (i + 1) % N;
    const seg = (L[j] || this.totalLength) - L[i];
    const f = seg > 1e-6 ? (s - L[i]) / seg : 0;
    const p0 = this.cachedPoints[i], p1 = this.cachedPoints[j];
    const t0 = this.cachedTangents[i], t1 = this.cachedTangents[j];
    return {
      point:   new THREE.Vector3(
        p0.x + (p1.x - p0.x) * f,
        p0.y + (p1.y - p0.y) * f,
        p0.z + (p1.z - p0.z) * f,
      ),
      tangent: new THREE.Vector3(
        t0.x + (t1.x - t0.x) * f,
        t0.y + (t1.y - t0.y) * f,
        t0.z + (t1.z - t0.z) * f,
      ).normalize(),
    };
  }

  // ─── Track surface (single merged mesh) ────────────────────────────────────
  _buildTrackSurface() {
    const W   = this.data.trackWidthHalf;
    const pts = this.cachedPoints;
    const N   = pts.length;

    const pos = new Float32Array(N * 2 * 3);
    const uvs = new Float32Array(N * 2 * 2);
    const idx = [];

    for (let i = 0; i < N; i++) {
      const p = pts[i];
      const r = this._right(this.cachedTangents[i]);
      const t = i / N;
      const vi = i * 6;
      const y = p.y + 0.01;
      pos[vi]   = p.x - r.x * W;  pos[vi+1] = y; pos[vi+2] = p.z - r.z * W;
      pos[vi+3] = p.x + r.x * W;  pos[vi+4] = y; pos[vi+5] = p.z + r.z * W;
      uvs[i*4]   = 0; uvs[i*4+1] = t * 30;
      uvs[i*4+2] = 1; uvs[i*4+3] = t * 30;
      if (i < N - 1) {
        const b = i * 2;
        idx.push(b, b+1, b+2, b+1, b+3, b+2);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv',       new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();

    // Tarmac texture (canvas-generated tarmac pattern)
    const mat = new THREE.MeshStandardMaterial({
      color: 0x1e1e1e, roughness: 0.9, metalness: 0.0,
      map: this._makeTarmacTexture(),
    });
    const mesh = new THREE.Mesh(geo, mat);
    this.trackGroup.add(mesh);

    // Opaque underside + side fascias on elevated (bridge) segments
    this._buildDeckUnderside(W);
    // White track-limit lines
    this._buildLimitLines(W);
    // Dashed centre line
    this._buildCentreLine();
  }

  // Build a thin box-shell under any segment whose endpoints are elevated
  // so the T6 flyover reads as a solid opaque deck from the side/below.
  _buildDeckUnderside(W) {
    const pts = this.cachedPoints;
    const N   = pts.length;
    const THICK = 0.25;      // deck thickness
    const Y_MIN = 0.2;       // consider a segment elevated above this

    const botPos = [], botIdx = [];
    const sidPos = [], sidIdx = [];
    const trimPos = [], trimIdx = [];
    let bv = 0, sv = 0, tv = 0;

    for (let i = 0; i < N; i++) {
      const j  = (i + 1) % N;
      const p  = pts[i], p1 = pts[j];
      if (p.y < Y_MIN || p1.y < Y_MIN) continue;

      const r  = this._right(this.cachedTangents[i]);
      const r1 = this._right(this.cachedTangents[j]);
      const yT0 = p.y + 0.01,   yT1 = p1.y + 0.01;
      const yB0 = p.y - THICK,  yB1 = p1.y - THICK;

      // Bottom ribbon (facing down)
      botPos.push(
        p.x  + r.x  * W, yB0, p.z  + r.z  * W,
        p.x  - r.x  * W, yB0, p.z  - r.z  * W,
        p1.x + r1.x * W, yB1, p1.z + r1.z * W,
        p1.x - r1.x * W, yB1, p1.z - r1.z * W,
      );
      // flipped winding so normals point down
      botIdx.push(bv, bv+2, bv+1, bv+1, bv+2, bv+3);
      bv += 4;

      // Side fascias (L=-, R=+)
      for (const sign of [-1, 1]) {
        sidPos.push(
          p.x  + sign * r.x  * W, yT0, p.z  + sign * r.z  * W,
          p.x  + sign * r.x  * W, yB0, p.z  + sign * r.z  * W,
          p1.x + sign * r1.x * W, yT1, p1.z + sign * r1.z * W,
          p1.x + sign * r1.x * W, yB1, p1.z + sign * r1.z * W,
        );
        if (sign > 0) sidIdx.push(sv, sv+1, sv+2, sv+1, sv+3, sv+2);
        else          sidIdx.push(sv, sv+2, sv+1, sv+1, sv+2, sv+3);
        sv += 4;

        // Yellow trim strip — narrow band at the top edge of each fascia
        const yTrim0 = yT0 - 0.04, yTrim1 = yT1 - 0.04;
        const Wt = W + 0.01; // push out slightly to avoid z-fighting
        trimPos.push(
          p.x  + sign * r.x  * Wt, yT0,    p.z  + sign * r.z  * Wt,
          p.x  + sign * r.x  * Wt, yTrim0, p.z  + sign * r.z  * Wt,
          p1.x + sign * r1.x * Wt, yT1,    p1.z + sign * r1.z * Wt,
          p1.x + sign * r1.x * Wt, yTrim1, p1.z + sign * r1.z * Wt,
        );
        if (sign > 0) trimIdx.push(tv, tv+1, tv+2, tv+1, tv+3, tv+2);
        else          trimIdx.push(tv, tv+2, tv+1, tv+1, tv+2, tv+3);
        tv += 4;
      }
    }
    if (bv === 0) return; // no elevated spans

    const deckMat = new THREE.MeshStandardMaterial({ color: 0x3a3a42, roughness: 0.9 });
    const sideMat = new THREE.MeshStandardMaterial({ color: 0x2a2a32, roughness: 0.85 });
    const trimMat = new THREE.MeshBasicMaterial({ color: 0xffcc00 });

    const mkMesh = (pos, idx, mat) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      return new THREE.Mesh(g, mat);
    };
    this.trackGroup.add(mkMesh(botPos, botIdx, deckMat));
    this.trackGroup.add(mkMesh(sidPos, sidIdx, sideMat));
    this.trackGroup.add(mkMesh(trimPos, trimIdx, trimMat));
  }

  _makeTarmacTexture() {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#1e1e1e';
    ctx.fillRect(0, 0, 128, 128);
    // subtle aggregate grain
    for (let i = 0; i < 600; i++) {
      const x = Math.random() * 128, y = Math.random() * 128;
      const r = Math.random() * 1.5;
      const v = Math.floor(Math.random() * 30 + 15);
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(2, 80);
    return tex;
  }

  _buildLimitLines(W) {
    const matLine = new THREE.LineBasicMaterial({ color: 0xffffff });
    ['l', 'r'].forEach(side => {
      const sign = side === 'l' ? -1 : 1;
      const pts3 = this.cachedPoints.map((p, i) => {
        const r = this._right(this.cachedTangents[i]);
        return new THREE.Vector3(p.x + sign * r.x * W, p.y + 0.05, p.z + sign * r.z * W);
      });
      this.trackGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts3), matLine));
    });
  }

  _buildCentreLine() {
    // Dashed yellow centre line – sample every 4 pts, draw short segment
    const matY = new THREE.LineBasicMaterial({ color: 0xdddd00 });
    const dashLen = 3, gapLen = 5;
    let distAcc = 0;
    let drawing = true;
    let segPts = [];
    for (let i = 1; i < this.cachedPoints.length; i++) {
      const seg = this.cachedPoints[i].distanceTo(this.cachedPoints[i-1]);
      distAcc += seg;
      if (drawing) {
        const p = this.cachedPoints[i];
        segPts.push(p.clone().setY(p.y + 0.04));
        if (distAcc >= dashLen) {
          if (segPts.length > 1)
            this.trackGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(segPts), matY));
          segPts = []; distAcc = 0; drawing = false;
        }
      } else {
        if (distAcc >= gapLen) {
          distAcc = 0; drawing = true;
          const p = this.cachedPoints[i];
          segPts = [p.clone().setY(p.y + 0.04)];
        }
      }
    }
  }

  // ─── Kerbs (merged, alternating red/white via geometry groups) ───────────
  _buildKerbs() {
    const W  = this.data.trackWidthHalf;
    const KW = this.data.kerbWidth;
    const pts = this.cachedPoints;
    const N   = pts.length;
    const STRIPE = 4; // pts per colour stripe

    const matRed   = new THREE.MeshStandardMaterial({ color: 0xcc1111, roughness: 1 });
    const matWhite = new THREE.MeshStandardMaterial({ color: 0xfafafa, roughness: 1 });

    ['l', 'r'].forEach(side => {
      const sign  = side === 'l' ? -1 : 1;
      const inner = W, outer = W + KW;
      const posArr = [], idxArr = [];
      let vi = 0;

      for (let i = 0; i < N; i++) {
        const p  = pts[i],             p1  = pts[(i+1) % N];
        const r  = this._right(this.cachedTangents[i]);
        const r1 = this._right(this.cachedTangents[(i+1) % N]);
        posArr.push(
          p.x  + sign * r.x  * inner, p.y  + 0.02, p.z  + sign * r.z  * inner,
          p.x  + sign * r.x  * outer, p.y  + 0.02, p.z  + sign * r.z  * outer,
          p1.x + sign * r1.x * inner, p1.y + 0.02, p1.z + sign * r1.z * inner,
          p1.x + sign * r1.x * outer, p1.y + 0.02, p1.z + sign * r1.z * outer,
        );
        idxArr.push(vi, vi+1, vi+2, vi+1, vi+3, vi+2);
        vi += 4;
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3));
      geo.setIndex(idxArr);
      geo.computeVertexNormals();

      const segsPerGroup = STRIPE * 6;
      for (let g = 0; g * segsPerGroup < idxArr.length; g++) {
        geo.addGroup(g * segsPerGroup, Math.min(segsPerGroup, idxArr.length - g * segsPerGroup), g % 2);
      }
      const mesh = new THREE.Mesh(geo, [matRed, matWhite]);
      this.trackGroup.add(mesh);
    });
  }

  // ─── Barriers (InstancedMesh – one draw call per material) ───────────────
  // Arc-length stepped so modules are evenly spaced regardless of corner radius.
  _buildBarriers() {
    const W   = this.data.trackWidthHalf + this.data.kerbWidth + 0.18;
    const H   = 0.75;
    const MODULE_LEN = 2.0; // box long-axis length (must match geo depth)
    const SPACING    = 2.5; // arc-length between module centres
    const count      = Math.max(1, Math.round(this.totalLength / SPACING));
    const step       = this.totalLength / count;

    const geo       = new THREE.BoxGeometry(0.35, H, MODULE_LEN);
    const matCon    = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.9 });
    const matStripe = new THREE.MeshStandardMaterial({ color: 0xdd2222, roughness: 0.9 });
    const instC     = new THREE.InstancedMesh(geo, matCon,    count * 2);
    const instS     = new THREE.InstancedMesh(geo, matStripe, count * 2);
    let ci = 0, si = 0;

    const m4  = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const q   = new THREE.Quaternion();
    const scl = new THREE.Vector3(1, 1, 1);
    const yAxis = new THREE.Vector3(0, 1, 0);

    for (let i = 0; i < count; i++) {
      const { point: p, tangent: tan } = this._sampleAtArc(i * step);
      const rgt = this._right(tan);
      const ang = Math.atan2(tan.x, tan.z);
      q.setFromAxisAngle(yAxis, ang);
      const stripe = (i % 5 === 0);

      for (const sign of [-1, 1]) {
        pos.set(p.x + sign * rgt.x * W, p.y + H/2, p.z + sign * rgt.z * W);
        m4.compose(pos, q, scl);
        if (stripe) { instS.setMatrixAt(si++, m4); }
        else         { instC.setMatrixAt(ci++, m4); }
      }
    }
    instC.count = ci; instS.count = si;
    instC.instanceMatrix.needsUpdate = true;
    instS.instanceMatrix.needsUpdate = true;
    this.trackGroup.add(instC, instS);
  }

  // ─── Start/finish line ─────────────────────────────────────────────────────
  _buildStartLine() {
    const W  = this.data.trackWidthHalf * 2;
    const c  = document.createElement('canvas');
    c.width = 256; c.height = 32;
    const ctx = c.getContext('2d');
    for (let x = 0; x < 8; x++) {
      ctx.fillStyle = x % 2 === 0 ? '#fff' : '#000';
      ctx.fillRect(x*32, 0, 32, 32);
      ctx.fillStyle = x % 2 === 0 ? '#000' : '#fff';
      ctx.fillRect(x*32, 16, 32, 16);
    }
    const mat  = new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(c) });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(W, 2.5), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(0, 0.03, 2);
    this.trackGroup.add(mesh);
  }

  // ─── Ground plane + runoff ─────────────────────────────────────────────────
  _buildGround() {
    // Main ground (city block asphalt)
    const gMat = new THREE.MeshStandardMaterial({ color: 0x161620, roughness: 1 });
    const gMesh = new THREE.Mesh(new THREE.PlaneGeometry(800, 800), gMat);
    gMesh.rotation.x = -Math.PI / 2;
    gMesh.position.set(50, -0.01, 140);
    this.trackGroup.add(gMesh);

    // Gravel runoff strips (merged left + right)
    this._buildRunoff();
  }

  _buildRunoff() {
    const W    = this.data.trackWidthHalf + this.data.kerbWidth + 1.0;
    const ROFF = 5;
    const pts  = this.cachedPoints;
    const N    = pts.length;
    const mat  = new THREE.MeshStandardMaterial({ color: 0x6e5c40, roughness: 1 });

    ['l', 'r'].forEach(side => {
      const sign = side === 'l' ? -1 : 1;
      const posArr = [], idxArr = [];
      let vi = 0;
      for (let i = 0; i < N; i++) {
        const p  = pts[i],             p1  = pts[(i+1)%N];
        // Skip runoff on elevated bridge sections — no ground to lay gravel on
        if (p.y > 0.5 || p1.y > 0.5) continue;
        const r  = this._right(this.cachedTangents[i]);
        const r1 = this._right(this.cachedTangents[(i+1)%N]);
        posArr.push(
          p.x  + sign*r.x *(W),      0.005, p.z  + sign*r.z *(W),
          p.x  + sign*r.x *(W+ROFF), 0.005, p.z  + sign*r.z *(W+ROFF),
          p1.x + sign*r1.x*(W),      0.005, p1.z + sign*r1.z*(W),
          p1.x + sign*r1.x*(W+ROFF), 0.005, p1.z + sign*r1.z*(W+ROFF),
        );
        idxArr.push(vi, vi+1, vi+2, vi+1, vi+3, vi+2);
        vi += 4;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3));
      geo.setIndex(idxArr);
      geo.computeVertexNormals();
      this.trackGroup.add(new THREE.Mesh(geo, mat));
    });
  }

  // ─── Surface detection (cached) ────────────────────────────────────────────
  // carY lets us disambiguate stacked levels (T6 flyover vs Koval below).
  getSurfaceAt(x, z, carY = 0) {
    const N    = this.cachedPoints.length;
    const NEAR = 80; // first search ±80 around last known position
    let minD = Infinity, bestIdx = this._lastBestIdx;

    // Fast local search — sequential continuity plus Y-weighting prevents
    // jumping to the other level when bridge sections overlap ground sections.
    for (let di = -NEAR; di <= NEAR; di += 2) {
      const i = ((this._lastBestIdx + di) % N + N) % N;
      const p = this.cachedPoints[i];
      const d = Math.abs(p.x - x) + Math.abs(p.z - z) + Math.abs(p.y - carY) * 2;
      if (d < minD) { minD = d; bestIdx = i; }
    }
    // Full fallback if car is far from last position
    if (minD > 40) {
      minD = Infinity;
      for (let i = 0; i < N; i += 4) {
        const p = this.cachedPoints[i];
        const d = Math.abs(p.x - x) + Math.abs(p.z - z) + Math.abs(p.y - carY) * 2;
        if (d < minD) { minD = d; bestIdx = i; }
      }
    }
    // Fine refine ±4 (planar distance — Y already disambiguated coarse match)
    for (let di = -4; di <= 4; di++) {
      const i = ((bestIdx + di) % N + N) % N;
      const p = this.cachedPoints[i];
      const dx = p.x - x, dz = p.z - z;
      const d = Math.sqrt(dx*dx + dz*dz);
      if (d < minD) { minD = d; bestIdx = i; }
    }
    this._lastBestIdx = bestIdx;

    const W = this.data.trackWidthHalf, KW = this.data.kerbWidth;
    const surface =
      minD < W          ? 'tarmac'     :
      minD < W + KW     ? 'kerb'       :
      minD < W + KW + 0.5 ? 'gravel'  : 'outOfBounds';

    return { surface, distFromCenter: minD, tParam: bestIdx / N,
             closestIdx: bestIdx, onTrack: minD < W,
             surfaceY: this.cachedPoints[bestIdx].y };
  }

  getTrackHeading(t) {
    const tan = this.curve.getTangentAt(t);
    return Math.atan2(tan.x, tan.z);
  }
}
