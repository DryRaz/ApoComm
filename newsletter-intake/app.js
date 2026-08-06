(function () {
  "use strict";

  var form = document.getElementById("intake-form");
  var resultSection = document.getElementById("result");
  var tsvOutput = document.getElementById("tsv-output");
  var copyBtn = document.getElementById("copy-btn");
  var copyStatus = document.getElementById("copy-status");

  var REQUIRED_FIELDS = ["ClientID", "IsFirstNewsletter", "Events"];
  var LIST_FIELDS = ["Events", "PrayerNeeds", "UpcomingProjects"];

  // The order the missionary fills these in; SubmissionDate is
  // appended as the 10th, system-derived column so a later intake for
  // the same ClientID can be told apart from an earlier one.
  var TSV_COLUMNS = [
    "ClientID", "IsFirstNewsletter", "Events", "MeetingsSummary", "PrayerNeeds",
    "UpcomingProjects", "NumbersUpdate", "NewPhotoLinks", "AnythingToAvoid", "SubmissionDate"
  ];

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

  function buildRow() {
    var values = {
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
    return TSV_COLUMNS.map(function (col) { return values[col] || ""; }).join("\t");
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();

    if (!validate()) {
      var firstError = form.querySelector(".field.has-error input, .field.has-error select, .field.has-error textarea");
      if (firstError) firstError.scrollIntoView({ behavior: "smooth", block: "center" });
      resultSection.hidden = true;
      return;
    }

    tsvOutput.value = buildRow();
    copyStatus.textContent = "";
    resultSection.hidden = false;
    resultSection.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  copyBtn.addEventListener("click", function () {
    navigator.clipboard.writeText(tsvOutput.value).then(function () {
      copyStatus.textContent = "Copied.";
    }, function () {
      copyStatus.textContent = "Copy failed — select the text and copy manually.";
    });
  });
})();
