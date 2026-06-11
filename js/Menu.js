// Menu.js — circuit select + race setup screen.

class Menu {
  constructor(onStart) {
    this.onStart = onStart;
    this.root = document.getElementById('menu');
    this.team = 'redbull';
    this.tire = 'medium';
    this.laps = 3;
    this._built = false;
  }

  _build() {
    const rounds = F1_CIRCUITS.map((c, i) => `
      <div class="round${c.active ? ' active' : ' locked'}" ${c.active ? 'id="round-vegas"' : ''}>
        <span class="rd-no">R${String(i + 1).padStart(2, '0')}</span>
        <span class="rd-flag">${c.flag}</span>
        <span class="rd-name">${c.name}</span>
        ${c.active ? '<span class="rd-go">▶</span>' : '<span class="rd-lock">🔒</span>'}
      </div>`).join('');

    const teams = TEAMS.map(t => `
      <div class="team-chip" data-team="${t.id}" title="${t.name}">
        <span class="tc-color" style="background:#${new THREE.Color(t.primary).getHexString()};border-color:#${new THREE.Color(t.accent).getHexString()}"></span>
        <span class="tc-name">${t.name}</span>
      </div>`).join('');

    this.root.innerHTML = `
      <div class="menu-bg"></div>
      <header class="menu-head">
        <div class="menu-f1">F1</div>
        <h1 class="menu-title"><span>LAS VEGAS</span> GRAND PRIX</h1>
        <div class="menu-sub">NIGHT RACE · STREET CIRCUIT</div>
      </header>
      <div class="menu-grid">
        <section class="panel calendar">
          <h2>2024 캘린더</h2>
          <div class="rounds">${rounds}</div>
        </section>
        <section class="panel preview">
          <h2>서킷 프리뷰</h2>
          <canvas id="menu-map" width="340" height="380"></canvas>
          <div class="stats" id="menu-stats"></div>
        </section>
        <section class="panel setup">
          <h2>레이스 설정</h2>
          <h3>팀</h3>
          <div class="teams">${teams}</div>
          <h3>타이어</h3>
          <div class="opts" id="tire-opts">
            <button data-tire="soft" class="opt tire-s">S 소프트</button>
            <button data-tire="medium" class="opt tire-m">M 미디엄</button>
            <button data-tire="hard" class="opt tire-h">H 하드</button>
          </div>
          <h3>랩 수</h3>
          <div class="opts" id="lap-opts">
            <button data-laps="3" class="opt">3</button>
            <button data-laps="5" class="opt">5</button>
            <button data-laps="10" class="opt">10</button>
          </div>
          <button id="btn-race" class="race-btn">레이스 스타트</button>
          <div class="controls-hint">
            <b>조작법</b> — W/↑ 가속 · S/↓ 브레이크 · A/D 조향<br>
            E DRS · C 카메라 · R 리셋 · 1/2/3 타이어(그리드) · ESC 일시정지
          </div>
        </section>
      </div>`;
    this._built = true;

    // circuit math for the preview (no scene = geometry only)
    this._previewTrack = new Track(null, LAS_VEGAS);
    this._drawPreview();
    document.getElementById('menu-stats').innerHTML = `
      <div><b>${(this._previewTrack.lengthM / 1000).toFixed(2)} km</b><span>길이</span></div>
      <div><b>${LAS_VEGAS.cornerCount}</b><span>코너</span></div>
      <div><b>${LAS_VEGAS.drsZones.length}</b><span>DRS 존</span></div>
      <div><b>${fmtTime(this._previewTrack.idealLap)}</b><span>예상 랩</span></div>`;

    // wire events
    this.root.querySelectorAll('.team-chip').forEach(el => {
      el.addEventListener('click', () => this._select('team', el.dataset.team, '.team-chip', el));
    });
    this.root.querySelectorAll('#tire-opts .opt').forEach(el => {
      el.addEventListener('click', () => this._select('tire', el.dataset.tire, '#tire-opts .opt', el));
    });
    this.root.querySelectorAll('#lap-opts .opt').forEach(el => {
      el.addEventListener('click', () => this._select('laps', parseInt(el.dataset.laps, 10), '#lap-opts .opt', el));
    });
    const start = () => {
      this.hide();
      this.onStart({ team: this.team, tire: this.tire, laps: this.laps });
    };
    document.getElementById('btn-race').addEventListener('click', start);
    document.getElementById('round-vegas').addEventListener('click', start);

    // defaults
    this._select('team', this.team, '.team-chip', this.root.querySelector(`[data-team="${this.team}"]`));
    this._select('tire', this.tire, '#tire-opts .opt', this.root.querySelector(`[data-tire="${this.tire}"]`));
    this._select('laps', this.laps, '#lap-opts .opt', this.root.querySelector(`[data-laps="${this.laps}"]`));
  }

  _select(prop, value, selector, el) {
    this[prop] = value;
    this.root.querySelectorAll(selector).forEach(e => e.classList.remove('sel'));
    if (el) el.classList.add('sel');
  }

  _drawPreview() {
    const cv = document.getElementById('menu-map');
    const c = cv.getContext('2d');
    const tr = this._previewTrack;
    const b = tr.bounds, pad = 26;
    const s = Math.min((cv.width - pad * 2) / (b.maxX - b.minX), (cv.height - pad * 2) / (b.maxZ - b.minZ));
    const ox = pad + ((cv.width - pad * 2) - (b.maxX - b.minX) * s) / 2 - b.minX * s;
    const oz = pad + ((cv.height - pad * 2) - (b.maxZ - b.minZ) * s) / 2 - b.minZ * s;
    c.clearRect(0, 0, cv.width, cv.height);

    // glow pass + crisp pass
    [['rgba(255,45,111,0.35)', 11], ['#fff', 4]].forEach(([col, w]) => {
      c.strokeStyle = col; c.lineWidth = w; c.lineJoin = c.lineCap = 'round';
      c.beginPath();
      tr.samples.forEach((p, i) => {
        const x = p.x * s + ox, y = p.z * s + oz;
        i === 0 ? c.moveTo(x, y) : (i % 5 === 0 && c.lineTo(x, y));
      });
      c.closePath(); c.stroke();
    });
    // DRS zones
    c.strokeStyle = '#19f56e'; c.lineWidth = 4;
    for (const z of tr._drsT) {
      const N = tr.samples.length;
      const i0 = tr._idxAt(z.from), count = (tr._idxAt(z.to) - i0 + N) % N;
      c.beginPath();
      for (let k = 0; k <= count; k += 5) {
        const p = tr.samples[(i0 + k) % N];
        const x = p.x * s + ox, y = p.z * s + oz;
        k === 0 ? c.moveTo(x, y) : c.lineTo(x, y);
      }
      c.stroke();
    }
    // corner labels
    c.font = 'bold 10px Arial'; c.fillStyle = '#9fb2d8';
    c.textAlign = 'center';
    for (const corner of LAS_VEGAS.corners) {
      const [x, z] = LAS_VEGAS.waypoints[corner.wp];
      const info = tr.getTrackInfo(x, z);
      const lx = (x + info.nx * 9) * s + ox, ly = (z + info.nz * 9) * s + oz;
      c.fillText(corner.name, lx, ly);
    }
    // start dot
    const s0 = tr.samples[0];
    c.fillStyle = '#ffd012';
    c.beginPath(); c.arc(s0.x * s + ox, s0.z * s + oz, 4, 0, Math.PI * 2); c.fill();
  }

  show() {
    if (!this._built) this._build();
    this.root.style.display = 'flex';
  }

  hide() { this.root.style.display = 'none'; }
}
