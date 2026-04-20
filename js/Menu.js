// Menu.js - Main menu with circuit selection

class Menu {
  constructor(onStart) {
    this.onStart = onStart;
    this.el = document.getElementById('menu');
    this.selectedCircuit = 21; // Las Vegas index (0-based)
    this.selectedLivery = 'redbull';
    this.selectedTire = 'medium';
    this.selectedLaps = 5;
    this._build();
  }

  _build() {
    this.el.innerHTML = `
      <div id="menu-inner">
        <div id="menu-header">
          <div id="menu-f1-logo">F1</div>
          <div id="menu-title">FORMULA 1</div>
          <div id="menu-subtitle">RACING SIMULATOR</div>
          <div id="menu-season">2024 SEASON</div>
        </div>

        <div id="menu-content">
          <!-- Left: circuit list -->
          <div id="menu-left">
            <div class="menu-section-title">SELECT CIRCUIT</div>
            <div id="circuit-list"></div>
          </div>

          <!-- Center: circuit preview + info -->
          <div id="menu-center">
            <div id="circuit-preview">
              <canvas id="preview-canvas" width="320" height="260"></canvas>
              <div id="preview-locked">
                <div class="lock-icon">🔒</div>
                <div>COMING SOON</div>
              </div>
            </div>
            <div id="circuit-info">
              <div id="ci-name">Las Vegas Street Circuit</div>
              <div id="ci-details">
                <span>🌍 USA</span>
                <span>📏 6.12 km</span>
                <span>🔄 50 laps</span>
                <span>🌙 Night Race</span>
              </div>
              <div id="ci-stats">
                <div>Corners: 17 &nbsp;|&nbsp; DRS Zones: 3</div>
                <div>Counter-clockwise &nbsp;|&nbsp; Street Circuit</div>
              </div>
            </div>
          </div>

          <!-- Right: car + race settings -->
          <div id="menu-right">
            <div class="menu-section-title">CAR SETUP</div>

            <div class="setting-group">
              <div class="setting-label">TEAM</div>
              <div id="livery-options">
                <div class="livery-opt selected" data-livery="redbull"   style="--c1:#1E3A8A;--c2:#FFD700">Red Bull</div>
                <div class="livery-opt"          data-livery="mercedes"  style="--c1:#00D2BE;--c2:#C0C0C0">Mercedes</div>
                <div class="livery-opt"          data-livery="ferrari"   style="--c1:#DC0000;--c2:#FFD700">Ferrari</div>
                <div class="livery-opt"          data-livery="mclaren"   style="--c1:#FF8000;--c2:#000000">McLaren</div>
                <div class="livery-opt"          data-livery="aston"     style="--c1:#006F62;--c2:#CEA14E">Aston M.</div>
              </div>
            </div>

            <div class="setting-group">
              <div class="setting-label">TIRE COMPOUND</div>
              <div id="tire-options">
                <div class="tire-opt" data-tire="soft"   style="--tc:#cc0000">● SOFT</div>
                <div class="tire-opt selected" data-tire="medium" style="--tc:#ddcc00">● MEDIUM</div>
                <div class="tire-opt" data-tire="hard"   style="--tc:#eeeeee">● HARD</div>
              </div>
            </div>

            <div class="setting-group">
              <div class="setting-label">RACE LAPS</div>
              <div id="laps-options">
                <div class="laps-opt" data-laps="3">3</div>
                <div class="laps-opt selected" data-laps="5">5</div>
                <div class="laps-opt" data-laps="10">10</div>
                <div class="laps-opt" data-laps="25">25</div>
                <div class="laps-opt" data-laps="50">50</div>
              </div>
            </div>

            <div class="setting-group">
              <div class="setting-label">CONTROLS</div>
              <div id="controls-hint">
                <div>W/↑ Throttle &nbsp; S/↓ Brake</div>
                <div>A/← D/→ Steer</div>
                <div>E = DRS &nbsp; C = Camera</div>
                <div>1/2/3 = Tire change</div>
                <div>ESC = Pause</div>
              </div>
            </div>
          </div>
        </div>

        <div id="menu-footer">
          <button id="btn-start" class="btn-start" disabled>
            <span>SELECT AN ACTIVE CIRCUIT</span>
          </button>
        </div>
      </div>
    `;

    // Populate circuit list
    this._buildCircuitList();

    // Wire events
    document.querySelectorAll('.livery-opt').forEach(el => {
      el.addEventListener('click', () => {
        document.querySelectorAll('.livery-opt').forEach(e => e.classList.remove('selected'));
        el.classList.add('selected');
        this.selectedLivery = el.dataset.livery;
      });
    });

    document.querySelectorAll('.tire-opt').forEach(el => {
      el.addEventListener('click', () => {
        document.querySelectorAll('.tire-opt').forEach(e => e.classList.remove('selected'));
        el.classList.add('selected');
        this.selectedTire = el.dataset.tire;
      });
    });

    document.querySelectorAll('.laps-opt').forEach(el => {
      el.addEventListener('click', () => {
        document.querySelectorAll('.laps-opt').forEach(e => e.classList.remove('selected'));
        el.classList.add('selected');
        this.selectedLaps = parseInt(el.dataset.laps);
      });
    });

    document.getElementById('btn-start').addEventListener('click', () => {
      this.hide();
      this.onStart({
        livery: this.selectedLivery,
        tire: this.selectedTire,
        laps: this.selectedLaps,
      });
    });

    // Auto-select Las Vegas
    this._selectCircuit(21);
  }

