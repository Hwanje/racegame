// HUD.js - Heads-up display overlay

class HUD {
  constructor() {
    this.el = document.getElementById('hud');
    this.visible = false;
    this._build();
  }

  _build() {
    this.el.innerHTML = `
      <!-- Speed + Gear -->
      <div id="hud-speed-box">
        <div id="hud-speed">0</div>
        <div id="hud-unit">KM/H</div>
        <div id="hud-gear-label">GEAR</div>
        <div id="hud-gear">N</div>
      </div>

      <!-- RPM bar -->
      <div id="hud-rpm-bar-wrap">
        <div id="hud-rpm-bar"></div>
        <div id="hud-rpm-label">RPM</div>
      </div>

      <!-- Throttle / Brake -->
      <div id="hud-pedals">
        <div class="pedal-wrap">
          <div class="pedal-label">T</div>
          <div class="pedal-track"><div id="hud-throttle" class="pedal-fill throttle-fill"></div></div>
        </div>
        <div class="pedal-wrap">
          <div class="pedal-label">B</div>
          <div class="pedal-track"><div id="hud-brake" class="pedal-fill brake-fill"></div></div>
        </div>
      </div>

      <!-- Tire compound + wear -->
      <div id="hud-tires">
        <div id="hud-tire-icon">&#9679;</div>
        <div id="hud-tire-compound">MEDIUM</div>
        <div id="hud-tire-wear-bar-wrap">
          <div id="hud-tire-wear-bar"></div>
        </div>
        <div id="hud-tire-wear-pct">100%</div>
        <div id="hud-tire-temp">75°C</div>
      </div>

      <!-- DRS indicator -->
      <div id="hud-drs">DRS</div>

      <!-- Lap info -->
      <div id="hud-lap-info">
        <div id="hud-lap-num">LAP 1/50</div>
        <div id="hud-lap-time">0:00.000</div>
        <div id="hud-best-lap">BEST --:--.---</div>
        <div id="hud-delta"></div>
      </div>

      <!-- Mini map -->
      <canvas id="hud-minimap" width="180" height="180"></canvas>

      <!-- Warning messages -->
      <div id="hud-msg"></div>

      <!-- Controls hint (fades out) -->
      <div id="hud-controls">
        THROTTLE: W / ↑ &nbsp;|&nbsp; BRAKE: S / ↓ &nbsp;|&nbsp; STEER: A D / ← →<br>
        DRS: E &nbsp;|&nbsp; TIRE: 1=Soft 2=Medium 3=Hard &nbsp;|&nbsp; CAMERA: C
      </div>
    `;

    this.els = {
      speed:     document.getElementById('hud-speed'),
      gear:      document.getElementById('hud-gear'),
      rpmBar:    document.getElementById('hud-rpm-bar'),
      throttle:  document.getElementById('hud-throttle'),
      brake:     document.getElementById('hud-brake'),
      tireIcon:  document.getElementById('hud-tire-icon'),
      tireComp:  document.getElementById('hud-tire-compound'),
      tireWear:  document.getElementById('hud-tire-wear-bar'),
      tireWearPct: document.getElementById('hud-tire-wear-pct'),
      tireTemp:  document.getElementById('hud-tire-temp'),
      drs:       document.getElementById('hud-drs'),
      lapNum:    document.getElementById('hud-lap-num'),
      lapTime:   document.getElementById('hud-lap-time'),
      bestLap:   document.getElementById('hud-best-lap'),
      delta:     document.getElementById('hud-delta'),
      minimap:   document.getElementById('hud-minimap'),
      msg:       document.getElementById('hud-msg'),
      controls:  document.getElementById('hud-controls'),
    };

    this.minimapCtx = this.els.minimap.getContext('2d');
    this.msgTimeout = null;

    // Fade out controls hint after 6s
    setTimeout(() => {
      if (this.els.controls) this.els.controls.style.opacity = '0';
    }, 6000);
  }

  show() { this.el.style.display = 'block'; this.visible = true; }
  hide() { this.el.style.display = 'none'; this.visible = false; }

