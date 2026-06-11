// HUD.js — F1-broadcast-style race overlay: position tower, lap & sector
// timing with live delta, rev cluster, tire status, DRS, minimap, toasts.

function fmtTime(s, blankInfinity = true) {
  if (!isFinite(s) || s == null) return blankInfinity ? '—:——.———' : '0:00.000';
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return `${m}:${sec.toFixed(3).padStart(6, '0')}`;
}

class HUD {
  constructor() {
    this.root = document.getElementById('hud');
    this._txtTimer = 0;
    this._built = false;
    this._toastTimer = null;
  }

  _build() {
    this.root.innerHTML = `
      <div class="hud-lights" id="hud-lights">
        ${'<div class="hl"></div>'.repeat(5)}
      </div>
      <div class="hud-lap" id="hud-lap">LAP 1/3</div>
      <div class="hud-tower" id="hud-tower"></div>
      <div class="hud-times">
        <div class="ht-row"><span>LAST</span><b id="ht-last">—:——.———</b></div>
        <div class="ht-row"><span>BEST</span><b id="ht-best">—:——.———</b></div>
        <div class="ht-row"><span>Δ</span><b id="ht-delta">--.-</b></div>
        <div class="ht-sectors">
          <span class="sec" id="sec-0">S1</span><span class="sec" id="sec-1">S2</span><span class="sec" id="sec-2">S3</span>
        </div>
      </div>
      <div class="hud-cluster">
        <div class="rpm-strip" id="rpm-strip">${'<i></i>'.repeat(16)}</div>
        <div class="cluster-main">
          <div class="speed-block"><div class="speed" id="hud-speed">0</div><div class="unit">KM/H</div></div>
          <div class="gear" id="hud-gear">N</div>
          <div class="pedals">
            <div class="pedal"><div class="pedal-fill thr" id="ped-thr"></div></div>
            <div class="pedal"><div class="pedal-fill brk" id="ped-brk"></div></div>
          </div>
        </div>
        <div class="drs-badge" id="drs-badge">DRS</div>
      </div>
      <div class="hud-tire">
        <div class="tire-disc" id="tire-disc">M</div>
        <div class="tire-info">
          <div class="tire-bar"><div class="tire-fill" id="tire-fill"></div></div>
          <div class="tire-temp" id="tire-temp">70°C</div>
        </div>
      </div>
      <canvas class="hud-map" id="hud-map" width="210" height="250"></canvas>
      <div class="hud-toast" id="hud-toast"></div>
      <div class="hud-help">C 카메라 · E DRS · R 리셋 · M 음소거 · ESC 일시정지</div>
    `;
    this.map = document.getElementById('hud-map');
    this.mapCtx = this.map.getContext('2d');
    this._built = true;
    this.$ = (id) => document.getElementById(id);
  }

  show(track, playerCar) {
    if (!this._built) this._build();
    this.root.style.display = 'block';
    this.track = track;
    this.player = playerCar;
    this._renderMapBase(track);
    this.setLights(0);
    this.setSector(-1);
    this.setDelta(null);
  }

  hide() { if (this.root) this.root.style.display = 'none'; }

  // ── start lights (DOM mirror of the 3D gantry) ──
  setLights(n, out = false) {
    const box = this.$ ? this.$('hud-lights') : null;
    if (!box) return;
    box.style.display = n === 0 && out ? 'none' : 'flex';
    [...box.children].forEach((el, i) => el.classList.toggle('on', i < n));
    if (out) { box.classList.add('out'); setTimeout(() => { box.style.display = 'none'; box.classList.remove('out'); }, 900); }
  }

