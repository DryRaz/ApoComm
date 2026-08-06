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
  var calendarView = document.getElementById("calendar-view");
  var calendarOutput = document.getElementById("calendar-output");
  var copyBtn = document.getElementById("copy-btn");
  var actionStatus = document.getElementById("action-status");

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
    highlight: ["highlight"],
    prayer: ["prayer"],
    numbers: ["numbers", "stats", "progress"]
  };

  function evaluateSecurityGate(regFields) {
    var sensitive = regFields.SecuritySensitive.trim().toUpperCase() === "YES";
    var instructions = regFields.SecurityInstructions.trim();

    if (!sensitive) {
      return { blocked: false, sensitive: false, allow: { highlight: true, prayer: true, numbers: true } };
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

  var TOPIC_META = { highlight: "Highlight", prayer: "Prayer Request", numbers: "Numbers Update" };

  // Format→topic compatibility and per-topic preference order used when
  // filling the schedule. prayer_focused is the one hard exclusivity rule
  // from the spec ("only ever pulls from PrayerRequest"); every other
  // format is open to any topic, with a preference order that leads with
  // the "sensible" fit called out in the spec (BTS/POV/viral/educational
  // for Highlight, quote/stat for Numbers) before falling back to the rest.
  var FORMAT_PREFERENCE = {
    highlight: ["bts", "pov", "viral", "educational", "quote_stat", "engagement"],
    numbers: ["quote_stat", "viral", "educational", "engagement", "bts", "pov"],
    prayer: ["prayer_focused", "engagement", "bts", "pov", "viral", "educational", "quote_stat"]
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
      highlight: {
        viral: function (s) { return "Okay, I have to tell you about this one. " + s + " I'm still smiling about it, and I wanted you to be among the first to know."; },
        educational: function (s) { return "Something I don't always explain well in these updates: " + s + " Moments like this are actually a normal part of what ministry here looks like day to day — less about grand plans, more about showing up consistently and staying ready."; },
        pov: function (s) { return "Picture this with me for a second: " + s + " Now imagine standing right next to me in that exact moment — that's genuinely what it felt like, and I wanted to bring you into it instead of just reporting it after the fact."; },
        quote_stat: function (s) { return s; },
        bts: function (s) { return "Here's the part you don't usually see: " + s + " There was a lot of ordinary, unglamorous prep behind that moment — the setup, the small logistics, the waiting — and I think that's just as worth sharing as the highlight itself."; },
        engagement: function (s) { return s + " I'd love to know — has something small like this ever ended up mattering way more than you expected? Tell me in the comments."; }
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

  function getCaption(lang, topic, format, seed) {
    if (lang === "english") return TEMPLATES.english[topic][format](seed);
    return GENERIC_TEMPLATES[lang][format](seed);
  }

  var HASHTAG_BANK = {
    highlight: ["#MissionaryLife", "#FaithInAction", "#Testimony", "#ThisIsMinistry", "#GodAtWork"],
    prayer: ["#PrayForMe", "#PrayerRequest", "#StandWithMe", "#Intercession"],
    numbers: ["#Milestone", "#Progress", "#Grateful", "#KingdomWork"],
    universal: ["#MissionaryLife", "#SupportMissions", "#PartnerInMinistry"]
  };

  function buildHashtags(topic) {
    var tags = HASHTAG_BANK[topic].slice(0, 3);
    HASHTAG_BANK.universal.forEach(function (t) {
      if (tags.indexOf(t) === -1 && tags.length < 5) tags.push(t);
    });
    return tags.slice(0, 5);
  }

  // ---- scheduling ---------------------------------------------------

  var TARGET_POSTS = 16; // 4 weeks x 4 posts/week

  // Round-robins through the available topics (in a fixed, spread-
  // friendly order), assigning each occurrence the next format in that
  // topic's preference list. A topic is skipped once its own preference
  // list is exhausted, which is exactly what guarantees no topic+format
  // pair ever repeats. If every available topic's list runs dry before
  // 16 slots are filled, the schedule simply stops short — callers see
  // that via `target < TARGET_POSTS` and flag it instead of padding.
  function buildSchedule(topicSeeds) {
    var order = ["highlight", "numbers", "prayer"].filter(function (k) { return topicSeeds[k]; });
    var lists = {};
    order.forEach(function (k) { lists[k] = FORMAT_PREFERENCE[k]; });
    var counts = {}; order.forEach(function (k) { counts[k] = 0; });
    var totalCapacity = order.reduce(function (sum, k) { return sum + lists[k].length; }, 0);
    var target = Math.min(TARGET_POSTS, totalCapacity);

    var schedule = [];
    var i = 0;
    var guard = 0;
    while (schedule.length < target && guard < 1000) {
      guard++;
      var topic = order[i % order.length];
      i++;
      if (counts[topic] < lists[topic].length) {
        schedule.push({ topic: topic, format: lists[topic][counts[topic]] });
        counts[topic]++;
      }
    }

    return { schedule: schedule, target: target, totalCapacity: totalCapacity };
  }

  // ---- assembly -------------------------------------------------------

  function buildCalendar(regFields, intakeFields, security) {
    var lang = detectLanguage(regFields.PrimaryLanguage);

    var topicSeeds = {};
    if (intakeFields.Highlight.trim() && security.allow.highlight) {
      topicSeeds.highlight = toFirstPerson(intakeFields.Highlight.trim(), regFields.FirstName, regFields.LastName);
    }
    if (intakeFields.PrayerRequest.trim() && security.allow.prayer) {
      topicSeeds.prayer = toFirstPerson(intakeFields.PrayerRequest.trim(), regFields.FirstName, regFields.LastName);
    }
    if (intakeFields.NumbersUpdate.trim() && security.allow.numbers) {
      topicSeeds.numbers = toFirstPerson(intakeFields.NumbersUpdate.trim(), regFields.FirstName, regFields.LastName);
    }

    var built = buildSchedule(topicSeeds);
    var pairsUsed = {}; // topic -> [formats]

    var posts = built.schedule.map(function (slot, idx) {
      var caption = getCaption(lang, slot.topic, slot.format, topicSeeds[slot.topic]);
      var avoided = applyAvoidList(caption, intakeFields.AnythingToAvoid);
      pairsUsed[slot.topic] = pairsUsed[slot.topic] || [];
      pairsUsed[slot.topic].push(slot.format);
      return {
        index: idx,
        week: Math.floor(idx / 4) + 1,
        slot: (idx % 4) + 1,
        topic: slot.topic,
        format: slot.format,
        caption: avoided.text,
        avoidedTerms: avoided.applied.filter(function (a) { return a.found; }),
        hashtags: buildHashtags(slot.topic),
        graphic: GRAPHIC_NOTES[slot.format]
      };
    });

    var exhausted = built.target < TARGET_POSTS;

    return {
      posts: posts,
      target: built.target,
      totalCapacity: built.totalCapacity,
      exhausted: exhausted,
      topicSeeds: topicSeeds,
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
          '<div class="meta"><span class="topic-tag ' + p.topic + '">' + escapeHtml(TOPIC_META[p.topic]) + "</span>" +
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
          "Day " + p.slot + " — Topic: " + TOPIC_META[p.topic] + " | Format: " + FORMAT_META[p.format]
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
    Object.keys(calendar.pairsUsed).forEach(function (topic) {
      lines.push('<div class="row"><strong>' + TOPIC_META[topic] + " formats used:</strong> " +
        calendar.pairsUsed[topic].map(function (f) { return FORMAT_META[f]; }).join(", ") + "</div>");
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

    var calendar = buildCalendar(regFields, intakeFields, security);

    showDecision(security, calendar);

    calendarView.innerHTML = renderCalendarHtml(calendar);
    calendarOutput.value = renderCalendarText(calendar);
    successPanel.hidden = false;
  });

  copyBtn.addEventListener("click", function () {
    navigator.clipboard.writeText(calendarOutput.value).then(function () {
      actionStatus.textContent = "Copied.";
    }, function () {
      actionStatus.textContent = "Copy failed — select and copy manually.";
    });
  });
})();
