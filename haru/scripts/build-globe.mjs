// Generates public/data/globe.json: evenly spread points on a sphere that fall on land, each tagged
// with the country it lies in (ISO 3166 numeric code, '' where none), so the News globe can light up a country.
// The globe draws these as dots — no images, no map tiles at runtime.
// Source: Natural Earth land and country polygons via world-atlas (50m). Run once: `npm run globe`.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { feature } from 'topojson-client';
import { geoBounds, geoContains } from 'd3-geo';

const SAMPLES = 16000; // points on the whole sphere; ~29% land → ≈4.6k dots
const read = (name) => JSON.parse(readFileSync(`node_modules/world-atlas/${name}`, 'utf-8'));
const landTopo = read('land-50m.json');
const land = feature(landTopo, landTopo.objects.land);
const countryTopo = read('countries-50m.json');
const countries = feature(countryTopo, countryTopo.objects.countries).features.map((f) => {
  const [[w, s], [e, n]] = geoBounds(f);
  return { id: String(f.id ?? ''), f, w, s, e, n };
});
// a cheap bounding-box test first (boxes that cross the antimeridian have w > e)
const inBox = (c, lon, lat) => lat >= c.s && lat <= c.n && (c.w <= c.e ? lon >= c.w && lon <= c.e : lon >= c.w || lon <= c.e);
const countryOf = (lon, lat) => countries.find((c) => inBox(c, lon, lat) && geoContains(c.f, [lon, lat]))?.id ?? '';

// Fibonacci sphere: near-uniform spacing without polar clumping
const golden = Math.PI * (3 - Math.sqrt(5));
const points = [];
let tagged = 0;
for (let i = 0; i < SAMPLES; i++) {
  const y = 1 - (i / (SAMPLES - 1)) * 2;
  const lat = (Math.asin(y) * 180) / Math.PI;
  const lon = ((((i * golden) * 180) / Math.PI) % 360 + 540) % 360 - 180;
  if (!geoContains(land, [lon, lat])) continue;
  const cc = countryOf(lon, lat);
  if (cc) tagged++;
  points.push([+lat.toFixed(2), +lon.toFixed(2), cc]);
}
// small countries get only a handful of dots (or none): give them a finer set of their own,
// kept apart in `extra` — drawn only while that country is lit, so the map itself keeps its even texture
const MIN_DOTS = 25;
const counts = new Map();
for (const p of points) counts.set(p[2], (counts.get(p[2]) ?? 0) + 1);
const extra = [];
for (const c of countries) {
  if (!c.id || (counts.get(c.id) ?? 0) >= MIN_DOTS) continue;
  const width = c.w <= c.e ? c.e - c.w : c.e + 360 - c.w;
  if (width > 60) continue; // spread-out island groups: the regular dots will do
  let found = [];
  for (let step = 1; step >= 0.05 && found.length < 20; step /= 2) {
    found = [];
    for (let lat = c.s + step / 2; lat < c.n; lat += step) {
      for (let x = c.w + step / 2; x < c.w + width; x += step) {
        const lon = ((x + 540) % 360) - 180;
        if (geoContains(c.f, [lon, lat])) found.push([+lat.toFixed(2), +lon.toFixed(2), c.id]);
      }
    }
  }
  extra.push(...found.slice(0, 160));
}

// islands the 50m map drops or barely touches, drawn on purpose: always on the globe, and lit with their country.
// [lat, lon] of each island's dots; the first one is the always-visible dot, the rest fill it in when lit.
const ISLANDS = [
  { name: 'Jeju', cc: '410', dots: [[33.38, 126.55], [33.3, 126.25], [33.45, 126.38], [33.5, 126.7], [33.45, 126.88], [33.27, 126.45], [33.3, 126.72]] },
  { name: 'Ulleungdo', cc: '410', dots: [[37.5, 130.87], [37.47, 130.9]] },
  { name: 'Dokdo', cc: '410', dots: [[37.24, 131.87]] },
];
for (const isle of ISLANDS) {
  const [first, ...rest] = isle.dots;
  points.push([first[0], first[1], isle.cc]);
  extra.push(...rest.map(([lat, lon]) => [lat, lon, isle.cc]));
}

mkdirSync('public/data', { recursive: true });
writeFileSync('public/data/globe.json', JSON.stringify({ source: 'Natural Earth (world-atlas land-50m, countries-50m)', points, extra }));
console.log(`globe: ${points.length} land dots (${tagged} in a country) + ${extra.length} for small countries → public/data/globe.json`);
