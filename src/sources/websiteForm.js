// Placeholder: Express-compatible webhook parser for website contact forms

function parseWebsiteForm(body) {
  const lead = {
    id: body.id || `wf-${Date.now()}`,
    source: 'websiteForm',
    receivedAt: new Date().toISOString(),
    contact: {
      name: body.name || body.fullName || '',
      email: body.email || '',
      phone: body.phone || body.phoneNumber || '',
    },
    meta: {
      notes: body.message || body.notes || '',
      raw: body,
    },
  };
  return lead;
}

module.exports = { parseWebsiteForm };


