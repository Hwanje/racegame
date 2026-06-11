// AI.js — opponent drivers. Each AI follows the track's precomputed racing
// line + speed profile, with per-driver skill, slipstream-aware overtaking
// and a simple stuck-recovery hook (Game performs the actual reset).

class AIDriver {
  constructor(car, track, skill = 0.95) {
    this.car = car;
    this.track = track;
    this.skill = skill;              // 0.90 (backmarker) .. 0.99 (ace)
    this.latTarget = 0;              // lateral offset from racing line (units)
    this.latNow = 0;
    this.reaction = 0.12 + (1 - skill) * 1.8; // start reaction time, s
    this.launched = false;
    this.stuckTime = 0;
    this.seed = Math.random() * 1000;
  }

  reset() {
    this.launched = false;
    this.latNow = this.latTarget = 0;
    this.stuckTime = 0;
  }

  // raceTime: seconds since lights-out (negative before start)
  update(dt, raceTime, cars) {
    const car = this.car, track = this.track;
    const inp = car.input;

    if (raceTime < this.reaction) {            // waiting for lights / reaction
      inp.throttle = raceTime > -0.5 ? 0.4 : 0; // crew revs on the grid
      inp.brake = 1; inp.steer = 0;
      return;
    }
    if (!this.launched) { this.launched = true; inp.brake = 0; }

    const info = car._trackInfo || track.getTrackInfo(car.pos.x, car.pos.z);
    const v = car.speed;                       // m/s
    const lenM = track.lengthM;

    // ── traffic: pick a passing offset, lift if boxed in ──
    let liftFactor = 1;
    let ahead = null, aheadDist = 1e9;
    for (const other of cars) {
      if (other === car) continue;
      let dProg = (other.progress - car.progress) * lenM;
      if (dProg > 0.5 && dProg < aheadDist) { aheadDist = dProg; ahead = other; }
    }
    if (ahead && aheadDist < 30) {
      const myLat = info.lateral;
      const oInfo = ahead._trackInfo;
      const oLat = oInfo ? oInfo.lateral : 0;
      if (Math.abs(myLat - oLat) < 0.45) {
        // pick the side with more room
        const room = track.data.widthHalf - 0.35;
        const goLeft = oLat > 0 ? -1 : 1;
        this.latTarget = THREE.MathUtils.clamp(oLat + goLeft * 0.75, -room, room) -
                         track.lineOffsetAt(info.t);
        if (aheadDist < 9 && Math.abs(ahead.speed - v) < 4) liftFactor = 0.82;
        if (aheadDist < 4.5) liftFactor = 0.55;
      }
    } else {
      this.latTarget = 0;
    }
    this.latNow += (this.latTarget - this.latNow) * Math.min(1, dt * 1.6);

    // ── steering: pure pursuit on the racing line ──
    const lookM = Math.max(11, v * 0.45);
    const tAhead = info.t + lookM / lenM;
    const lp = track.linePointAt(tAhead);
    const sAhead = track.posAt(tAhead);
    const tx = lp.x + sAhead.nx * this.latNow - car.pos.x;
    const tz = lp.z + sAhead.nz * this.latNow - car.pos.z;
    const desired = Math.atan2(tx, tz);
    let err = desired - car.heading;
    while (err > Math.PI) err -= Math.PI * 2;
    while (err < -Math.PI) err += Math.PI * 2;
    // physics: positive heading change needs negative input.steer (screen-left)
    inp.steer = THREE.MathUtils.clamp(-err * 2.2, -1, 1);

    // ── speed control from profile (skill scales pace; small per-driver wobble) ──
    const wobble = 1 + 0.012 * Math.sin(info.t * 37 + this.seed);
    const brakeLook = info.t + Math.max(4, v * 0.18) / lenM;
    let vt = Math.min(track.lineSpeedAt(info.t), track.lineSpeedAt(brakeLook));
    vt *= this.skill * wobble * liftFactor;
    if (info.surface === 'runoff') vt = Math.min(vt, 18);

    const dv = vt - v;
    if (dv > 0.3) {
      inp.throttle = THREE.MathUtils.clamp(dv * 0.45 + 0.25, 0, 1);
      inp.brake = 0;
    } else if (dv < -0.8) {
      inp.throttle = 0;
      inp.brake = THREE.MathUtils.clamp(-dv * 0.22, 0.1, 1);
    } else {
      inp.throttle = 0.35; inp.brake = 0;
    }

    // DRS whenever legal and flat-out
    if (car.drsAvailable && inp.throttle > 0.9 && !car.drsActive) car.drsActive = true;

    // ── stuck detection (Game resets us) ──
    if (this.launched && v < 1.5 && raceTime > 4) this.stuckTime += dt;
    else this.stuckTime = 0;
    this.isStuck = this.stuckTime > 2.5;
  }
}
