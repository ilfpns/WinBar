/**
 * Dot-matrix globe on a 2D canvas: land is ~4.6k points (Natural Earth, generated at build time),
 * projected orthographically every frame. No images, no WebGL — the "3D" is depth-shaded dots,
 * a faint see-through far side and a rim light.
 *
 * Interaction: drag to spin (with inertia), idle auto-rotation, dots swell under the pointer,
 * click a pin to pick that place. Strictly monochrome. Work per frame is a few milliseconds at most (dots are batched by shade).
 */
const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const AUTO_SPIN = 0.12;      // rad/s while idle
const IDLE_MS = 1600;        // pause before auto-spin resumes after a drag
const FRICTION_MS = 450;     // inertia half-life-ish
const HOVER_PX = 46;
const SHADES = 10;           // alpha buckets → one fill per bucket
const PIN_HIT_PX = 16;       // how close a click must land to a pin
const FLASH_MS = 2600;       // a pin that just got news pulses this long
const AIM_MS = 260;          // turning a picked place to the front: time constant

export interface GeoPoint { lat: number; lon: number }

/** A place with news: drawn as a pin, picked by clicking it. `weight` (0..1) sizes it. */
export interface Marker extends GeoPoint { id: string; label: string; weight: number }

export interface Globe {
  /** Starts/stops the animation loop (run only while the News page is visible). */
  setActive(on: boolean): void;
  /** Draws a few frames up front (page laid out but not shown) so the first visible frame is already hot. */
  warm(): void;
  /** Called with the coordinates under the pointer, null when off the globe. */
  onReadout(fn: (p: GeoPoint | null) => void): void;
  setMarkers(markers: Marker[]): void;
  /** Called when a pin is clicked (its id), or when a click on the globe lands away from every pin (null). */
  onPick(fn: (id: string | null) => void): void;
  /** Highlights a pin and turns the globe to bring it to the front; null lets go. */
  select(id: string | null): void;
  /** Pulses these pins (they just got news). */
  flash(ids: string[]): void;
}

