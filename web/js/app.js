/* Storm Damage Risk Analytics · Texas
 * One screen, three coordinated views:
 *   A Filter view   time window, hazards, dollars, map colour, selected counties, data notes
 *   B Comparison    b1 map + b2 county comparison (R1), b3 damage concentration (R2), b4 hazard contribution (R3)
 *   C Detail        c1 recurring vs. catastrophic typology (R2), c2 temporal patterns (R4), c3 event investigation (R5)
 * Brushing years in c2 narrows every other view to those years; clicking a storm day in b3 (or a year in c2) opens the
 * NOAA reports behind it in c3.
 * A storm day = all hail, thunderstorm-wind and tornado reports in one county on one date (NOAA splits one storm
 * into many reports). Every number is computed here from web/data, so all views share the same filters. */

const PERILS = [{ k: 0, name: "Hail", c: "#5b8fc9" }, { k: 1, name: "Wind", c: "#d9a441" }, { k: 2, name: "Tornado", c: "#8e6bb5" }];
const SEL_COLORS = ["#0f8b8d", "#e4572e", "#2e4057", "#a23b72"];
const DEFAULT_SEL = [48439, 48029, 48303, 48041];            // Tarrant, Bexar, Lubbock, Brazos: similar totals, different patterns
const LAST_YEAR = 2025;
const fmtMoney = (v) => (v == null || isNaN(v) ? "n/a" : v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)}M` : v >= 1e3 ? `$${Math.round(v / 1e3)}K` : `$${Math.round(v)}`);
const fmtPct = (v) => (v == null || isNaN(v) ? "n/a" : `${Math.round(v * 100)}%`);
const fmt1 = (v) => (v == null || isNaN(v) ? "n/a" : v >= 10 ? v.toFixed(0) : v.toFixed(1));
const METRICS = {
  stormDays: { label: "Storm days / yr", long: "Storm days per year", short: "Storm days per year", fmt: fmt1, log: true, map: true },
  damagingDays: { label: "Damaging days / yr", long: "Storm days with reported damage, per year", fmt: fmt1, log: true },
  damage: { label: "NOAA damage / yr", long: "NOAA estimated property damage per year", short: "NOAA damage per year", fmt: fmtMoney, log: true, map: true },
  damagePerHome: { label: "Damage / home / yr", long: "NOAA damage per housing unit per year (ACS 2020–2024 homes)", short: "Damage per home", fmt: fmtMoney, log: true, map: true },
  medianDay: { label: "Median damaging day", long: "Median NOAA damage per damaging storm day", fmt: fmtMoney, log: true },
  top1: { label: "Largest-day share", long: "Share of window damage from the single worst storm day", short: "Largest storm-day share", fmt: fmtPct, map: true },
  top5: { label: "Top-5 day share", long: "Share of window damage from the 5 worst storm days", fmt: fmtPct },
  lossPerPolicy: { label: "TDI loss / policy", long: "TDI homeowners paid loss per policy, 2019–2025", short: "TDI paid loss per policy", fmt: fmtMoney, log: true, map: true },
  windShare: { label: "Wind & hail share", long: "Wind & hail share of TDI paid losses, 2019–2025", fmt: fmtPct },
  premium: { label: "Avg premium 2025", long: "TDI average homeowners premium with wind coverage, 2025", short: "Average premium (2025)", fmt: fmtMoney, map: true },
};
const COMPARE_ROWS = ["stormDays", "damagingDays", "damage", "damagePerHome", "medianDay", "top1", "lossPerPolicy", "windShare", "premium"];

const state = { window: 20, brush: null, perils: new Set([0, 1, 2]), real: true, mapMetric: "damage", sel: [...DEFAULT_SEL], r4: "damage", r4Scale: "own", focus: null };
let DATA, NAMES, TOPO, CPI, CTX, M = new Map(), TX = null, TYPO = null;
const EVENTS = new Map();                                    // fips -> promise of that county's NOAA reports
const windowRange = () => [LAST_YEAR - state.window + 1, LAST_YEAR];
const yearRange = () => state.brush ?? windowRange();        // the years every view summarizes
const iso = (d) => String(d).replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3");
const $ = (s) => document.querySelector(s);
const tip = $("#tip");
const showTip = (e, text) => { tip.textContent = text; tip.hidden = false; moveTip(e); };
const moveTip = (e) => { const x = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8), y = Math.min(e.clientY + 14, innerHeight - tip.offsetHeight - 8); tip.style.left = `${x}px`; tip.style.top = `${y}px`; };
const hideTip = () => { tip.hidden = true; };
const colorOf = (fips) => SEL_COLORS[state.sel.indexOf(fips)];

// ---------------------------------------------------------------- metrics (one pass per county)
function countyMetrics(fips) {
  const [y0, y1] = yearRange(), n = y1 - y0 + 1, [w0] = windowRange(), P = [...state.perils];
  const rows = DATA.counties[fips] ?? [];
  const reports = [0, 0, 0], dmgP = [0, 0, 0];
  const annual = d3.range(w0, LAST_YEAR + 1).map((year) => ({ year, damage: 0, days: 0, worst: null }));
  const dmgDays = [];
  let stormDays = 0, total = 0, nRep = 0, blank = 0;
  for (const r of rows) {
    const yr = Math.floor(r[0] / 10000); if (yr < w0) continue;
    const k = state.real ? CPI.toBase[yr] : 1;
    let d = 0, c = 0, b = 0;
    for (const p of P) { d += r[1 + p] * k; c += r[4 + p]; b += r[7 + p]; }
    if (!c) continue;
    const a = annual[yr - w0]; a.days++; a.damage += d;
    if (d > 0 && (!a.worst || d > a.worst.d)) a.worst = { date: r[0], d };
    if (yr < y0 || yr > y1) continue;
    for (const p of P) { reports[p] += r[4 + p]; dmgP[p] += r[1 + p] * k; }
    stormDays++; nRep += c; total += d; blank += b;
    if (d > 0) dmgDays.push({ date: r[0], d });
  }
  const avg = d3.mean(annual, (a) => a.damage);
  for (const a of annual) a.flag = avg > 0 && a.damage >= 2 * avg;
  dmgDays.sort((a, b) => b.d - a.d);
  const cum = []; let run = 0;
  for (const x of dmgDays.slice(0, 20)) { run += x.d; cum.push(total ? run / total : 0); }
  const sortedAsc = dmgDays.map((x) => x.d).sort((a, b) => a - b);
  const median = sortedAsc.length ? d3.median(sortedAsc) : null;
  const cx = CTX[fips] ?? {};
  return {
    fips, name: NAMES[fips], stormDays: stormDays / n, damagingDays: dmgDays.length / n, damage: total / n,
    damagePerHome: cx.homes ? total / n / cx.homes : null, premium: cx.premium2025 ?? null,
    medianDay: median, meanDay: dmgDays.length ? total / dmgDays.length : null,
    top1: total ? dmgDays[0].d / total : null, top5: total && dmgDays.length >= 3 ? cum[Math.min(4, cum.length - 1)] : null,
    cum, topDays: dmgDays.slice(0, 20), annual, reports, dmgP, nRep, blank, nDmgDays: dmgDays.length, ...TDI(fips),
  };
}
function TDI(fips) {
  const rows = DATA.tdi.counties[fips] ?? [];
  let paid = 0, wind = 0, pol = 0;
  for (const [yr, p, w, n] of rows) { if (p == null || !n) continue; const k = state.real ? CPI.toBase[yr] : 1; paid += p * k; wind += (w ?? 0) * k; pol += n; }
  return { lossPerPolicy: pol ? paid / pol : null, windShare: paid > 0 ? wind / paid : null };
}
function computeAll() {
  M = new Map(Object.keys(NAMES).map((f) => [+f, countyMetrics(+f)]));
  // Texas as a whole (for the hazard reference row and the notes)
  const all = [...M.values()];
  TX = { reports: [0, 1, 2].map((p) => d3.sum(all, (m) => m.reports[p])), dmgP: [0, 1, 2].map((p) => d3.sum(all, (m) => m.dmgP[p])),
    nRep: d3.sum(all, (m) => m.nRep), blank: d3.sum(all, (m) => m.blank) };
  const pts = all.filter((m) => m.nDmgDays >= 3 && m.top1 != null);
  TYPO = { pts, medX: d3.median(pts, (m) => m.damagingDays), medY: d3.median(pts, (m) => m.top1) };
  for (const m of all) m.type = m.nDmgDays < 3 || m.top1 == null ? "Too few damaging days" :
    m.top1 >= TYPO.medY ? (m.damagingDays >= TYPO.medX ? "Recurring + dominant storms" : "Catastrophe-driven") : (m.damagingDays >= TYPO.medX ? "Recurring" : "Occasional");
}

// ---------------------------------------------------------------- A · filters
function renderFilters() {
  const [y0, y1] = yearRange(), inRange = (r) => { const y = Math.floor(r[0] / 10000); return y >= y0 && y <= y1; };
  const counts = [0, 1, 2].map((p) => { let s = 0; for (const rows of Object.values(DATA.counties)) for (const r of rows) if (inRange(r)) s += r[4 + p]; return s; });
  const total = d3.sum(counts) || 1, shares = counts.map((c) => c / total);
  $("#f-years").innerHTML = state.brush ? `years ${y0}–${y1} <a href="#" id="f-clear">clear</a>` : `NOAA ${y0}–${y1}`;
  $("#f-perils").innerHTML = PERILS.map((p) => `<div class="peril ${state.perils.has(p.k) ? "on" : "off"}" data-p="${p.k}" style="--c:${p.c}">
    <span class="box"></span><span>${p.name}</span><span class="bar-bg"><i style="width:${shares[p.k] * 100}%"></i></span><small>${fmtPct(shares[p.k])}</small></div>`).join("");
  $("#peril-legend").innerHTML = PERILS.map((p) => `<span><i style="background:${p.c}"></i>${p.name}</span>`).join("");
  $("#f-metric").innerHTML = Object.entries(METRICS).filter(([, m]) => m.map).map(([k, m]) => `<label title="${m.long}"><input type="radio" name="mm" value="${k}" ${k === state.mapMetric ? "checked" : ""}/>${m.short}</label>`).join("");
}
function renderChips() {
  $("#f-chips").innerHTML = state.sel.map((f) => { const m = M.get(f);
    return `<div class="chip" style="--c:${colorOf(f)}"><i></i><b>${m.name}</b><small>${m.type}</small><button data-rm="${f}" aria-label="Remove ${m.name}">×</button></div>`; }).join("") +
    (state.sel.length < 4 ? `<div class="chip" style="--c:#ddd;color:#aaa"><i></i><span>Add up to ${4 - state.sel.length} more</span></div>` : "");
}
function renderNotes() {
  const [y0] = yearRange();
  $("#f-notes").innerHTML = [
    `NOAA damage is a weather-service estimate, not an insurance payout.`,
    `${fmtPct(TX.blank / TX.nRep)} of ${y0}–${yearRange()[1]} reports have no damage value (unknown, not $0).`,
    `TDI losses: homeowners policies, 2019–2025, excluding TWIA.`,
    `Premiums: TDI 2025, with wind. Homes: ACS 2020–2024.`,
    state.real ? `2025 dollars via CPI-U (prices only).` : `Nominal dollars.`,
  ].map((t) => `<li>${t}</li>`).join("");
}

// ---------------------------------------------------------------- B1 · map (R1)
function size(id) { const el = document.querySelector(`#${id} .chart`); return { el, w: el.clientWidth, h: el.clientHeight }; }
function svgIn(el, w, h) { el.innerHTML = ""; return d3.select(el).append("svg").attr("viewBox", `0 0 ${w} ${h}`); }
function renderMap() {
  const { el, w, h } = size("p-map"), svg = svgIn(el, w, h);
  const key = state.mapMetric, meta = METRICS[key];
  $("#map-title").textContent = meta.long + (key === "lossPerPolicy" || key === "premium" ? "" : `, ${yearRange().join("–")}`);
  const geo = topojson.feature(TOPO, TOPO.objects.counties);
  const proj = d3.geoConicEqualArea().parallels([27.5, 35]).rotate([100, 0]).fitExtent([[8, 8], [w - 96, h - 8]], geo);
  const path = d3.geoPath(proj);
  const vals = [...M.values()].map((m) => m[key]).filter((v) => v != null && v > 0);
  const lo = d3.quantile(vals.sort(d3.ascending), 0.03), hi = d3.quantile(vals, 0.98);
  const t = meta.log ? d3.scaleLog().domain([Math.max(lo, 1e-3), hi]).clamp(true) : d3.scaleLinear().domain([lo, hi]).clamp(true);
  const color = (v) => (v == null || v <= 0 ? "#efeeea" : d3.interpolateRgb("#f7e7df", "#660d12")(t(v)));
  svg.append("g").selectAll("path").data(geo.features).join("path").attr("class", "county-path").attr("d", path)
    .attr("fill", (d) => color(M.get(+d.id)?.[key]))
    .on("mousemove", (e, d) => { const m = M.get(+d.id); showTip(e, `${m.name} County\n${meta.long}: ${meta.fmt(m[key])}\nPattern: ${m.type}\nClick to ${state.sel.includes(m.fips) ? "remove from" : "add to"} the comparison`); })
    .on("mouseleave", hideTip).on("click", (e, d) => toggle(+d.id));
  const selF = geo.features.filter((f) => state.sel.includes(+f.id));
  svg.append("g").selectAll("path").data(selF).join("path").attr("class", "sel-outline").attr("d", path).attr("stroke", (d) => colorOf(+d.id));
  svg.append("g").selectAll("text").data(selF).join("text").attr("x", (d) => path.centroid(d)[0]).attr("y", (d) => path.centroid(d)[1] - 7)
    .attr("text-anchor", "middle").attr("font-size", 10.5).attr("font-weight", 700).attr("fill", (d) => colorOf(+d.id)).attr("paint-order", "stroke").attr("stroke", "#fff").attr("stroke-width", 3)
    .text((d) => M.get(+d.id).name);
  // legend
  const L = svg.append("g").attr("transform", `translate(${w - 84},${h / 2 - 70})`), steps = 6;
  L.append("text").attr("class", "lab").attr("y", -8).text(meta.label);
  d3.range(steps).forEach((i) => {
    const v = meta.log ? Math.exp(Math.log(t.domain()[0]) + (i / (steps - 1)) * (Math.log(t.domain()[1]) - Math.log(t.domain()[0]))) : t.domain()[0] + (i / (steps - 1)) * (t.domain()[1] - t.domain()[0]);
    L.append("rect").attr("y", i * 20).attr("width", 14).attr("height", 18).attr("fill", color(v));
    L.append("text").attr("class", "lab").attr("x", 19).attr("y", i * 20 + 12).text((i === steps - 1 ? "≥ " : "") + meta.fmt(v));
  });
  L.append("rect").attr("y", steps * 20 + 6).attr("width", 14).attr("height", 12).attr("fill", "#efeeea");
  L.append("text").attr("class", "lab").attr("x", 19).attr("y", steps * 20 + 16).text("none / n/a");
}

