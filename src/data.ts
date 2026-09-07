import type { CellValue, CluesGeoItem, DataRow, TablasFormulario } from './types';

async function fetchJson<T>(filename: string): Promise<T | null> {
  const ts = Date.now();
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}${filename}?_cb=${ts}`);
    if (!response.ok) return null;
    return await response.json() as T;
  } catch {
    return null;
  }
}

async function fetchBaseClues(): Promise<string[]> {
  const payload = await fetchJson<unknown[]>('base_clues.json');
  if (!Array.isArray(payload)) return [];
  return [...new Set(
    payload.map((row) => {
      if (typeof row === 'string') return row.trim();
      if (row && typeof row === 'object' && 'clues_imb' in row)
        return String((row as { clues_imb: unknown }).clues_imb ?? '').trim();
      return '';
    }).filter(Boolean)
  )];
}

async function fetchCluesGeo(): Promise<CluesGeoItem[]> {
  const payload = await fetchJson<{
    features?: Array<{
      geometry?: { type?: string; coordinates?: unknown[] };
      properties?: Record<string, unknown>;
    }>;
  }>('mapa_base.geojson');

  if (!Array.isArray(payload?.features)) return [];

  return payload.features.flatMap((feature) => {
    const properties = feature.properties;
    const coordinates = feature.geometry?.coordinates;
    const institucion = properties?.clave_de_la_institucion ?? properties?.institucion;
    const totalConsultorios = Number(properties?.total_consultorios);
    const poblacionPorConsultorio = Number(properties?.['población_por_consultorio']);

    if (
      feature.geometry?.type !== 'Point'
      || !Array.isArray(coordinates)
      || typeof coordinates[0] !== 'number'
      || typeof coordinates[1] !== 'number'
      || (institucion !== 'IMO' && institucion !== 'IMB' && institucion !== 'CSA')
      || !properties?.clues
    ) return [];

    return [{
      clues: String(properties.clues),
      clave_de_la_institucion: institucion,
      nombre_de_la_unidad: String(properties.nombre_unidad ?? ''),
      entidad: String(properties.entidad ?? ''),
      municipio: String(properties.municipio ?? ''),
      localidad: String(properties.localidad ?? ''),
      total_consultorios: properties.total_consultorios !== null && Number.isFinite(totalConsultorios)
        ? totalConsultorios
        : null,
      poblacion_por_consultorio: properties['población_por_consultorio'] !== null && Number.isFinite(poblacionPorConsultorio)
        ? poblacionPorConsultorio
        : null,
      lng: coordinates[0],
      lat: coordinates[1],
    }];
  });
}

async function fetchTablaUnidades(): Promise<Set<string>> {
  const payload = await fetchJson<unknown[]>('tabla_unidades.json');
  if (!Array.isArray(payload)) return new Set();
  return new Set(payload.map((v) => String(v).trim()).filter(Boolean));
}

async function fetchBaseMeta(): Promise<{ cluesTotal: number; entidadesEsperadas: number; scriptLastRunAt?: string }> {
  const payload = await fetchJson<Record<string, unknown>>('base_meta.json');
  if (!payload) return { cluesTotal: 0, entidadesEsperadas: 0 };
  const cluesTotal = Number(payload?.clues_unicas ?? payload?.clues_total ?? 0);
  const entidadesEsperadas = Number(payload?.entidades_esperadas ?? 0);
  return {
    cluesTotal: Number.isFinite(cluesTotal) ? cluesTotal : 0,
    entidadesEsperadas: Number.isFinite(entidadesEsperadas) ? entidadesEsperadas : 0,
    scriptLastRunAt: typeof payload?.script_last_run_at === 'string' ? payload.script_last_run_at : undefined,
  };
}

function toCellValue(value: unknown): CellValue {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value).trim();
  const low = text.toLowerCase();
  if (low === 'true') return true;
  if (low === 'false') return false;
  const asNumber = Number(text);
  if (!Number.isNaN(asNumber) && text !== '') return asNumber;
  return text;
}

async function fetchDataRows(filename: string): Promise<DataRow[]> {
  const payload = await fetchJson<Record<string, unknown>[]>(filename);
  if (!Array.isArray(payload)) return [];
  return payload.map((row) => {
    const normalized: DataRow = {};
    Object.entries(row).forEach(([key, value]) => {
      normalized[key] = toCellValue(value);
    });
    return normalized;
  });
}

export async function cargarTablasFormulario(): Promise<{ tablas: TablasFormulario; fetchedAt: Date }> {
  const [baseClues, baseMeta, cluesGeo, resultado, resumen, resumenEntidad, faltantes, baseAn] = await Promise.all([
    fetchBaseClues(),
    fetchBaseMeta(),
    fetchCluesGeo(),
    fetchDataRows('resultado.json'),
    fetchDataRows('resumen.json'),
    fetchDataRows('resumen_entidad.json'),
    fetchDataRows('faltantes.json'),
    fetchDataRows('base_an.json'),
  ]);

  const tablas: TablasFormulario = {
    baseClues,
    baseMeta,
    baseAn,
    resultado,
    resumen,
    resumenEntidad,
    cluesGeo,
    faltantes,
  };

  return { tablas, fetchedAt: new Date() };
}
