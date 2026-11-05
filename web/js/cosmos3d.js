/* Storm Risk Cosmos · Texas
 * A seven-chapter 3D story for homeowners insurers. Every county is a 3D storm:
 *   shape  = the peril that drives its NOAA damage (hail stones, thunderstorm-wind spiral, tornado funnel)
 *   stack  = amounts under the storm, one bundle = a fixed amount: paper money for dollars, red bills for claims paid,
 *            policy paper for insured homes, rose sheets for owner homes without a policy (two-part stacks compare two
 *            amounts in one column)
 *   colour = the measure of the chapter, always named in the legend
 * Each chapter names one high-contrast pair of counties. The site opens on the story; Explore (after the last chapter, or
 * the toggle in the top bar) gives free choice of colour, layout and stacks. Clicking a county opens the county view: the county on its
 * own with its four perils (hurricanes added from NOAA zone reports), its homes as houses and its money as paper stacks. */
import * as THREE from "three";
import { OrbitControls } from "../vendor/three/OrbitControls.js";

const PERILS = [{ k: 0, name: "Hail", long: "Hail", c: "#5b8fc9" }, { k: 1, name: "Wind", long: "Thunderstorm wind", c: "#d9a441" }, { k: 2, name: "Tornado", long: "Tornado", c: "#8e6bb5" }];
// hurricanes come from NOAA zone reports and appear only in the county view (the Texas map ranks hail, wind and tornado)
const HURR = { k: 3, name: "Hurricane", long: "Hurricane & tropical storm", c: "#14a39a" };
const WINDOW = 20, LAST_YEAR = 2025;
// TWIA first-tier coastal counties: most wind claims there go to the Texas Windstorm Insurance Association, not in TDI data
const COAST = new Set([48007, 48039, 48057, 48061, 48071, 48167, 48245, 48261, 48273, 48321, 48355, 48391, 48409, 48489]);
const MIN_POL = 500;                                         // smaller books are too noisy to rank
const fmtMoney = (v) => (v == null || isNaN(v) ? "n/a" : Math.abs(v) >= 1e12 ? `$${(v / 1e12).toFixed(1)}T` : Math.abs(v) >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(Math.abs(v) >= 1e7 ? 0 : 1)}M` : Math.abs(v) >= 1e3 ? `$${Math.round(v / 1e3)}K` : `$${Math.round(v)}`);
const fmtDollar = (v) => (v == null || isNaN(v) ? "n/a" : `$${Math.round(v).toLocaleString("en-US")}`);
const fmtPct = (v) => (v == null || isNaN(v) ? "n/a" : `${Math.round(v * 100)}%`);
const fmtInt = (v) => (v == null || isNaN(v) ? "n/a" : Math.round(v).toLocaleString("en-US"));
const fmtCount = (v) => (v == null || isNaN(v) ? "n/a" : v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e4 ? `${Math.round(v / 1e3)}K` : fmtInt(v));
const fmt1 = (v) => (v == null || isNaN(v) ? "n/a" : v >= 10 ? v.toFixed(0) : v.toFixed(1));
const fmtGap = (v) => (v == null || isNaN(v) ? "n/a" : `${v >= 0 ? "+" : "−"}${Math.round(Math.abs(v) * 100)} pts`);
const fmtCents = (v) => (v == null || isNaN(v) ? "n/a" : `${Math.round(v * 100)}¢`);
const LENSES = {
  peril: { tab: "Main storm", long: "Storm behind most of the county's property damage", type: "peril" },
  top1: { tab: "One-day share", long: "Share of 20 years of damage that fell on the single worst day", fmt: fmtPct, type: "seq", ramp: ["#2c7bb6", "#7fb3d5", "#f2c14e", "#e8642c", "#c81d4b"], domain: [0.2, 1] },
  coverage: { tab: "Coverage", long: "Share of owner-occupied homes with a homeowners policy, 2025", fmt: fmtPct, type: "seq", ramp: ["#e8642c", "#e0a526", "#9cc5a1", "#2fa58f", "#1f5f99"] },
  lossPerPolicy: { tab: "Paid per policy", long: "Claims paid per policy per year, 2019–2025", fmt: fmtDollar, type: "seq", ramp: ["#2c7bb6", "#2fa58f", "#e0a526", "#e8642c", "#c81d4b"] },
  lossRatio: { tab: "Claims vs premium", long: "Claims paid per premium dollar, 2019–2025 (premium estimated)", fmt: (v) => fmtCents(v), type: "div", domain: [0.15, null, 1], ramp: ["#1a9850", "#f2c14e", "#c81d4b"] },
  claimGap: { tab: "Claims vs storms", long: "Claim rank minus storm rank (positive = more claims than storms suggest)", fmt: (v) => fmtGap(v), type: "div", domain: [-0.6, 0, 0.6], ramp: ["#2c7bb6", "#d9cfe3", "#c81d4b"] },
  category: { tab: "Insurer view", long: "Where an insurer should look", type: "cat" },
};
const CATS = {
  growth: { name: "Grow", c: "#1f9e89", note: "many owner homes without a policy and claims below the Texas average (3,000+ uncovered homes)" },
  over: { name: "Review", c: "#c81d4b", note: "claims eat 70¢+ of each premium dollar and rank 30+ points above the county's storms" },
  rich: { name: "Protect", c: "#e0a526", note: "claims take 35¢ or less of each premium dollar (2,000+ policies)" },
};
const OTHER = { c: "#8fb1e3", name: "No flag" }, COASTAL = { c: "#7d74c9", name: "TWIA coast (wind claims not in this data)" };
const NO_DATA = "#c9c3d6";
const BURST = {
  oneday: { x: -22, z: -2, name: "One big day", note: "the worst day caused half or more of 20 years of damage" },
  spread: { x: 22, z: -2, name: "Many smaller days", note: "damage spread over many storms" },
  few: { x: 0, z: 22, name: "Little damage", note: "fewer than 3 damaging days in 20 years" },
};
const PAPER_KIND = {
  money: { label: "premium kept", c: ["#cfe3bf", "#5f8f55", "#c4a052"] },
  damage: { label: "property damage", c: ["#cfe3bf", "#5f8f55", "#c4a052"] },
  claims: { label: "claims paid", c: ["#f6c7b8", "#c0533a", "#c4a052"] },
  policy: { label: "insured homes", c: ["#f6f8fd", "#8fa2cc", "#2c5aa0"] },
  uncovered: { label: "homes without a policy", c: ["#f7e1e3", "#c26b78", "#c81d4b"] },
};
const CAMERA = { map: [[7, 74, 100], [7, 0, 6]], burst: [[2, 66, 92], [2, 0, 4]], mismatch: [[0, 1, 88], [0, 0, 0]] };
const SIZE_FACTOR = { map: 1, burst: 0.6, mismatch: 0.42 };
const WIND_TILT = { map: 0.6, burst: 0.6, mismatch: 1.3 };   // wind spirals lean toward the camera
const STORY_DX = { map: 9, burst: 5, mismatch: 2 };          // nudge the scene right of the story card

// Explore: free choice of colour, layout and stacks, using the same scene
const EXPLORE = {
  tabs: ["peril", "top1", "coverage", "lossPerPolicy", "lossRatio", "claimGap", "category"],
  stacks: {
    none: { label: "None", parts: [] },
    damage: { label: "Property damage", parts: [{ key: "damage", kind: "damage" }] },
    homes: { label: "Insured vs uninsured homes", parts: [{ key: "insured", kind: "policy" }, { key: "uncovered", kind: "uncovered" }] },
    premium: { label: "Claims vs premium kept", parts: [{ key: "paidPerYear", kind: "claims" }, { key: "keptPos", kind: "money" }] },
  },
  sizes: { stormDays: "Storm days a year", policies: "Homeowners policies" },
  notes: { map: "Counties where they are.", burst: "Grouped by whether one big day or many smaller days caused the damage.", mismatch: "Storm rank left to right, claim rank bottom to top. Dashed line: claims match storms." },
};
const ex = { lens: "category", mode: "map", stack: "none", size: "policies" };
const state = { county: null, view: "story", chapter: 0, mode: "map", lens: "peril", size: "stormDays", stack: [], focus: null, special: null, pair: [], sel: null, hover: null };
let SD, TDIDATA, CPI, CTX, TOPO, TROP, NAMES, M = new Map(), TX = {}, colorOf, sizeOf, lensScale, bundle = 1;
const BUNDLE_H = 1.1, STORM_ON_STACK = 0.85;   // world height of one bundle; storm size when it sits on a stack
const EVENTS = new Map();
const $ = (s) => document.querySelector(s);

// ---------------------------------------------------------------- metrics
function compute() {
  const w0 = LAST_YEAR - WINDOW + 1;
  for (const f of Object.keys(NAMES)) {
    const fips = +f, rows = SD.counties[f] ?? [];
    const dmgP = [0, 0, 0], reports = [0, 0, 0], days = [], pDays = [0, 0, 0], pWorst = [null, null, null];
    let total = 0, stormDays = 0;
    for (const r of rows) {
      const yr = Math.floor(r[0] / 10000); if (yr < w0) continue;
      const k = CPI.toBase[yr];
      let d = 0, c = 0; const dp = [0, 0, 0];
      for (const p of [0, 1, 2]) {
        dp[p] = r[1 + p] * k; d += dp[p]; c += r[4 + p]; reports[p] += r[4 + p]; dmgP[p] += dp[p];
        if (r[4 + p]) { pDays[p]++; if (dp[p] > 0 && (!pWorst[p] || dp[p] > pWorst[p].d)) pWorst[p] = { date: r[0], d: dp[p] }; }
      }
      if (!c) continue;
      stormDays++; total += d;
      if (d > 0) days.push({ date: r[0], d, dp });
    }
    days.sort((a, b) => b.d - a.d);
    const argmax = (a) => a.indexOf(Math.max(...a));
    const dom = total > 0 ? argmax(dmgP) : d3.sum(reports) > 0 ? argmax(reports) : -1;
    const cx = CTX[f] ?? {};
    // TDI homeowners, 2019–2025, in 2025 dollars; premium per year estimated from policies x average premium,
    // with the average premium interpolated between the 2019 and 2025 TDI values
    let paid = 0, wind = 0, pol = 0, yrs = 0, prem = 0;
    const tdi = (TDIDATA.counties[f] ?? []).map(([year, p, w, np]) => {
      const k = CPI.toBase[year];
      if (p != null && np) {
        paid += p * k; wind += (w ?? 0) * k; pol += np; yrs++;
        if (cx.premium2019 && cx.premium2025) prem += np * (cx.premium2019 + ((cx.premium2025 - cx.premium2019) * (year - 2019)) / 6) * k;
      }
      return { year, paid: p == null ? null : p * k, wind: w == null ? null : w * k, pol: np };
    });
    const last = tdi.length ? tdi[tdi.length - 1] : null, policies = last?.pol ?? null, owners = cx.owners ?? null;
    const top1 = total > 0 ? days[0].d / total : null;
    const trop = (TROP[f] ?? []).filter((t) => Math.floor(t[0] / 10000) >= w0)
      .map(([date, type, name, dm, text]) => ({ date, type, name, d: dm == null ? null : dm * CPI.toBase[Math.floor(date / 10000)], text }));
    M.set(fips, {
      fips, name: NAMES[f], coast: COAST.has(fips), dmgP, reports, nReports: d3.sum(reports), stormDays: stormDays / WINDOW,
      pDays, pWorst, trop, tropDamage: d3.sum(trop, (t) => t.d ?? 0) / WINDOW,
      damage: total / WINDOW, nDmgDays: days.length, top1, topDays: days.slice(0, 3), dom, domShare: total > 0 ? dmgP[dom] / total : null,
      burst: days.length < 3 ? "few" : top1 >= 0.5 ? "oneday" : "spread",
      tdi, paidPerYear: yrs ? paid / yrs : null, lossPerPolicy: pol ? paid / pol : null, windShare: paid > 0 ? wind / paid : null,
      premiumYear: prem ? prem / yrs : null, lossRatio: prem ? paid / prem : null, premiumKept: prem ? (prem - paid) / yrs : null,
      keptPos: prem ? Math.max(0, (prem - paid) / yrs) : null,
      policies, owners, coverage: policies != null && owners ? Math.min(1, policies / owners) : null,
      insured: policies != null && owners != null ? Math.min(policies, owners) : null,
      uncovered: policies != null && owners != null ? Math.max(0, owners - policies) : null,
      insuredValue: policies != null && cx.coverage2025 ? policies * cx.coverage2025 : null,
      premium: cx.premium2025 ?? null, premiumChange: cx.premium2019 && cx.premium2025 ? cx.premium2025 / cx.premium2019 - 1 : null,
    });
  }
  const all = [...M.values()];
  for (const m of all) m.uncoveredShare = m.uncovered != null && m.owners ? m.uncovered / m.owners : null;
  // storms vs. claims: percentile rank of storm days per year against percentile rank of paid loss per policy
  const ranked = all.filter((m) => m.lossPerPolicy != null && m.policies >= MIN_POL && !m.coast);
  const pct = (key) => { const s = [...ranked].sort((a, b) => a[key] - b[key]); s.forEach((m, i) => (m[`${key}Pct`] = i / (s.length - 1))); };
  pct("stormDays"); pct("lossPerPolicy");
  for (const m of all) m.claimGap = ranked.includes(m) ? m.lossPerPolicyPct - m.stormDaysPct : null;
  // Texas totals
  const S = (f) => d3.sum(all, f);
  let paid = 0, wind = 0, pol = 0;
  for (const m of all) for (const t of m.tdi) if (t.paid != null && t.pol) { paid += t.paid; wind += t.wind ?? 0; pol += t.pol; }
  const withPrem = all.filter((m) => m.lossRatio != null);
  TX = {
    paid, windShare: wind / paid, lossPerPolicy: paid / pol, reports: S((m) => m.nReports), counties: all.filter((m) => m.nReports > 0).length,
    domCount: [0, 1, 2].map((p) => all.filter((m) => m.dom === p).length), damageYr: S((m) => m.damage),
    hailRep: S((m) => m.reports[0]) / S((m) => m.nReports), hailDmg: S((m) => m.dmgP[0]) / S((m) => d3.sum(m.dmgP)),
    burst: Object.fromEntries(Object.keys(BURST).map((b) => [b, all.filter((m) => m.burst === b).length])),
    policies: S((m) => m.policies ?? 0), owners: S((m) => m.owners ?? 0), insuredValue: S((m) => m.insuredValue ?? 0), uncovered: S((m) => m.uncovered ?? 0),
    lossRatio: d3.sum(withPrem, (m) => m.paidPerYear) / d3.sum(withPrem, (m) => m.premiumYear),
  };
  TX.coverage = Math.min(1, TX.policies / TX.owners); TX.uncoveredShare = TX.uncovered / TX.owners;
  TX.nGap = all.filter((m) => m.claimGap >= 0.3).length;
  // the insurer's view: one label per county, coast and very small books left out
  for (const m of all) {
    m.cat = null;
    if (m.coast || !(m.policies >= MIN_POL) || m.lossRatio == null) continue;
    if (m.claimGap != null && m.claimGap >= 0.3 && m.lossRatio >= 0.7) m.cat = "over";
    else if (m.uncovered >= 3000 && m.lossRatio <= TX.lossRatio) m.cat = "growth";
    else if (m.lossRatio <= 0.35 && m.policies >= 2000) m.cat = "rich";
  }
  TX.cat = Object.fromEntries(Object.keys(CATS).map((c) => [c, all.filter((m) => m.cat === c).length]));
}

function buildScales() {
  const all = [...M.values()], L = LENSES[state.lens];
  lensScale = null;
  let base;
  if (L.type === "peril") base = (m) => (m.dom >= 0 ? PERILS[m.dom].c : NO_DATA);
  else if (L.type === "cat") base = (m) => (m.cat ? CATS[m.cat].c : OTHER.c);
  else {
    const vals = all.map((m) => m[state.lens]).filter((v) => v != null && isFinite(v)).sort(d3.ascending);
    let sc;
    if (L.type === "div") { const [lo, mid, hi] = L.domain.map((d) => d ?? TX[state.lens]); sc = d3.scaleLinear().domain([lo, mid, hi]).range([0, 0.5, 1]).clamp(true); Object.assign(sc, { lo, mid, hi }); }
    else { const [lo, hi] = L.domain ?? [d3.quantileSorted(vals, 0.03), d3.quantileSorted(vals, 0.97)]; sc = d3.scaleLinear().domain([lo, hi]).range([0, 1]).clamp(true); Object.assign(sc, { lo, hi, mid: d3.quantileSorted(vals, 0.5) }); }
    lensScale = sc; const ramp = d3.interpolateRgbBasis(L.ramp);
    base = (m) => { const v = m[state.lens]; return v == null || !isFinite(v) ? NO_DATA : ramp(sc(v)); };
    base.ramp = ramp;
  }
  colorOf = (m) => (state.special?.(m) ? state.special(m).c : base(m));
  colorOf.ramp = base.ramp;
  const sv = all.map((m) => m[state.size] ?? 0).sort(d3.ascending);
  const sMax = d3.quantileSorted(sv, 0.985) || 1;
  const s = d3.scaleSqrt().domain([0, sMax]).range([0.7, 3.3]).clamp(true);
  sizeOf = (m) => s(m[state.size] ?? 0);
  sizeOf.scale = s; sizeOf.max = sMax;
  // stacks: height is linear in the amount; one bundle is a round amount so the tallest stack has about 16
  if (state.stack.length) {
    const top = d3.max(all, stackTotal) || 1, raw = top / 16, p = 10 ** Math.floor(Math.log10(raw));
    bundle = [1, 2, 2.5, 5, 10].map((k) => k * p).find((v) => v >= raw);
  }
}
const stackTotal = (m) => d3.sum(state.stack, (p) => Math.max(0, m[p.key] ?? 0));
const useStack = () => state.stack.length && state.mode !== "mismatch";
const partH = (m, i) => { const v = Math.max(0, m[state.stack[i]?.key] ?? 0); return v > 0 ? Math.max(0.12, (v / bundle) * BUNDLE_H) : 0; };

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

// stacks of paper: the top shows one sheet, the sides show the paper edges of strapped bundles
const canvasTex = (w, h, draw) => { const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
const sideTex = (light, dark, gap, strap) => {
  const t = canvasTex(64, 128, (g, w, h) => {
    for (let y = 0; y < h; y += 4) { g.fillStyle = y % 8 ? light : dark; g.fillRect(0, y, w, 4); }
    g.fillStyle = gap; g.fillRect(0, h - 3, w, 3);                               // gap between bundles
    g.fillStyle = strap; g.fillRect(w * 0.6, 0, w * 0.14, h);
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
};
const bill = (paper, ink, edge, stamp) => canvasTex(256, 116, (g, w, h) => {
  g.fillStyle = paper; g.fillRect(0, 0, w, h);
  g.strokeStyle = edge; g.lineWidth = 5; g.strokeRect(7, 7, w - 14, h - 14);
  g.lineWidth = 1.5; g.strokeRect(15, 15, w - 30, h - 30);
  g.beginPath(); g.ellipse(w / 2, h / 2, 30, 34, 0, 0, Math.PI * 2); g.stroke();
  g.fillStyle = ink; g.font = "bold 44px Georgia, serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("$", w / 2, h / 2 + 2);
  g.font = "bold 20px Georgia, serif"; for (const [x, y] of [[30, 30], [w - 30, 30], [30, h - 28], [w - 30, h - 28]]) g.fillText("$", x, y);
  if (stamp) { g.save(); g.translate(w / 2 + 70, h / 2); g.rotate(-0.25); g.font = "bold 22px Helvetica, Arial, sans-serif"; g.fillText(stamp, 0, 0); g.restore(); }
  else { g.fillStyle = "rgba(196, 160, 82, 0.9)"; g.fillRect(w / 2 + 52, 0, 26, h); }           // paper strap
});
const moneyPaper = { top: bill("#cfe3bf", "#3f6e3a", "#5f8f55"), side: sideTex("#d6efc4", "#8fc47a", "#6f9a63", "rgba(196, 160, 82, 0.95)") };
const PAPER = {
  money: moneyPaper, damage: moneyPaper,
  claims: { top: bill("#f6c7b8", "#9a3a26", "#c0533a", "PAID"), side: sideTex("#fadbd1", "#e59a83", "#c0533a", "rgba(196, 160, 82, 0.95)") },
  policy: {
    top: canvasTex(256, 116, (g, w, h) => {
      g.fillStyle = "#fbfcff"; g.fillRect(0, 0, w, h);
      g.fillStyle = "#2c5aa0"; g.fillRect(0, 0, w, 24);
      g.fillStyle = "#fff"; g.font = "bold 15px Helvetica, Arial, sans-serif"; g.textBaseline = "middle"; g.fillText("HOMEOWNERS POLICY", 14, 13);
      g.fillStyle = "#c3cbe0"; for (let y = 38; y < h - 12; y += 12) g.fillRect(14, y, w * (y % 24 ? 0.55 : 0.68), 4);
      g.strokeStyle = "#2c5aa0"; g.lineWidth = 4; g.beginPath(); g.moveTo(w - 50, 40); g.lineTo(w - 24, 48); g.lineTo(w - 24, 70); g.quadraticCurveTo(w - 37, 96, w - 50, 100); g.quadraticCurveTo(w - 63, 96, w - 76, 70); g.lineTo(w - 76, 48); g.closePath(); g.stroke();
    }),
    side: sideTex("#f6f8fd", "#c9d3ea", "#8fa2cc", "rgba(44, 90, 160, 0.85)"),
  },
  uncovered: {
    top: canvasTex(256, 116, (g, w, h) => {
      g.fillStyle = "#f7e1e3"; g.fillRect(0, 0, w, h);
      g.strokeStyle = "#8c1d2f"; g.lineWidth = 5; g.beginPath(); g.moveTo(w / 2 - 34, 62); g.lineTo(w / 2, 30); g.lineTo(w / 2 + 34, 62); g.moveTo(w / 2 - 24, 56); g.lineTo(w / 2 - 24, 92); g.lineTo(w / 2 + 24, 92); g.lineTo(w / 2 + 24, 56); g.stroke();
      g.strokeStyle = "#c81d4b"; g.lineWidth = 6; g.beginPath(); g.moveTo(w / 2 - 44, 24); g.lineTo(w / 2 + 44, 100); g.stroke();
    }),
    side: sideTex("#f8e6e8", "#e3aab2", "#c26b78", "rgba(200, 29, 75, 0.7)"),
  },
};
const stackGeo = new THREE.BoxGeometry(1.5, 1, 0.68); stackGeo.translate(0, 0.5, 0);

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
  // hurricane: three thick cloud bands around an eyewall over a soft cloud disc (thicker and fewer arms than the wind spiral)
  const hurricane = new THREE.Group(), cyclone = new THREE.Group();
  for (let a = 0; a < 3; a++) {
    const pts = d3.range(0, 51).map((i) => { const t = i / 50, th = -(t * 1.7 * Math.PI + (a * 2 * Math.PI) / 3), r = 0.34 + 0.72 * t; return new THREE.Vector3(r * Math.cos(th), 0.1 * Math.sin(t * Math.PI), r * Math.sin(th)); });
    cyclone.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, 0.15, 8, false)));
  }
  const eye = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.12, 10, 32)); eye.rotation.x = Math.PI / 2; cyclone.add(eye);
  const cloud = new THREE.Mesh(new THREE.CylinderGeometry(1.08, 1.08, 0.06, 48)); cloud.userData.soft = true; cyclone.add(cloud);
  hurricane.add(cyclone); hurricane.rotation.x = 0.75;
  const none = new THREE.Group(); none.add(new THREE.Mesh(new THREE.SphereGeometry(0.35, 12, 10)));
  return { 0: hail, 1: wind, 2: tornado, 3: hurricane, [-1]: none };
})();
const SPIN = { 0: 0.25, 1: 0.9, 2: 1.8, 3: -0.7, [-1]: 0 };
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
function paperFor(part, kind) {
  if (part.kind === kind) return;
  part.kind = kind;
  part.sideTex = PAPER[kind].side.clone();                   // own copy so each stack repeats its bundles to its height
  part.sideMat.map = part.sideTex; part.topMat.map = PAPER[kind].top;
  part.sideMat.needsUpdate = part.topMat.needsUpdate = true;
}
function makePart(fips, rot) {
  const part = { sideMat: new THREE.MeshStandardMaterial({ roughness: 0.9, transparent: true }), topMat: new THREE.MeshStandardMaterial({ roughness: 0.85, transparent: true }), h0: 0, h1: 0 };
  paperFor(part, "money");
  part.mesh = new THREE.Mesh(stackGeo, [part.sideMat, part.sideMat, part.topMat, part.topMat, part.sideMat, part.sideMat]);
  part.mesh.rotation.y = rot; part.mesh.scale.y = 0.001; part.mesh.visible = false;
  part.mesh.userData.fips = fips; hits.push(part.mesh); world.add(part.mesh);
  return part;
}
function makeObj(m) {
  const obj = { fips: m.fips, group: new THREE.Group(), p0: new THREE.Vector3(), p1: new THREE.Vector3(), s0: 0.001, s1: 1, alpha: 1, alphaTo: 1 };
  obj.mat = new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.15, flatShading: true, transparent: true, emissiveIntensity: 0.5 });
  obj.softMat = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false, emissiveIntensity: 0.6 });
  obj.halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, opacity: 0.18 }));
  obj.halo.scale.setScalar(3.4); obj.group.add(obj.halo);
  obj.hit = new THREE.Mesh(hitGeo, hitMat); obj.hit.userData.fips = m.fips; obj.group.add(obj.hit); hits.push(obj.hit);
  const rot = (Math.random() - 0.5) * 0.5;
  obj.parts = [makePart(m.fips, rot), makePart(m.fips, rot)];
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
  for (const f of GEO.features) { const m = M.get(+f.id); if (m) m.xy = PROJ(d3.geoCentroid(f)); }
}

// the "claims match storms" diagonal in the match layout
const MATCH_W = 50, MATCH_H = 34;
const matchLine = (() => {
  const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-MATCH_W / 2, -MATCH_H / 2, 0), new THREE.Vector3(MATCH_W / 2, MATCH_H / 2, 0)]),
    new THREE.LineDashedMaterial({ color: 0x8c1d2f, dashSize: 1, gapSize: 0.8, transparent: true, opacity: 0.7 }));
  l.computeLineDistances(); l.visible = false; scene.add(l); return l;
})();

function layout() {
  const sf = SIZE_FACTOR[state.mode], all = [...M.values()], stacked = useStack();
  const nodes = all.map((m) => { const h = stacked ? [partH(m, 0), partH(m, 1)] : [0, 0]; return { m, h, r: stacked ? STORM_ON_STACK : sizeOf(m) * sf, top: h[0] + h[1] }; });
  if (state.mode === "map") {
    for (const d of nodes) { d.x = d.m.xy[0]; d.z = d.m.xy[1]; }
  } else if (state.mode === "burst") {
    for (const d of nodes) { const g = BURST[d.m.burst]; d.tx = g.x; d.tz = g.z; d.x = g.x + (Math.random() - 0.5); d.y = g.z + (Math.random() - 0.5); }
    const sim = d3.forceSimulation(nodes).force("x", d3.forceX((d) => d.tx).strength(0.08)).force("y", d3.forceY((d) => d.tz).strength(0.08))
      .force("c", d3.forceCollide((d) => (stacked ? 1.05 : d.r * 1.08 + 0.25)).iterations(2)).stop();
    for (let i = 0; i < 280; i++) sim.tick();
    for (const d of nodes) d.z = d.y;
  } else {
    for (const d of nodes) {
      if (d.m.claimGap == null) { d.r = 0.001; d.tx = d.x = 0; d.ty = d.y = -MATCH_H / 2 - 8; continue; }
      d.tx = (d.m.stormDaysPct - 0.5) * MATCH_W; d.ty = (d.m.lossPerPolicyPct - 0.5) * MATCH_H; d.x = d.tx; d.y = d.ty;
    }
    const sim = d3.forceSimulation(nodes).force("x", d3.forceX((d) => d.tx).strength(0.5)).force("y", d3.forceY((d) => d.ty).strength(0.5))
      .force("c", d3.forceCollide((d) => d.r * 0.95).iterations(1)).stop();
    for (let i = 0; i < 120; i++) sim.tick();
  }
  for (const d of nodes) {
    const o = OBJ.get(d.m.fips);
    const y = state.mode === "mismatch" ? d.y : d.top + d.r * 0.9, z = state.mode === "mismatch" ? 0 : d.z;
    o.p0.copy(o.group.position); o.p1.set(d.x, y, z);
    o.s0 = o.group.scale.x; o.s1 = d.r;
    o.parts.forEach((p, i) => { p.h0 = p.mesh.scale.y; p.h1 = d.h[i]; });
  }
  tween.t0 = performance.now();
  mapLines.visible = state.mode === "map";
  matchLine.visible = state.mode === "mismatch";
  buildLabels();
}

function applyStyle() {
  for (const m of M.values()) {
    const o = OBJ.get(m.fips) ?? makeObj(m);
    if (o.dom !== m.dom) shapeFor(o, m.dom);
    state.stack.forEach((s, i) => paperFor(o.parts[i], s.kind));
    const c = new THREE.Color(colorOf(m));
    o.mat.color.copy(c); o.mat.emissive.copy(c).multiplyScalar(0.22);
    o.softMat.color.copy(c); o.softMat.emissive.copy(c).multiplyScalar(0.3);
    o.halo.material.color.copy(c);
    o.alphaTo = state.focus && !state.focus.has(m.fips) ? 0.8 : 1;
  }
}

// camera + layout tween; in the story the card on the left needs the scene nudged right and pulled back a little
const tween = { t0: -1e9, dur: 1200, cam0: null, cam1: null };
function moveCamera() {
  const story = state.view === "story", [p, t] = CAMERA[state.mode].map((v) => new THREE.Vector3(...v)), dx = story ? STORY_DX[state.mode] : 0;
  t.x -= dx; p.x -= dx; p.sub(t).multiplyScalar(story ? 1.1 : 1.04).add(t);
  tween.cam0 = [camera.position.clone(), controls.target.clone()];
  tween.cam1 = [p, t];
  tween.t0 = performance.now();
}
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// ---------------------------------------------------------------- HTML labels projected from 3D
let LABELS = [];
const labelBox = $("#labels");
function buildLabels() {
  labelBox.innerHTML = ""; LABELS = [];
  const add = (html, cls, pos, obj = null) => { const el = document.createElement("div"); el.className = `lab3d ${cls}`; el.innerHTML = html; labelBox.appendChild(el); LABELS.push({ el, pos, obj }); return el; };
  if (CV) { for (const l of CV.labels) { const el = add(l.html, l.cls, l.pos); if (l.color) el.style.setProperty("--c", l.color); } return; }
  const all = [...M.values()], V = (x, y, z) => new THREE.Vector3(x, y, z), ch = STORY[state.chapter];
  const named = new Set(state.pair);
  // the contrast pair gets a callout with its number
  state.pair.forEach((f, i) => add(`${M.get(f).name}<small>${ch.pairValue(M.get(f))}</small>`, `pair ${i ? "b" : "a"}`, null, OBJ.get(f)));
  const nameAll = (ms) => { for (const m of ms) if (!named.has(m.fips)) { named.add(m.fips); add(m.name, "", null, OBJ.get(m.fips)); } };
  if (state.mode === "map") {
    const rank = (m) => (state.stack.length ? stackTotal(m) : m[state.size] ?? 0);
    nameAll(all.filter((m) => !state.focus || state.focus.has(m.fips)).sort((a, b) => rank(b) - rank(a)).slice(0, state.focus ? 10 : 6));
  } else if (state.mode === "burst") {
    for (const [k, g] of Object.entries(BURST)) {
      const members = all.filter((m) => m.burst === k); if (!members.length) continue;
      const zs = members.map((m) => OBJ.get(m.fips).p1.z);
      add(`${g.name} · ${members.length}<small>${g.note}</small>`, "group", V(g.x, 0, Math.max(...zs) + 4));
    }
  } else {
    add("More claims than storms suggest", "zone over", V(4, MATCH_H / 2 + 5, 0));
    add("Fewer claims than storms suggest", "zone under", V(MATCH_W / 4, -MATCH_H / 2 - 1, 0));
    add("fewer storm days  ←  storm frequency rank  →  more storm days", "note", V(0, -MATCH_H / 2 - 5, 0));
    add("↑ higher<br>claims", "axis", V(-MATCH_W / 2 - 1.5, MATCH_H / 2 - 1, 0));
    add("↓ lower<br>claims", "axis", V(-MATCH_W / 2 - 1.5, -MATCH_H / 2 + 1, 0));
    nameAll(all.filter((x) => x.claimGap != null).sort((a, b) => b.claimGap - a.claimGap).slice(0, 4));
  }
  if (state.sel && !named.has(state.sel)) add(M.get(state.sel).name, "", null, OBJ.get(state.sel));
}
const v3 = new THREE.Vector3();
function placeLabels() {
  const w = innerWidth, h = innerHeight;
  for (const l of LABELS) {
    if (l.obj) v3.copy(l.obj.group.position).y += l.obj.group.scale.x * 1.15; else v3.copy(l.pos);
    v3.project(camera);
    if (v3.z > 1) { l.el.style.display = "none"; continue; }
    l.el.style.display = ""; l.el.style.left = `${((v3.x + 1) / 2) * w}px`; l.el.style.top = `${((1 - v3.y) / 2) * h}px`;
    if (l.obj && !l.el.classList.contains("pair")) l.el.style.opacity = l.obj.alpha;
  }
}

// rings: the selected county, and the two counties of the contrast pair
const ring = (color) => { const r = new THREE.Mesh(new THREE.RingGeometry(1.3, 1.42, 64), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false })); r.visible = false; scene.add(r); return r; };
const selRing = ring(0x1d2233), pairRings = [ring(0x8c1d2f), ring(0x8c1d2f)];
const placeRing = (r, f) => { const o = f && OBJ.get(f); r.visible = !!o; if (!o) return; r.position.copy(o.group.position); r.scale.setScalar(Math.max(o.group.scale.x, 0.7) * 1.1); r.lookAt(camera.position); };

// ---------------------------------------------------------------- render loop + picking
const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2(-9, -9);
let lastT = performance.now(), pointerEvt = null;
function frame(now) {
  const dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
  const k = Math.min(1, (now - tween.t0) / tween.dur), e = ease(k);
  for (const o of OBJ.values()) {
    if (k < 1) { o.group.position.lerpVectors(o.p0, o.p1, e); o.group.scale.setScalar(o.s0 + (o.s1 - o.s0) * e); }
    else if (o.group.position.distanceToSquared(o.p1) > 0) { o.group.position.copy(o.p1); o.group.scale.setScalar(o.s1); }
    let base = 0;
    for (const p of o.parts) {
      const h = k < 1 ? p.h0 + (p.h1 - p.h0) * e : p.h1;
      p.mesh.visible = h > 0.002; p.mesh.scale.y = Math.max(h, 0.001);
      p.mesh.position.set(o.group.position.x, base, o.group.position.z); base += h;
      p.sideTex.repeat.set(1, h / BUNDLE_H);
      p.sideMat.opacity = p.topMat.opacity = o.alpha;
    }
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
  if (CV) { animateCounty(now, dt); selRing.visible = pairRings[0].visible = pairRings[1].visible = false; if (pointerEvt) pickCounty(); }
  else { placeRing(selRing, state.sel); pairRings.forEach((r, i) => placeRing(r, state.pair[i])); if (pointerEvt) pick(); }
  renderer.render(scene, camera);
  placeLabels();
  requestAnimationFrame(frame);
}
function pick() {
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(hits, false).find((h) => OBJ.get(h.object.userData.fips).s1 > 0.01);
  const f = hit ? hit.object.userData.fips : null;
  if (f !== state.hover) { state.hover = f; canvas.style.cursor = f ? "pointer" : ""; }
  if (f) showTip(pointerEvt, M.get(f)); else $("#tip").hidden = true;
}
canvas.addEventListener("pointermove", (e) => { pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); pointerEvt = e; });
canvas.addEventListener("pointerleave", () => { pointerEvt = null; state.hover = null; $("#tip").hidden = true; });
let down = null;
canvas.addEventListener("pointerdown", (e) => { down = [e.clientX, e.clientY]; });
canvas.addEventListener("pointerup", (e) => {
  if (CV || !down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
  if (state.hover) openCounty(state.hover);
});

function showTip(e, m) {
  const tip = $("#tip");
  const drive = m.dom >= 0 ? `${PERILS[m.dom].long}${m.domShare != null ? ` · ${fmtPct(m.domShare)} of damage` : ""}` : "no storm damage";
  tip.innerHTML = `<b>${m.name}</b> <small>County</small><br><span class="sw" style="background:${colorOf(m)}"></span>${state.view === "story" ? STORY[state.chapter].tip(m) : exploreTip(m)}<br>Main peril: ${drive}${m.coast ? `<br><small>Coastal: most wind claims go to TWIA, not in this data</small>` : ""}`;
  tip.hidden = false;
  tip.style.left = `${Math.min(e.clientX + 16, innerWidth - tip.offsetWidth - 10)}px`;
  tip.style.top = `${Math.min(e.clientY + 16, innerHeight - tip.offsetHeight - 10)}px`;
}

function exploreTip(m) {
  const L = LENSES[state.lens], out = [];
  if (L.type === "cat") out.push(m.cat ? CATS[m.cat].name : OTHER.name);
  else if (L.type !== "peril") out.push(`${L.tab}: <b>${L.fmt(m[state.lens])}</b>`);
  for (const p of state.stack) out.push(`${PAPER_KIND[p.kind].label}: ${p.kind === "policy" || p.kind === "uncovered" ? fmtCount(m[p.key]) : fmtMoney(m[p.key])}`);
  if (!state.stack.length) out.push(`${EXPLORE.sizes[state.size]}: ${state.size === "stormDays" ? fmt1(m.stormDays) : fmtCount(m.policies)}`);
  return out.join("<br>");
}

// ---------------------------------------------------------------- 2D icons for legends and the card
function icon(k, color) {
  if (k === 0) return `<g fill="${color}" stroke="#fff" stroke-opacity=".5" stroke-width="1"><circle cx="26" cy="31" r="12"/><circle cx="41" cy="22" r="7.5"/><circle cx="41" cy="41" r="6.5"/><circle cx="15" cy="45" r="5"/><circle cx="14" cy="17" r="4.5"/></g>`;
  if (k === 1) {
    const arms = d3.range(3).map((a) => "M" + d3.range(0, 31).map((i) => { const t = i / 30, th = t * 2.2 * Math.PI + (a * 2 * Math.PI) / 3, r = 3 + 23 * t; return `${30 + r * Math.cos(th)},${30 + r * Math.sin(th) * 0.8}`; }).join("L")).join(" ");
    return `<path d="${arms}" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round"/><circle cx="30" cy="30" r="3.5" fill="${color}"/>`;
  }
  if (k === 2) return `<path d="M8 10 Q30 2 52 10 Q44 22 37 32 Q32 42 30 55 Q27 42 23 32 Q16 22 8 10Z" fill="${color}" fill-opacity=".55" stroke="${color}" stroke-width="2"/><path d="M14 14 Q30 20 46 13 M20 25 Q31 29 41 24 M25 36 Q31 38 36 35" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="2"/>`;
  if (k === 3) return `<circle cx="30" cy="30" r="7" fill="none" stroke="${color}" stroke-width="5"/><path d="M23 30 C23 17 31 9 45 8 M37 30 C37 43 29 51 15 52" fill="none" stroke="${color}" stroke-width="5.5" stroke-linecap="round"/>`;
  return `<circle cx="30" cy="30" r="9" fill="${color}"/>`;
}
const stackSVG = (kind, n) => { const [f, e, s] = PAPER_KIND[kind].c; return `<svg viewBox="0 0 46 ${4 + n * 9}" width="40" height="${(4 + n * 9) * 0.87}">${d3.range(n).map((i) => { const y = 2 + (n - 1 - i) * 9;
  return `<rect x="${3 + (i % 2) * 2}" y="${y}" width="38" height="8" rx="1" fill="${f}" stroke="${e}"/><rect x="${25 + (i % 2) * 2}" y="${y}" width="5" height="8" fill="${s}"/>`; }).join("")}</svg>`; };
