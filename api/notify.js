// Vercel serverless function — sends email notifications via Resend
// POST /api/notify
// Body: { type: 'request' | 'granted' | 'denied' | 'help', userEmail, userName, message? }

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const ADMIN_EMAIL    = process.env.DIGEST_EMAIL || 'nicomistry@gmail.com';
  const FROM_EMAIL     = process.env.FROM_EMAIL   || 'onboarding@resend.dev';

  if (!RESEND_API_KEY) return res.status(500).json({ error: 'RESEND_API_KEY not configured' });

  const { type, userEmail, userName, message } = req.body || {};
  if (!type || !userEmail) return res.status(400).json({ error: 'type and userEmail required' });

  const display = userName || userEmail;

  const templates = {
    request: {
      to:      ADMIN_EMAIL,
      subject: `PPM — Control Panel access requested by ${display}`,
      html:    `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px;">
          <h2 style="color:#111;margin-bottom:8px;">Control Panel Access Request</h2>
          <p style="color:#555;"><strong>${display}</strong> (${userEmail}) has requested access to the Control Panel.</p>
          ${message ? `<p style="color:#555;border-left:3px solid #00d084;padding-left:12px;"><em>"${message}"</em></p>` : ''}
          <p style="margin-top:24px;">
            <a href="https://ppm.build/admin.html#requests" style="background:#00d084;color:#000;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600;">Review Request</a>
          </p>
        </div>`,
    },
    granted: {
      to:      userEmail,
      subject: 'PPM — Your Control Panel access has been granted',
      html:    `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px;">
          <h2 style="color:#111;margin-bottom:8px;">Access Granted</h2>
          <p style="color:#555;">Hi ${display}, your request for Control Panel access has been <strong style="color:#00d084;">granted</strong>.</p>
          <p style="color:#555;">You have <strong>1 scan run</strong> available. Log in to use it.</p>
          <p style="margin-top:24px;">
            <a href="https://ppm.build/dashboard.html" style="background:#00d084;color:#000;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600;">Go to Dashboard</a>
          </p>
        </div>`,
    },
    denied: {
      to:      userEmail,
      subject: 'PPM — Control Panel access request update',
      html:    `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px;">
          <h2 style="color:#111;margin-bottom:8px;">Access Request Denied</h2>
          <p style="color:#555;">Hi ${display}, your Control Panel access request has been <strong style="color:#ef4444;">denied</strong>.</p>
          ${message ? `<p style="color:#555;border-left:3px solid #ef4444;padding-left:12px;"><em>"${message}"</em></p>` : ''}
          <p style="color:#555;">You can request access again after 30 minutes.</p>
        </div>`,
    },
    help: {
      to:      ADMIN_EMAIL,
      subject: `PPM — Scan exception request from ${display}`,
      html:    `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px;">
          <h2 style="color:#111;margin-bottom:8px;">Scan Exception Request</h2>
          <p style="color:#555;"><strong>${display}</strong> (${userEmail}) says their scan had an issue and is requesting an extra run.</p>
          ${message ? `<p style="color:#555;border-left:3px solid #f59e0b;padding-left:12px;"><em>"${message}"</em></p>` : ''}
          <p style="margin-top:24px;">
            <a href="https://ppm.build/admin.html#requests" style="background:#00d084;color:#000;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600;">Review in Admin Panel</a>
          </p>
        </div>`,
    },
  };

  const tpl = templates[type];
  if (!tpl) return res.status(400).json({ error: `Unknown type: ${type}` });

  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_API_KEY}` },
      body:    JSON.stringify({ from: FROM_EMAIL, to: tpl.to, subject: tpl.subject, html: tpl.html }),
    });
    const data = await resp.json();
    if (!resp.ok) return res.status(resp.status).json({ error: data });
    return res.status(200).json({ ok: true, id: data.id });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
