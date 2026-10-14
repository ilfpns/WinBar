// Generates public/data/globe.json: evenly spread points on a sphere that fall on land.
// The News globe draws these as dots — no images, no map tiles at runtime.
// Source: Natural Earth land polygons via world-atlas (50m). Run once: `npm run globe`.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { feature } from 'topojson-client';
import { geoContains } from 'd3-geo';

const SAMPLES = 16000; // points on the whole sphere; ~29% land → ≈4.6k dots
const topo = JSON.parse(readFileSync('node_modules/world-atlas/land-50m.json', 'utf-8'));
const land = feature(topo, topo.objects.land);

// Fibonacci sphere: near-uniform spacing without polar clumping
const golden = Math.PI * (3 - Math.sqrt(5));
const points = [];
for (let i = 0; i < SAMPLES; i++) {
  const y = 1 - (i / (SAMPLES - 1)) * 2;
  const lat = (Math.asin(y) * 180) / Math.PI;
  const lon = ((((i * golden) * 180) / Math.PI) % 360 + 540) % 360 - 180;
  if (geoContains(land, [lon, lat])) points.push([+lat.toFixed(2), +lon.toFixed(2)]);
}
mkdirSync('public/data', { recursive: true });
writeFileSync('public/data/globe.json', JSON.stringify({ source: 'Natural Earth (world-atlas land-50m)', points }));
console.log(`globe: ${points.length} land dots → public/data/globe.json`);
