// Single shared source of truth for the Google Sheets backend connection —
// every tool that talks to the backend (registration, site generator,
// newsletter, Instagram calendar, newsletter intake) loads this one file
// instead of hardcoding the URL/key per tool. Load before apocomm-backend.js.
//
// THIS FILE IS PUBLIC. GitHub Pages serves it to any browser that opens any
// of the five tools, so API_KEY is readable by anyone with the URL — it is
// not a secret and must never be treated as one. It only raises the cost of
// casual scraping; it stops nobody who looks.
//
// The real protection has to live in the Apps Script itself, which cannot
// check where a request came from: doGet(e) receives the query string and
// the POST body and no HTTP headers at all, so there is no Origin or
// Referer to verify. What the script CAN do is limit the blast radius —
// reject an empty searchByName query, cap how many rows a search returns,
// keep Security_Instructions out of every response, rate-limit per day, and
// log each call. Anything stronger needs a proxy that does see headers
// (a Cloudflare Worker holding the key) in front of the Web App, which also
// removes the key from the browser entirely.
//
// Rotating this value means changing it in two places at once: here, and
// the matching constant in the Apps Script. The site is broken in between.
(function (global) {
  "use strict";

  var ApoComm = global.ApoComm = global.ApoComm || {};

  ApoComm.CONFIG = {
    WEB_APP_URL: "https://script.google.com/macros/s/AKfycbzAsVUJBTQ6XavnUiyHpTnaEHhCi9hzv9XS1wIJCbx5CpznbJ0nyfRBJ6REJcdcVJ14ug/exec",
    // Rotated 2026-11-19. The previous value stays in this repo's git
    // history forever, which is fine only because the Apps Script no
    // longer accepts it — rotation is what retires a key, not deletion.
    API_KEY: "qdfnkwqbatem4fqu1wdjvmuj27986hqtzr70afs5"
  };
})(window);
