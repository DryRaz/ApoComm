(function () {
  "use strict";

  var REG_COLUMNS = ApoComm.REG_COLUMNS;
  var INTAKE_COLUMNS = ApoComm.INTAKE_COLUMNS;

  var regInput = document.getElementById("reg-input");
  var intakeInput = document.getElementById("intake-input");
  var clientSearch = document.getElementById("client-search");
  var clientResults = document.getElementById("client-results");
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

  // ---- shared client/month storage (same convention across all 4 tools) ----

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

  function refreshMonthSelect() {
    var clientId = currentClientIdFromRegInput();
    var months = clientId ? ApoComm.listSavedMonths(clientId) : [];
    populateSelect(monthSelect, months, "-- Paste manually, or pick a saved month --");
  }

  var clientMap = {};
  var activeResultIndex = -1;

  function renderClientResults(query) {
    var all = ApoComm.listSavedClients();
    clientMap = {};
    all.forEach(function (c) { clientMap[c.clientId] = c; });

    var q = query.trim().toLowerCase();
    var matches = !q ? all : all.filter(function (c) {
      return c.firstName.toLowerCase().indexOf(q) !== -1 ||
        c.lastName.toLowerCase().indexOf(q) !== -1 ||
        c._name.toLowerCase().indexOf(q) !== -1;
    });

    activeResultIndex = -1;
    clientResults.innerHTML = "";

    if (all.length === 0) {
      clientResults.innerHTML = '<li class="client-results-empty">No saved clients on this browser — paste the registration TSV row below instead.</li>';
      clientResults.hidden = false;
      return;
    }
    if (matches.length === 0) {
      clientResults.innerHTML = '<li class="client-results-empty">No match — paste the registration TSV row below instead.</li>';
      clientResults.hidden = false;
      return;
    }
    matches.forEach(function (c) {
      var li = document.createElement("li");
      li.textContent = c.label;
      li.setAttribute("role", "option");
      li.dataset.clientId = c.clientId;
      clientResults.appendChild(li);
    });
    clientResults.hidden = false;
  }

  function selectClient(clientId) {
    var client = clientMap[clientId];
    if (!client) return;
    regInput.value = client.raw;
    clientSearch.value = client.label;
    clientResults.hidden = true;
    refreshMonthSelect();
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
    var saved = localStorage.getItem("apocomm_client_" + clientId + "_intake_" + monthSelect.value);
    if (saved) intakeInput.value = saved;
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

    ApoComm.saveIntakeRow(intakeFields);
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
