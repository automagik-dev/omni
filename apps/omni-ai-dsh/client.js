// Generated from src/client by `npm run build` (scripts/build-client.mjs). Do not edit by hand.
window.__ModuleLoader__.load({
  id: '@automagik/omni-ai-dsh',
  factory: (require) => {
const module = { exports: {} }
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.js
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);

// src/client/api.js
var ROUTE = "api/omni-ai";
async function call(endpoint, payload) {
  let response;
  try {
    response = await fetch(ROUTE, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ endpoint, payload: payload ?? null })
    });
  } catch {
    throw Object.assign(new Error("Could not reach DSH. Check that it is still running."), { code: "NETWORK" });
  }
  if (!response.ok) throw Object.assign(new Error(`DSH answered HTTP ${response.status}`), { code: `HTTP_${response.status}` });
  const result = await response.json();
  if (!result.ok) throw Object.assign(new Error(result.error?.message ?? "Request failed"), { code: result.error?.code ?? "omni-ai/error" });
  return result.value;
}

// src/client/octopus.js
var BODY = "M50 6C75 6 87 24 87 46C87 60 82 68 80 72C84 82 84 92 80 96C76 98 72 92 70 84C68 92 66 98 61 96C57 94 56 84 54 78C52 80 48 80 46 78C44 84 43 94 39 96C34 98 32 92 30 84C28 92 24 98 20 96C16 92 16 82 20 72C18 68 13 60 13 46C13 24 25 6 50 6Z";
var SHADE = "M87 46C87 60 82 68 80 72C84 82 84 92 80 96C76 98 72 92 70 84C68 92 66 98 61 96C57 94 56 84 54 78C62 76 70 66 75 56C80 48 80 36 75 26C82 32 87 38 87 46Z";
var OCTOPUS_SVG = `<svg class="oai-octo" viewBox="0 0 100 100" aria-hidden="true">
<defs><linearGradient id="oai-octo-skin" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8ff4ff"/><stop offset=".5" stop-color="#22d3ee"/><stop offset="1" stop-color="#0e7490"/></linearGradient></defs>
<path class="oai-ghost oai-cyan" d="${BODY}"/><path class="oai-ghost oai-magenta" d="${BODY}"/>
<path d="${BODY}" fill="url(#oai-octo-skin)"/><path d="${SHADE}" fill="#0b4f6c" opacity=".5"/>
<path d="M30 22C36 14 44 11 50 11C40 14 33 20 30 28Z" fill="#fff" opacity=".45"/>
<g class="oai-eyes"><ellipse cx="40" cy="36" rx="6.5" ry="11" fill="#06121f"/><ellipse cx="60" cy="36" rx="6.5" ry="11" fill="#06121f"/>
<circle cx="42" cy="31" r="2.4" fill="#fff"/><circle cx="62" cy="31" r="2.4" fill="#fff"/></g>
<path d="M44 54Q50 59 56 54" stroke="#06121f" stroke-width="2.4" fill="none" stroke-linecap="round"/>
<ellipse cx="31" cy="50" rx="5" ry="2.8" fill="#ff5fb8" opacity=".6"/><ellipse cx="69" cy="50" rx="5" ry="2.8" fill="#ff5fb8" opacity=".6"/>
<g fill="none" stroke="#0e7490" stroke-width="3" stroke-linecap="round"><path d="M20 96Q13 99 12 92"/><path d="M80 96Q87 99 88 92"/></g>
</svg>`;
var STAGE_CSS = `
.oai-overlay{--oai-bg:#05070f;--oai-card:rgba(13,20,36,.8);--oai-ink:#eef3ff;--oai-ink2:#9fb0cc;--oai-line:rgba(120,160,220,.22);--oai-accent:#22d3ee;--oai-accent-2:#ff3bd4;--oai-bad:#ff6b6b;
  position:fixed;inset:0;z-index:2000;overflow:auto;display:grid;place-items:center;padding:24px 16px;box-sizing:border-box;color-scheme:dark;color:var(--oai-ink);
  font:15px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
  background:radial-gradient(1200px 600px at 50% -10%,rgba(34,211,238,.18),transparent 60%),radial-gradient(900px 500px at 100% 110%,rgba(255,59,212,.16),transparent 60%),var(--oai-bg)}
.oai-overlay *{box-sizing:border-box}
.oai-overlay::before{content:"";position:fixed;inset:0;pointer-events:none;opacity:.55;
  background-image:radial-gradient(1px 1px at 12% 18%,#fff,transparent),radial-gradient(1px 1px at 72% 12%,#cde,transparent),radial-gradient(1.5px 1.5px at 38% 72%,#fff,transparent),radial-gradient(1px 1px at 86% 64%,#bcd,transparent),radial-gradient(1px 1px at 22% 88%,#fff,transparent),radial-gradient(1.5px 1.5px at 58% 40%,#def,transparent);
  animation:oai-twinkle 6s ease-in-out infinite alternate}
.oai-overlay::after{content:"";position:fixed;left:-50%;right:-50%;bottom:-30vh;height:60vh;pointer-events:none;opacity:.35;
  background-image:linear-gradient(rgba(34,211,238,.32) 1px,transparent 1px),linear-gradient(90deg,rgba(255,59,212,.22) 1px,transparent 1px);background-size:56px 56px;
  transform:perspective(420px) rotateX(62deg);mask-image:linear-gradient(to top,#000,transparent);animation:oai-grid 9s linear infinite}
@keyframes oai-twinkle{from{opacity:.35}to{opacity:.7}}
@keyframes oai-grid{from{background-position:0 0}to{background-position:0 56px}}
.oai-stage{position:relative;z-index:1;width:min(580px,100%);display:flex;flex-direction:column;align-items:center}
.oai-octo{width:124px;height:124px;filter:drop-shadow(0 12px 30px rgba(34,211,238,.35)) drop-shadow(0 0 18px rgba(255,59,212,.18));animation:oai-float 4.5s ease-in-out infinite}
.oai-ghost{opacity:0}.oai-cyan{fill:#00f0ff}.oai-magenta{fill:#ff2bd6}
.oai-octo:hover .oai-cyan,.oai-glitch .oai-cyan{opacity:.55;transform:translate(-2.5px,0);animation:oai-glitch 2.4s steps(1) infinite}
.oai-octo:hover .oai-magenta,.oai-glitch .oai-magenta{opacity:.55;transform:translate(2.5px,0);animation:oai-glitch 2.4s steps(1) infinite reverse}
.oai-eyes{transform-origin:50px 36px;animation:oai-blink 5s infinite}
@keyframes oai-float{0%,100%{transform:translateY(0) rotate(-2deg)}50%{transform:translateY(-10px) rotate(2deg)}}
@keyframes oai-blink{0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(.1)}}
@keyframes oai-glitch{0%{clip-path:inset(0 0 70% 0)}25%{clip-path:inset(40% 0 30% 0)}50%{clip-path:inset(75% 0 0 0)}75%{clip-path:inset(10% 0 60% 0)}}
.oai-bubble{position:relative;margin:6px 0 18px;padding:10px 16px;border-radius:14px;background:rgba(34,211,238,.1);border:1px solid rgba(34,211,238,.35);color:#d6f8ff;font:500 15px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;min-height:44px;max-width:100%}
.oai-bubble::before{content:"";position:absolute;top:-7px;left:50%;width:12px;height:12px;border-left:inherit;border-top:inherit;transform:translateX(-50%) rotate(45deg);background:#0d2232}
.oai-caret{display:inline-block;width:.55em;height:1.05em;margin-left:2px;vertical-align:-2px;background:var(--oai-accent-2);animation:oai-caret 1s steps(1) infinite}
@keyframes oai-caret{50%{opacity:0}}
.oai-hidden{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.oai-rail{display:flex;flex-wrap:wrap;justify-content:center;gap:8px;margin:0 0 14px;padding:0;list-style:none;font:600 11px/1 ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase;color:var(--oai-ink2)}
.oai-rail li{padding:6px 10px;border-radius:999px;border:1px solid var(--oai-line)}.oai-rail li.oai-on{color:#05070f;background:var(--oai-accent);border-color:var(--oai-accent)}.oai-rail li.oai-done{color:var(--oai-accent);border-color:rgba(34,211,238,.5)}
.oai-card{width:100%;background:var(--oai-card);border:1px solid var(--oai-line);border-radius:20px;padding:24px;backdrop-filter:blur(14px);box-shadow:0 30px 80px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,255,255,.04)}
.oai-card h1{font-size:21px;margin:0 0 6px;letter-spacing:-.01em;outline:none}.oai-card p{margin:0 0 14px;color:var(--oai-ink2)}
.oai-mark{font:700 12px/1 ui-monospace,monospace;letter-spacing:.32em;color:var(--oai-accent);margin-bottom:14px}
.oai-card button{display:block;width:100%;padding:12px 14px;margin:8px 0 0;border-radius:13px;border:1px solid var(--oai-line);background:rgba(255,255,255,.02);color:var(--oai-ink);font:inherit;font-weight:600;cursor:pointer;text-align:center;transition:transform .15s,box-shadow .15s,border-color .15s}
.oai-card button:hover:not(:disabled),.oai-card button:focus-visible{transform:translateY(-1px);border-color:rgba(255,59,212,.6);box-shadow:0 0 0 1px rgba(255,59,212,.25),0 8px 24px rgba(255,59,212,.14);outline:none}
.oai-card button.oai-primary{background:linear-gradient(135deg,var(--oai-accent),var(--oai-accent-2));border-color:transparent;color:#06060f}.oai-card button:disabled{opacity:.55;cursor:default}
.oai-card button.oai-quiet{background:none;border-color:transparent;color:var(--oai-ink2);font-weight:500}
.oai-group{margin:16px 0 0}.oai-group h2{margin:0 0 2px;font:600 11px/1.4 ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase;color:var(--oai-accent)}
.oai-group .oai-terms{margin:0 0 4px;font-size:12px}
.oai-tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}
.oai-card button.oai-tile{margin:4px 0 0;text-align:left;padding:10px 12px}.oai-tile strong{display:block}.oai-tile span{display:block;font-size:12px;font-weight:400;color:var(--oai-ink2)}
.oai-card label{display:block;margin:12px 0 4px;font-size:13px;color:var(--oai-ink2)}
.oai-card input{width:100%;padding:11px 12px;border-radius:12px;border:1px solid var(--oai-line);background:rgba(0,0,0,.25);color:var(--oai-ink);font:14px/1.3 ui-monospace,monospace}
.oai-card input:focus{outline:none;border-color:var(--oai-accent);box-shadow:0 0 0 3px rgba(34,211,238,.2)}
.oai-error{color:var(--oai-bad)!important}.oai-muted{font-size:13px}
.oai-models{margin:8px 0 0;padding:8px 12px;border-radius:10px;border:1px solid var(--oai-line);background:rgba(0,0,0,.3);font:12px/1.5 ui-monospace,monospace;color:#d6f8ff;max-height:120px;overflow:auto}
.oai-card a.oai-link{color:var(--oai-accent);text-decoration:underline;text-underline-offset:3px}
.oai-card a.oai-button{display:block;margin:12px 0 0;padding:12px 14px;border-radius:13px;text-align:center;font-weight:600;text-decoration:none;background:linear-gradient(135deg,var(--oai-accent),var(--oai-accent-2));color:#06060f}
.oai-code{display:flex;align-items:center;gap:10px;margin:6px 0 4px;padding:12px 14px;border-radius:14px;border:1px dashed rgba(255,59,212,.5);background:rgba(255,59,212,.07)}
.oai-code code{flex:1;font:700 24px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.18em;color:#fff}
.oai-card .oai-code button.oai-ghost{display:inline-block;width:auto;margin:0;padding:8px 12px;font-size:13px}
.oai-choices button{text-align:left}.oai-choices button span{display:block;font-size:12px;font-weight:400;color:var(--oai-ink2)}
.oai-waiting::before{content:"";display:inline-block;width:9px;height:9px;margin-right:8px;border-radius:50%;background:var(--oai-accent-2);animation:oai-caret 1s steps(1) infinite}
.oai-card button.oai-tile-on{border-color:rgba(34,211,238,.55)}
.oai-tile em.oai-on{display:inline-block;margin-top:6px;padding:2px 8px;border-radius:999px;font:600 10px/1.6 ui-monospace,monospace;letter-spacing:.08em;text-transform:uppercase;font-style:normal;color:#06060f;background:var(--oai-accent)}
@media (prefers-reduced-motion:reduce){.oai-overlay *,.oai-overlay::before,.oai-overlay::after{animation:none!important;transition:none!important}}
`;

