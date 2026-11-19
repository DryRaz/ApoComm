// Instagram-calendar-specific generation logic: the 4-topic security gate,
// the format/caption/hashtag libraries, the language-purity guard, the
// pool/wave scheduler, the core build() function, and HTML/text renderers.
// Depends on apocomm-common.js (ApoComm.splitList, ApoComm.isTopicAllowed,
// ApoComm.evaluateSecurityGate, ApoComm.toFirstPerson, ApoComm.applyAvoidList,
// ApoComm.detectLanguage, ApoComm.escapeHtml) being loaded first. Exposes
// window.ApoComm.Instagram, used by both the standalone
// admin/instagram-calendar tool and the automated newsletter-intake flow.
(function (global) {
  "use strict";

  var ApoComm = global.ApoComm = global.ApoComm || {};
  var Instagram = ApoComm.Instagram = ApoComm.Instagram || {};

  Instagram.TOPICS = {
    highlights: ["highlight", "event", "events"],
    prayer: ["prayer"],
    looking_ahead: ["upcoming", "project", "looking ahead"],
    numbers: ["numbers", "stats", "progress"]
  };

  Instagram.evaluateSecurityGate = function (regFields) {
    return ApoComm.evaluateSecurityGate(regFields, Instagram.TOPICS);
  };

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
    },
    // French now carries the same per-category set as English, rather
    // than the one-generic-template-per-format fallback it had before:
    // four Events in a month used to open with four copies of the same
    // framing sentence in French while English got four distinct angles.
    // Same non-fabrication guarantee — the missionary's own sentence is
    // wrapped, never rewritten, and no template adds a fact, a figure,
    // a name or a date.
    french: {
      highlights: {
        viral: function (s) { return "Il faut vraiment que je vous raconte celle-là. " + s + " J'en souris encore, et je voulais que vous soyez parmi les premiers à le savoir."; },
        educational: function (s) { return "Quelque chose que j'explique rarement dans mes nouvelles : " + s + " Ce genre de moment, c'est en réalité le quotidien ici — moins les grands plans que le fait d'être présent, régulièrement."; },
        pov: function (s) { return "Imaginez la scène avec moi un instant : " + s + " Maintenant, mettez-vous juste à côté de moi à cet instant précis — c'est exactement ce que ça faisait, et je préférais vous y emmener plutôt que de vous le raconter après coup."; },
        quote_stat: function (s) { return s; },
        bts: function (s) { return "Voici la partie qu'on ne montre pas d'habitude : " + s + " Derrière ce moment, il y a eu beaucoup de préparation sans éclat — l'installation, la logistique, l'attente — et je trouve que ça mérite d'être partagé autant que le reste."; },
        engagement: function (s) { return s + " Et vous, est-ce qu'une petite chose comme celle-là a déjà fini par compter bien plus que prévu ? Racontez-moi en commentaire."; }
      },
      looking_ahead: {
        educational: function (s) { return "Quelque chose que je prends rarement le temps d'expliquer : " + s + " J'aime vous annoncer ce qui arrive, pas seulement vous résumer ce qui s'est passé : vous pouvez en faire partie pendant que ça se construit, au lieu de l'apprendre une fois terminé."; },
        engagement: function (s) { return s + " Et vous, qu'est-ce que vous attendez avec impatience en ce moment ? Dites-le-moi en commentaire."; },
        viral: function (s) { return "Il faut que je vous dise ce qui arrive. " + s + " J'ai hâte, et un peu le trac, et je voulais que vous le sachiez avant, pas seulement après."; },
        pov: function (s) { return "Imaginez la scène avec moi un instant : " + s + " Je ne sais pas encore comment ça va se passer, mais je voulais vous faire vivre l'attente avec moi plutôt que de vous donner seulement le résultat plus tard."; },
        bts: function (s) { return "Voici ce que personne ne voit encore : " + s + " Pour l'instant, c'est surtout de la préparation, de la logistique et beaucoup de petites décisions en coulisses — rien de photogénique, mais c'est du vrai travail."; },
        quote_stat: function (s) { return s; }
      },
      numbers: {
        viral: function (s) { return "Un chiffre que je ne pensais pas partager si tôt : " + s + " C'est un petit jalon, mais il est réel, et je voulais que vous le voyiez avant qu'il ne devienne une ligne dans un tableau."; },
        educational: function (s) { return "Un mot sur ce qu'il y a derrière ces chiffres : " + s + " Des nombres comme ceux-là représentent surtout beaucoup de conversations et de petites décisions accumulées dans le temps, pas un grand coup d'éclat — ça vaut la peine de le savoir si vous n'avez jamais vécu ça de l'intérieur."; },
        pov: function (s) { return "Imaginez recevoir la nouvelle que j'ai reçue récemment : " + s + " C'est ce moment-là que je partage avec vous aujourd'hui — pas une grande annonce, juste quelque chose de discret et de vrai."; },
        quote_stat: function (s) { return s; },
        bts: function (s) { return "Quelque chose qui n'apparaît presque jamais dans mes nouvelles : " + s + " Derrière un chiffre pareil, il y a beaucoup de suivi discret et ordinaire — des messages, des conversations, des petites prises de nouvelles qui ne font pas de belles photos mais qui changent tout."; },
        engagement: function (s) { return s + " Les chiffres comme celui-là me rendent curieux : la dernière fois que des efforts réguliers et sans éclat ont fini par payer chez vous, c'était quand ? J'aimerais le lire."; }
      },
      prayer: {
        prayer_focused: function (s) { return "Je veux être honnête avec vous sur ce que je porte en ce moment : " + s + " Je ne publie pas ça pour qu'on le regarde de loin — est-ce que vous accepteriez de vous arrêter et de prier avec moi, maintenant si vous le pouvez ?"; },
        engagement: function (s) { return s + " Si vous êtes de ceux qui prient, c'est vraiment là que j'en ai le plus besoin cette semaine. Écrivez « je prie » en commentaire, que je sache que je ne porte pas ça seul."; },
        bts: function (s) { return "Tout ce que je publie n'est pas un temps fort — voici quelque chose de plus proche de ce à quoi ressemble vraiment une soirée ordinaire pour moi en ce moment : " + s + " Je ne sais pas toujours comment présenter ça joliment, alors je vous le dis simplement."; },
        pov: function (s) { return "Un instant, asseyez-vous là où je suis assis : " + s + " C'est vraiment ce que j'ai en tête en ce moment, et je voulais que vous y soyez avec moi plutôt que de l'apprendre une fois que ce sera réglé."; },
        viral: function (s) { return "Ce n'est pas ce que je mets en avant d'habitude, mais : " + s + " Je préfère être honnête avec vous plutôt que de ne montrer que les bons moments — si vous pouvez porter ça avec moi, ça compte vraiment."; },
        educational: function (s) { return "Quelque chose qu'il vaut la peine de comprendre sur cette période : " + s + " Des besoins comme celui-là font complètement partie d'une vie comme la mienne, même si mes nouvelles penchent souvent vers les belles choses — je voulais vous donner le tableau complet."; },
        quote_stat: function (s) { return s; }
      }
    }
  };

  // `meetings` is a single rollup stat like `numbers`, so it reuses that
  // category's templates rather than duplicating a near-identical set.
  function getCaption(lang, category, format, seed) {
    var set = TEMPLATES[lang] || TEMPLATES.english;
    var templateCategory = category === "meetings" ? "numbers" : category;
    return set[templateCategory][format](seed);
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
  // the sole source of truth for output language (see ApoComm.detectLanguage) —
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
      return ApoComm.splitList(rawList).map(function (raw) {
        return ApoComm.toFirstPerson(raw, regFields.FirstName, regFields.LastName, regFields.PrimaryLanguage);
      });
    }
    var byCat = {};
    byCat.highlights = toItems(intakeFields.Events, security.allow.highlights);
    byCat.prayer = toItems(intakeFields.PrayerNeeds, security.allow.prayer);
    byCat.looking_ahead = toItems(intakeFields.UpcomingProjects, security.allow.looking_ahead);
    byCat.numbers = (security.allow.numbers && intakeFields.NumbersUpdate.trim())
      ? [ApoComm.toFirstPerson(intakeFields.NumbersUpdate.trim(), regFields.FirstName, regFields.LastName, regFields.PrimaryLanguage)] : [];
    byCat.meetings = (security.allow.highlights && intakeFields.MeetingsSummary.trim())
      ? [ApoComm.toFirstPerson(intakeFields.MeetingsSummary.trim(), regFields.FirstName, regFields.LastName, regFields.PrimaryLanguage)] : [];
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

  // Core generation function. `security` must already be the result of
  // Instagram.evaluateSecurityGate(regFields) with blocked === false —
  // callers are responsible for checking the gate first. Can throw (from
  // checkLanguagePurity) — callers should wrap in try/catch.
  Instagram.build = function (regFields, intakeFields, security) {
    var lang = ApoComm.detectLanguage(regFields.PrimaryLanguage);

    var byCat = buildItemsByCategory(regFields, intakeFields, security);
    var pool = buildPool(byCat);
    var waves = buildWaves(pool);
    var target = Math.min(TARGET_POSTS, waves.length);
    var scheduled = waves.slice(0, target);

    var pairsUsed = {}; // category -> [formats]

    var posts = scheduled.map(function (entry, idx) {
      var caption = getCaption(lang, entry.item.category, entry.format, entry.item.seed);
      checkLanguagePurity(caption, entry.item.seed, lang);
      var avoided = ApoComm.applyAvoidList(caption, intakeFields.AnythingToAvoid);
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
  };

  Instagram.CATEGORY_LABEL = CATEGORY_LABEL;
  Instagram.FORMAT_META = FORMAT_META;
  Instagram.TARGET_POSTS = TARGET_POSTS;

  // ---- rendering --------------------------------------------------------

  Instagram.renderHtml = function (calendar) {
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
          '<div class="meta"><span class="topic-tag ' + p.category + '">' + ApoComm.escapeHtml(p.label) + "</span>" +
          '<span class="format-tag">' + ApoComm.escapeHtml(FORMAT_META[p.format]) + "</span></div>" +
          '<div class="caption">' + ApoComm.escapeHtml(p.caption) + "</div>" +
          '<div class="hashtags">' + ApoComm.escapeHtml(p.hashtags.join(" ")) + "</div>" +
          '<div class="graphic-note">' + ApoComm.escapeHtml(p.graphic) + "</div>" +
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
  };

  Instagram.renderText = function (calendar) {
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
  };

  Instagram.showDecisionLines = function (security, calendar) {
    var lines = [];
    lines.push('<div class="row"><strong>SecuritySensitive:</strong> ' + (security.sensitive ? "YES" : "NO") + "</div>");
    if (security.sensitive) {
      Object.keys(Instagram.TOPICS).forEach(function (key) {
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
    return lines;
  };
})(window);
