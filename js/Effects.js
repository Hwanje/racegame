// Effects.js — pooled GPU particles: tire smoke, wall-scrape sparks and
// persistent skid marks. One draw call per system.

class Effects {
  constructor(scene) {
    this.scene = scene;
    this.time = 0;
    this._initSmoke();
    this._initSparks();
    this._initSkids();
  }

  // ════════ smoke ════════
  _initSmoke() {
    const MAX = this.smokeMax = 220;
    this.smokePos = new Float32Array(MAX * 3);
    this.smokeSize = new Float32Array(MAX);
    this.smokeAlpha = new Float32Array(MAX);
    this.smokeVel = new Float32Array(MAX * 3);
    this.smokeLife = new Float32Array(MAX);
    this.smokeHead = 0;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.smokePos, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.smokeSize, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.smokeAlpha, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      vertexShader: `
        attribute float aSize; attribute float aAlpha; varying float vA;
        void main() {
          vA = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * (160.0 / max(1.0, -mv.z));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying float vA;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.12, d) * vA;
          if (a < 0.01) discard;
          gl_FragColor = vec4(0.62, 0.63, 0.68, a);
        }`,
    });
    this.smokeMesh = new THREE.Points(geo, mat);
    this.smokeMesh.frustumCulled = false;
    this.scene.add(this.smokeMesh);
  }

  smoke(x, y, z, vx, vz, intensity = 1) {
    const i = this.smokeHead; this.smokeHead = (i + 1) % this.smokeMax;
    this.smokePos.set([x, y, z], i * 3);
    this.smokeVel.set([vx * 0.04 + (Math.random() - 0.5) * 0.3, 0.5 + Math.random() * 0.5,
                       vz * 0.04 + (Math.random() - 0.5) * 0.3], i * 3);
    this.smokeSize[i] = 0.5 + intensity * 0.8;
    this.smokeAlpha[i] = 0.30 * intensity;
    this.smokeLife[i] = 1.0 + Math.random() * 0.4;
  }

  // ════════ sparks ════════
  _initSparks() {
    const MAX = this.sparkMax = 320;
    this.sparkPos = new Float32Array(MAX * 3);
    this.sparkAlpha = new Float32Array(MAX);
    this.sparkVel = new Float32Array(MAX * 3);
    this.sparkLife = new Float32Array(MAX);
    this.sparkHead = 0;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.sparkPos, 3));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.sparkAlpha, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `
        attribute float aAlpha; varying float vA;
        void main() {
          vA = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = 26.0 / max(1.0, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying float vA;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, d) * vA;
          if (a < 0.02) discard;
          gl_FragColor = vec4(1.0, 0.75, 0.3, a);
        }`,
    });
    this.sparkMesh = new THREE.Points(geo, mat);
    this.sparkMesh.frustumCulled = false;
    this.scene.add(this.sparkMesh);
  }

  sparks(x, y, z, dirX, dirZ, count = 6) {
    for (let n = 0; n < count; n++) {
      const i = this.sparkHead; this.sparkHead = (i + 1) % this.sparkMax;
      this.sparkPos.set([x, y + Math.random() * 0.05, z], i * 3);
      this.sparkVel.set([
        dirX * (1 + Math.random() * 2) + (Math.random() - 0.5) * 1.5,
        0.4 + Math.random() * 1.2,
        dirZ * (1 + Math.random() * 2) + (Math.random() - 0.5) * 1.5], i * 3);
      this.sparkAlpha[i] = 0.9;
      this.sparkLife[i] = 0.25 + Math.random() * 0.35;
    }
  }

  // ════════ skid marks (birth-time alpha decay in shader) ════════
  _initSkids() {
    const MAX = this.skidMax = 900;
    this.skidHead = 0;
    const pos = new Float32Array(MAX * 4 * 3);
    const birth = new Float32Array(MAX * 4).fill(-1e3);
    const idx = new Uint32Array(MAX * 6);
    for (let i = 0; i < MAX; i++) {
      const o = i * 4, j = i * 6;
      idx[j] = o; idx[j + 1] = o + 1; idx[j + 2] = o + 2;
      idx[j + 3] = o + 1; idx[j + 4] = o + 3; idx[j + 5] = o + 2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aBirth', new THREE.BufferAttribute(birth, 1));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.skidUniforms = { uTime: { value: 0 } };
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, uniforms: this.skidUniforms,
      polygonOffset: true, polygonOffsetFactor: -2,
      vertexShader: `
        attribute float aBirth; uniform float uTime; varying float vA;
        void main() {
          vA = clamp(1.0 - (uTime - aBirth) / 14.0, 0.0, 1.0) * 0.50;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        varying float vA;
        void main() {
          if (vA < 0.01) discard;
          gl_FragColor = vec4(0.02, 0.02, 0.03, vA);
        }`,
    });
    this.skidMesh = new THREE.Mesh(geo, mat);
    this.skidMesh.frustumCulled = false;
    this.scene.add(this.skidMesh);
  }

  // segment from (x1,z1) → (x2,z2), width in units
  skid(x1, z1, x2, z2, width = 0.045) {
    let dx = x2 - x1, dz = z2 - z1;
    const len = Math.hypot(dx, dz);
    if (len < 0.01 || len > 2) return;
    dx /= len; dz /= len;
    const nx = -dz * width / 2, nz = dx * width / 2;
    const i = this.skidHead; this.skidHead = (i + 1) % this.skidMax;
    const y = 0.009;
    const posAttr = this.skidMesh.geometry.getAttribute('position');
    posAttr.array.set([
      x1 + nx, y, z1 + nz,  x1 - nx, y, z1 - nz,
      x2 + nx, y, z2 + nz,  x2 - nx, y, z2 - nz,
    ], i * 12);
    posAttr.needsUpdate = true;
    const bAttr = this.skidMesh.geometry.getAttribute('aBirth');
    bAttr.array.fill(this.time, i * 4, i * 4 + 4);
    bAttr.needsUpdate = true;
  }

  update(dt) {
    this.time += dt;
    this.skidUniforms.uTime.value = this.time;

    for (let i = 0; i < this.smokeMax; i++) {
      if (this.smokeLife[i] <= 0) continue;
      this.smokeLife[i] -= dt;
      this.smokePos[i * 3] += this.smokeVel[i * 3] * dt;
      this.smokePos[i * 3 + 1] += this.smokeVel[i * 3 + 1] * dt;
      this.smokePos[i * 3 + 2] += this.smokeVel[i * 3 + 2] * dt;
      this.smokeSize[i] += dt * 1.6;
      this.smokeAlpha[i] = Math.max(0, this.smokeAlpha[i] - dt * 0.25);
    }
    this.smokeMesh.geometry.getAttribute('position').needsUpdate = true;
    this.smokeMesh.geometry.getAttribute('aSize').needsUpdate = true;
    this.smokeMesh.geometry.getAttribute('aAlpha').needsUpdate = true;

    for (let i = 0; i < this.sparkMax; i++) {
      if (this.sparkLife[i] <= 0) continue;
      this.sparkLife[i] -= dt;
      if (this.sparkLife[i] <= 0) { this.sparkAlpha[i] = 0; continue; }
      this.sparkVel[i * 3 + 1] -= 4 * dt; // gravity
      this.sparkPos[i * 3] += this.sparkVel[i * 3] * dt;
      this.sparkPos[i * 3 + 1] = Math.max(0.01, this.sparkPos[i * 3 + 1] + this.sparkVel[i * 3 + 1] * dt);
      this.sparkPos[i * 3 + 2] += this.sparkVel[i * 3 + 2] * dt;
      this.sparkAlpha[i] = Math.min(1, this.sparkLife[i] * 3);
    }
    this.sparkMesh.geometry.getAttribute('position').needsUpdate = true;
    this.sparkMesh.geometry.getAttribute('aAlpha').needsUpdate = true;
  }

  dispose() {
    [this.smokeMesh, this.sparkMesh, this.skidMesh].forEach(m => this.scene.remove(m));
  }
}
