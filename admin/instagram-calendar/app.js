(function () {
  "use strict";

  var REG_COLUMNS = [
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

  var INTAKE_COLUMNS = [
    "ClientID", "IsFirstNewsletter", "Events", "MeetingsSummary", "PrayerNeeds",
    "UpcomingProjects", "NumbersUpdate", "NewPhotoLinks", "AnythingToAvoid", "SubmissionDate"
  ];

  // Events/PrayerNeeds/UpcomingProjects are semicolon-joined lists (see
  // newsletter-intake); any number of entries, including zero.
  function splitList(raw) {
    return raw.split(/;+/).map(function (s) { return s.trim(); }).filter(Boolean);
  }

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

  // Reads every saved registration row and pulls out just enough (name,
  // country) to build a human-friendly, disambiguated label — the raw
  // ClientID (APC-YYYY-000) is never shown to the operator, only used
  // internally once a result is picked.
  function listSavedClients() {
    var clients = [];
    for (var i = 0; i < localStorage.length; i++) {
      var key = localStorage.key(i);
      var m = /^apocomm_client_(.+)$/.exec(key);
      if (!m || /_intake_\d{4}-\d{2}$/.test(m[1])) continue;
      var raw = localStorage.getItem(key);
      var cols = raw.split("\t");
      clients.push({
        clientId: m[1],
        lastName: (cols[3] || "").trim(),
        firstName: (cols[4] || "").trim(),
        country: (cols[10] || "").trim(),
        raw: raw
      });
    }
    assignDisambiguatedLabels(clients);
    clients.sort(function (a, b) { return a.label.localeCompare(b.label); });
    return clients;
  }

  // Two clients sharing a name get "FirstName LastName (Country)" if
  // their countries are all different, otherwise "FirstName LastName
  // (last 4 of ClientID)" — country is preferred since it's what the
  // spec asks for and reads more usefully than an opaque ID fragment.
  function assignDisambiguatedLabels(clients) {
    var byName = {};
    clients.forEach(function (c) {
      var name = (c.firstName + " " + c.lastName).trim() || c.clientId;
      c._name = name;
      (byName[name] = byName[name] || []).push(c);
    });
    Object.keys(byName).forEach(function (name) {
      var group = byName[name];
      if (group.length === 1) {
        group[0].label = name;
        return;
      }
      var countries = group.map(function (g) { return g.country; });
      var countriesUsable = countries.every(Boolean) && new Set(countries).size === group.length;
      group.forEach(function (c) {
        c.label = countriesUsable ? name + " (" + c.country + ")" : name + " (" + c.clientId.slice(-4) + ")";
      });
    });
  }

  function listSavedMonths(clientId) {
    var prefix = "apocomm_client_" + clientId + "_intake_";
    var months = [];
    for (var i = 0; i < localStorage.length; i++) {
      var key = localStorage.key(i);
      if (key.indexOf(prefix) === 0) months.push(key.slice(prefix.length));
    }
    return months.sort().reverse();
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

  function refreshMonthSelect() {
    var clientId = currentClientIdFromRegInput();
    var months = clientId ? listSavedMonths(clientId) : [];
    populateSelect(monthSelect, months, "-- Paste manually, or pick a saved month --");
  }

  var clientMap = {};
  var activeResultIndex = -1;

  function renderClientResults(query) {
    var all = listSavedClients();
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

  // Saves under the intake row's own ClientID (not necessarily whatever
  // is currently in reg-input) — that's the record this intake actually
  // belongs to, mismatch-warning notwithstanding.
  function saveIntakeRow(intakeFields) {
    var clientId = intakeFields.ClientID;
    var month = (/^\d{4}-\d{2}/.exec(intakeFields.SubmissionDate) || [])[0];
    if (!clientId || !month) return;
    var row = INTAKE_COLUMNS.map(function (c) { return intakeFields[c] || ""; }).join("\t");
    try {
      localStorage.setItem("apocomm_client_" + clientId + "_intake_" + month, row);
    } catch (e) { /* ignore storage errors (e.g. private browsing) */ }
  }

  // ---- parsing (same fixed logic as the other generators) -------------

  function firstNonBlankLine(raw) {
    var lines = raw.split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].trim() !== "") return lines[i];
    }
    return "";
  }

  function parseRow(raw, columns, label) {
    var line = firstNonBlankLine(raw);
    var cols = line.split("\t");
    if (cols.length !== columns.length) {
      throw new Error(
        label + ": expected " + columns.length + " tab-separated columns, got " + cols.length + "."
      );
    }
    var fields = {};
    columns.forEach(function (name, i) { fields[name] = (cols[i] || "").trim(); });
    return fields;
  }

  // ---- security gate & topic allow-list (same scanner as the other generators) ----

  function segmentsOf(text) {
    return text.split(/[.;\n]+/).map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean);
  }

  var NEGATION_WORDS = ["not", "never", "don't", "do not", "cannot", "can't", "no "];
  var ALLOW_WORDS = [
    "ok", "okay", "allow", "allowed", "permit", "permitted", "approved",
    "share", "shared", "show", "shown", "disclose", "publish", "include", "fine"
  ];

  function clauseAllowsAny(clause, keywords) {
    var mentionsTopic = keywords.some(function (k) { return clause.indexOf(k) !== -1; });
    if (!mentionsTopic) return false;
    var negated = NEGATION_WORDS.some(function (w) { return clause.indexOf(w) !== -1; });
    if (negated) return false;
    return ALLOW_WORDS.some(function (w) { return clause.indexOf(w) !== -1; });
  }

  function isTopicAllowed(instructions, keywords) {
    var clauses = segmentsOf(instructions);
    return clauses.some(function (clause) { return clauseAllowsAny(clause, keywords); });
  }

  var TOPICS = {
    highlights: ["highlight", "event", "events"],
    prayer: ["prayer"],
    looking_ahead: ["upcoming", "project", "looking ahead"],
    numbers: ["numbers", "stats", "progress"]
  };

  function evaluateSecurityGate(regFields) {
    var sensitive = regFields.SecuritySensitive.trim().toUpperCase() === "YES";
    var instructions = regFields.SecurityInstructions.trim();

    if (!sensitive) {
      return { blocked: false, sensitive: false, allow: { highlights: true, prayer: true, looking_ahead: true, numbers: true } };
    }

    if (!instructions) {
      return {
        blocked: true,
        reason: "Cannot generate — this profile requires human security validation first."
      };
    }

    var allow = {};
    Object.keys(TOPICS).forEach(function (key) {
      allow[key] = isTopicAllowed(instructions, TOPICS[key]);
    });

    return { blocked: false, sensitive: true, allow: allow };
  }

  // ---- AnythingToAvoid scrubbing (same as newsletter generator) -------

  function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function applyAvoidList(text, avoidRaw) {
    var terms = avoidRaw.split(/[;\n]+/).map(function (t) { return t.trim(); }).filter(Boolean);
    var applied = [];
    var result = text;
    terms.forEach(function (term) {
      var re = new RegExp(escapeRegex(term), "gi");
      var found = re.test(result);
      if (found) {
        result = result.replace(re, "")
          .replace(/[ \t]{2,}/g, " ")
          .replace(/ +([.,!?;:])/g, "$1")
          .replace(/ +\n/g, "\n")
          .replace(/\n{3,}/g, "\n\n");
      }
      applied.push({ term: term, found: found });
    });
    return { text: result.trim(), applied: applied };
  }

  // ---- first-person conversion (same as site/newsletter generators) ---

  function capIfSentenceStart(word, offset, string) {
    var before = string.slice(0, offset);
    var atStart = before.length === 0 || /[.!?]["')\]]*\s+$/.test(before);
    return atStart ? word.charAt(0).toUpperCase() + word.slice(1) : word;
  }

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

  function detectLanguage(primaryLanguage) {
    var v = (primaryLanguage || "").trim().toLowerCase();
    if (/fran|français|francais/.test(v)) return "french";
    if (/span|español|espanol/.test(v)) return "spanish";
    if (/portug|português/.test(v)) return "portuguese";
    return "english";
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // ---- format library ---------------------------------------------------

  var FORMAT_META = {
    viral: "Viral / Hook",
    educational: "Educational",
    pov: "POV",
    quote_stat: "Quote / Stat Card",
    bts: "Behind-the-Scenes",
    prayer_focused: "Prayer-Focused",
    engagement: "Engagement / Question"
  };

  // Categories in the monthly topic pool. `meetings` (MeetingsSummary) is
  // its own pool entry per the spec, but reuses the `numbers` caption
  // templates/format preference — both are single rollup stats rather
  // than itemized lists, so a dedicated template set would be redundant.
  var CATEGORY_LABEL = {
    highlights: "Event",
    prayer: "Prayer Need",
    looking_ahead: "Upcoming Project",
    numbers: "Numbers Update",
    meetings: "Meetings Summary"
  };

  // Format→topic compatibility and per-category preference order used
  // when filling the schedule. prayer_focused is the one hard exclusivity
  // rule from the spec ("only ever pulls from PrayerRequest"); every
  // other format is open to any category, with a preference order that
  // leads with the "sensible" fit called out in the spec (BTS/POV/viral/
  // educational for events, quote/stat for numbers) before falling back
  // to the rest.
  var FORMAT_PREFERENCE = {
    highlights: ["bts", "pov", "viral", "educational", "quote_stat", "engagement"],
    numbers: ["quote_stat", "viral", "educational", "engagement", "bts", "pov"],
    meetings: ["quote_stat", "educational", "engagement", "viral", "bts", "pov"],
    prayer: ["prayer_focused", "engagement", "bts", "pov", "viral", "educational", "quote_stat"],
    looking_ahead: ["educational", "engagement", "viral", "pov", "bts", "quote_stat"]
  };

  // Graphic direction is keyed by format only (not topic/language) — it's
  // an instruction to whoever designs the actual image, not reader-facing
  // copy, so one description per format is enough.
  var GRAPHIC_NOTES = {
    viral: "Photo suggestion: your favorite shot from the moment — bright, high-contrast, cropped tight for a scroll-stopping thumbnail.",
    educational: "Graphic suggestion: a simple text-over-photo slide explaining the context, for someone new to your page.",
    pov: "Photo suggestion: a wide, immersive, eye-level shot so it feels like the viewer is standing there with you.",
    quote_stat: "Graphic: minimal quote/stat card — this line alone, large centered text, plain brand-consistent background.",
    bts: "Photo suggestion: a candid, unposed shot — setup, cleanup, or an in-between moment, not the polished highlight photo.",
    prayer_focused: "Graphic: quiet, minimal design — plain background, small \"PRAYER REQUEST\" label above the line as the main text.",
    engagement: "Graphic suggestion: the topic photo with room left for a text overlay of the closing question."
  };

  // Caption templates never introduce a new fact, number, name, date, or
  // event — every function below wraps the missionary's own (unaltered,
  // already first-person) sentence in fixed framing/reflection/address
  // text. The framing is what varies by format; the substance is always
  // exactly what the missionary wrote.
  var TEMPLATES = {
    english: {
      highlights: {
        viral: function (s) { return "Okay, I have to tell you about this one. " + s + " I'm still smiling about it, and I wanted you to be among the first to know."; },
        educational: function (s) { return "Something I don't always explain well in these updates: " + s + " Moments like this are actually a normal part of what ministry here looks like day to day — less about grand plans, more about showing up consistently and staying ready."; },
        pov: function (s) { return "Picture this with me for a second: " + s + " Now imagine standing right next to me in that exact moment — that's genuinely what it felt like, and I wanted to bring you into it instead of just reporting it after the fact."; },
        quote_stat: function (s) { return s; },
        bts: function (s) { return "Here's the part you don't usually see: " + s + " There was a lot of ordinary, unglamorous prep behind that moment — the setup, the small logistics, the waiting — and I think that's just as worth sharing as the highlight itself."; },
        engagement: function (s) { return s + " I'd love to know — has something small like this ever ended up mattering way more than you expected? Tell me in the comments."; }
      },
      looking_ahead: {
        educational: function (s) { return "Something I don't always slow down to explain: " + s + " I like giving you a heads-up on what's ahead, not just a recap of what's already happened, since it means you can actually be part of it as it unfolds instead of only hearing about it afterward."; },
        engagement: function (s) { return s + " I'd love to know — is there something you're looking forward to right now too? Tell me in the comments."; },
        viral: function (s) { return "Okay, I have to tell you what's coming up. " + s + " I'm genuinely excited (and a little nervous) about this one, and I wanted you to know before it happens, not just after."; },
        pov: function (s) { return "Picture this with me for a second: " + s + " I don't know exactly how it'll go yet, but I wanted to bring you into the anticipation of it with me instead of only telling you the outcome later."; },
        bts: function (s) { return "Here's something most people don't see yet: " + s + " Right now it's still mostly planning, logistics, and a lot of small decisions behind the scenes — nothing photogenic yet, but it's real work."; },
        quote_stat: function (s) { return s; }
      },
      numbers: {
        viral: function (s) { return "A number I wasn't expecting to share yet: " + s + " It's a small milestone, but it's a real one, and I wanted you to see it before it just becomes a line in a spreadsheet."; },
        educational: function (s) { return "A quick behind-the-numbers note: " + s + " Figures like this usually represent a lot of individual conversations and small decisions adding up over time, not one big dramatic push — worth understanding if you've never been part of something like this before."; },
        pov: function (s) { return "Imagine getting the update I got recently: " + s + " That's the moment I'm bringing you into today — not a big announcement, just a quiet, real one."; },
        quote_stat: function (s) { return s; },
        bts: function (s) { return "Something that doesn't usually make it into an update: " + s + " Behind a number like that is a lot of quiet, ordinary follow-up — messages, conversations, and small check-ins that don't make for exciting photos but absolutely make the difference."; },
        engagement: function (s) { return s + " Numbers like this always make me curious — when's the last time you noticed steady, unglamorous progress paying off in your own life? I'd love to hear about it."; }
      },
      prayer: {
        prayer_focused: function (s) { return "I want to be honest with you about something I'm sitting with right now: " + s + " I'm not just posting this to be observed from a distance — would you actually stop and pray about this with me, right now if you can?"; },
        engagement: function (s) { return s + " If you're the praying type, this is genuinely where I need it most this week. Would you comment \"praying\" so I know I'm not carrying this alone?"; },
        bts: function (s) { return "Not everything I post is a highlight — here's something closer to what an ordinary evening actually looks like for me right now: " + s + " I don't always know how to package that neatly, so I'm just telling you plainly instead."; },
        pov: function (s) { return "For a moment, sit where I'm sitting: " + s + " That's genuinely what's on my mind right now, and I wanted you there with me in it instead of only hearing about it after it's resolved."; },
        viral: function (s) { return "I don't usually lead with this, but: " + s + " I'd rather be honest with you than only show you the highlight reel — if this is something you can carry with me, I'd be genuinely grateful."; },
        educational: function (s) { return "Something worth understanding about this season: " + s + " Needs like this are a completely normal part of a life like mine, even when my updates tend to lean toward the highlights — I wanted to give you the fuller picture."; },
        quote_stat: function (s) { return s; }
      }
    }
  };

  // French/Spanish/Portuguese use one generic template per format, shared
  // across all three topics — same non-fabrication guarantee, less
  // topic-specific nuance than English. Scoped this way to keep the
  // template set maintainable; extend to per-topic wording if needed.
  var GENERIC_TEMPLATES = {
    french: {
      viral: function (s) { return "Il faut que je vous raconte ça : " + s + " Je souris encore rien qu'en y repensant, et je voulais que vous soyez parmi les premiers à le savoir."; },
      educational: function (s) { return "Un petit aparté que je n'explique pas toujours : " + s + " Ce genre de moment fait partie du quotidien ici, même si ça ne ressemble pas toujours à un grand plan bien organisé."; },
      pov: function (s) { return "Imaginez un instant à ma place : " + s + " Voilà exactement ce que ça m'a fait, et je voulais vous y emmener plutôt que de simplement vous le raconter après coup."; },
      quote_stat: function (s) { return s; },
      bts: function (s) { return "Voici ce qu'on ne voit pas d'habitude : " + s + " Il y a eu beaucoup de préparation discrète derrière ce moment, et je trouve que ça mérite d'être partagé aussi."; },
      prayer_focused: function (s) { return "Je veux être honnête avec vous sur ce que je porte en ce moment : " + s + " Est-ce que vous accepteriez de vous arrêter et de prier avec moi pour ça, maintenant si possible ?"; },
      engagement: function (s) { return s + " Et vous — est-ce que ça vous est déjà arrivé de vivre quelque chose de similaire ? Dites-le-moi en commentaire."; }
    },
    spanish: {
      viral: function (s) { return "Tengo que contarte esto: " + s + " Todavía sonrío al pensarlo, y quería que fueras de los primeros en saberlo."; },
      educational: function (s) { return "Algo que no siempre explico bien: " + s + " Momentos así son parte normal del día a día aquí, aunque no siempre se vea como un gran plan organizado."; },
      pov: function (s) { return "Imagínate por un momento en mi lugar: " + s + " Así es exactamente como se sintió, y quise traerte a ese momento en lugar de solo contártelo después."; },
      quote_stat: function (s) { return s; },
      bts: function (s) { return "Esto es lo que normalmente no se ve: " + s + " Detrás de ese momento hubo mucha preparación silenciosa, y creo que también vale la pena compartirla."; },
      prayer_focused: function (s) { return "Quiero ser honesto contigo sobre algo que estoy cargando ahora mismo: " + s + " ¿Podrías detenerte a orar por esto conmigo, ahora si es posible?"; },
      engagement: function (s) { return s + " ¿Y tú? ¿Alguna vez te ha pasado algo parecido? Cuéntamelo en los comentarios."; }
    },
    portuguese: {
      viral: function (s) { return "Preciso te contar isso: " + s + " Ainda sorrio só de lembrar, e quis que você fosse um dos primeiros a saber."; },
      educational: function (s) { return "Algo que nem sempre explico bem: " + s + " Momentos assim fazem parte do dia a dia por aqui, mesmo que não pareçam um grande plano organizado."; },
      pov: function (s) { return "Imagine por um instante no meu lugar: " + s + " Foi exatamente assim que pareceu, e eu quis te trazer para esse momento em vez de só contar depois."; },
      quote_stat: function (s) { return s; },
      bts: function (s) { return "Aqui está o que normalmente não aparece: " + s + " Houve muita preparação silenciosa por trás desse momento, e acho que isso também merece ser compartilhado."; },
      prayer_focused: function (s) { return "Quero ser honesto com você sobre algo que estou carregando agora: " + s + " Você pararia para orar comigo por isso, agora se possível?"; },
      engagement: function (s) { return s + " E você? Já viveu algo parecido? Me conta nos comentários."; }
    }
  };

  function getCaption(lang, category, format, seed) {
    // `meetings` reuses the `numbers` English template set (see
    // CATEGORY_LABEL comment); the generic FR/ES/PT templates are
    // format-keyed only, so no mapping is needed for those.
    if (lang === "english") {
      var templateCategory = category === "meetings" ? "numbers" : category;
      return TEMPLATES.english[templateCategory][format](seed);
    }
    return GENERIC_TEMPLATES[lang][format](seed);
  }

  var HASHTAG_BANK = {
    highlights: ["#MissionaryLife", "#FaithInAction", "#Testimony", "#ThisIsMinistry", "#GodAtWork"],
    prayer: ["#PrayForMe", "#PrayerRequest", "#StandWithMe", "#Intercession"],
    looking_ahead: ["#ComingSoon", "#LookingAhead", "#NextChapter", "#Anticipation"],
    numbers: ["#Milestone", "#Progress", "#Grateful", "#KingdomWork"],
    universal: ["#MissionaryLife", "#SupportMissions", "#PartnerInMinistry"]
  };

  function buildHashtags(category) {
    var bankCategory = category === "meetings" ? "numbers" : category;
    var tags = HASHTAG_BANK[bankCategory].slice(0, 3);
    HASHTAG_BANK.universal.forEach(function (t) {
      if (tags.indexOf(t) === -1 && tags.length < 5) tags.push(t);
    });
    return tags.slice(0, 5);
  }

  // ---- language purity check (defensive) -------------------------------

  // PrimaryLanguage, parsed directly from the pasted registration row, is
  // the sole source of truth for output language (see detectLanguage()) —
  // there is no other input this tool reads that could influence it. This
  // check is an extra guard specifically on the template-authored framing
  // text (the part this tool actually writes): the missionary's own seed
  // sentence is excluded, since flagging their own words as a "language
  // bug" would be wrong — they're free to write their intake answers in
  // whatever language they actually used.
  var NON_ENGLISH_CHARS_RE = /[àâäéèêëîïôöùûüÿçœæñãõ¿¡]/i;
  var ENGLISH_TELLTALES = [" the ", " and ", " you ", " your ", "i'm ", "i am ", "would you", "let me know", "tell me"];

  function checkLanguagePurity(caption, seed, lang) {
    var framingOnly = seed ? caption.split(seed).join(" ") : caption;
    if (lang === "english") {
      if (NON_ENGLISH_CHARS_RE.test(framingOnly)) {
        throw new Error(
          "Language check failed: PrimaryLanguage is English but the generated caption framing contains non-English characters."
        );
      }
    } else {
      var lower = " " + framingOnly.toLowerCase() + " ";
      var hit = ENGLISH_TELLTALES.filter(function (t) { return lower.indexOf(t) !== -1; });
      if (hit.length) {
        throw new Error(
          "Language check failed: PrimaryLanguage is " + lang + " but the generated caption framing contains English (\"" + hit[0].trim() + "\")."
        );
      }
    }
  }

  // ---- pool & scheduling ------------------------------------------------

  var TARGET_POSTS = 16; // 4 weeks x 4 posts/week

  // The monthly topic pool: every individual Event, every individual
  // PrayerNeed, every individual UpcomingProject, plus NumbersUpdate and
  // MeetingsSummary as single rollup entries. MeetingsSummary is gated
  // under the same `highlights` allow-flag as Events, consistent with the
  // newsletter treating it as part of the Highlights topic.
  function buildItemsByCategory(regFields, intakeFields, security) {
    function toItems(rawList, allowed) {
      if (!allowed) return [];
      return splitList(rawList).map(function (raw) {
        return toFirstPerson(raw, regFields.FirstName, regFields.LastName);
      });
    }
    var byCat = {};
    byCat.highlights = toItems(intakeFields.Events, security.allow.highlights);
    byCat.prayer = toItems(intakeFields.PrayerNeeds, security.allow.prayer);
    byCat.looking_ahead = toItems(intakeFields.UpcomingProjects, security.allow.looking_ahead);
    byCat.numbers = (security.allow.numbers && intakeFields.NumbersUpdate.trim())
      ? [toFirstPerson(intakeFields.NumbersUpdate.trim(), regFields.FirstName, regFields.LastName)] : [];
    byCat.meetings = (security.allow.highlights && intakeFields.MeetingsSummary.trim())
      ? [toFirstPerson(intakeFields.MeetingsSummary.trim(), regFields.FirstName, regFields.LastName)] : [];
    return byCat;
  }

  function rotateList(list, n) {
    var k = n % list.length;
    return list.slice(k).concat(list.slice(0, k));
  }

  // Interleaves categories round-robin (rather than all Events, then all
  // PrayerNeeds, ...) so that even the earliest slice of the pool already
  // mixes topics — this is what gives a richer month natural variety
  // across weeks instead of clustering one category together. Each
  // item's preference list is also rotated by its own index within the
  // category: without this, every item in a multi-item category would
  // share the same #1 format (e.g. all four Events opening with the
  // identical "Behind-the-Scenes" framing text in wave 0) — technically
  // non-repeating pairs, but visibly templated. Rotating means four
  // Events instead open with four different formats in wave 0.
  function buildPool(byCat) {
    var order = ["highlights", "prayer", "looking_ahead", "numbers", "meetings"].filter(function (c) { return byCat[c].length > 0; });
    var maxLen = order.reduce(function (m, c) { return Math.max(m, byCat[c].length); }, 0);
    var pool = [];
    for (var i = 0; i < maxLen; i++) {
      order.forEach(function (cat) {
        if (i < byCat[cat].length) {
          var isList = byCat[cat].length > 1;
          pool.push({
            category: cat,
            label: CATEGORY_LABEL[cat] + (isList ? " " + (i + 1) : ""),
            seed: byCat[cat][i],
            prefList: rotateList(FORMAT_PREFERENCE[cat], i)
          });
        }
      });
    }
    return pool;
  }

  // Draws from the real pool before recycling any item onto a second
  // angle: wave 0 gives every distinct pool item its single best-fit
  // format (maximum topic variety first), wave 1 gives every item that
  // still has an unused format a second angle, and so on. A richer month
  // (more real items) fills more of the calendar from wave 0 alone —
  // exactly "more variety, not more repetition." If every item's
  // preference list is exhausted before 16 slots are filled, the
  // schedule simply stops short; callers see that via `target <
  // TARGET_POSTS` and flag it instead of padding or repeating a pair.
  function buildWaves(pool) {
    var maxPref = pool.reduce(function (m, p) { return Math.max(m, p.prefList.length); }, 0);
    var waves = [];
    for (var w = 0; w < maxPref; w++) {
      pool.forEach(function (item) {
        if (w < item.prefList.length) waves.push({ item: item, format: item.prefList[w] });
      });
    }
    return waves;
  }

  // ---- assembly -------------------------------------------------------

  function buildCalendar(regFields, intakeFields, security) {
    var lang = detectLanguage(regFields.PrimaryLanguage);

    var byCat = buildItemsByCategory(regFields, intakeFields, security);
    var pool = buildPool(byCat);
    var waves = buildWaves(pool);
    var target = Math.min(TARGET_POSTS, waves.length);
    var scheduled = waves.slice(0, target);

    var pairsUsed = {}; // category -> [formats]

    var posts = scheduled.map(function (entry, idx) {
      var caption = getCaption(lang, entry.item.category, entry.format, entry.item.seed);
      checkLanguagePurity(caption, entry.item.seed, lang);
      var avoided = applyAvoidList(caption, intakeFields.AnythingToAvoid);
      pairsUsed[entry.item.category] = pairsUsed[entry.item.category] || [];
      pairsUsed[entry.item.category].push(entry.format);
      return {
        index: idx,
        week: Math.floor(idx / 4) + 1,
        slot: (idx % 4) + 1,
        category: entry.item.category,
        label: entry.item.label,
        format: entry.format,
        caption: avoided.text,
        avoidedTerms: avoided.applied.filter(function (a) { return a.found; }),
        hashtags: buildHashtags(entry.item.category),
        graphic: GRAPHIC_NOTES[entry.format]
      };
    });

    var exhausted = target < TARGET_POSTS;

    return {
      posts: posts,
      target: target,
      totalCapacity: waves.length,
      poolSize: pool.length,
      exhausted: exhausted,
      pairsUsed: pairsUsed
    };
  }

  // ---- rendering --------------------------------------------------------

  function renderCalendarHtml(calendar) {
    var weeks = {};
    calendar.posts.forEach(function (p) {
      weeks[p.week] = weeks[p.week] || [];
      weeks[p.week].push(p);
    });

    var html = "";
    Object.keys(weeks).sort(function (a, b) { return a - b; }).forEach(function (weekNum) {
      html += '<div class="week-block"><h3>Week ' + weekNum + "</h3>" + '<div class="post-grid">';
      weeks[weekNum].forEach(function (p) {
        html +=
          '<div class="post-card">' +
          '<div class="meta"><span class="topic-tag ' + p.category + '">' + escapeHtml(p.label) + "</span>" +
          '<span class="format-tag">' + escapeHtml(FORMAT_META[p.format]) + "</span></div>" +
          '<div class="caption">' + escapeHtml(p.caption) + "</div>" +
          '<div class="hashtags">' + escapeHtml(p.hashtags.join(" ")) + "</div>" +
          '<div class="graphic-note">' + escapeHtml(p.graphic) + "</div>" +
          "</div>";
      });
      html += "</div></div>";
    });

    if (calendar.exhausted) {
      html += '<p class="exhaustion-note">Only ' + calendar.target + " of " + TARGET_POSTS +
        " posts could be generated without repeating a topic+format pair or fabricating content. " +
        "<!-- Topic exhausted without fabrication risk --></p>";
    }

    return html;
  }

  function renderCalendarText(calendar) {
    var lines = [];
    var weeks = {};
    calendar.posts.forEach(function (p) {
      weeks[p.week] = weeks[p.week] || [];
      weeks[p.week].push(p);
    });

    Object.keys(weeks).sort(function (a, b) { return a - b; }).forEach(function (weekNum) {
      lines.push("=== WEEK " + weekNum + " ===");
      weeks[weekNum].forEach(function (p) {
        lines.push(
          "Day " + p.slot + " — Topic: " + p.label + " | Format: " + FORMAT_META[p.format]
        );
        lines.push(p.caption);
        lines.push(p.hashtags.join(" "));
        lines.push("Graphic: " + p.graphic);
        lines.push("");
      });
    });

    if (calendar.exhausted) {
      lines.push(
        "Only " + calendar.target + " of " + TARGET_POSTS +
        " posts could be generated without repeating a topic+format pair or fabricating content."
      );
      lines.push("<!-- Topic exhausted without fabrication risk -->");
    }

    return lines.join("\n").trim();
  }

  function showDecision(security, calendar) {
    var lines = [];
    lines.push('<div class="row"><strong>SecuritySensitive:</strong> ' + (security.sensitive ? "YES" : "NO") + "</div>");
    if (security.sensitive) {
      Object.keys(TOPICS).forEach(function (key) {
        lines.push('<div class="row"><strong>' + key + ':</strong> ' + (security.allow[key] ? "included" : "omitted (not explicitly permitted)") + "</div>");
      });
    }
    lines.push('<div class="row"><strong>Posts generated:</strong> ' + calendar.target + " / " + TARGET_POSTS + "</div>");
    lines.push('<div class="row"><strong>Real items in pool this month:</strong> ' + calendar.poolSize + "</div>");
    Object.keys(calendar.pairsUsed).forEach(function (category) {
      lines.push('<div class="row"><strong>' + CATEGORY_LABEL[category] + " formats used:</strong> " +
        calendar.pairsUsed[category].map(function (f) { return FORMAT_META[f]; }).join(", ") + "</div>");
    });
    var avoidTerms = [];
    calendar.posts.forEach(function (p) { avoidTerms = avoidTerms.concat(p.avoidedTerms); });
    if (avoidTerms.length) {
      var seen = {};
      var unique = avoidTerms.filter(function (a) { if (seen[a.term]) return false; seen[a.term] = true; return true; });
      lines.push('<div class="row"><strong>AnythingToAvoid:</strong> ' +
        unique.map(function (a) { return '"' + a.term + '" — found &amp; removed'; }).join("; ") + "</div>");
    }
    securityDecision.innerHTML = lines.join("");
    securityDecision.hidden = false;
  }

  // ---- UI wiring -------------------------------------------------------

  function reset() {
    parseError.textContent = "";
    mismatchWarning.hidden = true;
    blockedMessage.hidden = true;
    securityDecision.hidden = true;
    successPanel.hidden = true;
    actionStatus.textContent = "";
  }

  generateBtn.addEventListener("click", function () {
    reset();

    var regFields, intakeFields;
    try {
      regFields = parseRow(regInput.value, REG_COLUMNS, "Registration row");
      intakeFields = parseRow(intakeInput.value, INTAKE_COLUMNS, "Intake row");
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

    var security = evaluateSecurityGate(regFields);

    if (security.blocked) {
      blockedMessage.textContent = security.reason;
      blockedMessage.hidden = false;
      return;
    }

    var calendar;
    try {
      calendar = buildCalendar(regFields, intakeFields, security);
    } catch (err) {
      parseError.textContent = err.message;
      return;
    }

    showDecision(security, calendar);

    calendarView.innerHTML = renderCalendarHtml(calendar);
    calendarOutput.value = renderCalendarText(calendar);
    successPanel.hidden = false;

    saveIntakeRow(intakeFields);
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