// ---------------------------------------------------------------- B2 · county comparison (R1)
function renderCompare() {
  const { el, w, h } = size("p-compare"), svg = svgIn(el, w, h);
  const sel = state.sel.map((f) => M.get(f)), colW = 56, labW = 118, right = colW * sel.length + 8;
  const top = 24, rowH = (h - top - 6) / COMPARE_ROWS.length, x0 = labW, x1 = w - right - 10;
  sel.forEach((m, i) => svg.append("text").attr("x", w - right + i * colW + colW / 2).attr("y", 14).attr("text-anchor", "middle").attr("font-size", 10.5).attr("font-weight", 700).attr("fill", colorOf(m.fips)).text(m.name.length > 9 ? m.name.slice(0, 8) + "." : m.name));
  COMPARE_ROWS.forEach((k, r) => {
    const meta = METRICS[k], y = top + r * rowH + rowH / 2;
    const vals = [...M.values()].map((m) => m[k]).filter((v) => v != null && (!meta.log || v > 0));
    const ext = d3.extent(vals);
    const sc = (meta.log ? d3.scaleLog().domain([Math.max(ext[0], 1e-3), ext[1]]) : d3.scaleLinear().domain([0, ["top1", "top5", "windShare"].includes(k) ? 1 : ext[1]])).range([x0, x1]).clamp(true);
    const g = svg.append("g");
    if (r % 2 === 0) g.append("rect").attr("x", 0).attr("y", y - rowH / 2).attr("width", w).attr("height", rowH).attr("fill", "#faf9f6");
    g.append("text").attr("x", 6).attr("y", y + 3).attr("font-size", 11).attr("fill", "#333").text(meta.label).append("title").text(meta.long);
    g.append("line").attr("x1", x0).attr("x2", x1).attr("y1", y).attr("y2", y).attr("stroke", "#e2dfd8");
    g.selectAll(".tick").data(vals).join("line").attr("x1", (v) => sc(v)).attr("x2", (v) => sc(v)).attr("y1", y - 6).attr("y2", y + 6).attr("stroke", "#c9c5bd").attr("stroke-opacity", 0.55);
    const med = d3.median(vals);
    g.append("line").attr("x1", sc(med)).attr("x2", sc(med)).attr("y1", y - 9).attr("y2", y + 9).attr("stroke", "#777").attr("stroke-dasharray", "2 2");
    if (r === 0) g.append("text").attr("class", "lab").attr("x", sc(med) + 3).attr("y", y - 9).text("TX median");
    sel.forEach((m, i) => {
      const v = m[k];
      if (v != null && (!meta.log || v > 0)) g.append("circle").attr("cx", sc(v)).attr("cy", y).attr("r", 5.5).attr("fill", colorOf(m.fips)).attr("stroke", "#fff").attr("stroke-width", 1.5)
        .on("mousemove", (e) => showTip(e, `${m.name}: ${meta.long}\n${meta.fmt(v)} (Texas median ${meta.fmt(med)})`)).on("mouseleave", hideTip);
      g.append("text").attr("x", w - right + i * colW + colW / 2).attr("y", y + 4).attr("text-anchor", "middle").attr("font-size", 11).attr("font-variant-numeric", "tabular-nums").attr("fill", "#222").text(meta.fmt(v));
    });
  });
}