const billBar = (x, yBase, w, h, fill, edge) => { let out = ""; for (let y = yBase - 3.2; y >= yBase - h - 0.01; y -= 3.2) out += `<rect x="${x}" y="${y}" width="${w}" height="2.6" rx=".6" fill="${fill}" stroke="${edge}" stroke-width=".5"/>`; return out; };
const iconSVG = (k, color, cls = "") => `<svg viewBox="0 0 60 60" class="${cls}">${icon(k, color)}</svg>`;

// ---------------------------------------------------------------- the story
const pool = (ok = () => true) => [...M.values()].filter(ok);
const top = (key, n = 5, ok = () => true, dir = -1) => pool((m) => m[key] != null && isFinite(m[key]) && ok(m)).sort((a, b) => dir * (a[key] - b[key])).slice(0, n);
const rows = (ms, key, fmt, extra = () => "") => { const mx = d3.max(ms, (m) => Math.abs(m[key])) || 1; return ms.map((m) => ({ m, value: fmt(m[key]) + extra(m), bar: Math.abs(m[key]) / mx })); };
const big = (m) => m.policies >= MIN_POL && !m.coast;
// each chapter picks two counties that make its point by contrast
const PAIRS = {
  storms: () => [top("stormDays", 1)[0], top("stormDays", 1, () => true, 1)[0]],
  damage: () => { const a = top("damage", 1)[0]; return [a, top("damage", 1, (m) => m.stormDays >= a.stormDays * 0.9 && m !== a, 1)[0]]; },
  burst: () => { const t = top("damage", 5); return [t.reduce((a, b) => (b.top1 > a.top1 ? b : a)), t.reduce((a, b) => (b.top1 < a.top1 ? b : a))]; },
  homes: () => { const ok = (m) => m.owners >= 20000 && m.policies < m.owners; return [top("coverage", 1, ok)[0], top("coverage", 1, ok, 1)[0]]; },
  premium: () => { const ok = (m) => big(m) && m.policies >= 5000; return [top("lossRatio", 1, ok)[0], top("lossRatio", 1, ok, 1)[0]]; },
  match: () => [top("claimGap", 1)[0], top("claimGap", 1, () => true, 1)[0]],
};
let P = [];                                                  // the current pair, as county records
const vs = (fmt, key) => `<div class="st-vs">${P.map((m, i) => `<span class="${i ? "b" : "a"}"><b>${fmt(m[key])}</b>${m.name}</span>`).join("<i>vs</i>")}</div>`;
const STORY = [
  { short: "Storms", title: "Storms hit every part of Texas", mode: "map", lens: "peril", size: "stormDays", pair: PAIRS.storms,
    stat: () => [fmtInt(TX.reports), "hail, wind and tornado reports across the state, 2006–2025"],
    text: () => `All ${TX.counties} Texas counties had storms, but not the same storms: hail causes most damage in ${TX.domCount[0]} counties, thunderstorm wind in ${TX.domCount[1]} and tornadoes in ${TX.domCount[2]}. ${P[0].name} County averages ${fmt1(P[0].stormDays)} storm days a year; ${P[1].name} County only ${fmt1(P[1].stormDays)}.`,
    contrast: () => vs(fmt1, "stormDays"), pairValue: (m) => `${fmt1(m.stormDays)} storm days / yr`,
    read: "Shape and colour = main storm. Bigger = more storm days a year.",
    tip: (m) => `${fmt1(m.stormDays)} storm days a year`,
    list: () => [{ title: "Most storm days", sub: "storm days per year", rows: rows(top("stormDays"), "stormDays", fmt1) }] },
  { short: "Damage", title: "Storms turn into property damage", mode: "map", lens: "peril", size: "stormDays", stack: [{ key: "damage", kind: "damage" }], pair: PAIRS.damage,
    stat: () => [fmtMoney(TX.damageYr), "of property damage a year (NOAA estimates, 2025 $)"],
    text: () => `More storms do not always mean more damage. ${P[0].name} and ${P[1].name} see about the same number of storm days a year, but ${P[0].name} loses ${fmtMoney(P[0].damage)} a year and ${P[1].name} ${fmtMoney(P[1].damage)}. Hail is ${fmtPct(TX.hailRep)} of storm reports yet ${fmtPct(TX.hailDmg)} of the damage: one hailstorm over a city breaks thousands of roofs.`,
    contrast: () => vs(fmtMoney, "damage"), pairValue: (m) => `${fmtMoney(m.damage)} / yr · ${fmt1(m.stormDays)} storm days`,
    read: "Stack of money = property damage a year. Storm on top = main peril.",
    tip: (m) => `${fmtMoney(m.damage)} damage a year`,
    list: () => [{ title: "Most property damage", sub: "NOAA damage per year", rows: rows(top("damage"), "damage", fmtMoney) }] },
  { short: "One day vs many", title: "One bad day, or many small ones", mode: "burst", lens: "top1", size: "damage", stack: [{ key: "damage", kind: "damage" }], pair: PAIRS.burst,
    stat: () => [`${TX.burst.oneday} · ${TX.burst.spread}`, "counties hit by one big day · by many smaller days"],
    text: () => `${P[0].name} and ${P[1].name} lose similar money a year (${fmtMoney(P[0].damage)} and ${fmtMoney(P[1].damage)}). But ${fmtPct(P[0].top1)} of ${P[0].name}'s 20 years of damage came on a single day, while ${P[1].name}'s worst day was only ${fmtPct(P[1].top1)}. Steady losses can be priced into premiums; one-day catastrophes need reinsurance and capital.`,
    contrast: () => vs(fmtPct, "top1"), pairValue: (m) => `${fmtPct(m.top1)} of damage on its worst day`,
    read: "Stack of money = damage a year. Colour = share of 20 years of damage on the worst day (blue spread out, red one day).",
    tip: (m) => `${fmtPct(m.top1)} of 20 years of damage on its worst day`,
    list: () => [{ title: "Hit hardest on one day", sub: "share of damage on the worst day (damage over $1M a year)", rows: rows(top("top1", 5, (m) => m.damage >= 1e6), "top1", fmtPct) }] },
  { short: "Insured homes", title: "Insured homes, and homes without a policy", mode: "map", lens: "coverage", size: "policies", stack: [{ key: "insured", kind: "policy" }, { key: "uncovered", kind: "uncovered" }], pair: PAIRS.homes,
    stat: () => [fmtPct(TX.coverage), `of owner-occupied homes are insured · ${fmtCount(TX.uncovered)} are not`],
    text: () => `${fmtCount(TX.policies)} homeowners policies cover about ${fmtMoney(TX.insuredValue)} of homes. Each stack is a county's owner-occupied homes: the blue part is insured, the rose part has no homeowners policy, so a storm repair falls on the owner. ${P[0].name} insures ${fmtPct(P[0].coverage)} of its owner homes; ${P[1].name} only ${fmtPct(P[1].coverage)}. Homes on the Texas FAIR Plan or surplus lines are not counted, so the gap is an upper bound.`,
    contrast: () => vs(fmtPct, "coverage"), pairValue: (m) => `${fmtPct(m.coverage)} insured · ${fmtCount(m.uncovered)} without`,
    read: "Stack = owner homes: blue = insured, rose = no policy. Colour = share insured (orange low, blue high).",
    tip: (m) => `${fmtPct(m.coverage)} of owner homes insured · ${fmtCount(m.uncovered)} without a policy`,
    list: () => [{ title: "Most homes without a policy", sub: "owner homes without a policy (share)", rows: rows(top("uncovered"), "uncovered", fmtCount, (m) => ` · ${fmtPct(m.uncoveredShare)}`) }] },
  { short: "Premium vs claims", title: "Premium in, claims out", mode: "map", lens: "lossRatio", size: "policies", stack: [{ key: "paidPerYear", kind: "claims" }, { key: "keptPos", kind: "money" }], pair: PAIRS.premium,
    special: (m) => (m.coast ? COASTAL : null),
    stat: () => [fmtCents(TX.lossRatio), `paid in claims per premium dollar · ${fmtMoney(TX.paid)} paid 2019–2025`],
    text: () => `Each stack is a county's yearly premium (estimated from policies × average premium): the red part went back out as claims, the green part stayed with insurers. In ${P[0].name}, claims took ${fmtCents(P[0].lossRatio)} of every premium dollar; in ${P[1].name}, only ${fmtCents(P[1].lossRatio)}. Coastal counties (purple) look cheap only because their wind claims go to TWIA, which this data leaves out.`,
    contrast: () => vs(fmtCents, "lossRatio"), pairValue: (m) => `${fmtCents(m.lossRatio)} of each premium $ paid out`,
    read: "Stack = premium a year: red = claims paid, green = kept. Colour = claims per premium dollar (green low, red high).",
    tip: (m) => `${fmtCents(m.lossRatio)} paid per premium dollar · ${fmtMoney(m.paidPerYear)} claims, ${fmtMoney(m.premiumYear)} premium a year`,
    list: () => [{ title: "Claims eat the premium", sub: `claims per premium dollar (${fmtInt(MIN_POL)}+ policies)`, rows: rows(top("lossRatio", 5, big), "lossRatio", fmtCents) }] },
  { short: "Mismatch", title: "Few storms, many claims", mode: "mismatch", lens: "claimGap", size: "policies", pair: PAIRS.match,
    stat: () => [`${TX.nGap}`, "counties claim far more than their storms suggest"],
    text: () => `Left to right: how often storms hit. Bottom to top: how much is paid per policy. On the dashed line, claims match the storms. ${P[0].name} sits far above it (${fmtGap(P[0].claimGap)}): few storms, high claims, which can mean older roofs, costly repairs or claim practices worth a look. ${P[1].name} is the opposite (${fmtGap(P[1].claimGap)}): frequent storms, modest claims. Coastal and very small counties are left out.`,
    contrast: () => vs(fmtGap, "claimGap"), pairValue: (m) => `claims ${fmtGap(m.claimGap)} vs storms`,
    read: "Above the line = more claims than storms. Size = policies. Colour = gap (red above, blue below).",
    tip: (m) => (m.claimGap == null ? "not ranked (coastal or small)" : `claim rank ${fmtGap(m.claimGap)} vs storm rank`),
    list: () => [{ title: "Claims far above storms", sub: "claim rank minus storm rank", rows: rows(top("claimGap"), "claimGap", fmtGap) }] },
  { short: "Playbook", title: "Where to grow, review and protect", mode: "map", lens: "category", size: "policies", pair: () => [],
    focus: () => new Set(pool((m) => m.cat).map((m) => m.fips)),
    stat: () => [`${TX.cat.growth} · ${TX.cat.over} · ${TX.cat.rich}`, "counties to grow · review · protect"],
    text: () => Object.values(CATS).map((c) => `<span class="cat-line"><i style="background:${c.c}"></i><b>${c.name}</b>: ${c.note}.</span>`).join("") + `<span class="cat-line muted">Light blue: no flag. Coastal TWIA counties and books under ${fmtInt(MIN_POL)} policies are not flagged.</span>`,
    contrast: () => "", pairValue: () => "",
    read: "Size = policies. Click any county for its insurance card.",
    tip: (m) => (m.cat ? `${CATS[m.cat].name}: ${fmtCents(m.lossRatio)} claims per premium $ · ${fmtCount(m.uncovered)} homes without a policy` : `No flag · ${fmtCents(m.lossRatio)} claims per premium $`),
    list: () => [
      { title: CATS.growth.name, sub: "owner homes without a policy", color: CATS.growth.c, rows: rows(top("uncovered", 4, (m) => m.cat === "growth"), "uncovered", fmtCount) },
      { title: CATS.over.name, sub: "claims per premium dollar", color: CATS.over.c, rows: rows(top("lossRatio", 4, (m) => m.cat === "over"), "lossRatio", fmtCents) },
      { title: CATS.rich.name, sub: "premium kept per year", color: CATS.rich.c, rows: rows(top("premiumKept", 4, (m) => m.cat === "rich"), "premiumKept", fmtMoney) },
    ] },
];

