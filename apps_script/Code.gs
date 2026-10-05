const SPREADSHEET_ID = '1KWUPWdcmACXB3zRSfvcjBvDt8tqGusYxCCy2MyoxzTU';
const SHEET_NAME = 'Hoja 1';
const HEADERS = [
  'id',
  'nombre_solicitante',
  'usuario',
  'nombre_punto',
  'clues',
  'institucion',
  'latitud',
  'longitud',
  'estado',
  'estatus_revision',
  'fecha_registro',
  'fuente_coordenadas',
];

function doGet(event) {
  try {
    const callback = event && event.parameter ? event.parameter.callback : '';
    const adminNonce = event && event.parameter ? safeText_(event.parameter.adminNonce, 120) : '';
    if (adminNonce) {
      const cache = CacheService.getScriptCache();
      const cacheKey = 'admin_verify_' + adminNonce;
      const cachedResult = cache.get(cacheKey);
      if (!cachedResult) return output_({ pending: true }, callback);
      cache.remove(cacheKey);
      return output_(JSON.parse(cachedResult), callback);
    }
    return output_({ ok: true, options: readOptions_() }, callback);
  } catch (error) {
    return output_({ ok: false, error: String(error.message || error) });
  }
}

function doPost(event) {
  const lock = LockService.getScriptLock();
  try {
    const payload = JSON.parse(event && event.postData ? event.postData.contents : '{}');
    if (payload.action === 'verify-admin') {
      const nonce = safeText_(payload.nonce, 120);
      if (!nonce) throw new Error('No se recibió el identificador de verificación.');
      const cacheKey = 'admin_verify_' + nonce;
      try {
        assertAdminPassword_(payload.password);
        CacheService.getScriptCache().put(cacheKey, JSON.stringify({ ok: true }), 60);
        return output_({ ok: true });
      } catch (error) {
        CacheService.getScriptCache().put(cacheKey, JSON.stringify({
          ok: false,
          error: String(error.message || error),
        }), 60);
        throw error;
      }
    }
    if (payload.action === 'delete') {
      assertAdminPassword_(payload.password);
      const optionId = safeText_(payload.id, 80);
      if (!optionId) throw new Error('No se recibió el ID del punto.');
      lock.waitLock(10000);
      const sheet = getSheet_();
      const lastRow = sheet.getLastRow();
      if (lastRow < 2) throw new Error('El punto ya no existe.');
      const ids = sheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues();
      const rowIndex = ids.findIndex(function (row) { return row[0] === optionId; });
      if (rowIndex < 0) throw new Error('El punto ya no existe.');
      sheet.deleteRow(rowIndex + 2);
      return output_({ ok: true, id: optionId });
    }
    if (payload.action === 'accept') {
      assertAdminPassword_(payload.password);
      const optionId = safeText_(payload.id, 80);
      if (!optionId) throw new Error('No se recibió el ID del punto.');
      lock.waitLock(10000);
      const sheet = getSheet_();
      const lastRow = sheet.getLastRow();
      if (lastRow < 2) throw new Error('El punto ya no existe.');
      const rows = sheet.getRange(2, 1, lastRow - 1, 6).getDisplayValues();
      const rowIndex = rows.findIndex(function (row) { return row[0] === optionId; });
      if (rowIndex < 0) throw new Error('El punto ya no existe.');
      if (['IMO', 'IMB', 'CSA'].indexOf(rows[rowIndex][5]) < 0) {
        throw new Error('Asigna IMO, IMB o CSA antes de aceptar el punto.');
      }
      sheet.getRange(rowIndex + 2, 10).setValue('Aceptada');
      return output_({ ok: true, id: optionId, estatus_revision: 'Aceptada' });
    }

    const option = payload.option || payload;
    const requesterName = safeText_(option.nombre_solicitante, 120);
    const username = safeText_(option.usuario, 120);
    const pointName = safeText_(option.nombre_punto, 120);
    const clues = safeText_(option.clues, 30);
    const institution = safeText_(option.institucion, 8);
    const state = safeText_(option.estado, 80);
    const source = safeText_(option.fuente_coordenadas || 'Mapa interactivo', 40);
    const latitude = Number(option.latitud);
    const longitude = Number(option.longitud);

    if (!requesterName || !username || !pointName || !state) {
      throw new Error('Completa los datos obligatorios de la propuesta.');
    }
    if (['IMO', 'IMB', 'CSA', 'Sin clasificar'].indexOf(institution) < 0) {
      throw new Error('La institución no es válida.');
    }
    if (!Number.isFinite(latitude) || latitude < 13 || latitude > 34) {
      throw new Error('La latitud debe estar dentro de México.');
    }
    if (!Number.isFinite(longitude) || longitude < -120 || longitude > -85) {
      throw new Error('La longitud debe estar dentro de México.');
    }

    lock.waitLock(10000);
    const sheet = getSheet_();
    const id = Utilities.getUuid();
    const createdAt = new Date();
    sheet.appendRow([
      id,
      requesterName,
      username,
      pointName,
      clues,
      institution,
      latitude,
      longitude,
      state,
      'Pendiente',
      createdAt,
      source,
    ]);

    return output_({ ok: true, option: {
      id: id,
      nombre_solicitante: requesterName,
      usuario: username,
      nombre_punto: pointName,
      clues: clues,
      institucion: institution,
      latitud: latitude,
      longitud: longitude,
      estado: state,
      estatus_revision: 'Pendiente',
      fecha_registro: createdAt.toISOString(),
      fuente_coordenadas: source,
    } });
  } catch (error) {
    return output_({ ok: false, error: String(error.message || error) });
  } finally {
    if (lock.hasLock()) lock.releaseLock();
  }
}

