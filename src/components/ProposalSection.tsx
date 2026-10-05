import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, MapPin, RefreshCw, Trash2 } from 'lucide-react';
import maplibregl from 'maplibre-gl';
import type { FeatureCollection, MultiPolygon, Point, Polygon } from 'geojson';
import mexicoStatesGeoJSON from '../assets/mexico-states.json';
import { loadProposals, moderateProposal, refreshProposals, saveProposal } from '../proposalsApi';
import type { CluesGeoItem } from '../types';

interface ProposalPoint {
  lat: number;
  lng: number;
}

interface ProposalDraft {
  id: string;
  name: string;
  username: string;
  pointName: string;
  clues: string;
  institution: string;
  state: string;
  coordinateSource: string;
  status: string;
  point: ProposalPoint;
}

const EMPTY_POINTS: FeatureCollection<Point> = {
  type: 'FeatureCollection',
  features: [],
};

const EMPTY_STATES: FeatureCollection<Polygon | MultiPolygon, Record<string, unknown>> = {
  type: 'FeatureCollection',
  features: [],
};

const MEXICO_STATES = mexicoStatesGeoJSON as unknown as FeatureCollection<
  Polygon | MultiPolygon,
  Record<string, unknown>
>;

function getGeometryBounds(geometry: Polygon | MultiPolygon): maplibregl.LngLatBounds {
  const bounds = new maplibregl.LngLatBounds();
  const visit = (value: unknown) => {
    if (!Array.isArray(value)) return;
    if (typeof value[0] === 'number' && typeof value[1] === 'number') {
      bounds.extend([value[0], value[1]]);
      return;
    }
    value.forEach(visit);
  };
  visit(geometry.coordinates);
  return bounds;
}

async function loadSavedOptions(): Promise<ProposalDraft[]> {
  const rows = await loadProposals();
  return rows.map((option) => ({
    id: option.id,
    name: option.nombre_solicitante,
    username: option.usuario,
    pointName: option.nombre_punto,
    clues: option.clues,
    institution: option.institucion,
    state: option.estado,
    coordinateSource: option.fuente_coordenadas,
    status: option.estatus_revision,
    point: { lat: Number(option.latitud), lng: Number(option.longitud) },
  }));
}

