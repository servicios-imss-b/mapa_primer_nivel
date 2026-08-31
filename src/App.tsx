import { useEffect, useMemo, useState } from 'react';
import { Header } from './components/Header';
import { StatCards } from './components/Charts';
import { cargarTablasFormulario } from './data';
import type { DashboardStats, DataRow, EntidadChart, InternetPieItem, TopFaltanteChart, CluesGeoItem } from './types';

function toText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function toNumber(value: unknown): number {
  const num = Number(value);
  return Number.isNaN(num) ? 0 : num;
}

function isMissingValue(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return true;
  if (typeof value === 'boolean') return value === false;
  if (typeof value === 'number') return value <= 0;

  const text = toText(value).toLowerCase();
  return text === '' || text === 'false' || text === 'no' || text === '0' || text === 'nan';
}

function excelSerialToDate(serial: number): Date {
  // Excel epoch: Dec 30, 1899 = day 0; JS epoch: Jan 1, 1970 = day 25569
  return new Date((serial - 25569) * 86400 * 1000);
}

function parseDateValue(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null;

  if (typeof value === 'number') {
    if (value > 25569 && value < 73050) {
      const d = excelSerialToDate(value);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    return null;
  }

  const text = toText(value);
  if (!text) return null;

  const nativeDate = new Date(text);
  if (!Number.isNaN(nativeDate.getTime())) return nativeDate;

  const mxFormat = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!mxFormat) return null;

  const day = Number(mxFormat[1]);
  const month = Number(mxFormat[2]);
  const year = Number(mxFormat[3]);
  const hour = Number(mxFormat[4] ?? 0);
  const minute = Number(mxFormat[5] ?? 0);
  const second = Number(mxFormat[6] ?? 0);

  const parsed = new Date(year, month - 1, day, hour, minute, second);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function inferDataUpdatedAt(rows: DataRow[]): Date | null {
  let latest: Date | null = null;

  for (const row of rows) {
    for (const [key, value] of Object.entries(row)) {
      if (!/fecha/i.test(key)) continue;
      const parsed = parseDateValue(value);
      if (!parsed) continue;

      if (!latest || parsed.getTime() > latest.getTime()) {
        latest = parsed;
      }
    }
  }

  return latest;
}

function formatLastUpdateLabel(date: Date): string {
  const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const day = String(date.getDate()).padStart(2, '0');
  const month = months[date.getMonth()];
  const year = date.getFullYear();
  const hour24 = date.getHours();
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const minute = String(date.getMinutes()).padStart(2, '0');
  const ampm = hour24 >= 12 ? 'p.m.' : 'a.m.';
  return `${day} ${month} ${year}, ${String(hour12).padStart(2, '0')}:${minute} ${ampm}`;
}

function formatCellValue(value: unknown, key?: string): string {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'boolean') return value ? 'Si' : 'No';
  if (typeof value === 'number') {
    // Detecta serial de fecha Excel en columnas cuyo nombre contiene 'fecha'
    if (key && /fecha/i.test(key) && value > 25569 && value < 73050) {
      const d = excelSerialToDate(value);
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${d.getDate()}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    }
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }

  const text = String(value).trim();
  if (text.toLowerCase() === 'true') return 'Si';
  if (text.toLowerCase() === 'false') return 'No';
  return text;
}