// src/client/stage.js
var import_react = require("react");
var import_react_dom = require("react-dom");
var RAIL = [["omni-welcome", "Welcome"], ["omni-connect", "Connect Omni"], ["omni-connect-ai", "Connect AI"]];
var ANNOUNCED = /* @__PURE__ */ Symbol.for("automagik.omni.onboarding-steps");
function announceStep(id, scope = globalThis) {
  const steps = scope[ANNOUNCED] ??= /* @__PURE__ */ new Set();
  steps.add(id);
  return () => steps.delete(id);
}
function railSteps(current, scope = globalThis) {
  const steps = scope[ANNOUNCED];
  return RAIL.filter(([id]) => id === current || steps?.has(id) === true);
}
var FLAG_OF = { "omni-welcome": "welcomeDone", "omni-connect-ai": "connectAiDone" };
var reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
async function gate({ stepId, explicit, complete }, request2 = call) {
  let state = {};
  try {
    state = await request2("state") ?? {};
  } catch {
  }
  if (explicit !== true && state[FLAG_OF[stepId]] === true) {
    complete();
    return null;
  }
  return state;
}
async function finish({ stepId, complete }, request2 = call) {
  try {
    await request2("done", { stepId });
  } catch {
  }
  complete();
}
async function finishInto(props, section, request2 = call) {
  await finish(props, request2);
  props.openSection(section);
}
function useGate(props) {
  const first = (0, import_react.useRef)(props);
  const [state, setState] = (0, import_react.useState)(void 0);
  (0, import_react.useEffect)(() => {
    let alive = true;
    gate(first.current).then((next) => {
      if (alive) setState(next);
    });
    return () => {
      alive = false;
    };
  }, []);
  return state;
}
function useFinish(props) {
  const done = (0, import_react.useRef)(false);
  return (0, import_react.useCallback)((section) => {
    if (done.current) return;
    done.current = true;
    if (section) void finishInto(props, section);
    else void finish(props);
  }, [props]);
}
function useGlitch() {
  const [on, setOn] = (0, import_react.useState)(false);
  const timer = (0, import_react.useRef)(0);
  (0, import_react.useEffect)(() => () => clearTimeout(timer.current), []);
  const glitch = (0, import_react.useCallback)(() => {
    if (reducedMotion()) return;
    setOn(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOn(false), 900);
  }, []);
  return [on, glitch];
}
function useTypewriter(text) {
  const [shown, setShown] = (0, import_react.useState)(() => reducedMotion() ? text : "");
  (0, import_react.useEffect)(() => {
    if (reducedMotion()) {
      setShown(text);
      return void 0;
    }
    let at = 0;
    let timer = 0;
    const tick = () => {
      at += 1;
      setShown(text.slice(0, at));
      if (at < text.length) timer = setTimeout(tick, 22);
    };
    setShown("");
    timer = setTimeout(tick, 120);
    return () => clearTimeout(timer);
  }, [text]);
  return shown;
}
function Rail({ at }) {
  const steps = railSteps(at);
  const here = steps.findIndex(([id]) => id === at);
  return (0, import_react.createElement)(
    "ol",
    { className: "oai-rail", "aria-label": "Setup steps" },
    steps.map(([id, label], index) => (0, import_react.createElement)("li", {
      key: id,
      className: index < here ? "oai-done" : index === here ? "oai-on" : "",
      "aria-current": index === here ? "step" : void 0
    }, label))
  );
}
function Stage({ title, speech, at, glitching, children }) {
  const titleRef = (0, import_react.useRef)(null);
  (0, import_react.useEffect)(() => {
    const root = document.getElementById("root");
    if (root === null) return void 0;
    const previous = root.inert;
    root.inert = true;
    return () => {
      root.inert = previous;
    };
  }, []);
  (0, import_react.useEffect)(() => {
    titleRef.current?.focus();
  }, [title]);
  const shown = useTypewriter(speech);
  return (0, import_react_dom.createPortal)((0, import_react.createElement)(
    "div",
    { className: "oai-overlay", role: "dialog", "aria-modal": "true", "aria-labelledby": "oai-title" },
    (0, import_react.createElement)(
      "div",
      { className: `oai-stage${glitching ? " oai-glitch" : ""}` },
      (0, import_react.createElement)("div", { dangerouslySetInnerHTML: { __html: OCTOPUS_SVG } }),
      (0, import_react.createElement)(
        "div",
        { className: "oai-bubble" },
        (0, import_react.createElement)("span", { className: "oai-hidden", role: "status" }, speech),
        (0, import_react.createElement)("span", { "aria-hidden": "true" }, shown, shown.length < speech.length ? (0, import_react.createElement)("span", { className: "oai-caret" }) : null)
      ),
      (0, import_react.createElement)(Rail, { at }),
      (0, import_react.createElement)(
        "main",
        { className: "oai-card" },
        (0, import_react.createElement)("div", { className: "oai-mark", "aria-hidden": "true" }, "OMNI"),
        (0, import_react.createElement)("h1", { id: "oai-title", ref: titleRef, tabIndex: -1 }, title),
        children
      )
    )
  ), document.body);
}

