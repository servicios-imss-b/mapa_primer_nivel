export type CellValue = string | number | boolean | null;
export type DataRow = Record<string, CellValue>;

export interface CluesGeoItem {
  clues: string;
  id_temp_sus?: string;
  clave_de_la_institucion: 'IMO' | 'IMB' | 'CSA';
  aceptado: 'Aceptada' | 'No aceptada' | null;
  nombre_de_la_unidad: string;
  entidad: string;
  municipio: string;
  localidad: string;
  total_consultorios: number | null;
  poblacion_por_consultorio: number | null;
  consulta_general: number | null;
  lat: number;
  lng: number;
}

export interface TablasFormulario {
  baseClues: string[];
  baseMeta: {
    cluesTotal: number;
    entidadesEsperadas: number;
    scriptLastRunAt?: string;
  };
  resultado: DataRow[];
  resumen: DataRow[];
  cluesGeo: CluesGeoItem[];
}

export interface DashboardStats {
  registrosBase: number;
  registrosUnidad: number;
  registrosRespuesta: number;
  baseCluesEsperadas: number;
  baseEntidadesEsperadas: number;
  cluesCapturadas: number;
  entidadesCapturadas: number;
  unidadesInternet: number;
  pctLlenado: number;
  consultoriosTotales: number;
}

export interface TopUnidadChart {
  clues: string;
  total: number;
}

export interface TopFaltanteChart {
  item: string;
  faltantes: number;
  pct: number;
}

export interface InternetPieItem {
  name: string;
  value: number;
}

export interface EntidadChart {
  entidad: string;
  unidades: number;
  consultoriosHabilitados: number;
  consultoriosLevantados: number;
  pctLlenado: number;
}
