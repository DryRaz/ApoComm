(function () {
  "use strict";

  var form = document.getElementById("intake-form");
  var clientSearch = document.getElementById("client-search");
  var clientResults = document.getElementById("client-results");
  var backendWarning = document.getElementById("backend-warning");
  var clientIdInput = document.getElementById("ClientID");
  var resultSection = document.getElementById("result");
  var tsvOutput = document.getElementById("tsv-output");
  var copyBtn = document.getElementById("copy-btn");
  var copyStatus = document.getElementById("copy-status");
  var notFoundMessage = document.getElementById("not-found-message");
  var blockedMessage = document.getElementById("blocked-message");
  var resultsScreen = document.getElementById("results-screen");

  var newsletterSecurityDecision = document.getElementById("newsletter-security-decision");
  var newsletterSubjectOutput = document.getElementById("newsletter-subject-output");
  var newsletterBodyOutput = document.getElementById("newsletter-body-output");
  var copyNewsletterSubjectBtn = document.getElementById("copy-newsletter-subject-btn");
  var copyNewsletterBodyBtn = document.getElementById("copy-newsletter-body-btn");
  var newsletterActionStatus = document.getElementById("newsletter-action-status");

  var instagramSecurityDecision = document.getElementById("instagram-security-decision");
  var instagramError = document.getElementById("instagram-error");
  var instagramView = document.getElementById("instagram-view");
  var instagramOutputField = document.getElementById("instagram-output-field");
  var instagramOutput = document.getElementById("instagram-output");
  var copyInstagramBtn = document.getElementById("copy-instagram-btn");
  var instagramActionStatus = document.getElementById("instagram-action-status");

  var REQUIRED_FIELDS = ["ClientID", "IsFirstNewsletter", "Events"];
  var LIST_FIELDS = ["Events", "PrayerNeeds", "UpcomingProjects"];
  var TSV_COLUMNS = ApoComm.INTAKE_COLUMNS;

  // ---- client-search lookup (backend-first, same pattern as the 3 admin
  // tools; here it fills the existing #ClientID field rather than a TSV
  // textarea, since missionaries submit this form and don't have a
  // registration row to paste — only their own Client ID, which they may
  // or may not remember). searchByName against the shared backend first;
  // falls back to the localStorage cache only if that call fails or
  // returns nothing. ------------------------------------------------------

  function showBackendWarning(warning) {
    if (warning) {
      backendWarning.textContent = warning;
      backendWarning.hidden = false;
    } else {
      backendWarning.hidden = true;
    }
  }

  var clientMap = {};
  var activeResultIndex = -1;
  var searchToken = 0;

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
          ? "No match — type your Client ID directly below instead."
          : "No saved clients yet — type your Client ID directly below instead.";
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
    clientIdInput.value = client.clientId;
    clientSearch.value = client.label;
    clientResults.hidden = true;
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

  // ---- intake field capture (unchanged from before) --------------------

  function sanitize(value) {
    return String(value == null ? "" : value).replace(/[\t\r\n]+/g, " ").trim();
  }

  // List fields accept either one entry per line or semicolon-separated
  // entries (the placeholders show both); normalize either style into a
  // single semicolon-joined TSV cell so the generators only ever have to
  // split on ";".
  function sanitizeList(value) {
    var raw = String(value == null ? "" : value);
    var items = raw.split(/[\n;]+/).map(function (s) { return s.replace(/\t/g, " ").trim(); }).filter(Boolean);
    return items.join("; ");
  }

  function todayISO() {
    var d = new Date();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + m + "-" + day;
  }

  function clearErrors() {
    form.querySelectorAll(".error").forEach(function (el) { el.textContent = ""; });
    form.querySelectorAll(".field.has-error").forEach(function (el) {
      el.classList.remove("has-error");
    });
  }

  function setError(fieldName, message) {
    var errorEl = form.querySelector('[data-error-for="' + fieldName + '"]');
    if (errorEl) {
      errorEl.textContent = message;
      var fieldWrap = errorEl.closest(".field");
      if (fieldWrap) fieldWrap.classList.add("has-error");
    }
  }

  function fieldValue(name) {
    var el = form.elements[name];
    if (!el) return "";
    return LIST_FIELDS.indexOf(name) !== -1 ? sanitizeList(el.value) : sanitize(el.value);
  }

  function validate() {
    clearErrors();
    var valid = true;
    REQUIRED_FIELDS.forEach(function (name) {
      if (!fieldValue(name)) {
        setError(name, LIST_FIELDS.indexOf(name) !== -1 ? "At least one entry is required." : "This field is required.");
        valid = false;
      }
    });
    return valid;
  }

  function buildFields() {
    return {
      ClientID: fieldValue("ClientID"),
      IsFirstNewsletter: fieldValue("IsFirstNewsletter"),
      Events: fieldValue("Events"),
      MeetingsSummary: fieldValue("MeetingsSummary"),
      PrayerNeeds: fieldValue("PrayerNeeds"),
      UpcomingProjects: fieldValue("UpcomingProjects"),
      NumbersUpdate: fieldValue("NumbersUpdate"),
      NewPhotoLinks: fieldValue("NewPhotoLinks"),
      AnythingToAvoid: fieldValue("AnythingToAvoid"),
      SubmissionDate: todayISO()
    };
  }

  function buildRow(fields) {
    return TSV_COLUMNS.map(function (col) { return fields[col] || ""; }).join("\t");
  }

  // ---- automated dual-generation on submit ------------------------------

  function resetOutcome() {
    notFoundMessage.hidden = true;
    blockedMessage.hidden = true;
    backendWarning.hidden = true;
    resultSection.hidden = true;
    resultsScreen.hidden = true;
    newsletterSecurityDecision.hidden = true;
    instagramSecurityDecision.hidden = true;
    instagramError.hidden = true;
    instagramOutputField.hidden = true;
    newsletterActionStatus.textContent = "";
    instagramActionStatus.textContent = "";
  }

  function showNewsletterDecision(security, redactions, expansionNotes) {
    var lines = [];
    lines.push('<div class="row"><strong>SecuritySensitive:</strong> ' + (security.sensitive ? "YES" : "NO") + "</div>");
    if (security.sensitive) {
      Object.keys(ApoComm.Newsletter.TOPICS).forEach(function (key) {
        lines.push('<div class="row"><strong>' + key + ':</strong> ' + (security.allow[key] ? "included" : "omitted / generic (not explicitly permitted)") + "</div>");
      });
    }
    var avoidTerms = redactions.filter(function (r) { return r.term; });
    if (avoidTerms.length) {
      lines.push('<div class="row"><strong>AnythingToAvoid:</strong> ' +
        avoidTerms.map(function (r) { return '"' + r.term + '" — ' + (r.found ? "found &amp; removed" : "not found in output"); }).join("; ") +
        "</div>");
    }
    if (expansionNotes && expansionNotes.length) {
      lines.push('<div class="row"><strong>Paragraph length:</strong> ' +
        expansionNotes.map(function (n) {
          return n.section + ": " + n.words + " words" + (n.reachedMin ? "" : " (below 150 — see SHORT INPUT comment in body)");
        }).join("; ") +
        "</div>");
    }
    newsletterSecurityDecision.innerHTML = lines.join("");
    newsletterSecurityDecision.hidden = false;
  }

  function showInstagramDecision(security, calendar) {
    var lines = ApoComm.Instagram.showDecisionLines(security, calendar);
    instagramSecurityDecision.innerHTML = lines.join("");
    instagramSecurityDecision.hidden = false;
  }

  var submitBtn = form.querySelector('button[type="submit"]');

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    resetOutcome();

    if (!validate()) {
      var firstError = form.querySelector(".field.has-error input, .field.has-error select, .field.has-error textarea");
      if (firstError) firstError.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    var intakeFields = buildFields();

    submitBtn.disabled = true;

    // Backend first (so a second browser with empty localStorage can still
    // find a registration saved from a different browser); falls back to
    // this browser's local cache only if the backend is unreachable.
    ApoComm.fetchClientRow(intakeFields.ClientID).then(function (lookup) {
      showBackendWarning(lookup.warning);

      if (!lookup.fields) {
        notFoundMessage.textContent = "No registration profile found for this client. Load or paste it first.";
        notFoundMessage.hidden = false;
        notFoundMessage.scrollIntoView({ behavior: "smooth", block: "center" });
        submitBtn.disabled = false;
        return;
      }

      var regFields = lookup.fields;

      tsvOutput.value = buildRow(intakeFields);
      copyStatus.textContent = "";
      resultSection.hidden = false;

      ApoComm.saveIntakeRemote(intakeFields).then(function (result) {
        if (result.warning) showBackendWarning(result.warning);
      });

      // The blocking decision (SecuritySensitive=YES + empty
      // SecurityInstructions) depends only on regFields, not on which
      // topic set is being evaluated, so newsletter's and Instagram's
      // gates always agree on block/no-block — checked once in effect,
      // even though each tool's allow-map has a different topic shape.
      var nlSecurity = ApoComm.Newsletter.evaluateSecurityGate(regFields);
      if (nlSecurity.blocked) {
        // Same block, softer words — nlSecurity.reason (shared with the
        // newsletter/Instagram tools, untouched) still drives the actual
        // decision; this is just what's displayed here.
        blockedMessage.textContent = "Thanks so much for sending this in. Because of what's on file for you, " +
          "a team member needs to take a quick look before we can put this month's update together. " +
          "Nothing you shared is lost — we'll be in touch, and you can check back anytime.";
        blockedMessage.hidden = false;
        blockedMessage.scrollIntoView({ behavior: "smooth", block: "center" });
        submitBtn.disabled = false;
        return;
      }
      var igSecurity = ApoComm.Instagram.evaluateSecurityGate(regFields);

      var draft = ApoComm.Newsletter.build(regFields, intakeFields, nlSecurity);
      showNewsletterDecision(nlSecurity, draft.redactions, draft.expansionNotes);
      newsletterSubjectOutput.value = draft.subject;
      newsletterBodyOutput.value = draft.body;

      try {
        var calendar = ApoComm.Instagram.build(regFields, intakeFields, igSecurity);
        showInstagramDecision(igSecurity, calendar);
        instagramView.innerHTML = ApoComm.Instagram.renderHtml(calendar);
        instagramOutput.value = ApoComm.Instagram.renderText(calendar);
        instagramOutputField.hidden = false;
      } catch (err) {
        instagramError.textContent = "Instagram calendar could not be generated: " + err.message;
        instagramError.hidden = false;
      }

      resultsScreen.hidden = false;
      resultsScreen.scrollIntoView({ behavior: "smooth", block: "start" });
      submitBtn.disabled = false;
    });
  });

  copyBtn.addEventListener("click", function () {
    navigator.clipboard.writeText(tsvOutput.value).then(function () {
      copyStatus.textContent = "Copied.";
    }, function () {
      copyStatus.textContent = "Copy failed — select the text and copy manually.";
    });
  });

  copyNewsletterSubjectBtn.addEventListener("click", function () {
    navigator.clipboard.writeText(newsletterSubjectOutput.value).then(function () {
      newsletterActionStatus.textContent = "Subject copied.";
    }, function () {
      newsletterActionStatus.textContent = "Copy failed — select and copy manually.";
    });
  });

  copyNewsletterBodyBtn.addEventListener("click", function () {
    navigator.clipboard.writeText(newsletterBodyOutput.value).then(function () {
      newsletterActionStatus.textContent = "Body copied.";
    }, function () {
      newsletterActionStatus.textContent = "Copy failed — select and copy manually.";
    });
  });

  copyInstagramBtn.addEventListener("click", function () {
    navigator.clipboard.writeText(instagramOutput.value).then(function () {
      instagramActionStatus.textContent = "Copied.";
    }, function () {
      instagramActionStatus.textContent = "Copy failed — select and copy manually.";
    });
  });
})();
