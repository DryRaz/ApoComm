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
  var clientSearch = document.getElementById("client-search");
  var clientResults = document.getElementById("client-results");
  var backendWarning = document.getElementById("backend-warning");
  var photoPicker = document.getElementById("photo-picker");
  var photoGrid = document.getElementById("photo-grid");
  var photoEmpty = document.getElementById("photo-empty");
  var parseError = document.getElementById("parse-error");
  var generateBtn = document.getElementById("generate-btn");
  var blockedMessage = document.getElementById("blocked-message");
  var securityDecision = document.getElementById("security-decision");
  var successPanel = document.getElementById("success-panel");
  var preview = document.getElementById("preview");
  var htmlOutput = document.getElementById("html-output");
  var saveInstruction = document.getElementById("save-path-instruction");
  var copyHtmlBtn = document.getElementById("copy-html-btn");
  var downloadBtn = document.getElementById("download-btn");
  var actionStatus = document.getElementById("action-status");

  var currentHtml = "";
  var currentFileName = "index.html";

  // ---- shared client lookup (backend-first, same convention across all
  // 4 tools) — searchByName against the shared backend first; falls back
  // to the localStorage cache only if that call fails or returns nothing.
  // Once a result is selected, the full row is re-fetched via getClient
  // rather than trusting whatever the search step returned. ------------

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

  // ---- photo picker: fetched via listPhotos once a client is selected
  // through the name search (not on a manual TSV paste — there's no
  // ClientID to key the lookup on until a client is actually resolved).
  // slotAssignments tracks which selected photo (by viewUrl) fills which
  // of the 5 generated-site slots; buildSiteHtml reads it at generation
  // time in place of the placeholder-only photoSlotHtml() calls. ---------

  var SLOT_LABELS = {
    hero: "Hero (full-bleed)",
    about: "About section",
    gallery1: "Gallery 1",
    gallery2: "Gallery 2",
    gallery3: "Gallery 3 (optional)"
  };
  var slotAssignments = { hero: "", about: "", gallery1: "", gallery2: "", gallery3: "" };
  var currentRegFields = null;
  var photoToken = 0;

  function isSecuritySensitive(fields) {
    return !!fields && fields.SecuritySensitive.trim().toUpperCase() === "YES";
  }

  function slotSelectFor(photo) {
    var select = document.createElement("select");
    select.dataset.photoUrl = photo.viewUrl;
    var noneOpt = document.createElement("option");
    noneOpt.value = "";
    noneOpt.textContent = "Not used";
    select.appendChild(noneOpt);
    Object.keys(SLOT_LABELS).forEach(function (slotKey) {
      var opt = document.createElement("option");
      opt.value = slotKey;
      opt.textContent = SLOT_LABELS[slotKey];
      select.appendChild(opt);
    });
    select.addEventListener("change", function () {
      var chosenSlot = select.value;
      // A slot can only hold one photo — clear this photo out of any slot
      // it previously held, then (if a slot was chosen) claim it, resetting
      // whichever other photo's dropdown previously claimed that slot.
      Object.keys(slotAssignments).forEach(function (k) {
        if (slotAssignments[k] === photo.viewUrl) slotAssignments[k] = "";
      });
      if (chosenSlot) {
        var previousUrl = slotAssignments[chosenSlot];
        if (previousUrl && previousUrl !== photo.viewUrl) {
          var previousSelect = photoGrid.querySelector('select[data-photo-url="' + previousUrl.replace(/"/g, '\\"') + '"]');
          if (previousSelect) previousSelect.value = "";
        }
        slotAssignments[chosenSlot] = photo.viewUrl;
      }
    });
    return select;
  }

  function renderPhotos(photos, sensitive) {
    photoGrid.innerHTML = "";
    slotAssignments = { hero: "", about: "", gallery1: "", gallery2: "", gallery3: "" };
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
      controls.appendChild(slotSelectFor(photo));

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
      tsvInput.value = result.fields ? ApoComm.regFieldsToBackendRow(result.fields).join("\t") : client.raw;
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
        reason: "We can't generate this site quite yet. Because of what's on this profile, a team member needs to take a quick, careful look first — this keeps the missionary safe, and won't take long. Check back once that review is done."
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

  // Bold full-width typographic statement rather than the earlier
  // pin-icon line — same allow-gating as before, byte-for-byte: if
  // neither field is permitted, the section is omitted entirely.
  function buildWhereSection(fields, security) {
    if (!security.allowCountry && !security.allowCity) return "";
    var parts = [];
    if (security.allowCity && fields.CityOfService) parts.push(escapeHtml(fields.CityOfService));
    if (security.allowCountry && fields.CountryOfService) parts.push(escapeHtml(fields.CountryOfService));
    if (parts.length === 0) return "";
    return (
      '<section class="statement">\n' +
      '  <p class="statement-label">Where I Serve</p>\n' +
      '  <h2 class="statement-text">' + parts.join(", ") + "</h2>\n" +
      "</section>"
    );
  }

  // A real <img> when a photo was picked for this slot (see the photo
  // picker above); otherwise the original placeholder div (unchanged
  // convention — there's no photo hosting for a client with no Drive
  // photos yet, so a human pastes in a real <img> later) preceded by an
  // HTML comment marking exactly where. Either way the grayscale
  // treatment is applied via CSS to `.photo-slot img`, so a picked photo
  // is grayscaled automatically, same as a manually-pasted one.
  function photoSlotHtml(note, viewUrl) {
    if (viewUrl) {
      return (
        "<!-- " + note + " -->\n" +
        '<div class="photo-slot"><img src="' + escapeHtml(viewUrl) + '" alt=""></div>'
      );
    }
    return (
      "<!-- " + note + " -->\n" +
      '<div class="photo-slot"><span>Photo</span></div>'
    );
  }

  // Two more grayscale slots woven into the page as an asymmetric band
  // (one larger + two smaller, stacked) rather than a separate uniform
  // gallery grid — keeps the same split-screen visual rhythm as the rest
  // of the page instead of reading like a bolted-on gallery.
  function buildPhotoSection(slots) {
    var main = photoSlotHtml("PHOTO 3: replace this placeholder div with e.g. <img src=\"https://...\" alt=\"...\">", slots.gallery1);
    var side1 = photoSlotHtml("PHOTO 4: replace this placeholder div with e.g. <img src=\"https://...\" alt=\"...\">", slots.gallery2);
    var side2 = photoSlotHtml("PHOTO 5 (optional): replace this placeholder div with e.g. <img src=\"https://...\" alt=\"...\">", slots.gallery3);
    return (
      '<section class="photo-band">\n' +
      '  <div class="photo-band-main">\n' +
      "    " + main.replace(/\n/g, "\n    ") + "\n" +
      "  </div>\n" +
      '  <div class="photo-band-side">\n' +
      "    " + side1.replace(/\n/g, "\n    ") + "\n" +
      "    " + side2.replace(/\n/g, "\n    ") + "\n" +
      "  </div>\n" +
      "</section>"
    );
  }

  function buildSiteHtml(fields, security, slots) {
    slots = slots || { hero: "", about: "", gallery1: "", gallery2: "", gallery3: "" };
    var fullName = (fields.FirstName + " " + fields.LastName).trim();
    var firstName = fields.FirstName.trim();
    var title = escapeHtml(fullName) + " — Apostello Comm";
    var summaryFirstPerson = toFirstPerson(fields.MissionSummary, fields.FirstName, fields.LastName);
    var objectiveFirstPerson = toFirstPerson(fields.MainObjective, fields.FirstName, fields.LastName);
    var hook = escapeHtml(hookLine(summaryFirstPerson));
    var mailHref = "mailto:" + encodeURIComponent(fields.Email).replace(/%40/g, "@");

    var whereSection = buildWhereSection(fields, security);

    var heroPhoto = photoSlotHtml("PHOTO 1 (hero, full-bleed): replace this placeholder div with e.g. <img src=\"https://...\" alt=\"...\">", slots.hero);
    var aboutPhoto = photoSlotHtml("PHOTO 2: replace this placeholder div with e.g. <img src=\"https://...\" alt=\"...\">", slots.about);

    // Slim bar overlaid directly on the hero photo (not a separate
    // header element) — a small text mark plus the one contact CTA the
    // whole page needs.
    var heroSection =
      '<header class="hero">\n' +
      '  <div class="hero-photo">\n' +
      "    " + heroPhoto.replace(/\n/g, "\n    ") + "\n" +
      "  </div>\n" +
      '  <div class="hero-top">\n' +
      '    <span class="mark">Apostello Comm &times; ' + escapeHtml(firstName) + "&#39;s Site</span>\n" +
      '    <a class="pill pill-solid" href="' + mailHref + '">Get in touch</a>\n' +
      "  </div>\n" +
      '  <div class="hero-content">\n' +
      (fields.MinistryType ? '    <p class="eyebrow">' + escapeHtml(fields.MinistryType) + "</p>\n" : "") +
      "    <h1>" + escapeHtml(fullName) + "</h1>\n" +
      (hook ? '    <p class="hook">' + hook + "</p>\n" : "") +
      "  </div>\n" +
      "</header>";

    // 50/50 split: grayscale photo one side, sage color block with the
    // first-person mission summary on the other.
    var aboutSection =
      '<section class="split about">\n' +
      '  <div class="split-photo">\n' +
      "    " + aboutPhoto.replace(/\n/g, "\n    ") + "\n" +
      "  </div>\n" +
      '  <div class="split-block sage">\n' +
      "    <h2>About Me</h2>\n" +
      "    <p>" + escapeHtml(summaryFirstPerson) + "</p>\n" +
      (fields.SendingOrganization
        ? '    <p class="sent-by">Sent by ' + escapeHtml(fields.SendingOrganization) + "</p>\n"
        : "") +
      "  </div>\n" +
      "</section>";

    // Closing coral color-block: MainObjective itself is the headline
    // (not buried under a generic label), one pill CTA, mailto — never
    // raw visible email text.
    var ctaSection =
      '<section class="cta-section">\n' +
      '  <p class="cta-label">Get Involved</p>\n' +
      '  <h2 class="cta-headline">' + (objectiveFirstPerson ? escapeHtml(objectiveFirstPerson) : "Partner with me") + "</h2>\n" +
      '  <a class="pill pill-dark" href="' + mailHref + '">Partner With Me</a>\n' +
      "</section>";

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
      heroSection + "\n" +
      "<main>\n" +
      "  " + aboutSection.replace(/\n/g, "\n  ") + "\n" +
      (whereSection ? "  " + whereSection.replace(/\n/g, "\n  ") + "\n" : "") +
      "  " + buildPhotoSection(slots).replace(/\n/g, "\n  ") + "\n" +
      "  " + ctaSection.replace(/\n/g, "\n  ") + "\n" +
      "</main>\n" +
      '<footer class="site-footer">\n' +
      "  <p>Site generated with Apostello Comm</p>\n" +
      "</footer>\n" +
      "</body>\n" +
      "</html>\n"
    );
  }

  // Bold editorial/industrial template — grayscale photography, coral +
  // sage color blocking, condensed-feeling all-caps headlines. No
  // external font/CDN loads (same single-portable-file constraint as
  // before): "headline" leans on a genuinely common system heavy sans
  // (Arial Black) with tight letter-spacing and uppercase to read as
  // condensed/industrial even where that exact font isn't installed.
  var SITE_CSS =
    ":root{--coral:#E8623A;--coral-dark:#c94f2c;--sage:#5C6E5A;--ink:#1A1A1A;--white:#fff;" +
    "--headline:'Arial Black','Helvetica Neue',Arial,sans-serif;" +
    "--body:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;}" +
    "*{box-sizing:border-box;}" +
    "body{margin:0;font-family:var(--body);color:var(--ink);line-height:1.65;background:var(--white);}" +
    "h1,h2{font-family:var(--headline);margin:0;text-transform:uppercase;letter-spacing:-.02em;font-weight:900;}" +
    "p{margin:0 0 1rem;}" +
    "a{color:inherit;}" +
    // Placeholder photo slots — no photo hosting in this pipeline, so a
    // human pastes a real <img> in later (see the HTML comments); the
    // grayscale filter applies to that future <img> automatically.
    ".photo-slot{width:100%;height:100%;min-height:220px;display:flex;align-items:center;justify-content:center;" +
    "background:repeating-linear-gradient(135deg,#2c2c2c,#2c2c2c 12px,#1a1a1a 12px,#1a1a1a 24px);" +
    "color:rgba(255,255,255,.55);font-family:var(--body);font-size:.78rem;letter-spacing:.1em;text-transform:uppercase;}" +
    ".photo-slot img{width:100%;height:100%;object-fit:cover;display:block;filter:grayscale(100%);}" +
    // Hero: full-bleed photo, dark gradient scrim for legible overlaid
    // text, slim top bar (mark + contact pill) laid directly on the photo.
    ".hero{position:relative;min-height:92vh;display:flex;flex-direction:column;color:var(--white);overflow:hidden;}" +
    ".hero-photo{position:absolute;inset:0;z-index:0;}" +
    ".hero-photo .photo-slot{min-height:100%;}" +
    ".hero::after{content:'';position:absolute;inset:0;z-index:1;" +
    "background:linear-gradient(180deg,rgba(26,26,26,.4) 0%,rgba(26,26,26,.1) 35%,rgba(26,26,26,.88) 100%);}" +
    ".hero-top,.hero-content{position:relative;z-index:2;}" +
    ".hero-top{display:flex;justify-content:space-between;align-items:center;gap:1rem;padding:1.5rem;}" +
    ".hero-top .mark{font-size:.72rem;letter-spacing:.12em;text-transform:uppercase;font-weight:600;}" +
    ".hero-content{margin-top:auto;padding:2rem 1.5rem 3.5rem;}" +
    ".hero-content .eyebrow{display:inline-block;background:var(--coral);color:var(--white);font-size:.72rem;" +
    "font-weight:700;letter-spacing:.1em;text-transform:uppercase;padding:.35rem .9rem;border-radius:999px;margin-bottom:1.1rem;}" +
    ".hero-content h1{font-size:clamp(2.4rem,9vw,5.5rem);line-height:.95;margin-bottom:1rem;}" +
    ".hero-content .hook{max-width:34rem;font-size:1.15rem;font-family:var(--body);text-transform:none;" +
    "letter-spacing:normal;font-weight:400;color:rgba(255,255,255,.92);margin:0;}" +
    // Pills — solid coral everywhere except when sitting on a coral
    // background itself (the closing CTA), where it inverts to near-black
    // for contrast; ghost variant for the hero top bar over the photo.
    ".pill{display:inline-block;font-family:var(--body);font-weight:700;text-transform:uppercase;" +
    "letter-spacing:.06em;font-size:.78rem;padding:.75rem 1.6rem;border-radius:999px;text-decoration:none;" +
    "border:2px solid transparent;white-space:nowrap;}" +
    ".pill-solid{background:var(--coral);color:var(--white);}" +
    ".pill-solid:hover{background:var(--coral-dark);}" +
    ".pill-dark{background:var(--ink);color:var(--white);}" +
    ".pill-dark:hover{background:#000;}" +
    // 50/50 split section (About/Mission): photo one side, color block
    // with white text the other.
    ".split{display:grid;grid-template-columns:1fr 1fr;min-height:520px;}" +
    ".split-photo{position:relative;min-height:320px;}" +
    ".split-block{display:flex;flex-direction:column;justify-content:center;padding:3.5rem 3rem;color:var(--white);}" +
    ".split-block.sage{background:var(--sage);}" +
    ".split-block h2{font-size:clamp(1.8rem,3.5vw,2.6rem);margin-bottom:1.25rem;}" +
    ".split-block p{font-family:var(--body);text-transform:none;letter-spacing:normal;font-weight:400;" +
    "font-size:1.05rem;line-height:1.75;}" +
    ".split-block .sent-by{font-size:.9rem;opacity:.85;font-style:italic;margin-bottom:0;}" +
    // Where I serve: bold full-width typographic statement, near-black.
    ".statement{background:var(--ink);color:var(--white);text-align:center;padding:5rem 1.5rem;}" +
    ".statement-label{font-family:var(--body);text-transform:uppercase;letter-spacing:.14em;font-size:.78rem;" +
    "font-weight:600;color:rgba(255,255,255,.6);margin-bottom:1rem;}" +
    ".statement-text{font-size:clamp(2.4rem,8vw,5rem);line-height:1;}" +
    // Photo band: one larger slot + two stacked smaller ones, woven in
    // with the same visual language as the splits rather than a grid.
    ".photo-band{display:grid;grid-template-columns:2fr 1fr;gap:.5rem;padding:.5rem;background:var(--white);}" +
    ".photo-band-main{min-height:420px;position:relative;}" +
    ".photo-band-side{display:grid;grid-template-rows:1fr 1fr;gap:.5rem;}" +
    ".photo-band-side .photo-slot{min-height:206px;}" +
    // Closing CTA: full-bleed coral block, MainObjective as the headline.
    ".cta-section{background:var(--coral);color:var(--white);text-align:center;padding:5.5rem 1.5rem;}" +
    ".cta-label{font-family:var(--body);text-transform:uppercase;letter-spacing:.14em;font-size:.78rem;" +
    "font-weight:700;margin-bottom:1rem;}" +
    ".cta-headline{font-size:clamp(2rem,6vw,3.5rem);max-width:44rem;margin:0 auto 2.25rem;line-height:1.05;}" +
    ".site-footer{text-align:center;padding:2rem 1rem;font-size:.78rem;color:#8a8a8a;font-family:var(--body);" +
    "text-transform:none;letter-spacing:normal;background:var(--white);}" +
    "@media (max-width:760px){" +
    ".split{grid-template-columns:1fr;min-height:0;}" +
    ".split-photo{min-height:280px;}" +
    ".split-block{padding:2.5rem 1.5rem;}" +
    ".photo-band{grid-template-columns:1fr;}" +
    ".photo-band-main{min-height:260px;}" +
    ".photo-band-side .photo-slot{min-height:180px;}" +
    ".hero-content h1{font-size:clamp(2.25rem,12vw,3rem);}" +
    ".hero-top{padding:1.1rem;}" +
    ".statement,.cta-section{padding:3.5rem 1.25rem;}" +
    "}";

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
    saveInstruction.innerHTML = "";
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

    currentHtml = buildSiteHtml(fields, security, slotAssignments);
    currentFileName = "index.html";

    var savePath = "/sites/" + (fields.ClientID || slug(fields.FirstName + "-" + fields.LastName)) + "/index.html";
    saveInstruction.innerHTML = "Save this file as <code>" + escapeHtml(savePath) + "</code> in the repository.";

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
