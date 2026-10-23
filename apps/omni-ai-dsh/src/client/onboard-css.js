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
.oai-octo-wrap .oai-octo{width:120px;height:120px;animation:oai-float 4.5s ease-in-out infinite}
.oai-is-waking .oai-octo-wrap .oai-octo{animation:oai-hop .9s cubic-bezier(.2,1.4,.4,1) both,oai-float 4.5s ease-in-out .9s infinite}
@keyframes oai-hop{0%{transform:translateY(14px)}50%{transform:translateY(-12px)}100%{transform:translateY(0)}}
.oai-bubbles i{position:absolute;bottom:-12px;width:10px;height:10px;border-radius:50%;border:1.5px solid rgba(143,244,255,.7);animation:oai-bubble 3.2s ease-in infinite}
.oai-bubbles i:nth-child(1){left:18%;animation-delay:.2s}.oai-bubbles i:nth-child(2){left:30%;width:6px;height:6px;animation-delay:1.1s}.oai-bubbles i:nth-child(3){left:68%;animation-delay:.6s}.oai-bubbles i:nth-child(4){left:80%;width:7px;height:7px;animation-delay:1.8s}.oai-bubbles i:nth-child(5){left:45%;width:5px;height:5px;animation-delay:2.4s}.oai-bubbles i:nth-child(6){left:58%;animation-delay:1.5s}
@keyframes oai-bubble{0%{transform:translateY(0);opacity:0}15%{opacity:1}100%{transform:translateY(-170px) translateX(6px);opacity:0}}
.oai-genie-wrap svg{animation:oai-emerge 1.6s cubic-bezier(.2,1.3,.4,1) .3s both,oai-float 5s ease-in-out 1.9s infinite}
@keyframes oai-emerge{0%{transform:translateY(60px) scale(.2);opacity:0;filter:blur(6px)}60%{opacity:1;filter:blur(0)}100%{transform:none}}
.oai-core{font:600 10px/1 ui-monospace,Menlo,monospace;letter-spacing:.1em;text-transform:uppercase;color:#7fe9ff;border:1px solid rgba(127,233,255,.4);border-radius:999px;padding:3px 7px}
.oai-hero{margin-bottom:8px}
.oai-soon{font:600 10px/1 ui-monospace,Menlo,monospace;letter-spacing:.1em;text-transform:uppercase;color:#ff8be3;border:1px solid rgba(255,139,227,.35);border-radius:999px;padding:3px 6px}
.oai-card button.oai-join,.oai-join{justify-self:stretch;text-align:center;margin-top:4px;padding:11px;border-radius:12px;border:1px solid var(--oai-line);background:rgba(255,255,255,.04);color:var(--oai-ink);font:600 14px/1 inherit;font-family:inherit;cursor:pointer}
.oai-card button.oai-join.on{background:linear-gradient(90deg,rgba(34,211,238,.25),rgba(255,59,212,.25));border-color:rgba(34,211,238,.6)}
.oai-soon-badge{cursor:default;color:#ff8be3;border-style:dashed}
.oai-about{font-size:13.5px!important}
.oai-fighter{transition:border-color .4s,box-shadow .4s,background .4s}
.oai-is-asleep{background:linear-gradient(180deg,rgba(12,16,30,.92),rgba(7,9,18,.95))}
.oai-is-asleep .oai-portrait,.oai-is-asleep .oai-caps,.oai-is-asleep header,.oai-is-asleep .oai-about{filter:saturate(.25) brightness(.62);transition:filter .6s}
.oai-portrait{transition:box-shadow .6s,background .6s}
.oai-is-asleep .oai-portrait{background:linear-gradient(180deg,#070b18,#04060d)}
.oai-is-asleep .oai-octo-wrap .oai-octo{animation:oai-breathe 4.8s ease-in-out infinite}
@keyframes oai-breathe{0%,100%{transform:translateY(14px) scale(1,.97)}50%{transform:translateY(8px) scale(1.02,1)}}
.oai-closed{display:none}.oai-is-asleep .oai-closed{display:inline}.oai-is-asleep .oai-eyes{display:none}
.oai-is-waking .oai-eyes{animation:oai-open .9s cubic-bezier(.3,1.5,.5,1) both}
@keyframes oai-open{0%{transform:scaleY(.08)}55%{transform:scaleY(.08)}100%{transform:scaleY(1)}}
.oai-omni:not(.oai-is-asleep) .oai-portrait{box-shadow:inset 0 0 0 1px rgba(34,211,238,.35),0 0 38px -6px rgba(34,211,238,.55);background:radial-gradient(120% 90% at 50% 110%,rgba(34,211,238,.32),transparent 60%),linear-gradient(180deg,#0b1430,#060a18)}
.oai-is-waking .oai-portrait{animation:oai-glow 1.1s ease-out both}
@keyframes oai-glow{0%{box-shadow:inset 0 0 0 1px rgba(34,211,238,0),0 0 0 rgba(34,211,238,0);filter:brightness(.6)}70%{filter:brightness(1.35)}100%{filter:none}}
.oai-zzz i{position:absolute;left:58%;top:42%;font:700 15px/1 ui-monospace,monospace;font-style:normal;color:#9fb0cc;opacity:0;animation:oai-z 3.6s ease-in infinite}
.oai-zzz i:nth-child(2){animation-delay:1.2s;font-size:12px}.oai-zzz i:nth-child(3){animation-delay:2.4s;font-size:10px}
@keyframes oai-z{0%{transform:translate(0,0);opacity:0}20%{opacity:.85}100%{transform:translate(26px,-58px);opacity:0}}
.oai-scan{position:absolute;inset:0;display:grid;place-items:center;pointer-events:none}
.oai-scan i{position:absolute;width:60px;height:60px;border-radius:50%;border:1.5px solid rgba(34,211,238,.7);opacity:0;animation:oai-ping 2.1s cubic-bezier(.2,.6,.4,1) infinite}
.oai-scan i:nth-child(2){animation-delay:.7s;border-color:rgba(255,59,212,.6)}.oai-scan i:nth-child(3){animation-delay:1.4s}
@keyframes oai-ping{0%{transform:scale(.4);opacity:.9}100%{transform:scale(4.2);opacity:0}}
.oai-power-row{display:flex;align-items:center;gap:12px}
.oai-card button.oai-power{flex:none;display:grid;place-items:center;width:52px;height:52px;margin:0;padding:0;border-radius:50%;corner-shape:round;border:1.5px solid rgba(34,211,238,.55);background:radial-gradient(circle at 50% 35%,rgba(34,211,238,.22),rgba(5,8,18,.9));color:#7fe9ff;box-shadow:0 0 0 4px rgba(34,211,238,.08),0 0 26px -4px rgba(34,211,238,.6)}
.oai-is-asleep button.oai-power{animation:oai-call 2.4s ease-in-out infinite}
@keyframes oai-call{0%,100%{box-shadow:0 0 0 4px rgba(34,211,238,.08),0 0 20px -6px rgba(34,211,238,.5)}50%{box-shadow:0 0 0 9px rgba(34,211,238,.12),0 0 34px -2px rgba(34,211,238,.75)}}
.oai-card button.oai-power.on{border-color:transparent;background:linear-gradient(135deg,var(--oai-accent),var(--oai-accent-2));color:#06060f;box-shadow:0 0 28px -4px rgba(255,59,212,.6)}
.oai-card button.oai-power:hover:not(:disabled){transform:scale(1.05)}
.oai-status{margin:0!important;font-size:14px;color:var(--oai-ink)!important}
.oai-is-asleep .oai-status{color:var(--oai-ink2)!important}
.oai-working::after{content:"";display:inline-block;width:8px;height:8px;margin-left:8px;border-radius:50%;background:var(--oai-accent-2);animation:oai-caret 1s steps(1) infinite}
.oai-install{list-style:none;margin:0;padding:10px 12px;display:grid;gap:8px;border-radius:12px;border:1px solid var(--oai-line);background:rgba(5,8,18,.55)}
.oai-install li{display:grid;grid-template-columns:18px 1fr auto;align-items:center;gap:10px;font-size:13.5px}
.oai-install small{color:var(--oai-ink2);font-size:12px}
.oai-install-dot{display:grid;place-items:center;width:18px;height:18px;border-radius:50%;border:1.5px solid var(--oai-line)}
.oai-install-done .oai-install-dot{border-color:#4fe0a8;color:#4fe0a8}
.oai-install-now .oai-install-dot{border-color:rgba(34,211,238,.25);border-top-color:var(--oai-accent);animation:oai-spin .8s linear infinite}
.oai-install-next{opacity:.6}
@keyframes oai-spin{to{transform:rotate(360deg)}}
.oai-connect{display:grid;gap:10px}
.oai-found-list{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.oai-found-row{display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:12px;border:1px solid rgba(34,211,238,.45);background:rgba(34,211,238,.06);animation:oai-in .35s ease-out both}
@keyframes oai-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.oai-found-mark{flex:none;width:10px;height:10px;border-radius:50%;background:#4fe0a8;box-shadow:0 0 10px #4fe0a8}
.oai-found-mark.oai-quiet{background:var(--oai-ink2);box-shadow:none;opacity:.6}
.oai-card .oai-pill,.oai-pill{display:inline-flex;align-items:center;justify-content:center;gap:6px;width:auto;margin:0;padding:8px 14px;border-radius:999px;border:1px solid var(--oai-line);background:none;color:var(--oai-ink2);font:inherit;font-size:13.5px;font-weight:600;text-decoration:none;white-space:nowrap;cursor:pointer}
.oai-card .oai-pill-primary,.oai-pill-primary{border-color:transparent;background:linear-gradient(135deg,var(--oai-accent),var(--oai-accent-2));color:#06060f}
.oai-card button.oai-local{display:grid;justify-items:start;gap:2px;width:100%;padding:10px 14px;border-radius:12px;text-align:left}
.oai-local strong{color:var(--oai-ink)}.oai-local small{font-weight:400;color:var(--oai-ink2);font-size:12px}
.oai-elsewhere{display:grid;gap:8px}.oai-elsewhere p{margin:0!important}
.oai-more summary{cursor:pointer;color:var(--oai-accent);font-size:13px}
.oai-more[open] summary{margin-bottom:8px}
.oai-pairing{display:grid;gap:8px}.oai-pairing p{margin:0!important}
.oai-linked{display:grid;grid-template-columns:auto 1fr;align-items:center;gap:4px 8px;margin:0!important;padding:10px 12px;border-radius:12px;border:1px solid rgba(79,224,168,.45);background:rgba(79,224,168,.07);color:#4fe0a8!important;font-weight:600}
.oai-linked small{grid-column:2;color:var(--oai-ink2);font-weight:400;font-size:12.5px}
.oai-menu-label{font:600 11px/1 ui-monospace,Menlo,monospace;letter-spacing:.14em;text-transform:uppercase;color:var(--oai-ink2);margin-top:4px}
.oai-menu-preview{list-style:none;margin:0;padding:8px;border-radius:12px;background:rgba(5,8,18,.6);border:1px solid var(--oai-line);display:grid;gap:4px;font-size:13px}
.oai-menu-preview li{display:flex;align-items:center;gap:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.oai-dot{width:7px;height:7px;border-radius:50%;flex:none}.oai-dot.ok{background:#4fe0a8}.oai-dot.warn{background:#f2c25b}
.oai-team-line{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 12px;border-radius:12px;border:1px solid rgba(79,224,168,.35);background:rgba(79,224,168,.06)}
.oai-on-team{display:inline-flex;align-items:center;gap:6px;color:#4fe0a8;font-weight:600;font-size:13.5px}
.oai-card button.oai-remove{width:auto;margin:0;padding:6px 12px;border-radius:999px;font-size:13px;font-weight:600;color:var(--oai-ink2);background:none;border:1px solid var(--oai-line)}
.oai-card button.oai-remove:hover:not(:disabled){color:var(--oai-ink);border-color:rgba(255,107,107,.6);box-shadow:none;transform:none}
.oai-cap.oai-off .oai-cap-what{opacity:.55}
.oai-cap-what small{overflow:hidden;text-overflow:ellipsis}
.oai-caps{display:grid;gap:12px;padding-top:4px;border-top:1px solid var(--oai-line)}
.oai-cap-group h3{margin:8px 0 6px;font:600 11px/1 ui-monospace,Menlo,monospace;letter-spacing:.14em;text-transform:uppercase;color:var(--oai-ink2)}
.oai-cap-group ul{list-style:none;margin:0;padding:0;display:grid;gap:6px}
.oai-cap{display:flex;align-items:center;gap:10px;font-size:13.5px}
.oai-cap-what{flex:1;min-width:0;display:flex;flex-direction:column}
.oai-cap-what strong{font-weight:600}
.oai-cap-what small{color:var(--oai-ink2);font-size:12px;line-height:1.35}
.oai-cap-what code{font:11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;color:#7fb8c8;overflow-wrap:anywhere}
.oai-cap-empty{font-size:12.5px!important}
.oai-version{flex:none;font:11px/1 ui-monospace,Menlo,monospace;color:var(--oai-ink2);padding:3px 7px;border-radius:999px;border:1px solid var(--oai-line)}
.oai-version.oai-pending{border-style:dashed}
.oai-tick{flex:none;display:grid;place-items:center;color:#4fe0a8}
.oai-genie .oai-soon-badge{justify-self:start;padding:6px 12px}
@media (prefers-reduced-motion: reduce){.oai-hero,.oai-egg-shell,.oai-spark,.oai-octo-wrap .oai-octo,.oai-bubbles i,.oai-genie-wrap svg,.oai-hatch,.oai-drawing,.oai-zzz i,.oai-scan i,.oai-power,.oai-portrait,.oai-eyes,.oai-found-row{animation:none!important}.oai-bubbles,.oai-scan i:nth-child(n+2){display:none}.oai-zzz i{opacity:.7}.oai-zzz i:nth-child(2){transform:translate(12px,-22px)}.oai-zzz i:nth-child(3){transform:translate(22px,-40px)}.oai-scan i{opacity:.6;transform:scale(2.2)}}
`