function readOptions_() {
  const sheet = getSheet_();
  const rows = sheet.getDataRange().getValues().slice(1);
  return rows
    .filter(function (row) { return row[0] !== '' && row[9] !== 'No aceptada'; })
    .map(function (row) {
      return {
        id: String(row[0]),
        nombre_solicitante: String(row[1]),
        usuario: String(row[2]),
        nombre_punto: String(row[3]),
        clues: String(row[4]),
        institucion: String(row[5]),
        latitud: Number(row[6]),
        longitud: Number(row[7]),
        estado: String(row[8]),
        estatus_revision: String(row[9]),
        fecha_registro: row[10] instanceof Date ? row[10].toISOString() : String(row[10]),
        fuente_coordenadas: String(row[11]),
      };
    });
}

function getSheet_() {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = spreadsheet.getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error('No existe la pestaña ' + SHEET_NAME + '.');

  const lastColumn = Math.max(sheet.getLastColumn(), HEADERS.length);
  const currentHeaders = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0];
  if (sheet.getLastRow() <= 1 || currentHeaders.every(function (value) { return value === ''; })) {
    sheet.getRange(1, 1, 1, lastColumn).clearContent();
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  } else if (HEADERS.some(function (header, index) { return currentHeaders[index] !== header; })) {
    throw new Error('Los encabezados de la hoja no coinciden con el esquema esperado.');
  }
  return sheet;
}

function output_(payload, callback) {
  const json = JSON.stringify(payload);
  if (callback && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(callback)) {
    return ContentService.createTextOutput(callback + '(' + json + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

function safeText_(value, maxLength) {
  const text = String(value == null ? '' : value).trim().slice(0, maxLength);
  return text && '=+@-'.indexOf(text.charAt(0)) >= 0 ? "'" + text : text;
}

function assertAdminPassword_(providedPassword) {
  const cache = CacheService.getScriptCache();
  const attemptsKey = 'admin_password_failed_attempts';
  const attempts = Number(cache.get(attemptsKey) || 0);
  if (attempts >= 5) throw new Error('Demasiados intentos. Espera 10 minutos antes de volver a intentar.');
  const configuredPassword = PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD');
  if (!configuredPassword) throw new Error('Falta configurar ADMIN_PASSWORD en las propiedades del script.');
  if (String(providedPassword || '') !== configuredPassword) {
    cache.put(attemptsKey, String(attempts + 1), 600);
    throw new Error('Contraseña incorrecta.');
  }
  cache.remove(attemptsKey);
}