function renderStory() {
  const i = state.chapter, ch = STORY[i], [v, lab] = ch.stat();
  $("#chapters").innerHTML = STORY.map((c, j) => `<button data-i="${j}" class="${j === i ? "on" : j < i ? "done" : ""}"><i>${j + 1}</i>${c.short}</button>`).join("");
  $("#story").innerHTML = `<div class="st-step">Chapter ${i + 1} of ${STORY.length}</div><h2>${ch.title}</h2>
    <div class="st-stat"><b>${v}</b><span>${lab}</span></div>${ch.contrast()}<p>${ch.text()}</p><div class="st-read">${ch.read}</div>
    <div class="st-nav"><button class="ghost" data-go="${i - 1}" ${i === 0 ? "disabled" : ""}>← Back</button>
      <div class="st-dots">${STORY.map((_, j) => `<i class="${j === i ? "on" : ""}"></i>`).join("")}</div>
      ${i < STORY.length - 1 ? `<button data-go="${i + 1}">Next →</button>` : `<button data-go="explore">Explore →</button>`}</div>`;
  $("#insights").innerHTML = `<h3>COUNTIES TO KNOW</h3>` + ch.list().map((g) => `<div class="ins-group"><div class="ins-title">${g.color ? `<i style="background:${g.color}"></i>` : ""}${g.title}<span>${g.sub}</span></div>` +
    g.rows.map((r, k) => `<button class="ins-row" data-f="${r.m.fips}"><em>${k + 1}</em><span>${r.m.name}</span><b>${r.value}</b><u style="width:${Math.max(4, r.bar * 100)}%;background:${g.color ?? colorOf(r.m)}"></u></button>`).join("") + `</div>`).join("");
}
function goChapter(i) {
  leaveCounty(true);
  const ch = STORY[i];
  Object.assign(state, { view: "story", chapter: i, mode: ch.mode, lens: ch.lens, size: ch.size, stack: ch.stack ?? [], special: ch.special ?? null, sel: null });
  state.focus = ch.focus ? ch.focus() : null;
  P = ch.pair(); state.pair = P.map((m) => m.fips);
  buildScales(); applyStyle(); renderChrome(); renderLegend(); layout(); moveCamera();
}
function startExplore() { state.view = "explore"; applyExplore(); moveCamera(); }
function applyExplore() {
  leaveCounty(true);
  const coastal = ex.lens === "lossRatio" || ex.stack === "premium";
  Object.assign(state, { mode: ex.mode, lens: ex.lens, size: ex.size, stack: EXPLORE.stacks[ex.stack].parts, special: coastal ? (m) => (m.coast ? COASTAL : null) : null, focus: null, sel: null });
  P = []; state.pair = [];
  buildScales(); applyStyle(); renderChrome(); renderLegend(); layout();
}
// top bar, side panels and explore controls for the current view
function renderChrome() {
  const story = state.view === "story";
  document.body.classList.toggle("is-story", story);
  document.querySelectorAll("#view-toggle button").forEach((b) => b.classList.toggle("on", b.dataset.v === state.view));
  if (story) renderStory();
  else {
    $("#tabs").innerHTML = EXPLORE.tabs.map((k) => `<button data-k="${k}" class="${k === ex.lens ? "on" : ""}" title="${LENSES[k].long}">${LENSES[k].tab}</button>`).join("");
    document.querySelectorAll("#mode button").forEach((b) => b.classList.toggle("on", b.dataset.mode === ex.mode));
    $("#mode-note").textContent = EXPLORE.notes[ex.mode];
    $("#f-stack").innerHTML = Object.entries(EXPLORE.stacks).map(([k, s]) => `<label><input type="radio" name="st" value="${k}" ${k === ex.stack ? "checked" : ""}/>${s.label}</label>`).join("");
    $("#f-size").innerHTML = Object.entries(EXPLORE.sizes).map(([k, l]) => `<label class="${ex.stack !== "none" ? "muted" : ""}"><input type="radio" name="sz" value="${k}" ${k === ex.size ? "checked" : ""}/>${l}</label>`).join("");
    $("#kpis").innerHTML = `<div><b>${fmtInt(TX.reports)}</b>storm reports 2006–2025</div><div><b>${fmtMoney(TX.damageYr)}</b>property damage a year</div>
      <div><b>${fmtPct(TX.coverage)}</b>of owner homes insured</div><div><b>${fmtCents(TX.lossRatio)}</b>claims per premium dollar</div>`;
  }
  renderPanels();
}

