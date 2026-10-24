/**
 * The pages a person opens to get into Omni (wish: omni-labs-distribution):
 *
 *   /api/login/claim?token=…        claim an unclaimed Omni with a WhatsApp number
 *   /api/login/device?user_code=…   approve a device (desktop app, DSH plugin, CLI)
 *   /api/login/app                  open Automagik on this computer, connected to this Omni
 *   /api/login/app?grant=…          the same, from the link the owner got by texting "connect"
 *   /  (and /api)                   what a browser sees at this Omni's own address
 *
 * "Open in Automagik" is an omni://connect?url=<this Omni> link: it carries this Omni's
 * address and nothing else. The app asks before connecting, then signs in through the device
 * page here (a passkey, or a code on WhatsApp), so the link grants nothing by itself. A link
 * from "connect" adds its one-time grant (login/connect.ts): the owner already said it is
 * them, in their own WhatsApp, so the app connects without a second sign-in.
 *
 * Plain HTML with a small script each: everything they do goes through Better Auth
 * (/api/auth) and Omni's login endpoints (/api/v2/login). Text is inserted with
 * textContent, never as HTML.
 */

// The Omni octopus (apps/bots-dsh/src/client/characters.js in automagik-dev/automagik), drawn for these pages.
const OCTOPUS_BODY =
  'M50 6C75 6 87 24 87 46C87 60 82 68 80 72C84 82 84 92 80 96C76 98 72 92 70 84C68 92 66 98 61 96C57 94 56 84 54 78C52 80 48 80 46 78C44 84 43 94 39 96C34 98 32 92 30 84C28 92 24 98 20 96C16 92 16 82 20 72C18 68 13 60 13 46C13 24 25 6 50 6Z';
const OCTOPUS_SHADE =
  'M87 46C87 60 82 68 80 72C84 82 84 92 80 96C76 98 72 92 70 84C68 92 66 98 61 96C57 94 56 84 54 78C62 76 70 66 75 56C80 48 80 36 75 26C82 32 87 38 87 46Z';
const OCTOPUS = `<svg class="octo" viewBox="0 0 100 100" aria-hidden="true">
<defs><linearGradient id="octo-skin" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8ff4ff"/><stop offset=".5" stop-color="#22d3ee"/><stop offset="1" stop-color="#0e7490"/></linearGradient></defs>
<path class="octo-ghost octo-cyan" d="${OCTOPUS_BODY}"/><path class="octo-ghost octo-magenta" d="${OCTOPUS_BODY}"/>
<path d="${OCTOPUS_BODY}" fill="url(#octo-skin)"/><path d="${OCTOPUS_SHADE}" fill="#0b4f6c" opacity=".5"/>
<path d="M30 22C36 14 44 11 50 11C40 14 33 20 30 28Z" fill="#fff" opacity=".45"/>
<g class="octo-eyes"><ellipse cx="40" cy="36" rx="6.5" ry="11" fill="#06121f"/><ellipse cx="60" cy="36" rx="6.5" ry="11" fill="#06121f"/>
<circle cx="42" cy="31" r="2.4" fill="#fff"/><circle cx="62" cy="31" r="2.4" fill="#fff"/></g>
<path d="M44 54Q50 59 56 54" stroke="#06121f" stroke-width="2.4" fill="none" stroke-linecap="round"/>
<ellipse cx="31" cy="50" rx="5" ry="2.8" fill="#ff5fb8" opacity=".6"/><ellipse cx="69" cy="50" rx="5" ry="2.8" fill="#ff5fb8" opacity=".6"/>
<g fill="none" stroke="#0e7490" stroke-width="3" stroke-linecap="round"><path d="M20 96Q13 99 12 92"/><path d="M80 96Q87 99 88 92"/></g>
</svg>`;

// The tab icon, inline: without one the browser asks for /favicon.ico, which Omni's auth gate refuses.
const ICON = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="${OCTOPUS_BODY}" fill="#22d3ee"/><path d="${OCTOPUS_SHADE}" fill="#0b4f6c" opacity=".5"/><ellipse cx="40" cy="36" rx="6.5" ry="11" fill="#06121f"/><ellipse cx="60" cy="36" rx="6.5" ry="11" fill="#06121f"/></svg>`,
)}`;

