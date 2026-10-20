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
<defs><linearGradient id="oai-octo-skin" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3ee6d0"/><stop offset="1" stop-color="#0b8f8a"/></linearGradient></defs>
<path class="oai-ghost oai-cyan" d="${BODY}"/><path class="oai-ghost oai-magenta" d="${BODY}"/>
<path d="${BODY}" fill="url(#oai-octo-skin)"/><path d="${SHADE}" fill="#06706d" opacity=".55"/>
<path d="M30 22C36 14 44 11 50 11C40 14 33 20 30 28Z" fill="#fff" opacity=".45"/>
<g class="oai-eyes"><ellipse cx="40" cy="36" rx="6.5" ry="11" fill="#06121f"/><ellipse cx="60" cy="36" rx="6.5" ry="11" fill="#06121f"/>
<circle cx="42" cy="31" r="2.4" fill="#fff"/><circle cx="62" cy="31" r="2.4" fill="#fff"/></g>
<path d="M44 54Q50 59 56 54" stroke="#06121f" stroke-width="2.4" fill="none" stroke-linecap="round"/>
<ellipse cx="31" cy="50" rx="5" ry="2.8" fill="#ff7ab8" opacity=".5"/><ellipse cx="69" cy="50" rx="5" ry="2.8" fill="#ff7ab8" opacity=".5"/>
<g fill="none" stroke="#0b8f8a" stroke-width="3" stroke-linecap="round"><path d="M20 96Q13 99 12 92"/><path d="M80 96Q87 99 88 92"/></g>
</svg>`;
var STAGE_CSS = `
.oai-overlay{--oai-bg:#05070f;--oai-card:rgba(13,20,36,.8);--oai-ink:#eef3ff;--oai-ink2:#9fb0cc;--oai-line:rgba(120,160,220,.22);--oai-accent:#22d3c5;--oai-bad:#ff6b6b;
  position:fixed;inset:0;z-index:2000;overflow:auto;display:grid;place-items:center;padding:24px 16px;box-sizing:border-box;color-scheme:dark;color:var(--oai-ink);
  font:15px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
  background:radial-gradient(1200px 600px at 50% -10%,rgba(34,211,197,.18),transparent 60%),radial-gradient(900px 500px at 100% 110%,rgba(124,92,255,.18),transparent 60%),var(--oai-bg)}