export function createGlobe(canvas: HTMLCanvasElement, landLatLon: [number, number][], home: GeoPoint): Globe {
  const ctx = canvas.getContext('2d')!;
  const n = landLatLon.length;
  // unit vectors: x right, y up, z toward the viewer at lon 0
  const px = new Float32Array(n), py = new Float32Array(n), pz = new Float32Array(n);
  landLatLon.forEach(([lat, lon], i) => {
    const φ = lat * DEG, λ = lon * DEG;
    px[i] = Math.cos(φ) * Math.sin(λ);
    py[i] = Math.sin(φ);
    pz[i] = Math.cos(φ) * Math.cos(λ);
  });

  const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  let colors = { dot: css('--text-muted'), hi: css('--text-strong'), rim: css('--line-strong') };

  // orientation is a 3×3 rotation (row-major), so drags roll the ball freely — over the poles too.
  // Screen-space turns pre-multiply (roll the ball as seen); the idle spin post-multiplies (around Earth's own axis).
  let M = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const mul = (a: number[], b: number[]) => [
    a[0]! * b[0]! + a[1]! * b[3]! + a[2]! * b[6]!, a[0]! * b[1]! + a[1]! * b[4]! + a[2]! * b[7]!, a[0]! * b[2]! + a[1]! * b[5]! + a[2]! * b[8]!,
    a[3]! * b[0]! + a[4]! * b[3]! + a[5]! * b[6]!, a[3]! * b[1]! + a[4]! * b[4]! + a[5]! * b[7]!, a[3]! * b[2]! + a[4]! * b[5]! + a[5]! * b[8]!,
    a[6]! * b[0]! + a[7]! * b[3]! + a[8]! * b[6]!, a[6]! * b[1]! + a[7]! * b[4]! + a[8]! * b[7]!, a[6]! * b[2]! + a[7]! * b[5]! + a[8]! * b[8]!,
  ];
  /** Rotation about the vertical axis (left/right). */
  const rotY = (t: number) => { const c = Math.cos(t), s = Math.sin(t); return [c, 0, s, 0, 1, 0, -s, 0, c]; };
  /** Rotation about the horizontal axis (up/down). */
  const rotX = (t: number) => { const c = Math.cos(t), s = Math.sin(t); return [1, 0, 0, 0, c, -s, 0, s, c]; };
  /** Keep M a clean rotation after many small steps (Gram–Schmidt on the rows). */
  const tidy = () => {
    const r0 = [M[0]!, M[1]!, M[2]!], r1 = [M[3]!, M[4]!, M[5]!];
    const n0 = Math.hypot(...r0); r0.forEach((v, i) => (r0[i] = v / n0));
    const d = r0[0]! * r1[0]! + r0[1]! * r1[1]! + r0[2]! * r1[2]!;
    r1.forEach((v, i) => (r1[i] = v - d * r0[i]!));
    const n1 = Math.hypot(...r1); r1.forEach((v, i) => (r1[i] = v / n1));
    const r2 = [r0[1]! * r1[2]! - r0[2]! * r1[1]!, r0[2]! * r1[0]! - r0[0]! * r1[2]!, r0[0]! * r1[1]! - r0[1]! * r1[0]!];
    M = [...r0, ...r1, ...r2];
  };
  /** Roll the ball as seen on screen: dx turns it sideways, dy over the top — any amount, any direction. */
  const roll = (dx: number, dy: number) => { M = mul(rotX(dy), mul(rotY(dx), M)); };

  // start facing home (Korea), tilted so it sits a little above centre
  M = mul(rotX(0.42), rotY(-home.lon * DEG));
  let vx = 0, vy = 0;           // screen-space angular velocity from a throw (rad/s)
  let spin = AUTO_SPIN;         // idle rotation about Earth's axis (rad/s)
  let lastTouch = -Infinity;
  let pointer: { x: number; y: number } | null = null;
  let drag: { x: number; y: number; t: number } | null = null;
  let moved = 0;
  let readout: (p: GeoPoint | null) => void = () => {};
  let markers: Marker[] = [];
  let selected: Marker | null = null;
  let hoverPin: Marker | null = null;
  const flashes = new Map<string, number>();
  let pick: (id: string | null) => void = () => {};
  /** A place being turned to the front (after it was picked). */
  let aim: GeoPoint | null = null;

  let dpr = 1, size = 0, R = 0, cx = 0, cy = 0;
  const fit = () => {
    dpr = Math.min(devicePixelRatio || 1, 2.5);
    size = canvas.offsetWidth;
    const w = Math.max(1, Math.round(size * dpr));
    // assigning width clears and re-allocates the bitmap: only do it when the size actually changed
    if (canvas.width !== w) {
      canvas.width = w;
      canvas.height = w;
    }
    R = canvas.width * 0.42;
    cx = cy = canvas.width / 2;
    colors = { dot: css('--text-muted'), hi: css('--text-strong'), rim: css('--line-strong') };
  };
  new ResizeObserver(fit).observe(canvas);
  fit();

  /** Screen (device px) → lat/lon on the front face, or null off the globe. */
  function unproject(sx: number, sy: number): GeoPoint | null {
    if (!R) return null;
    const x1 = (sx - cx) / R, y2 = -(sy - cy) / R;
    const d = x1 * x1 + y2 * y2;
    if (d > 1) return null;
    const z2 = Math.sqrt(1 - d);
    // inverse of a rotation is its transpose
    const x = M[0]! * x1 + M[3]! * y2 + M[6]! * z2;
    const y = M[1]! * x1 + M[4]! * y2 + M[7]! * z2;
    const z = M[2]! * x1 + M[5]! * y2 + M[8]! * z2;
    return { lat: Math.asin(Math.max(-1, Math.min(1, y))) / DEG, lon: Math.atan2(x, z) / DEG };
  }

  /** lat/lon → screen (device px) + depth (z > 0 faces the viewer). */
  function project(p: GeoPoint): { x: number; y: number; z: number } {
    const φ = p.lat * DEG, λ = p.lon * DEG;
    const x = Math.cos(φ) * Math.sin(λ), y = Math.sin(φ), z = Math.cos(φ) * Math.cos(λ);
    return {
      x: cx + R * (M[0]! * x + M[1]! * y + M[2]! * z),
      y: cy - R * (M[3]! * x + M[4]! * y + M[5]! * z),
      z: M[6]! * x + M[7]! * y + M[8]! * z,
    };
  }

  const local = (e: PointerEvent) => {
    const box = canvas.getBoundingClientRect();
    return { x: (e.clientX - box.left) * (canvas.width / box.width), y: (e.clientY - box.top) * (canvas.height / box.height) };
  };

  /** Is a canvas point on the sphere (the only part that drags/pins)? */
  const onSphere = (p: { x: number; y: number }) => Math.hypot(p.x - cx, p.y - cy) <= R;

  /** The front-facing pin nearest to a canvas point, within reach. */
  function pinAt(p: { x: number; y: number }): Marker | null {
    let best: Marker | null = null;
    let bestD = PIN_HIT_PX * dpr;
    for (const m of markers) {
      const s = project(m);
      if (s.z <= 0.05) continue;
      const d = Math.hypot(s.x - p.x, s.y - p.y);
      if (d < bestD) {
        bestD = d;
        best = m;
      }
    }
    return best;
  }

  /** Rodrigues rotation (row-major) of `angle` about the unit `axis`. */
  const rotAxis = (ax: number, ay: number, az: number, angle: number) => {
    const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c;
    return [
      t * ax * ax + c, t * ax * ay - s * az, t * ax * az + s * ay,
      t * ax * ay + s * az, t * ay * ay + c, t * ay * az - s * ax,
      t * ax * az - s * ay, t * ay * az + s * ax, t * az * az + c,
    ];
  };

  canvas.addEventListener('pointerdown', (e) => {
    const p = local(e);
    if (!onSphere(p)) return; // corners of the canvas behave like the page background
    canvas.setPointerCapture(e.pointerId);
    drag = { x: p.x, y: p.y, t: performance.now() };
    moved = 0;
    vx = vy = 0;
    aim = null; // grabbing the globe takes over from any turn in progress
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = local(e);
    pointer = p;
    if (drag) {
      const now = performance.now();
      const dt = Math.max(1, now - drag.t);
      const dx = (p.x - drag.x) / R, dy = (p.y - drag.y) / R;
      roll(dx, dy);
      // velocity for the throw, smoothed
      vx = vx * 0.6 + ((dx / dt) * 1000) * 0.4;
      vy = vy * 0.6 + ((dy / dt) * 1000) * 0.4;
      spin = 0;
      moved += Math.abs(p.x - drag.x) + Math.abs(p.y - drag.y);
      drag = { x: p.x, y: p.y, t: now };
      lastTouch = now;
    }
  });
  const release = (e: PointerEvent) => {
    if (!drag) return;
    if (moved < 6 * dpr) {
      // a click (not a drag) on a pin picks that place; anywhere else lets go of it
      pick(pinAt(local(e))?.id ?? null);
      vx = vy = 0;
    }
    drag = null;
    lastTouch = performance.now();
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('pointerleave', () => {
    if (!drag) pointer = null;
  });
  // belt and braces: any pointer movement over something else clears the hover
  addEventListener('pointermove', (e) => {
    if (!drag && e.target !== canvas) pointer = null;
  }, { passive: true });

  let active = false;
  let raf = 0;
  let last = performance.now();
  let lastReadout = '';

  function frame(now: number): void {
    const dt = Math.min(64, now - last) / 1000;
    last = now;
    if (!drag) {
      // inertia, then drift back into a slow spin once the user lets go
      const decay = Math.exp((-dt * 1000) / FRICTION_MS);
      vx *= decay;
      vy *= decay;
      // after a pause, ease back into turning about Earth's own axis (held still while a spot or place is picked)
      const target = !selected && !aim && now - lastTouch > IDLE_MS ? AUTO_SPIN : 0;
      spin += (target - spin) * (1 - decay);
      roll(vx * dt, vy * dt);
      M = mul(M, rotY(spin * dt));
      if (aim) {
        // turn the shortest way until the picked place faces the viewer
        const φ = aim.lat * DEG, λ = aim.lon * DEG;
        const x = Math.cos(φ) * Math.sin(λ), y = Math.sin(φ), z = Math.cos(φ) * Math.cos(λ);
        const v = [M[0]! * x + M[1]! * y + M[2]! * z, M[3]! * x + M[4]! * y + M[5]! * z, M[6]! * x + M[7]! * y + M[8]! * z];
        const angle = Math.acos(Math.max(-1, Math.min(1, v[2]!)));
        if (angle < 0.002) aim = null;
        else {
          // axis = v × viewer (0, 0, 1); straight behind, any axis in the screen plane will do
          let ax = v[1]!, ay = -v[0]!;
          const len = Math.hypot(ax, ay);
          if (len < 1e-6) { ax = 0; ay = 1; } else { ax /= len; ay /= len; }
          M = mul(rotAxis(ax, ay, 0, angle * (1 - Math.exp((-dt * 1000) / AIM_MS))), M);
        }
      }
      tidy();
    }
    // while pages slide the canvas holds its last frame: no re-raster/upload of a moving layer
    if (!document.body.classList.contains('switching')) draw(now);

    const pin = pointer && !drag ? pinAt(pointer) : null;
    if (pin !== hoverPin) {
      hoverPin = pin;
      canvas.style.cursor = pin ? 'pointer' : '';
    }
    const hover = pointer ? unproject(pointer.x, pointer.y) : null;
    const key = hover ? `${hover.lat.toFixed(1)},${hover.lon.toFixed(1)}` : '';
    if (key !== lastReadout) {
      lastReadout = key;
      readout(hover);
    }
    if (active) raf = requestAnimationFrame(frame);
  }

  function draw(now: number): void {
    const w = canvas.width;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, w);

    // body: a dark sphere with a soft lit edge, so the dots read as sitting on a ball
    const body = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.1, cx, cy, R * 1.05);
    body.addColorStop(0, 'rgba(255,255,255,0.045)');
    body.addColorStop(0.7, 'rgba(255,255,255,0.012)');
    body.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = colors.rim;
    ctx.lineWidth = dpr;
    ctx.stroke();

    const [m0, m1, m2, m3, m4, m5, m6, m7, m8] = M as [number, number, number, number, number, number, number, number, number];
    const base = Math.max(0.9, R / 240) * dpr * 0.85;
    const back = new Path2D();
    const front: Path2D[] = Array.from({ length: SHADES }, () => new Path2D());
    const lit = new Path2D();
    const hx = pointer?.x ?? -1e9, hy = pointer?.y ?? -1e9;
    const reach = HOVER_PX * dpr;

    for (let i = 0; i < n; i++) {
      const x = px[i]!, y = py[i]!, z = pz[i]!;
      const x1 = m0 * x + m1 * y + m2 * z;
      const y2 = m3 * x + m4 * y + m5 * z;
      const z2 = m6 * x + m7 * y + m8 * z;
      const sx = cx + R * x1, sy = cy - R * y2;
      if (z2 <= 0) {
        // the far side shows faintly through the globe
        const r = base * 0.55;
        back.moveTo(sx + r, sy);
        back.arc(sx, sy, r, 0, TAU);
        continue;
      }
      const dx = sx - hx, dy = sy - hy;
      const near = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) / reach);
      const r = base * (0.6 + 0.55 * z2) * (1 + 0.9 * near * near);
      const path = near > 0.25 ? lit : front[Math.min(SHADES - 1, Math.floor(z2 * SHADES))]!;
      path.moveTo(sx + r, sy);
      path.arc(sx, sy, r, 0, TAU);
    }

    ctx.fillStyle = colors.dot;
    ctx.globalAlpha = 0.07;
    ctx.fill(back);
    for (let b = 0; b < SHADES; b++) {
      ctx.globalAlpha = 0.18 + 0.82 * ((b + 0.5) / SHADES) ** 1.3;
      ctx.fill(front[b]!);
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = colors.hi;
    ctx.fill(lit);

    // home marker: a steady dot with a slow pulse ring, only while it faces us (monochrome like the rest)
    const h = project(home);
    if (h.z > 0) {
      const pulse = (now % 2400) / 2400;
      ctx.fillStyle = colors.hi;
      ctx.beginPath();
      ctx.arc(h.x, h.y, base * 1.9, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = colors.hi;
      ctx.lineWidth = 1.2 * dpr;
      ctx.globalAlpha = (1 - pulse) * 0.7 * h.z;
      ctx.beginPath();
      ctx.arc(h.x, h.y, base * (2 + pulse * 9), 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    drawMarkers(now, base);
  }

  /** News pins: a ring sized by how much is new there; the hovered or picked one is filled and named. */
  function drawMarkers(now: number, base: number): void {
    ctx.font = `500 ${11 * dpr}px ${css('--font-mono') || 'monospace'}`;
    ctx.textBaseline = 'middle';
    for (const m of markers) {
      const p = project(m);
      if (p.z <= 0) continue;
      const fade = Math.min(1, p.z * 2.5); // pins near the rim fade out as they turn away
      const on = m === selected || m === hoverPin;
      const r = base * (2.2 + 1.6 * m.weight) * (on ? 1.25 : 1);
      ctx.globalAlpha = fade;
      ctx.strokeStyle = colors.hi;
      ctx.lineWidth = 1.3 * dpr;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, TAU);
      ctx.stroke();
      ctx.fillStyle = colors.hi;
      ctx.beginPath();
      ctx.arc(p.x, p.y, on ? r * 0.62 : base * 0.9, 0, TAU);
      ctx.fill();
      // fresh news: a ring rippling outward for a few seconds
      const since = now - (flashes.get(m.id) ?? -Infinity);
      if (since < FLASH_MS) {
        const t = (since % 1300) / 1300;
        ctx.globalAlpha = fade * (1 - t) * 0.8;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + base * 7 * t, 0, TAU);
        ctx.stroke();
      }
      if (on) {
        ctx.globalAlpha = fade;
        const tx = p.x + r + 6 * dpr;
        const w = ctx.measureText(m.label).width;
        // a dark plate keeps the name readable over the dots
        ctx.fillStyle = 'rgba(10,10,10,0.82)';
        ctx.fillRect(tx - 4 * dpr, p.y - 9 * dpr, w + 8 * dpr, 18 * dpr);
        ctx.fillStyle = colors.hi;
        ctx.fillText(m.label, tx, p.y + 0.5 * dpr);
      }
    }
    ctx.globalAlpha = 1;
  }

  return {
    setMarkers(next) {
      markers = next;
      if (selected) selected = markers.find((m) => m.id === selected!.id) ?? null;
    },
    onPick(fn) {
      pick = fn;
    },
    select(id) {
      selected = id ? markers.find((m) => m.id === id) ?? null : null;
      if (selected) {
        aim = { lat: selected.lat, lon: selected.lon };
        vx = vy = 0;
      }
    },
    flash(ids) {
      const now = performance.now();
      for (const id of ids) flashes.set(id, now);
    },
    setActive(on) {
      if (on === active) return;
      active = on;
      if (on) {
        fit();
        last = performance.now();
        draw(last); // up to date the moment it starts sliding in
        raf = requestAnimationFrame(frame);
      } else {
        cancelAnimationFrame(raf);
      }
    },
    onReadout(fn) {
      readout = fn;
    },
    warm() {
      fit();
      for (let i = 0; i < 4; i++) draw(performance.now());
    },
  };
}
