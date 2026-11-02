/* Storm Risk Cosmos · Texas
 * Every county is a glowing storm in a 3D scene:
 *   shape  = the peril that drives its NOAA damage (hail stones, thunderstorm-wind spiral, tornado funnel)
 *   size   = NOAA damage per year, TDI paid losses per year, or homeowners policies; dollar measures are drawn as a
 *            stack of paper money under the storm (height = dollars, one strapped bundle = a fixed amount)
 *   colour = the insurance lens picked in the top tabs (paid loss per policy, wind & hail share, premium, ...)
 * Three layouts of the same objects: Map (where counties are), Pattern (recurring vs. catastrophic groups, split at
 * the Texas medians as in the 2D analysis) and Ladder (ranked on the colour measure, one column per peril).
 * Clicking a county opens its insurance card with TDI losses by year, peril mix and its worst storm days. */
import * as THREE from "three";
import { OrbitControls } from "../vendor/three/OrbitControls.js";

const PERILS = [{ k: 0, name: "Hail", long: "Hail", c: "#5b8fc9" }, { k: 1, name: "Wind", long: "Thunderstorm wind", c: "#d9a441" }, { k: 2, name: "Tornado", long: "Tornado", c: "#8e6bb5" }];
const LAST_YEAR = 2025;
const fmtMoney = (v) => (v == null || isNaN(v) ? "n/a" : Math.abs(v) >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(Math.abs(v) >= 1e7 ? 0 : 1)}M` : Math.abs(v) >= 1e3 ? `$${Math.round(v / 1e3)}K` : `$${Math.round(v)}`);
const fmtDollar = (v) => (v == null || isNaN(v) ? "n/a" : `$${Math.round(v).toLocaleString("en-US")}`);
const fmtPct = (v) => (v == null || isNaN(v) ? "n/a" : `${Math.round(v * 100)}%`);
const fmtInt = (v) => (v == null || isNaN(v) ? "n/a" : Math.round(v).toLocaleString("en-US"));
const LENSES = {
  lossPerPolicy: { tab: "Paid loss / policy", long: "TDI homeowners paid loss per policy per year, 2019–2025", fmt: fmtDollar, log: true },
  windShare: { tab: "Wind & hail share", long: "Share of TDI paid losses from wind & hail, 2019–2025", fmt: fmtPct },
  premium: { tab: "Premium 2025", long: "Average homeowners premium with wind coverage, 2025", fmt: fmtDollar },
  premiumChange: { tab: "Premium rise", long: "Change in average homeowners premium, 2019 → 2025", fmt: (v) => (v == null || isNaN(v) ? "n/a" : `${v >= 0 ? "+" : ""}${Math.round(v * 100)}%`) },
  damagePerHome: { tab: "Storm damage / home", long: "NOAA storm damage per housing unit per year", fmt: fmtDollar, log: true },
  top1: { tab: "Catastrophe share", long: "Share of NOAA damage from the county's single worst storm day", fmt: fmtPct },
};
const SIZES = {
  damage: { label: "NOAA damage / year", fmt: fmtMoney, money: true },
  paidPerYear: { label: "TDI paid losses / year", fmt: fmtMoney, money: true },
  policies: { label: "Homeowners policies", fmt: fmtInt },
};
const GROUPS = {
  "Catastrophe-driven": { x: -30, z: -20, note: "few damaging days, one dominant day" },
  "Recurring + dominant storms": { x: 30, z: -20, note: "damage most years and a dominant day" },
  Occasional: { x: -30, z: 22, note: "few damaging days, none dominant" },
  Recurring: { x: 30, z: 22, note: "damage most years, spread out" },
  "Too few damaging days": { x: 0, z: 0, note: "fewer than 3 damaging days" },
};
const MODE_NOTE = {
  map: "Counties where they are. Big, hot storms carry big damage and big insured losses.",
  pattern: "Grouped by how damage arrives: spread over many days, or in one catastrophic day.",
  ladder: "Ranked on the colour measure, one column per driving peril. Dashed line: Texas median.",
};
const CAMERA = { map: [[7, 74, 100], [7, 0, 6]], pattern: [[7, 70, 98], [7, 0, 2]], ladder: [[5, 6, 104], [5, 1, 0]] };
const SIZE_FACTOR = { map: 1, pattern: 0.8, ladder: 0.5 };
const WIND_TILT = { map: 0.6, pattern: 0.6, ladder: 1.3 };   // wind spirals lean toward the camera
const RAMP = d3.interpolateRgbBasis(["#2c7bb6", "#2fa58f", "#e0a526", "#e8642c", "#c81d4b"]);
const NO_DATA = "#b4b8c8";

const state = { mode: "map", lens: "lossPerPolicy", size: "damage", window: 20, perils: new Set([0, 1, 2]), pattern: "all", sel: null, hover: null };
let SD, TDIDATA, CPI, CTX, TOPO, NAMES, M = new Map(), TX = {}, colorOf, sizeOf, lensScale, bundle = 1;
const BUNDLE_H = 1.1, STORM_ON_CASH = 0.85;   // world height of one bundle; storm size when it sits on a stack
const EVENTS = new Map();
const $ = (s) => document.querySelector(s);

// ---------------------------------------------------------------- metrics
function compute() {
  const w0 = LAST_YEAR - state.window + 1, n = state.window, P = [...state.perils];
  M = new Map();
  for (const f of Object.keys(NAMES)) {
    const fips = +f, rows = SD.counties[f] ?? [];
    const dmgP = [0, 0, 0], reports = [0, 0, 0], days = [];
    let total = 0;
    for (const r of rows) {
      const yr = Math.floor(r[0] / 10000); if (yr < w0) continue;
      const k = CPI.toBase[yr];
      let d = 0, c = 0; const dp = [0, 0, 0];
      for (const p of P) { dp[p] = r[1 + p] * k; d += dp[p]; c += r[4 + p]; reports[p] += r[4 + p]; dmgP[p] += dp[p]; }
      if (!c) continue;
      total += d;
      if (d > 0) days.push({ date: r[0], d, dp });
    }
    days.sort((a, b) => b.d - a.d);
    const argmax = (a) => a.indexOf(Math.max(...a));
    const dom = total > 0 ? argmax(dmgP) : d3.sum(reports) > 0 ? argmax(reports) : -1;
    // TDI homeowners, 2019–2025, in 2025 dollars
    let paid = 0, wind = 0, pol = 0, yrs = 0;
    const tdi = (TDIDATA.counties[f] ?? []).map(([year, p, w, np]) => {
      const k = CPI.toBase[year];
      if (p != null && np) { paid += p * k; wind += (w ?? 0) * k; pol += np; yrs++; }
      return { year, paid: p == null ? null : p * k, wind: w == null ? null : w * k, pol: np };
    });
    const last = tdi.length ? tdi[tdi.length - 1] : null, cx = CTX[f] ?? {};
    M.set(fips, {
      fips, name: NAMES[f], dmgP, reports, damage: total / n, nDmgDays: days.length, damagingDays: days.length / n,
      top1: total > 0 ? days[0].d / total : null, topDays: days.slice(0, 3), dom, domShare: total > 0 ? dmgP[dom] / total : null,
      tdi, paidPerYear: yrs ? paid / yrs : null, lossPerPolicy: pol ? paid / pol : null, windShare: paid > 0 ? wind / paid : null,
      policies: last?.pol ?? null, premium: cx.premium2025 ?? null, premium2019: cx.premium2019 ?? null,
      premiumChange: cx.premium2019 && cx.premium2025 ? cx.premium2025 / cx.premium2019 - 1 : null,
      homes: cx.homes ?? null, damagePerHome: cx.homes ? total / n / cx.homes : null,
    });
  }
  // recurring vs. catastrophic typology, split at the Texas medians (same rule as the 2D analysis)
  const all = [...M.values()], pts = all.filter((m) => m.nDmgDays >= 3 && m.top1 != null);
  const medX = d3.median(pts, (m) => m.damagingDays), medY = d3.median(pts, (m) => m.top1);
  for (const m of all) m.type = m.nDmgDays < 3 || m.top1 == null ? "Too few damaging days" :
    m.top1 >= medY ? (m.damagingDays >= medX ? "Recurring + dominant storms" : "Catastrophe-driven") : (m.damagingDays >= medX ? "Recurring" : "Occasional");
  // Texas totals for the header (TDI does not depend on the NOAA filters)
  let paid = 0, wind = 0, pol = 0, p19 = 0, n19 = 0, p25 = 0, n25 = 0;
  for (const m of all) {
    for (const t of m.tdi) if (t.paid != null && t.pol) { paid += t.paid; wind += t.wind ?? 0; pol += t.pol; }
    const t19 = m.tdi.find((t) => t.year === 2019), t25 = m.tdi.find((t) => t.year === 2025);
    if (m.premium2019 && t19?.pol) { p19 += m.premium2019 * t19.pol; n19 += t19.pol; }
    if (m.premium && t25?.pol) { p25 += m.premium * t25.pol; n25 += t25.pol; }
  }
  TX = { paid, windShare: wind / paid, lossPerPolicy: paid / pol, prem19: p19 / n19, prem25: p25 / n25 };
}

function buildScales() {
  const all = [...M.values()], L = LENSES[state.lens];
  const vals = all.map((m) => m[state.lens]).filter((v) => v != null && isFinite(v) && (!L.log || v > 0)).sort(d3.ascending);
  const lo = d3.quantileSorted(vals, 0.03), hi = d3.quantileSorted(vals, 0.97);
  lensScale = (L.log ? d3.scaleLog() : d3.scaleLinear()).domain([lo, hi]).range([0, 1]).clamp(true);
  lensScale.median = d3.quantileSorted(vals, 0.5);
  colorOf = (m) => { const v = m[state.lens]; return v == null || !isFinite(v) ? NO_DATA : RAMP(lensScale(L.log && v <= 0 ? lo : v)); };
  const sv = all.map((m) => m[state.size] ?? 0).sort(d3.ascending);
  const sMax = d3.quantileSorted(sv, 0.985) || 1;
  const s = d3.scaleSqrt().domain([0, sMax]).range([0.7, 3.3]).clamp(true);
  sizeOf = (m) => s(m[state.size] ?? 0);
  sizeOf.scale = s; sizeOf.max = sMax;
  // cash stacks: height is linear in dollars; one strapped bundle is a round amount so the tallest stack has ~16
  const top = d3.max(sv) || 1, raw = top / 16, p = 10 ** Math.floor(Math.log10(raw));
  bundle = [1, 2, 2.5, 5, 10].map((k) => k * p).find((v) => v >= raw);
}
const useCash = () => SIZES[state.size].money && state.mode !== "ladder";
const stackH = (m) => { const v = m[state.size] ?? 0; return v > 0 ? Math.max(0.14, (v / bundle) * BUNDLE_H) : 0; };

// ---------------------------------------------------------------- three.js scene
const canvas = $("#scene");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, 1, 0.5, 2000);
camera.position.set(...CAMERA.map[0]);
const controls = new OrbitControls(camera, canvas);
controls.target.set(...CAMERA.map[1]);
controls.enableDamping = true; controls.dampingFactor = 0.08; controls.minDistance = 20; controls.maxDistance = 220;
controls.maxPolarAngle = Math.PI * 0.62;
scene.add(new THREE.AmbientLight(0xffffff, 0.8));
const sun = new THREE.DirectionalLight(0xffffff, 1.3); sun.position.set(30, 90, 60); scene.add(sun);
const rim = new THREE.DirectionalLight(0xffffff, 0.45); rim.position.set(-60, 20, -40); scene.add(rim);

const glowTex = (() => {
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const g = c.getContext("2d"), grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, "rgba(255,255,255,0.9)"); grd.addColorStop(0.25, "rgba(255,255,255,0.35)"); grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
})();

// paper money: the top of a stack shows a banknote, the sides show the paper edges of strapped bundles
const canvasTex = (w, h, draw) => { const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
const billTop = canvasTex(256, 116, (g, w, h) => {
  g.fillStyle = "#cfe3bf"; g.fillRect(0, 0, w, h);
  g.strokeStyle = "#5f8f55"; g.lineWidth = 5; g.strokeRect(7, 7, w - 14, h - 14);
  g.lineWidth = 1.5; g.strokeRect(15, 15, w - 30, h - 30);
  g.fillStyle = "#b3d29e"; g.beginPath(); g.ellipse(w / 2, h / 2, 30, 34, 0, 0, Math.PI * 2); g.fill(); g.stroke();
  g.fillStyle = "#3f6e3a"; g.font = "bold 44px Georgia, serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("$", w / 2, h / 2 + 2);
  g.font = "bold 20px Georgia, serif"; for (const [x, y] of [[30, 30], [w - 30, 30], [30, h - 28], [w - 30, h - 28]]) g.fillText("$", x, y);
  g.fillStyle = "rgba(196, 160, 82, 0.9)"; g.fillRect(w / 2 + 52, 0, 26, h);    // paper strap
});
const billSide = canvasTex(64, 128, (g, w, h) => {
  for (let y = 0; y < h; y += 4) { g.fillStyle = y % 8 ? "#d6efc4" : "#8fc47a"; g.fillRect(0, y, w, 4); }
  g.fillStyle = "#6f9a63"; g.fillRect(0, h - 3, w, 3);                         // gap between bundles
  g.fillStyle = "rgba(196, 160, 82, 0.95)"; g.fillRect(w * 0.6, 0, w * 0.14, h);
});
billSide.wrapS = billSide.wrapT = THREE.RepeatWrapping;
const stackGeo = new THREE.BoxGeometry(1.5, 1, 0.68); stackGeo.translate(0, 0.5, 0);
const billTopMat = new THREE.MeshStandardMaterial({ map: billTop, roughness: 0.85, transparent: true });

// shape templates, about one unit in radius; clones share these geometries
const TEMPLATES = (() => {
  const stoneGeo = new THREE.IcosahedronGeometry(1, 1);
  const hail = new THREE.Group();
  for (const [x, y, z, r] of [[0, 0, 0, 0.5], [0.55, 0.25, 0.15, 0.33], [-0.5, 0.3, -0.2, 0.3], [0.12, -0.48, 0.35, 0.27], [-0.22, 0.06, 0.6, 0.22], [0.3, 0.52, -0.42, 0.2], [-0.45, -0.38, -0.3, 0.18]]) {
    const s = new THREE.Mesh(stoneGeo); s.position.set(x, y, z); s.scale.setScalar(r); s.rotation.set(x * 3, y * 3, z * 3); hail.add(s);
  }
  // thunderstorm wind: a storm spiral (four curved bands around an eye), tilted toward the viewer
  const wind = new THREE.Group(), spiral = new THREE.Group();
  for (let a = 0; a < 4; a++) {
    const pts = d3.range(0, 61).map((i) => { const t = i / 60, th = t * 2.4 * Math.PI + (a * Math.PI) / 2, r = 0.14 + 0.86 * Math.pow(t, 1.1); return new THREE.Vector3(r * Math.cos(th), 0.08 * Math.sin(t * Math.PI), r * Math.sin(th)); });
    spiral.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 70, 0.075, 6, false)));
  }
  spiral.add(new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 12)));
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.98, 0.98, 0.03, 48)); disc.userData.soft = true; spiral.add(disc);
  wind.add(spiral); wind.rotation.x = 0.6;
  // tornado: a funnel with two spiral bands and a cloud ring on top
  const tornado = new THREE.Group(), funnel = new THREE.Group(), rad = (t) => 0.07 + 0.58 * Math.pow(t, 1.7);
  const lathe = new THREE.Mesh(new THREE.LatheGeometry(d3.range(0, 21).map((i) => new THREE.Vector2(rad(i / 20), -1 + (2 * i) / 20)), 32)); lathe.userData.soft = true; funnel.add(lathe);
  for (const off of [0, Math.PI]) {
    const pts = d3.range(0, 81).map((i) => { const t = i / 80, th = t * 5 * Math.PI + off, r = rad(t) * 1.05; return new THREE.Vector3(r * Math.cos(th), -1 + 2 * t, r * Math.sin(th)); });
    funnel.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 90, 0.045, 5, false)));
  }
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.11, 8, 32)); ring.rotation.x = Math.PI / 2; ring.position.y = 1; funnel.add(ring);
  tornado.add(funnel);
  const none = new THREE.Group(); none.add(new THREE.Mesh(new THREE.SphereGeometry(0.35, 12, 10)));
  return { 0: hail, 1: wind, 2: tornado, [-1]: none };
})();
const SPIN = { 0: 0.25, 1: 0.9, 2: 1.8, [-1]: 0 };
const hitGeo = new THREE.SphereGeometry(1.15, 10, 8), hitMat = new THREE.MeshBasicMaterial({ visible: false });

const world = new THREE.Group(); scene.add(world);
const OBJ = new Map();                                       // fips -> scene object state
const hits = [];

function shapeFor(obj, dom) {
  if (obj.shape) obj.group.remove(obj.shape);
  const t = TEMPLATES[dom].clone(true);
  t.traverse((o) => { if (o.isMesh) o.material = o.userData.soft ? obj.softMat : obj.mat; });
  obj.spin = dom === 1 || dom === 2 ? t.children[0] : t;    // wind and tornado spin inside their tilted wrapper
  obj.shape = t; obj.dom = dom; obj.group.add(t);
}
function makeObj(m) {
  const obj = { fips: m.fips, group: new THREE.Group(), p0: new THREE.Vector3(), p1: new THREE.Vector3(), s0: 0.001, s1: 1, alpha: 1, alphaTo: 1 };
  obj.mat = new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.15, flatShading: true, transparent: true, emissiveIntensity: 0.5 });
  obj.softMat = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false, emissiveIntensity: 0.6 });
  obj.halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, opacity: 0.18 }));
  obj.halo.scale.setScalar(3.4); obj.group.add(obj.halo);
  obj.hit = new THREE.Mesh(hitGeo, hitMat); obj.hit.userData.fips = m.fips; obj.group.add(obj.hit); hits.push(obj.hit);
  obj.sideTex = billSide.clone();
  obj.sideMat = new THREE.MeshStandardMaterial({ map: obj.sideTex, roughness: 0.9, transparent: true });
  obj.topMat = billTopMat.clone();
  obj.stack = new THREE.Mesh(stackGeo, [obj.sideMat, obj.sideMat, obj.topMat, obj.topMat, obj.sideMat, obj.sideMat]);
  obj.stack.rotation.y = (Math.random() - 0.5) * 0.5; obj.stack.scale.y = 0.001; obj.stack.visible = false;
  obj.stack.userData.fips = m.fips; hits.push(obj.stack); world.add(obj.stack);
  obj.h0 = obj.h1 = 0;
  obj.group.scale.setScalar(0.001);
  world.add(obj.group); OBJ.set(m.fips, obj);
  return obj;
}

// ---------------------------------------------------------------- layouts
let GEO, PROJ, mapLines;
function initMap() {
  GEO = topojson.feature(TOPO, TOPO.objects.counties);
  PROJ = d3.geoConicEqualArea().parallels([27.5, 35]).rotate([100, 0]).fitExtent([[-56, -50], [56, 50]], GEO);
  const seg = (mesh) => { const a = []; for (const line of mesh.coordinates) for (let i = 0; i < line.length - 1; i++) { const p = PROJ(line[i]), q = PROJ(line[i + 1]); a.push(p[0], 0, p[1], q[0], 0, q[1]); } return new Float32Array(a); };
  const lines = (arr, color, opacity) => { const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(arr, 3)); return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity })); };
  mapLines = new THREE.Group();
  mapLines.add(lines(seg(topojson.mesh(TOPO, TOPO.objects.counties, (a, b) => a !== b)), 0x8a90a8, 0.35));
  mapLines.add(lines(seg(topojson.mesh(TOPO, TOPO.objects.counties, (a, b) => a === b)), 0x3d4460, 0.7));
  scene.add(mapLines);
  for (const f of GEO.features) { const c = PROJ(d3.geoCentroid(f)); const m = M.get(+f.id); if (m) m.xy = c; }
}

// the Texas median line in the ladder layout
const medianLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-34, 0, 0), new THREE.Vector3(34, 0, 0)]),
  new THREE.LineDashedMaterial({ color: 0x8c1d2f, dashSize: 1, gapSize: 0.8, transparent: true, opacity: 0.7 }));
medianLine.computeLineDistances(); medianLine.visible = false; scene.add(medianLine);
const LADDER_X = { 0: -24, 1: 0, 2: 24, [-1]: 40 }, LADDER_H = 40;
const ladderY = (m) => { const v = m[state.lens]; return v == null || !isFinite(v) ? -LADDER_H / 2 - 5 : (lensScale(LENSES[state.lens].log && v <= 0 ? lensScale.domain()[0] : v) - 0.5) * LADDER_H; };

function layout() {
  const sf = SIZE_FACTOR[state.mode], all = [...M.values()], cash = useCash();
  const nodes = all.map((m) => ({ m, r: cash ? STORM_ON_CASH : sizeOf(m) * sf, h: cash ? stackH(m) : 0 }));
  if (state.mode === "map") {
    for (const d of nodes) { d.x = d.m.xy[0]; d.z = d.m.xy[1]; d.y = d.h + d.r * 0.9; }
  } else if (state.mode === "pattern") {
    for (const d of nodes) { const g = GROUPS[d.m.type]; d.tx = g.x; d.tz = g.z; d.x = g.x + (Math.random() - 0.5); d.y = g.z + (Math.random() - 0.5); }
    const sim = d3.forceSimulation(nodes).force("x", d3.forceX((d) => d.tx).strength(0.09)).force("y", d3.forceY((d) => d.tz).strength(0.09))
      .force("c", d3.forceCollide((d) => d.r * 1.08 + 0.25).iterations(2)).stop();
    for (let i = 0; i < 280; i++) sim.tick();
    for (const d of nodes) { d.z = d.y; d.y = d.h + d.r * 0.9; }
  } else {
    for (const d of nodes) { d.tx = LADDER_X[d.m.dom]; d.ty = ladderY(d.m); d.x = d.tx + (Math.random() - 0.5) * 4; d.y = d.ty; }
    const sim = d3.forceSimulation(nodes).force("x", d3.forceX((d) => d.tx).strength(0.06)).force("y", d3.forceY((d) => d.ty).strength(0.9))
      .force("c", d3.forceCollide((d) => d.r * 1.05 + 0.15).iterations(2)).stop();
    for (let i = 0; i < 260; i++) sim.tick();
    for (const d of nodes) { d.z = 0; }
    medianLine.position.y = ladderY({ [state.lens]: lensScale.median });
  }
  for (const d of nodes) {
    const o = OBJ.get(d.m.fips);
    o.p0.copy(o.group.position); o.p1.set(d.x, d.y, d.z);
    o.s0 = o.group.scale.x; o.s1 = d.r;
    o.h0 = o.stack.scale.y; o.h1 = d.h;
  }
  tween.t0 = performance.now();
  mapLines.visible = state.mode === "map";
  medianLine.visible = state.mode === "ladder";
  buildLabels();
}

function applyStyle() {
  for (const m of M.values()) {
    const o = OBJ.get(m.fips) ?? makeObj(m);
    if (o.dom !== m.dom) shapeFor(o, m.dom);
    const c = new THREE.Color(colorOf(m));
    o.mat.color.copy(c); o.mat.emissive.copy(c).multiplyScalar(0.22);
    o.softMat.color.copy(c); o.softMat.emissive.copy(c).multiplyScalar(0.3);
    o.halo.material.color.copy(c);
    o.alphaTo = state.pattern === "all" || state.pattern === m.type ? 1 : 0.08;
  }
}

// camera + layout tween
const tween = { t0: -1e9, dur: 1100, cam0: null, cam1: null };
function moveCamera() {
  const [p, t] = CAMERA[state.mode];
  tween.cam0 = [camera.position.clone(), controls.target.clone()];
  tween.cam1 = [new THREE.Vector3(...p), new THREE.Vector3(...t)];
}
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// ---------------------------------------------------------------- HTML labels projected from 3D
let LABELS = [];
const labelBox = $("#labels");
function buildLabels() {
  labelBox.innerHTML = ""; LABELS = [];
  const add = (html, cls, pos, obj = null) => { const el = document.createElement("div"); el.className = `lab3d ${cls}`; el.innerHTML = html; labelBox.appendChild(el); LABELS.push({ el, pos, obj }); };
  const all = [...M.values()];
  if (state.mode === "map") {
    for (const m of all.sort((a, b) => (b[state.size] ?? 0) - (a[state.size] ?? 0)).slice(0, 9)) add(m.name, "", null, OBJ.get(m.fips));
  } else if (state.mode === "pattern") {
    for (const [g, c] of Object.entries(GROUPS)) {
      const members = all.filter((m) => m.type === g); if (!members.length) continue;
      const zs = members.map((m) => OBJ.get(m.fips).p1.z);
      add(`${g} · ${members.length}<small>${c.note}</small>`, "group", new THREE.Vector3(c.x, 0, Math.min(...zs) - 4.5));
    }
    add("fewer ← damaging days per year → more", "note", new THREE.Vector3(0, 0, -40));
  } else {
    for (const p of [...PERILS, { k: -1, name: "No reports" }]) {
      const n = all.filter((m) => m.dom === p.k).length; if (!n) continue;
      add(`${p.k >= 0 ? `${p.name}-driven` : p.name} · ${n}`, "group", new THREE.Vector3(LADDER_X[p.k], LADDER_H / 2 + 5, 0));
    }
    const L = LENSES[state.lens];
    for (const v of lensScale.ticks(L.log ? 4 : 5)) add(L.fmt(v), "axis", new THREE.Vector3(-33, (lensScale(v) - 0.5) * LADDER_H, 0));
    add(`Texas median ${L.fmt(lensScale.median)}`, "median", new THREE.Vector3(9, medianLine.position.y, 0));
    if (all.some((m) => m[state.lens] == null)) add("no data", "axis", new THREE.Vector3(-33, -LADDER_H / 2 - 5, 0));
  }
  if (state.sel && !LABELS.some((l) => l.obj?.fips === state.sel)) add(M.get(state.sel).name, "", null, OBJ.get(state.sel));
}
const v3 = new THREE.Vector3();
function placeLabels() {
  const w = innerWidth, h = innerHeight;
  for (const l of LABELS) {
    if (l.obj) v3.copy(l.obj.group.position).y += l.obj.group.scale.x * 1.15; else v3.copy(l.pos);
    v3.project(camera);
    if (v3.z > 1) { l.el.style.display = "none"; continue; }
    l.el.style.display = ""; l.el.style.left = `${((v3.x + 1) / 2) * w}px`; l.el.style.top = `${((1 - v3.y) / 2) * h}px`;
    if (l.obj) l.el.style.opacity = l.obj.alpha;
  }
}

// selection ring
const selRing = new THREE.Mesh(new THREE.RingGeometry(1.3, 1.42, 64), new THREE.MeshBasicMaterial({ color: 0x8c1d2f, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
selRing.visible = false; scene.add(selRing);

// ---------------------------------------------------------------- render loop + picking
const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2(-9, -9);
let lastT = performance.now(), pointerEvt = null;
function frame(now) {
  const dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
  const k = Math.min(1, (now - tween.t0) / tween.dur), e = ease(k);
  for (const o of OBJ.values()) {
    if (k < 1) { o.group.position.lerpVectors(o.p0, o.p1, e); o.group.scale.setScalar(o.s0 + (o.s1 - o.s0) * e); }
    else if (o.group.position.distanceToSquared(o.p1) > 0) { o.group.position.copy(o.p1); o.group.scale.setScalar(o.s1); }
    const h = k < 1 ? o.h0 + (o.h1 - o.h0) * e : o.h1;
    o.stack.visible = h > 0.002; o.stack.scale.y = Math.max(h, 0.001);
    o.stack.position.set(o.group.position.x, 0, o.group.position.z);
    o.sideTex.repeat.set(1, h / BUNDLE_H);
    o.sideMat.opacity = o.topMat.opacity = o.alpha;
    if (o.spin) o.spin.rotation.y += dt * SPIN[o.dom];
    if (o.dom === 1) o.shape.rotation.x += (WIND_TILT[state.mode] - o.shape.rotation.x) * Math.min(1, dt * 4);
    o.alpha += (o.alphaTo - o.alpha) * Math.min(1, dt * 8);
    o.mat.opacity = o.alpha; o.softMat.opacity = 0.35 * o.alpha;
    const hot = state.hover === o.fips || state.sel === o.fips;
    o.halo.material.opacity = (hot ? 0.4 : 0.16) * o.alpha;
  }
  if (tween.cam1) {
    if (k < 1) { camera.position.lerpVectors(tween.cam0[0], tween.cam1[0], e); controls.target.lerpVectors(tween.cam0[1], tween.cam1[1], e); }
    else tween.cam1 = null;
  }
  controls.update();
  if (state.sel) { const o = OBJ.get(state.sel); selRing.visible = true; selRing.position.copy(o.group.position); selRing.scale.setScalar(o.group.scale.x); selRing.lookAt(camera.position); }
  else selRing.visible = false;
  if (pointerEvt) pick();
  renderer.render(scene, camera);
  placeLabels();
  requestAnimationFrame(frame);
}
function pick() {
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(hits, false).find((h) => OBJ.get(h.object.userData.fips).alphaTo > 0.5);
  const f = hit ? hit.object.userData.fips : null;
  if (f !== state.hover) { state.hover = f; canvas.style.cursor = f ? "pointer" : ""; }
  if (f) showTip(pointerEvt, M.get(f)); else $("#tip").hidden = true;
}
canvas.addEventListener("pointermove", (e) => { pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); pointerEvt = e; });
canvas.addEventListener("pointerleave", () => { pointerEvt = null; state.hover = null; $("#tip").hidden = true; });
let down = null;
canvas.addEventListener("pointerdown", (e) => { down = [e.clientX, e.clientY]; });
canvas.addEventListener("pointerup", (e) => {
  if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
  select(state.hover);
});

function showTip(e, m) {
  const tip = $("#tip"), L = LENSES[state.lens], S = SIZES[state.size];
  const drive = m.dom >= 0 ? `${PERILS[m.dom].long}${m.domShare != null ? ` · ${fmtPct(m.domShare)} of damage` : " · by reports"}` : "no storm reports";
  tip.innerHTML = `<b>${m.name}</b> <small>County</small><br><span class="sw" style="background:${colorOf(m)}"></span>${L.tab}: <b>${L.fmt(m[state.lens])}</b><br>
    Shape: ${drive}<br>Size: ${S.label} ${S.fmt(m[state.size])}<br><small>${m.type}</small>`;
  tip.hidden = false;
  tip.style.left = `${Math.min(e.clientX + 16, innerWidth - tip.offsetWidth - 10)}px`;
  tip.style.top = `${Math.min(e.clientY + 16, innerHeight - tip.offsetHeight - 10)}px`;
}

// ---------------------------------------------------------------- 2D icons for legends and the card
function icon(k, color) {
  if (k === 0) return `<g fill="${color}" stroke="#fff" stroke-opacity=".5" stroke-width="1"><circle cx="26" cy="31" r="12"/><circle cx="41" cy="22" r="7.5"/><circle cx="41" cy="41" r="6.5"/><circle cx="15" cy="45" r="5"/><circle cx="14" cy="17" r="4.5"/></g>`;
  if (k === 1) {
    const arms = d3.range(3).map((a) => "M" + d3.range(0, 31).map((i) => { const t = i / 30, th = t * 2.2 * Math.PI + (a * 2 * Math.PI) / 3, r = 3 + 23 * t; return `${30 + r * Math.cos(th)},${30 + r * Math.sin(th) * 0.8}`; }).join("L")).join(" ");
    return `<path d="${arms}" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round"/><circle cx="30" cy="30" r="3.5" fill="${color}"/>`;
  }
  if (k === 2) return `<path d="M8 10 Q30 2 52 10 Q44 22 37 32 Q32 42 30 55 Q27 42 23 32 Q16 22 8 10Z" fill="${color}" fill-opacity=".55" stroke="${color}" stroke-width="2"/><path d="M14 14 Q30 20 46 13 M20 25 Q31 29 41 24 M25 36 Q31 38 36 35" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="2"/>`;
  return `<circle cx="30" cy="30" r="9" fill="${color}"/>`;
}
// a small stack of n bundles of bills, for legends
const cashSVG = (n) => `<svg viewBox="0 0 46 ${8 + n * 9}" width="46" height="${8 + n * 9}">${d3.range(n).map((i) => { const y = 4 + (n - 1 - i) * 9;
  return `<rect x="${3 + (i % 2) * 2}" y="${y}" width="38" height="8" rx="1" fill="#cfe3bf" stroke="#5f8f55"/><rect x="${25 + (i % 2) * 2}" y="${y}" width="5" height="8" fill="#c4a052"/>`; }).join("")}</svg>`;
