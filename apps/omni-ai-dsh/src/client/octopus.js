// The Omni octopus (apps/omni-ui-dsh/src/client/characters.js), as the claim page draws it
// (packages/api/src/login/pages.ts), and the sci-fi stage it stands on. Copied, not
// imported: this plugin installs on its own. Every class is prefixed oai- so nothing
// here restyles DSH.
const BODY = 'M50 6C75 6 87 24 87 46C87 60 82 68 80 72C84 82 84 92 80 96C76 98 72 92 70 84C68 92 66 98 61 96C57 94 56 84 54 78C52 80 48 80 46 78C44 84 43 94 39 96C34 98 32 92 30 84C28 92 24 98 20 96C16 92 16 82 20 72C18 68 13 60 13 46C13 24 25 6 50 6Z'
const SHADE = 'M87 46C87 60 82 68 80 72C84 82 84 92 80 96C76 98 72 92 70 84C68 92 66 98 61 96C57 94 56 84 54 78C62 76 70 66 75 56C80 48 80 36 75 26C82 32 87 38 87 46Z'

export const OCTOPUS_SVG = `<svg class="oai-octo" viewBox="0 0 100 100" aria-hidden="true">
<defs><linearGradient id="oai-octo-skin" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8ff4ff"/><stop offset=".5" stop-color="#22d3ee"/><stop offset="1" stop-color="#0e7490"/></linearGradient></defs>
<path class="oai-ghost oai-cyan" d="${BODY}"/><path class="oai-ghost oai-magenta" d="${BODY}"/>
<path d="${BODY}" fill="url(#oai-octo-skin)"/><path d="${SHADE}" fill="#0b4f6c" opacity=".5"/>
<path d="M30 22C36 14 44 11 50 11C40 14 33 20 30 28Z" fill="#fff" opacity=".45"/>
<g class="oai-eyes"><ellipse cx="40" cy="36" rx="6.5" ry="11" fill="#06121f"/><ellipse cx="60" cy="36" rx="6.5" ry="11" fill="#06121f"/>
<circle cx="42" cy="31" r="2.4" fill="#fff"/><circle cx="62" cy="31" r="2.4" fill="#fff"/></g>
<path d="M44 54Q50 59 56 54" stroke="#06121f" stroke-width="2.4" fill="none" stroke-linecap="round"/>
<ellipse cx="31" cy="50" rx="5" ry="2.8" fill="#ff5fb8" opacity=".6"/><ellipse cx="69" cy="50" rx="5" ry="2.8" fill="#ff5fb8" opacity=".6"/>
<g fill="none" stroke="#0e7490" stroke-width="3" stroke-linecap="round"><path d="M20 96Q13 99 12 92"/><path d="M80 96Q87 99 88 92"/></g>
</svg>`

export const STAGE_CSS = `
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
.oai-list{border:1px solid var(--oai-line);border-radius:14px;overflow:hidden;background:rgba(0,0,0,.22)}
.oai-ai{border-top:1px solid var(--oai-line)}.oai-ai:first-child{border-top:0}
.oai-ai-row{display:flex;align-items:center;gap:12px;padding:11px 14px}
.oai-logo{width:32px;height:32px;flex:none;display:grid;place-items:center;border-radius:9px;background:rgba(120,160,220,.12);font:700 12px/1 ui-monospace,monospace;color:var(--oai-ink)}
.oai-ai-on .oai-logo{background:linear-gradient(135deg,rgba(34,211,238,.3),rgba(255,59,212,.3))}
.oai-ai-what{flex:1;min-width:0}.oai-ai-what strong{display:block;font-weight:600}.oai-ai-what span{display:block;font-size:12.5px;color:var(--oai-ink2)}
.oai-found{flex:none;font-style:normal;font-size:11px;padding:2px 8px;border-radius:999px;border:1px solid rgba(34,211,238,.45);color:var(--oai-accent);white-space:nowrap;max-width:40%;overflow:hidden;text-overflow:ellipsis}
.oai-card button.oai-switch{position:relative;flex:none;width:44px;height:26px;margin:0;padding:0;border-radius:999px;background:rgba(120,160,220,.16);border:1px solid var(--oai-line);transform:none}
.oai-card button.oai-switch::after{content:"";position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:var(--oai-ink2);transition:transform .15s,background .15s}
.oai-card button.oai-switch[aria-checked="true"]{background:linear-gradient(90deg,var(--oai-accent),var(--oai-accent-2));border-color:transparent}
.oai-card button.oai-switch[aria-checked="true"]::after{transform:translateX(18px);background:#fff}
.oai-card button.oai-switch:hover:not(:disabled),.oai-card button.oai-switch:focus-visible{transform:none;box-shadow:0 0 0 3px rgba(34,211,238,.25)}
.oai-ai-setup{padding:0 14px 12px 58px}.oai-ai-setup p{margin:8px 0 0}
.oai-ai-problem{margin:0 14px 10px 58px!important;font-size:13px}
.oai-field{display:flex;gap:8px;align-items:stretch}.oai-field input{flex:1;min-width:0}
.oai-card .oai-field button{width:auto;margin:0;white-space:nowrap}
.oai-setup-form input+.oai-field{margin-top:8px}
.oai-dupes{padding:0 14px 10px 58px}.oai-dupes p{margin:0 0 4px;font-size:12.5px}
.oai-card .oai-dupes button.oai-ghost{display:inline-block;width:auto;margin:2px 0 0;padding:6px 10px;font-size:12.5px}
.oai-card button.oai-more{margin:0;border:0;border-top:1px solid var(--oai-line);border-radius:0;background:none;color:var(--oai-accent);text-align:left;padding:11px 14px;font-weight:500;transform:none}
.oai-every{margin:12px 0 0!important}
.oai-card button.oai-inline{display:inline;width:auto;margin:0;padding:0;border:0;background:none;color:var(--oai-accent);font-weight:500;text-decoration:underline;text-underline-offset:3px;transform:none;box-shadow:none}
.oai-actions{display:flex;align-items:center;gap:12px;margin-top:18px;padding-top:14px;border-top:1px solid var(--oai-line)}
.oai-card .oai-actions button{width:auto;margin:0}.oai-actions .oai-quiet{margin-right:auto!important;padding-left:0}
.oai-count{font-size:13px;color:var(--oai-ink2)}
@media (max-width:520px){.oai-ai-setup,.oai-dupes{padding-left:14px}.oai-ai-problem{margin-left:14px!important}.oai-field{flex-direction:column}.oai-found{display:none}}
@media (prefers-reduced-motion:reduce){.oai-overlay *,.oai-overlay::before,.oai-overlay::after{animation:none!important;transition:none!important}}
`
