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
.oai-select{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px;margin-bottom:12px;align-items:start}
.oai-fighter{position:relative;display:grid;gap:10px;align-content:start;padding:14px;border-radius:18px;border:1px solid var(--oai-line);background:linear-gradient(180deg,rgba(17,25,48,.9),rgba(9,13,28,.9));transition:border-color .4s,box-shadow .4s}
.oai-fighter.oai-chosen{border-color:rgba(34,211,238,.7);box-shadow:0 0 0 1px rgba(34,211,238,.35),0 18px 50px -24px rgba(34,211,238,.55)}
.oai-fighter header{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:30px}
.oai-fighter h2{margin:0;font-size:20px;letter-spacing:.01em}
.oai-fighter p{margin:0;color:var(--oai-ink2);font-size:14px}
.oai-about{font-size:13.5px!important}
.oai-box{position:relative;height:340px;display:grid;grid-template-rows:30px 136px 24px 1fr;padding:10px 12px 12px;border-radius:16px;overflow:hidden;
  background:linear-gradient(rgba(120,170,230,.05) 1px,transparent 1px) 0 0/18px 18px,linear-gradient(90deg,rgba(120,170,230,.05) 1px,transparent 1px) 0 0/18px 18px,radial-gradient(120% 80% at 50% 45%,rgba(34,211,238,.16),transparent 65%),linear-gradient(180deg,#0a1230,#050915);
  box-shadow:inset 0 0 0 1px rgba(120,170,230,.18),inset 0 0 0 6px rgba(5,8,18,.55),inset 0 0 0 7px rgba(120,170,230,.08);transition:filter .6s,background .6s}
.oai-box.oai-is-asleep{background:linear-gradient(rgba(120,170,230,.018) 1px,transparent 1px) 0 0/18px 18px,linear-gradient(90deg,rgba(120,170,230,.018) 1px,transparent 1px) 0 0/18px 18px,linear-gradient(180deg,#04060d,#020308)}
.oai-box-genie{background:radial-gradient(90% 70% at 50% 45%,rgba(255,59,212,.12),transparent 65%),linear-gradient(180deg,#120a26,#06040f);box-shadow:inset 0 0 0 1px rgba(255,139,227,.14),inset 0 0 0 6px rgba(5,8,18,.55),inset 0 0 0 7px rgba(255,139,227,.06)}
.oai-box-top{display:flex;align-items:center;justify-content:space-between}
.oai-lights{display:flex;gap:6px;padding-left:4px}
.oai-light{width:6px;height:6px;border-radius:50%;background:rgba(160,180,210,.18);font-style:normal;transition:background .3s,box-shadow .3s}
.oai-light-on{background:#4fe0a8;box-shadow:0 0 6px #4fe0a8}
.oai-light-busy{background:#22d3ee;box-shadow:0 0 6px #22d3ee;animation:oai-blink-light 1s steps(2) infinite}
.oai-light-warn{background:#f2c25b;box-shadow:0 0 6px rgba(242,194,91,.7)}
@keyframes oai-blink-light{50%{opacity:.25}}
.oai-is-waking .oai-light{animation:oai-light-up .3s ease-out both}
.oai-is-waking .oai-light:nth-child(2){animation-delay:.3s}.oai-is-waking .oai-light:nth-child(3){animation-delay:.6s}
@keyframes oai-light-up{from{background:rgba(160,180,210,.18);box-shadow:none}to{background:#4fe0a8;box-shadow:0 0 6px #4fe0a8}}
.oai-card button.oai-power{display:grid;place-items:center;width:30px;height:30px;margin:0;padding:0;border-radius:50%;corner-shape:round;border:1px solid rgba(34,211,238,.45);background:rgba(5,8,18,.8);color:#7fe9ff;box-shadow:0 0 14px -4px rgba(34,211,238,.6)}
.oai-is-asleep button.oai-power{animation:oai-call 2.4s ease-in-out infinite}
@keyframes oai-call{0%,100%{box-shadow:0 0 10px -6px rgba(34,211,238,.5)}50%{box-shadow:0 0 0 5px rgba(34,211,238,.1),0 0 18px -2px rgba(34,211,238,.75)}}
.oai-card button.oai-power.on{border-color:transparent;background:linear-gradient(135deg,var(--oai-accent),var(--oai-accent-2));color:#06060f;box-shadow:0 0 16px -4px rgba(255,59,212,.6)}
.oai-card button.oai-power:hover:not(:disabled){transform:scale(1.06)}
.oai-screen{position:relative;display:grid;place-items:end center}
.oai-octo-wrap .oai-octo{width:118px;height:118px;animation:oai-float 4.5s ease-in-out infinite}
.oai-is-asleep .oai-octo-wrap{filter:saturate(.15) brightness(.45);transition:filter .6s}
.oai-is-asleep .oai-octo-wrap .oai-octo{animation:oai-slump 5.2s ease-in-out infinite}
@keyframes oai-slump{0%,100%{transform:translateY(6px) rotate(-7deg) scale(1,.95)}50%{transform:translateY(3px) rotate(-6deg) scale(1.01,.97)}}
.oai-is-waking .oai-octo-wrap .oai-octo{animation:oai-rise-up .9s cubic-bezier(.2,1.3,.4,1) both,oai-float 4.5s ease-in-out .9s infinite}
@keyframes oai-rise-up{0%{transform:translateY(6px) rotate(-7deg)}60%{transform:translateY(-8px) rotate(2deg)}100%{transform:none}}
.oai-closed{display:none}.oai-is-asleep .oai-closed{display:inline}.oai-is-asleep .oai-eyes{display:none}
.oai-is-waking .oai-eyes{animation:oai-open .5s cubic-bezier(.3,1.5,.5,1) both}
@keyframes oai-open{from{transform:scaleY(.08)}to{transform:scaleY(1)}}
.oai-genie-wrap{align-self:center;filter:saturate(.5) brightness(.75)}
.oai-zzz i{position:absolute;left:57%;top:46%;font:700 14px/1 ui-monospace,monospace;font-style:normal;color:#7d8aa3;opacity:0;animation:oai-z 3.6s ease-in infinite}
.oai-zzz i:nth-child(2){animation-delay:1.2s;font-size:11px}.oai-zzz i:nth-child(3){animation-delay:2.4s;font-size:9px}
@keyframes oai-z{0%{transform:translate(0,0);opacity:0}20%{opacity:.8}100%{transform:translate(24px,-54px);opacity:0}}
.oai-scan{position:absolute;inset:0;display:grid;place-items:center;pointer-events:none}
.oai-scan i{position:absolute;width:56px;height:56px;border-radius:50%;border:1.5px solid rgba(34,211,238,.7);opacity:0;animation:oai-ping 2.1s cubic-bezier(.2,.6,.4,1) infinite}
.oai-scan i:nth-child(2){animation-delay:.7s;border-color:rgba(255,59,212,.6)}.oai-scan i:nth-child(3){animation-delay:1.4s}
@keyframes oai-ping{0%{transform:scale(.4);opacity:.9}100%{transform:scale(3.6);opacity:0}}
.oai-status{align-self:center;margin:0!important;text-align:center;font:500 13px/1.3 ui-monospace,SFMono-Regular,Menlo,monospace!important;color:#d6f8ff!important;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.oai-is-asleep .oai-status,.oai-box-genie .oai-status{color:#7d8aa3!important}
.oai-working::after{content:"";display:inline-block;width:6px;height:6px;margin-left:8px;vertical-align:1px;border-radius:50%;background:var(--oai-accent-2);animation:oai-caret 1s steps(1) infinite}
.oai-inside{min-height:0;overflow:auto;display:grid;align-content:center;gap:6px;padding-top:4px}
.oai-inside-note{margin:0!important;text-align:center;font-size:12.5px!important;color:var(--oai-ink2)!important;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.oai-inside-note.oai-bad{color:var(--oai-bad)!important}
.oai-install{list-style:none;margin:0;padding:0;display:flex;justify-content:center;gap:14px;font-size:12.5px;color:var(--oai-ink2)}
.oai-install li{display:flex;align-items:center;gap:6px}
.oai-install-dot{display:grid;place-items:center;width:14px;height:14px;border-radius:50%;border:1.5px solid var(--oai-line)}
.oai-install-done{color:var(--oai-ink)}.oai-install-done .oai-install-dot{border-color:#4fe0a8;color:#4fe0a8}
.oai-install-now{color:var(--oai-ink)}.oai-install-now .oai-install-dot{border-color:rgba(34,211,238,.25);border-top-color:var(--oai-accent);animation:oai-spin .8s linear infinite}
.oai-install-next{opacity:.55}
@keyframes oai-spin{to{transform:rotate(360deg)}}
.oai-found-box{display:grid;gap:4px;justify-items:center}
.oai-found-list{list-style:none;margin:0;padding:0;display:grid;gap:5px;width:100%}
.oai-found-row{display:flex;align-items:center;gap:10px;padding:6px 6px 6px 10px;border-radius:10px;border:1px solid rgba(34,211,238,.35);background:rgba(34,211,238,.05)}
.oai-found-row.oai-quiet{border-color:var(--oai-line);background:none;opacity:.6}
.oai-found-what{flex:1;min-width:0;display:flex;flex-direction:column;line-height:1.25}
.oai-found-what strong{font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.oai-found-what small{font-size:11.5px;color:var(--oai-ink2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.oai-card .oai-pill,.oai-pill{display:inline-flex;align-items:center;justify-content:center;gap:6px;width:auto;margin:0;padding:6px 12px;border-radius:999px;border:1px solid var(--oai-line);background:none;color:var(--oai-ink2);font:inherit;font-size:12.5px;font-weight:600;text-decoration:none;white-space:nowrap;cursor:pointer}
.oai-card .oai-pill-primary,.oai-pill-primary{border-color:transparent;background:linear-gradient(135deg,var(--oai-accent),var(--oai-accent-2));color:#06060f}
.oai-card button.oai-textlink{display:inline;width:auto;margin:0;padding:0;border:0;background:none;color:var(--oai-accent);font-size:12.5px;font-weight:500;transform:none;box-shadow:none;justify-self:center}
.oai-elsewhere{display:grid;gap:6px}
.oai-elsewhere .oai-field input{padding:7px 10px;font-size:12.5px}
.oai-pairing{display:grid;gap:6px;justify-items:center}
.oai-pair-code{font:700 22px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.18em;color:#fff}
.oai-menu{display:grid;gap:5px}
.oai-menu-label{font:600 10px/1 ui-monospace,Menlo,monospace;letter-spacing:.14em;text-transform:uppercase;color:var(--oai-ink2)}
.oai-menu-preview{list-style:none;margin:0;padding:6px 8px;border-radius:10px;background:rgba(5,8,18,.6);border:1px solid var(--oai-line);display:grid;gap:3px;font-size:12.5px}
.oai-menu-preview li{display:flex;align-items:center;gap:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.oai-dot{width:7px;height:7px;border-radius:50%;flex:none}.oai-dot.ok{background:#4fe0a8}.oai-dot.warn{background:#f2c25b}
.oai-team-line{display:inline-flex;align-items:center;gap:10px}
.oai-on-team{display:inline-flex;align-items:center;gap:5px;color:#4fe0a8;font-weight:600;font-size:13px}
.oai-card button.oai-remove{width:auto;margin:0;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:600;color:var(--oai-ink2);background:none;border:1px solid var(--oai-line)}
.oai-card button.oai-remove:hover:not(:disabled){color:var(--oai-ink);border-color:rgba(255,107,107,.6);box-shadow:none;transform:none}
.oai-starts summary{cursor:pointer;color:var(--oai-ink2);font-size:13px;list-style:none;display:flex;align-items:center;gap:6px}
.oai-starts summary::-webkit-details-marker{display:none}
.oai-starts summary::before{content:"›";display:inline-block;transition:transform .15s;color:var(--oai-accent)}
.oai-starts[open] summary::before{transform:rotate(90deg)}
.oai-starts[open] summary{margin-bottom:8px}
.oai-core{font:600 10px/1 ui-monospace,Menlo,monospace;letter-spacing:.1em;text-transform:uppercase;color:#7fe9ff;border:1px solid rgba(127,233,255,.4);border-radius:999px;padding:3px 7px;white-space:nowrap}
.oai-caps{display:grid;gap:12px;padding-top:4px;border-top:1px solid var(--oai-line)}
.oai-cap-group h3{margin:8px 0 6px;font:600 11px/1 ui-monospace,Menlo,monospace;letter-spacing:.14em;text-transform:uppercase;color:var(--oai-ink2)}
.oai-cap-group ul{list-style:none;margin:0;padding:0;display:grid;gap:6px}
.oai-cap{display:flex;align-items:center;gap:10px;font-size:13.5px}
.oai-cap.oai-off .oai-cap-what{opacity:.55}
.oai-cap-what{flex:1;min-width:0;display:flex;flex-direction:column}
.oai-cap-what strong{font-weight:600}
.oai-cap-what small{color:var(--oai-ink2);font-size:12px;line-height:1.35;overflow:hidden;text-overflow:ellipsis}
.oai-cap-what code{font:11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;color:#7fb8c8;overflow-wrap:anywhere}
.oai-cap-empty{font-size:12.5px!important}
.oai-version{flex:none;font:11px/1 ui-monospace,Menlo,monospace;color:var(--oai-ink2);padding:3px 7px;border-radius:999px;border:1px solid var(--oai-line)}
.oai-version.oai-pending{border-style:dashed}
.oai-tick{flex:none;display:grid;place-items:center;color:#4fe0a8}
@media (prefers-reduced-motion: reduce){.oai-hero,.oai-egg-shell,.oai-spark,.oai-octo-wrap .oai-octo,.oai-drawing,.oai-zzz i,.oai-scan i,.oai-power,.oai-eyes,.oai-light,.oai-box{animation:none!important;transition:none!important}.oai-scan i:nth-child(n+2){display:none}.oai-zzz i{opacity:.7}.oai-zzz i:nth-child(2){transform:translate(12px,-22px)}.oai-zzz i:nth-child(3){transform:translate(22px,-40px)}.oai-scan i{opacity:.6;transform:scale(2.2)}.oai-is-asleep .oai-octo-wrap .oai-octo{transform:translateY(6px) rotate(-7deg)}}
`
