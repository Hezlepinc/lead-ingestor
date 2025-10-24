const path = require('path');

const settings = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  logLevel: process.env.LOG_LEVEL || 'info',
  storagePath: process.env.STORAGE_PATH || path.resolve(__dirname, '..', 'storage', 'leads.json'),
  sendgridApiKey: process.env.SENDGRID_API_KEY,
  alertToEmail: process.env.ALERT_TO_EMAIL,
  alertFromEmail: process.env.ALERT_FROM_EMAIL,
  alertToSms: process.env.ALERT_TO_SMS,
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID,
    authToken: process.env.TWILIO_AUTH_TOKEN,
    fromNumber: process.env.TWILIO_FROM_NUMBER,
  },
  playwright: {
    headless: (process.env.PLAYWRIGHT_HEADLESS || 'true') === 'true',
    powerplay: {
      email: process.env.POWERPLAY_EMAIL,
      password: process.env.POWERPLAY_PASSWORD,
    }
  }
};

module.exports = settings;