// a bar drawn as bills piled up: one slab per few pixels
const billBar = (x, yBase, w, h, fill, edge) => { let out = ""; for (let y = yBase - 3.2; y >= yBase - h - 0.01; y -= 3.2) out += `<rect x="${x}" y="${y}" width="${w}" height="2.6" rx=".6" fill="${fill}" stroke="${edge}" stroke-width=".5"/>`; return out; };
const iconSVG = (k, color, cls = "") => `<svg viewBox="0 0 60 60" class="${cls}">${icon(k, color)}</svg>`;

// ---------------------------------------------------------------- UI: tabs, controls, legends, KPIs
function renderUI() {
  $("#tabs").innerHTML = Object.entries(LENSES).map(([k, l]) => `<button data-k="${k}" class="${k === state.lens ? "on" : ""}" title="${l.long}">${l.tab}</button>`).join("");
  $("#f-size").innerHTML = Object.entries(SIZES).map(([k, s]) => `<label><input type="radio" name="sz" value="${k}" ${k === state.size ? "checked" : ""}/>${s.label}</label>`).join("");
  $("#f-perils").innerHTML = PERILS.map((p) => `<button data-p="${p.k}" class="${state.perils.has(p.k) ? "" : "off"}" style="--c:${p.c}">${iconSVG(p.k, state.perils.has(p.k) ? p.c : "#b4b8c8")}${p.name}</button>`).join("");
  document.querySelectorAll("#f-window button").forEach((b) => b.classList.toggle("on", +b.dataset.v === state.window));
  document.querySelectorAll("#mode button").forEach((b) => b.classList.toggle("on", b.dataset.mode === state.mode));
  $("#mode-note").textContent = MODE_NOTE[state.mode];
  const types = Object.keys(GROUPS), counts = Object.fromEntries(types.map((t) => [t, [...M.values()].filter((m) => m.type === t).length]));
  $("#f-pattern").innerHTML = `<option value="all">All damage patterns</option>` + types.map((t) => `<option value="${t}" ${t === state.pattern ? "selected" : ""}>${t} (${counts[t]})</option>`).join("");
  $("#kpis").innerHTML = `<div><b>${fmtMoney(TX.paid)}</b>TDI paid losses 2019–2025</div><div><b>${fmtDollar(TX.lossPerPolicy)}</b>paid loss per policy per year</div>
    <div><b>${fmtPct(TX.windShare)}</b>of losses from wind &amp; hail</div><div><b>${fmtDollar(TX.prem19)} <i>→</i> ${fmtDollar(TX.prem25)}</b>average premium 2019 → 2025</div>`;
  // legends
  $("#shape-legend").innerHTML = PERILS.map((p) => `<div>${iconSVG(p.k, p.c)}<span>${p.name}</span></div>`).join("");
  const S = SIZES[state.size], ticks = [sizeOf.max, sizeOf.max / 4, sizeOf.max / 25].filter((v) => v > 0);
  if (useCash()) {
    const tallest = [...M.values()].sort((a, b) => (b[state.size] ?? 0) - (a[state.size] ?? 0))[0];
    $("#size-legend").innerHTML = `<div>${S.label}</div><div class="cash-leg">${cashSVG(3)}<span>stack height = dollars<br>one bundle ≈ <b>${fmtMoney(bundle)}</b><br>tallest: ${tallest.name} ${fmtMoney(tallest[state.size])}</span></div>`;
  } else {
  const px = (v) => sizeOf.scale(v) * 7, R = px(ticks[0]);
  const base = R * 2 + 8;
  $("#size-legend").innerHTML = `<div>${S.label}</div><svg width="${R * 2 + 70}" height="${base + 2}">${ticks.map((v) => `<circle cx="${R + 1}" cy="${base - px(v)}" r="${px(v)}" fill="none" stroke="#8e95c9" stroke-opacity=".7"/><line x1="${R + 1}" x2="${R * 2 + 8}" y1="${base - 2 * px(v)}" y2="${base - 2 * px(v)}" stroke="#8e95c9" stroke-opacity=".4"/><text x="${R * 2 + 10}" y="${base + 3.5 - 2 * px(v)}">${S.fmt(v)}</text>`).join("")}</svg>`;
  }
  const L = LENSES[state.lens], [lo, hi] = lensScale.domain();
  const stops = d3.range(0, 1.01, 0.1).map((t) => `${RAMP(t)} ${t * 100}%`).join(",");
  $("#ramp").innerHTML = `<div class="title">${L.long}</div><div class="bar" style="background:linear-gradient(90deg,${stops})"></div>
    <div class="ticks"><span>${L.fmt(lo)} or less</span><span>Texas median ${L.fmt(lensScale.median)}</span><span>${L.fmt(hi)} or more</span></div>`;
  document.querySelectorAll(".g-ico").forEach((s) => (s.innerHTML = icon(+s.dataset.shape, PERILS[+s.dataset.shape].c)));
}

