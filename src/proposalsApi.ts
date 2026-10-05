export interface StoredProposal {
  id: string;
  nombre_solicitante: string;
  usuario: string;
  nombre_punto: string;
  clues: string;
  institucion: string;
  latitud: number;
  longitud: number;
  estado: string;
  estatus_revision: string;
  fecha_registro: string;
  fuente_coordenadas: string;
}

interface AppsScriptResponse {
  ok: boolean;
  options?: StoredProposal[];
  error?: string;
  pending?: boolean;
}

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbysK_5HCcs0MQMrRARSmFBgYb6P_oSTlF1s4OSeGqIE1W8NRMgIqFedtd6jjcEzCASj/exec';

function jsonp<T>(parameters: Record<string, string>): Promise<T> {
  return new Promise((resolve, reject) => {
    const callbackName = `receiveProposals${Date.now()}${Math.random().toString(36).slice(2)}`;
    const callbackWindow = window as unknown as Record<string, (payload: T) => void>;
    const script = document.createElement('script');
    const query = new URLSearchParams({ ...parameters, callback: callbackName, cache: String(Date.now()) });
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error('Apps Script no respondió a tiempo.'));
    }, 15000);
    const cleanup = () => {
      window.clearTimeout(timeout);
      script.remove();
      delete callbackWindow[callbackName];
    };

    callbackWindow[callbackName] = (payload) => {
      cleanup();
      resolve(payload);
    };
    script.onerror = () => {
      cleanup();
      reject(new Error('No se pudo leer Apps Script desde GitHub Pages.'));
    };
    script.src = `${APPS_SCRIPT_URL}?${query.toString()}`;
    document.head.append(script);
  });
}

async function postToAppsScript(payload: Record<string, unknown>): Promise<void> {
  await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    mode: 'no-cors',
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    body: JSON.stringify(payload),
  });
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

export async function loadProposals(): Promise<StoredProposal[]> {
  if (import.meta.env.DEV) {
    const response = await fetch('/api/proposals', { cache: 'no-store' });
    if (!response.ok) throw new Error('No se pudieron leer las opciones del Parquet local.');
    return await response.json() as StoredProposal[];
  }

  const response = await jsonp<AppsScriptResponse>({});
  if (!response.ok || !Array.isArray(response.options)) {
    throw new Error(response.error || 'Apps Script no devolvió opciones.');
  }
  return response.options;
}

export async function saveProposal(option: Omit<StoredProposal, 'id' | 'estatus_revision' | 'fecha_registro'>): Promise<void> {
  if (import.meta.env.DEV) {
    const response = await fetch('/api/proposals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ option }),
    });
    const result = await response.json() as AppsScriptResponse;
    if (!response.ok || !result.ok) throw new Error(result.error || 'No se pudo guardar la opción.');
    return;
  }

  await postToAppsScript({ option });
  const saved = await loadProposals();
  const found = saved.some((item) => item.nombre_solicitante === option.nombre_solicitante
    && item.usuario === option.usuario
    && item.nombre_punto === option.nombre_punto
    && item.latitud === option.latitud
    && item.longitud === option.longitud);
  if (!found) throw new Error('La opción no apareció en Google Sheets. Intenta actualizar.');
}

export async function refreshProposals(): Promise<number> {
  if (import.meta.env.DEV) {
    const response = await fetch('/api/proposals/refresh', { method: 'POST' });
    const result = await response.json() as { ok: boolean; count?: number; error?: string };
    if (!response.ok || !result.ok) throw new Error(result.error || 'No se pudo actualizar el Parquet.');
    return result.count ?? 0;
  }
  return (await loadProposals()).length;
}

export async function verifyAdminPassword(password: string): Promise<void> {
  if (import.meta.env.DEV) {
    const response = await fetch('/api/proposals/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    const result = await response.json() as { ok: boolean; error?: string };
    if (!response.ok || !result.ok) throw new Error(result.error || 'No se pudo verificar la contraseña.');
    return;
  }

  const nonce = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  await postToAppsScript({ action: 'verify-admin', password, nonce });
  for (let attempt = 0; attempt < 12; attempt++) {
    const result = await jsonp<AppsScriptResponse>({ adminNonce: nonce });
    if (!result.pending) {
      if (!result.ok) throw new Error(result.error || 'Contraseña incorrecta.');
      return;
    }
    await wait(350);
  }
  throw new Error('Apps Script no confirmó la verificación. Intenta de nuevo.');
}

export async function moderateProposal(action: 'accept' | 'delete', id: string, password: string): Promise<void> {
  if (import.meta.env.DEV) {
    const response = await fetch(`/api/proposals/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, password }),
    });
    const result = await response.json() as { ok: boolean; error?: string };
    if (!response.ok || !result.ok) throw new Error(result.error || 'La operación no se pudo completar.');
    return;
  }

  await postToAppsScript({ action, id, password });
  for (let attempt = 0; attempt < 8; attempt++) {
    const proposals = await loadProposals();
    const updated = proposals.find((proposal) => proposal.id === id);
    const completed = action === 'delete' ? !updated : updated?.estatus_revision === 'Aceptada';
    if (completed) return;
    await wait(400);
  }
  throw new Error('Apps Script no confirmó el cambio. Verifica el punto y actualiza.');
}