// ---------------------------------------------------------------- legend: shapes, stack, colour (every colour named)
function renderLegend() {
  const L = LENSES[state.lens], ink = "#3c4256";
  $("#shape-legend").innerHTML = `<div class="lg-title">Shape = main storm</div><div class="lg-row">${PERILS.map((p) => `<div>${iconSVG(p.k, L.type === "peril" ? p.c : ink)}<span>${p.name}</span></div>`).join("")}</div>`;
  if (useStack()) {
    $("#size-legend").innerHTML = `<div class="lg-title">Stack height = amount · one bundle ≈ ${state.stack[0].kind === "policy" ? `${fmtCount(bundle)} homes` : fmtMoney(bundle)}</div><div class="lg-row">${state.stack.map((s) => `<div class="cash-leg">${stackSVG(s.kind, 3)}<span>${PAPER_KIND[s.kind].label}</span></div>`).join("")}</div>`;
  } else {
    const ticks = [sizeOf.max, sizeOf.max / 4, sizeOf.max / 25], px = (v) => sizeOf.scale(v) * 6, R = px(ticks[0]), base = R * 2 + 8, f = state.size === "stormDays" ? fmt1 : fmtCount;
    $("#size-legend").innerHTML = `<div class="lg-title">Size = ${state.size === "stormDays" ? "storm days a year" : "homeowners policies"}</div><svg width="${R * 2 + 64}" height="${base + 2}">${ticks.map((v) => `<circle cx="${R + 1}" cy="${base - px(v)}" r="${px(v)}" fill="none" stroke="#3c4256" stroke-opacity=".55"/><line x1="${R + 1}" x2="${R * 2 + 8}" y1="${base - 2 * px(v)}" y2="${base - 2 * px(v)}" stroke="#3c4256" stroke-opacity=".3"/><text x="${R * 2 + 10}" y="${base + 3.5 - 2 * px(v)}">${f(v)}</text>`).join("")}</svg>`;
  }
  const sw = (c, t) => `<span><i style="background:${c}"></i>${t}</span>`;
  const extra = [];
  if (state.special && pool((m) => state.special(m)).length) extra.push(sw(COASTAL.c, COASTAL.name));
  if (L.type !== "cat" && L.type !== "peril" && state.mode !== "mismatch" && pool((m) => m[state.lens] == null && !state.special?.(m)).length) extra.push(sw(NO_DATA, "no data"));
  let body;
  if (L.type === "peril") body = `<div class="swatches">${PERILS.map((p) => sw(p.c, p.long)).join("")}</div>`;
  else if (L.type === "cat") body = `<div class="swatches">${Object.values(CATS).map((c) => sw(c.c, c.name)).join("")}${sw(OTHER.c, OTHER.name)}</div>`;
  else {
    const stops = d3.range(0, 1.01, 0.1).map((t) => `${colorOf.ramp(t)} ${t * 100}%`).join(",");
    body = `<div class="bar" style="background:linear-gradient(90deg,${stops})"></div><div class="ticks"><span>${L.fmt(lensScale.lo)} or less</span><span>Texas ${L.type === "div" ? "" : "median "}${L.fmt(lensScale.mid)}</span><span>${L.fmt(lensScale.hi)} or more</span></div>`;
  }
  $("#ramp").innerHTML = `<div class="title">Colour = ${L.long}</div>${body}${extra.length ? `<div class="swatches">${extra.join("")}</div>` : ""}`;
}
function renderPanels() {
  $("#card").hidden = !state.sel;
  $("#insights").hidden = !!state.sel || state.view !== "story";
  $("#controls").hidden = !!state.sel || state.view !== "explore";
}

