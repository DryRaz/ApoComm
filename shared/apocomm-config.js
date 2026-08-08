// Single shared source of truth for the Google Sheets backend connection —
// every tool that talks to the backend (registration, site generator,
// newsletter, Instagram calendar, newsletter intake) loads this one file
// instead of hardcoding the URL/key per tool. Load before apocomm-backend.js.
(function (global) {
  "use strict";

  var ApoComm = global.ApoComm = global.ApoComm || {};

  ApoComm.CONFIG = {
    WEB_APP_URL: "https://script.google.com/macros/s/AKfycbzAsVUJBTQ6XavnUiyHpTnaEHhCi9hzv9XS1wIJCbx5CpznbJ0nyfRBJ6REJcdcVJ14ug/exec",
    API_KEY: "vowrtgianqtppjvw4598fnjnpwetouixxxfg"
  };
})(window);
