/**
 * Dot-matrix globe on a 2D canvas: land is ~4.6k points (Natural Earth, generated at build time),
 * projected orthographically every frame. No images, no WebGL — the "3D" is depth-shaded dots,
 * a faint see-through far side and a rim light.
 *
 * Interaction: drag to spin (with inertia), idle auto-rotation, dots swell under the pointer,
 * click to pin a spot. Work per frame is a few milliseconds at most (dots are batched by shade).
 */
const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const AUTO_SPIN = 0.12;      // rad/s while idle
const IDLE_MS = 1600;        // pause before auto-spin resumes after a drag
const FRICTION_MS = 450;     // inertia half-life-ish
const HOVER_PX = 46;
const SHADES = 10;           // alpha buckets → one fill per bucket

export interface GeoPoint { lat: number; lon: number }

export interface Globe {
  /** Starts/stops the animation loop (run only while the News page is visible). */
  setActive(on: boolean): void;
  /** Called with the coordinates under the pointer (or the pinned spot), null when off the globe. */
  onReadout(fn: (p: GeoPoint | null, pinned: boolean) => void): void;
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
  let colors = { dot: css('--text-muted'), hi: css('--text-strong'), accent: css('--accent'), rim: css('--line-strong') };

  // start facing home (Korea), tilted so it sits a little above centre
  let yaw = -home.lon * DEG;
  let pitch = 0.42;
  let vYaw = AUTO_SPIN, vPitch = 0;
  let lastTouch = -Infinity;
  let pointer: { x: number; y: number } | null = null;
  let drag: { x: number; y: number; t: number } | null = null;
  let moved = 0;
  let pinned: GeoPoint | null = null;
  let readout: (p: GeoPoint | null, pinned: boolean) => void = () => {};

  let dpr = 1, size = 0, R = 0, cx = 0, cy = 0;
  const fit = () => {
    dpr = Math.min(devicePixelRatio || 1, 2.5);
    size = canvas.offsetWidth;
    canvas.width = Math.max(1, Math.round(size * dpr));
    canvas.height = canvas.width;
    R = canvas.width * 0.42;
    cx = cy = canvas.width / 2;
    colors = { dot: css('--text-muted'), hi: css('--text-strong'), accent: css('--accent'), rim: css('--line-strong') };
  };
  new ResizeObserver(fit).observe(canvas);
  fit();

  /** Screen (device px) → lat/lon on the front face, or null off the globe. */
  function unproject(sx: number, sy: number): GeoPoint | null {
    const x1 = (sx - cx) / R, y2 = -(sy - cy) / R;
    const d = x1 * x1 + y2 * y2;
    if (d > 1) return null;
    const z2 = Math.sqrt(1 - d);
    const c = Math.cos(pitch), s = Math.sin(pitch);
    const y = y2 * c + z2 * s;
    const z1 = -y2 * s + z2 * c;
    const cy_ = Math.cos(yaw), sy_ = Math.sin(yaw);
    const x = x1 * cy_ - z1 * sy_;
    const z = x1 * sy_ + z1 * cy_;
    return { lat: Math.asin(Math.max(-1, Math.min(1, y))) / DEG, lon: Math.atan2(x, z) / DEG };
  }

  /** lat/lon → screen (device px) + depth (z > 0 faces the viewer). */
  function project(p: GeoPoint): { x: number; y: number; z: number } {
    const φ = p.lat * DEG, λ = p.lon * DEG;
    const x = Math.cos(φ) * Math.sin(λ), y = Math.sin(φ), z = Math.cos(φ) * Math.cos(λ);
    const cY = Math.cos(yaw), sY = Math.sin(yaw), cP = Math.cos(pitch), sP = Math.sin(pitch);
    const x1 = x * cY + z * sY, z1 = -x * sY + z * cY;
    return { x: cx + R * x1, y: cy - R * (y * cP - z1 * sP), z: y * sP + z1 * cP };
  }