// ---------------------------------------------------------------- B3 · damage concentration (R2)
function renderConc() {
  const { el, w, h } = size("p-conc"), svg = svgIn(el, w, h);
  const sel = state.sel.map((f) => M.get(f)), tabW = 222, m = { l: 38, r: tabW + 18, t: 12, b: 30 }, R = 10;
  const x = d3.scaleLinear().domain([1, R]).range([m.l, w - m.r]), y = d3.scaleLinear().domain([0, 1]).range([h - m.b, m.t]);
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${h - m.b})`).call(d3.axisBottom(x).ticks(R).tickFormat((d) => `#${d}`).tickSize(3));
  svg.append("g").attr("class", "axis").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(5, "%").tickSize(-(w - m.r - m.l))).call((g) => g.selectAll("line").attr("class", "grid-line")).call((g) => g.select(".domain").remove());
  svg.append("text").attr("class", "lab").attr("x", (m.l + w - m.r) / 2).attr("y", h - 4).attr("text-anchor", "middle").text("storm days ranked by damage (#1 = worst day in the window)");
  svg.append("line").attr("x1", x(5)).attr("x2", x(5)).attr("y1", m.t).attr("y2", h - m.b).attr("stroke", "#999").attr("stroke-dasharray", "3 3");
  svg.append("text").attr("class", "lab").attr("x", x(5) + 4).attr("y", m.t + 10).text("top 5");
  const line = d3.line().x((d, i) => x(i + 1)).y((d) => y(d)).curve(d3.curveMonotoneX);
  sel.forEach((c) => {
    if (!c.cum.length) return;
    const cum = c.cum.slice(0, R);
    svg.append("path").attr("d", line(cum)).attr("fill", "none").attr("stroke", colorOf(c.fips)).attr("stroke-width", 2.2);
    svg.append("g").selectAll("circle").data(cum).join("circle").attr("cx", (d, i) => x(i + 1)).attr("cy", (d) => y(d))
      .attr("r", (d, i) => (state.focus?.fips === c.fips && state.focus.date === c.topDays[i].date ? 6 : i === 0 || i === 4 ? 4 : 2.6))
      .attr("fill", colorOf(c.fips)).attr("stroke", (d, i) => (state.focus?.fips === c.fips && state.focus.date === c.topDays[i].date ? "#252525" : "none")).attr("stroke-width", 1.5).style("cursor", "pointer")
      .on("mousemove", (e, d) => { const i = cum.indexOf(d), day = c.topDays[i]; showTip(e, `${c.name} · storm day #${i + 1}: ${iso(day.date)}\n${fmtMoney(day.d)} · worst ${i + 1} days = ${fmtPct(d)} of the period's damage\nClick to open its NOAA reports`); })
      .on("mouseleave", hideTip).on("click", (e, d) => focusDay(c.fips, c.topDays[cum.indexOf(d)].date));
  });
  // side table: median vs mean per damaging day and the top-1 / top-5 shares
  const tx = w - tabW - 4, cw = 33, cols = [["Top-1", (c) => fmtPct(c.top1)], ["Top-5", (c) => fmtPct(c.top5)], ["Median", (c) => fmtMoney(c.medianDay)], ["Mean", (c) => fmtMoney(c.meanDay)]];
  const cx = (j) => tx + 62 + (j + 1) * cw + (j > 1 ? (j - 1) * 12 + 6 : 0);    // money columns are wider
  svg.append("text").attr("class", "lab").attr("x", (cx(0) + cx(1)) / 2 - cw / 2).attr("y", m.t + 2).attr("text-anchor", "middle").text("damage share");
  svg.append("text").attr("class", "lab").attr("x", (cx(2) + cx(3)) / 2 - cw / 2).attr("y", m.t + 2).attr("text-anchor", "middle").text("per damaging day");
  cols.forEach(([t], j) => svg.append("text").attr("class", "lab").attr("x", cx(j)).attr("y", m.t + 15).attr("text-anchor", "end").attr("font-weight", 700).text(t));
  sel.forEach((c, i) => {
    const yy = m.t + 34 + i * 20;
    svg.append("text").attr("x", tx).attr("y", yy).attr("font-size", 11).attr("font-weight", 700).attr("fill", colorOf(c.fips)).text(c.name.length > 9 ? c.name.slice(0, 8) + "." : c.name);
    cols.forEach(([, f], j) => svg.append("text").attr("x", cx(j)).attr("y", yy).attr("text-anchor", "end").attr("font-size", 10.5).attr("font-variant-numeric", "tabular-nums").attr("fill", "#222").text(f(c)));
  });
  svg.append("text").attr("class", "lab").attr("x", tx).attr("y", m.t + 44 + sel.length * 20).text("mean ≫ median = a few huge days");
}

