/* PPG2ECG project page — hero animation, simulator demo, interactive case studies. Vanilla JS, Canvas 2D. */
(() => {
  "use strict";

  const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const FONT = '"Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  const MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
  const C = {
    ppg: "#e0573e", ecg: "#15896a", flow: "#6d4fb0", blue: "#2f6db0",
    text: "#0f172a", muted: "#475569", faint: "#8a94a6",
    panel: "#ffffff", panelLine: "rgba(15,23,42,0.10)", grid: "rgba(15,23,42,0.05)",
    ink: "rgba(15,23,42,0.5)",
  };
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
  const easeInOutSine = (t) => 0.5 - 0.5 * Math.cos(Math.PI * t);
  const wrapPi = (x) => ((((x + Math.PI) % TAU) + TAU) % TAU) - Math.PI;

  // Seeded PRNG so the hero looks the same on every load.
  let seed = 20260;
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-9)) * Math.cos(TAU * rand());

  function fitCanvas(canvas) {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(rect.width)), h = Math.max(1, Math.round(rect.height));
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) { canvas.width = w * dpr; canvas.height = h * dpr; }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  function arrow(ctx, x0, y0, x1, y1, color, label, labelSide = -1) {
    const ang = Math.atan2(y1 - y0, x1 - x0);
    ctx.save();
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - 8 * Math.cos(ang - 0.45), y1 - 8 * Math.sin(ang - 0.45));
    ctx.lineTo(x1 - 8 * Math.cos(ang + 0.45), y1 - 8 * Math.sin(ang + 0.45));
    ctx.closePath(); ctx.fill();
    if (label) {
      ctx.font = `500 11px ${MONO}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
      const horizontal = Math.abs(x1 - x0) > Math.abs(y1 - y0);
      ctx.fillText(label, horizontal ? mx : mx + 34, horizontal ? my + 14 * labelSide : my);
    }
    ctx.restore();
  }

  /* ------------------------------------------------------------------ */
  /* Electro-hemodynamic toy simulator: one cardiac phase, two signals.  */
  /* ------------------------------------------------------------------ */
  const FS = 240;            // samples per second kept in the ring buffers
  const PAT = 0.22;          // pulse-arrival delay in seconds
  const WAVES = [            // phase (rad), amplitude, width — P, Q, R, S, T
    [-1.22, 0.13, 0.22], [-0.24, -0.10, 0.075], [0.0, 1.0, 0.085], [0.24, -0.22, 0.09], [1.95, 0.32, 0.38],
  ];

  class CardiacSim {
    constructor() { this.t = 0; this.theta = 0; this.hr = 72; this.omega = TAU * this.hr / 60; }
    hrAt(t) { return 74 + 7 * Math.sin(TAU * t / 29) + 2.5 * Math.sin(TAU * t / 7.1); }
    step(dt) {
      this.t += dt; this.hr = this.hrAt(this.t); this.omega = TAU * this.hr / 60; this.theta += this.omega * dt;
    }
    ecg(theta, t) {
      let z = 0;
      for (const [th, a, b] of WAVES) { const d = wrapPi(theta - th); z += a * Math.exp(-(d * d) / (2 * b * b)); }
      return z + 0.025 * Math.sin(TAU * 0.28 * t) + 0.012 * gauss();
    }
    ppg(theta, t) {
      const phi = ((theta - this.omega * PAT) % TAU + TAU) % TAU;         // phase since the delayed R peak
      const systolic = Math.exp(-Math.pow((phi - 1.05) / 0.46, 2));
      const diastolic = 0.42 * Math.exp(-Math.pow((phi - 2.75) / 0.95, 2));
      const resp = 0.92 + 0.08 * Math.sin(TAU * 0.23 * t);
      return resp * (systolic + diastolic) + 0.006 * gauss();
    }
  }

  class Ring {
    constructor(seconds) { this.n = Math.round(seconds * FS); this.buf = new Float32Array(this.n); this.head = 0; this.filled = 0; }
    push(v) { this.buf[this.head] = v; this.head = (this.head + 1) % this.n; this.filled = Math.min(this.filled + 1, this.n); }
    at(i) { return this.buf[(this.head + i) % this.n]; }     // i = 0 oldest … n-1 newest
  }

  const sim = new CardiacSim();
  const ecgRing = new Ring(6), ppgRing = new Ring(6);
  let simAcc = 0;
  function advanceSim(dt, maxSteps = FS) {
    simAcc += dt;
    const step = 1 / FS;
    let guard = 0;
    while (simAcc >= step && guard++ < maxSteps) {
      sim.step(step);
      ecgRing.push(sim.ecg(sim.theta, sim.t));
      ppgRing.push(sim.ppg(sim.theta, sim.t));
      simAcc -= step;
    }
    if (guard >= maxSteps) simAcc = 0;   // dropped frames: skip ahead instead of catching up
  }
  // Pre-fill the whole window so the first frame already shows full traces.
  advanceSim(6.5, 7 * FS);

  function traceX(ring, i, x, w) { return x + (i / (ring.n - 1)) * w; }

  function drawTrace(ctx, ring, rect, color, base, scale, glow = true, width = 1.8, fromFrac = 0, toFrac = 1) {
    const i0 = Math.floor(fromFrac * (ring.n - 1)), i1 = Math.floor(toFrac * (ring.n - 1));
    const path = () => {
      ctx.beginPath();
      for (let i = i0; i <= i1; i++) {
        const px = traceX(ring, i, rect.x, rect.w), py = rect.y + rect.h * base - ring.at(i) * scale;
        if (i === i0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
    };
    ctx.save();
    ctx.lineJoin = "round"; ctx.lineCap = "round";
    if (glow) { ctx.globalAlpha = 0.18; ctx.strokeStyle = color; ctx.lineWidth = width + 5; path(); ctx.stroke(); }
    ctx.globalAlpha = 1; ctx.strokeStyle = color; ctx.lineWidth = width; path(); ctx.stroke();
    ctx.restore();
  }

  function drawPanel(ctx, rect, title, right) {
    ctx.save();
    roundRect(ctx, rect.x, rect.y, rect.w, rect.h, 12);
    ctx.fillStyle = C.panel; ctx.fill();
    ctx.strokeStyle = C.panelLine; ctx.lineWidth = 1; ctx.stroke();
    ctx.clip();
    ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
    for (let gx = rect.x + 24; gx < rect.x + rect.w; gx += 24) { ctx.beginPath(); ctx.moveTo(gx, rect.y); ctx.lineTo(gx, rect.y + rect.h); ctx.stroke(); }
    for (let gy = rect.y + 24; gy < rect.y + rect.h; gy += 24) { ctx.beginPath(); ctx.moveTo(rect.x, gy); ctx.lineTo(rect.x + rect.w, gy); ctx.stroke(); }
    ctx.restore();
    ctx.save();
    ctx.font = `700 11px ${FONT}`; ctx.fillStyle = C.muted; ctx.textBaseline = "top"; ctx.textAlign = "left";
    ctx.fillText(title.toUpperCase(), rect.x + 14, rect.y + 12);
    if (right) { ctx.textAlign = "right"; ctx.font = `500 12px ${MONO}`; ctx.fillStyle = right.color; ctx.fillText(right.text, rect.x + rect.w - 14, rect.y + 11); }
    ctx.restore();
  }

  /* ------------------------------------------------------------------ */
  /* Latent rectified flow particles (noise → ECG latent).               */
  /* ------------------------------------------------------------------ */
  const SLOTS = 8;
  class Flow {
    constructor(n) { this.ps = []; for (let i = 0; i < n; i++) this.ps.push(this.spawn(i / n)); this.guides = []; for (let i = 0; i < 7; i++) this.guides.push({ sy: gauss() * 0.9, slot: i, bend: (rand() - 0.5) * 0.6 }); this.clock = 0; }
    spawn(p) { return { p, dur: 2.4 + rand() * 1.6, sx: gauss() * 0.9, sy: gauss() * 0.9, slot: Math.floor(rand() * SLOTS), bend: (rand() - 0.5) * 0.7 }; }
    update(dt) { this.clock += dt; for (const p of this.ps) { p.p += dt / p.dur; if (p.p >= 1) Object.assign(p, this.spawn(0)); } }
    geometry(zone) {
      const start = { x: zone.x + zone.w * 0.2, y: zone.y + zone.h * 0.5, sx: zone.w * 0.075, sy: zone.h * 0.24 };
      const end = { x: zone.x + zone.w * 0.84, y: zone.y + zone.h * 0.5, cell: Math.min(11, zone.h * 0.075) };
      const slotY = (k) => end.y + (k - (SLOTS - 1) / 2) * (end.cell + 3);
      return { start, end, slotY, bulge: zone.h * 0.26 };
    }
    pointOn(g, sx, sy, slot, bend, t) {
      const x0 = g.start.x + sx * g.start.sx, y0 = g.start.y + sy * g.start.sy;
      const x1 = g.end.x - g.end.cell * 0.6, y1 = g.slotY(slot);
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2 + g.bulge * (0.55 + bend);
      const u = 1 - t;
      return { x: u * u * x0 + 2 * u * t * cx + t * t * x1, y: u * u * y0 + 2 * u * t * cy + t * t * y1 };
    }
    draw(ctx, zone) {
      const g = this.geometry(zone);
      ctx.save();
      // faint guide trajectories
      ctx.setLineDash([3, 5]); ctx.lineWidth = 1; ctx.strokeStyle = "rgba(109,79,176,0.28)";
      for (const gd of this.guides) {
        ctx.beginPath();
        for (let k = 0; k <= 24; k++) { const q = this.pointOn(g, 0, gd.sy, gd.slot, gd.bend, k / 24); if (k === 0) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y); }
        ctx.stroke();
      }
      ctx.setLineDash([]);
      // mean transport path
      ctx.lineWidth = 2.2; ctx.strokeStyle = C.flow; ctx.beginPath();
      for (let k = 0; k <= 32; k++) { const q = this.pointOn(g, 0, 0, (SLOTS - 1) / 2, 0, k / 32); if (k === 0) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y); }
      ctx.stroke();
      // noise cloud
      for (let i = 0; i < 46; i++) {
        const a = (i * 2.399) % TAU, r = Math.sqrt(((i * 7919) % 1000) / 1000);
        ctx.fillStyle = `rgba(109,79,176,${0.22 + 0.35 * (1 - r)})`;
        ctx.beginPath(); ctx.arc(g.start.x + Math.cos(a) * r * g.start.sx * 1.6, g.start.y + Math.sin(a) * r * g.start.sy * 1.6, 1.6, 0, TAU); ctx.fill();
      }
      // latent cells
      for (let k = 0; k < SLOTS; k++) {
        const y = g.slotY(k), c = g.end.cell;
        const glow = 0.6 + 0.4 * Math.sin(this.clock * 2.4 - k * 0.6);
        roundRect(ctx, g.end.x - c / 2, y - c / 2, c, c, 3);
        ctx.fillStyle = `rgba(21,137,106,${0.35 + 0.5 * glow})`; ctx.fill();
        ctx.strokeStyle = "rgba(21,137,106,0.7)"; ctx.lineWidth = 1; ctx.stroke();
      }
      // particles
      for (const p of this.ps) {
        const t = easeInOutSine(p.p), q = this.pointOn(g, p.sx, p.sy, p.slot, p.bend, t);
        const r = 109 + (21 - 109) * t, gC = 79 + (137 - 79) * t, b = 176 + (106 - 176) * t;
        const alpha = Math.pow(Math.sin(p.p * Math.PI), 0.6);
        ctx.fillStyle = `rgba(${r | 0},${gC | 0},${b | 0},${0.25 * alpha})`; ctx.beginPath(); ctx.arc(q.x, q.y, 5, 0, TAU); ctx.fill();
        ctx.fillStyle = `rgba(${r | 0},${gC | 0},${b | 0},${alpha})`; ctx.beginPath(); ctx.arc(q.x, q.y, 2.2, 0, TAU); ctx.fill();
      }
      // z_t marker on the mean path
      const zt = this.pointOn(g, 0, 0, (SLOTS - 1) / 2, 0, (this.clock / 3.2) % 1);
      ctx.fillStyle = C.flow; ctx.beginPath(); ctx.arc(zt.x, zt.y, 4, 0, TAU); ctx.fill();
      ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(zt.x, zt.y, 5.5, 0, TAU); ctx.stroke();
      ctx.strokeStyle = C.flow; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(zt.x, zt.y, 7.5, 0, TAU); ctx.stroke();
      // labels
      ctx.fillStyle = C.muted; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
      ctx.font = `500 11px ${MONO}`;
      ctx.fillText("z₀ ~ N(0, I)", g.start.x, g.start.y - g.start.sy * 1.7 - 8);
      ctx.fillText("ECG latent", g.end.x, g.slotY(0) - g.end.cell - 6);
      ctx.fillStyle = C.flow; ctx.font = `italic 500 12px ${MONO}`;
      const mid = this.pointOn(g, 0, 0, (SLOTS - 1) / 2, 0, 0.5);
      ctx.fillText("vψ(zt, t, zp)", mid.x, mid.y + 24);
      ctx.fillStyle = C.faint; ctx.font = `500 11px ${MONO}`; ctx.textBaseline = "top";
      ctx.fillText("t = 0", g.start.x, zone.y + zone.h - 16); ctx.fillText("t = 1", g.end.x, zone.y + zone.h - 16);
      ctx.restore();
    }
  }
  const flow = new Flow(54);

  /* ------------------------------------------------------------------ */
  /* Hero canvas: PPG panel → flow zone → ECG panel.                     */
  /* ------------------------------------------------------------------ */
  const heroCanvas = document.getElementById("heroCanvas");
  function drawHero() {
    const { ctx, w, h } = fitCanvas(heroCanvas);
    ctx.clearRect(0, 0, w, h);
    const stacked = w < 640;
    let ppg, zone, ecg;
    if (!stacked) {
      const pw = w * 0.34, gap = 34, zw = w - 2 * pw - 2 * gap;
      ppg = { x: 0, y: 0, w: pw, h }; zone = { x: pw + gap, y: 0, w: zw, h }; ecg = { x: w - pw, y: 0, w: pw, h };
    } else {
      const ph = h * 0.29, gap = 26, zh = h - 2 * ph - 2 * gap;
      ppg = { x: 0, y: 0, w, h: ph }; zone = { x: 0, y: ph + gap, w, h: zh }; ecg = { x: 0, y: h - ph, w, h: ph };
    }
    drawPanel(ctx, ppg, "Input PPG · 40 Hz", { text: `PAT ${Math.round(PAT * 1000)} ms`, color: C.ppg });
    drawPanel(ctx, ecg, "Generated ECG · 120 Hz", { text: `${Math.round(sim.hr)} bpm`, color: C.ecg });
    const inset = (r) => ({ x: r.x + 14, y: r.y + 34, w: r.w - 28, h: r.h - 46 });
    drawTrace(ctx, ppgRing, inset(ppg), C.ppg, 0.86, inset(ppg).h * 0.62);
    drawTrace(ctx, ecgRing, inset(ecg), C.ecg, 0.68, inset(ecg).h * 0.52);
    // live cursor dots at the newest sample
    const dot = (ring, rect, base, scale, color) => {
      const r = inset(rect), x = r.x + r.w, y = r.y + r.h * base - ring.at(ring.n - 1) * scale;
      ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, 3.2, 0, TAU); ctx.fill();
    };
    dot(ppgRing, ppg, 0.86, inset(ppg).h * 0.62, C.ppg);
    dot(ecgRing, ecg, 0.68, inset(ecg).h * 0.52, C.ecg);
    // flow zone
    flow.draw(ctx, zone);
    if (!stacked) {
      arrow(ctx, ppg.x + ppg.w + 2, h * 0.5, zone.x + zone.w * 0.2 - zone.w * 0.075 * 1.8 - 6, h * 0.5, C.ink, "zp · condition", -1);
      arrow(ctx, zone.x + zone.w * 0.84 + 12, h * 0.5, ecg.x - 2, h * 0.5, C.ink, "decode", -1);
    } else {
      arrow(ctx, w * 0.5, ppg.h + 2, w * 0.5, zone.y - 2, C.ink, "zp · condition");
      arrow(ctx, w * 0.5, zone.y + zone.h + 2, w * 0.5, ecg.y - 2, C.ink, "decode");
    }
  }

  /* ------------------------------------------------------------------ */
  /* Simulator demo: phase dial + stacked ECG/PPG with δ_PAT marker.     */
  /* ------------------------------------------------------------------ */
  const simCanvas = document.getElementById("simCanvas");
  function drawSimDemo() {
    const { ctx, w, h } = fitCanvas(simCanvas);
    ctx.clearRect(0, 0, w, h);
    const narrow = w < 640;
    const dialR = narrow ? 44 : Math.min(64, h * 0.3);
    const dial = narrow ? { cx: w * 0.5, cy: dialR + 28 } : { cx: dialR + 26, cy: h * 0.5 - 8 };
    const panel = narrow
      ? { x: 0, y: dial.cy + dialR + 62, w, h: h - (dial.cy + dialR + 62) }
      : { x: dial.cx + dialR + 40, y: 0, w: w - (dial.cx + dialR + 40), h };

    // dial
    ctx.save();
    ctx.strokeStyle = "rgba(15,23,42,0.14)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(dial.cx, dial.cy, dialR, 0, TAU); ctx.stroke();
    const marks = [["P", -1.22, C.ecg], ["R", 0, C.ecg], ["T", 1.95, C.ecg], ["pulse", sim.omega * PAT + 1.05, C.ppg]];
    ctx.font = `600 11px ${MONO}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (const [label, th, color] of marks) {
      const a = th - Math.PI / 2;
      ctx.strokeStyle = color; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(dial.cx + Math.cos(a) * (dialR - 6), dial.cy + Math.sin(a) * (dialR - 6)); ctx.lineTo(dial.cx + Math.cos(a) * (dialR + 4), dial.cy + Math.sin(a) * (dialR + 4)); ctx.stroke();
      ctx.fillStyle = color; ctx.fillText(label, dial.cx + Math.cos(a) * (dialR + 16), dial.cy + Math.sin(a) * (dialR + 16));
    }
    const a = (sim.theta % TAU) - Math.PI / 2;
    ctx.strokeStyle = "rgba(15,23,42,0.4)"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(dial.cx, dial.cy); ctx.lineTo(dial.cx + Math.cos(a) * (dialR - 10), dial.cy + Math.sin(a) * (dialR - 10)); ctx.stroke();
    ctx.fillStyle = C.text; ctx.beginPath(); ctx.arc(dial.cx + Math.cos(a) * (dialR - 10), dial.cy + Math.sin(a) * (dialR - 10), 4, 0, TAU); ctx.fill();
    ctx.fillStyle = C.text; ctx.font = `italic 600 14px ${MONO}`; ctx.fillText("θ(t)", dial.cx, dial.cy - 8);
    ctx.fillStyle = C.muted; ctx.font = `500 11px ${MONO}`; ctx.fillText(`${Math.round(sim.hr)} bpm`, dial.cx, dial.cy + 11);
    ctx.fillStyle = C.faint; ctx.font = `600 10px ${FONT}`; ctx.fillText("SHARED CARDIAC PHASE", dial.cx, dial.cy + dialR + 44);
    ctx.restore();

    // traces
    const rowH = (panel.h - 18) / 2;
    const ecgRect = { x: panel.x, y: panel.y + 6, w: panel.w - 8, h: rowH };
    const ppgRect = { x: panel.x, y: panel.y + 12 + rowH, w: panel.w - 8, h: rowH };
    ctx.save();
    ctx.strokeStyle = "rgba(15,23,42,0.06)"; ctx.lineWidth = 1;
    for (let gx = panel.x; gx < panel.x + panel.w; gx += 24) { ctx.beginPath(); ctx.moveTo(gx, panel.y); ctx.lineTo(gx, panel.y + panel.h); ctx.stroke(); }
    ctx.restore();
    drawTrace(ctx, ecgRing, ecgRect, C.ecg, 0.72, rowH * 0.5, true, 1.7);
    drawTrace(ctx, ppgRing, ppgRect, C.ppg, 0.9, rowH * 0.66, true, 1.7);
    ctx.save();
    ctx.font = `700 10px ${FONT}`; ctx.textBaseline = "top"; ctx.textAlign = "left";
    ctx.fillStyle = C.ecg; ctx.fillText("ECG SIMULATOR", ecgRect.x + 2, ecgRect.y - 2);
    ctx.fillStyle = C.ppg; ctx.fillText("PPG SIMULATOR", ppgRect.x + 2, ppgRect.y - 2);
    ctx.restore();

    // δ_PAT marker: latest R peak whose PPG foot still fits in the window
    const n = ecgRing.n, patSamples = Math.round(PAT * FS);
    let rIdx = -1;
    for (let i = n - 2 - patSamples - 10; i > 10; i--) {
      const v = ecgRing.at(i);
      if (v > 0.6 && v >= ecgRing.at(i - 1) && v >= ecgRing.at(i + 1)) { rIdx = i; break; }
    }
    if (rIdx > 0) {
      const xr = traceX(ecgRing, rIdx, ecgRect.x, ecgRect.w), xf = traceX(ecgRing, rIdx + patSamples, ecgRect.x, ecgRect.w);
      const yTop = ecgRect.y + 10, yBot = ppgRect.y + ppgRect.h - 2;
      ctx.save();
      ctx.setLineDash([4, 4]); ctx.lineWidth = 1; ctx.strokeStyle = "rgba(15,23,42,0.45)";
      ctx.beginPath(); ctx.moveTo(xr, yTop); ctx.lineTo(xr, yBot); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(xf, yTop); ctx.lineTo(xf, yBot); ctx.stroke();
      ctx.setLineDash([]);
      const yb = ppgRect.y + 2;
      ctx.strokeStyle = C.text; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(xr, yb); ctx.lineTo(xf, yb); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(xr, yb - 4); ctx.lineTo(xr, yb + 4); ctx.moveTo(xf, yb - 4); ctx.lineTo(xf, yb + 4); ctx.stroke();
      ctx.fillStyle = C.text; ctx.font = `italic 600 12px ${MONO}`; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
      const label = `δPAT = ${Math.round(PAT * 1000)} ms`, half = ctx.measureText(label).width / 2 + 4;
      ctx.fillText(label, clamp((xr + xf) / 2, ecgRect.x + half, ecgRect.x + ecgRect.w - half), yb - 6);
      ctx.restore();
    }
  }

  /* ------------------------------------------------------------------ */
  /* Case studies (real traces extracted from the paper figure).         */
  /* ------------------------------------------------------------------ */
  const PAPER = { ppg: "#1f77b4", ecg: "#111111", base: "#4a5c7d", ours: "#d62728", grid: "rgba(214,120,120,0.16)", gridMajor: "rgba(214,120,120,0.30)", panel: "#fffafa", ref: "rgba(120,120,120,0.45)" };
  const caseCards = Array.from(document.querySelectorAll(".case-card"));
  const caseState = { method: "PPG2ECG", data: null, sweep: caseCards.map(() => ({ start: 0, active: false, done: false })) };

  function polyline(ctx, pts, rect, upTo = 1) {
    const last = Math.max(1, Math.floor(pts.length * upTo));
    ctx.beginPath();
    for (let i = 0; i < last; i++) {
      const x = rect.x + pts[i][0] * rect.w, y = rect.y + (1 - pts[i][1]) * rect.h;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    return last;
  }

  function drawCase(card, idx, now) {
    const canvas = card.querySelector("canvas");
    const { ctx, w, h } = fitCanvas(canvas);
    ctx.clearRect(0, 0, w, h);
    const data = caseState.data && caseState.data.cases[idx];
    const gutter = 64, gap = 8, rowH = (h - 2 * gap) / 3;
    const rows = [
      { key: "PPG", label: "PPG", color: PAPER.ppg },
      { key: "ECG", label: "ECG", color: PAPER.ecg },
      { key: caseState.method, label: caseState.method, color: caseState.method === "PPG2ECG" ? PAPER.ours : PAPER.base, generated: true },
    ];
    const sw = caseState.sweep[idx];
    let prog = 1;
    if (!REDUCED && sw.active) { prog = clamp((now - sw.start) / 1150, 0, 1); if (prog >= 1) { sw.active = false; sw.done = true; } }
    else if (!sw.done && !REDUCED) prog = 0;

    rows.forEach((row, r) => {
      const rect = { x: gutter, y: r * (rowH + gap), w: w - gutter, h: rowH };
      ctx.save();
      roundRect(ctx, rect.x, rect.y, rect.w, rect.h, 4); ctx.fillStyle = PAPER.panel; ctx.fill(); ctx.clip();
      ctx.lineWidth = 1;
      for (let gx = rect.x; gx <= rect.x + rect.w; gx += 10) { ctx.strokeStyle = ((gx - rect.x) / 10) % 5 === 0 ? PAPER.gridMajor : PAPER.grid; ctx.beginPath(); ctx.moveTo(gx + 0.5, rect.y); ctx.lineTo(gx + 0.5, rect.y + rect.h); ctx.stroke(); }
      for (let gy = rect.y; gy <= rect.y + rect.h; gy += 10) { ctx.strokeStyle = ((gy - rect.y) / 10) % 5 === 0 ? PAPER.gridMajor : PAPER.grid; ctx.beginPath(); ctx.moveTo(rect.x, gy + 0.5); ctx.lineTo(rect.x + rect.w, gy + 0.5); ctx.stroke(); }
      ctx.restore();
      ctx.save();
      ctx.font = `700 11px ${FONT}`; ctx.fillStyle = row.generated ? row.color : "#334155"; ctx.textAlign = "right"; ctx.textBaseline = "middle";
      const label = row.label.length > 9 ? row.label.replace("Flow", "Flow​") : row.label;
      ctx.fillText(label, gutter - 8, rect.y + rect.h / 2);
      ctx.restore();
      if (!data) return;
      const inner = { x: rect.x + 4, y: rect.y + 3, w: rect.w - 8, h: rect.h - 6 };
      ctx.save(); ctx.lineJoin = "round"; ctx.lineCap = "round";
      if (row.generated) {
        ctx.strokeStyle = PAPER.ref; ctx.lineWidth = 1.1; polyline(ctx, data.rows.ECG, inner); ctx.stroke();
        const pts = data.rows[row.key];
        ctx.strokeStyle = row.color; ctx.lineWidth = 1.7;
        const last = polyline(ctx, pts, inner, easeOutCubic(prog)); ctx.stroke();
        if (prog > 0 && prog < 1) {
          const p = pts[last - 1], x = inner.x + p[0] * inner.w, y = inner.y + (1 - p[1]) * inner.h;
          ctx.fillStyle = row.color; ctx.globalAlpha = 0.25; ctx.beginPath(); ctx.arc(x, y, 7, 0, TAU); ctx.fill();
          ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(x, y, 3, 0, TAU); ctx.fill();
        }
      } else {
        ctx.strokeStyle = row.color; ctx.lineWidth = 1.5; polyline(ctx, data.rows[row.key], inner); ctx.stroke();
      }
      ctx.restore();
    });
  }

  function setMethod(method) {
    caseState.method = method;
    document.querySelectorAll("#methodBar button").forEach((b) => b.classList.toggle("is-active", b.dataset.method === method));
    const now = performance.now();
    caseCards.forEach((card, i) => {
      card.classList.toggle("is-baseline", method !== "PPG2ECG");
      card.querySelector(".legend-gen").textContent = method;
      const chip = card.querySelector(".chip");
      chip.innerHTML = method === "PPG2ECG" ? `Pearson <em>r</em> = ${chip.dataset.r}` : `Baselines: <em>r</em> ≤ 0.21`;
      caseState.sweep[i] = { start: now + i * 120, active: true, done: false };
    });
  }
  document.querySelectorAll("#methodBar button").forEach((b) => b.addEventListener("click", () => setMethod(b.dataset.method)));

  fetch("data/cases.json").then((r) => r.json()).then((json) => { caseState.data = json; }).catch(() => {
    caseCards.forEach((c) => { c.querySelector(".case-foot").insertAdjacentHTML("beforeend", '<span class="case-meta">Trace data unavailable</span>'); });
  });

  /* ------------------------------------------------------------------ */
  /* Visibility tracking + animation loop.                               */
  /* ------------------------------------------------------------------ */
  const visible = new Map();
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      visible.set(e.target, e.isIntersecting);
      if (e.target.classList.contains("reveal") && e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
      if (e.target.classList.contains("case-card") && e.isIntersecting) {
        const i = caseCards.indexOf(e.target), sw = caseState.sweep[i];
        if (!sw.done && !sw.active) { sw.start = performance.now() + i * 120; sw.active = true; }
      }
      if (e.target.classList.contains("stats-grid") && e.isIntersecting) countUp(e.target);
    }
  }, { threshold: 0.15 });
  document.querySelectorAll(".reveal, .hero-canvas, .sim-canvas, .case-card").forEach((el) => io.observe(el));

  function countUp(grid) {
    if (grid.dataset.counted) return; grid.dataset.counted = "1";
    if (REDUCED) return;
    const start = performance.now();
    const items = Array.from(grid.querySelectorAll(".stat-v")).map((el) => ({ el, target: parseFloat(el.dataset.count), dec: parseInt(el.dataset.decimals, 10), suffix: el.querySelector("small") ? el.querySelector("small").outerHTML : "" }));
    const tick = (now) => {
      const t = easeOutCubic(clamp((now - start) / 1100, 0, 1));
      for (const it of items) it.el.innerHTML = (it.target * t).toFixed(it.dec) + it.suffix;
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  let last = performance.now();
  function frame(now) {
    const dt = clamp((now - last) / 1000, 0, 0.1); last = now;
    const heroOn = visible.get(heroCanvas) !== false, simOn = visible.get(simCanvas) === true;
    if (!REDUCED && !document.hidden && (heroOn || simOn)) { advanceSim(dt); flow.update(dt); }
    if (heroOn) drawHero();
    if (simOn) drawSimDemo();
    caseCards.forEach((card, i) => { if (visible.get(card) !== false) drawCase(card, i, now); });
    if (!REDUCED) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  if (REDUCED) {
    // Static render after fonts/data arrive.
    setTimeout(() => { drawHero(); drawSimDemo(); caseCards.forEach((c, i) => drawCase(c, i, performance.now())); }, 600);
  }
  window.addEventListener("resize", () => { if (REDUCED) { drawHero(); drawSimDemo(); caseCards.forEach((c, i) => drawCase(c, i, performance.now())); } });

  /* ------------------------------------------------------------------ */
  /* BibTeX copy.                                                        */
  /* ------------------------------------------------------------------ */
  const copyBtn = document.getElementById("copyBib");
  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(document.getElementById("bibText").textContent);
      copyBtn.textContent = "Copied"; copyBtn.classList.add("is-done");
      setTimeout(() => { copyBtn.textContent = "Copy"; copyBtn.classList.remove("is-done"); }, 1600);
    } catch (_) { copyBtn.textContent = "Select & copy"; }
  });
})();
