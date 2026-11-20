/* Apostello Comm — the missionary's own space.
 *
 * The one page a client ever opens. It takes a token from the URL
 * fragment, asks the backend who that is, and renders their site link plus
 * their newsletter and Instagram posts for a chosen month.
 *
 * The content is REGENERATED here, not stored. The generators are pure
 * functions of (registration row, intake row) and the sheet already holds
 * both, so there is nothing to keep in sync and no second copy to go
 * stale. It also means this page and the admin tools cannot disagree:
 * they call the same ApoComm.Newsletter.build() and
 * ApoComm.Instagram.build().
 *
 * Two things this page deliberately does not do. It never writes — a
 * missionary cannot change their record from here. And it never receives
 * Security_Instructions: the backend blanks it, so a flagged profile gets
 * `canGenerate: false` and a pointer to their Apostello contact rather
 * than content assembled in a browser.
 */
(function () {
  "use strict";

  var TEXT = {
    english: {
      greeting: function (n) { return "Hello " + n; },
      lede: "Your page, your newsletter and your posts — all in one place.",
      siteTitle: "My page",
      siteReady: "Your public page is online. Share this link with anyone you like.",
      siteNotYet: "Your public page is not online yet. Your Apostello contact will let you know as soon as it is.",
      openSite: "Open my page",
      humanTitle: "Your content is prepared with your contact",
      humanBody: "Because of your situation on the ground, nothing is written automatically for you. Your Apostello contact prepares each month with you, by hand. Get in touch with them whenever you need something.",
      monthTitle: "This month",
      monthLabel: "Month",
      newsletterTitle: "My newsletter",
      newsletterNote: "A draft, written from what you sent us. Read it, change anything that does not sound like you, and tell your contact.",
      subjectLabel: "Subject:",
      instagramTitle: "My posts",
      instagramNote: "Ready to publish, one per slot. The picture is yours to choose.",
      copy: "Copy",
      copyAll: "Copy all",
      copied: "Copied.",
      copyFailed: "Copy did not work — select the text and copy it by hand.",
      noMonthTitle: "Nothing yet",
      noMonthBody: "You have not sent us your news yet. As soon as you fill in the monthly form, your newsletter and your posts will appear here.",
      renderFailTitle: "We couldn’t prepare this month",
      renderFailBody: "Your news reached us — nothing you sent has been lost. Something went wrong on our side while putting it together. Please tell your Apostello contact, and they will sort it out.",
      sectionFailed: "This part couldn’t be prepared. Your contact can sort it out.",
      generatedLegend: "The highlighted sentences were added automatically to fill out a short section — you did not write them. Read them over and cut or change anything that isn’t yours.",
      noAccessTitle: "This link isn’t working",
      noAccessGeneric: "Ask your Apostello contact to send you a fresh link.",
      offlineTitle: "We can’t reach your file right now",
      offlineBody: "Your link is fine — the trouble is on our side. Please try again in a few minutes.",
      months: ["January", "February", "March", "April", "May", "June",
               "July", "August", "September", "October", "November", "December"],
      foot: "This link is personal to you. We will never ask you for a password.",
      blocked: "Nothing could be prepared for this month.",
      week: "Week"
    },
    french: {
      greeting: function (n) { return "Bonjour " + n; },
      lede: "Votre page, votre lettre de nouvelles et vos publications, au même endroit.",
      siteTitle: "Ma page",
      siteReady: "Votre page publique est en ligne. Partagez ce lien avec qui vous voulez.",
      siteNotYet: "Votre page publique n’est pas encore en ligne. Votre interlocuteur Apostello vous préviendra dès qu’elle le sera.",
      openSite: "Ouvrir ma page",
      humanTitle: "Vos contenus sont préparés avec votre interlocuteur",
      humanBody: "Compte tenu de votre situation sur le terrain, rien n’est rédigé automatiquement pour vous. Votre interlocuteur Apostello prépare chaque mois avec vous, à la main. Écrivez-lui dès que vous avez besoin de quelque chose.",
      monthTitle: "Ce mois-ci",
      monthLabel: "Mois",
      newsletterTitle: "Ma lettre de nouvelles",
      newsletterNote: "Un brouillon, écrit à partir de ce que vous nous avez envoyé. Relisez-le, changez ce qui ne vous ressemble pas, et dites-le à votre interlocuteur.",
      subjectLabel: "Objet :",
      instagramTitle: "Mes publications",
      instagramNote: "Prêtes à publier, une par case. La photo reste votre choix.",
      copy: "Copier",
      copyAll: "Tout copier",
      copied: "Copié.",
      copyFailed: "La copie n’a pas fonctionné — sélectionnez le texte et copiez-le à la main.",
      noMonthTitle: "Rien pour l’instant",
      noMonthBody: "Vous ne nous avez pas encore envoyé vos nouvelles. Dès que vous remplirez le formulaire mensuel, votre lettre et vos publications apparaîtront ici.",
      renderFailTitle: "Nous n’avons pas pu préparer ce mois",
      renderFailBody: "Vos nouvelles nous sont bien parvenues — rien de ce que vous avez envoyé n’est perdu. Quelque chose a bloqué de notre côté au moment de les mettre en forme. Signalez-le à votre interlocuteur Apostello, il s’en occupera.",
      sectionFailed: "Cette partie n’a pas pu être préparée. Votre interlocuteur peut s’en occuper.",
      generatedLegend: "Les phrases surlignées ont été ajoutées automatiquement pour étoffer une section trop courte — ce n’est pas vous qui les avez écrites. Relisez-les et coupez ou modifiez ce qui ne vous ressemble pas.",
      noAccessTitle: "Ce lien ne fonctionne pas",
      noAccessGeneric: "Demandez à votre interlocuteur Apostello de vous envoyer un nouveau lien.",
      offlineTitle: "Nous n’arrivons pas à ouvrir votre dossier",
      offlineBody: "Votre lien est bon — la panne est de notre côté. Réessayez dans quelques minutes.",
      months: ["janvier", "février", "mars", "avril", "mai", "juin",
               "juillet", "août", "septembre", "octobre", "novembre", "décembre"],
      foot: "Ce lien vous est personnel. Nous ne vous demanderons jamais de mot de passe.",
      blocked: "Rien n’a pu être préparé pour ce mois.",
      week: "Semaine"
    }
  };

  var el = function (id) { return document.getElementById(id); };
  var T = TEXT.english;
  var space = null;
  // The months actually offered in the picker: space.months with repeats
  // of the same month collapsed. renderMonth() indexes into THIS, not
  // space.months, or the option values stop matching the rows.
  var visibleMonths = [];

  function setText(id, value) { var n = el(id); if (n) n.textContent = value; }

  function show(id, visible) { var n = el(id); if (n) n.hidden = !visible; }

  // The token lives in the fragment rather than the query string, so it
  // stays out of Referer headers and server logs. Accept ?t= too, since a
  // mail client that rewrites links may turn one into the other.
  function readToken() {
    var hash = (window.location.hash || "").replace(/^#/, "");
    var m = /(?:^|&)t=([^&]+)/.exec(hash);
    if (m) return decodeURIComponent(m[1]);
    m = /(?:^|&)t=([^&]+)/.exec((window.location.search || "").replace(/^\?/, ""));
    return m ? decodeURIComponent(m[1]) : "";
  }

  function applyLanguage(lang) {
    T = TEXT[lang] || TEXT.english;
    document.documentElement.lang = lang === "french" ? "fr" : "en";
    setText("lede", T.lede);
    setText("site-title", T.siteTitle);
    setText("human-only-title", T.humanTitle);
    setText("human-only-body", T.humanBody);
    setText("month-title", T.monthTitle);
    setText("month-label", T.monthLabel);
    setText("newsletter-title", T.newsletterTitle);
    setText("newsletter-note", T.newsletterNote);
    setText("subject-label", T.subjectLabel);
    setText("instagram-title", T.instagramTitle);
    setText("instagram-note", T.instagramNote);
    setText("no-month-title", T.noMonthTitle);
    setText("no-month-body", T.noMonthBody);
    setText("foot-note", T.foot);
    el("copy-newsletter").textContent = T.copy;
    el("copy-instagram").textContent = T.copyAll;
    el("site-link").textContent = T.openSite;
  }

  /* A refusal happens before we know who is knocking — an unrecognised
     token tells us nothing about the person's language — so this panel
     speaks both, French first because most of the client base does. The
     backend's own `reason` string is deliberately not shown: it is written
     in English only, and a French missionary reading an English error is
     worse than a plain message in their own language. The two cases differ
     in what the reader should DO, which is the whole point of separating
     them: a dead link means ask for a new one, an unreachable server means
     wait and come back. */
  function refuse(kind) {
    var down = kind === "offline";
    setText("no-access-title", down ? TEXT.french.offlineTitle : TEXT.french.noAccessTitle);
    setText("no-access-body", down ? TEXT.french.offlineBody : TEXT.french.noAccessGeneric);
    setText("no-access-title-en", down ? TEXT.english.offlineTitle : TEXT.english.noAccessTitle);
    setText("no-access-body-en", down ? TEXT.english.offlineBody : TEXT.english.noAccessGeneric);
    show("no-access", true);
    show("content", false);
    setText("lede", "");
    // The footer explains that the link is personal and that we never ask
    // for a password. On a refusal there is no link to speak of, and the
    // note would sit under an empty rule, so the whole footer goes.
    show("foot", false);
  }

  /* The backend cannot know whether a site file has actually been committed
     to /sites/<ClientID>/, so the page asks. Promising a link that 404s is
     worse than saying "not yet" — the missionary would send it to their
     partners before discovering it. */
  function checkSite(url) {
    return fetch(url, { method: "GET", cache: "no-store" })
      .then(function (r) { return r.ok; })
      .catch(function () { return false; });
  }

  function renderSite() {
    checkSite(space.siteUrl).then(function (live) {
      setText("site-body", live ? T.siteReady : T.siteNotYet);
      if (live) {
        el("site-link").href = space.siteUrl;
        show("site-link-wrap", true);
      }
    });
  }

  /* "2026-11" is how the sheet is meant to key a month; "novembre 2026" is
     how a person reads one.

     The sheet does not always hold the string, though: Google Sheets
     auto-coerces a cell written as "2026-11" into a real date, and Apps
     Script then hands it back as a Date, which arrives here JSON-serialized
     as "2026-11-01T07:00:00.000Z". Shown raw, that is what a missionary
     reads in their own month picker. So this accepts either shape. The
     underlying coercion is a backend defect and is fixed there too — this
     is what keeps the rows already written that way readable. */
  function monthKey(value) {
    var p = ApoComm.monthParts(value);
    return p ? p.year + "-" + ("0" + p.month).slice(-2) : "";
  }

  function monthLabel(value) {
    var p = ApoComm.monthParts(value);
    if (!p) return String(value == null ? "" : value);
    var name = T.months[p.month - 1];
    return name ? name + " " + p.year : p.year + "-" + ("0" + p.month).slice(-2);
  }

  /* One entry per month, not one per row. saveIntake appends rather than
     replacing, so a missionary who submits twice for the same month has two
     rows, and listing both offers them a choice between two things with the
     same name. The first wins, matching the order the backend sends (most
     recent month first). Collapsing them here is a display decision only —
     the duplicate rows are a backend defect and are fixed there. */
  function renderMonthOptions() {
    var select = el("month-select");
    select.innerHTML = "";
    var seen = {};
    visibleMonths = [];
    space.months.forEach(function (m) {
      var key = monthKey(m.month) || String(m.month);
      if (seen[key]) return;
      seen[key] = true;
      visibleMonths.push(m);
    });
    visibleMonths.forEach(function (m, i) {
      var opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = monthLabel(m.month);
      select.appendChild(opt);
    });
  }

  function renderMonth(index) {
    var entry = visibleMonths[index];
    if (!entry) return;

    // backendRowToRegFields(), NOT parseRow(). parseRow() is the strict
    // parser for a row a human pasted into a textarea: it demands exactly
    // REG_COLUMNS.length columns and throws otherwise. The backend returns
    // the sheet row as it stands — 38 values, the 36 real columns plus the
    // two calculated ones — so joining it with tabs and feeding it to
    // parseRow threw "expected 36, got 38" the moment a client had an
    // intake to render. backendRowToRegFields() maps by index over the 36
    // known names and ignores anything after them, which is what every
    // other tool already does with a backend row. It also avoids
    // round-tripping structured values through a tab-joined string, where
    // a tab inside a free-text field would shift every later column.
    var regFields = ApoComm.backendRowToRegFields(space.regRow);
    var intakeFields = ApoComm.backendRowToIntakeFields(entry.row);

    var nlSecurity = ApoComm.Newsletter.evaluateSecurityGate(regFields);
    if (nlSecurity.blocked) {
      el("newsletter-subject").textContent = "";
      el("newsletter-body").textContent = T.blocked;
      el("instagram-posts").innerHTML = "<p>" + ApoComm.escapeHtml(T.blocked) + "</p>";
      return;
    }

    // Each generator is caught on its own. They share their inputs but not
    // their failure: a newsletter that throws should not also cost the
    // missionary their Instagram posts, and vice versa.
    try {
      var nl = ApoComm.Newsletter.build(regFields, intakeFields, nlSecurity);
      el("newsletter-subject").textContent = nl.subject;
      renderNewsletterBody(nl.body, nl.generated || []);
    } catch (e) {
      console.error("[ApoComm.Espace] newsletter:", e);
      el("newsletter-subject").textContent = "";
      el("newsletter-body").textContent = T.sectionFailed;
    }

    var posts = [];
    try {
      var ig = ApoComm.Instagram.build(regFields, intakeFields, ApoComm.Instagram.evaluateSecurityGate(regFields));
      posts = ig.posts || [];
    } catch (e) {
      console.error("[ApoComm.Espace] instagram:", e);
      el("instagram-posts").innerHTML = "<p>" + ApoComm.escapeHtml(T.sectionFailed) + "</p>";
      return;
    }

    var host = el("instagram-posts");
    host.innerHTML = "";
    posts.forEach(function (p, i) {
      var card = document.createElement("article");
      card.className = "post";
      var week = Math.floor(i / 4) + 1;
      card.innerHTML =
        '<p class="post-meta">' + ApoComm.escapeHtml(T.week + " " + week) + "</p>" +
        '<p class="post-caption">' + ApoComm.escapeHtml(p.caption) + "</p>" +
        '<p class="post-tags">' + ApoComm.escapeHtml(p.hashtags || "") + "</p>";
      host.appendChild(card);
    });
  }

  /* Writes the newsletter body with the reflection-bank sentences marked.
   *
   * Nothing is removed or reworded — the text is exactly what the
   * generator produced. The marks only say which sentences the machine
   * added to pad a short section, because without them the missionary is
   * about to send a supporter a feeling, in the first person, that they
   * never expressed. Marked or not, it is theirs to keep, cut or rewrite.
   *
   * The whole body is escaped FIRST and the needles escaped the same way
   * before replacing, so a `<` anywhere in their own prose can never
   * become markup. The legend only appears when something was marked. */
  function renderNewsletterBody(body, generated) {
    var host = el("newsletter-body");
    var html = ApoComm.escapeHtml(body);
    var marked = 0;
    generated.forEach(function (sentence) {
      var needle = ApoComm.escapeHtml(sentence);
      var at = html.indexOf(needle);
      if (at === -1) return;
      html = html.slice(0, at) +
             '<span class="generated">' + needle + "</span>" +
             html.slice(at + needle.length);
      marked++;
    });
    host.innerHTML = html;
    show("generated-legend", marked > 0);
    setText("generated-legend-text", T.generatedLegend);
  }

  function instagramPlainText() {
    return Array.prototype.map.call(el("instagram-posts").querySelectorAll(".post"), function (card) {
      return card.querySelector(".post-caption").textContent + "\n" +
             card.querySelector(".post-tags").textContent;
    }).join("\n\n---\n\n");
  }

  // navigator.clipboard is refused in some embedded views and older app
  // webviews, and this page is opened on whatever device the missionary
  // has. Fall back to selecting the text so copying by hand still works.
  function copy(text, node) {
    function fallback() {
      setText("copy-status", T.copyFailed);
      if (node) {
        var range = document.createRange();
        range.selectNodeContents(node);
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }
    if (!navigator.clipboard || !navigator.clipboard.writeText) return fallback();
    navigator.clipboard.writeText(text).then(function () {
      setText("copy-status", T.copied);
    }).catch(fallback);
  }

  function wireCopy() {
    el("copy-newsletter").addEventListener("click", function () {
      var body = el("newsletter-body");
      copy(el("newsletter-subject").textContent + "\n\n" + body.textContent, body);
    });
    el("copy-instagram").addEventListener("click", function () {
      copy(instagramPlainText(), el("instagram-posts"));
    });
    el("month-select").addEventListener("change", function () {
      setText("copy-status", "");
      renderMonth(Number(this.value));
    });
  }

  function start() {
    var token = readToken();
    if (!token) return refuse("invalid");

    /* Two handlers, not one .catch() on the end of the chain.
     *
     * A .catch() there swallows BOTH a rejected fetch and any exception
     * thrown while rendering, and reported both as "we can't reach your
     * file". That is a lie in the second case and an expensive one: the
     * data had arrived, the greeting had already been written to the page,
     * and the missionary was told to come back later for a server that was
     * never down. Passing the failure handler as the second argument to
     * .then() means it only ever sees a rejected fetch; anything the
     * success path throws is caught below, where we know the backend was
     * fine and can say so. */
    ApoComm.fetchClientSpace(token).then(function (result) {
      if (!result.space) return refuse(result.offline ? "offline" : "invalid");
      space = result.space;
      try {
        renderSpace();
      } catch (e) {
        console.error("[ApoComm.Espace] render:", e);
        renderFailed();
      }
    }, function (e) {
      console.error("[ApoComm.Espace] fetch:", e);
      refuse("offline");
    });
  }

  function renderSpace() {
    applyLanguage(ApoComm.detectLanguage(space.primaryLanguage));
    setText("greeting", T.greeting(space.firstName));
    show("content", true);

    renderSite();

    if (!space.canGenerate) return show("human-only", true);
    if (!space.months.length) return show("no-month", true);

    show("month-section", true);
    renderMonthOptions();
    renderMonth(0);
    wireCopy();
  }

  /* The record was read and the page is theirs — only the content could not
     be assembled. So this keeps the greeting and the site link on screen and
     replaces the month section alone, rather than wiping the page down to a
     refusal. It does not claim anyone has been notified, because nothing
     here notifies anyone. */
  function renderFailed() {
    show("month-section", false);
    show("no-month", false);
    setText("render-failed-title", T.renderFailTitle);
    setText("render-failed-body", T.renderFailBody);
    show("render-failed", true);
  }

  start();
})();
