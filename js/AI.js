// AI.js — opponent driver controller.
// Pure pursuit on the precomputed racing line with yaw-rate damping (no
// low-speed weave), staged launch, gap keeping and committed side moves.

class AIDriver {
  constructor(car, track, skill = 0.95) {
    this.car = car;
    this.track = track;
    this.skill = skill;                                  // 0.90 backmarker .. 0.99 ace
    this.aggression = 0.4 + Math.random() * 0.6;
    this.reaction = 0.10 + (1 - skill) * 1.6 + Math.random() * 0.15;
    this.launched = false;
    this.launchT = 0;
    this.latTarget = 0;
    this.latNow = 0;
    this.steer = 0;
    this.sideLatch = 0;
    this.sideTimer = 0;
    this.stuckTime = 0;
    this.isStuck = false;
    this.seed = Math.random() * 1000;
  }

  reset() {
    this.launched = false;
    this.launchT = 0;
    this.latNow = this.latTarget = 0;
    this.steer = 0;
    this.sideTimer = 0;
    this.stuckTime = 0;
    this.isStuck = false;
  }

  // raceTime: seconds since lights-out (negative while the lights are on)
  update(dt, raceTime, cars) {
    const car = this.car, track = this.track;
    const inp = car.input;

    // ── on the grid: hold the brakes, rev ──
    if (raceTime < this.reaction) {
      inp.throttle = raceTime > -1.5 ? 0.5 : 0;
      inp.brake = 1;
      inp.steer = 0;
      return;
    }
    const info = car._trackInfo || track.getTrackInfo(car.pos.x, car.pos.z);
    const v = car.speed;
    const lenM = track.lengthM;

    if (!this.launched) {
      this.launched = true;
      this.launchT = 0;
      inp.brake = 0;
      // launch straight in your own grid lane, merge to the line later
      this.laneHold = info.lateral - track.lineOffsetAt(info.t);
      this.latNow = this.latTarget = this.laneHold;
    }
    this.launchT += dt;

    // ── traffic: nearest car ahead (spatially, within this lap-distance) ──
    let ahead = null, aheadDist = 1e9;
    for (const o of cars) {
      if (o === car) continue;
      const d = (((o._trackInfo ? o._trackInfo.t : 0) - info.t) % 1 + 1) % 1 * lenM;
      if (d > 0.5 && d < aheadDist) { aheadDist = d; ahead = o; }
    }

    let liftFactor = 1;
    const safeGap = 3 + v * 0.30; // m
    if (ahead && aheadDist < 45) {
      const oLat = ahead._trackInfo ? ahead._trackInfo.lateral : 0;
      const sameLane = Math.abs(info.lateral - oLat) < 0.42;

      if (this.launchT < 4) {
        // opening seconds: hold your grid lane, no dive-bombing
        this.latTarget = this.laneHold || 0;
        if (sameLane && aheadDist < safeGap) liftFactor = 0.72;
      } else if (sameLane) {
        if (this.sideTimer <= 0 && aheadDist < 28 && v - ahead.speed > -1.5) {
          // commit to a pass on the emptier side for a few seconds
          const room = track.data.widthHalf - 0.40;
          const side = oLat <= 0 ? 1 : -1;
          this.sideLatch = THREE.MathUtils.clamp(oLat + side * 0.85, -room, room) -
                           track.lineOffsetAt(info.t);
          this.sideTimer = 2.5 + this.aggression * 2.5;
        }
        // never out-brake yourself into the gearbox ahead
        if (aheadDist < safeGap) {
          liftFactor = Math.min(liftFactor, Math.max(0.4, (ahead.speed + 1) / (v + 1)));
        }
      }
    }
    if (this.sideTimer > 0) {
      this.sideTimer -= dt;
      this.latTarget = this.sideLatch;
    } else if (this.launchT >= 4) {
      this.latTarget = 0;
    } else if (!ahead || aheadDist >= 45) {
      this.latTarget = this.laneHold || 0;   // launch phase, clear road ahead
    }
    this.latNow += (this.latTarget - this.latNow) * Math.min(1, dt * 2.2);

    // ── steering: pure pursuit + yaw-rate damping, slew-limited ──
    const lookM = THREE.MathUtils.clamp(v * 0.40, 10, 34);
    const tA = info.t + lookM / lenM;
    const lp = track.linePointAt(tA);
    const sA = track.posAt(tA);
    const dx = lp.x + sA.nx * this.latNow - car.pos.x;
    const dz = lp.z + sA.nz * this.latNow - car.pos.z;
    let err = Math.atan2(dx, dz) - car.heading;
    while (err > Math.PI) err -= Math.PI * 2;
    while (err < -Math.PI) err += Math.PI * 2;
    // positive heading error needs negative input.steer (screen-left); the
    // yaw-rate term counters rotation so the car settles instead of weaving
    let cmd = THREE.MathUtils.clamp(-err * 2.0 + (car.yawRate || 0) * 0.38, -1, 1);
    this.steer += THREE.MathUtils.clamp(cmd - this.steer, -dt * 9, dt * 9);
    inp.steer = this.steer;

    // ── speed: profile-following with skill pace + small human wobble ──
    const wobble = 1 + (1 - this.skill) * 0.06 * Math.sin(info.t * 43 + this.seed);
    const look2 = info.t + Math.max(6, v * 0.22) / lenM;
    let vt = Math.min(track.lineSpeedAt(info.t), track.lineSpeedAt(look2));
    vt *= this.skill * wobble * liftFactor;
    if (info.surface === 'runoff') vt = Math.min(vt, 16);

    const dv = vt - v;
    if (this.launchT < 1.4) {
      inp.throttle = 0.65 + 0.35 * (this.launchT / 1.4);   // progressive launch
      inp.brake = 0;
    } else if (dv > 0.4) {
      inp.throttle = THREE.MathUtils.clamp(0.3 + dv * 0.4, 0, 1);
      inp.brake = 0;
    } else if (dv < -0.8) {
      inp.throttle = 0;
      inp.brake = THREE.MathUtils.clamp(-dv * 0.25, 0.15, 1);
    } else {
      inp.throttle = 0.4;
      inp.brake = 0;
    }

    if (car.drsAvailable && inp.throttle > 0.85 && !car.drsActive) car.drsActive = true;

    // ── stuck detection (Game performs the reset) ──
    if (v < 1.5 && raceTime > 5) this.stuckTime += dt;
    else this.stuckTime = 0;
    this.isStuck = this.stuckTime > 2.5;
  }
}