// ---------------------------------------------------------------- B4 · hazard contribution (R3)
function renderHazard() {
  const { el, w, h } = size("p-hazard"), svg = svgIn(el, w, h);
  const rows = [...state.sel.map((f) => M.get(f)), { name: "Texas", fips: 0, reports: TX.reports, dmgP: TX.dmgP }];
  const m = { l: 84, r: 16, t: 18 }, gh = (h - m.t - 8) / rows.length, bh = Math.min(13, gh / 2 - 5);
  const x = d3.scaleLinear().domain([0, 1]).range([m.l + 52, w - m.r]);
  [0, 0.25, 0.5, 0.75, 1].forEach((v) => { svg.append("line").attr("x1", x(v)).attr("x2", x(v)).attr("y1", m.t - 4).attr("y2", h - 6).attr("stroke", "#efede8");
    svg.append("text").attr("class", "lab").attr("x", x(v)).attr("y", m.t - 7).attr("text-anchor", "middle").text(fmtPct(v)); });
  const P = PERILS.filter((p) => state.perils.has(p.k));
  rows.forEach((c, i) => {
    const y0 = m.t + i * gh + gh / 2 - bh - 2;
    svg.append("text").attr("x", 6).attr("y", y0 + bh + 3).attr("font-size", 11.5).attr("font-weight", 700).attr("fill", c.fips ? colorOf(c.fips) : "#666").text(c.name);
    [["Reports", c.reports], ["Damage", c.dmgP]].forEach(([lab, arr], j) => {
      const yy = y0 + j * (bh + 4), tot = d3.sum(P, (p) => arr[p.k]);
      svg.append("text").attr("class", "lab").attr("x", m.l + 46).attr("y", yy + bh - 3).attr("text-anchor", "end").text(lab);
      if (!tot) { svg.append("text").attr("class", "lab").attr("x", x(0) + 4).attr("y", yy + bh - 3).text(j ? "no reported damage" : "no reports"); return; }
      let acc = 0;
      P.forEach((p) => {
        const share = arr[p.k] / tot, xa = x(acc); acc += share;
        svg.append("rect").attr("x", xa).attr("y", yy).attr("width", Math.max(0, x(acc) - xa)).attr("height", bh).attr("fill", p.c).attr("opacity", j ? 1 : 0.62)
          .on("mousemove", (e) => showTip(e, `${c.name} · ${p.name}\n${fmtPct(share)} of ${lab.toLowerCase()} (${j ? fmtMoney(arr[p.k]) : arr[p.k].toLocaleString() + " reports"})`)).on("mouseleave", hideTip);
        if (x(acc) - xa > 30) svg.append("text").attr("x", (xa + x(acc)) / 2).attr("y", yy + bh - 3).attr("text-anchor", "middle").attr("font-size", 9.5).attr("fill", "#fff").attr("pointer-events", "none").text(fmtPct(share));
      });
    });
  });
}

