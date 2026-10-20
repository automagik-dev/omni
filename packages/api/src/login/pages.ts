/**
 * The two pages a person opens to get into Omni (wish: omni-labs-distribution):
 *
 *   /login/claim?token=…        claim an unclaimed Omni with a WhatsApp number
 *   /login/device?user_code=…   approve a device (desktop app, DSH plugin, CLI)
 *
 * Plain HTML with a small script each: everything they do goes through Better Auth
 * (/api/auth) and Omni's login endpoints (/api/v2/login). Text is inserted with
 * textContent, never as HTML.
 */

const STYLE = `
:root{color-scheme:light dark;--bg:#f6f7f9;--card:#fff;--ink:#111827;--ink2:#5b6474;--line:#e3e6eb;--accent:#0f9d8f;--bad:#c0392b}
@media (prefers-color-scheme:dark){:root{--bg:#0b1220;--card:#121a2b;--ink:#eef1f6;--ink2:#9aa4b5;--line:#23304a}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:16px}
main{width:min(440px,100%);background:var(--card);border:1px solid var(--line);border-radius:18px;padding:28px}
h1{font-size:20px;margin:0 0 6px}p{margin:0 0 14px;color:var(--ink2)}
.mark{font:700 13px/1 system-ui;letter-spacing:.2em;color:var(--accent);margin-bottom:18px}
button,.btn{display:block;width:100%;padding:12px 14px;margin:8px 0;border-radius:12px;border:1px solid var(--line);background:transparent;color:var(--ink);font:inherit;font-weight:600;cursor:pointer;text-align:center;text-decoration:none}
button.primary{background:var(--accent);border-color:var(--accent);color:#fff}button:disabled{opacity:.55;cursor:default}
input{width:100%;padding:12px 14px;border-radius:12px;border:1px solid var(--line);background:transparent;color:var(--ink);font:600 22px/1 ui-monospace,monospace;letter-spacing:.3em;text-align:center}
.error{color:var(--bad)}.muted{color:var(--ink2);font-size:13px}.qr{display:grid;place-items:center;margin:12px 0}.qr svg{width:240px;height:240px;border-radius:12px}
.device{border:1px solid var(--line);border-radius:12px;padding:12px 14px;margin:12px 0}.device strong{display:block}
`;

const SHARED_SCRIPT = `
const $ = (id) => document.getElementById(id);
const say = (text, error) => { const p = $('status'); p.textContent = text || ''; p.className = error ? 'error' : 'muted'; };
const show = (id) => { for (const s of document.querySelectorAll('section')) s.hidden = s.id !== id; };
async function call(method, path, body, headers = {}) {
  const res = await fetch(path, { method, credentials: 'same-origin', headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error?.message || data?.message || data?.error_description || ('HTTP ' + res.status));
  return data?.data ?? data;
}
// WebAuthn JSON <-> binary, for browsers without PublicKeyCredential.parse*FromJSON.
const b64 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), (c) => c.charCodeAt(0));
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
const creationOptions = (o) => PublicKeyCredential.parseCreationOptionsFromJSON ? PublicKeyCredential.parseCreationOptionsFromJSON(o)
  : { ...o, challenge: b64(o.challenge), user: { ...o.user, id: b64(o.user.id) }, excludeCredentials: (o.excludeCredentials || []).map((c) => ({ ...c, id: b64(c.id) })) };
const requestOptions = (o) => PublicKeyCredential.parseRequestOptionsFromJSON ? PublicKeyCredential.parseRequestOptionsFromJSON(o)
  : { ...o, challenge: b64(o.challenge), allowCredentials: (o.allowCredentials || []).map((c) => ({ ...c, id: b64(c.id) })) };
function credentialJSON(cred) {
  if (cred.toJSON) return cred.toJSON();
  const r = cred.response;
  return { id: cred.id, rawId: b64url(cred.rawId), type: cred.type, clientExtensionResults: cred.getClientExtensionResults(), authenticatorAttachment: cred.authenticatorAttachment,
    response: r.attestationObject ? { clientDataJSON: b64url(r.clientDataJSON), attestationObject: b64url(r.attestationObject), transports: r.getTransports ? r.getTransports() : [] }
      : { clientDataJSON: b64url(r.clientDataJSON), authenticatorData: b64url(r.authenticatorData), signature: b64url(r.signature), userHandle: r.userHandle ? b64url(r.userHandle) : undefined } };
}
async function signInWithPasskey() {
  const options = await call('GET', '/api/auth/passkey/generate-authenticate-options');
  const cred = await navigator.credentials.get({ publicKey: requestOptions(options) });
  await call('POST', '/api/auth/passkey/verify-authentication', { response: credentialJSON(cred) });
}
async function addPasskey() {
  const options = await call('GET', '/api/auth/passkey/generate-register-options');
  const cred = await navigator.credentials.create({ publicKey: creationOptions(options) });
  await call('POST', '/api/auth/passkey/verify-registration', { response: credentialJSON(cred), name: navigator.platform || 'This device' });
}
const passkeysAvailable = () => typeof PublicKeyCredential !== 'undefined';
`;

