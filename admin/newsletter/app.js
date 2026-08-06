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
      highlight: [
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
      highlight: [
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
      numbers: [
        "Je sais qu'un chiffre comme celui-ci peut sembler petit à première vue, mais derrière chaque chiffre il y a une vraie conversation, une vraie relation, une vraie étape qui a pris du temps et de la confiance.",
        "Il est tentant de ne célébrer que les grandes étapes spectaculaires, mais j'ai appris à apprécier combien ce travail avance surtout par petits pas réguliers, moins impressionnants mais tout aussi réels.",
        "Je préfère être honnête : les progrès ici n'avancent pas toujours en ligne droite, et je préfère vous donner le vrai chiffre, modeste, plutôt que de l'enjoliver.",
        "Chaque petit mouvement comme celui-ci représente des personnes qui disent oui, à leur façon, et je ne pense pas que cela devrait jamais être considéré comme ordinaire.",
        "Quand je compare la situation d'il y a quelques mois à aujourd'hui, ça me rappelle qu'un effort constant reste un effort, même quand il ne semble pas spectaculaire sur le moment.",
        "Je voulais que vous voyiez ce chiffre en particulier parce que vous en faites partie — votre soutien n'est pas anodin pour moi, il se traduit vraiment par ce genre de mouvement."
      ]
    },
    spanish: {
      highlight: [
        "Momentos como este son exactamente la razón por la que sigo adelante, incluso en los días más difíciles, porque me recuerdan que las pequeñas cosas cotidianas realmente van sumando algo real.",
        "Una sola frase en una actualización como esta puede pasar desapercibida fácilmente, pero quise detenerme y prestarle atención, porque significó para mí mucho más de lo que parece en el papel.",
        "Nunca sé de antemano qué momentos terminarán quedándose conmigo, y eso es parte de lo que hace este trabajo tan impredecible y tan valioso a la vez.",
        "Quise que fueras parte de esto, no solo leyéndolo después, sino sabiendo que realmente formas parte de cómo fue posible.",
        "Nada de esto ocurre en el vacío, y siempre soy consciente de que las personas que me respaldan —orando, dando, preguntando por mí— son parte de momentos como este tanto como yo.",
        "Así que gracias por ser una de esas personas. No lo doy por sentado, y espero que esta pequeña ventana a mi mes te acerque un poco más a lo que realmente vivo aquí."
      ],
      prayer: [
        "Trato de no compartir solo las partes que se ven bien desde afuera, porque la verdad es que este trabajo tiene un peso real, y no quiero tratarte como si no pudieras escucharlo.",
        "Compartir una necesidad como esta no siempre es fácil para mí, pero prefiero ser honesto contigo antes que fingir una versión de esta vida que no sea del todo real.",
        "Creo que la oración cambia las cosas de maneras que no siempre puedo ver de inmediato, y prefiero pedirla demasiado pronto que lamentar después no haberlo dicho.",
        "Es el tipo de cosa en la que pienso a horas extrañas, y me ayuda saber que no la cargo solo, que hay personas sosteniéndola conmigo aunque estén lejos.",
        "No necesitas conocer cada detalle de lo que enfrento para orar bien por mí — con saber que está en mi corazón basta para que lleves una parte de ello también.",
        "Así que si piensas en mí en los próximos días, esto es lo que ocupa mi mente, y estoy profundamente agradecido de no tener que cargarlo solo."
      ],
      numbers: [
        "Sé que un número como este puede parecer pequeño a primera vista, pero detrás de cada cifra hay una conversación real, una relación real, un paso real que tomó tiempo y confianza.",
        "Es tentador celebrar solo los grandes hitos dramáticos, pero he aprendido a valorar cuánto de este trabajo ocurre en realidad en pasos más pequeños y constantes.",
        "Quiero ser honesto: el progreso aquí no siempre avanza en línea recta, y prefiero darte el número real, modesto, en lugar de exagerarlo.",
        "Cada pequeño movimiento como este representa a personas diciendo que sí, a su manera, y no creo que eso deba tratarse nunca como algo ordinario.",
        "Cuando comparo cómo estaban las cosas hace unos meses con ahora, me recuerda que el esfuerzo constante sigue siendo esfuerzo, aunque no se sienta dramático en el momento.",
        "Quise que vieras este número en particular porque eres parte de él — tu apoyo no es ruido de fondo para mí, realmente se refleja en movimiento como este."
      ]
    },
    portuguese: {
      highlight: [
        "Momentos como este são exatamente o motivo pelo qual eu continuo, mesmo nos dias mais difíceis, porque me lembram que as pequenas coisas do cotidiano realmente vão somando algo real.",
        "Uma única frase em uma atualização como esta pode passar despercebida facilmente, mas eu quis parar e prestar atenção nela, porque significou para mim muito mais do que parece no papel.",
        "Eu nunca sei de antemão quais momentos vão ficar comigo, e isso é parte do que torna este trabalho tão imprevisível e tão valioso ao mesmo tempo.",
        "Eu quis que você fizesse parte disso, não só lendo depois, mas sabendo que você realmente faz parte de como isso foi possível.",
        "Nada disso acontece no vazio, e eu sempre sei que as pessoas que me apoiam — orando, doando, perguntando por mim — fazem parte de momentos como este tanto quanto eu.",
        "Então obrigado por ser uma dessas pessoas. Eu não considero isso garantido, e espero que essa pequena janela para o meu mês te aproxime um pouco mais do que realmente vivo aqui."
      ],
      prayer: [
        "Eu tento não compartilhar só as partes que parecem boas de fora, porque a verdade é que este trabalho tem um peso real, e eu não quero tratar você como se não pudesse ouvir isso.",
        "Compartilhar uma necessidade como esta nem sempre é fácil para mim, mas prefiro ser honesto com você do que fingir uma versão desta vida que não seja bem real.",
        "Eu acredito que a oração muda as coisas de formas que nem sempre consigo ver de imediato, e prefiro pedir cedo demais do que me arrepender depois de não ter dito nada.",
        "É o tipo de coisa em que penso em horários estranhos, e me ajuda saber que não carrego isso sozinho, que há pessoas segurando isso comigo mesmo à distância.",
        "Você não precisa conhecer cada detalhe do que estou enfrentando para orar bem por mim — só de saber que está no meu coração já é o suficiente para você carregar um pedaço também.",
        "Então, se você pensar em mim nos próximos dias, é nisso que minha mente continua voltando, e sou profundamente grato por não ter que carregar isso sozinho."
      ],
      numbers: [
        "Eu sei que um número como este pode parecer pequeno à primeira vista, mas por trás de cada número há uma conversa real, um relacionamento real, um passo real que levou tempo e confiança.",
        "É tentador celebrar só os grandes marcos dramáticos, mas aprendi a valorizar o quanto deste trabalho realmente acontece em passos menores e mais constantes.",
        "Quero ser honesto: o progresso aqui nem sempre avança em linha reta, e prefiro te dar o número real, modesto, em vez de exagerá-lo.",
        "Cada pequeno movimento como este representa pessoas dizendo sim, do seu próprio jeito, e eu não acho que isso deva ser tratado como algo comum.",
        "Quando comparo como as coisas estavam há alguns meses com agora, isso me lembra que esforço constante ainda é esforço, mesmo quando não parece dramático no momento.",
        "Eu quis que você visse esse número especificamente porque você faz parte dele — seu apoio não é ruído de fundo para mim, ele realmente aparece em movimento como este."
      ]
    }
  };

  function wordCount(text) {
    var trimmed = text.trim();
    return trimmed ? trimmed.split(/\s+/).length : 0;
  }

  // Appends bank sentences (in order) after the missionary's own,
  // unaltered seed sentence until the paragraph reaches minWords.
  // Never fabricates: everything appended comes from the fixed bank.
  function expandParagraph(seed, bank, minWords) {
    var text = seed.trim();
    for (var i = 0; i < bank.length && wordCount(text) < minWords; i++) {
      text += " " + bank[i];
    }
    return { text: text, reachedMin: wordCount(text) >= minWords };
  }

  function withFallbackNote(expansion) {
    return expansion.reachedMin ? expansion.text : expansion.text + "\n" + FALLBACK_COMMENT;
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

    var banks = EXPANSION_BANKS[lang] || EXPANSION_BANKS.english;
    var expansionNotes = [];

    if (intakeFields.Highlight.trim()) {
      if (security.allow.highlight) {
        var highlightSeed = toFirstPerson(intakeFields.Highlight.trim(), regFields.FirstName, regFields.LastName);
        var highlightExp = expandParagraph(highlightSeed, banks.highlight, MIN_EXPANSION_WORDS);
        paragraphs.push(withFallbackNote(highlightExp));
        expansionNotes.push({ section: "Highlight", words: wordCount(highlightExp.text), reachedMin: highlightExp.reachedMin });
      }
    }

    if (intakeFields.PrayerRequest.trim() && security.allow.prayer) {
      var prayerSeed = toFirstPerson(intakeFields.PrayerRequest.trim(), regFields.FirstName, regFields.LastName);
      var prayerExp = expandParagraph(prayerSeed, banks.prayer, MIN_EXPANSION_WORDS);
      paragraphs.push(t.prayerLabel + "\n" + withFallbackNote(prayerExp));
      expansionNotes.push({ section: "PrayerRequest", words: wordCount(prayerExp.text), reachedMin: prayerExp.reachedMin });
    }

    if (intakeFields.NumbersUpdate.trim() && security.allow.numbers) {
      var numbersSeed = toFirstPerson(intakeFields.NumbersUpdate.trim(), regFields.FirstName, regFields.LastName);
      var numbersExp = expandParagraph(numbersSeed, banks.numbers, MIN_EXPANSION_WORDS);
      paragraphs.push(t.numbersLabel + "\n" + withFallbackNote(numbersExp));
      expansionNotes.push({ section: "NumbersUpdate", words: wordCount(numbersExp.text), reachedMin: numbersExp.reachedMin });
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
      ),
      expansionNotes: expansionNotes
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

  function showDecision(security, redactions, expansionNotes) {
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
    if (expansionNotes && expansionNotes.length) {
      lines.push('<div class="row"><strong>Paragraph length:</strong> ' +
        expansionNotes.map(function (n) {
          return n.section + ": " + n.words + " words" + (n.reachedMin ? "" : " (below 150 — see SHORT INPUT comment in body)");
        }).join("; ") +
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

    showDecision(security, draft.redactions, draft.expansionNotes);

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