const STYLE = `
:root{color-scheme:dark;--bg:#05070f;--card:rgba(13,20,36,.78);--ink:#eef3ff;--ink2:#9fb0cc;--line:rgba(120,160,220,.22);--accent:#22d3ee;--accent2:#ff3bd4;--bad:#ff6b6b}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;color:var(--ink);font:15px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:24px 16px;overflow-x:hidden;
  background:radial-gradient(1200px 600px at 50% -10%,rgba(34,211,238,.18),transparent 60%),radial-gradient(900px 500px at 100% 110%,rgba(255,59,212,.18),transparent 60%),var(--bg)}
body::before{content:"";position:fixed;inset:0;pointer-events:none;opacity:.55;
  background-image:radial-gradient(1px 1px at 12% 18%,#fff,transparent),radial-gradient(1px 1px at 72% 12%,#cde,transparent),radial-gradient(1.5px 1.5px at 38% 72%,#fff,transparent),radial-gradient(1px 1px at 86% 64%,#bcd,transparent),radial-gradient(1px 1px at 22% 88%,#fff,transparent),radial-gradient(1.5px 1.5px at 58% 40%,#def,transparent);
  animation:twinkle 6s ease-in-out infinite alternate}
body::after{content:"";position:fixed;left:-50%;right:-50%;bottom:-30vh;height:60vh;pointer-events:none;opacity:.35;
  background-image:linear-gradient(rgba(34,211,238,.35) 1px,transparent 1px),linear-gradient(90deg,rgba(34,211,238,.35) 1px,transparent 1px);background-size:56px 56px;
  transform:perspective(420px) rotateX(62deg);mask-image:linear-gradient(to top,#000,transparent);animation:grid 9s linear infinite}
@keyframes twinkle{from{opacity:.35}to{opacity:.7}}
@keyframes grid{from{background-position:0 0}to{background-position:0 56px}}
.stage{position:relative;z-index:1;width:min(460px,100%);display:flex;flex-direction:column;align-items:center}
.octo{width:132px;height:132px;filter:drop-shadow(0 12px 30px rgba(34,211,238,.35));animation:float 4.5s ease-in-out infinite}
.octo-ghost{opacity:0}.octo-cyan{fill:#00f0ff}.octo-magenta{fill:#ff2bd6}
.octo:hover .octo-cyan,.glitch .octo-cyan{opacity:.55;transform:translate(-2.5px,0);animation:glitch 2.4s steps(1) infinite}
.octo:hover .octo-magenta,.glitch .octo-magenta{opacity:.55;transform:translate(2.5px,0);animation:glitch 2.4s steps(1) infinite reverse}
.octo-eyes{transform-origin:50px 36px;animation:blink 5s infinite}
@keyframes float{0%,100%{transform:translateY(0) rotate(-2deg)}50%{transform:translateY(-10px) rotate(2deg)}}
@keyframes blink{0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(.1)}}
@keyframes glitch{0%{clip-path:inset(0 0 70% 0)}25%{clip-path:inset(40% 0 30% 0)}50%{clip-path:inset(75% 0 0 0)}75%{clip-path:inset(10% 0 60% 0)}}
.bubble{position:relative;margin:6px 0 18px;padding:10px 16px;border-radius:14px;background:rgba(34,211,238,.12);border:1px solid rgba(34,211,238,.35);color:#d6f8ff;font:500 15px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;min-height:44px;max-width:100%}
.bubble::before{content:"";position:absolute;top:-7px;left:50%;width:12px;height:12px;background:inherit;border-left:inherit;border-top:inherit;transform:translateX(-50%) rotate(45deg);background:#0e2a33}
.bubble .caret{display:inline-block;width:.55em;height:1.05em;margin-left:2px;vertical-align:-2px;background:#ff3bd4;animation:caret 1s steps(1) infinite}
@keyframes caret{50%{opacity:0}}
.rail{display:flex;gap:8px;margin-bottom:14px;font:600 11px/1 ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase;color:var(--ink2)}
.rail span{padding:6px 10px;border-radius:999px;border:1px solid var(--line)}.rail span.on{color:#05070f;background:var(--accent);border-color:var(--accent)}.rail span.done{color:var(--accent);border-color:rgba(34,211,238,.5)}
main{width:100%;background:var(--card);border:1px solid var(--line);border-radius:20px;padding:26px;backdrop-filter:blur(14px);box-shadow:0 30px 80px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,255,255,.04)}
h1{font-size:21px;margin:0 0 6px;letter-spacing:-.01em}p{margin:0 0 14px;color:var(--ink2)}
.mark{font:700 12px/1 ui-monospace,monospace;letter-spacing:.32em;color:var(--accent);margin-bottom:16px}
[hidden]{display:none!important}
button,.btn{display:block;width:100%;padding:13px 14px;margin:9px 0;border-radius:13px;border:1px solid var(--line);background:rgba(255,255,255,.02);color:var(--ink);font:inherit;font-weight:600;cursor:pointer;text-align:center;text-decoration:none;transition:transform .15s,box-shadow .15s,border-color .15s}
button:hover:not(:disabled),.btn:hover{transform:translateY(-1px);border-color:rgba(34,211,238,.6);box-shadow:0 0 0 1px rgba(34,211,238,.25),0 8px 24px rgba(34,211,238,.15)}
button.primary,.btn.primary{background:linear-gradient(135deg,var(--accent),var(--accent2));border-color:transparent;color:#06060f}button:disabled{opacity:.55;cursor:default}
input{width:100%;padding:13px 14px;border-radius:13px;border:1px solid var(--line);background:rgba(0,0,0,.25);color:var(--ink);font:600 24px/1 ui-monospace,monospace;letter-spacing:.35em;text-align:center}
input:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px rgba(34,211,238,.2)}
.error{color:var(--bad)}.muted{color:var(--ink2);font-size:13px}.qr{display:grid;place-items:center;margin:12px 0}.qr svg{width:240px;height:240px;border-radius:14px}
.device{border:1px solid var(--line);border-radius:13px;padding:12px 14px;margin:12px 0;background:rgba(255,255,255,.02)}.device strong{display:block}
.cmd{display:block;padding:10px 12px;border-radius:10px;border:1px solid var(--line);background:rgba(0,0,0,.35);font:13px/1.4 ui-monospace,monospace;color:#d6f8ff;user-select:all;overflow-x:auto;white-space:nowrap}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}
`;

