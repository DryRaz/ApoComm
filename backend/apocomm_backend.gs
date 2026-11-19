/**
 * Apostello Comm — Web App backend
 *
 * Bridges the static GitHub Pages tools to the live Google Sheet,
 * replacing localStorage as the shared, cross-device source of truth.
 *
 * THIS FILE IS THE REFERENCE COPY, kept in the repo so the backend is
 * version-controlled like everything else. It is NOT deployed from here:
 * paste it into the Apps Script project bound to
 * "Apostello_Comm_Base_Missionnaires" (Extensions > Apps Script), replacing
 * the file of the same name. It contains no credentials — API_KEY lives in
 * Script Properties and is read at runtime, so rotating the key never
 * requires touching this code or redeploying.
 *
 * SETUP (unchanged):
 *   Project Settings (gear) > Script Properties > API_KEY = a long random
 *   string. Deploy > Manage deployments > edit the existing deployment >
 *   Version: New version. Execute as: Me. Who has access: Anyone.
 *
 * SECURITY REALITY, stated plainly:
 *   "Anyone with the link" is required for static pages to reach this
 *   script — Apps Script has no real user-auth option for this setup. The
 *   API_KEY is served to every browser that opens any of the tools, so it
 *   is NOT a secret: it raises the cost of casual scraping and stops
 *   nobody who looks. doGet(e) receives no HTTP headers at all (no Origin,
 *   no Referer), so this script cannot check where a request came from.
 *   What it CAN do, and now does, is limit the blast radius: refuse a
 *   blank search, cap how much one call returns, rate-limit per minute,
 *   and log what happened. Anything stronger needs a proxy that does see
 *   headers (a Cloudflare Worker holding the key) in front of this Web App.
 *
 * WHY EVERYTHING GOES THROUGH doGet, INCLUDING WRITES:
 *   Apps Script Web Apps have unreliable CORS preflight handling for POST
 *   with a JSON body from another origin. GET with query parameters for
 *   reads AND writes sidesteps preflight entirely. Not conventional REST,
 *   but the pragmatic fix for this platform combination.
 */

const SHEET_FICHES = 'Fiches';
const SHEET_INTAKES = 'Monthly_Intakes';
const SHEET_JOURNAL = 'Journal_Agent';
const FICHES_DATA_START_ROW = 2; // 0-indexed: row 3 in the sheet (rows 1-2 are headers)

// Fiches columns, 0-indexed, named rather than scattered as magic numbers.
const COL = {
  clientId: 0, onboardingStatus: 1, lastName: 3, firstName: 4, email: 5,
  primaryLanguage: 7, country: 10, securitySensitive: 16,
  securityInstructions: 17, photosLink: 27
};

// searchByName limits. A blank query used to match every row, so three
// characters of URL returned the entire client base — country of service,
// email and WhatsApp number for every missionary, including the ones in
// places where that is dangerous to publish.
const SEARCH_MIN_CHARS = 2;
const SEARCH_MAX_RESULTS = 25;

// Per-minute ceiling across all callers, held in CacheService (cheap,
// in-memory, no Properties quota burned per request). Generous for a
// handful of people using the tools; a scraping loop hits it immediately.
const RATE_LIMIT_PER_MINUTE = 60;

function doGet(e) {
  const params = e.parameter;

  if (params.key !== getApiKey()) {
    journal('', 'DENIED', 'bad key, action=' + (params.action || '(none)'));
    return jsonOutput({ error: 'Invalid API key' });
  }

  if (!underRateLimit()) {
    journal('', 'DENIED', 'rate limit, action=' + (params.action || '(none)'));
    return jsonOutput({ error: 'Rate limit exceeded, try again shortly' });
  }

  try {
    switch (params.action) {
      case 'searchByName':
        return jsonOutput(searchByName(params.query || ''));
      case 'getClient':
        return jsonOutput(getClientRow(params.clientId));
      case 'registerClient':
        return jsonOutput(registerClient(JSON.parse(params.data)));
      case 'getIntake':
        return jsonOutput(getIntake(params.clientId, params.month));
      case 'saveIntake':
        return jsonOutput(saveIntake(JSON.parse(params.data)));
      case 'listIntakeMonths':
        return jsonOutput(listIntakeMonths(params.clientId));
      case 'listPhotos':
        return jsonOutput(listPhotos(params.clientId));
      default:
        return jsonOutput({ error: 'Unknown action: ' + params.action });
    }
  } catch (err) {
    // The raw error can carry row contents and internal paths. Log the
    // detail where only the owner sees it; return something generic.
    journal('', 'ERROR', String(err));
    return jsonOutput({ error: 'Request failed' });
  }
}

function getApiKey() {
  return PropertiesService.getScriptProperties().getProperty('API_KEY');
}

function jsonOutput(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function getFichesSheet() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_FICHES);
}

