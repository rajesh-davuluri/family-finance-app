// The Google Apps Script a household member pastes into script.google.com
// to send their labelled bank-alert emails to the app. Shown on the Settings
// page with the app URL and the household's token filled in.

export const GMAIL_LABEL = "bank-alerts";

export function buildGmailScript(appOrigin: string, token: string): string {
  return `// Family Finance — sends Gmail bank alerts to your app.
// Only reads emails labelled "${GMAIL_LABEL}". Keep this script private:
// the token below lets it add transactions to your household.

const APP_URL = "${appOrigin}/api/inbound/gmail";
const TOKEN = "${token}";
const LABEL = "${GMAIL_LABEL}";
const DONE_LABEL = "${GMAIL_LABEL}-done";
const MINUTES = 10;

// Run this once: it schedules sendBankAlerts every few minutes (MINUTES) and
// does a first run straight away.
function setup() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === "sendBankAlerts")
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("sendBankAlerts").timeBased().everyMinutes(MINUTES).create();
  sendBankAlerts();
}

function sendBankAlerts() {
  const label = GmailApp.getUserLabelByName(LABEL);
  if (!label) {
    console.log('No Gmail label "' + LABEL + '" yet — create the filter first.');
    return;
  }
  const done = GmailApp.getUserLabelByName(DONE_LABEL) || GmailApp.createLabel(DONE_LABEL);

  // Message ids already sent, so a new alert landing in an old conversation
  // doesn't resend the earlier ones.
  const props = PropertiesService.getUserProperties();
  const sent = JSON.parse(props.getProperty("sentIds") || "[]");

  for (const thread of label.getThreads(0, 50)) {
    let allOk = true;
    for (const msg of thread.getMessages()) {
      if (sent.indexOf(msg.getId()) !== -1) continue;
      const res = UrlFetchApp.fetch(APP_URL, {
        method: "post",
        contentType: "application/json",
        headers: { Authorization: "Bearer " + TOKEN },
        payload: JSON.stringify({
          subject: msg.getSubject(),
          textBody: msg.getPlainBody(),
          date: msg.getDate().toISOString(),
        }),
        muteHttpExceptions: true,
      });
      if (res.getResponseCode() === 200) {
        sent.push(msg.getId());
        console.log(msg.getSubject() + " -> " + res.getContentText());
      } else {
        allOk = false;
        console.log("Failed (" + res.getResponseCode() + "): " + res.getContentText());
      }
    }
    if (allOk) {
      thread.removeLabel(label);
      thread.addLabel(done);
    }
  }
  props.setProperty("sentIds", JSON.stringify(sent.slice(-500)));
}
`;
}
