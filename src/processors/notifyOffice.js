const settings = require('../config/settings');
const { sendEmail, sendSms } = require('../utils/emailer');

async function notifyOffice(lead) {
  const subject = `[Lead] ${lead.source} - ${lead.contact.name || lead.contact.email || lead.contact.phone || lead.id}`;
  const text = `New lead from ${lead.source}\nName: ${lead.contact.name}\nEmail: ${lead.contact.email}\nPhone: ${lead.contact.phone}\nNotes: ${lead.meta.notes || ''}`;

  if (settings.alertToEmail && settings.alertFromEmail) {
    await sendEmail({
      to: settings.alertToEmail,
      from: settings.alertFromEmail,
      subject,
      text,
    });
  }

  if (settings.alertToSms) {
    await sendSms({ to: settings.alertToSms, body: text });
  }
}

module.exports = { notifyOffice };


