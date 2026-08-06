(function () {
  "use strict";

  var TSV_COLUMNS = [
    "ClientID", "OnboardingStatus", "CreationDate", "LastName", "FirstName",
    "Email", "WhatsAppPhone", "PrimaryLanguage", "Timezone",
    "SendingOrganization", "CountryOfService", "CityOfService", "MinistryType",
    "DepartureDate", "CommitmentDuration", "MissionSummary", "SecuritySensitive",
    "SecurityInstructions", "CurrentPartnersCount", "AudienceSegments",
    "ExistingEmailList", "MainObjective", "RequestedServices", "Channels",
    "DesiredFrequency", "DesiredTone", "ExistingWritingLink", "PhotosLink",
    "PackageOffer", "MonthlyBudget", "ContractStartDate", "ApostelloManager",
    "NextAction", "NextFollowUpDate", "FollowUpCount", "Notes"
  ];

  var tsvInput = document.getElementById("tsv-input");
  var parseError = document.getElementById("parse-error");
  var generateBtn = document.getElementById("generate-btn");
  var blockedMessage = document.getElementById("blocked-message");
  var securityDecision = document.getElementById("security-decision");
  var successPanel = document.getElementById("success-panel");
  var preview = document.getElementById("preview");
  var htmlOutput = document.getElementById("html-output");
  var copyHtmlBtn = document.getElementById("copy-html-btn");
  var downloadBtn = document.getElementById("download-btn");
  var actionStatus = document.getElementById("action-status");

  var currentHtml = "";
  var currentFileName = "missionary-site.html";

  function parseRow(raw) {
    var lines = raw.split(/\r?\n/);
    var line = "";
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].trim() !== "") { line = lines[i]; break; }
    }
    var cols = line.split("\t");
    if (cols.length !== TSV_COLUMNS.length) {
      throw new Error(
        "Expected " + TSV_COLUMNS.length + " tab-separated columns, got " + cols.length + "."
      );
    }
    var fields = {};
    TSV_COLUMNS.forEach(function (name, i) { fields[name] = (cols[i] || "").trim(); });
    return fields;
  }

  // Scans SecurityInstructions clause by clause. A clause permits a
  // location field only if it mentions the keyword together with an
  // explicit allow word and no negation word in that same clause —
  // the safe default, when instructions are silent or ambiguous, is
  // to keep the field hidden.
  function segmentsOf(text) {
    return text.split(/[.;\n]+/).map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean);
  }

  var NEGATION_WORDS = ["not", "never", "don't", "do not", "cannot", "can't", "no "];
  var ALLOW_WORDS = [
    "ok", "okay", "allow", "allowed", "permit", "permitted", "approved",
    "share", "shared", "show", "shown", "disclose", "publish", "include", "fine"
  ];

  function clauseAllows(clause, keyword) {
    if (clause.indexOf(keyword) === -1) return false;
    var negated = NEGATION_WORDS.some(function (w) { return clause.indexOf(w) !== -1; });
    if (negated) return false;
    return ALLOW_WORDS.some(function (w) { return clause.indexOf(w) !== -1; });
  }

  function isLocationFieldAllowed(instructions, keyword) {
    return segmentsOf(instructions).some(function (clause) { return clauseAllows(clause, keyword); });
  }

  function evaluateSecurityGate(fields) {
    var sensitive = fields.SecuritySensitive.trim().toUpperCase() === "YES";
    var instructions = fields.SecurityInstructions.trim();

    if (!sensitive) {
      return { blocked: false, sensitive: false, allowCountry: true, allowCity: true };
    }

    if (!instructions) {
      return {
        blocked: true,
        reason: "Cannot generate — this profile requires human security validation first."
      };
    }

    return {
      blocked: false,
      sensitive: true,
      allowCountry: isLocationFieldAllowed(instructions, "country"),
      allowCity: isLocationFieldAllowed(instructions, "city")
    };
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function capIfSentenceStart(word, offset, string) {
    var before = string.slice(0, offset);
    var atStart = before.length === 0 || /[.!?]["')\]]*\s+$/.test(before);
    return atStart ? word.charAt(0).toUpperCase() + word.slice(1) : word;
  }

  // Best-effort conversion of third-person/plural biographical text into
  // first-person singular, so a public page reads as the missionary's own
  // voice even though MissionSummary/MainObjective are often written about
  // them by staff (see apostello-onboarding skill). This is a deterministic
  // rule-based pass, not real NLP: it reliably handles "<Name> is/was/does/
  // verb-s ...", gendered pronouns, and "we/our" plural — the common
  // patterns in this data — but a construction it doesn't recognize (e.g.
  // "<Name>" as the object of a verb with no preposition) can slip through
  // unconverted.
  function toFirstPerson(text, firstName, lastName) {
    if (!text) return text;
    var result = text;
    var names = [];
    if (firstName && lastName) names.push(escapeRegex((firstName + " " + lastName).trim()));
    if (firstName) names.push(escapeRegex(firstName));

    if (names.length) {
      var nameAlt = names.join("|");

      result = result.replace(new RegExp("\\b(?:" + nameAlt + ")'s\\b", "g"), function (m, offset, string) {
        return capIfSentenceStart("my", offset, string);
      });

      var auxMap = [
        ["\\s+is\\b", "I'm"], ["\\s+are\\b", "I'm"], ["\\s+was\\b", "I was"],
        ["\\s+has\\b", "I have"], ["\\s+had\\b", "I had"], ["\\s+will\\b", "I'll"],
        ["\\s+does\\b", "I do"], ["\\s+did\\b", "I did"]
      ];
      auxMap.forEach(function (pair) {
        var re = new RegExp("\\b(?:" + nameAlt + ")" + pair[0], "gi");
        result = result.replace(re, function (m, offset, string) {
          return capIfSentenceStart(pair[1], offset, string);
        });
      });

      var OBJECT_PRECEDERS = /\b(to|with|for|from|about|of|near|alongside|beside|behind|before|after|than|like|upon|unto)\s*$/i;
      result = result.replace(new RegExp("\\b(?:" + nameAlt + ")\\b", "g"), function (m, offset, string) {
        var before = string.slice(Math.max(0, offset - 20), offset);
        var word = OBJECT_PRECEDERS.test(before) ? "me" : "I";
        return capIfSentenceStart(word, offset, string);
      });
    }

    result = result.replace(/\bwe\s+are\b|\bwe're\b/gi, function (m, offset, string) {
      return capIfSentenceStart("I'm", offset, string);
    });
    result = result.replace(/\bwe\s+were\b/gi, function (m, offset, string) {
      return capIfSentenceStart("I was", offset, string);
    });
    result = result.replace(/\b(?:she|he|they)\b/gi, function (m, offset, string) {
      return capIfSentenceStart("I", offset, string);
    });
    result = result.replace(/\b(?:him|them|us)\b/gi, function (m, offset, string) {
      return capIfSentenceStart("me", offset, string);
    });
    result = result.replace(/\b(?:her|his|their|our)\b/gi, function (m, offset, string) {
      return capIfSentenceStart("my", offset, string);
    });
    result = result.replace(/\b(?:hers|theirs|ours)\b/gi, function (m, offset, string) {
      return capIfSentenceStart("mine", offset, string);
    });
    result = result.replace(/\b(?:herself|himself|themselves|ourselves)\b/gi, function (m, offset, string) {
      return capIfSentenceStart("myself", offset, string);
    });
    result = result.replace(/\bwe\b/gi, function (m, offset, string) {
      return capIfSentenceStart("I", offset, string);
    });

    return result;
  }

  function hookLine(missionSummary) {
    var text = missionSummary.trim();
    if (!text) return "";
    var firstSentence = (text.split(/(?<=[.!?])\s+/)[0] || text).trim();
    if (firstSentence.length > 140) {
      firstSentence = firstSentence.slice(0, 137).replace(/\s+\S*$/, "") + "…";
    }
    return firstSentence;
  }

  function slug(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "missionary";
  }

  function buildWhereSection(fields, security) {
    if (!security.allowCountry && !security.allowCity) return "";
    var parts = [];
    if (security.allowCity && fields.CityOfService) parts.push(escapeHtml(fields.CityOfService));
    if (security.allowCountry && fields.CountryOfService) parts.push(escapeHtml(fields.CountryOfService));
    if (parts.length === 0) return "";
    return (
      '<section class="section where">\n' +
      '  <h2>Where I serve</h2>\n' +
      '  <p class="location">\n' +
      '    <svg class="pin" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">\n' +
      '      <path d="M12 2C7.6 2 4 5.6 4 10c0 5.4 7 11.5 7.3 11.7a1 1 0 0 0 1.4 0C13 21.5 20 15.4 20 10c0-4.4-3.6-8-8-8zm0 11a3 3 0 1 1 0-6 3 3 0 0 1 0 6z" fill="currentColor"/>\n' +
      '    </svg>\n' +
      "    I'm serving in " + parts.join(", ") + "\n" +
      "  </p>\n" +
      "</section>"
    );
  }

  function buildPhotoSection() {
    return (
      '<section class="section photos">\n' +
      "  <h2>Photos</h2>\n" +
      '  <div class="photo-grid">\n' +
      "    <!-- PHOTO 1: replace this placeholder div with e.g. <img src=\"https://...\" alt=\"...\"> -->\n" +
      '    <div class="photo-slot"><span>Photo 1</span></div>\n' +
      "    <!-- PHOTO 2: replace this placeholder div with e.g. <img src=\"https://...\" alt=\"...\"> -->\n" +
      '    <div class="photo-slot"><span>Photo 2</span></div>\n' +
      "    <!-- PHOTO 3 (optional): replace this placeholder div with e.g. <img src=\"https://...\" alt=\"...\"> -->\n" +
      '    <div class="photo-slot"><span>Photo 3</span></div>\n' +
      "  </div>\n" +
      "</section>"
    );
  }

  function buildSiteHtml(fields, security) {
    var fullName = (fields.FirstName + " " + fields.LastName).trim();
    var title = escapeHtml(fullName) + " — Apostello Comm";
    var summaryFirstPerson = toFirstPerson(fields.MissionSummary, fields.FirstName, fields.LastName);
    var objectiveFirstPerson = toFirstPerson(fields.MainObjective, fields.FirstName, fields.LastName);
    var hook = escapeHtml(hookLine(summaryFirstPerson));
    var mailHref = "mailto:" + encodeURIComponent(fields.Email).replace(/%40/g, "@");

    var whereSection = buildWhereSection(fields, security);

    return (
      "<!DOCTYPE html>\n" +
      '<html lang="en">\n' +
      "<head>\n" +
      '<meta charset="UTF-8">\n' +
      '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
      "<title>" + title + "</title>\n" +
      "<style>\n" +
      SITE_CSS +
      "</style>\n" +
      "</head>\n" +
      "<body>\n" +
      '<header class="hero">\n' +
      '  <p class="eyebrow">Apostello Comm &middot; Missionary Update</p>\n' +
      "  <h1>" + escapeHtml(fullName) + "</h1>\n" +
      (fields.MinistryType ? '  <p class="badge">' + escapeHtml(fields.MinistryType) + "</p>\n" : "") +
      (hook ? '  <p class="hook">' + hook + "</p>\n" : "") +
      "</header>\n" +
      '<main class="container">\n' +
      '  <section class="section about">\n' +
      "    <h2>About me</h2>\n" +
      "    <p>" + escapeHtml(summaryFirstPerson) + "</p>\n" +
      (fields.SendingOrganization
        ? '    <p class="sent-by">I&#39;m sent by ' + escapeHtml(fields.SendingOrganization) + "</p>\n"
        : "") +
      "  </section>\n" +
      (whereSection ? "  " + whereSection.replace(/\n/g, "\n  ") + "\n" : "") +
      '  <section class="section involved">\n' +
      "    <h2>Get involved</h2>\n" +
      '    <p class="cta-lead">Here&#39;s how you can partner with me:</p>\n' +
      (objectiveFirstPerson ? "    <p>" + escapeHtml(objectiveFirstPerson) + "</p>\n" : "") +
      '    <a class="cta" href="' + mailHref + '">Get in touch</a>\n' +
      "  </section>\n" +
      "  " + buildPhotoSection().replace(/\n/g, "\n  ") + "\n" +
      "</main>\n" +
      '<footer class="site-footer">\n' +
      "  <p>Site generated with Apostello Comm</p>\n" +
      "</footer>\n" +
      "</body>\n" +
      "</html>\n"
    );
  }

  var SITE_CSS =
    ":root{--ink:#20262b;--muted:#5c6670;--bg:#faf6f0;--panel:#ffffff;--teal:#1f4d47;" +
    "--teal-dark:#163a35;--terracotta:#c1553d;--line:#e6dfd3;}" +
    "*{box-sizing:border-box;}" +
    "body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;" +
    "background:var(--bg);color:var(--ink);line-height:1.55;}" +
    "h1,h2{font-family:Georgia,'Iowan Old Style','Palatino Linotype',serif;margin:0;}" +
    ".hero{background:linear-gradient(160deg,var(--teal),var(--teal-dark));color:#fdf9f3;" +
    "padding:4rem 1.5rem 3.5rem;text-align:center;}" +
    ".hero .eyebrow{text-transform:uppercase;letter-spacing:.14em;font-size:.75rem;color:#d9c9b8;margin:0 0 .9rem;}" +
    ".hero h1{font-size:2.4rem;margin-bottom:.6rem;}" +
    ".hero .badge{display:inline-block;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.35);" +
    "border-radius:999px;padding:.3rem .9rem;font-size:.85rem;margin-bottom:1rem;}" +
    ".hero .hook{max-width:34rem;margin:0 auto;font-size:1.1rem;color:#f1e8dc;}" +
    ".container{max-width:640px;margin:0 auto;padding:0 1.5rem;}" +
    ".section{background:var(--panel);border:1px solid var(--line);border-radius:12px;" +
    "padding:2rem;margin-top:-2.5rem;position:relative;z-index:1;margin-bottom:1.75rem;}" +
    ".section h2{font-size:1.3rem;color:var(--teal-dark);margin-bottom:.9rem;" +
    "border-bottom:2px solid var(--terracotta);display:inline-block;padding-bottom:.25rem;}" +
    ".section p{margin:0 0 .75rem;color:var(--ink);}" +
    ".sent-by{color:var(--muted);font-size:.9rem;font-style:italic;}" +
    ".where{margin-top:0;}" +
    ".location{display:flex;align-items:center;gap:.5rem;font-size:1.05rem;color:var(--teal-dark);font-weight:600;}" +
    ".pin{flex-shrink:0;color:var(--terracotta);}" +
    ".cta{display:inline-block;background:var(--terracotta);color:#fff;text-decoration:none;" +
    "font-weight:600;padding:.75rem 1.6rem;border-radius:999px;margin-top:.4rem;}" +
    ".cta:hover{background:#a8462f;}" +
    ".photo-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:.9rem;}" +
    ".photo-slot{aspect-ratio:4/3;border-radius:8px;border:1.5px dashed var(--line);" +
    "background:repeating-linear-gradient(45deg,#f2ece2,#f2ece2 10px,#ece4d6 10px,#ece4d6 20px);" +
    "display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:.85rem;}" +
    ".site-footer{text-align:center;color:var(--muted);font-size:.8rem;padding:2rem 1rem 3rem;}" +
    "@media (max-width:520px){.hero{padding:3rem 1.25rem 3rem;}.hero h1{font-size:1.9rem;}" +
    ".section{padding:1.5rem;margin-top:-1.5rem;}}";

  function showDecision(security) {
    var lines = [];
    lines.push('<div class="row"><strong>SecuritySensitive:</strong> ' + (security.sensitive ? "YES" : "NO") + "</div>");
    if (security.sensitive) {
      lines.push('<div class="row"><strong>Country shown:</strong> ' + (security.allowCountry ? "yes" : "no (not explicitly permitted)") + "</div>");
      lines.push('<div class="row"><strong>City shown:</strong> ' + (security.allowCity ? "yes" : "no (not explicitly permitted)") + "</div>");
    }
    securityDecision.innerHTML = lines.join("");
    securityDecision.hidden = false;
  }

  function reset() {
    parseError.textContent = "";
    blockedMessage.hidden = true;
    securityDecision.hidden = true;
    successPanel.hidden = true;
    actionStatus.textContent = "";
  }

  generateBtn.addEventListener("click", function () {
    reset();

    var fields;
    try {
      fields = parseRow(tsvInput.value);
    } catch (err) {
      parseError.textContent = err.message;
      return;
    }

    var security = evaluateSecurityGate(fields);

    if (security.blocked) {
      blockedMessage.textContent = security.reason;
      blockedMessage.hidden = false;
      return;
    }

    showDecision(security);

    currentHtml = buildSiteHtml(fields, security);
    currentFileName = slug(fields.FirstName + "-" + fields.LastName) + "-site.html";

    htmlOutput.value = currentHtml;
    preview.srcdoc = currentHtml;
    successPanel.hidden = false;
  });

  copyHtmlBtn.addEventListener("click", function () {
    if (!currentHtml) return;
    navigator.clipboard.writeText(currentHtml).then(function () {
      actionStatus.textContent = "HTML copied.";
    }, function () {
      actionStatus.textContent = "Copy failed — select the text and copy manually.";
    });
  });

  downloadBtn.addEventListener("click", function () {
    if (!currentHtml) return;
    var blob = new Blob([currentHtml], { type: "text/html" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = currentFileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });
})();