// ---------------------------------------------------------------- county card
async function select(fips) {
  state.sel = fips;
  $("#card").hidden = !fips; $("#controls").hidden = !!fips;
  buildLabels();
  if (!fips) return;
  const m = M.get(fips), L = LENSES;
  const tdi = m.tdi.filter((t) => t.paid != null), maxP = d3.max(tdi, (t) => Math.max(0, t.paid)) || 1, bw = 268 / 7;
  const bars = tdi.map((t, i) => {
    const h = (Math.max(0, t.paid) / maxP) * 52, hw = (Math.max(0, Math.min(t.wind ?? 0, t.paid)) / maxP) * 52, x = (t.year - 2019) * bw + 4;
    return `<g><title>${t.year}: ${fmtMoney(t.paid)} paid, ${fmtMoney(t.wind)} wind & hail</title>${billBar(x, 56, bw - 8, h, "#dfeed3", "#8fb47f")}${billBar(x, 56, bw - 8, hw, "#7fae6c", "#4d7d44")}</g><text x="${x + (bw - 8) / 2}" y="68" text-anchor="middle">${String(t.year).slice(2)}</text>`;
  }).join("");
  const stack = (vals, y, label) => {
    const tot = d3.sum(vals) || 1; let x = 52;
    return `<text x="0" y="${y + 10}">${label}</text>` + vals.map((v, p) => {
      const w = (v / tot) * 214, s = `<rect x="${x}" y="${y}" width="${w}" height="14" fill="${PERILS[p].c}"/>${w > 26 ? `<text x="${x + w / 2}" y="${y + 10.5}" text-anchor="middle" style="fill:#fff">${fmtPct(v / tot)}</text>` : ""}`;
      x += w; return s;
    }).join("");
  };
  const lpRank = [...M.values()].filter((x) => x.lossPerPolicy != null).sort((a, b) => b.lossPerPolicy - a.lossPerPolicy).findIndex((x) => x.fips === fips) + 1;
  const peril = m.dom >= 0 ? PERILS[m.dom] : null;
  $("#card").innerHTML = `
    <div class="c-head">${iconSVG(m.dom, peril ? peril.c : NO_DATA)}<div><h2>${m.name} County</h2><span class="badge">${m.type}</span></div><button class="c-close" title="Back to controls">×</button></div>
    <div class="c-kpis">
      <div><b>${fmtDollar(m.lossPerPolicy)}</b>paid loss / policy / yr <small>· #${lpRank || "n/a"} of 254</small></div>
      <div><b>${fmtPct(m.windShare)}</b>of paid losses from wind &amp; hail</div>
      <div><b>${fmtDollar(m.premium)}</b>avg premium 2025 <small>· ${L.premiumChange.fmt(m.premiumChange)} since 2019</small></div>
      <div><b>${fmtInt(m.policies)}</b>homeowners policies (2025)</div>
      <div><b>${fmtMoney(m.damage)}</b>NOAA storm damage / yr <small>· last ${state.window} yrs</small></div>
      <div><b>${fmtPct(m.top1)}</b>of that damage on its worst day</div>
    </div>
    <div class="c-sec">TDI paid losses by year <span><i style="color:#7fae6c">■</i> wind &amp; hail part</span></div>
    <svg class="c-svg" viewBox="0 0 268 72">${bars}<text x="268" y="8" text-anchor="end">max ${fmtMoney(maxP)}</text></svg>
    <div class="c-sec">Peril mix <span>NOAA, last ${state.window} yrs</span></div>
    <svg class="c-svg" viewBox="0 0 268 38">${stack(m.reports, 2, "Reports")}${stack(m.dmgP, 21, "Damage")}</svg>
    <div class="c-sec">Worst storm days <span>NOAA reports</span></div>
    <div class="c-days" id="c-days"><div class="c-day" style="--c:#555">Loading reports…</div></div>`;
  $("#card .c-close").onclick = () => select(null);
  const ev = await loadEvents(fips);
  if (state.sel !== fips) return;
  $("#c-days").innerHTML = m.topDays.length ? m.topDays.map((d) => {
    const rows = ev.rows.filter((r) => r[0] === d.date && state.perils.has(r[2]));
    const dp = d.dp.indexOf(Math.max(...d.dp)), places = [...new Set(rows.map((r) => r[5]).filter(Boolean))].slice(0, 3).join(", ");
    const mags = PERILS.filter((p) => state.perils.has(p.k)).map((p) => { const rs = rows.filter((r) => r[2] === p.k); return rs.length ? `${rs.length} ${p.name.toLowerCase()}` : ""; }).filter(Boolean).join(" · ");
    const story = rows.map((r) => r[8]).filter(Boolean).sort((a, b) => b.length - a.length)[0] ?? "";
    const date = new Date(String(d.date).replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3T12:00")).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    return `<div class="c-day" style="--c:${PERILS[dp].c}"><b>${date}</b> · ${fmtMoney(d.d)} · ${mags}${places ? `<br>${places}` : ""}${story ? `<i>“${story}”</i>` : ""}</div>`;
  }).join("") : `<div class="c-day" style="--c:#555">No damaging storm days in this window.</div>`;
}
function loadEvents(fips) {
  if (!EVENTS.has(fips)) EVENTS.set(fips, fetch(`data/events/${fips}.json`).then((r) => r.json()));
  return EVENTS.get(fips);
}

// ---------------------------------------------------------------- wiring
function refresh({ recompute = false, relayout = true } = {}) {
  if (recompute) { compute(); for (const f of GEO.features) { const m = M.get(+f.id); if (m) m.xy = PROJ(d3.geoCentroid(f)); } }
  buildScales(); applyStyle(); renderUI();
  if (relayout) layout(); else buildLabels();
  if (state.sel) select(state.sel);
}
function bind() {
  $("#tabs").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; state.lens = b.dataset.k; refresh({ relayout: state.mode === "ladder" }); });
  $("#f-size").addEventListener("change", (e) => { state.size = e.target.value; refresh(); });
  $("#f-perils").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return; const p = +b.dataset.p;
    if (state.perils.has(p)) { if (state.perils.size > 1) state.perils.delete(p); } else state.perils.add(p);
    refresh({ recompute: true });
  });
  $("#f-window").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; state.window = +b.dataset.v; refresh({ recompute: true }); });
  $("#f-pattern").addEventListener("change", (e) => { state.pattern = e.target.value; applyStyle(); });
  document.querySelectorAll("#mode button").forEach((b) => b.addEventListener("click", () => { if (state.mode === b.dataset.mode) return; state.mode = b.dataset.mode; renderUI(); layout(); moveCamera(); }));
  $("#county-list").innerHTML = [...M.values()].sort((a, b) => a.name.localeCompare(b.name)).map((m) => `<option value="${m.name}"></option>`).join("");
  $("#search").addEventListener("change", (e) => { const m = [...M.values()].find((x) => x.name.toLowerCase() === e.target.value.trim().toLowerCase()); if (m) { e.target.value = ""; select(m.fips); } });
  addEventListener("keydown", (e) => { if (e.key === "Escape") { $("#guide").hidden = true; if (state.sel) select(null); } });
  const resize = () => { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); };
  addEventListener("resize", resize); resize();
}

// intro and guide work before the data arrives
{
  const close = () => { $("#splash").classList.add("gone"); setTimeout(() => ($("#splash").hidden = true), 650); };
  $("#btn-explore").onclick = close;
  $("#btn-guide").onclick = () => { close(); $("#guide").hidden = false; };
  $("#btn-help").onclick = () => ($("#guide").hidden = false);
  $("#guide-close").onclick = () => ($("#guide").hidden = true);
}

Promise.all(["storm_days", "tdi", "cpi", "tx.topo", "context"].map((f) => fetch(`data/${f}.json`).then((r) => r.json()))).then(([sd, tdi, cpi, topo, ctx]) => {
  SD = sd; NAMES = sd.names; TDIDATA = tdi; CPI = cpi; TOPO = topo; CTX = ctx.counties;
  compute(); initMap(); buildScales(); applyStyle(); renderUI(); layout(); bind();
  requestAnimationFrame(frame);
});
