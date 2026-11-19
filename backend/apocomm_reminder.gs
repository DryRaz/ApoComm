/**
 * Apostello Comm — monthly intake reminder
 *
 * Reference copy, version-controlled here; deployed by pasting into the
 * same Apps Script project as apocomm_backend.gs. It relies on that file's
 * getFichesSheet(), getIntakesSheet(), FICHES_DATA_START_ROW and COL —
 * Apps Script shares one global scope across files, so both must be
 * present in the project.
 *
 * WHAT IT DOES
 * Once a month, checks every client in Fiches. If they have not submitted
 * this month's intake (checked against Monthly_Intakes) and their
 * Onboarding_Status is not still "New"/"Nouveau", it emails them a link to
 * the intake form.
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

  let sent = 0;
  for (let i = FICHES_DATA_START_ROW; i < fichesData.length; i++) {
    const row = fichesData[i];
    const clientId = row[COL.clientId];
    if (!clientId) continue;

    const status = String(row[COL.onboardingStatus] || '').toLowerCase();
    if (status === 'new' || status === 'nouveau' || status === '') continue;

    const email = row[COL.email];
    if (!email) continue;

    if (submitted[clientId + '|' + currentMonth]) continue;

    sendReminderEmail(
      email,
      row[COL.firstName],
      row[COL.lastName],
      row[COL.primaryLanguage]
    );
    sent++;
  }
  Logger.log('Reminders sent: ' + sent);
}

/* The missionary chose English or French when they registered, and every
 * other thing this system sends them — newsletter, captions, their public
 * page — follows that choice. This email is the one piece that did not,
 * and it is the first thing they read each month. Same two-language rule
 * as the frontend: anything that is not French gets English. */
function reminderLanguage(primaryLanguage) {
  const v = String(primaryLanguage || '').trim().toLowerCase();
  if (v.split(/[-_]/)[0] === 'fr') return 'french';
  if (/fren|fran[cç]/.test(v)) return 'french';
  return 'english';
}

function sendReminderEmail(email, firstName, lastName, primaryLanguage) {
  const name = firstName + ' ' + lastName;
  let subject, body;

  if (reminderLanguage(primaryLanguage) === 'french') {
    subject = 'Vos nouvelles du mois — Apostello Comm';
    body =
      'Bonjour ' + firstName + ',\n\n' +
      "C'est le moment de vos nouvelles du mois. Cela prend quelques " +
      'minutes, et cela alimente à la fois votre lettre et vos ' +
      "publications Instagram pour tout le mois.\n\n" +
      'Rendez-vous ici et cherchez votre nom (' + name + ') :\n' +
      INTAKE_URL + '\n\n' +
      'Merci pour ce que vous vivez là-bas.\n\nApostello Comm';
  } else {
    subject = 'Your monthly Apostello Comm update';
    body =
      'Hi ' + firstName + ',\n\n' +
      "Time for this month's quick update! It only takes a few minutes " +
      'and it powers both your newsletter and your Instagram content for ' +
      'the month.\n\n' +
      'Go here and search for your name (' + name + '):\n' +
      INTAKE_URL + '\n\n' +
      "Thank you for what you're doing out there!\n\nApostello Comm";
  }

  MailApp.sendEmail(email, subject, body);
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