// ---------------------------------------------------------------- C1 · recurring vs catastrophic (R2)
function renderType() {
  const { el, w, h } = size("p-type"), svg = svgIn(el, w, h);
  const m = { l: 38, r: 10, t: 10, b: 30 }, pts = TYPO.pts;
  const x = d3.scaleLog().domain([d3.min(pts, (d) => d.damagingDays) * 0.9, d3.max(pts, (d) => d.damagingDays) * 1.1]).range([m.l, w - m.r]);
  const y = d3.scaleLinear().domain([0, 1]).range([h - m.b, m.t]).clamp(true);
  svg.append("rect").attr("x", m.l).attr("y", m.t).attr("width", x(TYPO.medX) - m.l).attr("height", y(TYPO.medY) - m.t).attr("fill", "#f6e9e9");
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${h - m.b})`).call(d3.axisBottom(x).ticks(4, "~g").tickSize(3));
  svg.append("g").attr("class", "axis").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(4, "%").tickSize(3));
  svg.append("text").attr("class", "lab").attr("x", (m.l + w - m.r) / 2).attr("y", h - 3).attr("text-anchor", "middle").text("recurrence: damaging storm days per year (log) →");
  svg.append("text").attr("class", "lab").attr("transform", `translate(10,${(m.t + h - m.b) / 2}) rotate(-90)`).attr("text-anchor", "middle").text("concentration: largest-day share ↑");
  svg.append("line").attr("x1", x(TYPO.medX)).attr("x2", x(TYPO.medX)).attr("y1", m.t).attr("y2", h - m.b).attr("stroke", "#aaa").attr("stroke-dasharray", "3 3");
  svg.append("line").attr("x1", m.l).attr("x2", w - m.r).attr("y1", y(TYPO.medY)).attr("y2", y(TYPO.medY)).attr("stroke", "#aaa").attr("stroke-dasharray", "3 3");
  [["Catastrophe-driven", m.l + 4, m.t + 28, "start"], ["Recurring + dominant", w - m.r - 4, m.t + 28, "end"], ["Occasional", m.l + 4, h - m.b - 6, "start"], ["Recurring", w - m.r - 4, h - m.b - 6, "end"]]
    .forEach(([t, xx, yy, a]) => svg.append("text").attr("class", "q-label").attr("x", xx).attr("y", yy).attr("text-anchor", a).text(t));
  const others = pts.filter((d) => !state.sel.includes(d.fips)), sel = pts.filter((d) => state.sel.includes(d.fips));
  svg.append("g").selectAll("circle").data(others).join("circle").attr("cx", (d) => x(d.damagingDays)).attr("cy", (d) => y(d.top1)).attr("r", 3)
    .attr("fill", "#b8b4ac").attr("fill-opacity", 0.55).style("cursor", "pointer")
    .on("mousemove", (e, d) => showTip(e, `${d.name}: ${d.type}\n${fmt1(d.damagingDays)} damaging days/yr · largest day ${fmtPct(d.top1)} of damage\nClick to compare`)).on("mouseleave", hideTip).on("click", (e, d) => toggle(d.fips));
  const g = svg.append("g").selectAll("g").data(sel).join("g").style("cursor", "pointer").on("click", (e, d) => toggle(d.fips))
    .on("mousemove", (e, d) => showTip(e, `${d.name}: ${d.type}\n${fmt1(d.damagingDays)} damaging days/yr · largest day ${fmtPct(d.top1)} of damage`)).on("mouseleave", hideTip);
  g.append("circle").attr("cx", (d) => x(d.damagingDays)).attr("cy", (d) => y(d.top1)).attr("r", 6.5).attr("fill", (d) => colorOf(d.fips)).attr("stroke", "#fff").attr("stroke-width", 1.5);
  g.append("text").attr("x", (d) => x(d.damagingDays) + (x(d.damagingDays) > w - 80 ? -9 : 9)).attr("text-anchor", (d) => (x(d.damagingDays) > w - 80 ? "end" : "start")).attr("y", (d) => y(d.top1) + 4).attr("font-size", 11).attr("font-weight", 700).attr("fill", (d) => colorOf(d.fips)).attr("paint-order", "stroke").attr("stroke", "#fff").attr("stroke-width", 3).text((d) => d.name);
}

// ---------------------------------------------------------------- C2 · temporal patterns (R4)
function renderTime() {
  const { el, w, h } = size("p-time"), svg = svgIn(el, w, h);
  const [w0] = windowRange(), years = d3.range(w0, LAST_YEAR + 1), key = state.r4;
  const sel = state.sel.map((f) => M.get(f)), m = { l: 74, r: 8, t: 4, b: 28 };
  const x = d3.scaleBand().domain(years).range([m.l, w - m.r]).paddingInner(0.2);
  const rowH = (h - m.t - m.b) / sel.length;
  const shared = state.r4Scale === "shared", ymax = d3.max(sel, (c) => d3.max(c.annual, (a) => a[key])) || 1;
  // brush first, so bars stay clickable on top of it
  const brush = d3.brushX().extent([[m.l, m.t], [w - m.r, h - m.b]]).on("end", (e) => {
    if (!e.sourceEvent) return;
    if (!e.selection) { if (state.brush) { state.brush = null; renderFilters(); renderAll(); } return; }
    const ys = years.filter((yv) => { const c = x(yv) + x.bandwidth() / 2; return c >= e.selection[0] && c <= e.selection[1]; });
    state.brush = ys.length ? [ys[0], ys.at(-1)] : null;
    renderFilters(); renderAll();
  });
  const bg = svg.append("g").attr("class", "brush").call(brush);
  sel.forEach((c, i) => {
    const y0 = m.t + i * rowH, base = y0 + rowH - 3;
    const top = shared ? ymax : d3.max(c.annual, (a) => a[key]) || 1;          // own scale keeps small counties readable
    const y = d3.scaleLinear().domain([0, top]).range([base, y0 + 6]);
    const avg = d3.mean(c.annual, (a) => a.damage);
    if (!shared) svg.append("text").attr("class", "lab").attr("x", w - m.r).attr("y", y0 + 12).attr("text-anchor", "end").text(`max ${key === "damage" ? fmtMoney(top) : top + " days"}`);
    svg.append("text").attr("x", 6).attr("y", y0 + rowH / 2 - 1).attr("font-size", 10.5).attr("font-weight", 700).attr("fill", colorOf(c.fips)).text(c.name.length > 10 ? c.name.slice(0, 9) + "." : c.name);
    svg.append("text").attr("class", "lab").attr("x", 6).attr("y", y0 + rowH / 2 + 11).text(key === "damage" ? `avg ${fmtMoney(avg)}` : `avg ${fmt1(d3.mean(c.annual, (a) => a.days))} days`);
    svg.append("line").attr("x1", m.l).attr("x2", w - m.r).attr("y1", base).attr("y2", base).attr("stroke", "#dedbd4");
    svg.append("g").selectAll("rect").data(c.annual).join("rect")
      .attr("x", (a) => x(a.year)).attr("width", x.bandwidth()).attr("y", (a) => y(a[key])).attr("height", (a) => base - y(a[key]))
      .attr("fill", colorOf(c.fips)).attr("fill-opacity", (a) => (a.flag ? 1 : 0.38)).style("cursor", (a) => (a.worst ? "pointer" : "default"))
      .on("mousemove", (e, a) => showTip(e, `${c.name} · ${a.year}\nNOAA damage ${fmtMoney(a.damage)} · ${a.days} storm days${a.flag ? "\nAt least 2× the county's yearly average" : ""}${a.worst ? "\nClick to open the year's worst storm day" : ""}`))
      .on("mouseleave", hideTip).on("click", (e, a) => { if (a.worst) focusDay(c.fips, a.worst.date); });
    svg.append("g").selectAll("text").data(c.annual.filter((a) => a.flag)).join("text").attr("x", (a) => x(a.year) + x.bandwidth() / 2).attr("y", (a) => y(a[key]) - 2)
      .attr("text-anchor", "middle").attr("font-size", 8).attr("fill", "#252525").attr("pointer-events", "none").text("▲");
  });
  const every = years.length > 10 ? 5 : 1;
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${h - m.b - 10})`).call(d3.axisBottom(x).tickValues(years.filter((yv) => (LAST_YEAR - yv) % every === 0)).tickSize(2));
  svg.append("text").attr("class", "lab").attr("x", m.l + 2).attr("y", h - 3).text(shared ? `▲ ≥ 2× county average · shared scale, max ${key === "damage" ? fmtMoney(ymax) : ymax + " days"}` : "▲ ≥ 2× county average · each county on its own scale");
  if (state.brush) bg.call(brush.move, [x(state.brush[0]), x(state.brush[1]) + x.bandwidth()]);
}

