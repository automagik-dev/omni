/**
 * Demo page with the chat bubble. Self-contained (inline CSS + JS, no CDN) so
 * it can be served straight from the plugin. A real embed would be a script
 * tag on the customer's site plus CORS/origin rules on the API.
 *
 * The 🎤 button runs the voice echo test (./voice.ts): an AudioWorklet cuts the
 * microphone into 20 ms PCM frames for the voice socket and the replies are
 * scheduled back to back on the speaker. Browsers only open the microphone on
 * HTTPS or localhost.
 */

export function renderWidgetPage(instanceId: string): string {
  const base = `/api/v2/channels/webchat/${instanceId}`;
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Omni Webchat (protótipo)</title>
<style>
  :root { --bg:#f4f5f7; --card:#fff; --text:#1d2129; --muted:#6b7280; --brand:#2563eb; --me:#2563eb; --them:#e5e7eb; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#0f1115; --card:#181b22; --text:#e6e8ec; --muted:#9aa1ad; --brand:#3b82f6; --me:#2563eb; --them:#2a2f3a; }
  }
  * { box-sizing: border-box; }
  body { margin:0; font:15px/1.45 system-ui, sans-serif; background:var(--bg); color:var(--text); }
  main { max-width:720px; margin:0 auto; padding:32px 16px; }
  h1 { font-size:20px; margin:0 0 8px; }
  p { color:var(--muted); margin:0 0 8px; }
  code { font-size:13px; }
  #launcher { position:fixed; right:20px; bottom:20px; width:56px; height:56px; border-radius:50%; border:0;
    background:var(--brand); color:#fff; font-size:24px; cursor:pointer; box-shadow:0 4px 14px rgba(0,0,0,.25); }
  #panel { position:fixed; right:20px; bottom:88px; width:min(360px, calc(100vw - 32px)); height:min(520px, calc(100vh - 120px));
    background:var(--card); border-radius:14px; box-shadow:0 8px 30px rgba(0,0,0,.25); display:none; flex-direction:column; overflow:hidden; }
  #panel.open { display:flex; }
  header { padding:12px 14px; background:var(--brand); color:#fff; display:flex; justify-content:space-between; align-items:center; }
  header small { opacity:.85; }
  #log { flex:1; overflow-y:auto; padding:12px; display:flex; flex-direction:column; gap:6px; }
  .msg { max-width:80%; padding:8px 11px; border-radius:12px; white-space:pre-wrap; word-wrap:break-word; }
  .me { align-self:flex-end; background:var(--me); color:#fff; border-bottom-right-radius:4px; }
  .them { align-self:flex-start; background:var(--them); border-bottom-left-radius:4px; }
  #mic { border:0; background:rgba(255,255,255,.2); color:#fff; border-radius:8px; padding:4px 8px; cursor:pointer; font-size:15px; }
  #voice { padding:6px 14px 0; color:var(--muted); font-size:12px; min-height:18px; word-break:break-all; }
  #typing { padding:0 14px 6px; color:var(--muted); font-size:13px; min-height:20px; }
  form { display:flex; gap:8px; padding:10px; border-top:1px solid var(--them); }
  input { flex:1; padding:9px 11px; border-radius:10px; border:1px solid var(--them); background:var(--bg); color:var(--text); font:inherit; }
  button[type=submit] { border:0; border-radius:10px; padding:0 14px; background:var(--brand); color:#fff; font:inherit; cursor:pointer; }
</style>
</head>
<body>
<main>
  <h1>Omni Webchat — protótipo</h1>
  <p>Página de demonstração. O balão no canto inferior direito conversa com a instância <code>${instanceId}</code>.</p>
  <p>Entrada por <code>POST ${base}/messages</code>; respostas chegam por Server-Sent Events em <code>${base}/events</code>.</p>
  <p>Voz (teste de eco): botão 🎤 no balão, WebSocket em <code>${base}/voice</code>. O microfone só abre em HTTPS ou localhost. Use fone de ouvido.</p>
</main>

<button id="launcher" aria-label="Abrir chat">💬</button>
<section id="panel" aria-label="Chat">
  <header><strong>Atendimento</strong><span><small id="status">conectando…</small> <button id="mic" type="button" aria-label="Voz">🎤</button></span></header>
  <div id="voice"></div>
  <div id="log"></div>
  <div id="typing"></div>
  <form id="form">
    <input id="text" autocomplete="off" placeholder="Digite sua mensagem" maxlength="4000">
    <button type="submit">Enviar</button>
  </form>
</section>

<script>
(() => {
  const BASE = ${JSON.stringify(base)};
  const KEY = 'omni-webchat-visitor';
  let visitorId = null;
  try { visitorId = localStorage.getItem(KEY); } catch {}
  if (!visitorId) {
    // crypto.randomUUID() only exists on HTTPS/localhost; getRandomValues works on plain http too.
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    visitorId = 'v' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    try { localStorage.setItem(KEY, visitorId); } catch {}
  }

  const $ = (id) => document.getElementById(id);
  const log = $('log'), statusEl = $('status'), typingEl = $('typing');
  const seen = new Set();
  let typingTimer;

  function add(text, who) {
    const div = document.createElement('div');
    div.className = 'msg ' + who;
    div.textContent = text;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
  }

  $('launcher').onclick = () => { $('panel').classList.toggle('open'); $('text').focus(); };

  const es = new EventSource(BASE + '/events?visitorId=' + encodeURIComponent(visitorId));
  es.addEventListener('ready', () => { statusEl.textContent = 'online'; });
  es.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (seen.has(m.id)) return; // backlog is replayed on every reconnect
    seen.add(m.id);
    typingEl.textContent = '';
    add(m.text, 'them');
  });
  es.addEventListener('typing', (e) => {
    const t = JSON.parse(e.data);
    clearTimeout(typingTimer);
    typingEl.textContent = t.on ? 'digitando…' : '';
    if (t.on) typingTimer = setTimeout(() => { typingEl.textContent = ''; }, 8000);
  });
  es.onerror = () => { statusEl.textContent = 'reconectando…'; };

  $('form').onsubmit = async (e) => {
    e.preventDefault();
    const input = $('text');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    add(text, 'me');
    const res = await fetch(BASE + '/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visitorId, name: 'Visitante ' + visitorId.slice(1, 7), text }),
    }).catch(() => null);
    if (!res || !res.ok) add('⚠ não foi possível enviar', 'them');
  };

  // ─── Voice echo test ───────────────────────────────────────────
  // 20 ms frames: 960 samples at 48 kHz, mono mic copied to both stereo channels.
  const WORKLET = [
    'class OmniMic extends AudioWorkletProcessor {',
    '  constructor() { super(); this.buf = new Float32Array(960); this.n = 0; }',
    '  process(inputs) {',
    '    const ch = inputs[0] && inputs[0][0];',
    '    if (!ch) return true;',
    '    for (let i = 0; i < ch.length; i++) {',
    '      this.buf[this.n++] = ch[i];',
    '      if (this.n < 960) continue;',
    '      const out = new Int16Array(1920);',
    '      for (let j = 0; j < 960; j++) { const s = Math.max(-1, Math.min(1, this.buf[j])) * 32767; out[2 * j] = s; out[2 * j + 1] = s; }',
    '      this.port.postMessage(out.buffer, [out.buffer]);',
    '      this.n = 0;',
    '    }',
    '    return true;',
    '  }',
    '}',
    "registerProcessor('omni-mic', OmniMic);",
  ].join(' ');
  const micBtn = $('mic'), voiceEl = $('voice');
  let voice = null;

  function stopVoice() {
    if (!voice) return;
    const v = voice;
    voice = null;
    if (v.stream) v.stream.getTracks().forEach((t) => t.stop());
    if (v.ws) try { v.ws.close(); } catch {}
    v.ctx.close().catch(() => {});
    micBtn.textContent = '🎤';
  }

  async function startVoice() {
    if (!window.isSecureContext || !navigator.mediaDevices) {
      voiceEl.textContent = 'voz: o microfone só abre em HTTPS ou localhost';
      return;
    }
    voice = { ctx: new AudioContext({ sampleRate: 48000 }) };
    const ctx = voice.ctx;
    micBtn.textContent = '⏹';
    voiceEl.textContent = 'voz: pedindo o microfone…';
    voice.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
    });
    await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' })));
    const mic = new AudioWorkletNode(ctx, 'omni-mic');
    const mute = ctx.createGain();
    mute.gain.value = 0; // the worklet must reach the destination to run, silently
    ctx.createMediaStreamSource(voice.stream).connect(mic);
    mic.connect(mute).connect(ctx.destination);

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(proto + '//' + location.host + BASE + '/voice?visitorId=' + encodeURIComponent(visitorId));
    ws.binaryType = 'arraybuffer';
    voice.ws = ws;
    voiceEl.textContent = 'voz: conectando…';
    mic.port.onmessage = (e) => { if (ws.readyState === 1) ws.send(e.data); };

    let playAt = 0;
    ws.onmessage = (e) => {
      if (typeof e.data === 'string') {
        const m = JSON.parse(e.data);
        if (m.type === 'session_ready') voiceEl.textContent = 'voz: sessão ' + m.sessionId;
        return;
      }
      const pcm = new Int16Array(e.data);
      const frames = pcm.length / 2;
      const buf = ctx.createBuffer(2, frames, 48000);
      const left = buf.getChannelData(0), right = buf.getChannelData(1);
      for (let i = 0; i < frames; i++) { left[i] = pcm[2 * i] / 32768; right[i] = pcm[2 * i + 1] / 32768; }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      playAt = Math.max(playAt, ctx.currentTime + 0.06); // 60 ms cushion against network jitter
      src.start(playAt);
      playAt += buf.duration;
    };
    ws.onclose = (e) => {
      if (!voice || voice.ws !== ws) return;
      voiceEl.textContent = 'voz: encerrada' + (e.reason ? ' (' + e.reason + ')' : '');
      stopVoice();
    };
  }

  micBtn.onclick = () => {
    if (voice) {
      stopVoice();
      voiceEl.textContent = 'voz: encerrada';
      return;
    }
    startVoice().catch((err) => { voiceEl.textContent = 'voz: ' + err.message; stopVoice(); });
  };
})();
</script>
</body>
</html>`;
}
