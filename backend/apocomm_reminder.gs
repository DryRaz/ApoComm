/**
 * Apostello Comm — monthly intake reminder
 *
 * Reference copy, version-controlled here; deployed by pasting into the
 * same Apps Script project as apocomm_backend.gs. It relies on that file's
 * getFichesSheet(), getIntakesSheet(), FICHES_DATA_START_ROW, COL,
 * SPACE_URL, emailLanguage(), journal(), accessTokensByClient() and
 * createAccessToken() — Apps Script shares one global scope across files,
 * so both must be present in the project.
 *
 * WHAT IT DOES
 * Emails each client, once a month, a link to the intake form and a link to
 * their own client space — at 8am in THEIR timezone, not in the script's.
 *
 * WHY IT RUNS HOURLY
 * It used to be one monthly trigger at "8am", which meant 8am wherever the
 * Apps Script project happened to be set — Los Angeles, by default. A
 * missionary in Kenya got their nudge at 7pm and one in Cambodia at 11pm.
 * One run cannot be 8am in twenty countries, so instead this runs every
 * hour and each run mails only the clients for whom it is now past 8am
 * locally, using the Timezone column their own registration filled in.
 *
 * Nothing here reads Session.getScriptTimeZone(). Local time is computed
 * from the absolute instant plus the client's own UTC offset, so changing
 * the project's timezone setting cannot move anyone's reminder.
 *
 * ONE MAIL PER CLIENT PER MONTH
 * Hourly runs need a record of what has already gone out, or a client would
 * be mailed 24 times a day. Reminders_Sent (ClientID, Month, SentAt) is
 * that record, created on demand like Access_Tokens, and doubles as an
 * audit trail. The eligibility rule is deliberately "past 8am local and not
 * yet sent this month" rather than "exactly 8am": if a run is skipped —
 * quota, outage, a trigger that did not fire — the next hour catches it,
 * instead of that client silently losing their reminder for the month.
 *
 * This is also where the client space reaches everyone who registered
 * before it existed: a client with no row in Access_Tokens gets a token
 * minted on their first reminder. A client who already has one keeps it —
 * every token ever issued stays valid, so re-minting monthly would leave
 * each client holding a growing pile of live links.
 *
 * SETUP (run once)
 *   Select createMonthlyTrigger in the function dropdown, click Run,
 *   authorise. It installs the hourly trigger and clears any previous
 *   trigger for itself first — including the old monthly one, so running it
 *   again is how you migrate.
 *   To test immediately: run sendMonthlyIntakeReminders by hand.
 */

const INTAKE_URL = 'https://dryraz.github.io/ApoComm/newsletter-intake/';

/* The local hour at which a client should receive their reminder. */
const REMINDER_LOCAL_HOUR = 8;

/* And the window of local days it may be sent in, counting from the 1st.
 *
 * Without a window, "past 8am and not yet sent this month" leaves a client
 * eligible until the month ends, which does two unwanted things. It lets a
 * reminder for a month arrive on the 30th, when asking for that month's
 * news is pointless. And around a month boundary it fires twice within
 * hours: a client west of UTC is still on the 30th when the servers roll
 * over, so they take the old month's reminder at 9pm and the new month's
 * the next morning.
 *
 * Seven days still absorbs what the window exists to absorb — a skipped
 * hour, a trigger that did not fire, a day of outage — while keeping the
 * mail near the start of the month where it belongs. The trade is
 * deliberate: if a whole week is missed, that month's reminder is dropped
 * rather than delivered too late to act on. */
const REMINDER_WINDOW_DAYS = 7;

/* Used when a client's Timezone cell is empty or unreadable. Most of the
   client base is East Africa, so this is the least-wrong guess — but it is
   a guess, and every use of it is journalled by name so the cell can be
   filled in rather than left to a default forever. */
const DEFAULT_UTC_OFFSET_MINUTES = 180;

const SHEET_REMINDERS = 'Reminders_Sent';

/* "UTC+3" / "UTC-8" / "UTC+5:45" -> minutes from UTC. Returns null for
   anything else, including an empty cell, so the caller can tell a real
   offset from a fallback. Half- and quarter-hour offsets are real places —
   India, Nepal, Iran, Myanmar — and the registration form offers them, so
   an hours-only parser would quietly put those clients on the wrong hour.
   Daylight saving is not modelled, matching the registration form, which
   collects standard offsets only: a client on DST gets their reminder an
   hour off for part of the year. */