// src/client/welcome.js
var import_react2 = require("react");
function WelcomeStep(props) {
  const state = useGate(props);
  const finish2 = useFinish(props);
  const [glitching, glitch] = useGlitch();
  (0, import_react2.useEffect)(() => {
    if (state) glitch();
  }, [state, glitch]);
  if (!state) return null;
  return (0, import_react2.createElement)(
    Stage,
    {
      title: "Welcome to Omni",
      speech: "Hi! I'm Omni. Every chat, every channel, one place. Let's get you set up.",
      at: "omni-welcome",
      glitching
    },
    (0, import_react2.createElement)("p", null, railSteps("omni-welcome").some(([id]) => id === "omni-connect") ? "Two quick steps: connect your Omni, so I can see your channels, and connect an AI, so I can think." : "One quick step: connect an AI, so I can think."),
    (0, import_react2.createElement)("button", { type: "button", className: "oai-primary", onClick: () => finish2() }, "Let's go")
  );
}

// src/client/subscriptions.js
var import_react3 = require("react");
var BASE = "dsh-subscriptions";
var SUBSCRIPTION_TILES = [
  { id: "grok", provider: "grok", name: "Grok", note: "SuperGrok or X Premium", kind: "device" },
  { id: "perplexity", provider: "perplexity", name: "Perplexity", note: "Perplexity Pro", kind: "browser" },
  { id: "jetbrains", provider: "jetbrains", name: "JetBrains AI", note: "Your JetBrains AI plan", kind: "browser" },
  { id: "cursor", provider: "cursor", name: "Cursor", note: "Your Cursor plan", kind: "token", where: "https://cursor.com/settings", what: "Cursor session token" },
  { id: "kiro", provider: "kiro", name: "Kiro", note: "AWS Kiro", kind: "token", where: "https://kiro.dev", what: "Kiro token" },
  { id: "glm", provider: "glm", name: "Zhipu GLM", note: "GLM coding plan", kind: "token", where: "https://bigmodel.cn/usercenter/proj-mgmt/apikeys", what: "GLM API key" },
  { id: "qwen", provider: "qwen", name: "Qwen", note: "Alibaba Bailian", kind: "token", where: "https://bailian.console.aliyun.com/", what: "DashScope API key" },
  { id: "cody", provider: "cody", name: "Sourcegraph Cody", note: "Cody Pro", kind: "token", where: "https://sourcegraph.com/user/settings/tokens", what: "Sourcegraph access token" },
  { id: "replit", provider: "replit", name: "Replit", note: "Replit Core", kind: "token", where: "https://replit.com/account", what: "Replit token" }
];
async function request(path, init) {
  let response;
  try {
    response = await fetch(`${BASE}/${path}`, { credentials: "same-origin", ...init });
  } catch {
    throw new Error("Could not reach the subscriptions plugin.");
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok === false) throw new Error(body?.error?.message ?? `HTTP ${response.status}`);
  return body;
}
var post = (path, payload) => request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
async function subscriptionAccounts() {
  try {
    return (await request("config")).accounts ?? [];
  } catch {
    return null;
  }
}
function nextIndex(accounts, provider) {
  const own = (accounts ?? []).filter((account) => account.provider === provider);
  const free = own.find((account) => !account.configured);
  if (free) return free.index;
  return own.reduce((top, account) => Math.max(top, account.index), 0) + 1;
}
var signedInCount = (accounts, provider) => (accounts ?? []).filter((account) => account.provider === provider && account.configured).length;
function SubscriptionSignIn({ tile, onBack, onSaved, glitch }) {
  const [step, setStep] = (0, import_react3.useState)(null);
  const [problem, setProblem] = (0, import_react3.useState)(null);
  const [value, setValue] = (0, import_react3.useState)("");
  const [busy, setBusy] = (0, import_react3.useState)(false);
  const [index, setIndex] = (0, import_react3.useState)(null);
  (0, import_react3.useEffect)(() => {
    let live = true;
    let timer = 0;
    const done = () => {
      if (!live) return;
      glitch();
      onSaved({ name: tile.name });
    };
    const start = async () => {
      try {
        const slot = nextIndex(await subscriptionAccounts(), tile.provider);
        if (!live) return;
        setIndex(slot);
        if (tile.kind === "device") {
          const device = await post("oauth/device/start", { provider: tile.provider, index: slot });
          if (!live) return;
          setStep({ code: device.userCode, url: device.authUrl });
          const poll = async () => {
            try {
              const out = await post("oauth/device/poll", { state: device.state });
              if (out.status === "authorized") return done();
              if (live) timer = setTimeout(poll, Math.max(device.intervalMs ?? 5e3, 2e3));
            } catch (error) {
              if (live) setProblem(error.message);
            }
          };
          timer = setTimeout(poll, Math.max(device.intervalMs ?? 5e3, 2e3));
        } else if (tile.kind === "browser") {
          const started = await request(`oauth/start?provider=${encodeURIComponent(tile.provider)}&index=${slot}`);
          if (!live) return;
          setStep({ url: started.url, state: started.state, autoCatch: started.autoCatch });
          const watch = async () => {
            const accounts = await subscriptionAccounts();
            if (accounts?.some((account) => account.provider === tile.provider && account.index === slot && account.configured)) return done();
            if (live) timer = setTimeout(watch, 2e3);
          };
          timer = setTimeout(watch, 2e3);
        } else setStep({ url: tile.where });
      } catch (error) {
        if (live) setProblem(error.message);
      }
    };
    start();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [tile.provider]);
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      if (tile.kind === "token") await post("import-token", { provider: tile.provider, index, apiKey: value.trim() });
      else {
        const pasted = value.trim();
        await post("oauth/complete", { provider: tile.provider, index, state: step.state, .../^https?:\/\//i.test(pasted) ? { url: pasted } : { code: pasted } });
      }
      setValue("");
      glitch();
      onSaved({ name: tile.name });
    } catch (error) {
      setProblem(error.message);
      setBusy(false);
    }
  };
  return (0, import_react3.createElement)(
    "div",
    { className: "oai-signin" },
    !step && !problem ? (0, import_react3.createElement)("p", { className: "oai-muted" }, `Starting the ${tile.name} sign-in…`) : null,
    step?.code ? (0, import_react3.createElement)("p", null, `Open ${tile.name}, sign in, and enter this code:`) : null,
    step?.code ? (0, import_react3.createElement)("div", { className: "oai-code" }, (0, import_react3.createElement)("code", null, step.code)) : null,
    step?.url && tile.kind !== "token" ? (0, import_react3.createElement)("a", { className: "oai-primary oai-button", href: step.url, target: "_blank", rel: "noreferrer" }, `Open ${tile.name} to sign in`) : null,
    tile.kind === "device" && step ? (0, import_react3.createElement)("p", { className: "oai-muted oai-waiting" }, "Waiting for you to finish signing in…") : null,
    tile.kind === "browser" && step ? (0, import_react3.createElement)("p", { className: "oai-muted" }, step.autoCatch ? "Sign in on their page; this finishes on its own. If it ends on a page that does not load, paste its address here." : "Sign in on their page, then paste the address it ends on here.") : null,
    tile.kind === "token" && step ? (0, import_react3.createElement)("p", null, `Copy your ${tile.what} from `, (0, import_react3.createElement)("a", { className: "oai-link", href: tile.where, target: "_blank", rel: "noreferrer" }, tile.name), " and paste it here. It stays in DSH's credential store on this computer.") : null,
    step && tile.kind !== "device" ? (0, import_react3.createElement)(
      "form",
      { onSubmit: submit },
      (0, import_react3.createElement)("label", { htmlFor: "oai-sub-value" }, tile.kind === "token" ? tile.what : "The address you landed on"),
      (0, import_react3.createElement)("input", { id: "oai-sub-value", type: tile.kind === "token" ? "password" : "text", required: true, autoComplete: "off", spellCheck: false, value, onChange: (e) => setValue(e.target.value) }),
      (0, import_react3.createElement)("button", { type: "submit", className: tile.kind === "token" ? "oai-primary" : "", disabled: busy }, busy ? "Connecting…" : "Connect")
    ) : null,
    problem ? (0, import_react3.createElement)("p", { className: "oai-error", role: "alert" }, problem) : null,
    (0, import_react3.createElement)("button", { type: "button", className: "oai-quiet", onClick: onBack }, "Back")
  );
}

// src/client/connect-ai.js
var import_react4 = require("react");
var VENDOR_TERMS = "Personal use under the vendor's terms";
var GROUPS = [
  {
    title: "Sign in with a plan you have",
    terms: VENDOR_TERMS,
    tiles: [
      { id: "codex", provider: "openai-codex", name: "ChatGPT", note: "Plus, Pro or Team, through Codex", signin: true },
      { id: "claude", name: "Claude", note: "Pro or Max, through your Claude Code", claudeCode: true },
      { id: "kimi", provider: "kimi-coding", name: "Kimi", note: "Kimi Code", signin: true },
      { id: "copilot", provider: "github-copilot", name: "GitHub Copilot", note: "Your Copilot plan", signin: true }
    ]
  },
  {
    title: "With an API key",
    tiles: [
      { id: "deepseek", provider: "deepseek", name: "DeepSeek", note: "A DeepSeek API key", key: "https://platform.deepseek.com/api_keys" },
      { id: "openai", provider: "openai", name: "OpenAI", note: "An OpenAI API key", key: "https://platform.openai.com/api-keys" },
      { id: "anthropic", provider: "anthropic", name: "Anthropic", note: "An Anthropic API key", key: "https://console.anthropic.com/settings/keys" },
      { id: "openrouter", provider: "openrouter", name: "OpenRouter", note: "Hundreds of models, one key", key: "https://openrouter.ai/keys" },
      { id: "zai", provider: "zai", name: "Z.ai", note: "GLM models", key: "https://z.ai/manage-apikey/apikey-list" },
      { id: "moonshot", provider: "moonshotai", name: "Moonshot", note: "Kimi models by API key", key: "https://platform.moonshot.ai/console/api-keys" },
      { id: "opencode", provider: "opencode", name: "OpenCode", note: "An OpenCode Zen key", key: "https://opencode.ai/zen" }
    ]
  },
  {
    title: "Something else",
    tiles: [
      { id: "cliproxy", name: "Your own gateway", note: "CLIProxyAPI or any OpenAI-compatible server", form: true },
      { id: "api-key", name: "Another provider", note: "Every provider DSH knows, in Settings", section: "models" }
    ]
  }
];
var SUBSCRIPTIONS_GROUP = { title: "More subscriptions", terms: VENDOR_TERMS, tiles: SUBSCRIPTION_TILES.map((tile) => ({ ...tile, subscription: true })) };
function connectionsOf(tile, status, accounts) {
  if (tile.subscription) return signedInCount(accounts, tile.provider);
  if (tile.claudeCode) return status?.claudeCode?.loggedIn ? 1 : 0;
  const own = status?.[tile.provider];
  if (tile.signin) return own?.signedIn ? 1 : 0;
  if (tile.key) return own?.key ? 1 : 0;
  return 0;
}
function Tiles({ onTile, status, accounts }) {
  const groups = accounts ? [GROUPS[0], SUBSCRIPTIONS_GROUP, ...GROUPS.slice(1)] : GROUPS;
  return groups.map((group) => (0, import_react4.createElement)(
    "section",
    { key: group.title, className: "oai-group", "aria-label": group.title },
    (0, import_react4.createElement)("h2", null, group.title),
    group.terms ? (0, import_react4.createElement)("p", { className: "oai-terms oai-muted" }, group.terms) : null,
    (0, import_react4.createElement)("div", { className: "oai-tiles" }, group.tiles.map((tile) => {
      const count = connectionsOf(tile, status, accounts);
      return (0, import_react4.createElement)(
        "button",
        {
          key: tile.id,
          type: "button",
          className: count > 0 ? "oai-tile oai-tile-on" : "oai-tile",
          onClick: () => onTile(tile)
        },
        (0, import_react4.createElement)("strong", null, tile.name),
        (0, import_react4.createElement)("span", null, tile.note),
        count > 0 ? (0, import_react4.createElement)("em", { className: "oai-on" }, count === 1 ? "Connected" : `${count} accounts`) : null
      );
    }))
  ));
}
function KeyForm({ tile, onBack, onSaved, glitch }) {
  const [apiKey, setApiKey] = (0, import_react4.useState)("");
  const [busy, setBusy] = (0, import_react4.useState)(false);
  const [problem, setProblem] = (0, import_react4.useState)(null);
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      await call("provider-key", { provider: tile.provider, apiKey });
      setApiKey("");
      glitch();
      onSaved({ name: tile.name });
    } catch (error) {
      setProblem(error.message);
      setBusy(false);
    }
  };
  return (0, import_react4.createElement)(
    "form",
    { onSubmit: submit },
    (0, import_react4.createElement)("p", null, "The key stays in DSH's own credential store on this computer. ", (0, import_react4.createElement)("a", { className: "oai-link", href: tile.key, target: "_blank", rel: "noreferrer" }, `Get a ${tile.name} key`), "."),
    (0, import_react4.createElement)("label", { htmlFor: "oai-key" }, `${tile.name} API key`),
    (0, import_react4.createElement)("input", { id: "oai-key", type: "password", required: true, autoComplete: "off", spellCheck: false, autoFocus: true, value: apiKey, onChange: (e) => setApiKey(e.target.value) }),
    problem ? (0, import_react4.createElement)("p", { className: "oai-error", role: "alert", style: { marginTop: "10px" } }, problem) : null,
    (0, import_react4.createElement)("button", { type: "submit", className: "oai-primary", disabled: busy }, busy ? "Connecting…" : "Connect"),
    (0, import_react4.createElement)("button", { type: "button", className: "oai-quiet", disabled: busy, onClick: onBack }, "Back")
  );
}
var CLAUDE_INSTALL = "curl -fsSL https://claude.ai/install.sh | bash";
var CLAUDE_LOGIN = "claude auth login";
function Copyable({ text }) {
  const [copied, setCopied] = (0, import_react4.useState)(false);
  return (0, import_react4.createElement)(
    "div",
    { className: "oai-code oai-command" },
    (0, import_react4.createElement)("code", null, text),
    (0, import_react4.createElement)("button", { type: "button", className: "oai-ghost", onClick: () => navigator.clipboard?.writeText(text).then(() => setCopied(true)) }, copied ? "Copied" : "Copy")
  );
}
function ClaudeCode({ onBack, onSaved, glitch }) {
  const [check, setCheck] = (0, import_react4.useState)(null);
  const [problem, setProblem] = (0, import_react4.useState)(null);
  (0, import_react4.useEffect)(() => {
    let live = true;
    let timer = 0;
    const poll = async () => {
      try {
        const next = await call("claude-code");
        if (!live) return;
        setCheck(next);
        setProblem(null);
        if (next.plugin && next.loggedIn && next.reachable !== false) {
          glitch();
          onSaved({ name: "Claude", detail: [next.email, next.plan ? `${next.plan[0].toUpperCase()}${next.plan.slice(1)} plan` : null].filter(Boolean).join(" · ") });
          return;
        }
      } catch (error) {
        if (live) setProblem(error.message);
      }
      if (live) timer = setTimeout(poll, 3e3);
    };
    poll();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, []);
  return (0, import_react4.createElement)(
    "div",
    { className: "oai-signin" },
    !check && !problem ? (0, import_react4.createElement)("p", { className: "oai-muted" }, "Looking for Claude Code on this computer…") : null,
    check && !check.plugin ? (0, import_react4.createElement)("p", null, "Claude runs through the Oh My Claude plugin, which this DSH does not have. Add it from Settings → Plugins.") : null,
    check?.plugin && !check.installed ? [
      (0, import_react4.createElement)("p", { key: "p" }, "Install Claude Code, Anthropic's own app. In a terminal:"),
      (0, import_react4.createElement)(Copyable, { key: "c", text: CLAUDE_INSTALL }),
      (0, import_react4.createElement)("p", { key: "m", className: "oai-muted" }, "Or follow ", (0, import_react4.createElement)("a", { className: "oai-link", href: "https://code.claude.com/docs/en/setup", target: "_blank", rel: "noreferrer" }, "Anthropic's setup guide"), ".")
    ] : null,
    check?.plugin && check.installed && check.loggedIn && check.reachable === false ? (0, import_react4.createElement)("p", { className: "oai-error" }, `Claude Code is signed in, at ${check.path}, but this app cannot start it from there. Restart the app to pick it up.`) : null,
    check?.plugin && check.installed && !check.loggedIn ? [
      (0, import_react4.createElement)("p", { key: "p" }, "Claude Code is here. Sign it in with your Claude account, in a terminal:"),
      (0, import_react4.createElement)(Copyable, { key: "c", text: CLAUDE_LOGIN })
    ] : null,
    check?.plugin && !check.loggedIn ? (0, import_react4.createElement)("p", { className: "oai-muted oai-waiting" }, "I'll notice as soon as it's done.") : null,
    problem ? (0, import_react4.createElement)("p", { className: "oai-error", role: "alert" }, problem) : null,
    (0, import_react4.createElement)("button", { type: "button", className: "oai-quiet", onClick: onBack }, "Back")
  );
}
function SignIn({ tile, onBack, onSaved, glitch }) {
  const [attempt, setAttempt] = (0, import_react4.useState)(null);
  const [problem, setProblem] = (0, import_react4.useState)(null);
  const [answer, setAnswer] = (0, import_react4.useState)("");
  const [copied, setCopied] = (0, import_react4.useState)(false);
  (0, import_react4.useEffect)(() => {
    let live = true;
    let timer = 0;
    const poll = async (first) => {
      try {
        const next = await call(first ? "signin-start" : "signin-status", { provider: tile.provider });
        if (!live) return;
        setAttempt(next);
        if (next.status === "authorized") {
          glitch();
          onSaved({ name: tile.name });
          return;
        }
        if (next.status === "running" || next.status === "none") timer = setTimeout(() => poll(false), 1e3);
      } catch (error) {
        if (live) setProblem(error.message);
      }
    };
    poll(true);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [tile.provider]);
  const reply = async (value) => {
    setProblem(null);
    try {
      setAttempt(await call("signin-answer", { provider: tile.provider, promptId: attempt.prompt.id, value }));
      setAnswer("");
    } catch (error) {
      setProblem(error.message);
    }
  };
  const cancel = async () => {
    await call("signin-cancel", { provider: tile.provider }).catch(() => {
    });
    onBack();
  };
  const notice = attempt?.notice;
  const prompt = attempt?.prompt;
  const ended = attempt && ["cancelled", "failed"].includes(attempt.status);
  return (0, import_react4.createElement)(
    "div",
    { className: "oai-signin" },
    !attempt && !problem ? (0, import_react4.createElement)("p", { className: "oai-muted" }, `Starting the ${tile.name} sign-in…`) : null,
    notice?.message ? (0, import_react4.createElement)("p", null, notice.message) : null,
    notice?.code ? (0, import_react4.createElement)(
      "div",
      { className: "oai-code" },
      (0, import_react4.createElement)("code", null, notice.code),
      (0, import_react4.createElement)("button", { type: "button", className: "oai-ghost", onClick: () => navigator.clipboard?.writeText(notice.code).then(() => setCopied(true)) }, copied ? "Copied" : "Copy code")
    ) : null,
    notice?.url ? (0, import_react4.createElement)("a", { className: "oai-primary oai-button", href: notice.url, target: "_blank", rel: "noreferrer" }, `Open ${tile.name} to sign in`) : null,
    prompt?.kind === "select" ? (0, import_react4.createElement)(
      "div",
      { className: "oai-choices", role: "group", "aria-label": prompt.message },
      (0, import_react4.createElement)("p", null, prompt.message),
      prompt.options.map((option) => (0, import_react4.createElement)("button", { key: option.id, type: "button", onClick: () => reply(option.id) }, (0, import_react4.createElement)("strong", null, option.label), option.description ? (0, import_react4.createElement)("span", null, option.description) : null))
    ) : null,
    prompt && prompt.kind !== "select" ? (0, import_react4.createElement)(
      "form",
      { onSubmit: (event) => {
        event.preventDefault();
        reply(answer);
      } },
      (0, import_react4.createElement)("label", { htmlFor: "oai-answer" }, prompt.message),
      (0, import_react4.createElement)("input", { id: "oai-answer", type: prompt.kind === "secret" ? "password" : "text", required: true, autoComplete: "off", spellCheck: false, autoFocus: true, placeholder: prompt.placeholder, value: answer, onChange: (e) => setAnswer(e.target.value) }),
      (0, import_react4.createElement)("button", { type: "submit", className: "oai-primary" }, "Continue")
    ) : null,
    attempt?.status === "running" && !prompt ? (0, import_react4.createElement)("p", { className: "oai-muted oai-waiting" }, "Waiting for you to finish signing in…") : null,
    ended ? (0, import_react4.createElement)("p", { className: "oai-error", role: "alert" }, attempt.status === "failed" ? `The sign-in did not finish: ${attempt.error}` : "The sign-in was cancelled.") : null,
    problem ? (0, import_react4.createElement)("p", { className: "oai-error", role: "alert" }, problem) : null,
    (0, import_react4.createElement)("button", { type: "button", className: "oai-quiet", onClick: ended || problem ? onBack : cancel }, ended || problem ? "Back" : "Cancel")
  );
}
function CliproxyForm({ onBack, onSaved, glitch }) {
  const [baseURL, setBaseURL] = (0, import_react4.useState)("");
  const [apiKey, setApiKey] = (0, import_react4.useState)("");
  const [busy, setBusy] = (0, import_react4.useState)(false);
  const [problem, setProblem] = (0, import_react4.useState)(null);
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      const saved = await call("cliproxy", { baseURL, apiKey });
      setApiKey("");
      glitch();
      onSaved(saved);
    } catch (error) {
      setProblem(error.message);
      setBusy(false);
    }
  };
  return (0, import_react4.createElement)(
    "form",
    { onSubmit: submit },
    (0, import_react4.createElement)("p", null, "Omni lists the gateway's models with your key, keeps the key in DSH's credential store, and adds the models to the model picker."),
    (0, import_react4.createElement)("label", { htmlFor: "oai-cliproxy-url" }, "Gateway address"),
    (0, import_react4.createElement)("input", { id: "oai-cliproxy-url", type: "url", required: true, placeholder: "http://localhost:8317/v1", autoComplete: "off", value: baseURL, onChange: (e) => setBaseURL(e.target.value) }),
    (0, import_react4.createElement)("label", { htmlFor: "oai-cliproxy-key" }, "API key"),
    (0, import_react4.createElement)("input", { id: "oai-cliproxy-key", type: "password", required: true, autoComplete: "off", spellCheck: false, value: apiKey, onChange: (e) => setApiKey(e.target.value) }),
    problem ? (0, import_react4.createElement)("p", { className: "oai-error", role: "alert", style: { marginTop: "10px" } }, problem) : null,
    (0, import_react4.createElement)("button", { type: "submit", className: "oai-primary", disabled: busy }, busy ? "Connecting…" : "Connect"),
    (0, import_react4.createElement)("button", { type: "button", className: "oai-quiet", disabled: busy, onClick: onBack }, "Back")
  );
}
function ConnectAiStep(props) {
  const state = useGate(props);
  const finish2 = useFinish(props);
  const [glitching, glitch] = useGlitch();
  const [view, setView] = (0, import_react4.useState)("tiles");
  const [saved, setSaved] = (0, import_react4.useState)(null);
  const [status, setStatus] = (0, import_react4.useState)(null);
  const [accounts, setAccounts] = (0, import_react4.useState)(null);
  (0, import_react4.useEffect)(() => {
    if (view !== "tiles") return;
    Promise.all([call("providers").catch(() => ({})), call("claude-code").catch(() => null)]).then(([providers, claudeCode]) => setStatus({ ...providers, claudeCode }));
    subscriptionAccounts().then(setAccounts);
  }, [view]);
  (0, import_react4.useEffect)(() => {
    if (state) glitch();
  }, [state, glitch]);
  if (!state) return null;
  if (view?.claudeCode) {
    return (0, import_react4.createElement)(
      Stage,
      { title: "Claude, through your Claude Code", speech: "I'll think with your own Claude Code: your login, your plan.", at: "omni-connect-ai", glitching },
      (0, import_react4.createElement)(ClaudeCode, { onBack: () => setView("tiles"), onSaved: (value) => {
        setSaved(value);
        setView("saved");
      }, glitch })
    );
  }
  if (view?.subscription) {
    return (0, import_react4.createElement)(
      Stage,
      { title: `Connect ${view.subscription.name}`, speech: "Sign in with your plan; I'll add it to what you already have.", at: "omni-connect-ai", glitching },
      (0, import_react4.createElement)(SubscriptionSignIn, { tile: view.subscription, onBack: () => setView("tiles"), onSaved: (value) => {
        setSaved(value);
        setView("saved");
      }, glitch })
    );
  }
  if (view?.signin) {
    return (0, import_react4.createElement)(
      Stage,
      { title: `Sign in to ${view.signin.name}`, speech: "Sign in on their page; I'll wait right here.", at: "omni-connect-ai", glitching },
      (0, import_react4.createElement)(SignIn, { tile: view.signin, onBack: () => setView("tiles"), onSaved: (value) => {
        setSaved(value);
        setView("saved");
      }, glitch })
    );
  }
  if (view?.key) {
    return (0, import_react4.createElement)(
      Stage,
      { title: `Connect ${view.key.name}`, speech: "Paste your key and I'm ready to think.", at: "omni-connect-ai", glitching },
      (0, import_react4.createElement)(KeyForm, { tile: view.key, onBack: () => setView("tiles"), onSaved: (value) => {
        setSaved(value);
        setView("saved");
      }, glitch })
    );
  }
  if (view === "cliproxy") {
    return (0, import_react4.createElement)(
      Stage,
      { title: "Connect CLIProxyAPI", speech: "Point me at your gateway. Its key stays in DSH, never in a settings file.", at: "omni-connect-ai", glitching },
      (0, import_react4.createElement)(CliproxyForm, { onBack: () => setView("tiles"), onSaved: (value) => {
        setSaved(value);
        setView("saved");
      }, glitch })
    );
  }
  if (view === "saved" && saved?.models) {
    const count = saved.models.length;
    return (0, import_react4.createElement)(
      Stage,
      { title: "Gateway connected", speech: `Connected! ${count} ${count === 1 ? "model" : "models"} from your gateway, ready in the model picker.`, at: "omni-connect-ai", glitching },
      (0, import_react4.createElement)("div", { className: "oai-models", "aria-label": "Models" }, saved.models.map((id) => (0, import_react4.createElement)("div", { key: id }, id))),
      (0, import_react4.createElement)("button", { type: "button", className: "oai-primary", onClick: () => finish2() }, "Done")
    );
  }
  if (view === "saved") {
    return (0, import_react4.createElement)(
      Stage,
      { title: `${saved?.name ?? "AI"} connected`, speech: `Connected! ${saved?.name ?? "Its"} models join the others in the model picker.`, at: "omni-connect-ai", glitching },
      saved?.detail ? (0, import_react4.createElement)("p", { className: "oai-muted" }, saved.detail) : null,
      (0, import_react4.createElement)("button", { type: "button", className: "oai-primary", onClick: () => finish2() }, "Done"),
      (0, import_react4.createElement)("button", { type: "button", onClick: () => setView("tiles") }, "Connect another")
    );
  }
  const connected = state.aiConnected === true;
  return (0, import_react4.createElement)(
    Stage,
    {
      title: "Connect an AI",
      speech: connected ? "You already have an AI connected. Add another, or carry on." : "Now give me a brain. Pick how you reach your AI; you can add more later.",
      at: "omni-connect-ai",
      glitching
    },
    (0, import_react4.createElement)(Tiles, { status, accounts, onTile: (tile) => tile.claudeCode ? setView({ claudeCode: true }) : tile.subscription ? setView({ subscription: tile }) : tile.form ? setView("cliproxy") : tile.signin ? setView({ signin: tile }) : tile.key ? setView({ key: tile }) : finish2(tile.section) }),
    (0, import_react4.createElement)("button", { type: "button", className: connected ? "oai-primary" : "oai-quiet", style: { marginTop: "16px" }, onClick: () => finish2() }, connected ? "Continue" : "Skip for now")
  );
}

// src/client/index.js
var STEPS = [
  { id: "omni-welcome", order: -300, component: WelcomeStep },
  { id: "omni-connect-ai", order: -200, component: ConnectAiStep }
];
var inject = ["slots"];
function installStyles() {
  const style = document.createElement("style");
  style.dataset.omniAi = "";
  style.textContent = STAGE_CSS;
  document.head.append(style);
  return () => style.remove();
}
function apply(ctx) {
  ctx.effect(installStyles, "omni-ai: stage styles");
  for (const step of STEPS) {
    ctx.effect(() => announceStep(step.id), `omni-ai: ${step.id} on the rail`);
    ctx.slots.inject("settings.onboarding", () => ctx.slots.register({ name: "settings.onboarding", id: step.id, order: step.order }, step.component));
  }
}
return Object.defineProperty({ ...module.exports }, Symbol.toStringTag, { value: 'Module' })
  },
})
