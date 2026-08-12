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
// differs, the fix belongs in `asRow`/`asList`/`looksEmpty`/
// `extractClientId` below — every caller in apocomm-common.js consumes
// normalized {ok, ...} results and shouldn't need to change.
//
// ClientID allocation is server-side now: registerClient sends the row
// with an empty ClientID placeholder and expects the response to carry
// back the real, assigned ID (see `extractClientId`) — the client no
// longer generates its own ID for a successful registration.
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

  // Shows only the first 4 characters + a length count — enough to catch
  // a copy-paste mismatch (wrong key entirely, truncated key, stray
  // leading/trailing whitespace changing the length) against the API_KEY
  // script property, without printing the full key to the console.
  function maskKey(key) {
    if (!key) return "(empty)";
    return JSON.stringify(key.slice(0, 4)) + "... (" + key.length + " chars total)";
  }

  // Resolves to the parsed JSON body on any reachable HTTP 200 response
  // (even one representing a logical "not found"/error from the script);
  // rejects on real transport failure — network error, timeout, non-2xx
  // status, or a body that isn't valid JSON. Every call logs its request
  // (action + masked key) and the full raw response (HTTP status + raw
  // body text) to the console, specifically so a backend failure that
  // would otherwise be swallowed into "just show the fallback warning"
  // is visible and diagnosable — including the case Apps Script Web Apps
  // are notorious for: HTTP 200 with a JSON `{"error": "..."}` body,
  // which reads as a technical success but is a logical failure. That
  // check happens per-action below (registerClient/saveIntake always
  // treat a `.error` field as failure; read actions may legitimately
  // return `.error` to mean "no such record", not "something's broken" —
  // either way it's logged here so it's visible regardless.
  function call(params) {
    var url = buildUrl(params);
    var hasAbort = typeof AbortController !== "undefined";
    var controller = hasAbort ? new AbortController() : null;
    var timer = hasAbort ? setTimeout(function () { controller.abort(); }, TIMEOUT_MS) : null;

    console.log("[ApoComm.Backend] → " + params.action, "key=" + maskKey(ApoComm.CONFIG.API_KEY), "params=", params);

    return fetch(url, controller ? { signal: controller.signal } : {})
      .then(function (res) {
        if (timer) clearTimeout(timer);
        return res.text().then(function (text) {
          console.log("[ApoComm.Backend] ← " + params.action, "HTTP " + res.status, "raw response:", text);
          if (!res.ok) throw new Error("Backend responded with HTTP " + res.status + ": " + text);
          var json = null;
          if (text) {
            try {
              json = JSON.parse(text);
            } catch (parseErr) {
              throw new Error("Backend response was not valid JSON (" + parseErr.message + "): " + text.slice(0, 300));
            }
          }
          if (json && typeof json === "object" && json.error) {
            console.warn("[ApoComm.Backend] " + params.action, "response body contains an error field:", json.error);
          }
          return json;
        });
      })
      .catch(function (err) {
        if (timer) clearTimeout(timer);
        console.error("[ApoComm.Backend] " + params.action, "call failed:", err.message);
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
    if (value && Array.isArray(value.photos)) return value.photos;
    if (value && Array.isArray(value.data)) return value.data;
    return [];
  }

  // Normalizes one listPhotos entry into { viewUrl, id, name }, tolerating
  // a bare URL string or an object under a few common Drive-API-flavored
  // key names (viewUrl/url/link/webViewLink for the URL itself). An entry
  // with no extractable URL is dropped rather than shown as a broken
  // thumbnail.
  function entryToPhoto(entry) {
    if (typeof entry === "string") {
      var url = entry.trim();
      return url ? { viewUrl: url, id: url, name: "" } : null;
    }
    if (entry && typeof entry === "object") {
      var viewUrl = entry.viewUrl || entry.url || entry.link || entry.webViewLink || "";
      if (!viewUrl) return null;
      return {
        viewUrl: viewUrl,
        id: entry.id || entry.fileId || viewUrl,
        name: entry.name || entry.fileName || ""
      };
    }
    return null;
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

  // ClientID allocation is the backend's job now, not the client's: the
  // row is sent with an empty ClientID placeholder (regFields.ClientID is
  // ignored/overwritten server-side) and the response is expected to carry
  // back the real, assigned ID — as a bare string, the echoed row (ID in
  // the first slot), or an object under a clientId/ClientID/id key. A
  // response with no extractable ID is treated as a failure, since the
  // caller has nothing usable to save under.
  function extractClientId(json) {
    if (typeof json === "string") return json.trim() || null;
    if (Array.isArray(json)) return (json[0] && String(json[0]).trim()) || null;
    if (json && typeof json === "object") {
      var id = json.clientId || json.ClientID || json.id || json.ID;
      return id ? String(id).trim() : null;
    }
    return null;
  }

  Backend.registerClient = function (regFields) {
    var placeholderRow = ApoComm.regFieldsToBackendRow(Object.assign({}, regFields, { ClientID: "" }));
    return call({ action: "registerClient", data: JSON.stringify(placeholderRow) }).then(function (json) {
      // A write action has no legitimate "not found" reading of `.error`
      // the way a lookup does — any error field here is a real failure,
      // full stop, regardless of the (still HTTP 200) response status.
      if (json && typeof json === "object" && (json.error || json.success === false)) {
        throw new Error(json.error || "Backend reported failure (success: false)");
      }
      var clientId = extractClientId(json);
      if (!clientId) throw new Error("Backend did not return an assigned ClientID — raw response logged above");
      return { ok: true, clientId: clientId };
    }).catch(function (err) {
      return { ok: false, error: err.message, clientId: null };
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

  // Lists the photos in a client's Drive folder (set up manually per
  // client — there's no upload pipeline in this codebase). Reachable-but-
  // empty (no photos yet, or folder not yet created) resolves ok:true with
  // an empty list, same "not broken, just nothing there" convention as
  // every other read action.
  Backend.listPhotos = function (clientId) {
    return call({ action: "listPhotos", clientId: clientId }).then(function (json) {
      if (looksEmpty(json)) return { ok: true, photos: [] };
      var photos = asList(json).map(entryToPhoto).filter(Boolean);
      return { ok: true, photos: photos };
    }).catch(function (err) {
      return { ok: false, error: err.message, photos: [] };
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