// ---------------------------------------------------------------- county card
async function select(fips) {
  state.sel = fips;
  renderPanels(); buildLabels();
  if (!fips) return;
  const m = M.get(fips);
  const tdi = m.tdi.filter((t) => t.paid != null), maxP = d3.max(tdi, (t) => Math.max(0, t.paid)) || 1, bw = 268 / 7;
  const bars = tdi.map((t) => {
    const h = (Math.max(0, t.paid) / maxP) * 52, hw = (Math.max(0, Math.min(t.wind ?? 0, t.paid)) / maxP) * 52, x = (t.year - 2019) * bw + 4;
    return `<g><title>${t.year}: ${fmtMoney(t.paid)} paid, ${fmtMoney(t.wind)} wind & hail</title>${billBar(x, 56, bw - 8, h, "#fadbd1", "#e59a83")}${billBar(x, 56, bw - 8, hw, "#e59a83", "#c0533a")}</g><text x="${x + (bw - 8) / 2}" y="68" text-anchor="middle">${String(t.year).slice(2)}</text>`;
  }).join("");
  const stack = (vals, y, label) => {
    const tot = d3.sum(vals) || 1; let x = 52;
    return `<text x="0" y="${y + 10}">${label}</text>` + vals.map((v, p) => {
      const w = (v / tot) * 214, s = `<rect x="${x}" y="${y}" width="${w}" height="14" fill="${PERILS[p].c}"/>${w > 26 ? `<text x="${x + w / 2}" y="${y + 10.5}" text-anchor="middle" style="fill:#fff">${fmtPct(v / tot)}</text>` : ""}`;
      x += w; return s;
    }).join("");
  };
  const peril = m.dom >= 0 ? PERILS[m.dom] : null;
  const badges = [`<span class="badge">${BURST[m.burst].name}</span>`, m.cat ? `<span class="badge solid" style="background:${CATS[m.cat].c};border-color:${CATS[m.cat].c}">${CATS[m.cat].name}</span>` : "",
    m.coast ? `<span class="badge coast" title="Most wind claims go to TWIA, which is not in this data">TWIA coast</span>` : ""].join("");
  $("#card").innerHTML = `
    <div class="c-head">${iconSVG(m.dom, peril ? peril.c : NO_DATA)}<div><h2>${m.name} County</h2>${badges}</div><button class="c-close" title="Back">×</button></div>
    <div class="c-kpis">
      <div><b>${fmtMoney(m.damage)}</b>storm damage / yr <small>· ${fmtPct(m.top1)} on worst day</small></div>
      <div><b>${fmt1(m.stormDays)}</b>storm days / yr</div>
      <div><b>${fmtInt(m.policies)}</b>policies · ${fmtPct(m.coverage)} of owner homes</div>
      <div><b>${fmtCount(m.uncovered)}</b>owner homes without a policy</div>
      <div><b>${fmtCents(m.lossRatio)}</b>claims per premium $ <small>(est.)</small></div>
      <div><b>${fmtDollar(m.premium)}</b>avg premium 2025 <small>· ${m.premiumChange == null ? "n/a" : `+${Math.round(m.premiumChange * 100)}%`} since 2019</small></div>
    </div>
    <div class="c-sec">Claims paid by year <span><i style="color:#e59a83">■</i> wind &amp; hail ${fmtPct(m.windShare)}</span></div>
    <svg class="c-svg" viewBox="0 0 268 72">${bars}<text x="268" y="8" text-anchor="end">max ${fmtMoney(maxP)}</text></svg>
    <div class="c-sec">Peril mix <span>NOAA, 2006–2025</span></div>
    <svg class="c-svg" viewBox="0 0 268 38">${stack(m.reports, 2, "Reports")}${stack(m.dmgP, 21, "Damage")}</svg>
    <div class="c-sec">Worst storm days <span>NOAA reports</span></div>
    <div class="c-days" id="c-days"><div class="c-day" style="--c:#8a90a8">Loading reports…</div></div>`;
  $("#card .c-close").onclick = () => (CV ? leaveCounty() : select(null));
  const ev = await loadEvents(fips);
  if (state.sel !== fips) return;
  $("#c-days").innerHTML = m.topDays.length ? m.topDays.map((d) => {
    const rs = ev.rows.filter((r) => r[0] === d.date);
    const dp = d.dp.indexOf(Math.max(...d.dp)), places = [...new Set(rs.map((r) => r[5]).filter(Boolean))].slice(0, 3).join(", ");
    const mags = PERILS.map((p) => { const n = rs.filter((r) => r[2] === p.k).length; return n ? `${n} ${p.name.toLowerCase()}` : ""; }).filter(Boolean).join(" · ");
    const story = rs.map((r) => r[8]).filter(Boolean).sort((a, b) => b.length - a.length)[0] ?? "";
    const date = new Date(String(d.date).replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3T12:00")).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    return `<div class="c-day" style="--c:${PERILS[dp].c}"><b>${date}</b> · ${fmtMoney(d.d)} · ${mags}${places ? `<br>${places}` : ""}${story ? `<i>“${story}”</i>` : ""}</div>`;
  }).join("") : `<div class="c-day" style="--c:#8a90a8">No damaging storm days in 2006–2025.</div>`;
}
function loadEvents(fips) {
  if (!EVENTS.has(fips)) EVENTS.set(fips, fetch(`data/events/${fips}.json`).then((r) => r.json()));
  return EVENTS.get(fips);
}

// ---------------------------------------------------------------- county view
// Clicking a county swaps Texas for that county: its outline raised as a slab with its neighbours around it, every NOAA report
// as a dot where it happened, one 3D storm per peril floating above (size = damage a year, a line down to where its reports
// fell), 20 houses for its owner-occupied homes (blue roof = insured, red = no policy) and paper stacks for its money a year.
const CV_R = 17, SLAB = 1.2, CV_BH = 1, CV_CAM = [[0, 30, 49], [0, 3.2, 3]];
const ALL_PERILS = [...PERILS, HURR];
const MON = (d) => new Date(String(d).replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3T12:00")).toLocaleDateString("en-US", { month: "short", year: "numeric" });
let CV = null, NEIGHBORS = null;

function perilStats(m) {
  const out = PERILS.map((p) => ({ ...p, n: m.pDays[p.k], unit: "storm days", dmgYr: m.dmgP[p.k] / WINDOW, worst: m.pWorst[p.k] }));
  const w = m.trop.filter((t) => t.d != null).sort((a, b) => b.d - a.d)[0];
  out.push({ ...HURR, n: m.trop.length, unit: m.trop.length === 1 ? "storm" : "storms", dmgYr: m.tropDamage,
    worst: w && w.d > 0 ? { date: w.date, d: w.d, name: `${w.type}${w.name ? ` ${w.name}` : ""}` } : null });
  return out;
}
const worstText = (s) => (s.worst ? `worst: ${s.worst.name ? `${s.worst.name}, ` : ""}${MON(s.worst.date)} · ${fmtMoney(s.worst.d)}` : s.n ? "no damage estimate" : "none recorded");

function glyph(k, color, faint) {
  const g = TEMPLATES[k].clone(true);
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.15, flatShading: true, transparent: true, opacity: faint ? 0.3 : 1, emissive: new THREE.Color(color).multiplyScalar(0.22) });
  const soft = new THREE.MeshStandardMaterial({ color, roughness: 0.6, transparent: true, opacity: faint ? 0.12 : 0.35, side: THREE.DoubleSide, depthWrite: false });
  g.traverse((o) => { if (o.isMesh) o.material = o.userData.soft ? soft : mat; });
  return { g, spin: k === 1 || k === 2 || k === 3 ? g.children[0] : g, mats: [mat, soft] };
}
const HOUSE = (() => {
  const body = new THREE.BoxGeometry(0.8, 0.62, 0.8); body.translate(0, 0.31, 0);
  const roof = new THREE.ConeGeometry(0.68, 0.55, 4); roof.rotateY(Math.PI / 4); roof.translate(0, 0.9, 0);
  const m = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7, flatShading: true });
  return { body, roof, wall: { ins: m("#ffffff"), unc: m("#fbe9eb"), none: m("#eeeff3") }, top: { ins: m("#2c5aa0"), unc: m("#c81d4b"), none: m("#9aa0b4") } };
})();