// ---------------------------------------------------------------- C3 · event investigation (R5)
const loadEvents = (fips) => { if (!EVENTS.has(fips)) EVENTS.set(fips, fetch(`data/events/${fips}.json`).then((r) => (r.ok ? r.json() : { rows: [] }))); return EVENTS.get(fips); };
function focusDay(fips, date) { state.focus = { fips, date }; hideTip(); renderConc(); renderEvents(); }
function renderEvents() {
  const { el } = size("p-events");
  el.classList.add("html");
  const fy = state.focus && Math.floor(state.focus.date / 10000), [ry0, ry1] = yearRange();
  if (!state.focus || !state.sel.includes(state.focus.fips) || fy < ry0 || fy > ry1) {   // keep the focus inside the chosen years
    const c = state.sel.map((f) => M.get(f)).find((m) => m.topDays.length);
    state.focus = c ? { fips: c.fips, date: c.topDays[0].date } : null;
  }
  if (!state.focus) { el.innerHTML = `<div class="r5-empty">No damaging storm day for the selected counties in these years.</div>`; return; }
  const f = state.focus, c = M.get(f.fips), rank = c.topDays.findIndex((d) => d.date === f.date);
  el.innerHTML = `<div class="r5"><div class="r5-head"></div><div class="r5-map"></div><div class="r5-table"><div class="r5-empty">Loading reports…</div></div></div>`;
  loadEvents(f.fips).then((ev) => {
    if (state.focus !== f) return;                              // a newer click won
    const k = state.real ? CPI.toBase[Math.floor(f.date / 10000)] : 1;
    const rows = ev.rows.filter((r) => r[0] === f.date && state.perils.has(r[2]))
      .sort((a, b) => (b[4] ?? -1) - (a[4] ?? -1) || a[1] - b[1]);
    const total = d3.sum(rows, (r) => (r[4] ?? 0) * k), blanks = rows.filter((r) => r[4] == null).length;
    el.querySelector(".r5-head").innerHTML = `<b style="color:${colorOf(f.fips)}">${c.name}</b><b>${iso(f.date)}</b>
      <span>${fmtMoney(total)} · ${rows.length} report${rows.length === 1 ? "" : "s"}${blanks ? ` · ${blanks} without a damage value` : ""}</span>
      <span class="muted">${rank >= 0 ? `worst day #${rank + 1} in ${yearRange().join("–")}` : "worst day of that year"}</span>
      ${rank > 0 ? `<button data-step="-1" title="More damaging day">◀</button>` : ""}${rank >= 0 && rank < c.topDays.length - 1 ? `<button data-step="1" title="Less damaging day">▶</button>` : ""}`;
    el.querySelectorAll("[data-step]").forEach((b) => (b.onclick = () => focusDay(f.fips, c.topDays[rank + +b.dataset.step].date)));
    // locator map: the county outline and where each report was made
    const mapEl = el.querySelector(".r5-map"), mw = mapEl.clientWidth, mh = mapEl.clientHeight;
    const feat = topojson.feature(TOPO, TOPO.objects.counties).features.find((g) => +g.id === f.fips);
    const msvg = d3.select(mapEl).append("svg").attr("viewBox", `0 0 ${mw} ${mh}`);
    const proj = d3.geoMercator().fitExtent([[10, 10], [mw - 10, mh - 34]], feat), path = d3.geoPath(proj);
    msvg.append("path").attr("d", path(feat)).attr("fill", "#f6f2ee").attr("stroke", colorOf(f.fips)).attr("stroke-width", 1.5);
    const maxD = d3.max(rows, (r) => r[4] ?? 0) || 1;
    msvg.append("g").selectAll("circle").data(rows.filter((r) => r[6] != null)).join("circle")
      .attr("cx", (r) => proj([r[7], r[6]])[0]).attr("cy", (r) => proj([r[7], r[6]])[1])
      .attr("r", (r) => (r[4] == null ? 3 : 3 + 7 * Math.sqrt(r[4] / maxD))).attr("fill", (r) => (r[4] == null ? "#fff" : PERILS[r[2]].c)).attr("fill-opacity", 0.8)
      .attr("stroke", (r) => PERILS[r[2]].c).attr("stroke-width", 1.2)
      .on("mousemove", (e, r) => showTip(e, `${PERILS[r[2]].name} · ${r[3] ?? "size n/a"} · ${r[5] ?? ""}\n${r[4] == null ? "no damage value reported" : fmtMoney(r[4] * k)}`)).on("mouseleave", hideTip);
    msvg.append("text").attr("class", "lab").attr("x", mw / 2).attr("y", mh - 18).attr("text-anchor", "middle").text("size = damage");
    msvg.append("text").attr("class", "lab").attr("x", mw / 2).attr("y", mh - 6).attr("text-anchor", "middle").text("hollow = no value");
    const t = (r) => `${String(Math.floor(r[1] / 100)).padStart(2, "0")}:${String(r[1] % 100).padStart(2, "0")}`;
    const esc = (x) => String(x ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
    el.querySelector(".r5-table").innerHTML = rows.length ? `<table><thead><tr><th>Time · type</th><th>Size</th><th>Damage</th><th>Place</th></tr></thead><tbody>${rows.map((r) => `<tr>
      <td><span class="sw" style="background:${PERILS[r[2]].c}"></span>${t(r)} ${PERILS[r[2]].name}</td><td>${esc(r[3] ?? "–")}</td>
      <td class="num ${r[4] == null ? "blank" : ""}">${r[4] == null ? "not reported" : fmtMoney(r[4] * k)}</td><td>${esc(r[5] ?? "")}</td></tr>
      ${r[8] ? `<tr class="nar-row"><td colspan="4" class="nar" title="${esc(r[8])}">${esc(r[8].slice(0, 150))}${r[8].length > 150 ? "…" : ""}</td></tr>` : ""}`).join("")}</tbody></table>`
      : `<div class="r5-empty">No reports for the selected storm types on this day.</div>`;
  });
}

// ---------------------------------------------------------------- interaction
function toggle(fips) {
  if (state.sel.includes(fips)) { if (state.sel.length > 1) state.sel = state.sel.filter((f) => f !== fips); }
  else if (state.sel.length < 4) state.sel = [...state.sel, fips];
  else state.sel = [...state.sel.slice(1), fips];
  hideTip(); renderAll(false);
}
function renderAll(recompute = true) {
  if (recompute) computeAll();
  renderChips(); renderNotes(); renderMap(); renderCompare(); renderConc(); renderHazard(); renderType(); renderTime(); renderEvents();
}
function bindFilters() {
  $("#f-window").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; state.window = +b.dataset.v; state.brush = null; [...b.parentNode.children].forEach((x) => x.classList.toggle("on", x === b)); renderFilters(); renderAll(); };
  $("#f-years").onclick = (e) => { if (e.target.id === "f-clear") { e.preventDefault(); state.brush = null; renderFilters(); renderAll(); } };
  $("#r4-measure").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; state.r4 = b.dataset.v; [...b.parentNode.children].forEach((x) => x.classList.toggle("on", x === b)); renderTime(); };
  $("#r4-scale").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; state.r4Scale = b.dataset.v; [...b.parentNode.children].forEach((x) => x.classList.toggle("on", x === b)); renderTime(); };
  $("#f-dollars").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; state.real = b.dataset.v === "real"; [...b.parentNode.children].forEach((x) => x.classList.toggle("on", x === b)); renderAll(); };
  $("#f-perils").onclick = (e) => { const p = e.target.closest(".peril"); if (!p) return; const k = +p.dataset.p;
    if (state.perils.has(k)) { if (state.perils.size > 1) state.perils.delete(k); } else state.perils.add(k); renderFilters(); renderAll(); };
  $("#f-metric").onchange = (e) => { state.mapMetric = e.target.value; renderMap(); };
  $("#f-chips").onclick = (e) => { const b = e.target.closest("[data-rm]"); if (b) toggle(+b.dataset.rm); };
  const input = $("#f-search"), box = $("#f-suggest");
  input.oninput = () => {
    const q = input.value.trim().toLowerCase();
    const hits = q ? Object.entries(NAMES).filter(([, n]) => n.toLowerCase().startsWith(q)).slice(0, 8) : [];
    box.innerHTML = hits.map(([f, n]) => `<div data-f="${f}">${n} County</div>`).join("");
  };
  box.onclick = (e) => { const d = e.target.closest("[data-f]"); if (!d) return; input.value = ""; box.innerHTML = ""; if (!state.sel.includes(+d.dataset.f)) toggle(+d.dataset.f); };
  input.onkeydown = (e) => { if (e.key === "Enter") { const d = box.querySelector("[data-f]"); if (d) d.click(); } };
  document.addEventListener("mousemove", (e) => { if (!tip.hidden) moveTip(e); });
  let t; new ResizeObserver(() => { clearTimeout(t); t = setTimeout(() => renderAll(false), 120); }).observe(document.querySelector(".grid"));
}

Promise.all(["storm_days", "tdi", "cpi", "tx.topo", "context"].map((f) => fetch(`data/${f}.json`).then((r) => r.json()))).then(([sd, tdi, cpi, topo, ctx]) => {
  DATA = { counties: sd.counties, tdi }; NAMES = sd.names; CPI = cpi; TOPO = topo; CTX = ctx.counties;
  bindFilters(); renderFilters(); renderAll();
});
