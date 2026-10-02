import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import bboxClip from '@turf/bbox-clip';
import maplibregl from 'maplibre-gl';
import type { BBox, Feature, Polygon, MultiPolygon, LineString, MultiLineString } from 'geojson';

export interface OsmSceneStatus {
  phase: 'overview' | 'loading' | 'ready' | 'error';
  buildings: number;
  roads: number;
  estimated: number;
  message?: string;
}

export interface OsmSceneController {
  refresh: () => void;
  exportGlb: () => Promise<ArrayBuffer>;
  dispose: () => void;
}

type SceneGeometry = Polygon | MultiPolygon | LineString | MultiLineString;
const OVERVIEW: OsmSceneStatus = { phase: 'overview', buildings: 0, roads: 0, estimated: 0 };

export function attachOsmScene(map: maplibregl.Map, onStatus: (status: OsmSceneStatus) => void): OsmSceneController {
  const scene = new THREE.Scene();
  const content = new THREE.Group();
  content.name = 'OpenStreetMap - Mexico';
  scene.add(content, new THREE.AmbientLight('#ffffff', 2));
  const sun = new THREE.DirectionalLight('#ffffff', 2.5);
  sun.position.set(-200, -300, 500);
  scene.add(sun);
  const camera = new THREE.Camera();
  const buildingMaterial = new THREE.MeshStandardMaterial({ color: '#b7c6c9', roughness: 0.85 });
  const roadMaterial = new THREE.MeshStandardMaterial({ color: '#68777d', roughness: 1 });
  let renderer: THREE.WebGLRenderer | undefined;
  let transform = new THREE.Matrix4();
  let revision = '';
  let status = OVERVIEW;
  let disposed = false;

  const clear = () => {
    for (const object of [...content.children]) {
      if (object instanceof THREE.Mesh) object.geometry.dispose();
      content.remove(object);
    }
  };
  const report = (next: OsmSceneStatus) => {
    status = next;
    if (!disposed) onStatus(next);
  };
  const setNativeBuildings = (visible: boolean) => {
    if (map.getLayer('building-3d')) map.setPaintProperty('building-3d', 'fill-extrusion-opacity', visible ? 0.85 : 0);
  };

  map.addLayer({
    id: 'osm-country-scene', type: 'custom', renderingMode: '3d',
    onAdd(currentMap, gl) {
      renderer = new THREE.WebGLRenderer({ canvas: currentMap.getCanvas(), context: gl, antialias: true });
      renderer.autoClear = false;
    },
    render(_gl, args) {
      if (!renderer || content.children.length === 0) return;
      camera.projectionMatrix = new THREE.Matrix4().fromArray(args.defaultProjectionData.mainMatrix).multiply(transform);
      renderer.resetState();
      renderer.render(scene, camera);
    },
    onRemove() {
      clear();
      buildingMaterial.dispose();
      roadMaterial.dispose();
      renderer?.dispose();
    },
  }, 'clues-halo');

  const rebuild = () => {
    if (disposed) return;
    if (map.getZoom() < 15) {
      if (revision === 'overview') return;
      revision = 'overview';
      clear();
      setNativeBuildings(true);
      report(OVERVIEW);
      map.triggerRepaint();
      return;
    }
    if (!map.isSourceLoaded('openmaptiles')) return;
    const bounds = map.getBounds();
    const bbox: BBox = [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()];
    const nextRevision = `${map.getZoom().toFixed(3)}:${bbox.join(',')}`;
    if (nextRevision === revision) return;
    revision = nextRevision;
    report({ ...status, phase: 'loading' });
    try {
      const center = map.getCenter();
      const origin = maplibregl.MercatorCoordinate.fromLngLat(center, 0);
      const scale = origin.meterInMercatorCoordinateUnits();
      transform = new THREE.Matrix4().makeTranslation(origin.x, origin.y, origin.z)
        .scale(new THREE.Vector3(scale, -scale, scale));
      const toLocal = (coordinates: number[]) => {
        const mercator = maplibregl.MercatorCoordinate.fromLngLat([coordinates[0], coordinates[1]]);
        return new THREE.Vector2((mercator.x - origin.x) / scale, (origin.y - mercator.y) / scale);
      };
      const features = [
        ...map.querySourceFeatures('openmaptiles', { sourceLayer: 'building' }).map((feature) => ({ feature, sourceLayer: 'building' })),
        ...map.querySourceFeatures('openmaptiles', { sourceLayer: 'transportation' }).map((feature) => ({ feature, sourceLayer: 'transportation' })),
      ];
      clear();
      const seen = new Set<string>();
      let buildings = 0;
      let roads = 0;
      let estimated = 0;
      for (const { feature, sourceLayer } of features) {
        if (!['Polygon', 'MultiPolygon', 'LineString', 'MultiLineString'].includes(feature.geometry.type)) continue;
        if (sourceLayer === 'transportation' && ['rail', 'transit'].includes(String(feature.properties.class))) continue;
        const key = JSON.stringify([sourceLayer, feature.id, feature.geometry]);
        if (seen.has(key)) continue;
        seen.add(key);
        const clipped = bboxClip(feature as Feature<SceneGeometry>, bbox);
        const properties = feature.properties;
        const name = String(properties.name ?? `${sourceLayer}-${feature.id ?? seen.size}`);
        if (sourceLayer === 'building' && ['Polygon', 'MultiPolygon'].includes(clipped.geometry.type)) {
          const geometry = clipped.geometry as Polygon | MultiPolygon;
          const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
          const suppliedHeight = Number(properties.height ?? properties.render_height);
          const suppliedBase = Number(properties.min_height ?? properties.render_min_height);
          const levels = Number(properties['building:levels']);
          const height = Number.isFinite(suppliedHeight) && suppliedHeight > 0
            ? suppliedHeight : Number.isFinite(levels) && levels > 0 ? levels * 3 : 8;
          const base = Number.isFinite(suppliedBase) && suppliedBase >= 0 && suppliedBase < height ? suppliedBase : 0;
          const heightEstimated = !(Number.isFinite(suppliedHeight) && suppliedHeight > 0);
          for (const rings of polygons) {
            if (!rings[0] || rings[0].length < 4) continue;
            const shape = new THREE.Shape(rings[0].map(toLocal));
            for (const hole of rings.slice(1)) shape.holes.push(new THREE.Path(hole.map(toLocal)));
            const mesh = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: height - base, bevelEnabled: false }), buildingMaterial);
            mesh.position.z = base;
            mesh.name = name;
            mesh.userData = { ...properties, height_m: height, height_source: heightEstimated ? 'estimated' : 'OSM vector tiles' };
            content.add(mesh);
            buildings++;
            if (heightEstimated) estimated++;
          }
        } else if (sourceLayer === 'transportation' && ['LineString', 'MultiLineString'].includes(clipped.geometry.type)) {
          const geometry = clipped.geometry as LineString | MultiLineString;
          const lines = geometry.type === 'LineString' ? [geometry.coordinates] : geometry.coordinates;
          const width = ['motorway', 'trunk'].includes(String(properties.class)) ? 7
            : ['primary', 'secondary'].includes(String(properties.class)) ? 5 : 2.5;
          for (const line of lines) {
            if (line.length < 2) continue;
            const points = line.map(toLocal).map((point) => new THREE.Vector3(point.x, point.y, 0.12));
            const path = new THREE.CurvePath<THREE.Vector3>();
            for (let index = 1; index < points.length; index++) {
              if (!points[index - 1].equals(points[index])) path.add(new THREE.LineCurve3(points[index - 1], points[index]));
            }
            if (path.curves.length === 0) continue;
            const mesh = new THREE.Mesh(new THREE.TubeGeometry(path, Math.min(points.length * 2, 256), width / 2, 4, false), roadMaterial);
            mesh.scale.z = 0.02;
            mesh.name = name;
            mesh.userData = { ...properties, source: 'OpenStreetMap', width_estimated: true };
            content.add(mesh);
            roads++;
          }
        }
      }
      content.userData = { source: 'OpenStreetMap contributors / OpenFreeMap', license: 'ODbL', center: center.toArray(), bbox, units: 'meters', up: 'Z', buildings, roads, estimated_heights: estimated };
      setNativeBuildings(buildings === 0);
      report({ phase: 'ready', buildings, roads, estimated });
      map.triggerRepaint();
    } catch {
      clear();
      setNativeBuildings(true);
      report({ ...OVERVIEW, phase: 'error', message: 'No se pudo generar la escena de esta zona.' });
    }
  };
  const markLoading = () => {
    revision = '';
    if (map.getZoom() >= 15) report({ ...status, phase: 'loading' });
  };
  map.on('moveend', markLoading);
  map.on('idle', rebuild);
  rebuild();

  return {
    refresh() { markLoading(); rebuild(); map.triggerRepaint(); },
    async exportGlb() {
      if (status.phase !== 'ready' || content.children.length === 0) throw new Error('No hay una escena cargada para exportar.');
      const output = await new GLTFExporter().parseAsync(content.clone(true), { binary: true, onlyVisible: true });
      if (!(output instanceof ArrayBuffer)) throw new Error('No se pudo generar el archivo GLB.');
      return output;
    },
    dispose() {
      disposed = true;
      map.off('moveend', markLoading);
      map.off('idle', rebuild);
      if (map.getLayer('osm-country-scene')) map.removeLayer('osm-country-scene');
    },
  };
}