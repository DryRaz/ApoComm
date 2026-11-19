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
 * Once a month, checks every client in Fiches. If they have not submitted
 * this month's intake (checked against Monthly_Intakes) and their
 * Onboarding_Status is not still "New"/"Nouveau", it emails them a link to
 * the intake form, plus the link to their own client space.
 *
 * This is also where the client space reaches everyone who registered
 * before it existed: a client with no row in Access_Tokens gets a token
 * minted on their first reminder. A client who already has one keeps it —
 * every token ever issued stays valid, so re-minting monthly would leave
 * each client holding a growing pile of live links.
 *
 * SETUP (run once)
 *   Select createMonthlyTrigger in the function dropdown, click Run,
 *   authorise. It then runs on the 1st of each month at 8am in the script
 *   timezone, and clears any previous trigger for itself first.
 *   To test immediately: run sendMonthlyIntakeReminders by hand.
 */

const INTAKE_URL = 'https://dryraz.github.io/ApoComm/newsletter-intake/';

function sendMonthlyIntakeReminders() {
  const fiches = getFichesSheet();
  const intakes = getIntakesSheet();
  const currentMonth = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM');

  const fichesData = fiches.getDataRange().getValues();
  const intakesData = intakes.getDataRange().getValues();

  const submitted = {};
  for (let i = 1; i < intakesData.length; i++) {
    if (intakesData[i][0]) submitted[intakesData[i][0] + '|' + intakesData[i][1]] = true;
  }

  // Read Access_Tokens once rather than per client — see
  // accessTokensByClient() in apocomm_backend.gs. Clients registered before
  // the client space existed have no token at all; they get one minted here,
  // which makes this monthly run the backfill path for the whole base.
  const tokens = accessTokensByClient();

  let sent = 0;
  let failed = 0;
  let minted = 0;
  for (let i = FICHES_DATA_START_ROW; i < fichesData.length; i++) {
    const row = fichesData[i];
    const clientId = row[COL.clientId];
    if (!clientId) continue;

    const status = String(row[COL.onboardingStatus] || '').toLowerCase();
    if (status === 'new' || status === 'nouveau' || status === '') continue;

    const email = row[COL.email];
    if (!email) continue;

    if (submitted[clientId + '|' + currentMonth]) continue;

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
    )) sent++;
    else failed++;
  }
  Logger.log('Reminders sent: ' + sent + ' (failed: ' + failed +
             ', tokens minted: ' + minted + ')');
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
  ScriptApp.newTrigger('sendMonthlyIntakeReminders')
    .timeBased()
    .onMonthDay(1)
    .atHour(8)
    .create();
  Logger.log('Monthly trigger installed: runs the 1st of each month at 8am.');
}
