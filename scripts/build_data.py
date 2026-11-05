"""Build the data files for the Storm Damage Risk Analytics dashboard (web/data/).

Inputs (download once, pass the folder with --raw):
  noaa_details/StormEvents_details-ftp_v1.0_dYYYY_c*.csv.gz   NOAA NCEI Storm Events details, 2006-2025
  tdi_ho_losses_by_county.csv                                 TDI homeowners losses by county, 2019-2025
  cpi_u_monthly_fred.csv                                      BLS CPI-U (FRED CPIAUCNS), monthly
  counties-10m.json                                           us-atlas county TopoJSON
  tdi_ho_premium_by_county.csv                                TDI homeowners market overview by county, 2019-2025
  acs/tx_2024_b25001.csv, b25003.csv, b25077.csv              Census ACS 5-year 2020-2024: housing units, owner-occupied homes, median home value

Outputs:
  storm_days.json  per Texas county, one row per storm day (all hail, thunderstorm wind and tornado reports in the
                   county on one date): date, damage by peril, reports by peril, reports with blank damage by peril
  tdi.json         per county and year: total paid losses, wind & hail paid losses, policies in force
  cpi.json         annual CPI-U and the factor to 2025 dollars
  tx.topo.json     Texas county boundaries (TopoJSON, unused arcs removed)
  events/<fips>.json  every report behind the storm days of one county (loaded on demand by the event view): date,
                   time, peril, magnitude, damage (blank kept blank), place, latitude, longitude, narrative, NOAA event id
  context.json     per county: TDI average premium and coverage (2019 and 2025), ACS housing units and median home value

Usage: python3 scripts/build_data.py --raw /path/to/raw
"""
import argparse, csv, gzip, glob, json, re
from collections import defaultdict
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "web" / "data"
PERILS = {"Hail": 0, "Thunderstorm Wind": 1, "Tornado": 2}
YEARS = range(2006, 2026)


def money(s):
    """NOAA damage strings: '10.00K', '1.5M', '0', '' (blank = not reported, kept apart from zero)"""
    s = (s or "").strip().upper()
    if not s: return None
    mult = {"K": 1e3, "M": 1e6, "B": 1e9}.get(s[-1], 1)
    try: return float(s[:-1] if s[-1] in "KMB" else s) * mult
    except ValueError: return None


def magnitude(r):
    """hail size in inches, wind speed in knots, tornado rating"""
    if r["EVENT_TYPE"] == "Tornado": return r["TOR_F_SCALE"] or None
    m = r["MAGNITUDE"].strip()
    if not m: return None
    return f"{float(m):g} in" if r["EVENT_TYPE"] == "Hail" else f"{float(m):g} kt"


def storm_days(raw):
    days = defaultdict(lambda: [0.0] * 3 + [0] * 3 + [0] * 3)        # (fips, date) -> dmg x3, n x3, blank x3
    events = defaultdict(list)
    names = {}
    for year in YEARS:
        path = sorted(glob.glob(f"{raw}/noaa_details/StormEvents_details-ftp_v1.0_d{year}_c*.csv.gz"))[-1]
        with gzip.open(path, "rt", encoding="latin-1") as f:
            for r in csv.DictReader(f):
                if r["STATE_FIPS"] != "48" or r["CZ_TYPE"] != "C" or r["EVENT_TYPE"] not in PERILS: continue
                fips = 48000 + int(r["CZ_FIPS"])
                date = int(r["BEGIN_YEARMONTH"]) * 100 + int(r["BEGIN_DAY"])
                p = PERILS[r["EVENT_TYPE"]]
                row = days[(fips, date)]
                d = money(r["DAMAGE_PROPERTY"])
                row[3 + p] += 1
                if d is None: row[6 + p] += 1
                else: row[p] += d
                names[fips] = r["CZ_NAME"].title()
                lat, lon = r["BEGIN_LAT"].strip(), r["BEGIN_LON"].strip()
                narrative = " ".join(r["EVENT_NARRATIVE"].split())
                events[str(fips)].append([date, int(r["BEGIN_TIME"] or 0), p, magnitude(r), None if d is None else round(d),
                                          r["BEGIN_LOCATION"].title() or None, round(float(lat), 3) if lat else None,
                                          round(float(lon), 3) if lon else None, narrative[:280] + ("…" if len(narrative) > 280 else ""),
                                          int(r["EVENT_ID"])])
    out = defaultdict(list)
    for (fips, date), v in sorted(days.items()):
        out[str(fips)].append([date] + [round(x) for x in v[:3]] + v[3:])
    return out, {f: sorted(v, key=lambda e: (e[0], e[1], e[9])) for f, v in events.items()}