const SHARED_SCRIPT = `
const $ = (id) => document.getElementById(id);
// This Omni's address as people reach it: the page's own URL up to its /api/login path.
const omniBase = () => location.href.split('/api/login/')[0];
const appLink = () => 'omni://connect?url=' + encodeURIComponent(omniBase());
// The octopus says things, one character at a time (all at once with reduced motion).
let speaking = 0;
function speak(text) {
  const bubble = $('bubble'); if (!bubble) return;
  const run = ++speaking;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { bubble.textContent = text; return; }
  bubble.textContent = ''; const caret = document.createElement('span'); caret.className = 'caret';
  let i = 0;
  const tick = () => { if (run !== speaking) return; bubble.textContent = text.slice(0, ++i); bubble.append(caret); if (i < text.length) setTimeout(tick, 22); };
  tick();
}
function rail(step) {
  document.querySelectorAll('.rail span').forEach((el, i) => { el.className = i < step ? 'done' : i === step ? 'on' : ''; });
}
function glitch() { const o = document.querySelector('.octo'); if (!o) return; o.parentElement.classList.add('glitch'); setTimeout(() => o.parentElement.classList.remove('glitch'), 900); }
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
  // Named by the owner's number: without a name, Better Auth names the passkey by the account's placeholder email.
  const session = await call('GET', '/api/auth/get-session').catch(() => null);
  const name = session && session.user && session.user.name;
  const options = await call('GET', '/api/auth/passkey/generate-register-options' + (name ? '?name=' + encodeURIComponent(name) : ''));
  const cred = await navigator.credentials.create({ publicKey: creationOptions(options) });
  await call('POST', '/api/auth/passkey/verify-registration', { response: credentialJSON(cred), name: navigator.platform || 'This device' });
}
// PASSKEYS: this Omni has a fixed public URL, which WebAuthn needs (login/config.ts).
const passkeysAvailable = () => PASSKEYS && typeof PublicKeyCredential !== 'undefined';
`;

/** What a page may offer: passkeys only where this Omni has a fixed public URL. */
export interface PageOptions {
  passkeys?: boolean;
}