  _buildCircuitList() {
    const list = document.getElementById('circuit-list');
    list.innerHTML = '';
    F1_CIRCUITS.forEach((circuit, index) => {
      const item = document.createElement('div');
      item.className = 'circuit-item' + (circuit.active ? ' active' : ' locked');
      item.dataset.index = index;
      item.innerHTML = `
        <span class="circuit-flag">${circuit.flag}</span>
        <span class="circuit-name">${circuit.name}</span>
        ${circuit.active ? '<span class="circuit-badge">READY</span>' : '<span class="circuit-lock">🔒</span>'}
      `;
      if (circuit.active) {
        item.addEventListener('click', () => this._selectCircuit(index));
      }
      list.appendChild(item);
    });

    // Scroll to Las Vegas
    setTimeout(() => {
      const lasVegasEl = list.querySelector('[data-index="21"]');
      if (lasVegasEl) lasVegasEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 100);
  }

  _selectCircuit(index) {
    this.selectedCircuit = index;
    const circuit = F1_CIRCUITS[index];

    document.querySelectorAll('.circuit-item').forEach(el => el.classList.remove('selected'));
    const el = document.querySelector(`.circuit-item[data-index="${index}"]`);
    if (el) el.classList.add('selected');

    // Update circuit info
    document.getElementById('ci-name').textContent = circuit.name;
    document.getElementById('ci-details').innerHTML = circuit.active
      ? `<span>🌍 ${circuit.country}</span><span>📏 6.12 km</span><span>🔄 50 laps</span><span>🌙 Night Race</span>`
      : `<span>🌍 ${circuit.country}</span><span>🔒 Locked</span>`;

    if (circuit.active) {
      document.getElementById('preview-locked').style.display = 'none';
      this._drawPreviewMap();
      document.getElementById('btn-start').disabled = false;
      document.getElementById('btn-start').innerHTML = `<span>▶ START RACE — ${circuit.name}</span>`;
    } else {
      document.getElementById('preview-locked').style.display = 'flex';
      document.getElementById('btn-start').disabled = true;
      document.getElementById('btn-start').innerHTML = `<span>SELECT AN ACTIVE CIRCUIT</span>`;
    }
  }

  _drawPreviewMap() {
    const canvas = document.getElementById('preview-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    // Gradient background
    const grad = ctx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, '#0a0a1a');
    grad.addColorStop(1, '#1a1030');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    const pts = LAS_VEGAS.waypoints;
    const xs = pts.map(p => p[0]), zs = pts.map(p => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minZ = Math.min(...zs), maxZ = Math.max(...zs);
    const PAD = 22;
    const scaleX = (W - PAD * 2) / (maxX - minX);
    const scaleZ = (H - PAD * 2) / (maxZ - minZ);
    const scale = Math.min(scaleX, scaleZ);
    const offX = (W - (maxX - minX) * scale) / 2;
    const offZ = (H - (maxZ - minZ) * scale) / 2;

    const toC = ([x, z]) => [offX + (x - minX) * scale, offZ + (z - minZ) * scale];

    // Track outline (thick)
    ctx.beginPath();
    ctx.strokeStyle = '#444';
    ctx.lineWidth = 12;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    pts.forEach((p, i) => {
      const [cx, cy] = toC(p);
      if (i === 0) ctx.moveTo(cx, cy); else ctx.lineTo(cx, cy);
    });
    ctx.closePath();
    ctx.stroke();

    // Track surface
    ctx.beginPath();
    ctx.strokeStyle = '#888';
    ctx.lineWidth = 6;
    pts.forEach((p, i) => {
      const [cx, cy] = toC(p);
      if (i === 0) ctx.moveTo(cx, cy); else ctx.lineTo(cx, cy);
    });
    ctx.closePath();
    ctx.stroke();

    // Track center line dashed
    ctx.beginPath();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = '#00e5ff55';
    ctx.lineWidth = 1.5;
    pts.forEach((p, i) => {
      const [cx, cy] = toC(p);
      if (i === 0) ctx.moveTo(cx, cy); else ctx.lineTo(cx, cy);
    });
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);

    // S/F line
    const [sx, sy] = toC(pts[0]);
    ctx.fillStyle = '#00ff88';
    ctx.fillRect(sx - 6, sy - 2, 12, 4);

    // Turn numbers (T1, T3, T11 etc)
    const turnLabels = [
      { idx: 8, label: 'T1' },
      { idx: 16, label: 'T3' },
      { idx: 33, label: 'T6' },
      { idx: 40, label: 'T7' },
      { idx: 51, label: 'T9' },
      { idx: 60, label: 'T11' },
      { idx: 79, label: 'T12' },
      { idx: 87, label: 'T13' },
    ];
    ctx.font = 'bold 8px monospace';
    ctx.fillStyle = '#aaffff';
    turnLabels.forEach(({ idx, label }) => {
      if (idx < pts.length) {
        const [cx, cy] = toC(pts[idx]);
        ctx.fillText(label, cx + 3, cy - 3);
      }
    });

    // DRS arrows
    ctx.fillStyle = '#00ff88aa';
    ctx.font = '7px monospace';
    ctx.fillText('DRS', offX + (0 - minX) * scale, offZ + (10 - minZ) * scale);

    // Circuit name overlay
    ctx.font = 'bold 11px monospace';
    ctx.fillStyle = '#ffffff99';
    ctx.fillText('LAS VEGAS STREET CIRCUIT', 10, H - 10);
  }

  show() { this.el.style.display = 'flex'; }
  hide() { this.el.style.display = 'none'; }
}
