// Newsletter-specific generation logic: the 6-topic security gate, the
// language/template dictionary, paragraph expansion/weaving, and the core
// build() function. Depends on apocomm-common.js (ApoComm.splitList,
// ApoComm.isTopicAllowed, ApoComm.evaluateSecurityGate, ApoComm.toFirstPerson,
// ApoComm.applyAvoidList, ApoComm.detectLanguage) being loaded first. Exposes
// window.ApoComm.Newsletter, used by both the standalone admin/newsletter
// tool and the automated newsletter-intake flow, so this logic exists in
// exactly one place.
(function (global) {
  "use strict";

  var ApoComm = global.ApoComm = global.ApoComm || {};
  var Newsletter = ApoComm.Newsletter = ApoComm.Newsletter || {};

  Newsletter.TOPICS = {
    intro: ["intro", "summary", "bio", "background"],
    highlights: ["highlight", "event", "events"],
    prayer: ["prayer"],
    looking_ahead: ["upcoming", "project", "looking ahead"],
    numbers: ["numbers", "stats", "progress"],
    whatsapp: ["whatsapp", "phone", "contact number"]
  };

  Newsletter.evaluateSecurityGate = function (regFields) {
    return ApoComm.evaluateSecurityGate(regFields, Newsletter.TOPICS);
  };

  // ---- language templates -------------------------------------------

  var MONTHS = {
    english: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
    french: ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"]
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
      highlightsLabel: "This Month's Highlights:",
      prayerLabel: "Prayer Needs:",
      lookingAheadLabel: "Looking Ahead:",
      numbersLabel: "By the Numbers:",
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
      highlightsLabel: "Les temps forts du mois :",
      prayerLabel: "Sujets de prière :",
      lookingAheadLabel: "Ce qui s'en vient :",
      numbersLabel: "En chiffres :",
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
    }
  };

  function formatDate(dateStr, lang) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
    if (!m) return dateStr;
    var months = MONTHS[lang] || MONTHS.english;
    var monthName = months[parseInt(m[2], 10) - 1] || m[2];
    var day = parseInt(m[3], 10);
    return monthName + " " + day + ", " + m[1];
  }

  // ---- paragraph expansion -------------------------------------------

  // The missionary's monthly answers are often a single terse sentence.
  // Rather than printing that sentence bare, each section is expanded
  // into a fuller paragraph by appending fixed, hand-written reflection/
  // address sentences after the missionary's own (unaltered) sentence.
  // These banks deliberately contain no specifics — no names, numbers,
  // dates, or registration data — only generic texture and direct
  // address to the reader, so nothing is ever fabricated about what
  // actually happened and no gated registration field can leak through
  // here regardless of SecuritySensitive.
  var MIN_EXPANSION_WORDS = 150;

  var FALLBACK_COMMENT =
    "<!-- SHORT INPUT: could not reach 150 words without inventing details. " +
    "Consider asking the missionary a follow-up question next month. -->";

  var EXPANSION_BANKS = {
    english: {
      highlights: [
        "Moments like this one are exactly why I keep going, even on the harder days, because they remind me that the small, ordinary things I show up for are quietly adding up to something real.",
        "It's easy for a single sentence in an update like this to breeze right past you, but I wanted to slow down and actually sit with it for a moment, because it mattered to me more than it might look on the page.",
        "I don't always know in advance which moments will end up staying with me, and that's part of what makes this work so unpredictable and so worth it at the same time.",
        "I wanted you to be part of this, not just as someone reading about it after the fact, but as someone who's actually woven into how it was even possible in the first place.",
        "None of this happens in a vacuum, and I'm always aware that the people standing behind me — praying, giving, checking in — are as much a part of moments like this as I am.",
        "So thank you for being one of those people. I don't take that for granted, and I hope this small window into my month helps you feel a little closer to what's actually happening here."
      ],
      prayer: [
        "I try not to only share the parts of this journey that look good from the outside, because the truth is that this kind of work comes with real weight, and I don't want to carry it as if you can't handle hearing about it.",
        "Sharing a need like this isn't always easy for me — there's a part of me that wants to sound like I always have it together — but I'd rather be honest with you than perform a version of this life that isn't quite real.",
        "I believe prayer changes things in ways I can't always see or measure right away, and I'd rather ask too early than wish later that I'd said something sooner.",
        "This is the kind of thing I find myself thinking about at odd hours, and it helps to know it's not just sitting with me alone, that there are people out there holding it with me even from a distance.",
        "You don't have to understand every detail of what I'm facing to pray for me well — just knowing it's on my heart is enough for you to carry a piece of it too.",
        "So if you think of me in the coming days, this is where my mind keeps going, and I'm grateful beyond words that I don't have to carry it by myself."
      ],
      looking_ahead: [
        "I don't always know exactly how things like this will unfold, but I wanted to give you a heads-up now rather than only tell you about it after it's already happened.",
        "Looking ahead like this is honestly a little vulnerable — plans shift, timelines move, and I'd rather be upfront about what I'm hoping for than pretend I have it all figured out.",
        "Part of why I like sharing what's coming, not just what's already happened, is that it gives you a chance to be praying and thinking about it before the fact, not just hearing the recap.",
        "I've learned that the space between planning something and actually doing it is where a lot of the real work happens, even when it doesn't look like much from the outside yet.",
        "If you've ever waited on something you couldn't fully control the timeline for, you know a little of what this season feels like for me right now.",
        "I'll keep you posted as this develops — for now, I just wanted you to be among the first to know it's on the horizon."
      ],
      numbers: [
        "I know a number like this can look small when you read it quickly, but behind every single digit is a real conversation, a real relationship, a real step that took time and trust to get to.",
        "It's tempting to only celebrate the big, dramatic milestones, but I've come to appreciate how much of this work actually happens in smaller, steadier movements that don't always make for an exciting headline.",
        "I want to be honest that progress here doesn't always move in a straight line, and I'd rather tell you the real, modest number than dress it up into something it isn't.",
        "Every bit of movement like this represents people saying yes in ways big and small, and I don't think that should ever be treated as ordinary, even when it happens gradually.",
        "When I look at where things stood a few months ago compared to now, it's a good reminder that steady, faithful effort is still effort, even when it doesn't feel dramatic in the moment.",
        "I wanted you to see this number specifically because you're part of it — your support isn't background noise to me, it's actually showing up in movement like this."
      ]
    },
    french: {
      highlights: [
        "Des moments comme celui-ci sont exactement la raison pour laquelle je continue, même les jours plus difficiles, parce qu'ils me rappellent que les petites choses ordinaires finissent par compter pour de vrai.",
        "Une seule phrase dans une lettre comme celle-ci peut facilement passer inaperçue, mais j'ai voulu prendre le temps de m'y arrêter, parce que ce moment a compté pour moi bien plus qu'il n'y paraît sur le papier.",
        "Je ne sais jamais à l'avance quels moments resteront gravés en moi, et c'est en partie ce qui rend ce travail si imprévisible et si précieux à la fois.",
        "J'ai voulu que vous fassiez partie de ce moment, pas seulement en le lisant après coup, mais en sachant que vous en faites vraiment partie.",
        "Rien de tout cela n'arrive dans le vide, et je sais bien que les personnes qui me soutiennent — en priant, en donnant, en prenant de mes nouvelles — font partie de ces moments autant que moi.",
        "Merci donc de faire partie de ces personnes-là. Je ne le prends pas à la légère, et j'espère que ce petit aperçu de mon mois vous rapproche un peu de ce qui se vit vraiment ici."
      ],
      prayer: [
        "J'essaie de ne pas partager seulement les parties qui donnent une belle image, parce que ce travail comporte un vrai poids, et je ne veux pas faire comme si vous ne pouviez pas l'entendre.",
        "Partager un besoin comme celui-ci n'est pas toujours facile pour moi, mais je préfère être honnête avec vous plutôt que de jouer un rôle qui ne serait pas tout à fait vrai.",
        "Je crois que la prière change vraiment les choses, même quand je ne le vois pas tout de suite, et je préfère demander trop tôt que regretter plus tard de ne pas l'avoir dit.",
        "C'est le genre de chose à laquelle je pense à des heures étranges, et ça m'aide de savoir que je ne le porte pas seul, que d'autres le portent avec moi même à distance.",
        "Vous n'avez pas besoin de connaître tous les détails pour bien prier pour moi — savoir que c'est sur mon cœur suffit pour que vous en portiez une part avec moi.",
        "Alors si vous pensez à moi dans les jours qui viennent, voilà ce qui occupe mon esprit, et je suis reconnaissant de ne pas avoir à le porter seul."
      ],
      looking_ahead: [
        "Je ne sais pas toujours exactement comment les choses vont se dérouler, mais je préfère vous en parler dès maintenant plutôt que seulement après coup.",
        "Partager ce qui s'en vient, c'est un peu vulnérable, honnêtement — les plans changent, les délais bougent, et je préfère être transparent sur ce que j'espère plutôt que de prétendre tout maîtriser.",
        "Ce que j'aime en partageant ce qui arrive, pas seulement ce qui s'est déjà passé, c'est que ça vous donne l'occasion d'y penser et d'en prier avant, pas seulement d'en entendre le résumé après.",
        "J'ai appris que l'espace entre planifier quelque chose et le vivre vraiment, c'est souvent là que se passe le plus gros du travail, même si ça ne se voit pas encore de l'extérieur.",
        "Si vous avez déjà attendu quelque chose dont vous ne maîtrisiez pas le calendrier, vous comprenez un peu ce que je vis en ce moment.",
        "Je vous tiendrai au courant à mesure que ça avance — pour l'instant, je voulais juste que vous soyez parmi les premiers à savoir."
      ],
      numbers: [
        "Je sais qu'un chiffre comme celui-ci peut sembler petit à première vue, mais derrière chaque chiffre il y a une vraie conversation, une vraie relation, une vraie étape qui a pris du temps et de la confiance.",
        "Il est tentant de ne célébrer que les grandes étapes spectaculaires, mais j'ai appris à apprécier combien ce travail avance surtout par petits pas réguliers, moins impressionnants mais tout aussi réels.",
        "Je préfère être honnête : les progrès ici n'avancent pas toujours en ligne droite, et je préfère vous donner le vrai chiffre, modeste, plutôt que de l'enjoliver.",
        "Chaque petit mouvement comme celui-ci représente des personnes qui disent oui, à leur façon, et je ne pense pas que cela devrait jamais être considéré comme ordinaire.",
        "Quand je compare la situation d'il y a quelques mois à aujourd'hui, ça me rappelle qu'un effort constant reste un effort, même quand il ne semble pas spectaculaire sur le moment.",
        "Je voulais que vous voyiez ce chiffre en particulier parce que vous en faites partie — votre soutien n'est pas anodin pour moi, il se traduit vraiment par ce genre de mouvement."
      ]
    }
  };

  // Lead-in clauses used to weave multiple real list items (Events,
  // PrayerNeeds, UpcomingProjects) into one flowing section instead of a
  // bullet list. Each ends with a colon; the next item follows as its own
  // sentence, so no grammar-splicing with the item's own wording is ever
  // needed. Purely connective — no facts, numbers, or specifics live here.
  var CONNECTORS = {
    english: {
      highlights: ["On top of that: ", "Around the same time: ", "I also want to tell you about this: ", "And maybe most memorably: ", "There's more too: ", "One more thing worth sharing: "],
      prayer: ["I also want to ask for prayer about this: ", "Something else I'm carrying: ", "And one more need: ", "On top of that: ", "There's this too: ", "One more thing I'd love prayer for: "],
      looking_ahead: ["I'm also looking ahead to this: ", "Coming up too: ", "And further down the road: ", "Something else on the horizon: ", "There's this too: ", "One more thing I'm anticipating: "]
    },
    french: {
      highlights: ["En plus de ça : ", "À peu près au même moment : ", "Je veux aussi vous parler de ceci : ", "Et peut-être le plus marquant : ", "Il y a aussi ceci : ", "Une dernière chose à partager : "],
      prayer: ["Je veux aussi vous demander de prier pour ceci : ", "Autre chose que je porte : ", "Et un autre besoin : ", "En plus de ça : ", "Il y a aussi ceci : ", "Une dernière chose pour laquelle j'aimerais de la prière : "],
      looking_ahead: ["Je pense aussi à ceci : ", "Autre chose à venir : ", "Et plus loin encore : ", "Autre chose à l'horizon : ", "Il y a aussi ceci : ", "Une dernière chose que j'anticipe : "]
    }
  };

  function wordCount(text) {
    var trimmed = text.trim();
    return trimmed ? trimmed.split(/\s+/).length : 0;
  }

  function withFallbackNote(expansion) {
    return expansion.reachedMin ? expansion.text : expansion.text + "\n" + FALLBACK_COMMENT;
  }

  // Weaves any number of real, unaltered list items into one flowing
  // passage, connecting item 2+ with a rotating lead-in phrase. Never
  // itemizes ("first... second... third...") and never adds a fact —
  // purely the missionary's own sentences plus fixed connective tissue.
  function weaveItems(items, connectors) {
    if (items.length === 0) return "";
    // Every item but the last is followed by a connector that opens a new
    // sentence, so each needs its own terminal mark — see
    // ApoComm.endSentence(). The last one is closed too, since free text or
    // an expansion line may follow it.
    var parts = [ApoComm.endSentence(items[0])];
    for (var i = 1; i < items.length; i++) {
      var connector = connectors[(i - 1) % connectors.length];
      parts.push(connector + ApoComm.endSentence(items[i]));
    }
    return parts.join(" ");
  }

  // Builds one newsletter section from any mix of list items and/or a
  // single free-text rollup (e.g. MeetingsSummary, NumbersUpdate). The
  // anti-fabrication rule applies to the section as a whole, not per
  // item: real material (however much or little there is) is woven
  // together first, then — and only if still short — the same generic,
  // non-specific reflection bank used elsewhere tops it up toward
  // minWords. Returns null if there is no real material at all, so the
  // caller can skip the section entirely rather than padding it.
  function buildSection(items, freeText, connectors, bank, minWords) {
    var woven = weaveItems(items, connectors);
    var tail = freeText ? ApoComm.endSentence(freeText) : "";
    var text = tail ? (woven ? woven + " " + tail : tail) : woven;
    if (!text) return null;
    for (var i = 0; i < bank.length && wordCount(text) < minWords; i++) {
      text += " " + bank[i];
    }
    return { text: text, reachedMin: wordCount(text) >= minWords };
  }

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

  // Core generation function. `security` must already be the result of
  // Newsletter.evaluateSecurityGate(regFields) with blocked === false —
  // callers are responsible for checking the gate first.
  Newsletter.build = function (regFields, intakeFields, security) {
    var lang = ApoComm.detectLanguage(regFields.PrimaryLanguage);
    var t = TEMPLATES[lang];
    var name = regFields.FirstName.trim();
    var isFirst = intakeFields.IsFirstNewsletter.trim().toLowerCase() === "yes";

    var paragraphs = [];

    if (isFirst) {
      var introAllowed = security.allow.intro;
      if (introAllowed) {
        var summaryFirstPerson = ApoComm.toFirstPerson(regFields.MissionSummary.trim(), regFields.FirstName, regFields.LastName, regFields.PrimaryLanguage);
        paragraphs.push(t.introDetailed(summaryFirstPerson, formatDate(regFields.DepartureDate, lang)));
      } else {
        paragraphs.push(t.introGeneric());
      }
    }

    var banks = EXPANSION_BANKS[lang] || EXPANSION_BANKS.english;
    var connectors = CONNECTORS[lang] || CONNECTORS.english;
    var expansionNotes = [];

    function convertAll(rawList) {
      return ApoComm.splitList(rawList).map(function (item) {
        return ApoComm.toFirstPerson(item, regFields.FirstName, regFields.LastName, regFields.PrimaryLanguage);
      });
    }

    var eventItems = security.allow.highlights ? convertAll(intakeFields.Events) : [];
    var meetingsText = (security.allow.highlights && intakeFields.MeetingsSummary.trim())
      ? ApoComm.toFirstPerson(intakeFields.MeetingsSummary.trim(), regFields.FirstName, regFields.LastName, regFields.PrimaryLanguage) : "";
    var highlightsSection = buildSection(eventItems, meetingsText, connectors.highlights, banks.highlights, MIN_EXPANSION_WORDS);
    if (highlightsSection) {
      paragraphs.push(t.highlightsLabel + "\n" + withFallbackNote(highlightsSection));
      expansionNotes.push({ section: "Highlights", words: wordCount(highlightsSection.text), reachedMin: highlightsSection.reachedMin });
    }

    var prayerItems = security.allow.prayer ? convertAll(intakeFields.PrayerNeeds) : [];
    var prayerSection = buildSection(prayerItems, "", connectors.prayer, banks.prayer, MIN_EXPANSION_WORDS);
    if (prayerSection) {
      paragraphs.push(t.prayerLabel + "\n" + withFallbackNote(prayerSection));
      expansionNotes.push({ section: "PrayerNeeds", words: wordCount(prayerSection.text), reachedMin: prayerSection.reachedMin });
    }

    var projectItems = security.allow.looking_ahead ? convertAll(intakeFields.UpcomingProjects) : [];
    var lookingAheadSection = buildSection(projectItems, "", connectors.looking_ahead, banks.looking_ahead, MIN_EXPANSION_WORDS);
    if (lookingAheadSection) {
      paragraphs.push(t.lookingAheadLabel + "\n" + withFallbackNote(lookingAheadSection));
      expansionNotes.push({ section: "UpcomingProjects", words: wordCount(lookingAheadSection.text), reachedMin: lookingAheadSection.reachedMin });
    }

    var numbersText = (security.allow.numbers && intakeFields.NumbersUpdate.trim())
      ? ApoComm.toFirstPerson(intakeFields.NumbersUpdate.trim(), regFields.FirstName, regFields.LastName, regFields.PrimaryLanguage) : "";
    var numbersSection = buildSection([], numbersText, [], banks.numbers, MIN_EXPANSION_WORDS);
    if (numbersSection) {
      paragraphs.push(t.numbersLabel + "\n" + withFallbackNote(numbersSection));
      expansionNotes.push({ section: "NumbersUpdate", words: wordCount(numbersSection.text), reachedMin: numbersSection.reachedMin });
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

    var avoidSubject = ApoComm.applyAvoidList(subject, intakeFields.AnythingToAvoid);
    var avoidBody = ApoComm.applyAvoidList(body, intakeFields.AnythingToAvoid);

    return {
      subject: avoidSubject.text,
      body: avoidBody.text,
      redactions: avoidBody.applied.concat(
        avoidSubject.applied.filter(function (a) { return a.found; }).map(function (a) {
          return { term: a.term, found: true, inSubject: true };
        })
      ),
      expansionNotes: expansionNotes
    };
  };
})(window);
