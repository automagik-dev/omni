// Styles for the companion and team steps, on top of the stage (octopus.js STAGE_CSS):
// the same deep-space overlay, cyan and magenta, every class prefixed oai-.
export const ONBOARD_CSS = `
.oai-stage.oai-wide{width:min(980px,100%)}
.oai-hero{width:132px;height:132px;display:grid;place-items:center;filter:drop-shadow(0 12px 30px rgba(34,211,238,.35)) drop-shadow(0 0 18px rgba(255,59,212,.18));animation:oai-float 4.5s ease-in-out infinite}
.oai-hero svg{width:132px;height:132px}
.oai-hero .oai-octo{width:124px;height:124px;filter:none;animation:none}
.oai-hero-img{width:132px;height:132px;object-fit:cover;border-radius:28px;border:1px solid rgba(255,255,255,.12)}
.oai-hatch{animation:oai-hatch 1s cubic-bezier(.2,1.4,.4,1) both}
@keyframes oai-hatch{0%{transform:scale(.6) rotate(-8deg);filter:brightness(2.4) drop-shadow(0 0 40px #22d3ee)}60%{transform:scale(1.18) rotate(3deg)}100%{transform:scale(1)}}
.oai-egg{position:relative}
.oai-egg-shell{width:84px;height:104px;border-radius:50% 50% 46% 46%/58% 58% 42% 42%;background:radial-gradient(circle at 36% 30%,#fff 0,#b9f6ff 12%,#22d3ee 42%,#7a3cff 78%,#ff3bd4 100%);box-shadow:0 0 30px rgba(34,211,238,.5),0 0 60px rgba(255,59,212,.25);animation:oai-wobble 2.6s ease-in-out infinite}
@keyframes oai-wobble{0%,100%{transform:rotate(-4deg)}50%{transform:rotate(4deg) translateY(-4px)}}
.oai-spark{position:absolute;width:6px;height:6px;border-radius:50%;background:#fff;box-shadow:0 0 8px #22d3ee;animation:oai-twinkle-dot 2.4s ease-in-out infinite}
.oai-spark-0{top:8px;left:16px}.oai-spark-1{top:22px;right:10px;animation-delay:.5s}.oai-spark-2{bottom:16px;left:6px;animation-delay:1s;background:#ff8be3}.oai-spark-3{bottom:6px;right:22px;animation-delay:1.5s}.oai-spark-4{top:52px;right:-4px;animation-delay:.8s;background:#ff8be3}
@keyframes oai-twinkle-dot{0%,100%{opacity:.2;transform:scale(.6)}50%{opacity:1;transform:scale(1.2)}}
.oai-lede{color:var(--oai-ink2);margin:0 0 16px}
.oai-seg{display:inline-flex;padding:4px;border-radius:12px;background:rgba(255,255,255,.04);border:1px solid var(--oai-line);gap:4px;margin-bottom:14px}
.oai-card .oai-seg button{width:auto;margin:0;white-space:nowrap;background:transparent;border:0;color:var(--oai-ink2);font-weight:600;font-size:14px;padding:9px 16px;border-radius:9px;transform:none;box-shadow:none}
.oai-card .oai-seg button[aria-selected="true"]{background:linear-gradient(90deg,rgba(34,211,238,.22),rgba(255,59,212,.22));color:var(--oai-ink)}
.oai-describe,.oai-pick,.oai-name{display:grid;gap:10px;margin-bottom:16px}
.oai-describe label,.oai-name label{font-size:13px;color:var(--oai-ink2)}
.oai-describe textarea,.oai-name input{width:100%;background:rgba(5,8,18,.7);border:1px solid var(--oai-line);border-radius:12px;color:var(--oai-ink);padding:11px 12px;font:inherit;resize:vertical}
.oai-describe textarea:focus,.oai-name input:focus{outline:2px solid rgba(34,211,238,.55);outline-offset:0}
.oai-name .oai-row{display:grid;gap:8px}
.oai-chips{display:flex;flex-wrap:wrap;gap:6px}
.oai-card button.oai-chip{display:inline-block;width:auto;margin:0;font-weight:500;background:rgba(255,255,255,.04);border:1px solid var(--oai-line);color:var(--oai-ink2);border-radius:999px;padding:5px 10px;font:inherit;font-size:12.5px;cursor:pointer}
.oai-card button.oai-chip:hover{transform:none;box-shadow:none;color:var(--oai-ink);border-color:rgba(34,211,238,.5)}
.oai-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.oai-muted{color:var(--oai-ink2);font-size:13px;margin:0}
.oai-note{color:#ffd9a0;background:rgba(255,184,77,.08);border:1px solid rgba(255,184,77,.28);border-radius:12px;padding:10px 12px;font-size:13.5px;margin:0}
.oai-drawing{height:6px;border-radius:6px;background:linear-gradient(90deg,transparent,#22d3ee,#ff3bd4,transparent);background-size:200% 100%;animation:oai-shimmer 1.2s linear infinite}
@keyframes oai-shimmer{from{background-position:200% 0}to{background-position:-200% 0}}
.oai-shapes{display:grid;grid-template-columns:repeat(auto-fill,minmax(64px,1fr));gap:8px}
.oai-card button.oai-shape{width:auto;margin:0;aspect-ratio:1;background:rgba(255,255,255,.03);border:1px solid var(--oai-line);border-radius:14px;padding:4px;display:grid;place-items:center;cursor:pointer;transition:transform .15s,border-color .15s}
.oai-card button.oai-shape:hover{box-shadow:none;transform:translateY(-2px);border-color:rgba(34,211,238,.45)}
.oai-card button.oai-shape[aria-checked="true"]{border-color:#22d3ee;box-shadow:0 0 0 1px #22d3ee inset,0 0 18px rgba(34,211,238,.25)}
.oai-swatches{display:flex;flex-wrap:wrap;gap:8px}
.oai-card button.oai-swatch{display:inline-block;width:26px;height:26px;margin:0;padding:0;border-radius:50%;border:2px solid transparent;cursor:pointer;box-shadow:0 0 0 1px rgba(255,255,255,.12)}
.oai-card button.oai-swatch[aria-checked="true"]{border-color:#fff;box-shadow:0 0 0 3px rgba(255,255,255,.18)}
.oai-error{color:var(--oai-bad);margin:0 0 10px}
.oai-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:6px}
.oai-big{padding:12px 20px;font-size:15px}
.oai-select{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px;margin-bottom:12px}
.oai-fighter{position:relative;display:grid;gap:10px;align-content:start;padding:16px;border-radius:18px;border:1px solid var(--oai-line);background:linear-gradient(180deg,rgba(17,25,48,.9),rgba(9,13,28,.9));transition:border-color .2s,box-shadow .2s}
.oai-fighter.oai-chosen{border-color:#22d3ee;box-shadow:0 0 0 1px rgba(34,211,238,.6),0 18px 50px -20px rgba(34,211,238,.55)}
.oai-fighter.oai-locked{opacity:.92}
.oai-fighter header{display:flex;align-items:baseline;justify-content:space-between;gap:8px}
.oai-fighter h2{margin:0;font-size:22px;letter-spacing:.01em}
.oai-fighter p{margin:0;color:var(--oai-ink2);font-size:14px}
.oai-class{font:600 11px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.14em;text-transform:uppercase;color:#ff8be3}
.oai-omni .oai-class{color:#7fe9ff}
.oai-portrait{position:relative;height:150px;border-radius:14px;overflow:hidden;display:grid;place-items:end center;background:radial-gradient(120% 90% at 50% 110%,rgba(34,211,238,.18),transparent 60%),linear-gradient(180deg,#0b1430,#060a18)}
.oai-genie .oai-portrait{place-items:center;background:radial-gradient(90% 80% at 50% 80%,rgba(255,59,212,.2),transparent 60%),linear-gradient(180deg,#140b2c,#070512)}
.oai-octo-wrap .oai-octo{width:120px;height:120px;animation:oai-rise 1.4s cubic-bezier(.2,1.2,.4,1) both,oai-float 4.5s ease-in-out 1.4s infinite}
@keyframes oai-rise{from{transform:translateY(140px)}to{transform:translateY(8px)}}
.oai-bubbles i{position:absolute;bottom:-12px;width:10px;height:10px;border-radius:50%;border:1.5px solid rgba(143,244,255,.7);animation:oai-bubble 3.2s ease-in infinite}
.oai-bubbles i:nth-child(1){left:18%;animation-delay:.2s}.oai-bubbles i:nth-child(2){left:30%;width:6px;height:6px;animation-delay:1.1s}.oai-bubbles i:nth-child(3){left:68%;animation-delay:.6s}.oai-bubbles i:nth-child(4){left:80%;width:7px;height:7px;animation-delay:1.8s}.oai-bubbles i:nth-child(5){left:45%;width:5px;height:5px;animation-delay:2.4s}.oai-bubbles i:nth-child(6){left:58%;animation-delay:1.5s}
@keyframes oai-bubble{0%{transform:translateY(0);opacity:0}15%{opacity:1}100%{transform:translateY(-170px) translateX(6px);opacity:0}}
.oai-genie-wrap svg{animation:oai-emerge 1.6s cubic-bezier(.2,1.3,.4,1) .3s both,oai-float 5s ease-in-out 1.9s infinite}
@keyframes oai-emerge{0%{transform:translateY(60px) scale(.2);opacity:0;filter:blur(6px)}60%{opacity:1;filter:blur(0)}100%{transform:none}}
.oai-sparkles i{position:absolute;width:5px;height:5px;border-radius:50%;background:#64f4ff;box-shadow:0 0 10px #64f4ff;animation:oai-twinkle-dot 2s ease-in-out infinite}
.oai-sparkles i:nth-child(1){top:24px;left:22%}.oai-sparkles i:nth-child(2){top:40px;right:20%;animation-delay:.4s}.oai-sparkles i:nth-child(3){bottom:30px;left:16%;animation-delay:.9s;background:#ff8be3;box-shadow:0 0 10px #ff8be3}.oai-sparkles i:nth-child(4){bottom:22px;right:26%;animation-delay:1.3s}.oai-sparkles i:nth-child(5){top:70px;left:50%;animation-delay:.7s;background:#ff8be3;box-shadow:0 0 10px #ff8be3}
.oai-stats{list-style:none;margin:2px 0 0;padding:0;display:grid;gap:6px}
.oai-stat{display:grid;grid-template-columns:110px 1fr auto;align-items:center;gap:10px;font-size:13.5px}
.oai-stat.oai-off .oai-stat-label{color:var(--oai-ink2);text-decoration:line-through;text-decoration-color:rgba(255,255,255,.25)}
.oai-bar{display:flex;gap:3px}
.oai-pip{flex:1;height:8px;border-radius:2px;background:rgba(255,255,255,.07)}
.oai-pip.on{background:linear-gradient(90deg,#22d3ee,#ff3bd4)}
.oai-genie .oai-pip.on{background:linear-gradient(90deg,#ff3bd4,#b77bff)}
.oai-off .oai-pip.on{filter:grayscale(1);opacity:.4}
.oai-core{font:600 10px/1 ui-monospace,Menlo,monospace;letter-spacing:.1em;text-transform:uppercase;color:#7fe9ff;border:1px solid rgba(127,233,255,.4);border-radius:999px;padding:3px 7px}
.oai-hero{margin-bottom:8px}
.oai-soon{font:600 10px/1 ui-monospace,Menlo,monospace;letter-spacing:.1em;text-transform:uppercase;color:#ff8be3;border:1px solid rgba(255,139,227,.35);border-radius:999px;padding:3px 6px}
.oai-facts{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;margin:4px 0 0;font-size:13px}
.oai-facts dt{color:var(--oai-ink2)}.oai-facts dd{margin:0;color:var(--oai-ink)}
.oai-menu-label{font:600 11px/1 ui-monospace,Menlo,monospace;letter-spacing:.14em;text-transform:uppercase;color:var(--oai-ink2);margin-top:4px}
.oai-menu-preview{list-style:none;margin:0;padding:8px;border-radius:12px;background:rgba(5,8,18,.6);border:1px solid var(--oai-line);display:grid;gap:4px;font-size:13px}
.oai-menu-preview li{display:flex;align-items:center;gap:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.oai-dot{width:7px;height:7px;border-radius:50%;flex:none}.oai-dot.ok{background:#4fe0a8}.oai-dot.warn{background:#f2c25b}
.oai-card button.oai-join,.oai-join{justify-self:stretch;text-align:center;margin-top:4px;padding:11px;border-radius:12px;border:1px solid var(--oai-line);background:rgba(255,255,255,.04);color:var(--oai-ink);font:600 14px/1 inherit;font-family:inherit;cursor:pointer}
.oai-card button.oai-join.on{background:linear-gradient(90deg,rgba(34,211,238,.25),rgba(255,59,212,.25));border-color:rgba(34,211,238,.6)}
.oai-soon-badge{cursor:default;color:#ff8be3;border-style:dashed}
@media (prefers-reduced-motion: reduce){.oai-hero,.oai-egg-shell,.oai-spark,.oai-octo-wrap .oai-octo,.oai-bubbles i,.oai-genie-wrap svg,.oai-sparkles i,.oai-hatch,.oai-drawing{animation:none!important}.oai-bubbles,.oai-sparkles{display:none}}
`