  toast(text, cls = '', dur = 2.4) {
    const el = this.$('hud-toast');
    el.textContent = text;
    el.className = 'hud-toast visible ' + cls;
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.classList.remove('visible'), dur * 1000);
  }

  // ── sectors: states per index: -1 reset all, {i, cls} ──
  setSector(i, cls = '') {
    for (let k = 0; k < 3; k++) {
      const el = this.$(`sec-${k}`);
      if (i === -1) el.className = 'sec';
      else if (k === i) el.className = 'sec ' + cls;
    }
  }

  setDelta(d) {
    const el = this.$('ht-delta');
    if (d == null) { el.textContent = '--.-'; el.className = ''; return; }
    el.textContent = (d >= 0 ? '+' : '−') + Math.abs(d).toFixed(2);
    el.className = d <= 0 ? 'delta-neg' : 'delta-pos';
  }

  update(dt, game) {
    if (!this._built) return;
    const car = this.player;

    // fast lane: rpm strip, pedals, speed (every frame — these read as analog)
    const frac = (car.rpm - PHYS.rpmIdle) / (PHYS.rpmMax - PHYS.rpmIdle);
    const strip = this.$('rpm-strip').children;
    const lit = Math.round(frac * 16);
    const flash = frac > 0.96 && (performance.now() % 200) < 100;
    for (let i = 0; i < 16; i++) {
      strip[i].className = i < lit ? (i >= 13 ? 'lit-red' : (i >= 9 ? 'lit-yel' : 'lit')) : '';
      if (flash) strip[i].className = 'lit-red';
    }
    this.$('ped-thr').style.height = `${car.input.throttle * 100}%`;
    this.$('ped-brk').style.height = `${car.input.brake * 100}%`;
    this.$('hud-speed').textContent = Math.round(car.speedKmh);
    this.$('hud-gear').textContent = car.speed < 0.5 && car.input.throttle === 0 ? 'N' : car.gear;

    // DRS badge
    const drs = this.$('drs-badge');
    drs.className = 'drs-badge' + (car.drsActive ? ' active' : (car.drsAvailable ? ' avail' : ''));

    // slow lane (10 Hz): tower, times, tire
    this._txtTimer -= dt;
    if (this._txtTimer <= 0) {
      this._txtTimer = 0.1;
      this.$('hud-lap').textContent = `LAP ${Math.min(car.lap, game.totalLaps)}/${game.totalLaps}`;
      this.$('ht-last').textContent = fmtTime(car.lastLap || null);
      this.$('ht-best').textContent = fmtTime(car.bestLap);
      this._updateTower(game);
      // tire
      const disc = this.$('tire-disc');
      disc.textContent = car.tireCompound[0].toUpperCase();
      disc.className = 'tire-disc tc-' + car.tireCompound;
      this.$('tire-fill').style.width = `${(1 - car.tireWear) * 100}%`;
      this.$('tire-fill').style.background = car.tireWear > 0.7 ? '#e23' : car.tireWear > 0.4 ? '#fb3' : '#3e6';
      this.$('tire-temp').textContent = `${Math.round(car.tireTemp)}°C`;
    }

    this._drawMap(game.cars);
  }

  _updateTower(game) {
    const rows = game.standings.map((st, i) => {
      const c = st.car;
      const me = c === this.player;
      const gap = i === 0 ? 'LEADER' : (c.finished && game.standings[0].car.finished
        ? '+' + (c.finishTime - game.standings[0].car.finishTime).toFixed(1)
        : '+' + st.gap.toFixed(1));
      const col = '#' + new THREE.Color(c.team.accent).getHexString();
      return `<div class="tw-row${me ? ' me' : ''}">
        <span class="tw-pos">${i + 1}</span>
        <span class="tw-chip" style="background:${col}"></span>
        <span class="tw-code">${c.code}</span>
        <span class="tw-gap">${gap}</span></div>`;
    }).join('');
    this.$('hud-tower').innerHTML = rows;
  }

  // ── minimap ──
  _renderMapBase(track) {
    const cv = document.createElement('canvas');
    cv.width = this.map.width; cv.height = this.map.height;
    const c = cv.getContext('2d');
    const b = track.bounds;
    const pad = 14;
    const sx = (cv.width - pad * 2) / (b.maxX - b.minX);
    const sy = (cv.height - pad * 2) / (b.maxZ - b.minZ);
    const s = Math.min(sx, sy);
    this._mapXform = {
      s,
      ox: pad + ((cv.width - pad * 2) - (b.maxX - b.minX) * s) / 2 - b.minX * s,
      oz: pad + ((cv.height - pad * 2) - (b.maxZ - b.minZ) * s) / 2 - b.minZ * s,
    };
    const P = (x, z) => [x * s + this._mapXform.ox, z * s + this._mapXform.oz];

    c.lineWidth = 5; c.strokeStyle = 'rgba(255,255,255,0.85)';
    c.lineJoin = c.lineCap = 'round';
    c.beginPath();
    track.samples.forEach((p, i) => {
      const [x, y] = P(p.x, p.z);
      i === 0 ? c.moveTo(x, y) : (i % 6 === 0 && c.lineTo(x, y));
    });
    c.closePath(); c.stroke();
    // DRS zones in green
    c.lineWidth = 5; c.strokeStyle = '#19f56e';
    for (const z of track._drsT) {
      c.beginPath();
      const N = track.samples.length;
      const i0 = track._idxAt(z.from), i1 = track._idxAt(z.to);
      const count = (i1 - i0 + N) % N;
      for (let k = 0; k <= count; k += 6) {
        const p = track.samples[(i0 + k) % N];
        const [x, y] = P(p.x, p.z);
        k === 0 ? c.moveTo(x, y) : c.lineTo(x, y);
      }
      c.stroke();
    }
    // start line tick
    const s0 = track.samples[0];
    const [fx, fy] = P(s0.x, s0.z);
    c.strokeStyle = '#fff'; c.lineWidth = 3;
    c.beginPath();
    c.moveTo(fx - s0.nx * 7 * 1, fy - s0.nz * 7);
    c.lineTo(fx + s0.nx * 7, fy + s0.nz * 7);
    c.stroke();
    this._mapBase = cv;
  }

  _drawMap(cars) {
    if (!this._mapBase) return;
    const c = this.mapCtx;
    c.clearRect(0, 0, this.map.width, this.map.height);
    c.drawImage(this._mapBase, 0, 0);
    const { s, ox, oz } = this._mapXform;
    for (const car of cars) {
      const x = car.pos.x * s + ox, y = car.pos.z * s + oz;
      const me = car === this.player;
      c.beginPath();
      c.arc(x, y, me ? 5 : 3.4, 0, Math.PI * 2);
      c.fillStyle = me ? '#' + new THREE.Color(car.team.accent).getHexString() : '#c8ccd8';
      c.fill();
      if (me) { c.lineWidth = 2; c.strokeStyle = '#fff'; c.stroke(); }
    }
  }

  // ── results overlay ──
  showResults(standings, player, totalLaps) {
    const overlay = document.getElementById('results-overlay');
    const tbody = document.getElementById('results-rows');
    const playerPos = standings.findIndex(s => s.car === player) + 1;
    document.getElementById('results-title').textContent =
      playerPos === 1 ? '🏆 우승!' : `🏁 레이스 완료 — P${playerPos}`;
    const leader = standings[0].car;
    tbody.innerHTML = standings.map((st, i) => {
      const c = st.car;
      const col = '#' + new THREE.Color(c.team.accent).getHexString();
      let gap;
      if (i === 0) gap = fmtTime(c.finishTime || c.totalTime, false);
      else if (c.finished) gap = '+' + (c.finishTime - leader.finishTime).toFixed(3);
      else gap = '+' + st.gap.toFixed(1);
      const pen = c.penalty > 0 ? ` <i class="pen">+${c.penalty}s</i>` : '';
      return `<div class="res-row${c === player ? ' me' : ''}">
        <span class="r-pos">${i + 1}</span>
        <span class="r-chip" style="background:${col}"></span>
        <span class="r-code">${c.code}</span>
        <span class="r-team">${c.team.name}</span>
        <span class="r-best">${fmtTime(c.bestLap)}</span>
        <span class="r-gap">${gap}${pen}</span></div>`;
    }).join('');
    overlay.style.display = 'flex';
  }

  hideResults() {
    document.getElementById('results-overlay').style.display = 'none';
  }
}