/** The octopus page shell these pages share, and the marketplace page (market/page.ts) reuses. */
export function page(
  title: string,
  body: string,
  script: string,
  rail: string[] = [],
  options: PageOptions = {},
): string {
  const steps = rail.length ? `<div class="rail">${rail.map((step) => `<span>${step}</span>`).join('')}</div>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><meta name="theme-color" content="#05070f"><link rel="icon" href="${ICON}"><title>${title}</title><style>${STYLE}</style></head><body><div class="stage">${OCTOPUS}<div class="bubble" id="bubble" role="status"></div>${steps}<main><div class="mark">OMNI</div>${body}<p id="status" class="muted"></p></main></div><script>const PASSKEYS = ${options.passkeys === true};${SHARED_SCRIPT}${script}</script></body></html>`;
}

export function claimPage(options: PageOptions = {}): string {
  return page(
    'Welcome to Omni',
    `
<section id="claim"><h1>Make this Omni yours</h1><p>You have its claim link, so you run it. One tap and it's yours.</p><button class="primary" id="claimNow">Claim this Omni</button><button id="withPhone">Claim it with my WhatsApp instead</button></section>
<section id="pick" hidden><h1 id="pickTitle">Approve from your phone</h1><p>Optional: link your WhatsApp, and you can approve new devices by texting yourself. Without it, approve them with <code>omni approve</code> on the server.</p><div id="accounts"></div><button id="connect">Connect my WhatsApp</button><button id="skipPhone">Not now</button></section>
<section id="link" hidden><h1>Link your WhatsApp</h1><p>On your phone: WhatsApp → Settings → Linked devices → Link a device, and scan this.</p><div class="qr" id="qr"></div></section>
<section id="code" hidden><h1>Check your WhatsApp</h1><p>I sent a 6-digit code to <strong id="sentTo"></strong>, in your chat with yourself.</p><input id="otp" inputmode="numeric" autocomplete="one-time-code" maxlength="6" aria-label="Code"><button class="primary" id="verify">Claim this Omni</button></section>
<section id="done" hidden><h1>This Omni is yours</h1><p id="doneLede">Make signing in a touch: use this device's fingerprint or face instead of a code.</p><button class="primary" id="passkey">Use my fingerprint or face</button>
<p style="margin-top:18px">That's all on this page. Next, open Automagik on your computer and connect it to <strong id="host"></strong>: open this Omni's <a id="appPage" href="app">app page</a> there and tap <em>Open in Automagik</em>.</p><code class="cmd">npx @automagik/omni desktop</code></section>`,
    `
const token = new URLSearchParams(location.search).get('token') || '';
const claim = (method, path, body) => call(method, '/api/v2/login/claim' + path, body, { 'x-omni-claim-token': token });
let instanceId = null;
async function sendCode(id) {
  instanceId = id;
  const { sentTo } = await claim('POST', '/send-code', { instanceId: id });
  $('sentTo').textContent = sentTo; show('code'); $('otp').focus();
  speak('Check your chat with yourself. Six digits, from me.');
}
let claimedByToken = false;
function finish(viaPhone) {
  say(''); show('done'); rail(1); glitch();
  speak("I'm yours! Now open me on your computer and give me a brain.");
  if (!viaPhone) $('doneLede').textContent = 'Approve new devices with omni approve on the server, or link WhatsApp later from this same link to approve them from your phone.';
  // A passkey needs a signed-in session, which only the WhatsApp code gives, and a fixed address.
  if (!viaPhone || !passkeysAvailable()) $('passkey').hidden = true;
}
async function pickPhone() {
  show('pick');
  const accounts = await claim('GET', '/accounts');
  $('accounts').replaceChildren();
    for (const account of accounts) {
      const b = document.createElement('button'); b.className = 'primary';
      b.textContent = 'My number: ' + account.phone;
      b.onclick = () => sendCode(account.instanceId).catch((e) => say(e.message, true));
      $('accounts').append(b);
    }
    if (accounts.length) $('connect').textContent = 'Connect another WhatsApp';
}
async function start() {
  rail(0);
  speak("Hi! I'm Omni. Every chat, every channel, one place. Let's make me yours.");
  if (!token) { speak('I need my claim link. It is in my server log.'); return say('Open the claim link printed in the Omni server log, or run omni claim on the server.', true); }
  try {
    const status = await call('GET', '/api/v2/login/status');
    await pickPhone(); // checks the link: it works while nobody owns me, or my owner has no WhatsApp yet
    if (status.claimed) { claimedByToken = true; speak('I am yours already. Want approvals on your phone?'); }
    else show('claim');
  }
  catch (e) {
    speak(e.message === 'Not found' ? 'I already have an owner. Or this link is not mine.' : 'Hmm, something is off.');
    say(e.message === 'Not found' ? 'This Omni is already claimed, or the claim link is wrong.' : e.message, true); show('none');
  }
}
$('claimNow').onclick = async () => {
  try { await claim('POST', '/token'); claimedByToken = true; glitch(); speak("I'm yours. Want approvals on your phone too?"); await pickPhone(); $('pickTitle').textContent = 'This Omni is yours. Approve from your phone too?'; }
  catch (e) { say(e.message, true); }
};
$('withPhone').onclick = () => show('pick');
$('skipPhone').onclick = () => (claimedByToken ? finish(false) : show('claim'));
$('connect').onclick = async () => {
  try {
    const { instanceId: id } = await claim('POST', '/whatsapp');
    show('link'); speak('Scan me from WhatsApp, under Linked devices.');
    const poll = async () => {
      const state = await claim('GET', '/whatsapp/' + id);
      if (state.connected) { glitch(); return sendCode(id); }
      if (state.qrSvg) $('qr').innerHTML = state.qrSvg; // server-made SVG of WhatsApp's own linking code
      setTimeout(() => poll().catch((e) => say(e.message, true)), 2500);
    };
    await poll();
  } catch (e) { say(e.message, true); }
};
$('verify').onclick = async () => {
  try {
    await claim('POST', '/verify', { instanceId, code: $('otp').value.trim() });
    // Linking after a claim by token gives no session, so no passkey from here.
    finish(!claimedByToken);
  } catch (e) { speak('That is not the code I sent. Try again?'); say(e.message, true); }
};
$('host').textContent = location.host;
$('passkey').onclick = async () => {
  try { await addPasskey(); glitch(); speak('Got it. Next time, just a touch. You can close this page.'); $('passkey').hidden = true; say(''); }
  catch (e) { say(e.name === 'InvalidStateError' ? 'This device already has a passkey for this Omni.' : e.message, true); $('passkey').hidden = e.name === 'InvalidStateError'; }
};
start();`,
    ['Claim', 'Connect AI', 'Your devices'],
    options,
  );
}