function parseUtcOffsetMinutes(raw) {
  const m = /^\s*UTC\s*([+-])\s*(\d{1,2})(?::(\d{2}))?\s*$/i.exec(String(raw == null ? '' : raw));
  if (!m) return null;
  const sign = m[1] === '-' ? -1 : 1;
  const hours = parseInt(m[2], 10);
  const minutes = m[3] ? parseInt(m[3], 10) : 0;
  if (hours > 14 || minutes > 59) return null;
  return sign * (hours * 60 + minutes);
}

/* Wall-clock parts at a given UTC offset, derived from the absolute instant
   alone. Deliberately uses the getUTC* accessors on a shifted timestamp:
   the local getters would reintroduce the script's own timezone, which is
   the whole thing this file exists to stop depending on. */
function localPartsAt(offsetMinutes) {
  const d = new Date(Date.now() + offsetMinutes * 60000);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours()
  };
}

function localMonthKeyAt(offsetMinutes) {
  const p = localPartsAt(offsetMinutes);
  return p.year + '-' + ('0' + p.month).slice(-2);
}

function getOrCreateRemindersSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_REMINDERS);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_REMINDERS);
    sheet.getRange(1, 1, 1, 3).setValues([['ClientID', 'Month', 'SentAt']]);
  }
  return sheet;
}

/* {ClientID|YYYY-MM: true} in one pass, same reasoning as
   accessTokensByClient(): this runs every hour and must not re-read the
   sheet per client. monthKey() on the stored value because Sheets coerces
   a "2026-11" cell into a date, exactly as it does in Monthly_Intakes. */
function remindersSentIndex() {
  const data = getOrCreateRemindersSheet().getDataRange().getValues();
  const index = {};
  for (let i = 1; i < data.length; i++) {
    if (data[i][0]) index[data[i][0] + '|' + monthKey(data[i][1])] = true;
  }
  return index;
}

function recordReminderSent(clientId, month) {
  const sheet = getOrCreateRemindersSheet();
  const row = sheet.getLastRow() + 1;
  // Month forced to text first, for the same reason as writeIntakeRow().
  sheet.getRange(row, 2).setNumberFormat('@');
  sheet.getRange(row, 1, 1, 3).setValues([[clientId, month, new Date()]]);
}

function sendMonthlyIntakeReminders() {
  const fiches = getFichesSheet();
  const intakes = getIntakesSheet();

  const fichesData = fiches.getDataRange().getValues();
  const intakesData = intakes.getDataRange().getValues();

  const submitted = {};
  for (let i = 1; i < intakesData.length; i++) {
    // monthKey(), not the raw cell: Sheets stores the month as a real date,
    // so comparing it to the YYYY-MM string built below never matched and
    // this check silently passed every client through — they would have
    // been chased for intakes they had already submitted.
    if (intakesData[i][0]) submitted[intakesData[i][0] + '|' + monthKey(intakesData[i][1])] = true;
  }

  // Read Access_Tokens once rather than per client — see
  // accessTokensByClient() in apocomm_backend.gs. Clients registered before
  // the client space existed have no token at all; they get one minted here,
  // which makes this monthly run the backfill path for the whole base.
  const tokens = accessTokensByClient();
  const alreadySent = remindersSentIndex();

  let sent = 0;
  let failed = 0;
  let minted = 0;
  let waiting = 0;
  let defaulted = 0;
  for (let i = FICHES_DATA_START_ROW; i < fichesData.length; i++) {
    const row = fichesData[i];
    const clientId = row[COL.clientId];
    if (!clientId) continue;

    const status = String(row[COL.onboardingStatus] || '').toLowerCase();
    if (status === 'new' || status === 'nouveau' || status === '') continue;

    const email = row[COL.email];
    if (!email) continue;

    // Their clock, not ours. A blank or unreadable Timezone falls back to
    // the default and says so by name in the journal — a default that
    // nobody can see is a default nobody ever fixes.
    let offset = parseUtcOffsetMinutes(row[COL.timezone]);
    if (offset === null) {
      offset = DEFAULT_UTC_OFFSET_MINUTES;
      defaulted++;
      journal(clientId, 'reminder', 'no usable Timezone (' +
              JSON.stringify(String(row[COL.timezone] || '')) +
              '), assumed UTC' + (DEFAULT_UTC_OFFSET_MINUTES >= 0 ? '+' : '') +
              (DEFAULT_UTC_OFFSET_MINUTES / 60));
    }

    const localMonth = localMonthKeyAt(offset);

    // Already has this month's intake in, or already been asked this month.
    if (submitted[clientId + '|' + localMonth]) continue;
    if (alreadySent[clientId + '|' + localMonth]) continue;

    // Not yet 8am where they are, or past the opening days of their month.
    // "waiting" is not "skipped": a later run picks them up, right up to
    // the end of the window.
    const local = localPartsAt(offset);
    if (local.day > REMINDER_WINDOW_DAYS) continue;
    if (local.hour < REMINDER_LOCAL_HOUR) { waiting++; continue; }

    let token = tokens[clientId];
    if (!token) {
      token = createAccessToken(clientId);
      tokens[clientId] = token;
      minted++;
    }

    if (sendReminderEmail(
      email,
      row[COL.firstName],
      row[COL.lastName],
      row[COL.primaryLanguage],
      token,
      clientId
    )) {
      // Recorded only on a successful send, so a failure is retried on the
      // next hourly run rather than written off for the month.
      recordReminderSent(clientId, localMonth);
      alreadySent[clientId + '|' + localMonth] = true;
      sent++;
    } else {
      failed++;
    }
  }
  Logger.log('Reminders sent: ' + sent + ' (failed: ' + failed +
             ', waiting for 8am local: ' + waiting +
             ', tokens minted: ' + minted +
             ', timezone defaulted: ' + defaulted + ')');
}