function page(title: string, body: string, script: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title><style>${STYLE}</style></head><body><main><div class="mark">OMNI</div>${body}<p id="status" class="muted"></p></main><script>${SHARED_SCRIPT}${script}</script></body></html>`;
}

export function claimPage(): string {
  return page(
    'Claim this Omni',
    `
<section id="pick"><h1>Welcome to your Omni</h1><p>It has no owner yet. Your WhatsApp number is how Omni will know it is you.</p><div id="accounts"></div><button id="connect">Connect my WhatsApp</button></section>
<section id="link" hidden><h1>Link your WhatsApp</h1><p>On your phone: WhatsApp → Settings → Linked devices → Link a device, and scan this.</p><div class="qr" id="qr"></div></section>
<section id="code" hidden><h1>Check your WhatsApp</h1><p>Omni sent a 6-digit code to <strong id="sentTo"></strong>, in your chat with yourself.</p><input id="otp" inputmode="numeric" autocomplete="one-time-code" maxlength="6"><button class="primary" id="verify">Claim this Omni</button></section>
<section id="done" hidden><h1>This Omni is yours</h1><p>Next time, sign in with Face ID, Touch ID or your fingerprint instead of a code.</p><button class="primary" id="passkey">Use this device's fingerprint or face</button><p class="muted">You can close this page.</p></section>`,
    `
const token = new URLSearchParams(location.search).get('token') || '';
const claim = (method, path, body) => call(method, '/api/v2/login/claim' + path, body, { 'x-omni-claim-token': token });
let instanceId = null;
async function sendCode(id) {
  instanceId = id;
  const { sentTo } = await claim('POST', '/send-code', { instanceId: id });
  $('sentTo').textContent = sentTo; show('code'); $('otp').focus();
}
async function start() {
  if (!token) return say('Open the claim link printed in the Omni server log.', true);
  try {
    const accounts = await claim('GET', '/accounts');
    for (const account of accounts) {
      const b = document.createElement('button'); b.className = 'primary';
      b.textContent = 'This is my number: ' + account.phone;
      b.onclick = () => sendCode(account.instanceId).catch((e) => say(e.message, true));
      $('accounts').append(b);
    }
    if (accounts.length) $('connect').textContent = 'Connect another WhatsApp';
  } catch (e) { say(e.message === 'Not found' ? 'This Omni is already claimed, or the claim link is wrong.' : e.message, true); $('connect').hidden = true; }
}
$('connect').onclick = async () => {
  try {
    const { instanceId: id } = await claim('POST', '/whatsapp');
    show('link');
    const poll = async () => {
      const state = await claim('GET', '/whatsapp/' + id);
      if (state.connected) return sendCode(id);
      if (state.qrSvg) $('qr').innerHTML = state.qrSvg; // server-made SVG of WhatsApp's own linking code
      setTimeout(() => poll().catch((e) => say(e.message, true)), 2500);
    };
    await poll();
  } catch (e) { say(e.message, true); }
};
$('verify').onclick = async () => {
  try { await claim('POST', '/verify', { instanceId, code: $('otp').value.trim() }); say(''); show('done'); if (!passkeysAvailable()) $('passkey').hidden = true; }
  catch (e) { say(e.message, true); }
};
$('passkey').onclick = async () => { try { await addPasskey(); say('Done. This device can sign you in now.'); $('passkey').hidden = true; } catch (e) { say(e.message, true); } };
start();`,
  );
}