function getIntakesSheet() {
  let sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_INTAKES);
  if (!sheet) {
    sheet = SpreadsheetApp.getActiveSpreadsheet().insertSheet(SHEET_INTAKES);
    sheet.getRange(1, 1, 1, 11).setValues([[
      'ClientID', 'YearMonth', 'Timestamp', 'IsFirstNewsletter', 'Events',
      'MeetingsSummary', 'PrayerNeeds', 'UpcomingProjects', 'NumbersUpdate',
      'NewPhotoLinks', 'AnythingToAvoid'
    ]]);
  }
  return sheet;
}

/* ---- security flag: fails closed ----------------------------------------
 * This used to be `String(rowValues[16]).toUpperCase() === 'YES'` inline,
 * which treated every value it did not recognise as "not sensitive". A
 * blank cell, or "OUI" typed into a sheet whose headers were French until
 * recently, both produced isSensitive = false — and the consequence here is
 * not a cosmetic one: createMissionaryPhotoFolder() then shares that
 * missionary's photo folder with ANYONE_WITH_LINK.
 *
 * Only an explicit, recognised "no" now clears a profile. Everything else,
 * blank included, is treated as sensitive. This mirrors
 * ApoComm.isSecuritySensitive() in shared/apocomm-common.js — the two must
 * agree, or the frontend will block generation for a client whose photos
 * the backend has already made public.
 */
const NOT_SENSITIVE_VALUES = ['NO', 'N', 'NON', 'FALSE', '0'];

function isSecuritySensitive(raw) {
  const v = String(raw == null ? '' : raw).trim().toUpperCase();
  return NOT_SENSITIVE_VALUES.indexOf(v) === -1;
}

/* ---- rate limiting ------------------------------------------------------ */

function underRateLimit() {
  const cache = CacheService.getScriptCache();
  const bucket = 'rl_' + Math.floor(Date.now() / 60000);
  const current = parseInt(cache.get(bucket) || '0', 10);
  if (current >= RATE_LIMIT_PER_MINUTE) return false;
  cache.put(bucket, String(current + 1), 120);
  return true;
}

/* ---- journal ------------------------------------------------------------
 * Writes land in Journal_Agent so abuse is visible rather than silent.
 * Reads are deliberately not logged one by one — that would be a sheet
 * write per request. Denials, writes and errors are.
 */
function journal(clientId, action, detail) {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_JOURNAL);
    if (!sheet) return;
    sheet.appendRow([new Date(), clientId || '', 'web-app', action, detail || '', '', '', '']);
  } catch (e) {
    // Logging must never break a request.
  }
}

/* ---- reads -------------------------------------------------------------- */

function searchByName(query) {
  const q = String(query || '').trim().toLowerCase();

  // A blank or one-character query used to match everyone. Refuse it, and
  // say so, rather than returning the whole base.
  if (q.length < SEARCH_MIN_CHARS) {
    return {
      results: [],
      error: 'Type at least ' + SEARCH_MIN_CHARS + ' characters to search'
    };
  }

  const sheet = getFichesSheet();
  const data = sheet.getDataRange().getValues();
  const results = [];
  let truncated = false;

  for (let i = FICHES_DATA_START_ROW; i < data.length; i++) {
    const row = data[i];
    const clientId = row[COL.clientId];
    if (!clientId) continue;

    const fullName = (String(row[COL.firstName] || '') + ' ' +
                      String(row[COL.lastName] || '')).toLowerCase();
    if (fullName.indexOf(q) === -1) continue;

    if (results.length >= SEARCH_MAX_RESULTS) { truncated = true; break; }

    results.push({
      clientId: clientId,
      firstName: row[COL.firstName],
      lastName: row[COL.lastName],
      country: row[COL.country]
    });
  }

  return { results: results, truncated: truncated };
}

function getClientRow(clientId) {
  if (!clientId) return { error: 'Client not found' };
  const sheet = getFichesSheet();
  const data = sheet.getDataRange().getValues();
  for (let i = FICHES_DATA_START_ROW; i < data.length; i++) {
    if (data[i][COL.clientId] === clientId) {
      return { row: data[i] };
    }
  }
  return { error: 'Client not found' };
}

function listPhotos(clientId) {
  if (!clientId) return { photos: [] };
  const parent = getOrCreatePhotosParentFolder();
  const subfolders = parent.getFolders();
  let targetFolder = null;
  while (subfolders.hasNext()) {
    const f = subfolders.next();
    if (f.getName().indexOf(clientId + ' —') === 0) { targetFolder = f; break; }
  }
  if (!targetFolder) return { photos: [] };

  const files = targetFolder.getFiles();
  const photos = [];
  while (files.hasNext()) {
    const file = files.next();
    if (file.getMimeType().indexOf('image/') === 0) {
      photos.push({
        fileId: file.getId(),
        name: file.getName(),
        viewUrl: 'https://drive.google.com/uc?export=view&id=' + file.getId(),
        lastUpdated: file.getLastUpdated()
      });
    }
  }
  photos.sort(function (a, b) { return b.lastUpdated - a.lastUpdated; });
  return { photos: photos };
}

/* ---- photo folders ------------------------------------------------------ */

