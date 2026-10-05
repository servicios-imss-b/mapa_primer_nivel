import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const parquetPath = path.join(projectRoot, 'base', 'nuevos_sus.parquet');
const converterPath = path.join(projectRoot, 'scripts', 'proposals-parquet.py');
const spreadsheetApi = 'https://script.google.com/macros/s/AKfycbysK_5HCcs0MQMrRARSmFBgYb6P_oSTlF1s4OSeGqIE1W8NRMgIqFedtd6jjcEzCASj/exec';

function runConverter(action, input = '') {
  return new Promise((resolve, reject) => {
    const python = spawn(process.env.PYTHON || 'python', [converterPath, action, parquetPath], {
      cwd: projectRoot,
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    python.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    python.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    python.on('error', reject);
    python.on('close', (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || `PyArrow terminó con código ${code}.`));
    });
    if (input) python.stdin.end(input);
    else python.stdin.end();
  });
}

function sendJson(response, status, payload) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(payload));
}

function readRequestBody(request, maxBytes = 32768) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > maxBytes) reject(new Error('La solicitud supera el tamaño permitido.'));
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

async function syncSheetToParquet() {
  const sheetResponse = await fetch(spreadsheetApi, { redirect: 'follow' });
  if (!sheetResponse.ok) throw new Error(`Apps Script respondió HTTP ${sheetResponse.status}.`);
  const payload = await sheetResponse.json();
  if (!payload.ok || !Array.isArray(payload.options)) {
    throw new Error(payload.error || 'La hoja no devolvió una lista de opciones.');
  }
  const options = payload.options
    .filter((option) => option.estatus_revision?.trim().toLowerCase() !== 'no aceptada')
    .map((option) => ({
      id: String(option.id ?? ''),
      nombre_solicitante: String(option.nombre_solicitante ?? ''),
      usuario: String(option.usuario ?? ''),
      nombre_punto: String(option.nombre_punto ?? ''),
      clues: String(option.clues ?? ''),
      institucion: String(option.institucion ?? ''),
      latitud: Number(option.latitud),
      longitud: Number(option.longitud),
      estado: String(option.estado ?? ''),
      estatus_revision: String(option.estatus_revision ?? 'Pendiente'),
      fecha_registro: String(option.fecha_registro ?? ''),
      fuente_coordenadas: String(option.fuente_coordenadas ?? ''),
    }));
  await mkdir(path.dirname(parquetPath), { recursive: true });
  await runConverter('write', JSON.stringify(options));
  return options.length;
}

export function proposalsParquetPlugin() {
  return {
    name: 'proposals-parquet-local-api',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = new URL(request.url ?? '/', 'http://localhost');
        if (!['/api/proposals', '/api/proposals/refresh', '/api/proposals/admin', '/api/proposals/delete', '/api/proposals/accept'].includes(url.pathname)) {
          next();
          return;
        }

        void (async () => {
          if (request.method === 'GET' && url.pathname === '/api/proposals') {
            const rows = await runConverter('read');
            sendJson(response, 200, JSON.parse(rows || '[]'));
            return;
          }

          if (request.method === 'POST' && url.pathname === '/api/proposals') {
            const body = await readRequestBody(request);
            const payload = JSON.parse(body);
            const sheetResponse = await fetch(spreadsheetApi, {
              method: 'POST',
              headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
              body: JSON.stringify(payload),
              redirect: 'follow',
            });
            const result = await sheetResponse.json();
            if (!sheetResponse.ok || !result.ok) {
              sendJson(response, 400, { ok: false, error: result.error || `Apps Script respondió HTTP ${sheetResponse.status}.` });
              return;
            }
            sendJson(response, 201, result);
            return;
          }

          if (request.method === 'POST' && ['/api/proposals/admin', '/api/proposals/delete', '/api/proposals/accept'].includes(url.pathname)) {
            const payload = JSON.parse(await readRequestBody(request));
            const action = url.pathname.endsWith('/delete')
              ? 'delete'
              : url.pathname.endsWith('/accept') ? 'accept' : 'verify-admin';
            const sheetResponse = await fetch(spreadsheetApi, {
              method: 'POST',
              headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
              body: JSON.stringify({ action, id: payload.id, password: payload.password }),
              redirect: 'follow',
            });
            const result = await sheetResponse.json();
            if (!sheetResponse.ok || !result.ok) {
              sendJson(response, 403, { ok: false, error: result.error || 'No se autorizó la operación.' });
              return;
            }
            if (action === 'delete' || action === 'accept') {
              const count = await syncSheetToParquet();
              sendJson(response, 200, { ok: true, id: result.id, status: result.estatus_revision, count });
            } else {
              sendJson(response, 200, { ok: true });
            }
            return;
          }

          if (request.method === 'POST' && url.pathname === '/api/proposals/refresh') {
            const count = await syncSheetToParquet();
            sendJson(response, 200, { ok: true, count, file: 'base/nuevos_sus.parquet' });
            return;
          }

          response.setHeader('Allow', request.method === 'GET' ? 'GET' : 'POST');
          sendJson(response, 405, { ok: false, error: 'Método no permitido.' });
        })().catch((error) => {
          sendJson(response, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
        });
      });
    },
  };
}