export function devicePage(clients: Record<string, string>): string {
  return page(
    'Approve a device',
    `
<section id="signin" hidden><h1>Sign in to approve</h1><p>A device is asking to use your Omni. First, show it's you.</p><button class="primary" id="usePasskey">Use Face ID, Touch ID or fingerprint</button><button id="sendCode">Send me a code on WhatsApp</button><div id="codeBox" hidden><p>Code sent to <strong id="sentTo"></strong>, in your chat with yourself.</p><input id="otp" inputmode="numeric" autocomplete="one-time-code" maxlength="6"><button class="primary" id="verify">Sign in</button></div></section>
<section id="approve" hidden><h1>Approve this device?</h1><div class="device"><strong id="client"></strong><span class="muted">Code <span id="userCode"></span></span></div><p>It will be able to use your Omni until you revoke it.</p><button class="primary" id="yes">Approve</button><button id="no">Deny</button></section>
<section id="done" hidden><h1 id="doneTitle">Approved</h1><p id="doneText">The device is signing in now.</p><button id="passkey" hidden>Use this device's fingerprint or face next time</button></section>`,
    `
const CLIENTS = ${JSON.stringify(clients)};
const userCode = (new URLSearchParams(location.search).get('user_code') || '').toUpperCase();
async function load() {
  if (!userCode) return say('Open this page from the QR code on the device.', true);
  const session = await call('GET', '/api/auth/get-session').catch(() => null);
  if (!session) { show('signin'); if (!passkeysAvailable()) $('usePasskey').hidden = true; return; }
  try {
    const request = await call('GET', '/api/auth/device?user_code=' + encodeURIComponent(userCode));
    $('client').textContent = 'Request from ' + (CLIENTS[request.client_id || request.clientId] || 'a device');
    $('userCode').textContent = userCode;
    show('approve');
  } catch (e) { say(e.message, true); }
}
$('usePasskey').onclick = async () => { try { await signInWithPasskey(); say(''); load(); } catch (e) { say(e.message, true); } };
$('sendCode').onclick = async () => { try { const { sentTo } = await call('POST', '/api/v2/login/send-code'); $('sentTo').textContent = sentTo; $('codeBox').hidden = false; $('otp').focus(); } catch (e) { say(e.message, true); } };
$('verify').onclick = async () => { try { await call('POST', '/api/v2/login/verify', { code: $('otp').value.trim() }); say(''); load(); } catch (e) { say(e.message, true); } };
$('yes').onclick = async () => {
  try {
    await call('POST', '/api/auth/device/approve', { userCode });
    show('done');
    const keys = passkeysAvailable() ? await call('GET', '/api/auth/passkey/list-user-passkeys').catch(() => []) : [null];
    if (Array.isArray(keys) && keys.length === 0) $('passkey').hidden = false;
  } catch (e) { say(e.message, true); }
};
$('no').onclick = async () => { try { await call('POST', '/api/auth/device/deny', { userCode }); $('doneTitle').textContent = 'Denied'; $('doneText').textContent = 'The device was not let in.'; show('done'); } catch (e) { say(e.message, true); } };
$('passkey').onclick = async () => { try { await addPasskey(); say('Done. Next time, approve with your fingerprint or face.'); $('passkey').hidden = true; } catch (e) { say(e.message, true); } };
load();`,
  );
}