  update(car, totalLaps) {
    const e = this.els;
    const speedKMH = car.getSpeedKMH();

    // Speed
    e.speed.textContent = Math.round(speedKMH);

    // Gear
    e.gear.textContent = car.speed < 0.5 ? 'N' : car.gear;

    // RPM bar
    const rpmPct = Math.min(1, car.rpm / 15000);
    e.rpmBar.style.width = (rpmPct * 100) + '%';
    // Color shifts red near redline
    if (rpmPct > 0.88) {
      e.rpmBar.style.background = '#ff2200';
    } else if (rpmPct > 0.72) {
      e.rpmBar.style.background = '#ffaa00';
    } else {
      e.rpmBar.style.background = '#00e5ff';
    }

    // Throttle / brake
    e.throttle.style.height = (car.input.throttle * 100) + '%';
    e.brake.style.height    = (car.input.brake * 100) + '%';

    // Tire compound
    const compColors = { soft: '#ff2222', medium: '#ddcc00', hard: '#eeeeee' };
    const comp = car.tireCompound;
    e.tireIcon.style.color = compColors[comp] || '#ffffff';
    e.tireComp.textContent = comp.toUpperCase();

    // Tire wear
    const wear = 100 - car.tireWear;
    e.tireWear.style.width = wear + '%';
    e.tireWear.style.background = wear > 60 ? '#44dd44' : wear > 30 ? '#ddaa00' : '#ff2200';
    e.tireWearPct.textContent = Math.round(wear) + '%';
    e.tireTemp.textContent = Math.round(car.tireTemp) + '°C';

    // DRS
    e.drs.classList.toggle('drs-active',    car.drsActive);
    e.drs.classList.toggle('drs-available', car.drsAvailable && !car.drsActive);

    // Lap
    e.lapNum.textContent = `LAP ${car.lap}/${totalLaps}`;
    e.lapTime.textContent = this._formatTime(car.lapTime);

    if (car.bestLap < Infinity) {
      e.bestLap.textContent = 'BEST ' + this._formatTime(car.bestLap);
    }

    // Surface warning
    if (car.surface === 'gravel') {
      this.showMsg('GRAVEL!', '#ff8800');
    } else if (car.surface === 'outOfBounds') {
      this.showMsg('OUT OF BOUNDS', '#ff2200');
    }
  }

  showMsg(text, color = '#ffffff') {
    const e = this.els.msg;
    e.textContent = text;
    e.style.color = color;
    e.style.opacity = '1';
    if (this.msgTimeout) clearTimeout(this.msgTimeout);
    this.msgTimeout = setTimeout(() => { e.style.opacity = '0'; }, 2000);
  }

  updateMinimap(car, trackPoints, totalTrackBounds) {
    const ctx = this.minimapCtx;
    const W = 180, H = 180;
    const PAD = 15;

    // Build cached track image once
    if (!this._minimapCache) {
      const { minX, maxX, minZ, maxZ } = totalTrackBounds;
      const scaleX = (W - PAD * 2) / (maxX - minX);
      const scaleZ = (H - PAD * 2) / (maxZ - minZ);
      const sc = Math.min(scaleX, scaleZ);
      this._minimapScale = sc;
      this._minimapMin   = { x: minX, z: minZ };

      const off = document.createElement('canvas');
      off.width = W; off.height = H;
      const oc = off.getContext('2d');
      oc.fillStyle = 'rgba(0,0,0,0.8)';
      oc.fillRect(0, 0, W, H);

      const toC = (x, z) => [PAD + (x - minX) * sc, PAD + (z - minZ) * sc];
      const STEP = 4; // sample every 4th point for speed

      oc.beginPath();
      oc.strokeStyle = '#555';
      oc.lineWidth = 6;
      for (let i = 0; i < trackPoints.length; i += STEP) {
        const [cx, cy] = toC(trackPoints[i].x, trackPoints[i].z);
        i === 0 ? oc.moveTo(cx, cy) : oc.lineTo(cx, cy);
      }
      oc.closePath();
      oc.stroke();

      oc.beginPath();
      oc.strokeStyle = '#999';
      oc.lineWidth = 2;
      for (let i = 0; i < trackPoints.length; i += STEP) {
        const [cx, cy] = toC(trackPoints[i].x, trackPoints[i].z);
        i === 0 ? oc.moveTo(cx, cy) : oc.lineTo(cx, cy);
      }
      oc.closePath();
      oc.stroke();

      this._minimapCache = off;
    }

    // Draw cached track then car dot
    ctx.drawImage(this._minimapCache, 0, 0);

    const sc  = this._minimapScale;
    const min = this._minimapMin;
    const cx  = PAD + (car.pos.x - min.x) * sc;
    const cy  = PAD + (car.pos.z - min.z) * sc;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(car.heading);
    ctx.fillStyle = '#00e5ff';
    ctx.beginPath();
    ctx.moveTo(0, -5);
    ctx.lineTo(-3, 3);
    ctx.lineTo(3, 3);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  _formatTime(seconds) {
    if (!isFinite(seconds)) return '--:--.---';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    return `${m}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
  }

  showLapComplete(lapTime, bestLap, lap) {
    const msg = lapTime === bestLap
      ? `LAP ${lap} - BEST LAP! ${this._formatTime(lapTime)}`
      : `LAP ${lap} - ${this._formatTime(lapTime)}`;
    this.showMsg(msg, lapTime === bestLap ? '#ffdd00' : '#ffffff');
  }

  showRaceFinished(totalTime, laps) {
    const overlay = document.getElementById('race-finish-overlay');
    if (overlay) {
      document.getElementById('finish-time').textContent = this._formatTime(totalTime);
      overlay.style.display = 'flex';
    }
  }
}