// The desktop app (Automagik's, formerly automagik-dev/omni-desktop): its latest release.
const GET_APP = 'https://github.com/automagik-dev/automagik/releases/latest';

/**
 * Open Automagik on this computer, connected to this Omni: an omni:// link and how to get
 * the app. With a live `grant` the link carries it; an `expired` one says so and nothing else.
 */
export function appPage(link: { grant: string } | { expired: true } | Record<string, never> = {}): string {
  if ('expired' in link) {
    return page(
      'Open Automagik',
      `
<section id="expired"><h1>This link expired</h1><p>A connect link works once, for ten minutes. Text <strong>connect</strong> to yourself on WhatsApp and I'll send a new one.</p></section>`,
      `
speak('That link is used up. Ask me for a new one.');`,
    );
  }
  // The grant matched GrantSchema (base64url) before it got here: safe inside the script.
  const grant = 'grant' in link ? JSON.stringify(link.grant) : 'null';
  return page(
    'Open Automagik',
    `
<section id="open"><h1>Open Automagik on this computer</h1><p id="lede">Automagik connects to <strong id="host"></strong>. It asks you first, then you sign in here with Face ID, Touch ID, your fingerprint or a code on WhatsApp.</p><a class="btn primary" id="openApp" href="#">Open in Automagik</a><button id="copy" hidden>Copy the app link</button>
<p style="margin-top:18px" class="muted">No app yet? <a href="${GET_APP}">Download Automagik for Mac or Linux</a>, or run:</p><code class="cmd">npx @automagik/omni desktop</code></section>`,
    `
const grant = ${grant};
const link = appLink() + (grant ? '&grant=' + encodeURIComponent(grant) : '');
$('host').textContent = location.host;
$('openApp').href = link;
if (grant) {
  $('lede').textContent = 'Automagik connects to ' + location.host + ' right away: you asked for this link in your own WhatsApp. It works once, for ten minutes.';
  $('copy').hidden = !navigator.clipboard;
  $('copy').onclick = () => navigator.clipboard.writeText(link).then(() => say('Copied. Paste it in Automagik, under Connect your Omni.'), (e) => say(e.message, true));
}
speak(grant ? "One tap and I'm on this computer." : "Let's put me on your computer.");`,
  );
}