.oai-overlay *{box-sizing:border-box}
.oai-overlay::before{content:"";position:fixed;inset:0;pointer-events:none;opacity:.55;
  background-image:radial-gradient(1px 1px at 12% 18%,#fff,transparent),radial-gradient(1px 1px at 72% 12%,#cde,transparent),radial-gradient(1.5px 1.5px at 38% 72%,#fff,transparent),radial-gradient(1px 1px at 86% 64%,#bcd,transparent),radial-gradient(1px 1px at 22% 88%,#fff,transparent),radial-gradient(1.5px 1.5px at 58% 40%,#def,transparent);
  animation:oai-twinkle 6s ease-in-out infinite alternate}
.oai-overlay::after{content:"";position:fixed;left:-50%;right:-50%;bottom:-30vh;height:60vh;pointer-events:none;opacity:.35;
  background-image:linear-gradient(rgba(34,211,197,.35) 1px,transparent 1px),linear-gradient(90deg,rgba(34,211,197,.35) 1px,transparent 1px);background-size:56px 56px;
  transform:perspective(420px) rotateX(62deg);mask-image:linear-gradient(to top,#000,transparent);animation:oai-grid 9s linear infinite}
@keyframes oai-twinkle{from{opacity:.35}to{opacity:.7}}
@keyframes oai-grid{from{background-position:0 0}to{background-position:0 56px}}
.oai-stage{position:relative;z-index:1;width:min(580px,100%);display:flex;flex-direction:column;align-items:center}
.oai-octo{width:124px;height:124px;filter:drop-shadow(0 12px 30px rgba(34,211,197,.35));animation:oai-float 4.5s ease-in-out infinite}
.oai-ghost{opacity:0}.oai-cyan{fill:#00f0ff}.oai-magenta{fill:#ff2bd6}
.oai-octo:hover .oai-cyan,.oai-glitch .oai-cyan{opacity:.55;transform:translate(-2.5px,0);animation:oai-glitch 2.4s steps(1) infinite}
.oai-octo:hover .oai-magenta,.oai-glitch .oai-magenta{opacity:.55;transform:translate(2.5px,0);animation:oai-glitch 2.4s steps(1) infinite reverse}
.oai-eyes{transform-origin:50px 36px;animation:oai-blink 5s infinite}
@keyframes oai-float{0%,100%{transform:translateY(0) rotate(-2deg)}50%{transform:translateY(-10px) rotate(2deg)}}
@keyframes oai-blink{0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(.1)}}
@keyframes oai-glitch{0%{clip-path:inset(0 0 70% 0)}25%{clip-path:inset(40% 0 30% 0)}50%{clip-path:inset(75% 0 0 0)}75%{clip-path:inset(10% 0 60% 0)}}
.oai-bubble{position:relative;margin:6px 0 18px;padding:10px 16px;border-radius:14px;background:rgba(34,211,197,.12);border:1px solid rgba(34,211,197,.35);color:#c9fff8;font:500 15px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;min-height:44px;max-width:100%}
.oai-bubble::before{content:"";position:absolute;top:-7px;left:50%;width:12px;height:12px;border-left:inherit;border-top:inherit;transform:translateX(-50%) rotate(45deg);background:#0e2a33}
.oai-caret{display:inline-block;width:.55em;height:1.05em;margin-left:2px;vertical-align:-2px;background:#7ff7ea;animation:oai-caret 1s steps(1) infinite}
@keyframes oai-caret{50%{opacity:0}}
.oai-hidden{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.oai-rail{display:flex;flex-wrap:wrap;justify-content:center;gap:8px;margin:0 0 14px;padding:0;list-style:none;font:600 11px/1 ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase;color:var(--oai-ink2)}
.oai-rail li{padding:6px 10px;border-radius:999px;border:1px solid var(--oai-line)}.oai-rail li.oai-on{color:#05070f;background:var(--oai-accent);border-color:var(--oai-accent)}.oai-rail li.oai-done{color:var(--oai-accent);border-color:rgba(34,211,197,.5)}
.oai-card{width:100%;background:var(--oai-card);border:1px solid var(--oai-line);border-radius:20px;padding:24px;backdrop-filter:blur(14px);box-shadow:0 30px 80px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,255,255,.04)}
.oai-card h1{font-size:21px;margin:0 0 6px;letter-spacing:-.01em;outline:none}.oai-card p{margin:0 0 14px;color:var(--oai-ink2)}
.oai-mark{font:700 12px/1 ui-monospace,monospace;letter-spacing:.32em;color:var(--oai-accent);margin-bottom:14px}
.oai-card button{display:block;width:100%;padding:12px 14px;margin:8px 0 0;border-radius:13px;border:1px solid var(--oai-line);background:rgba(255,255,255,.02);color:var(--oai-ink);font:inherit;font-weight:600;cursor:pointer;text-align:center;transition:transform .15s,box-shadow .15s,border-color .15s}
.oai-card button:hover:not(:disabled),.oai-card button:focus-visible{transform:translateY(-1px);border-color:rgba(34,211,197,.6);box-shadow:0 0 0 1px rgba(34,211,197,.25),0 8px 24px rgba(34,211,197,.15);outline:none}
.oai-card button.oai-primary{background:linear-gradient(135deg,var(--oai-accent),#14a8c7);border-color:transparent;color:#03141a}.oai-card button:disabled{opacity:.55;cursor:default}
.oai-card button.oai-quiet{background:none;border-color:transparent;color:var(--oai-ink2);font-weight:500}
.oai-group{margin:16px 0 0}.oai-group h2{margin:0 0 2px;font:600 11px/1.4 ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase;color:var(--oai-accent)}
.oai-group .oai-terms{margin:0 0 4px;font-size:12px}
.oai-tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}
.oai-card button.oai-tile{margin:4px 0 0;text-align:left;padding:10px 12px}.oai-tile strong{display:block}.oai-tile span{display:block;font-size:12px;font-weight:400;color:var(--oai-ink2)}
.oai-card label{display:block;margin:12px 0 4px;font-size:13px;color:var(--oai-ink2)}
.oai-card input{width:100%;padding:11px 12px;border-radius:12px;border:1px solid var(--oai-line);background:rgba(0,0,0,.25);color:var(--oai-ink);font:14px/1.3 ui-monospace,monospace}
.oai-card input:focus{outline:none;border-color:var(--oai-accent);box-shadow:0 0 0 3px rgba(34,211,197,.2)}
.oai-error{color:var(--oai-bad)!important}.oai-muted{font-size:13px}
.oai-models{margin:8px 0 0;padding:8px 12px;border-radius:10px;border:1px solid var(--oai-line);background:rgba(0,0,0,.3);font:12px/1.5 ui-monospace,monospace;color:#c9fff8;max-height:120px;overflow:auto}
@media (prefers-reduced-motion:reduce){.oai-overlay *,.oai-overlay::before,.oai-overlay::after{animation:none!important;transition:none!important}}
`;

// src/client/stage.js
var import_react = require("react");
var import_react_dom = require("react-dom");
var RAIL = ["Welcome", "Connect Omni", "Connect AI"];
var FLAG_OF = { "omni-welcome": "welcomeDone", "omni-connect-ai": "connectAiDone" };
var reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
async function gate({ stepId, explicit, complete }, request = call) {
  let state = {};
  try {
    state = await request("state") ?? {};
  } catch {
  }
  if (explicit !== true && state[FLAG_OF[stepId]] === true) {
    complete();
    return null;
  }
  return state;
}
async function finish({ stepId, complete }, request = call) {
  try {
    await request("done", { stepId });
  } catch {
  }
  complete();
}
async function finishInto(props, section, request = call) {
  await finish(props, request);
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
  return (0, import_react.createElement)(
    "ol",
    { className: "oai-rail", "aria-label": "Setup steps" },
    RAIL.map((label, index) => (0, import_react.createElement)("li", {
      key: label,
      className: index < at ? "oai-done" : index === at ? "oai-on" : "",
      "aria-current": index === at ? "step" : void 0
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
      at: 0,
      glitching
    },
    (0, import_react2.createElement)("p", null, "Two quick steps: connect your Omni, so I can see your channels, and connect an AI, so I can think."),
    (0, import_react2.createElement)("button", { type: "button", className: "oai-primary", onClick: () => finish2() }, "Let's go")
  );
}

// src/client/connect-ai.js
var import_react3 = require("react");
var VENDOR_TERMS = "Personal use under the vendor's terms";
var GROUPS = [
  {
    title: "With an API key",
    tiles: [
      { id: "deepseek", name: "DeepSeek", note: "Sign in to DeepSeek, or use its API key", section: "account" },
      { id: "zai", name: "Z.ai", note: "GLM models, with a Z.ai API key", section: "models" },
      { id: "opencode", name: "OpenCode", note: "With an OpenCode API key", section: "models" },
      { id: "api-key", name: "Any API key", note: "Any provider on DSH's Models page", section: "models" }
    ]
  },
  {
    title: "With a subscription sign-in",
    terms: VENDOR_TERMS,
    tiles: [
      { id: "codex", name: "Codex", note: VENDOR_TERMS, section: "models" },
      { id: "claude", name: "Claude", note: VENDOR_TERMS, section: "models" },
      { id: "kimi", name: "Kimi", note: VENDOR_TERMS, section: "models" }
    ]
  },
  {
    title: "Through your own gateway",
    tiles: [{ id: "cliproxy", name: "CLIProxyAPI", note: "An OpenAI-compatible gateway you run", form: true }]
  }
];
function Tiles({ onTile }) {
  return GROUPS.map((group) => (0, import_react3.createElement)(
    "section",
    { key: group.title, className: "oai-group", "aria-label": group.title },
    (0, import_react3.createElement)("h2", null, group.title),
    group.terms ? (0, import_react3.createElement)("p", { className: "oai-terms oai-muted" }, group.terms) : null,
    (0, import_react3.createElement)("div", { className: "oai-tiles" }, group.tiles.map((tile) => (0, import_react3.createElement)("button", {
      key: tile.id,
      type: "button",
      className: "oai-tile",
      onClick: () => onTile(tile)
    }, (0, import_react3.createElement)("strong", null, tile.name), (0, import_react3.createElement)("span", null, tile.note))))
  ));
}
function CliproxyForm({ onBack, onSaved, glitch }) {
  const [baseURL, setBaseURL] = (0, import_react3.useState)("");
  const [apiKey, setApiKey] = (0, import_react3.useState)("");
  const [busy, setBusy] = (0, import_react3.useState)(false);
  const [problem, setProblem] = (0, import_react3.useState)(null);
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
  return (0, import_react3.createElement)(
    "form",
    { onSubmit: submit },
    (0, import_react3.createElement)("p", null, "Omni lists the gateway's models with your key, keeps the key in DSH's credential store, and adds the models to the model picker."),
    (0, import_react3.createElement)("label", { htmlFor: "oai-cliproxy-url" }, "Gateway address"),
    (0, import_react3.createElement)("input", { id: "oai-cliproxy-url", type: "url", required: true, placeholder: "http://localhost:8317/v1", autoComplete: "off", value: baseURL, onChange: (e) => setBaseURL(e.target.value) }),
    (0, import_react3.createElement)("label", { htmlFor: "oai-cliproxy-key" }, "API key"),
    (0, import_react3.createElement)("input", { id: "oai-cliproxy-key", type: "password", required: true, autoComplete: "off", spellCheck: false, value: apiKey, onChange: (e) => setApiKey(e.target.value) }),
    problem ? (0, import_react3.createElement)("p", { className: "oai-error", role: "alert", style: { marginTop: "10px" } }, problem) : null,
    (0, import_react3.createElement)("button", { type: "submit", className: "oai-primary", disabled: busy }, busy ? "Connecting…" : "Connect"),
    (0, import_react3.createElement)("button", { type: "button", className: "oai-quiet", disabled: busy, onClick: onBack }, "Back")
  );
}
function ConnectAiStep(props) {
  const state = useGate(props);
  const finish2 = useFinish(props);
  const [glitching, glitch] = useGlitch();
  const [view, setView] = (0, import_react3.useState)("tiles");
  const [saved, setSaved] = (0, import_react3.useState)(null);
  (0, import_react3.useEffect)(() => {
    if (state) glitch();
  }, [state, glitch]);
  if (!state) return null;
  if (view === "cliproxy") {
    return (0, import_react3.createElement)(
      Stage,
      { title: "Connect CLIProxyAPI", speech: "Point me at your gateway. Its key stays in DSH, never in a settings file.", at: 2, glitching },
      (0, import_react3.createElement)(CliproxyForm, { onBack: () => setView("tiles"), onSaved: (value) => {
        setSaved(value);
        setView("saved");
      }, glitch })
    );
  }
  if (view === "saved") {
    const count = saved?.models?.length ?? 0;
    return (0, import_react3.createElement)(
      Stage,
      { title: "Gateway connected", speech: `Connected! ${count} ${count === 1 ? "model" : "models"} from your gateway, ready in the model picker.`, at: 2, glitching },
      (0, import_react3.createElement)("div", { className: "oai-models", "aria-label": "Models" }, (saved?.models ?? []).map((id) => (0, import_react3.createElement)("div", { key: id }, id))),
      (0, import_react3.createElement)("button", { type: "button", className: "oai-primary", onClick: () => finish2() }, "Done")
    );
  }
  const connected = state.aiConnected === true;
  return (0, import_react3.createElement)(
    Stage,
    {
      title: "Connect an AI",
      speech: connected ? "You already have an AI connected. Add another, or carry on." : "Now give me a brain. Pick how you reach your AI; you can add more later.",
      at: 2,
      glitching
    },
    (0, import_react3.createElement)(Tiles, { onTile: (tile) => tile.form ? setView("cliproxy") : finish2(tile.section) }),
    (0, import_react3.createElement)("button", { type: "button", className: connected ? "oai-primary" : "oai-quiet", style: { marginTop: "16px" }, onClick: () => finish2() }, connected ? "Continue" : "Skip for now")
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
    ctx.slots.inject("settings.onboarding", () => ctx.slots.register({ name: "settings.onboarding", id: step.id, order: step.order }, step.component));
  }
}
return Object.defineProperty({ ...module.exports }, Symbol.toStringTag, { value: 'Module' })
  },
})