  const local = (e: PointerEvent) => {
    const box = canvas.getBoundingClientRect();
    return { x: (e.clientX - box.left) * (canvas.width / box.width), y: (e.clientY - box.top) * (canvas.height / box.height) };
  };

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    const p = local(e);
    drag = { x: p.x, y: p.y, t: performance.now() };
    moved = 0;
    vYaw = vPitch = 0;
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = local(e);
    pointer = p;
    if (drag) {
      const now = performance.now();
      const dt = Math.max(1, now - drag.t);
      const dYaw = (p.x - drag.x) / R, dPitch = (p.y - drag.y) / R;
      yaw += dYaw;
      pitch = Math.max(-1.25, Math.min(1.25, pitch + dPitch));
      // velocity for the throw, smoothed
      vYaw = vYaw * 0.6 + ((dYaw / dt) * 1000) * 0.4;
      vPitch = vPitch * 0.6 + ((dPitch / dt) * 1000) * 0.4;
      moved += Math.abs(p.x - drag.x) + Math.abs(p.y - drag.y);
      drag = { x: p.x, y: p.y, t: now };
      lastTouch = now;
    }
  });
  const release = (e: PointerEvent) => {
    if (!drag) return;
    if (moved < 6 * dpr) {
      // a click (not a drag) pins that spot; clicking off the globe unpins
      pinned = unproject(local(e).x, local(e).y);
      vYaw = vPitch = 0;
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
      const idle = now - lastTouch > IDLE_MS;
      vYaw = idle ? vYaw + (AUTO_SPIN - vYaw) * (1 - decay) : vYaw * decay;
      vPitch *= decay;
      if (pinned) vYaw *= decay; // hold still while a spot is pinned
      yaw += vYaw * dt;
      pitch = Math.max(-1.25, Math.min(1.25, pitch + vPitch * dt));
    }
    draw(now);

    const hover = pointer ? unproject(pointer.x, pointer.y) : null;
    const shown = hover ?? pinned;
    const key = shown ? `${shown.lat.toFixed(1)},${shown.lon.toFixed(1)},${!hover}` : '';
    if (key !== lastReadout) {
      lastReadout = key;
      readout(shown, !hover && !!pinned);
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

    const cY = Math.cos(yaw), sY = Math.sin(yaw), cP = Math.cos(pitch), sP = Math.sin(pitch);
    const base = Math.max(0.9, R / 240) * dpr * 0.85;
    const back = new Path2D();
    const front: Path2D[] = Array.from({ length: SHADES }, () => new Path2D());
    const lit = new Path2D();
    const hx = pointer?.x ?? -1e9, hy = pointer?.y ?? -1e9;
    const reach = HOVER_PX * dpr;

    for (let i = 0; i < n; i++) {
      const x1 = px[i]! * cY + pz[i]! * sY;
      const z1 = -px[i]! * sY + pz[i]! * cY;
      const y2 = py[i]! * cP - z1 * sP;
      const z2 = py[i]! * sP + z1 * cP;
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

    // home marker: a steady dot with a slow pulse ring, only while it faces us
    const h = project(home);
    if (h.z > 0) {
      const pulse = (now % 2400) / 2400;
      ctx.fillStyle = colors.accent;
      ctx.beginPath();
      ctx.arc(h.x, h.y, base * 1.9, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = colors.accent;
      ctx.lineWidth = 1.2 * dpr;
      ctx.globalAlpha = (1 - pulse) * 0.7 * h.z;
      ctx.beginPath();
      ctx.arc(h.x, h.y, base * (2 + pulse * 9), 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // pinned spot: a ring
    if (pinned) {
      const p = project(pinned);
      if (p.z > 0) {
        ctx.strokeStyle = colors.hi;
        ctx.lineWidth = 1.4 * dpr;
        ctx.beginPath();
        ctx.arc(p.x, p.y, base * 4.5, 0, TAU);
        ctx.stroke();
      }
    }
  }

  return {
    setActive(on) {
      if (on === active) return;
      active = on;
      if (on) {
        fit();
        last = performance.now();
        raf = requestAnimationFrame(frame);
      } else {
        cancelAnimationFrame(raf);
      }
    },
    onReadout(fn) {
      readout = fn;
    },
  };
}