function cvStack(kind, amount, bundleAmt, x, z, y0 = 0) {
  const h = Math.max(0.15, (amount / bundleAmt) * CV_BH);
  const side = PAPER[kind].side.clone(); side.repeat.set(1, h / CV_BH); side.needsUpdate = true;
  const sm = new THREE.MeshStandardMaterial({ map: side, roughness: 0.9 }), tm = new THREE.MeshStandardMaterial({ map: PAPER[kind].top, roughness: 0.85 });
  const mesh = new THREE.Mesh(stackGeo, [sm, sm, tm, tm, sm, sm]);
  mesh.position.set(x, y0, z); mesh.scale.set(2.3, 0.001, 2.3);
  CV.group.add(mesh); CV.own.push(sm, tm, side);
  CV.grow.push({ o: mesh, h, delay: 500, stack: true });
  return { mesh, h };
}

function openCounty(fips) {
  if (!fips) return;
  if (CV) clearCounty();
  const m = M.get(fips);
  state.county = fips;
  document.body.classList.add("in-county");
  world.visible = mapLines.visible = matchLine.visible = false;
  buildCounty(m);
  renderCountyPanel(m);
  select(fips);
  tween.cam0 = [camera.position.clone(), controls.target.clone()];
  tween.cam1 = CV_CAM.map((v) => new THREE.Vector3(...v));
  tween.t0 = performance.now();
}
// back to Texas; `quiet` when a chapter or Explore change redraws the scene anyway
function leaveCounty(quiet) {
  if (!CV) return;
  clearCounty(); state.county = null;
  document.body.classList.remove("in-county");
  world.visible = true; mapLines.visible = state.mode === "map"; matchLine.visible = state.mode === "mismatch";
  if (quiet) return;
  select(null); moveCamera();
}
function clearCounty() {
  scene.remove(CV.group);
  for (const x of CV.own) x.dispose();
  CV = null; $("#tip").hidden = true;
}