/**
 * What a browser sees at this Omni's address. Public: nothing about the owner or what the
 * Omni holds. `publicUrl` is set when human login is on; only then can the app connect.
 */
export function landingPage({ publicUrl }: { publicUrl: string | null }): string {
  // encodeURIComponent leaves no quote or angle bracket: safe inside the attribute.
  const open = publicUrl
    ? `<a class="btn primary" id="openApp" href="omni://connect?url=${encodeURIComponent(publicUrl)}">Open in Automagik</a>`
    : '';
  const text = publicUrl
    ? '<p class="muted">Already have the app? Text <strong>connect</strong> to yourself on WhatsApp and open the link I send.</p>'
    : '';
  return page(
    'Omni',
    `
<section id="landing"><h1>This is an Omni</h1><p>Every chat, every channel, one place. Use it from Automagik on your computer.</p>${open}<a class="btn${publicUrl ? '' : ' primary'}" href="${GET_APP}">Get Automagik</a>${text}</section>`,
    `
speak("Hi! I'm Omni.");`,
  );
}

export function devicePage(clients: Record<string, string>, options: PageOptions = {}): string {
  return page(
    'Approve a device',
    `
<section id="signin" hidden><h1>Sign in to approve</h1><p>A device is asking to use your Omni. First, show it's you.</p><button class="primary" id="usePasskey">Use Face ID, Touch ID or fingerprint</button><button id="sendCode">Send me a code on WhatsApp</button><p class="muted">Or on the server: <code id="approveCmd"></code></p><p class="muted" id="noPasskey" hidden>Face ID and fingerprints need this Omni's fixed address (OMNI_PUBLIC_URL), so they are off here.</p><div id="codeBox" hidden><p>Code sent to <strong id="sentTo"></strong>, in your chat with yourself.</p><input id="otp" inputmode="numeric" autocomplete="one-time-code" maxlength="6"><button class="primary" id="verify">Sign in</button></div></section>
<section id="approve" hidden><h1>Approve this device?</h1><div class="device"><strong id="client"></strong><span class="muted">Code <span id="userCode"></span></span></div><p>It will be able to use your Omni until you revoke it.</p><button class="primary" id="yes">Approve</button><button id="no">Deny</button></section>
<section id="done" hidden><h1 id="doneTitle">Approved</h1><p id="doneText">The device is signing in now.</p><a class="btn primary" id="backToApp" href="omni://open" hidden>Back to Automagik</a><button id="passkey" hidden>Use this device's fingerprint or face next time</button></section>`,
    `
const CLIENTS = ${JSON.stringify(clients)};
const userCode = (new URLSearchParams(location.search).get('user_code') || '').toUpperCase();
let clientId = null;
async function load() {
  speak('Someone wants to use your Omni. Is it you?');
  if (!userCode) return say('Open this page from the QR code on the device.', true);
  const session = await call('GET', '/api/auth/get-session').catch(() => null);
  if (!session) {
    show('signin'); $('approveCmd').textContent = 'omni approve ' + userCode;
    if (!passkeysAvailable()) { $('usePasskey').hidden = true; $('noPasskey').hidden = PASSKEYS; }
    return;
  }
  try {
    const request = await call('GET', '/api/auth/device?user_code=' + encodeURIComponent(userCode));
    clientId = request.client_id || request.clientId || null;
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
    show('done'); glitch(); speak('Approved. It is signing in now.');
    // The desktop app opened this page: one tap takes the person back to it.
    $('backToApp').hidden = clientId !== 'omni-desktop';
    const keys = passkeysAvailable() ? await call('GET', '/api/auth/passkey/list-user-passkeys').catch(() => []) : [null];
    if (Array.isArray(keys) && keys.length === 0) $('passkey').hidden = false;
  } catch (e) { say(e.message, true); }
};
$('no').onclick = async () => { try { await call('POST', '/api/auth/device/deny', { userCode }); $('doneTitle').textContent = 'Denied'; $('doneText').textContent = 'The device was not let in.'; show('done'); } catch (e) { say(e.message, true); } };
$('passkey').onclick = async () => { try { await addPasskey(); say('Done. Next time, approve with your fingerprint or face.'); $('passkey').hidden = true; } catch (e) { say(e.message, true); } };
load();`,
    [],
    options,
  );
}
