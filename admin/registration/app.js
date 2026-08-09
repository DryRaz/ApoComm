(function () {
  "use strict";

  var form = document.getElementById("registration-form");
  var resultSection = document.getElementById("result");
  var securityBanner = document.getElementById("security-banner");
  var completionLine = document.getElementById("completion-line");
  var tsvOutput = document.getElementById("tsv-output");
  var copyBtn = document.getElementById("copy-btn");
  var copyStatus = document.getElementById("copy-status");
  var saveStatus = document.getElementById("save-status");
  var submitBtn = form.querySelector('button[type="submit"]');

  // ---- step wizard (interface only — the 36 fields, REQUIRED_TEXT_FIELDS,
  // REQUIRED_GROUP_FIELDS, validate(), buildRow(), analyzeSecurity(), and
  // the submit handler's backend/ID logic below are all unchanged; this
  // section only adds pagination on top of the same single <form>) -------

  var backBtn = document.getElementById("back-btn");
  var nextBtn = document.getElementById("next-btn");
  var stepEls = Array.prototype.slice.call(form.querySelectorAll(".step"));
  var indicatorItems = Array.prototype.slice.call(document.querySelectorAll(".step-indicator-item"));
  var stepPositionEl = document.getElementById("step-position");
  var stepCurrentNameEl = document.getElementById("step-current-name");
  var progressTrack = document.getElementById("progress-track");
  var progressFill = document.getElementById("progress-fill");
  var progressLabel = document.getElementById("progress-label");

  var STEP_NAMES = ["Identity", "Mission", "Audience", "Needs", "Content", "Admin"];

  // Which of REQUIRED_TEXT_FIELDS / REQUIRED_GROUP_FIELDS belong to each
  // step, used only to gate the "Continue" button — the authoritative,
  // unchanged full-form check still runs in validate() at final submit.
  var STEP_REQUIRED_TEXT = [
    ["LastName", "FirstName", "Email", "PrimaryLanguage"],
    ["SendingOrganization", "CountryOfService", "MinistryType", "DepartureDate", "MissionSummary"],
    ["CurrentPartnersCount"],
    ["MainObjective", "DesiredFrequency"],
    [],
    ["PackageOffer", "ContractStartDate"]
  ];
  var STEP_REQUIRED_GROUPS = [[], [], [], ["RequestedServices", "Channels"], [], []];

  var currentStep = 0;

  // Single-value required fields (block submission if empty).
  var REQUIRED_TEXT_FIELDS = [
    "LastName", "FirstName", "Email", "PrimaryLanguage", "SendingOrganization",
    "CountryOfService", "MinistryType", "DepartureDate", "MissionSummary",
    "CurrentPartnersCount", "MainObjective", "DesiredFrequency", "PackageOffer",
    "ContractStartDate"
  ];

  // Checkbox-group required fields (at least one option must be checked).
  var REQUIRED_GROUP_FIELDS = ["RequestedServices", "Channels"];

  // The 17 required fields tracked for the completion percentage:
  // the 16 fields the missionary must supply, plus SecuritySensitive,
  // which the system always derives once MissionSummary is analyzed.
  var COMPLETION_FIELD_COUNT = REQUIRED_TEXT_FIELDS.length + REQUIRED_GROUP_FIELDS.length + 1;

  // Phrasing that signals a need for discretion in the mission summary.
  var SECURITY_KEYWORDS = [
    "prefer not to disclose", "sensitive location", "restricted access",
    "restricted-access", "can't share publicly", "cannot share publicly",
    "don't disclose", "do not disclose", "undisclosed location",
    "closed country", "creative access", "please do not publish",
    "do not publish", "security reasons", "for security purposes",
    "keep this confidential", "confidential location", "cannot be named",
    "cannot be identified", "avoid identifying", "need discretion",
    "for discretion", "no photos please", "anonymous"
  ];

  var TSV_COLUMNS = ApoComm.REG_COLUMNS;

  function sanitize(value) {
    return String(value == null ? "" : value).replace(/[\t\r\n]+/g, " ").trim();
  }

  function todayISO() {
    var d = new Date();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + m + "-" + day;
  }

  // Offline-only fallback: the backend allocates the real ClientID on a
  // successful registerClient call (see apocomm-backend.js) — this local
  // counter is used ONLY when that call fails outright, so the row still
  // has something to be saved locally under rather than being lost. Two
  // browsers registering offline in the same year could in principle
  // generate the same fallback ID before either syncs; that's an accepted
  // limitation of a purely local counter, not something to design around
  // here, since it only ever applies to the already-degraded offline path.
  function nextClientId() {
    var year = new Date().getFullYear();
    // Deliberately NOT prefixed "apocomm_client_" — that prefix is reserved
    // for saved client TSV rows (see ApoComm.cacheClientRow()) and is
    // scanned by the other tools' "load saved client" dropdowns; this
    // internal counter must never appear in that list.
    var key = "apocomm_seq_" + year;
    var seq = parseInt(localStorage.getItem(key) || "0", 10) + 1;
    localStorage.setItem(key, String(seq));
    return "APC-" + year + "-" + String(seq).padStart(3, "0");
  }

  function analyzeSecurity(missionSummary) {
    var text = missionSummary.toLowerCase();
    for (var i = 0; i < SECURITY_KEYWORDS.length; i++) {
      if (text.indexOf(SECURITY_KEYWORDS[i]) !== -1) {
        return true;
      }
    }
    return false;
  }

  function getCheckedValues(groupName) {
    var boxes = form.querySelectorAll('input[name="' + groupName + '"]:checked');
    var values = [];
    boxes.forEach(function (box) { values.push(box.value); });
    return values;
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

  function validate() {
    clearErrors();
    var valid = true;

    REQUIRED_TEXT_FIELDS.forEach(function (name) {
      var el = form.elements[name];
      if (!el || !sanitize(el.value)) {
        setError(name, "This field is required.");
        valid = false;
      }
    });

    var emailEl = form.elements.Email;
    if (emailEl && sanitize(emailEl.value) && !emailEl.checkValidity()) {
      setError("Email", "Enter a valid email address.");
      valid = false;
    }

    REQUIRED_GROUP_FIELDS.forEach(function (name) {
      if (getCheckedValues(name).length === 0) {
        setError(name, "Select at least one option.");
        valid = false;
      }
    });

    return valid;
  }

  // Same shape as validate() above but scoped to one step's fields, so
  // "Continue" only checks what's actually on screen. Uses the exact same
  // setError()/getCheckedValues()/sanitize() helpers and the exact same
  // required-field lists (just filtered to this step) — no separate
  // validation logic, no separate error copy.
  function validateStep(stepIndex) {
    clearErrors();
    var valid = true;

    STEP_REQUIRED_TEXT[stepIndex].forEach(function (name) {
      var el = form.elements[name];
      if (!el || !sanitize(el.value)) {
        setError(name, "This field is required.");
        valid = false;
      }
    });

    if (STEP_REQUIRED_TEXT[stepIndex].indexOf("Email") !== -1) {
      var emailEl = form.elements.Email;
      if (emailEl && sanitize(emailEl.value) && !emailEl.checkValidity()) {
        setError("Email", "Enter a valid email address.");
        valid = false;
      }
    }

    STEP_REQUIRED_GROUPS[stepIndex].forEach(function (name) {
      if (getCheckedValues(name).length === 0) {
        setError(name, "Select at least one option.");
        valid = false;
      }
    });

    return valid;
  }

  // Finds which step a given field name lives on, so a final-submit
  // validation failure (validate() covers every field, not just the
  // current step) can bring the right step into view before scrolling —
  // this only reacts to validate()'s existing true/false result, it
  // doesn't change what validate() checks.
  function stepIndexForField(name) {
    for (var i = 0; i < STEP_REQUIRED_TEXT.length; i++) {
      if (STEP_REQUIRED_TEXT[i].indexOf(name) !== -1) return i;
    }
    for (var j = 0; j < STEP_REQUIRED_GROUPS.length; j++) {
      if (STEP_REQUIRED_GROUPS[j].indexOf(name) !== -1) return j;
    }
    return -1;
  }

  function updateIndicator() {
    indicatorItems.forEach(function (item, i) {
      item.classList.toggle("is-current", i === currentStep);
      item.classList.toggle("is-complete", i < currentStep);
    });
    stepPositionEl.textContent = "Step " + (currentStep + 1) + " of " + STEP_NAMES.length;
    stepCurrentNameEl.textContent = STEP_NAMES[currentStep];
  }

  // Live completion preview: reuses buildRow()/completionStats() exactly
  // as the result screen does — just called more often, on every input,
  // rather than only once at submit. No new completion logic.
  function updateProgress() {
    var values = buildRow();
    var stats = completionStats(values);
    progressFill.style.width = stats.percent + "%";
    progressLabel.textContent = stats.percent + "% complete";
    progressTrack.setAttribute("aria-valuenow", String(stats.percent));
  }

  function renderStep() {
    stepEls.forEach(function (el, i) {
      el.hidden = i !== currentStep;
    });
    backBtn.hidden = currentStep === 0;
    nextBtn.hidden = currentStep === STEP_NAMES.length - 1;
    submitBtn.hidden = currentStep !== STEP_NAMES.length - 1;
    updateIndicator();
    updateProgress();
  }

  function goToStep(index) {
    currentStep = Math.max(0, Math.min(STEP_NAMES.length - 1, index));
    renderStep();
    form.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  nextBtn.addEventListener("click", function () {
    if (!validateStep(currentStep)) {
      var firstError = stepEls[currentStep].querySelector(".field.has-error input, .field.has-error select, .field.has-error textarea");
      if (firstError) firstError.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    clearErrors();
    goToStep(currentStep + 1);
  });

  backBtn.addEventListener("click", function () {
    clearErrors();
    goToStep(currentStep - 1);
  });

  // Enter inside a text-like input would otherwise implicitly submit the
  // whole form (the browser looks for the first submit button in the
  // form regardless of which step is visible) — redirect it to whatever
  // this step's forward action is instead. Textareas keep Enter as a
  // normal newline.
  form.addEventListener("keydown", function (event) {
    if (event.key !== "Enter" || event.target.tagName === "TEXTAREA") return;
    if (currentStep === STEP_NAMES.length - 1) return; // let the real submit button handle it
    event.preventDefault();
    nextBtn.click();
  });

  // Clears a field's error as soon as its value changes, rather than
  // leaving a stale error message/highlight visible until the next
  // "Continue" click — pure UI responsiveness, doesn't change what
  // validateStep()/validate() consider valid.
  function clearFieldErrorOnEdit(event) {
    var fieldWrap = event.target.closest(".field");
    if (fieldWrap && fieldWrap.classList.contains("has-error")) {
      fieldWrap.classList.remove("has-error");
      var errorEl = fieldWrap.querySelector(".error");
      if (errorEl) errorEl.textContent = "";
    }
  }

  form.addEventListener("input", clearFieldErrorOnEdit);
  form.addEventListener("change", clearFieldErrorOnEdit);
  form.addEventListener("input", updateProgress);
  form.addEventListener("change", updateProgress);

  function buildRow() {
    var missionSummary = sanitize(form.elements.MissionSummary.value);
    var securitySensitive = analyzeSecurity(missionSummary) ? "YES" : "NO";

    var values = {
      // Placeholder — the backend assigns the real ClientID on submit
      // (see the submit handler below); left blank rather than guessed
      // here so nothing downstream mistakes this for a real ID.
      ClientID: "",
      OnboardingStatus: "New",
      CreationDate: todayISO(),
      LastName: sanitize(form.elements.LastName.value),
      FirstName: sanitize(form.elements.FirstName.value),
      Email: sanitize(form.elements.Email.value),
      WhatsAppPhone: sanitize(form.elements.WhatsAppPhone.value),
      PrimaryLanguage: sanitize(form.elements.PrimaryLanguage.value),
      Timezone: sanitize(form.elements.Timezone.value),
      SendingOrganization: sanitize(form.elements.SendingOrganization.value),
      CountryOfService: sanitize(form.elements.CountryOfService.value),
      CityOfService: sanitize(form.elements.CityOfService.value),
      MinistryType: sanitize(form.elements.MinistryType.value),
      DepartureDate: sanitize(form.elements.DepartureDate.value),
      CommitmentDuration: sanitize(form.elements.CommitmentDuration.value),
      MissionSummary: missionSummary,
      SecuritySensitive: securitySensitive,
      SecurityInstructions: "",
      CurrentPartnersCount: sanitize(form.elements.CurrentPartnersCount.value),
      AudienceSegments: sanitize(form.elements.AudienceSegments.value),
      ExistingEmailList: sanitize(form.elements.ExistingEmailList.value),
      MainObjective: sanitize(form.elements.MainObjective.value),
      RequestedServices: getCheckedValues("RequestedServices").join("; "),
      Channels: getCheckedValues("Channels").join("; "),
      DesiredFrequency: sanitize(form.elements.DesiredFrequency.value),
      DesiredTone: sanitize(form.elements.DesiredTone.value),
      ExistingWritingLink: sanitize(form.elements.ExistingWritingLink.value),
      PhotosLink: sanitize(form.elements.PhotosLink.value),
      PackageOffer: sanitize(form.elements.PackageOffer.value),
      MonthlyBudget: sanitize(form.elements.MonthlyBudget.value),
      ContractStartDate: sanitize(form.elements.ContractStartDate.value),
      ApostelloManager: "",
      NextAction: "",
      NextFollowUpDate: "",
      FollowUpCount: "",
      Notes: sanitize(form.elements.Notes.value)
    };

    return values;
  }

  function completionStats(values) {
    var filled = 0;
    REQUIRED_TEXT_FIELDS.forEach(function (name) {
      if (values[name]) filled++;
    });
    if (values.RequestedServices) filled++;
    if (values.Channels) filled++;
    if (values.SecuritySensitive) filled++;
    return {
      filled: filled,
      total: COMPLETION_FIELD_COUNT,
      percent: Math.round((filled / COMPLETION_FIELD_COUNT) * 100)
    };
  }

  function toTsvRow(values) {
    return TSV_COLUMNS.map(function (col) { return values[col] || ""; }).join("\t");
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();

    if (!validate()) {
      // validate() itself is unchanged and checks every field regardless
      // of which step is showing — if the first problem it found is on an
      // earlier step (shouldn't normally happen, since "Continue" already
      // gates each step, but covers e.g. browser back/forward), bring
      // that step into view before scrolling to the field.
      var firstError = form.querySelector(".field.has-error input, .field.has-error select, .field.has-error textarea");
      if (firstError) {
        var errorStep = stepIndexForField(firstError.name);
        if (errorStep !== -1 && errorStep !== currentStep) {
          currentStep = errorStep;
          renderStep();
        }
        firstError.scrollIntoView({ behavior: "smooth", block: "center" });
        firstError.focus({ preventScroll: true });
      }
      resultSection.hidden = true;
      return;
    }

    var values = buildRow();
    var stats = completionStats(values);

    securityBanner.hidden = values.SecuritySensitive !== "YES";
    completionLine.textContent = "Required-field completion: " + stats.percent + "% (" +
      stats.filled + "/" + stats.total + " tracked fields).";
    copyStatus.textContent = "";
    tsvOutput.value = "";

    saveStatus.classList.remove("warning");
    saveStatus.textContent = "Saving…";
    submitBtn.disabled = true;
    resultSection.hidden = false;
    resultSection.scrollIntoView({ behavior: "smooth", block: "start" });

    // ClientID isn't known yet — `values.ClientID` is still the blank
    // placeholder from buildRow(). The backend assigns the real one; only
    // once that comes back (or the call fails, in which case a purely
    // local fallback ID is generated) do we know what to display/save
    // under, so the TSV output is filled in below, not above.
    ApoComm.registerClientRemote(values).then(function (result) {
      if (result.ok) {
        values.ClientID = result.clientId;
        tsvOutput.value = toTsvRow(values);
        saveStatus.classList.remove("warning");
        saveStatus.textContent = "Saved as " + values.ClientID + " to the shared database — available to the other tools everywhere.";
      } else {
        values.ClientID = nextClientId();
        ApoComm.cacheClientRow(values);
        tsvOutput.value = toTsvRow(values);
        saveStatus.classList.add("warning");
        saveStatus.textContent = "Could not reach the shared database — saved locally only on this browser as " +
          values.ClientID + ". It will need to be synced manually until the connection is available again.";
      }
      submitBtn.disabled = false;
    });
  });

  copyBtn.addEventListener("click", function () {
    tsvOutput.select();
    navigator.clipboard.writeText(tsvOutput.value).then(function () {
      copyStatus.textContent = "Copied.";
    }, function () {
      copyStatus.textContent = "Copy failed — select the text and copy manually.";
    });
  });

  renderStep();
})();
