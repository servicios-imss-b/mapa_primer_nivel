import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { simplify } from '@turf/simplify';

const source = new URL('../public/contorno_estados.geojson', import.meta.url);
const destination = new URL('../public/contorno_estados_web.geojson', import.meta.url);
const original = await readFile(source, 'utf8');
const data = JSON.parse(original);
assert.equal(data.type, 'FeatureCollection');
const optimized = simplify(data, { tolerance: 0.001, highQuality: true, mutate: false });
assert.equal(optimized.features.length, data.features.length);
assert.deepEqual(optimized.features.map((feature) => feature.properties), data.features.map((feature) => feature.properties));
for (const feature of optimized.features) {
  assert.ok(['Polygon', 'MultiPolygon'].includes(feature.geometry.type));
  const polygons = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
  for (const polygon of polygons) {
    for (const ring of polygon) {
      assert.ok(ring.length >= 4);
      assert.deepEqual(ring[0], ring.at(-1));
    }
  }
}
const output = JSON.stringify(optimized);
await writeFile(destination, output);
const oldSize = Buffer.byteLength(original);
const newSize = Buffer.byteLength(output);
console.log(`Contornos web: ${(oldSize / 1048576).toFixed(2)} MB -> ${(newSize / 1048576).toFixed(2)} MB (${(100 * (1 - newSize / oldSize)).toFixed(1)}% menos).`);