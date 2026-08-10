(function () {
  "use strict";

  var REG_COLUMNS = ApoComm.REG_COLUMNS;
  var INTAKE_COLUMNS = ApoComm.INTAKE_COLUMNS;

  var regInput = document.getElementById("reg-input");
  var intakeInput = document.getElementById("intake-input");
  var clientSearch = document.getElementById("client-search");
  var clientResults = document.getElementById("client-results");
  var backendWarning = document.getElementById("backend-warning");
  var photoPicker = document.getElementById("photo-picker");
  var photoGrid = document.getElementById("photo-grid");
  var photoEmpty = document.getElementById("photo-empty");
  var monthSelect = document.getElementById("month-select");
  var parseError = document.getElementById("parse-error");
  var generateBtn = document.getElementById("generate-btn");
  var mismatchWarning = document.getElementById("mismatch-warning");
  var blockedMessage = document.getElementById("blocked-message");
  var securityDecision = document.getElementById("security-decision");
  var successPanel = document.getElementById("success-panel");
  var calendarView = document.getElementById("calendar-view");
  var calendarOutput = document.getElementById("calendar-output");
  var copyBtn = document.getElementById("copy-btn");
  var actionStatus = document.getElementById("action-status");

  // ---- shared client/month storage (backend-first, same convention
  // across all 4 tools) — searchByName/getClient against the shared
  // backend first, falling back to the localStorage cache only if those
  // calls fail or return nothing; likewise listIntakeMonths/getIntake
  // for the "load a past month" select. ---------------------------------

  function showBackendWarning(warning) {
    if (warning) {
      backendWarning.textContent = warning;
      backendWarning.hidden = false;
    } else {
      backendWarning.hidden = true;
    }
  }

  function currentClientIdFromRegInput() {
    return (regInput.value.split("\t")[0] || "").trim();
  }

  function populateSelect(select, options, placeholder) {
    var current = select.value;
    select.innerHTML = "";
    var placeholderOpt = document.createElement("option");
    placeholderOpt.value = "";
    placeholderOpt.textContent = placeholder;
    select.appendChild(placeholderOpt);
    options.forEach(function (value) {
      var opt = document.createElement("option");
      opt.value = value;
      opt.textContent = value;
      select.appendChild(opt);
    });
    if (options.indexOf(current) !== -1) select.value = current;
  }

  var monthToken = 0;

  function refreshMonthSelect() {
    var clientId = currentClientIdFromRegInput();
    if (!clientId) {
      populateSelect(monthSelect, [], "-- Paste manually, or pick a saved month --");
      return;
    }
    var token = ++monthToken;
    ApoComm.fetchIntakeMonths(clientId).then(function (result) {
      if (token !== monthToken) return; // superseded by a newer client selection
      showBackendWarning(result.warning);
      populateSelect(monthSelect, result.months, "-- Paste manually, or pick a saved month --");
    });
  }

  var clientMap = {};
  var activeResultIndex = -1;
  var searchToken = 0;

  // ---- photo picker: fetched via listPhotos once a client is selected
  // through the name search. Checked photos' viewUrls are written,
  // comma-separated, into the NewPhotoLinks column of the intake TSV
  // textarea below — the same field a manually-pasted/typed row already
  // uses, so nothing about the 10-column shape changes, just how that one
  // cell gets filled in. ---------------------------------------------

  var currentRegFields = null;
  var photoToken = 0;
  var selectedPhotoUrls = [];
  var NEW_PHOTO_LINKS_INDEX = INTAKE_COLUMNS.indexOf("NewPhotoLinks");

  function isSecuritySensitive(fields) {
    return !!fields && fields.SecuritySensitive.trim().toUpperCase() === "YES";
  }

  function applySelectedPhotosToIntake() {
    var cols = intakeInput.value.split("\t");
    while (cols.length < INTAKE_COLUMNS.length) cols.push("");
    if (cols.length > INTAKE_COLUMNS.length) cols = cols.slice(0, INTAKE_COLUMNS.length);
    if (!cols[0]) cols[0] = currentClientIdFromRegInput();
    cols[NEW_PHOTO_LINKS_INDEX] = selectedPhotoUrls.join(", ");
    intakeInput.value = cols.join("\t");
  }

  function renderPhotos(photos, sensitive) {
    photoGrid.innerHTML = "";
    selectedPhotoUrls = [];
    photoPicker.hidden = false;

    if (photos.length === 0) {
      photoEmpty.hidden = false;
      return;
    }
    photoEmpty.hidden = true;

    photos.forEach(function (photo) {
      var fig = document.createElement("figure");
      fig.className = "photo-thumb";

      var img = document.createElement("img");
      img.src = photo.viewUrl;
      img.alt = photo.name || "";
      img.loading = "lazy";
      fig.appendChild(img);

      var controls = document.createElement("div");
      controls.className = "photo-thumb-controls";

      var label = document.createElement("label");
      var checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.addEventListener("change", function () {
        var idx = selectedPhotoUrls.indexOf(photo.viewUrl);
        if (checkbox.checked && idx === -1) selectedPhotoUrls.push(photo.viewUrl);
        else if (!checkbox.checked && idx !== -1) selectedPhotoUrls.splice(idx, 1);
        applySelectedPhotosToIntake();
      });
      label.appendChild(checkbox);
      label.appendChild(document.createTextNode("Use this month"));
      controls.appendChild(label);

      if (sensitive) {
        var note = document.createElement("span");
        note.className = "photo-thumb-sensitive";
        note.textContent = "Confirm this is cleared for public use";
        controls.appendChild(note);
      }

      fig.appendChild(controls);
      photoGrid.appendChild(fig);
    });
  }

  function loadPhotos(clientId) {
    var token = ++photoToken;
    ApoComm.fetchPhotos(clientId).then(function (result) {
      if (token !== photoToken) return; // superseded by a newer client selection
      if (result.warning) showBackendWarning(result.warning);
      renderPhotos(result.photos, isSecuritySensitive(currentRegFields));
    });
  }

  function renderClientResults(query) {
    var token = ++searchToken;
    clientResults.innerHTML = '<li class="client-results-empty">Searching…</li>';
    clientResults.hidden = false;

    ApoComm.searchClients(query).then(function (result) {
      if (token !== searchToken) return; // a newer search superseded this one

      showBackendWarning(result.warning);

      clientMap = {};
      result.clients.forEach(function (c) { clientMap[c.clientId] = c; });

      activeResultIndex = -1;
      clientResults.innerHTML = "";

      if (result.clients.length === 0) {
        var msg = query.trim()
          ? "No match — paste the registration TSV row below instead."
          : "No saved clients yet — paste the registration TSV row below instead.";
        clientResults.innerHTML = '<li class="client-results-empty">' + msg + "</li>";
        clientResults.hidden = false;
        return;
      }
      result.clients.forEach(function (c) {
        var li = document.createElement("li");
        li.textContent = c.label;
        li.setAttribute("role", "option");
        li.dataset.clientId = c.clientId;
        clientResults.appendChild(li);
      });
      clientResults.hidden = false;
    });
  }

  function selectClient(clientId) {
    var client = clientMap[clientId];
    if (!client) return;
    clientSearch.value = client.label;
    clientResults.hidden = true;
    ApoComm.fetchClientRow(clientId).then(function (result) {
      showBackendWarning(result.warning);
      currentRegFields = result.fields || null;
      regInput.value = result.fields ? ApoComm.regFieldsToBackendRow(result.fields).join("\t") : client.raw;
      refreshMonthSelect();
      loadPhotos(clientId);
    });
  }

  clientSearch.addEventListener("focus", function () { renderClientResults(clientSearch.value); });
  clientSearch.addEventListener("input", function () { renderClientResults(clientSearch.value); });

  clientSearch.addEventListener("keydown", function (e) {
    var options = clientResults.querySelectorAll("li[data-client-id]");
    if (e.key === "Escape") {
      clientResults.hidden = true;
    } else if (e.key === "ArrowDown" && options.length) {
      e.preventDefault();
      activeResultIndex = Math.min(activeResultIndex + 1, options.length - 1);
      options.forEach(function (o, i) { o.classList.toggle("is-active", i === activeResultIndex); });
    } else if (e.key === "ArrowUp" && options.length) {
      e.preventDefault();
      activeResultIndex = Math.max(activeResultIndex - 1, 0);
      options.forEach(function (o, i) { o.classList.toggle("is-active", i === activeResultIndex); });
    } else if (e.key === "Enter" && activeResultIndex >= 0 && options[activeResultIndex]) {
      e.preventDefault();
      selectClient(options[activeResultIndex].dataset.clientId);
    }
  });

  // mousedown (not click) fires before the input's blur hides the list.
  clientResults.addEventListener("mousedown", function (e) {
    var li = e.target.closest("li[data-client-id]");
    if (!li) return;
    selectClient(li.dataset.clientId);
  });

  clientSearch.addEventListener("blur", function () {
    setTimeout(function () { clientResults.hidden = true; }, 150);
  });

  regInput.addEventListener("input", refreshMonthSelect);

  monthSelect.addEventListener("change", function () {
    if (!monthSelect.value) return;
    var clientId = currentClientIdFromRegInput();
    ApoComm.fetchIntakeRow(clientId, monthSelect.value).then(function (result) {
      showBackendWarning(result.warning);
      if (result.fields) intakeInput.value = ApoComm.INTAKE_COLUMNS.map(function (c) { return result.fields[c] || ""; }).join("\t");
    });
  });

  refreshMonthSelect();

  // ---- UI wiring -------------------------------------------------------

  function reset() {
    parseError.textContent = "";
    mismatchWarning.hidden = true;
    blockedMessage.hidden = true;
    securityDecision.hidden = true;
    successPanel.hidden = true;
    actionStatus.textContent = "";
  }

  function showDecision(security, calendar) {
    var lines = ApoComm.Instagram.showDecisionLines(security, calendar);
    securityDecision.innerHTML = lines.join("");
    securityDecision.hidden = false;
  }

  generateBtn.addEventListener("click", function () {
    reset();

    var regFields, intakeFields;
    try {
      regFields = ApoComm.parseRow(regInput.value, REG_COLUMNS, "Registration row");
      intakeFields = ApoComm.parseRow(intakeInput.value, INTAKE_COLUMNS, "Intake row");
    } catch (err) {
      parseError.textContent = err.message;
      return;
    }

    if (regFields.ClientID && intakeFields.ClientID && regFields.ClientID !== intakeFields.ClientID) {
      mismatchWarning.textContent =
        "Warning: ClientID mismatch — registration row is \"" + regFields.ClientID +
        "\", intake row is \"" + intakeFields.ClientID + "\". Double-check you pasted the right pair before sending.";
      mismatchWarning.hidden = false;
    }

    var security = ApoComm.Instagram.evaluateSecurityGate(regFields);

    if (security.blocked) {
      blockedMessage.textContent = security.reason;
      blockedMessage.hidden = false;
      return;
    }

    var calendar;
    try {
      calendar = ApoComm.Instagram.build(regFields, intakeFields, security);
    } catch (err) {
      parseError.textContent = err.message;
      return;
    }

    showDecision(security, calendar);

    calendarView.innerHTML = ApoComm.Instagram.renderHtml(calendar);
    calendarOutput.value = ApoComm.Instagram.renderText(calendar);
    successPanel.hidden = false;

    ApoComm.saveIntakeRemote(intakeFields).then(function (result) {
      showBackendWarning(result.warning);
    });
    refreshMonthSelect();
  });

  copyBtn.addEventListener("click", function () {
    navigator.clipboard.writeText(calendarOutput.value).then(function () {
      actionStatus.textContent = "Copied.";
    }, function () {
      actionStatus.textContent = "Copy failed — select and copy manually.";
    });
  });
})();
