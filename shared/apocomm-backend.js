// Thin GET-only client for the shared Google Sheets Apps Script backend.
// Every action is a GET request with query params (see apocomm-config.js
// for the URL/key); write operations (registerClient, saveIntake) pass
// their payload as a URL-encoded JSON array in a `data` param, same as
// reads — there is no POST in this API.
//
// IMPORTANT — response-shape assumption: this environment's outbound
// network policy blocks script.google.com, so this module could not be
// exercised against the real deployed backend while writing it. It is
// written defensively against the shapes the API description implies
// ("returns the full 36-value row" -> a bare JSON array; "returns
// matching clients" -> a JSON array of such rows/objects), tolerating a
// few reasonable variations. If the live backend's actual response shape
// differs, the fix belongs in `asRow`/`asList`/`looksEmpty` below — every
// caller in apocomm-common.js consumes normalized {ok, ...} results and
// shouldn't need to change.
//
// `ok: false` means a genuine transport failure (network error, non-2xx
// HTTP, unparseable body) — callers treat this as "could not reach the
// shared database" and fall back to the local cache. `ok: true` with an
// empty/null payload means the backend was reached but has no such
// record (e.g. an unregistered ClientID) — callers must NOT show a
// connectivity warning for that case, since nothing is actually broken.
(function (global) {
  "use strict";

  var ApoComm = global.ApoComm = global.ApoComm || {};
  var Backend = ApoComm.Backend = ApoComm.Backend || {};

  var TIMEOUT_MS = 10000;

  function buildUrl(params) {
    var url = ApoComm.CONFIG.WEB_APP_URL + "?key=" + encodeURIComponent(ApoComm.CONFIG.API_KEY);
    Object.keys(params).forEach(function (k) {
      url += "&" + encodeURIComponent(k) + "=" + encodeURIComponent(params[k]);
    });
    return url;
  }

  // Resolves to the parsed JSON body on any reachable HTTP 200 response
  // (even one representing a logical "not found"/error from the script);
  // rejects only on real transport failure — network error, timeout,
  // non-2xx status, or a body that isn't valid JSON.
  function call(params) {
    var url = buildUrl(params);
    var hasAbort = typeof AbortController !== "undefined";
    var controller = hasAbort ? new AbortController() : null;
    var timer = hasAbort ? setTimeout(function () { controller.abort(); }, TIMEOUT_MS) : null;
    return fetch(url, controller ? { signal: controller.signal } : {})
      .then(function (res) {
        if (timer) clearTimeout(timer);
        if (!res.ok) throw new Error("Backend responded with HTTP " + res.status);
        return res.json();
      })
      .catch(function (err) {
        if (timer) clearTimeout(timer);
        throw err;
      });
  }

  // A "row-shaped" single result: a bare array (the literal spec'd shape),
  // or one wrapped in a common envelope key.
  function asRow(value) {
    if (Array.isArray(value)) return value;
    if (value && Array.isArray(value.row)) return value.row;
    if (value && Array.isArray(value.data)) return value.data;
    return null;
  }

  // A "list-shaped" result: a bare array of entries, or one wrapped in a
  // common envelope key.
  function asList(value) {
    if (Array.isArray(value)) return value;
    if (value && Array.isArray(value.results)) return value.results;
    if (value && Array.isArray(value.clients)) return value.clients;
    if (value && Array.isArray(value.months)) return value.months;
    if (value && Array.isArray(value.data)) return value.data;
    return [];
  }

  // True for the shapes a reachable-but-empty/not-found response is
  // likely to take: null, undefined, {}, [], or an object carrying an
  // `.error`/`.found === false` flag. Distinguishing this from a genuine
  // transport failure is what lets callers skip the "could not reach the
  // shared database" warning for a simple "no such record" answer.
  function looksEmpty(value) {
    if (value == null) return true;
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === "object") {
      if (value.error || value.found === false || value.success === false) return true;
      return Object.keys(value).length === 0;
    }
    return false;
  }

  // Normalizes one search-result entry into regFields, tolerating either
  // a full 36-value row or a lighter object carrying at least the fields
  // needed to build a client-search label (clientId/firstName/lastName/
  // country under a few common key-name variants).
  function entryToRegFields(entry) {
    var row = asRow(entry);
    if (row) return ApoComm.backendRowToRegFields(row);
    if (entry && typeof entry === "object") {
      var fields = {};
      ApoComm.REG_COLUMNS.forEach(function (c) { fields[c] = ""; });
      fields.ClientID = entry.clientId || entry.ClientID || "";
      fields.FirstName = entry.firstName || entry.FirstName || "";
      fields.LastName = entry.lastName || entry.LastName || "";
      fields.CountryOfService = entry.country || entry.CountryOfService || "";
      return fields.ClientID ? fields : null;
    }
    return null;
  }

  Backend.searchByName = function (query) {
    return call({ action: "searchByName", query: query }).then(function (json) {
      if (looksEmpty(json)) return { ok: true, clients: [] };
      var clients = asList(json).map(entryToRegFields).filter(Boolean);
      return { ok: true, clients: clients };
    }).catch(function (err) {
      return { ok: false, error: err.message, clients: [] };
    });
  };

  Backend.getClient = function (clientId) {
    return call({ action: "getClient", clientId: clientId }).then(function (json) {
      if (looksEmpty(json)) return { ok: true, fields: null };
      var row = asRow(json);
      if (!row) return { ok: true, fields: null };
      return { ok: true, fields: ApoComm.backendRowToRegFields(row) };
    }).catch(function (err) {
      return { ok: false, error: err.message, fields: null };
    });
  };

  Backend.registerClient = function (regFields) {
    var row = ApoComm.regFieldsToBackendRow(regFields);
    return call({ action: "registerClient", data: JSON.stringify(row) }).then(function (json) {
      if (json && typeof json === "object" && (json.error || json.success === false)) {
        throw new Error(json.error || "Backend reported failure");
      }
      return { ok: true };
    }).catch(function (err) {
      return { ok: false, error: err.message };
    });
  };

  Backend.getIntake = function (clientId, month) {
    return call({ action: "getIntake", clientId: clientId, month: month }).then(function (json) {
      if (looksEmpty(json)) return { ok: true, fields: null };
      var row = asRow(json);
      if (!row) return { ok: true, fields: null };
      return { ok: true, fields: ApoComm.backendRowToIntakeFields(row) };
    }).catch(function (err) {
      return { ok: false, error: err.message, fields: null };
    });
  };

  Backend.saveIntake = function (intakeFields) {
    var row = ApoComm.intakeFieldsToBackendRow(intakeFields);
    return call({ action: "saveIntake", data: JSON.stringify(row) }).then(function (json) {
      if (json && typeof json === "object" && (json.error || json.success === false)) {
        throw new Error(json.error || "Backend reported failure");
      }
      return { ok: true };
    }).catch(function (err) {
      return { ok: false, error: err.message };
    });
  };

  Backend.listIntakeMonths = function (clientId) {
    return call({ action: "listIntakeMonths", clientId: clientId }).then(function (json) {
      if (looksEmpty(json)) return { ok: true, months: [] };
      var months = asList(json).map(function (m) {
        return typeof m === "string" ? m : (m && (m.month || m.Month)) || "";
      }).filter(Boolean);
      return { ok: true, months: months };
    }).catch(function (err) {
      return { ok: false, error: err.message, months: [] };
    });
  };
})(window);