function buildCounty(m) {
  const feat = GEO.features.find((f) => +f.id === m.fips);
  const proj = d3.geoMercator().fitExtent([[-CV_R, -CV_R * 0.78], [CV_R, CV_R * 0.78]], feat);
  const group = new THREE.Group(); scene.add(group);
  CV = { fips: m.fips, group, own: [], hits: [], spin: [], grow: [], labels: [], t0: performance.now() };
  const own = (x) => (CV.own.push(x), x), V = (x, y, z) => new THREE.Vector3(x, y, z);
  const P = (c) => proj(c);                                   // [x, z] on the ground
  // the county slab
  const polys = feat.geometry.type === "Polygon" ? [feat.geometry.coordinates] : feat.geometry.coordinates;
  const toV = (ring) => ring.map((c) => { const [x, z] = P(c); return new THREE.Vector2(x, -z); });
  const shapes = polys.map((rings) => { const sh = new THREE.Shape(toV(rings[0])); sh.holes = rings.slice(1).map((r) => new THREE.Path(toV(r))); return sh; });
  const slabGeo = own(new THREE.ExtrudeGeometry(shapes, { depth: SLAB, bevelEnabled: false })); slabGeo.rotateX(-Math.PI / 2);
  const peril = m.dom >= 0 ? PERILS[m.dom].c : NO_DATA;
  const capMat = own(new THREE.MeshStandardMaterial({ color: new THREE.Color("#f4f6fb").lerp(new THREE.Color(peril), 0.12), roughness: 0.95 }));
  const sideMat = own(new THREE.MeshStandardMaterial({ color: "#c9cfe0", roughness: 0.9 }));
  const slab = new THREE.Mesh(slabGeo, [capMat, sideMat]); slab.scale.y = 0.001; group.add(slab);
  CV.grow.push({ o: slab, h: 1, delay: 0, slab: true });
  const lineMat = (color, opacity) => own(new THREE.LineBasicMaterial({ color, transparent: true, opacity }));
  const ringLines = (geom, y, mat) => {
    const a = [];
    for (const poly of geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates) for (const ring of poly)
      for (let i = 0; i < ring.length - 1; i++) { const p = P(ring[i]), q = P(ring[i + 1]); a.push(p[0], y, p[1], q[0], y, q[1]); }
    const g = own(new THREE.BufferGeometry()); g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(a), 3));
    group.add(new THREE.LineSegments(g, mat));
  };
  ringLines(feat.geometry, SLAB + 0.02, lineMat(0x8c1d2f, 0.9));
  // neighbours: faint outlines and names, so the county sits in its place
  if (!NEIGHBORS) NEIGHBORS = topojson.neighbors(TOPO.objects.counties.geometries);
  const idx = GEO.features.indexOf(feat), nbMat = lineMat(0x8a90a8, 0.55);
  for (const j of NEIGHBORS[idx]) {
    const f = GEO.features[j]; ringLines(f.geometry, 0, nbMat);
    const [x, z] = P(d3.geoCentroid(f)), d = Math.hypot(x, z), k = Math.min(1, (CV_R * 1.45) / d);
    CV.labels.push({ html: M.get(+f.id)?.name ?? "", cls: "nb", pos: V(x * k, 0, z * k) });
  }
  const [cx, cz] = P(d3.geoCentroid(feat));
  // 20 houses = the county's owner-occupied homes; blue roof insured, red roof no homeowners policy
  const known = m.coverage != null, nIns = known ? Math.round(m.coverage * 20) : 0;
  for (let i = 0; i < 20; i++) {
    const kind = !known ? "none" : i < nIns ? "ins" : "unc", col = i % 5, row = Math.floor(i / 5);
    const h = new THREE.Group();
    h.add(new THREE.Mesh(HOUSE.body, HOUSE.wall[kind]), new THREE.Mesh(HOUSE.roof, HOUSE.top[kind]));
    h.position.set(cx + (col - 2) * 1.45, SLAB, cz + (row - 1.5) * 1.45 + 1); h.scale.setScalar(0.001); group.add(h);
    const tip = !known ? `${fmtCount(m.owners)} owner homes · no TDI policy data` : kind === "ins" ? `Insured: ${fmtCount(m.insured)} of ${fmtCount(m.owners)} owner homes (${fmtPct(m.coverage)})` : `No homeowners policy: ${fmtCount(m.uncovered)} owner homes (${fmtPct(m.uncoveredShare)})`;
    h.children.forEach((c) => { c.userData.tip = `<b>Homes</b><br>${tip}<br><small>one house = 5% of the county's owner-occupied homes</small>`; CV.hits.push(c); });
    CV.grow.push({ o: h, s: 1, delay: 650 + i * 25 });
  }
  CV.labels.push({ html: `${known ? `${fmtPct(m.coverage)} insured` : "homes"}<small>${fmtCount(m.owners)} owner homes</small>`, cls: "cv-homes", pos: V(cx, SLAB + 2.4, cz - 2.2 + 1) });
  // one storm per peril above the back edge, size = damage a year
  const stats = perilStats(m), maxD = d3.max(stats, (s) => s.dmgYr) || 1, zb = -CV_R * 0.78 - 3;
  CV.stats = stats; CV.drop = [];
  stats.forEach((s, i) => {
    const x = (i - 1.5) * 9.2, y = 8, size = s.n ? 1.05 + 2.3 * Math.sqrt(s.dmgYr / maxD) : 0.75;
    const { g, spin, mats } = glyph(s.k, s.c, !s.n); CV.own.push(...mats);
    g.position.set(x, y, zb); g.scale.setScalar(0.001); group.add(g); CV.spin.push({ o: spin, k: s.k });
    CV.grow.push({ o: g, s: size, delay: 250 + i * 140 });
    const hit = new THREE.Mesh(hitGeo, hitMat); hit.scale.setScalar(size); hit.position.copy(g.position); group.add(hit);
    hit.userData.tip = `<b>${s.long}</b><br>${fmtInt(s.n)} ${s.unit}, 2006–2025<br>${fmtMoney(s.dmgYr)} property damage a year<br>${worstText(s)}${s.k === 3 ? "<br><small>NOAA zone reports; flooding from hurricanes is filed as flood and not counted</small>" : ""}`;
    CV.hits.push(hit);
    CV.labels.push({ html: `${s.name}<small>${fmtInt(s.n)} ${s.unit} · ${fmtMoney(s.dmgYr)}/yr</small>`, cls: `cv-peril${s.n ? "" : " off"}`, pos: V(x, y + size + 0.6, zb), color: s.c });
    // dashed line down to where the storm's reports fell (county centre for hurricanes, filed by zone)
    const dl = new THREE.Line(own(new THREE.BufferGeometry().setFromPoints([V(x, y - size * 0.9, zb), V(cx, SLAB, cz)])),
      own(new THREE.LineDashedMaterial({ color: s.c, dashSize: 0.6, gapSize: 0.4, transparent: true, opacity: s.n ? 0.95 : 0 })));
    dl.computeLineDistances(); dl.visible = false; group.add(dl); CV.drop.push({ line: dl, k: s.k, top: V(x, y - size * 0.9, zb) });
  });
  // money a year, in front of the county: storm damage (all four perils) and premium split into claims paid and kept
  const dmg = m.damage + m.tropDamage, prem = m.premiumYear, paid = m.paidPerYear;
  const topAmt = Math.max(dmg, prem ?? 0, paid ?? 0) || 1, raw = topAmt / 10, p10 = 10 ** Math.floor(Math.log10(raw));
  CV.bundle = [1, 2, 2.5, 5, 10].map((k) => k * p10).find((v) => v >= raw);
  const zf = CV_R * 0.78 + 4.5;
  const sd = cvStack("damage", dmg, CV.bundle, -5.5, zf);
  const tipD = `<b>Storm property damage</b><br>${fmtMoney(dmg)} a year (NOAA estimates, 2006–2025, 2025 $)<br>${stats.filter((s) => s.dmgYr > 0).map((s) => `${s.name} ${fmtMoney(s.dmgYr)}`).join(" · ")}`;
  sd.mesh.userData.tip = tipD; CV.hits.push(sd.mesh);
  CV.labels.push({ html: `Storm damage<small>${fmtMoney(dmg)} a year</small>`, cls: "cv-stack", pos: V(-5.5, sd.h + 0.5, zf) });
  if (prem != null && paid != null) {
    const kept = Math.max(0, prem - paid), sc = cvStack("claims", Math.max(0, paid), CV.bundle, 5.5, zf);
    const sk = kept > 0 ? cvStack("money", kept, CV.bundle, 5.5, zf, sc.h) : null;
    if (sk) CV.grow[CV.grow.length - 1].base = sc;            // the kept part rides on top of the claims part
    const tipP = `<b>Homeowners premium</b><br>${fmtMoney(prem)} a year (estimated, 2019–2025)<br>${fmtMoney(paid)} paid back in claims (${fmtCents(m.lossRatio)} per premium $)<br>${kept > 0 ? `${fmtMoney(kept)} kept by insurers` : "claims took more than the premium"}`;
    for (const st of [sc, sk]) if (st) { st.mesh.userData.tip = tipP; CV.hits.push(st.mesh); }
    CV.labels.push({ html: `Premium ${fmtMoney(prem)}<small>red ${fmtMoney(paid)} claims · green ${fmtMoney(kept)} kept</small>`, cls: "cv-stack", pos: V(5.5, sc.h + (sk?.h ?? 0) + 0.5, zf) });
  } else CV.labels.push({ html: `Premium<small>no TDI data</small>`, cls: "cv-stack", pos: V(5.5, 0.6, zf) });
  // NOAA reports as dots where they happened, and the storm lines retargeted to their centre
  loadEvents(m.fips).then((ev) => {
    if (!CV || CV.fips !== m.fips) return;
    const sphere = own(new THREE.SphereGeometry(0.17, 8, 6)), dummy = new THREE.Object3D(), cent = [[], [], []];
    for (const p of PERILS) {
      const rs = ev.rows.filter((r) => r[2] === p.k && r[6] != null && r[7] != null);
      if (!rs.length) continue;
      const im = new THREE.InstancedMesh(sphere, own(new THREE.MeshStandardMaterial({ color: p.c, roughness: 0.5, transparent: true, opacity: 0.85 })), rs.length);
      rs.forEach((r, i) => {
        const [x, z] = P([r[7], r[6]]); cent[p.k].push([x, z]);
        dummy.position.set(x, SLAB + 0.12, z); dummy.scale.setScalar(r[4] > 0 ? 1 + Math.min(1.6, Math.log10(1 + r[4] / 1e4) * 0.5) : 0.8); dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix);
      });
      group.add(im);
    }
    for (const d of CV.drop) {
      const c = cent[d.k] ?? [];
      const end = c.length ? V(d3.mean(c, (q) => q[0]), SLAB, d3.mean(c, (q) => q[1])) : V(cx, SLAB, cz);
      d.line.geometry.setFromPoints([d.top, end]); d.line.computeLineDistances();
    }
  });
  buildLabels();
}

