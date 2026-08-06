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
    "ClientID", "IsFirstNewsletter", "Highlight", "PrayerRequest",
    "NumbersUpdate", "NewPhotoLinks", "AnythingToAvoid", "SubmissionDate"
  ];

  var regInput = document.getElementById("reg-input");
  var intakeInput = document.getElementById("intake-input");
  var parseError = document.getElementById("parse-error");
  var generateBtn = document.getElementById("generate-btn");
  var mismatchWarning = document.getElementById("mismatch-warning");
  var blockedMessage = document.getElementById("blocked-message");
  var securityDecision = document.getElementById("security-decision");
  var successPanel = document.getElementById("success-panel");
  var subjectOutput = document.getElementById("subject-output");
  var bodyOutput = document.getElementById("body-output");
  var copySubjectBtn = document.getElementById("copy-subject-btn");
  var copyBodyBtn = document.getElementById("copy-body-btn");
  var actionStatus = document.getElementById("action-status");

  // ---- parsing ----------------------------------------------------

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

  // ---- security gate & topic allow-list ----------------------------

  // Same clause-by-clause scanner used by the site generator, extended
  // with topic keywords beyond just country/city. A clause permits a
  // topic only if it names the topic plus an explicit allow word, with
  // no negation word in that same clause. Silence/ambiguity => hidden.
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
    intro: ["intro", "summary", "bio", "background"],
    highlight: ["highlight"],
    prayer: ["prayer"],
    numbers: ["numbers", "stats", "progress"],
    whatsapp: ["whatsapp", "phone", "contact number"]
  };

  function evaluateSecurityGate(regFields) {
    var sensitive = regFields.SecuritySensitive.trim().toUpperCase() === "YES";
    var instructions = regFields.SecurityInstructions.trim();

    if (!sensitive) {
      return {
        blocked: false, sensitive: false,
        allow: { intro: true, highlight: true, prayer: true, numbers: true, whatsapp: true }
      };
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

  // ---- AnythingToAvoid scrubbing ------------------------------------

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

  // ---- first-person conversion ---------------------------------------

  function capIfSentenceStart(word, offset, string) {
    var before = string.slice(0, offset);
    var atStart = before.length === 0 || /[.!?]["')\]]*\s+$/.test(before);
    return atStart ? word.charAt(0).toUpperCase() + word.slice(1) : word;
  }

  // Best-effort conversion of third-person/plural text into first-person
  // singular, so the newsletter reads in the missionary's own voice even
  // though MissionSummary is often written about them by staff (see
  // apostello-onboarding skill), and monthly answers occasionally slip
  // into "we". Deterministic rule-based pass, not real NLP: reliably
  // handles "<Name> is/was/does/verb-s ...", gendered pronouns, and "we/
  // our" — the common patterns in this data — but an unrecognized
  // construction (e.g. "<Name>" as a verb's object with no preposition)
  // can slip through unconverted.
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

  // ---- language templates -------------------------------------------

  var MONTHS = {
    english: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
    french: ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"],
    spanish: ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"],
    portuguese: ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"]
  };

  var TEMPLATES = {
    english: {
      subjectFirst: function (name) { return "Meet " + name + " — My First Update"; },
      subjectMonthly: function (name, month, year) { return name + "'s Update — " + month + " " + year; },
      introDetailed: function (summary, dateStr) {
        return "Welcome to my very first update! " + summary + " I began this chapter on " + dateStr + ".";
      },
      introGeneric: function () {
        return "Welcome to my very first update — more will be shared here each month.";
      },
      prayerLabel: "Prayer request:",
      numbersLabel: "This month in numbers:",
      ctaLead: "Here's how you can partner with me:",
      ctaGeneric: "Stay in touch — I'd love to hear from you.",
      ctaEmail: "Simply reply to this email — I'd love to hear from you.",
      ctaWhatsApp: function (phone) { return "Message me on WhatsApp at " + phone + "."; },
      ctaWhatsAppNoPhone: "Message me on WhatsApp.",
      ctaInstagram: "Follow along with me on Instagram.",
      ctaFacebook: "Connect with me on Facebook.",
      ctaYouTube: "Subscribe on YouTube for more updates from me.",
      ctaPrint: "Watch your mailbox — I'll be sending a printed edition too.",
      ctaWebsite: "Visit my website for more.",
      signoff: "With gratitude,"
    },
    french: {
      subjectFirst: function (name) { return "À la rencontre de " + name + " — Ma première lettre"; },
      subjectMonthly: function (name, month, year) { return "Des nouvelles de " + name + " — " + month + " " + year; },
      introDetailed: function (summary, dateStr) {
        return "Bienvenue dans ma toute première lettre ! " + summary + " J'ai commencé cette étape le " + dateStr + ".";
      },
      introGeneric: function () {
        return "Bienvenue dans ma toute première lettre — d'autres nouvelles suivront chaque mois.";
      },
      prayerLabel: "Sujet de prière :",
      numbersLabel: "Ce mois-ci en chiffres :",
      ctaLead: "Voici comment vous pouvez m'accompagner :",
      ctaGeneric: "J'aimerais rester en contact avec vous.",
      ctaEmail: "Répondez simplement à cet e-mail — j'aimerais avoir de vos nouvelles.",
      ctaWhatsApp: function (phone) { return "Écrivez-moi sur WhatsApp au " + phone + "."; },
      ctaWhatsAppNoPhone: "Écrivez-moi sur WhatsApp.",
      ctaInstagram: "Suivez-moi sur Instagram.",
      ctaFacebook: "Retrouvez-moi sur Facebook.",
      ctaYouTube: "Abonnez-vous à ma chaîne YouTube pour plus de nouvelles.",
      ctaPrint: "Je vous enverrai bientôt la version imprimée dans votre boîte aux lettres.",
      ctaWebsite: "Visitez mon site pour en savoir plus.",
      signoff: "Avec gratitude,"
    },
    spanish: {
      subjectFirst: function (name) { return "Conoce a " + name + " — Mi primera actualización"; },
      subjectMonthly: function (name, month, year) { return "Actualización de " + name + " — " + month + " " + year; },
      introDetailed: function (summary, dateStr) {
        return "¡Te doy la bienvenida a mi primera actualización! " + summary + " Comencé esta etapa el " + dateStr + ".";
      },
      introGeneric: function () {
        return "Te doy la bienvenida a mi primera actualización — compartiré más cada mes.";
      },
      prayerLabel: "Petición de oración:",
      numbersLabel: "Este mes en números:",
      ctaLead: "Así es como puedes acompañarme:",
      ctaGeneric: "Me encantaría saber de ti.",
      ctaEmail: "Simplemente responde a este correo — me encantaría saber de ti.",
      ctaWhatsApp: function (phone) { return "Escríbeme por WhatsApp al " + phone + "."; },
      ctaWhatsAppNoPhone: "Escríbeme por WhatsApp.",
      ctaInstagram: "Sígueme en Instagram.",
      ctaFacebook: "Conéctate conmigo en Facebook.",
      ctaYouTube: "Suscríbete a mi canal de YouTube para más novedades.",
      ctaPrint: "Pronto te enviaré la edición impresa a tu buzón.",
      ctaWebsite: "Visita mi sitio web para más información.",
      signoff: "Con gratitud,"
    },
    portuguese: {
      subjectFirst: function (name) { return "Conheça " + name + " — Minha primeira atualização"; },
      subjectMonthly: function (name, month, year) { return "Atualização de " + name + " — " + month + " " + year; },
      introDetailed: function (summary, dateStr) {
        return "Seja bem-vindo à minha primeira atualização! " + summary + " Comecei esta etapa em " + dateStr + ".";
      },
      introGeneric: function () {
        return "Seja bem-vindo à minha primeira atualização — mais novidades a cada mês.";
      },
      prayerLabel: "Pedido de oração:",
      numbersLabel: "Este mês em números:",
      ctaLead: "Veja como você pode me apoiar:",
      ctaGeneric: "Adoraria ouvir de você.",
      ctaEmail: "Basta responder a este e-mail — adoraria ouvir de você.",
      ctaWhatsApp: function (phone) { return "Me chame no WhatsApp em " + phone + "."; },
      ctaWhatsAppNoPhone: "Me chame no WhatsApp.",
      ctaInstagram: "Acompanhe-me no Instagram.",
      ctaFacebook: "Conecte-se comigo no Facebook.",
      ctaYouTube: "Inscreva-se no meu canal do YouTube para mais novidades.",
      ctaPrint: "Fique de olho na sua caixa de correio — enviarei a edição impressa também.",
      ctaWebsite: "Visite meu site para saber mais.",
      signoff: "Com gratidão,"
    }
  };

  function detectLanguage(primaryLanguage) {
    var v = (primaryLanguage || "").trim().toLowerCase();
    if (/fran|français|francais/.test(v)) return "french";
    if (/span|español|espanol/.test(v)) return "spanish";
    if (/portug|português/.test(v)) return "portuguese";
    return "english";
  }

  function formatDate(dateStr, lang) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
    if (!m) return dateStr;
    var months = MONTHS[lang] || MONTHS.english;
    var monthName = months[parseInt(m[2], 10) - 1] || m[2];
    var day = parseInt(m[3], 10);
    return monthName + " " + day + ", " + m[1];
  }

  // ---- content assembly -----------------------------------------------

  function buildCtaLines(t, channelsRaw, allowWhatsApp, whatsAppPhone) {
    var channels = channelsRaw.split(/;\s*/).map(function (c) { return c.trim().toLowerCase(); }).filter(Boolean);
    if (channels.length === 0) return [t.ctaGeneric];

    var lines = [];
    channels.forEach(function (c) {
      if (c === "email") lines.push(t.ctaEmail);
      else if (c === "whatsapp") {
        if (allowWhatsApp && whatsAppPhone) lines.push(t.ctaWhatsApp(whatsAppPhone));
        else lines.push(t.ctaWhatsAppNoPhone);
      } else if (c === "instagram") lines.push(t.ctaInstagram);
      else if (c === "facebook") lines.push(t.ctaFacebook);
      else if (c === "youtube") lines.push(t.ctaYouTube);
      else if (c === "printed newsletter") lines.push(t.ctaPrint);
      else if (c === "website") lines.push(t.ctaWebsite);
    });
    return lines.length ? lines : [t.ctaGeneric];
  }

  function buildNewsletter(regFields, intakeFields, security) {
    var lang = detectLanguage(regFields.PrimaryLanguage);
    var t = TEMPLATES[lang];
    var name = regFields.FirstName.trim();
    var isFirst = intakeFields.IsFirstNewsletter.trim().toLowerCase() === "yes";

    var paragraphs = [];

    if (isFirst) {
      var introAllowed = security.allow.intro;
      if (introAllowed) {
        var summaryFirstPerson = toFirstPerson(regFields.MissionSummary.trim(), regFields.FirstName, regFields.LastName);
        paragraphs.push(t.introDetailed(summaryFirstPerson, formatDate(regFields.DepartureDate, lang)));
      } else {
        paragraphs.push(t.introGeneric());
      }
    }

    if (intakeFields.Highlight.trim()) {
      if (security.allow.highlight) {
        paragraphs.push(toFirstPerson(intakeFields.Highlight.trim(), regFields.FirstName, regFields.LastName));
      }
    }

    if (intakeFields.PrayerRequest.trim() && security.allow.prayer) {
      paragraphs.push(t.prayerLabel + " " + toFirstPerson(intakeFields.PrayerRequest.trim(), regFields.FirstName, regFields.LastName));
    }

    if (intakeFields.NumbersUpdate.trim() && security.allow.numbers) {
      paragraphs.push(t.numbersLabel + " " + toFirstPerson(intakeFields.NumbersUpdate.trim(), regFields.FirstName, regFields.LastName));
    }

    var ctaLines = buildCtaLines(t, regFields.Channels, security.allow.whatsapp, regFields.WhatsAppPhone.trim());
    paragraphs.push(t.ctaLead + " " + ctaLines.join(" "));

    paragraphs.push(t.signoff + "\n" + name);

    var body = paragraphs.join("\n\n");

    var subject;
    var subDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(intakeFields.SubmissionDate);
    var monthName = subDate ? (MONTHS[lang] || MONTHS.english)[parseInt(subDate[2], 10) - 1] : "";
    var year = subDate ? subDate[1] : "";
    subject = isFirst ? t.subjectFirst(name) : t.subjectMonthly(name, monthName, year);

    var avoidSubject = applyAvoidList(subject, intakeFields.AnythingToAvoid);
    var avoidBody = applyAvoidList(body, intakeFields.AnythingToAvoid);

    return {
      subject: avoidSubject.text,
      body: avoidBody.text,
      redactions: avoidBody.applied.concat(
        avoidSubject.applied.filter(function (a) { return a.found; }).map(function (a) {
          return { term: a.term, found: true, inSubject: true };
        })
      )
    };
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

  function showDecision(security, redactions) {
    var lines = [];
    lines.push('<div class="row"><strong>SecuritySensitive:</strong> ' + (security.sensitive ? "YES" : "NO") + "</div>");
    if (security.sensitive) {
      Object.keys(TOPICS).forEach(function (key) {
        lines.push('<div class="row"><strong>' + key + ':</strong> ' + (security.allow[key] ? "included" : "omitted / generic (not explicitly permitted)") + "</div>");
      });
    }
    var avoidTerms = redactions.filter(function (r) { return r.term; });
    if (avoidTerms.length) {
      lines.push('<div class="row"><strong>AnythingToAvoid:</strong> ' +
        avoidTerms.map(function (r) { return '"' + r.term + '" — ' + (r.found ? "found &amp; removed" : "not found in output"); }).join("; ") +
        "</div>");
    }
    securityDecision.innerHTML = lines.join("");
    securityDecision.hidden = false;
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

    var draft = buildNewsletter(regFields, intakeFields, security);

    showDecision(security, draft.redactions);

    subjectOutput.value = draft.subject;
    bodyOutput.value = draft.body;
    successPanel.hidden = false;
  });

  copySubjectBtn.addEventListener("click", function () {
    navigator.clipboard.writeText(subjectOutput.value).then(function () {
      actionStatus.textContent = "Subject copied.";
    }, function () {
      actionStatus.textContent = "Copy failed — select and copy manually.";
    });
  });

  copyBodyBtn.addEventListener("click", function () {
    navigator.clipboard.writeText(bodyOutput.value).then(function () {
      actionStatus.textContent = "Body copied.";
    }, function () {
      actionStatus.textContent = "Copy failed — select and copy manually.";
    });
  });
})();