/* The ask comes first and the space comes second, deliberately. This email
 * exists to get one thing done — the intake — and a reader handed two links
 * at once will click the one that costs them nothing. The space is framed
 * as last month's finished work, which is also the honest reason to look at
 * it before writing this month's. */
function sendReminderEmail(email, firstName, lastName, primaryLanguage, token, clientId) {
  const name = firstName + ' ' + lastName;
  const space = token ? SPACE_URL + '#t=' + token : '';
  let subject, body;

  if (emailLanguage(primaryLanguage) === 'french') {
    subject = 'Vos nouvelles du mois — Apostello Comm';
    body =
      'Bonjour ' + firstName + ',\n\n' +
      "C'est le moment de vos nouvelles du mois. Cela prend quelques " +
      'minutes, et cela alimente à la fois votre lettre et vos ' +
      "publications Instagram pour tout le mois.\n\n" +
      'Rendez-vous ici et cherchez votre nom (' + name + ') :\n' +
      INTAKE_URL + '\n\n';
    if (space) {
      body +=
        'Et voici votre espace personnel, où vous retrouvez à tout moment ' +
        'votre page publique, votre lettre et vos publications :\n' +
        space + '\n\n' +
        'Ce lien est personnel et nous ne vous demanderons jamais de mot ' +
        'de passe.\n\n';
    }
    body += 'Merci pour ce que vous vivez là-bas.\n\nApostello Comm';
  } else {
    subject = 'Your monthly Apostello Comm update';
    body =
      'Hi ' + firstName + ',\n\n' +
      "Time for this month's quick update! It only takes a few minutes " +
      'and it powers both your newsletter and your Instagram content for ' +
      'the month.\n\n' +
      'Go here and search for your name (' + name + '):\n' +
      INTAKE_URL + '\n\n';
    if (space) {
      body +=
        'And here is your personal space, where you can find your public ' +
        'page, your newsletter and your posts at any time:\n' +
        space + '\n\n' +
        'This link is personal to you, and we will never ask you for a ' +
        'password.\n\n';
    }
    body += "Thank you for what you're doing out there!\n\nApostello Comm";
  }

  // A bad address must not stop the rest of the run — one unsendable row
  // should not cost every client after it in the loop their reminder.
  try {
    MailApp.sendEmail(email, subject, body);
    return true;
  } catch (e) {
    journal(clientId, 'ERROR', 'reminder not sent: ' + String(e));
    return false;
  }
}

function createMonthlyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendMonthlyIntakeReminders') {
      ScriptApp.deleteTrigger(t);
    }
  });
  // Hourly, not monthly: each run mails only the clients for whom it is now
  // past 8am locally. Running this function again is also the migration
  // path off the old monthly trigger, which the loop above removes.
  ScriptApp.newTrigger('sendMonthlyIntakeReminders')
    .timeBased()
    .everyHours(1)
    .create();
  Logger.log('Hourly trigger installed: each client is mailed once a month, ' +
             'at ' + REMINDER_LOCAL_HOUR + 'am in their own timezone.');
}