export default function App() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [baseAn, setBaseAn] = useState<DataRow[]>([]);
  const [baseClues, setBaseClues] = useState<string[]>([]);
  const [baseMeta, setBaseMeta] = useState<{ cluesTotal: number; entidadesEsperadas: number }>({
    cluesTotal: 0,
    entidadesEsperadas: 0,
  });
  const [resultado, setResultado] = useState<DataRow[]>([]);
  const [resumen, setResumen] = useState<DataRow[]>([]);
  const [cluesGeo, setCluesGeo] = useState<CluesGeoItem[]>([]);
  const [faltantes, setFaltantes] = useState<DataRow[]>([]);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  async function load() {
    try {
      setLoading(true);
      setError(null);
      const { tablas } = await cargarTablasFormulario();
      setBaseClues(tablas.baseClues);
      setBaseMeta(tablas.baseMeta);
      setBaseAn(tablas.baseAn);
      setResultado(tablas.resultado);
      setResumen(tablas.resumen);
      setCluesGeo(tablas.cluesGeo);
      setFaltantes(tablas.faltantes);

      const updatedFromScript = parseDateValue(tablas.baseMeta.scriptLastRunAt);
      setLastUpdate(updatedFromScript ?? inferDataUpdatedAt(tablas.baseAn));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ocurrio un error al cargar datos');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const lastUpdateLabel = useMemo(() => {
    if (!lastUpdate) return 'Sin actualizacion';
    return formatLastUpdateLabel(lastUpdate);
  }, [lastUpdate]);

  const stats = useMemo<DashboardStats>(() => {
    // baseAn ya no se usa — los datos vienen de resumen y resultado directamente
    const cluesCapturadas = new Set<string>();
    const entidadesCapturadas = new Set<string>();
    const cluesConInternet = new Set<string>();

    for (const row of resumen) {
      const clues = toText(row.clues_imb);
      const entidad = toText(row.entidad);
      if (clues) cluesCapturadas.add(clues);
      if (entidad) entidadesCapturadas.add(entidad);

      const internet = toText(row.internet).toLowerCase();
      if (clues && (internet === 'true' || internet === '1' || internet === 'si')) cluesConInternet.add(clues);
    }

    const denominadorClues = baseMeta.cluesTotal > 0 ? baseMeta.cluesTotal : baseClues.length;
    const denominadorEntidades = baseMeta.entidadesEsperadas > 0 ? baseMeta.entidadesEsperadas : entidadesCapturadas.size;

    return {
      registrosBase: resumen.length,
      registrosUnidad: resumen.length,
      registrosRespuesta: resultado.length,
      baseCluesEsperadas: denominadorClues,
      baseEntidadesEsperadas: denominadorEntidades,
      cluesCapturadas: cluesCapturadas.size,
      entidadesCapturadas: entidadesCapturadas.size,
      unidadesInternet: cluesConInternet.size,
      consultoriosTotales: resumen.reduce((s, r) => s + toNumber(r.consultorio), 0),
      pctLlenado: (() => {
        const FIXED = new Set(['entidad', 'clues_imb', 'nombre_de_la_unidad', 'internet', 'consultorios_habilitados', 'consultorio', 'turno_consultorio', 'latitud', 'longitud']);
        let filled = 0, total = 0;
        for (const row of resultado) {
          for (const [key, value] of Object.entries(row)) {
            if (FIXED.has(key)) continue;
            total++;
            if (value !== null && value !== undefined && value !== '' && value !== 0 && value !== false) filled++;
          }
        }
        return total > 0 ? +(filled / total * 100).toFixed(1) : 0;
      })(),
    };
  }, [baseClues, baseMeta, resultado, resumen]);

  const topFaltantes = useMemo<TopFaltanteChart[]>(() => {
    const fixedCols = new Set([
      'entidad',
      'clues_imb',
      'nombre_de_la_unidad',
      'internet',
      'consultorios_habilitados',
      'consultorio',
      'turno_consultorio',
    ]);

    if (!resultado.length) return [];

    const counts = new Map<string, number>();

    for (const row of resultado) {
      for (const [key, value] of Object.entries(row)) {
        if (fixedCols.has(key)) continue;
        if (isMissingValue(value)) {
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
      }
    }

    const total = resultado.length;

    return [...counts.entries()]
      .map(([item, faltantes]) => ({
        item: item.replace(/_consultorio(_\d+)?$/i, '').replaceAll('_', ' ').trim(),
        faltantes,
        pct: total > 0 ? (faltantes / total) * 100 : 0,
      }))
      .sort((a, b) => b.faltantes - a.faltantes)
      .slice(0, 20);
  }, [resultado]);

  const internetPie = useMemo<InternetPieItem[]>(() => {
    const conInternet = stats.unidadesInternet;
    // Referente a las unidades capturadas (506), no al total esperado
    const sinInternet = Math.max(0, stats.cluesCapturadas - conInternet);
    return [
      { name: 'Con Internet', value: conInternet },
      { name: 'Sin Internet', value: sinInternet },
    ];
  }, [stats]);

  const porEntidad = useMemo<EntidadChart[]>(() => {
    const FIXED_COLS = new Set(['entidad', 'clues_imb', 'nombre_de_la_unidad', 'internet', 'consultorios_habilitados', 'consultorio', 'turno_consultorio']);

    const map = new Map<string, EntidadChart & { _filledSum: number; _totalSum: number }>();

    for (const row of resumen) {
      const entidad = toText(row.entidad) || 'Sin entidad';
      if (!map.has(entidad)) {
        map.set(entidad, {
          entidad,
          unidades: 0,
          consultoriosHabilitados: 0,
          consultoriosLevantados: 0,
          pctLlenado: 0,
          _filledSum: 0,
          _totalSum: 0,
        });
      }

      const agg = map.get(entidad);
      if (!agg) continue;

      agg.unidades += 1;
      agg.consultoriosHabilitados += toNumber(row.consultorios_habilitados);
      agg.consultoriosLevantados += toNumber(row.consultorio);
    }

    for (const row of resultado) {
      const entidad = toText(row.entidad) || 'Sin entidad';
      const agg = map.get(entidad);
      if (!agg) continue;

      for (const [key, value] of Object.entries(row)) {
        if (FIXED_COLS.has(key)) continue;
        agg._totalSum += 1;
        if (value !== null && value !== undefined && value !== '' && value !== 0 && value !== false) {
          agg._filledSum += 1;
        }
      }
    }

    return [...map.values()]
      .map(({ _filledSum, _totalSum, ...rest }) => ({
        ...rest,
        pctLlenado: _totalSum > 0 ? +(_filledSum / _totalSum * 100).toFixed(1) : 0,
      }))
      .sort((a, b) => b.unidades - a.unidades);
  }, [resumen, resultado]);

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />

      <main className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
        {loading ? (
          <div className="card p-10 text-center text-gray-500">Cargando información geográfica de unidades...</div>
        ) : error ? (
          <div className="card border-imss-wine/30 bg-imss-wine/5 p-8 text-imss-wine">Error: {error}</div>
        ) : (
          <StatCards stats={stats} internetPie={internetPie} porEntidad={porEntidad} topFaltantes={topFaltantes} cluesGeo={cluesGeo} resultado={resultado} />
        )}
      </main>

      <footer className="border-t border-gray-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
          <p className="text-center text-xs text-gray-400">
            IMSS Bienestar · Reporte Interno de Infraestructura de Materiales Hospitalarios · Documento de uso institucional
          </p>
        </div>
      </footer>
    </div>
  );
}