const PHOTOS_PARENT_FOLDER_NAME = 'Apostello Comm — Missionary Photos';

function getOrCreatePhotosParentFolder() {
  const folders = DriveApp.getFoldersByName(PHOTOS_PARENT_FOLDER_NAME);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(PHOTOS_PARENT_FOLDER_NAME);
}

function createMissionaryPhotoFolder(clientId, firstName, lastName, email, sensitive) {
  const parent = getOrCreatePhotosParentFolder();
  const folder = parent.createFolder(clientId + ' — ' + firstName + ' ' + lastName);

  // Share with the missionary as editor so they can upload their own
  // photos. Fails silently if the address is not a Google account — the
  // folder still exists and can be shared by hand.
  try {
    folder.addEditor(email);
  } catch (e) {
    // non-fatal
  }

  if (!sensitive) {
    // Link-viewable, which is what makes the images load on the public
    // site. Reached only for an explicit, recognised "no" (see
    // isSecuritySensitive) — never for a blank or unrecognised flag.
    folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  }
  // Sensitive, blank or unreadable: the folder stays owner/editor-only. A
  // team member reviews and publishes individual photos by hand, in step
  // with Security_Instructions — never all at once, never automatically.

  return folder.getUrl();
}

/* ---- writes ------------------------------------------------------------- */

function registerClient(rowValues) {
  // rowValues: 36 values, exact Fiches column order. rowValues[0]
  // (ClientID) is ignored and overwritten — the ID must be assigned
  // centrally, under a lock, so two browsers cannot produce the same one.
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = getFichesSheet();
    const newId = generateNextClientId(sheet);
    rowValues[COL.clientId] = newId;

    const lastName = rowValues[COL.lastName];
    const firstName = rowValues[COL.firstName];
    const email = rowValues[COL.email];
    const sensitive = isSecuritySensitive(rowValues[COL.securitySensitive]);

    const folderUrl = createMissionaryPhotoFolder(newId, firstName, lastName, email, sensitive);
    rowValues[COL.photosLink] = folderUrl;

    const targetRow = findFirstEmptyRow(sheet);
    sheet.getRange(targetRow, 1, 1, rowValues.length).setValues([rowValues]);

    journal(newId, 'registerClient',
      'row written; photo folder ' + (sensitive ? 'PRIVATE (sensitive or unreadable flag)' : 'link-viewable'));

    return { success: true, clientId: newId, photoFolderUrl: folderUrl };
  } finally {
    lock.releaseLock();
  }
}

function findFirstEmptyRow(sheet) {
  const startRow = FICHES_DATA_START_ROW + 1; // 1-indexed: row 3
  const lastRow = Math.max(sheet.getLastRow(), startRow);
  const numRows = lastRow - startRow + 1;
  const colA = sheet.getRange(startRow, 1, numRows, 1).getValues();
  for (let i = 0; i < colA.length; i++) {
    if (!colA[i][0]) return startRow + i;
  }
  return lastRow + 1;
}

function generateNextClientId(sheet) {
  const year = new Date().getFullYear();
  const prefix = 'APC-' + year + '-';
  const data = sheet.getDataRange().getValues();
  let maxSeq = 0;
  for (let i = FICHES_DATA_START_ROW; i < data.length; i++) {
    const id = String(data[i][COL.clientId] || '');
    if (id.indexOf(prefix) === 0) {
      const seq = parseInt(id.substring(prefix.length), 10);
      if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
    }
  }
  return prefix + ('000' + (maxSeq + 1)).slice(-3);
}

/* ---- intakes ------------------------------------------------------------ */

function getIntake(clientId, month) {
  const sheet = getIntakesSheet();
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === clientId && data[i][1] === month) {
      return { row: data[i] };
    }
  }
  return { error: 'Intake not found' };
}

function saveIntake(rowValues) {
  // rowValues: [ClientID, YearMonth, Timestamp, IsFirstNewsletter, Events,
  // MeetingsSummary, PrayerNeeds, UpcomingProjects, NumbersUpdate,
  // NewPhotoLinks, AnythingToAvoid] — 11 values, this exact order. The
  // frontend's ApoComm.BACKEND_INTAKE_COLUMNS must match it position for
  // position; it did not until 2026-11-19, which shifted every value from
  // column C onward one cell to the left.
  const sheet = getIntakesSheet();
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === rowValues[0] && data[i][1] === rowValues[1]) {
      sheet.getRange(i + 1, 1, 1, rowValues.length).setValues([rowValues]);
      journal(rowValues[0], 'saveIntake', 'updated ' + rowValues[1]);
      return { success: true, updated: true };
    }
  }
  sheet.appendRow(rowValues);
  journal(rowValues[0], 'saveIntake', 'appended ' + rowValues[1]);
  return { success: true, updated: false };
}

function listIntakeMonths(clientId) {
  const sheet = getIntakesSheet();
  const data = sheet.getDataRange().getValues();
  const months = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === clientId) months.push(data[i][1]);
  }
  return { months: months };
}