export function ProposalSection({
  cluesGeo,
  adminEnabled,
  adminPassword,
  onOptionsUpdated,
}: {
  cluesGeo: CluesGeoItem[];
  adminEnabled: boolean;
  adminPassword: string;
  onOptionsUpdated: () => Promise<void>;
}) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const proposalMarkerRef = useRef<maplibregl.Marker | null>(null);
  const coordinateInputRef = useRef<HTMLInputElement>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState(false);
  const [selectedPoint, setSelectedPoint] = useState<ProposalPoint | null>(null);
  const [coordinateError, setCoordinateError] = useState('');
  const [coordinatesConfirmed, setCoordinatesConfirmed] = useState(false);
  const [selectedState, setSelectedState] = useState('');
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [pointName, setPointName] = useState('');
  const [coordinateSource, setCoordinateSource] = useState('Mapa interactivo');
  const [selectedInstitution, setSelectedInstitution] = useState('');
  const [mapPitch, setMapPitch] = useState<0 | 60>(0);
  const [selectedClues, setSelectedClues] = useState('');
  const [drafts, setDrafts] = useState<ProposalDraft[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [savingOption, setSavingOption] = useState(false);
  const [refreshingOptions, setRefreshingOptions] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState('');
  const [deletingId, setDeletingId] = useState('');
  const [acceptingId, setAcceptingId] = useState('');
  const [optionsError, setOptionsError] = useState('');

  const referenceUnits = useMemo(
    () => cluesGeo.filter((unit) =>
      unit.accion?.trim().toLowerCase() !== 'no aceptada'
      && Number.isFinite(unit.lat)
      && Number.isFinite(unit.lng)
    ),
    [cluesGeo],
  );
  const visibleReferenceUnits = referenceUnits;

  useEffect(() => {
    let active = true;
    loadSavedOptions()
      .then((options) => {
        if (active) setDrafts(options);
      })
      .catch((error: unknown) => {
        if (active) setOptionsError(error instanceof Error ? error.message : 'No se pudieron cargar las opciones.');
      })
      .finally(() => {
        if (active) setLoadingOptions(false);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!mapContainerRef.current) return;
    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: 'https://tiles.openfreemap.org/styles/liberty',
      center: [-102, 23.5],
      zoom: 4.7,
      pitch: 0,
      maxBounds: [[-120, 13], [-85, 34]],
      attributionControl: false,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl(), 'bottom-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
    map.on('load', () => {
      map.addSource('state-contours', { type: 'geojson', data: EMPTY_STATES });
      map.addLayer({
        id: 'state-contours-fill',
        type: 'fill',
        source: 'state-contours',
        paint: { 'fill-color': '#E5ECE6', 'fill-opacity': 0.08 },
      });
      map.addLayer({
        id: 'state-contours-line',
        type: 'line',
        source: 'state-contours',
        paint: { 'line-color': '#15803D', 'line-width': 3.2, 'line-opacity': 0.95 },
      });
      map.addSource('reference-units', { type: 'geojson', data: EMPTY_POINTS });
      map.addLayer({
        id: 'reference-unit-points',
        type: 'circle',
        source: 'reference-units',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 3, 9, 6],
          'circle-color': ['match', ['get', 'institucion'], 'CSA', '#A57F2C', 'IMB', '#611232', '#002F2A'],
          'circle-stroke-color': '#FFFFFF',
          'circle-stroke-width': 1.5,
        },
      });
      map.addSource('saved-options', { type: 'geojson', data: EMPTY_POINTS });
      map.addLayer({
        id: 'saved-option-points',
        type: 'circle',
        source: 'saved-options',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 5, 9, 8],
          'circle-color': '#DC2626',
          'circle-stroke-color': '#FFFFFF',
          'circle-stroke-width': 2,
        },
      });
      map.on('click', (event) => {
        const point = { lat: event.lngLat.lat, lng: event.lngLat.lng };
        const selectedFeature = map.queryRenderedFeatures(event.point, { layers: ['reference-unit-points'] })[0];
        const properties = selectedFeature?.properties as Record<string, unknown> | undefined;
        const selectedInstitution = properties?.institucion;
        if (properties && (selectedInstitution === 'IMO' || selectedInstitution === 'IMB' || selectedInstitution === 'CSA')) {
          setSelectedClues(String(properties.clues ?? ''));
          setSelectedInstitution(selectedInstitution);
          setSelectedState(String(properties.entidad ?? ''));
        } else {
          setSelectedClues('');
        }
        setSelectedPoint(point);
        setCoordinateSource('Mapa interactivo');
        setCoordinatesConfirmed(false);
        if (coordinateInputRef.current) {
          coordinateInputRef.current.value = `${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}`;
        }
        setCoordinateError('');
      });
      map.on('mouseenter', 'reference-unit-points', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'reference-unit-points', () => { map.getCanvas().style.cursor = ''; });
      void fetch(`${import.meta.env.BASE_URL}contorno_estados_web.geojson`)
        .then(async (response) => {
          if (!response.ok) throw new Error('No fue posible cargar los contornos estatales');
          const states = await response.json() as FeatureCollection<Polygon | MultiPolygon, Record<string, unknown>>;
          (map.getSource('state-contours') as maplibregl.GeoJSONSource).setData(states);
          map.fitBounds([[-118.5, 14], [-86, 33.2]], { padding: 24, duration: 0 });
        })
        .catch(() => setMapError(true));
      setMapReady(true);
    });
    map.on('error', () => setMapError(true));

    return () => {
      proposalMarkerRef.current?.remove();
      proposalMarkerRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const updateSources = () => {
      const referenceSource = map.getSource('reference-units') as maplibregl.GeoJSONSource | undefined;
      referenceSource?.setData({
        type: 'FeatureCollection',
        features: visibleReferenceUnits.map((unit) => ({
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [unit.lng, unit.lat] },
          properties: {
            clues: unit.clues,
            nombre: unit.nombre_de_la_unidad,
            institucion: unit.clave_de_la_institucion,
            entidad: unit.entidad,
          },
        })),
      });
    };
    if (map.getSource('reference-units')) updateSources();
    else map.once('load', updateSources);
    return () => { map.off('load', updateSources); };
  }, [visibleReferenceUnits]);

  useEffect(() => {
    const map = mapRef.current;
    if (map && mapReady) map.easeTo({ pitch: mapPitch, duration: 500 });
  }, [mapPitch, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const updateSavedOptions = () => {
      const source = map.getSource('saved-options') as maplibregl.GeoJSONSource | undefined;
      source?.setData({
        type: 'FeatureCollection',
        features: drafts
          .filter((option) => option.status.trim().toLowerCase() !== 'no aceptada')
          .map((option) => ({
            type: 'Feature' as const,
            geometry: { type: 'Point' as const, coordinates: [option.point.lng, option.point.lat] },
            properties: { id: option.id, nombre: option.pointName },
          })),
      });
    };
    if (map.getSource('saved-options')) updateSavedOptions();
    else map.once('load', updateSavedOptions);
    return () => { map.off('load', updateSavedOptions); };
  }, [drafts]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    if (!selectedPoint) {
      proposalMarkerRef.current?.remove();
      proposalMarkerRef.current = null;
      return;
    }

    const coordinates: [number, number] = [selectedPoint.lng, selectedPoint.lat];
    if (!proposalMarkerRef.current) {
      const marker = new maplibregl.Marker({ color: '#7C3AED', draggable: true, scale: 1.1 })
        .setLngLat(coordinates)
        .addTo(map);
      marker.on('dragend', () => {
        const point = marker.getLngLat();
        setSelectedPoint({ lat: point.lat, lng: point.lng });
        setCoordinateSource('Mapa interactivo');
        setCoordinatesConfirmed(false);
        if (coordinateInputRef.current) {
          coordinateInputRef.current.value = `${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}`;
        }
      });
      proposalMarkerRef.current = marker;
    } else {
      proposalMarkerRef.current.setLngLat(coordinates);
    }
  }, [mapReady, selectedPoint]);

  function focusState(stateName: string) {
    setSelectedState(stateName);
    const map = mapRef.current;
    if (!map) return;
    if (!stateName) {
      map.fitBounds([[-118.5, 14], [-86, 33.2]], { padding: 24, duration: 700 });
      return;
    }
    const state = MEXICO_STATES.features.find((feature) => feature.properties?.name === stateName);
    if (!state) return;
    const bounds = getGeometryBounds(state.geometry);
    if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 40, maxZoom: 8, duration: 700 });
  }

  async function updateOptions() {
    setRefreshingOptions(true);
    setOptionsError('');
    setRefreshMessage('');
    try {
      const count = await refreshProposals();
      setDrafts(await loadSavedOptions());
      await onOptionsUpdated();
      setRefreshMessage(`Base actualizada: ${count.toLocaleString('es-MX')} opciones.`);
    } catch (error) {
      setOptionsError(error instanceof Error ? error.message : 'No se pudo actualizar la base Parquet.');
    } finally {
      setRefreshingOptions(false);
    }
  }

  async function deleteSavedOption(option: ProposalDraft) {
    if (!adminEnabled) return;
    if (confirmDeleteId !== option.id) {
      setConfirmDeleteId(option.id);
      return;
    }
    setDeletingId(option.id);
    setOptionsError('');
    try {
      await moderateProposal('delete', option.id, adminPassword);
      setDrafts(await loadSavedOptions());
      await onOptionsUpdated();
      setConfirmDeleteId('');
    } catch (error) {
      setOptionsError(error instanceof Error ? error.message : 'No se pudo eliminar el punto.');
    } finally {
      setDeletingId('');
    }
  }

  async function acceptSavedOption(option: ProposalDraft) {
    if (!adminEnabled || option.status === 'Aceptada') return;
    setAcceptingId(option.id);
    setOptionsError('');
    try {
      await moderateProposal('accept', option.id, adminPassword);
      setDrafts(await loadSavedOptions());
      await onOptionsUpdated();
    } catch (error) {
      setOptionsError(error instanceof Error ? error.message : 'No se pudo aceptar el punto.');
    } finally {
      setAcceptingId('');
    }
  }

  function applyGoogleCoordinates() {
    const value = coordinateInputRef.current?.value.trim() ?? '';
    const match = value.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/)
      ?? value.match(/@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/)
      ?? value.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
    if (!match) {
      setCoordinateError('Pega latitud y longitud, por ejemplo: 19.432608, -99.133209.');
      return;
    }

    const lat = Number(match[1]);
    const lng = Number(match[2]);
    if (lat < 13 || lat > 34 || lng < -120 || lng > -85) {
      setCoordinateError('Las coordenadas deben estar dentro de México.');
      return;
    }

    setSelectedPoint({ lat, lng });
    setSelectedClues('');
    setCoordinateSource('Google Maps');
    setCoordinatesConfirmed(true);
    setCoordinateError('');
    mapRef.current?.flyTo({ center: [lng, lat], zoom: 13, duration: 700 });
  }

  async function addDraft(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !selectedPoint
      || !coordinatesConfirmed
      || !name.trim()
      || !username.trim()
      || !pointName.trim()
      || !selectedInstitution
      || !selectedState
      || savingOption
    ) return;
    setSavingOption(true);
    setOptionsError('');
    const option = {
      nombre_solicitante: name.trim(),
      usuario: username.trim(),
      nombre_punto: pointName.trim(),
      clues: selectedClues,
      institucion: selectedInstitution,
      latitud: selectedPoint.lat,
      longitud: selectedPoint.lng,
      estado: selectedState,
      fuente_coordenadas: coordinateSource,
    };
    try {
      await saveProposal(option);
      setRefreshMessage('Opción guardada. Para ver su punto nuevo, pulse Actualizar.');
      setName('');
      setUsername('');
      setPointName('');
      setSelectedPoint(null);
      setSelectedClues('');
      setCoordinatesConfirmed(false);
      if (coordinateInputRef.current) coordinateInputRef.current.value = '';
    } catch (error) {
      setOptionsError(error instanceof Error ? error.message : 'No se pudo guardar en Google Sheets.');
    } finally {
      setSavingOption(false);
    }
  }

  return (
    <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 overflow-hidden rounded-lg border border-gray-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-800">
            <MapPin className="h-4 w-4 text-imss-green" />
            Selecciona un punto en el mapa
          </div>
          <span className="text-xs text-gray-500">Haz clic para colocar el pin; arrástralo para ajustarlo.</span>
          <div className="inline-flex rounded-md border border-gray-300 p-0.5" role="group" aria-label="Modo de vista">
            {([0, 60] as const).map((pitch) => (
              <button
                key={pitch}
                type="button"
                aria-pressed={mapPitch === pitch}
                onClick={() => setMapPitch(pitch)}
                className={`rounded px-2.5 py-1 text-xs font-semibold ${mapPitch === pitch ? 'bg-imss-green text-white' : 'text-gray-600 hover:bg-gray-100'}`}
              >
                {pitch}°
              </button>
            ))}
          </div>
          <label className="text-xs font-medium text-gray-600" htmlFor="proposal-state">Estado</label>
          <label className="sr-only" htmlFor="proposal-state">Acercar a estado</label>
          <select
            id="proposal-state"
            value={selectedState}
            onChange={(event) => focusState(event.target.value)}
            className="rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs text-gray-700"
          >
            <option value="">Todo México</option>
            {[...MEXICO_STATES.features]
              .map((feature) => String(feature.properties?.name ?? ''))
              .filter(Boolean)
              .sort((a, b) => a.localeCompare(b, 'es'))
              .map((stateName) => <option key={stateName} value={stateName}>{stateName}</option>)}
          </select>
          <div className="flex items-center gap-4 text-xs text-gray-600">
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-red-600" />Opciones guardadas</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#7C3AED]" />En captura</span>
          </div>
        </div>
        <div className="relative h-[55vh] min-h-[420px] max-h-[720px] lg:h-[72vh]">
          <div ref={mapContainerRef} className="absolute inset-0" />
          {!mapReady && !mapError && (
            <div role="status" className="absolute right-3 top-3 rounded-md border border-gray-200 bg-white/95 px-3 py-2 text-xs text-gray-600 shadow-sm">
              Cargando cartografía...
            </div>
          )}
          {mapError && (
            <div role="alert" className="absolute left-3 right-3 top-3 rounded-md border border-red-200 bg-white/95 px-3 py-2 text-sm text-red-700 shadow-sm">
              No fue posible cargar el mapa base. Verifica tu conexión e inténtalo de nuevo.
            </div>
          )}
        </div>
        <div className="border-t border-gray-200 px-4 py-2 text-xs text-gray-500">
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" className="hover:underline">© OpenStreetMap</a>
          {' · '}
          <a href="https://openfreemap.org/" target="_blank" rel="noopener noreferrer" className="hover:underline">OpenFreeMap</a>
        </div>
      </div>

      <aside className="space-y-6">
        <div className="flex items-end justify-between border-b border-gray-200 pb-3">
          <div>
            <p className="text-xs font-semibold uppercase text-gray-500">Base territorial</p>
            <h2 className="mt-1 text-2xl font-bold text-imss-green">Unidades de referencia</h2>
          </div>
          <p className="text-2xl font-bold tabular-nums text-gray-800">{visibleReferenceUnits.length.toLocaleString('es-MX')}</p>
        </div>

        <form onSubmit={addDraft} className="space-y-4">
          <h3 className="text-base font-bold text-gray-900">Nueva propuesta</h3>
          {optionsError && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{optionsError}</p>}
          <label className="block text-sm font-medium text-gray-700">
            Nombre de quien propone
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              maxLength={120}
              className="mt-1.5 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-imss-green focus:ring-2 focus:ring-imss-green/20"
            />
          </label>
          <label className="block text-sm font-medium text-gray-700">
            Correo electrónico
            <input
              type="email"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
              maxLength={120}
              className="mt-1.5 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-imss-green focus:ring-2 focus:ring-imss-green/20"
            />
          </label>
          <label className="block text-sm font-medium text-gray-700">
            Institución
            <select
              value={selectedInstitution}
              onChange={(event) => setSelectedInstitution(event.target.value)}
              required
              className="mt-1.5 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-imss-green focus:ring-2 focus:ring-imss-green/20"
            >
              <option value="">Selecciona una institución</option>
              <option value="IMO">IMO</option>
              <option value="IMB">IMB</option>
              <option value="CSA">CSA</option>
            </select>
          </label>
          <label className="block text-sm font-medium text-gray-700">
            Nombre del punto
            <input
              value={pointName}
              onChange={(event) => setPointName(event.target.value)}
              required
              maxLength={120}
              className="mt-1.5 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-imss-green focus:ring-2 focus:ring-imss-green/20"
            />
          </label>
          <label className="block text-sm font-medium text-gray-700">
            Coordenadas de Google Maps
            <div className="mt-1.5 flex gap-2">
              <input
                ref={coordinateInputRef}
                type="text"
                placeholder="19.432608, -99.133209"
                aria-label="Coordenadas de Google Maps, latitud y longitud"
                onChange={() => setCoordinatesConfirmed(false)}
                className="min-w-0 flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-imss-green focus:ring-2 focus:ring-imss-green/20"
              />
              <button
                type="button"
                onClick={applyGoogleCoordinates}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
              >
                Aplicar
              </button>
            </div>
          </label>
          {coordinateError && <p role="alert" className="text-xs text-red-700">{coordinateError}</p>}
          <label className="flex items-start gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={coordinatesConfirmed} onChange={(event) => setCoordinatesConfirmed(event.target.checked)} className="mt-0.5 accent-imss-green" />
            <span>Confirmo que estas coordenadas corresponden al punto propuesto.</span>
          </label>
          <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
            <span className="font-semibold">Punto seleccionado:</span>{' '}
            {selectedPoint
              ? `${selectedPoint.lat.toFixed(6)}, ${selectedPoint.lng.toFixed(6)}`
              : 'Sin punto seleccionado'}
          </div>
          <button
            type="submit"
            disabled={savingOption || !selectedPoint || !coordinatesConfirmed || !name.trim() || !username.trim() || !pointName.trim() || !selectedInstitution || !selectedState}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-imss-green px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-900 disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            <Check className="h-4 w-4" />
            {savingOption ? 'Guardando...' : 'Agregar como opción'}
          </button>
        </form>

        <div className="border-t border-gray-200 pt-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-bold text-gray-900">Opciones guardadas</h3>
            <div className="flex items-center gap-3">
              <span className="text-xs tabular-nums text-gray-500">{drafts.length}</span>
              <button
                type="button"
                onClick={updateOptions}
                disabled={refreshingOptions}
                aria-label="Actualizar opciones desde Google Sheets"
                title="Descargar cambios de Google Sheets al Parquet local"
                className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-2.5 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-wait disabled:opacity-60"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${refreshingOptions ? 'animate-spin' : ''}`} />
                {refreshingOptions ? 'Actualizando...' : 'Actualizar'}
              </button>
            </div>
          </div>
          {refreshMessage && <p role="status" className="mb-2 text-xs text-emerald-700">{refreshMessage}</p>}
          {loadingOptions ? (
            <p role="status" className="text-sm text-gray-500">Cargando opciones...</p>
          ) : drafts.length === 0 ? (
            <p className="text-sm text-gray-500">Sin opciones guardadas.</p>
          ) : (
            <ul className="divide-y divide-gray-200">
              {drafts.map((draft) => (
                <li key={draft.id} className="flex items-start gap-3 py-3">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-gray-800">{draft.pointName}</p>
                    <p className="truncate text-xs text-gray-500">{draft.name} · {draft.username}</p>
                    <p className="truncate text-xs text-gray-500">{draft.institution}{draft.clues ? ` · CLUES ${draft.clues}` : ''} · {draft.state}</p>
                    <p className="text-xs text-gray-500">{draft.point.lat.toFixed(6)}, {draft.point.lng.toFixed(6)}</p>
                    {draft.status === 'Aceptada' && <p className="mt-1 text-xs font-semibold text-emerald-800">Aceptada · visible en el mapa principal</p>}
                    {confirmDeleteId === draft.id && (
                      <div className="mt-2 flex items-center gap-2 text-xs">
                        <span className="text-red-700">¿Eliminar este punto?</span>
                        <button type="button" onClick={() => void deleteSavedOption(draft)} disabled={deletingId === draft.id} className="font-semibold text-red-700 underline disabled:opacity-50">
                          {deletingId === draft.id ? 'Eliminando...' : 'Confirmar'}
                        </button>
                        <button type="button" onClick={() => setConfirmDeleteId('')} className="text-gray-500 underline">Cancelar</button>
                      </div>
                    )}
                  </div>
                  {adminEnabled && (
                    <div className="flex shrink-0 items-center gap-1">
                      {draft.status !== 'Aceptada' && (
                        <button
                          type="button"
                          onClick={() => void acceptSavedOption(draft)}
                          disabled={Boolean(acceptingId || deletingId)}
                          aria-label={`Aceptar ${draft.pointName}`}
                          title="Aceptar punto para el mapa principal"
                          className="flex h-8 items-center gap-1 rounded-md px-2 text-xs font-semibold text-imss-green hover:bg-emerald-50 disabled:opacity-50"
                        >
                          <Check className="h-4 w-4" />
                          {acceptingId === draft.id ? 'Aceptando...' : 'Aceptar'}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void deleteSavedOption(draft)}
                        disabled={Boolean(deletingId || acceptingId)}
                        aria-label={`Eliminar ${draft.pointName}`}
                        title="Eliminar punto guardado"
                        className="flex h-8 w-8 items-center justify-center rounded-md text-gray-500 hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </section>
  );
}