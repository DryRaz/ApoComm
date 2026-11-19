// Shared across every tool that reads/writes the registration TSV (36
// columns) and monthly intake TSV (10 columns): parsing, the security-gate
// clause-scanner, AnythingToAvoid redaction, first-person conversion,
// language detection, HTML escaping, and the shared-localStorage client
// lookup. Exposes a single global, window.ApoComm, so plain <script> tags
// can load this before any tool-specific logic — no build step, no module
// bundler, consistent with the rest of this repo.
(function (global) {
  "use strict";

  var ApoComm = global.ApoComm = global.ApoComm || {};

  ApoComm.REG_COLUMNS = [
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

  ApoComm.INTAKE_COLUMNS = [
    "ClientID", "IsFirstNewsletter", "Events", "MeetingsSummary", "PrayerNeeds",
    "UpcomingProjects", "NumbersUpdate", "NewPhotoLinks", "AnythingToAvoid", "SubmissionDate"
  ];

  // The backend's Monthly_Intakes row shape — 11 values, positional. The
  // Apps Script appends the array it receives without consulting headers,
  // so this order must match the sheet's own header row exactly:
  //
  //   ClientID | YearMonth | Timestamp | IsFirstNewsletter | Events |
  //   MeetingsSummary | PrayerNeeds | UpcomingProjects | NumbersUpdate |
  //   NewPhotoLinks | AnythingToAvoid
  //
  // "Month" (YYYY-MM, derived from SubmissionDate) is the sheet's
  // YearMonth and is what getIntake/listIntakeMonths index by;
  // SubmissionDate (the exact day) is the sheet's Timestamp, in third
  // position — NOT appended at the end.
  //
  // This previously listed SubmissionDate last and omitted the Timestamp
  // slot, so every value from column C onward was written one cell to the
  // left: IsFirstNewsletter landed in Timestamp, Events in
  // IsFirstNewsletter, and the submission date in AnythingToAvoid. The
  // visible damage was that AnythingToAvoid always came back as a date
  // when a past month was reloaded from the sheet — a missionary's
  // "don't mention X" never reached the generator on a regeneration. The
  // September 2026 row for APC-2026-011 was written in the old shape and
  // needs repairing by hand; nothing here migrates it.
  ApoComm.BACKEND_INTAKE_COLUMNS = [
    "ClientID", "Month", "SubmissionDate", "IsFirstNewsletter", "Events",
    "MeetingsSummary", "PrayerNeeds", "UpcomingProjects", "NumbersUpdate",
    "NewPhotoLinks", "AnythingToAvoid"
  ];

  // Events/PrayerNeeds/UpcomingProjects are semicolon-joined lists (see
  // newsletter-intake); any number of entries, including zero.
  ApoComm.splitList = function (raw) {
    return raw.split(/;+/).map(function (s) { return s.trim(); }).filter(Boolean);
  };

  // ---- parsing ----------------------------------------------------

  ApoComm.firstNonBlankLine = function (raw) {
    var lines = raw.split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].trim() !== "") return lines[i];
    }
    return "";
  };

  ApoComm.parseRow = function (raw, columns, label) {
    var line = ApoComm.firstNonBlankLine(raw);
    var cols = line.split("\t");
    if (cols.length !== columns.length) {
      throw new Error(
        label + ": expected " + columns.length + " tab-separated columns, got " + cols.length + "."
      );
    }
    var fields = {};
    columns.forEach(function (name, i) { fields[name] = (cols[i] || "").trim(); });
    return fields;
  };

  // ---- security gate & topic allow-list ----------------------------

  // Clause-by-clause scanner: a clause permits a topic only if it names
  // the topic plus an explicit allow word, with no negation word in that
  // same clause. Silence/ambiguity => hidden (the safe default).
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

  ApoComm.isTopicAllowed = function (instructions, keywords) {
    var clauses = segmentsOf(instructions);
    return clauses.some(function (clause) { return clauseAllowsAny(clause, keywords); });
  };

  // `topics` is a { key: [keyword, ...] } map, specific to whichever
  // generator is calling this (newsletter and Instagram gate different
  // topic sets) — the blocking decision itself is identical everywhere.
  // The only values that mean "this profile is cleared". Anything else —
  // a blank cell, "OUI" typed into the French-headed Sheet, a typo, a row
  // that came back short from the backend — is treated as sensitive and
  // blocks. The apostello-onboarding rule is explicit: in doubt, YES. A
  // false block costs one question; a false pass costs far more.
  var NOT_SENSITIVE = ["NO", "N", "NON", "FALSE", "0"];
  var SENSITIVE = ["YES", "Y", "OUI", "SI", "SÍ", "SIM", "TRUE", "1"];

  // Returns true (sensitive) for every value that is not an explicit,
  // recognized "no" — including an empty or unrecognized one.
  ApoComm.isSecuritySensitive = function (raw) {
    var v = String(raw == null ? "" : raw).trim().toUpperCase();
    if (NOT_SENSITIVE.indexOf(v) !== -1) return false;
    return true;
  };

  // True only when the value is one this codebase actually understands,
  // either way. An unrecognized value still blocks (above) but deserves a
  // different message: the operator mistyped, they didn't flag a risk.
  ApoComm.isSecurityValueRecognized = function (raw) {
    var v = String(raw == null ? "" : raw).trim().toUpperCase();
    return NOT_SENSITIVE.indexOf(v) !== -1 || SENSITIVE.indexOf(v) !== -1;
  };

  ApoComm.evaluateSecurityGate = function (regFields, topics) {
    var rawFlag = regFields.SecuritySensitive;
    var sensitive = ApoComm.isSecuritySensitive(rawFlag);
    var recognized = ApoComm.isSecurityValueRecognized(rawFlag);
    var instructions = regFields.SecurityInstructions.trim();

    // An unreadable flag is never silently treated as a cleared profile.
    if (sensitive && !recognized) {
      return {
        blocked: true,
        sensitive: true,
        unreadableFlag: true,
        reason: String(rawFlag || "").trim()
          ? "Cannot generate — the security field reads \"" + String(rawFlag).trim() + "\", which this tool does not recognize. Set it to YES or NO on the client record."
          : "Cannot generate — the security field is empty on this client record. Set it to YES or NO before anything is published."
      };
    }

    if (!sensitive) {
      var allowAll = {};
      Object.keys(topics).forEach(function (key) { allowAll[key] = true; });
      return { blocked: false, sensitive: false, allow: allowAll };
    }

    if (!instructions) {
      return {
        blocked: true,
        reason: "Cannot generate — this profile requires human security validation first."
      };
    }

    var allow = {};
    Object.keys(topics).forEach(function (key) {
      allow[key] = ApoComm.isTopicAllowed(instructions, topics[key]);
    });

    return { blocked: false, sensitive: true, allow: allow };
  };

  // ---- AnythingToAvoid scrubbing ------------------------------------

  ApoComm.escapeRegex = function (s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  };

  // Missionaries write this field as an instruction ("Ne pas nommer
  // l'hôpital du district", "Please don't mention the school"), not as a
  // bare term. Matching the instruction verbatim finds nothing, so the
  // subject it refers to gets published while the audit panel reports
  // "not found in output". These prefixes are stripped so the subject
  // itself is what gets searched for.
  var AVOID_PREFIXES = [
    // French
    /^(?:merci de |priè?re de |s'?il (?:vous |te )?pla[îi]t,? )?(?:ne (?:pas|jamais) |[ée]viter de |[ée]viter )(?:nommer|mentionner|citer|parler de|[ée]voquer|publier|dire|donner|indiquer|pr[ée]ciser|r[ée]v[ée]ler|partager)\s+/i,
    /^(?:ne |n')(?:pas |jamais )?(?:nommez|mentionnez|citez|publiez)\s+/i,
    /^(?:pas de|aucun[e]? mention de|rien sur|sans)\s+/i,
    // English
    /^(?:please |kindly )?(?:do not|don'?t|never|avoid|refrain from)\s+(?:name|naming|mention|mentioning|say|saying|cite|citing|publish|publishing|share|sharing|refer to|referring to|talk about|talking about|include|including|use|using)\s+/i,
    /^(?:no mention of|nothing about|leave out|omit|without)\s+/i,
    // Spanish / Portuguese
    /^(?:no|não|nao)\s+(?:nombrar|mencionar|publicar|citar|compartir|mencione|nomear|publicar|citar|compartilhar)\s+/i
  ];
  // Articles left dangling once the subject is cut out of a sentence.
  var LEADING_ARTICLE = /^(?:l'|le |la |les |du |de la |des |de l'|d'|un |une |the |a |an |el |los |las |o |os |as )/i;

  // From "Ne pas nommer l'hôpital du district." produce the terms worth
  // searching for: the whole clause (in case it really is a bare term),
  // the subject after the instruction prefix, and that subject without a
  // leading article, so "l'hôpital du district" and "hôpital du district"
  // both match.
  ApoComm.avoidTermVariants = function (clause) {
    var variants = [];
    function push(v) {
      v = String(v || "").replace(/[.;:,!?]+\s*$/, "").trim();
      if (v.length >= 3 && variants.indexOf(v) === -1) variants.push(v);
    }
    push(clause);
    var stripped = clause;
    AVOID_PREFIXES.forEach(function (re) {
      var next = stripped.replace(re, "");
      if (next !== stripped) { stripped = next.trim(); push(stripped); }
    });
    if (LEADING_ARTICLE.test(stripped)) push(stripped.replace(LEADING_ARTICLE, ""));
    // Longest first: strip the full phrase before its article-less form,
    // so the article doesn't survive as an orphan.
    return variants.sort(function (a, b) { return b.length - a.length; });
  };

  ApoComm.applyAvoidList = function (text, avoidRaw) {
    var terms = avoidRaw.split(/[;\n]+/).map(function (t) { return t.trim(); }).filter(Boolean);
    var applied = [];
    var result = text;
    terms.forEach(function (term) {
      var variants = ApoComm.avoidTermVariants(term);
      var found = false;
      var matched = [];
      variants.forEach(function (variant) {
        var re = new RegExp(ApoComm.escapeRegex(variant), "gi");
        if (!re.test(result)) return;
        found = true;
        matched.push(variant);
        result = result.replace(re, "");
      });
      if (found) {
        result = result
          // Articles stranded by the removal. A French elided article is
          // never followed by whitespace ("orientée par l' ce mois-ci"),
          // so that form is always breakage, not legitimate text.
          .replace(/\b(?:l|d|n|j|m|t|s|c|qu)['’]\s+/gi, "")
          .replace(/[ \t]{2,}/g, " ")
          .replace(/ +([.,!?;:])/g, "$1")
          .replace(/ +\n/g, "\n")
          .replace(/\n{3,}/g, "\n\n");
      }
      applied.push({ term: term, found: found, matched: matched });
    });
    return { text: result.trim(), applied: applied };
  };

  // ---- first-person conversion ---------------------------------------

  function capIfSentenceStart(word, offset, string) {
    var before = string.slice(0, offset);
    var atStart = before.length === 0 || /[.!?]["')\]]*\s+$/.test(before);
    return atStart ? word.charAt(0).toUpperCase() + word.slice(1) : word;
  }

  // Best-effort conversion of third-person/plural text into first-person
  // singular, so generated content reads in the missionary's own voice
  // even though MissionSummary is often written about them by staff (see
  // apostello-onboarding skill), and monthly answers occasionally slip
  // into "we". Deterministic rule-based pass, not real NLP: reliably
  // handles "<Name> is/was/does/verb-s ...", gendered pronouns, and "we/
  // our" — the common patterns in this data — but an unrecognized
  // construction (e.g. "<Name>" as a verb's object with no preposition)
  // can slip through unconverted.
  // Every rule below is English: English auxiliaries, English pronouns,
  // English possessives. Run on French it produces "I accompagne des
  // familles. Elle forme aussi des mères." — the name swapped, the verb
  // unconjugated, the later pronouns untouched. Callers pass the profile
  // language; anything but English is returned unchanged, because the
  // missionary's own sentence is already better than a mangled one.
  // Removing this guard requires per-language rules, not a wider regex.
  ApoComm.toFirstPerson = function (text, firstName, lastName, language) {
    if (!text) return text;
    if (language && ApoComm.detectLanguage(language) !== "english") return text;
    var result = text;
    var names = [];
    if (firstName && lastName) names.push(ApoComm.escapeRegex((firstName + " " + lastName).trim()));
    if (firstName) names.push(ApoComm.escapeRegex(firstName));

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
  };

  // PrimaryLanguage is a free-text field on a form written in English, so
  // the value that actually arrives is usually the English name of the
  // language ("French"), sometimes the endonym ("Français"), sometimes an
  // ISO code ("fr", "fr-FR"). The old test only matched the endonym stem
  // "fran", so "French" fell through to English and a francophone
  // missionary got an English newsletter wrapped around French sentences.
  ApoComm.detectLanguage = function (primaryLanguage) {
    var v = (primaryLanguage || "").trim().toLowerCase();
    if (!v) return "english";
    var code = v.split(/[-_]/)[0];
    if (code === "fr") return "french";
    if (code === "es" || code === "ca") return "spanish";
    if (code === "pt") return "portuguese";
    if (code === "en") return "english";
    if (/fren|fran[cç]|french/.test(v)) return "french";
    if (/span|espan|españ|castell/.test(v)) return "spanish";
    if (/portug|portugu/.test(v)) return "portuguese";
    if (/engl|angl|ingl/.test(v)) return "english";
    return "english";
  };

  ApoComm.escapeHtml = function (value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  };

  // ---- row <-> fields conversion (backend talks JSON arrays, the local
  // cache talks TSV strings — both represent the same `fields` object,
  // keyed by column name, that every generator/gate already works with) --

  ApoComm.regFieldsToBackendRow = function (fields) {
    return ApoComm.REG_COLUMNS.map(function (c) { return fields[c] || ""; });
  };

  ApoComm.backendRowToRegFields = function (row) {
    var fields = {};
    ApoComm.REG_COLUMNS.forEach(function (c, i) { fields[c] = (row[i] == null ? "" : String(row[i])).trim(); });
    return fields;
  };

  ApoComm.intakeFieldsToBackendRow = function (fields) {
    var month = (/^\d{4}-\d{2}/.exec(fields.SubmissionDate || "") || [])[0] || "";
    return ApoComm.BACKEND_INTAKE_COLUMNS.map(function (c) {
      return c === "Month" ? month : (fields[c] || "");
    });
  };

  ApoComm.backendRowToIntakeFields = function (row) {
    var fields = {};
    ApoComm.BACKEND_INTAKE_COLUMNS.forEach(function (c, i) {
      if (c === "Month") return; // derived, not part of the local 10-column shape
      fields[c] = (row[i] == null ? "" : String(row[i])).trim();
    });
    return fields;
  };

  // Lightweight {clientId, firstName, lastName, country, raw} summary —
  // the same shape listSavedClients() produces from a local TSV row — so
  // backend-sourced results can flow through the same disambiguation/
  // rendering code every tool's client-search already uses.
  ApoComm.fieldsToClientSummary = function (fields) {
    return {
      clientId: fields.ClientID || "",
      lastName: fields.LastName || "",
      firstName: fields.FirstName || "",
      country: fields.CountryOfService || "",
      raw: ApoComm.regFieldsToBackendRow(fields).join("\t")
    };
  };

  // ---- shared client lookup (localStorage) -----------------------------

  // Two clients sharing a name get "FirstName LastName (Country)" if
  // their countries are all different, otherwise "FirstName LastName
  // (last 4 of ClientID)" — country is preferred since it reads more
  // usefully than an opaque ID fragment. Exported (not just used by
  // listSavedClients) so backend-sourced result lists can be labeled the
  // same way as local ones.
  ApoComm.assignDisambiguatedLabels = function (clients) {
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
    return clients;
  };

  // Reads every saved registration row and pulls out just enough (name,
  // country) to build a human-friendly, disambiguated label — the raw
  // ClientID (APC-YYYY-000) is never shown to the operator, only used
  // internally once a result is picked. This is the offline/local-cache
  // path; ApoComm.searchClients() below tries the shared backend first.
  ApoComm.listSavedClients = function () {
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
    ApoComm.assignDisambiguatedLabels(clients);
    clients.sort(function (a, b) { return a.label.localeCompare(b.label); });
    return clients;
  };

  ApoComm.getSavedClientRow = function (clientId) {
    return localStorage.getItem("apocomm_client_" + clientId);
  };

  // Writes/refreshes the local offline-cache copy of a registration row —
  // called both after a successful registerClient (so the browser that
  // just registered has an immediate local copy) and after any successful
  // backend read (searchClients/fetchClientRow), so the cache stays warm
  // for next time the backend is unreachable.
  ApoComm.cacheClientRow = function (fields) {
    if (!fields || !fields.ClientID) return;
    try {
      localStorage.setItem("apocomm_client_" + fields.ClientID, ApoComm.regFieldsToBackendRow(fields).join("\t"));
    } catch (e) { /* ignore storage errors (e.g. private browsing) */ }
  };

  ApoComm.listSavedMonths = function (clientId) {
    var prefix = "apocomm_client_" + clientId + "_intake_";
    var months = [];
    for (var i = 0; i < localStorage.length; i++) {
      var key = localStorage.key(i);
      if (key.indexOf(prefix) === 0) months.push(key.slice(prefix.length));
    }
    return months.sort().reverse();
  };

  // Saves under the intake row's own ClientID (not necessarily whatever
  // is currently in a registration textarea) — that's the record this
  // intake actually belongs to, mismatch-warning notwithstanding.
  ApoComm.saveIntakeRow = function (intakeFields) {
    var clientId = intakeFields.ClientID;
    var month = (/^\d{4}-\d{2}/.exec(intakeFields.SubmissionDate) || [])[0];
    if (!clientId || !month) return;
    var row = ApoComm.INTAKE_COLUMNS.map(function (c) { return intakeFields[c] || ""; }).join("\t");
    try {
      localStorage.setItem("apocomm_client_" + clientId + "_intake_" + month, row);
    } catch (e) { /* ignore storage errors (e.g. private browsing) */ }
  };

  // ---- backend-first orchestration, localStorage as offline fallback ---
  //
  // Every function below tries the shared Google Sheets backend
  // (ApoComm.Backend.*, from apocomm-backend.js) first and falls back to
  // the local cache only on a genuine transport failure (ApoComm.Backend
  // already distinguishes that from a reachable-but-empty answer — see
  // apocomm-backend.js). A successful backend read also refreshes the
  // local cache, so the next offline attempt has the freshest data.
  //
  // Results carry { source: "backend"|"local", warning: string|null } so
  // every tool can show the same "Could not reach the shared database —
  // using local data only" message without duplicating that decision.

  var BACKEND_DOWN_WARNING = "Could not reach the shared database — using local data only.";
  ApoComm.BACKEND_DOWN_WARNING = BACKEND_DOWN_WARNING;

  function localSearchMatches(query) {
    var all = ApoComm.listSavedClients();
    var q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter(function (c) {
      return c.firstName.toLowerCase().indexOf(q) !== -1 ||
        c.lastName.toLowerCase().indexOf(q) !== -1 ||
        c._name.toLowerCase().indexOf(q) !== -1;
    });
  }

  // Backend first; falls back to the local cache if the call fails OR
  // comes back with zero matches (this browser may hold a locally-cached
  // client — e.g. registered while offline — that the backend search
  // genuinely has no record of yet).
  ApoComm.searchClients = function (query) {
    return ApoComm.Backend.searchByName(query).then(function (result) {
      if (result.ok && result.clients.length > 0) {
        var summaries = result.clients.map(function (fields) {
          ApoComm.cacheClientRow(fields);
          return ApoComm.fieldsToClientSummary(fields);
        });
        ApoComm.assignDisambiguatedLabels(summaries);
        summaries.sort(function (a, b) { return a.label.localeCompare(b.label); });
        return { clients: summaries, source: "backend", warning: null };
      }
      return {
        clients: localSearchMatches(query),
        source: "local",
        warning: result.ok ? null : BACKEND_DOWN_WARNING
      };
    });
  };

  // Always fetches the authoritative full row for a selected client via
  // getClient rather than trusting whatever the search step returned.
  // `result.ok` from Backend.getClient means "reachable" — a reachable
  // backend with no such record still checks the local cache (e.g. an
  // offline registration not yet synced) before giving up, with no
  // connectivity warning in that case since nothing is actually down.
  ApoComm.fetchClientRow = function (clientId) {
    return ApoComm.Backend.getClient(clientId).then(function (result) {
      if (result.ok && result.fields) {
        ApoComm.cacheClientRow(result.fields);
        return { fields: result.fields, source: "backend", warning: null };
      }
      var raw = ApoComm.getSavedClientRow(clientId);
      var localFields = raw ? ApoComm.parseRow(raw, ApoComm.REG_COLUMNS, "Cached registration row") : null;
      return {
        fields: localFields,
        source: "local",
        warning: result.ok ? null : BACKEND_DOWN_WARNING
      };
    });
  };

  // Registration submit: ClientID allocation is the backend's job now
  // (see apocomm-backend.js) — `fields.ClientID` here is a placeholder,
  // not a real ID, so there's nothing sane to cache locally until the
  // backend responds with the one it actually assigned. Callers only get
  // a `clientId` back on `ok: true`; on failure it's the caller's
  // responsibility to generate an offline-only fallback ID (registration
  // is the only tool that does this, via its own local `nextClientId()`)
  // and cache under that instead — this function deliberately doesn't
  // own that fallback-ID policy, since it's specific to the registration
  // UI, not to backend orchestration in general.
  ApoComm.registerClientRemote = function (fields) {
    return ApoComm.Backend.registerClient(fields).then(function (result) {
      if (!result.ok) return { ok: false, clientId: null, warning: BACKEND_DOWN_WARNING };
      var savedFields = Object.assign({}, fields, { ClientID: result.clientId });
      ApoComm.cacheClientRow(savedFields);
      return { ok: true, clientId: result.clientId, warning: null };
    });
  };

  // Intake submit: same always-cache-locally-then-write-through pattern,
  // targeting the backend's Monthly_Intakes tab.
  ApoComm.saveIntakeRemote = function (intakeFields) {
    ApoComm.saveIntakeRow(intakeFields);
    return ApoComm.Backend.saveIntake(intakeFields).then(function (result) {
      return result.ok ? { ok: true, warning: null } : { ok: false, warning: BACKEND_DOWN_WARNING };
    });
  };

  // Past-month list for the "load a past month" selects — backend first,
  // merged with any local-only months (e.g. saved while offline and not
  // yet synced) so nothing locally saved is ever hidden from the list.
  ApoComm.fetchIntakeMonths = function (clientId) {
    return ApoComm.Backend.listIntakeMonths(clientId).then(function (result) {
      var localMonths = ApoComm.listSavedMonths(clientId);
      if (!result.ok) {
        return { months: localMonths, source: "local", warning: BACKEND_DOWN_WARNING };
      }
      var merged = result.months.slice();
      localMonths.forEach(function (m) { if (merged.indexOf(m) === -1) merged.push(m); });
      merged.sort().reverse();
      return { months: merged, source: "backend", warning: null };
    });
  };

  // Photos live only in each client's Drive folder — there's no local
  // cache to fall back to (nothing was ever written locally for them), so
  // a transport failure just means an empty list plus the usual warning,
  // same as every other backend-first read once fallback data runs out.
  ApoComm.fetchPhotos = function (clientId) {
    return ApoComm.Backend.listPhotos(clientId).then(function (result) {
      return {
        photos: result.photos,
        warning: result.ok ? null : BACKEND_DOWN_WARNING
      };
    });
  };

  ApoComm.fetchIntakeRow = function (clientId, month) {
    return ApoComm.Backend.getIntake(clientId, month).then(function (result) {
      if (result.ok && result.fields) {
        return { fields: result.fields, source: "backend", warning: null };
      }
      var raw = localStorage.getItem("apocomm_client_" + clientId + "_intake_" + month);
      var localFields = raw ? ApoComm.parseRow(raw, ApoComm.INTAKE_COLUMNS, "Cached intake row") : null;
      return {
        fields: localFields,
        source: "local",
        warning: result.ok ? null : BACKEND_DOWN_WARNING
      };
    });
  };
})(window);