def tdi(raw):
    rows = defaultdict(dict)
    def num(s):
        t = re.sub(r"[$,\s%]", "", s or "")
        if t in ("", "-"): return None
        neg = t.startswith("(") and t.endswith(")")            # accounting notation: (123) = -123, kept as reported
        return -float(t.strip("()")) if neg else float(t)
    with open(f"{raw}/tdi_ho_losses_by_county.csv", encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            key = (r["County"].replace(" County", "").strip(), int(r["Year"]))
            kind = r["Loss type"].strip()
            if kind == "Total Paid Loss":
                rows[key]["paid"] = num(r["Paid losses"]); rows[key]["policies"] = num(r["Policies in force"])
            elif kind == "Wind":                                      # TDI "Wind" = wind and hail
                rows[key]["wind"] = num(r["Paid losses"])
    by_county = defaultdict(list)
    for (county, year), v in sorted(rows.items()):
        by_county[county].append([year, v.get("paid"), v.get("wind"), v.get("policies")])
    return by_county


def cpi(raw):
    vals = defaultdict(list)
    with open(f"{raw}/cpi_u_monthly_fred.csv") as f:
        for r in csv.DictReader(f):
            y = int(r["observation_date"][:4]) if "observation_date" in r else int(list(r.values())[0][:4])
            v = list(r.values())[1]
            if v not in ("", "."): vals[y].append(float(v))
    annual = {y: sum(v) / len(v) for y, v in vals.items() if y in YEARS}
    return {"annual": annual, "toBase": {y: round(annual[2025] / a, 5) for y, a in annual.items()}, "base": 2025}


def context(raw, by_name):
    """market and exposure context per county: TDI premiums and coverage, Census housing units, owner-occupied homes and home values"""
    num = lambda v: float(v) if v not in (None, "", "-") else None
    out = defaultdict(dict)
    with open(f"{raw}/tdi_ho_premium_by_county.csv", encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            fips = by_name.get(r["County"].replace(" County", "").strip())
            if not fips or r["Year"] not in ("2019", "2025"): continue
            y = r["Year"]
            out[str(fips)][f"premium{y}"] = num(r["Average premium (with wind)"])
            out[str(fips)][f"coverage{y}"] = num(r["Average coverage"])
    for table, key, col in (("b25001", "homes", "E001"), ("b25003", "owners", "E002"), ("b25077", "homeValue", "E001")):
        with open(f"{raw}/acs/tx_2024_{table}.csv") as f:
            for r in csv.DictReader(f, delimiter="|"):
                fips = r["GEO_ID"][-5:]
                if fips.startswith("48"): out[fips][key] = num(r[f"{table.upper()}_{col}"])
    return out


def texas_topology(raw):
    topo = json.loads(Path(f"{raw}/counties-10m.json").read_text())
    geoms = [g for g in topo["objects"]["counties"]["geometries"] if str(g["id"]).startswith("48")]
    used = sorted({a if a >= 0 else ~a for g in geoms for poly in (g["arcs"] if g["type"] == "Polygon" else [r for p in g["arcs"] for r in p]) for ring in [poly] for a in ring})
    remap = {old: new for new, old in enumerate(used)}
    fix = lambda a: remap[a] if a >= 0 else ~remap[~a]
    for g in geoms:
        g["arcs"] = [[fix(a) for a in ring] for ring in g["arcs"]] if g["type"] == "Polygon" else [[[fix(a) for a in ring] for ring in poly] for poly in g["arcs"]]
    return {"type": "Topology", "transform": topo["transform"], "arcs": [topo["arcs"][i] for i in used],
            "objects": {"counties": {"type": "GeometryCollection", "geometries": geoms}}}


if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("--raw", required=True); a = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    topo = texas_topology(a.raw)
    names = {int(g["id"]): g["properties"]["name"] for g in topo["objects"]["counties"]["geometries"]}
    sd, events = storm_days(a.raw)
    t = tdi(a.raw)
    by_name = {v: k for k, v in names.items()}
    tdi_out = {str(by_name[c]): rows for c, rows in t.items() if c in by_name}
    (OUT / "storm_days.json").write_text(json.dumps({"columns": ["date", "dmg_hail", "dmg_wind", "dmg_tornado", "n_hail", "n_wind", "n_tornado",
                                                                  "blank_hail", "blank_wind", "blank_tornado"],
                                                      "years": [YEARS[0], YEARS[-1]], "names": names, "counties": sd}, separators=(",", ":")))
    (OUT / "tdi.json").write_text(json.dumps({"columns": ["year", "paid", "wind_hail_paid", "policies"], "counties": tdi_out}, separators=(",", ":")))
    (OUT / "cpi.json").write_text(json.dumps(cpi(a.raw)))
    (OUT / "tx.topo.json").write_text(json.dumps(topo, separators=(",", ":")))
    (OUT / "events").mkdir(exist_ok=True)
    for fips, rows in events.items():
        (OUT / "events" / f"{fips}.json").write_text(json.dumps({"columns": ["date", "time", "peril", "magnitude", "damage", "place", "lat", "lon",
                                                                             "narrative", "event_id"], "rows": rows}, separators=(",", ":"), ensure_ascii=False))
    ctx = context(a.raw, by_name)
    (OUT / "context.json").write_text(json.dumps({"source": "TDI homeowners market overview (policies with wind), ACS 5-year 2020-2024",
                                                  "counties": ctx}, separators=(",", ":")))
    print(len(sd), "counties with storm days;", sum(len(v) for v in sd.values()), "storm days;", sum(len(v) for v in events.values()), "reports;",
          len(tdi_out), "counties with TDI losses;", sum(1 for v in ctx.values() if "premium2025" in v), "with premiums;", sum(1 for v in ctx.values() if "homes" in v), "with ACS")
