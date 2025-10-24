// src/utils/emailer.js
import sgMail from "@sendgrid/mail";

/**
 * Email utility for Lead Ingestor
 * - Works even if SENDGRID_API_KEY is not configured
 * - Logs "stub" messages when running without real email delivery
 */

const apiKey = process.env.SENDGRID_API_KEY || "disabled";
const sender = process.env.SENDER_EMAIL || "no-reply@example.com";
const office = process.env.OFFICE_EMAIL || "office@example.com";

let sendgridEnabled = false;

if (apiKey.startsWith("SG.")) {
  sgMail.setApiKey(apiKey);
  sendgridEnabled = true;
  console.log("✅ SendGrid enabled: real emails will be sent");
} else {
  console.log("⚠️ SendGrid disabled — using placeholder mode (no emails sent)");
}

/**
 * Send confirmation email to customer
 */
export async function sendCustomerEmail({ to, name, schedulerUrl }) {
  if (!to) return;

  if (!sendgridEnabled) {
    console.log(
      `(stub) Would send customer email → ${to}\nSubject: Schedule your appointment\nLink: ${schedulerUrl}`
    );
    return;
  }

  const msg = {
    to,
    from: sender,
    subject: "Schedule your Generac appointment",
    text: `Hi ${name || ""}, please schedule here: ${schedulerUrl}`,
    html: `<p>Hi ${name || ""},</p>
           <p>Thanks for your interest in Generac.</p>
           <p><a href="${schedulerUrl}">Click here to schedule your appointment</a>.</p>`
  };

  try {
    await sgMail.send(msg);
    console.log(`📨 Sent customer email → ${to}`);
  } catch (err) {
    console.error("❌ Failed to send customer email:", err.message);
  }
}

/**
 * Send notification email to office
 */
export async function sendOfficeEmail({ lead, sourceAccount }) {
  if (!sendgridEnabled) {
    console.log(
      `(stub) Would send office email → ${office}\nSource: ${sourceAccount}\nLead: ${JSON.stringify(
        lead,
        null,
        2
      )}`
    );
    return;
  }

  const msg = {
    to: office,
    from: sender,
    subject: `New Lead from ${sourceAccount}`,
    text: JSON.stringify(lead, null, 2)
  };

  try {
    await sgMail.send(msg);
    console.log(`📩 Sent office email → ${office}`);
  } catch (err) {
    console.error("❌ Failed to send office email:", err.message);
  }
}