function renderCountyPanel(m) {
  const stats = perilStats(m), row = (s) => `<div class="cv-row${s.n ? "" : " off"}">${iconSVG(s.k, s.c)}<div><b>${s.long}</b><span>${fmtInt(s.n)} ${s.unit} · ${worstText(s)}</span></div><em>${fmtMoney(s.dmgYr)}<small>/yr</small></em></div>`;
  const house = (c) => `<svg viewBox="0 0 20 20" width="16" height="16"><path d="M3 9 L10 3 L17 9Z" fill="${c}"/><rect x="5" y="9" width="10" height="8" fill="#fff" stroke="${c}" stroke-width="1.2"/></svg>`;
  $("#county").innerHTML = `<button class="cv-back">← Back to Texas</button>
    <div class="st-step">County view · 2006–2025</div><h2>${m.name} County</h2>
    <div class="cv-sec">The four perils <span>damage a year, 2025 $</span></div>${stats.map(row).join("")}
    <div class="cv-sec">Homes <span>20 houses = all owner homes</span></div>
    <div class="cv-legend">${m.coverage == null ? `${house("#9aa0b4")} ${fmtCount(m.owners)} owner homes, no TDI policy data` : `<span>${house("#2c5aa0")} insured <b>${fmtPct(m.coverage)}</b> · ${fmtCount(m.insured)}</span><span>${house("#c81d4b")} no policy <b>${fmtPct(m.uncoveredShare)}</b> · ${fmtCount(m.uncovered)}</span>`}</div>
    <div class="cv-sec">Money a year <span>one bundle ≈ ${fmtMoney(CV.bundle)}</span></div>
    <div class="cv-legend"><span>${stackSVG("damage", 2)} storm damage <b>${fmtMoney(m.damage + m.tropDamage)}</b></span>${m.premiumYear != null ? `<span>${stackSVG("claims", 2)} claims paid <b>${fmtMoney(m.paidPerYear)}</b></span><span>${stackSVG("money", 2)} premium kept <b>${fmtMoney(Math.max(0, m.premiumYear - m.paidPerYear))}</b></span>` : ""}</div>
    <p class="cv-note">Dots: every NOAA hail, wind and tornado report, where it happened (bigger = damage reported). Hurricanes, tropical storms and storm surge come from NOAA zone reports matched to the county; hurricane flooding is filed as flood and is not counted. Drag to turn, hover for numbers.</p>`;
  $("#county .cv-back").onclick = () => leaveCounty();
}

function animateCounty(now, dt) {
  const t = now - CV.t0;
  for (const g of CV.grow) {
    const e = ease(Math.min(1, Math.max(0, (t - g.delay) / 700)));
    if (g.slab) g.o.scale.y = Math.max(0.001, e);
    else if (g.stack) { g.o.scale.y = Math.max(0.001, g.h * e); if (g.base) g.o.position.y = g.base.mesh.scale.y; }
    else g.o.scale.setScalar(Math.max(0.001, g.s * e));
  }
  if (t > 1200) for (const d of CV.drop) d.line.visible = true;
  for (const s of CV.spin) s.o.rotation.y += dt * SPIN[s.k];
}
function pickCounty() {
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(CV.hits, false)[0], tip = $("#tip");
  canvas.style.cursor = hit ? "help" : "";
  if (!hit) { tip.hidden = true; return; }
  tip.innerHTML = hit.object.userData.tip; tip.hidden = false;
  tip.style.left = `${Math.min(pointerEvt.clientX + 16, innerWidth - tip.offsetWidth - 10)}px`;
  tip.style.top = `${Math.min(pointerEvt.clientY + 16, innerHeight - tip.offsetHeight - 10)}px`;
}

// ---------------------------------------------------------------- wiring
function bind() {
  $("#chapters").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) goChapter(+b.dataset.i); });
  $("#story").addEventListener("click", (e) => { const b = e.target.closest("button[data-go]"); if (!b || b.disabled) return; b.dataset.go === "explore" ? startExplore() : goChapter(+b.dataset.go); });
  $("#view-toggle").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b || b.dataset.v === state.view) return; b.dataset.v === "story" ? goChapter(state.chapter) : startExplore(); });
  $("#tabs").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; ex.lens = b.dataset.k; applyExplore(); });
  document.querySelectorAll("#mode button").forEach((b) => b.addEventListener("click", () => { if (ex.mode === b.dataset.mode) return; ex.mode = b.dataset.mode; applyExplore(); moveCamera(); }));
  $("#f-stack").addEventListener("change", (e) => { ex.stack = e.target.value; applyExplore(); });
  $("#f-size").addEventListener("change", (e) => { ex.size = e.target.value; applyExplore(); });
  $("#county-list").innerHTML = [...M.values()].sort((a, b) => a.name.localeCompare(b.name)).map((m) => `<option value="${m.name}"></option>`).join("");
  $("#search").addEventListener("change", (e) => { const m = [...M.values()].find((x) => x.name.toLowerCase() === e.target.value.trim().toLowerCase()); if (m) { e.target.value = ""; openCounty(m.fips); } });
  $("#insights").addEventListener("click", (e) => { const b = e.target.closest(".ins-row"); if (b) openCounty(+b.dataset.f); });
  addEventListener("keydown", (e) => {
    if (e.key === "Escape") { $("#guide").hidden = true; if (CV) leaveCounty(); else if (state.sel) select(null); }
    if (state.view !== "story" || e.target.matches("input")) return;
    if (e.key === "ArrowRight") state.chapter < STORY.length - 1 ? goChapter(state.chapter + 1) : startExplore();
    if (e.key === "ArrowLeft" && state.chapter > 0) goChapter(state.chapter - 1);
  });
  const resize = () => { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); };
  addEventListener("resize", resize); resize();
}
$("#btn-help").onclick = () => ($("#guide").hidden = false);
$("#guide-close").onclick = () => ($("#guide").hidden = true);

Promise.all(["storm_days", "tdi", "cpi", "tx.topo", "context", "tropical"].map((f) => fetch(`data/${f}.json`).then((r) => r.json()))).then(([sd, tdi, cpi, topo, ctx, trop]) => {
  SD = sd; NAMES = sd.names; TDIDATA = tdi; CPI = cpi; TOPO = topo; CTX = ctx.counties; TROP = trop.counties;
  compute(); initMap(); bind();
  document.querySelectorAll(".g-ico").forEach((s) => (s.innerHTML = icon(+s.dataset.shape, PERILS[+s.dataset.shape].c)));
  goChapter(0);
  requestAnimationFrame(frame);
});
