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
var __esm = (fn2, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn2 && (res = (0, fn2[__getOwnPropNames(fn2)[0]])(fn2 = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to2, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to2, key) && key !== except)
        __defProp(to2, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to2;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// node_modules/@xterm/xterm/lib/xterm.mjs
var xterm_exports = {};
__export(xterm_exports, {
  Terminal: () => Dl
});
function Al(s15) {
  return s15.replace(/\r?\n/g, "\r");
}
function kl(s15, t) {
  return t ? "\x1B[200~" + s15 + "\x1B[201~" : s15;
}
function Vs(s15, t) {
  s15.clipboardData && s15.clipboardData.setData("text/plain", t.selectionText), s15.preventDefault();
}
function qs(s15, t, e, i) {
  if (s15.stopPropagation(), s15.clipboardData) {
    let r = s15.clipboardData.getData("text/plain");
    Cn(r, t, e, i);
  }
}
function Cn(s15, t, e, i) {
  s15 = Al(s15), s15 = kl(s15, e.decPrivateModes.bracketedPasteMode && i.rawOptions.ignoreBracketedPasteMode !== true), e.triggerDataEvent(s15, true), t.value = "";
}
function Mn(s15, t, e) {
  let i = e.getBoundingClientRect(), r = s15.clientX - i.left - 10, n = s15.clientY - i.top - 10;
  t.style.width = "20px", t.style.height = "20px", t.style.left = `${r}px`, t.style.top = `${n}px`, t.style.zIndex = "1000", t.focus();
}
function Pn(s15, t, e, i, r) {
  Mn(s15, t, e), r && i.rightClickSelect(s15), t.value = i.selectionText, t.select();
}
function Ce(s15) {
  return s15 > 65535 ? (s15 -= 65536, String.fromCharCode((s15 >> 10) + 55296) + String.fromCharCode(s15 % 1024 + 56320)) : String.fromCharCode(s15);
}
function It(s15, t = 0, e = s15.length) {
  let i = "";
  for (let r = t; r < e; ++r) {
    let n = s15[r];
    n > 65535 ? (n -= 65536, i += String.fromCharCode((n >> 10) + 55296) + String.fromCharCode(n % 1024 + 56320)) : i += String.fromCharCode(n);
  }
  return i;
}
function Xs(s15) {
  return s15[Hn] || [];
}
function ie(s15) {
  if (Fn.has(s15)) return Fn.get(s15);
  let t = function(e, i, r) {
    if (arguments.length !== 3) throw new Error("@IServiceName-decorator can only be used to decorate a parameter");
    Pl(t, e, r);
  };
  return t._id = s15, Fn.set(s15, t), t;
}
function Pl(s15, t, e) {
  t[js] === t ? t[Hn].push({ id: s15, index: e }) : (t[Hn] = [{ id: s15, index: e }], t[js] = t);
}
function Ol(s15, t) {
  if (confirm(`Do you want to navigate to ${t}?

WARNING: This link could potentially be dangerous`)) {
    let i = window.open();
    if (i) {
      try {
        i.opener = null;
      } catch {
      }
      i.location.href = t;
    } else console.warn("Opening link blocked as opener could not be cleared");
  }
}
function Lt(s15) {
  Nl(s15) || Bl.onUnexpectedError(s15);
}
function Nl(s15) {
  return s15 instanceof bi ? true : s15 instanceof Error && s15.name === Un && s15.message === Un;
}
function eo(s15) {
  return s15 ? new Error(`Illegal argument: ${s15}`) : new Error("Illegal argument");
}
function Fl(s15, t, e = 0, i = s15.length) {
  let r = e, n = i;
  for (; r < n; ) {
    let o = Math.floor((r + n) / 2);
    t(s15[o]) ? r = o + 1 : n = o;
  }
  return r - 1;
}
function Se(s15, t = 0) {
  return s15[s15.length - (1 + t)];
}
function no(s15, t) {
  return (e, i) => t(s15(e), s15(i));
}
function co(s15, t) {
  let e = /* @__PURE__ */ Object.create(null);
  for (let i of s15) {
    let r = t(i), n = e[r];
    n || (n = e[r] = []), n.push(i);
  }
  return e;
}
function Kn(s15, t) {
  let e = this, i = false, r;
  return function() {
    if (i) return r;
    if (i = true, t) try {
      r = s15.apply(e, arguments);
    } finally {
      t();
    }
    else r = s15.apply(e, arguments);
    return r;
  };
}
function Ul(s15) {
  dt = s15;
}
function fr(s15) {
  return dt?.trackDisposable(s15), s15;
}
function pr(s15) {
  dt?.markAsDisposed(s15);
}
function vi(s15, t) {
  dt?.setParent(s15, t);
}
function Kl(s15, t) {
  if (dt) for (let e of s15) dt.setParent(e, t);
}
function Gn(s15) {
  return dt?.markAsSingleton(s15), s15;
}
function Ne(s15) {
  if (zn.is(s15)) {
    let t = [];
    for (let e of s15) if (e) try {
      e.dispose();
    } catch (i) {
      t.push(i);
    }
    if (t.length === 1) throw t[0];
    if (t.length > 1) throw new AggregateError(t, "Encountered errors while disposing of store");
    return Array.isArray(s15) ? [] : s15;
  } else if (s15) return s15.dispose(), s15;
}
function ho(...s15) {
  let t = C(() => Ne(s15));
  return Kl(s15, t), t;
}
function C(s15) {
  let t = fr({ dispose: Kn(() => {
    pr(t), s15();
  }) });
  return t;
}
function Xl(s15, t, e) {
  typeof t == "string" && (t = s15.matchMedia(t)), t.addEventListener("change", e);
}
function mo(s15) {
  return Si.INSTANCE.getZoomFactor(s15);
}
function _o() {
  return vr;
}
function ca(s15) {
  if (s15.charCode) {
    let e = String.fromCharCode(s15.charCode).toUpperCase();
    return Qn.fromString(e);
  }
  let t = s15.keyCode;
  if (t === 3) return 7;
  if (Ei) switch (t) {
    case 59:
      return 85;
    case 60:
      if (Zn) return 97;
      break;
    case 61:
      return 86;
    case 107:
      return 109;
    case 109:
      return 111;
    case 173:
      return 88;
    case 224:
      if (Te) return 57;
      break;
  }
  else if (Bt) {
    if (Te && t === 93) return 57;
    if (!Te && t === 92) return 57;
  }
  return yo[t] || 0;
}
function pa(s15) {
  if (!s15.parent || s15.parent === s15) return null;
  try {
    let t = s15.location, e = s15.parent.location;
    if (t.origin !== "null" && e.origin !== "null" && t.origin !== e.origin) return null;
  } catch {
    return null;
  }
  return s15.parent;
}
function Lo(s15) {
  return 55296 <= s15 && s15 <= 56319;
}
function is(s15) {
  return 56320 <= s15 && s15 <= 57343;
}
function Ao(s15, t) {
  return (s15 - 55296 << 10) + (t - 56320) + 65536;
}
function Mo(s15) {
  return ns(s15, 0);
}
function ns(s15, t) {
  switch (typeof s15) {
    case "object":
      return s15 === null ? je(349, t) : Array.isArray(s15) ? Ea(s15, t) : Ta(s15, t);
    case "string":
      return Po(s15, t);
    case "boolean":
      return Sa(s15, t);
    case "number":
      return je(s15, t);
    case "undefined":
      return je(937, t);
    default:
      return je(617, t);
  }
}
function je(s15, t) {
  return (t << 5) - t + s15 | 0;
}
function Sa(s15, t) {
  return je(s15 ? 433 : 863, t);
}
function Po(s15, t) {
  t = je(149417, t);
  for (let e = 0, i = s15.length; e < i; e++) t = je(s15.charCodeAt(e), t);
  return t;
}
function Ea(s15, t) {
  return t = je(104579, t), s15.reduce((e, i) => ns(i, e), t);
}
function Ta(s15, t) {
  return t = je(181387, t), Object.keys(s15).sort().reduce((e, i) => (e = Po(i, e), ns(s15[i], e)), t);
}
function rs(s15, t, e = 32) {
  let i = e - t, r = ~((1 << i) - 1);
  return (s15 << t | (r & s15) >>> i) >>> 0;
}
function ko(s15, t = 0, e = s15.byteLength, i = 0) {
  for (let r = 0; r < e; r++) s15[t + r] = i;
}
function Ia(s15, t, e = "0") {
  for (; s15.length < t; ) s15 = e + s15;
  return s15;
}
function wi(s15, t = 32) {
  return s15 instanceof ArrayBuffer ? Array.from(new Uint8Array(s15)).map((e) => e.toString(16).padStart(2, "0")).join("") : Ia((s15 >>> 0).toString(16), t / 4);
}
function L(s15, t, e, i) {
  return new ss(s15, t, e, i);
}
function ya(s15, t) {
  return function(e) {
    return t(new qe(s15, e));
  };
}
function xa(s15) {
  return function(t) {
    return s15(new ft(t));
  };
}
function Fo(s15) {
  let t = s15.getBoundingClientRect(), e = be(s15);
  return { left: t.left + e.scrollX, top: t.top + e.scrollY, width: t.width, height: t.height };
}
function Ho(s15, t, e, ...i) {
  let r = Da.exec(t);
  if (!r) throw new Error("Bad use of emmet");
  let n = r[1] || "div", o;
  return s15 !== "http://www.w3.org/1999/xhtml" ? o = document.createElementNS(s15, n) : o = document.createElement(n), r[3] && (o.id = r[3]), r[4] && (o.className = r[4].replace(/\./g, " ").trim()), e && Object.entries(e).forEach(([l, a]) => {
    typeof a > "u" || (/^on\w+$/.test(l) ? o[l] = a : l === "selected" ? a && o.setAttribute(l, "true") : o.setAttribute(l, a));
  }), o.append(...i), o;
}
function Ra(s15, t, ...e) {
  return Ho("http://www.w3.org/1999/xhtml", s15, t, ...e);
}
function Ie(s15) {
  return typeof s15 == "number" ? `${s15}px` : s15;
}
function _t(s15) {
  return new ls(s15);
}
function Wo(s15, t, e) {
  let i = null, r = null;
  if (typeof e.value == "function" ? (i = "value", r = e.value, r.length !== 0 && console.warn("Memoize should only be used in functions with zero parameters")) : typeof e.get == "function" && (i = "get", r = e.get), !r) throw new Error("not supported");
  let n = `$memoize$${t}`;
  e[i] = function(...o) {
    return this.hasOwnProperty(n) || Object.defineProperty(this, n, { configurable: false, enumerable: false, writable: false, value: r.apply(this, o) }), this[n];
  };
}
function as(s15, t) {
  let e = t - s15;
  return function(i) {
    return s15 + e * ka(i);
  };
}
function La(s15, t, e) {
  return function(i) {
    return i < e ? s15(i / e) : t((i - e) / (1 - e));
  };
}
function Aa(s15) {
  return Math.pow(s15, 3);
}
function ka(s15) {
  return 1 - Aa(1 - s15);
}
function Pa(s15) {
  let t = { lazyRender: typeof s15.lazyRender < "u" ? s15.lazyRender : false, className: typeof s15.className < "u" ? s15.className : "", useShadows: typeof s15.useShadows < "u" ? s15.useShadows : true, handleMouseWheel: typeof s15.handleMouseWheel < "u" ? s15.handleMouseWheel : true, flipAxes: typeof s15.flipAxes < "u" ? s15.flipAxes : false, consumeMouseWheelIfScrollbarIsNeeded: typeof s15.consumeMouseWheelIfScrollbarIsNeeded < "u" ? s15.consumeMouseWheelIfScrollbarIsNeeded : false, alwaysConsumeMouseWheel: typeof s15.alwaysConsumeMouseWheel < "u" ? s15.alwaysConsumeMouseWheel : false, scrollYToX: typeof s15.scrollYToX < "u" ? s15.scrollYToX : false, mouseWheelScrollSensitivity: typeof s15.mouseWheelScrollSensitivity < "u" ? s15.mouseWheelScrollSensitivity : 1, fastScrollSensitivity: typeof s15.fastScrollSensitivity < "u" ? s15.fastScrollSensitivity : 5, scrollPredominantAxis: typeof s15.scrollPredominantAxis < "u" ? s15.scrollPredominantAxis : true, mouseWheelSmoothScroll: typeof s15.mouseWheelSmoothScroll < "u" ? s15.mouseWheelSmoothScroll : true, arrowSize: typeof s15.arrowSize < "u" ? s15.arrowSize : 11, listenOnDomNode: typeof s15.listenOnDomNode < "u" ? s15.listenOnDomNode : null, horizontal: typeof s15.horizontal < "u" ? s15.horizontal : 1, horizontalScrollbarSize: typeof s15.horizontalScrollbarSize < "u" ? s15.horizontalScrollbarSize : 10, horizontalSliderSize: typeof s15.horizontalSliderSize < "u" ? s15.horizontalSliderSize : 0, horizontalHasArrows: typeof s15.horizontalHasArrows < "u" ? s15.horizontalHasArrows : false, vertical: typeof s15.vertical < "u" ? s15.vertical : 1, verticalScrollbarSize: typeof s15.verticalScrollbarSize < "u" ? s15.verticalScrollbarSize : 10, verticalHasArrows: typeof s15.verticalHasArrows < "u" ? s15.verticalHasArrows : false, verticalSliderSize: typeof s15.verticalSliderSize < "u" ? s15.verticalSliderSize : 0, scrollByPage: typeof s15.scrollByPage < "u" ? s15.scrollByPage : false };
  return t.horizontalSliderSize = typeof s15.horizontalSliderSize < "u" ? s15.horizontalSliderSize : t.horizontalScrollbarSize, t.verticalSliderSize = typeof s15.verticalSliderSize < "u" ? s15.verticalSliderSize : t.verticalScrollbarSize, Te && (t.className += " mac"), t;
}
function vt(s15) {
  let t = s15.toString(16);
  return t.length < 2 ? "0" + t : t;
}
function Xe(s15, t) {
  return s15 < t ? (t + 0.05) / (s15 + 0.05) : (s15 + 0.05) / (t + 0.05);
}
function Oa(s15) {
  return 57508 <= s15 && s15 <= 57558;
}
function Ba(s15) {
  return 9472 <= s15 && s15 <= 9631;
}
function $o(s15) {
  return Oa(s15) || Ba(s15);
}
function Vo() {
  return { css: { canvas: qr(), cell: qr() }, device: { canvas: qr(), cell: qr(), char: { width: 0, height: 0, left: 0, top: 0 } } };
}
function qr() {
  return { width: 0, height: 0 };
}
function qo(s15, t, e) {
  for (; s15.length < e; ) s15 = t + s15;
  return s15;
}
function Yo() {
  return new ms();
}
function Ci(s15, t, e) {
  let i = e.getBoundingClientRect(), r = s15.getComputedStyle(e), n = parseInt(r.getPropertyValue("padding-left")), o = parseInt(r.getPropertyValue("padding-top"));
  return [t.clientX - i.left - n, t.clientY - i.top - o];
}
function Xo(s15, t, e, i, r, n, o, l, a) {
  if (!n) return;
  let u = Ci(s15, t, e);
  if (u) return u[0] = Math.ceil((u[0] + (a ? o / 2 : 0)) / o), u[1] = Math.ceil(u[1] / l), u[0] = Math.min(Math.max(u[0], 1), i + (a ? 1 : 0)), u[1] = Math.min(Math.max(u[1], 1), r), u;
}
function Ha() {
  if (!Zo) return 0;
  let s15 = Pi.match(/Version\/(\d+)/);
  return s15 === null || s15.length < 2 ? 0 : parseInt(s15[1]);
}
function Jo(s15, t, e, i) {
  let r = e.buffer.x, n = e.buffer.y;
  if (!e.buffer.hasScrollback) return Ga(r, n, s15, t, e, i) + sn(n, t, e, i) + $a(r, n, s15, t, e, i);
  let o;
  if (n === t) return o = r > s15 ? "D" : "C", Fi(Math.abs(r - s15), Ni(o, i));
  o = n > t ? "D" : "C";
  let l = Math.abs(n - t), a = za(n > t ? s15 : r, e) + (l - 1) * e.cols + 1 + Ka(n > t ? r : s15, e);
  return Fi(a, Ni(o, i));
}
function Ka(s15, t) {
  return s15 - 1;
}
function za(s15, t) {
  return t.cols - s15;
}
function Ga(s15, t, e, i, r, n) {
  return sn(t, i, r, n).length === 0 ? "" : Fi(el(s15, t, s15, t - gt(t, r), false, r).length, Ni("D", n));
}
function sn(s15, t, e, i) {
  let r = s15 - gt(s15, e), n = t - gt(t, e), o = Math.abs(r - n) - Va(s15, t, e);
  return Fi(o, Ni(Qo(s15, t), i));
}
function $a(s15, t, e, i, r, n) {
  let o;
  sn(t, i, r, n).length > 0 ? o = i - gt(i, r) : o = t;
  let l = i, a = qa(s15, t, e, i, r, n);
  return Fi(el(s15, o, e, l, a === "C", r).length, Ni(a, n));
}
function Va(s15, t, e) {
  let i = 0, r = s15 - gt(s15, e), n = t - gt(t, e);
  for (let o = 0; o < Math.abs(r - n); o++) {
    let l = Qo(s15, t) === "A" ? -1 : 1;
    e.buffer.lines.get(r + l * o)?.isWrapped && i++;
  }
  return i;
}
function gt(s15, t) {
  let e = 0, i = t.buffer.lines.get(s15), r = i?.isWrapped;
  for (; r && s15 >= 0 && s15 < t.rows; ) e++, i = t.buffer.lines.get(--s15), r = i?.isWrapped;
  return e;
}
function qa(s15, t, e, i, r, n) {
  let o;
  return sn(e, i, r, n).length > 0 ? o = i - gt(i, r) : o = t, s15 < e && o <= i || s15 >= e && o < i ? "C" : "D";
}
function Qo(s15, t) {
  return s15 > t ? "A" : "B";
}
function el(s15, t, e, i, r, n) {
  let o = s15, l = t, a = "";
  for (; (o !== e || l !== i) && l >= 0 && l < n.buffer.lines.length; ) o += r ? 1 : -1, r && o > n.cols - 1 ? (a += n.buffer.translateBufferLineToString(l, false, s15, o), o = 0, s15 = 0, l++) : !r && o < 0 && (a += n.buffer.translateBufferLineToString(l, false, 0, s15 + 1), o = n.cols - 1, s15 = o, l--);
  return a + n.buffer.translateBufferLineToString(l, false, s15, o);
}
function Ni(s15, t) {
  let e = t ? "O" : "[";
  return b.ESC + e + s15;
}
function Fi(s15, t) {
  s15 = Math.floor(s15);
  let e = "";
  for (let i = 0; i < s15; i++) e += t;
  return e;
}
function ws(s15, t) {
  if (s15.start.y > s15.end.y) throw new Error(`Buffer range end (${s15.end.x}, ${s15.end.y}) cannot be before start (${s15.start.x}, ${s15.start.y})`);
  return t * (s15.end.y - s15.start.y) + (s15.end.x - s15.start.x + 1);
}
function K(s15, t) {
  if (s15 !== void 0) try {
    return z.toColor(s15);
  } catch {
  }
  return t;
}
function sl(s15, t, e, i, r, n) {
  let o = [];
  for (let l = 0; l < s15.length - 1; l++) {
    let a = l, u = s15.get(++a);
    if (!u.isWrapped) continue;
    let h8 = [s15.get(l)];
    for (; a < s15.length && u.isWrapped; ) h8.push(u), u = s15.get(++a);
    if (!n && i >= l && i < a) {
      l += h8.length - 1;
      continue;
    }
    let c = 0, d = ri(h8, c, t), _ = 1, p = 0;
    for (; _ < h8.length; ) {
      let f = ri(h8, _, t), A = f - p, R = e - d, O = Math.min(A, R);
      h8[c].copyCellsFrom(h8[_], p, d, O, false), d += O, d === e && (c++, d = 0), p += O, p === f && (_++, p = 0), d === 0 && c !== 0 && h8[c - 1].getWidth(e - 1) === 2 && (h8[c].copyCellsFrom(h8[c - 1], e - 1, d++, 1, false), h8[c - 1].setCell(e - 1, r));
    }
    h8[c].replaceCells(d, e, r);
    let m = 0;
    for (let f = h8.length - 1; f > 0 && (f > c || h8[f].getTrimmedLength() === 0); f--) m++;
    m > 0 && (o.push(l + h8.length - m), o.push(m)), l += h8.length - 1;
  }
  return o;
}
function ol(s15, t) {
  let e = [], i = 0, r = t[i], n = 0;
  for (let o = 0; o < s15.length; o++) if (r === o) {
    let l = t[++i];
    s15.onDeleteEmitter.fire({ index: o - n, amount: l }), o += l - 1, n += l, r = t[++i];
  } else e.push(o);
  return { layout: e, countRemoved: n };
}
function ll(s15, t) {
  let e = [];
  for (let i = 0; i < t.length; i++) e.push(s15.get(t[i]));
  for (let i = 0; i < e.length; i++) s15.set(i, e[i]);
  s15.length = t.length;
}
function al(s15, t, e) {
  let i = [], r = s15.map((a, u) => ri(s15, u, t)).reduce((a, u) => a + u), n = 0, o = 0, l = 0;
  for (; l < r; ) {
    if (r - l < e) {
      i.push(r - l);
      break;
    }
    n += e;
    let a = ri(s15, o, t);
    n > a && (n -= a, o++);
    let u = s15[o].getWidth(n - 1) === 2;
    u && n--;
    let h8 = u ? e - 1 : e;
    i.push(h8), l += h8;
  }
  return i;
}
function ri(s15, t, e) {
  if (t === s15.length - 1) return s15[t].getTrimmedLength();
  let i = !s15[t].hasContent(e - 1) && s15[t].getWidth(e - 1) === 1, r = s15[t + 1].getWidth(0) === 2;
  return i && r ? e - 1 : e;
}
function sc(s15) {
  return s15 === "block" || s15 === "underline" || s15 === "bar";
}
function oi(s15, t = 5) {
  if (typeof s15 != "object") return s15;
  let e = Array.isArray(s15) ? [] : {};
  for (let i in s15) e[i] = t <= 1 ? s15[i] : s15[i] && oi(s15[i], t - 1);
  return e;
}
function Ms(s15, t) {
  let e = (s15.ctrl ? 16 : 0) | (s15.shift ? 4 : 0) | (s15.alt ? 8 : 0);
  return s15.button === 4 ? (e |= 64, e |= s15.action) : (e |= s15.button & 3, s15.button & 4 && (e |= 64), s15.button & 8 && (e |= 128), s15.action === 32 ? e |= 32 : s15.action === 0 && !t && (e |= 3)), e;
}
function cc(s15, t) {
  let e = 0, i = t.length - 1, r;
  if (s15 < t[0][0] || s15 > t[i][1]) return false;
  for (; i >= e; ) if (r = e + i >> 1, s15 > t[r][1]) e = r + 1;
  else if (s15 < t[r][0]) i = r - 1;
  else return true;
  return false;
}
function Bs(s15) {
  let e = s15.buffer.lines.get(s15.buffer.ybase + s15.buffer.y - 1)?.get(s15.cols - 1), i = s15.buffer.lines.get(s15.buffer.ybase + s15.buffer.y);
  i && e && (i.isWrapped = e[3] !== 0 && e[3] !== 32);
}
function Ws(s15) {
  if (!s15) return;
  let t = s15.toLowerCase();
  if (t.indexOf("rgb:") === 0) {
    t = t.slice(4);
    let e = dc.exec(t);
    if (e) {
      let i = e[1] ? 15 : e[4] ? 255 : e[7] ? 4095 : 65535;
      return [Math.round(parseInt(e[1] || e[4] || e[7] || e[10], 16) / i * 255), Math.round(parseInt(e[2] || e[5] || e[8] || e[11], 16) / i * 255), Math.round(parseInt(e[3] || e[6] || e[9] || e[12], 16) / i * 255)];
    }
  } else if (t.indexOf("#") === 0 && (t = t.slice(1), fc.exec(t) && [3, 6, 9, 12].includes(t.length))) {
    let e = t.length / 3, i = [0, 0, 0];
    for (let r = 0; r < 3; ++r) {
      let n = parseInt(t.slice(e * r, e * r + e), 16);
      i[r] = e === 1 ? n << 4 : e === 2 ? n : e === 3 ? n >> 4 : n >> 8;
    }
    return i;
  }
}
function Hs(s15, t) {
  let e = s15.toString(16), i = e.length < 2 ? "0" + e : e;
  switch (t) {
    case 4:
      return e[0];
    case 8:
      return i;
    case 12:
      return (i + i).slice(0, 3);
    default:
      return i + i;
  }
}
function ml(s15, t = 16) {
  let [e, i, r] = s15;
  return `rgb:${Hs(e, t)}/${Hs(i, t)}/${Hs(r, t)}`;
}
function bl(s15, t) {
  if (s15 > 24) return t.setWinLines || false;
  switch (s15) {
    case 1:
      return !!t.restoreWin;
    case 2:
      return !!t.minimizeWin;
    case 3:
      return !!t.setWinPosition;
    case 4:
      return !!t.setWinSizePixels;
    case 5:
      return !!t.raiseWin;
    case 6:
      return !!t.lowerWin;
    case 7:
      return !!t.refreshWin;
    case 8:
      return !!t.setWinSizeChars;
    case 9:
      return !!t.maximizeWin;
    case 10:
      return !!t.fullscreenWin;
    case 11:
      return !!t.getWinState;
    case 13:
      return !!t.getWinPosition;
    case 14:
      return !!t.getWinSizePixels;
    case 15:
      return !!t.getScreenSizePixels;
    case 16:
      return !!t.getCellSizePixels;
    case 18:
      return !!t.getWinSizeChars;
    case 19:
      return !!t.getScreenSizeChars;
    case 20:
      return !!t.getIconTitle;
    case 21:
      return !!t.getWinTitle;
    case 22:
      return !!t.pushTitle;
    case 23:
      return !!t.popTitle;
    case 24:
      return !!t.setWinLines;
  }
  return false;
}
function Sl(s15) {
  return 0 <= s15 && s15 < 256;
}
function Il(s15, t, e, i) {
  let r = { type: 0, cancel: false, key: void 0 }, n = (s15.shiftKey ? 1 : 0) | (s15.altKey ? 2 : 0) | (s15.ctrlKey ? 4 : 0) | (s15.metaKey ? 8 : 0);
  switch (s15.keyCode) {
    case 0:
      s15.key === "UIKeyInputUpArrow" ? t ? r.key = b.ESC + "OA" : r.key = b.ESC + "[A" : s15.key === "UIKeyInputLeftArrow" ? t ? r.key = b.ESC + "OD" : r.key = b.ESC + "[D" : s15.key === "UIKeyInputRightArrow" ? t ? r.key = b.ESC + "OC" : r.key = b.ESC + "[C" : s15.key === "UIKeyInputDownArrow" && (t ? r.key = b.ESC + "OB" : r.key = b.ESC + "[B");
      break;
    case 8:
      r.key = s15.ctrlKey ? "\b" : b.DEL, s15.altKey && (r.key = b.ESC + r.key);
      break;
    case 9:
      if (s15.shiftKey) {
        r.key = b.ESC + "[Z";
        break;
      }
      r.key = b.HT, r.cancel = true;
      break;
    case 13:
      r.key = s15.altKey ? b.ESC + b.CR : b.CR, r.cancel = true;
      break;
    case 27:
      r.key = b.ESC, s15.altKey && (r.key = b.ESC + b.ESC), r.cancel = true;
      break;
    case 37:
      if (s15.metaKey) break;
      n ? r.key = b.ESC + "[1;" + (n + 1) + "D" : t ? r.key = b.ESC + "OD" : r.key = b.ESC + "[D";
      break;
    case 39:
      if (s15.metaKey) break;
      n ? r.key = b.ESC + "[1;" + (n + 1) + "C" : t ? r.key = b.ESC + "OC" : r.key = b.ESC + "[C";
      break;
    case 38:
      if (s15.metaKey) break;
      n ? r.key = b.ESC + "[1;" + (n + 1) + "A" : t ? r.key = b.ESC + "OA" : r.key = b.ESC + "[A";
      break;
    case 40:
      if (s15.metaKey) break;
      n ? r.key = b.ESC + "[1;" + (n + 1) + "B" : t ? r.key = b.ESC + "OB" : r.key = b.ESC + "[B";
      break;
    case 45:
      !s15.shiftKey && !s15.ctrlKey && (r.key = b.ESC + "[2~");
      break;
    case 46:
      n ? r.key = b.ESC + "[3;" + (n + 1) + "~" : r.key = b.ESC + "[3~";
      break;
    case 36:
      n ? r.key = b.ESC + "[1;" + (n + 1) + "H" : t ? r.key = b.ESC + "OH" : r.key = b.ESC + "[H";
      break;
    case 35:
      n ? r.key = b.ESC + "[1;" + (n + 1) + "F" : t ? r.key = b.ESC + "OF" : r.key = b.ESC + "[F";
      break;
    case 33:
      s15.shiftKey ? r.type = 2 : s15.ctrlKey ? r.key = b.ESC + "[5;" + (n + 1) + "~" : r.key = b.ESC + "[5~";
      break;
    case 34:
      s15.shiftKey ? r.type = 3 : s15.ctrlKey ? r.key = b.ESC + "[6;" + (n + 1) + "~" : r.key = b.ESC + "[6~";
      break;
    case 112:
      n ? r.key = b.ESC + "[1;" + (n + 1) + "P" : r.key = b.ESC + "OP";
      break;
    case 113:
      n ? r.key = b.ESC + "[1;" + (n + 1) + "Q" : r.key = b.ESC + "OQ";
      break;
    case 114:
      n ? r.key = b.ESC + "[1;" + (n + 1) + "R" : r.key = b.ESC + "OR";
      break;
    case 115:
      n ? r.key = b.ESC + "[1;" + (n + 1) + "S" : r.key = b.ESC + "OS";
      break;
    case 116:
      n ? r.key = b.ESC + "[15;" + (n + 1) + "~" : r.key = b.ESC + "[15~";
      break;
    case 117:
      n ? r.key = b.ESC + "[17;" + (n + 1) + "~" : r.key = b.ESC + "[17~";
      break;
    case 118:
      n ? r.key = b.ESC + "[18;" + (n + 1) + "~" : r.key = b.ESC + "[18~";
      break;
    case 119:
      n ? r.key = b.ESC + "[19;" + (n + 1) + "~" : r.key = b.ESC + "[19~";
      break;
    case 120:
      n ? r.key = b.ESC + "[20;" + (n + 1) + "~" : r.key = b.ESC + "[20~";
      break;
    case 121:
      n ? r.key = b.ESC + "[21;" + (n + 1) + "~" : r.key = b.ESC + "[21~";
      break;
    case 122:
      n ? r.key = b.ESC + "[23;" + (n + 1) + "~" : r.key = b.ESC + "[23~";
      break;
    case 123:
      n ? r.key = b.ESC + "[24;" + (n + 1) + "~" : r.key = b.ESC + "[24~";
      break;
    default:
      if (s15.ctrlKey && !s15.shiftKey && !s15.altKey && !s15.metaKey) s15.keyCode >= 65 && s15.keyCode <= 90 ? r.key = String.fromCharCode(s15.keyCode - 64) : s15.keyCode === 32 ? r.key = b.NUL : s15.keyCode >= 51 && s15.keyCode <= 55 ? r.key = String.fromCharCode(s15.keyCode - 51 + 27) : s15.keyCode === 56 ? r.key = b.DEL : s15.keyCode === 219 ? r.key = b.ESC : s15.keyCode === 220 ? r.key = b.FS : s15.keyCode === 221 && (r.key = b.GS);
      else if ((!e || i) && s15.altKey && !s15.metaKey) {
        let l = gc[s15.keyCode]?.[s15.shiftKey ? 1 : 0];
        if (l) r.key = b.ESC + l;
        else if (s15.keyCode >= 65 && s15.keyCode <= 90) {
          let a = s15.ctrlKey ? s15.keyCode - 64 : s15.keyCode + 32, u = String.fromCharCode(a);
          s15.shiftKey && (u = u.toUpperCase()), r.key = b.ESC + u;
        } else if (s15.keyCode === 32) r.key = b.ESC + (s15.ctrlKey ? b.NUL : " ");
        else if (s15.key === "Dead" && s15.code.startsWith("Key")) {
          let a = s15.code.slice(3, 4);
          s15.shiftKey || (a = a.toLowerCase()), r.key = b.ESC + a, r.cancel = true;
        }
      } else e && !s15.altKey && !s15.ctrlKey && !s15.shiftKey && s15.metaKey ? s15.keyCode === 65 && (r.type = 1) : s15.key && !s15.ctrlKey && !s15.altKey && !s15.metaKey && s15.keyCode >= 48 && s15.key.length === 1 ? r.key = s15.key : s15.key && s15.ctrlKey && (s15.key === "_" && (r.key = b.US), s15.key === "@" && (r.key = b.NUL));
      break;
  }
  return r;
}
function Ec(s15, t) {
  return s15.text === t.text && s15.range.start.x === t.range.start.x && s15.range.start.y === t.range.start.y && s15.range.end.x === t.range.end.x && s15.range.end.y === t.range.end.y;
}
function Tc(s15) {
  return s15.keyCode === 16 || s15.keyCode === 17 || s15.keyCode === 18;
}
var zs, Rl, Ll, M, S, Gs, mi, $s, _i, er, tr, ir, we, De, rt, q, js, Hn, Fn, F, rr, ge, Zs, xt, nr, H, sr, Js, Be, wt, nt, ae, Dt, ce, Qs, or, Re, lr, Wn, Bl, Un, bi, ar, Rt, cr, to, ro, so, At, io, lo, ao, oo, ur, zn, Wl, dt, hr, uo, dr, Ee, D, ye, fe, kt, G, Ct, zl, mr, Gl, fo, $l, $, Mt, $n, po, br, Vn, gi, qn, Yn, Vl, Pt, ql, Yl, _r, v, jn, gr, Si, Eu, Tu, Ot, Ei, Bt, Ti, Sr, Iu, yu, vr, Nt, yr, xr, Ii, Zl, vo, go, Jl, Ql, ea, ta, Tr, Ir, bo, ia, $e, Ve, xe, So, ra, Xn, wr, Te, Zn, Dr, na, xu, Fe, st, sa, oa, Eo, la, wu, Du, Ru, Lu, ot, aa, yi, Jn, To, Io, yo, Qn, Rr, es, ua, ha, da, fa, ft, wo, Lr, qe, xi, Do, ma, ts, _a, Ye, kr, ba, Ar, va, _e, Ro, Cr, Co, Bh, be, Nh, Fh, Hh, Oo, Wh, Uh, No, Kh, zh, ss, os, wa, mt, Mr, Di, pt, Bo, Gh, Y, Da, ls, Wt, He, Q, Pr, lt, Uo, Or, cs, Ri, Br, Nr, Fr, Ca, Ut, Kt, Wr, Ur, Ma, Ko, zo, us, zr, hs, ds, Kr, zt, Gt, Gr, We, at, Li, bt, b, Ai, fs, $t, ue, he, de, J, ps, j, U, z, ve, $r, Vr, ct, Vt, Yr, ms, _s, Le, jr, jo, ki, Xr, Na, Yt, jt, Zr, bs, vs, Jr, gs, Qr, Xt, en, tn, Mi, Pi, Oi, Ss, Fa, Zo, Zt, Wa, Ua, Es, Bi, Ts, rn, Is, ys, Jt, nn, Qt, xs, on, Ds, Ya, ja, Xa, Za, Ja, ei, Hi, Wi, re, St, Ki, tl, il, Ui, Qa, ti, Rs, ln, ec, tc, ii, ic, zi, B, X, an, Ls, Ze, un, cn, ne, Je, cl, $i, hn, ks, Cs, ni, si, nc, dn, ul, hl, li, dl, Ps, fl, ai, Os, ac, se, fn, Ae, pn, Vi, uc, ci, qi, mn, pe, Yi, _n, ji, Xi, Fs, ke, hc, bn, dc, fc, mc, ut, _l, vl, gl, vn, Zi, _c, El, bc, gn, ui, Tl, Sn, gc, ee, En, Us, yl, Tn, Ks, Sc, In, xl, wl, Tt, hi, yn, xn, wn, Ji, Dn, Rn, Ln, Ic, Ue, Dl;
var init_xterm = __esm({
  "node_modules/@xterm/xterm/lib/xterm.mjs"() {
    zs = Object.defineProperty;
    Rl = Object.getOwnPropertyDescriptor;
    Ll = (s15, t) => {
      for (var e in t) zs(s15, e, { get: t[e], enumerable: true });
    };
    M = (s15, t, e, i) => {
      for (var r = i > 1 ? void 0 : i ? Rl(t, e) : t, n = s15.length - 1, o; n >= 0; n--) (o = s15[n]) && (r = (i ? o(t, e, r) : o(r)) || r);
      return i && r && zs(t, e, r), r;
    }, S = (s15, t) => (e, i) => t(e, i, s15);
    Gs = "Terminal input", mi = { get: () => Gs, set: (s15) => Gs = s15 }, $s = "Too much output to announce, navigate to rows manually to read", _i = { get: () => $s, set: (s15) => $s = s15 };
    er = class {
      constructor() {
        this._interim = 0;
      }
      clear() {
        this._interim = 0;
      }
      decode(t, e) {
        let i = t.length;
        if (!i) return 0;
        let r = 0, n = 0;
        if (this._interim) {
          let o = t.charCodeAt(n++);
          56320 <= o && o <= 57343 ? e[r++] = (this._interim - 55296) * 1024 + o - 56320 + 65536 : (e[r++] = this._interim, e[r++] = o), this._interim = 0;
        }
        for (let o = n; o < i; ++o) {
          let l = t.charCodeAt(o);
          if (55296 <= l && l <= 56319) {
            if (++o >= i) return this._interim = l, r;
            let a = t.charCodeAt(o);
            56320 <= a && a <= 57343 ? e[r++] = (l - 55296) * 1024 + a - 56320 + 65536 : (e[r++] = l, e[r++] = a);
            continue;
          }
          l !== 65279 && (e[r++] = l);
        }
        return r;
      }
    }, tr = class {
      constructor() {
        this.interim = new Uint8Array(3);
      }
      clear() {
        this.interim.fill(0);
      }
      decode(t, e) {
        let i = t.length;
        if (!i) return 0;
        let r = 0, n, o, l, a, u = 0, h8 = 0;
        if (this.interim[0]) {
          let _ = false, p = this.interim[0];
          p &= (p & 224) === 192 ? 31 : (p & 240) === 224 ? 15 : 7;
          let m = 0, f;
          for (; (f = this.interim[++m] & 63) && m < 4; ) p <<= 6, p |= f;
          let A = (this.interim[0] & 224) === 192 ? 2 : (this.interim[0] & 240) === 224 ? 3 : 4, R = A - m;
          for (; h8 < R; ) {
            if (h8 >= i) return 0;
            if (f = t[h8++], (f & 192) !== 128) {
              h8--, _ = true;
              break;
            } else this.interim[m++] = f, p <<= 6, p |= f & 63;
          }
          _ || (A === 2 ? p < 128 ? h8-- : e[r++] = p : A === 3 ? p < 2048 || p >= 55296 && p <= 57343 || p === 65279 || (e[r++] = p) : p < 65536 || p > 1114111 || (e[r++] = p)), this.interim.fill(0);
        }
        let c = i - 4, d = h8;
        for (; d < i; ) {
          for (; d < c && !((n = t[d]) & 128) && !((o = t[d + 1]) & 128) && !((l = t[d + 2]) & 128) && !((a = t[d + 3]) & 128); ) e[r++] = n, e[r++] = o, e[r++] = l, e[r++] = a, d += 4;
          if (n = t[d++], n < 128) e[r++] = n;
          else if ((n & 224) === 192) {
            if (d >= i) return this.interim[0] = n, r;
            if (o = t[d++], (o & 192) !== 128) {
              d--;
              continue;
            }
            if (u = (n & 31) << 6 | o & 63, u < 128) {
              d--;
              continue;
            }
            e[r++] = u;
          } else if ((n & 240) === 224) {
            if (d >= i) return this.interim[0] = n, r;
            if (o = t[d++], (o & 192) !== 128) {
              d--;
              continue;
            }
            if (d >= i) return this.interim[0] = n, this.interim[1] = o, r;
            if (l = t[d++], (l & 192) !== 128) {
              d--;
              continue;
            }
            if (u = (n & 15) << 12 | (o & 63) << 6 | l & 63, u < 2048 || u >= 55296 && u <= 57343 || u === 65279) continue;
            e[r++] = u;
          } else if ((n & 248) === 240) {
            if (d >= i) return this.interim[0] = n, r;
            if (o = t[d++], (o & 192) !== 128) {
              d--;
              continue;
            }
            if (d >= i) return this.interim[0] = n, this.interim[1] = o, r;
            if (l = t[d++], (l & 192) !== 128) {
              d--;
              continue;
            }
            if (d >= i) return this.interim[0] = n, this.interim[1] = o, this.interim[2] = l, r;
            if (a = t[d++], (a & 192) !== 128) {
              d--;
              continue;
            }
            if (u = (n & 7) << 18 | (o & 63) << 12 | (l & 63) << 6 | a & 63, u < 65536 || u > 1114111) continue;
            e[r++] = u;
          }
        }
        return r;
      }
    };
    ir = "";
    we = " ";
    De = class s {
      constructor() {
        this.fg = 0;
        this.bg = 0;
        this.extended = new rt();
      }
      static toColorRGB(t) {
        return [t >>> 16 & 255, t >>> 8 & 255, t & 255];
      }
      static fromColorRGB(t) {
        return (t[0] & 255) << 16 | (t[1] & 255) << 8 | t[2] & 255;
      }
      clone() {
        let t = new s();
        return t.fg = this.fg, t.bg = this.bg, t.extended = this.extended.clone(), t;
      }
      isInverse() {
        return this.fg & 67108864;
      }
      isBold() {
        return this.fg & 134217728;
      }
      isUnderline() {
        return this.hasExtendedAttrs() && this.extended.underlineStyle !== 0 ? 1 : this.fg & 268435456;
      }
      isBlink() {
        return this.fg & 536870912;
      }
      isInvisible() {
        return this.fg & 1073741824;
      }
      isItalic() {
        return this.bg & 67108864;
      }
      isDim() {
        return this.bg & 134217728;
      }
      isStrikethrough() {
        return this.fg & 2147483648;
      }
      isProtected() {
        return this.bg & 536870912;
      }
      isOverline() {
        return this.bg & 1073741824;
      }
      getFgColorMode() {
        return this.fg & 50331648;
      }
      getBgColorMode() {
        return this.bg & 50331648;
      }
      isFgRGB() {
        return (this.fg & 50331648) === 50331648;
      }
      isBgRGB() {
        return (this.bg & 50331648) === 50331648;
      }
      isFgPalette() {
        return (this.fg & 50331648) === 16777216 || (this.fg & 50331648) === 33554432;
      }
      isBgPalette() {
        return (this.bg & 50331648) === 16777216 || (this.bg & 50331648) === 33554432;
      }
      isFgDefault() {
        return (this.fg & 50331648) === 0;
      }
      isBgDefault() {
        return (this.bg & 50331648) === 0;
      }
      isAttributeDefault() {
        return this.fg === 0 && this.bg === 0;
      }
      getFgColor() {
        switch (this.fg & 50331648) {
          case 16777216:
          case 33554432:
            return this.fg & 255;
          case 50331648:
            return this.fg & 16777215;
          default:
            return -1;
        }
      }
      getBgColor() {
        switch (this.bg & 50331648) {
          case 16777216:
          case 33554432:
            return this.bg & 255;
          case 50331648:
            return this.bg & 16777215;
          default:
            return -1;
        }
      }
      hasExtendedAttrs() {
        return this.bg & 268435456;
      }
      updateExtended() {
        this.extended.isEmpty() ? this.bg &= -268435457 : this.bg |= 268435456;
      }
      getUnderlineColor() {
        if (this.bg & 268435456 && ~this.extended.underlineColor) switch (this.extended.underlineColor & 50331648) {
          case 16777216:
          case 33554432:
            return this.extended.underlineColor & 255;
          case 50331648:
            return this.extended.underlineColor & 16777215;
          default:
            return this.getFgColor();
        }
        return this.getFgColor();
      }
      getUnderlineColorMode() {
        return this.bg & 268435456 && ~this.extended.underlineColor ? this.extended.underlineColor & 50331648 : this.getFgColorMode();
      }
      isUnderlineColorRGB() {
        return this.bg & 268435456 && ~this.extended.underlineColor ? (this.extended.underlineColor & 50331648) === 50331648 : this.isFgRGB();
      }
      isUnderlineColorPalette() {
        return this.bg & 268435456 && ~this.extended.underlineColor ? (this.extended.underlineColor & 50331648) === 16777216 || (this.extended.underlineColor & 50331648) === 33554432 : this.isFgPalette();
      }
      isUnderlineColorDefault() {
        return this.bg & 268435456 && ~this.extended.underlineColor ? (this.extended.underlineColor & 50331648) === 0 : this.isFgDefault();
      }
      getUnderlineStyle() {
        return this.fg & 268435456 ? this.bg & 268435456 ? this.extended.underlineStyle : 1 : 0;
      }
      getUnderlineVariantOffset() {
        return this.extended.underlineVariantOffset;
      }
    }, rt = class s2 {
      constructor(t = 0, e = 0) {
        this._ext = 0;
        this._urlId = 0;
        this._ext = t, this._urlId = e;
      }
      get ext() {
        return this._urlId ? this._ext & -469762049 | this.underlineStyle << 26 : this._ext;
      }
      set ext(t) {
        this._ext = t;
      }
      get underlineStyle() {
        return this._urlId ? 5 : (this._ext & 469762048) >> 26;
      }
      set underlineStyle(t) {
        this._ext &= -469762049, this._ext |= t << 26 & 469762048;
      }
      get underlineColor() {
        return this._ext & 67108863;
      }
      set underlineColor(t) {
        this._ext &= -67108864, this._ext |= t & 67108863;
      }
      get urlId() {
        return this._urlId;
      }
      set urlId(t) {
        this._urlId = t;
      }
      get underlineVariantOffset() {
        let t = (this._ext & 3758096384) >> 29;
        return t < 0 ? t ^ 4294967288 : t;
      }
      set underlineVariantOffset(t) {
        this._ext &= 536870911, this._ext |= t << 29 & 3758096384;
      }
      clone() {
        return new s2(this._ext, this._urlId);
      }
      isEmpty() {
        return this.underlineStyle === 0 && this._urlId === 0;
      }
    };
    q = class s3 extends De {
      constructor() {
        super(...arguments);
        this.content = 0;
        this.fg = 0;
        this.bg = 0;
        this.extended = new rt();
        this.combinedData = "";
      }
      static fromCharData(e) {
        let i = new s3();
        return i.setFromCharData(e), i;
      }
      isCombined() {
        return this.content & 2097152;
      }
      getWidth() {
        return this.content >> 22;
      }
      getChars() {
        return this.content & 2097152 ? this.combinedData : this.content & 2097151 ? Ce(this.content & 2097151) : "";
      }
      getCode() {
        return this.isCombined() ? this.combinedData.charCodeAt(this.combinedData.length - 1) : this.content & 2097151;
      }
      setFromCharData(e) {
        this.fg = e[0], this.bg = 0;
        let i = false;
        if (e[1].length > 2) i = true;
        else if (e[1].length === 2) {
          let r = e[1].charCodeAt(0);
          if (55296 <= r && r <= 56319) {
            let n = e[1].charCodeAt(1);
            56320 <= n && n <= 57343 ? this.content = (r - 55296) * 1024 + n - 56320 + 65536 | e[2] << 22 : i = true;
          } else i = true;
        } else this.content = e[1].charCodeAt(0) | e[2] << 22;
        i && (this.combinedData = e[1], this.content = 2097152 | e[2] << 22);
      }
      getAsCharData() {
        return [this.fg, this.getChars(), this.getWidth(), this.getCode()];
      }
    };
    js = "di$target", Hn = "di$dependencies", Fn = /* @__PURE__ */ new Map();
    F = ie("BufferService"), rr = ie("CoreMouseService"), ge = ie("CoreService"), Zs = ie("CharsetService"), xt = ie("InstantiationService");
    nr = ie("LogService"), H = ie("OptionsService"), sr = ie("OscLinkService"), Js = ie("UnicodeService"), Be = ie("DecorationService");
    wt = class {
      constructor(t, e, i) {
        this._bufferService = t;
        this._optionsService = e;
        this._oscLinkService = i;
      }
      provideLinks(t, e) {
        let i = this._bufferService.buffer.lines.get(t - 1);
        if (!i) {
          e(void 0);
          return;
        }
        let r = [], n = this._optionsService.rawOptions.linkHandler, o = new q(), l = i.getTrimmedLength(), a = -1, u = -1, h8 = false;
        for (let c = 0; c < l; c++) if (!(u === -1 && !i.hasContent(c))) {
          if (i.loadCell(c, o), o.hasExtendedAttrs() && o.extended.urlId) if (u === -1) {
            u = c, a = o.extended.urlId;
            continue;
          } else h8 = o.extended.urlId !== a;
          else u !== -1 && (h8 = true);
          if (h8 || u !== -1 && c === l - 1) {
            let d = this._oscLinkService.getLinkData(a)?.uri;
            if (d) {
              let _ = { start: { x: u + 1, y: t }, end: { x: c + (!h8 && c === l - 1 ? 1 : 0), y: t } }, p = false;
              if (!n?.allowNonHttpProtocols) try {
                let m = new URL(d);
                ["http:", "https:"].includes(m.protocol) || (p = true);
              } catch {
                p = true;
              }
              p || r.push({ text: d, range: _, activate: (m, f) => n ? n.activate(m, f, _) : Ol(m, f), hover: (m, f) => n?.hover?.(m, f, _), leave: (m, f) => n?.leave?.(m, f, _) });
            }
            h8 = false, o.hasExtendedAttrs() && o.extended.urlId ? (u = c, a = o.extended.urlId) : (u = -1, a = -1);
          }
        }
        e(r);
      }
    };
    wt = M([S(0, F), S(1, H), S(2, sr)], wt);
    nt = ie("CharSizeService"), ae = ie("CoreBrowserService"), Dt = ie("MouseService"), ce = ie("RenderService"), Qs = ie("SelectionService"), or = ie("CharacterJoinerService"), Re = ie("ThemeService"), lr = ie("LinkProviderService");
    Wn = class {
      constructor() {
        this.listeners = [], this.unexpectedErrorHandler = function(t) {
          setTimeout(() => {
            throw t.stack ? ar.isErrorNoTelemetry(t) ? new ar(t.message + `

` + t.stack) : new Error(t.message + `

` + t.stack) : t;
          }, 0);
        };
      }
      addListener(t) {
        return this.listeners.push(t), () => {
          this._removeListener(t);
        };
      }
      emit(t) {
        this.listeners.forEach((e) => {
          e(t);
        });
      }
      _removeListener(t) {
        this.listeners.splice(this.listeners.indexOf(t), 1);
      }
      setUnexpectedErrorHandler(t) {
        this.unexpectedErrorHandler = t;
      }
      getUnexpectedErrorHandler() {
        return this.unexpectedErrorHandler;
      }
      onUnexpectedError(t) {
        this.unexpectedErrorHandler(t), this.emit(t);
      }
      onUnexpectedExternalError(t) {
        this.unexpectedErrorHandler(t);
      }
    }, Bl = new Wn();
    Un = "Canceled";
    bi = class extends Error {
      constructor() {
        super(Un), this.name = this.message;
      }
    };
    ar = class s4 extends Error {
      constructor(t) {
        super(t), this.name = "CodeExpectedError";
      }
      static fromError(t) {
        if (t instanceof s4) return t;
        let e = new s4();
        return e.message = t.message, e.stack = t.stack, e;
      }
      static isErrorNoTelemetry(t) {
        return t.name === "CodeExpectedError";
      }
    }, Rt = class s5 extends Error {
      constructor(t) {
        super(t || "An unexpected bug occurred."), Object.setPrototypeOf(this, s5.prototype);
      }
    };
    cr = class cr2 {
      constructor(t) {
        this._array = t;
        this._findLastMonotonousLastIdx = 0;
      }
      findLastMonotonous(t) {
        if (cr2.assertInvariants) {
          if (this._prevFindLastPredicate) {
            for (let i of this._array) if (this._prevFindLastPredicate(i) && !t(i)) throw new Error("MonotonousArray: current predicate must be weaker than (or equal to) the previous predicate.");
          }
          this._prevFindLastPredicate = t;
        }
        let e = Fl(this._array, t, this._findLastMonotonousLastIdx);
        return this._findLastMonotonousLastIdx = e + 1, e === -1 ? void 0 : this._array[e];
      }
    };
    cr.assertInvariants = false;
    to = cr;
    ((l) => {
      function s15(a) {
        return a < 0;
      }
      l.isLessThan = s15;
      function t(a) {
        return a <= 0;
      }
      l.isLessThanOrEqual = t;
      function e(a) {
        return a > 0;
      }
      l.isGreaterThan = e;
      function i(a) {
        return a === 0;
      }
      l.isNeitherLessOrGreaterThan = i, l.greaterThan = 1, l.lessThan = -1, l.neitherLessOrGreaterThan = 0;
    })(ro ||= {});
    so = (s15, t) => s15 - t;
    At = class At2 {
      constructor(t) {
        this.iterate = t;
      }
      forEach(t) {
        this.iterate((e) => (t(e), true));
      }
      toArray() {
        let t = [];
        return this.iterate((e) => (t.push(e), true)), t;
      }
      filter(t) {
        return new At2((e) => this.iterate((i) => t(i) ? e(i) : true));
      }
      map(t) {
        return new At2((e) => this.iterate((i) => e(t(i))));
      }
      some(t) {
        let e = false;
        return this.iterate((i) => (e = t(i), !e)), e;
      }
      findFirst(t) {
        let e;
        return this.iterate((i) => t(i) ? (e = i, false) : true), e;
      }
      findLast(t) {
        let e;
        return this.iterate((i) => (t(i) && (e = i), true)), e;
      }
      findLastMaxBy(t) {
        let e, i = true;
        return this.iterate((r) => ((i || ro.isGreaterThan(t(r, e))) && (i = false, e = r), true)), e;
      }
    };
    At.empty = new At((t) => {
    });
    io = At;
    oo = class {
      constructor(t, e) {
        this.toKey = e;
        this._map = /* @__PURE__ */ new Map();
        this[lo] = "SetWithKey";
        for (let i of t) this.add(i);
      }
      get size() {
        return this._map.size;
      }
      add(t) {
        let e = this.toKey(t);
        return this._map.set(e, t), this;
      }
      delete(t) {
        return this._map.delete(this.toKey(t));
      }
      has(t) {
        return this._map.has(this.toKey(t));
      }
      *entries() {
        for (let t of this._map.values()) yield [t, t];
      }
      keys() {
        return this.values();
      }
      *values() {
        for (let t of this._map.values()) yield t;
      }
      clear() {
        this._map.clear();
      }
      forEach(t, e) {
        this._map.forEach((i) => t.call(e, i, i, this));
      }
      [(ao = Symbol.iterator, lo = Symbol.toStringTag, ao)]() {
        return this.values();
      }
    };
    ur = class {
      constructor() {
        this.map = /* @__PURE__ */ new Map();
      }
      add(t, e) {
        let i = this.map.get(t);
        i || (i = /* @__PURE__ */ new Set(), this.map.set(t, i)), i.add(e);
      }
      delete(t, e) {
        let i = this.map.get(t);
        i && (i.delete(e), i.size === 0 && this.map.delete(t));
      }
      forEach(t, e) {
        let i = this.map.get(t);
        i && i.forEach(e);
      }
      get(t) {
        let e = this.map.get(t);
        return e || /* @__PURE__ */ new Set();
      }
    };
    ((O) => {
      function s15(I) {
        return I && typeof I == "object" && typeof I[Symbol.iterator] == "function";
      }
      O.is = s15;
      let t = Object.freeze([]);
      function e() {
        return t;
      }
      O.empty = e;
      function* i(I) {
        yield I;
      }
      O.single = i;
      function r(I) {
        return s15(I) ? I : i(I);
      }
      O.wrap = r;
      function n(I) {
        return I || t;
      }
      O.from = n;
      function* o(I) {
        for (let k = I.length - 1; k >= 0; k--) yield I[k];
      }
      O.reverse = o;
      function l(I) {
        return !I || I[Symbol.iterator]().next().done === true;
      }
      O.isEmpty = l;
      function a(I) {
        return I[Symbol.iterator]().next().value;
      }
      O.first = a;
      function u(I, k) {
        let P = 0;
        for (let oe of I) if (k(oe, P++)) return true;
        return false;
      }
      O.some = u;
      function h8(I, k) {
        for (let P of I) if (k(P)) return P;
      }
      O.find = h8;
      function* c(I, k) {
        for (let P of I) k(P) && (yield P);
      }
      O.filter = c;
      function* d(I, k) {
        let P = 0;
        for (let oe of I) yield k(oe, P++);
      }
      O.map = d;
      function* _(I, k) {
        let P = 0;
        for (let oe of I) yield* k(oe, P++);
      }
      O.flatMap = _;
      function* p(...I) {
        for (let k of I) yield* k;
      }
      O.concat = p;
      function m(I, k, P) {
        let oe = P;
        for (let Me of I) oe = k(oe, Me);
        return oe;
      }
      O.reduce = m;
      function* f(I, k, P = I.length) {
        for (k < 0 && (k += I.length), P < 0 ? P += I.length : P > I.length && (P = I.length); k < P; k++) yield I[k];
      }
      O.slice = f;
      function A(I, k = Number.POSITIVE_INFINITY) {
        let P = [];
        if (k === 0) return [P, I];
        let oe = I[Symbol.iterator]();
        for (let Me = 0; Me < k; Me++) {
          let Pe = oe.next();
          if (Pe.done) return [P, O.empty()];
          P.push(Pe.value);
        }
        return [P, { [Symbol.iterator]() {
          return oe;
        } }];
      }
      O.consume = A;
      async function R(I) {
        let k = [];
        for await (let P of I) k.push(P);
        return Promise.resolve(k);
      }
      O.asyncToArray = R;
    })(zn ||= {});
    Wl = false, dt = null, hr = class hr2 {
      constructor() {
        this.livingDisposables = /* @__PURE__ */ new Map();
      }
      getDisposableData(t) {
        let e = this.livingDisposables.get(t);
        return e || (e = { parent: null, source: null, isSingleton: false, value: t, idx: hr2.idx++ }, this.livingDisposables.set(t, e)), e;
      }
      trackDisposable(t) {
        let e = this.getDisposableData(t);
        e.source || (e.source = new Error().stack);
      }
      setParent(t, e) {
        let i = this.getDisposableData(t);
        i.parent = e;
      }
      markAsDisposed(t) {
        this.livingDisposables.delete(t);
      }
      markAsSingleton(t) {
        this.getDisposableData(t).isSingleton = true;
      }
      getRootParent(t, e) {
        let i = e.get(t);
        if (i) return i;
        let r = t.parent ? this.getRootParent(this.getDisposableData(t.parent), e) : t;
        return e.set(t, r), r;
      }
      getTrackedDisposables() {
        let t = /* @__PURE__ */ new Map();
        return [...this.livingDisposables.entries()].filter(([, i]) => i.source !== null && !this.getRootParent(i, t).isSingleton).flatMap(([i]) => i);
      }
      computeLeakingDisposables(t = 10, e) {
        let i;
        if (e) i = e;
        else {
          let a = /* @__PURE__ */ new Map(), u = [...this.livingDisposables.values()].filter((c) => c.source !== null && !this.getRootParent(c, a).isSingleton);
          if (u.length === 0) return;
          let h8 = new Set(u.map((c) => c.value));
          if (i = u.filter((c) => !(c.parent && h8.has(c.parent))), i.length === 0) throw new Error("There are cyclic diposable chains!");
        }
        if (!i) return;
        function r(a) {
          function u(c, d) {
            for (; c.length > 0 && d.some((_) => typeof _ == "string" ? _ === c[0] : c[0].match(_)); ) c.shift();
          }
          let h8 = a.source.split(`
`).map((c) => c.trim().replace("at ", "")).filter((c) => c !== "");
          return u(h8, ["Error", /^trackDisposable \(.*\)$/, /^DisposableTracker.trackDisposable \(.*\)$/]), h8.reverse();
        }
        let n = new ur();
        for (let a of i) {
          let u = r(a);
          for (let h8 = 0; h8 <= u.length; h8++) n.add(u.slice(0, h8).join(`
`), a);
        }
        i.sort(no((a) => a.idx, so));
        let o = "", l = 0;
        for (let a of i.slice(0, t)) {
          l++;
          let u = r(a), h8 = [];
          for (let c = 0; c < u.length; c++) {
            let d = u[c];
            d = `(shared with ${n.get(u.slice(0, c + 1).join(`
`)).size}/${i.length} leaks) at ${d}`;
            let p = n.get(u.slice(0, c).join(`
`)), m = co([...p].map((f) => r(f)[c]), (f) => f);
            delete m[u[c]];
            for (let [f, A] of Object.entries(m)) h8.unshift(`    - stacktraces of ${A.length} other leaks continue with ${f}`);
            h8.unshift(d);
          }
          o += `


==================== Leaking disposable ${l}/${i.length}: ${a.value.constructor.name} ====================
${h8.join(`
`)}
============================================================

`;
        }
        return i.length > t && (o += `


... and ${i.length - t} more leaking disposables

`), { leaks: i, details: o };
      }
    };
    hr.idx = 0;
    uo = hr;
    if (Wl) {
      let s15 = "__is_disposable_tracked__";
      Ul(new class {
        trackDisposable(t) {
          let e = new Error("Potentially leaked disposable").stack;
          setTimeout(() => {
            t[s15] || console.log(e);
          }, 3e3);
        }
        setParent(t, e) {
          if (t && t !== D.None) try {
            t[s15] = true;
          } catch {
          }
        }
        markAsDisposed(t) {
          if (t && t !== D.None) try {
            t[s15] = true;
          } catch {
          }
        }
        markAsSingleton(t) {
        }
      }());
    }
    dr = class dr2 {
      constructor() {
        this._toDispose = /* @__PURE__ */ new Set();
        this._isDisposed = false;
        fr(this);
      }
      dispose() {
        this._isDisposed || (pr(this), this._isDisposed = true, this.clear());
      }
      get isDisposed() {
        return this._isDisposed;
      }
      clear() {
        if (this._toDispose.size !== 0) try {
          Ne(this._toDispose);
        } finally {
          this._toDispose.clear();
        }
      }
      add(t) {
        if (!t) return t;
        if (t === this) throw new Error("Cannot register a disposable on itself!");
        return vi(t, this), this._isDisposed ? dr2.DISABLE_DISPOSED_WARNING || console.warn(new Error("Trying to add a disposable to a DisposableStore that has already been disposed of. The added object will be leaked!").stack) : this._toDispose.add(t), t;
      }
      delete(t) {
        if (t) {
          if (t === this) throw new Error("Cannot dispose a disposable on itself!");
          this._toDispose.delete(t), t.dispose();
        }
      }
      deleteAndLeak(t) {
        t && this._toDispose.has(t) && (this._toDispose.delete(t), vi(t, null));
      }
    };
    dr.DISABLE_DISPOSED_WARNING = false;
    Ee = dr, D = class {
      constructor() {
        this._store = new Ee();
        fr(this), vi(this._store, this);
      }
      dispose() {
        pr(this), this._store.dispose();
      }
      _register(t) {
        if (t === this) throw new Error("Cannot register a disposable on itself!");
        return this._store.add(t);
      }
    };
    D.None = Object.freeze({ dispose() {
    } });
    ye = class {
      constructor() {
        this._isDisposed = false;
        fr(this);
      }
      get value() {
        return this._isDisposed ? void 0 : this._value;
      }
      set value(t) {
        this._isDisposed || t === this._value || (this._value?.dispose(), t && vi(t, this), this._value = t);
      }
      clear() {
        this.value = void 0;
      }
      dispose() {
        this._isDisposed = true, pr(this), this._value?.dispose(), this._value = void 0;
      }
      clearAndLeak() {
        let t = this._value;
        return this._value = void 0, t && vi(t, null), t;
      }
    };
    fe = typeof window == "object" ? window : globalThis;
    kt = class kt2 {
      constructor(t) {
        this.element = t, this.next = kt2.Undefined, this.prev = kt2.Undefined;
      }
    };
    kt.Undefined = new kt(void 0);
    G = kt, Ct = class {
      constructor() {
        this._first = G.Undefined;
        this._last = G.Undefined;
        this._size = 0;
      }
      get size() {
        return this._size;
      }
      isEmpty() {
        return this._first === G.Undefined;
      }
      clear() {
        let t = this._first;
        for (; t !== G.Undefined; ) {
          let e = t.next;
          t.prev = G.Undefined, t.next = G.Undefined, t = e;
        }
        this._first = G.Undefined, this._last = G.Undefined, this._size = 0;
      }
      unshift(t) {
        return this._insert(t, false);
      }
      push(t) {
        return this._insert(t, true);
      }
      _insert(t, e) {
        let i = new G(t);
        if (this._first === G.Undefined) this._first = i, this._last = i;
        else if (e) {
          let n = this._last;
          this._last = i, i.prev = n, n.next = i;
        } else {
          let n = this._first;
          this._first = i, i.next = n, n.prev = i;
        }
        this._size += 1;
        let r = false;
        return () => {
          r || (r = true, this._remove(i));
        };
      }
      shift() {
        if (this._first !== G.Undefined) {
          let t = this._first.element;
          return this._remove(this._first), t;
        }
      }
      pop() {
        if (this._last !== G.Undefined) {
          let t = this._last.element;
          return this._remove(this._last), t;
        }
      }
      _remove(t) {
        if (t.prev !== G.Undefined && t.next !== G.Undefined) {
          let e = t.prev;
          e.next = t.next, t.next.prev = e;
        } else t.prev === G.Undefined && t.next === G.Undefined ? (this._first = G.Undefined, this._last = G.Undefined) : t.next === G.Undefined ? (this._last = this._last.prev, this._last.next = G.Undefined) : t.prev === G.Undefined && (this._first = this._first.next, this._first.prev = G.Undefined);
        this._size -= 1;
      }
      *[Symbol.iterator]() {
        let t = this._first;
        for (; t !== G.Undefined; ) yield t.element, t = t.next;
      }
    };
    zl = globalThis.performance && typeof globalThis.performance.now == "function", mr = class s6 {
      static create(t) {
        return new s6(t);
      }
      constructor(t) {
        this._now = zl && t === false ? Date.now : globalThis.performance.now.bind(globalThis.performance), this._startTime = this._now(), this._stopTime = -1;
      }
      stop() {
        this._stopTime = this._now();
      }
      reset() {
        this._startTime = this._now(), this._stopTime = -1;
      }
      elapsed() {
        return this._stopTime !== -1 ? this._stopTime - this._startTime : this._now() - this._startTime;
      }
    };
    Gl = false, fo = false, $l = false;
    ((Qe) => {
      Qe.None = () => D.None;
      function t(y) {
        if ($l) {
          let { onDidAddListener: T } = y, g = gi.create(), w = 0;
          y.onDidAddListener = () => {
            ++w === 2 && (console.warn("snapshotted emitter LIKELY used public and SHOULD HAVE BEEN created with DisposableStore. snapshotted here"), g.print()), T?.();
          };
        }
      }
      function e(y, T) {
        return d(y, () => {
        }, 0, void 0, true, void 0, T);
      }
      Qe.defer = e;
      function i(y) {
        return (T, g = null, w) => {
          let E = false, x;
          return x = y((N) => {
            if (!E) return x ? x.dispose() : E = true, T.call(g, N);
          }, null, w), E && x.dispose(), x;
        };
      }
      Qe.once = i;
      function r(y, T, g) {
        return h8((w, E = null, x) => y((N) => w.call(E, T(N)), null, x), g);
      }
      Qe.map = r;
      function n(y, T, g) {
        return h8((w, E = null, x) => y((N) => {
          T(N), w.call(E, N);
        }, null, x), g);
      }
      Qe.forEach = n;
      function o(y, T, g) {
        return h8((w, E = null, x) => y((N) => T(N) && w.call(E, N), null, x), g);
      }
      Qe.filter = o;
      function l(y) {
        return y;
      }
      Qe.signal = l;
      function a(...y) {
        return (T, g = null, w) => {
          let E = ho(...y.map((x) => x((N) => T.call(g, N))));
          return c(E, w);
        };
      }
      Qe.any = a;
      function u(y, T, g, w) {
        let E = g;
        return r(y, (x) => (E = T(E, x), E), w);
      }
      Qe.reduce = u;
      function h8(y, T) {
        let g, w = { onWillAddFirstListener() {
          g = y(E.fire, E);
        }, onDidRemoveLastListener() {
          g?.dispose();
        } };
        T || t(w);
        let E = new v(w);
        return T?.add(E), E.event;
      }
      function c(y, T) {
        return T instanceof Array ? T.push(y) : T && T.add(y), y;
      }
      function d(y, T, g = 100, w = false, E = false, x, N) {
        let Z, te, Oe, ze = 0, le, et = { leakWarningThreshold: x, onWillAddFirstListener() {
          Z = y((ht) => {
            ze++, te = T(te, ht), w && !Oe && (me.fire(te), te = void 0), le = () => {
              let fi = te;
              te = void 0, Oe = void 0, (!w || ze > 1) && me.fire(fi), ze = 0;
            }, typeof g == "number" ? (clearTimeout(Oe), Oe = setTimeout(le, g)) : Oe === void 0 && (Oe = 0, queueMicrotask(le));
          });
        }, onWillRemoveListener() {
          E && ze > 0 && le?.();
        }, onDidRemoveLastListener() {
          le = void 0, Z.dispose();
        } };
        N || t(et);
        let me = new v(et);
        return N?.add(me), me.event;
      }
      Qe.debounce = d;
      function _(y, T = 0, g) {
        return Qe.debounce(y, (w, E) => w ? (w.push(E), w) : [E], T, void 0, true, void 0, g);
      }
      Qe.accumulate = _;
      function p(y, T = (w, E) => w === E, g) {
        let w = true, E;
        return o(y, (x) => {
          let N = w || !T(x, E);
          return w = false, E = x, N;
        }, g);
      }
      Qe.latch = p;
      function m(y, T, g) {
        return [Qe.filter(y, T, g), Qe.filter(y, (w) => !T(w), g)];
      }
      Qe.split = m;
      function f(y, T = false, g = [], w) {
        let E = g.slice(), x = y((te) => {
          E ? E.push(te) : Z.fire(te);
        });
        w && w.add(x);
        let N = () => {
          E?.forEach((te) => Z.fire(te)), E = null;
        }, Z = new v({ onWillAddFirstListener() {
          x || (x = y((te) => Z.fire(te)), w && w.add(x));
        }, onDidAddFirstListener() {
          E && (T ? setTimeout(N) : N());
        }, onDidRemoveLastListener() {
          x && x.dispose(), x = null;
        } });
        return w && w.add(Z), Z.event;
      }
      Qe.buffer = f;
      function A(y, T) {
        return (w, E, x) => {
          let N = T(new O());
          return y(function(Z) {
            let te = N.evaluate(Z);
            te !== R && w.call(E, te);
          }, void 0, x);
        };
      }
      Qe.chain = A;
      let R = /* @__PURE__ */ Symbol("HaltChainable");
      class O {
        constructor() {
          this.steps = [];
        }
        map(T) {
          return this.steps.push(T), this;
        }
        forEach(T) {
          return this.steps.push((g) => (T(g), g)), this;
        }
        filter(T) {
          return this.steps.push((g) => T(g) ? g : R), this;
        }
        reduce(T, g) {
          let w = g;
          return this.steps.push((E) => (w = T(w, E), w)), this;
        }
        latch(T = (g, w) => g === w) {
          let g = true, w;
          return this.steps.push((E) => {
            let x = g || !T(E, w);
            return g = false, w = E, x ? E : R;
          }), this;
        }
        evaluate(T) {
          for (let g of this.steps) if (T = g(T), T === R) break;
          return T;
        }
      }
      function I(y, T, g = (w) => w) {
        let w = (...Z) => N.fire(g(...Z)), E = () => y.on(T, w), x = () => y.removeListener(T, w), N = new v({ onWillAddFirstListener: E, onDidRemoveLastListener: x });
        return N.event;
      }
      Qe.fromNodeEventEmitter = I;
      function k(y, T, g = (w) => w) {
        let w = (...Z) => N.fire(g(...Z)), E = () => y.addEventListener(T, w), x = () => y.removeEventListener(T, w), N = new v({ onWillAddFirstListener: E, onDidRemoveLastListener: x });
        return N.event;
      }
      Qe.fromDOMEventEmitter = k;
      function P(y) {
        return new Promise((T) => i(y)(T));
      }
      Qe.toPromise = P;
      function oe(y) {
        let T = new v();
        return y.then((g) => {
          T.fire(g);
        }, () => {
          T.fire(void 0);
        }).finally(() => {
          T.dispose();
        }), T.event;
      }
      Qe.fromPromise = oe;
      function Me(y, T) {
        return y((g) => T.fire(g));
      }
      Qe.forward = Me;
      function Pe(y, T, g) {
        return T(g), y((w) => T(w));
      }
      Qe.runAndSubscribe = Pe;
      class Ke {
        constructor(T, g) {
          this._observable = T;
          this._counter = 0;
          this._hasChanged = false;
          let w = { onWillAddFirstListener: () => {
            T.addObserver(this);
          }, onDidRemoveLastListener: () => {
            T.removeObserver(this);
          } };
          g || t(w), this.emitter = new v(w), g && g.add(this.emitter);
        }
        beginUpdate(T) {
          this._counter++;
        }
        handlePossibleChange(T) {
        }
        handleChange(T, g) {
          this._hasChanged = true;
        }
        endUpdate(T) {
          this._counter--, this._counter === 0 && (this._observable.reportChanges(), this._hasChanged && (this._hasChanged = false, this.emitter.fire(this._observable.get())));
        }
      }
      function di(y, T) {
        return new Ke(y, T).emitter.event;
      }
      Qe.fromObservable = di;
      function V(y) {
        return (T, g, w) => {
          let E = 0, x = false, N = { beginUpdate() {
            E++;
          }, endUpdate() {
            E--, E === 0 && (y.reportChanges(), x && (x = false, T.call(g)));
          }, handlePossibleChange() {
          }, handleChange() {
            x = true;
          } };
          y.addObserver(N), y.reportChanges();
          let Z = { dispose() {
            y.removeObserver(N);
          } };
          return w instanceof Ee ? w.add(Z) : Array.isArray(w) && w.push(Z), Z;
        };
      }
      Qe.fromObservableLight = V;
    })($ ||= {});
    Mt = class Mt2 {
      constructor(t) {
        this.listenerCount = 0;
        this.invocationCount = 0;
        this.elapsedOverall = 0;
        this.durations = [];
        this.name = `${t}_${Mt2._idPool++}`, Mt2.all.add(this);
      }
      start(t) {
        this._stopWatch = new mr(), this.listenerCount = t;
      }
      stop() {
        if (this._stopWatch) {
          let t = this._stopWatch.elapsed();
          this.durations.push(t), this.elapsedOverall += t, this.invocationCount += 1, this._stopWatch = void 0;
        }
      }
    };
    Mt.all = /* @__PURE__ */ new Set(), Mt._idPool = 0;
    $n = Mt, po = -1;
    br = class br2 {
      constructor(t, e, i = (br2._idPool++).toString(16).padStart(3, "0")) {
        this._errorHandler = t;
        this.threshold = e;
        this.name = i;
        this._warnCountdown = 0;
      }
      dispose() {
        this._stacks?.clear();
      }
      check(t, e) {
        let i = this.threshold;
        if (i <= 0 || e < i) return;
        this._stacks || (this._stacks = /* @__PURE__ */ new Map());
        let r = this._stacks.get(t.value) || 0;
        if (this._stacks.set(t.value, r + 1), this._warnCountdown -= 1, this._warnCountdown <= 0) {
          this._warnCountdown = i * 0.5;
          let [n, o] = this.getMostFrequentStack(), l = `[${this.name}] potential listener LEAK detected, having ${e} listeners already. MOST frequent listener (${o}):`;
          console.warn(l), console.warn(n);
          let a = new qn(l, n);
          this._errorHandler(a);
        }
        return () => {
          let n = this._stacks.get(t.value) || 0;
          this._stacks.set(t.value, n - 1);
        };
      }
      getMostFrequentStack() {
        if (!this._stacks) return;
        let t, e = 0;
        for (let [i, r] of this._stacks) (!t || e < r) && (t = [i, r], e = r);
        return t;
      }
    };
    br._idPool = 1;
    Vn = br, gi = class s7 {
      constructor(t) {
        this.value = t;
      }
      static create() {
        let t = new Error();
        return new s7(t.stack ?? "");
      }
      print() {
        console.warn(this.value.split(`
`).slice(2).join(`
`));
      }
    }, qn = class extends Error {
      constructor(t, e) {
        super(t), this.name = "ListenerLeakError", this.stack = e;
      }
    }, Yn = class extends Error {
      constructor(t, e) {
        super(t), this.name = "ListenerRefusalError", this.stack = e;
      }
    }, Vl = 0, Pt = class {
      constructor(t) {
        this.value = t;
        this.id = Vl++;
      }
    }, ql = 2, Yl = (s15, t) => {
      if (s15 instanceof Pt) t(s15);
      else for (let e = 0; e < s15.length; e++) {
        let i = s15[e];
        i && t(i);
      }
    };
    if (Gl) {
      let s15 = [];
      setInterval(() => {
        s15.length !== 0 && (console.warn("[LEAKING LISTENERS] GC'ed these listeners that were NOT yet disposed:"), console.warn(s15.join(`
`)), s15.length = 0);
      }, 3e3), _r = new FinalizationRegistry((t) => {
        typeof t == "string" && s15.push(t);
      });
    }
    v = class {
      constructor(t) {
        this._size = 0;
        this._options = t, this._leakageMon = po > 0 || this._options?.leakWarningThreshold ? new Vn(t?.onListenerError ?? Lt, this._options?.leakWarningThreshold ?? po) : void 0, this._perfMon = this._options?._profName ? new $n(this._options._profName) : void 0, this._deliveryQueue = this._options?.deliveryQueue;
      }
      dispose() {
        if (!this._disposed) {
          if (this._disposed = true, this._deliveryQueue?.current === this && this._deliveryQueue.reset(), this._listeners) {
            if (fo) {
              let t = this._listeners;
              queueMicrotask(() => {
                Yl(t, (e) => e.stack?.print());
              });
            }
            this._listeners = void 0, this._size = 0;
          }
          this._options?.onDidRemoveLastListener?.(), this._leakageMon?.dispose();
        }
      }
      get event() {
        return this._event ??= (t, e, i) => {
          if (this._leakageMon && this._size > this._leakageMon.threshold ** 2) {
            let a = `[${this._leakageMon.name}] REFUSES to accept new listeners because it exceeded its threshold by far (${this._size} vs ${this._leakageMon.threshold})`;
            console.warn(a);
            let u = this._leakageMon.getMostFrequentStack() ?? ["UNKNOWN stack", -1], h8 = new Yn(`${a}. HINT: Stack shows most frequent listener (${u[1]}-times)`, u[0]);
            return (this._options?.onListenerError || Lt)(h8), D.None;
          }
          if (this._disposed) return D.None;
          e && (t = t.bind(e));
          let r = new Pt(t), n, o;
          this._leakageMon && this._size >= Math.ceil(this._leakageMon.threshold * 0.2) && (r.stack = gi.create(), n = this._leakageMon.check(r.stack, this._size + 1)), fo && (r.stack = o ?? gi.create()), this._listeners ? this._listeners instanceof Pt ? (this._deliveryQueue ??= new jn(), this._listeners = [this._listeners, r]) : this._listeners.push(r) : (this._options?.onWillAddFirstListener?.(this), this._listeners = r, this._options?.onDidAddFirstListener?.(this)), this._size++;
          let l = C(() => {
            _r?.unregister(l), n?.(), this._removeListener(r);
          });
          if (i instanceof Ee ? i.add(l) : Array.isArray(i) && i.push(l), _r) {
            let a = new Error().stack.split(`
`).slice(2, 3).join(`
`).trim(), u = /(file:|vscode-file:\/\/vscode-app)?(\/[^:]*:\d+:\d+)/.exec(a);
            _r.register(l, u?.[2] ?? a, l);
          }
          return l;
        }, this._event;
      }
      _removeListener(t) {
        if (this._options?.onWillRemoveListener?.(this), !this._listeners) return;
        if (this._size === 1) {
          this._listeners = void 0, this._options?.onDidRemoveLastListener?.(this), this._size = 0;
          return;
        }
        let e = this._listeners, i = e.indexOf(t);
        if (i === -1) throw console.log("disposed?", this._disposed), console.log("size?", this._size), console.log("arr?", JSON.stringify(this._listeners)), new Error("Attempted to dispose unknown listener");
        this._size--, e[i] = void 0;
        let r = this._deliveryQueue.current === this;
        if (this._size * ql <= e.length) {
          let n = 0;
          for (let o = 0; o < e.length; o++) e[o] ? e[n++] = e[o] : r && (this._deliveryQueue.end--, n < this._deliveryQueue.i && this._deliveryQueue.i--);
          e.length = n;
        }
      }
      _deliver(t, e) {
        if (!t) return;
        let i = this._options?.onListenerError || Lt;
        if (!i) {
          t.value(e);
          return;
        }
        try {
          t.value(e);
        } catch (r) {
          i(r);
        }
      }
      _deliverQueue(t) {
        let e = t.current._listeners;
        for (; t.i < t.end; ) this._deliver(e[t.i++], t.value);
        t.reset();
      }
      fire(t) {
        if (this._deliveryQueue?.current && (this._deliverQueue(this._deliveryQueue), this._perfMon?.stop()), this._perfMon?.start(this._size), this._listeners) if (this._listeners instanceof Pt) this._deliver(this._listeners, t);
        else {
          let e = this._deliveryQueue;
          e.enqueue(this, t, this._listeners.length), this._deliverQueue(e);
        }
        this._perfMon?.stop();
      }
      hasListeners() {
        return this._size > 0;
      }
    };
    jn = class {
      constructor() {
        this.i = -1;
        this.end = 0;
      }
      enqueue(t, e, i) {
        this.i = 0, this.end = i, this.current = t, this.value = e;
      }
      reset() {
        this.i = this.end, this.current = void 0, this.value = void 0;
      }
    };
    gr = class gr2 {
      constructor() {
        this.mapWindowIdToZoomLevel = /* @__PURE__ */ new Map();
        this._onDidChangeZoomLevel = new v();
        this.onDidChangeZoomLevel = this._onDidChangeZoomLevel.event;
        this.mapWindowIdToZoomFactor = /* @__PURE__ */ new Map();
        this._onDidChangeFullscreen = new v();
        this.onDidChangeFullscreen = this._onDidChangeFullscreen.event;
        this.mapWindowIdToFullScreen = /* @__PURE__ */ new Map();
      }
      getZoomLevel(t) {
        return this.mapWindowIdToZoomLevel.get(this.getWindowId(t)) ?? 0;
      }
      setZoomLevel(t, e) {
        if (this.getZoomLevel(e) === t) return;
        let i = this.getWindowId(e);
        this.mapWindowIdToZoomLevel.set(i, t), this._onDidChangeZoomLevel.fire(i);
      }
      getZoomFactor(t) {
        return this.mapWindowIdToZoomFactor.get(this.getWindowId(t)) ?? 1;
      }
      setZoomFactor(t, e) {
        this.mapWindowIdToZoomFactor.set(this.getWindowId(e), t);
      }
      setFullscreen(t, e) {
        if (this.isFullscreen(e) === t) return;
        let i = this.getWindowId(e);
        this.mapWindowIdToFullScreen.set(i, t), this._onDidChangeFullscreen.fire(i);
      }
      isFullscreen(t) {
        return !!this.mapWindowIdToFullScreen.get(this.getWindowId(t));
      }
      getWindowId(t) {
        return t.vscodeWindowId;
      }
    };
    gr.INSTANCE = new gr();
    Si = gr;
    Eu = Si.INSTANCE.onDidChangeZoomLevel;
    Tu = Si.INSTANCE.onDidChangeFullscreen, Ot = typeof navigator == "object" ? navigator.userAgent : "", Ei = Ot.indexOf("Firefox") >= 0, Bt = Ot.indexOf("AppleWebKit") >= 0, Ti = Ot.indexOf("Chrome") >= 0, Sr = !Ti && Ot.indexOf("Safari") >= 0;
    Iu = Ot.indexOf("Electron/") >= 0, yu = Ot.indexOf("Android") >= 0, vr = false;
    if (typeof fe.matchMedia == "function") {
      let s15 = fe.matchMedia("(display-mode: standalone) or (display-mode: window-controls-overlay)"), t = fe.matchMedia("(display-mode: fullscreen)");
      vr = s15.matches, Xl(fe, s15, ({ matches: e }) => {
        vr && t.matches || (vr = e);
      });
    }
    Nt = "en", yr = false, xr = false, Ii = false, Zl = false, vo = false, go = false, Jl = false, Ql = false, ea = false, ta = false, Ir = Nt, bo = Nt, Ve = globalThis;
    typeof Ve.vscode < "u" && typeof Ve.vscode.process < "u" ? xe = Ve.vscode.process : typeof process < "u" && typeof process?.versions?.node == "string" && (xe = process);
    So = typeof xe?.versions?.electron == "string", ra = So && xe?.type === "renderer";
    if (typeof xe == "object") {
      yr = xe.platform === "win32", xr = xe.platform === "darwin", Ii = xe.platform === "linux", Zl = Ii && !!xe.env.SNAP && !!xe.env.SNAP_REVISION, Jl = So, ea = !!xe.env.CI || !!xe.env.BUILD_ARTIFACTSTAGINGDIRECTORY, Tr = Nt, Ir = Nt;
      let s15 = xe.env.VSCODE_NLS_CONFIG;
      if (s15) try {
        let t = JSON.parse(s15);
        Tr = t.userLocale, bo = t.osLocale, Ir = t.resolvedLanguage || Nt, ia = t.languagePack?.translationsConfigFile;
      } catch {
      }
      vo = true;
    } else typeof navigator == "object" && !ra ? ($e = navigator.userAgent, yr = $e.indexOf("Windows") >= 0, xr = $e.indexOf("Macintosh") >= 0, Ql = ($e.indexOf("Macintosh") >= 0 || $e.indexOf("iPad") >= 0 || $e.indexOf("iPhone") >= 0) && !!navigator.maxTouchPoints && navigator.maxTouchPoints > 0, Ii = $e.indexOf("Linux") >= 0, ta = $e?.indexOf("Mobi") >= 0, go = true, Ir = globalThis._VSCODE_NLS_LANGUAGE || Nt, Tr = navigator.language.toLowerCase(), bo = Tr) : console.error("Unable to resolve platform.");
    Xn = 0;
    xr ? Xn = 1 : yr ? Xn = 3 : Ii && (Xn = 2);
    wr = yr, Te = xr, Zn = Ii;
    Dr = vo;
    na = go && typeof Ve.importScripts == "function", xu = na ? Ve.origin : void 0;
    Fe = $e, st = Ir;
    ((i) => {
      function s15() {
        return st;
      }
      i.value = s15;
      function t() {
        return st.length === 2 ? st === "en" : st.length >= 3 ? st[0] === "e" && st[1] === "n" && st[2] === "-" : false;
      }
      i.isDefaultVariant = t;
      function e() {
        return st === "en";
      }
      i.isDefault = e;
    })(sa ||= {});
    oa = typeof Ve.postMessage == "function" && !Ve.importScripts, Eo = (() => {
      if (oa) {
        let s15 = [];
        Ve.addEventListener("message", (e) => {
          if (e.data && e.data.vscodeScheduleAsyncWork) for (let i = 0, r = s15.length; i < r; i++) {
            let n = s15[i];
            if (n.id === e.data.vscodeScheduleAsyncWork) {
              s15.splice(i, 1), n.callback();
              return;
            }
          }
        });
        let t = 0;
        return (e) => {
          let i = ++t;
          s15.push({ id: i, callback: e }), Ve.postMessage({ vscodeScheduleAsyncWork: i }, "*");
        };
      }
      return (s15) => setTimeout(s15);
    })();
    la = !!(Fe && Fe.indexOf("Chrome") >= 0), wu = !!(Fe && Fe.indexOf("Firefox") >= 0), Du = !!(!la && Fe && Fe.indexOf("Safari") >= 0), Ru = !!(Fe && Fe.indexOf("Edg/") >= 0), Lu = !!(Fe && Fe.indexOf("Android") >= 0);
    ot = typeof navigator == "object" ? navigator : {}, aa = { clipboard: { writeText: Dr || document.queryCommandSupported && document.queryCommandSupported("copy") || !!(ot && ot.clipboard && ot.clipboard.writeText), readText: Dr || !!(ot && ot.clipboard && ot.clipboard.readText) }, keyboard: Dr || _o() ? 0 : ot.keyboard || Sr ? 1 : 2, touch: "ontouchstart" in fe || ot.maxTouchPoints > 0, pointerEvents: fe.PointerEvent && ("ontouchstart" in fe || navigator.maxTouchPoints > 0) };
    yi = class {
      constructor() {
        this._keyCodeToStr = [], this._strToKeyCode = /* @__PURE__ */ Object.create(null);
      }
      define(t, e) {
        this._keyCodeToStr[t] = e, this._strToKeyCode[e.toLowerCase()] = t;
      }
      keyCodeToStr(t) {
        return this._keyCodeToStr[t];
      }
      strToKeyCode(t) {
        return this._strToKeyCode[t.toLowerCase()] || 0;
      }
    }, Jn = new yi(), To = new yi(), Io = new yi(), yo = new Array(230);
    ((o) => {
      function s15(l) {
        return Jn.keyCodeToStr(l);
      }
      o.toString = s15;
      function t(l) {
        return Jn.strToKeyCode(l);
      }
      o.fromString = t;
      function e(l) {
        return To.keyCodeToStr(l);
      }
      o.toUserSettingsUS = e;
      function i(l) {
        return Io.keyCodeToStr(l);
      }
      o.toUserSettingsGeneral = i;
      function r(l) {
        return To.strToKeyCode(l) || Io.strToKeyCode(l);
      }
      o.fromUserSettings = r;
      function n(l) {
        if (l >= 98 && l <= 113) return null;
        switch (l) {
          case 16:
            return "Up";
          case 18:
            return "Down";
          case 15:
            return "Left";
          case 17:
            return "Right";
        }
        return Jn.keyCodeToStr(l);
      }
      o.toElectronAccelerator = n;
    })(Qn ||= {});
    Rr = class s8 {
      constructor(t, e, i, r, n) {
        this.ctrlKey = t;
        this.shiftKey = e;
        this.altKey = i;
        this.metaKey = r;
        this.keyCode = n;
      }
      equals(t) {
        return t instanceof s8 && this.ctrlKey === t.ctrlKey && this.shiftKey === t.shiftKey && this.altKey === t.altKey && this.metaKey === t.metaKey && this.keyCode === t.keyCode;
      }
      getHashCode() {
        let t = this.ctrlKey ? "1" : "0", e = this.shiftKey ? "1" : "0", i = this.altKey ? "1" : "0", r = this.metaKey ? "1" : "0";
        return `K${t}${e}${i}${r}${this.keyCode}`;
      }
      isModifierKey() {
        return this.keyCode === 0 || this.keyCode === 5 || this.keyCode === 57 || this.keyCode === 6 || this.keyCode === 4;
      }
      toKeybinding() {
        return new es([this]);
      }
      isDuplicateModifierCase() {
        return this.ctrlKey && this.keyCode === 5 || this.shiftKey && this.keyCode === 4 || this.altKey && this.keyCode === 6 || this.metaKey && this.keyCode === 57;
      }
    };
    es = class {
      constructor(t) {
        if (t.length === 0) throw eo("chords");
        this.chords = t;
      }
      getHashCode() {
        let t = "";
        for (let e = 0, i = this.chords.length; e < i; e++) e !== 0 && (t += ";"), t += this.chords[e].getHashCode();
        return t;
      }
      equals(t) {
        if (t === null || this.chords.length !== t.chords.length) return false;
        for (let e = 0; e < this.chords.length; e++) if (!this.chords[e].equals(t.chords[e])) return false;
        return true;
      }
    };
    ua = Te ? 256 : 2048, ha = 512, da = 1024, fa = Te ? 2048 : 256;
    ft = class {
      constructor(t) {
        this._standardKeyboardEventBrand = true;
        let e = t;
        this.browserEvent = e, this.target = e.target, this.ctrlKey = e.ctrlKey, this.shiftKey = e.shiftKey, this.altKey = e.altKey, this.metaKey = e.metaKey, this.altGraphKey = e.getModifierState?.("AltGraph"), this.keyCode = ca(e), this.code = e.code, this.ctrlKey = this.ctrlKey || this.keyCode === 5, this.altKey = this.altKey || this.keyCode === 6, this.shiftKey = this.shiftKey || this.keyCode === 4, this.metaKey = this.metaKey || this.keyCode === 57, this._asKeybinding = this._computeKeybinding(), this._asKeyCodeChord = this._computeKeyCodeChord();
      }
      preventDefault() {
        this.browserEvent && this.browserEvent.preventDefault && this.browserEvent.preventDefault();
      }
      stopPropagation() {
        this.browserEvent && this.browserEvent.stopPropagation && this.browserEvent.stopPropagation();
      }
      toKeyCodeChord() {
        return this._asKeyCodeChord;
      }
      equals(t) {
        return this._asKeybinding === t;
      }
      _computeKeybinding() {
        let t = 0;
        this.keyCode !== 5 && this.keyCode !== 4 && this.keyCode !== 6 && this.keyCode !== 57 && (t = this.keyCode);
        let e = 0;
        return this.ctrlKey && (e |= ua), this.altKey && (e |= ha), this.shiftKey && (e |= da), this.metaKey && (e |= fa), e |= t, e;
      }
      _computeKeyCodeChord() {
        let t = 0;
        return this.keyCode !== 5 && this.keyCode !== 4 && this.keyCode !== 6 && this.keyCode !== 57 && (t = this.keyCode), new Rr(this.ctrlKey, this.shiftKey, this.altKey, this.metaKey, t);
      }
    };
    wo = /* @__PURE__ */ new WeakMap();
    Lr = class {
      static getSameOriginWindowChain(t) {
        let e = wo.get(t);
        if (!e) {
          e = [], wo.set(t, e);
          let i = t, r;
          do
            r = pa(i), r ? e.push({ window: new WeakRef(i), iframeElement: i.frameElement || null }) : e.push({ window: new WeakRef(i), iframeElement: null }), i = r;
          while (i);
        }
        return e.slice(0);
      }
      static getPositionOfChildWindowRelativeToAncestorWindow(t, e) {
        if (!e || t === e) return { top: 0, left: 0 };
        let i = 0, r = 0, n = this.getSameOriginWindowChain(t);
        for (let o of n) {
          let l = o.window.deref();
          if (i += l?.scrollY ?? 0, r += l?.scrollX ?? 0, l === e || !o.iframeElement) break;
          let a = o.iframeElement.getBoundingClientRect();
          i += a.top, r += a.left;
        }
        return { top: i, left: r };
      }
    };
    qe = class {
      constructor(t, e) {
        this.timestamp = Date.now(), this.browserEvent = e, this.leftButton = e.button === 0, this.middleButton = e.button === 1, this.rightButton = e.button === 2, this.buttons = e.buttons, this.target = e.target, this.detail = e.detail || 1, e.type === "dblclick" && (this.detail = 2), this.ctrlKey = e.ctrlKey, this.shiftKey = e.shiftKey, this.altKey = e.altKey, this.metaKey = e.metaKey, typeof e.pageX == "number" ? (this.posx = e.pageX, this.posy = e.pageY) : (this.posx = e.clientX + this.target.ownerDocument.body.scrollLeft + this.target.ownerDocument.documentElement.scrollLeft, this.posy = e.clientY + this.target.ownerDocument.body.scrollTop + this.target.ownerDocument.documentElement.scrollTop);
        let i = Lr.getPositionOfChildWindowRelativeToAncestorWindow(t, e.view);
        this.posx -= i.left, this.posy -= i.top;
      }
      preventDefault() {
        this.browserEvent.preventDefault();
      }
      stopPropagation() {
        this.browserEvent.stopPropagation();
      }
    };
    xi = class {
      constructor(t, e = 0, i = 0) {
        this.browserEvent = t || null, this.target = t ? t.target || t.targetNode || t.srcElement : null, this.deltaY = i, this.deltaX = e;
        let r = false;
        if (Ti) {
          let n = navigator.userAgent.match(/Chrome\/(\d+)/);
          r = (n ? parseInt(n[1]) : 123) <= 122;
        }
        if (t) {
          let n = t, o = t, l = t.view?.devicePixelRatio || 1;
          if (typeof n.wheelDeltaY < "u") r ? this.deltaY = n.wheelDeltaY / (120 * l) : this.deltaY = n.wheelDeltaY / 120;
          else if (typeof o.VERTICAL_AXIS < "u" && o.axis === o.VERTICAL_AXIS) this.deltaY = -o.detail / 3;
          else if (t.type === "wheel") {
            let a = t;
            a.deltaMode === a.DOM_DELTA_LINE ? Ei && !Te ? this.deltaY = -t.deltaY / 3 : this.deltaY = -t.deltaY : this.deltaY = -t.deltaY / 40;
          }
          if (typeof n.wheelDeltaX < "u") Sr && wr ? this.deltaX = -(n.wheelDeltaX / 120) : r ? this.deltaX = n.wheelDeltaX / (120 * l) : this.deltaX = n.wheelDeltaX / 120;
          else if (typeof o.HORIZONTAL_AXIS < "u" && o.axis === o.HORIZONTAL_AXIS) this.deltaX = -t.detail / 3;
          else if (t.type === "wheel") {
            let a = t;
            a.deltaMode === a.DOM_DELTA_LINE ? Ei && !Te ? this.deltaX = -t.deltaX / 3 : this.deltaX = -t.deltaX : this.deltaX = -t.deltaX / 40;
          }
          this.deltaY === 0 && this.deltaX === 0 && t.wheelDelta && (r ? this.deltaY = t.wheelDelta / (120 * l) : this.deltaY = t.wheelDelta / 120);
        }
      }
      preventDefault() {
        this.browserEvent?.preventDefault();
      }
      stopPropagation() {
        this.browserEvent?.stopPropagation();
      }
    };
    Do = Object.freeze(function(s15, t) {
      let e = setTimeout(s15.bind(t), 0);
      return { dispose() {
        clearTimeout(e);
      } };
    });
    ((i) => {
      function s15(r) {
        return r === i.None || r === i.Cancelled || r instanceof ts ? true : !r || typeof r != "object" ? false : typeof r.isCancellationRequested == "boolean" && typeof r.onCancellationRequested == "function";
      }
      i.isCancellationToken = s15, i.None = Object.freeze({ isCancellationRequested: false, onCancellationRequested: $.None }), i.Cancelled = Object.freeze({ isCancellationRequested: true, onCancellationRequested: Do });
    })(ma ||= {});
    ts = class {
      constructor() {
        this._isCancelled = false;
        this._emitter = null;
      }
      cancel() {
        this._isCancelled || (this._isCancelled = true, this._emitter && (this._emitter.fire(void 0), this.dispose()));
      }
      get isCancellationRequested() {
        return this._isCancelled;
      }
      get onCancellationRequested() {
        return this._isCancelled ? Do : (this._emitter || (this._emitter = new v()), this._emitter.event);
      }
      dispose() {
        this._emitter && (this._emitter.dispose(), this._emitter = null);
      }
    };
    _a = /* @__PURE__ */ Symbol("MicrotaskDelay");
    Ye = class {
      constructor(t, e) {
        this._isDisposed = false;
        this._token = -1, typeof t == "function" && typeof e == "number" && this.setIfNotSet(t, e);
      }
      dispose() {
        this.cancel(), this._isDisposed = true;
      }
      cancel() {
        this._token !== -1 && (clearTimeout(this._token), this._token = -1);
      }
      cancelAndSet(t, e) {
        if (this._isDisposed) throw new Rt("Calling 'cancelAndSet' on a disposed TimeoutTimer");
        this.cancel(), this._token = setTimeout(() => {
          this._token = -1, t();
        }, e);
      }
      setIfNotSet(t, e) {
        if (this._isDisposed) throw new Rt("Calling 'setIfNotSet' on a disposed TimeoutTimer");
        this._token === -1 && (this._token = setTimeout(() => {
          this._token = -1, t();
        }, e));
      }
    }, kr = class {
      constructor() {
        this.disposable = void 0;
        this.isDisposed = false;
      }
      cancel() {
        this.disposable?.dispose(), this.disposable = void 0;
      }
      cancelAndSet(t, e, i = globalThis) {
        if (this.isDisposed) throw new Rt("Calling 'cancelAndSet' on a disposed IntervalTimer");
        this.cancel();
        let r = i.setInterval(() => {
          t();
        }, e);
        this.disposable = C(() => {
          i.clearInterval(r), this.disposable = void 0;
        });
      }
      dispose() {
        this.cancel(), this.isDisposed = true;
      }
    };
    (function() {
      typeof globalThis.requestIdleCallback != "function" || typeof globalThis.cancelIdleCallback != "function" ? Ar = (s15, t) => {
        Eo(() => {
          if (e) return;
          let i = Date.now() + 15;
          t(Object.freeze({ didTimeout: true, timeRemaining() {
            return Math.max(0, i - Date.now());
          } }));
        });
        let e = false;
        return { dispose() {
          e || (e = true);
        } };
      } : Ar = (s15, t, e) => {
        let i = s15.requestIdleCallback(t, typeof e == "number" ? { timeout: e } : void 0), r = false;
        return { dispose() {
          r || (r = true, s15.cancelIdleCallback(i));
        } };
      }, ba = (s15) => Ar(globalThis, s15);
    })();
    ((e) => {
      async function s15(i) {
        let r, n = await Promise.all(i.map((o) => o.then((l) => l, (l) => {
          r || (r = l);
        })));
        if (typeof r < "u") throw r;
        return n;
      }
      e.settled = s15;
      function t(i) {
        return new Promise(async (r, n) => {
          try {
            await i(r, n);
          } catch (o) {
            n(o);
          }
        });
      }
      e.withAsyncBody = t;
    })(va ||= {});
    _e = class _e2 {
      static fromArray(t) {
        return new _e2((e) => {
          e.emitMany(t);
        });
      }
      static fromPromise(t) {
        return new _e2(async (e) => {
          e.emitMany(await t);
        });
      }
      static fromPromises(t) {
        return new _e2(async (e) => {
          await Promise.all(t.map(async (i) => e.emitOne(await i)));
        });
      }
      static merge(t) {
        return new _e2(async (e) => {
          await Promise.all(t.map(async (i) => {
            for await (let r of i) e.emitOne(r);
          }));
        });
      }
      constructor(t, e) {
        this._state = 0, this._results = [], this._error = null, this._onReturn = e, this._onStateChanged = new v(), queueMicrotask(async () => {
          let i = { emitOne: (r) => this.emitOne(r), emitMany: (r) => this.emitMany(r), reject: (r) => this.reject(r) };
          try {
            await Promise.resolve(t(i)), this.resolve();
          } catch (r) {
            this.reject(r);
          } finally {
            i.emitOne = void 0, i.emitMany = void 0, i.reject = void 0;
          }
        });
      }
      [Symbol.asyncIterator]() {
        let t = 0;
        return { next: async () => {
          do {
            if (this._state === 2) throw this._error;
            if (t < this._results.length) return { done: false, value: this._results[t++] };
            if (this._state === 1) return { done: true, value: void 0 };
            await $.toPromise(this._onStateChanged.event);
          } while (true);
        }, return: async () => (this._onReturn?.(), { done: true, value: void 0 }) };
      }
      static map(t, e) {
        return new _e2(async (i) => {
          for await (let r of t) i.emitOne(e(r));
        });
      }
      map(t) {
        return _e2.map(this, t);
      }
      static filter(t, e) {
        return new _e2(async (i) => {
          for await (let r of t) e(r) && i.emitOne(r);
        });
      }
      filter(t) {
        return _e2.filter(this, t);
      }
      static coalesce(t) {
        return _e2.filter(t, (e) => !!e);
      }
      coalesce() {
        return _e2.coalesce(this);
      }
      static async toPromise(t) {
        let e = [];
        for await (let i of t) e.push(i);
        return e;
      }
      toPromise() {
        return _e2.toPromise(this);
      }
      emitOne(t) {
        this._state === 0 && (this._results.push(t), this._onStateChanged.fire());
      }
      emitMany(t) {
        this._state === 0 && (this._results = this._results.concat(t), this._onStateChanged.fire());
      }
      resolve() {
        this._state === 0 && (this._state = 1, this._onStateChanged.fire());
      }
      reject(t) {
        this._state === 0 && (this._state = 2, this._error = t, this._onStateChanged.fire());
      }
    };
    _e.EMPTY = _e.fromArray([]);
    Ro = _e;
    Cr = class Cr2 {
      constructor() {
        this._h0 = 1732584193;
        this._h1 = 4023233417;
        this._h2 = 2562383102;
        this._h3 = 271733878;
        this._h4 = 3285377520;
        this._buff = new Uint8Array(67), this._buffDV = new DataView(this._buff.buffer), this._buffLen = 0, this._totalLen = 0, this._leftoverHighSurrogate = 0, this._finished = false;
      }
      update(t) {
        let e = t.length;
        if (e === 0) return;
        let i = this._buff, r = this._buffLen, n = this._leftoverHighSurrogate, o, l;
        for (n !== 0 ? (o = n, l = -1, n = 0) : (o = t.charCodeAt(0), l = 0); ; ) {
          let a = o;
          if (Lo(o)) if (l + 1 < e) {
            let u = t.charCodeAt(l + 1);
            is(u) ? (l++, a = Ao(o, u)) : a = 65533;
          } else {
            n = o;
            break;
          }
          else is(o) && (a = 65533);
          if (r = this._push(i, r, a), l++, l < e) o = t.charCodeAt(l);
          else break;
        }
        this._buffLen = r, this._leftoverHighSurrogate = n;
      }
      _push(t, e, i) {
        return i < 128 ? t[e++] = i : i < 2048 ? (t[e++] = 192 | (i & 1984) >>> 6, t[e++] = 128 | (i & 63) >>> 0) : i < 65536 ? (t[e++] = 224 | (i & 61440) >>> 12, t[e++] = 128 | (i & 4032) >>> 6, t[e++] = 128 | (i & 63) >>> 0) : (t[e++] = 240 | (i & 1835008) >>> 18, t[e++] = 128 | (i & 258048) >>> 12, t[e++] = 128 | (i & 4032) >>> 6, t[e++] = 128 | (i & 63) >>> 0), e >= 64 && (this._step(), e -= 64, this._totalLen += 64, t[0] = t[64], t[1] = t[65], t[2] = t[66]), e;
      }
      digest() {
        return this._finished || (this._finished = true, this._leftoverHighSurrogate && (this._leftoverHighSurrogate = 0, this._buffLen = this._push(this._buff, this._buffLen, 65533)), this._totalLen += this._buffLen, this._wrapUp()), wi(this._h0) + wi(this._h1) + wi(this._h2) + wi(this._h3) + wi(this._h4);
      }
      _wrapUp() {
        this._buff[this._buffLen++] = 128, ko(this._buff, this._buffLen), this._buffLen > 56 && (this._step(), ko(this._buff));
        let t = 8 * this._totalLen;
        this._buffDV.setUint32(56, Math.floor(t / 4294967296), false), this._buffDV.setUint32(60, t % 4294967296, false), this._step();
      }
      _step() {
        let t = Cr2._bigBlock32, e = this._buffDV;
        for (let c = 0; c < 64; c += 4) t.setUint32(c, e.getUint32(c, false), false);
        for (let c = 64; c < 320; c += 4) t.setUint32(c, rs(t.getUint32(c - 12, false) ^ t.getUint32(c - 32, false) ^ t.getUint32(c - 56, false) ^ t.getUint32(c - 64, false), 1), false);
        let i = this._h0, r = this._h1, n = this._h2, o = this._h3, l = this._h4, a, u, h8;
        for (let c = 0; c < 80; c++) c < 20 ? (a = r & n | ~r & o, u = 1518500249) : c < 40 ? (a = r ^ n ^ o, u = 1859775393) : c < 60 ? (a = r & n | r & o | n & o, u = 2400959708) : (a = r ^ n ^ o, u = 3395469782), h8 = rs(i, 5) + a + l + u + t.getUint32(c * 4, false) & 4294967295, l = o, o = n, n = rs(r, 30), r = i, i = h8;
        this._h0 = this._h0 + i & 4294967295, this._h1 = this._h1 + r & 4294967295, this._h2 = this._h2 + n & 4294967295, this._h3 = this._h3 + o & 4294967295, this._h4 = this._h4 + l & 4294967295;
      }
    };
    Cr._bigBlock32 = new DataView(new ArrayBuffer(320));
    Co = Cr;
    ({ registerWindow: Bh, getWindow: be, getDocument: Nh, getWindows: Fh, getWindowsCount: Hh, getWindowId: Oo, getWindowById: Wh, hasWindow: Uh, onDidRegisterWindow: No, onWillUnregisterWindow: Kh, onDidUnregisterWindow: zh } = (function() {
      let s15 = /* @__PURE__ */ new Map();
      fe;
      let t = { window: fe, disposables: new Ee() };
      s15.set(fe.vscodeWindowId, t);
      let e = new v(), i = new v(), r = new v();
      function n(o, l) {
        return (typeof o == "number" ? s15.get(o) : void 0) ?? (l ? t : void 0);
      }
      return { onDidRegisterWindow: e.event, onWillUnregisterWindow: r.event, onDidUnregisterWindow: i.event, registerWindow(o) {
        if (s15.has(o.vscodeWindowId)) return D.None;
        let l = new Ee(), a = { window: o, disposables: l.add(new Ee()) };
        return s15.set(o.vscodeWindowId, a), l.add(C(() => {
          s15.delete(o.vscodeWindowId), i.fire(o);
        })), l.add(L(o, Y.BEFORE_UNLOAD, () => {
          r.fire(o);
        })), e.fire(a), l;
      }, getWindows() {
        return s15.values();
      }, getWindowsCount() {
        return s15.size;
      }, getWindowId(o) {
        return o.vscodeWindowId;
      }, hasWindow(o) {
        return s15.has(o);
      }, getWindowById: n, getWindow(o) {
        let l = o;
        if (l?.ownerDocument?.defaultView) return l.ownerDocument.defaultView.window;
        let a = o;
        return a?.view ? a.view.window : fe;
      }, getDocument(o) {
        return be(o).document;
      } };
    })());
    ss = class {
      constructor(t, e, i, r) {
        this._node = t, this._type = e, this._handler = i, this._options = r || false, this._node.addEventListener(this._type, this._handler, this._options);
      }
      dispose() {
        this._handler && (this._node.removeEventListener(this._type, this._handler, this._options), this._node = null, this._handler = null);
      }
    };
    os = function(t, e, i, r) {
      let n = i;
      return e === "click" || e === "mousedown" || e === "contextmenu" ? n = ya(be(t), i) : (e === "keydown" || e === "keypress" || e === "keyup") && (n = xa(i)), L(t, e, n, r);
    };
    Mr = class extends kr {
      constructor(t) {
        super(), this.defaultTarget = t && be(t);
      }
      cancelAndSet(t, e, i) {
        return super.cancelAndSet(t, e, i ?? this.defaultTarget);
      }
    }, Di = class {
      constructor(t, e = 0) {
        this._runner = t, this.priority = e, this._canceled = false;
      }
      dispose() {
        this._canceled = true;
      }
      execute() {
        if (!this._canceled) try {
          this._runner();
        } catch (t) {
          Lt(t);
        }
      }
      static sort(t, e) {
        return e.priority - t.priority;
      }
    };
    (function() {
      let s15 = /* @__PURE__ */ new Map(), t = /* @__PURE__ */ new Map(), e = /* @__PURE__ */ new Map(), i = /* @__PURE__ */ new Map(), r = (n) => {
        e.set(n, false);
        let o = s15.get(n) ?? [];
        for (t.set(n, o), s15.set(n, []), i.set(n, true); o.length > 0; ) o.sort(Di.sort), o.shift().execute();
        i.set(n, false);
      };
      mt = (n, o, l = 0) => {
        let a = Oo(n), u = new Di(o, l), h8 = s15.get(a);
        return h8 || (h8 = [], s15.set(a, h8)), h8.push(u), e.get(a) || (e.set(a, true), n.requestAnimationFrame(() => r(a))), u;
      }, wa = (n, o, l) => {
        let a = Oo(n);
        if (i.get(a)) {
          let u = new Di(o, l), h8 = t.get(a);
          return h8 || (h8 = [], t.set(a, h8)), h8.push(u), u;
        } else return mt(n, o, l);
      };
    })();
    pt = class pt2 {
      constructor(t, e) {
        this.width = t;
        this.height = e;
      }
      with(t = this.width, e = this.height) {
        return t !== this.width || e !== this.height ? new pt2(t, e) : this;
      }
      static is(t) {
        return typeof t == "object" && typeof t.height == "number" && typeof t.width == "number";
      }
      static lift(t) {
        return t instanceof pt2 ? t : new pt2(t.width, t.height);
      }
      static equals(t, e) {
        return t === e ? true : !t || !e ? false : t.width === e.width && t.height === e.height;
      }
    };
    pt.None = new pt(0, 0);
    Bo = pt;
    Gh = new class {
      constructor() {
        this.mutationObservers = /* @__PURE__ */ new Map();
      }
      observe(s15, t, e) {
        let i = this.mutationObservers.get(s15);
        i || (i = /* @__PURE__ */ new Map(), this.mutationObservers.set(s15, i));
        let r = Mo(e), n = i.get(r);
        if (n) n.users += 1;
        else {
          let o = new v(), l = new MutationObserver((u) => o.fire(u));
          l.observe(s15, e);
          let a = n = { users: 1, observer: l, onDidMutate: o.event };
          t.add(C(() => {
            a.users -= 1, a.users === 0 && (o.dispose(), l.disconnect(), i?.delete(r), i?.size === 0 && this.mutationObservers.delete(s15));
          })), i.set(r, n);
        }
        return n.onDidMutate;
      }
    }();
    Y = { CLICK: "click", AUXCLICK: "auxclick", DBLCLICK: "dblclick", MOUSE_UP: "mouseup", MOUSE_DOWN: "mousedown", MOUSE_OVER: "mouseover", MOUSE_MOVE: "mousemove", MOUSE_OUT: "mouseout", MOUSE_ENTER: "mouseenter", MOUSE_LEAVE: "mouseleave", MOUSE_WHEEL: "wheel", POINTER_UP: "pointerup", POINTER_DOWN: "pointerdown", POINTER_MOVE: "pointermove", POINTER_LEAVE: "pointerleave", CONTEXT_MENU: "contextmenu", WHEEL: "wheel", KEY_DOWN: "keydown", KEY_PRESS: "keypress", KEY_UP: "keyup", LOAD: "load", BEFORE_UNLOAD: "beforeunload", UNLOAD: "unload", PAGE_SHOW: "pageshow", PAGE_HIDE: "pagehide", PASTE: "paste", ABORT: "abort", ERROR: "error", RESIZE: "resize", SCROLL: "scroll", FULLSCREEN_CHANGE: "fullscreenchange", WK_FULLSCREEN_CHANGE: "webkitfullscreenchange", SELECT: "select", CHANGE: "change", SUBMIT: "submit", RESET: "reset", FOCUS: "focus", FOCUS_IN: "focusin", FOCUS_OUT: "focusout", BLUR: "blur", INPUT: "input", STORAGE: "storage", DRAG_START: "dragstart", DRAG: "drag", DRAG_ENTER: "dragenter", DRAG_LEAVE: "dragleave", DRAG_OVER: "dragover", DROP: "drop", DRAG_END: "dragend", ANIMATION_START: Bt ? "webkitAnimationStart" : "animationstart", ANIMATION_END: Bt ? "webkitAnimationEnd" : "animationend", ANIMATION_ITERATION: Bt ? "webkitAnimationIteration" : "animationiteration" };
    Da = /([\w\-]+)?(#([\w\-]+))?((\.([\w\-]+))*)/;
    Ra.SVG = function(s15, t, ...e) {
      return Ho("http://www.w3.org/2000/svg", s15, t, ...e);
    };
    ls = class {
      constructor(t) {
        this.domNode = t;
        this._maxWidth = "";
        this._width = "";
        this._height = "";
        this._top = "";
        this._left = "";
        this._bottom = "";
        this._right = "";
        this._paddingTop = "";
        this._paddingLeft = "";
        this._paddingBottom = "";
        this._paddingRight = "";
        this._fontFamily = "";
        this._fontWeight = "";
        this._fontSize = "";
        this._fontStyle = "";
        this._fontFeatureSettings = "";
        this._fontVariationSettings = "";
        this._textDecoration = "";
        this._lineHeight = "";
        this._letterSpacing = "";
        this._className = "";
        this._display = "";
        this._position = "";
        this._visibility = "";
        this._color = "";
        this._backgroundColor = "";
        this._layerHint = false;
        this._contain = "none";
        this._boxShadow = "";
      }
      setMaxWidth(t) {
        let e = Ie(t);
        this._maxWidth !== e && (this._maxWidth = e, this.domNode.style.maxWidth = this._maxWidth);
      }
      setWidth(t) {
        let e = Ie(t);
        this._width !== e && (this._width = e, this.domNode.style.width = this._width);
      }
      setHeight(t) {
        let e = Ie(t);
        this._height !== e && (this._height = e, this.domNode.style.height = this._height);
      }
      setTop(t) {
        let e = Ie(t);
        this._top !== e && (this._top = e, this.domNode.style.top = this._top);
      }
      setLeft(t) {
        let e = Ie(t);
        this._left !== e && (this._left = e, this.domNode.style.left = this._left);
      }
      setBottom(t) {
        let e = Ie(t);
        this._bottom !== e && (this._bottom = e, this.domNode.style.bottom = this._bottom);
      }
      setRight(t) {
        let e = Ie(t);
        this._right !== e && (this._right = e, this.domNode.style.right = this._right);
      }
      setPaddingTop(t) {
        let e = Ie(t);
        this._paddingTop !== e && (this._paddingTop = e, this.domNode.style.paddingTop = this._paddingTop);
      }
      setPaddingLeft(t) {
        let e = Ie(t);
        this._paddingLeft !== e && (this._paddingLeft = e, this.domNode.style.paddingLeft = this._paddingLeft);
      }
      setPaddingBottom(t) {
        let e = Ie(t);
        this._paddingBottom !== e && (this._paddingBottom = e, this.domNode.style.paddingBottom = this._paddingBottom);
      }
      setPaddingRight(t) {
        let e = Ie(t);
        this._paddingRight !== e && (this._paddingRight = e, this.domNode.style.paddingRight = this._paddingRight);
      }
      setFontFamily(t) {
        this._fontFamily !== t && (this._fontFamily = t, this.domNode.style.fontFamily = this._fontFamily);
      }
      setFontWeight(t) {
        this._fontWeight !== t && (this._fontWeight = t, this.domNode.style.fontWeight = this._fontWeight);
      }
      setFontSize(t) {
        let e = Ie(t);
        this._fontSize !== e && (this._fontSize = e, this.domNode.style.fontSize = this._fontSize);
      }
      setFontStyle(t) {
        this._fontStyle !== t && (this._fontStyle = t, this.domNode.style.fontStyle = this._fontStyle);
      }
      setFontFeatureSettings(t) {
        this._fontFeatureSettings !== t && (this._fontFeatureSettings = t, this.domNode.style.fontFeatureSettings = this._fontFeatureSettings);
      }
      setFontVariationSettings(t) {
        this._fontVariationSettings !== t && (this._fontVariationSettings = t, this.domNode.style.fontVariationSettings = this._fontVariationSettings);
      }
      setTextDecoration(t) {
        this._textDecoration !== t && (this._textDecoration = t, this.domNode.style.textDecoration = this._textDecoration);
      }
      setLineHeight(t) {
        let e = Ie(t);
        this._lineHeight !== e && (this._lineHeight = e, this.domNode.style.lineHeight = this._lineHeight);
      }
      setLetterSpacing(t) {
        let e = Ie(t);
        this._letterSpacing !== e && (this._letterSpacing = e, this.domNode.style.letterSpacing = this._letterSpacing);
      }
      setClassName(t) {
        this._className !== t && (this._className = t, this.domNode.className = this._className);
      }
      toggleClassName(t, e) {
        this.domNode.classList.toggle(t, e), this._className = this.domNode.className;
      }
      setDisplay(t) {
        this._display !== t && (this._display = t, this.domNode.style.display = this._display);
      }
      setPosition(t) {
        this._position !== t && (this._position = t, this.domNode.style.position = this._position);
      }
      setVisibility(t) {
        this._visibility !== t && (this._visibility = t, this.domNode.style.visibility = this._visibility);
      }
      setColor(t) {
        this._color !== t && (this._color = t, this.domNode.style.color = this._color);
      }
      setBackgroundColor(t) {
        this._backgroundColor !== t && (this._backgroundColor = t, this.domNode.style.backgroundColor = this._backgroundColor);
      }
      setLayerHinting(t) {
        this._layerHint !== t && (this._layerHint = t, this.domNode.style.transform = this._layerHint ? "translate3d(0px, 0px, 0px)" : "");
      }
      setBoxShadow(t) {
        this._boxShadow !== t && (this._boxShadow = t, this.domNode.style.boxShadow = t);
      }
      setContain(t) {
        this._contain !== t && (this._contain = t, this.domNode.style.contain = this._contain);
      }
      setAttribute(t, e) {
        this.domNode.setAttribute(t, e);
      }
      removeAttribute(t) {
        this.domNode.removeAttribute(t);
      }
      appendChild(t) {
        this.domNode.appendChild(t.domNode);
      }
      removeChild(t) {
        this.domNode.removeChild(t.domNode);
      }
    };
    Wt = class {
      constructor() {
        this._hooks = new Ee();
        this._pointerMoveCallback = null;
        this._onStopCallback = null;
      }
      dispose() {
        this.stopMonitoring(false), this._hooks.dispose();
      }
      stopMonitoring(t, e) {
        if (!this.isMonitoring()) return;
        this._hooks.clear(), this._pointerMoveCallback = null;
        let i = this._onStopCallback;
        this._onStopCallback = null, t && i && i(e);
      }
      isMonitoring() {
        return !!this._pointerMoveCallback;
      }
      startMonitoring(t, e, i, r, n) {
        this.isMonitoring() && this.stopMonitoring(false), this._pointerMoveCallback = r, this._onStopCallback = n;
        let o = t;
        try {
          t.setPointerCapture(e), this._hooks.add(C(() => {
            try {
              t.releasePointerCapture(e);
            } catch {
            }
          }));
        } catch {
          o = be(t);
        }
        this._hooks.add(L(o, Y.POINTER_MOVE, (l) => {
          if (l.buttons !== i) {
            this.stopMonitoring(true);
            return;
          }
          l.preventDefault(), this._pointerMoveCallback(l);
        })), this._hooks.add(L(o, Y.POINTER_UP, (l) => this.stopMonitoring(true)));
      }
    };
    ((n) => (n.Tap = "-xterm-gesturetap", n.Change = "-xterm-gesturechange", n.Start = "-xterm-gesturestart", n.End = "-xterm-gesturesend", n.Contextmenu = "-xterm-gesturecontextmenu"))(He ||= {});
    Q = class Q2 extends D {
      constructor() {
        super();
        this.dispatched = false;
        this.targets = new Ct();
        this.ignoreTargets = new Ct();
        this.activeTouches = {}, this.handle = null, this._lastSetTapCountTime = 0, this._register($.runAndSubscribe(No, ({ window: e, disposables: i }) => {
          i.add(L(e.document, "touchstart", (r) => this.onTouchStart(r), { passive: false })), i.add(L(e.document, "touchend", (r) => this.onTouchEnd(e, r))), i.add(L(e.document, "touchmove", (r) => this.onTouchMove(r), { passive: false }));
        }, { window: fe, disposables: this._store }));
      }
      static addTarget(e) {
        if (!Q2.isTouchDevice()) return D.None;
        Q2.INSTANCE || (Q2.INSTANCE = Gn(new Q2()));
        let i = Q2.INSTANCE.targets.push(e);
        return C(i);
      }
      static ignoreTarget(e) {
        if (!Q2.isTouchDevice()) return D.None;
        Q2.INSTANCE || (Q2.INSTANCE = Gn(new Q2()));
        let i = Q2.INSTANCE.ignoreTargets.push(e);
        return C(i);
      }
      static isTouchDevice() {
        return "ontouchstart" in fe || navigator.maxTouchPoints > 0;
      }
      dispose() {
        this.handle && (this.handle.dispose(), this.handle = null), super.dispose();
      }
      onTouchStart(e) {
        let i = Date.now();
        this.handle && (this.handle.dispose(), this.handle = null);
        for (let r = 0, n = e.targetTouches.length; r < n; r++) {
          let o = e.targetTouches.item(r);
          this.activeTouches[o.identifier] = { id: o.identifier, initialTarget: o.target, initialTimeStamp: i, initialPageX: o.pageX, initialPageY: o.pageY, rollingTimestamps: [i], rollingPageX: [o.pageX], rollingPageY: [o.pageY] };
          let l = this.newGestureEvent(He.Start, o.target);
          l.pageX = o.pageX, l.pageY = o.pageY, this.dispatchEvent(l);
        }
        this.dispatched && (e.preventDefault(), e.stopPropagation(), this.dispatched = false);
      }
      onTouchEnd(e, i) {
        let r = Date.now(), n = Object.keys(this.activeTouches).length;
        for (let o = 0, l = i.changedTouches.length; o < l; o++) {
          let a = i.changedTouches.item(o);
          if (!this.activeTouches.hasOwnProperty(String(a.identifier))) {
            console.warn("move of an UNKNOWN touch", a);
            continue;
          }
          let u = this.activeTouches[a.identifier], h8 = Date.now() - u.initialTimeStamp;
          if (h8 < Q2.HOLD_DELAY && Math.abs(u.initialPageX - Se(u.rollingPageX)) < 30 && Math.abs(u.initialPageY - Se(u.rollingPageY)) < 30) {
            let c = this.newGestureEvent(He.Tap, u.initialTarget);
            c.pageX = Se(u.rollingPageX), c.pageY = Se(u.rollingPageY), this.dispatchEvent(c);
          } else if (h8 >= Q2.HOLD_DELAY && Math.abs(u.initialPageX - Se(u.rollingPageX)) < 30 && Math.abs(u.initialPageY - Se(u.rollingPageY)) < 30) {
            let c = this.newGestureEvent(He.Contextmenu, u.initialTarget);
            c.pageX = Se(u.rollingPageX), c.pageY = Se(u.rollingPageY), this.dispatchEvent(c);
          } else if (n === 1) {
            let c = Se(u.rollingPageX), d = Se(u.rollingPageY), _ = Se(u.rollingTimestamps) - u.rollingTimestamps[0], p = c - u.rollingPageX[0], m = d - u.rollingPageY[0], f = [...this.targets].filter((A) => u.initialTarget instanceof Node && A.contains(u.initialTarget));
            this.inertia(e, f, r, Math.abs(p) / _, p > 0 ? 1 : -1, c, Math.abs(m) / _, m > 0 ? 1 : -1, d);
          }
          this.dispatchEvent(this.newGestureEvent(He.End, u.initialTarget)), delete this.activeTouches[a.identifier];
        }
        this.dispatched && (i.preventDefault(), i.stopPropagation(), this.dispatched = false);
      }
      newGestureEvent(e, i) {
        let r = document.createEvent("CustomEvent");
        return r.initEvent(e, false, true), r.initialTarget = i, r.tapCount = 0, r;
      }
      dispatchEvent(e) {
        if (e.type === He.Tap) {
          let i = (/* @__PURE__ */ new Date()).getTime(), r = 0;
          i - this._lastSetTapCountTime > Q2.CLEAR_TAP_COUNT_TIME ? r = 1 : r = 2, this._lastSetTapCountTime = i, e.tapCount = r;
        } else (e.type === He.Change || e.type === He.Contextmenu) && (this._lastSetTapCountTime = 0);
        if (e.initialTarget instanceof Node) {
          for (let r of this.ignoreTargets) if (r.contains(e.initialTarget)) return;
          let i = [];
          for (let r of this.targets) if (r.contains(e.initialTarget)) {
            let n = 0, o = e.initialTarget;
            for (; o && o !== r; ) n++, o = o.parentElement;
            i.push([n, r]);
          }
          i.sort((r, n) => r[0] - n[0]);
          for (let [r, n] of i) n.dispatchEvent(e), this.dispatched = true;
        }
      }
      inertia(e, i, r, n, o, l, a, u, h8) {
        this.handle = mt(e, () => {
          let c = Date.now(), d = c - r, _ = 0, p = 0, m = true;
          n += Q2.SCROLL_FRICTION * d, a += Q2.SCROLL_FRICTION * d, n > 0 && (m = false, _ = o * n * d), a > 0 && (m = false, p = u * a * d);
          let f = this.newGestureEvent(He.Change);
          f.translationX = _, f.translationY = p, i.forEach((A) => A.dispatchEvent(f)), m || this.inertia(e, i, c, n, o, l + _, a, u, h8 + p);
        });
      }
      onTouchMove(e) {
        let i = Date.now();
        for (let r = 0, n = e.changedTouches.length; r < n; r++) {
          let o = e.changedTouches.item(r);
          if (!this.activeTouches.hasOwnProperty(String(o.identifier))) {
            console.warn("end of an UNKNOWN touch", o);
            continue;
          }
          let l = this.activeTouches[o.identifier], a = this.newGestureEvent(He.Change, l.initialTarget);
          a.translationX = o.pageX - Se(l.rollingPageX), a.translationY = o.pageY - Se(l.rollingPageY), a.pageX = o.pageX, a.pageY = o.pageY, this.dispatchEvent(a), l.rollingPageX.length > 3 && (l.rollingPageX.shift(), l.rollingPageY.shift(), l.rollingTimestamps.shift()), l.rollingPageX.push(o.pageX), l.rollingPageY.push(o.pageY), l.rollingTimestamps.push(i);
        }
        this.dispatched && (e.preventDefault(), e.stopPropagation(), this.dispatched = false);
      }
    };
    Q.SCROLL_FRICTION = -5e-3, Q.HOLD_DELAY = 700, Q.CLEAR_TAP_COUNT_TIME = 400, M([Wo], Q, "isTouchDevice", 1);
    Pr = Q;
    lt = class extends D {
      onclick(t, e) {
        this._register(L(t, Y.CLICK, (i) => e(new qe(be(t), i))));
      }
      onmousedown(t, e) {
        this._register(L(t, Y.MOUSE_DOWN, (i) => e(new qe(be(t), i))));
      }
      onmouseover(t, e) {
        this._register(L(t, Y.MOUSE_OVER, (i) => e(new qe(be(t), i))));
      }
      onmouseleave(t, e) {
        this._register(L(t, Y.MOUSE_LEAVE, (i) => e(new qe(be(t), i))));
      }
      onkeydown(t, e) {
        this._register(L(t, Y.KEY_DOWN, (i) => e(new ft(i))));
      }
      onkeyup(t, e) {
        this._register(L(t, Y.KEY_UP, (i) => e(new ft(i))));
      }
      oninput(t, e) {
        this._register(L(t, Y.INPUT, e));
      }
      onblur(t, e) {
        this._register(L(t, Y.BLUR, e));
      }
      onfocus(t, e) {
        this._register(L(t, Y.FOCUS, e));
      }
      onchange(t, e) {
        this._register(L(t, Y.CHANGE, e));
      }
      ignoreGesture(t) {
        return Pr.ignoreTarget(t);
      }
    };
    Uo = 11, Or = class extends lt {
      constructor(t) {
        super(), this._onActivate = t.onActivate, this.bgDomNode = document.createElement("div"), this.bgDomNode.className = "arrow-background", this.bgDomNode.style.position = "absolute", this.bgDomNode.style.width = t.bgWidth + "px", this.bgDomNode.style.height = t.bgHeight + "px", typeof t.top < "u" && (this.bgDomNode.style.top = "0px"), typeof t.left < "u" && (this.bgDomNode.style.left = "0px"), typeof t.bottom < "u" && (this.bgDomNode.style.bottom = "0px"), typeof t.right < "u" && (this.bgDomNode.style.right = "0px"), this.domNode = document.createElement("div"), this.domNode.className = t.className, this.domNode.style.position = "absolute", this.domNode.style.width = Uo + "px", this.domNode.style.height = Uo + "px", typeof t.top < "u" && (this.domNode.style.top = t.top + "px"), typeof t.left < "u" && (this.domNode.style.left = t.left + "px"), typeof t.bottom < "u" && (this.domNode.style.bottom = t.bottom + "px"), typeof t.right < "u" && (this.domNode.style.right = t.right + "px"), this._pointerMoveMonitor = this._register(new Wt()), this._register(os(this.bgDomNode, Y.POINTER_DOWN, (e) => this._arrowPointerDown(e))), this._register(os(this.domNode, Y.POINTER_DOWN, (e) => this._arrowPointerDown(e))), this._pointerdownRepeatTimer = this._register(new Mr()), this._pointerdownScheduleRepeatTimer = this._register(new Ye());
      }
      _arrowPointerDown(t) {
        if (!t.target || !(t.target instanceof Element)) return;
        let e = () => {
          this._pointerdownRepeatTimer.cancelAndSet(() => this._onActivate(), 1e3 / 24, be(t));
        };
        this._onActivate(), this._pointerdownRepeatTimer.cancel(), this._pointerdownScheduleRepeatTimer.cancelAndSet(e, 200), this._pointerMoveMonitor.startMonitoring(t.target, t.pointerId, t.buttons, (i) => {
        }, () => {
          this._pointerdownRepeatTimer.cancel(), this._pointerdownScheduleRepeatTimer.cancel();
        }), t.preventDefault();
      }
    };
    cs = class s9 {
      constructor(t, e, i, r, n, o, l) {
        this._forceIntegerValues = t;
        this._scrollStateBrand = void 0;
        this._forceIntegerValues && (e = e | 0, i = i | 0, r = r | 0, n = n | 0, o = o | 0, l = l | 0), this.rawScrollLeft = r, this.rawScrollTop = l, e < 0 && (e = 0), r + e > i && (r = i - e), r < 0 && (r = 0), n < 0 && (n = 0), l + n > o && (l = o - n), l < 0 && (l = 0), this.width = e, this.scrollWidth = i, this.scrollLeft = r, this.height = n, this.scrollHeight = o, this.scrollTop = l;
      }
      equals(t) {
        return this.rawScrollLeft === t.rawScrollLeft && this.rawScrollTop === t.rawScrollTop && this.width === t.width && this.scrollWidth === t.scrollWidth && this.scrollLeft === t.scrollLeft && this.height === t.height && this.scrollHeight === t.scrollHeight && this.scrollTop === t.scrollTop;
      }
      withScrollDimensions(t, e) {
        return new s9(this._forceIntegerValues, typeof t.width < "u" ? t.width : this.width, typeof t.scrollWidth < "u" ? t.scrollWidth : this.scrollWidth, e ? this.rawScrollLeft : this.scrollLeft, typeof t.height < "u" ? t.height : this.height, typeof t.scrollHeight < "u" ? t.scrollHeight : this.scrollHeight, e ? this.rawScrollTop : this.scrollTop);
      }
      withScrollPosition(t) {
        return new s9(this._forceIntegerValues, this.width, this.scrollWidth, typeof t.scrollLeft < "u" ? t.scrollLeft : this.rawScrollLeft, this.height, this.scrollHeight, typeof t.scrollTop < "u" ? t.scrollTop : this.rawScrollTop);
      }
      createScrollEvent(t, e) {
        let i = this.width !== t.width, r = this.scrollWidth !== t.scrollWidth, n = this.scrollLeft !== t.scrollLeft, o = this.height !== t.height, l = this.scrollHeight !== t.scrollHeight, a = this.scrollTop !== t.scrollTop;
        return { inSmoothScrolling: e, oldWidth: t.width, oldScrollWidth: t.scrollWidth, oldScrollLeft: t.scrollLeft, width: this.width, scrollWidth: this.scrollWidth, scrollLeft: this.scrollLeft, oldHeight: t.height, oldScrollHeight: t.scrollHeight, oldScrollTop: t.scrollTop, height: this.height, scrollHeight: this.scrollHeight, scrollTop: this.scrollTop, widthChanged: i, scrollWidthChanged: r, scrollLeftChanged: n, heightChanged: o, scrollHeightChanged: l, scrollTopChanged: a };
      }
    }, Ri = class extends D {
      constructor(e) {
        super();
        this._scrollableBrand = void 0;
        this._onScroll = this._register(new v());
        this.onScroll = this._onScroll.event;
        this._smoothScrollDuration = e.smoothScrollDuration, this._scheduleAtNextAnimationFrame = e.scheduleAtNextAnimationFrame, this._state = new cs(e.forceIntegerValues, 0, 0, 0, 0, 0, 0), this._smoothScrolling = null;
      }
      dispose() {
        this._smoothScrolling && (this._smoothScrolling.dispose(), this._smoothScrolling = null), super.dispose();
      }
      setSmoothScrollDuration(e) {
        this._smoothScrollDuration = e;
      }
      validateScrollPosition(e) {
        return this._state.withScrollPosition(e);
      }
      getScrollDimensions() {
        return this._state;
      }
      setScrollDimensions(e, i) {
        let r = this._state.withScrollDimensions(e, i);
        this._setState(r, !!this._smoothScrolling), this._smoothScrolling?.acceptScrollDimensions(this._state);
      }
      getFutureScrollPosition() {
        return this._smoothScrolling ? this._smoothScrolling.to : this._state;
      }
      getCurrentScrollPosition() {
        return this._state;
      }
      setScrollPositionNow(e) {
        let i = this._state.withScrollPosition(e);
        this._smoothScrolling && (this._smoothScrolling.dispose(), this._smoothScrolling = null), this._setState(i, false);
      }
      setScrollPositionSmooth(e, i) {
        if (this._smoothScrollDuration === 0) return this.setScrollPositionNow(e);
        if (this._smoothScrolling) {
          e = { scrollLeft: typeof e.scrollLeft > "u" ? this._smoothScrolling.to.scrollLeft : e.scrollLeft, scrollTop: typeof e.scrollTop > "u" ? this._smoothScrolling.to.scrollTop : e.scrollTop };
          let r = this._state.withScrollPosition(e);
          if (this._smoothScrolling.to.scrollLeft === r.scrollLeft && this._smoothScrolling.to.scrollTop === r.scrollTop) return;
          let n;
          i ? n = new Nr(this._smoothScrolling.from, r, this._smoothScrolling.startTime, this._smoothScrolling.duration) : n = this._smoothScrolling.combine(this._state, r, this._smoothScrollDuration), this._smoothScrolling.dispose(), this._smoothScrolling = n;
        } else {
          let r = this._state.withScrollPosition(e);
          this._smoothScrolling = Nr.start(this._state, r, this._smoothScrollDuration);
        }
        this._smoothScrolling.animationFrameDisposable = this._scheduleAtNextAnimationFrame(() => {
          this._smoothScrolling && (this._smoothScrolling.animationFrameDisposable = null, this._performSmoothScrolling());
        });
      }
      hasPendingScrollAnimation() {
        return !!this._smoothScrolling;
      }
      _performSmoothScrolling() {
        if (!this._smoothScrolling) return;
        let e = this._smoothScrolling.tick(), i = this._state.withScrollPosition(e);
        if (this._setState(i, true), !!this._smoothScrolling) {
          if (e.isDone) {
            this._smoothScrolling.dispose(), this._smoothScrolling = null;
            return;
          }
          this._smoothScrolling.animationFrameDisposable = this._scheduleAtNextAnimationFrame(() => {
            this._smoothScrolling && (this._smoothScrolling.animationFrameDisposable = null, this._performSmoothScrolling());
          });
        }
      }
      _setState(e, i) {
        let r = this._state;
        r.equals(e) || (this._state = e, this._onScroll.fire(this._state.createScrollEvent(r, i)));
      }
    }, Br = class {
      constructor(t, e, i) {
        this.scrollLeft = t, this.scrollTop = e, this.isDone = i;
      }
    };
    Nr = class s10 {
      constructor(t, e, i, r) {
        this.from = t, this.to = e, this.duration = r, this.startTime = i, this.animationFrameDisposable = null, this._initAnimations();
      }
      _initAnimations() {
        this.scrollLeft = this._initAnimation(this.from.scrollLeft, this.to.scrollLeft, this.to.width), this.scrollTop = this._initAnimation(this.from.scrollTop, this.to.scrollTop, this.to.height);
      }
      _initAnimation(t, e, i) {
        if (Math.abs(t - e) > 2.5 * i) {
          let n, o;
          return t < e ? (n = t + 0.75 * i, o = e - 0.75 * i) : (n = t - 0.75 * i, o = e + 0.75 * i), La(as(t, n), as(o, e), 0.33);
        }
        return as(t, e);
      }
      dispose() {
        this.animationFrameDisposable !== null && (this.animationFrameDisposable.dispose(), this.animationFrameDisposable = null);
      }
      acceptScrollDimensions(t) {
        this.to = t.withScrollPosition(this.to), this._initAnimations();
      }
      tick() {
        return this._tick(Date.now());
      }
      _tick(t) {
        let e = (t - this.startTime) / this.duration;
        if (e < 1) {
          let i = this.scrollLeft(e), r = this.scrollTop(e);
          return new Br(i, r, false);
        }
        return new Br(this.to.scrollLeft, this.to.scrollTop, true);
      }
      combine(t, e, i) {
        return s10.start(t, e, i);
      }
      static start(t, e, i) {
        i = i + 10;
        let r = Date.now() - 10;
        return new s10(t, e, r, i);
      }
    };
    Fr = class extends D {
      constructor(t, e, i) {
        super(), this._visibility = t, this._visibleClassName = e, this._invisibleClassName = i, this._domNode = null, this._isVisible = false, this._isNeeded = false, this._rawShouldBeVisible = false, this._shouldBeVisible = false, this._revealTimer = this._register(new Ye());
      }
      setVisibility(t) {
        this._visibility !== t && (this._visibility = t, this._updateShouldBeVisible());
      }
      setShouldBeVisible(t) {
        this._rawShouldBeVisible = t, this._updateShouldBeVisible();
      }
      _applyVisibilitySetting() {
        return this._visibility === 2 ? false : this._visibility === 3 ? true : this._rawShouldBeVisible;
      }
      _updateShouldBeVisible() {
        let t = this._applyVisibilitySetting();
        this._shouldBeVisible !== t && (this._shouldBeVisible = t, this.ensureVisibility());
      }
      setIsNeeded(t) {
        this._isNeeded !== t && (this._isNeeded = t, this.ensureVisibility());
      }
      setDomNode(t) {
        this._domNode = t, this._domNode.setClassName(this._invisibleClassName), this.setShouldBeVisible(false);
      }
      ensureVisibility() {
        if (!this._isNeeded) {
          this._hide(false);
          return;
        }
        this._shouldBeVisible ? this._reveal() : this._hide(true);
      }
      _reveal() {
        this._isVisible || (this._isVisible = true, this._revealTimer.setIfNotSet(() => {
          this._domNode?.setClassName(this._visibleClassName);
        }, 0));
      }
      _hide(t) {
        this._revealTimer.cancel(), this._isVisible && (this._isVisible = false, this._domNode?.setClassName(this._invisibleClassName + (t ? " fade" : "")));
      }
    };
    Ca = 140, Ut = class extends lt {
      constructor(t) {
        super(), this._lazyRender = t.lazyRender, this._host = t.host, this._scrollable = t.scrollable, this._scrollByPage = t.scrollByPage, this._scrollbarState = t.scrollbarState, this._visibilityController = this._register(new Fr(t.visibility, "visible scrollbar " + t.extraScrollbarClassName, "invisible scrollbar " + t.extraScrollbarClassName)), this._visibilityController.setIsNeeded(this._scrollbarState.isNeeded()), this._pointerMoveMonitor = this._register(new Wt()), this._shouldRender = true, this.domNode = _t(document.createElement("div")), this.domNode.setAttribute("role", "presentation"), this.domNode.setAttribute("aria-hidden", "true"), this._visibilityController.setDomNode(this.domNode), this.domNode.setPosition("absolute"), this._register(L(this.domNode.domNode, Y.POINTER_DOWN, (e) => this._domNodePointerDown(e)));
      }
      _createArrow(t) {
        let e = this._register(new Or(t));
        this.domNode.domNode.appendChild(e.bgDomNode), this.domNode.domNode.appendChild(e.domNode);
      }
      _createSlider(t, e, i, r) {
        this.slider = _t(document.createElement("div")), this.slider.setClassName("slider"), this.slider.setPosition("absolute"), this.slider.setTop(t), this.slider.setLeft(e), typeof i == "number" && this.slider.setWidth(i), typeof r == "number" && this.slider.setHeight(r), this.slider.setLayerHinting(true), this.slider.setContain("strict"), this.domNode.domNode.appendChild(this.slider.domNode), this._register(L(this.slider.domNode, Y.POINTER_DOWN, (n) => {
          n.button === 0 && (n.preventDefault(), this._sliderPointerDown(n));
        })), this.onclick(this.slider.domNode, (n) => {
          n.leftButton && n.stopPropagation();
        });
      }
      _onElementSize(t) {
        return this._scrollbarState.setVisibleSize(t) && (this._visibilityController.setIsNeeded(this._scrollbarState.isNeeded()), this._shouldRender = true, this._lazyRender || this.render()), this._shouldRender;
      }
      _onElementScrollSize(t) {
        return this._scrollbarState.setScrollSize(t) && (this._visibilityController.setIsNeeded(this._scrollbarState.isNeeded()), this._shouldRender = true, this._lazyRender || this.render()), this._shouldRender;
      }
      _onElementScrollPosition(t) {
        return this._scrollbarState.setScrollPosition(t) && (this._visibilityController.setIsNeeded(this._scrollbarState.isNeeded()), this._shouldRender = true, this._lazyRender || this.render()), this._shouldRender;
      }
      beginReveal() {
        this._visibilityController.setShouldBeVisible(true);
      }
      beginHide() {
        this._visibilityController.setShouldBeVisible(false);
      }
      render() {
        this._shouldRender && (this._shouldRender = false, this._renderDomNode(this._scrollbarState.getRectangleLargeSize(), this._scrollbarState.getRectangleSmallSize()), this._updateSlider(this._scrollbarState.getSliderSize(), this._scrollbarState.getArrowSize() + this._scrollbarState.getSliderPosition()));
      }
      _domNodePointerDown(t) {
        t.target === this.domNode.domNode && this._onPointerDown(t);
      }
      delegatePointerDown(t) {
        let e = this.domNode.domNode.getClientRects()[0].top, i = e + this._scrollbarState.getSliderPosition(), r = e + this._scrollbarState.getSliderPosition() + this._scrollbarState.getSliderSize(), n = this._sliderPointerPosition(t);
        i <= n && n <= r ? t.button === 0 && (t.preventDefault(), this._sliderPointerDown(t)) : this._onPointerDown(t);
      }
      _onPointerDown(t) {
        let e, i;
        if (t.target === this.domNode.domNode && typeof t.offsetX == "number" && typeof t.offsetY == "number") e = t.offsetX, i = t.offsetY;
        else {
          let n = Fo(this.domNode.domNode);
          e = t.pageX - n.left, i = t.pageY - n.top;
        }
        let r = this._pointerDownRelativePosition(e, i);
        this._setDesiredScrollPositionNow(this._scrollByPage ? this._scrollbarState.getDesiredScrollPositionFromOffsetPaged(r) : this._scrollbarState.getDesiredScrollPositionFromOffset(r)), t.button === 0 && (t.preventDefault(), this._sliderPointerDown(t));
      }
      _sliderPointerDown(t) {
        if (!t.target || !(t.target instanceof Element)) return;
        let e = this._sliderPointerPosition(t), i = this._sliderOrthogonalPointerPosition(t), r = this._scrollbarState.clone();
        this.slider.toggleClassName("active", true), this._pointerMoveMonitor.startMonitoring(t.target, t.pointerId, t.buttons, (n) => {
          let o = this._sliderOrthogonalPointerPosition(n), l = Math.abs(o - i);
          if (wr && l > Ca) {
            this._setDesiredScrollPositionNow(r.getScrollPosition());
            return;
          }
          let u = this._sliderPointerPosition(n) - e;
          this._setDesiredScrollPositionNow(r.getDesiredScrollPositionFromDelta(u));
        }, () => {
          this.slider.toggleClassName("active", false), this._host.onDragEnd();
        }), this._host.onDragStart();
      }
      _setDesiredScrollPositionNow(t) {
        let e = {};
        this.writeScrollPosition(e, t), this._scrollable.setScrollPositionNow(e);
      }
      updateScrollbarSize(t) {
        this._updateScrollbarSize(t), this._scrollbarState.setScrollbarSize(t), this._shouldRender = true, this._lazyRender || this.render();
      }
      isNeeded() {
        return this._scrollbarState.isNeeded();
      }
    };
    Kt = class s11 {
      constructor(t, e, i, r, n, o) {
        this._scrollbarSize = Math.round(e), this._oppositeScrollbarSize = Math.round(i), this._arrowSize = Math.round(t), this._visibleSize = r, this._scrollSize = n, this._scrollPosition = o, this._computedAvailableSize = 0, this._computedIsNeeded = false, this._computedSliderSize = 0, this._computedSliderRatio = 0, this._computedSliderPosition = 0, this._refreshComputedValues();
      }
      clone() {
        return new s11(this._arrowSize, this._scrollbarSize, this._oppositeScrollbarSize, this._visibleSize, this._scrollSize, this._scrollPosition);
      }
      setVisibleSize(t) {
        let e = Math.round(t);
        return this._visibleSize !== e ? (this._visibleSize = e, this._refreshComputedValues(), true) : false;
      }
      setScrollSize(t) {
        let e = Math.round(t);
        return this._scrollSize !== e ? (this._scrollSize = e, this._refreshComputedValues(), true) : false;
      }
      setScrollPosition(t) {
        let e = Math.round(t);
        return this._scrollPosition !== e ? (this._scrollPosition = e, this._refreshComputedValues(), true) : false;
      }
      setScrollbarSize(t) {
        this._scrollbarSize = Math.round(t);
      }
      setOppositeScrollbarSize(t) {
        this._oppositeScrollbarSize = Math.round(t);
      }
      static _computeValues(t, e, i, r, n) {
        let o = Math.max(0, i - t), l = Math.max(0, o - 2 * e), a = r > 0 && r > i;
        if (!a) return { computedAvailableSize: Math.round(o), computedIsNeeded: a, computedSliderSize: Math.round(l), computedSliderRatio: 0, computedSliderPosition: 0 };
        let u = Math.round(Math.max(20, Math.floor(i * l / r))), h8 = (l - u) / (r - i), c = n * h8;
        return { computedAvailableSize: Math.round(o), computedIsNeeded: a, computedSliderSize: Math.round(u), computedSliderRatio: h8, computedSliderPosition: Math.round(c) };
      }
      _refreshComputedValues() {
        let t = s11._computeValues(this._oppositeScrollbarSize, this._arrowSize, this._visibleSize, this._scrollSize, this._scrollPosition);
        this._computedAvailableSize = t.computedAvailableSize, this._computedIsNeeded = t.computedIsNeeded, this._computedSliderSize = t.computedSliderSize, this._computedSliderRatio = t.computedSliderRatio, this._computedSliderPosition = t.computedSliderPosition;
      }
      getArrowSize() {
        return this._arrowSize;
      }
      getScrollPosition() {
        return this._scrollPosition;
      }
      getRectangleLargeSize() {
        return this._computedAvailableSize;
      }
      getRectangleSmallSize() {
        return this._scrollbarSize;
      }
      isNeeded() {
        return this._computedIsNeeded;
      }
      getSliderSize() {
        return this._computedSliderSize;
      }
      getSliderPosition() {
        return this._computedSliderPosition;
      }
      getDesiredScrollPositionFromOffset(t) {
        if (!this._computedIsNeeded) return 0;
        let e = t - this._arrowSize - this._computedSliderSize / 2;
        return Math.round(e / this._computedSliderRatio);
      }
      getDesiredScrollPositionFromOffsetPaged(t) {
        if (!this._computedIsNeeded) return 0;
        let e = t - this._arrowSize, i = this._scrollPosition;
        return e < this._computedSliderPosition ? i -= this._visibleSize : i += this._visibleSize, i;
      }
      getDesiredScrollPositionFromDelta(t) {
        if (!this._computedIsNeeded) return 0;
        let e = this._computedSliderPosition + t;
        return Math.round(e / this._computedSliderRatio);
      }
    };
    Wr = class extends Ut {
      constructor(t, e, i) {
        let r = t.getScrollDimensions(), n = t.getCurrentScrollPosition();
        if (super({ lazyRender: e.lazyRender, host: i, scrollbarState: new Kt(e.horizontalHasArrows ? e.arrowSize : 0, e.horizontal === 2 ? 0 : e.horizontalScrollbarSize, e.vertical === 2 ? 0 : e.verticalScrollbarSize, r.width, r.scrollWidth, n.scrollLeft), visibility: e.horizontal, extraScrollbarClassName: "horizontal", scrollable: t, scrollByPage: e.scrollByPage }), e.horizontalHasArrows) throw new Error("horizontalHasArrows is not supported in xterm.js");
        this._createSlider(Math.floor((e.horizontalScrollbarSize - e.horizontalSliderSize) / 2), 0, void 0, e.horizontalSliderSize);
      }
      _updateSlider(t, e) {
        this.slider.setWidth(t), this.slider.setLeft(e);
      }
      _renderDomNode(t, e) {
        this.domNode.setWidth(t), this.domNode.setHeight(e), this.domNode.setLeft(0), this.domNode.setBottom(0);
      }
      onDidScroll(t) {
        return this._shouldRender = this._onElementScrollSize(t.scrollWidth) || this._shouldRender, this._shouldRender = this._onElementScrollPosition(t.scrollLeft) || this._shouldRender, this._shouldRender = this._onElementSize(t.width) || this._shouldRender, this._shouldRender;
      }
      _pointerDownRelativePosition(t, e) {
        return t;
      }
      _sliderPointerPosition(t) {
        return t.pageX;
      }
      _sliderOrthogonalPointerPosition(t) {
        return t.pageY;
      }
      _updateScrollbarSize(t) {
        this.slider.setHeight(t);
      }
      writeScrollPosition(t, e) {
        t.scrollLeft = e;
      }
      updateOptions(t) {
        this.updateScrollbarSize(t.horizontal === 2 ? 0 : t.horizontalScrollbarSize), this._scrollbarState.setOppositeScrollbarSize(t.vertical === 2 ? 0 : t.verticalScrollbarSize), this._visibilityController.setVisibility(t.horizontal), this._scrollByPage = t.scrollByPage;
      }
    };
    Ur = class extends Ut {
      constructor(t, e, i) {
        let r = t.getScrollDimensions(), n = t.getCurrentScrollPosition();
        if (super({ lazyRender: e.lazyRender, host: i, scrollbarState: new Kt(e.verticalHasArrows ? e.arrowSize : 0, e.vertical === 2 ? 0 : e.verticalScrollbarSize, 0, r.height, r.scrollHeight, n.scrollTop), visibility: e.vertical, extraScrollbarClassName: "vertical", scrollable: t, scrollByPage: e.scrollByPage }), e.verticalHasArrows) throw new Error("horizontalHasArrows is not supported in xterm.js");
        this._createSlider(0, Math.floor((e.verticalScrollbarSize - e.verticalSliderSize) / 2), e.verticalSliderSize, void 0);
      }
      _updateSlider(t, e) {
        this.slider.setHeight(t), this.slider.setTop(e);
      }
      _renderDomNode(t, e) {
        this.domNode.setWidth(e), this.domNode.setHeight(t), this.domNode.setRight(0), this.domNode.setTop(0);
      }
      onDidScroll(t) {
        return this._shouldRender = this._onElementScrollSize(t.scrollHeight) || this._shouldRender, this._shouldRender = this._onElementScrollPosition(t.scrollTop) || this._shouldRender, this._shouldRender = this._onElementSize(t.height) || this._shouldRender, this._shouldRender;
      }
      _pointerDownRelativePosition(t, e) {
        return e;
      }
      _sliderPointerPosition(t) {
        return t.pageY;
      }
      _sliderOrthogonalPointerPosition(t) {
        return t.pageX;
      }
      _updateScrollbarSize(t) {
        this.slider.setWidth(t);
      }
      writeScrollPosition(t, e) {
        t.scrollTop = e;
      }
      updateOptions(t) {
        this.updateScrollbarSize(t.vertical === 2 ? 0 : t.verticalScrollbarSize), this._scrollbarState.setOppositeScrollbarSize(0), this._visibilityController.setVisibility(t.vertical), this._scrollByPage = t.scrollByPage;
      }
    };
    Ma = 500, Ko = 50, zo = true, us = class {
      constructor(t, e, i) {
        this.timestamp = t, this.deltaX = e, this.deltaY = i, this.score = 0;
      }
    }, zr = class zr2 {
      constructor() {
        this._capacity = 5, this._memory = [], this._front = -1, this._rear = -1;
      }
      isPhysicalMouseWheel() {
        if (this._front === -1 && this._rear === -1) return false;
        let t = 1, e = 0, i = 1, r = this._rear;
        do {
          let n = r === this._front ? t : Math.pow(2, -i);
          if (t -= n, e += this._memory[r].score * n, r === this._front) break;
          r = (this._capacity + r - 1) % this._capacity, i++;
        } while (true);
        return e <= 0.5;
      }
      acceptStandardWheelEvent(t) {
        if (Ti) {
          let e = be(t.browserEvent), i = mo(e);
          this.accept(Date.now(), t.deltaX * i, t.deltaY * i);
        } else this.accept(Date.now(), t.deltaX, t.deltaY);
      }
      accept(t, e, i) {
        let r = null, n = new us(t, e, i);
        this._front === -1 && this._rear === -1 ? (this._memory[0] = n, this._front = 0, this._rear = 0) : (r = this._memory[this._rear], this._rear = (this._rear + 1) % this._capacity, this._rear === this._front && (this._front = (this._front + 1) % this._capacity), this._memory[this._rear] = n), n.score = this._computeScore(n, r);
      }
      _computeScore(t, e) {
        if (Math.abs(t.deltaX) > 0 && Math.abs(t.deltaY) > 0) return 1;
        let i = 0.5;
        if ((!this._isAlmostInt(t.deltaX) || !this._isAlmostInt(t.deltaY)) && (i += 0.25), e) {
          let r = Math.abs(t.deltaX), n = Math.abs(t.deltaY), o = Math.abs(e.deltaX), l = Math.abs(e.deltaY), a = Math.max(Math.min(r, o), 1), u = Math.max(Math.min(n, l), 1), h8 = Math.max(r, o), c = Math.max(n, l);
          h8 % a === 0 && c % u === 0 && (i -= 0.5);
        }
        return Math.min(Math.max(i, 0), 1);
      }
      _isAlmostInt(t) {
        return Math.abs(Math.round(t) - t) < 0.01;
      }
    };
    zr.INSTANCE = new zr();
    hs = zr, ds = class extends lt {
      constructor(e, i, r) {
        super();
        this._onScroll = this._register(new v());
        this.onScroll = this._onScroll.event;
        this._onWillScroll = this._register(new v());
        this.onWillScroll = this._onWillScroll.event;
        this._options = Pa(i), this._scrollable = r, this._register(this._scrollable.onScroll((o) => {
          this._onWillScroll.fire(o), this._onDidScroll(o), this._onScroll.fire(o);
        }));
        let n = { onMouseWheel: (o) => this._onMouseWheel(o), onDragStart: () => this._onDragStart(), onDragEnd: () => this._onDragEnd() };
        this._verticalScrollbar = this._register(new Ur(this._scrollable, this._options, n)), this._horizontalScrollbar = this._register(new Wr(this._scrollable, this._options, n)), this._domNode = document.createElement("div"), this._domNode.className = "xterm-scrollable-element " + this._options.className, this._domNode.setAttribute("role", "presentation"), this._domNode.style.position = "relative", this._domNode.appendChild(e), this._domNode.appendChild(this._horizontalScrollbar.domNode.domNode), this._domNode.appendChild(this._verticalScrollbar.domNode.domNode), this._options.useShadows ? (this._leftShadowDomNode = _t(document.createElement("div")), this._leftShadowDomNode.setClassName("shadow"), this._domNode.appendChild(this._leftShadowDomNode.domNode), this._topShadowDomNode = _t(document.createElement("div")), this._topShadowDomNode.setClassName("shadow"), this._domNode.appendChild(this._topShadowDomNode.domNode), this._topLeftShadowDomNode = _t(document.createElement("div")), this._topLeftShadowDomNode.setClassName("shadow"), this._domNode.appendChild(this._topLeftShadowDomNode.domNode)) : (this._leftShadowDomNode = null, this._topShadowDomNode = null, this._topLeftShadowDomNode = null), this._listenOnDomNode = this._options.listenOnDomNode || this._domNode, this._mouseWheelToDispose = [], this._setListeningToMouseWheel(this._options.handleMouseWheel), this.onmouseover(this._listenOnDomNode, (o) => this._onMouseOver(o)), this.onmouseleave(this._listenOnDomNode, (o) => this._onMouseLeave(o)), this._hideTimeout = this._register(new Ye()), this._isDragging = false, this._mouseIsOver = false, this._shouldRender = true, this._revealOnScroll = true;
      }
      get options() {
        return this._options;
      }
      dispose() {
        this._mouseWheelToDispose = Ne(this._mouseWheelToDispose), super.dispose();
      }
      getDomNode() {
        return this._domNode;
      }
      getOverviewRulerLayoutInfo() {
        return { parent: this._domNode, insertBefore: this._verticalScrollbar.domNode.domNode };
      }
      delegateVerticalScrollbarPointerDown(e) {
        this._verticalScrollbar.delegatePointerDown(e);
      }
      getScrollDimensions() {
        return this._scrollable.getScrollDimensions();
      }
      setScrollDimensions(e) {
        this._scrollable.setScrollDimensions(e, false);
      }
      updateClassName(e) {
        this._options.className = e, Te && (this._options.className += " mac"), this._domNode.className = "xterm-scrollable-element " + this._options.className;
      }
      updateOptions(e) {
        typeof e.handleMouseWheel < "u" && (this._options.handleMouseWheel = e.handleMouseWheel, this._setListeningToMouseWheel(this._options.handleMouseWheel)), typeof e.mouseWheelScrollSensitivity < "u" && (this._options.mouseWheelScrollSensitivity = e.mouseWheelScrollSensitivity), typeof e.fastScrollSensitivity < "u" && (this._options.fastScrollSensitivity = e.fastScrollSensitivity), typeof e.scrollPredominantAxis < "u" && (this._options.scrollPredominantAxis = e.scrollPredominantAxis), typeof e.horizontal < "u" && (this._options.horizontal = e.horizontal), typeof e.vertical < "u" && (this._options.vertical = e.vertical), typeof e.horizontalScrollbarSize < "u" && (this._options.horizontalScrollbarSize = e.horizontalScrollbarSize), typeof e.verticalScrollbarSize < "u" && (this._options.verticalScrollbarSize = e.verticalScrollbarSize), typeof e.scrollByPage < "u" && (this._options.scrollByPage = e.scrollByPage), this._horizontalScrollbar.updateOptions(this._options), this._verticalScrollbar.updateOptions(this._options), this._options.lazyRender || this._render();
      }
      setRevealOnScroll(e) {
        this._revealOnScroll = e;
      }
      delegateScrollFromMouseWheelEvent(e) {
        this._onMouseWheel(new xi(e));
      }
      _setListeningToMouseWheel(e) {
        if (this._mouseWheelToDispose.length > 0 !== e && (this._mouseWheelToDispose = Ne(this._mouseWheelToDispose), e)) {
          let r = (n) => {
            this._onMouseWheel(new xi(n));
          };
          this._mouseWheelToDispose.push(L(this._listenOnDomNode, Y.MOUSE_WHEEL, r, { passive: false }));
        }
      }
      _onMouseWheel(e) {
        if (e.browserEvent?.defaultPrevented) return;
        let i = hs.INSTANCE;
        zo && i.acceptStandardWheelEvent(e);
        let r = false;
        if (e.deltaY || e.deltaX) {
          let o = e.deltaY * this._options.mouseWheelScrollSensitivity, l = e.deltaX * this._options.mouseWheelScrollSensitivity;
          this._options.scrollPredominantAxis && (this._options.scrollYToX && l + o === 0 ? l = o = 0 : Math.abs(o) >= Math.abs(l) ? l = 0 : o = 0), this._options.flipAxes && ([o, l] = [l, o]);
          let a = !Te && e.browserEvent && e.browserEvent.shiftKey;
          (this._options.scrollYToX || a) && !l && (l = o, o = 0), e.browserEvent && e.browserEvent.altKey && (l = l * this._options.fastScrollSensitivity, o = o * this._options.fastScrollSensitivity);
          let u = this._scrollable.getFutureScrollPosition(), h8 = {};
          if (o) {
            let c = Ko * o, d = u.scrollTop - (c < 0 ? Math.floor(c) : Math.ceil(c));
            this._verticalScrollbar.writeScrollPosition(h8, d);
          }
          if (l) {
            let c = Ko * l, d = u.scrollLeft - (c < 0 ? Math.floor(c) : Math.ceil(c));
            this._horizontalScrollbar.writeScrollPosition(h8, d);
          }
          h8 = this._scrollable.validateScrollPosition(h8), (u.scrollLeft !== h8.scrollLeft || u.scrollTop !== h8.scrollTop) && (zo && this._options.mouseWheelSmoothScroll && i.isPhysicalMouseWheel() ? this._scrollable.setScrollPositionSmooth(h8) : this._scrollable.setScrollPositionNow(h8), r = true);
        }
        let n = r;
        !n && this._options.alwaysConsumeMouseWheel && (n = true), !n && this._options.consumeMouseWheelIfScrollbarIsNeeded && (this._verticalScrollbar.isNeeded() || this._horizontalScrollbar.isNeeded()) && (n = true), n && (e.preventDefault(), e.stopPropagation());
      }
      _onDidScroll(e) {
        this._shouldRender = this._horizontalScrollbar.onDidScroll(e) || this._shouldRender, this._shouldRender = this._verticalScrollbar.onDidScroll(e) || this._shouldRender, this._options.useShadows && (this._shouldRender = true), this._revealOnScroll && this._reveal(), this._options.lazyRender || this._render();
      }
      renderNow() {
        if (!this._options.lazyRender) throw new Error("Please use `lazyRender` together with `renderNow`!");
        this._render();
      }
      _render() {
        if (this._shouldRender && (this._shouldRender = false, this._horizontalScrollbar.render(), this._verticalScrollbar.render(), this._options.useShadows)) {
          let e = this._scrollable.getCurrentScrollPosition(), i = e.scrollTop > 0, r = e.scrollLeft > 0, n = r ? " left" : "", o = i ? " top" : "", l = r || i ? " top-left-corner" : "";
          this._leftShadowDomNode.setClassName(`shadow${n}`), this._topShadowDomNode.setClassName(`shadow${o}`), this._topLeftShadowDomNode.setClassName(`shadow${l}${o}${n}`);
        }
      }
      _onDragStart() {
        this._isDragging = true, this._reveal();
      }
      _onDragEnd() {
        this._isDragging = false, this._hide();
      }
      _onMouseLeave(e) {
        this._mouseIsOver = false, this._hide();
      }
      _onMouseOver(e) {
        this._mouseIsOver = true, this._reveal();
      }
      _reveal() {
        this._verticalScrollbar.beginReveal(), this._horizontalScrollbar.beginReveal(), this._scheduleHide();
      }
      _hide() {
        !this._mouseIsOver && !this._isDragging && (this._verticalScrollbar.beginHide(), this._horizontalScrollbar.beginHide());
      }
      _scheduleHide() {
        !this._mouseIsOver && !this._isDragging && this._hideTimeout.cancelAndSet(() => this._hide(), Ma);
      }
    };
    Kr = class extends ds {
      constructor(t, e, i) {
        super(t, e, i);
      }
      setScrollPosition(t) {
        t.reuseAnimation ? this._scrollable.setScrollPositionSmooth(t, t.reuseAnimation) : this._scrollable.setScrollPositionNow(t);
      }
      getScrollPosition() {
        return this._scrollable.getCurrentScrollPosition();
      }
    };
    zt = class extends D {
      constructor(e, i, r, n, o, l, a, u) {
        super();
        this._bufferService = r;
        this._optionsService = a;
        this._renderService = u;
        this._onRequestScrollLines = this._register(new v());
        this.onRequestScrollLines = this._onRequestScrollLines.event;
        this._isSyncing = false;
        this._isHandlingScroll = false;
        this._suppressOnScrollHandler = false;
        let h8 = this._register(new Ri({ forceIntegerValues: false, smoothScrollDuration: this._optionsService.rawOptions.smoothScrollDuration, scheduleAtNextAnimationFrame: (c) => mt(n.window, c) }));
        this._register(this._optionsService.onSpecificOptionChange("smoothScrollDuration", () => {
          h8.setSmoothScrollDuration(this._optionsService.rawOptions.smoothScrollDuration);
        })), this._scrollableElement = this._register(new Kr(i, { vertical: 1, horizontal: 2, useShadows: false, mouseWheelSmoothScroll: true, ...this._getChangeOptions() }, h8)), this._register(this._optionsService.onMultipleOptionChange(["scrollSensitivity", "fastScrollSensitivity", "overviewRuler"], () => this._scrollableElement.updateOptions(this._getChangeOptions()))), this._register(o.onProtocolChange((c) => {
          this._scrollableElement.updateOptions({ handleMouseWheel: !(c & 16) });
        })), this._scrollableElement.setScrollDimensions({ height: 0, scrollHeight: 0 }), this._register($.runAndSubscribe(l.onChangeColors, () => {
          this._scrollableElement.getDomNode().style.backgroundColor = l.colors.background.css;
        })), e.appendChild(this._scrollableElement.getDomNode()), this._register(C(() => this._scrollableElement.getDomNode().remove())), this._styleElement = n.mainDocument.createElement("style"), i.appendChild(this._styleElement), this._register(C(() => this._styleElement.remove())), this._register($.runAndSubscribe(l.onChangeColors, () => {
          this._styleElement.textContent = [".xterm .xterm-scrollable-element > .scrollbar > .slider {", `  background: ${l.colors.scrollbarSliderBackground.css};`, "}", ".xterm .xterm-scrollable-element > .scrollbar > .slider:hover {", `  background: ${l.colors.scrollbarSliderHoverBackground.css};`, "}", ".xterm .xterm-scrollable-element > .scrollbar > .slider.active {", `  background: ${l.colors.scrollbarSliderActiveBackground.css};`, "}"].join(`
`);
        })), this._register(this._bufferService.onResize(() => this.queueSync())), this._register(this._bufferService.buffers.onBufferActivate(() => {
          this._latestYDisp = void 0, this.queueSync();
        })), this._register(this._bufferService.onScroll(() => this._sync())), this._register(this._scrollableElement.onScroll((c) => this._handleScroll(c)));
      }
      scrollLines(e) {
        let i = this._scrollableElement.getScrollPosition();
        this._scrollableElement.setScrollPosition({ reuseAnimation: true, scrollTop: i.scrollTop + e * this._renderService.dimensions.css.cell.height });
      }
      scrollToLine(e, i) {
        i && (this._latestYDisp = e), this._scrollableElement.setScrollPosition({ reuseAnimation: !i, scrollTop: e * this._renderService.dimensions.css.cell.height });
      }
      _getChangeOptions() {
        return { mouseWheelScrollSensitivity: this._optionsService.rawOptions.scrollSensitivity, fastScrollSensitivity: this._optionsService.rawOptions.fastScrollSensitivity, verticalScrollbarSize: this._optionsService.rawOptions.overviewRuler?.width || 14 };
      }
      queueSync(e) {
        e !== void 0 && (this._latestYDisp = e), this._queuedAnimationFrame === void 0 && (this._queuedAnimationFrame = this._renderService.addRefreshCallback(() => {
          this._queuedAnimationFrame = void 0, this._sync(this._latestYDisp);
        }));
      }
      _sync(e = this._bufferService.buffer.ydisp) {
        !this._renderService || this._isSyncing || (this._isSyncing = true, this._suppressOnScrollHandler = true, this._scrollableElement.setScrollDimensions({ height: this._renderService.dimensions.css.canvas.height, scrollHeight: this._renderService.dimensions.css.cell.height * this._bufferService.buffer.lines.length }), this._suppressOnScrollHandler = false, e !== this._latestYDisp && this._scrollableElement.setScrollPosition({ scrollTop: e * this._renderService.dimensions.css.cell.height }), this._isSyncing = false);
      }
      _handleScroll(e) {
        if (!this._renderService || this._isHandlingScroll || this._suppressOnScrollHandler) return;
        this._isHandlingScroll = true;
        let i = Math.round(e.scrollTop / this._renderService.dimensions.css.cell.height), r = i - this._bufferService.buffer.ydisp;
        r !== 0 && (this._latestYDisp = i, this._onRequestScrollLines.fire(r)), this._isHandlingScroll = false;
      }
    };
    zt = M([S(2, F), S(3, ae), S(4, rr), S(5, Re), S(6, H), S(7, ce)], zt);
    Gt = class extends D {
      constructor(e, i, r, n, o) {
        super();
        this._screenElement = e;
        this._bufferService = i;
        this._coreBrowserService = r;
        this._decorationService = n;
        this._renderService = o;
        this._decorationElements = /* @__PURE__ */ new Map();
        this._altBufferIsActive = false;
        this._dimensionsChanged = false;
        this._container = document.createElement("div"), this._container.classList.add("xterm-decoration-container"), this._screenElement.appendChild(this._container), this._register(this._renderService.onRenderedViewportChange(() => this._doRefreshDecorations())), this._register(this._renderService.onDimensionsChange(() => {
          this._dimensionsChanged = true, this._queueRefresh();
        })), this._register(this._coreBrowserService.onDprChange(() => this._queueRefresh())), this._register(this._bufferService.buffers.onBufferActivate(() => {
          this._altBufferIsActive = this._bufferService.buffer === this._bufferService.buffers.alt;
        })), this._register(this._decorationService.onDecorationRegistered(() => this._queueRefresh())), this._register(this._decorationService.onDecorationRemoved((l) => this._removeDecoration(l))), this._register(C(() => {
          this._container.remove(), this._decorationElements.clear();
        }));
      }
      _queueRefresh() {
        this._animationFrame === void 0 && (this._animationFrame = this._renderService.addRefreshCallback(() => {
          this._doRefreshDecorations(), this._animationFrame = void 0;
        }));
      }
      _doRefreshDecorations() {
        for (let e of this._decorationService.decorations) this._renderDecoration(e);
        this._dimensionsChanged = false;
      }
      _renderDecoration(e) {
        this._refreshStyle(e), this._dimensionsChanged && this._refreshXPosition(e);
      }
      _createElement(e) {
        let i = this._coreBrowserService.mainDocument.createElement("div");
        i.classList.add("xterm-decoration"), i.classList.toggle("xterm-decoration-top-layer", e?.options?.layer === "top"), i.style.width = `${Math.round((e.options.width || 1) * this._renderService.dimensions.css.cell.width)}px`, i.style.height = `${(e.options.height || 1) * this._renderService.dimensions.css.cell.height}px`, i.style.top = `${(e.marker.line - this._bufferService.buffers.active.ydisp) * this._renderService.dimensions.css.cell.height}px`, i.style.lineHeight = `${this._renderService.dimensions.css.cell.height}px`;
        let r = e.options.x ?? 0;
        return r && r > this._bufferService.cols && (i.style.display = "none"), this._refreshXPosition(e, i), i;
      }
      _refreshStyle(e) {
        let i = e.marker.line - this._bufferService.buffers.active.ydisp;
        if (i < 0 || i >= this._bufferService.rows) e.element && (e.element.style.display = "none", e.onRenderEmitter.fire(e.element));
        else {
          let r = this._decorationElements.get(e);
          r || (r = this._createElement(e), e.element = r, this._decorationElements.set(e, r), this._container.appendChild(r), e.onDispose(() => {
            this._decorationElements.delete(e), r.remove();
          })), r.style.display = this._altBufferIsActive ? "none" : "block", this._altBufferIsActive || (r.style.width = `${Math.round((e.options.width || 1) * this._renderService.dimensions.css.cell.width)}px`, r.style.height = `${(e.options.height || 1) * this._renderService.dimensions.css.cell.height}px`, r.style.top = `${i * this._renderService.dimensions.css.cell.height}px`, r.style.lineHeight = `${this._renderService.dimensions.css.cell.height}px`), e.onRenderEmitter.fire(r);
        }
      }
      _refreshXPosition(e, i = e.element) {
        if (!i) return;
        let r = e.options.x ?? 0;
        (e.options.anchor || "left") === "right" ? i.style.right = r ? `${r * this._renderService.dimensions.css.cell.width}px` : "" : i.style.left = r ? `${r * this._renderService.dimensions.css.cell.width}px` : "";
      }
      _removeDecoration(e) {
        this._decorationElements.get(e)?.remove(), this._decorationElements.delete(e), e.dispose();
      }
    };
    Gt = M([S(1, F), S(2, ae), S(3, Be), S(4, ce)], Gt);
    Gr = class {
      constructor() {
        this._zones = [];
        this._zonePool = [];
        this._zonePoolIndex = 0;
        this._linePadding = { full: 0, left: 0, center: 0, right: 0 };
      }
      get zones() {
        return this._zonePool.length = Math.min(this._zonePool.length, this._zones.length), this._zones;
      }
      clear() {
        this._zones.length = 0, this._zonePoolIndex = 0;
      }
      addDecoration(t) {
        if (t.options.overviewRulerOptions) {
          for (let e of this._zones) if (e.color === t.options.overviewRulerOptions.color && e.position === t.options.overviewRulerOptions.position) {
            if (this._lineIntersectsZone(e, t.marker.line)) return;
            if (this._lineAdjacentToZone(e, t.marker.line, t.options.overviewRulerOptions.position)) {
              this._addLineToZone(e, t.marker.line);
              return;
            }
          }
          if (this._zonePoolIndex < this._zonePool.length) {
            this._zonePool[this._zonePoolIndex].color = t.options.overviewRulerOptions.color, this._zonePool[this._zonePoolIndex].position = t.options.overviewRulerOptions.position, this._zonePool[this._zonePoolIndex].startBufferLine = t.marker.line, this._zonePool[this._zonePoolIndex].endBufferLine = t.marker.line, this._zones.push(this._zonePool[this._zonePoolIndex++]);
            return;
          }
          this._zones.push({ color: t.options.overviewRulerOptions.color, position: t.options.overviewRulerOptions.position, startBufferLine: t.marker.line, endBufferLine: t.marker.line }), this._zonePool.push(this._zones[this._zones.length - 1]), this._zonePoolIndex++;
        }
      }
      setPadding(t) {
        this._linePadding = t;
      }
      _lineIntersectsZone(t, e) {
        return e >= t.startBufferLine && e <= t.endBufferLine;
      }
      _lineAdjacentToZone(t, e, i) {
        return e >= t.startBufferLine - this._linePadding[i || "full"] && e <= t.endBufferLine + this._linePadding[i || "full"];
      }
      _addLineToZone(t, e) {
        t.startBufferLine = Math.min(t.startBufferLine, e), t.endBufferLine = Math.max(t.endBufferLine, e);
      }
    };
    We = { full: 0, left: 0, center: 0, right: 0 }, at = { full: 0, left: 0, center: 0, right: 0 }, Li = { full: 0, left: 0, center: 0, right: 0 }, bt = class extends D {
      constructor(e, i, r, n, o, l, a, u) {
        super();
        this._viewportElement = e;
        this._screenElement = i;
        this._bufferService = r;
        this._decorationService = n;
        this._renderService = o;
        this._optionsService = l;
        this._themeService = a;
        this._coreBrowserService = u;
        this._colorZoneStore = new Gr();
        this._shouldUpdateDimensions = true;
        this._shouldUpdateAnchor = true;
        this._lastKnownBufferLength = 0;
        this._canvas = this._coreBrowserService.mainDocument.createElement("canvas"), this._canvas.classList.add("xterm-decoration-overview-ruler"), this._refreshCanvasDimensions(), this._viewportElement.parentElement?.insertBefore(this._canvas, this._viewportElement), this._register(C(() => this._canvas?.remove()));
        let h8 = this._canvas.getContext("2d");
        if (h8) this._ctx = h8;
        else throw new Error("Ctx cannot be null");
        this._register(this._decorationService.onDecorationRegistered(() => this._queueRefresh(void 0, true))), this._register(this._decorationService.onDecorationRemoved(() => this._queueRefresh(void 0, true))), this._register(this._renderService.onRenderedViewportChange(() => this._queueRefresh())), this._register(this._bufferService.buffers.onBufferActivate(() => {
          this._canvas.style.display = this._bufferService.buffer === this._bufferService.buffers.alt ? "none" : "block";
        })), this._register(this._bufferService.onScroll(() => {
          this._lastKnownBufferLength !== this._bufferService.buffers.normal.lines.length && (this._refreshDrawHeightConstants(), this._refreshColorZonePadding());
        })), this._register(this._renderService.onRender(() => {
          (!this._containerHeight || this._containerHeight !== this._screenElement.clientHeight) && (this._queueRefresh(true), this._containerHeight = this._screenElement.clientHeight);
        })), this._register(this._coreBrowserService.onDprChange(() => this._queueRefresh(true))), this._register(this._optionsService.onSpecificOptionChange("overviewRuler", () => this._queueRefresh(true))), this._register(this._themeService.onChangeColors(() => this._queueRefresh())), this._queueRefresh(true);
      }
      get _width() {
        return this._optionsService.options.overviewRuler?.width || 0;
      }
      _refreshDrawConstants() {
        let e = Math.floor((this._canvas.width - 1) / 3), i = Math.ceil((this._canvas.width - 1) / 3);
        at.full = this._canvas.width, at.left = e, at.center = i, at.right = e, this._refreshDrawHeightConstants(), Li.full = 1, Li.left = 1, Li.center = 1 + at.left, Li.right = 1 + at.left + at.center;
      }
      _refreshDrawHeightConstants() {
        We.full = Math.round(2 * this._coreBrowserService.dpr);
        let e = this._canvas.height / this._bufferService.buffer.lines.length, i = Math.round(Math.max(Math.min(e, 12), 6) * this._coreBrowserService.dpr);
        We.left = i, We.center = i, We.right = i;
      }
      _refreshColorZonePadding() {
        this._colorZoneStore.setPadding({ full: Math.floor(this._bufferService.buffers.active.lines.length / (this._canvas.height - 1) * We.full), left: Math.floor(this._bufferService.buffers.active.lines.length / (this._canvas.height - 1) * We.left), center: Math.floor(this._bufferService.buffers.active.lines.length / (this._canvas.height - 1) * We.center), right: Math.floor(this._bufferService.buffers.active.lines.length / (this._canvas.height - 1) * We.right) }), this._lastKnownBufferLength = this._bufferService.buffers.normal.lines.length;
      }
      _refreshCanvasDimensions() {
        this._canvas.style.width = `${this._width}px`, this._canvas.width = Math.round(this._width * this._coreBrowserService.dpr), this._canvas.style.height = `${this._screenElement.clientHeight}px`, this._canvas.height = Math.round(this._screenElement.clientHeight * this._coreBrowserService.dpr), this._refreshDrawConstants(), this._refreshColorZonePadding();
      }
      _refreshDecorations() {
        this._shouldUpdateDimensions && this._refreshCanvasDimensions(), this._ctx.clearRect(0, 0, this._canvas.width, this._canvas.height), this._colorZoneStore.clear();
        for (let i of this._decorationService.decorations) this._colorZoneStore.addDecoration(i);
        this._ctx.lineWidth = 1, this._renderRulerOutline();
        let e = this._colorZoneStore.zones;
        for (let i of e) i.position !== "full" && this._renderColorZone(i);
        for (let i of e) i.position === "full" && this._renderColorZone(i);
        this._shouldUpdateDimensions = false, this._shouldUpdateAnchor = false;
      }
      _renderRulerOutline() {
        this._ctx.fillStyle = this._themeService.colors.overviewRulerBorder.css, this._ctx.fillRect(0, 0, 1, this._canvas.height), this._optionsService.rawOptions.overviewRuler.showTopBorder && this._ctx.fillRect(1, 0, this._canvas.width - 1, 1), this._optionsService.rawOptions.overviewRuler.showBottomBorder && this._ctx.fillRect(1, this._canvas.height - 1, this._canvas.width - 1, this._canvas.height);
      }
      _renderColorZone(e) {
        this._ctx.fillStyle = e.color, this._ctx.fillRect(Li[e.position || "full"], Math.round((this._canvas.height - 1) * (e.startBufferLine / this._bufferService.buffers.active.lines.length) - We[e.position || "full"] / 2), at[e.position || "full"], Math.round((this._canvas.height - 1) * ((e.endBufferLine - e.startBufferLine) / this._bufferService.buffers.active.lines.length) + We[e.position || "full"]));
      }
      _queueRefresh(e, i) {
        this._shouldUpdateDimensions = e || this._shouldUpdateDimensions, this._shouldUpdateAnchor = i || this._shouldUpdateAnchor, this._animationFrame === void 0 && (this._animationFrame = this._coreBrowserService.window.requestAnimationFrame(() => {
          this._refreshDecorations(), this._animationFrame = void 0;
        }));
      }
    };
    bt = M([S(2, F), S(3, Be), S(4, ce), S(5, H), S(6, Re), S(7, ae)], bt);
    ((E) => (E.NUL = "\0", E.SOH = "", E.STX = "", E.ETX = "", E.EOT = "", E.ENQ = "", E.ACK = "", E.BEL = "\x07", E.BS = "\b", E.HT = "	", E.LF = `
`, E.VT = "\v", E.FF = "\f", E.CR = "\r", E.SO = "", E.SI = "", E.DLE = "", E.DC1 = "", E.DC2 = "", E.DC3 = "", E.DC4 = "", E.NAK = "", E.SYN = "", E.ETB = "", E.CAN = "", E.EM = "", E.SUB = "", E.ESC = "\x1B", E.FS = "", E.GS = "", E.RS = "", E.US = "", E.SP = " ", E.DEL = ""))(b ||= {});
    ((g) => (g.PAD = "", g.HOP = "", g.BPH = "", g.NBH = "", g.IND = "", g.NEL = "", g.SSA = "", g.ESA = "", g.HTS = "", g.HTJ = "", g.VTS = "", g.PLD = "", g.PLU = "", g.RI = "", g.SS2 = "", g.SS3 = "", g.DCS = "", g.PU1 = "", g.PU2 = "", g.STS = "", g.CCH = "", g.MW = "", g.SPA = "", g.EPA = "", g.SOS = "", g.SGCI = "", g.SCI = "", g.CSI = "", g.ST = "", g.OSC = "", g.PM = "", g.APC = ""))(Ai ||= {});
    ((t) => t.ST = `${b.ESC}\\`)(fs ||= {});
    $t = class {
      constructor(t, e, i, r, n, o) {
        this._textarea = t;
        this._compositionView = e;
        this._bufferService = i;
        this._optionsService = r;
        this._coreService = n;
        this._renderService = o;
        this._isComposing = false, this._isSendingComposition = false, this._compositionPosition = { start: 0, end: 0 }, this._dataAlreadySent = "";
      }
      get isComposing() {
        return this._isComposing;
      }
      compositionstart() {
        this._isComposing = true, this._compositionPosition.start = this._textarea.value.length, this._compositionView.textContent = "", this._dataAlreadySent = "", this._compositionView.classList.add("active");
      }
      compositionupdate(t) {
        this._compositionView.textContent = t.data, this.updateCompositionElements(), setTimeout(() => {
          this._compositionPosition.end = this._textarea.value.length;
        }, 0);
      }
      compositionend() {
        this._finalizeComposition(true);
      }
      keydown(t) {
        if (this._isComposing || this._isSendingComposition) {
          if (t.keyCode === 20 || t.keyCode === 229 || t.keyCode === 16 || t.keyCode === 17 || t.keyCode === 18) return false;
          this._finalizeComposition(false);
        }
        return t.keyCode === 229 ? (this._handleAnyTextareaChanges(), false) : true;
      }
      _finalizeComposition(t) {
        if (this._compositionView.classList.remove("active"), this._isComposing = false, t) {
          let e = { start: this._compositionPosition.start, end: this._compositionPosition.end };
          this._isSendingComposition = true, setTimeout(() => {
            if (this._isSendingComposition) {
              this._isSendingComposition = false;
              let i;
              e.start += this._dataAlreadySent.length, this._isComposing ? i = this._textarea.value.substring(e.start, this._compositionPosition.start) : i = this._textarea.value.substring(e.start), i.length > 0 && this._coreService.triggerDataEvent(i, true);
            }
          }, 0);
        } else {
          this._isSendingComposition = false;
          let e = this._textarea.value.substring(this._compositionPosition.start, this._compositionPosition.end);
          this._coreService.triggerDataEvent(e, true);
        }
      }
      _handleAnyTextareaChanges() {
        let t = this._textarea.value;
        setTimeout(() => {
          if (!this._isComposing) {
            let e = this._textarea.value, i = e.replace(t, "");
            this._dataAlreadySent = i, e.length > t.length ? this._coreService.triggerDataEvent(i, true) : e.length < t.length ? this._coreService.triggerDataEvent(`${b.DEL}`, true) : e.length === t.length && e !== t && this._coreService.triggerDataEvent(e, true);
          }
        }, 0);
      }
      updateCompositionElements(t) {
        if (this._isComposing) {
          if (this._bufferService.buffer.isCursorInViewport) {
            let e = Math.min(this._bufferService.buffer.x, this._bufferService.cols - 1), i = this._renderService.dimensions.css.cell.height, r = this._bufferService.buffer.y * this._renderService.dimensions.css.cell.height, n = e * this._renderService.dimensions.css.cell.width;
            this._compositionView.style.left = n + "px", this._compositionView.style.top = r + "px", this._compositionView.style.height = i + "px", this._compositionView.style.lineHeight = i + "px", this._compositionView.style.fontFamily = this._optionsService.rawOptions.fontFamily, this._compositionView.style.fontSize = this._optionsService.rawOptions.fontSize + "px";
            let o = this._compositionView.getBoundingClientRect();
            this._textarea.style.left = n + "px", this._textarea.style.top = r + "px", this._textarea.style.width = Math.max(o.width, 1) + "px", this._textarea.style.height = Math.max(o.height, 1) + "px", this._textarea.style.lineHeight = o.height + "px";
          }
          t || setTimeout(() => this.updateCompositionElements(true), 0);
        }
      }
    };
    $t = M([S(2, F), S(3, H), S(4, ge), S(5, ce)], $t);
    ue = 0, he = 0, de = 0, J = 0, ps = { css: "#00000000", rgba: 0 };
    ((i) => {
      function s15(r, n, o, l) {
        return l !== void 0 ? `#${vt(r)}${vt(n)}${vt(o)}${vt(l)}` : `#${vt(r)}${vt(n)}${vt(o)}`;
      }
      i.toCss = s15;
      function t(r, n, o, l = 255) {
        return (r << 24 | n << 16 | o << 8 | l) >>> 0;
      }
      i.toRgba = t;
      function e(r, n, o, l) {
        return { css: i.toCss(r, n, o, l), rgba: i.toRgba(r, n, o, l) };
      }
      i.toColor = e;
    })(j ||= {});
    ((l) => {
      function s15(a, u) {
        if (J = (u.rgba & 255) / 255, J === 1) return { css: u.css, rgba: u.rgba };
        let h8 = u.rgba >> 24 & 255, c = u.rgba >> 16 & 255, d = u.rgba >> 8 & 255, _ = a.rgba >> 24 & 255, p = a.rgba >> 16 & 255, m = a.rgba >> 8 & 255;
        ue = _ + Math.round((h8 - _) * J), he = p + Math.round((c - p) * J), de = m + Math.round((d - m) * J);
        let f = j.toCss(ue, he, de), A = j.toRgba(ue, he, de);
        return { css: f, rgba: A };
      }
      l.blend = s15;
      function t(a) {
        return (a.rgba & 255) === 255;
      }
      l.isOpaque = t;
      function e(a, u, h8) {
        let c = $r.ensureContrastRatio(a.rgba, u.rgba, h8);
        if (c) return j.toColor(c >> 24 & 255, c >> 16 & 255, c >> 8 & 255);
      }
      l.ensureContrastRatio = e;
      function i(a) {
        let u = (a.rgba | 255) >>> 0;
        return [ue, he, de] = $r.toChannels(u), { css: j.toCss(ue, he, de), rgba: u };
      }
      l.opaque = i;
      function r(a, u) {
        return J = Math.round(u * 255), [ue, he, de] = $r.toChannels(a.rgba), { css: j.toCss(ue, he, de, J), rgba: j.toRgba(ue, he, de, J) };
      }
      l.opacity = r;
      function n(a, u) {
        return J = a.rgba & 255, r(a, J * u / 255);
      }
      l.multiplyOpacity = n;
      function o(a) {
        return [a.rgba >> 24 & 255, a.rgba >> 16 & 255, a.rgba >> 8 & 255];
      }
      l.toColorRGB = o;
    })(U ||= {});
    ((i) => {
      let s15, t;
      try {
        let r = document.createElement("canvas");
        r.width = 1, r.height = 1;
        let n = r.getContext("2d", { willReadFrequently: true });
        n && (s15 = n, s15.globalCompositeOperation = "copy", t = s15.createLinearGradient(0, 0, 1, 1));
      } catch {
      }
      function e(r) {
        if (r.match(/#[\da-f]{3,8}/i)) switch (r.length) {
          case 4:
            return ue = parseInt(r.slice(1, 2).repeat(2), 16), he = parseInt(r.slice(2, 3).repeat(2), 16), de = parseInt(r.slice(3, 4).repeat(2), 16), j.toColor(ue, he, de);
          case 5:
            return ue = parseInt(r.slice(1, 2).repeat(2), 16), he = parseInt(r.slice(2, 3).repeat(2), 16), de = parseInt(r.slice(3, 4).repeat(2), 16), J = parseInt(r.slice(4, 5).repeat(2), 16), j.toColor(ue, he, de, J);
          case 7:
            return { css: r, rgba: (parseInt(r.slice(1), 16) << 8 | 255) >>> 0 };
          case 9:
            return { css: r, rgba: parseInt(r.slice(1), 16) >>> 0 };
        }
        let n = r.match(/rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(,\s*(0|1|\d?\.(\d+))\s*)?\)/);
        if (n) return ue = parseInt(n[1]), he = parseInt(n[2]), de = parseInt(n[3]), J = Math.round((n[5] === void 0 ? 1 : parseFloat(n[5])) * 255), j.toColor(ue, he, de, J);
        if (!s15 || !t) throw new Error("css.toColor: Unsupported css format");
        if (s15.fillStyle = t, s15.fillStyle = r, typeof s15.fillStyle != "string") throw new Error("css.toColor: Unsupported css format");
        if (s15.fillRect(0, 0, 1, 1), [ue, he, de, J] = s15.getImageData(0, 0, 1, 1).data, J !== 255) throw new Error("css.toColor: Unsupported css format");
        return { rgba: j.toRgba(ue, he, de, J), css: r };
      }
      i.toColor = e;
    })(z ||= {});
    ((e) => {
      function s15(i) {
        return t(i >> 16 & 255, i >> 8 & 255, i & 255);
      }
      e.relativeLuminance = s15;
      function t(i, r, n) {
        let o = i / 255, l = r / 255, a = n / 255, u = o <= 0.03928 ? o / 12.92 : Math.pow((o + 0.055) / 1.055, 2.4), h8 = l <= 0.03928 ? l / 12.92 : Math.pow((l + 0.055) / 1.055, 2.4), c = a <= 0.03928 ? a / 12.92 : Math.pow((a + 0.055) / 1.055, 2.4);
        return u * 0.2126 + h8 * 0.7152 + c * 0.0722;
      }
      e.relativeLuminance2 = t;
    })(ve ||= {});
    ((n) => {
      function s15(o, l) {
        if (J = (l & 255) / 255, J === 1) return l;
        let a = l >> 24 & 255, u = l >> 16 & 255, h8 = l >> 8 & 255, c = o >> 24 & 255, d = o >> 16 & 255, _ = o >> 8 & 255;
        return ue = c + Math.round((a - c) * J), he = d + Math.round((u - d) * J), de = _ + Math.round((h8 - _) * J), j.toRgba(ue, he, de);
      }
      n.blend = s15;
      function t(o, l, a) {
        let u = ve.relativeLuminance(o >> 8), h8 = ve.relativeLuminance(l >> 8);
        if (Xe(u, h8) < a) {
          if (h8 < u) {
            let p = e(o, l, a), m = Xe(u, ve.relativeLuminance(p >> 8));
            if (m < a) {
              let f = i(o, l, a), A = Xe(u, ve.relativeLuminance(f >> 8));
              return m > A ? p : f;
            }
            return p;
          }
          let d = i(o, l, a), _ = Xe(u, ve.relativeLuminance(d >> 8));
          if (_ < a) {
            let p = e(o, l, a), m = Xe(u, ve.relativeLuminance(p >> 8));
            return _ > m ? d : p;
          }
          return d;
        }
      }
      n.ensureContrastRatio = t;
      function e(o, l, a) {
        let u = o >> 24 & 255, h8 = o >> 16 & 255, c = o >> 8 & 255, d = l >> 24 & 255, _ = l >> 16 & 255, p = l >> 8 & 255, m = Xe(ve.relativeLuminance2(d, _, p), ve.relativeLuminance2(u, h8, c));
        for (; m < a && (d > 0 || _ > 0 || p > 0); ) d -= Math.max(0, Math.ceil(d * 0.1)), _ -= Math.max(0, Math.ceil(_ * 0.1)), p -= Math.max(0, Math.ceil(p * 0.1)), m = Xe(ve.relativeLuminance2(d, _, p), ve.relativeLuminance2(u, h8, c));
        return (d << 24 | _ << 16 | p << 8 | 255) >>> 0;
      }
      n.reduceLuminance = e;
      function i(o, l, a) {
        let u = o >> 24 & 255, h8 = o >> 16 & 255, c = o >> 8 & 255, d = l >> 24 & 255, _ = l >> 16 & 255, p = l >> 8 & 255, m = Xe(ve.relativeLuminance2(d, _, p), ve.relativeLuminance2(u, h8, c));
        for (; m < a && (d < 255 || _ < 255 || p < 255); ) d = Math.min(255, d + Math.ceil((255 - d) * 0.1)), _ = Math.min(255, _ + Math.ceil((255 - _) * 0.1)), p = Math.min(255, p + Math.ceil((255 - p) * 0.1)), m = Xe(ve.relativeLuminance2(d, _, p), ve.relativeLuminance2(u, h8, c));
        return (d << 24 | _ << 16 | p << 8 | 255) >>> 0;
      }
      n.increaseLuminance = i;
      function r(o) {
        return [o >> 24 & 255, o >> 16 & 255, o >> 8 & 255, o & 255];
      }
      n.toChannels = r;
    })($r ||= {});
    Vr = class extends De {
      constructor(e, i, r) {
        super();
        this.content = 0;
        this.combinedData = "";
        this.fg = e.fg, this.bg = e.bg, this.combinedData = i, this._width = r;
      }
      isCombined() {
        return 2097152;
      }
      getWidth() {
        return this._width;
      }
      getChars() {
        return this.combinedData;
      }
      getCode() {
        return 2097151;
      }
      setFromCharData(e) {
        throw new Error("not implemented");
      }
      getAsCharData() {
        return [this.fg, this.getChars(), this.getWidth(), this.getCode()];
      }
    }, ct = class {
      constructor(t) {
        this._bufferService = t;
        this._characterJoiners = [];
        this._nextCharacterJoinerId = 0;
        this._workCell = new q();
      }
      register(t) {
        let e = { id: this._nextCharacterJoinerId++, handler: t };
        return this._characterJoiners.push(e), e.id;
      }
      deregister(t) {
        for (let e = 0; e < this._characterJoiners.length; e++) if (this._characterJoiners[e].id === t) return this._characterJoiners.splice(e, 1), true;
        return false;
      }
      getJoinedCharacters(t) {
        if (this._characterJoiners.length === 0) return [];
        let e = this._bufferService.buffer.lines.get(t);
        if (!e || e.length === 0) return [];
        let i = [], r = e.translateToString(true), n = 0, o = 0, l = 0, a = e.getFg(0), u = e.getBg(0);
        for (let h8 = 0; h8 < e.getTrimmedLength(); h8++) if (e.loadCell(h8, this._workCell), this._workCell.getWidth() !== 0) {
          if (this._workCell.fg !== a || this._workCell.bg !== u) {
            if (h8 - n > 1) {
              let c = this._getJoinedRanges(r, l, o, e, n);
              for (let d = 0; d < c.length; d++) i.push(c[d]);
            }
            n = h8, l = o, a = this._workCell.fg, u = this._workCell.bg;
          }
          o += this._workCell.getChars().length || we.length;
        }
        if (this._bufferService.cols - n > 1) {
          let h8 = this._getJoinedRanges(r, l, o, e, n);
          for (let c = 0; c < h8.length; c++) i.push(h8[c]);
        }
        return i;
      }
      _getJoinedRanges(t, e, i, r, n) {
        let o = t.substring(e, i), l = [];
        try {
          l = this._characterJoiners[0].handler(o);
        } catch (a) {
          console.error(a);
        }
        for (let a = 1; a < this._characterJoiners.length; a++) try {
          let u = this._characterJoiners[a].handler(o);
          for (let h8 = 0; h8 < u.length; h8++) ct._mergeRanges(l, u[h8]);
        } catch (u) {
          console.error(u);
        }
        return this._stringRangesToCellRanges(l, r, n), l;
      }
      _stringRangesToCellRanges(t, e, i) {
        let r = 0, n = false, o = 0, l = t[r];
        if (l) {
          for (let a = i; a < this._bufferService.cols; a++) {
            let u = e.getWidth(a), h8 = e.getString(a).length || we.length;
            if (u !== 0) {
              if (!n && l[0] <= o && (l[0] = a, n = true), l[1] <= o) {
                if (l[1] = a, l = t[++r], !l) break;
                l[0] <= o ? (l[0] = a, n = true) : n = false;
              }
              o += h8;
            }
          }
          l && (l[1] = this._bufferService.cols);
        }
      }
      static _mergeRanges(t, e) {
        let i = false;
        for (let r = 0; r < t.length; r++) {
          let n = t[r];
          if (i) {
            if (e[1] <= n[0]) return t[r - 1][1] = e[1], t;
            if (e[1] <= n[1]) return t[r - 1][1] = Math.max(e[1], n[1]), t.splice(r, 1), t;
            t.splice(r, 1), r--;
          } else {
            if (e[1] <= n[0]) return t.splice(r, 0, e), t;
            if (e[1] <= n[1]) return n[0] = Math.min(e[0], n[0]), t;
            e[0] < n[1] && (n[0] = Math.min(e[0], n[0]), i = true);
            continue;
          }
        }
        return i ? t[t.length - 1][1] = e[1] : t.push(e), t;
      }
    };
    ct = M([S(0, F)], ct);
    Vt = class {
      constructor(t, e, i, r, n, o, l) {
        this._document = t;
        this._characterJoinerService = e;
        this._optionsService = i;
        this._coreBrowserService = r;
        this._coreService = n;
        this._decorationService = o;
        this._themeService = l;
        this._workCell = new q();
        this._columnSelectMode = false;
        this.defaultSpacing = 0;
      }
      handleSelectionChanged(t, e, i) {
        this._selectionStart = t, this._selectionEnd = e, this._columnSelectMode = i;
      }
      createRow(t, e, i, r, n, o, l, a, u, h8, c) {
        let d = [], _ = this._characterJoinerService.getJoinedCharacters(e), p = this._themeService.colors, m = t.getNoBgTrimmedLength();
        i && m < o + 1 && (m = o + 1);
        let f, A = 0, R = "", O = 0, I = 0, k = 0, P = 0, oe = false, Me = 0, Pe = false, Ke = 0, di = 0, V = [], Qe = h8 !== -1 && c !== -1;
        for (let y = 0; y < m; y++) {
          t.loadCell(y, this._workCell);
          let T = this._workCell.getWidth();
          if (T === 0) continue;
          let g = false, w = y >= di, E = y, x = this._workCell;
          if (_.length > 0 && y === _[0][0] && w) {
            let W = _.shift(), An = this._isCellInSelection(W[0], e);
            for (O = W[0] + 1; O < W[1]; O++) w &&= An === this._isCellInSelection(O, e);
            w &&= !i || o < W[0] || o >= W[1], w ? (g = true, x = new Vr(this._workCell, t.translateToString(true, W[0], W[1]), W[1] - W[0]), E = W[1] - 1, T = x.getWidth()) : di = W[1];
          }
          let N = this._isCellInSelection(y, e), Z = i && y === o, te = Qe && y >= h8 && y <= c, Oe = false;
          this._decorationService.forEachDecorationAtCell(y, e, void 0, (W) => {
            Oe = true;
          });
          let ze = x.getChars() || we;
          if (ze === " " && (x.isUnderline() || x.isOverline()) && (ze = " "), Ke = T * a - u.get(ze, x.isBold(), x.isItalic()), !f) f = this._document.createElement("span");
          else if (A && (N && Pe || !N && !Pe && x.bg === I) && (N && Pe && p.selectionForeground || x.fg === k) && x.extended.ext === P && te === oe && Ke === Me && !Z && !g && !Oe && w) {
            x.isInvisible() ? R += we : R += ze, A++;
            continue;
          } else A && (f.textContent = R), f = this._document.createElement("span"), A = 0, R = "";
          if (I = x.bg, k = x.fg, P = x.extended.ext, oe = te, Me = Ke, Pe = N, g && o >= y && o <= E && (o = y), !this._coreService.isCursorHidden && Z && this._coreService.isCursorInitialized) {
            if (V.push("xterm-cursor"), this._coreBrowserService.isFocused) l && V.push("xterm-cursor-blink"), V.push(r === "bar" ? "xterm-cursor-bar" : r === "underline" ? "xterm-cursor-underline" : "xterm-cursor-block");
            else if (n) switch (n) {
              case "outline":
                V.push("xterm-cursor-outline");
                break;
              case "block":
                V.push("xterm-cursor-block");
                break;
              case "bar":
                V.push("xterm-cursor-bar");
                break;
              case "underline":
                V.push("xterm-cursor-underline");
                break;
              default:
                break;
            }
          }
          if (x.isBold() && V.push("xterm-bold"), x.isItalic() && V.push("xterm-italic"), x.isDim() && V.push("xterm-dim"), x.isInvisible() ? R = we : R = x.getChars() || we, x.isUnderline() && (V.push(`xterm-underline-${x.extended.underlineStyle}`), R === " " && (R = " "), !x.isUnderlineColorDefault())) if (x.isUnderlineColorRGB()) f.style.textDecorationColor = `rgb(${De.toColorRGB(x.getUnderlineColor()).join(",")})`;
          else {
            let W = x.getUnderlineColor();
            this._optionsService.rawOptions.drawBoldTextInBrightColors && x.isBold() && W < 8 && (W += 8), f.style.textDecorationColor = p.ansi[W].css;
          }
          x.isOverline() && (V.push("xterm-overline"), R === " " && (R = " ")), x.isStrikethrough() && V.push("xterm-strikethrough"), te && (f.style.textDecoration = "underline");
          let le = x.getFgColor(), et = x.getFgColorMode(), me = x.getBgColor(), ht = x.getBgColorMode(), fi = !!x.isInverse();
          if (fi) {
            let W = le;
            le = me, me = W;
            let An = et;
            et = ht, ht = An;
          }
          let tt, Qi, pi = false;
          this._decorationService.forEachDecorationAtCell(y, e, void 0, (W) => {
            W.options.layer !== "top" && pi || (W.backgroundColorRGB && (ht = 50331648, me = W.backgroundColorRGB.rgba >> 8 & 16777215, tt = W.backgroundColorRGB), W.foregroundColorRGB && (et = 50331648, le = W.foregroundColorRGB.rgba >> 8 & 16777215, Qi = W.foregroundColorRGB), pi = W.options.layer === "top");
          }), !pi && N && (tt = this._coreBrowserService.isFocused ? p.selectionBackgroundOpaque : p.selectionInactiveBackgroundOpaque, me = tt.rgba >> 8 & 16777215, ht = 50331648, pi = true, p.selectionForeground && (et = 50331648, le = p.selectionForeground.rgba >> 8 & 16777215, Qi = p.selectionForeground)), pi && V.push("xterm-decoration-top");
          let it;
          switch (ht) {
            case 16777216:
            case 33554432:
              it = p.ansi[me], V.push(`xterm-bg-${me}`);
              break;
            case 50331648:
              it = j.toColor(me >> 16, me >> 8 & 255, me & 255), this._addStyle(f, `background-color:#${qo((me >>> 0).toString(16), "0", 6)}`);
              break;
            case 0:
            default:
              fi ? (it = p.foreground, V.push(`xterm-bg-${257}`)) : it = p.background;
          }
          switch (tt || x.isDim() && (tt = U.multiplyOpacity(it, 0.5)), et) {
            case 16777216:
            case 33554432:
              x.isBold() && le < 8 && this._optionsService.rawOptions.drawBoldTextInBrightColors && (le += 8), this._applyMinimumContrast(f, it, p.ansi[le], x, tt, void 0) || V.push(`xterm-fg-${le}`);
              break;
            case 50331648:
              let W = j.toColor(le >> 16 & 255, le >> 8 & 255, le & 255);
              this._applyMinimumContrast(f, it, W, x, tt, Qi) || this._addStyle(f, `color:#${qo(le.toString(16), "0", 6)}`);
              break;
            case 0:
            default:
              this._applyMinimumContrast(f, it, p.foreground, x, tt, Qi) || fi && V.push(`xterm-fg-${257}`);
          }
          V.length && (f.className = V.join(" "), V.length = 0), !Z && !g && !Oe && w ? A++ : f.textContent = R, Ke !== this.defaultSpacing && (f.style.letterSpacing = `${Ke}px`), d.push(f), y = E;
        }
        return f && A && (f.textContent = R), d;
      }
      _applyMinimumContrast(t, e, i, r, n, o) {
        if (this._optionsService.rawOptions.minimumContrastRatio === 1 || $o(r.getCode())) return false;
        let l = this._getContrastCache(r), a;
        if (!n && !o && (a = l.getColor(e.rgba, i.rgba)), a === void 0) {
          let u = this._optionsService.rawOptions.minimumContrastRatio / (r.isDim() ? 2 : 1);
          a = U.ensureContrastRatio(n || e, o || i, u), l.setColor((n || e).rgba, (o || i).rgba, a ?? null);
        }
        return a ? (this._addStyle(t, `color:${a.css}`), true) : false;
      }
      _getContrastCache(t) {
        return t.isDim() ? this._themeService.colors.halfContrastCache : this._themeService.colors.contrastCache;
      }
      _addStyle(t, e) {
        t.setAttribute("style", `${t.getAttribute("style") || ""}${e};`);
      }
      _isCellInSelection(t, e) {
        let i = this._selectionStart, r = this._selectionEnd;
        return !i || !r ? false : this._columnSelectMode ? i[0] <= r[0] ? t >= i[0] && e >= i[1] && t < r[0] && e <= r[1] : t < i[0] && e >= i[1] && t >= r[0] && e <= r[1] : e > i[1] && e < r[1] || i[1] === r[1] && e === i[1] && t >= i[0] && t < r[0] || i[1] < r[1] && e === r[1] && t < r[0] || i[1] < r[1] && e === i[1] && t >= i[0];
      }
    };
    Vt = M([S(1, or), S(2, H), S(3, ae), S(4, ge), S(5, Be), S(6, Re)], Vt);
    Yr = class {
      constructor(t, e) {
        this._flat = new Float32Array(256);
        this._font = "";
        this._fontSize = 0;
        this._weight = "normal";
        this._weightBold = "bold";
        this._measureElements = [];
        this._container = t.createElement("div"), this._container.classList.add("xterm-width-cache-measure-container"), this._container.setAttribute("aria-hidden", "true"), this._container.style.whiteSpace = "pre", this._container.style.fontKerning = "none";
        let i = t.createElement("span");
        i.classList.add("xterm-char-measure-element");
        let r = t.createElement("span");
        r.classList.add("xterm-char-measure-element"), r.style.fontWeight = "bold";
        let n = t.createElement("span");
        n.classList.add("xterm-char-measure-element"), n.style.fontStyle = "italic";
        let o = t.createElement("span");
        o.classList.add("xterm-char-measure-element"), o.style.fontWeight = "bold", o.style.fontStyle = "italic", this._measureElements = [i, r, n, o], this._container.appendChild(i), this._container.appendChild(r), this._container.appendChild(n), this._container.appendChild(o), e.appendChild(this._container), this.clear();
      }
      dispose() {
        this._container.remove(), this._measureElements.length = 0, this._holey = void 0;
      }
      clear() {
        this._flat.fill(-9999), this._holey = /* @__PURE__ */ new Map();
      }
      setFont(t, e, i, r) {
        t === this._font && e === this._fontSize && i === this._weight && r === this._weightBold || (this._font = t, this._fontSize = e, this._weight = i, this._weightBold = r, this._container.style.fontFamily = this._font, this._container.style.fontSize = `${this._fontSize}px`, this._measureElements[0].style.fontWeight = `${i}`, this._measureElements[1].style.fontWeight = `${r}`, this._measureElements[2].style.fontWeight = `${i}`, this._measureElements[3].style.fontWeight = `${r}`, this.clear());
      }
      get(t, e, i) {
        let r = 0;
        if (!e && !i && t.length === 1 && (r = t.charCodeAt(0)) < 256) {
          if (this._flat[r] !== -9999) return this._flat[r];
          let l = this._measure(t, 0);
          return l > 0 && (this._flat[r] = l), l;
        }
        let n = t;
        e && (n += "B"), i && (n += "I");
        let o = this._holey.get(n);
        if (o === void 0) {
          let l = 0;
          e && (l |= 1), i && (l |= 2), o = this._measure(t, l), o > 0 && this._holey.set(n, o);
        }
        return o;
      }
      _measure(t, e) {
        let i = this._measureElements[e];
        return i.textContent = t.repeat(32), i.offsetWidth / 32;
      }
    };
    ms = class {
      constructor() {
        this.clear();
      }
      clear() {
        this.hasSelection = false, this.columnSelectMode = false, this.viewportStartRow = 0, this.viewportEndRow = 0, this.viewportCappedStartRow = 0, this.viewportCappedEndRow = 0, this.startCol = 0, this.endCol = 0, this.selectionStart = void 0, this.selectionEnd = void 0;
      }
      update(t, e, i, r = false) {
        if (this.selectionStart = e, this.selectionEnd = i, !e || !i || e[0] === i[0] && e[1] === i[1]) {
          this.clear();
          return;
        }
        let n = t.buffers.active.ydisp, o = e[1] - n, l = i[1] - n, a = Math.max(o, 0), u = Math.min(l, t.rows - 1);
        if (a >= t.rows || u < 0) {
          this.clear();
          return;
        }
        this.hasSelection = true, this.columnSelectMode = r, this.viewportStartRow = o, this.viewportEndRow = l, this.viewportCappedStartRow = a, this.viewportCappedEndRow = u, this.startCol = e[0], this.endCol = i[0];
      }
      isCellSelected(t, e, i) {
        return this.hasSelection ? (i -= t.buffer.active.viewportY, this.columnSelectMode ? this.startCol <= this.endCol ? e >= this.startCol && i >= this.viewportCappedStartRow && e < this.endCol && i <= this.viewportCappedEndRow : e < this.startCol && i >= this.viewportCappedStartRow && e >= this.endCol && i <= this.viewportCappedEndRow : i > this.viewportStartRow && i < this.viewportEndRow || this.viewportStartRow === this.viewportEndRow && i === this.viewportStartRow && e >= this.startCol && e < this.endCol || this.viewportStartRow < this.viewportEndRow && i === this.viewportEndRow && e < this.endCol || this.viewportStartRow < this.viewportEndRow && i === this.viewportStartRow && e >= this.startCol) : false;
      }
    };
    _s = "xterm-dom-renderer-owner-", Le = "xterm-rows", jr = "xterm-fg-", jo = "xterm-bg-", ki = "xterm-focus", Xr = "xterm-selection", Na = 1, Yt = class extends D {
      constructor(e, i, r, n, o, l, a, u, h8, c, d, _, p, m) {
        super();
        this._terminal = e;
        this._document = i;
        this._element = r;
        this._screenElement = n;
        this._viewportElement = o;
        this._helperContainer = l;
        this._linkifier2 = a;
        this._charSizeService = h8;
        this._optionsService = c;
        this._bufferService = d;
        this._coreService = _;
        this._coreBrowserService = p;
        this._themeService = m;
        this._terminalClass = Na++;
        this._rowElements = [];
        this._selectionRenderModel = Yo();
        this.onRequestRedraw = this._register(new v()).event;
        this._rowContainer = this._document.createElement("div"), this._rowContainer.classList.add(Le), this._rowContainer.style.lineHeight = "normal", this._rowContainer.setAttribute("aria-hidden", "true"), this._refreshRowElements(this._bufferService.cols, this._bufferService.rows), this._selectionContainer = this._document.createElement("div"), this._selectionContainer.classList.add(Xr), this._selectionContainer.setAttribute("aria-hidden", "true"), this.dimensions = Vo(), this._updateDimensions(), this._register(this._optionsService.onOptionChange(() => this._handleOptionsChanged())), this._register(this._themeService.onChangeColors((f) => this._injectCss(f))), this._injectCss(this._themeService.colors), this._rowFactory = u.createInstance(Vt, document), this._element.classList.add(_s + this._terminalClass), this._screenElement.appendChild(this._rowContainer), this._screenElement.appendChild(this._selectionContainer), this._register(this._linkifier2.onShowLinkUnderline((f) => this._handleLinkHover(f))), this._register(this._linkifier2.onHideLinkUnderline((f) => this._handleLinkLeave(f))), this._register(C(() => {
          this._element.classList.remove(_s + this._terminalClass), this._rowContainer.remove(), this._selectionContainer.remove(), this._widthCache.dispose(), this._themeStyleElement.remove(), this._dimensionsStyleElement.remove();
        })), this._widthCache = new Yr(this._document, this._helperContainer), this._widthCache.setFont(this._optionsService.rawOptions.fontFamily, this._optionsService.rawOptions.fontSize, this._optionsService.rawOptions.fontWeight, this._optionsService.rawOptions.fontWeightBold), this._setDefaultSpacing();
      }
      _updateDimensions() {
        let e = this._coreBrowserService.dpr;
        this.dimensions.device.char.width = this._charSizeService.width * e, this.dimensions.device.char.height = Math.ceil(this._charSizeService.height * e), this.dimensions.device.cell.width = this.dimensions.device.char.width + Math.round(this._optionsService.rawOptions.letterSpacing), this.dimensions.device.cell.height = Math.floor(this.dimensions.device.char.height * this._optionsService.rawOptions.lineHeight), this.dimensions.device.char.left = 0, this.dimensions.device.char.top = 0, this.dimensions.device.canvas.width = this.dimensions.device.cell.width * this._bufferService.cols, this.dimensions.device.canvas.height = this.dimensions.device.cell.height * this._bufferService.rows, this.dimensions.css.canvas.width = Math.round(this.dimensions.device.canvas.width / e), this.dimensions.css.canvas.height = Math.round(this.dimensions.device.canvas.height / e), this.dimensions.css.cell.width = this.dimensions.css.canvas.width / this._bufferService.cols, this.dimensions.css.cell.height = this.dimensions.css.canvas.height / this._bufferService.rows;
        for (let r of this._rowElements) r.style.width = `${this.dimensions.css.canvas.width}px`, r.style.height = `${this.dimensions.css.cell.height}px`, r.style.lineHeight = `${this.dimensions.css.cell.height}px`, r.style.overflow = "hidden";
        this._dimensionsStyleElement || (this._dimensionsStyleElement = this._document.createElement("style"), this._screenElement.appendChild(this._dimensionsStyleElement));
        let i = `${this._terminalSelector} .${Le} span { display: inline-block; height: 100%; vertical-align: top;}`;
        this._dimensionsStyleElement.textContent = i, this._selectionContainer.style.height = this._viewportElement.style.height, this._screenElement.style.width = `${this.dimensions.css.canvas.width}px`, this._screenElement.style.height = `${this.dimensions.css.canvas.height}px`;
      }
      _injectCss(e) {
        this._themeStyleElement || (this._themeStyleElement = this._document.createElement("style"), this._screenElement.appendChild(this._themeStyleElement));
        let i = `${this._terminalSelector} .${Le} { pointer-events: none; color: ${e.foreground.css}; font-family: ${this._optionsService.rawOptions.fontFamily}; font-size: ${this._optionsService.rawOptions.fontSize}px; font-kerning: none; white-space: pre}`;
        i += `${this._terminalSelector} .${Le} .xterm-dim { color: ${U.multiplyOpacity(e.foreground, 0.5).css};}`, i += `${this._terminalSelector} span:not(.xterm-bold) { font-weight: ${this._optionsService.rawOptions.fontWeight};}${this._terminalSelector} span.xterm-bold { font-weight: ${this._optionsService.rawOptions.fontWeightBold};}${this._terminalSelector} span.xterm-italic { font-style: italic;}`;
        let r = `blink_underline_${this._terminalClass}`, n = `blink_bar_${this._terminalClass}`, o = `blink_block_${this._terminalClass}`;
        i += `@keyframes ${r} { 50% {  border-bottom-style: hidden; }}`, i += `@keyframes ${n} { 50% {  box-shadow: none; }}`, i += `@keyframes ${o} { 0% {  background-color: ${e.cursor.css};  color: ${e.cursorAccent.css}; } 50% {  background-color: inherit;  color: ${e.cursor.css}; }}`, i += `${this._terminalSelector} .${Le}.${ki} .xterm-cursor.xterm-cursor-blink.xterm-cursor-underline { animation: ${r} 1s step-end infinite;}${this._terminalSelector} .${Le}.${ki} .xterm-cursor.xterm-cursor-blink.xterm-cursor-bar { animation: ${n} 1s step-end infinite;}${this._terminalSelector} .${Le}.${ki} .xterm-cursor.xterm-cursor-blink.xterm-cursor-block { animation: ${o} 1s step-end infinite;}${this._terminalSelector} .${Le} .xterm-cursor.xterm-cursor-block { background-color: ${e.cursor.css}; color: ${e.cursorAccent.css};}${this._terminalSelector} .${Le} .xterm-cursor.xterm-cursor-block:not(.xterm-cursor-blink) { background-color: ${e.cursor.css} !important; color: ${e.cursorAccent.css} !important;}${this._terminalSelector} .${Le} .xterm-cursor.xterm-cursor-outline { outline: 1px solid ${e.cursor.css}; outline-offset: -1px;}${this._terminalSelector} .${Le} .xterm-cursor.xterm-cursor-bar { box-shadow: ${this._optionsService.rawOptions.cursorWidth}px 0 0 ${e.cursor.css} inset;}${this._terminalSelector} .${Le} .xterm-cursor.xterm-cursor-underline { border-bottom: 1px ${e.cursor.css}; border-bottom-style: solid; height: calc(100% - 1px);}`, i += `${this._terminalSelector} .${Xr} { position: absolute; top: 0; left: 0; z-index: 1; pointer-events: none;}${this._terminalSelector}.focus .${Xr} div { position: absolute; background-color: ${e.selectionBackgroundOpaque.css};}${this._terminalSelector} .${Xr} div { position: absolute; background-color: ${e.selectionInactiveBackgroundOpaque.css};}`;
        for (let [l, a] of e.ansi.entries()) i += `${this._terminalSelector} .${jr}${l} { color: ${a.css}; }${this._terminalSelector} .${jr}${l}.xterm-dim { color: ${U.multiplyOpacity(a, 0.5).css}; }${this._terminalSelector} .${jo}${l} { background-color: ${a.css}; }`;
        i += `${this._terminalSelector} .${jr}${257} { color: ${U.opaque(e.background).css}; }${this._terminalSelector} .${jr}${257}.xterm-dim { color: ${U.multiplyOpacity(U.opaque(e.background), 0.5).css}; }${this._terminalSelector} .${jo}${257} { background-color: ${e.foreground.css}; }`, this._themeStyleElement.textContent = i;
      }
      _setDefaultSpacing() {
        let e = this.dimensions.css.cell.width - this._widthCache.get("W", false, false);
        this._rowContainer.style.letterSpacing = `${e}px`, this._rowFactory.defaultSpacing = e;
      }
      handleDevicePixelRatioChange() {
        this._updateDimensions(), this._widthCache.clear(), this._setDefaultSpacing();
      }
      _refreshRowElements(e, i) {
        for (let r = this._rowElements.length; r <= i; r++) {
          let n = this._document.createElement("div");
          this._rowContainer.appendChild(n), this._rowElements.push(n);
        }
        for (; this._rowElements.length > i; ) this._rowContainer.removeChild(this._rowElements.pop());
      }
      handleResize(e, i) {
        this._refreshRowElements(e, i), this._updateDimensions(), this.handleSelectionChanged(this._selectionRenderModel.selectionStart, this._selectionRenderModel.selectionEnd, this._selectionRenderModel.columnSelectMode);
      }
      handleCharSizeChanged() {
        this._updateDimensions(), this._widthCache.clear(), this._setDefaultSpacing();
      }
      handleBlur() {
        this._rowContainer.classList.remove(ki), this.renderRows(0, this._bufferService.rows - 1);
      }
      handleFocus() {
        this._rowContainer.classList.add(ki), this.renderRows(this._bufferService.buffer.y, this._bufferService.buffer.y);
      }
      handleSelectionChanged(e, i, r) {
        if (this._selectionContainer.replaceChildren(), this._rowFactory.handleSelectionChanged(e, i, r), this.renderRows(0, this._bufferService.rows - 1), !e || !i || (this._selectionRenderModel.update(this._terminal, e, i, r), !this._selectionRenderModel.hasSelection)) return;
        let n = this._selectionRenderModel.viewportStartRow, o = this._selectionRenderModel.viewportEndRow, l = this._selectionRenderModel.viewportCappedStartRow, a = this._selectionRenderModel.viewportCappedEndRow, u = this._document.createDocumentFragment();
        if (r) {
          let h8 = e[0] > i[0];
          u.appendChild(this._createSelectionElement(l, h8 ? i[0] : e[0], h8 ? e[0] : i[0], a - l + 1));
        } else {
          let h8 = n === l ? e[0] : 0, c = l === o ? i[0] : this._bufferService.cols;
          u.appendChild(this._createSelectionElement(l, h8, c));
          let d = a - l - 1;
          if (u.appendChild(this._createSelectionElement(l + 1, 0, this._bufferService.cols, d)), l !== a) {
            let _ = o === a ? i[0] : this._bufferService.cols;
            u.appendChild(this._createSelectionElement(a, 0, _));
          }
        }
        this._selectionContainer.appendChild(u);
      }
      _createSelectionElement(e, i, r, n = 1) {
        let o = this._document.createElement("div"), l = i * this.dimensions.css.cell.width, a = this.dimensions.css.cell.width * (r - i);
        return l + a > this.dimensions.css.canvas.width && (a = this.dimensions.css.canvas.width - l), o.style.height = `${n * this.dimensions.css.cell.height}px`, o.style.top = `${e * this.dimensions.css.cell.height}px`, o.style.left = `${l}px`, o.style.width = `${a}px`, o;
      }
      handleCursorMove() {
      }
      _handleOptionsChanged() {
        this._updateDimensions(), this._injectCss(this._themeService.colors), this._widthCache.setFont(this._optionsService.rawOptions.fontFamily, this._optionsService.rawOptions.fontSize, this._optionsService.rawOptions.fontWeight, this._optionsService.rawOptions.fontWeightBold), this._setDefaultSpacing();
      }
      clear() {
        for (let e of this._rowElements) e.replaceChildren();
      }
      renderRows(e, i) {
        let r = this._bufferService.buffer, n = r.ybase + r.y, o = Math.min(r.x, this._bufferService.cols - 1), l = this._coreService.decPrivateModes.cursorBlink ?? this._optionsService.rawOptions.cursorBlink, a = this._coreService.decPrivateModes.cursorStyle ?? this._optionsService.rawOptions.cursorStyle, u = this._optionsService.rawOptions.cursorInactiveStyle;
        for (let h8 = e; h8 <= i; h8++) {
          let c = h8 + r.ydisp, d = this._rowElements[h8], _ = r.lines.get(c);
          if (!d || !_) break;
          d.replaceChildren(...this._rowFactory.createRow(_, c, c === n, a, u, o, l, this.dimensions.css.cell.width, this._widthCache, -1, -1));
        }
      }
      get _terminalSelector() {
        return `.${_s}${this._terminalClass}`;
      }
      _handleLinkHover(e) {
        this._setCellUnderline(e.x1, e.x2, e.y1, e.y2, e.cols, true);
      }
      _handleLinkLeave(e) {
        this._setCellUnderline(e.x1, e.x2, e.y1, e.y2, e.cols, false);
      }
      _setCellUnderline(e, i, r, n, o, l) {
        r < 0 && (e = 0), n < 0 && (i = 0);
        let a = this._bufferService.rows - 1;
        r = Math.max(Math.min(r, a), 0), n = Math.max(Math.min(n, a), 0), o = Math.min(o, this._bufferService.cols);
        let u = this._bufferService.buffer, h8 = u.ybase + u.y, c = Math.min(u.x, o - 1), d = this._optionsService.rawOptions.cursorBlink, _ = this._optionsService.rawOptions.cursorStyle, p = this._optionsService.rawOptions.cursorInactiveStyle;
        for (let m = r; m <= n; ++m) {
          let f = m + u.ydisp, A = this._rowElements[m], R = u.lines.get(f);
          if (!A || !R) break;
          A.replaceChildren(...this._rowFactory.createRow(R, f, f === h8, _, p, c, d, this.dimensions.css.cell.width, this._widthCache, l ? m === r ? e : 0 : -1, l ? (m === n ? i : o) - 1 : -1));
        }
      }
    };
    Yt = M([S(7, xt), S(8, nt), S(9, H), S(10, F), S(11, ge), S(12, ae), S(13, Re)], Yt);
    jt = class extends D {
      constructor(e, i, r) {
        super();
        this._optionsService = r;
        this.width = 0;
        this.height = 0;
        this._onCharSizeChange = this._register(new v());
        this.onCharSizeChange = this._onCharSizeChange.event;
        try {
          this._measureStrategy = this._register(new vs(this._optionsService));
        } catch {
          this._measureStrategy = this._register(new bs(e, i, this._optionsService));
        }
        this._register(this._optionsService.onMultipleOptionChange(["fontFamily", "fontSize"], () => this.measure()));
      }
      get hasValidSize() {
        return this.width > 0 && this.height > 0;
      }
      measure() {
        let e = this._measureStrategy.measure();
        (e.width !== this.width || e.height !== this.height) && (this.width = e.width, this.height = e.height, this._onCharSizeChange.fire());
      }
    };
    jt = M([S(2, H)], jt);
    Zr = class extends D {
      constructor() {
        super(...arguments);
        this._result = { width: 0, height: 0 };
      }
      _validateAndSet(e, i) {
        e !== void 0 && e > 0 && i !== void 0 && i > 0 && (this._result.width = e, this._result.height = i);
      }
    }, bs = class extends Zr {
      constructor(e, i, r) {
        super();
        this._document = e;
        this._parentElement = i;
        this._optionsService = r;
        this._measureElement = this._document.createElement("span"), this._measureElement.classList.add("xterm-char-measure-element"), this._measureElement.textContent = "W".repeat(32), this._measureElement.setAttribute("aria-hidden", "true"), this._measureElement.style.whiteSpace = "pre", this._measureElement.style.fontKerning = "none", this._parentElement.appendChild(this._measureElement);
      }
      measure() {
        return this._measureElement.style.fontFamily = this._optionsService.rawOptions.fontFamily, this._measureElement.style.fontSize = `${this._optionsService.rawOptions.fontSize}px`, this._validateAndSet(Number(this._measureElement.offsetWidth) / 32, Number(this._measureElement.offsetHeight)), this._result;
      }
    }, vs = class extends Zr {
      constructor(e) {
        super();
        this._optionsService = e;
        this._canvas = new OffscreenCanvas(100, 100), this._ctx = this._canvas.getContext("2d");
        let i = this._ctx.measureText("W");
        if (!("width" in i && "fontBoundingBoxAscent" in i && "fontBoundingBoxDescent" in i)) throw new Error("Required font metrics not supported");
      }
      measure() {
        this._ctx.font = `${this._optionsService.rawOptions.fontSize}px ${this._optionsService.rawOptions.fontFamily}`;
        let e = this._ctx.measureText("W");
        return this._validateAndSet(e.width, e.fontBoundingBoxAscent + e.fontBoundingBoxDescent), this._result;
      }
    };
    Jr = class extends D {
      constructor(e, i, r) {
        super();
        this._textarea = e;
        this._window = i;
        this.mainDocument = r;
        this._isFocused = false;
        this._cachedIsFocused = void 0;
        this._screenDprMonitor = this._register(new gs(this._window));
        this._onDprChange = this._register(new v());
        this.onDprChange = this._onDprChange.event;
        this._onWindowChange = this._register(new v());
        this.onWindowChange = this._onWindowChange.event;
        this._register(this.onWindowChange((n) => this._screenDprMonitor.setWindow(n))), this._register($.forward(this._screenDprMonitor.onDprChange, this._onDprChange)), this._register(L(this._textarea, "focus", () => this._isFocused = true)), this._register(L(this._textarea, "blur", () => this._isFocused = false));
      }
      get window() {
        return this._window;
      }
      set window(e) {
        this._window !== e && (this._window = e, this._onWindowChange.fire(this._window));
      }
      get dpr() {
        return this.window.devicePixelRatio;
      }
      get isFocused() {
        return this._cachedIsFocused === void 0 && (this._cachedIsFocused = this._isFocused && this._textarea.ownerDocument.hasFocus(), queueMicrotask(() => this._cachedIsFocused = void 0)), this._cachedIsFocused;
      }
    }, gs = class extends D {
      constructor(e) {
        super();
        this._parentWindow = e;
        this._windowResizeListener = this._register(new ye());
        this._onDprChange = this._register(new v());
        this.onDprChange = this._onDprChange.event;
        this._outerListener = () => this._setDprAndFireIfDiffers(), this._currentDevicePixelRatio = this._parentWindow.devicePixelRatio, this._updateDpr(), this._setWindowResizeListener(), this._register(C(() => this.clearListener()));
      }
      setWindow(e) {
        this._parentWindow = e, this._setWindowResizeListener(), this._setDprAndFireIfDiffers();
      }
      _setWindowResizeListener() {
        this._windowResizeListener.value = L(this._parentWindow, "resize", () => this._setDprAndFireIfDiffers());
      }
      _setDprAndFireIfDiffers() {
        this._parentWindow.devicePixelRatio !== this._currentDevicePixelRatio && this._onDprChange.fire(this._parentWindow.devicePixelRatio), this._updateDpr();
      }
      _updateDpr() {
        this._outerListener && (this._resolutionMediaMatchList?.removeListener(this._outerListener), this._currentDevicePixelRatio = this._parentWindow.devicePixelRatio, this._resolutionMediaMatchList = this._parentWindow.matchMedia(`screen and (resolution: ${this._parentWindow.devicePixelRatio}dppx)`), this._resolutionMediaMatchList.addListener(this._outerListener));
      }
      clearListener() {
        !this._resolutionMediaMatchList || !this._outerListener || (this._resolutionMediaMatchList.removeListener(this._outerListener), this._resolutionMediaMatchList = void 0, this._outerListener = void 0);
      }
    };
    Qr = class extends D {
      constructor() {
        super();
        this.linkProviders = [];
        this._register(C(() => this.linkProviders.length = 0));
      }
      registerLinkProvider(e) {
        return this.linkProviders.push(e), { dispose: () => {
          let i = this.linkProviders.indexOf(e);
          i !== -1 && this.linkProviders.splice(i, 1);
        } };
      }
    };
    Xt = class {
      constructor(t, e) {
        this._renderService = t;
        this._charSizeService = e;
      }
      getCoords(t, e, i, r, n) {
        return Xo(window, t, e, i, r, this._charSizeService.hasValidSize, this._renderService.dimensions.css.cell.width, this._renderService.dimensions.css.cell.height, n);
      }
      getMouseReportCoords(t, e) {
        let i = Ci(window, t, e);
        if (this._charSizeService.hasValidSize) return i[0] = Math.min(Math.max(i[0], 0), this._renderService.dimensions.css.canvas.width - 1), i[1] = Math.min(Math.max(i[1], 0), this._renderService.dimensions.css.canvas.height - 1), { col: Math.floor(i[0] / this._renderService.dimensions.css.cell.width), row: Math.floor(i[1] / this._renderService.dimensions.css.cell.height), x: Math.floor(i[0]), y: Math.floor(i[1]) };
      }
    };
    Xt = M([S(0, ce), S(1, nt)], Xt);
    en = class {
      constructor(t, e) {
        this._renderCallback = t;
        this._coreBrowserService = e;
        this._refreshCallbacks = [];
      }
      dispose() {
        this._animationFrame && (this._coreBrowserService.window.cancelAnimationFrame(this._animationFrame), this._animationFrame = void 0);
      }
      addRefreshCallback(t) {
        return this._refreshCallbacks.push(t), this._animationFrame || (this._animationFrame = this._coreBrowserService.window.requestAnimationFrame(() => this._innerRefresh())), this._animationFrame;
      }
      refresh(t, e, i) {
        this._rowCount = i, t = t !== void 0 ? t : 0, e = e !== void 0 ? e : this._rowCount - 1, this._rowStart = this._rowStart !== void 0 ? Math.min(this._rowStart, t) : t, this._rowEnd = this._rowEnd !== void 0 ? Math.max(this._rowEnd, e) : e, !this._animationFrame && (this._animationFrame = this._coreBrowserService.window.requestAnimationFrame(() => this._innerRefresh()));
      }
      _innerRefresh() {
        if (this._animationFrame = void 0, this._rowStart === void 0 || this._rowEnd === void 0 || this._rowCount === void 0) {
          this._runRefreshCallbacks();
          return;
        }
        let t = Math.max(this._rowStart, 0), e = Math.min(this._rowEnd, this._rowCount - 1);
        this._rowStart = void 0, this._rowEnd = void 0, this._renderCallback(t, e), this._runRefreshCallbacks();
      }
      _runRefreshCallbacks() {
        for (let t of this._refreshCallbacks) t(0);
        this._refreshCallbacks = [];
      }
    };
    tn = {};
    Ll(tn, { getSafariVersion: () => Ha, isChromeOS: () => Ts, isFirefox: () => Ss, isIpad: () => Wa, isIphone: () => Ua, isLegacyEdge: () => Fa, isLinux: () => Bi, isMac: () => Zt, isNode: () => Mi, isSafari: () => Zo, isWindows: () => Es });
    Mi = typeof process < "u" && "title" in process, Pi = Mi ? "node" : navigator.userAgent, Oi = Mi ? "node" : navigator.platform, Ss = Pi.includes("Firefox"), Fa = Pi.includes("Edge"), Zo = /^((?!chrome|android).)*safari/i.test(Pi);
    Zt = ["Macintosh", "MacIntel", "MacPPC", "Mac68K"].includes(Oi), Wa = Oi === "iPad", Ua = Oi === "iPhone", Es = ["Windows", "Win16", "Win32", "WinCE"].includes(Oi), Bi = Oi.indexOf("Linux") >= 0, Ts = /\bCrOS\b/.test(Pi);
    rn = class {
      constructor() {
        this._tasks = [];
        this._i = 0;
      }
      enqueue(t) {
        this._tasks.push(t), this._start();
      }
      flush() {
        for (; this._i < this._tasks.length; ) this._tasks[this._i]() || this._i++;
        this.clear();
      }
      clear() {
        this._idleCallback && (this._cancelCallback(this._idleCallback), this._idleCallback = void 0), this._i = 0, this._tasks.length = 0;
      }
      _start() {
        this._idleCallback || (this._idleCallback = this._requestCallback(this._process.bind(this)));
      }
      _process(t) {
        this._idleCallback = void 0;
        let e = 0, i = 0, r = t.timeRemaining(), n = 0;
        for (; this._i < this._tasks.length; ) {
          if (e = performance.now(), this._tasks[this._i]() || this._i++, e = Math.max(1, performance.now() - e), i = Math.max(e, i), n = t.timeRemaining(), i * 1.5 > n) {
            r - e < -20 && console.warn(`task queue exceeded allotted deadline by ${Math.abs(Math.round(r - e))}ms`), this._start();
            return;
          }
          r = n;
        }
        this.clear();
      }
    }, Is = class extends rn {
      _requestCallback(t) {
        return setTimeout(() => t(this._createDeadline(16)));
      }
      _cancelCallback(t) {
        clearTimeout(t);
      }
      _createDeadline(t) {
        let e = performance.now() + t;
        return { timeRemaining: () => Math.max(0, e - performance.now()) };
      }
    }, ys = class extends rn {
      _requestCallback(t) {
        return requestIdleCallback(t);
      }
      _cancelCallback(t) {
        cancelIdleCallback(t);
      }
    }, Jt = !Mi && "requestIdleCallback" in window ? ys : Is, nn = class {
      constructor() {
        this._queue = new Jt();
      }
      set(t) {
        this._queue.clear(), this._queue.enqueue(t);
      }
      flush() {
        this._queue.flush();
      }
    };
    Qt = class extends D {
      constructor(e, i, r, n, o, l, a, u, h8) {
        super();
        this._rowCount = e;
        this._optionsService = r;
        this._charSizeService = n;
        this._coreService = o;
        this._coreBrowserService = u;
        this._renderer = this._register(new ye());
        this._pausedResizeTask = new nn();
        this._observerDisposable = this._register(new ye());
        this._isPaused = false;
        this._needsFullRefresh = false;
        this._isNextRenderRedrawOnly = true;
        this._needsSelectionRefresh = false;
        this._canvasWidth = 0;
        this._canvasHeight = 0;
        this._selectionState = { start: void 0, end: void 0, columnSelectMode: false };
        this._onDimensionsChange = this._register(new v());
        this.onDimensionsChange = this._onDimensionsChange.event;
        this._onRenderedViewportChange = this._register(new v());
        this.onRenderedViewportChange = this._onRenderedViewportChange.event;
        this._onRender = this._register(new v());
        this.onRender = this._onRender.event;
        this._onRefreshRequest = this._register(new v());
        this.onRefreshRequest = this._onRefreshRequest.event;
        this._renderDebouncer = new en((c, d) => this._renderRows(c, d), this._coreBrowserService), this._register(this._renderDebouncer), this._syncOutputHandler = new xs(this._coreBrowserService, this._coreService, () => this._fullRefresh()), this._register(C(() => this._syncOutputHandler.dispose())), this._register(this._coreBrowserService.onDprChange(() => this.handleDevicePixelRatioChange())), this._register(a.onResize(() => this._fullRefresh())), this._register(a.buffers.onBufferActivate(() => this._renderer.value?.clear())), this._register(this._optionsService.onOptionChange(() => this._handleOptionsChanged())), this._register(this._charSizeService.onCharSizeChange(() => this.handleCharSizeChanged())), this._register(l.onDecorationRegistered(() => this._fullRefresh())), this._register(l.onDecorationRemoved(() => this._fullRefresh())), this._register(this._optionsService.onMultipleOptionChange(["customGlyphs", "drawBoldTextInBrightColors", "letterSpacing", "lineHeight", "fontFamily", "fontSize", "fontWeight", "fontWeightBold", "minimumContrastRatio", "rescaleOverlappingGlyphs"], () => {
          this.clear(), this.handleResize(a.cols, a.rows), this._fullRefresh();
        })), this._register(this._optionsService.onMultipleOptionChange(["cursorBlink", "cursorStyle"], () => this.refreshRows(a.buffer.y, a.buffer.y, true))), this._register(h8.onChangeColors(() => this._fullRefresh())), this._registerIntersectionObserver(this._coreBrowserService.window, i), this._register(this._coreBrowserService.onWindowChange((c) => this._registerIntersectionObserver(c, i)));
      }
      get dimensions() {
        return this._renderer.value.dimensions;
      }
      _registerIntersectionObserver(e, i) {
        if ("IntersectionObserver" in e) {
          let r = new e.IntersectionObserver((n) => this._handleIntersectionChange(n[n.length - 1]), { threshold: 0 });
          r.observe(i), this._observerDisposable.value = C(() => r.disconnect());
        }
      }
      _handleIntersectionChange(e) {
        this._isPaused = e.isIntersecting === void 0 ? e.intersectionRatio === 0 : !e.isIntersecting, !this._isPaused && !this._charSizeService.hasValidSize && this._charSizeService.measure(), !this._isPaused && this._needsFullRefresh && (this._pausedResizeTask.flush(), this.refreshRows(0, this._rowCount - 1), this._needsFullRefresh = false);
      }
      refreshRows(e, i, r = false) {
        if (this._isPaused) {
          this._needsFullRefresh = true;
          return;
        }
        if (this._coreService.decPrivateModes.synchronizedOutput) {
          this._syncOutputHandler.bufferRows(e, i);
          return;
        }
        let n = this._syncOutputHandler.flush();
        n && (e = Math.min(e, n.start), i = Math.max(i, n.end)), r || (this._isNextRenderRedrawOnly = false), this._renderDebouncer.refresh(e, i, this._rowCount);
      }
      _renderRows(e, i) {
        if (this._renderer.value) {
          if (this._coreService.decPrivateModes.synchronizedOutput) {
            this._syncOutputHandler.bufferRows(e, i);
            return;
          }
          e = Math.min(e, this._rowCount - 1), i = Math.min(i, this._rowCount - 1), this._renderer.value.renderRows(e, i), this._needsSelectionRefresh && (this._renderer.value.handleSelectionChanged(this._selectionState.start, this._selectionState.end, this._selectionState.columnSelectMode), this._needsSelectionRefresh = false), this._isNextRenderRedrawOnly || this._onRenderedViewportChange.fire({ start: e, end: i }), this._onRender.fire({ start: e, end: i }), this._isNextRenderRedrawOnly = true;
        }
      }
      resize(e, i) {
        this._rowCount = i, this._fireOnCanvasResize();
      }
      _handleOptionsChanged() {
        this._renderer.value && (this.refreshRows(0, this._rowCount - 1), this._fireOnCanvasResize());
      }
      _fireOnCanvasResize() {
        this._renderer.value && (this._renderer.value.dimensions.css.canvas.width === this._canvasWidth && this._renderer.value.dimensions.css.canvas.height === this._canvasHeight || this._onDimensionsChange.fire(this._renderer.value.dimensions));
      }
      hasRenderer() {
        return !!this._renderer.value;
      }
      setRenderer(e) {
        this._renderer.value = e, this._renderer.value && (this._renderer.value.onRequestRedraw((i) => this.refreshRows(i.start, i.end, true)), this._needsSelectionRefresh = true, this._fullRefresh());
      }
      addRefreshCallback(e) {
        return this._renderDebouncer.addRefreshCallback(e);
      }
      _fullRefresh() {
        this._isPaused ? this._needsFullRefresh = true : this.refreshRows(0, this._rowCount - 1);
      }
      clearTextureAtlas() {
        this._renderer.value && (this._renderer.value.clearTextureAtlas?.(), this._fullRefresh());
      }
      handleDevicePixelRatioChange() {
        this._charSizeService.measure(), this._renderer.value && (this._renderer.value.handleDevicePixelRatioChange(), this.refreshRows(0, this._rowCount - 1));
      }
      handleResize(e, i) {
        this._renderer.value && (this._isPaused ? this._pausedResizeTask.set(() => this._renderer.value?.handleResize(e, i)) : this._renderer.value.handleResize(e, i), this._fullRefresh());
      }
      handleCharSizeChanged() {
        this._renderer.value?.handleCharSizeChanged();
      }
      handleBlur() {
        this._renderer.value?.handleBlur();
      }
      handleFocus() {
        this._renderer.value?.handleFocus();
      }
      handleSelectionChanged(e, i, r) {
        this._selectionState.start = e, this._selectionState.end = i, this._selectionState.columnSelectMode = r, this._renderer.value?.handleSelectionChanged(e, i, r);
      }
      handleCursorMove() {
        this._renderer.value?.handleCursorMove();
      }
      clear() {
        this._renderer.value?.clear();
      }
    };
    Qt = M([S(2, H), S(3, nt), S(4, ge), S(5, Be), S(6, F), S(7, ae), S(8, Re)], Qt);
    xs = class {
      constructor(t, e, i) {
        this._coreBrowserService = t;
        this._coreService = e;
        this._onTimeout = i;
        this._start = 0;
        this._end = 0;
        this._isBuffering = false;
      }
      bufferRows(t, e) {
        this._isBuffering ? (this._start = Math.min(this._start, t), this._end = Math.max(this._end, e)) : (this._start = t, this._end = e, this._isBuffering = true), this._timeout === void 0 && (this._timeout = this._coreBrowserService.window.setTimeout(() => {
          this._timeout = void 0, this._coreService.decPrivateModes.synchronizedOutput = false, this._onTimeout();
        }, 1e3));
      }
      flush() {
        if (this._timeout !== void 0 && (this._coreBrowserService.window.clearTimeout(this._timeout), this._timeout = void 0), !this._isBuffering) return;
        let t = { start: this._start, end: this._end };
        return this._isBuffering = false, t;
      }
      dispose() {
        this._timeout !== void 0 && (this._coreBrowserService.window.clearTimeout(this._timeout), this._timeout = void 0);
      }
    };
    on = class {
      constructor(t) {
        this._bufferService = t;
        this.isSelectAllActive = false;
        this.selectionStartLength = 0;
      }
      clearSelection() {
        this.selectionStart = void 0, this.selectionEnd = void 0, this.isSelectAllActive = false, this.selectionStartLength = 0;
      }
      get finalSelectionStart() {
        return this.isSelectAllActive ? [0, 0] : !this.selectionEnd || !this.selectionStart ? this.selectionStart : this.areSelectionValuesReversed() ? this.selectionEnd : this.selectionStart;
      }
      get finalSelectionEnd() {
        if (this.isSelectAllActive) return [this._bufferService.cols, this._bufferService.buffer.ybase + this._bufferService.rows - 1];
        if (this.selectionStart) {
          if (!this.selectionEnd || this.areSelectionValuesReversed()) {
            let t = this.selectionStart[0] + this.selectionStartLength;
            return t > this._bufferService.cols ? t % this._bufferService.cols === 0 ? [this._bufferService.cols, this.selectionStart[1] + Math.floor(t / this._bufferService.cols) - 1] : [t % this._bufferService.cols, this.selectionStart[1] + Math.floor(t / this._bufferService.cols)] : [t, this.selectionStart[1]];
          }
          if (this.selectionStartLength && this.selectionEnd[1] === this.selectionStart[1]) {
            let t = this.selectionStart[0] + this.selectionStartLength;
            return t > this._bufferService.cols ? [t % this._bufferService.cols, this.selectionStart[1] + Math.floor(t / this._bufferService.cols)] : [Math.max(t, this.selectionEnd[0]), this.selectionEnd[1]];
          }
          return this.selectionEnd;
        }
      }
      areSelectionValuesReversed() {
        let t = this.selectionStart, e = this.selectionEnd;
        return !t || !e ? false : t[1] > e[1] || t[1] === e[1] && t[0] > e[0];
      }
      handleTrim(t) {
        return this.selectionStart && (this.selectionStart[1] -= t), this.selectionEnd && (this.selectionEnd[1] -= t), this.selectionEnd && this.selectionEnd[1] < 0 ? (this.clearSelection(), true) : (this.selectionStart && this.selectionStart[1] < 0 && (this.selectionStart[1] = 0), false);
      }
    };
    Ds = 50, Ya = 15, ja = 50, Xa = 500, Za = " ", Ja = new RegExp(Za, "g");
    ei = class extends D {
      constructor(e, i, r, n, o, l, a, u, h8) {
        super();
        this._element = e;
        this._screenElement = i;
        this._linkifier = r;
        this._bufferService = n;
        this._coreService = o;
        this._mouseService = l;
        this._optionsService = a;
        this._renderService = u;
        this._coreBrowserService = h8;
        this._dragScrollAmount = 0;
        this._enabled = true;
        this._workCell = new q();
        this._mouseDownTimeStamp = 0;
        this._oldHasSelection = false;
        this._oldSelectionStart = void 0;
        this._oldSelectionEnd = void 0;
        this._onLinuxMouseSelection = this._register(new v());
        this.onLinuxMouseSelection = this._onLinuxMouseSelection.event;
        this._onRedrawRequest = this._register(new v());
        this.onRequestRedraw = this._onRedrawRequest.event;
        this._onSelectionChange = this._register(new v());
        this.onSelectionChange = this._onSelectionChange.event;
        this._onRequestScrollLines = this._register(new v());
        this.onRequestScrollLines = this._onRequestScrollLines.event;
        this._mouseMoveListener = (c) => this._handleMouseMove(c), this._mouseUpListener = (c) => this._handleMouseUp(c), this._coreService.onUserInput(() => {
          this.hasSelection && this.clearSelection();
        }), this._trimListener = this._bufferService.buffer.lines.onTrim((c) => this._handleTrim(c)), this._register(this._bufferService.buffers.onBufferActivate((c) => this._handleBufferActivate(c))), this.enable(), this._model = new on(this._bufferService), this._activeSelectionMode = 0, this._register(C(() => {
          this._removeMouseDownListeners();
        })), this._register(this._bufferService.onResize((c) => {
          c.rowsChanged && this.clearSelection();
        }));
      }
      reset() {
        this.clearSelection();
      }
      disable() {
        this.clearSelection(), this._enabled = false;
      }
      enable() {
        this._enabled = true;
      }
      get selectionStart() {
        return this._model.finalSelectionStart;
      }
      get selectionEnd() {
        return this._model.finalSelectionEnd;
      }
      get hasSelection() {
        let e = this._model.finalSelectionStart, i = this._model.finalSelectionEnd;
        return !e || !i ? false : e[0] !== i[0] || e[1] !== i[1];
      }
      get selectionText() {
        let e = this._model.finalSelectionStart, i = this._model.finalSelectionEnd;
        if (!e || !i) return "";
        let r = this._bufferService.buffer, n = [];
        if (this._activeSelectionMode === 3) {
          if (e[0] === i[0]) return "";
          let l = e[0] < i[0] ? e[0] : i[0], a = e[0] < i[0] ? i[0] : e[0];
          for (let u = e[1]; u <= i[1]; u++) {
            let h8 = r.translateBufferLineToString(u, true, l, a);
            n.push(h8);
          }
        } else {
          let l = e[1] === i[1] ? i[0] : void 0;
          n.push(r.translateBufferLineToString(e[1], true, e[0], l));
          for (let a = e[1] + 1; a <= i[1] - 1; a++) {
            let u = r.lines.get(a), h8 = r.translateBufferLineToString(a, true);
            u?.isWrapped ? n[n.length - 1] += h8 : n.push(h8);
          }
          if (e[1] !== i[1]) {
            let a = r.lines.get(i[1]), u = r.translateBufferLineToString(i[1], true, 0, i[0]);
            a && a.isWrapped ? n[n.length - 1] += u : n.push(u);
          }
        }
        return n.map((l) => l.replace(Ja, " ")).join(Es ? `\r
` : `
`);
      }
      clearSelection() {
        this._model.clearSelection(), this._removeMouseDownListeners(), this.refresh(), this._onSelectionChange.fire();
      }
      refresh(e) {
        this._refreshAnimationFrame || (this._refreshAnimationFrame = this._coreBrowserService.window.requestAnimationFrame(() => this._refresh())), Bi && e && this.selectionText.length && this._onLinuxMouseSelection.fire(this.selectionText);
      }
      _refresh() {
        this._refreshAnimationFrame = void 0, this._onRedrawRequest.fire({ start: this._model.finalSelectionStart, end: this._model.finalSelectionEnd, columnSelectMode: this._activeSelectionMode === 3 });
      }
      _isClickInSelection(e) {
        let i = this._getMouseBufferCoords(e), r = this._model.finalSelectionStart, n = this._model.finalSelectionEnd;
        return !r || !n || !i ? false : this._areCoordsInSelection(i, r, n);
      }
      isCellInSelection(e, i) {
        let r = this._model.finalSelectionStart, n = this._model.finalSelectionEnd;
        return !r || !n ? false : this._areCoordsInSelection([e, i], r, n);
      }
      _areCoordsInSelection(e, i, r) {
        return e[1] > i[1] && e[1] < r[1] || i[1] === r[1] && e[1] === i[1] && e[0] >= i[0] && e[0] < r[0] || i[1] < r[1] && e[1] === r[1] && e[0] < r[0] || i[1] < r[1] && e[1] === i[1] && e[0] >= i[0];
      }
      _selectWordAtCursor(e, i) {
        let r = this._linkifier.currentLink?.link?.range;
        if (r) return this._model.selectionStart = [r.start.x - 1, r.start.y - 1], this._model.selectionStartLength = ws(r, this._bufferService.cols), this._model.selectionEnd = void 0, true;
        let n = this._getMouseBufferCoords(e);
        return n ? (this._selectWordAt(n, i), this._model.selectionEnd = void 0, true) : false;
      }
      selectAll() {
        this._model.isSelectAllActive = true, this.refresh(), this._onSelectionChange.fire();
      }
      selectLines(e, i) {
        this._model.clearSelection(), e = Math.max(e, 0), i = Math.min(i, this._bufferService.buffer.lines.length - 1), this._model.selectionStart = [0, e], this._model.selectionEnd = [this._bufferService.cols, i], this.refresh(), this._onSelectionChange.fire();
      }
      _handleTrim(e) {
        this._model.handleTrim(e) && this.refresh();
      }
      _getMouseBufferCoords(e) {
        let i = this._mouseService.getCoords(e, this._screenElement, this._bufferService.cols, this._bufferService.rows, true);
        if (i) return i[0]--, i[1]--, i[1] += this._bufferService.buffer.ydisp, i;
      }
      _getMouseEventScrollAmount(e) {
        let i = Ci(this._coreBrowserService.window, e, this._screenElement)[1], r = this._renderService.dimensions.css.canvas.height;
        return i >= 0 && i <= r ? 0 : (i > r && (i -= r), i = Math.min(Math.max(i, -Ds), Ds), i /= Ds, i / Math.abs(i) + Math.round(i * (Ya - 1)));
      }
      shouldForceSelection(e) {
        return Zt ? e.altKey && this._optionsService.rawOptions.macOptionClickForcesSelection : e.shiftKey;
      }
      handleMouseDown(e) {
        if (this._mouseDownTimeStamp = e.timeStamp, !(e.button === 2 && this.hasSelection) && e.button === 0) {
          if (!this._enabled) {
            if (!this.shouldForceSelection(e)) return;
            e.stopPropagation();
          }
          e.preventDefault(), this._dragScrollAmount = 0, this._enabled && e.shiftKey ? this._handleIncrementalClick(e) : e.detail === 1 ? this._handleSingleClick(e) : e.detail === 2 ? this._handleDoubleClick(e) : e.detail === 3 && this._handleTripleClick(e), this._addMouseDownListeners(), this.refresh(true);
        }
      }
      _addMouseDownListeners() {
        this._screenElement.ownerDocument && (this._screenElement.ownerDocument.addEventListener("mousemove", this._mouseMoveListener), this._screenElement.ownerDocument.addEventListener("mouseup", this._mouseUpListener)), this._dragScrollIntervalTimer = this._coreBrowserService.window.setInterval(() => this._dragScroll(), ja);
      }
      _removeMouseDownListeners() {
        this._screenElement.ownerDocument && (this._screenElement.ownerDocument.removeEventListener("mousemove", this._mouseMoveListener), this._screenElement.ownerDocument.removeEventListener("mouseup", this._mouseUpListener)), this._coreBrowserService.window.clearInterval(this._dragScrollIntervalTimer), this._dragScrollIntervalTimer = void 0;
      }
      _handleIncrementalClick(e) {
        this._model.selectionStart && (this._model.selectionEnd = this._getMouseBufferCoords(e));
      }
      _handleSingleClick(e) {
        if (this._model.selectionStartLength = 0, this._model.isSelectAllActive = false, this._activeSelectionMode = this.shouldColumnSelect(e) ? 3 : 0, this._model.selectionStart = this._getMouseBufferCoords(e), !this._model.selectionStart) return;
        this._model.selectionEnd = void 0;
        let i = this._bufferService.buffer.lines.get(this._model.selectionStart[1]);
        i && i.length !== this._model.selectionStart[0] && i.hasWidth(this._model.selectionStart[0]) === 0 && this._model.selectionStart[0]++;
      }
      _handleDoubleClick(e) {
        this._selectWordAtCursor(e, true) && (this._activeSelectionMode = 1);
      }
      _handleTripleClick(e) {
        let i = this._getMouseBufferCoords(e);
        i && (this._activeSelectionMode = 2, this._selectLineAt(i[1]));
      }
      shouldColumnSelect(e) {
        return e.altKey && !(Zt && this._optionsService.rawOptions.macOptionClickForcesSelection);
      }
      _handleMouseMove(e) {
        if (e.stopImmediatePropagation(), !this._model.selectionStart) return;
        let i = this._model.selectionEnd ? [this._model.selectionEnd[0], this._model.selectionEnd[1]] : null;
        if (this._model.selectionEnd = this._getMouseBufferCoords(e), !this._model.selectionEnd) {
          this.refresh(true);
          return;
        }
        this._activeSelectionMode === 2 ? this._model.selectionEnd[1] < this._model.selectionStart[1] ? this._model.selectionEnd[0] = 0 : this._model.selectionEnd[0] = this._bufferService.cols : this._activeSelectionMode === 1 && this._selectToWordAt(this._model.selectionEnd), this._dragScrollAmount = this._getMouseEventScrollAmount(e), this._activeSelectionMode !== 3 && (this._dragScrollAmount > 0 ? this._model.selectionEnd[0] = this._bufferService.cols : this._dragScrollAmount < 0 && (this._model.selectionEnd[0] = 0));
        let r = this._bufferService.buffer;
        if (this._model.selectionEnd[1] < r.lines.length) {
          let n = r.lines.get(this._model.selectionEnd[1]);
          n && n.hasWidth(this._model.selectionEnd[0]) === 0 && this._model.selectionEnd[0] < this._bufferService.cols && this._model.selectionEnd[0]++;
        }
        (!i || i[0] !== this._model.selectionEnd[0] || i[1] !== this._model.selectionEnd[1]) && this.refresh(true);
      }
      _dragScroll() {
        if (!(!this._model.selectionEnd || !this._model.selectionStart) && this._dragScrollAmount) {
          this._onRequestScrollLines.fire({ amount: this._dragScrollAmount, suppressScrollEvent: false });
          let e = this._bufferService.buffer;
          this._dragScrollAmount > 0 ? (this._activeSelectionMode !== 3 && (this._model.selectionEnd[0] = this._bufferService.cols), this._model.selectionEnd[1] = Math.min(e.ydisp + this._bufferService.rows, e.lines.length - 1)) : (this._activeSelectionMode !== 3 && (this._model.selectionEnd[0] = 0), this._model.selectionEnd[1] = e.ydisp), this.refresh();
        }
      }
      _handleMouseUp(e) {
        let i = e.timeStamp - this._mouseDownTimeStamp;
        if (this._removeMouseDownListeners(), this.selectionText.length <= 1 && i < Xa && e.altKey && this._optionsService.rawOptions.altClickMovesCursor) {
          if (this._bufferService.buffer.ybase === this._bufferService.buffer.ydisp) {
            let r = this._mouseService.getCoords(e, this._element, this._bufferService.cols, this._bufferService.rows, false);
            if (r && r[0] !== void 0 && r[1] !== void 0) {
              let n = Jo(r[0] - 1, r[1] - 1, this._bufferService, this._coreService.decPrivateModes.applicationCursorKeys);
              this._coreService.triggerDataEvent(n, true);
            }
          }
        } else this._fireEventIfSelectionChanged();
      }
      _fireEventIfSelectionChanged() {
        let e = this._model.finalSelectionStart, i = this._model.finalSelectionEnd, r = !!e && !!i && (e[0] !== i[0] || e[1] !== i[1]);
        if (!r) {
          this._oldHasSelection && this._fireOnSelectionChange(e, i, r);
          return;
        }
        !e || !i || (!this._oldSelectionStart || !this._oldSelectionEnd || e[0] !== this._oldSelectionStart[0] || e[1] !== this._oldSelectionStart[1] || i[0] !== this._oldSelectionEnd[0] || i[1] !== this._oldSelectionEnd[1]) && this._fireOnSelectionChange(e, i, r);
      }
      _fireOnSelectionChange(e, i, r) {
        this._oldSelectionStart = e, this._oldSelectionEnd = i, this._oldHasSelection = r, this._onSelectionChange.fire();
      }
      _handleBufferActivate(e) {
        this.clearSelection(), this._trimListener.dispose(), this._trimListener = e.activeBuffer.lines.onTrim((i) => this._handleTrim(i));
      }
      _convertViewportColToCharacterIndex(e, i) {
        let r = i;
        for (let n = 0; i >= n; n++) {
          let o = e.loadCell(n, this._workCell).getChars().length;
          this._workCell.getWidth() === 0 ? r-- : o > 1 && i !== n && (r += o - 1);
        }
        return r;
      }
      setSelection(e, i, r) {
        this._model.clearSelection(), this._removeMouseDownListeners(), this._model.selectionStart = [e, i], this._model.selectionStartLength = r, this.refresh(), this._fireEventIfSelectionChanged();
      }
      rightClickSelect(e) {
        this._isClickInSelection(e) || (this._selectWordAtCursor(e, false) && this.refresh(true), this._fireEventIfSelectionChanged());
      }
      _getWordAt(e, i, r = true, n = true) {
        if (e[0] >= this._bufferService.cols) return;
        let o = this._bufferService.buffer, l = o.lines.get(e[1]);
        if (!l) return;
        let a = o.translateBufferLineToString(e[1], false), u = this._convertViewportColToCharacterIndex(l, e[0]), h8 = u, c = e[0] - u, d = 0, _ = 0, p = 0, m = 0;
        if (a.charAt(u) === " ") {
          for (; u > 0 && a.charAt(u - 1) === " "; ) u--;
          for (; h8 < a.length && a.charAt(h8 + 1) === " "; ) h8++;
        } else {
          let R = e[0], O = e[0];
          l.getWidth(R) === 0 && (d++, R--), l.getWidth(O) === 2 && (_++, O++);
          let I = l.getString(O).length;
          for (I > 1 && (m += I - 1, h8 += I - 1); R > 0 && u > 0 && !this._isCharWordSeparator(l.loadCell(R - 1, this._workCell)); ) {
            l.loadCell(R - 1, this._workCell);
            let k = this._workCell.getChars().length;
            this._workCell.getWidth() === 0 ? (d++, R--) : k > 1 && (p += k - 1, u -= k - 1), u--, R--;
          }
          for (; O < l.length && h8 + 1 < a.length && !this._isCharWordSeparator(l.loadCell(O + 1, this._workCell)); ) {
            l.loadCell(O + 1, this._workCell);
            let k = this._workCell.getChars().length;
            this._workCell.getWidth() === 2 ? (_++, O++) : k > 1 && (m += k - 1, h8 += k - 1), h8++, O++;
          }
        }
        h8++;
        let f = u + c - d + p, A = Math.min(this._bufferService.cols, h8 - u + d + _ - p - m);
        if (!(!i && a.slice(u, h8).trim() === "")) {
          if (r && f === 0 && l.getCodePoint(0) !== 32) {
            let R = o.lines.get(e[1] - 1);
            if (R && l.isWrapped && R.getCodePoint(this._bufferService.cols - 1) !== 32) {
              let O = this._getWordAt([this._bufferService.cols - 1, e[1] - 1], false, true, false);
              if (O) {
                let I = this._bufferService.cols - O.start;
                f -= I, A += I;
              }
            }
          }
          if (n && f + A === this._bufferService.cols && l.getCodePoint(this._bufferService.cols - 1) !== 32) {
            let R = o.lines.get(e[1] + 1);
            if (R?.isWrapped && R.getCodePoint(0) !== 32) {
              let O = this._getWordAt([0, e[1] + 1], false, false, true);
              O && (A += O.length);
            }
          }
          return { start: f, length: A };
        }
      }
      _selectWordAt(e, i) {
        let r = this._getWordAt(e, i);
        if (r) {
          for (; r.start < 0; ) r.start += this._bufferService.cols, e[1]--;
          this._model.selectionStart = [r.start, e[1]], this._model.selectionStartLength = r.length;
        }
      }
      _selectToWordAt(e) {
        let i = this._getWordAt(e, true);
        if (i) {
          let r = e[1];
          for (; i.start < 0; ) i.start += this._bufferService.cols, r--;
          if (!this._model.areSelectionValuesReversed()) for (; i.start + i.length > this._bufferService.cols; ) i.length -= this._bufferService.cols, r++;
          this._model.selectionEnd = [this._model.areSelectionValuesReversed() ? i.start : i.start + i.length, r];
        }
      }
      _isCharWordSeparator(e) {
        return e.getWidth() === 0 ? false : this._optionsService.rawOptions.wordSeparator.indexOf(e.getChars()) >= 0;
      }
      _selectLineAt(e) {
        let i = this._bufferService.buffer.getWrappedRangeForLine(e), r = { start: { x: 0, y: i.first }, end: { x: this._bufferService.cols - 1, y: i.last } };
        this._model.selectionStart = [0, i.first], this._model.selectionEnd = void 0, this._model.selectionStartLength = ws(r, this._bufferService.cols);
      }
    };
    ei = M([S(3, F), S(4, ge), S(5, Dt), S(6, H), S(7, ce), S(8, ae)], ei);
    Hi = class {
      constructor() {
        this._data = {};
      }
      set(t, e, i) {
        this._data[t] || (this._data[t] = {}), this._data[t][e] = i;
      }
      get(t, e) {
        return this._data[t] ? this._data[t][e] : void 0;
      }
      clear() {
        this._data = {};
      }
    };
    Wi = class {
      constructor() {
        this._color = new Hi();
        this._css = new Hi();
      }
      setCss(t, e, i) {
        this._css.set(t, e, i);
      }
      getCss(t, e) {
        return this._css.get(t, e);
      }
      setColor(t, e, i) {
        this._color.set(t, e, i);
      }
      getColor(t, e) {
        return this._color.get(t, e);
      }
      clear() {
        this._color.clear(), this._css.clear();
      }
    };
    re = Object.freeze((() => {
      let s15 = [z.toColor("#2e3436"), z.toColor("#cc0000"), z.toColor("#4e9a06"), z.toColor("#c4a000"), z.toColor("#3465a4"), z.toColor("#75507b"), z.toColor("#06989a"), z.toColor("#d3d7cf"), z.toColor("#555753"), z.toColor("#ef2929"), z.toColor("#8ae234"), z.toColor("#fce94f"), z.toColor("#729fcf"), z.toColor("#ad7fa8"), z.toColor("#34e2e2"), z.toColor("#eeeeec")], t = [0, 95, 135, 175, 215, 255];
      for (let e = 0; e < 216; e++) {
        let i = t[e / 36 % 6 | 0], r = t[e / 6 % 6 | 0], n = t[e % 6];
        s15.push({ css: j.toCss(i, r, n), rgba: j.toRgba(i, r, n) });
      }
      for (let e = 0; e < 24; e++) {
        let i = 8 + e * 10;
        s15.push({ css: j.toCss(i, i, i), rgba: j.toRgba(i, i, i) });
      }
      return s15;
    })());
    St = z.toColor("#ffffff"), Ki = z.toColor("#000000"), tl = z.toColor("#ffffff"), il = Ki, Ui = { css: "rgba(255, 255, 255, 0.3)", rgba: 4294967117 }, Qa = St, ti = class extends D {
      constructor(e) {
        super();
        this._optionsService = e;
        this._contrastCache = new Wi();
        this._halfContrastCache = new Wi();
        this._onChangeColors = this._register(new v());
        this.onChangeColors = this._onChangeColors.event;
        this._colors = { foreground: St, background: Ki, cursor: tl, cursorAccent: il, selectionForeground: void 0, selectionBackgroundTransparent: Ui, selectionBackgroundOpaque: U.blend(Ki, Ui), selectionInactiveBackgroundTransparent: Ui, selectionInactiveBackgroundOpaque: U.blend(Ki, Ui), scrollbarSliderBackground: U.opacity(St, 0.2), scrollbarSliderHoverBackground: U.opacity(St, 0.4), scrollbarSliderActiveBackground: U.opacity(St, 0.5), overviewRulerBorder: St, ansi: re.slice(), contrastCache: this._contrastCache, halfContrastCache: this._halfContrastCache }, this._updateRestoreColors(), this._setTheme(this._optionsService.rawOptions.theme), this._register(this._optionsService.onSpecificOptionChange("minimumContrastRatio", () => this._contrastCache.clear())), this._register(this._optionsService.onSpecificOptionChange("theme", () => this._setTheme(this._optionsService.rawOptions.theme)));
      }
      get colors() {
        return this._colors;
      }
      _setTheme(e = {}) {
        let i = this._colors;
        if (i.foreground = K(e.foreground, St), i.background = K(e.background, Ki), i.cursor = U.blend(i.background, K(e.cursor, tl)), i.cursorAccent = U.blend(i.background, K(e.cursorAccent, il)), i.selectionBackgroundTransparent = K(e.selectionBackground, Ui), i.selectionBackgroundOpaque = U.blend(i.background, i.selectionBackgroundTransparent), i.selectionInactiveBackgroundTransparent = K(e.selectionInactiveBackground, i.selectionBackgroundTransparent), i.selectionInactiveBackgroundOpaque = U.blend(i.background, i.selectionInactiveBackgroundTransparent), i.selectionForeground = e.selectionForeground ? K(e.selectionForeground, ps) : void 0, i.selectionForeground === ps && (i.selectionForeground = void 0), U.isOpaque(i.selectionBackgroundTransparent) && (i.selectionBackgroundTransparent = U.opacity(i.selectionBackgroundTransparent, 0.3)), U.isOpaque(i.selectionInactiveBackgroundTransparent) && (i.selectionInactiveBackgroundTransparent = U.opacity(i.selectionInactiveBackgroundTransparent, 0.3)), i.scrollbarSliderBackground = K(e.scrollbarSliderBackground, U.opacity(i.foreground, 0.2)), i.scrollbarSliderHoverBackground = K(e.scrollbarSliderHoverBackground, U.opacity(i.foreground, 0.4)), i.scrollbarSliderActiveBackground = K(e.scrollbarSliderActiveBackground, U.opacity(i.foreground, 0.5)), i.overviewRulerBorder = K(e.overviewRulerBorder, Qa), i.ansi = re.slice(), i.ansi[0] = K(e.black, re[0]), i.ansi[1] = K(e.red, re[1]), i.ansi[2] = K(e.green, re[2]), i.ansi[3] = K(e.yellow, re[3]), i.ansi[4] = K(e.blue, re[4]), i.ansi[5] = K(e.magenta, re[5]), i.ansi[6] = K(e.cyan, re[6]), i.ansi[7] = K(e.white, re[7]), i.ansi[8] = K(e.brightBlack, re[8]), i.ansi[9] = K(e.brightRed, re[9]), i.ansi[10] = K(e.brightGreen, re[10]), i.ansi[11] = K(e.brightYellow, re[11]), i.ansi[12] = K(e.brightBlue, re[12]), i.ansi[13] = K(e.brightMagenta, re[13]), i.ansi[14] = K(e.brightCyan, re[14]), i.ansi[15] = K(e.brightWhite, re[15]), e.extendedAnsi) {
          let r = Math.min(i.ansi.length - 16, e.extendedAnsi.length);
          for (let n = 0; n < r; n++) i.ansi[n + 16] = K(e.extendedAnsi[n], re[n + 16]);
        }
        this._contrastCache.clear(), this._halfContrastCache.clear(), this._updateRestoreColors(), this._onChangeColors.fire(this.colors);
      }
      restoreColor(e) {
        this._restoreColor(e), this._onChangeColors.fire(this.colors);
      }
      _restoreColor(e) {
        if (e === void 0) {
          for (let i = 0; i < this._restoreColors.ansi.length; ++i) this._colors.ansi[i] = this._restoreColors.ansi[i];
          return;
        }
        switch (e) {
          case 256:
            this._colors.foreground = this._restoreColors.foreground;
            break;
          case 257:
            this._colors.background = this._restoreColors.background;
            break;
          case 258:
            this._colors.cursor = this._restoreColors.cursor;
            break;
          default:
            this._colors.ansi[e] = this._restoreColors.ansi[e];
        }
      }
      modifyColors(e) {
        e(this._colors), this._onChangeColors.fire(this.colors);
      }
      _updateRestoreColors() {
        this._restoreColors = { foreground: this._colors.foreground, background: this._colors.background, cursor: this._colors.cursor, ansi: this._colors.ansi.slice() };
      }
    };
    ti = M([S(0, H)], ti);
    Rs = class {
      constructor(...t) {
        this._entries = /* @__PURE__ */ new Map();
        for (let [e, i] of t) this.set(e, i);
      }
      set(t, e) {
        let i = this._entries.get(t);
        return this._entries.set(t, e), i;
      }
      forEach(t) {
        for (let [e, i] of this._entries.entries()) t(e, i);
      }
      has(t) {
        return this._entries.has(t);
      }
      get(t) {
        return this._entries.get(t);
      }
    }, ln = class {
      constructor() {
        this._services = new Rs();
        this._services.set(xt, this);
      }
      setService(t, e) {
        this._services.set(t, e);
      }
      getService(t) {
        return this._services.get(t);
      }
      createInstance(t, ...e) {
        let i = Xs(t).sort((o, l) => o.index - l.index), r = [];
        for (let o of i) {
          let l = this._services.get(o.id);
          if (!l) throw new Error(`[createInstance] ${t.name} depends on UNKNOWN service ${o.id._id}.`);
          r.push(l);
        }
        let n = i.length > 0 ? i[0].index : e.length;
        if (e.length !== n) throw new Error(`[createInstance] First service dependency of ${t.name} at position ${n + 1} conflicts with ${e.length} static arguments`);
        return new t(...e, ...r);
      }
    };
    ec = { trace: 0, debug: 1, info: 2, warn: 3, error: 4, off: 5 }, tc = "xterm.js: ", ii = class extends D {
      constructor(e) {
        super();
        this._optionsService = e;
        this._logLevel = 5;
        this._updateLogLevel(), this._register(this._optionsService.onSpecificOptionChange("logLevel", () => this._updateLogLevel())), ic = this;
      }
      get logLevel() {
        return this._logLevel;
      }
      _updateLogLevel() {
        this._logLevel = ec[this._optionsService.rawOptions.logLevel];
      }
      _evalLazyOptionalParams(e) {
        for (let i = 0; i < e.length; i++) typeof e[i] == "function" && (e[i] = e[i]());
      }
      _log(e, i, r) {
        this._evalLazyOptionalParams(r), e.call(console, (this._optionsService.options.logger ? "" : tc) + i, ...r);
      }
      trace(e, ...i) {
        this._logLevel <= 0 && this._log(this._optionsService.options.logger?.trace.bind(this._optionsService.options.logger) ?? console.log, e, i);
      }
      debug(e, ...i) {
        this._logLevel <= 1 && this._log(this._optionsService.options.logger?.debug.bind(this._optionsService.options.logger) ?? console.log, e, i);
      }
      info(e, ...i) {
        this._logLevel <= 2 && this._log(this._optionsService.options.logger?.info.bind(this._optionsService.options.logger) ?? console.info, e, i);
      }
      warn(e, ...i) {
        this._logLevel <= 3 && this._log(this._optionsService.options.logger?.warn.bind(this._optionsService.options.logger) ?? console.warn, e, i);
      }
      error(e, ...i) {
        this._logLevel <= 4 && this._log(this._optionsService.options.logger?.error.bind(this._optionsService.options.logger) ?? console.error, e, i);
      }
    };
    ii = M([S(0, H)], ii);
    zi = class extends D {
      constructor(e) {
        super();
        this._maxLength = e;
        this.onDeleteEmitter = this._register(new v());
        this.onDelete = this.onDeleteEmitter.event;
        this.onInsertEmitter = this._register(new v());
        this.onInsert = this.onInsertEmitter.event;
        this.onTrimEmitter = this._register(new v());
        this.onTrim = this.onTrimEmitter.event;
        this._array = new Array(this._maxLength), this._startIndex = 0, this._length = 0;
      }
      get maxLength() {
        return this._maxLength;
      }
      set maxLength(e) {
        if (this._maxLength === e) return;
        let i = new Array(e);
        for (let r = 0; r < Math.min(e, this.length); r++) i[r] = this._array[this._getCyclicIndex(r)];
        this._array = i, this._maxLength = e, this._startIndex = 0;
      }
      get length() {
        return this._length;
      }
      set length(e) {
        if (e > this._length) for (let i = this._length; i < e; i++) this._array[i] = void 0;
        this._length = e;
      }
      get(e) {
        return this._array[this._getCyclicIndex(e)];
      }
      set(e, i) {
        this._array[this._getCyclicIndex(e)] = i;
      }
      push(e) {
        this._array[this._getCyclicIndex(this._length)] = e, this._length === this._maxLength ? (this._startIndex = ++this._startIndex % this._maxLength, this.onTrimEmitter.fire(1)) : this._length++;
      }
      recycle() {
        if (this._length !== this._maxLength) throw new Error("Can only recycle when the buffer is full");
        return this._startIndex = ++this._startIndex % this._maxLength, this.onTrimEmitter.fire(1), this._array[this._getCyclicIndex(this._length - 1)];
      }
      get isFull() {
        return this._length === this._maxLength;
      }
      pop() {
        return this._array[this._getCyclicIndex(this._length-- - 1)];
      }
      splice(e, i, ...r) {
        if (i) {
          for (let n = e; n < this._length - i; n++) this._array[this._getCyclicIndex(n)] = this._array[this._getCyclicIndex(n + i)];
          this._length -= i, this.onDeleteEmitter.fire({ index: e, amount: i });
        }
        for (let n = this._length - 1; n >= e; n--) this._array[this._getCyclicIndex(n + r.length)] = this._array[this._getCyclicIndex(n)];
        for (let n = 0; n < r.length; n++) this._array[this._getCyclicIndex(e + n)] = r[n];
        if (r.length && this.onInsertEmitter.fire({ index: e, amount: r.length }), this._length + r.length > this._maxLength) {
          let n = this._length + r.length - this._maxLength;
          this._startIndex += n, this._length = this._maxLength, this.onTrimEmitter.fire(n);
        } else this._length += r.length;
      }
      trimStart(e) {
        e > this._length && (e = this._length), this._startIndex += e, this._length -= e, this.onTrimEmitter.fire(e);
      }
      shiftElements(e, i, r) {
        if (!(i <= 0)) {
          if (e < 0 || e >= this._length) throw new Error("start argument out of range");
          if (e + r < 0) throw new Error("Cannot shift elements in list beyond index 0");
          if (r > 0) {
            for (let o = i - 1; o >= 0; o--) this.set(e + o + r, this.get(e + o));
            let n = e + i + r - this._length;
            if (n > 0) for (this._length += n; this._length > this._maxLength; ) this._length--, this._startIndex++, this.onTrimEmitter.fire(1);
          } else for (let n = 0; n < i; n++) this.set(e + n + r, this.get(e + n));
        }
      }
      _getCyclicIndex(e) {
        return (this._startIndex + e) % this._maxLength;
      }
    };
    B = 3;
    X = Object.freeze(new De()), an = 0, Ls = 2, Ze = class s12 {
      constructor(t, e, i = false) {
        this.isWrapped = i;
        this._combined = {};
        this._extendedAttrs = {};
        this._data = new Uint32Array(t * B);
        let r = e || q.fromCharData([0, ir, 1, 0]);
        for (let n = 0; n < t; ++n) this.setCell(n, r);
        this.length = t;
      }
      get(t) {
        let e = this._data[t * B + 0], i = e & 2097151;
        return [this._data[t * B + 1], e & 2097152 ? this._combined[t] : i ? Ce(i) : "", e >> 22, e & 2097152 ? this._combined[t].charCodeAt(this._combined[t].length - 1) : i];
      }
      set(t, e) {
        this._data[t * B + 1] = e[0], e[1].length > 1 ? (this._combined[t] = e[1], this._data[t * B + 0] = t | 2097152 | e[2] << 22) : this._data[t * B + 0] = e[1].charCodeAt(0) | e[2] << 22;
      }
      getWidth(t) {
        return this._data[t * B + 0] >> 22;
      }
      hasWidth(t) {
        return this._data[t * B + 0] & 12582912;
      }
      getFg(t) {
        return this._data[t * B + 1];
      }
      getBg(t) {
        return this._data[t * B + 2];
      }
      hasContent(t) {
        return this._data[t * B + 0] & 4194303;
      }
      getCodePoint(t) {
        let e = this._data[t * B + 0];
        return e & 2097152 ? this._combined[t].charCodeAt(this._combined[t].length - 1) : e & 2097151;
      }
      isCombined(t) {
        return this._data[t * B + 0] & 2097152;
      }
      getString(t) {
        let e = this._data[t * B + 0];
        return e & 2097152 ? this._combined[t] : e & 2097151 ? Ce(e & 2097151) : "";
      }
      isProtected(t) {
        return this._data[t * B + 2] & 536870912;
      }
      loadCell(t, e) {
        return an = t * B, e.content = this._data[an + 0], e.fg = this._data[an + 1], e.bg = this._data[an + 2], e.content & 2097152 && (e.combinedData = this._combined[t]), e.bg & 268435456 && (e.extended = this._extendedAttrs[t]), e;
      }
      setCell(t, e) {
        e.content & 2097152 && (this._combined[t] = e.combinedData), e.bg & 268435456 && (this._extendedAttrs[t] = e.extended), this._data[t * B + 0] = e.content, this._data[t * B + 1] = e.fg, this._data[t * B + 2] = e.bg;
      }
      setCellFromCodepoint(t, e, i, r) {
        r.bg & 268435456 && (this._extendedAttrs[t] = r.extended), this._data[t * B + 0] = e | i << 22, this._data[t * B + 1] = r.fg, this._data[t * B + 2] = r.bg;
      }
      addCodepointToCell(t, e, i) {
        let r = this._data[t * B + 0];
        r & 2097152 ? this._combined[t] += Ce(e) : r & 2097151 ? (this._combined[t] = Ce(r & 2097151) + Ce(e), r &= -2097152, r |= 2097152) : r = e | 1 << 22, i && (r &= -12582913, r |= i << 22), this._data[t * B + 0] = r;
      }
      insertCells(t, e, i) {
        if (t %= this.length, t && this.getWidth(t - 1) === 2 && this.setCellFromCodepoint(t - 1, 0, 1, i), e < this.length - t) {
          let r = new q();
          for (let n = this.length - t - e - 1; n >= 0; --n) this.setCell(t + e + n, this.loadCell(t + n, r));
          for (let n = 0; n < e; ++n) this.setCell(t + n, i);
        } else for (let r = t; r < this.length; ++r) this.setCell(r, i);
        this.getWidth(this.length - 1) === 2 && this.setCellFromCodepoint(this.length - 1, 0, 1, i);
      }
      deleteCells(t, e, i) {
        if (t %= this.length, e < this.length - t) {
          let r = new q();
          for (let n = 0; n < this.length - t - e; ++n) this.setCell(t + n, this.loadCell(t + e + n, r));
          for (let n = this.length - e; n < this.length; ++n) this.setCell(n, i);
        } else for (let r = t; r < this.length; ++r) this.setCell(r, i);
        t && this.getWidth(t - 1) === 2 && this.setCellFromCodepoint(t - 1, 0, 1, i), this.getWidth(t) === 0 && !this.hasContent(t) && this.setCellFromCodepoint(t, 0, 1, i);
      }
      replaceCells(t, e, i, r = false) {
        if (r) {
          for (t && this.getWidth(t - 1) === 2 && !this.isProtected(t - 1) && this.setCellFromCodepoint(t - 1, 0, 1, i), e < this.length && this.getWidth(e - 1) === 2 && !this.isProtected(e) && this.setCellFromCodepoint(e, 0, 1, i); t < e && t < this.length; ) this.isProtected(t) || this.setCell(t, i), t++;
          return;
        }
        for (t && this.getWidth(t - 1) === 2 && this.setCellFromCodepoint(t - 1, 0, 1, i), e < this.length && this.getWidth(e - 1) === 2 && this.setCellFromCodepoint(e, 0, 1, i); t < e && t < this.length; ) this.setCell(t++, i);
      }
      resize(t, e) {
        if (t === this.length) return this._data.length * 4 * Ls < this._data.buffer.byteLength;
        let i = t * B;
        if (t > this.length) {
          if (this._data.buffer.byteLength >= i * 4) this._data = new Uint32Array(this._data.buffer, 0, i);
          else {
            let r = new Uint32Array(i);
            r.set(this._data), this._data = r;
          }
          for (let r = this.length; r < t; ++r) this.setCell(r, e);
        } else {
          this._data = this._data.subarray(0, i);
          let r = Object.keys(this._combined);
          for (let o = 0; o < r.length; o++) {
            let l = parseInt(r[o], 10);
            l >= t && delete this._combined[l];
          }
          let n = Object.keys(this._extendedAttrs);
          for (let o = 0; o < n.length; o++) {
            let l = parseInt(n[o], 10);
            l >= t && delete this._extendedAttrs[l];
          }
        }
        return this.length = t, i * 4 * Ls < this._data.buffer.byteLength;
      }
      cleanupMemory() {
        if (this._data.length * 4 * Ls < this._data.buffer.byteLength) {
          let t = new Uint32Array(this._data.length);
          return t.set(this._data), this._data = t, 1;
        }
        return 0;
      }
      fill(t, e = false) {
        if (e) {
          for (let i = 0; i < this.length; ++i) this.isProtected(i) || this.setCell(i, t);
          return;
        }
        this._combined = {}, this._extendedAttrs = {};
        for (let i = 0; i < this.length; ++i) this.setCell(i, t);
      }
      copyFrom(t) {
        this.length !== t.length ? this._data = new Uint32Array(t._data) : this._data.set(t._data), this.length = t.length, this._combined = {};
        for (let e in t._combined) this._combined[e] = t._combined[e];
        this._extendedAttrs = {};
        for (let e in t._extendedAttrs) this._extendedAttrs[e] = t._extendedAttrs[e];
        this.isWrapped = t.isWrapped;
      }
      clone() {
        let t = new s12(0);
        t._data = new Uint32Array(this._data), t.length = this.length;
        for (let e in this._combined) t._combined[e] = this._combined[e];
        for (let e in this._extendedAttrs) t._extendedAttrs[e] = this._extendedAttrs[e];
        return t.isWrapped = this.isWrapped, t;
      }
      getTrimmedLength() {
        for (let t = this.length - 1; t >= 0; --t) if (this._data[t * B + 0] & 4194303) return t + (this._data[t * B + 0] >> 22);
        return 0;
      }
      getNoBgTrimmedLength() {
        for (let t = this.length - 1; t >= 0; --t) if (this._data[t * B + 0] & 4194303 || this._data[t * B + 2] & 50331648) return t + (this._data[t * B + 0] >> 22);
        return 0;
      }
      copyCellsFrom(t, e, i, r, n) {
        let o = t._data;
        if (n) for (let a = r - 1; a >= 0; a--) {
          for (let u = 0; u < B; u++) this._data[(i + a) * B + u] = o[(e + a) * B + u];
          o[(e + a) * B + 2] & 268435456 && (this._extendedAttrs[i + a] = t._extendedAttrs[e + a]);
        }
        else for (let a = 0; a < r; a++) {
          for (let u = 0; u < B; u++) this._data[(i + a) * B + u] = o[(e + a) * B + u];
          o[(e + a) * B + 2] & 268435456 && (this._extendedAttrs[i + a] = t._extendedAttrs[e + a]);
        }
        let l = Object.keys(t._combined);
        for (let a = 0; a < l.length; a++) {
          let u = parseInt(l[a], 10);
          u >= e && (this._combined[u - e + i] = t._combined[u]);
        }
      }
      translateToString(t, e, i, r) {
        e = e ?? 0, i = i ?? this.length, t && (i = Math.min(i, this.getTrimmedLength())), r && (r.length = 0);
        let n = "";
        for (; e < i; ) {
          let o = this._data[e * B + 0], l = o & 2097151, a = o & 2097152 ? this._combined[e] : l ? Ce(l) : we;
          if (n += a, r) for (let u = 0; u < a.length; ++u) r.push(e);
          e += o >> 22 || 1;
        }
        return r && r.push(e), n;
      }
    };
    un = class un2 {
      constructor(t) {
        this.line = t;
        this.isDisposed = false;
        this._disposables = [];
        this._id = un2._nextId++;
        this._onDispose = this.register(new v());
        this.onDispose = this._onDispose.event;
      }
      get id() {
        return this._id;
      }
      dispose() {
        this.isDisposed || (this.isDisposed = true, this.line = -1, this._onDispose.fire(), Ne(this._disposables), this._disposables.length = 0);
      }
      register(t) {
        return this._disposables.push(t), t;
      }
    };
    un._nextId = 1;
    cn = un;
    ne = {}, Je = ne.B;
    ne[0] = { "`": "◆", a: "▒", b: "␉", c: "␌", d: "␍", e: "␊", f: "°", g: "±", h: "␤", i: "␋", j: "┘", k: "┐", l: "┌", m: "└", n: "┼", o: "⎺", p: "⎻", q: "─", r: "⎼", s: "⎽", t: "├", u: "┤", v: "┴", w: "┬", x: "│", y: "≤", z: "≥", "{": "π", "|": "≠", "}": "£", "~": "·" };
    ne.A = { "#": "£" };
    ne.B = void 0;
    ne[4] = { "#": "£", "@": "¾", "[": "ij", "\\": "½", "]": "|", "{": "¨", "|": "f", "}": "¼", "~": "´" };
    ne.C = ne[5] = { "[": "Ä", "\\": "Ö", "]": "Å", "^": "Ü", "`": "é", "{": "ä", "|": "ö", "}": "å", "~": "ü" };
    ne.R = { "#": "£", "@": "à", "[": "°", "\\": "ç", "]": "§", "{": "é", "|": "ù", "}": "è", "~": "¨" };
    ne.Q = { "@": "à", "[": "â", "\\": "ç", "]": "ê", "^": "î", "`": "ô", "{": "é", "|": "ù", "}": "è", "~": "û" };
    ne.K = { "@": "§", "[": "Ä", "\\": "Ö", "]": "Ü", "{": "ä", "|": "ö", "}": "ü", "~": "ß" };
    ne.Y = { "#": "£", "@": "§", "[": "°", "\\": "ç", "]": "é", "`": "ù", "{": "à", "|": "ò", "}": "è", "~": "ì" };
    ne.E = ne[6] = { "@": "Ä", "[": "Æ", "\\": "Ø", "]": "Å", "^": "Ü", "`": "ä", "{": "æ", "|": "ø", "}": "å", "~": "ü" };
    ne.Z = { "#": "£", "@": "§", "[": "¡", "\\": "Ñ", "]": "¿", "{": "°", "|": "ñ", "}": "ç" };
    ne.H = ne[7] = { "@": "É", "[": "Ä", "\\": "Ö", "]": "Å", "^": "Ü", "`": "é", "{": "ä", "|": "ö", "}": "å", "~": "ü" };
    ne["="] = { "#": "ù", "@": "à", "[": "é", "\\": "ç", "]": "ê", "^": "î", _: "è", "`": "ô", "{": "ä", "|": "ö", "}": "ü", "~": "û" };
    cl = 4294967295, $i = class {
      constructor(t, e, i) {
        this._hasScrollback = t;
        this._optionsService = e;
        this._bufferService = i;
        this.ydisp = 0;
        this.ybase = 0;
        this.y = 0;
        this.x = 0;
        this.tabs = {};
        this.savedY = 0;
        this.savedX = 0;
        this.savedCurAttrData = X.clone();
        this.savedCharset = Je;
        this.markers = [];
        this._nullCell = q.fromCharData([0, ir, 1, 0]);
        this._whitespaceCell = q.fromCharData([0, we, 1, 32]);
        this._isClearing = false;
        this._memoryCleanupQueue = new Jt();
        this._memoryCleanupPosition = 0;
        this._cols = this._bufferService.cols, this._rows = this._bufferService.rows, this.lines = new zi(this._getCorrectBufferLength(this._rows)), this.scrollTop = 0, this.scrollBottom = this._rows - 1, this.setupTabStops();
      }
      getNullCell(t) {
        return t ? (this._nullCell.fg = t.fg, this._nullCell.bg = t.bg, this._nullCell.extended = t.extended) : (this._nullCell.fg = 0, this._nullCell.bg = 0, this._nullCell.extended = new rt()), this._nullCell;
      }
      getWhitespaceCell(t) {
        return t ? (this._whitespaceCell.fg = t.fg, this._whitespaceCell.bg = t.bg, this._whitespaceCell.extended = t.extended) : (this._whitespaceCell.fg = 0, this._whitespaceCell.bg = 0, this._whitespaceCell.extended = new rt()), this._whitespaceCell;
      }
      getBlankLine(t, e) {
        return new Ze(this._bufferService.cols, this.getNullCell(t), e);
      }
      get hasScrollback() {
        return this._hasScrollback && this.lines.maxLength > this._rows;
      }
      get isCursorInViewport() {
        let e = this.ybase + this.y - this.ydisp;
        return e >= 0 && e < this._rows;
      }
      _getCorrectBufferLength(t) {
        if (!this._hasScrollback) return t;
        let e = t + this._optionsService.rawOptions.scrollback;
        return e > cl ? cl : e;
      }
      fillViewportRows(t) {
        if (this.lines.length === 0) {
          t === void 0 && (t = X);
          let e = this._rows;
          for (; e--; ) this.lines.push(this.getBlankLine(t));
        }
      }
      clear() {
        this.ydisp = 0, this.ybase = 0, this.y = 0, this.x = 0, this.lines = new zi(this._getCorrectBufferLength(this._rows)), this.scrollTop = 0, this.scrollBottom = this._rows - 1, this.setupTabStops();
      }
      resize(t, e) {
        let i = this.getNullCell(X), r = 0, n = this._getCorrectBufferLength(e);
        if (n > this.lines.maxLength && (this.lines.maxLength = n), this.lines.length > 0) {
          if (this._cols < t) for (let l = 0; l < this.lines.length; l++) r += +this.lines.get(l).resize(t, i);
          let o = 0;
          if (this._rows < e) for (let l = this._rows; l < e; l++) this.lines.length < e + this.ybase && (this._optionsService.rawOptions.windowsMode || this._optionsService.rawOptions.windowsPty.backend !== void 0 || this._optionsService.rawOptions.windowsPty.buildNumber !== void 0 ? this.lines.push(new Ze(t, i)) : this.ybase > 0 && this.lines.length <= this.ybase + this.y + o + 1 ? (this.ybase--, o++, this.ydisp > 0 && this.ydisp--) : this.lines.push(new Ze(t, i)));
          else for (let l = this._rows; l > e; l--) this.lines.length > e + this.ybase && (this.lines.length > this.ybase + this.y + 1 ? this.lines.pop() : (this.ybase++, this.ydisp++));
          if (n < this.lines.maxLength) {
            let l = this.lines.length - n;
            l > 0 && (this.lines.trimStart(l), this.ybase = Math.max(this.ybase - l, 0), this.ydisp = Math.max(this.ydisp - l, 0), this.savedY = Math.max(this.savedY - l, 0)), this.lines.maxLength = n;
          }
          this.x = Math.min(this.x, t - 1), this.y = Math.min(this.y, e - 1), o && (this.y += o), this.savedX = Math.min(this.savedX, t - 1), this.scrollTop = 0;
        }
        if (this.scrollBottom = e - 1, this._isReflowEnabled && (this._reflow(t, e), this._cols > t)) for (let o = 0; o < this.lines.length; o++) r += +this.lines.get(o).resize(t, i);
        this._cols = t, this._rows = e, this._memoryCleanupQueue.clear(), r > 0.1 * this.lines.length && (this._memoryCleanupPosition = 0, this._memoryCleanupQueue.enqueue(() => this._batchedMemoryCleanup()));
      }
      _batchedMemoryCleanup() {
        let t = true;
        this._memoryCleanupPosition >= this.lines.length && (this._memoryCleanupPosition = 0, t = false);
        let e = 0;
        for (; this._memoryCleanupPosition < this.lines.length; ) if (e += this.lines.get(this._memoryCleanupPosition++).cleanupMemory(), e > 100) return true;
        return t;
      }
      get _isReflowEnabled() {
        let t = this._optionsService.rawOptions.windowsPty;
        return t && t.buildNumber ? this._hasScrollback && t.backend === "conpty" && t.buildNumber >= 21376 : this._hasScrollback && !this._optionsService.rawOptions.windowsMode;
      }
      _reflow(t, e) {
        this._cols !== t && (t > this._cols ? this._reflowLarger(t, e) : this._reflowSmaller(t, e));
      }
      _reflowLarger(t, e) {
        let i = this._optionsService.rawOptions.reflowCursorLine, r = sl(this.lines, this._cols, t, this.ybase + this.y, this.getNullCell(X), i);
        if (r.length > 0) {
          let n = ol(this.lines, r);
          ll(this.lines, n.layout), this._reflowLargerAdjustViewport(t, e, n.countRemoved);
        }
      }
      _reflowLargerAdjustViewport(t, e, i) {
        let r = this.getNullCell(X), n = i;
        for (; n-- > 0; ) this.ybase === 0 ? (this.y > 0 && this.y--, this.lines.length < e && this.lines.push(new Ze(t, r))) : (this.ydisp === this.ybase && this.ydisp--, this.ybase--);
        this.savedY = Math.max(this.savedY - i, 0);
      }
      _reflowSmaller(t, e) {
        let i = this._optionsService.rawOptions.reflowCursorLine, r = this.getNullCell(X), n = [], o = 0;
        for (let l = this.lines.length - 1; l >= 0; l--) {
          let a = this.lines.get(l);
          if (!a || !a.isWrapped && a.getTrimmedLength() <= t) continue;
          let u = [a];
          for (; a.isWrapped && l > 0; ) a = this.lines.get(--l), u.unshift(a);
          if (!i) {
            let I = this.ybase + this.y;
            if (I >= l && I < l + u.length) continue;
          }
          let h8 = u[u.length - 1].getTrimmedLength(), c = al(u, this._cols, t), d = c.length - u.length, _;
          this.ybase === 0 && this.y !== this.lines.length - 1 ? _ = Math.max(0, this.y - this.lines.maxLength + d) : _ = Math.max(0, this.lines.length - this.lines.maxLength + d);
          let p = [];
          for (let I = 0; I < d; I++) {
            let k = this.getBlankLine(X, true);
            p.push(k);
          }
          p.length > 0 && (n.push({ start: l + u.length + o, newLines: p }), o += p.length), u.push(...p);
          let m = c.length - 1, f = c[m];
          f === 0 && (m--, f = c[m]);
          let A = u.length - d - 1, R = h8;
          for (; A >= 0; ) {
            let I = Math.min(R, f);
            if (u[m] === void 0) break;
            if (u[m].copyCellsFrom(u[A], R - I, f - I, I, true), f -= I, f === 0 && (m--, f = c[m]), R -= I, R === 0) {
              A--;
              let k = Math.max(A, 0);
              R = ri(u, k, this._cols);
            }
          }
          for (let I = 0; I < u.length; I++) c[I] < t && u[I].setCell(c[I], r);
          let O = d - _;
          for (; O-- > 0; ) this.ybase === 0 ? this.y < e - 1 ? (this.y++, this.lines.pop()) : (this.ybase++, this.ydisp++) : this.ybase < Math.min(this.lines.maxLength, this.lines.length + o) - e && (this.ybase === this.ydisp && this.ydisp++, this.ybase++);
          this.savedY = Math.min(this.savedY + d, this.ybase + e - 1);
        }
        if (n.length > 0) {
          let l = [], a = [];
          for (let f = 0; f < this.lines.length; f++) a.push(this.lines.get(f));
          let u = this.lines.length, h8 = u - 1, c = 0, d = n[c];
          this.lines.length = Math.min(this.lines.maxLength, this.lines.length + o);
          let _ = 0;
          for (let f = Math.min(this.lines.maxLength - 1, u + o - 1); f >= 0; f--) if (d && d.start > h8 + _) {
            for (let A = d.newLines.length - 1; A >= 0; A--) this.lines.set(f--, d.newLines[A]);
            f++, l.push({ index: h8 + 1, amount: d.newLines.length }), _ += d.newLines.length, d = n[++c];
          } else this.lines.set(f, a[h8--]);
          let p = 0;
          for (let f = l.length - 1; f >= 0; f--) l[f].index += p, this.lines.onInsertEmitter.fire(l[f]), p += l[f].amount;
          let m = Math.max(0, u + o - this.lines.maxLength);
          m > 0 && this.lines.onTrimEmitter.fire(m);
        }
      }
      translateBufferLineToString(t, e, i = 0, r) {
        let n = this.lines.get(t);
        return n ? n.translateToString(e, i, r) : "";
      }
      getWrappedRangeForLine(t) {
        let e = t, i = t;
        for (; e > 0 && this.lines.get(e).isWrapped; ) e--;
        for (; i + 1 < this.lines.length && this.lines.get(i + 1).isWrapped; ) i++;
        return { first: e, last: i };
      }
      setupTabStops(t) {
        for (t != null ? this.tabs[t] || (t = this.prevStop(t)) : (this.tabs = {}, t = 0); t < this._cols; t += this._optionsService.rawOptions.tabStopWidth) this.tabs[t] = true;
      }
      prevStop(t) {
        for (t == null && (t = this.x); !this.tabs[--t] && t > 0; ) ;
        return t >= this._cols ? this._cols - 1 : t < 0 ? 0 : t;
      }
      nextStop(t) {
        for (t == null && (t = this.x); !this.tabs[++t] && t < this._cols; ) ;
        return t >= this._cols ? this._cols - 1 : t < 0 ? 0 : t;
      }
      clearMarkers(t) {
        this._isClearing = true;
        for (let e = 0; e < this.markers.length; e++) this.markers[e].line === t && (this.markers[e].dispose(), this.markers.splice(e--, 1));
        this._isClearing = false;
      }
      clearAllMarkers() {
        this._isClearing = true;
        for (let t = 0; t < this.markers.length; t++) this.markers[t].dispose();
        this.markers.length = 0, this._isClearing = false;
      }
      addMarker(t) {
        let e = new cn(t);
        return this.markers.push(e), e.register(this.lines.onTrim((i) => {
          e.line -= i, e.line < 0 && e.dispose();
        })), e.register(this.lines.onInsert((i) => {
          e.line >= i.index && (e.line += i.amount);
        })), e.register(this.lines.onDelete((i) => {
          e.line >= i.index && e.line < i.index + i.amount && e.dispose(), e.line > i.index && (e.line -= i.amount);
        })), e.register(e.onDispose(() => this._removeMarker(e))), e;
      }
      _removeMarker(t) {
        this._isClearing || this.markers.splice(this.markers.indexOf(t), 1);
      }
    };
    hn = class extends D {
      constructor(e, i) {
        super();
        this._optionsService = e;
        this._bufferService = i;
        this._onBufferActivate = this._register(new v());
        this.onBufferActivate = this._onBufferActivate.event;
        this.reset(), this._register(this._optionsService.onSpecificOptionChange("scrollback", () => this.resize(this._bufferService.cols, this._bufferService.rows))), this._register(this._optionsService.onSpecificOptionChange("tabStopWidth", () => this.setupTabStops()));
      }
      reset() {
        this._normal = new $i(true, this._optionsService, this._bufferService), this._normal.fillViewportRows(), this._alt = new $i(false, this._optionsService, this._bufferService), this._activeBuffer = this._normal, this._onBufferActivate.fire({ activeBuffer: this._normal, inactiveBuffer: this._alt }), this.setupTabStops();
      }
      get alt() {
        return this._alt;
      }
      get active() {
        return this._activeBuffer;
      }
      get normal() {
        return this._normal;
      }
      activateNormalBuffer() {
        this._activeBuffer !== this._normal && (this._normal.x = this._alt.x, this._normal.y = this._alt.y, this._alt.clearAllMarkers(), this._alt.clear(), this._activeBuffer = this._normal, this._onBufferActivate.fire({ activeBuffer: this._normal, inactiveBuffer: this._alt }));
      }
      activateAltBuffer(e) {
        this._activeBuffer !== this._alt && (this._alt.fillViewportRows(e), this._alt.x = this._normal.x, this._alt.y = this._normal.y, this._activeBuffer = this._alt, this._onBufferActivate.fire({ activeBuffer: this._alt, inactiveBuffer: this._normal }));
      }
      resize(e, i) {
        this._normal.resize(e, i), this._alt.resize(e, i), this.setupTabStops(e);
      }
      setupTabStops(e) {
        this._normal.setupTabStops(e), this._alt.setupTabStops(e);
      }
    };
    ks = 2, Cs = 1, ni = class extends D {
      constructor(e) {
        super();
        this.isUserScrolling = false;
        this._onResize = this._register(new v());
        this.onResize = this._onResize.event;
        this._onScroll = this._register(new v());
        this.onScroll = this._onScroll.event;
        this.cols = Math.max(e.rawOptions.cols || 0, ks), this.rows = Math.max(e.rawOptions.rows || 0, Cs), this.buffers = this._register(new hn(e, this)), this._register(this.buffers.onBufferActivate((i) => {
          this._onScroll.fire(i.activeBuffer.ydisp);
        }));
      }
      get buffer() {
        return this.buffers.active;
      }
      resize(e, i) {
        let r = this.cols !== e, n = this.rows !== i;
        this.cols = e, this.rows = i, this.buffers.resize(e, i), this._onResize.fire({ cols: e, rows: i, colsChanged: r, rowsChanged: n });
      }
      reset() {
        this.buffers.reset(), this.isUserScrolling = false;
      }
      scroll(e, i = false) {
        let r = this.buffer, n;
        n = this._cachedBlankLine, (!n || n.length !== this.cols || n.getFg(0) !== e.fg || n.getBg(0) !== e.bg) && (n = r.getBlankLine(e, i), this._cachedBlankLine = n), n.isWrapped = i;
        let o = r.ybase + r.scrollTop, l = r.ybase + r.scrollBottom;
        if (r.scrollTop === 0) {
          let a = r.lines.isFull;
          l === r.lines.length - 1 ? a ? r.lines.recycle().copyFrom(n) : r.lines.push(n.clone()) : r.lines.splice(l + 1, 0, n.clone()), a ? this.isUserScrolling && (r.ydisp = Math.max(r.ydisp - 1, 0)) : (r.ybase++, this.isUserScrolling || r.ydisp++);
        } else {
          let a = l - o + 1;
          r.lines.shiftElements(o + 1, a - 1, -1), r.lines.set(l, n.clone());
        }
        this.isUserScrolling || (r.ydisp = r.ybase), this._onScroll.fire(r.ydisp);
      }
      scrollLines(e, i) {
        let r = this.buffer;
        if (e < 0) {
          if (r.ydisp === 0) return;
          this.isUserScrolling = true;
        } else e + r.ydisp >= r.ybase && (this.isUserScrolling = false);
        let n = r.ydisp;
        r.ydisp = Math.max(Math.min(r.ydisp + e, r.ybase), 0), n !== r.ydisp && (i || this._onScroll.fire(r.ydisp));
      }
    };
    ni = M([S(0, H)], ni);
    si = { cols: 80, rows: 24, cursorBlink: false, cursorStyle: "block", cursorWidth: 1, cursorInactiveStyle: "outline", customGlyphs: true, drawBoldTextInBrightColors: true, documentOverride: null, fastScrollModifier: "alt", fastScrollSensitivity: 5, fontFamily: "monospace", fontSize: 15, fontWeight: "normal", fontWeightBold: "bold", ignoreBracketedPasteMode: false, lineHeight: 1, letterSpacing: 0, linkHandler: null, logLevel: "info", logger: null, scrollback: 1e3, scrollOnEraseInDisplay: false, scrollOnUserInput: true, scrollSensitivity: 1, screenReaderMode: false, smoothScrollDuration: 0, macOptionIsMeta: false, macOptionClickForcesSelection: false, minimumContrastRatio: 1, disableStdin: false, allowProposedApi: false, allowTransparency: false, tabStopWidth: 8, theme: {}, reflowCursorLine: false, rescaleOverlappingGlyphs: false, rightClickSelectsWord: Zt, windowOptions: {}, windowsMode: false, windowsPty: {}, wordSeparator: " ()[]{}',\"`", altClickMovesCursor: true, convertEol: false, termName: "xterm", cancelEvents: false, overviewRuler: {} }, nc = ["normal", "bold", "100", "200", "300", "400", "500", "600", "700", "800", "900"], dn = class extends D {
      constructor(e) {
        super();
        this._onOptionChange = this._register(new v());
        this.onOptionChange = this._onOptionChange.event;
        let i = { ...si };
        for (let r in e) if (r in i) try {
          let n = e[r];
          i[r] = this._sanitizeAndValidateOption(r, n);
        } catch (n) {
          console.error(n);
        }
        this.rawOptions = i, this.options = { ...i }, this._setupOptions(), this._register(C(() => {
          this.rawOptions.linkHandler = null, this.rawOptions.documentOverride = null;
        }));
      }
      onSpecificOptionChange(e, i) {
        return this.onOptionChange((r) => {
          r === e && i(this.rawOptions[e]);
        });
      }
      onMultipleOptionChange(e, i) {
        return this.onOptionChange((r) => {
          e.indexOf(r) !== -1 && i();
        });
      }
      _setupOptions() {
        let e = (r) => {
          if (!(r in si)) throw new Error(`No option with key "${r}"`);
          return this.rawOptions[r];
        }, i = (r, n) => {
          if (!(r in si)) throw new Error(`No option with key "${r}"`);
          n = this._sanitizeAndValidateOption(r, n), this.rawOptions[r] !== n && (this.rawOptions[r] = n, this._onOptionChange.fire(r));
        };
        for (let r in this.rawOptions) {
          let n = { get: e.bind(this, r), set: i.bind(this, r) };
          Object.defineProperty(this.options, r, n);
        }
      }
      _sanitizeAndValidateOption(e, i) {
        switch (e) {
          case "cursorStyle":
            if (i || (i = si[e]), !sc(i)) throw new Error(`"${i}" is not a valid value for ${e}`);
            break;
          case "wordSeparator":
            i || (i = si[e]);
            break;
          case "fontWeight":
          case "fontWeightBold":
            if (typeof i == "number" && 1 <= i && i <= 1e3) break;
            i = nc.includes(i) ? i : si[e];
            break;
          case "cursorWidth":
            i = Math.floor(i);
          case "lineHeight":
          case "tabStopWidth":
            if (i < 1) throw new Error(`${e} cannot be less than 1, value: ${i}`);
            break;
          case "minimumContrastRatio":
            i = Math.max(1, Math.min(21, Math.round(i * 10) / 10));
            break;
          case "scrollback":
            if (i = Math.min(i, 4294967295), i < 0) throw new Error(`${e} cannot be less than 0, value: ${i}`);
            break;
          case "fastScrollSensitivity":
          case "scrollSensitivity":
            if (i <= 0) throw new Error(`${e} cannot be less than or equal to 0, value: ${i}`);
            break;
          case "rows":
          case "cols":
            if (!i && i !== 0) throw new Error(`${e} must be numeric, value: ${i}`);
            break;
          case "windowsPty":
            i = i ?? {};
            break;
        }
        return i;
      }
    };
    ul = Object.freeze({ insertMode: false }), hl = Object.freeze({ applicationCursorKeys: false, applicationKeypad: false, bracketedPasteMode: false, cursorBlink: void 0, cursorStyle: void 0, origin: false, reverseWraparound: false, sendFocus: false, synchronizedOutput: false, wraparound: true }), li = class extends D {
      constructor(e, i, r) {
        super();
        this._bufferService = e;
        this._logService = i;
        this._optionsService = r;
        this.isCursorInitialized = false;
        this.isCursorHidden = false;
        this._onData = this._register(new v());
        this.onData = this._onData.event;
        this._onUserInput = this._register(new v());
        this.onUserInput = this._onUserInput.event;
        this._onBinary = this._register(new v());
        this.onBinary = this._onBinary.event;
        this._onRequestScrollToBottom = this._register(new v());
        this.onRequestScrollToBottom = this._onRequestScrollToBottom.event;
        this.modes = oi(ul), this.decPrivateModes = oi(hl);
      }
      reset() {
        this.modes = oi(ul), this.decPrivateModes = oi(hl);
      }
      triggerDataEvent(e, i = false) {
        if (this._optionsService.rawOptions.disableStdin) return;
        let r = this._bufferService.buffer;
        i && this._optionsService.rawOptions.scrollOnUserInput && r.ybase !== r.ydisp && this._onRequestScrollToBottom.fire(), i && this._onUserInput.fire(), this._logService.debug(`sending data "${e}"`), this._logService.trace("sending data (codes)", () => e.split("").map((n) => n.charCodeAt(0))), this._onData.fire(e);
      }
      triggerBinaryEvent(e) {
        this._optionsService.rawOptions.disableStdin || (this._logService.debug(`sending binary "${e}"`), this._logService.trace("sending binary (codes)", () => e.split("").map((i) => i.charCodeAt(0))), this._onBinary.fire(e));
      }
    };
    li = M([S(0, F), S(1, nr), S(2, H)], li);
    dl = { NONE: { events: 0, restrict: () => false }, X10: { events: 1, restrict: (s15) => s15.button === 4 || s15.action !== 1 ? false : (s15.ctrl = false, s15.alt = false, s15.shift = false, true) }, VT200: { events: 19, restrict: (s15) => s15.action !== 32 }, DRAG: { events: 23, restrict: (s15) => !(s15.action === 32 && s15.button === 3) }, ANY: { events: 31, restrict: (s15) => true } };
    Ps = String.fromCharCode, fl = { DEFAULT: (s15) => {
      let t = [Ms(s15, false) + 32, s15.col + 32, s15.row + 32];
      return t[0] > 255 || t[1] > 255 || t[2] > 255 ? "" : `\x1B[M${Ps(t[0])}${Ps(t[1])}${Ps(t[2])}`;
    }, SGR: (s15) => {
      let t = s15.action === 0 && s15.button !== 4 ? "m" : "M";
      return `\x1B[<${Ms(s15, true)};${s15.col};${s15.row}${t}`;
    }, SGR_PIXELS: (s15) => {
      let t = s15.action === 0 && s15.button !== 4 ? "m" : "M";
      return `\x1B[<${Ms(s15, true)};${s15.x};${s15.y}${t}`;
    } }, ai = class extends D {
      constructor(e, i, r) {
        super();
        this._bufferService = e;
        this._coreService = i;
        this._optionsService = r;
        this._protocols = {};
        this._encodings = {};
        this._activeProtocol = "";
        this._activeEncoding = "";
        this._lastEvent = null;
        this._wheelPartialScroll = 0;
        this._onProtocolChange = this._register(new v());
        this.onProtocolChange = this._onProtocolChange.event;
        for (let n of Object.keys(dl)) this.addProtocol(n, dl[n]);
        for (let n of Object.keys(fl)) this.addEncoding(n, fl[n]);
        this.reset();
      }
      addProtocol(e, i) {
        this._protocols[e] = i;
      }
      addEncoding(e, i) {
        this._encodings[e] = i;
      }
      get activeProtocol() {
        return this._activeProtocol;
      }
      get areMouseEventsActive() {
        return this._protocols[this._activeProtocol].events !== 0;
      }
      set activeProtocol(e) {
        if (!this._protocols[e]) throw new Error(`unknown protocol "${e}"`);
        this._activeProtocol = e, this._onProtocolChange.fire(this._protocols[e].events);
      }
      get activeEncoding() {
        return this._activeEncoding;
      }
      set activeEncoding(e) {
        if (!this._encodings[e]) throw new Error(`unknown encoding "${e}"`);
        this._activeEncoding = e;
      }
      reset() {
        this.activeProtocol = "NONE", this.activeEncoding = "DEFAULT", this._lastEvent = null, this._wheelPartialScroll = 0;
      }
      consumeWheelEvent(e, i, r) {
        if (e.deltaY === 0 || e.shiftKey || i === void 0 || r === void 0) return 0;
        let n = i / r, o = this._applyScrollModifier(e.deltaY, e);
        return e.deltaMode === WheelEvent.DOM_DELTA_PIXEL ? (o /= n + 0, Math.abs(e.deltaY) < 50 && (o *= 0.3), this._wheelPartialScroll += o, o = Math.floor(Math.abs(this._wheelPartialScroll)) * (this._wheelPartialScroll > 0 ? 1 : -1), this._wheelPartialScroll %= 1) : e.deltaMode === WheelEvent.DOM_DELTA_PAGE && (o *= this._bufferService.rows), o;
      }
      _applyScrollModifier(e, i) {
        return i.altKey || i.ctrlKey || i.shiftKey ? e * this._optionsService.rawOptions.fastScrollSensitivity * this._optionsService.rawOptions.scrollSensitivity : e * this._optionsService.rawOptions.scrollSensitivity;
      }
      triggerMouseEvent(e) {
        if (e.col < 0 || e.col >= this._bufferService.cols || e.row < 0 || e.row >= this._bufferService.rows || e.button === 4 && e.action === 32 || e.button === 3 && e.action !== 32 || e.button !== 4 && (e.action === 2 || e.action === 3) || (e.col++, e.row++, e.action === 32 && this._lastEvent && this._equalEvents(this._lastEvent, e, this._activeEncoding === "SGR_PIXELS")) || !this._protocols[this._activeProtocol].restrict(e)) return false;
        let i = this._encodings[this._activeEncoding](e);
        return i && (this._activeEncoding === "DEFAULT" ? this._coreService.triggerBinaryEvent(i) : this._coreService.triggerDataEvent(i, true)), this._lastEvent = e, true;
      }
      explainEvents(e) {
        return { down: !!(e & 1), up: !!(e & 2), drag: !!(e & 4), move: !!(e & 8), wheel: !!(e & 16) };
      }
      _equalEvents(e, i, r) {
        if (r) {
          if (e.x !== i.x || e.y !== i.y) return false;
        } else if (e.col !== i.col || e.row !== i.row) return false;
        return !(e.button !== i.button || e.action !== i.action || e.ctrl !== i.ctrl || e.alt !== i.alt || e.shift !== i.shift);
      }
    };
    ai = M([S(0, F), S(1, ge), S(2, H)], ai);
    Os = [[768, 879], [1155, 1158], [1160, 1161], [1425, 1469], [1471, 1471], [1473, 1474], [1476, 1477], [1479, 1479], [1536, 1539], [1552, 1557], [1611, 1630], [1648, 1648], [1750, 1764], [1767, 1768], [1770, 1773], [1807, 1807], [1809, 1809], [1840, 1866], [1958, 1968], [2027, 2035], [2305, 2306], [2364, 2364], [2369, 2376], [2381, 2381], [2385, 2388], [2402, 2403], [2433, 2433], [2492, 2492], [2497, 2500], [2509, 2509], [2530, 2531], [2561, 2562], [2620, 2620], [2625, 2626], [2631, 2632], [2635, 2637], [2672, 2673], [2689, 2690], [2748, 2748], [2753, 2757], [2759, 2760], [2765, 2765], [2786, 2787], [2817, 2817], [2876, 2876], [2879, 2879], [2881, 2883], [2893, 2893], [2902, 2902], [2946, 2946], [3008, 3008], [3021, 3021], [3134, 3136], [3142, 3144], [3146, 3149], [3157, 3158], [3260, 3260], [3263, 3263], [3270, 3270], [3276, 3277], [3298, 3299], [3393, 3395], [3405, 3405], [3530, 3530], [3538, 3540], [3542, 3542], [3633, 3633], [3636, 3642], [3655, 3662], [3761, 3761], [3764, 3769], [3771, 3772], [3784, 3789], [3864, 3865], [3893, 3893], [3895, 3895], [3897, 3897], [3953, 3966], [3968, 3972], [3974, 3975], [3984, 3991], [3993, 4028], [4038, 4038], [4141, 4144], [4146, 4146], [4150, 4151], [4153, 4153], [4184, 4185], [4448, 4607], [4959, 4959], [5906, 5908], [5938, 5940], [5970, 5971], [6002, 6003], [6068, 6069], [6071, 6077], [6086, 6086], [6089, 6099], [6109, 6109], [6155, 6157], [6313, 6313], [6432, 6434], [6439, 6440], [6450, 6450], [6457, 6459], [6679, 6680], [6912, 6915], [6964, 6964], [6966, 6970], [6972, 6972], [6978, 6978], [7019, 7027], [7616, 7626], [7678, 7679], [8203, 8207], [8234, 8238], [8288, 8291], [8298, 8303], [8400, 8431], [12330, 12335], [12441, 12442], [43014, 43014], [43019, 43019], [43045, 43046], [64286, 64286], [65024, 65039], [65056, 65059], [65279, 65279], [65529, 65531]], ac = [[68097, 68099], [68101, 68102], [68108, 68111], [68152, 68154], [68159, 68159], [119143, 119145], [119155, 119170], [119173, 119179], [119210, 119213], [119362, 119364], [917505, 917505], [917536, 917631], [917760, 917999]];
    fn = class {
      constructor() {
        this.version = "6";
        if (!se) {
          se = new Uint8Array(65536), se.fill(1), se[0] = 0, se.fill(0, 1, 32), se.fill(0, 127, 160), se.fill(2, 4352, 4448), se[9001] = 2, se[9002] = 2, se.fill(2, 11904, 42192), se[12351] = 1, se.fill(2, 44032, 55204), se.fill(2, 63744, 64256), se.fill(2, 65040, 65050), se.fill(2, 65072, 65136), se.fill(2, 65280, 65377), se.fill(2, 65504, 65511);
          for (let t = 0; t < Os.length; ++t) se.fill(0, Os[t][0], Os[t][1] + 1);
        }
      }
      wcwidth(t) {
        return t < 32 ? 0 : t < 127 ? 1 : t < 65536 ? se[t] : cc(t, ac) ? 0 : t >= 131072 && t <= 196605 || t >= 196608 && t <= 262141 ? 2 : 1;
      }
      charProperties(t, e) {
        let i = this.wcwidth(t), r = i === 0 && e !== 0;
        if (r) {
          let n = Ae.extractWidth(e);
          n === 0 ? r = false : n > i && (i = n);
        }
        return Ae.createPropertyValue(0, i, r);
      }
    };
    Ae = class s13 {
      constructor() {
        this._providers = /* @__PURE__ */ Object.create(null);
        this._active = "";
        this._onChange = new v();
        this.onChange = this._onChange.event;
        let t = new fn();
        this.register(t), this._active = t.version, this._activeProvider = t;
      }
      static extractShouldJoin(t) {
        return (t & 1) !== 0;
      }
      static extractWidth(t) {
        return t >> 1 & 3;
      }
      static extractCharKind(t) {
        return t >> 3;
      }
      static createPropertyValue(t, e, i = false) {
        return (t & 16777215) << 3 | (e & 3) << 1 | (i ? 1 : 0);
      }
      dispose() {
        this._onChange.dispose();
      }
      get versions() {
        return Object.keys(this._providers);
      }
      get activeVersion() {
        return this._active;
      }
      set activeVersion(t) {
        if (!this._providers[t]) throw new Error(`unknown Unicode version "${t}"`);
        this._active = t, this._activeProvider = this._providers[t], this._onChange.fire(t);
      }
      register(t) {
        this._providers[t.version] = t;
      }
      wcwidth(t) {
        return this._activeProvider.wcwidth(t);
      }
      getStringCellWidth(t) {
        let e = 0, i = 0, r = t.length;
        for (let n = 0; n < r; ++n) {
          let o = t.charCodeAt(n);
          if (55296 <= o && o <= 56319) {
            if (++n >= r) return e + this.wcwidth(o);
            let u = t.charCodeAt(n);
            56320 <= u && u <= 57343 ? o = (o - 55296) * 1024 + u - 56320 + 65536 : e += this.wcwidth(u);
          }
          let l = this.charProperties(o, i), a = s13.extractWidth(l);
          s13.extractShouldJoin(l) && (a -= s13.extractWidth(i)), e += a, i = l;
        }
        return e;
      }
      charProperties(t, e) {
        return this._activeProvider.charProperties(t, e);
      }
    };
    pn = class {
      constructor() {
        this.glevel = 0;
        this._charsets = [];
      }
      reset() {
        this.charset = void 0, this._charsets = [], this.glevel = 0;
      }
      setgLevel(t) {
        this.glevel = t, this.charset = this._charsets[t];
      }
      setgCharset(t, e) {
        this._charsets[t] = e, this.glevel === t && (this.charset = e);
      }
    };
    Vi = 2147483647, uc = 256, ci = class s14 {
      constructor(t = 32, e = 32) {
        this.maxLength = t;
        this.maxSubParamsLength = e;
        if (e > uc) throw new Error("maxSubParamsLength must not be greater than 256");
        this.params = new Int32Array(t), this.length = 0, this._subParams = new Int32Array(e), this._subParamsLength = 0, this._subParamsIdx = new Uint16Array(t), this._rejectDigits = false, this._rejectSubDigits = false, this._digitIsSub = false;
      }
      static fromArray(t) {
        let e = new s14();
        if (!t.length) return e;
        for (let i = Array.isArray(t[0]) ? 1 : 0; i < t.length; ++i) {
          let r = t[i];
          if (Array.isArray(r)) for (let n = 0; n < r.length; ++n) e.addSubParam(r[n]);
          else e.addParam(r);
        }
        return e;
      }
      clone() {
        let t = new s14(this.maxLength, this.maxSubParamsLength);
        return t.params.set(this.params), t.length = this.length, t._subParams.set(this._subParams), t._subParamsLength = this._subParamsLength, t._subParamsIdx.set(this._subParamsIdx), t._rejectDigits = this._rejectDigits, t._rejectSubDigits = this._rejectSubDigits, t._digitIsSub = this._digitIsSub, t;
      }
      toArray() {
        let t = [];
        for (let e = 0; e < this.length; ++e) {
          t.push(this.params[e]);
          let i = this._subParamsIdx[e] >> 8, r = this._subParamsIdx[e] & 255;
          r - i > 0 && t.push(Array.prototype.slice.call(this._subParams, i, r));
        }
        return t;
      }
      reset() {
        this.length = 0, this._subParamsLength = 0, this._rejectDigits = false, this._rejectSubDigits = false, this._digitIsSub = false;
      }
      addParam(t) {
        if (this._digitIsSub = false, this.length >= this.maxLength) {
          this._rejectDigits = true;
          return;
        }
        if (t < -1) throw new Error("values lesser than -1 are not allowed");
        this._subParamsIdx[this.length] = this._subParamsLength << 8 | this._subParamsLength, this.params[this.length++] = t > Vi ? Vi : t;
      }
      addSubParam(t) {
        if (this._digitIsSub = true, !!this.length) {
          if (this._rejectDigits || this._subParamsLength >= this.maxSubParamsLength) {
            this._rejectSubDigits = true;
            return;
          }
          if (t < -1) throw new Error("values lesser than -1 are not allowed");
          this._subParams[this._subParamsLength++] = t > Vi ? Vi : t, this._subParamsIdx[this.length - 1]++;
        }
      }
      hasSubParams(t) {
        return (this._subParamsIdx[t] & 255) - (this._subParamsIdx[t] >> 8) > 0;
      }
      getSubParams(t) {
        let e = this._subParamsIdx[t] >> 8, i = this._subParamsIdx[t] & 255;
        return i - e > 0 ? this._subParams.subarray(e, i) : null;
      }
      getSubParamsAll() {
        let t = {};
        for (let e = 0; e < this.length; ++e) {
          let i = this._subParamsIdx[e] >> 8, r = this._subParamsIdx[e] & 255;
          r - i > 0 && (t[e] = this._subParams.slice(i, r));
        }
        return t;
      }
      addDigit(t) {
        let e;
        if (this._rejectDigits || !(e = this._digitIsSub ? this._subParamsLength : this.length) || this._digitIsSub && this._rejectSubDigits) return;
        let i = this._digitIsSub ? this._subParams : this.params, r = i[e - 1];
        i[e - 1] = ~r ? Math.min(r * 10 + t, Vi) : t;
      }
    };
    qi = [], mn = class {
      constructor() {
        this._state = 0;
        this._active = qi;
        this._id = -1;
        this._handlers = /* @__PURE__ */ Object.create(null);
        this._handlerFb = () => {
        };
        this._stack = { paused: false, loopPosition: 0, fallThrough: false };
      }
      registerHandler(t, e) {
        this._handlers[t] === void 0 && (this._handlers[t] = []);
        let i = this._handlers[t];
        return i.push(e), { dispose: () => {
          let r = i.indexOf(e);
          r !== -1 && i.splice(r, 1);
        } };
      }
      clearHandler(t) {
        this._handlers[t] && delete this._handlers[t];
      }
      setHandlerFallback(t) {
        this._handlerFb = t;
      }
      dispose() {
        this._handlers = /* @__PURE__ */ Object.create(null), this._handlerFb = () => {
        }, this._active = qi;
      }
      reset() {
        if (this._state === 2) for (let t = this._stack.paused ? this._stack.loopPosition - 1 : this._active.length - 1; t >= 0; --t) this._active[t].end(false);
        this._stack.paused = false, this._active = qi, this._id = -1, this._state = 0;
      }
      _start() {
        if (this._active = this._handlers[this._id] || qi, !this._active.length) this._handlerFb(this._id, "START");
        else for (let t = this._active.length - 1; t >= 0; t--) this._active[t].start();
      }
      _put(t, e, i) {
        if (!this._active.length) this._handlerFb(this._id, "PUT", It(t, e, i));
        else for (let r = this._active.length - 1; r >= 0; r--) this._active[r].put(t, e, i);
      }
      start() {
        this.reset(), this._state = 1;
      }
      put(t, e, i) {
        if (this._state !== 3) {
          if (this._state === 1) for (; e < i; ) {
            let r = t[e++];
            if (r === 59) {
              this._state = 2, this._start();
              break;
            }
            if (r < 48 || 57 < r) {
              this._state = 3;
              return;
            }
            this._id === -1 && (this._id = 0), this._id = this._id * 10 + r - 48;
          }
          this._state === 2 && i - e > 0 && this._put(t, e, i);
        }
      }
      end(t, e = true) {
        if (this._state !== 0) {
          if (this._state !== 3) if (this._state === 1 && this._start(), !this._active.length) this._handlerFb(this._id, "END", t);
          else {
            let i = false, r = this._active.length - 1, n = false;
            if (this._stack.paused && (r = this._stack.loopPosition - 1, i = e, n = this._stack.fallThrough, this._stack.paused = false), !n && i === false) {
              for (; r >= 0 && (i = this._active[r].end(t), i !== true); r--) if (i instanceof Promise) return this._stack.paused = true, this._stack.loopPosition = r, this._stack.fallThrough = false, i;
              r--;
            }
            for (; r >= 0; r--) if (i = this._active[r].end(false), i instanceof Promise) return this._stack.paused = true, this._stack.loopPosition = r, this._stack.fallThrough = true, i;
          }
          this._active = qi, this._id = -1, this._state = 0;
        }
      }
    }, pe = class {
      constructor(t) {
        this._handler = t;
        this._data = "";
        this._hitLimit = false;
      }
      start() {
        this._data = "", this._hitLimit = false;
      }
      put(t, e, i) {
        this._hitLimit || (this._data += It(t, e, i), this._data.length > 1e7 && (this._data = "", this._hitLimit = true));
      }
      end(t) {
        let e = false;
        if (this._hitLimit) e = false;
        else if (t && (e = this._handler(this._data), e instanceof Promise)) return e.then((i) => (this._data = "", this._hitLimit = false, i));
        return this._data = "", this._hitLimit = false, e;
      }
    };
    Yi = [], _n = class {
      constructor() {
        this._handlers = /* @__PURE__ */ Object.create(null);
        this._active = Yi;
        this._ident = 0;
        this._handlerFb = () => {
        };
        this._stack = { paused: false, loopPosition: 0, fallThrough: false };
      }
      dispose() {
        this._handlers = /* @__PURE__ */ Object.create(null), this._handlerFb = () => {
        }, this._active = Yi;
      }
      registerHandler(t, e) {
        this._handlers[t] === void 0 && (this._handlers[t] = []);
        let i = this._handlers[t];
        return i.push(e), { dispose: () => {
          let r = i.indexOf(e);
          r !== -1 && i.splice(r, 1);
        } };
      }
      clearHandler(t) {
        this._handlers[t] && delete this._handlers[t];
      }
      setHandlerFallback(t) {
        this._handlerFb = t;
      }
      reset() {
        if (this._active.length) for (let t = this._stack.paused ? this._stack.loopPosition - 1 : this._active.length - 1; t >= 0; --t) this._active[t].unhook(false);
        this._stack.paused = false, this._active = Yi, this._ident = 0;
      }
      hook(t, e) {
        if (this.reset(), this._ident = t, this._active = this._handlers[t] || Yi, !this._active.length) this._handlerFb(this._ident, "HOOK", e);
        else for (let i = this._active.length - 1; i >= 0; i--) this._active[i].hook(e);
      }
      put(t, e, i) {
        if (!this._active.length) this._handlerFb(this._ident, "PUT", It(t, e, i));
        else for (let r = this._active.length - 1; r >= 0; r--) this._active[r].put(t, e, i);
      }
      unhook(t, e = true) {
        if (!this._active.length) this._handlerFb(this._ident, "UNHOOK", t);
        else {
          let i = false, r = this._active.length - 1, n = false;
          if (this._stack.paused && (r = this._stack.loopPosition - 1, i = e, n = this._stack.fallThrough, this._stack.paused = false), !n && i === false) {
            for (; r >= 0 && (i = this._active[r].unhook(t), i !== true); r--) if (i instanceof Promise) return this._stack.paused = true, this._stack.loopPosition = r, this._stack.fallThrough = false, i;
            r--;
          }
          for (; r >= 0; r--) if (i = this._active[r].unhook(false), i instanceof Promise) return this._stack.paused = true, this._stack.loopPosition = r, this._stack.fallThrough = true, i;
        }
        this._active = Yi, this._ident = 0;
      }
    }, ji = new ci();
    ji.addParam(0);
    Xi = class {
      constructor(t) {
        this._handler = t;
        this._data = "";
        this._params = ji;
        this._hitLimit = false;
      }
      hook(t) {
        this._params = t.length > 1 || t.params[0] ? t.clone() : ji, this._data = "", this._hitLimit = false;
      }
      put(t, e, i) {
        this._hitLimit || (this._data += It(t, e, i), this._data.length > 1e7 && (this._data = "", this._hitLimit = true));
      }
      unhook(t) {
        let e = false;
        if (this._hitLimit) e = false;
        else if (t && (e = this._handler(this._data, this._params), e instanceof Promise)) return e.then((i) => (this._params = ji, this._data = "", this._hitLimit = false, i));
        return this._params = ji, this._data = "", this._hitLimit = false, e;
      }
    };
    Fs = class {
      constructor(t) {
        this.table = new Uint8Array(t);
      }
      setDefault(t, e) {
        this.table.fill(t << 4 | e);
      }
      add(t, e, i, r) {
        this.table[e << 8 | t] = i << 4 | r;
      }
      addMany(t, e, i, r) {
        for (let n = 0; n < t.length; n++) this.table[e << 8 | t[n]] = i << 4 | r;
      }
    }, ke = 160, hc = (function() {
      let s15 = new Fs(4095), e = Array.apply(null, Array(256)).map((a, u) => u), i = (a, u) => e.slice(a, u), r = i(32, 127), n = i(0, 24);
      n.push(25), n.push.apply(n, i(28, 32));
      let o = i(0, 14), l;
      s15.setDefault(1, 0), s15.addMany(r, 0, 2, 0);
      for (l in o) s15.addMany([24, 26, 153, 154], l, 3, 0), s15.addMany(i(128, 144), l, 3, 0), s15.addMany(i(144, 152), l, 3, 0), s15.add(156, l, 0, 0), s15.add(27, l, 11, 1), s15.add(157, l, 4, 8), s15.addMany([152, 158, 159], l, 0, 7), s15.add(155, l, 11, 3), s15.add(144, l, 11, 9);
      return s15.addMany(n, 0, 3, 0), s15.addMany(n, 1, 3, 1), s15.add(127, 1, 0, 1), s15.addMany(n, 8, 0, 8), s15.addMany(n, 3, 3, 3), s15.add(127, 3, 0, 3), s15.addMany(n, 4, 3, 4), s15.add(127, 4, 0, 4), s15.addMany(n, 6, 3, 6), s15.addMany(n, 5, 3, 5), s15.add(127, 5, 0, 5), s15.addMany(n, 2, 3, 2), s15.add(127, 2, 0, 2), s15.add(93, 1, 4, 8), s15.addMany(r, 8, 5, 8), s15.add(127, 8, 5, 8), s15.addMany([156, 27, 24, 26, 7], 8, 6, 0), s15.addMany(i(28, 32), 8, 0, 8), s15.addMany([88, 94, 95], 1, 0, 7), s15.addMany(r, 7, 0, 7), s15.addMany(n, 7, 0, 7), s15.add(156, 7, 0, 0), s15.add(127, 7, 0, 7), s15.add(91, 1, 11, 3), s15.addMany(i(64, 127), 3, 7, 0), s15.addMany(i(48, 60), 3, 8, 4), s15.addMany([60, 61, 62, 63], 3, 9, 4), s15.addMany(i(48, 60), 4, 8, 4), s15.addMany(i(64, 127), 4, 7, 0), s15.addMany([60, 61, 62, 63], 4, 0, 6), s15.addMany(i(32, 64), 6, 0, 6), s15.add(127, 6, 0, 6), s15.addMany(i(64, 127), 6, 0, 0), s15.addMany(i(32, 48), 3, 9, 5), s15.addMany(i(32, 48), 5, 9, 5), s15.addMany(i(48, 64), 5, 0, 6), s15.addMany(i(64, 127), 5, 7, 0), s15.addMany(i(32, 48), 4, 9, 5), s15.addMany(i(32, 48), 1, 9, 2), s15.addMany(i(32, 48), 2, 9, 2), s15.addMany(i(48, 127), 2, 10, 0), s15.addMany(i(48, 80), 1, 10, 0), s15.addMany(i(81, 88), 1, 10, 0), s15.addMany([89, 90, 92], 1, 10, 0), s15.addMany(i(96, 127), 1, 10, 0), s15.add(80, 1, 11, 9), s15.addMany(n, 9, 0, 9), s15.add(127, 9, 0, 9), s15.addMany(i(28, 32), 9, 0, 9), s15.addMany(i(32, 48), 9, 9, 12), s15.addMany(i(48, 60), 9, 8, 10), s15.addMany([60, 61, 62, 63], 9, 9, 10), s15.addMany(n, 11, 0, 11), s15.addMany(i(32, 128), 11, 0, 11), s15.addMany(i(28, 32), 11, 0, 11), s15.addMany(n, 10, 0, 10), s15.add(127, 10, 0, 10), s15.addMany(i(28, 32), 10, 0, 10), s15.addMany(i(48, 60), 10, 8, 10), s15.addMany([60, 61, 62, 63], 10, 0, 11), s15.addMany(i(32, 48), 10, 9, 12), s15.addMany(n, 12, 0, 12), s15.add(127, 12, 0, 12), s15.addMany(i(28, 32), 12, 0, 12), s15.addMany(i(32, 48), 12, 9, 12), s15.addMany(i(48, 64), 12, 0, 11), s15.addMany(i(64, 127), 12, 12, 13), s15.addMany(i(64, 127), 10, 12, 13), s15.addMany(i(64, 127), 9, 12, 13), s15.addMany(n, 13, 13, 13), s15.addMany(r, 13, 13, 13), s15.add(127, 13, 0, 13), s15.addMany([27, 156, 24, 26], 13, 14, 0), s15.add(ke, 0, 2, 0), s15.add(ke, 8, 5, 8), s15.add(ke, 6, 0, 6), s15.add(ke, 11, 0, 11), s15.add(ke, 13, 13, 13), s15;
    })(), bn = class extends D {
      constructor(e = hc) {
        super();
        this._transitions = e;
        this._parseStack = { state: 0, handlers: [], handlerPos: 0, transition: 0, chunkPos: 0 };
        this.initialState = 0, this.currentState = this.initialState, this._params = new ci(), this._params.addParam(0), this._collect = 0, this.precedingJoinState = 0, this._printHandlerFb = (i, r, n) => {
        }, this._executeHandlerFb = (i) => {
        }, this._csiHandlerFb = (i, r) => {
        }, this._escHandlerFb = (i) => {
        }, this._errorHandlerFb = (i) => i, this._printHandler = this._printHandlerFb, this._executeHandlers = /* @__PURE__ */ Object.create(null), this._csiHandlers = /* @__PURE__ */ Object.create(null), this._escHandlers = /* @__PURE__ */ Object.create(null), this._register(C(() => {
          this._csiHandlers = /* @__PURE__ */ Object.create(null), this._executeHandlers = /* @__PURE__ */ Object.create(null), this._escHandlers = /* @__PURE__ */ Object.create(null);
        })), this._oscParser = this._register(new mn()), this._dcsParser = this._register(new _n()), this._errorHandler = this._errorHandlerFb, this.registerEscHandler({ final: "\\" }, () => true);
      }
      _identifier(e, i = [64, 126]) {
        let r = 0;
        if (e.prefix) {
          if (e.prefix.length > 1) throw new Error("only one byte as prefix supported");
          if (r = e.prefix.charCodeAt(0), r && 60 > r || r > 63) throw new Error("prefix must be in range 0x3c .. 0x3f");
        }
        if (e.intermediates) {
          if (e.intermediates.length > 2) throw new Error("only two bytes as intermediates are supported");
          for (let o = 0; o < e.intermediates.length; ++o) {
            let l = e.intermediates.charCodeAt(o);
            if (32 > l || l > 47) throw new Error("intermediate must be in range 0x20 .. 0x2f");
            r <<= 8, r |= l;
          }
        }
        if (e.final.length !== 1) throw new Error("final must be a single byte");
        let n = e.final.charCodeAt(0);
        if (i[0] > n || n > i[1]) throw new Error(`final must be in range ${i[0]} .. ${i[1]}`);
        return r <<= 8, r |= n, r;
      }
      identToString(e) {
        let i = [];
        for (; e; ) i.push(String.fromCharCode(e & 255)), e >>= 8;
        return i.reverse().join("");
      }
      setPrintHandler(e) {
        this._printHandler = e;
      }
      clearPrintHandler() {
        this._printHandler = this._printHandlerFb;
      }
      registerEscHandler(e, i) {
        let r = this._identifier(e, [48, 126]);
        this._escHandlers[r] === void 0 && (this._escHandlers[r] = []);
        let n = this._escHandlers[r];
        return n.push(i), { dispose: () => {
          let o = n.indexOf(i);
          o !== -1 && n.splice(o, 1);
        } };
      }
      clearEscHandler(e) {
        this._escHandlers[this._identifier(e, [48, 126])] && delete this._escHandlers[this._identifier(e, [48, 126])];
      }
      setEscHandlerFallback(e) {
        this._escHandlerFb = e;
      }
      setExecuteHandler(e, i) {
        this._executeHandlers[e.charCodeAt(0)] = i;
      }
      clearExecuteHandler(e) {
        this._executeHandlers[e.charCodeAt(0)] && delete this._executeHandlers[e.charCodeAt(0)];
      }
      setExecuteHandlerFallback(e) {
        this._executeHandlerFb = e;
      }
      registerCsiHandler(e, i) {
        let r = this._identifier(e);
        this._csiHandlers[r] === void 0 && (this._csiHandlers[r] = []);
        let n = this._csiHandlers[r];
        return n.push(i), { dispose: () => {
          let o = n.indexOf(i);
          o !== -1 && n.splice(o, 1);
        } };
      }
      clearCsiHandler(e) {
        this._csiHandlers[this._identifier(e)] && delete this._csiHandlers[this._identifier(e)];
      }
      setCsiHandlerFallback(e) {
        this._csiHandlerFb = e;
      }
      registerDcsHandler(e, i) {
        return this._dcsParser.registerHandler(this._identifier(e), i);
      }
      clearDcsHandler(e) {
        this._dcsParser.clearHandler(this._identifier(e));
      }
      setDcsHandlerFallback(e) {
        this._dcsParser.setHandlerFallback(e);
      }
      registerOscHandler(e, i) {
        return this._oscParser.registerHandler(e, i);
      }
      clearOscHandler(e) {
        this._oscParser.clearHandler(e);
      }
      setOscHandlerFallback(e) {
        this._oscParser.setHandlerFallback(e);
      }
      setErrorHandler(e) {
        this._errorHandler = e;
      }
      clearErrorHandler() {
        this._errorHandler = this._errorHandlerFb;
      }
      reset() {
        this.currentState = this.initialState, this._oscParser.reset(), this._dcsParser.reset(), this._params.reset(), this._params.addParam(0), this._collect = 0, this.precedingJoinState = 0, this._parseStack.state !== 0 && (this._parseStack.state = 2, this._parseStack.handlers = []);
      }
      _preserveStack(e, i, r, n, o) {
        this._parseStack.state = e, this._parseStack.handlers = i, this._parseStack.handlerPos = r, this._parseStack.transition = n, this._parseStack.chunkPos = o;
      }
      parse(e, i, r) {
        let n = 0, o = 0, l = 0, a;
        if (this._parseStack.state) if (this._parseStack.state === 2) this._parseStack.state = 0, l = this._parseStack.chunkPos + 1;
        else {
          if (r === void 0 || this._parseStack.state === 1) throw this._parseStack.state = 1, new Error("improper continuation due to previous async handler, giving up parsing");
          let u = this._parseStack.handlers, h8 = this._parseStack.handlerPos - 1;
          switch (this._parseStack.state) {
            case 3:
              if (r === false && h8 > -1) {
                for (; h8 >= 0 && (a = u[h8](this._params), a !== true); h8--) if (a instanceof Promise) return this._parseStack.handlerPos = h8, a;
              }
              this._parseStack.handlers = [];
              break;
            case 4:
              if (r === false && h8 > -1) {
                for (; h8 >= 0 && (a = u[h8](), a !== true); h8--) if (a instanceof Promise) return this._parseStack.handlerPos = h8, a;
              }
              this._parseStack.handlers = [];
              break;
            case 6:
              if (n = e[this._parseStack.chunkPos], a = this._dcsParser.unhook(n !== 24 && n !== 26, r), a) return a;
              n === 27 && (this._parseStack.transition |= 1), this._params.reset(), this._params.addParam(0), this._collect = 0;
              break;
            case 5:
              if (n = e[this._parseStack.chunkPos], a = this._oscParser.end(n !== 24 && n !== 26, r), a) return a;
              n === 27 && (this._parseStack.transition |= 1), this._params.reset(), this._params.addParam(0), this._collect = 0;
              break;
          }
          this._parseStack.state = 0, l = this._parseStack.chunkPos + 1, this.precedingJoinState = 0, this.currentState = this._parseStack.transition & 15;
        }
        for (let u = l; u < i; ++u) {
          switch (n = e[u], o = this._transitions.table[this.currentState << 8 | (n < 160 ? n : ke)], o >> 4) {
            case 2:
              for (let m = u + 1; ; ++m) {
                if (m >= i || (n = e[m]) < 32 || n > 126 && n < ke) {
                  this._printHandler(e, u, m), u = m - 1;
                  break;
                }
                if (++m >= i || (n = e[m]) < 32 || n > 126 && n < ke) {
                  this._printHandler(e, u, m), u = m - 1;
                  break;
                }
                if (++m >= i || (n = e[m]) < 32 || n > 126 && n < ke) {
                  this._printHandler(e, u, m), u = m - 1;
                  break;
                }
                if (++m >= i || (n = e[m]) < 32 || n > 126 && n < ke) {
                  this._printHandler(e, u, m), u = m - 1;
                  break;
                }
              }
              break;
            case 3:
              this._executeHandlers[n] ? this._executeHandlers[n]() : this._executeHandlerFb(n), this.precedingJoinState = 0;
              break;
            case 0:
              break;
            case 1:
              if (this._errorHandler({ position: u, code: n, currentState: this.currentState, collect: this._collect, params: this._params, abort: false }).abort) return;
              break;
            case 7:
              let c = this._csiHandlers[this._collect << 8 | n], d = c ? c.length - 1 : -1;
              for (; d >= 0 && (a = c[d](this._params), a !== true); d--) if (a instanceof Promise) return this._preserveStack(3, c, d, o, u), a;
              d < 0 && this._csiHandlerFb(this._collect << 8 | n, this._params), this.precedingJoinState = 0;
              break;
            case 8:
              do
                switch (n) {
                  case 59:
                    this._params.addParam(0);
                    break;
                  case 58:
                    this._params.addSubParam(-1);
                    break;
                  default:
                    this._params.addDigit(n - 48);
                }
              while (++u < i && (n = e[u]) > 47 && n < 60);
              u--;
              break;
            case 9:
              this._collect <<= 8, this._collect |= n;
              break;
            case 10:
              let _ = this._escHandlers[this._collect << 8 | n], p = _ ? _.length - 1 : -1;
              for (; p >= 0 && (a = _[p](), a !== true); p--) if (a instanceof Promise) return this._preserveStack(4, _, p, o, u), a;
              p < 0 && this._escHandlerFb(this._collect << 8 | n), this.precedingJoinState = 0;
              break;
            case 11:
              this._params.reset(), this._params.addParam(0), this._collect = 0;
              break;
            case 12:
              this._dcsParser.hook(this._collect << 8 | n, this._params);
              break;
            case 13:
              for (let m = u + 1; ; ++m) if (m >= i || (n = e[m]) === 24 || n === 26 || n === 27 || n > 127 && n < ke) {
                this._dcsParser.put(e, u, m), u = m - 1;
                break;
              }
              break;
            case 14:
              if (a = this._dcsParser.unhook(n !== 24 && n !== 26), a) return this._preserveStack(6, [], 0, o, u), a;
              n === 27 && (o |= 1), this._params.reset(), this._params.addParam(0), this._collect = 0, this.precedingJoinState = 0;
              break;
            case 4:
              this._oscParser.start();
              break;
            case 5:
              for (let m = u + 1; ; m++) if (m >= i || (n = e[m]) < 32 || n > 127 && n < ke) {
                this._oscParser.put(e, u, m), u = m - 1;
                break;
              }
              break;
            case 6:
              if (a = this._oscParser.end(n !== 24 && n !== 26), a) return this._preserveStack(5, [], 0, o, u), a;
              n === 27 && (o |= 1), this._params.reset(), this._params.addParam(0), this._collect = 0, this.precedingJoinState = 0;
              break;
          }
          this.currentState = o & 15;
        }
      }
    };
    dc = /^([\da-f])\/([\da-f])\/([\da-f])$|^([\da-f]{2})\/([\da-f]{2})\/([\da-f]{2})$|^([\da-f]{3})\/([\da-f]{3})\/([\da-f]{3})$|^([\da-f]{4})\/([\da-f]{4})\/([\da-f]{4})$/, fc = /^[\da-f]+$/;
    mc = { "(": 0, ")": 1, "*": 2, "+": 3, "-": 1, ".": 2 }, ut = 131072, _l = 10;
    vl = 5e3, gl = 0, vn = class extends D {
      constructor(e, i, r, n, o, l, a, u, h8 = new bn()) {
        super();
        this._bufferService = e;
        this._charsetService = i;
        this._coreService = r;
        this._logService = n;
        this._optionsService = o;
        this._oscLinkService = l;
        this._coreMouseService = a;
        this._unicodeService = u;
        this._parser = h8;
        this._parseBuffer = new Uint32Array(4096);
        this._stringDecoder = new er();
        this._utf8Decoder = new tr();
        this._windowTitle = "";
        this._iconName = "";
        this._windowTitleStack = [];
        this._iconNameStack = [];
        this._curAttrData = X.clone();
        this._eraseAttrDataInternal = X.clone();
        this._onRequestBell = this._register(new v());
        this.onRequestBell = this._onRequestBell.event;
        this._onRequestRefreshRows = this._register(new v());
        this.onRequestRefreshRows = this._onRequestRefreshRows.event;
        this._onRequestReset = this._register(new v());
        this.onRequestReset = this._onRequestReset.event;
        this._onRequestSendFocus = this._register(new v());
        this.onRequestSendFocus = this._onRequestSendFocus.event;
        this._onRequestSyncScrollBar = this._register(new v());
        this.onRequestSyncScrollBar = this._onRequestSyncScrollBar.event;
        this._onRequestWindowsOptionsReport = this._register(new v());
        this.onRequestWindowsOptionsReport = this._onRequestWindowsOptionsReport.event;
        this._onA11yChar = this._register(new v());
        this.onA11yChar = this._onA11yChar.event;
        this._onA11yTab = this._register(new v());
        this.onA11yTab = this._onA11yTab.event;
        this._onCursorMove = this._register(new v());
        this.onCursorMove = this._onCursorMove.event;
        this._onLineFeed = this._register(new v());
        this.onLineFeed = this._onLineFeed.event;
        this._onScroll = this._register(new v());
        this.onScroll = this._onScroll.event;
        this._onTitleChange = this._register(new v());
        this.onTitleChange = this._onTitleChange.event;
        this._onColor = this._register(new v());
        this.onColor = this._onColor.event;
        this._parseStack = { paused: false, cursorStartX: 0, cursorStartY: 0, decodedLength: 0, position: 0 };
        this._specialColors = [256, 257, 258];
        this._register(this._parser), this._dirtyRowTracker = new Zi(this._bufferService), this._activeBuffer = this._bufferService.buffer, this._register(this._bufferService.buffers.onBufferActivate((c) => this._activeBuffer = c.activeBuffer)), this._parser.setCsiHandlerFallback((c, d) => {
          this._logService.debug("Unknown CSI code: ", { identifier: this._parser.identToString(c), params: d.toArray() });
        }), this._parser.setEscHandlerFallback((c) => {
          this._logService.debug("Unknown ESC code: ", { identifier: this._parser.identToString(c) });
        }), this._parser.setExecuteHandlerFallback((c) => {
          this._logService.debug("Unknown EXECUTE code: ", { code: c });
        }), this._parser.setOscHandlerFallback((c, d, _) => {
          this._logService.debug("Unknown OSC code: ", { identifier: c, action: d, data: _ });
        }), this._parser.setDcsHandlerFallback((c, d, _) => {
          d === "HOOK" && (_ = _.toArray()), this._logService.debug("Unknown DCS code: ", { identifier: this._parser.identToString(c), action: d, payload: _ });
        }), this._parser.setPrintHandler((c, d, _) => this.print(c, d, _)), this._parser.registerCsiHandler({ final: "@" }, (c) => this.insertChars(c)), this._parser.registerCsiHandler({ intermediates: " ", final: "@" }, (c) => this.scrollLeft(c)), this._parser.registerCsiHandler({ final: "A" }, (c) => this.cursorUp(c)), this._parser.registerCsiHandler({ intermediates: " ", final: "A" }, (c) => this.scrollRight(c)), this._parser.registerCsiHandler({ final: "B" }, (c) => this.cursorDown(c)), this._parser.registerCsiHandler({ final: "C" }, (c) => this.cursorForward(c)), this._parser.registerCsiHandler({ final: "D" }, (c) => this.cursorBackward(c)), this._parser.registerCsiHandler({ final: "E" }, (c) => this.cursorNextLine(c)), this._parser.registerCsiHandler({ final: "F" }, (c) => this.cursorPrecedingLine(c)), this._parser.registerCsiHandler({ final: "G" }, (c) => this.cursorCharAbsolute(c)), this._parser.registerCsiHandler({ final: "H" }, (c) => this.cursorPosition(c)), this._parser.registerCsiHandler({ final: "I" }, (c) => this.cursorForwardTab(c)), this._parser.registerCsiHandler({ final: "J" }, (c) => this.eraseInDisplay(c, false)), this._parser.registerCsiHandler({ prefix: "?", final: "J" }, (c) => this.eraseInDisplay(c, true)), this._parser.registerCsiHandler({ final: "K" }, (c) => this.eraseInLine(c, false)), this._parser.registerCsiHandler({ prefix: "?", final: "K" }, (c) => this.eraseInLine(c, true)), this._parser.registerCsiHandler({ final: "L" }, (c) => this.insertLines(c)), this._parser.registerCsiHandler({ final: "M" }, (c) => this.deleteLines(c)), this._parser.registerCsiHandler({ final: "P" }, (c) => this.deleteChars(c)), this._parser.registerCsiHandler({ final: "S" }, (c) => this.scrollUp(c)), this._parser.registerCsiHandler({ final: "T" }, (c) => this.scrollDown(c)), this._parser.registerCsiHandler({ final: "X" }, (c) => this.eraseChars(c)), this._parser.registerCsiHandler({ final: "Z" }, (c) => this.cursorBackwardTab(c)), this._parser.registerCsiHandler({ final: "`" }, (c) => this.charPosAbsolute(c)), this._parser.registerCsiHandler({ final: "a" }, (c) => this.hPositionRelative(c)), this._parser.registerCsiHandler({ final: "b" }, (c) => this.repeatPrecedingCharacter(c)), this._parser.registerCsiHandler({ final: "c" }, (c) => this.sendDeviceAttributesPrimary(c)), this._parser.registerCsiHandler({ prefix: ">", final: "c" }, (c) => this.sendDeviceAttributesSecondary(c)), this._parser.registerCsiHandler({ final: "d" }, (c) => this.linePosAbsolute(c)), this._parser.registerCsiHandler({ final: "e" }, (c) => this.vPositionRelative(c)), this._parser.registerCsiHandler({ final: "f" }, (c) => this.hVPosition(c)), this._parser.registerCsiHandler({ final: "g" }, (c) => this.tabClear(c)), this._parser.registerCsiHandler({ final: "h" }, (c) => this.setMode(c)), this._parser.registerCsiHandler({ prefix: "?", final: "h" }, (c) => this.setModePrivate(c)), this._parser.registerCsiHandler({ final: "l" }, (c) => this.resetMode(c)), this._parser.registerCsiHandler({ prefix: "?", final: "l" }, (c) => this.resetModePrivate(c)), this._parser.registerCsiHandler({ final: "m" }, (c) => this.charAttributes(c)), this._parser.registerCsiHandler({ final: "n" }, (c) => this.deviceStatus(c)), this._parser.registerCsiHandler({ prefix: "?", final: "n" }, (c) => this.deviceStatusPrivate(c)), this._parser.registerCsiHandler({ intermediates: "!", final: "p" }, (c) => this.softReset(c)), this._parser.registerCsiHandler({ intermediates: " ", final: "q" }, (c) => this.setCursorStyle(c)), this._parser.registerCsiHandler({ final: "r" }, (c) => this.setScrollRegion(c)), this._parser.registerCsiHandler({ final: "s" }, (c) => this.saveCursor(c)), this._parser.registerCsiHandler({ final: "t" }, (c) => this.windowOptions(c)), this._parser.registerCsiHandler({ final: "u" }, (c) => this.restoreCursor(c)), this._parser.registerCsiHandler({ intermediates: "'", final: "}" }, (c) => this.insertColumns(c)), this._parser.registerCsiHandler({ intermediates: "'", final: "~" }, (c) => this.deleteColumns(c)), this._parser.registerCsiHandler({ intermediates: '"', final: "q" }, (c) => this.selectProtected(c)), this._parser.registerCsiHandler({ intermediates: "$", final: "p" }, (c) => this.requestMode(c, true)), this._parser.registerCsiHandler({ prefix: "?", intermediates: "$", final: "p" }, (c) => this.requestMode(c, false)), this._parser.setExecuteHandler(b.BEL, () => this.bell()), this._parser.setExecuteHandler(b.LF, () => this.lineFeed()), this._parser.setExecuteHandler(b.VT, () => this.lineFeed()), this._parser.setExecuteHandler(b.FF, () => this.lineFeed()), this._parser.setExecuteHandler(b.CR, () => this.carriageReturn()), this._parser.setExecuteHandler(b.BS, () => this.backspace()), this._parser.setExecuteHandler(b.HT, () => this.tab()), this._parser.setExecuteHandler(b.SO, () => this.shiftOut()), this._parser.setExecuteHandler(b.SI, () => this.shiftIn()), this._parser.setExecuteHandler(Ai.IND, () => this.index()), this._parser.setExecuteHandler(Ai.NEL, () => this.nextLine()), this._parser.setExecuteHandler(Ai.HTS, () => this.tabSet()), this._parser.registerOscHandler(0, new pe((c) => (this.setTitle(c), this.setIconName(c), true))), this._parser.registerOscHandler(1, new pe((c) => this.setIconName(c))), this._parser.registerOscHandler(2, new pe((c) => this.setTitle(c))), this._parser.registerOscHandler(4, new pe((c) => this.setOrReportIndexedColor(c))), this._parser.registerOscHandler(8, new pe((c) => this.setHyperlink(c))), this._parser.registerOscHandler(10, new pe((c) => this.setOrReportFgColor(c))), this._parser.registerOscHandler(11, new pe((c) => this.setOrReportBgColor(c))), this._parser.registerOscHandler(12, new pe((c) => this.setOrReportCursorColor(c))), this._parser.registerOscHandler(104, new pe((c) => this.restoreIndexedColor(c))), this._parser.registerOscHandler(110, new pe((c) => this.restoreFgColor(c))), this._parser.registerOscHandler(111, new pe((c) => this.restoreBgColor(c))), this._parser.registerOscHandler(112, new pe((c) => this.restoreCursorColor(c))), this._parser.registerEscHandler({ final: "7" }, () => this.saveCursor()), this._parser.registerEscHandler({ final: "8" }, () => this.restoreCursor()), this._parser.registerEscHandler({ final: "D" }, () => this.index()), this._parser.registerEscHandler({ final: "E" }, () => this.nextLine()), this._parser.registerEscHandler({ final: "H" }, () => this.tabSet()), this._parser.registerEscHandler({ final: "M" }, () => this.reverseIndex()), this._parser.registerEscHandler({ final: "=" }, () => this.keypadApplicationMode()), this._parser.registerEscHandler({ final: ">" }, () => this.keypadNumericMode()), this._parser.registerEscHandler({ final: "c" }, () => this.fullReset()), this._parser.registerEscHandler({ final: "n" }, () => this.setgLevel(2)), this._parser.registerEscHandler({ final: "o" }, () => this.setgLevel(3)), this._parser.registerEscHandler({ final: "|" }, () => this.setgLevel(3)), this._parser.registerEscHandler({ final: "}" }, () => this.setgLevel(2)), this._parser.registerEscHandler({ final: "~" }, () => this.setgLevel(1)), this._parser.registerEscHandler({ intermediates: "%", final: "@" }, () => this.selectDefaultCharset()), this._parser.registerEscHandler({ intermediates: "%", final: "G" }, () => this.selectDefaultCharset());
        for (let c in ne) this._parser.registerEscHandler({ intermediates: "(", final: c }, () => this.selectCharset("(" + c)), this._parser.registerEscHandler({ intermediates: ")", final: c }, () => this.selectCharset(")" + c)), this._parser.registerEscHandler({ intermediates: "*", final: c }, () => this.selectCharset("*" + c)), this._parser.registerEscHandler({ intermediates: "+", final: c }, () => this.selectCharset("+" + c)), this._parser.registerEscHandler({ intermediates: "-", final: c }, () => this.selectCharset("-" + c)), this._parser.registerEscHandler({ intermediates: ".", final: c }, () => this.selectCharset("." + c)), this._parser.registerEscHandler({ intermediates: "/", final: c }, () => this.selectCharset("/" + c));
        this._parser.registerEscHandler({ intermediates: "#", final: "8" }, () => this.screenAlignmentPattern()), this._parser.setErrorHandler((c) => (this._logService.error("Parsing error: ", c), c)), this._parser.registerDcsHandler({ intermediates: "$", final: "q" }, new Xi((c, d) => this.requestStatusString(c, d)));
      }
      getAttrData() {
        return this._curAttrData;
      }
      _preserveStack(e, i, r, n) {
        this._parseStack.paused = true, this._parseStack.cursorStartX = e, this._parseStack.cursorStartY = i, this._parseStack.decodedLength = r, this._parseStack.position = n;
      }
      _logSlowResolvingAsync(e) {
        this._logService.logLevel <= 3 && Promise.race([e, new Promise((i, r) => setTimeout(() => r("#SLOW_TIMEOUT"), vl))]).catch((i) => {
          if (i !== "#SLOW_TIMEOUT") throw i;
          console.warn(`async parser handler taking longer than ${vl} ms`);
        });
      }
      _getCurrentLinkId() {
        return this._curAttrData.extended.urlId;
      }
      parse(e, i) {
        let r, n = this._activeBuffer.x, o = this._activeBuffer.y, l = 0, a = this._parseStack.paused;
        if (a) {
          if (r = this._parser.parse(this._parseBuffer, this._parseStack.decodedLength, i)) return this._logSlowResolvingAsync(r), r;
          n = this._parseStack.cursorStartX, o = this._parseStack.cursorStartY, this._parseStack.paused = false, e.length > ut && (l = this._parseStack.position + ut);
        }
        if (this._logService.logLevel <= 1 && this._logService.debug(`parsing data ${typeof e == "string" ? ` "${e}"` : ` "${Array.prototype.map.call(e, (c) => String.fromCharCode(c)).join("")}"`}`), this._logService.logLevel === 0 && this._logService.trace("parsing data (codes)", typeof e == "string" ? e.split("").map((c) => c.charCodeAt(0)) : e), this._parseBuffer.length < e.length && this._parseBuffer.length < ut && (this._parseBuffer = new Uint32Array(Math.min(e.length, ut))), a || this._dirtyRowTracker.clearRange(), e.length > ut) for (let c = l; c < e.length; c += ut) {
          let d = c + ut < e.length ? c + ut : e.length, _ = typeof e == "string" ? this._stringDecoder.decode(e.substring(c, d), this._parseBuffer) : this._utf8Decoder.decode(e.subarray(c, d), this._parseBuffer);
          if (r = this._parser.parse(this._parseBuffer, _)) return this._preserveStack(n, o, _, c), this._logSlowResolvingAsync(r), r;
        }
        else if (!a) {
          let c = typeof e == "string" ? this._stringDecoder.decode(e, this._parseBuffer) : this._utf8Decoder.decode(e, this._parseBuffer);
          if (r = this._parser.parse(this._parseBuffer, c)) return this._preserveStack(n, o, c, 0), this._logSlowResolvingAsync(r), r;
        }
        (this._activeBuffer.x !== n || this._activeBuffer.y !== o) && this._onCursorMove.fire();
        let u = this._dirtyRowTracker.end + (this._bufferService.buffer.ybase - this._bufferService.buffer.ydisp), h8 = this._dirtyRowTracker.start + (this._bufferService.buffer.ybase - this._bufferService.buffer.ydisp);
        h8 < this._bufferService.rows && this._onRequestRefreshRows.fire({ start: Math.min(h8, this._bufferService.rows - 1), end: Math.min(u, this._bufferService.rows - 1) });
      }
      print(e, i, r) {
        let n, o, l = this._charsetService.charset, a = this._optionsService.rawOptions.screenReaderMode, u = this._bufferService.cols, h8 = this._coreService.decPrivateModes.wraparound, c = this._coreService.modes.insertMode, d = this._curAttrData, _ = this._activeBuffer.lines.get(this._activeBuffer.ybase + this._activeBuffer.y);
        this._dirtyRowTracker.markDirty(this._activeBuffer.y), this._activeBuffer.x && r - i > 0 && _.getWidth(this._activeBuffer.x - 1) === 2 && _.setCellFromCodepoint(this._activeBuffer.x - 1, 0, 1, d);
        let p = this._parser.precedingJoinState;
        for (let m = i; m < r; ++m) {
          if (n = e[m], n < 127 && l) {
            let O = l[String.fromCharCode(n)];
            O && (n = O.charCodeAt(0));
          }
          let f = this._unicodeService.charProperties(n, p);
          o = Ae.extractWidth(f);
          let A = Ae.extractShouldJoin(f), R = A ? Ae.extractWidth(p) : 0;
          if (p = f, a && this._onA11yChar.fire(Ce(n)), this._getCurrentLinkId() && this._oscLinkService.addLineToLink(this._getCurrentLinkId(), this._activeBuffer.ybase + this._activeBuffer.y), this._activeBuffer.x + o - R > u) {
            if (h8) {
              let O = _, I = this._activeBuffer.x - R;
              for (this._activeBuffer.x = R, this._activeBuffer.y++, this._activeBuffer.y === this._activeBuffer.scrollBottom + 1 ? (this._activeBuffer.y--, this._bufferService.scroll(this._eraseAttrData(), true)) : (this._activeBuffer.y >= this._bufferService.rows && (this._activeBuffer.y = this._bufferService.rows - 1), this._activeBuffer.lines.get(this._activeBuffer.ybase + this._activeBuffer.y).isWrapped = true), _ = this._activeBuffer.lines.get(this._activeBuffer.ybase + this._activeBuffer.y), R > 0 && _ instanceof Ze && _.copyCellsFrom(O, I, 0, R, false); I < u; ) O.setCellFromCodepoint(I++, 0, 1, d);
            } else if (this._activeBuffer.x = u - 1, o === 2) continue;
          }
          if (A && this._activeBuffer.x) {
            let O = _.getWidth(this._activeBuffer.x - 1) ? 1 : 2;
            _.addCodepointToCell(this._activeBuffer.x - O, n, o);
            for (let I = o - R; --I >= 0; ) _.setCellFromCodepoint(this._activeBuffer.x++, 0, 0, d);
            continue;
          }
          if (c && (_.insertCells(this._activeBuffer.x, o - R, this._activeBuffer.getNullCell(d)), _.getWidth(u - 1) === 2 && _.setCellFromCodepoint(u - 1, 0, 1, d)), _.setCellFromCodepoint(this._activeBuffer.x++, n, o, d), o > 0) for (; --o; ) _.setCellFromCodepoint(this._activeBuffer.x++, 0, 0, d);
        }
        this._parser.precedingJoinState = p, this._activeBuffer.x < u && r - i > 0 && _.getWidth(this._activeBuffer.x) === 0 && !_.hasContent(this._activeBuffer.x) && _.setCellFromCodepoint(this._activeBuffer.x, 0, 1, d), this._dirtyRowTracker.markDirty(this._activeBuffer.y);
      }
      registerCsiHandler(e, i) {
        return e.final === "t" && !e.prefix && !e.intermediates ? this._parser.registerCsiHandler(e, (r) => bl(r.params[0], this._optionsService.rawOptions.windowOptions) ? i(r) : true) : this._parser.registerCsiHandler(e, i);
      }
      registerDcsHandler(e, i) {
        return this._parser.registerDcsHandler(e, new Xi(i));
      }
      registerEscHandler(e, i) {
        return this._parser.registerEscHandler(e, i);
      }
      registerOscHandler(e, i) {
        return this._parser.registerOscHandler(e, new pe(i));
      }
      bell() {
        return this._onRequestBell.fire(), true;
      }
      lineFeed() {
        return this._dirtyRowTracker.markDirty(this._activeBuffer.y), this._optionsService.rawOptions.convertEol && (this._activeBuffer.x = 0), this._activeBuffer.y++, this._activeBuffer.y === this._activeBuffer.scrollBottom + 1 ? (this._activeBuffer.y--, this._bufferService.scroll(this._eraseAttrData())) : this._activeBuffer.y >= this._bufferService.rows ? this._activeBuffer.y = this._bufferService.rows - 1 : this._activeBuffer.lines.get(this._activeBuffer.ybase + this._activeBuffer.y).isWrapped = false, this._activeBuffer.x >= this._bufferService.cols && this._activeBuffer.x--, this._dirtyRowTracker.markDirty(this._activeBuffer.y), this._onLineFeed.fire(), true;
      }
      carriageReturn() {
        return this._activeBuffer.x = 0, true;
      }
      backspace() {
        if (!this._coreService.decPrivateModes.reverseWraparound) return this._restrictCursor(), this._activeBuffer.x > 0 && this._activeBuffer.x--, true;
        if (this._restrictCursor(this._bufferService.cols), this._activeBuffer.x > 0) this._activeBuffer.x--;
        else if (this._activeBuffer.x === 0 && this._activeBuffer.y > this._activeBuffer.scrollTop && this._activeBuffer.y <= this._activeBuffer.scrollBottom && this._activeBuffer.lines.get(this._activeBuffer.ybase + this._activeBuffer.y)?.isWrapped) {
          this._activeBuffer.lines.get(this._activeBuffer.ybase + this._activeBuffer.y).isWrapped = false, this._activeBuffer.y--, this._activeBuffer.x = this._bufferService.cols - 1;
          let e = this._activeBuffer.lines.get(this._activeBuffer.ybase + this._activeBuffer.y);
          e.hasWidth(this._activeBuffer.x) && !e.hasContent(this._activeBuffer.x) && this._activeBuffer.x--;
        }
        return this._restrictCursor(), true;
      }
      tab() {
        if (this._activeBuffer.x >= this._bufferService.cols) return true;
        let e = this._activeBuffer.x;
        return this._activeBuffer.x = this._activeBuffer.nextStop(), this._optionsService.rawOptions.screenReaderMode && this._onA11yTab.fire(this._activeBuffer.x - e), true;
      }
      shiftOut() {
        return this._charsetService.setgLevel(1), true;
      }
      shiftIn() {
        return this._charsetService.setgLevel(0), true;
      }
      _restrictCursor(e = this._bufferService.cols - 1) {
        this._activeBuffer.x = Math.min(e, Math.max(0, this._activeBuffer.x)), this._activeBuffer.y = this._coreService.decPrivateModes.origin ? Math.min(this._activeBuffer.scrollBottom, Math.max(this._activeBuffer.scrollTop, this._activeBuffer.y)) : Math.min(this._bufferService.rows - 1, Math.max(0, this._activeBuffer.y)), this._dirtyRowTracker.markDirty(this._activeBuffer.y);
      }
      _setCursor(e, i) {
        this._dirtyRowTracker.markDirty(this._activeBuffer.y), this._coreService.decPrivateModes.origin ? (this._activeBuffer.x = e, this._activeBuffer.y = this._activeBuffer.scrollTop + i) : (this._activeBuffer.x = e, this._activeBuffer.y = i), this._restrictCursor(), this._dirtyRowTracker.markDirty(this._activeBuffer.y);
      }
      _moveCursor(e, i) {
        this._restrictCursor(), this._setCursor(this._activeBuffer.x + e, this._activeBuffer.y + i);
      }
      cursorUp(e) {
        let i = this._activeBuffer.y - this._activeBuffer.scrollTop;
        return i >= 0 ? this._moveCursor(0, -Math.min(i, e.params[0] || 1)) : this._moveCursor(0, -(e.params[0] || 1)), true;
      }
      cursorDown(e) {
        let i = this._activeBuffer.scrollBottom - this._activeBuffer.y;
        return i >= 0 ? this._moveCursor(0, Math.min(i, e.params[0] || 1)) : this._moveCursor(0, e.params[0] || 1), true;
      }
      cursorForward(e) {
        return this._moveCursor(e.params[0] || 1, 0), true;
      }
      cursorBackward(e) {
        return this._moveCursor(-(e.params[0] || 1), 0), true;
      }
      cursorNextLine(e) {
        return this.cursorDown(e), this._activeBuffer.x = 0, true;
      }
      cursorPrecedingLine(e) {
        return this.cursorUp(e), this._activeBuffer.x = 0, true;
      }
      cursorCharAbsolute(e) {
        return this._setCursor((e.params[0] || 1) - 1, this._activeBuffer.y), true;
      }
      cursorPosition(e) {
        return this._setCursor(e.length >= 2 ? (e.params[1] || 1) - 1 : 0, (e.params[0] || 1) - 1), true;
      }
      charPosAbsolute(e) {
        return this._setCursor((e.params[0] || 1) - 1, this._activeBuffer.y), true;
      }
      hPositionRelative(e) {
        return this._moveCursor(e.params[0] || 1, 0), true;
      }
      linePosAbsolute(e) {
        return this._setCursor(this._activeBuffer.x, (e.params[0] || 1) - 1), true;
      }
      vPositionRelative(e) {
        return this._moveCursor(0, e.params[0] || 1), true;
      }
      hVPosition(e) {
        return this.cursorPosition(e), true;
      }
      tabClear(e) {
        let i = e.params[0];
        return i === 0 ? delete this._activeBuffer.tabs[this._activeBuffer.x] : i === 3 && (this._activeBuffer.tabs = {}), true;
      }
      cursorForwardTab(e) {
        if (this._activeBuffer.x >= this._bufferService.cols) return true;
        let i = e.params[0] || 1;
        for (; i--; ) this._activeBuffer.x = this._activeBuffer.nextStop();
        return true;
      }
      cursorBackwardTab(e) {
        if (this._activeBuffer.x >= this._bufferService.cols) return true;
        let i = e.params[0] || 1;
        for (; i--; ) this._activeBuffer.x = this._activeBuffer.prevStop();
        return true;
      }
      selectProtected(e) {
        let i = e.params[0];
        return i === 1 && (this._curAttrData.bg |= 536870912), (i === 2 || i === 0) && (this._curAttrData.bg &= -536870913), true;
      }
      _eraseInBufferLine(e, i, r, n = false, o = false) {
        let l = this._activeBuffer.lines.get(this._activeBuffer.ybase + e);
        l.replaceCells(i, r, this._activeBuffer.getNullCell(this._eraseAttrData()), o), n && (l.isWrapped = false);
      }
      _resetBufferLine(e, i = false) {
        let r = this._activeBuffer.lines.get(this._activeBuffer.ybase + e);
        r && (r.fill(this._activeBuffer.getNullCell(this._eraseAttrData()), i), this._bufferService.buffer.clearMarkers(this._activeBuffer.ybase + e), r.isWrapped = false);
      }
      eraseInDisplay(e, i = false) {
        this._restrictCursor(this._bufferService.cols);
        let r;
        switch (e.params[0]) {
          case 0:
            for (r = this._activeBuffer.y, this._dirtyRowTracker.markDirty(r), this._eraseInBufferLine(r++, this._activeBuffer.x, this._bufferService.cols, this._activeBuffer.x === 0, i); r < this._bufferService.rows; r++) this._resetBufferLine(r, i);
            this._dirtyRowTracker.markDirty(r);
            break;
          case 1:
            for (r = this._activeBuffer.y, this._dirtyRowTracker.markDirty(r), this._eraseInBufferLine(r, 0, this._activeBuffer.x + 1, true, i), this._activeBuffer.x + 1 >= this._bufferService.cols && (this._activeBuffer.lines.get(r + 1).isWrapped = false); r--; ) this._resetBufferLine(r, i);
            this._dirtyRowTracker.markDirty(0);
            break;
          case 2:
            if (this._optionsService.rawOptions.scrollOnEraseInDisplay) {
              for (r = this._bufferService.rows, this._dirtyRowTracker.markRangeDirty(0, r - 1); r-- && !this._activeBuffer.lines.get(this._activeBuffer.ybase + r)?.getTrimmedLength(); ) ;
              for (; r >= 0; r--) this._bufferService.scroll(this._eraseAttrData());
            } else {
              for (r = this._bufferService.rows, this._dirtyRowTracker.markDirty(r - 1); r--; ) this._resetBufferLine(r, i);
              this._dirtyRowTracker.markDirty(0);
            }
            break;
          case 3:
            let n = this._activeBuffer.lines.length - this._bufferService.rows;
            n > 0 && (this._activeBuffer.lines.trimStart(n), this._activeBuffer.ybase = Math.max(this._activeBuffer.ybase - n, 0), this._activeBuffer.ydisp = Math.max(this._activeBuffer.ydisp - n, 0), this._onScroll.fire(0));
            break;
        }
        return true;
      }
      eraseInLine(e, i = false) {
        switch (this._restrictCursor(this._bufferService.cols), e.params[0]) {
          case 0:
            this._eraseInBufferLine(this._activeBuffer.y, this._activeBuffer.x, this._bufferService.cols, this._activeBuffer.x === 0, i);
            break;
          case 1:
            this._eraseInBufferLine(this._activeBuffer.y, 0, this._activeBuffer.x + 1, false, i);
            break;
          case 2:
            this._eraseInBufferLine(this._activeBuffer.y, 0, this._bufferService.cols, true, i);
            break;
        }
        return this._dirtyRowTracker.markDirty(this._activeBuffer.y), true;
      }
      insertLines(e) {
        this._restrictCursor();
        let i = e.params[0] || 1;
        if (this._activeBuffer.y > this._activeBuffer.scrollBottom || this._activeBuffer.y < this._activeBuffer.scrollTop) return true;
        let r = this._activeBuffer.ybase + this._activeBuffer.y, n = this._bufferService.rows - 1 - this._activeBuffer.scrollBottom, o = this._bufferService.rows - 1 + this._activeBuffer.ybase - n + 1;
        for (; i--; ) this._activeBuffer.lines.splice(o - 1, 1), this._activeBuffer.lines.splice(r, 0, this._activeBuffer.getBlankLine(this._eraseAttrData()));
        return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.y, this._activeBuffer.scrollBottom), this._activeBuffer.x = 0, true;
      }
      deleteLines(e) {
        this._restrictCursor();
        let i = e.params[0] || 1;
        if (this._activeBuffer.y > this._activeBuffer.scrollBottom || this._activeBuffer.y < this._activeBuffer.scrollTop) return true;
        let r = this._activeBuffer.ybase + this._activeBuffer.y, n;
        for (n = this._bufferService.rows - 1 - this._activeBuffer.scrollBottom, n = this._bufferService.rows - 1 + this._activeBuffer.ybase - n; i--; ) this._activeBuffer.lines.splice(r, 1), this._activeBuffer.lines.splice(n, 0, this._activeBuffer.getBlankLine(this._eraseAttrData()));
        return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.y, this._activeBuffer.scrollBottom), this._activeBuffer.x = 0, true;
      }
      insertChars(e) {
        this._restrictCursor();
        let i = this._activeBuffer.lines.get(this._activeBuffer.ybase + this._activeBuffer.y);
        return i && (i.insertCells(this._activeBuffer.x, e.params[0] || 1, this._activeBuffer.getNullCell(this._eraseAttrData())), this._dirtyRowTracker.markDirty(this._activeBuffer.y)), true;
      }
      deleteChars(e) {
        this._restrictCursor();
        let i = this._activeBuffer.lines.get(this._activeBuffer.ybase + this._activeBuffer.y);
        return i && (i.deleteCells(this._activeBuffer.x, e.params[0] || 1, this._activeBuffer.getNullCell(this._eraseAttrData())), this._dirtyRowTracker.markDirty(this._activeBuffer.y)), true;
      }
      scrollUp(e) {
        let i = e.params[0] || 1;
        for (; i--; ) this._activeBuffer.lines.splice(this._activeBuffer.ybase + this._activeBuffer.scrollTop, 1), this._activeBuffer.lines.splice(this._activeBuffer.ybase + this._activeBuffer.scrollBottom, 0, this._activeBuffer.getBlankLine(this._eraseAttrData()));
        return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop, this._activeBuffer.scrollBottom), true;
      }
      scrollDown(e) {
        let i = e.params[0] || 1;
        for (; i--; ) this._activeBuffer.lines.splice(this._activeBuffer.ybase + this._activeBuffer.scrollBottom, 1), this._activeBuffer.lines.splice(this._activeBuffer.ybase + this._activeBuffer.scrollTop, 0, this._activeBuffer.getBlankLine(X));
        return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop, this._activeBuffer.scrollBottom), true;
      }
      scrollLeft(e) {
        if (this._activeBuffer.y > this._activeBuffer.scrollBottom || this._activeBuffer.y < this._activeBuffer.scrollTop) return true;
        let i = e.params[0] || 1;
        for (let r = this._activeBuffer.scrollTop; r <= this._activeBuffer.scrollBottom; ++r) {
          let n = this._activeBuffer.lines.get(this._activeBuffer.ybase + r);
          n.deleteCells(0, i, this._activeBuffer.getNullCell(this._eraseAttrData())), n.isWrapped = false;
        }
        return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop, this._activeBuffer.scrollBottom), true;
      }
      scrollRight(e) {
        if (this._activeBuffer.y > this._activeBuffer.scrollBottom || this._activeBuffer.y < this._activeBuffer.scrollTop) return true;
        let i = e.params[0] || 1;
        for (let r = this._activeBuffer.scrollTop; r <= this._activeBuffer.scrollBottom; ++r) {
          let n = this._activeBuffer.lines.get(this._activeBuffer.ybase + r);
          n.insertCells(0, i, this._activeBuffer.getNullCell(this._eraseAttrData())), n.isWrapped = false;
        }
        return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop, this._activeBuffer.scrollBottom), true;
      }
      insertColumns(e) {
        if (this._activeBuffer.y > this._activeBuffer.scrollBottom || this._activeBuffer.y < this._activeBuffer.scrollTop) return true;
        let i = e.params[0] || 1;
        for (let r = this._activeBuffer.scrollTop; r <= this._activeBuffer.scrollBottom; ++r) {
          let n = this._activeBuffer.lines.get(this._activeBuffer.ybase + r);
          n.insertCells(this._activeBuffer.x, i, this._activeBuffer.getNullCell(this._eraseAttrData())), n.isWrapped = false;
        }
        return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop, this._activeBuffer.scrollBottom), true;
      }
      deleteColumns(e) {
        if (this._activeBuffer.y > this._activeBuffer.scrollBottom || this._activeBuffer.y < this._activeBuffer.scrollTop) return true;
        let i = e.params[0] || 1;
        for (let r = this._activeBuffer.scrollTop; r <= this._activeBuffer.scrollBottom; ++r) {
          let n = this._activeBuffer.lines.get(this._activeBuffer.ybase + r);
          n.deleteCells(this._activeBuffer.x, i, this._activeBuffer.getNullCell(this._eraseAttrData())), n.isWrapped = false;
        }
        return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop, this._activeBuffer.scrollBottom), true;
      }
      eraseChars(e) {
        this._restrictCursor();
        let i = this._activeBuffer.lines.get(this._activeBuffer.ybase + this._activeBuffer.y);
        return i && (i.replaceCells(this._activeBuffer.x, this._activeBuffer.x + (e.params[0] || 1), this._activeBuffer.getNullCell(this._eraseAttrData())), this._dirtyRowTracker.markDirty(this._activeBuffer.y)), true;
      }
      repeatPrecedingCharacter(e) {
        let i = this._parser.precedingJoinState;
        if (!i) return true;
        let r = e.params[0] || 1, n = Ae.extractWidth(i), o = this._activeBuffer.x - n, a = this._activeBuffer.lines.get(this._activeBuffer.ybase + this._activeBuffer.y).getString(o), u = new Uint32Array(a.length * r), h8 = 0;
        for (let d = 0; d < a.length; ) {
          let _ = a.codePointAt(d) || 0;
          u[h8++] = _, d += _ > 65535 ? 2 : 1;
        }
        let c = h8;
        for (let d = 1; d < r; ++d) u.copyWithin(c, 0, h8), c += h8;
        return this.print(u, 0, c), true;
      }
      sendDeviceAttributesPrimary(e) {
        return e.params[0] > 0 || (this._is("xterm") || this._is("rxvt-unicode") || this._is("screen") ? this._coreService.triggerDataEvent(b.ESC + "[?1;2c") : this._is("linux") && this._coreService.triggerDataEvent(b.ESC + "[?6c")), true;
      }
      sendDeviceAttributesSecondary(e) {
        return e.params[0] > 0 || (this._is("xterm") ? this._coreService.triggerDataEvent(b.ESC + "[>0;276;0c") : this._is("rxvt-unicode") ? this._coreService.triggerDataEvent(b.ESC + "[>85;95;0c") : this._is("linux") ? this._coreService.triggerDataEvent(e.params[0] + "c") : this._is("screen") && this._coreService.triggerDataEvent(b.ESC + "[>83;40003;0c")), true;
      }
      _is(e) {
        return (this._optionsService.rawOptions.termName + "").indexOf(e) === 0;
      }
      setMode(e) {
        for (let i = 0; i < e.length; i++) switch (e.params[i]) {
          case 4:
            this._coreService.modes.insertMode = true;
            break;
          case 20:
            this._optionsService.options.convertEol = true;
            break;
        }
        return true;
      }
      setModePrivate(e) {
        for (let i = 0; i < e.length; i++) switch (e.params[i]) {
          case 1:
            this._coreService.decPrivateModes.applicationCursorKeys = true;
            break;
          case 2:
            this._charsetService.setgCharset(0, Je), this._charsetService.setgCharset(1, Je), this._charsetService.setgCharset(2, Je), this._charsetService.setgCharset(3, Je);
            break;
          case 3:
            this._optionsService.rawOptions.windowOptions.setWinLines && (this._bufferService.resize(132, this._bufferService.rows), this._onRequestReset.fire());
            break;
          case 6:
            this._coreService.decPrivateModes.origin = true, this._setCursor(0, 0);
            break;
          case 7:
            this._coreService.decPrivateModes.wraparound = true;
            break;
          case 12:
            this._optionsService.options.cursorBlink = true;
            break;
          case 45:
            this._coreService.decPrivateModes.reverseWraparound = true;
            break;
          case 66:
            this._logService.debug("Serial port requested application keypad."), this._coreService.decPrivateModes.applicationKeypad = true, this._onRequestSyncScrollBar.fire();
            break;
          case 9:
            this._coreMouseService.activeProtocol = "X10";
            break;
          case 1e3:
            this._coreMouseService.activeProtocol = "VT200";
            break;
          case 1002:
            this._coreMouseService.activeProtocol = "DRAG";
            break;
          case 1003:
            this._coreMouseService.activeProtocol = "ANY";
            break;
          case 1004:
            this._coreService.decPrivateModes.sendFocus = true, this._onRequestSendFocus.fire();
            break;
          case 1005:
            this._logService.debug("DECSET 1005 not supported (see #2507)");
            break;
          case 1006:
            this._coreMouseService.activeEncoding = "SGR";
            break;
          case 1015:
            this._logService.debug("DECSET 1015 not supported (see #2507)");
            break;
          case 1016:
            this._coreMouseService.activeEncoding = "SGR_PIXELS";
            break;
          case 25:
            this._coreService.isCursorHidden = false;
            break;
          case 1048:
            this.saveCursor();
            break;
          case 1049:
            this.saveCursor();
          case 47:
          case 1047:
            this._bufferService.buffers.activateAltBuffer(this._eraseAttrData()), this._coreService.isCursorInitialized = true, this._onRequestRefreshRows.fire(void 0), this._onRequestSyncScrollBar.fire();
            break;
          case 2004:
            this._coreService.decPrivateModes.bracketedPasteMode = true;
            break;
          case 2026:
            this._coreService.decPrivateModes.synchronizedOutput = true;
            break;
        }
        return true;
      }
      resetMode(e) {
        for (let i = 0; i < e.length; i++) switch (e.params[i]) {
          case 4:
            this._coreService.modes.insertMode = false;
            break;
          case 20:
            this._optionsService.options.convertEol = false;
            break;
        }
        return true;
      }
      resetModePrivate(e) {
        for (let i = 0; i < e.length; i++) switch (e.params[i]) {
          case 1:
            this._coreService.decPrivateModes.applicationCursorKeys = false;
            break;
          case 3:
            this._optionsService.rawOptions.windowOptions.setWinLines && (this._bufferService.resize(80, this._bufferService.rows), this._onRequestReset.fire());
            break;
          case 6:
            this._coreService.decPrivateModes.origin = false, this._setCursor(0, 0);
            break;
          case 7:
            this._coreService.decPrivateModes.wraparound = false;
            break;
          case 12:
            this._optionsService.options.cursorBlink = false;
            break;
          case 45:
            this._coreService.decPrivateModes.reverseWraparound = false;
            break;
          case 66:
            this._logService.debug("Switching back to normal keypad."), this._coreService.decPrivateModes.applicationKeypad = false, this._onRequestSyncScrollBar.fire();
            break;
          case 9:
          case 1e3:
          case 1002:
          case 1003:
            this._coreMouseService.activeProtocol = "NONE";
            break;
          case 1004:
            this._coreService.decPrivateModes.sendFocus = false;
            break;
          case 1005:
            this._logService.debug("DECRST 1005 not supported (see #2507)");
            break;
          case 1006:
            this._coreMouseService.activeEncoding = "DEFAULT";
            break;
          case 1015:
            this._logService.debug("DECRST 1015 not supported (see #2507)");
            break;
          case 1016:
            this._coreMouseService.activeEncoding = "DEFAULT";
            break;
          case 25:
            this._coreService.isCursorHidden = true;
            break;
          case 1048:
            this.restoreCursor();
            break;
          case 1049:
          case 47:
          case 1047:
            this._bufferService.buffers.activateNormalBuffer(), e.params[i] === 1049 && this.restoreCursor(), this._coreService.isCursorInitialized = true, this._onRequestRefreshRows.fire(void 0), this._onRequestSyncScrollBar.fire();
            break;
          case 2004:
            this._coreService.decPrivateModes.bracketedPasteMode = false;
            break;
          case 2026:
            this._coreService.decPrivateModes.synchronizedOutput = false, this._onRequestRefreshRows.fire(void 0);
            break;
        }
        return true;
      }
      requestMode(e, i) {
        let r;
        ((P) => (P[P.NOT_RECOGNIZED = 0] = "NOT_RECOGNIZED", P[P.SET = 1] = "SET", P[P.RESET = 2] = "RESET", P[P.PERMANENTLY_SET = 3] = "PERMANENTLY_SET", P[P.PERMANENTLY_RESET = 4] = "PERMANENTLY_RESET"))(r ||= {});
        let n = this._coreService.decPrivateModes, { activeProtocol: o, activeEncoding: l } = this._coreMouseService, a = this._coreService, { buffers: u, cols: h8 } = this._bufferService, { active: c, alt: d } = u, _ = this._optionsService.rawOptions, p = (A, R) => (a.triggerDataEvent(`${b.ESC}[${i ? "" : "?"}${A};${R}$y`), true), m = (A) => A ? 1 : 2, f = e.params[0];
        return i ? f === 2 ? p(f, 4) : f === 4 ? p(f, m(a.modes.insertMode)) : f === 12 ? p(f, 3) : f === 20 ? p(f, m(_.convertEol)) : p(f, 0) : f === 1 ? p(f, m(n.applicationCursorKeys)) : f === 3 ? p(f, _.windowOptions.setWinLines ? h8 === 80 ? 2 : h8 === 132 ? 1 : 0 : 0) : f === 6 ? p(f, m(n.origin)) : f === 7 ? p(f, m(n.wraparound)) : f === 8 ? p(f, 3) : f === 9 ? p(f, m(o === "X10")) : f === 12 ? p(f, m(_.cursorBlink)) : f === 25 ? p(f, m(!a.isCursorHidden)) : f === 45 ? p(f, m(n.reverseWraparound)) : f === 66 ? p(f, m(n.applicationKeypad)) : f === 67 ? p(f, 4) : f === 1e3 ? p(f, m(o === "VT200")) : f === 1002 ? p(f, m(o === "DRAG")) : f === 1003 ? p(f, m(o === "ANY")) : f === 1004 ? p(f, m(n.sendFocus)) : f === 1005 ? p(f, 4) : f === 1006 ? p(f, m(l === "SGR")) : f === 1015 ? p(f, 4) : f === 1016 ? p(f, m(l === "SGR_PIXELS")) : f === 1048 ? p(f, 1) : f === 47 || f === 1047 || f === 1049 ? p(f, m(c === d)) : f === 2004 ? p(f, m(n.bracketedPasteMode)) : f === 2026 ? p(f, m(n.synchronizedOutput)) : p(f, 0);
      }
      _updateAttrColor(e, i, r, n, o) {
        return i === 2 ? (e |= 50331648, e &= -16777216, e |= De.fromColorRGB([r, n, o])) : i === 5 && (e &= -50331904, e |= 33554432 | r & 255), e;
      }
      _extractColor(e, i, r) {
        let n = [0, 0, -1, 0, 0, 0], o = 0, l = 0;
        do {
          if (n[l + o] = e.params[i + l], e.hasSubParams(i + l)) {
            let a = e.getSubParams(i + l), u = 0;
            do
              n[1] === 5 && (o = 1), n[l + u + 1 + o] = a[u];
            while (++u < a.length && u + l + 1 + o < n.length);
            break;
          }
          if (n[1] === 5 && l + o >= 2 || n[1] === 2 && l + o >= 5) break;
          n[1] && (o = 1);
        } while (++l + i < e.length && l + o < n.length);
        for (let a = 2; a < n.length; ++a) n[a] === -1 && (n[a] = 0);
        switch (n[0]) {
          case 38:
            r.fg = this._updateAttrColor(r.fg, n[1], n[3], n[4], n[5]);
            break;
          case 48:
            r.bg = this._updateAttrColor(r.bg, n[1], n[3], n[4], n[5]);
            break;
          case 58:
            r.extended = r.extended.clone(), r.extended.underlineColor = this._updateAttrColor(r.extended.underlineColor, n[1], n[3], n[4], n[5]);
        }
        return l;
      }
      _processUnderline(e, i) {
        i.extended = i.extended.clone(), (!~e || e > 5) && (e = 1), i.extended.underlineStyle = e, i.fg |= 268435456, e === 0 && (i.fg &= -268435457), i.updateExtended();
      }
      _processSGR0(e) {
        e.fg = X.fg, e.bg = X.bg, e.extended = e.extended.clone(), e.extended.underlineStyle = 0, e.extended.underlineColor &= -67108864, e.updateExtended();
      }
      charAttributes(e) {
        if (e.length === 1 && e.params[0] === 0) return this._processSGR0(this._curAttrData), true;
        let i = e.length, r, n = this._curAttrData;
        for (let o = 0; o < i; o++) r = e.params[o], r >= 30 && r <= 37 ? (n.fg &= -50331904, n.fg |= 16777216 | r - 30) : r >= 40 && r <= 47 ? (n.bg &= -50331904, n.bg |= 16777216 | r - 40) : r >= 90 && r <= 97 ? (n.fg &= -50331904, n.fg |= 16777216 | r - 90 | 8) : r >= 100 && r <= 107 ? (n.bg &= -50331904, n.bg |= 16777216 | r - 100 | 8) : r === 0 ? this._processSGR0(n) : r === 1 ? n.fg |= 134217728 : r === 3 ? n.bg |= 67108864 : r === 4 ? (n.fg |= 268435456, this._processUnderline(e.hasSubParams(o) ? e.getSubParams(o)[0] : 1, n)) : r === 5 ? n.fg |= 536870912 : r === 7 ? n.fg |= 67108864 : r === 8 ? n.fg |= 1073741824 : r === 9 ? n.fg |= 2147483648 : r === 2 ? n.bg |= 134217728 : r === 21 ? this._processUnderline(2, n) : r === 22 ? (n.fg &= -134217729, n.bg &= -134217729) : r === 23 ? n.bg &= -67108865 : r === 24 ? (n.fg &= -268435457, this._processUnderline(0, n)) : r === 25 ? n.fg &= -536870913 : r === 27 ? n.fg &= -67108865 : r === 28 ? n.fg &= -1073741825 : r === 29 ? n.fg &= 2147483647 : r === 39 ? (n.fg &= -67108864, n.fg |= X.fg & 16777215) : r === 49 ? (n.bg &= -67108864, n.bg |= X.bg & 16777215) : r === 38 || r === 48 || r === 58 ? o += this._extractColor(e, o, n) : r === 53 ? n.bg |= 1073741824 : r === 55 ? n.bg &= -1073741825 : r === 59 ? (n.extended = n.extended.clone(), n.extended.underlineColor = -1, n.updateExtended()) : r === 100 ? (n.fg &= -67108864, n.fg |= X.fg & 16777215, n.bg &= -67108864, n.bg |= X.bg & 16777215) : this._logService.debug("Unknown SGR attribute: %d.", r);
        return true;
      }
      deviceStatus(e) {
        switch (e.params[0]) {
          case 5:
            this._coreService.triggerDataEvent(`${b.ESC}[0n`);
            break;
          case 6:
            let i = this._activeBuffer.y + 1, r = this._activeBuffer.x + 1;
            this._coreService.triggerDataEvent(`${b.ESC}[${i};${r}R`);
            break;
        }
        return true;
      }
      deviceStatusPrivate(e) {
        switch (e.params[0]) {
          case 6:
            let i = this._activeBuffer.y + 1, r = this._activeBuffer.x + 1;
            this._coreService.triggerDataEvent(`${b.ESC}[?${i};${r}R`);
            break;
          case 15:
            break;
          case 25:
            break;
          case 26:
            break;
          case 53:
            break;
        }
        return true;
      }
      softReset(e) {
        return this._coreService.isCursorHidden = false, this._onRequestSyncScrollBar.fire(), this._activeBuffer.scrollTop = 0, this._activeBuffer.scrollBottom = this._bufferService.rows - 1, this._curAttrData = X.clone(), this._coreService.reset(), this._charsetService.reset(), this._activeBuffer.savedX = 0, this._activeBuffer.savedY = this._activeBuffer.ybase, this._activeBuffer.savedCurAttrData.fg = this._curAttrData.fg, this._activeBuffer.savedCurAttrData.bg = this._curAttrData.bg, this._activeBuffer.savedCharset = this._charsetService.charset, this._coreService.decPrivateModes.origin = false, true;
      }
      setCursorStyle(e) {
        let i = e.length === 0 ? 1 : e.params[0];
        if (i === 0) this._coreService.decPrivateModes.cursorStyle = void 0, this._coreService.decPrivateModes.cursorBlink = void 0;
        else {
          switch (i) {
            case 1:
            case 2:
              this._coreService.decPrivateModes.cursorStyle = "block";
              break;
            case 3:
            case 4:
              this._coreService.decPrivateModes.cursorStyle = "underline";
              break;
            case 5:
            case 6:
              this._coreService.decPrivateModes.cursorStyle = "bar";
              break;
          }
          let r = i % 2 === 1;
          this._coreService.decPrivateModes.cursorBlink = r;
        }
        return true;
      }
      setScrollRegion(e) {
        let i = e.params[0] || 1, r;
        return (e.length < 2 || (r = e.params[1]) > this._bufferService.rows || r === 0) && (r = this._bufferService.rows), r > i && (this._activeBuffer.scrollTop = i - 1, this._activeBuffer.scrollBottom = r - 1, this._setCursor(0, 0)), true;
      }
      windowOptions(e) {
        if (!bl(e.params[0], this._optionsService.rawOptions.windowOptions)) return true;
        let i = e.length > 1 ? e.params[1] : 0;
        switch (e.params[0]) {
          case 14:
            i !== 2 && this._onRequestWindowsOptionsReport.fire(0);
            break;
          case 16:
            this._onRequestWindowsOptionsReport.fire(1);
            break;
          case 18:
            this._bufferService && this._coreService.triggerDataEvent(`${b.ESC}[8;${this._bufferService.rows};${this._bufferService.cols}t`);
            break;
          case 22:
            (i === 0 || i === 2) && (this._windowTitleStack.push(this._windowTitle), this._windowTitleStack.length > _l && this._windowTitleStack.shift()), (i === 0 || i === 1) && (this._iconNameStack.push(this._iconName), this._iconNameStack.length > _l && this._iconNameStack.shift());
            break;
          case 23:
            (i === 0 || i === 2) && this._windowTitleStack.length && this.setTitle(this._windowTitleStack.pop()), (i === 0 || i === 1) && this._iconNameStack.length && this.setIconName(this._iconNameStack.pop());
            break;
        }
        return true;
      }
      saveCursor(e) {
        return this._activeBuffer.savedX = this._activeBuffer.x, this._activeBuffer.savedY = this._activeBuffer.ybase + this._activeBuffer.y, this._activeBuffer.savedCurAttrData.fg = this._curAttrData.fg, this._activeBuffer.savedCurAttrData.bg = this._curAttrData.bg, this._activeBuffer.savedCharset = this._charsetService.charset, true;
      }
      restoreCursor(e) {
        return this._activeBuffer.x = this._activeBuffer.savedX || 0, this._activeBuffer.y = Math.max(this._activeBuffer.savedY - this._activeBuffer.ybase, 0), this._curAttrData.fg = this._activeBuffer.savedCurAttrData.fg, this._curAttrData.bg = this._activeBuffer.savedCurAttrData.bg, this._charsetService.charset = this._savedCharset, this._activeBuffer.savedCharset && (this._charsetService.charset = this._activeBuffer.savedCharset), this._restrictCursor(), true;
      }
      setTitle(e) {
        return this._windowTitle = e, this._onTitleChange.fire(e), true;
      }
      setIconName(e) {
        return this._iconName = e, true;
      }
      setOrReportIndexedColor(e) {
        let i = [], r = e.split(";");
        for (; r.length > 1; ) {
          let n = r.shift(), o = r.shift();
          if (/^\d+$/.exec(n)) {
            let l = parseInt(n);
            if (Sl(l)) if (o === "?") i.push({ type: 0, index: l });
            else {
              let a = Ws(o);
              a && i.push({ type: 1, index: l, color: a });
            }
          }
        }
        return i.length && this._onColor.fire(i), true;
      }
      setHyperlink(e) {
        let i = e.indexOf(";");
        if (i === -1) return true;
        let r = e.slice(0, i).trim(), n = e.slice(i + 1);
        return n ? this._createHyperlink(r, n) : r.trim() ? false : this._finishHyperlink();
      }
      _createHyperlink(e, i) {
        this._getCurrentLinkId() && this._finishHyperlink();
        let r = e.split(":"), n, o = r.findIndex((l) => l.startsWith("id="));
        return o !== -1 && (n = r[o].slice(3) || void 0), this._curAttrData.extended = this._curAttrData.extended.clone(), this._curAttrData.extended.urlId = this._oscLinkService.registerLink({ id: n, uri: i }), this._curAttrData.updateExtended(), true;
      }
      _finishHyperlink() {
        return this._curAttrData.extended = this._curAttrData.extended.clone(), this._curAttrData.extended.urlId = 0, this._curAttrData.updateExtended(), true;
      }
      _setOrReportSpecialColor(e, i) {
        let r = e.split(";");
        for (let n = 0; n < r.length && !(i >= this._specialColors.length); ++n, ++i) if (r[n] === "?") this._onColor.fire([{ type: 0, index: this._specialColors[i] }]);
        else {
          let o = Ws(r[n]);
          o && this._onColor.fire([{ type: 1, index: this._specialColors[i], color: o }]);
        }
        return true;
      }
      setOrReportFgColor(e) {
        return this._setOrReportSpecialColor(e, 0);
      }
      setOrReportBgColor(e) {
        return this._setOrReportSpecialColor(e, 1);
      }
      setOrReportCursorColor(e) {
        return this._setOrReportSpecialColor(e, 2);
      }
      restoreIndexedColor(e) {
        if (!e) return this._onColor.fire([{ type: 2 }]), true;
        let i = [], r = e.split(";");
        for (let n = 0; n < r.length; ++n) if (/^\d+$/.exec(r[n])) {
          let o = parseInt(r[n]);
          Sl(o) && i.push({ type: 2, index: o });
        }
        return i.length && this._onColor.fire(i), true;
      }
      restoreFgColor(e) {
        return this._onColor.fire([{ type: 2, index: 256 }]), true;
      }
      restoreBgColor(e) {
        return this._onColor.fire([{ type: 2, index: 257 }]), true;
      }
      restoreCursorColor(e) {
        return this._onColor.fire([{ type: 2, index: 258 }]), true;
      }
      nextLine() {
        return this._activeBuffer.x = 0, this.index(), true;
      }
      keypadApplicationMode() {
        return this._logService.debug("Serial port requested application keypad."), this._coreService.decPrivateModes.applicationKeypad = true, this._onRequestSyncScrollBar.fire(), true;
      }
      keypadNumericMode() {
        return this._logService.debug("Switching back to normal keypad."), this._coreService.decPrivateModes.applicationKeypad = false, this._onRequestSyncScrollBar.fire(), true;
      }
      selectDefaultCharset() {
        return this._charsetService.setgLevel(0), this._charsetService.setgCharset(0, Je), true;
      }
      selectCharset(e) {
        return e.length !== 2 ? (this.selectDefaultCharset(), true) : (e[0] === "/" || this._charsetService.setgCharset(mc[e[0]], ne[e[1]] || Je), true);
      }
      index() {
        return this._restrictCursor(), this._activeBuffer.y++, this._activeBuffer.y === this._activeBuffer.scrollBottom + 1 ? (this._activeBuffer.y--, this._bufferService.scroll(this._eraseAttrData())) : this._activeBuffer.y >= this._bufferService.rows && (this._activeBuffer.y = this._bufferService.rows - 1), this._restrictCursor(), true;
      }
      tabSet() {
        return this._activeBuffer.tabs[this._activeBuffer.x] = true, true;
      }
      reverseIndex() {
        if (this._restrictCursor(), this._activeBuffer.y === this._activeBuffer.scrollTop) {
          let e = this._activeBuffer.scrollBottom - this._activeBuffer.scrollTop;
          this._activeBuffer.lines.shiftElements(this._activeBuffer.ybase + this._activeBuffer.y, e, 1), this._activeBuffer.lines.set(this._activeBuffer.ybase + this._activeBuffer.y, this._activeBuffer.getBlankLine(this._eraseAttrData())), this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop, this._activeBuffer.scrollBottom);
        } else this._activeBuffer.y--, this._restrictCursor();
        return true;
      }
      fullReset() {
        return this._parser.reset(), this._onRequestReset.fire(), true;
      }
      reset() {
        this._curAttrData = X.clone(), this._eraseAttrDataInternal = X.clone();
      }
      _eraseAttrData() {
        return this._eraseAttrDataInternal.bg &= -67108864, this._eraseAttrDataInternal.bg |= this._curAttrData.bg & 67108863, this._eraseAttrDataInternal;
      }
      setgLevel(e) {
        return this._charsetService.setgLevel(e), true;
      }
      screenAlignmentPattern() {
        let e = new q();
        e.content = 1 << 22 | 69, e.fg = this._curAttrData.fg, e.bg = this._curAttrData.bg, this._setCursor(0, 0);
        for (let i = 0; i < this._bufferService.rows; ++i) {
          let r = this._activeBuffer.ybase + this._activeBuffer.y + i, n = this._activeBuffer.lines.get(r);
          n && (n.fill(e), n.isWrapped = false);
        }
        return this._dirtyRowTracker.markAllDirty(), this._setCursor(0, 0), true;
      }
      requestStatusString(e, i) {
        let r = (a) => (this._coreService.triggerDataEvent(`${b.ESC}${a}${b.ESC}\\`), true), n = this._bufferService.buffer, o = this._optionsService.rawOptions, l = { block: 2, underline: 4, bar: 6 };
        return r(e === '"q' ? `P1$r${this._curAttrData.isProtected() ? 1 : 0}"q` : e === '"p' ? 'P1$r61;1"p' : e === "r" ? `P1$r${n.scrollTop + 1};${n.scrollBottom + 1}r` : e === "m" ? "P1$r0m" : e === " q" ? `P1$r${l[o.cursorStyle] - (o.cursorBlink ? 1 : 0)} q` : "P0$r");
      }
      markRangeDirty(e, i) {
        this._dirtyRowTracker.markRangeDirty(e, i);
      }
    }, Zi = class {
      constructor(t) {
        this._bufferService = t;
        this.clearRange();
      }
      clearRange() {
        this.start = this._bufferService.buffer.y, this.end = this._bufferService.buffer.y;
      }
      markDirty(t) {
        t < this.start ? this.start = t : t > this.end && (this.end = t);
      }
      markRangeDirty(t, e) {
        t > e && (gl = t, t = e, e = gl), t < this.start && (this.start = t), e > this.end && (this.end = e);
      }
      markAllDirty() {
        this.markRangeDirty(0, this._bufferService.rows - 1);
      }
    };
    Zi = M([S(0, F)], Zi);
    _c = 5e7, El = 12, bc = 50, gn = class extends D {
      constructor(e) {
        super();
        this._action = e;
        this._writeBuffer = [];
        this._callbacks = [];
        this._pendingData = 0;
        this._bufferOffset = 0;
        this._isSyncWriting = false;
        this._syncCalls = 0;
        this._didUserInput = false;
        this._onWriteParsed = this._register(new v());
        this.onWriteParsed = this._onWriteParsed.event;
      }
      handleUserInput() {
        this._didUserInput = true;
      }
      writeSync(e, i) {
        if (i !== void 0 && this._syncCalls > i) {
          this._syncCalls = 0;
          return;
        }
        if (this._pendingData += e.length, this._writeBuffer.push(e), this._callbacks.push(void 0), this._syncCalls++, this._isSyncWriting) return;
        this._isSyncWriting = true;
        let r;
        for (; r = this._writeBuffer.shift(); ) {
          this._action(r);
          let n = this._callbacks.shift();
          n && n();
        }
        this._pendingData = 0, this._bufferOffset = 2147483647, this._isSyncWriting = false, this._syncCalls = 0;
      }
      write(e, i) {
        if (this._pendingData > _c) throw new Error("write data discarded, use flow control to avoid losing data");
        if (!this._writeBuffer.length) {
          if (this._bufferOffset = 0, this._didUserInput) {
            this._didUserInput = false, this._pendingData += e.length, this._writeBuffer.push(e), this._callbacks.push(i), this._innerWrite();
            return;
          }
          setTimeout(() => this._innerWrite());
        }
        this._pendingData += e.length, this._writeBuffer.push(e), this._callbacks.push(i);
      }
      _innerWrite(e = 0, i = true) {
        let r = e || performance.now();
        for (; this._writeBuffer.length > this._bufferOffset; ) {
          let n = this._writeBuffer[this._bufferOffset], o = this._action(n, i);
          if (o) {
            let a = (u) => performance.now() - r >= El ? setTimeout(() => this._innerWrite(0, u)) : this._innerWrite(r, u);
            o.catch((u) => (queueMicrotask(() => {
              throw u;
            }), Promise.resolve(false))).then(a);
            return;
          }
          let l = this._callbacks[this._bufferOffset];
          if (l && l(), this._bufferOffset++, this._pendingData -= n.length, performance.now() - r >= El) break;
        }
        this._writeBuffer.length > this._bufferOffset ? (this._bufferOffset > bc && (this._writeBuffer = this._writeBuffer.slice(this._bufferOffset), this._callbacks = this._callbacks.slice(this._bufferOffset), this._bufferOffset = 0), setTimeout(() => this._innerWrite())) : (this._writeBuffer.length = 0, this._callbacks.length = 0, this._pendingData = 0, this._bufferOffset = 0), this._onWriteParsed.fire();
      }
    };
    ui = class {
      constructor(t) {
        this._bufferService = t;
        this._nextId = 1;
        this._entriesWithId = /* @__PURE__ */ new Map();
        this._dataByLinkId = /* @__PURE__ */ new Map();
      }
      registerLink(t) {
        let e = this._bufferService.buffer;
        if (t.id === void 0) {
          let a = e.addMarker(e.ybase + e.y), u = { data: t, id: this._nextId++, lines: [a] };
          return a.onDispose(() => this._removeMarkerFromLink(u, a)), this._dataByLinkId.set(u.id, u), u.id;
        }
        let i = t, r = this._getEntryIdKey(i), n = this._entriesWithId.get(r);
        if (n) return this.addLineToLink(n.id, e.ybase + e.y), n.id;
        let o = e.addMarker(e.ybase + e.y), l = { id: this._nextId++, key: this._getEntryIdKey(i), data: i, lines: [o] };
        return o.onDispose(() => this._removeMarkerFromLink(l, o)), this._entriesWithId.set(l.key, l), this._dataByLinkId.set(l.id, l), l.id;
      }
      addLineToLink(t, e) {
        let i = this._dataByLinkId.get(t);
        if (i && i.lines.every((r) => r.line !== e)) {
          let r = this._bufferService.buffer.addMarker(e);
          i.lines.push(r), r.onDispose(() => this._removeMarkerFromLink(i, r));
        }
      }
      getLinkData(t) {
        return this._dataByLinkId.get(t)?.data;
      }
      _getEntryIdKey(t) {
        return `${t.id};;${t.uri}`;
      }
      _removeMarkerFromLink(t, e) {
        let i = t.lines.indexOf(e);
        i !== -1 && (t.lines.splice(i, 1), t.lines.length === 0 && (t.data.id !== void 0 && this._entriesWithId.delete(t.key), this._dataByLinkId.delete(t.id)));
      }
    };
    ui = M([S(0, F)], ui);
    Tl = false, Sn = class extends D {
      constructor(e) {
        super();
        this._windowsWrappingHeuristics = this._register(new ye());
        this._onBinary = this._register(new v());
        this.onBinary = this._onBinary.event;
        this._onData = this._register(new v());
        this.onData = this._onData.event;
        this._onLineFeed = this._register(new v());
        this.onLineFeed = this._onLineFeed.event;
        this._onResize = this._register(new v());
        this.onResize = this._onResize.event;
        this._onWriteParsed = this._register(new v());
        this.onWriteParsed = this._onWriteParsed.event;
        this._onScroll = this._register(new v());
        this._instantiationService = new ln(), this.optionsService = this._register(new dn(e)), this._instantiationService.setService(H, this.optionsService), this._bufferService = this._register(this._instantiationService.createInstance(ni)), this._instantiationService.setService(F, this._bufferService), this._logService = this._register(this._instantiationService.createInstance(ii)), this._instantiationService.setService(nr, this._logService), this.coreService = this._register(this._instantiationService.createInstance(li)), this._instantiationService.setService(ge, this.coreService), this.coreMouseService = this._register(this._instantiationService.createInstance(ai)), this._instantiationService.setService(rr, this.coreMouseService), this.unicodeService = this._register(this._instantiationService.createInstance(Ae)), this._instantiationService.setService(Js, this.unicodeService), this._charsetService = this._instantiationService.createInstance(pn), this._instantiationService.setService(Zs, this._charsetService), this._oscLinkService = this._instantiationService.createInstance(ui), this._instantiationService.setService(sr, this._oscLinkService), this._inputHandler = this._register(new vn(this._bufferService, this._charsetService, this.coreService, this._logService, this.optionsService, this._oscLinkService, this.coreMouseService, this.unicodeService)), this._register($.forward(this._inputHandler.onLineFeed, this._onLineFeed)), this._register(this._inputHandler), this._register($.forward(this._bufferService.onResize, this._onResize)), this._register($.forward(this.coreService.onData, this._onData)), this._register($.forward(this.coreService.onBinary, this._onBinary)), this._register(this.coreService.onRequestScrollToBottom(() => this.scrollToBottom(true))), this._register(this.coreService.onUserInput(() => this._writeBuffer.handleUserInput())), this._register(this.optionsService.onMultipleOptionChange(["windowsMode", "windowsPty"], () => this._handleWindowsPtyOptionChange())), this._register(this._bufferService.onScroll(() => {
          this._onScroll.fire({ position: this._bufferService.buffer.ydisp }), this._inputHandler.markRangeDirty(this._bufferService.buffer.scrollTop, this._bufferService.buffer.scrollBottom);
        })), this._writeBuffer = this._register(new gn((i, r) => this._inputHandler.parse(i, r))), this._register($.forward(this._writeBuffer.onWriteParsed, this._onWriteParsed));
      }
      get onScroll() {
        return this._onScrollApi || (this._onScrollApi = this._register(new v()), this._onScroll.event((e) => {
          this._onScrollApi?.fire(e.position);
        })), this._onScrollApi.event;
      }
      get cols() {
        return this._bufferService.cols;
      }
      get rows() {
        return this._bufferService.rows;
      }
      get buffers() {
        return this._bufferService.buffers;
      }
      get options() {
        return this.optionsService.options;
      }
      set options(e) {
        for (let i in e) this.optionsService.options[i] = e[i];
      }
      write(e, i) {
        this._writeBuffer.write(e, i);
      }
      writeSync(e, i) {
        this._logService.logLevel <= 3 && !Tl && (this._logService.warn("writeSync is unreliable and will be removed soon."), Tl = true), this._writeBuffer.writeSync(e, i);
      }
      input(e, i = true) {
        this.coreService.triggerDataEvent(e, i);
      }
      resize(e, i) {
        isNaN(e) || isNaN(i) || (e = Math.max(e, ks), i = Math.max(i, Cs), this._bufferService.resize(e, i));
      }
      scroll(e, i = false) {
        this._bufferService.scroll(e, i);
      }
      scrollLines(e, i) {
        this._bufferService.scrollLines(e, i);
      }
      scrollPages(e) {
        this.scrollLines(e * (this.rows - 1));
      }
      scrollToTop() {
        this.scrollLines(-this._bufferService.buffer.ydisp);
      }
      scrollToBottom(e) {
        this.scrollLines(this._bufferService.buffer.ybase - this._bufferService.buffer.ydisp);
      }
      scrollToLine(e) {
        let i = e - this._bufferService.buffer.ydisp;
        i !== 0 && this.scrollLines(i);
      }
      registerEscHandler(e, i) {
        return this._inputHandler.registerEscHandler(e, i);
      }
      registerDcsHandler(e, i) {
        return this._inputHandler.registerDcsHandler(e, i);
      }
      registerCsiHandler(e, i) {
        return this._inputHandler.registerCsiHandler(e, i);
      }
      registerOscHandler(e, i) {
        return this._inputHandler.registerOscHandler(e, i);
      }
      _setup() {
        this._handleWindowsPtyOptionChange();
      }
      reset() {
        this._inputHandler.reset(), this._bufferService.reset(), this._charsetService.reset(), this.coreService.reset(), this.coreMouseService.reset();
      }
      _handleWindowsPtyOptionChange() {
        let e = false, i = this.optionsService.rawOptions.windowsPty;
        i && i.buildNumber !== void 0 && i.buildNumber !== void 0 ? e = i.backend === "conpty" && i.buildNumber < 21376 : this.optionsService.rawOptions.windowsMode && (e = true), e ? this._enableWindowsWrappingHeuristics() : this._windowsWrappingHeuristics.clear();
      }
      _enableWindowsWrappingHeuristics() {
        if (!this._windowsWrappingHeuristics.value) {
          let e = [];
          e.push(this.onLineFeed(Bs.bind(null, this._bufferService))), e.push(this.registerCsiHandler({ final: "H" }, () => (Bs(this._bufferService), false))), this._windowsWrappingHeuristics.value = C(() => {
            for (let i of e) i.dispose();
          });
        }
      }
    };
    gc = { 48: ["0", ")"], 49: ["1", "!"], 50: ["2", "@"], 51: ["3", "#"], 52: ["4", "$"], 53: ["5", "%"], 54: ["6", "^"], 55: ["7", "&"], 56: ["8", "*"], 57: ["9", "("], 186: [";", ":"], 187: ["=", "+"], 188: [",", "<"], 189: ["-", "_"], 190: [".", ">"], 191: ["/", "?"], 192: ["`", "~"], 219: ["[", "{"], 220: ["\\", "|"], 221: ["]", "}"], 222: ["'", '"'] };
    ee = 0, En = class {
      constructor(t) {
        this._getKey = t;
        this._array = [];
        this._insertedValues = [];
        this._flushInsertedTask = new Jt();
        this._isFlushingInserted = false;
        this._deletedIndices = [];
        this._flushDeletedTask = new Jt();
        this._isFlushingDeleted = false;
      }
      clear() {
        this._array.length = 0, this._insertedValues.length = 0, this._flushInsertedTask.clear(), this._isFlushingInserted = false, this._deletedIndices.length = 0, this._flushDeletedTask.clear(), this._isFlushingDeleted = false;
      }
      insert(t) {
        this._flushCleanupDeleted(), this._insertedValues.length === 0 && this._flushInsertedTask.enqueue(() => this._flushInserted()), this._insertedValues.push(t);
      }
      _flushInserted() {
        let t = this._insertedValues.sort((n, o) => this._getKey(n) - this._getKey(o)), e = 0, i = 0, r = new Array(this._array.length + this._insertedValues.length);
        for (let n = 0; n < r.length; n++) i >= this._array.length || this._getKey(t[e]) <= this._getKey(this._array[i]) ? (r[n] = t[e], e++) : r[n] = this._array[i++];
        this._array = r, this._insertedValues.length = 0;
      }
      _flushCleanupInserted() {
        !this._isFlushingInserted && this._insertedValues.length > 0 && this._flushInsertedTask.flush();
      }
      delete(t) {
        if (this._flushCleanupInserted(), this._array.length === 0) return false;
        let e = this._getKey(t);
        if (e === void 0 || (ee = this._search(e), ee === -1) || this._getKey(this._array[ee]) !== e) return false;
        do
          if (this._array[ee] === t) return this._deletedIndices.length === 0 && this._flushDeletedTask.enqueue(() => this._flushDeleted()), this._deletedIndices.push(ee), true;
        while (++ee < this._array.length && this._getKey(this._array[ee]) === e);
        return false;
      }
      _flushDeleted() {
        this._isFlushingDeleted = true;
        let t = this._deletedIndices.sort((n, o) => n - o), e = 0, i = new Array(this._array.length - t.length), r = 0;
        for (let n = 0; n < this._array.length; n++) t[e] === n ? e++ : i[r++] = this._array[n];
        this._array = i, this._deletedIndices.length = 0, this._isFlushingDeleted = false;
      }
      _flushCleanupDeleted() {
        !this._isFlushingDeleted && this._deletedIndices.length > 0 && this._flushDeletedTask.flush();
      }
      *getKeyIterator(t) {
        if (this._flushCleanupInserted(), this._flushCleanupDeleted(), this._array.length !== 0 && (ee = this._search(t), !(ee < 0 || ee >= this._array.length) && this._getKey(this._array[ee]) === t)) do
          yield this._array[ee];
        while (++ee < this._array.length && this._getKey(this._array[ee]) === t);
      }
      forEachByKey(t, e) {
        if (this._flushCleanupInserted(), this._flushCleanupDeleted(), this._array.length !== 0 && (ee = this._search(t), !(ee < 0 || ee >= this._array.length) && this._getKey(this._array[ee]) === t)) do
          e(this._array[ee]);
        while (++ee < this._array.length && this._getKey(this._array[ee]) === t);
      }
      values() {
        return this._flushCleanupInserted(), this._flushCleanupDeleted(), [...this._array].values();
      }
      _search(t) {
        let e = 0, i = this._array.length - 1;
        for (; i >= e; ) {
          let r = e + i >> 1, n = this._getKey(this._array[r]);
          if (n > t) i = r - 1;
          else if (n < t) e = r + 1;
          else {
            for (; r > 0 && this._getKey(this._array[r - 1]) === t; ) r--;
            return r;
          }
        }
        return e;
      }
    };
    Us = 0, yl = 0, Tn = class extends D {
      constructor() {
        super();
        this._decorations = new En((e) => e?.marker.line);
        this._onDecorationRegistered = this._register(new v());
        this.onDecorationRegistered = this._onDecorationRegistered.event;
        this._onDecorationRemoved = this._register(new v());
        this.onDecorationRemoved = this._onDecorationRemoved.event;
        this._register(C(() => this.reset()));
      }
      get decorations() {
        return this._decorations.values();
      }
      registerDecoration(e) {
        if (e.marker.isDisposed) return;
        let i = new Ks(e);
        if (i) {
          let r = i.marker.onDispose(() => i.dispose()), n = i.onDispose(() => {
            n.dispose(), i && (this._decorations.delete(i) && this._onDecorationRemoved.fire(i), r.dispose());
          });
          this._decorations.insert(i), this._onDecorationRegistered.fire(i);
        }
        return i;
      }
      reset() {
        for (let e of this._decorations.values()) e.dispose();
        this._decorations.clear();
      }
      *getDecorationsAtCell(e, i, r) {
        let n = 0, o = 0;
        for (let l of this._decorations.getKeyIterator(i)) n = l.options.x ?? 0, o = n + (l.options.width ?? 1), e >= n && e < o && (!r || (l.options.layer ?? "bottom") === r) && (yield l);
      }
      forEachDecorationAtCell(e, i, r, n) {
        this._decorations.forEachByKey(i, (o) => {
          Us = o.options.x ?? 0, yl = Us + (o.options.width ?? 1), e >= Us && e < yl && (!r || (o.options.layer ?? "bottom") === r) && n(o);
        });
      }
    }, Ks = class extends Ee {
      constructor(e) {
        super();
        this.options = e;
        this.onRenderEmitter = this.add(new v());
        this.onRender = this.onRenderEmitter.event;
        this._onDispose = this.add(new v());
        this.onDispose = this._onDispose.event;
        this._cachedBg = null;
        this._cachedFg = null;
        this.marker = e.marker, this.options.overviewRulerOptions && !this.options.overviewRulerOptions.position && (this.options.overviewRulerOptions.position = "full");
      }
      get backgroundColorRGB() {
        return this._cachedBg === null && (this.options.backgroundColor ? this._cachedBg = z.toColor(this.options.backgroundColor) : this._cachedBg = void 0), this._cachedBg;
      }
      get foregroundColorRGB() {
        return this._cachedFg === null && (this.options.foregroundColor ? this._cachedFg = z.toColor(this.options.foregroundColor) : this._cachedFg = void 0), this._cachedFg;
      }
      dispose() {
        this._onDispose.fire(), super.dispose();
      }
    };
    Sc = 1e3, In = class {
      constructor(t, e = Sc) {
        this._renderCallback = t;
        this._debounceThresholdMS = e;
        this._lastRefreshMs = 0;
        this._additionalRefreshRequested = false;
      }
      dispose() {
        this._refreshTimeoutID && clearTimeout(this._refreshTimeoutID);
      }
      refresh(t, e, i) {
        this._rowCount = i, t = t !== void 0 ? t : 0, e = e !== void 0 ? e : this._rowCount - 1, this._rowStart = this._rowStart !== void 0 ? Math.min(this._rowStart, t) : t, this._rowEnd = this._rowEnd !== void 0 ? Math.max(this._rowEnd, e) : e;
        let r = performance.now();
        if (r - this._lastRefreshMs >= this._debounceThresholdMS) this._lastRefreshMs = r, this._innerRefresh();
        else if (!this._additionalRefreshRequested) {
          let n = r - this._lastRefreshMs, o = this._debounceThresholdMS - n;
          this._additionalRefreshRequested = true, this._refreshTimeoutID = window.setTimeout(() => {
            this._lastRefreshMs = performance.now(), this._innerRefresh(), this._additionalRefreshRequested = false, this._refreshTimeoutID = void 0;
          }, o);
        }
      }
      _innerRefresh() {
        if (this._rowStart === void 0 || this._rowEnd === void 0 || this._rowCount === void 0) return;
        let t = Math.max(this._rowStart, 0), e = Math.min(this._rowEnd, this._rowCount - 1);
        this._rowStart = void 0, this._rowEnd = void 0, this._renderCallback(t, e);
      }
    };
    xl = 20;
    wl = false, Tt = class extends D {
      constructor(e, i, r, n) {
        super();
        this._terminal = e;
        this._coreBrowserService = r;
        this._renderService = n;
        this._rowColumns = /* @__PURE__ */ new WeakMap();
        this._liveRegionLineCount = 0;
        this._charsToConsume = [];
        this._charsToAnnounce = "";
        let o = this._coreBrowserService.mainDocument;
        this._accessibilityContainer = o.createElement("div"), this._accessibilityContainer.classList.add("xterm-accessibility"), this._rowContainer = o.createElement("div"), this._rowContainer.setAttribute("role", "list"), this._rowContainer.classList.add("xterm-accessibility-tree"), this._rowElements = [];
        for (let l = 0; l < this._terminal.rows; l++) this._rowElements[l] = this._createAccessibilityTreeNode(), this._rowContainer.appendChild(this._rowElements[l]);
        if (this._topBoundaryFocusListener = (l) => this._handleBoundaryFocus(l, 0), this._bottomBoundaryFocusListener = (l) => this._handleBoundaryFocus(l, 1), this._rowElements[0].addEventListener("focus", this._topBoundaryFocusListener), this._rowElements[this._rowElements.length - 1].addEventListener("focus", this._bottomBoundaryFocusListener), this._accessibilityContainer.appendChild(this._rowContainer), this._liveRegion = o.createElement("div"), this._liveRegion.classList.add("live-region"), this._liveRegion.setAttribute("aria-live", "assertive"), this._accessibilityContainer.appendChild(this._liveRegion), this._liveRegionDebouncer = this._register(new In(this._renderRows.bind(this))), !this._terminal.element) throw new Error("Cannot enable accessibility before Terminal.open");
        wl ? (this._accessibilityContainer.classList.add("debug"), this._rowContainer.classList.add("debug"), this._debugRootContainer = o.createElement("div"), this._debugRootContainer.classList.add("xterm"), this._debugRootContainer.appendChild(o.createTextNode("------start a11y------")), this._debugRootContainer.appendChild(this._accessibilityContainer), this._debugRootContainer.appendChild(o.createTextNode("------end a11y------")), this._terminal.element.insertAdjacentElement("afterend", this._debugRootContainer)) : this._terminal.element.insertAdjacentElement("afterbegin", this._accessibilityContainer), this._register(this._terminal.onResize((l) => this._handleResize(l.rows))), this._register(this._terminal.onRender((l) => this._refreshRows(l.start, l.end))), this._register(this._terminal.onScroll(() => this._refreshRows())), this._register(this._terminal.onA11yChar((l) => this._handleChar(l))), this._register(this._terminal.onLineFeed(() => this._handleChar(`
`))), this._register(this._terminal.onA11yTab((l) => this._handleTab(l))), this._register(this._terminal.onKey((l) => this._handleKey(l.key))), this._register(this._terminal.onBlur(() => this._clearLiveRegion())), this._register(this._renderService.onDimensionsChange(() => this._refreshRowsDimensions())), this._register(L(o, "selectionchange", () => this._handleSelectionChange())), this._register(this._coreBrowserService.onDprChange(() => this._refreshRowsDimensions())), this._refreshRowsDimensions(), this._refreshRows(), this._register(C(() => {
          wl ? this._debugRootContainer.remove() : this._accessibilityContainer.remove(), this._rowElements.length = 0;
        }));
      }
      _handleTab(e) {
        for (let i = 0; i < e; i++) this._handleChar(" ");
      }
      _handleChar(e) {
        this._liveRegionLineCount < xl + 1 && (this._charsToConsume.length > 0 ? this._charsToConsume.shift() !== e && (this._charsToAnnounce += e) : this._charsToAnnounce += e, e === `
` && (this._liveRegionLineCount++, this._liveRegionLineCount === xl + 1 && (this._liveRegion.textContent += _i.get())));
      }
      _clearLiveRegion() {
        this._liveRegion.textContent = "", this._liveRegionLineCount = 0;
      }
      _handleKey(e) {
        this._clearLiveRegion(), /\p{Control}/u.test(e) || this._charsToConsume.push(e);
      }
      _refreshRows(e, i) {
        this._liveRegionDebouncer.refresh(e, i, this._terminal.rows);
      }
      _renderRows(e, i) {
        let r = this._terminal.buffer, n = r.lines.length.toString();
        for (let o = e; o <= i; o++) {
          let l = r.lines.get(r.ydisp + o), a = [], u = l?.translateToString(true, void 0, void 0, a) || "", h8 = (r.ydisp + o + 1).toString(), c = this._rowElements[o];
          c && (u.length === 0 ? (c.textContent = " ", this._rowColumns.set(c, [0, 1])) : (c.textContent = u, this._rowColumns.set(c, a)), c.setAttribute("aria-posinset", h8), c.setAttribute("aria-setsize", n), this._alignRowWidth(c));
        }
        this._announceCharacters();
      }
      _announceCharacters() {
        this._charsToAnnounce.length !== 0 && (this._liveRegion.textContent += this._charsToAnnounce, this._charsToAnnounce = "");
      }
      _handleBoundaryFocus(e, i) {
        let r = e.target, n = this._rowElements[i === 0 ? 1 : this._rowElements.length - 2], o = r.getAttribute("aria-posinset"), l = i === 0 ? "1" : `${this._terminal.buffer.lines.length}`;
        if (o === l || e.relatedTarget !== n) return;
        let a, u;
        if (i === 0 ? (a = r, u = this._rowElements.pop(), this._rowContainer.removeChild(u)) : (a = this._rowElements.shift(), u = r, this._rowContainer.removeChild(a)), a.removeEventListener("focus", this._topBoundaryFocusListener), u.removeEventListener("focus", this._bottomBoundaryFocusListener), i === 0) {
          let h8 = this._createAccessibilityTreeNode();
          this._rowElements.unshift(h8), this._rowContainer.insertAdjacentElement("afterbegin", h8);
        } else {
          let h8 = this._createAccessibilityTreeNode();
          this._rowElements.push(h8), this._rowContainer.appendChild(h8);
        }
        this._rowElements[0].addEventListener("focus", this._topBoundaryFocusListener), this._rowElements[this._rowElements.length - 1].addEventListener("focus", this._bottomBoundaryFocusListener), this._terminal.scrollLines(i === 0 ? -1 : 1), this._rowElements[i === 0 ? 1 : this._rowElements.length - 2].focus(), e.preventDefault(), e.stopImmediatePropagation();
      }
      _handleSelectionChange() {
        if (this._rowElements.length === 0) return;
        let e = this._coreBrowserService.mainDocument.getSelection();
        if (!e) return;
        if (e.isCollapsed) {
          this._rowContainer.contains(e.anchorNode) && this._terminal.clearSelection();
          return;
        }
        if (!e.anchorNode || !e.focusNode) {
          console.error("anchorNode and/or focusNode are null");
          return;
        }
        let i = { node: e.anchorNode, offset: e.anchorOffset }, r = { node: e.focusNode, offset: e.focusOffset };
        if ((i.node.compareDocumentPosition(r.node) & Node.DOCUMENT_POSITION_PRECEDING || i.node === r.node && i.offset > r.offset) && ([i, r] = [r, i]), i.node.compareDocumentPosition(this._rowElements[0]) & (Node.DOCUMENT_POSITION_CONTAINED_BY | Node.DOCUMENT_POSITION_FOLLOWING) && (i = { node: this._rowElements[0].childNodes[0], offset: 0 }), !this._rowContainer.contains(i.node)) return;
        let n = this._rowElements.slice(-1)[0];
        if (r.node.compareDocumentPosition(n) & (Node.DOCUMENT_POSITION_CONTAINED_BY | Node.DOCUMENT_POSITION_PRECEDING) && (r = { node: n, offset: n.textContent?.length ?? 0 }), !this._rowContainer.contains(r.node)) return;
        let o = ({ node: u, offset: h8 }) => {
          let c = u instanceof Text ? u.parentNode : u, d = parseInt(c?.getAttribute("aria-posinset"), 10) - 1;
          if (isNaN(d)) return console.warn("row is invalid. Race condition?"), null;
          let _ = this._rowColumns.get(c);
          if (!_) return console.warn("columns is null. Race condition?"), null;
          let p = h8 < _.length ? _[h8] : _.slice(-1)[0] + 1;
          return p >= this._terminal.cols && (++d, p = 0), { row: d, column: p };
        }, l = o(i), a = o(r);
        if (!(!l || !a)) {
          if (l.row > a.row || l.row === a.row && l.column >= a.column) throw new Error("invalid range");
          this._terminal.select(l.column, l.row, (a.row - l.row) * this._terminal.cols - l.column + a.column);
        }
      }
      _handleResize(e) {
        this._rowElements[this._rowElements.length - 1].removeEventListener("focus", this._bottomBoundaryFocusListener);
        for (let i = this._rowContainer.children.length; i < this._terminal.rows; i++) this._rowElements[i] = this._createAccessibilityTreeNode(), this._rowContainer.appendChild(this._rowElements[i]);
        for (; this._rowElements.length > e; ) this._rowContainer.removeChild(this._rowElements.pop());
        this._rowElements[this._rowElements.length - 1].addEventListener("focus", this._bottomBoundaryFocusListener), this._refreshRowsDimensions();
      }
      _createAccessibilityTreeNode() {
        let e = this._coreBrowserService.mainDocument.createElement("div");
        return e.setAttribute("role", "listitem"), e.tabIndex = -1, this._refreshRowDimensions(e), e;
      }
      _refreshRowsDimensions() {
        if (this._renderService.dimensions.css.cell.height) {
          Object.assign(this._accessibilityContainer.style, { width: `${this._renderService.dimensions.css.canvas.width}px`, fontSize: `${this._terminal.options.fontSize}px` }), this._rowElements.length !== this._terminal.rows && this._handleResize(this._terminal.rows);
          for (let e = 0; e < this._terminal.rows; e++) this._refreshRowDimensions(this._rowElements[e]), this._alignRowWidth(this._rowElements[e]);
        }
      }
      _refreshRowDimensions(e) {
        e.style.height = `${this._renderService.dimensions.css.cell.height}px`;
      }
      _alignRowWidth(e) {
        e.style.transform = "";
        let i = e.getBoundingClientRect().width, r = this._rowColumns.get(e)?.slice(-1)?.[0];
        if (!r) return;
        let n = r * this._renderService.dimensions.css.cell.width;
        e.style.transform = `scaleX(${n / i})`;
      }
    };
    Tt = M([S(1, xt), S(2, ae), S(3, ce)], Tt);
    hi = class extends D {
      constructor(e, i, r, n, o) {
        super();
        this._element = e;
        this._mouseService = i;
        this._renderService = r;
        this._bufferService = n;
        this._linkProviderService = o;
        this._linkCacheDisposables = [];
        this._isMouseOut = true;
        this._wasResized = false;
        this._activeLine = -1;
        this._onShowLinkUnderline = this._register(new v());
        this.onShowLinkUnderline = this._onShowLinkUnderline.event;
        this._onHideLinkUnderline = this._register(new v());
        this.onHideLinkUnderline = this._onHideLinkUnderline.event;
        this._register(C(() => {
          Ne(this._linkCacheDisposables), this._linkCacheDisposables.length = 0, this._lastMouseEvent = void 0, this._activeProviderReplies?.clear();
        })), this._register(this._bufferService.onResize(() => {
          this._clearCurrentLink(), this._wasResized = true;
        })), this._register(L(this._element, "mouseleave", () => {
          this._isMouseOut = true, this._clearCurrentLink();
        })), this._register(L(this._element, "mousemove", this._handleMouseMove.bind(this))), this._register(L(this._element, "mousedown", this._handleMouseDown.bind(this))), this._register(L(this._element, "mouseup", this._handleMouseUp.bind(this)));
      }
      get currentLink() {
        return this._currentLink;
      }
      _handleMouseMove(e) {
        this._lastMouseEvent = e;
        let i = this._positionFromMouseEvent(e, this._element, this._mouseService);
        if (!i) return;
        this._isMouseOut = false;
        let r = e.composedPath();
        for (let n = 0; n < r.length; n++) {
          let o = r[n];
          if (o.classList.contains("xterm")) break;
          if (o.classList.contains("xterm-hover")) return;
        }
        (!this._lastBufferCell || i.x !== this._lastBufferCell.x || i.y !== this._lastBufferCell.y) && (this._handleHover(i), this._lastBufferCell = i);
      }
      _handleHover(e) {
        if (this._activeLine !== e.y || this._wasResized) {
          this._clearCurrentLink(), this._askForLink(e, false), this._wasResized = false;
          return;
        }
        this._currentLink && this._linkAtPosition(this._currentLink.link, e) || (this._clearCurrentLink(), this._askForLink(e, true));
      }
      _askForLink(e, i) {
        (!this._activeProviderReplies || !i) && (this._activeProviderReplies?.forEach((n) => {
          n?.forEach((o) => {
            o.link.dispose && o.link.dispose();
          });
        }), this._activeProviderReplies = /* @__PURE__ */ new Map(), this._activeLine = e.y);
        let r = false;
        for (let [n, o] of this._linkProviderService.linkProviders.entries()) i ? this._activeProviderReplies?.get(n) && (r = this._checkLinkProviderResult(n, e, r)) : o.provideLinks(e.y, (l) => {
          if (this._isMouseOut) return;
          let a = l?.map((u) => ({ link: u }));
          this._activeProviderReplies?.set(n, a), r = this._checkLinkProviderResult(n, e, r), this._activeProviderReplies?.size === this._linkProviderService.linkProviders.length && this._removeIntersectingLinks(e.y, this._activeProviderReplies);
        });
      }
      _removeIntersectingLinks(e, i) {
        let r = /* @__PURE__ */ new Set();
        for (let n = 0; n < i.size; n++) {
          let o = i.get(n);
          if (o) for (let l = 0; l < o.length; l++) {
            let a = o[l], u = a.link.range.start.y < e ? 0 : a.link.range.start.x, h8 = a.link.range.end.y > e ? this._bufferService.cols : a.link.range.end.x;
            for (let c = u; c <= h8; c++) {
              if (r.has(c)) {
                o.splice(l--, 1);
                break;
              }
              r.add(c);
            }
          }
        }
      }
      _checkLinkProviderResult(e, i, r) {
        if (!this._activeProviderReplies) return r;
        let n = this._activeProviderReplies.get(e), o = false;
        for (let l = 0; l < e; l++) (!this._activeProviderReplies.has(l) || this._activeProviderReplies.get(l)) && (o = true);
        if (!o && n) {
          let l = n.find((a) => this._linkAtPosition(a.link, i));
          l && (r = true, this._handleNewLink(l));
        }
        if (this._activeProviderReplies.size === this._linkProviderService.linkProviders.length && !r) for (let l = 0; l < this._activeProviderReplies.size; l++) {
          let a = this._activeProviderReplies.get(l)?.find((u) => this._linkAtPosition(u.link, i));
          if (a) {
            r = true, this._handleNewLink(a);
            break;
          }
        }
        return r;
      }
      _handleMouseDown() {
        this._mouseDownLink = this._currentLink;
      }
      _handleMouseUp(e) {
        if (!this._currentLink) return;
        let i = this._positionFromMouseEvent(e, this._element, this._mouseService);
        i && this._mouseDownLink && Ec(this._mouseDownLink.link, this._currentLink.link) && this._linkAtPosition(this._currentLink.link, i) && this._currentLink.link.activate(e, this._currentLink.link.text);
      }
      _clearCurrentLink(e, i) {
        !this._currentLink || !this._lastMouseEvent || (!e || !i || this._currentLink.link.range.start.y >= e && this._currentLink.link.range.end.y <= i) && (this._linkLeave(this._element, this._currentLink.link, this._lastMouseEvent), this._currentLink = void 0, Ne(this._linkCacheDisposables), this._linkCacheDisposables.length = 0);
      }
      _handleNewLink(e) {
        if (!this._lastMouseEvent) return;
        let i = this._positionFromMouseEvent(this._lastMouseEvent, this._element, this._mouseService);
        i && this._linkAtPosition(e.link, i) && (this._currentLink = e, this._currentLink.state = { decorations: { underline: e.link.decorations === void 0 ? true : e.link.decorations.underline, pointerCursor: e.link.decorations === void 0 ? true : e.link.decorations.pointerCursor }, isHovered: true }, this._linkHover(this._element, e.link, this._lastMouseEvent), e.link.decorations = {}, Object.defineProperties(e.link.decorations, { pointerCursor: { get: () => this._currentLink?.state?.decorations.pointerCursor, set: (r) => {
          this._currentLink?.state && this._currentLink.state.decorations.pointerCursor !== r && (this._currentLink.state.decorations.pointerCursor = r, this._currentLink.state.isHovered && this._element.classList.toggle("xterm-cursor-pointer", r));
        } }, underline: { get: () => this._currentLink?.state?.decorations.underline, set: (r) => {
          this._currentLink?.state && this._currentLink?.state?.decorations.underline !== r && (this._currentLink.state.decorations.underline = r, this._currentLink.state.isHovered && this._fireUnderlineEvent(e.link, r));
        } } }), this._linkCacheDisposables.push(this._renderService.onRenderedViewportChange((r) => {
          if (!this._currentLink) return;
          let n = r.start === 0 ? 0 : r.start + 1 + this._bufferService.buffer.ydisp, o = this._bufferService.buffer.ydisp + 1 + r.end;
          if (this._currentLink.link.range.start.y >= n && this._currentLink.link.range.end.y <= o && (this._clearCurrentLink(n, o), this._lastMouseEvent)) {
            let l = this._positionFromMouseEvent(this._lastMouseEvent, this._element, this._mouseService);
            l && this._askForLink(l, false);
          }
        })));
      }
      _linkHover(e, i, r) {
        this._currentLink?.state && (this._currentLink.state.isHovered = true, this._currentLink.state.decorations.underline && this._fireUnderlineEvent(i, true), this._currentLink.state.decorations.pointerCursor && e.classList.add("xterm-cursor-pointer")), i.hover && i.hover(r, i.text);
      }
      _fireUnderlineEvent(e, i) {
        let r = e.range, n = this._bufferService.buffer.ydisp, o = this._createLinkUnderlineEvent(r.start.x - 1, r.start.y - n - 1, r.end.x, r.end.y - n - 1, void 0);
        (i ? this._onShowLinkUnderline : this._onHideLinkUnderline).fire(o);
      }
      _linkLeave(e, i, r) {
        this._currentLink?.state && (this._currentLink.state.isHovered = false, this._currentLink.state.decorations.underline && this._fireUnderlineEvent(i, false), this._currentLink.state.decorations.pointerCursor && e.classList.remove("xterm-cursor-pointer")), i.leave && i.leave(r, i.text);
      }
      _linkAtPosition(e, i) {
        let r = e.range.start.y * this._bufferService.cols + e.range.start.x, n = e.range.end.y * this._bufferService.cols + e.range.end.x, o = i.y * this._bufferService.cols + i.x;
        return r <= o && o <= n;
      }
      _positionFromMouseEvent(e, i, r) {
        let n = r.getCoords(e, i, this._bufferService.cols, this._bufferService.rows);
        if (n) return { x: n[0], y: n[1] + this._bufferService.buffer.ydisp };
      }
      _createLinkUnderlineEvent(e, i, r, n, o) {
        return { x1: e, y1: i, x2: r, y2: n, cols: this._bufferService.cols, fg: o };
      }
    };
    hi = M([S(1, Dt), S(2, ce), S(3, F), S(4, lr)], hi);
    yn = class extends Sn {
      constructor(e = {}) {
        super(e);
        this._linkifier = this._register(new ye());
        this.browser = tn;
        this._keyDownHandled = false;
        this._keyDownSeen = false;
        this._keyPressHandled = false;
        this._unprocessedDeadKey = false;
        this._accessibilityManager = this._register(new ye());
        this._onCursorMove = this._register(new v());
        this.onCursorMove = this._onCursorMove.event;
        this._onKey = this._register(new v());
        this.onKey = this._onKey.event;
        this._onRender = this._register(new v());
        this.onRender = this._onRender.event;
        this._onSelectionChange = this._register(new v());
        this.onSelectionChange = this._onSelectionChange.event;
        this._onTitleChange = this._register(new v());
        this.onTitleChange = this._onTitleChange.event;
        this._onBell = this._register(new v());
        this.onBell = this._onBell.event;
        this._onFocus = this._register(new v());
        this._onBlur = this._register(new v());
        this._onA11yCharEmitter = this._register(new v());
        this._onA11yTabEmitter = this._register(new v());
        this._onWillOpen = this._register(new v());
        this._setup(), this._decorationService = this._instantiationService.createInstance(Tn), this._instantiationService.setService(Be, this._decorationService), this._linkProviderService = this._instantiationService.createInstance(Qr), this._instantiationService.setService(lr, this._linkProviderService), this._linkProviderService.registerLinkProvider(this._instantiationService.createInstance(wt)), this._register(this._inputHandler.onRequestBell(() => this._onBell.fire())), this._register(this._inputHandler.onRequestRefreshRows((i) => this.refresh(i?.start ?? 0, i?.end ?? this.rows - 1))), this._register(this._inputHandler.onRequestSendFocus(() => this._reportFocus())), this._register(this._inputHandler.onRequestReset(() => this.reset())), this._register(this._inputHandler.onRequestWindowsOptionsReport((i) => this._reportWindowsOptions(i))), this._register(this._inputHandler.onColor((i) => this._handleColorEvent(i))), this._register($.forward(this._inputHandler.onCursorMove, this._onCursorMove)), this._register($.forward(this._inputHandler.onTitleChange, this._onTitleChange)), this._register($.forward(this._inputHandler.onA11yChar, this._onA11yCharEmitter)), this._register($.forward(this._inputHandler.onA11yTab, this._onA11yTabEmitter)), this._register(this._bufferService.onResize((i) => this._afterResize(i.cols, i.rows))), this._register(C(() => {
          this._customKeyEventHandler = void 0, this.element?.parentNode?.removeChild(this.element);
        }));
      }
      get linkifier() {
        return this._linkifier.value;
      }
      get onFocus() {
        return this._onFocus.event;
      }
      get onBlur() {
        return this._onBlur.event;
      }
      get onA11yChar() {
        return this._onA11yCharEmitter.event;
      }
      get onA11yTab() {
        return this._onA11yTabEmitter.event;
      }
      get onWillOpen() {
        return this._onWillOpen.event;
      }
      _handleColorEvent(e) {
        if (this._themeService) for (let i of e) {
          let r, n = "";
          switch (i.index) {
            case 256:
              r = "foreground", n = "10";
              break;
            case 257:
              r = "background", n = "11";
              break;
            case 258:
              r = "cursor", n = "12";
              break;
            default:
              r = "ansi", n = "4;" + i.index;
          }
          switch (i.type) {
            case 0:
              let o = U.toColorRGB(r === "ansi" ? this._themeService.colors.ansi[i.index] : this._themeService.colors[r]);
              this.coreService.triggerDataEvent(`${b.ESC}]${n};${ml(o)}${fs.ST}`);
              break;
            case 1:
              if (r === "ansi") this._themeService.modifyColors((l) => l.ansi[i.index] = j.toColor(...i.color));
              else {
                let l = r;
                this._themeService.modifyColors((a) => a[l] = j.toColor(...i.color));
              }
              break;
            case 2:
              this._themeService.restoreColor(i.index);
              break;
          }
        }
      }
      _setup() {
        super._setup(), this._customKeyEventHandler = void 0;
      }
      get buffer() {
        return this.buffers.active;
      }
      focus() {
        this.textarea && this.textarea.focus({ preventScroll: true });
      }
      _handleScreenReaderModeOptionChange(e) {
        e ? !this._accessibilityManager.value && this._renderService && (this._accessibilityManager.value = this._instantiationService.createInstance(Tt, this)) : this._accessibilityManager.clear();
      }
      _handleTextAreaFocus(e) {
        this.coreService.decPrivateModes.sendFocus && this.coreService.triggerDataEvent(b.ESC + "[I"), this.element.classList.add("focus"), this._showCursor(), this._onFocus.fire();
      }
      blur() {
        return this.textarea?.blur();
      }
      _handleTextAreaBlur() {
        this.textarea.value = "", this.refresh(this.buffer.y, this.buffer.y), this.coreService.decPrivateModes.sendFocus && this.coreService.triggerDataEvent(b.ESC + "[O"), this.element.classList.remove("focus"), this._onBlur.fire();
      }
      _syncTextArea() {
        if (!this.textarea || !this.buffer.isCursorInViewport || this._compositionHelper.isComposing || !this._renderService) return;
        let e = this.buffer.ybase + this.buffer.y, i = this.buffer.lines.get(e);
        if (!i) return;
        let r = Math.min(this.buffer.x, this.cols - 1), n = this._renderService.dimensions.css.cell.height, o = i.getWidth(r), l = this._renderService.dimensions.css.cell.width * o, a = this.buffer.y * this._renderService.dimensions.css.cell.height, u = r * this._renderService.dimensions.css.cell.width;
        this.textarea.style.left = u + "px", this.textarea.style.top = a + "px", this.textarea.style.width = l + "px", this.textarea.style.height = n + "px", this.textarea.style.lineHeight = n + "px", this.textarea.style.zIndex = "-5";
      }
      _initGlobal() {
        this._bindKeys(), this._register(L(this.element, "copy", (i) => {
          this.hasSelection() && Vs(i, this._selectionService);
        }));
        let e = (i) => qs(i, this.textarea, this.coreService, this.optionsService);
        this._register(L(this.textarea, "paste", e)), this._register(L(this.element, "paste", e)), Ss ? this._register(L(this.element, "mousedown", (i) => {
          i.button === 2 && Pn(i, this.textarea, this.screenElement, this._selectionService, this.options.rightClickSelectsWord);
        })) : this._register(L(this.element, "contextmenu", (i) => {
          Pn(i, this.textarea, this.screenElement, this._selectionService, this.options.rightClickSelectsWord);
        })), Bi && this._register(L(this.element, "auxclick", (i) => {
          i.button === 1 && Mn(i, this.textarea, this.screenElement);
        }));
      }
      _bindKeys() {
        this._register(L(this.textarea, "keyup", (e) => this._keyUp(e), true)), this._register(L(this.textarea, "keydown", (e) => this._keyDown(e), true)), this._register(L(this.textarea, "keypress", (e) => this._keyPress(e), true)), this._register(L(this.textarea, "compositionstart", () => this._compositionHelper.compositionstart())), this._register(L(this.textarea, "compositionupdate", (e) => this._compositionHelper.compositionupdate(e))), this._register(L(this.textarea, "compositionend", () => this._compositionHelper.compositionend())), this._register(L(this.textarea, "input", (e) => this._inputEvent(e), true)), this._register(this.onRender(() => this._compositionHelper.updateCompositionElements()));
      }
      open(e) {
        if (!e) throw new Error("Terminal requires a parent element.");
        if (e.isConnected || this._logService.debug("Terminal.open was called on an element that was not attached to the DOM"), this.element?.ownerDocument.defaultView && this._coreBrowserService) {
          this.element.ownerDocument.defaultView !== this._coreBrowserService.window && (this._coreBrowserService.window = this.element.ownerDocument.defaultView);
          return;
        }
        this._document = e.ownerDocument, this.options.documentOverride && this.options.documentOverride instanceof Document && (this._document = this.optionsService.rawOptions.documentOverride), this.element = this._document.createElement("div"), this.element.dir = "ltr", this.element.classList.add("terminal"), this.element.classList.add("xterm"), e.appendChild(this.element);
        let i = this._document.createDocumentFragment();
        this._viewportElement = this._document.createElement("div"), this._viewportElement.classList.add("xterm-viewport"), i.appendChild(this._viewportElement), this.screenElement = this._document.createElement("div"), this.screenElement.classList.add("xterm-screen"), this._register(L(this.screenElement, "mousemove", (o) => this.updateCursorStyle(o))), this._helperContainer = this._document.createElement("div"), this._helperContainer.classList.add("xterm-helpers"), this.screenElement.appendChild(this._helperContainer), i.appendChild(this.screenElement);
        let r = this.textarea = this._document.createElement("textarea");
        this.textarea.classList.add("xterm-helper-textarea"), this.textarea.setAttribute("aria-label", mi.get()), Ts || this.textarea.setAttribute("aria-multiline", "false"), this.textarea.setAttribute("autocorrect", "off"), this.textarea.setAttribute("autocapitalize", "off"), this.textarea.setAttribute("spellcheck", "false"), this.textarea.tabIndex = 0, this._register(this.optionsService.onSpecificOptionChange("disableStdin", () => r.readOnly = this.optionsService.rawOptions.disableStdin)), this.textarea.readOnly = this.optionsService.rawOptions.disableStdin, this._coreBrowserService = this._register(this._instantiationService.createInstance(Jr, this.textarea, e.ownerDocument.defaultView ?? window, this._document ?? typeof window < "u" ? window.document : null)), this._instantiationService.setService(ae, this._coreBrowserService), this._register(L(this.textarea, "focus", (o) => this._handleTextAreaFocus(o))), this._register(L(this.textarea, "blur", () => this._handleTextAreaBlur())), this._helperContainer.appendChild(this.textarea), this._charSizeService = this._instantiationService.createInstance(jt, this._document, this._helperContainer), this._instantiationService.setService(nt, this._charSizeService), this._themeService = this._instantiationService.createInstance(ti), this._instantiationService.setService(Re, this._themeService), this._characterJoinerService = this._instantiationService.createInstance(ct), this._instantiationService.setService(or, this._characterJoinerService), this._renderService = this._register(this._instantiationService.createInstance(Qt, this.rows, this.screenElement)), this._instantiationService.setService(ce, this._renderService), this._register(this._renderService.onRenderedViewportChange((o) => this._onRender.fire(o))), this.onResize((o) => this._renderService.resize(o.cols, o.rows)), this._compositionView = this._document.createElement("div"), this._compositionView.classList.add("composition-view"), this._compositionHelper = this._instantiationService.createInstance($t, this.textarea, this._compositionView), this._helperContainer.appendChild(this._compositionView), this._mouseService = this._instantiationService.createInstance(Xt), this._instantiationService.setService(Dt, this._mouseService);
        let n = this._linkifier.value = this._register(this._instantiationService.createInstance(hi, this.screenElement));
        this.element.appendChild(i);
        try {
          this._onWillOpen.fire(this.element);
        } catch {
        }
        this._renderService.hasRenderer() || this._renderService.setRenderer(this._createRenderer()), this._register(this.onCursorMove(() => {
          this._renderService.handleCursorMove(), this._syncTextArea();
        })), this._register(this.onResize(() => this._renderService.handleResize(this.cols, this.rows))), this._register(this.onBlur(() => this._renderService.handleBlur())), this._register(this.onFocus(() => this._renderService.handleFocus())), this._viewport = this._register(this._instantiationService.createInstance(zt, this.element, this.screenElement)), this._register(this._viewport.onRequestScrollLines((o) => {
          super.scrollLines(o, false), this.refresh(0, this.rows - 1);
        })), this._selectionService = this._register(this._instantiationService.createInstance(ei, this.element, this.screenElement, n)), this._instantiationService.setService(Qs, this._selectionService), this._register(this._selectionService.onRequestScrollLines((o) => this.scrollLines(o.amount, o.suppressScrollEvent))), this._register(this._selectionService.onSelectionChange(() => this._onSelectionChange.fire())), this._register(this._selectionService.onRequestRedraw((o) => this._renderService.handleSelectionChanged(o.start, o.end, o.columnSelectMode))), this._register(this._selectionService.onLinuxMouseSelection((o) => {
          this.textarea.value = o, this.textarea.focus(), this.textarea.select();
        })), this._register($.any(this._onScroll.event, this._inputHandler.onScroll)(() => {
          this._selectionService.refresh(), this._viewport?.queueSync();
        })), this._register(this._instantiationService.createInstance(Gt, this.screenElement)), this._register(L(this.element, "mousedown", (o) => this._selectionService.handleMouseDown(o))), this.coreMouseService.areMouseEventsActive ? (this._selectionService.disable(), this.element.classList.add("enable-mouse-events")) : this._selectionService.enable(), this.options.screenReaderMode && (this._accessibilityManager.value = this._instantiationService.createInstance(Tt, this)), this._register(this.optionsService.onSpecificOptionChange("screenReaderMode", (o) => this._handleScreenReaderModeOptionChange(o))), this.options.overviewRuler.width && (this._overviewRulerRenderer = this._register(this._instantiationService.createInstance(bt, this._viewportElement, this.screenElement))), this.optionsService.onSpecificOptionChange("overviewRuler", (o) => {
          !this._overviewRulerRenderer && o && this._viewportElement && this.screenElement && (this._overviewRulerRenderer = this._register(this._instantiationService.createInstance(bt, this._viewportElement, this.screenElement)));
        }), this._charSizeService.measure(), this.refresh(0, this.rows - 1), this._initGlobal(), this.bindMouse();
      }
      _createRenderer() {
        return this._instantiationService.createInstance(Yt, this, this._document, this.element, this.screenElement, this._viewportElement, this._helperContainer, this.linkifier);
      }
      bindMouse() {
        let e = this, i = this.element;
        function r(l) {
          let a = e._mouseService.getMouseReportCoords(l, e.screenElement);
          if (!a) return false;
          let u, h8;
          switch (l.overrideType || l.type) {
            case "mousemove":
              h8 = 32, l.buttons === void 0 ? (u = 3, l.button !== void 0 && (u = l.button < 3 ? l.button : 3)) : u = l.buttons & 1 ? 0 : l.buttons & 4 ? 1 : l.buttons & 2 ? 2 : 3;
              break;
            case "mouseup":
              h8 = 0, u = l.button < 3 ? l.button : 3;
              break;
            case "mousedown":
              h8 = 1, u = l.button < 3 ? l.button : 3;
              break;
            case "wheel":
              if (e._customWheelEventHandler && e._customWheelEventHandler(l) === false) return false;
              let c = l.deltaY;
              if (c === 0 || e.coreMouseService.consumeWheelEvent(l, e._renderService?.dimensions?.device?.cell?.height, e._coreBrowserService?.dpr) === 0) return false;
              h8 = c < 0 ? 0 : 1, u = 4;
              break;
            default:
              return false;
          }
          return h8 === void 0 || u === void 0 || u > 4 ? false : e.coreMouseService.triggerMouseEvent({ col: a.col, row: a.row, x: a.x, y: a.y, button: u, action: h8, ctrl: l.ctrlKey, alt: l.altKey, shift: l.shiftKey });
        }
        let n = { mouseup: null, wheel: null, mousedrag: null, mousemove: null }, o = { mouseup: (l) => (r(l), l.buttons || (this._document.removeEventListener("mouseup", n.mouseup), n.mousedrag && this._document.removeEventListener("mousemove", n.mousedrag)), this.cancel(l)), wheel: (l) => (r(l), this.cancel(l, true)), mousedrag: (l) => {
          l.buttons && r(l);
        }, mousemove: (l) => {
          l.buttons || r(l);
        } };
        this._register(this.coreMouseService.onProtocolChange((l) => {
          l ? (this.optionsService.rawOptions.logLevel === "debug" && this._logService.debug("Binding to mouse events:", this.coreMouseService.explainEvents(l)), this.element.classList.add("enable-mouse-events"), this._selectionService.disable()) : (this._logService.debug("Unbinding from mouse events."), this.element.classList.remove("enable-mouse-events"), this._selectionService.enable()), l & 8 ? n.mousemove || (i.addEventListener("mousemove", o.mousemove), n.mousemove = o.mousemove) : (i.removeEventListener("mousemove", n.mousemove), n.mousemove = null), l & 16 ? n.wheel || (i.addEventListener("wheel", o.wheel, { passive: false }), n.wheel = o.wheel) : (i.removeEventListener("wheel", n.wheel), n.wheel = null), l & 2 ? n.mouseup || (n.mouseup = o.mouseup) : (this._document.removeEventListener("mouseup", n.mouseup), n.mouseup = null), l & 4 ? n.mousedrag || (n.mousedrag = o.mousedrag) : (this._document.removeEventListener("mousemove", n.mousedrag), n.mousedrag = null);
        })), this.coreMouseService.activeProtocol = this.coreMouseService.activeProtocol, this._register(L(i, "mousedown", (l) => {
          if (l.preventDefault(), this.focus(), !(!this.coreMouseService.areMouseEventsActive || this._selectionService.shouldForceSelection(l))) return r(l), n.mouseup && this._document.addEventListener("mouseup", n.mouseup), n.mousedrag && this._document.addEventListener("mousemove", n.mousedrag), this.cancel(l);
        })), this._register(L(i, "wheel", (l) => {
          if (!n.wheel) {
            if (this._customWheelEventHandler && this._customWheelEventHandler(l) === false) return false;
            if (!this.buffer.hasScrollback) {
              if (l.deltaY === 0) return false;
              if (e.coreMouseService.consumeWheelEvent(l, e._renderService?.dimensions?.device?.cell?.height, e._coreBrowserService?.dpr) === 0) return this.cancel(l, true);
              let h8 = b.ESC + (this.coreService.decPrivateModes.applicationCursorKeys ? "O" : "[") + (l.deltaY < 0 ? "A" : "B");
              return this.coreService.triggerDataEvent(h8, true), this.cancel(l, true);
            }
          }
        }, { passive: false }));
      }
      refresh(e, i) {
        this._renderService?.refreshRows(e, i);
      }
      updateCursorStyle(e) {
        this._selectionService?.shouldColumnSelect(e) ? this.element.classList.add("column-select") : this.element.classList.remove("column-select");
      }
      _showCursor() {
        this.coreService.isCursorInitialized || (this.coreService.isCursorInitialized = true, this.refresh(this.buffer.y, this.buffer.y));
      }
      scrollLines(e, i) {
        this._viewport ? this._viewport.scrollLines(e) : super.scrollLines(e, i), this.refresh(0, this.rows - 1);
      }
      scrollPages(e) {
        this.scrollLines(e * (this.rows - 1));
      }
      scrollToTop() {
        this.scrollLines(-this._bufferService.buffer.ydisp);
      }
      scrollToBottom(e) {
        e && this._viewport ? this._viewport.scrollToLine(this.buffer.ybase, true) : this.scrollLines(this._bufferService.buffer.ybase - this._bufferService.buffer.ydisp);
      }
      scrollToLine(e) {
        let i = e - this._bufferService.buffer.ydisp;
        i !== 0 && this.scrollLines(i);
      }
      paste(e) {
        Cn(e, this.textarea, this.coreService, this.optionsService);
      }
      attachCustomKeyEventHandler(e) {
        this._customKeyEventHandler = e;
      }
      attachCustomWheelEventHandler(e) {
        this._customWheelEventHandler = e;
      }
      registerLinkProvider(e) {
        return this._linkProviderService.registerLinkProvider(e);
      }
      registerCharacterJoiner(e) {
        if (!this._characterJoinerService) throw new Error("Terminal must be opened first");
        let i = this._characterJoinerService.register(e);
        return this.refresh(0, this.rows - 1), i;
      }
      deregisterCharacterJoiner(e) {
        if (!this._characterJoinerService) throw new Error("Terminal must be opened first");
        this._characterJoinerService.deregister(e) && this.refresh(0, this.rows - 1);
      }
      get markers() {
        return this.buffer.markers;
      }
      registerMarker(e) {
        return this.buffer.addMarker(this.buffer.ybase + this.buffer.y + e);
      }
      registerDecoration(e) {
        return this._decorationService.registerDecoration(e);
      }
      hasSelection() {
        return this._selectionService ? this._selectionService.hasSelection : false;
      }
      select(e, i, r) {
        this._selectionService.setSelection(e, i, r);
      }
      getSelection() {
        return this._selectionService ? this._selectionService.selectionText : "";
      }
      getSelectionPosition() {
        if (!(!this._selectionService || !this._selectionService.hasSelection)) return { start: { x: this._selectionService.selectionStart[0], y: this._selectionService.selectionStart[1] }, end: { x: this._selectionService.selectionEnd[0], y: this._selectionService.selectionEnd[1] } };
      }
      clearSelection() {
        this._selectionService?.clearSelection();
      }
      selectAll() {
        this._selectionService?.selectAll();
      }
      selectLines(e, i) {
        this._selectionService?.selectLines(e, i);
      }
      _keyDown(e) {
        if (this._keyDownHandled = false, this._keyDownSeen = true, this._customKeyEventHandler && this._customKeyEventHandler(e) === false) return false;
        let i = this.browser.isMac && this.options.macOptionIsMeta && e.altKey;
        if (!i && !this._compositionHelper.keydown(e)) return this.options.scrollOnUserInput && this.buffer.ybase !== this.buffer.ydisp && this.scrollToBottom(true), false;
        !i && (e.key === "Dead" || e.key === "AltGraph") && (this._unprocessedDeadKey = true);
        let r = Il(e, this.coreService.decPrivateModes.applicationCursorKeys, this.browser.isMac, this.options.macOptionIsMeta);
        if (this.updateCursorStyle(e), r.type === 3 || r.type === 2) {
          let n = this.rows - 1;
          return this.scrollLines(r.type === 2 ? -n : n), this.cancel(e, true);
        }
        if (r.type === 1 && this.selectAll(), this._isThirdLevelShift(this.browser, e) || (r.cancel && this.cancel(e, true), !r.key) || e.key && !e.ctrlKey && !e.altKey && !e.metaKey && e.key.length === 1 && e.key.charCodeAt(0) >= 65 && e.key.charCodeAt(0) <= 90) return true;
        if (this._unprocessedDeadKey) return this._unprocessedDeadKey = false, true;
        if ((r.key === b.ETX || r.key === b.CR) && (this.textarea.value = ""), this._onKey.fire({ key: r.key, domEvent: e }), this._showCursor(), this.coreService.triggerDataEvent(r.key, true), !this.optionsService.rawOptions.screenReaderMode || e.altKey || e.ctrlKey) return this.cancel(e, true);
        this._keyDownHandled = true;
      }
      _isThirdLevelShift(e, i) {
        let r = e.isMac && !this.options.macOptionIsMeta && i.altKey && !i.ctrlKey && !i.metaKey || e.isWindows && i.altKey && i.ctrlKey && !i.metaKey || e.isWindows && i.getModifierState("AltGraph");
        return i.type === "keypress" ? r : r && (!i.keyCode || i.keyCode > 47);
      }
      _keyUp(e) {
        this._keyDownSeen = false, !(this._customKeyEventHandler && this._customKeyEventHandler(e) === false) && (Tc(e) || this.focus(), this.updateCursorStyle(e), this._keyPressHandled = false);
      }
      _keyPress(e) {
        let i;
        if (this._keyPressHandled = false, this._keyDownHandled || this._customKeyEventHandler && this._customKeyEventHandler(e) === false) return false;
        if (this.cancel(e), e.charCode) i = e.charCode;
        else if (e.which === null || e.which === void 0) i = e.keyCode;
        else if (e.which !== 0 && e.charCode !== 0) i = e.which;
        else return false;
        return !i || (e.altKey || e.ctrlKey || e.metaKey) && !this._isThirdLevelShift(this.browser, e) ? false : (i = String.fromCharCode(i), this._onKey.fire({ key: i, domEvent: e }), this._showCursor(), this.coreService.triggerDataEvent(i, true), this._keyPressHandled = true, this._unprocessedDeadKey = false, true);
      }
      _inputEvent(e) {
        if (e.data && e.inputType === "insertText" && (!e.composed || !this._keyDownSeen) && !this.optionsService.rawOptions.screenReaderMode) {
          if (this._keyPressHandled) return false;
          this._unprocessedDeadKey = false;
          let i = e.data;
          return this.coreService.triggerDataEvent(i, true), this.cancel(e), true;
        }
        return false;
      }
      resize(e, i) {
        if (e === this.cols && i === this.rows) {
          this._charSizeService && !this._charSizeService.hasValidSize && this._charSizeService.measure();
          return;
        }
        super.resize(e, i);
      }
      _afterResize(e, i) {
        this._charSizeService?.measure();
      }
      clear() {
        if (!(this.buffer.ybase === 0 && this.buffer.y === 0)) {
          this.buffer.clearAllMarkers(), this.buffer.lines.set(0, this.buffer.lines.get(this.buffer.ybase + this.buffer.y)), this.buffer.lines.length = 1, this.buffer.ydisp = 0, this.buffer.ybase = 0, this.buffer.y = 0;
          for (let e = 1; e < this.rows; e++) this.buffer.lines.push(this.buffer.getBlankLine(X));
          this._onScroll.fire({ position: this.buffer.ydisp }), this.refresh(0, this.rows - 1);
        }
      }
      reset() {
        this.options.rows = this.rows, this.options.cols = this.cols;
        let e = this._customKeyEventHandler;
        this._setup(), super.reset(), this._selectionService?.reset(), this._decorationService.reset(), this._customKeyEventHandler = e, this.refresh(0, this.rows - 1);
      }
      clearTextureAtlas() {
        this._renderService?.clearTextureAtlas();
      }
      _reportFocus() {
        this.element?.classList.contains("focus") ? this.coreService.triggerDataEvent(b.ESC + "[I") : this.coreService.triggerDataEvent(b.ESC + "[O");
      }
      _reportWindowsOptions(e) {
        if (this._renderService) switch (e) {
          case 0:
            let i = this._renderService.dimensions.css.canvas.width.toFixed(0), r = this._renderService.dimensions.css.canvas.height.toFixed(0);
            this.coreService.triggerDataEvent(`${b.ESC}[4;${r};${i}t`);
            break;
          case 1:
            let n = this._renderService.dimensions.css.cell.width.toFixed(0), o = this._renderService.dimensions.css.cell.height.toFixed(0);
            this.coreService.triggerDataEvent(`${b.ESC}[6;${o};${n}t`);
            break;
        }
      }
      cancel(e, i) {
        if (!(!this.options.cancelEvents && !i)) return e.preventDefault(), e.stopPropagation(), false;
      }
    };
    xn = class {
      constructor() {
        this._addons = [];
      }
      dispose() {
        for (let t = this._addons.length - 1; t >= 0; t--) this._addons[t].instance.dispose();
      }
      loadAddon(t, e) {
        let i = { instance: e, dispose: e.dispose, isDisposed: false };
        this._addons.push(i), e.dispose = () => this._wrappedAddonDispose(i), e.activate(t);
      }
      _wrappedAddonDispose(t) {
        if (t.isDisposed) return;
        let e = -1;
        for (let i = 0; i < this._addons.length; i++) if (this._addons[i] === t) {
          e = i;
          break;
        }
        if (e === -1) throw new Error("Could not dispose an addon that has not been loaded");
        t.isDisposed = true, t.dispose.apply(t.instance), this._addons.splice(e, 1);
      }
    };
    wn = class {
      constructor(t) {
        this._line = t;
      }
      get isWrapped() {
        return this._line.isWrapped;
      }
      get length() {
        return this._line.length;
      }
      getCell(t, e) {
        if (!(t < 0 || t >= this._line.length)) return e ? (this._line.loadCell(t, e), e) : this._line.loadCell(t, new q());
      }
      translateToString(t, e, i) {
        return this._line.translateToString(t, e, i);
      }
    };
    Ji = class {
      constructor(t, e) {
        this._buffer = t;
        this.type = e;
      }
      init(t) {
        return this._buffer = t, this;
      }
      get cursorY() {
        return this._buffer.y;
      }
      get cursorX() {
        return this._buffer.x;
      }
      get viewportY() {
        return this._buffer.ydisp;
      }
      get baseY() {
        return this._buffer.ybase;
      }
      get length() {
        return this._buffer.lines.length;
      }
      getLine(t) {
        let e = this._buffer.lines.get(t);
        if (e) return new wn(e);
      }
      getNullCell() {
        return new q();
      }
    };
    Dn = class extends D {
      constructor(e) {
        super();
        this._core = e;
        this._onBufferChange = this._register(new v());
        this.onBufferChange = this._onBufferChange.event;
        this._normal = new Ji(this._core.buffers.normal, "normal"), this._alternate = new Ji(this._core.buffers.alt, "alternate"), this._core.buffers.onBufferActivate(() => this._onBufferChange.fire(this.active));
      }
      get active() {
        if (this._core.buffers.active === this._core.buffers.normal) return this.normal;
        if (this._core.buffers.active === this._core.buffers.alt) return this.alternate;
        throw new Error("Active buffer is neither normal nor alternate");
      }
      get normal() {
        return this._normal.init(this._core.buffers.normal);
      }
      get alternate() {
        return this._alternate.init(this._core.buffers.alt);
      }
    };
    Rn = class {
      constructor(t) {
        this._core = t;
      }
      registerCsiHandler(t, e) {
        return this._core.registerCsiHandler(t, (i) => e(i.toArray()));
      }
      addCsiHandler(t, e) {
        return this.registerCsiHandler(t, e);
      }
      registerDcsHandler(t, e) {
        return this._core.registerDcsHandler(t, (i, r) => e(i, r.toArray()));
      }
      addDcsHandler(t, e) {
        return this.registerDcsHandler(t, e);
      }
      registerEscHandler(t, e) {
        return this._core.registerEscHandler(t, e);
      }
      addEscHandler(t, e) {
        return this.registerEscHandler(t, e);
      }
      registerOscHandler(t, e) {
        return this._core.registerOscHandler(t, e);
      }
      addOscHandler(t, e) {
        return this.registerOscHandler(t, e);
      }
    };
    Ln = class {
      constructor(t) {
        this._core = t;
      }
      register(t) {
        this._core.unicodeService.register(t);
      }
      get versions() {
        return this._core.unicodeService.versions;
      }
      get activeVersion() {
        return this._core.unicodeService.activeVersion;
      }
      set activeVersion(t) {
        this._core.unicodeService.activeVersion = t;
      }
    };
    Ic = ["cols", "rows"], Ue = 0, Dl = class extends D {
      constructor(t) {
        super(), this._core = this._register(new yn(t)), this._addonManager = this._register(new xn()), this._publicOptions = { ...this._core.options };
        let e = (r) => this._core.options[r], i = (r, n) => {
          this._checkReadonlyOptions(r), this._core.options[r] = n;
        };
        for (let r in this._core.options) {
          let n = { get: e.bind(this, r), set: i.bind(this, r) };
          Object.defineProperty(this._publicOptions, r, n);
        }
      }
      _checkReadonlyOptions(t) {
        if (Ic.includes(t)) throw new Error(`Option "${t}" can only be set in the constructor`);
      }
      _checkProposedApi() {
        if (!this._core.optionsService.rawOptions.allowProposedApi) throw new Error("You must set the allowProposedApi option to true to use proposed API");
      }
      get onBell() {
        return this._core.onBell;
      }
      get onBinary() {
        return this._core.onBinary;
      }
      get onCursorMove() {
        return this._core.onCursorMove;
      }
      get onData() {
        return this._core.onData;
      }
      get onKey() {
        return this._core.onKey;
      }
      get onLineFeed() {
        return this._core.onLineFeed;
      }
      get onRender() {
        return this._core.onRender;
      }
      get onResize() {
        return this._core.onResize;
      }
      get onScroll() {
        return this._core.onScroll;
      }
      get onSelectionChange() {
        return this._core.onSelectionChange;
      }
      get onTitleChange() {
        return this._core.onTitleChange;
      }
      get onWriteParsed() {
        return this._core.onWriteParsed;
      }
      get element() {
        return this._core.element;
      }
      get parser() {
        return this._parser || (this._parser = new Rn(this._core)), this._parser;
      }
      get unicode() {
        return this._checkProposedApi(), new Ln(this._core);
      }
      get textarea() {
        return this._core.textarea;
      }
      get rows() {
        return this._core.rows;
      }
      get cols() {
        return this._core.cols;
      }
      get buffer() {
        return this._buffer || (this._buffer = this._register(new Dn(this._core))), this._buffer;
      }
      get markers() {
        return this._checkProposedApi(), this._core.markers;
      }
      get modes() {
        let t = this._core.coreService.decPrivateModes, e = "none";
        switch (this._core.coreMouseService.activeProtocol) {
          case "X10":
            e = "x10";
            break;
          case "VT200":
            e = "vt200";
            break;
          case "DRAG":
            e = "drag";
            break;
          case "ANY":
            e = "any";
            break;
        }
        return { applicationCursorKeysMode: t.applicationCursorKeys, applicationKeypadMode: t.applicationKeypad, bracketedPasteMode: t.bracketedPasteMode, insertMode: this._core.coreService.modes.insertMode, mouseTrackingMode: e, originMode: t.origin, reverseWraparoundMode: t.reverseWraparound, sendFocusMode: t.sendFocus, synchronizedOutputMode: t.synchronizedOutput, wraparoundMode: t.wraparound };
      }
      get options() {
        return this._publicOptions;
      }
      set options(t) {
        for (let e in t) this._publicOptions[e] = t[e];
      }
      blur() {
        this._core.blur();
      }
      focus() {
        this._core.focus();
      }
      input(t, e = true) {
        this._core.input(t, e);
      }
      resize(t, e) {
        this._verifyIntegers(t, e), this._core.resize(t, e);
      }
      open(t) {
        this._core.open(t);
      }
      attachCustomKeyEventHandler(t) {
        this._core.attachCustomKeyEventHandler(t);
      }
      attachCustomWheelEventHandler(t) {
        this._core.attachCustomWheelEventHandler(t);
      }
      registerLinkProvider(t) {
        return this._core.registerLinkProvider(t);
      }
      registerCharacterJoiner(t) {
        return this._checkProposedApi(), this._core.registerCharacterJoiner(t);
      }
      deregisterCharacterJoiner(t) {
        this._checkProposedApi(), this._core.deregisterCharacterJoiner(t);
      }
      registerMarker(t = 0) {
        return this._verifyIntegers(t), this._core.registerMarker(t);
      }
      registerDecoration(t) {
        return this._checkProposedApi(), this._verifyPositiveIntegers(t.x ?? 0, t.width ?? 0, t.height ?? 0), this._core.registerDecoration(t);
      }
      hasSelection() {
        return this._core.hasSelection();
      }
      select(t, e, i) {
        this._verifyIntegers(t, e, i), this._core.select(t, e, i);
      }
      getSelection() {
        return this._core.getSelection();
      }
      getSelectionPosition() {
        return this._core.getSelectionPosition();
      }
      clearSelection() {
        this._core.clearSelection();
      }
      selectAll() {
        this._core.selectAll();
      }
      selectLines(t, e) {
        this._verifyIntegers(t, e), this._core.selectLines(t, e);
      }
      dispose() {
        super.dispose();
      }
      scrollLines(t) {
        this._verifyIntegers(t), this._core.scrollLines(t);
      }
      scrollPages(t) {
        this._verifyIntegers(t), this._core.scrollPages(t);
      }
      scrollToTop() {
        this._core.scrollToTop();
      }
      scrollToBottom() {
        this._core.scrollToBottom();
      }
      scrollToLine(t) {
        this._verifyIntegers(t), this._core.scrollToLine(t);
      }
      clear() {
        this._core.clear();
      }
      write(t, e) {
        this._core.write(t, e);
      }
      writeln(t, e) {
        this._core.write(t), this._core.write(`\r
`, e);
      }
      paste(t) {
        this._core.paste(t);
      }
      refresh(t, e) {
        this._verifyIntegers(t, e), this._core.refresh(t, e);
      }
      reset() {
        this._core.reset();
      }
      clearTextureAtlas() {
        this._core.clearTextureAtlas();
      }
      loadAddon(t) {
        this._addonManager.loadAddon(this, t);
      }
      static get strings() {
        return { get promptLabel() {
          return mi.get();
        }, set promptLabel(t) {
          mi.set(t);
        }, get tooMuchOutput() {
          return _i.get();
        }, set tooMuchOutput(t) {
          _i.set(t);
        } };
      }
      _verifyIntegers(...t) {
        for (Ue of t) if (Ue === 1 / 0 || isNaN(Ue) || Ue % 1 !== 0) throw new Error("This API only accepts integers");
      }
      _verifyPositiveIntegers(...t) {
        for (Ue of t) if (Ue && (Ue === 1 / 0 || isNaN(Ue) || Ue % 1 !== 0 || Ue < 0)) throw new Error("This API only accepts positive integers");
      }
    };
  }
});

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

// src/client/vendor/inks.js
var INKS = {
  deepseek: ["#0891B2", "#22D3EE"],
  charcoal: ["#141416", "#F1F2F4"],
  graphite: ["#2D2D2D", "#D6D6DA"],
  rose: ["#EC2F6B", "#FF5A7A"],
  sky: ["#0AA8D6", "#2EE6E0"],
  tangerine: ["#FF6900", "#FF8A2E"],
  cobalt: ["#082DFF", "#5C78FF"],
  black: ["#000000", "#FFFFFF"],
  brown: ["#A27952", "#855C36"],
  red: ["#FF3E51", "#E02135"],
  orange: ["#FF781C", "#FF6700"],
  yellow: ["#FFAF38", "#FF9800"],
  green: ["#00C972", "#009957"],
  cyan: ["#1CC3B0", "#00A592"],
  blue: ["#2A92FE", "#0E74E0"],
  violet: ["#A97EFE", "#804EE0"],
  magenta: ["#FF5EB1", "#E02A88"],
  gray: ["#959595", "#777777"],
  aurora: ["#00B8D4", "#2EE6E0"]
};
var GRADIENTS = { aurora: [[0, "#A4FFB0"], [0.42, "#00F0E4"], [1, "#2E9EF7"]] };
var ACCENT_INKS = ["deepseek", "charcoal", "graphite", "rose", "sky", "tangerine", "cobalt"];
var LEGACY_INKS = { kimi: "charcoal", zai: "graphite", minimax: "rose", stepfun: "sky", mimo: "tangerine", qwen: "cobalt" };
var isHex = (color) => typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color);
var luminance = (hex) => [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255).map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
var inkName = (color) => INKS[color] ? color : INKS[LEGACY_INKS[color]] ? LEGACY_INKS[color] : "gray";
var inkFill = (color) => isHex(color) ? color : `var(--bt-ink-${inkName(color)})`;
var inkText = (color) => color === "black" ? "var(--bt-ink-gray)" : inkFill(color);
var paintCss = (color) => GRADIENTS[color] ? `linear-gradient(135deg,${GRADIENTS[color].map(([offset, value]) => `${value} ${offset * 100}%`).join(",")})` : inkFill(color);

// src/client/vendor/characters.js
var CHARACTERS = {
  whale: { label: "Whale", body: "M65.3 20.9l5.1 .1 4.8 .9 4.8 1.7 4.3 2.3 3.8 3.1 3 3.4 2.3 3.8 1.6 4.3 .9 4.3 0 4.8-.8 4.8-1.4 4.3-2.3 4.3-3.2 4.3-3.4 3.3-4.3 3.1-7.2 3.5-7.6 1.7-7.2 .1-9.6-1.6-3.3-1-2.9-1.7-8.8-8.9-6-4.7-3.3-.5-7.7 1.1-4.8-.1-4.7-1.2-1.9-1.2-1-1-.5-1.5 .4-1.4 1.1-1.3 1.9-1.3 4.7-1.5 7.7-.6 1.1-.5 .7-1 0-1.4-2.8-7.2-1.2-5.3-.1-4.3 .4-1.4 .9-1.2 1.9-.2 2 1 2.2 2.3 2.2 3.4 3.2 7.6 1.9 9.7 .5-.1 1.1-7.2 1.8-4.8 3.2-5.2 3.9-4.3 4.9-3.9 5.6-2.9 5.8-1.9z", paints: [["M93.3 55.8l1-.3 .1 1.2-2.4 5.3-3.4 4.8-3.8 3.8-4.8 3.4-5.7 2.8-4.8 1.5-4.8 .4 20.1-17.4 5.2-3.7z", "#fff", 1]], shade: "M88.6 29.5l2.4 2.9 1.9 2.8 2.4 6.3 .5 3.3 .1 5.3-1.5 6.6-1.9 4.3-2 3.3-4.8 5.4-5.7 4.3-7.2 3.3-6.2 1.5-6.7 .1-3.3-.2-9.6-1.8-3.3-1.5-2.4-1.9-8.6-8.9-5.3-3.9-3.3-.1-2.9 .2-3.3 .8-5.8 0-4.3-1-2.9-1.9 .6-.6 3.8-1.3 10.5-2.5 4.3 .9 1.4-.1 2.2-1.7 .5-1.4-.3-1.5-1.2-1.4-2.2-1.4-1.2-1.9-.6-12 .4-3.3 .5-.5 2.9 3.8 2.4 4.8 1.9 5.7 .7 5.8 .7 2.8 2.1 2.4 2.7 5.5 3.8 4.3 2.9 2.2 3.3 1 3.4-.4 6.2-3 7.1-4.5 7.3-5.6 6.6-5.9 5.9-6.5 3.7-5.3 1.7-4.2 .1-2.9z", light: "M55.6 22.8l1.9-.3 1.5 .3 .6 1 .1 .9-2 4.3-3.8 5.3-5.8 6.2-5.4 4.4-4.8 2.3-1.4 0-1.2-.5-.8-1.9 .5-3.3 2.5-4.8 3.3-4.3 2.4-2.4 5.3-3.9zM19.3 28.1l-1.4 2 .3-1.1zM21.7 49.1l.6 .5-.3 .5-.8 0zM35.8 52l1.2-.4 .9 .7 .7 1.6-.4 .9-1.2 .1-2.6-.5zM7.2 52.9l-2.9 2.9 1.2-1.6z", eyes: [[72.5, 48.4, 9.3, 23, -15.8], [85.6, 43.4, 7, 22.9, -21.2]] },
  octopus: { label: "Octopus", body: "M50 6C75 6 87 24 87 46C87 60 82 68 80 72C84 82 84 92 80 96C76 98 72 92 70 84C68 92 66 98 61 96C57 94 56 84 54 78C52 80 48 80 46 78C44 84 43 94 39 96C34 98 32 92 30 84C28 92 24 98 20 96C16 92 16 82 20 72C18 68 13 60 13 46C13 24 25 6 50 6Z", shade: "M87 46C87 60 82 68 80 72C84 82 84 92 80 96C76 98 72 92 70 84C68 92 66 98 61 96C57 94 56 84 54 78C62 76 70 66 75 56C80 48 80 36 75 26C82 32 87 38 87 46Z", light: "M30 22C36 14 44 11 50 11C40 14 33 20 30 28Z", eyes: [[40, 36, 6.5, 11, 0], [60, 36, 6.5, 11, 0]] },
  star: { label: "Star", body: "M40.1 4.4l1.5-.4 1.9 .1 5.2 1.1 1.9 .9 13.2 14.9 17.1-.8 5.2 1.1 1.8 .9 1.7 1.6 .7 2.4-.4 1.9-9.7 23.6 5.6 23.7 .1 1.9-.6 1.4-2.1 1.8-2.3 .5-19.9-1.8-16.6 15.5-1.9 1-1.9 .3-7-1.5-2.6-2.1-.9-2.4-2.8-24.1-16-13.6-1.1-1.5-.5-1.9 .4-1.9 1.2-1.5 18.9-13.6 7.1-24.6 1-1.7z", shade: "M52 7.7l14.3 16.1 1 2.9 .3 3.1 19.4-1.3 2-1.4 .7-2.3-.4-1 .5 .5 .5 1.9-.4 1.9-9.8 23.2 5.5 23.1 .1 3.4-2 2.4-2.8 .8-19.4-2.1-1.9 1.4-14.7 14-2.4 1.4-3.3 .1-4.7-1-2-1 .6-.2 3.3 .8 2.8 .1 5.1-2.1 .7-.9 .4-2.4-2.6-22.7-.3-.3-1.4 .2-1.4 .7-5.7 .7-5.6-1.2-16.7-13.8 1-.1 5.2 1 3.8-1.1 1-.7 1.9-.4 .4-.4 1.5 .3 .4-.4 1 .2 18-12.8 6.7-23.5 0-1.8-.4-.5-.3-1.9 .4-2.4z", light: "M40.1 4.4l2-.1 4.7 1 .7 1-.5 1.4-2.8 1.5-6.6 23.1 .7 1.2 .6 .3-18.1 12.5-1.8 2.1-3.4 .7-5.2-1.2-.3-.4 .3-.9 1.4-1.4 18.3-12.9 .9-2.3 6.4-22.7 .8-1.4z", eyes: [[53.9, 53.4, 7.2, 18.8, -10], [65.1, 49.2, 7.2, 18.8, -10]] },
  moon: { label: "Moon", body: "M45.8 4.2l4.7-.2 4.2 .4 10.2 2.4 3.7 1.6 3.6 2.1 3.3 2.5 3 3.1 4.6 6.7 3.4 8.3 1.5 8.8 .1 4.6-.8 7.8-2.6 8.8-3.9 7.7-5.1 6.7-6.1 5.3-4.1 2.6-3.6 1.6-27.2 10.2-2.8 .7-2.6 0-5.7-1.3-2-.8-1.9-1.7-1.1-2.6-6.5-37.7-.2-5.2 .8-7.7 1.3-5.2 3.1-7.8 4.2-6.7 3-3.6 3.9-3.6 6.3-4.2 4.1-1.8z", paints: [["M57.6 9.9l.2-.3 .2 .3 2 4.7 1.9 1.9 2.6 .5 1.5-.7 1.1-1.1 .4 .4-.1 1.6-.7 1.5-2.2 2.5-1.6 .7-2 0-1.6-.8-1.3-1.4-.8-2-.4-2.6 .1-3.1z", "#1783FF", 1]], shade: "M74.3 13.5l2.1 1.5 .3-.4-.3-.6 2.1 2.1 4.6 6.7 3.1 7.4 1.5 7.6 .1 10.4-.6 4.6-2.5 8.3-4.2 8.2-3.1 4.2-5.7 5.7-6.2 4.2-4.6 2-28 10.3-4.1 0-5.2-1.1-2-.9-.5-.7 .5 .5 1.5 0 3.6 1 2.6-.3 5.7-2.1 2.1-2.1-5.4-31.5-.2-4.1 .4-1.1-.1-2.6 .5-3.6 1.8-7.7 2.8-6.7 1.9-3.1 3.9-5.2 3.2-3.1 2.5-2 5.2-2.9 3.1-1.1 3.1-.8 2.1 0 .5-.4 2.6 .2 1-.3 1.6 .4 1-.5 2.1 .8 1-.8 2.1 1.2z", light: "M38 6.3l1.7-.3 2.5 .2 .6 .4 1.5 0 .5 .5 1.6 .3-3.1 1.3 .4 .7-2.5 1.6-.5 1-2.5 2.1-2.7 2.9-6.2 7.9-1.5 2.7-1 .9-1.2 2.6-1.4 1-1.3 3.7-1.3 .3-6-1.4-1 3.6-.8 0 .9-3.6-.5-1 1.1-3.6 2.7-5.7 4.1-6.2 5.7-5.8 3.1-2.4 3.6-2.2z", eyes: [[51.6, 48.5, 8.4, 22.1, -10], [66.8, 42.9, 8.4, 22.1, -10]] },
  wave: { label: "Wave", body: "M46.1 4l6.1 .3 9.6 2.1 4.5 1.8 4.1 2.4 3.5 2.8 4.4 4.8 2.6 4 2.1 4.1 2.2 6 4.8 26 .5 5.3-.3 4.1-1.2 3.8-1.5 2.8-2.4 2.5-2.1 1.4-3.1 1-3 .3-8.1-1.5-3.2 5.3-2.1 2.1-2.5 1.5-2.8 1-3 .4-9.1-1.6-2.7 4.2-3.4 3.1-4 1.7-4.6 .1-7-1.5-3.5-1.9-3.4-3.5-2.1-4-1.5-5.6-3.7-20.7-.6-5.6-.1-5 .5-6.1 2.3-9.6 2.3-5.5 2.7-4.9 2.7-3.7 3.2-3.6 4.2-3.6 4.7-2.9 4.4-2 4-1.2z", paints: [["M61.6 48.5l2.2-.3 2 1.1 1.1 2.2 .3 3-.6 3.1-1.5 3.5-2.5 4.1-2.4 2.8-5-2.2-3-2.2-2.3-3-.7-3.5 .6-2.6 1.8-2.1 1.6-.7 1.5 0 1.5 .6 1.5 1.3 2-3.6z", "#fff", 0.4]], shade: "M69.3 13.6l2.6 1.3 .5-.3 .5-1.3 2 1.7 .5 0 2.5 2.7 3.5 5.5 3.6 8.6 1.5 6.6 3.5 19.7 .5 5.5-.4 4.6-2 5-1 1.6-2.6 2.5-3 1.5-2.1 .5-4 0-6.6-1.4-1.4 2.9-1.9 2.5-2.7 2.6-3.1 1.5-2.5 .6-4 .1-7.1-1.5-1.5 2.8-2.6 3-2 1.6-3 1.4-4.5 .6-7.1-1.5-3.6-1.5-3.5-3.1 6.6 1.5 2.8-.5 .5-.5-.3-.5 3.2-2-.4-1 1.4-1.5-.3-1 .7-1.6-.2-2.5-3.4-19.2 .3-.5-.6-5 .5-.5-.1-4.6 .4-.5 .3-4 1-4.1 1.5-4.5 3.8-7.7 5.5-6.9 3.1-2.6 6.5-3.9 7.6-2.2 3.1 0 .5-.4 3 .5 1-.5 2.5 1z", light: "M36.5 6.1l2-.3 .5 .6 4.1 .5 1 .7-3.3 1.5-.3 1.2-3 2-.3 .8-2.8 2.6-3.5 4-3.9 5-2 3.6-1 .5-1.7 4-1.5 .5-1.4 4.6-1.6 .2-.5-.4-5.6-.9-.4-.4 1.4-5.1 1.5-3.5 2.6-5.1 4-5.5 6.6-6.2 4-2.5z", eyes: [[47.5, 37.2, 8.4, 22.1, -10], [61.6, 31.9, 8.4, 22.1, -10]] },
  squircle: { label: "Squircle", body: "M54.5 4.2l3.9-.2 3.7 .3 11.6 2.7 3.1 1.6 2.8 1.9 2.6 2.7 2.2 3.1 2.4 4.8 1.9 5.8 3.7 19.4 .8 11.1-.4 4.7-1 4.7-1.3 3.5-1.8 3.4-4.8 5.8-6.4 4.7-8 4-14.2 5.3-9.5 2.2-7.4 .1-10.5-2.2-5.3-2.5-4.3-3.7-3.3-4.8-2.7-6.3-2.4-9.5-2.8-17.9-.2-7.8 1.3-7.9 2.2-5.3 2.8-4.2 4.1-4.2 4.3-3.1 6.3-3.4 11.6-4.6 7.9-2.7z", shade: "M80.5 11.6l2.1 2.1 2.1 3.2 3.2 7.3 2.1 8.4 2.7 15.8 .5 7.9-.6 7.4-2 6.3-3.8 6.3-4.2 4.3-2.6 2-6.9 3.8-15.2 6.2-9.5 2.7-6.8 .6-6.2-.7-8.5-2-5.8-3.2-3.2-3.3 .5 .4 1.1-.2 5.8 1.4 2.1-.8 1.4-.7-.3-.5 1.4-1.1-.1-1 .8-.5 0-1.1 1.1-1 .1-2.1 .4-.6-.2-3.6-2.4-17.9-.2-9.5 .8-5.3 1.1-3.6 1.2-2.7 2.2-3.5 2.7-2.8 3.1-2.5 5.8-3.2 17.9-6.9 5.3-1.4 8.4-1.4 1.6-1.1 .5 .1 .9-1.5z", light: "M39.4 8.4l1.2 0-1.6 .7-1-.1 1-.1zM36.8 9.5l1 0 .6 .9 4.2 .6 .7 .6-3.8-.4-.3 .4 1.9 .3 .1 .7-3.2 1.6-6.9 5.8-5.3 6-4.7 6.1-3.8 3.7-.2 .5-1.8 .1-6.8-1.7 .4-3.6 2.1-4.2 2.2-3.2 4.2-4.3 4.2-3 3.1-1.8 5.3-2.5zM35.1 10.5l1.7 0-.5 .4zM36.5 11.1l.3-.5 2.2 .1 .4 .4-.4 .3z", eyes: [[52.6, 52.4, 8.4, 22.1, -10], [67.3, 46.9, 8.4, 22.1, -10]] },
  zed: { label: "Bull", body: "M77 4.4l1.1-.4 1.1 .2 1.2 1.3 2 9.8 2.2 5.9 .4 2.8-.3 2.1-.8 1.7-4.7 5.1-1.3 1.9-.4 1.7 .1 1.6 1 1.7 4.4 .2 3.8 1.3 2 1.7 .6 1.6-.3 1.7-.7 1.1-3.5 2.7 1.7 6 .4 5.9-.8 6.6-1.9 6-3.4 5.9-4.4 5.3-5.5 4.4-6 3.1-6.5 2-7.1 .7-6.5-.7-6.5-2.1-6-3.4-4.8-4.4-3.5-4.9-3.1-6.7-3.3 1.1-2.7 .3-2-.6-1.1-1.1-.3-2.2 .9-2.7 2.9-3.8 4.6-3.8 1.8-7.1-6.3-1.8-1.6-1.3-1.3-1.8-.6-2.7 0-6.6-1.4-8.7 .2-1.1 1.5-1.4 1.1-.1 1 .5 5.5 7.9 2.2 2.2 2.7 1.4 4.9 .4 .5-.1 6.5-5.1 6.6-3.2 6-1.6 8.7-.7 3.8-.9 2.7-1.5 3.9-3.2 3-3.8 2.4-4.9 2.1-10z", paints: [["M61 36.5l1.9 .7 1.4 2-.7 5.4 .3 .4 2.8-1.2 1.1 0 1 .9 .5 1.6-.5 .8-1 .5-7.1 2.4-1.1-.5-.9-1.6 1.4-5.4-.5-.6-3.3 1.1-1.1-.1-1.6-1-1-1.6 .5-.9z", "#fff", 1]], shade: "M80.2 5.5l.6 1.6 1.3 8.2 2.5 6 .2 3.7-.1 1.1-1.2 2.2-5.2 5.4-1.1 3.3 .9 2.7 3.8 3.9 1.6 .1 4.4-1.4 1.2 1.2 .1 1.1-.2 1.7-.6 1.1-3.6 2.7 .9 2.2 1.1 5.4 .1 6-1.1 6.5-2.3 6-3.8 6-6 6-4.9 3.3-5.9 2.6-7.1 1.7-7.1 .1-6-1.1-5.9-2.3-4.4-2.7-4.4-4.5 3.8 .4 5.5-1.5 7.6-3.9 6.8-4.7 7.9-6.5 7.1-6.9 5.4-6.5 4.4-6.7 1.8-4.4 .4-3.2-.3-1.1-3.3-3.8-.8-2.8 .8-2.7 6.2-7 .8-2.2-.1-2.7-1.7-4.4-.8-8.2zM14.9 29.9l.1-.5 4 6.5 2.3 2.7-1.4 .1-2-.6-3.6-7.1zM24.3 44.6l1-.3 1.1 .2 3.3 2.9 1.7 .5 .3 1.6-.5 2.2-1 1.6-1.6 1.5-1.6 .7-1.7 .1-3.2-2.2-2.2 0-2.7-.6-2.9-1.6 3.9-1.6 2.2-1.7 2.2-2.3zM21 68.6l.5-.5 1.1 .1 1.1 .5 .8 1 .6 2.7-.1 1.1-.7 1.1-.6 .1-2.2-1.2-2.7 1.1-3.8 .6-2.7-1.2 3.4-1.6z", light: "M77 4.4l.6-.2 .1 .7-1.2 .8-.1-.8zM74.2 15.8l.6 1.1 .1 2.7-.6 2.2-1 1.6-5.5 5-1.7 .7-3.3 .3 .1-.6 2.1-1.2 4.2-3.6 2.7-3.9zM11.7 28.9l.8 0-.1 .5-1.2 .8-.1-.8zM44.3 32.1l3.1 0 .8 1.1 0 1.1-1.9 4.3-3 4.1-1.7-1.1-2.1-.8-4.4-.6-4.4 .1 5.5-4.4zM22 54.4l.6 0-.3 .6 .2 .5 2.3 2.7 .4 1.7-1 .9-4.8 2.3-7.1 7.8 0-1.8 2.1-3.3 6.4-5.4 1.2-4.3z", eyes: [[61.8, 69, 9.5, 22.3, -10.5], [78.4, 62.7, 6.9, 22.2, -11.2]] },
  hex: { label: "Blossom", body: "M38.8 4.2l2.6-.1 6 1.3 2 1.3 3 3.3 12-4.5 2-.5 6.5 1.1 2.9 1.6 4.9 6 .8 2 .3 2-.2 2.5-1.9 7-1.3 2.2-1.9 1.8 2.9 1.3 1.8 1.7 10.1 12.5 1.5 3 .1 4-1.8 7-.9 2-2.8 2.7-7.1 2.7-5.2 20-.8 2-1.4 1.9-1.5 1.1-6.5 2.6-3 .2-6.5-1.6-2-1.4-4-4.9-16 5.7-2 .1-4.5-1-3-1.2-5.2-6-1.3-3 0-3.5 2-8.5-10.8-13.4-1.4-3-.3-2 .3-2.5 1.7-6.5 1.8-3 2.2-1.8 5.9-2.2 2.1-.4 2.5 .3 .4-.4-.7-2.5 .1-2.5 4.8-18.5 1-2.5 2.9-2.9z", shade: "M49.7 7.7l.2-.4 .5 .4 2 2.3 0 .7 1.6 1.5 1 2 .1 1.5-.3 .5 .6 1.3 17.5-6.5 2.5-1.3 1-1.5 4.5 6 .6 1.5 .3 3-1.9 8-1 2-3 3-.3 1 .4 .5-1.7 3 .1 .5-.5 .5 0 .7 5.5-2.2 1.5-1.5 2 2 8 10 1 1.5 1 2.5-.1 4-1.9 7-1.1 1.9-2.9 2.5-6.8 2.5-4.7 19-1.5 3.5-2.5 2.5-6.5 2.6-4 0-5.5-1.4-2.2-1.7-3.2-4 4.9 .8 2.5-1.4 1.5-2.6 .7-2.3 1.7-6.5-.4-.3-.6 .8-.7 3.5-1.1 1.5 .3 .5-.3 .5-.7-.5-1.4-5.5-.5 1-.2 2-.9 1-.1 1.5-1.1 2-2.7 2.8-1 .4-1 .1-15.5 5.8-3-.1-4.5-1-2-1-2-2-2.2-3 .2-.2 4 .9 2-1.1 1.7-1.6 1.3-3.2 1.7-6.3 1.1-2.5-.3-.3-.5 .2-6.5-.3-.5-.5-2 0-.5-.5-1.7-.1-10.4-13.4 4.1 .7 3.1-1.7 1.3-2 2.5-8.5 .9-1.5 1.7-1.3 6.5-2.7 2-1.5-.3-.5 .3-.5 1.5-1.2 1.5-3 5.6-20.3 1.9-2 6-2.4 1.1-.6zM73.2 31.2l1.5 0-.8 1-34 12.7-1 .1-1.5-.5-2 .8-1.9-2.6 .4-.9 2 .5 1.5 1 .5-.4 1 .5 1-.3 1 .4 3-1.5 1 .1 3-1.6 1 .1 3-1.6 1 .1 3-1.6 2.5-.5 1.5-1 2.5-.5 1.5-1 2.5-.5 1.5-1 2.5-.5 1.5-1 1 0zM61.3 74.6l.1-.2 .4 .2-.4 1.7z", light: "M33.4 6.2l3 .1 1.9 .9-.1 .5-1.8 2.5-3.4 3.5-4.5 17-3.6-.9-1 .4 0-1 4.4-16.5 0-1.5 2.1-3.1zM68.2 6.2l1.2 0zM14.9 37.7l3.5 .9 .4 .6-.3 1-5 5.5-1.1 4.6-2.5-.5-2 .1 0-1.7 1-4.5 1-2.5 2-2.1zM19.4 71.6l4 .7 1.8 .8-1.2 1-1.1 5.1-4.5-.5-.5-.6 1.4-5z", eyes: [[49.8, 55.5, 6.7, 17.7, -10], [61.6, 51.1, 6.7, 17.7, -10]] },
  gumdrop: { body: "M38.7 4.5l4.4-.5 4.6 .8 4.1 1.9 3.7 3.2 23.2 36.6 2.3 5 1.4 5.1 .7 6.4-.7 6.4-1.8 6.1-3.1 5.7-4.1 5.1-5.2 4.2-5.8 3.1-6 1.8-6.4 .6-6.4-.6-6-1.8-5.9-3.1-5.1-4.2-4.1-5.1-3-5.4-1.9-6.4-.7-6 .5-5.9 9-41.6 2-4.1 2.6-3.2 3.4-2.5z", shade: "M54.9 9.5l1.9 2.3 22.9 36.5 1.8 4.6 .9 3.7 .6 4.1-.1 5.9-1.4 6.4-2.3 5.5-3.7 5.4-4.1 4.2-4.5 3.3-7.3 3.2-6.4 1.2-6.4 0-5.1-.9-5.9-2.1-5.5-3.3-4.6-4.1 .5-.3 4.1 .8 5.5-1 6.4-2.6 7.3-4.5 7.2-5.7 6.5-6.4 5.5-6.9 3.5-5.9-18.1-37 1.1-3.7 .2-2.3z", light: "M37.1 4.9l2.5 0 .8 1.4-.5 2.1-1.8 2.9-3.2 3.2-3.2 2.1-2.3 .7-1.8-.1-.7-.9 .1-1.8 2.4-4.1 2.7-2.8z", eyes: [[52.1, 40.3, 9.7, 22.9, -15.2], [64.8, 35.6, 6.3, 23, -27]] },
  peanut: { body: "M43.5 4l6.6 .7 5.8 2.2 5.4 3.8 4.1 4.7 2 3.8 1.4 4.3 1.3 11.9 1 4.3 1.6 3.8 5.8 10.5 1.4 3.8 .8 4.3 .1 6.2-1 5.7-2.1 5.5-3.2 4.9-4.1 4.3-4.8 3.4-5.6 2.4-5.7 1.3-6.1 .1-5.8-1.1-5.7-2.2-4.7-3.1-4.3-4.1-3.3-4.8-2.5-5.7-1.2-5.7-.1-6.7 1.7-9 .4-4.3-.5-4.7-2.5-9.6-.6-3.8 .2-5.2 1.2-5.2 1.5-3.4 2.2-3.3 2.5-2.9 2.8-2.3 3.4-2.1 3.4-1.4 3.8-.9z", shade: "M62.7 12.6l2.6 2.8 2.8 5.8 1.1 4.2 1 11.9 1 3.4 2.3 4.7 4.2 6.7 1.9 4.7 .9 3.8 .2 2.9-.1 6.2-.5 3.3-1.9 5.3-3.4 5.7-3.4 3.8-4.2 3.3-5.7 2.9-4.8 1.4-5.7 .6-6.2-.6-3.8-1-5.2-2.3-4.8-3.4-2.9-2.8 3.9 .8 5.2-.7 6.2-2.5 5.7-3.3 6.7-5.1 6.2-5.9 5.1-6.2 3.5-5.7-1.1-2.8-2.4-2.4-3.2-1.7-11.5-4.1-2.7-1.8-1.6-2.4-.2-2.4 .8-2.9 7.8-8 4.9-7.7 1.6-5.2z", light: "M35.9 5.4l3.2-.2 1.3 .7 .5 1-.5 3.3-2.9 4.8-4.1 4.1-4.8 3.3-4.2 1.5-1.5 0-1.4-.6-.7-1.2 .2-2.4 1.9-3.8 2.4-3.3 4.3-3.9z", eyes: [[50.9, 31.5, 8.7, 20.5, -11.9], [64.2, 26.5, 5.7, 20.3, -16.3]] },
  saucer: { body: "M45 22.7l6.7 .1 6.7 1.9 4.3 2.5 3.5 3.1 2.8 3.5 2.5 4.5 6.8 .9 5.6 1.2 4.5 1.6 3.5 2.1 2.8 2.8 1.3 3.5-.5 3.5-2 3.5-2.6 2.8-3.5 2.8-4.5 2.8-5.1 2.6-12 4.4-13.6 3.1-13.6 1.5-12.6-.3-5.5-.7-5-1.2-4.1-1.6-3.5-2-2.8-3.1-1.1-3 .5-3.5 2-3.6 2.7-3 3.7-2.9 10.3-5.6 .7-5.1 1.5-4.5 2.6-4.5 3.1-3.5 3-2.4 3.5-2 3.5-1.4z", shade: "M66.5 31.3l.3-.2 .6 .7 1.9 2.5 2 4.5 1.6 1.5 .1 1.5-1.7 1.7-3 1.2-3.1 .5-3.1-.3 4-8.1 .7-3.5zM94.9 47.4l1.1 3-.5 3.5-2.1 3.5-4 4.1-5 3.5-6.1 3.1-7 2.9-6.6 2.1-8 2-9.1 1.5-6.5 .6-11.6 0-4.5-.2-8-1.4-4.6-1.5-3.6-2.1 4.1 1.2 5.1 .8 7 .3 6-.2 15.1-1.9 15.6-3.6 14.5-5.1 5.4-2.5 5.3-3.1 4-3 2.3-2.5 1.2-2.1zM7.3 71l.7 .5z", light: "M40.6 23.7l2.8 0 .8 .5 .7 1.5-.8 3.6-2.6 4-3.9 4-4.5 3.2-4.6 1.7-2.5-.4-1-1.4 0-1.6 .9-2.5 2.1-3.5 2.6-3 3-2.6 3.5-2.1zM22.4 47.4l.7 0-.5 .5 0 1.5 .4 .8 2 1.4 3 1.2 9.1 2 15.1 1.1-.2 1.5-2.2 3.6-3 2.5-4.9 2.5-6 2-7.9 1.5-6.5 .5-7.1-.4-4.9-1.1-3-1.5-1.6-1.7-.6-2.3 1.1-3.1 2.9-3.5 4.1-3.5 4.1-2.6z", eyes: [[53.6, 45, 7.8, 18.4, -14.5], [66.2, 40.3, 5, 18.3, -25.1]] },
  bunny: { body: "M49.3 4.4l1.5-.4 2 1.2 1.6 2.7 1.2 3.4 1.6 8.9 .2 6-.2 6.4 .6 3 2.4 2.5 5.4 3 3.4 2.4 5.1 5.5 2.4 3.9 1.7 4 1.1 4.4 .4 4.5-.5 5.9-1.6 5.5-2.8 5.4-3.6 4.5-4.6 3.8-4.9 2.7-5.5 1.7-5.9 .7-6-.5-5.4-1.7-4.9-2.5-4.7-3.7-3.8-4.5-2.7-4.9-1.8-5.5-.7-5.9 .6-6.5 1.9-5.9 3.1-5.4 4.6-5.5-.4-2-3.4-8.4-1.8-6.9-.6-6.9 .3-3 .6-2 1.3-1.4 2-.1 2.5 1.5 2.1 2.5 4 6.9 2.1 5.5 1.7 5.9 1.5 2.1 1.8-1.6 .7-2-.4-12.4 1-8.9 1.6-4.9z", shade: "M52.7 5.4l2.1 3.5 1.9 7.4 .7 7.9-.5 8.4 .8 3.6-4.4-2.5-2.1-2.6 1.4-17.3zM31.2 15.3l.3-.5 2 2.5 2.9 4.9 2.5 6 1.7 6.4 1.4 2.5 0 .5-1.1 .9-4.5 1.9-2.4 .2-1.2-.6zM71.5 46l3.6 4.4 2.9 6 1.5 6.4 .1 5.5-1.1 6.3-2 5-3.4 5.4-3.5 3.6-4 2.9-6.4 3-4 1-6.9 .5-5.9-1-5.5-2-5.4-3.5-3.6-3.4 2.6 .7 2.5 .1 2.9-.5 4-1.3 8.4-4.6 8.7-6.8 7.4-7.9 5.3-7.9 1.3-3 1-3.5 .2-2.9-.2-2z", light: "M49.3 4.4l.6 0-3.6 6.2 1-3.7zM26 13.3l.5-.4 .2 .4-1.7 2.2 0-.7zM44.8 34.6l.5-.1 1.2 1.1 .8 1 0 .7-.5 .3-4-.5zM45.1 42.5l.8 0-.3 1-2.4 4.5-3.8 4.4-4.1 3.5-3.8 2.4-4 1.6-2.9 .1-1.8-1.1-.4-2.5 1.1-3.5 3.5-5.4 3-3.1 .2 1.6 .8 .8 3 .1 4.4-1.2z", eyes: [[59.2, 69.2, 8.2, 19.3, -12], [72.9, 64, 5.6, 19.1, -15.4]] },
  kitty: { body: "M62.4 4.2l1.6-.1 1.5 1.2 7.4 21.3 3.7 6.4 6.2 7.4 3.1 5.9 1.5 4.8 .7 5.3-.2 5.4-1.1 5.3-3 7.4-4.4 6.4-5.3 5.4-6.9 4.6-7.5 3.1-8 1.7-8 .2-7.4-1.4-4.3-1.5-3.7-1.8-3.8-2.5-3.1-2.7-2.7-3-2.5-3.7-1.9-3.7-1.4-4.3-.9-5.3 .1-5.8 1.4-7 1.6-4.2 2-3.8 .8-3.2 .2-20.2 1.1-1.4 1.1-.3 1.1 .3 12.2 9.7 5.9-2.5 8-2.1 3.2-1.8 2.3-2.4 8.3-16z", shade: "M64.9 5.8l.1-.3 .7 .3 6.5 19.7 3.1 5.9 2.5 3.2-1.6-.8-2.6-2.4-5.1-8zM79.4 36.7l2.2 2.1 1.6 2.2 3.3 6.9 1.5 6.9-.1 6.4-1.6 7.5-3.1 6.9-3.8 5.3-5.3 5.4-6.4 4.3-7 3.1-6.3 1.6-4.3 .6-5.3 0-7.5-1.1-5.8-2-5.9-3.3-5.9-5.4 2.7 .7 3.2-.1 3.7-.8 5.2-1.9 10.3-5.5 11-7.8 10.7-9.6 7.8-9.1 3-4.6 1.6-3.4 .7-3.2z", light: "M62.4 4.2l.5-.1 0 .6-.8 1.1-4.5 14.4 .2 2.7-.3 1.6-1.1 1-2 .6-6.9-.5 2.6-1.3 3.1-3 8.1-16zM18.7 20.7l1.1-.5 0 .8-1.1 .9-.6-.1zM39.5 27.7l2.6-.3 1.9 .8 .4 1.6-.7 1.8-4.2-1.5-5.4 .2 0-.5zM16 47.4l.3 4.2 1.6 2.2 3 2.1-.6 .5-3.7 .6-1.1-.3-1.1-1.1-.4-1.8 .4-2.7z", eyes: [[59.6, 65.1, 9.4, 22.6, -11.9], [77.5, 58.4, 7, 22.5, -14]] },
  beacon: { body: "M40 4.1l2.7 0 2.5 .9 2 1.7 1.1 2.1 .5 2-.2 2.1-2.1 4.1-.4 1.6 1.5 7.7 9-3.1 4.1-.2 18.5 4 3.1 1.6 2.4 2.3 1.3 2.1 .9 2.6 5.8 33.4-.4 3.1-1.3 3.1-2 2.5-2.6 1.9-41.7 15.7-4.1 .7-19.6-4-3.5-1.9-2.5-2.5-1.2-2.1-.8-2.6-5.7-32.9 .4-3.1 1-2.7 1.7-2.5 2.4-1.9 28.4-10.9-1.5-9.3-.7-1-3.5-3.3-.9-1.9-.4-2 .5-2.6 1.1-2.1 1.7-1.5z", shade: "M47.1 7.2l.4 0 .8 1.6 .3 2-.2 2.6-2.5 4.7 1.5 8.2 0 2 .5 .6 .1 1.5 .5 1-1.2 .4-1.3-.4-.3-.5-1.9-10.3-4.1-1.5-3.2-2.6 3.1-.9 3.2-2.2 2.5-2.6zM84.2 30.9l1.2 1.1 1.5 3.6 5.7 32.4 0 2.6-1 3.6-1 1.5-3.1 3.2-4.2 1.9-40.6 15-4.2 0-16.4-3.6-3.6-1.4-2.6-2.2 .5 .4 17.5 3.4 3.8-1.2 5-3.4 1-1.3-5.4-30.3 .2-.6 3.1-3.4 40.2-15.1 2-3.6z", light: "M38.5 4.7l2 0-.1 1-.8 1.4-2.6 2.2-1 .4-1.1-.1-.1-.8 .7-1.6 1.5-1.6zM55 23.7l1.1 .1-1.6 .6-.9-.2 .9 0zM52.4 24.7l1 0-3 1.2-.9-.1 2.4-.6zM48.3 26.3l1 0-1.5 .6zM40 29.4l1.1 0-3.1 1.2-.9-.2 2.5-.5zM35.9 30.9l1 0-3 1.2-.9-.1 2.5-.6zM31.8 32.5l1 0-3 1.2-.9-.2 2.4-.5zM40.2 33l.4-.4 1-.1 1.6 .8 3 .7-1.5 .5-4.1 0-.9-1zM27.7 34l1 0-3 1.2-1-.2 2.5-.5zM23.6 35.6l1 0-3 1.1-1-.1 2.5-.5zM19.4 37.1l1 0-2.4 .8-.5 .7 15.4 3.3 .5 .3 .3 1.1-1.1 2.6-3.3 3.3-3.1 1.5-17.5-3.6-.6-1.2 .5-1.6 3.2-3.7 2.1-1.4 2.5-1.1 1 0 .6-.5 1 0z", eyes: [[55.5, 65.3, 8.4, 22.1, -10], [74.2, 58.3, 8.4, 22.1, -10]] },
  plus: { body: "M44.6 4.3l3.3-.1 11.9 2.5 2.5 1.3 1.3 1.4 .7 1.6 2.1 11.4 4.1-1.2 2.1 0 12.3 2.6 2.8 1.6 1.2 1.5 .7 1.5 3.8 21.6-.5 3.1-1 1.5-1.3 1.3-17 6.6 3.4 20.4-.4 2.5-1.2 2.1-2.3 1.6-19 6.9-2-.2-11.9-2.5-2.5-1.3-1.3-1.4-.7-1.6-2.1-11.4-4.1 1.2-2.1 0-12.3-2.6-2.8-1.6-1.2-1.5-.7-1.5-3.8-21.6 .5-3.1 1-1.5 1.3-1.3 17-6.6-3.4-20.4 .2-2 1.1-2.2 2.6-2z", shade: "M63.2 9.4l.7 .6 .5 1.5 2.1 13.3 .6 .6 0 2.5 .5 .5 .1 2.6 .5 .5 .1 2.1-.8 3.1 19-7.1 1-1.2 1-2.1 1.1 2.1 .4 2.6 3.2 18 0 3.1-1 2-2.2 2.1-15.9 5.8-.8 .8 3.6 19.5-.1 2.6-1.5 2.6-2.2 1.6-16.4 6.1-2.1 .6-2.5 0-12.4-2.7-2.2-1.5 12.5 2.5 2.4-1 2.7-2-3.9-22.1-3.8 3.5-1 .4-2.6 .5-1.5 1-2.6 .5-1.5 1-2.6 .4-1.5 1-4.6 1.5-2.5 0-11.9-2.6-2.7-1.6 12.4 2.3 2.6-.9 2.4-1.9-3.4-20.5 .3-.5 1.7-1.8 18.6-6.9 .3-.6-.7-1-3.8-22.1 2.1-2.1 16.4-6.1 .6-.5z", light: "M28.4 10.5l1.1 .5 10.2 2.1 .5 .4-.1 1.1-1.9 2.3-2.1 1-12.3-2.5-.1-1.3 1-1.6 1.2-1zM11.4 43.3l11.4 2.2 1 .6 0 .8-1.5 2.3-2.6 1.4-12.3-2.6-.2-1.1 .6-1 2.2-2.1z", eyes: [[54.5, 53.1, 6.1, 15.9, -10], [64.5, 49.4, 6.1, 15.9, -10]] },
  magnet: { body: "M71.9 4.2l1.2-.2 12.1 2.6 .5 .3 .6 1 6.2 35.6 .6 5.8-.1 5.7-.7 5.8-1.5 5.7-2.2 5.8-4.2 7.3-5.5 6.5-6.5 5-7.1 3.4-6.3 1.3-6.3 0-15.2-3.1-5.2-1.8-5.2-3-4.6-4.1-4-5.2-2.9-5.8-2.4-7.8-6.4-36.2 25-9.5 13.1 2.9 .5 .9 6.3 35.3 1.8-3.9 .5-4.7-6.3-36.1 .4-.6z", shade: "M86.2 9.5l.5 1 5.8 33 .6 4.7 0 5.2-.6 5.8-2.1 8.4-3.1 7.3-3.7 5.8-6.3 6.8-5.7 4.1-5.8 2.7-6.8 1.5-6.3 0-15.2-3.1-5.7-2-5.2-3.2-5.9-5.8 .1-.7 11.5 2.5 .3-3.4-1.9-13.6-5.7-32.4 1-.1 18.3-6.9 .9-.9 .4-1 6.1 35 1.6 2.1 .1 .6 4 4.7 3.2 1.1 3.6-.6 3.2-1.9 2.4-2.8 1.9-4.2 .6-3.7-6.4-36.6 19.3-7.1 .8-.8z", light: "M53.6 54.5l.7-.4 12 2.8 .6 1.8-.6 2.1-2.1 2.4-2.6 1-1.5 0-6.3-1.4-1.6-2.6-.2-2.1z", eyes: [[59.6, 82.1, 6.1, 15.9, -10], [72, 77.5, 6.1, 15.9, -10]] },
  acorn: { body: "M47.6 4l2.1 .6 1.3 1.5 .4 1.5-.4 5.2 .3 .3 8.8-.1 7.7 1 7.3 2.1 5.7 2.9 3.6 2.9 2.6 3 1.8 3.4 .9 3.7 0 4.1-1 3.6-1.7 2.2-3.9 3 2.9 8.3 .9 8.3-.9 8.3-2.7 7.7-4.2 6.8-2.9 3.1-3.2 2.6-6.7 3.8-3.7 1.2-4.1 .8-7.2 0-7.3-1.7-7-3.6-5.9-5.1-4.8-6.3-3.3-7.3-1.8-7.7-.1-8.3-4.5-1.5-2.6-1.7-2.6-4.1-1.1-4.1 0-4.2 1.2-4.1 2.2-4.1 2.8-3.7 5.2-4.6 6.3-3.8 7.2-3.2 8.3-2.3 .9-8.3 1.2-1.4z", shade: "M50.6 6.1l.1-.5 .6 2-.6 5.7 .2 2.1-1.2 .2-1.2-.7 .5-6.8zM85.8 23.7l1.7 2 1.6 3.7 .6 2.6-.1 4.1-.5 2.6-1.1 2.1-2.1 2-2.9 2.1 1.4 3.1 1.6 5.2 .9 8.8-.5 5.7-1.4 5.7-2.2 5.1-2.6 4.2-5.1 5.7-5.2 3.6-4.7 2.2-6.2 1.5-7.7 .1-5.7-1.2-6.8-3-4.6-3.2-4.2-4.2 2.1 1 2.1 .3 3.1-.3 3.1-.9 6.4-3.1 6.5-4.6 6.6-5.8 5.9-6.4 5.6-7.9 4-7.4-2.4 .4-.5 .5-1.1 0-.5 .5-1 0-.5 .5-1.1 0-.5 .5-1 0-.5 .6-1.6-.1-.5 .5-1.6 0-.5 .5-3.6 .5-.5 .5-2.1-.1-.5 .6-2.1-.1-.5 .7-3.1-.2-.5 .5-3.1 0-.5 .7-4.7-.2-.5 .7-15.6-.3 0-.3 8.3-.6 11.4-2.4 11.4-3.8 10.5-4.8 9.2-5.7 6-5.2 2.2-2.6 1.6-2.9 .5-1.7z", light: "M46 4.5l1.1-.1 0 .6-1.5 1.6-1.1 .2-.1-.7zM38.5 15.9l5 0 3.3 1.6 1.6 3.1 .1 3.1-.9 3.1-1.9 3.1-3.2 3.6-4 3.1-3.6 2.1-8.5 3.2-4.1 .7-4.2 .1-3.1-.5-2.6-1.5-1.1-2 .1-2.1 .5-1.5 2.1-3.7 4.1-4.6 3.7-3.1 5.1-3.2 6.3-3z", eyes: [[63.6, 63.3, 9.6, 22.7, -11.9], [79.5, 57.3, 6.5, 22.5, -15.5]] },
  pebbles: { body: "M47.3 4.5l2.7-.4 2.7 .1 13.7 3 4.3 2.1 3.3 3.4 1.3 2.2 1 2.8 2 12-.5 4.3-3.1 7.7 .2 .5 8.4 1.9 2.7 1 3.3 2.1 2.7 2.8 2.4 4.3 1.4 6.5 .1 4.4-.8 3.8-1.3 2.7-2 2.8-2.4 2.2-2.7 1.6-45.5 17-3.3 .6-3.2-.2-19.2-4.2-4.9-2.8-3.4-3.8-1.9-4.4-1.3-7.7 .2-3.2 .8-2.8 1.3-2.7 2-2.7 3.2-2.8 7.9-3.8 2.5-2.2-.4-1.6-5.4-6.1-1.8-3.8-2.3-12.5 .2-3.3 .7-2.7 2.6-4.4 2.2-2 2.2-1.4z", shade: "M73.2 12.2l.4 0 1.5 2.2 1.2 3.3 1.8 11.4-.2 4.4-3.3 7.6 0 1.1 .6 1.1-1.2 1.3-26.8 10.1-3.2 .5-5.8-.4-15.2-3.3-1.4-.5-3.5-3.8 .2-.3 1.6 .2 10.9 2.2 2.8-.5 4.4-2.2 5-3.8 .1-.6-1.5-8.7 4-4.5 24.2-9.2 2.4-3.8zM90.9 48.8l2.8 3.8 1 2.8 1.2 6 0 4.3-1.1 3.9-1.7 3.2-3.8 3.9-2.7 1.7-42.1 15.8-5.5 1.6-3.8 0-18-3.8-4.9-2.1-3.4-2.9 17.6 3.8 2.7-.2 3.3-1.2 4.3-2.6 4.4-3.6-.4-3.8 4.4-4.9 42.5-16 2.1-3.1 1.1-2.8 .5-3.3z", light: "M45.6 5.1l1.5 0-.4 .2-22.9 8.5 11.4 2.5 .6 .8 0 1.6-1.5 2.8-1.9 2.2-2.8 2.1-3.1 1.2-13.2-2.8-.1-2.2 1.2-2.2 1.7-2.2 2.7-2.2 2.2-1.1 2.2-.5 .5-.5 2.8-.6 1.6-1.1 2.7-.5 1.7-1.1 2.7-.6 1.6-1 2.8-.6 1.6-1.1 2.8-.5zM21.6 53.2l15.8 3.6 1.2 .7-.1 .9-.8 .8-3.1 1.6-1.3 3.8-3 3.8-3.3 2.5-3.3 1.4-18-3.6-.6-1.3 .6-2.2 1.6-2.7 1.7-1.8 3.8-2.8 5.5-2.2z", eyes: [[51.2, 34.1, 6.9, 18.1, -10], [66.4, 28.4, 6.9, 18.1, -10]] },
  cushion: { body: "M64.2 4.4l3.3-.4 2.8 .2 3.9 .8 2.8 1.1 2.7 1.7 2.4 2.1 1.9 2.4 1.5 2.8 1.2 3.9 7.1 40.6-.1 5-1.4 4.5-1.6 2.9-1.9 2.2-2.2 1.9-2.8 1.7-45.6 17.1-3.4 .9-3.4 .2-4.5-.7-3.4-1.2-3.3-2-2.9-2.7-2.3-3.4-1.5-3.9-7.3-41.7 .1-5 1.4-4.5 1.6-2.9 1.9-2.2 2.2-1.9 2.8-1.7z", shade: "M82.1 10l2.9 4 1.6 4.5 7.3 42.2-.5 5.1-1.1 3.3-1.7 2.9-4.6 4.5-3.3 1.7-46.8 17.4-5.6 .2-4-.7-3.3-1.2-3.4-2.2-1.7-1.8 .6 .4 3.3 .2 4.5-1.2 5.1-2.8 5.3-4.4-6.9-39.4 5-5.7 43.9-16.4 2.3-3.6 1.1-2.8 .5-3.6z", light: "M62.3 4.9l1.8 .1-43.4 16.1 1.1 .4 .8 .9 .1 1.7-1.6 3.4-2.6 3-3.4 2.7-3.4 1.5-3.4-.2-.8-.8-.2-1.2 .4-1.6 1.7-2.9 3.4-3.5 2.3-1.6 3.4-1.6 5.6-1.8 .6-.5 1.1 0 .5-.6 2.3-.5 .6-.6 1.1 0 .6-.6 2.2-.5 .6-.6 1.1 0 .6-.6 2.2-.5 .6-.6 1.1 0 .6-.5 2.2-.6 .6-.6 1.1 0 .6-.5 2.2-.6 .6-.5 1.1-.1 .6-.5 2.2-.6 .6-.5 1.1-.1 .6-.5 2.2-.6 .6-.5 1.1 0 .6-.6 2.2-.6 .6-.5 1.1 0z", eyes: [[51.1, 57.2, 8.4, 22.1, -10], [69.9, 50.1, 8.4, 22.1, -10]] },
  ring: { body: "M48.1 4.3l8-.1 7.8 1.8 7.3 3.5 6.7 5.4 5.2 6.7 4.1 8.3 2.3 8.9 .7 9-1 9.5-2.5 8.9-4.1 8.3-5.3 7.3-6.6 6.1-7.3 4.5-7.8 2.7-8.4 .9-7.2-.8-7.3-2.5-6.7-4.1-5.6-5.3-4.5-6.5-3.5-7.8-2-8.4-.6-8.4 .9-8.9 2.2-8.4 3.5-7.8 4.9-7.2 5.8-6.1 6.3-4.5 7.1-3.3zM50.5 33.8l2.3-.3 1.7 .4 1.6 1.1 2 2.2 1.3 2.8 .8 2.7 .4 3.4-.1 3.3-1.4 6.2-3 5.6-2.2 2.4-2.2 1.6-2.3 1-2.2 .3-1.7-.4-1.6-1.1-2.8-3.7-1.5-5.2-.1-5.5 1.2-5.6 2.4-5 3.6-4z", shade: "M76.2 14.9l1.1-.5 3.4 3.8 2.8 3.9 2.3 4.5 1.6 3.9 1.6 5.6 1.1 8.3-.4 10.1-1.3 6.1-2.6 7.8-4.6 8.3-4.4 5.6-6.2 5.7-6.1 3.8-7.2 2.9-6.2 1.1-7.8-.1-7.2-1.7-3.9-1.6-4-2.2-5.5-4.5-2.8-3.4 1.7-.6 2.4-2.1 2-2.8 1.2-2.8 1.2-5 1.1-13.4 1.4-7.8 2.5-7.8 3.8-7.3 3.3-4.5 3.4-3.4 3.9-3.1 4.4-2.6 3.9-1.5 4.5-1.1 12.3-.9zM50.5 33.8l.6-.3 2.8 0 1.6 .9 2.7 2.8 3 1.4 3.3 .5 6.1 .2 3.9 .9 1.7 1 1.7 1.6 2.1 4.4 .7 4.5-.3 5-1.2 5-1.9 4.5-2.8 4.2-3.3 3.6-3.9 2.8-3.9 1.7-3.4 .6-3.3-.1-3.4-1.1-2.5-1.7-2.5-3-3.6-7-2.9-3.4-2.1-5-.6-5.6 .6-4.4 1-3.4 2.3-4.4 1.4-2.1 2.3-2.2 2.7-1.7z", light: "M41.1 5.9l.5 .1 .2 .5-.3 .6-12.4 13.3-13.1 18.1-2.3 2.1-1.1 0-.2-1.2 .2-2.8 1.6-5 4.6-8.3 3.9-5.1 4.4-4.4 4.5-3.4 5-2.8zM60.5 53.3l1.2-.3 1.1 .6 1.1 1.3 .8 1.8-.2 3.3-1.5 2.8-2 1.7-2.6 1-7.3 .2 2.2-1.4 2.6-2.6z", eyes: [[56.2, 84.6, 5.3, 13.3, -6.8], [71.7, 78.8, 5.1, 13.4, -6.5]] },
  gem: { body: "M57 9.3l2.9-.4 14.9 3.5 19.6 14.1 1 1.4 .6 1.6-.5 2.6-27.1 56.5-1.6 1.8-2.1 .7-15.9-3.4-42.9-30.7-1.3-1.6-.6-1.6 .5-2.6 12-25.2 1.1-1.5 1.5-1z", shade: "M75.7 14.6l.1-.4 .6 .2 16.9 12.3 1.1 .7 .5-.2 .5 .7 .6 2.6-.5 1.6-26.4 55.1-1.2 2.1-1.1 1.1-1.6 .6-2.1 0-14.3-3.3-42.8-30.7 1.5-.2 11.6 2.5 2.2-.7 2.8-2.6 11.9-24.9 .6-.8 38.2-14.2z", light: "M19.1 23.6l1.1-.4 .5 .5 11.7 2.2 1 .9-.2 .5-1.8 2.7-11.7 24.4-1.6 .6-13.3-2.8-.5-.5 12.1-25.4 1.2-1.7z", eyes: [[51.4, 42.9, 6.7, 17.7, -10], [66.1, 37.4, 6.7, 17.7, -10]] }
};
var PICKER_SHAPES = Object.keys(CHARACTERS);
var PICKER_COLUMNS = 6;
var DEFAULT_SHAPES = ["star", "moon", "gumdrop", "peanut", "bunny", "kitty", "acorn"];
var FALLBACK_SHAPE = "gumdrop";
var MAIN_LOOK = Object.freeze({ shape: "octopus", color: "deepseek" });
var CHARACTER_COLORS = ["black", "brown", "red", "orange", "yellow", "green", "cyan", "blue", "violet", "magenta", "gray", "aurora"];
var DEFAULT_COLORS = CHARACTER_COLORS.filter((color) => !["black", "gray", "brown"].includes(color) && !GRADIENTS[color]);
var isColor = (color) => isHex(color) || Object.hasOwn(INKS, color);
function fnv1a(text) {
  let value = 2166136261;
  for (let index = 0; index < text.length; index += 1) value = Math.imul(value ^ text.charCodeAt(index), 16777619);
  return value >>> 0;
}
function defaultColor(id) {
  const t = fnv1a(id) + 1831565813 | 0;
  let n = Math.imul(t ^ t >>> 15, 1 | t);
  n = n + Math.imul(n ^ n >>> 7, 61 | n) ^ n;
  return DEFAULT_COLORS[Math.floor(((n ^ n >>> 14) >>> 0) / 4294967296 * DEFAULT_COLORS.length)];
}
function defaultShape(id) {
  let value = fnv1a(id) | 0;
  value = Math.imul(value ^ value >>> 16, 73244475);
  value = Math.imul(value ^ value >>> 13, 3266489909);
  return DEFAULT_SHAPES[((value ^ value >>> 16) >>> 0) % DEFAULT_SHAPES.length];
}
var colorOf = (bot) => isColor(bot?.color) ? bot.color : bot?.id ? defaultColor(String(bot.id)) : "black";
function lookOf(bot) {
  const avatar = bot?.avatar ?? {};
  return {
    shape: hasShape(avatar.shape) ? avatar.shape : bot?.id ? defaultShape(String(bot.id)) : FALLBACK_SHAPE,
    image: avatar.image,
    color: colorOf(bot)
  };
}
var SHAPES = {};
for (const [id, character] of Object.entries(CHARACTERS)) {
  const layers = [
    ...(character.paints ?? []).map(([d, fill, opacity]) => `<path d="${d}" fill="${fill}" fill-opacity="${opacity}"/>`),
    `<path d="${character.shade}" fill="#000" fill-opacity=".14"/>`,
    `<path d="${character.light}" fill="#fff" fill-opacity=".16"/>`
  ].join("");
  SHAPES[id] = { label: character.label ?? id[0].toUpperCase() + id.slice(1), size: 100, path: character.body, layers, eyes: character.eyes };
}
var hasShape = (id) => typeof id === "string" && Object.hasOwn(SHAPES, id);
var shapeId = (id) => hasShape(id) ? id : FALLBACK_SHAPE;
var shapeOf = (id) => SHAPES[shapeId(id)];
function bodyOf(def, paint, flat = false) {
  if (def.path) return `<g fill-rule="evenodd"><path d="${def.path}" fill="${paint}"/>${flat ? "" : def.layers}</g>`;
  try {
    return def.body(paint);
  } catch {
    return "";
  }
}
var PUPIL = "#0a0f1f";
var pupilMarkup = ([cx, cy, w, h8, tilt]) => `<g transform="translate(${cx} ${cy}) rotate(${tilt})"><g class="bt-eye"><rect x="${-w / 2}" y="${-h8 / 2}" width="${w}" height="${h8}" rx="${w / 2}" fill="${PUPIL}"/><circle cx="${w * 0.12}" cy="${-h8 * 0.24}" r="${w * 0.3}" fill="#fff"/><circle cx="${-w * 0.16}" cy="${h8 * 0.22}" r="${w * 0.12}" fill="#fff" fill-opacity=".7"/></g></g>`;
var blushMarkup = ([cx, cy, w, h8, tilt]) => `<ellipse cx="${cx}" cy="${cy + h8 * 0.56}" rx="${w * 0.78}" ry="${w * 0.4}" transform="rotate(${tilt} ${cx} ${cy})" fill="#ff5fb8" fill-opacity=".42"/>`;
var eyeMarkup = ([cx, cy, w, h8, tilt]) => `<g transform="translate(${cx} ${cy}) rotate(${tilt})"><rect class="bt-eye" x="${-w / 2}" y="${-h8 / 2}" width="${w}" height="${h8}" rx="${w / 2}"/></g>`;
var happyEyeMarkup = ([cx, cy, w, h8, tilt]) => `<g transform="translate(${cx} ${cy}) rotate(${tilt})"><path class="bt-eye-happy" opacity="0" d="M${-w * 0.62} ${h8 * 0.14}Q0 ${-h8 * 0.42} ${w * 0.62} ${h8 * 0.14}" fill="none" stroke="#000" stroke-width="${w * 0.5}" stroke-linecap="round"/></g>`;
var maskBox = (size) => `maskUnits="userSpaceOnUse" x="${-size}" y="${-size}" width="${size * 3}" height="${size * 3}"`;
var holes = (def, eyes) => `<rect x="${-def.size}" y="${-def.size}" width="${def.size * 3}" height="${def.size * 3}" fill="#fff"/>${eyes}`;
var MASK_ID = "%MASK%";
var markSerial = 0;
var nextMarkSerial = () => markSerial += 1;
var markupCache = /* @__PURE__ */ new Map();
function characterMarkup(shape, color) {
  const key = `${shape}|${color}`;
  let markup = markupCache.get(key);
  if (markup === void 0) {
    const def = shapeOf(shape);
    const eyes = `<g class="bt-gaze"><g class="bt-eyes" fill="#000">${def.eyes.map(eyeMarkup).join("")}${def.eyes.map(happyEyeMarkup).join("")}</g></g>`;
    const ink = inkFill(color);
    const stops = GRADIENTS[color] ?? [[0, `color-mix(in srgb, ${ink} 58%, #fff)`], [0.5, ink], [1, `color-mix(in srgb, ${ink} 72%, #000)`]];
    const box = def.size;
    const gradient = `<linearGradient id="${MASK_ID}g" gradientUnits="userSpaceOnUse" x1="${box * 0.18}" y1="${box * 0.08}" x2="${box * 0.8}" y2="${box * 0.95}">${stops.map(([offset, value]) => `<stop offset="${offset}" style="stop-color:${value}"/>`).join("")}</linearGradient>`;
    const face = `<g class="bt-gaze"><g class="bt-eyes">${def.eyes.map(pupilMarkup).join("")}${def.eyes.map(happyEyeMarkup).join("").replaceAll('stroke="#000"', `stroke="${PUPIL}"`)}</g></g>`;
    const body = `<g mask="url(#${MASK_ID})">${bodyOf(def, `url(#${MASK_ID}g)`)}</g>${def.eyes.map(blushMarkup).join("")}${face}`;
    markup = `<defs>${gradient}<mask id="${MASK_ID}" ${maskBox(def.size)}>${holes(def, eyes)}</mask></defs><g class="bt-b">${def.wrap ? `<g transform="${def.wrap}">${body}</g>` : body}</g>`;
    markupCache.set(key, markup);
  }
  return markup;
}
var svgUrl = (inner, size) => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">${inner}</svg>`)}")`;
var maskCache = /* @__PURE__ */ new Map();
function maskOf(shape) {
  let mask = maskCache.get(shape);
  if (mask === void 0) {
    const def = shapeOf(shape);
    const body = `<g mask="url(#e)">${bodyOf(def, "#000", true)}</g>`;
    mask = svgUrl(`<mask id="e" ${maskBox(def.size)}>${holes(def, def.eyes.map(eyeMarkup).join("").replaceAll('class="bt-eye"', 'fill="#000"'))}</mask>${def.wrap ? `<g transform="${def.wrap}">${body}</g>` : body}`, def.size);
    maskCache.set(shape, mask);
  }
  return mask;
}
var DEFAULT_MASK = maskOf(FALLBACK_SHAPE);

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
`;

// src/client/companion-art.js
var import_react = require("react");
var SHAPES2 = PICKER_SHAPES;
var COLORS = CHARACTER_COLORS;
var serial = 0;
function characterSvg(shape, color, size = 120) {
  serial += 1;
  return `<svg viewBox="0 0 100 100" width="${size}" height="${size}" aria-hidden="true">${characterMarkup(shape, color).replaceAll("%MASK%", `oaic${serial}`)}</svg>`;
}
var INK_CSS = `.oai-overlay{${Object.entries(INKS).map(([name, [, dark]]) => `--bt-ink-${name}:${dark}`).join(";")}}`;
var swatchOf = (color) => GRADIENTS[color] ? `linear-gradient(135deg,${GRADIENTS[color].map(([at2, value]) => `${value} ${at2 * 100}%`).join(",")})` : INKS[color]?.[1] ?? color;
var cached;
function companionLook(state) {
  if (!state) return void 0;
  if (state.companionImage) return { image: true, name: state.companionName };
  if (state.companionShape) return { shape: state.companionShape, color: state.companionColor ?? "cyan", name: state.companionName };
  return void 0;
}
function useCompanion() {
  const [look, setLook] = (0, import_react.useState)(cached);
  (0, import_react.useEffect)(() => {
    let alive = true;
    call("state").then(async (state) => {
      let next = companionLook(state);
      if (next?.image) {
        const { image } = await call("companion-image").catch(() => ({ image: null }));
        next = image ? { ...next, src: image } : void 0;
      }
      cached = next;
      if (alive) setLook(next);
    }).catch(() => {
    });
    return () => {
      alive = false;
    };
  }, []);
  return [look, (next) => {
    cached = next;
    setLook(next);
  }];
}
function Hero({ look, hatching }) {
  const cls = `oai-hero${hatching ? " oai-hatch" : ""}`;
  if (look?.src) return (0, import_react.createElement)("div", { className: cls }, (0, import_react.createElement)("img", { className: "oai-hero-img", src: look.src, alt: look.name ? `${look.name}, your companion` : "Your companion" }));
  if (look?.shape) return (0, import_react.createElement)("div", { className: cls, dangerouslySetInnerHTML: { __html: characterSvg(look.shape, look.color, 132) } });
  return (0, import_react.createElement)("div", { className: cls, dangerouslySetInnerHTML: { __html: OCTOPUS_SVG } });
}
function Egg() {
  return (0, import_react.createElement)(
    "div",
    { className: "oai-hero oai-egg", "aria-hidden": "true" },
    (0, import_react.createElement)("span", { className: "oai-egg-shell" }),
    [0, 1, 2, 3, 4].map((index) => (0, import_react.createElement)("i", { key: index, className: `oai-spark oai-spark-${index}` }))
  );
}

// src/client/stage.js
var import_react2 = require("react");
var import_react_dom = require("react-dom");
var RAIL = [["omni-companion", "Your companion"], ["omni-team", "Your team"], ["omni-connect", "Connect Omni"], ["omni-connect-ai", "Connect AI"]];
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
var FLAG_OF = { "omni-companion": "companionDone", "omni-team": "teamDone", "omni-connect-ai": "connectAiDone" };
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
  const first = (0, import_react2.useRef)(props);
  const [state, setState] = (0, import_react2.useState)(void 0);
  (0, import_react2.useEffect)(() => {
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
  const done = (0, import_react2.useRef)(false);
  return (0, import_react2.useCallback)((section) => {
    if (done.current) return;
    done.current = true;
    if (section) void finishInto(props, section);
    else void finish(props);
  }, [props]);
}
function useGlitch() {
  const [on2, setOn] = (0, import_react2.useState)(false);
  const timer = (0, import_react2.useRef)(0);
  (0, import_react2.useEffect)(() => () => clearTimeout(timer.current), []);
  const glitch = (0, import_react2.useCallback)(() => {
    if (reducedMotion()) return;
    setOn(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOn(false), 900);
  }, []);
  return [on2, glitch];
}
function useTypewriter(text) {
  const [shown, setShown] = (0, import_react2.useState)(() => reducedMotion() ? text : "");
  (0, import_react2.useEffect)(() => {
    if (reducedMotion()) {
      setShown(text);
      return void 0;
    }
    let at2 = 0;
    let timer = 0;
    const tick = () => {
      at2 += 1;
      setShown(text.slice(0, at2));
      if (at2 < text.length) timer = setTimeout(tick, 22);
    };
    setShown("");
    timer = setTimeout(tick, 120);
    return () => clearTimeout(timer);
  }, [text]);
  return shown;
}
function Rail({ at: at2 }) {
  const steps = railSteps(at2);
  const here = steps.findIndex(([id]) => id === at2);
  return (0, import_react2.createElement)(
    "ol",
    { className: "oai-rail", "aria-label": "Setup steps" },
    steps.map(([id, label], index) => (0, import_react2.createElement)("li", {
      key: id,
      className: index < here ? "oai-done" : index === here ? "oai-on" : "",
      "aria-current": index === here ? "step" : void 0
    }, label))
  );
}
function Stage({ title, speech, at: at2, glitching, hero, mark = "AUTOMAGIK", wide = false, children }) {
  const titleRef = (0, import_react2.useRef)(null);
  (0, import_react2.useEffect)(() => {
    const root = document.getElementById("root");
    if (root === null) return void 0;
    const previous = root.inert;
    root.inert = true;
    return () => {
      root.inert = previous;
    };
  }, []);
  (0, import_react2.useEffect)(() => {
    titleRef.current?.focus();
  }, [title]);
  const shown = useTypewriter(speech);
  const [look] = useCompanion();
  return (0, import_react_dom.createPortal)((0, import_react2.createElement)(
    "div",
    { className: "oai-overlay", role: "dialog", "aria-modal": "true", "aria-labelledby": "oai-title" },
    (0, import_react2.createElement)(
      "div",
      { className: `oai-stage${glitching ? " oai-glitch" : ""}${wide ? " oai-wide" : ""}` },
      hero ?? (0, import_react2.createElement)(Hero, { look }),
      (0, import_react2.createElement)(
        "div",
        { className: "oai-bubble" },
        (0, import_react2.createElement)("span", { className: "oai-hidden", role: "status" }, speech),
        (0, import_react2.createElement)("span", { "aria-hidden": "true" }, shown, shown.length < speech.length ? (0, import_react2.createElement)("span", { className: "oai-caret" }) : null)
      ),
      (0, import_react2.createElement)(Rail, { at: at2 }),
      (0, import_react2.createElement)(
        "main",
        { className: "oai-card" },
        (0, import_react2.createElement)("div", { className: "oai-mark", "aria-hidden": "true" }, mark),
        (0, import_react2.createElement)("h1", { id: "oai-title", ref: titleRef, tabIndex: -1 }, title),
        children
      )
    )
  ), document.body);
}

// src/client/companion.js
var import_react3 = require("react");
var IDEAS = ["a sleepy cyan fox with a lantern tail", "a tiny robot made of moonlight", "a round jellyfish that wears headphones"];
var NAMES = ["Pip", "Nova", "Mochi", "Echo", "Biscuit"];
var NAME_RULE = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,39}$/u;
var AVATAR_SIZE = 256;
var MAX_AVATAR = 16e4;
async function avatarOf(src) {
  try {
    const picture = new Image();
    picture.src = src;
    await picture.decode();
    const canvas = document.createElement("canvas");
    canvas.width = AVATAR_SIZE;
    canvas.height = AVATAR_SIZE;
    const side = Math.min(picture.naturalWidth, picture.naturalHeight);
    canvas.getContext("2d").drawImage(picture, (picture.naturalWidth - side) / 2, (picture.naturalHeight - side) / 2, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
    const small = [canvas.toDataURL("image/webp", 0.86), canvas.toDataURL("image/png")].find((url) => /^data:image\/(webp|png);/.test(url) && url.length <= MAX_AVATAR);
    return small;
  } catch {
    return void 0;
  }
}
function CompanionStep(props) {
  const state = useGate(props);
  const finish2 = useFinish(props);
  const [glitching, glitch] = useGlitch();
  const [, setLook] = useCompanion();
  const [caps, setCaps] = (0, import_react3.useState)(null);
  const [mode, setMode] = (0, import_react3.useState)("pick");
  const [shape, setShape] = (0, import_react3.useState)(null);
  const [color, setColor] = (0, import_react3.useState)("cyan");
  const [description, setDescription] = (0, import_react3.useState)("");
  const [image, setImage] = (0, import_react3.useState)(null);
  const [drawing, setDrawing] = (0, import_react3.useState)(false);
  const [name, setName] = (0, import_react3.useState)("");
  const [problem, setProblem] = (0, import_react3.useState)(null);
  const [saving, setSaving] = (0, import_react3.useState)(false);
  const [hatching, setHatching] = (0, import_react3.useState)(false);
  (0, import_react3.useEffect)(() => {
    call("companion").then((reply) => {
      setCaps(reply);
      if (reply?.generate) setMode("describe");
    }).catch(() => setCaps({ generate: null }));
  }, []);
  (0, import_react3.useEffect)(() => {
    if (state) glitch();
  }, [state, glitch]);
  if (!state) return null;
  const generating = caps?.generate;
  const look = image ? { src: image, name } : shape ? { shape, color, name } : null;
  const nameOk = NAME_RULE.test(name.trim());
  const ready = look !== null && nameOk && !saving;
  const draw = async () => {
    setProblem(null);
    setDrawing(true);
    try {
      const reply = await call("companion-generate", { description });
      setImage(reply.image);
      glitch();
    } catch (error) {
      setProblem(error.message);
    } finally {
      setDrawing(false);
    }
  };
  const hatch = async () => {
    if (!ready) return;
    setSaving(true);
    setProblem(null);
    try {
      const avatar = image ? await avatarOf(image) : void 0;
      await call("companion-save", { name: name.trim(), ...image ? { image, ...avatar ? { avatar } : {} } : { shape, color } });
      setLook({ ...image ? { src: image } : { shape, color }, name: name.trim() });
      setHatching(true);
      setTimeout(() => finish2(), 1100);
    } catch (error) {
      setProblem(error.message);
      setSaving(false);
    }
  };
  const speech = look ? nameOk ? `I'm ${name.trim()}! Ready when you are.` : "Oh, that's me! What's my name?" : "Hi! I'm going to be yours. What should I look like?";
  const hero = look ? (0, import_react3.createElement)(Hero, { look, hatching }) : (0, import_react3.createElement)(Egg);
  return (0, import_react3.createElement)(
    Stage,
    { title: "Create your companion", speech, at: "omni-companion", glitching, hero },
    (0, import_react3.createElement)("p", { className: "oai-lede" }, "Your companion runs your team: it talks with you, hands work to the others and keeps an eye on everything. Make it yours."),
    (0, import_react3.createElement)(
      "div",
      { className: "oai-seg", role: "tablist", "aria-label": "How to make it" },
      (0, import_react3.createElement)("button", { type: "button", role: "tab", "aria-selected": mode === "describe", onClick: () => setMode("describe") }, "Describe it"),
      (0, import_react3.createElement)("button", { type: "button", role: "tab", "aria-selected": mode === "pick", onClick: () => setMode("pick") }, "Pick one")
    ),
    mode === "describe" ? (0, import_react3.createElement)(
      "div",
      { className: "oai-describe" },
      (0, import_react3.createElement)("label", { htmlFor: "oai-desc" }, "What does it look like?"),
      (0, import_react3.createElement)("textarea", { id: "oai-desc", rows: 2, value: description, placeholder: IDEAS[0], onChange: (event) => setDescription(event.target.value), disabled: drawing }),
      (0, import_react3.createElement)("div", { className: "oai-chips" }, IDEAS.map((idea) => (0, import_react3.createElement)("button", { key: idea, type: "button", className: "oai-chip", onClick: () => setDescription(idea) }, idea))),
      generating ? (0, import_react3.createElement)(
        "div",
        { className: "oai-row" },
        (0, import_react3.createElement)("button", { type: "button", className: "oai-primary", disabled: drawing || description.trim().length < 3 || !generating.ready, onClick: draw }, drawing ? "Drawing…" : image ? "Draw again" : "Bring it to life"),
        (0, import_react3.createElement)("span", { className: "oai-muted" }, generating.kind === "chatgpt" ? "Drawn with your ChatGPT plan (gpt-image-2)" : "Drawn with your OpenAI key (gpt-image-1)")
      ) : (0, import_react3.createElement)("p", { className: "oai-note" }, "Drawing a companion needs ChatGPT or an OpenAI key. Connect one in the AI step, then come back from Settings. For now, pick one."),
      drawing ? (0, import_react3.createElement)("div", { className: "oai-drawing", "aria-hidden": "true" }) : null
    ) : (0, import_react3.createElement)(
      "div",
      { className: "oai-pick" },
      (0, import_react3.createElement)(
        "div",
        { className: "oai-shapes", role: "radiogroup", "aria-label": "Character" },
        SHAPES2.map((id) => (0, import_react3.createElement)("button", {
          key: id,
          type: "button",
          role: "radio",
          "aria-checked": shape === id && !image,
          "aria-label": id,
          className: "oai-shape",
          onClick: () => {
            setImage(null);
            setShape(id);
          },
          dangerouslySetInnerHTML: { __html: characterSvg(id, color, 54) }
        }))
      ),
      (0, import_react3.createElement)(
        "div",
        { className: "oai-swatches", role: "radiogroup", "aria-label": "Color" },
        COLORS.map((id) => (0, import_react3.createElement)("button", { key: id, type: "button", role: "radio", "aria-checked": color === id, "aria-label": id, className: "oai-swatch", style: { background: swatchOf(id) }, onClick: () => setColor(id) }))
      )
    ),
    (0, import_react3.createElement)(
      "div",
      { className: "oai-name" },
      (0, import_react3.createElement)("label", { htmlFor: "oai-name" }, "Its name"),
      (0, import_react3.createElement)(
        "div",
        { className: "oai-row" },
        (0, import_react3.createElement)("input", { id: "oai-name", value: name, maxLength: 40, placeholder: NAMES[0], autoComplete: "off", onChange: (event) => setName(event.target.value), onKeyDown: (event) => {
          if (event.key === "Enter") void hatch();
        } }),
        (0, import_react3.createElement)("div", { className: "oai-chips" }, NAMES.map((option) => (0, import_react3.createElement)("button", { key: option, type: "button", className: "oai-chip", onClick: () => setName(option) }, option)))
      )
    ),
    problem ? (0, import_react3.createElement)("p", { className: "oai-error", role: "alert" }, problem) : null,
    (0, import_react3.createElement)(
      "div",
      { className: "oai-actions" },
      (0, import_react3.createElement)("button", { type: "button", className: "oai-primary oai-big", disabled: !ready, onClick: hatch }, saving ? "Hatching…" : nameOk ? `Hatch ${name.trim()}` : "Hatch")
    )
  );
}

// src/client/genie.js
var WISPS = {
  right: "M50 35.5C50 27 53 21.5 61 20C70 18.5 74 24 81.5 19.5C87 16 86 9 81 8.8C77.8 8.7 76.8 11.5 78.6 13.2",
  left: "M50 35.5C50 27 47 21.5 39 20C30 18.5 26 24 18.5 19.5C13 16 14 9 19 8.8C22.2 8.7 23.2 11.5 21.4 13.2",
  question: "M50 35.5C50 30 54.5 27 57 22.5C59.5 18 57.5 12 52 11.5C47 11 44.5 15 46 18.5",
  flame: "M50 35.5C47.5 30 52.5 27 51.2 22C50.2 18 48 16 50.4 10.5"
};
function genieSvg(size, { wisp = "right", uid = "g", tilt = -8 } = {}) {
  const CY = "#64f4ff", MG = "#ff4fd8", INK = "#0b0718";
  const eye = (x, y, w) => `<path d="M${x - w} ${y}Q${x} ${y - w * 1.35} ${x + w} ${y}Q${x} ${y - w * 0.62} ${x - w} ${y}Z"/><path d="M${x - w * 0.78} ${y + w * 0.95}Q${x} ${y + w * 0.1} ${x + w * 0.78} ${y + w * 0.95}Q${x} ${y + w * 0.5} ${x - w * 0.78} ${y + w * 0.95}Z"/>`;
  const ear = "M32.4 63C25.5 60.5 19 53.5 15.2 41.5C22.8 45 28.8 48.8 33.6 53Z";
  const fold = "M30.2 58C26.2 54.6 22 50.2 18.8 45.4";
  return `<svg viewBox="6 2 90 90" width="${size}" height="${size}" aria-hidden="true">
  <defs>
    <radialGradient id="${uid}s" cx="38%" cy="32%" r="78%"><stop offset="0" stop-color="#22143f"/><stop offset=".6" stop-color="#110a24"/><stop offset="1" stop-color="${INK}"/></radialGradient>
    <filter id="${uid}gm" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation=".8" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <filter id="${uid}gc" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation=".7" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>
  <g transform="rotate(${tilt} 50 60)">
    <g filter="url(#${uid}gm)" stroke-linecap="round" stroke-linejoin="round">
      <path d="${WISPS[wisp]}" fill="none" stroke="${MG}" stroke-width="4.4"/>
      <path d="${WISPS[wisp]}" fill="none" stroke="${INK}" stroke-width="2.3"/>
      <g fill="url(#${uid}s)" stroke="${MG}" stroke-width="1.25">
        <path d="${ear}"/><path d="${ear}" transform="matrix(-1 0 0 1 100 0)"/>
        <ellipse cx="50" cy="61" rx="21" ry="20.2"/>
      </g>
      <g fill="none" stroke="${MG}" stroke-width="1"><path d="${fold}"/><path d="${fold}" transform="matrix(-1 0 0 1 100 0)"/></g>
    </g>
    <g filter="url(#${uid}gc)" stroke-linecap="round" stroke-linejoin="round">
      <g fill="none" stroke="${CY}" stroke-width="1.2">
        <path d="M45.6 41V37.2M54.4 41V37.2"/><ellipse cx="50" cy="37.2" rx="4.4" ry="1.3" fill="${INK}"/>
        <circle cx="29.6" cy="68.2" r="2.3"/><circle cx="70.4" cy="68.2" r="2.3"/>
      </g>
      <g fill="${CY}" stroke="${CY}" stroke-width=".35">
        ${eye(42.3, 58, 4.6)}${eye(57.7, 58, 4.6)}
        <path d="M42.5 67.2Q51 75.6 59.4 66.4Q51.4 71.2 42.5 67.2Z"/>
      </g>
    </g>
  </g>
  </svg>`;
}

// src/client/team.js
var import_react4 = require("react");
async function overview() {
  try {
    const response = await fetch("api/omni-ui", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: "omni-overview", payload: {} }) });
    const result = await response.json();
    return result.ok ? result.value : null;
  } catch {
    return null;
  }
}
var tilde = (path) => path.replace(/^\/(?:home|Users)\/[^/]+(?=\/)/, "~");
var TYPE_LABEL = { "whatsapp-baileys": "WhatsApp", "whatsapp-cloud": "WhatsApp Business", slack: "Slack", telegram: "Telegram", discord: "Discord", gupshup: "Gupshup" };
var channelLabel = (channel) => TYPE_LABEL[channel.type] ?? channel.type ?? "Channel";
var OMNI_STATS = [
  { id: "channels", label: "Channels", value: 5, on: true, locked: true },
  { id: "threads", label: "Threads", value: 3, on: true },
  { id: "canvases", label: "Live canvases", value: 4, on: true },
  { id: "files", label: "Files", value: 1, on: false },
  { id: "shell", label: "Shell", value: 0, on: false }
];
var GENIE_STATS = [
  { id: "threads", label: "Threads", value: 5 },
  { id: "files", label: "Files", value: 4 },
  { id: "shell", label: "Shell", value: 4 },
  { id: "plugins", label: "Plugins", value: 3 },
  { id: "channels", label: "Channels", value: 1 }
];
function Stat({ stat, onToggle, disabled }) {
  return (0, import_react4.createElement)(
    "li",
    { className: `oai-stat${stat.on === false ? " oai-off" : ""}` },
    (0, import_react4.createElement)("span", { className: "oai-stat-label" }, stat.label),
    (0, import_react4.createElement)("span", { className: "oai-bar", "aria-label": `${stat.value} of 5` }, [0, 1, 2, 3, 4].map((index) => (0, import_react4.createElement)("i", { key: index, className: index < stat.value ? "oai-pip on" : "oai-pip" }))),
    !onToggle ? (0, import_react4.createElement)("span", { className: "oai-soon" }, "soon") : stat.locked ? (0, import_react4.createElement)("span", { className: "oai-core", title: "What this Bot is for: always on" }, "core") : (0, import_react4.createElement)("button", { type: "button", role: "switch", className: "oai-switch", "aria-checked": stat.on === true, "aria-label": `${stat.label} for this Bot`, disabled, onClick: onToggle })
  );
}
function Facts({ rows }) {
  return (0, import_react4.createElement)("dl", { className: "oai-facts" }, rows.map(([term, value]) => [(0, import_react4.createElement)("dt", { key: `${term}t` }, term), (0, import_react4.createElement)("dd", { key: `${term}d` }, value)]));
}
function TeamStep(props) {
  const state = useGate(props);
  const finish2 = useFinish(props);
  const [glitching, glitch] = useGlitch();
  const [omni, setOmni] = (0, import_react4.useState)(true);
  const [stats, setStats] = (0, import_react4.useState)(OMNI_STATS);
  const [live, setLive] = (0, import_react4.useState)(void 0);
  const [saving, setSaving] = (0, import_react4.useState)(false);
  const [problem, setProblem] = (0, import_react4.useState)(null);
  const [project, setProject] = (0, import_react4.useState)(null);
  (0, import_react4.useEffect)(() => {
    overview().then(setLive);
  }, []);
  (0, import_react4.useEffect)(() => {
    call("companion").then((reply) => setProject(reply?.omniProject ?? null), () => {
    });
  }, []);
  (0, import_react4.useEffect)(() => {
    if (state) glitch();
  }, [state, glitch]);
  if (!state) return null;
  const channels = live?.configured ? live.channels ?? [] : [];
  const chats = live?.configured ? live.chats ?? [] : [];
  const name = state.companionName ?? "Your companion";
  const toggle = (id) => setStats((rows) => rows.map((row) => row.id === id && !row.locked ? { ...row, on: !row.on } : row));
  const go2 = async () => {
    setSaving(true);
    setProblem(null);
    try {
      await call("team-save", { omni, genie: false, omniAbilities: Object.fromEntries(stats.map((row) => [row.id, row.on])) });
      finish2();
    } catch (error) {
      setProblem(error.message);
      setSaving(false);
    }
  };
  const menu = channels.length > 0 ? (0, import_react4.createElement)("ul", { className: "oai-menu-preview" }, channels.slice(0, 5).map((channel) => (0, import_react4.createElement)("li", { key: channel.id }, (0, import_react4.createElement)("span", { className: `oai-dot ${channel.status === "connected" ? "ok" : "warn"}` }), `${channelLabel(channel)} · ${channel.name}`))) : (0, import_react4.createElement)("p", { className: "oai-muted" }, live === void 0 ? "Reading your Omni…" : "Link an Omni next, and each of its channels gets a place in your menu.");
  return (0, import_react4.createElement)(
    Stage,
    {
      title: "Grow your team",
      speech: `${name} here! Two friends can join us. Pick who comes along.`,
      at: "omni-team",
      glitching,
      wide: true
    },
    (0, import_react4.createElement)("p", { className: "oai-lede" }, `${name} leads. Each friend brings its own powers, its own project and its own place in your menu.`),
    (0, import_react4.createElement)(
      "div",
      { className: "oai-select" },
      (0, import_react4.createElement)(
        "article",
        { className: `oai-fighter oai-omni${omni ? " oai-chosen" : ""}` },
        (0, import_react4.createElement)(
          "div",
          { className: "oai-portrait oai-rise", "aria-hidden": "true" },
          (0, import_react4.createElement)("div", { className: "oai-bubbles" }, [0, 1, 2, 3, 4, 5].map((index) => (0, import_react4.createElement)("i", { key: index }))),
          (0, import_react4.createElement)("div", { className: "oai-octo-wrap", dangerouslySetInnerHTML: { __html: OCTOPUS_SVG } })
        ),
        (0, import_react4.createElement)("header", null, (0, import_react4.createElement)("h2", null, "Omni"), (0, import_react4.createElement)("span", { className: "oai-class" }, "Channel keeper")),
        (0, import_react4.createElement)("p", null, "Runs your Omni: every chat on every channel, answered by your team. A little Omni sits in each chat to help there."),
        (0, import_react4.createElement)("ul", { className: "oai-stats" }, stats.map((stat) => (0, import_react4.createElement)(Stat, { key: stat.id, stat, onToggle: () => toggle(stat.id), disabled: !omni }))),
        (0, import_react4.createElement)(Facts, { rows: [
          ["Controls", live?.configured ? `${live.origin}: ${channels.length} channels, ${chats.length} recent chats` : "The Omni you link next"],
          ["Project", project ? `Its own: ${tilde(project)}` : "Its own, in your team workspace"],
          ["Plugins", "Omni channels · Omni canvases"],
          ["Helpers", "A little Omni in each chat"]
        ] }),
        (0, import_react4.createElement)("div", { className: "oai-menu-label" }, "In your menu"),
        menu,
        (0, import_react4.createElement)("button", { type: "button", role: "switch", className: `oai-join${omni ? " on" : ""}`, "aria-checked": omni, onClick: () => setOmni((value) => !value) }, omni ? "On your team" : "Add to your team")
      ),
      (0, import_react4.createElement)(
        "article",
        { className: "oai-fighter oai-genie oai-locked" },
        (0, import_react4.createElement)(
          "div",
          { className: "oai-portrait oai-emerge", "aria-hidden": "true" },
          (0, import_react4.createElement)("div", { className: "oai-sparkles" }, [0, 1, 2, 3, 4].map((index) => (0, import_react4.createElement)("i", { key: index }))),
          (0, import_react4.createElement)("div", { className: "oai-genie-wrap", dangerouslySetInnerHTML: { __html: genieSvg(150, { uid: "oaig" }) } })
        ),
        (0, import_react4.createElement)("header", null, (0, import_react4.createElement)("h2", null, "Genie"), (0, import_react4.createElement)("span", { className: "oai-class" }, "Wish granter")),
        (0, import_react4.createElement)("p", null, "Give it a wish, get one delivery. It works in threads of itself, in its own project, and hands you the result."),
        (0, import_react4.createElement)("ul", { className: "oai-stats" }, GENIE_STATS.map((stat) => (0, import_react4.createElement)(Stat, { key: stat.id, stat }))),
        (0, import_react4.createElement)(Facts, { rows: [["Controls", "Code, files and tasks in its project"], ["Project", "Its own, per wish"], ["Plugins", "Genie (not released for DSH yet)"], ["Helpers", "One thread per wish"]] }),
        (0, import_react4.createElement)("div", { className: "oai-menu-label" }, "In your menu"),
        (0, import_react4.createElement)("p", { className: "oai-muted" }, "Its threads, under Genie."),
        (0, import_react4.createElement)("span", { className: "oai-join oai-soon-badge", "aria-disabled": "true" }, "Coming soon")
      )
    ),
    problem ? (0, import_react4.createElement)("p", { className: "oai-error", role: "alert" }, problem) : null,
    (0, import_react4.createElement)(
      "div",
      { className: "oai-actions" },
      (0, import_react4.createElement)("button", { type: "button", className: "oai-primary oai-big", disabled: saving, onClick: go2 }, saving ? "Bringing them in…" : omni ? "Continue with Omni" : `Continue with just ${name}`)
    )
  );
}

// src/client/onboard-css.js
var ONBOARD_CSS = `
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
`;

// src/client/subscriptions.js
var import_react5 = require("react");
var BASE = "dsh-subscriptions";
var SUBSCRIPTION_TILES = [
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
  const [step, setStep] = (0, import_react5.useState)(null);
  const [problem, setProblem] = (0, import_react5.useState)(null);
  const [value, setValue] = (0, import_react5.useState)("");
  const [busy, setBusy] = (0, import_react5.useState)(false);
  const [index, setIndex] = (0, import_react5.useState)(null);
  (0, import_react5.useEffect)(() => {
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
          const every = Math.max(device.intervalMs ?? 5e3, 2e3);
          const poll = async () => {
            try {
              const out = await post("oauth/device/poll", { state: device.state });
              if (out.status === "authorized") return done();
              if (!live) return;
              if (out.status === "expired") return setProblem("The code expired before the sign-in finished. Go back and start again.");
              setProblem(null);
            } catch (error) {
              if (!live) return;
              setProblem(error.message);
            }
            timer = setTimeout(poll, every);
          };
          timer = setTimeout(poll, every);
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
  return (0, import_react5.createElement)(
    "div",
    { className: "oai-signin" },
    !step && !problem ? (0, import_react5.createElement)("p", { className: "oai-muted" }, `Starting the ${tile.name} sign-in…`) : null,
    step?.code ? (0, import_react5.createElement)("p", null, `Open ${tile.name}, sign in, and enter this code:`) : null,
    step?.code ? (0, import_react5.createElement)("div", { className: "oai-code" }, (0, import_react5.createElement)("code", null, step.code)) : null,
    step?.url && tile.kind !== "token" ? (0, import_react5.createElement)("a", { className: "oai-primary oai-button", href: step.url, target: "_blank", rel: "noreferrer" }, `Open ${tile.name} to sign in`) : null,
    tile.kind === "device" && step ? (0, import_react5.createElement)("p", { className: "oai-muted oai-waiting" }, "Waiting for you to finish signing in…") : null,
    tile.kind === "browser" && step ? (0, import_react5.createElement)("p", { className: "oai-muted" }, step.autoCatch ? "Sign in on their page; this finishes on its own. If it ends on a page that does not load, paste its address here." : "Sign in on their page, then paste the address it ends on here.") : null,
    tile.kind === "token" && step ? (0, import_react5.createElement)("p", null, `Copy your ${tile.what} from `, (0, import_react5.createElement)("a", { className: "oai-link", href: tile.where, target: "_blank", rel: "noreferrer" }, tile.name), " and paste it here. It stays in DSH's credential store on this computer.") : null,
    step && tile.kind !== "device" ? (0, import_react5.createElement)(
      "form",
      { onSubmit: submit },
      (0, import_react5.createElement)("label", { htmlFor: "oai-sub-value" }, tile.kind === "token" ? tile.what : "The address you landed on"),
      (0, import_react5.createElement)("input", { id: "oai-sub-value", type: tile.kind === "token" ? "password" : "text", required: true, autoComplete: "off", spellCheck: false, value, onChange: (e) => setValue(e.target.value) }),
      (0, import_react5.createElement)("button", { type: "submit", className: tile.kind === "token" ? "oai-primary" : "", disabled: busy }, busy ? "Connecting…" : "Connect")
    ) : null,
    problem ? (0, import_react5.createElement)("p", { className: "oai-error", role: "alert" }, problem) : null,
    (0, import_react5.createElement)("button", { type: "button", className: "oai-quiet", onClick: onBack }, "Back")
  );
}

// node_modules/@xterm/xterm/css/xterm.css
var xterm_default = `/**
 * Copyright (c) 2014 The xterm.js authors. All rights reserved.
 * Copyright (c) 2012-2013, Christopher Jeffrey (MIT License)
 * https://github.com/chjj/term.js
 * @license MIT
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 *
 * Originally forked from (with the author's permission):
 *   Fabrice Bellard's javascript vt100 for jslinux:
 *   http://bellard.org/jslinux/
 *   Copyright (c) 2011 Fabrice Bellard
 *   The original design remains. The terminal itself
 *   has been extended to include xterm CSI codes, among
 *   other features.
 */

/**
 *  Default styles for xterm.js
 */

.xterm {
    cursor: text;
    position: relative;
    user-select: none;
    -ms-user-select: none;
    -webkit-user-select: none;
}

.xterm.focus,
.xterm:focus {
    outline: none;
}

.xterm .xterm-helpers {
    position: absolute;
    top: 0;
    /**
     * The z-index of the helpers must be higher than the canvases in order for
     * IMEs to appear on top.
     */
    z-index: 5;
}

.xterm .xterm-helper-textarea {
    padding: 0;
    border: 0;
    margin: 0;
    /* Move textarea out of the screen to the far left, so that the cursor is not visible */
    position: absolute;
    opacity: 0;
    left: -9999em;
    top: 0;
    width: 0;
    height: 0;
    z-index: -5;
    /** Prevent wrapping so the IME appears against the textarea at the correct position */
    white-space: nowrap;
    overflow: hidden;
    resize: none;
}

.xterm .composition-view {
    /* TODO: Composition position got messed up somewhere */
    background: #000;
    color: #FFF;
    display: none;
    position: absolute;
    white-space: nowrap;
    z-index: 1;
}

.xterm .composition-view.active {
    display: block;
}

.xterm .xterm-viewport {
    /* On OS X this is required in order for the scroll bar to appear fully opaque */
    background-color: #000;
    overflow-y: scroll;
    cursor: default;
    position: absolute;
    right: 0;
    left: 0;
    top: 0;
    bottom: 0;
}

.xterm .xterm-screen {
    position: relative;
}

.xterm .xterm-screen canvas {
    position: absolute;
    left: 0;
    top: 0;
}

.xterm-char-measure-element {
    display: inline-block;
    visibility: hidden;
    position: absolute;
    top: 0;
    left: -9999em;
    line-height: normal;
}

.xterm.enable-mouse-events {
    /* When mouse events are enabled (eg. tmux), revert to the standard pointer cursor */
    cursor: default;
}

.xterm.xterm-cursor-pointer,
.xterm .xterm-cursor-pointer {
    cursor: pointer;
}

.xterm.column-select.focus {
    /* Column selection mode */
    cursor: crosshair;
}

.xterm .xterm-accessibility:not(.debug),
.xterm .xterm-message {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    right: 0;
    z-index: 10;
    color: transparent;
    pointer-events: none;
}

.xterm .xterm-accessibility-tree:not(.debug) *::selection {
  color: transparent;
}

.xterm .xterm-accessibility-tree {
  font-family: monospace;
  user-select: text;
  white-space: pre;
}

.xterm .xterm-accessibility-tree > div {
  transform-origin: left;
  width: fit-content;
}

.xterm .live-region {
    position: absolute;
    left: -9999px;
    width: 1px;
    height: 1px;
    overflow: hidden;
}

.xterm-dim {
    /* Dim should not apply to background, so the opacity of the foreground color is applied
     * explicitly in the generated class and reset to 1 here */
    opacity: 1 !important;
}

.xterm-underline-1 { text-decoration: underline; }
.xterm-underline-2 { text-decoration: double underline; }
.xterm-underline-3 { text-decoration: wavy underline; }
.xterm-underline-4 { text-decoration: dotted underline; }
.xterm-underline-5 { text-decoration: dashed underline; }

.xterm-overline {
    text-decoration: overline;
}

.xterm-overline.xterm-underline-1 { text-decoration: overline underline; }
.xterm-overline.xterm-underline-2 { text-decoration: overline double underline; }
.xterm-overline.xterm-underline-3 { text-decoration: overline wavy underline; }
.xterm-overline.xterm-underline-4 { text-decoration: overline dotted underline; }
.xterm-overline.xterm-underline-5 { text-decoration: overline dashed underline; }

.xterm-strikethrough {
    text-decoration: line-through;
}

.xterm-screen .xterm-decoration-container .xterm-decoration {
	z-index: 6;
	position: absolute;
}

.xterm-screen .xterm-decoration-container .xterm-decoration.xterm-decoration-top-layer {
	z-index: 7;
}

.xterm-decoration-overview-ruler {
    z-index: 8;
    position: absolute;
    top: 0;
    right: 0;
    pointer-events: none;
}

.xterm-decoration-top {
    z-index: 2;
    position: relative;
}



/* Derived from vs/base/browser/ui/scrollbar/media/scrollbar.css */

/* xterm.js customization: Override xterm's cursor style */
.xterm .xterm-scrollable-element > .scrollbar {
    cursor: default;
}

/* Arrows */
.xterm .xterm-scrollable-element > .scrollbar > .scra {
	cursor: pointer;
	font-size: 11px !important;
}

.xterm .xterm-scrollable-element > .visible {
	opacity: 1;

	/* Background rule added for IE9 - to allow clicks on dom node */
	background:rgba(0,0,0,0);

	transition: opacity 100ms linear;
	/* In front of peek view */
	z-index: 11;
}
.xterm .xterm-scrollable-element > .invisible {
	opacity: 0;
	pointer-events: none;
}
.xterm .xterm-scrollable-element > .invisible.fade {
	transition: opacity 800ms linear;
}

/* Scrollable Content Inset Shadow */
.xterm .xterm-scrollable-element > .shadow {
	position: absolute;
	display: none;
}
.xterm .xterm-scrollable-element > .shadow.top {
	display: block;
	top: 0;
	left: 3px;
	height: 3px;
	width: 100%;
	box-shadow: var(--vscode-scrollbar-shadow, #000) 0 6px 6px -6px inset;
}
.xterm .xterm-scrollable-element > .shadow.left {
	display: block;
	top: 3px;
	left: 0;
	height: 100%;
	width: 3px;
	box-shadow: var(--vscode-scrollbar-shadow, #000) 6px 0 6px -6px inset;
}
.xterm .xterm-scrollable-element > .shadow.top-left-corner {
	display: block;
	top: 0;
	left: 0;
	height: 3px;
	width: 3px;
}
.xterm .xterm-scrollable-element > .shadow.top.left {
	box-shadow: var(--vscode-scrollbar-shadow, #000) 6px 0 6px -6px inset;
}
`;

// src/client/terminal.js
var import_react6 = require("react");
var READ_MS = 150;
var ROWS = 10;
var FONT = "13px ui-monospace, SFMono-Regular, Menlo, monospace";
var THEME = {
  background: "#05080e",
  foreground: "#cfe3ee",
  cursor: "#22d3ee",
  cursorAccent: "#05080e",
  selectionBackground: "#1f4b5c",
  black: "#0b111d",
  red: "#ff6b6b",
  green: "#4fe0a8",
  yellow: "#f0c86a",
  blue: "#5fa8f0",
  magenta: "#ff3bd4",
  cyan: "#22d3ee",
  white: "#cfe3ee",
  brightBlack: "#5d6b82",
  brightRed: "#ff8f8f",
  brightGreen: "#7ef0c2",
  brightYellow: "#ffd98a",
  brightBlue: "#8cc3ff",
  brightMagenta: "#ff7fe3",
  brightCyan: "#8ff4ff",
  brightWhite: "#ffffff"
};
var ENDED = /* @__PURE__ */ new Set(["done", "failed", "cancelled"]);
function columnsFor(width, charWidth2) {
  if (!(width > 0) || !(charWidth2 > 0)) return 80;
  return Math.max(30, Math.min(400, Math.floor((width - 24) / charWidth2)));
}
var measured = 0;
function charWidth() {
  if (measured > 0) return measured;
  const context = document.createElement("canvas").getContext?.("2d");
  if (!context) return 7.8;
  context.font = FONT;
  measured = context.measureText("W").width || 7.8;
  return measured;
}
function footFor({ state, entered, exitCode, error }) {
  if (state === "preparing") return "Opening a terminal…";
  if (state === "ready") return entered ? "Signing in… Finish in the browser page Claude Code opens." : "The command is ready. Press Enter to run it, or edit it first.";
  if (state === "checking") return "Finished. Checking that Claude Code is signed in…";
  if (state === "done") return "Signed in. Closing the terminal…";
  if (state === "cancelled") return "Nothing ran. Open it again when you are ready.";
  if (error) return error;
  return `It stopped with exit code ${exitCode ?? "?"}. Read what it printed above, then try again.`;
}
function ClaudeLoginTerminal({ onEnded, onClose }) {
  const box = (0, import_react6.useRef)(null);
  const [status, setStatus] = (0, import_react6.useState)({ state: "preparing", entered: false });
  const ended = (0, import_react6.useRef)(onEnded);
  ended.current = onEnded;
  (0, import_react6.useEffect)(() => {
    let alive = true;
    let timer = 0;
    let terminal = null;
    let offset = 0;
    let entered = false;
    let writing = Promise.resolve();
    let term = null;
    let typed = null;
    let observer = null;
    const fit = () => {
      const cols = columnsFor(box.current?.clientWidth, charWidth());
      if (term === null || cols === term.cols) return;
      term.resize(cols, ROWS);
      if (terminal !== null) void call("ai-terminal-resize", { terminal, cols, rows: ROWS }).catch(() => {
      });
    };
    const read = async () => {
      try {
        const reply = await call("ai-terminal-read", { terminal, from: offset });
        if (!alive) return;
        if (reply.data) term.write(reply.data);
        offset = reply.next ?? offset;
        setStatus({ state: reply.state, entered, exitCode: reply.exitCode, error: reply.error });
        if (ENDED.has(reply.state)) {
          ended.current?.(reply);
          return;
        }
      } catch (error) {
        if (!alive) return;
        setStatus({ state: "failed", error: error.message, entered });
        return;
      }
      timer = setTimeout(read, READ_MS);
    };
    const start = async () => {
      const { Terminal } = await Promise.resolve().then(() => (init_xterm(), xterm_exports));
      if (!alive) return;
      term = new Terminal({ rows: ROWS, cols: columnsFor(box.current?.clientWidth, charWidth()), fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 13, lineHeight: 1.2, cursorBlink: true, scrollback: 2e3, theme: THEME });
      term.open(box.current);
      typed = term.onData((data) => {
        if (terminal === null) return;
        if (/[\r\n]/.test(data) && !entered) {
          entered = true;
          setStatus((previous) => ({ ...previous, entered: true }));
        }
        writing = writing.then(() => call("ai-terminal-write", { terminal, data })).catch(() => {
        });
      });
      observer = typeof ResizeObserver === "function" ? new ResizeObserver(fit) : null;
      observer?.observe(box.current);
      const reply = await call("ai-terminal-open", { kind: "claude-login", cols: term.cols, rows: ROWS });
      if (!alive) {
        void call("ai-terminal-close", { terminal: reply.terminal }).catch(() => {
        });
        return;
      }
      terminal = reply.terminal;
      setStatus((previous) => ({ ...previous, state: reply.state }));
      term.focus();
      void read();
    };
    start().catch((error) => {
      if (alive) setStatus({ state: "failed", error: error.message, entered: false });
    });
    return () => {
      alive = false;
      clearTimeout(timer);
      observer?.disconnect();
      typed?.dispose();
      term?.dispose();
      if (terminal !== null) void call("ai-terminal-close", { terminal }).catch(() => {
      });
    };
  }, []);
  const stopped = status.state === "failed" || status.state === "cancelled";
  return (0, import_react6.createElement)(
    "div",
    { className: `oai-term${stopped ? " oai-term-stopped" : ""}` },
    (0, import_react6.createElement)(
      "div",
      { className: "oai-term-bar" },
      (0, import_react6.createElement)("span", { className: "oai-term-dots", "aria-hidden": true }, (0, import_react6.createElement)("i"), (0, import_react6.createElement)("i"), (0, import_react6.createElement)("i")),
      (0, import_react6.createElement)("span", { className: "oai-term-title" }, "Sign in to Claude Code"),
      onClose ? (0, import_react6.createElement)("button", { type: "button", className: "oai-term-close", onClick: onClose, "aria-label": "Close the terminal" }, "×") : (0, import_react6.createElement)("span")
    ),
    (0, import_react6.createElement)("div", { className: "oai-term-screen", ref: box, role: "application", "aria-label": "Claude Code sign-in terminal" }),
    (0, import_react6.createElement)("div", { className: "oai-term-foot", role: "status" }, footFor(status))
  );
}
var TERMINAL_CSS = xterm_default + `
.oai-term{margin-top:10px;border:1px solid var(--oai-line);border-radius:12px;overflow:hidden;background:#05080e}
.oai-term.oai-term-stopped{border-color:color-mix(in srgb,var(--oai-bad) 55%,transparent)}
.oai-term-bar{display:grid;grid-template-columns:44px 1fr 44px;align-items:center;padding:7px 12px;border-bottom:1px solid var(--oai-line);color:var(--oai-ink2);font-size:12px}
.oai-term-dots{display:inline-flex;gap:6px}.oai-term-dots i{width:9px;height:9px;border-radius:50%;background:#253247}
.oai-term-title{text-align:center}
.oai-card button.oai-term-close{justify-self:end;width:auto;margin:0;padding:0 2px;background:none;border:0;color:var(--oai-ink2);font-size:16px;line-height:1}
.oai-term-screen{padding:10px 12px;min-height:150px}
.oai-term-screen .xterm-viewport{background:#05080e!important}
.oai-term-foot{padding:8px 14px;border-top:1px solid var(--oai-line);color:var(--oai-ink2);font-size:12.5px}
`;

// src/client/connect-ai.js
var import_react7 = require("react");
var VENDOR_TERMS = "Personal use under the vendor's terms";
var FIRST_OTHERS = 4;
var LOGOS = { claude: "C", chatgpt: "G", deepseek: "D", kimi: "K", copilot: "P", grok: "X", openai: "O", anthropic: "A", openrouter: "R", zai: "Z", moonshot: "M", opencode: "OC", cliproxy: "⇄", ollama: "L" };
var CLAUDE_INSTALL = "curl -fsSL https://claude.ai/install.sh | bash";
function subscriptionRows(subscriptions) {
  if (!subscriptions) return [];
  return SUBSCRIPTION_TILES.map((tile) => {
    const count = signedInCount(subscriptions.accounts.map((account) => ({ ...account, configured: true })), tile.provider);
    const on2 = count > 0 && !subscriptions.hidden.includes(tile.provider);
    return { id: `sub:${tile.provider}`, name: tile.name, via: `${tile.note} · dsh-subscriptions`, kind: "subscription", tile, ready: count > 0, on: on2, found: count > 1 ? `${count} accounts` : count === 1 ? "Signed in" : null };
  });
}
function sections(rows) {
  const found = rows.filter((row) => row.found || row.on);
  const others = rows.filter((row) => !found.includes(row));
  return { found, others };
}
var onCount = (rows) => rows.filter((row) => row.on).length;
function flipAction(row) {
  if (row.on) return "off";
  return row.ready ? "on" : "setup";
}
function Copyable({ text }) {
  const [copied, setCopied] = (0, import_react7.useState)(false);
  return (0, import_react7.createElement)(
    "div",
    { className: "oai-code oai-command" },
    (0, import_react7.createElement)("code", null, text),
    (0, import_react7.createElement)("button", { type: "button", className: "oai-ghost", onClick: () => navigator.clipboard?.writeText(text).then(() => setCopied(true)) }, copied ? "Copied" : "Copy")
  );
}
function KeyForm({ row, provider, onSaved }) {
  const [apiKey, setApiKey] = (0, import_react7.useState)("");
  const [busy, setBusy] = (0, import_react7.useState)(false);
  const [problem, setProblem] = (0, import_react7.useState)(null);
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      await call("provider-key", { provider, apiKey });
      setApiKey("");
      onSaved();
    } catch (error) {
      setProblem(error.message);
      setBusy(false);
    }
  };
  return (0, import_react7.createElement)(
    "form",
    { onSubmit: submit, className: "oai-setup-form" },
    (0, import_react7.createElement)(
      "div",
      { className: "oai-field" },
      (0, import_react7.createElement)("input", { type: "password", required: true, autoComplete: "off", spellCheck: false, autoFocus: true, placeholder: `Paste your ${row.name} key`, "aria-label": `${row.name} key`, value: apiKey, onChange: (e) => setApiKey(e.target.value) }),
      (0, import_react7.createElement)("button", { type: "submit", className: "oai-primary", disabled: busy }, busy ? "Turning on…" : "Turn on")
    ),
    (0, import_react7.createElement)("p", { className: "oai-muted" }, "It stays on this computer, in DSH's own credential store.", row.keyUrl ? [" ", (0, import_react7.createElement)("a", { key: "k", className: "oai-link", href: row.keyUrl, target: "_blank", rel: "noreferrer" }, `Get a ${row.name} key`)] : null),
    problem ? (0, import_react7.createElement)("p", { className: "oai-error", role: "alert" }, problem) : null
  );
}
function SignIn({ row, provider, onSaved, onCancel }) {
  const [attempt, setAttempt] = (0, import_react7.useState)(null);
  const [problem, setProblem] = (0, import_react7.useState)(null);
  const [answer, setAnswer] = (0, import_react7.useState)("");
  const [copied, setCopied] = (0, import_react7.useState)(false);
  (0, import_react7.useEffect)(() => {
    let live = true;
    let timer = 0;
    const poll = async (first) => {
      try {
        const next = await call(first ? "signin-start" : "signin-status", { provider });
        if (!live) return;
        setAttempt(next);
        if (next.status === "authorized") return onSaved();
        if (next.status === "running") timer = setTimeout(() => poll(false), 1e3);
      } catch (error) {
        if (live) setProblem(error.message);
      }
    };
    poll(true);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [provider]);
  const reply = async (value) => {
    setProblem(null);
    try {
      setAttempt(await call("signin-answer", { provider, promptId: attempt.prompt.id, value }));
      setAnswer("");
    } catch (error) {
      setProblem(error.message);
    }
  };
  const cancel = async () => {
    await call("signin-cancel", { provider }).catch(() => {
    });
    onCancel();
  };
  const notice = attempt?.notice;
  const prompt = attempt?.prompt;
  const ended = attempt && ["cancelled", "failed", "none"].includes(attempt.status);
  const endedText = { failed: `The sign-in did not finish: ${attempt?.error}`, cancelled: "The sign-in was cancelled. Nothing was turned on.", none: "The sign-in stopped before it finished. Flip the switch to start again." };
  return (0, import_react7.createElement)(
    "div",
    { className: "oai-signin" },
    !attempt && !problem ? (0, import_react7.createElement)("p", { className: "oai-muted" }, `Starting the ${row.name} sign-in…`) : null,
    notice?.message ? (0, import_react7.createElement)("p", null, notice.message) : null,
    notice?.code ? (0, import_react7.createElement)(
      "div",
      { className: "oai-code" },
      (0, import_react7.createElement)("code", null, notice.code),
      (0, import_react7.createElement)("button", { type: "button", className: "oai-ghost", onClick: () => navigator.clipboard?.writeText(notice.code).then(() => setCopied(true)) }, copied ? "Copied" : "Copy code")
    ) : null,
    notice?.url ? (0, import_react7.createElement)("a", { className: "oai-primary oai-button", href: notice.url, target: "_blank", rel: "noreferrer" }, `Sign in with ${row.name}`) : null,
    prompt?.kind === "select" ? (0, import_react7.createElement)(
      "div",
      { className: "oai-choices", role: "group", "aria-label": prompt.message },
      (0, import_react7.createElement)("p", null, prompt.message),
      prompt.options.map((option) => (0, import_react7.createElement)("button", { key: option.id, type: "button", onClick: () => reply(option.id) }, (0, import_react7.createElement)("strong", null, option.label), option.description ? (0, import_react7.createElement)("span", null, option.description) : null))
    ) : null,
    prompt && prompt.kind !== "select" ? (0, import_react7.createElement)(
      "form",
      { onSubmit: (event) => {
        event.preventDefault();
        reply(answer);
      } },
      (0, import_react7.createElement)("label", { htmlFor: `oai-answer-${row.id}` }, prompt.message),
      (0, import_react7.createElement)("input", { id: `oai-answer-${row.id}`, type: prompt.kind === "secret" ? "password" : "text", required: true, autoComplete: "off", spellCheck: false, autoFocus: true, placeholder: prompt.placeholder, value: answer, onChange: (e) => setAnswer(e.target.value) }),
      (0, import_react7.createElement)("button", { type: "submit", className: "oai-primary" }, "Continue")
    ) : null,
    attempt?.status === "running" && !prompt ? (0, import_react7.createElement)("p", { className: "oai-muted oai-waiting" }, "Finish signing in on their page…") : null,
    ended ? (0, import_react7.createElement)("p", { className: "oai-error", role: "alert" }, endedText[attempt.status]) : null,
    problem ? (0, import_react7.createElement)("p", { className: "oai-error", role: "alert" }, problem) : null,
    !ended && !problem ? (0, import_react7.createElement)("button", { type: "button", className: "oai-quiet", onClick: cancel }, "Cancel") : null
  );
}
function CliproxyForm({ onSaved }) {
  const [baseURL, setBaseURL] = (0, import_react7.useState)("");
  const [apiKey, setApiKey] = (0, import_react7.useState)("");
  const [busy, setBusy] = (0, import_react7.useState)(false);
  const [problem, setProblem] = (0, import_react7.useState)(null);
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      await call("cliproxy", { baseURL, apiKey });
      setApiKey("");
      onSaved();
    } catch (error) {
      setProblem(error.message);
      setBusy(false);
    }
  };
  return (0, import_react7.createElement)(
    "form",
    { onSubmit: submit, className: "oai-setup-form" },
    (0, import_react7.createElement)("input", { type: "url", required: true, placeholder: "http://localhost:8317/v1", "aria-label": "Gateway address", autoComplete: "off", value: baseURL, onChange: (e) => setBaseURL(e.target.value) }),
    (0, import_react7.createElement)(
      "div",
      { className: "oai-field" },
      (0, import_react7.createElement)("input", { type: "password", required: true, placeholder: "Gateway key", "aria-label": "Gateway key", autoComplete: "off", spellCheck: false, value: apiKey, onChange: (e) => setApiKey(e.target.value) }),
      (0, import_react7.createElement)("button", { type: "submit", className: "oai-primary", disabled: busy }, busy ? "Turning on…" : "Turn on")
    ),
    (0, import_react7.createElement)("p", { className: "oai-muted" }, "Omni lists the gateway's models with your key and keeps the key in DSH's credential store."),
    problem ? (0, import_react7.createElement)("p", { className: "oai-error", role: "alert" }, problem) : null
  );
}
function ClaudeSetup({ row, onSaved, onClose }) {
  if (row.needs === "plugin") return (0, import_react7.createElement)("p", null, "Claude runs through the Oh My Claude plugin, which this DSH does not have. Add it from Settings → Plugins.");
  if (row.needs === "install") {
    return (0, import_react7.createElement)(
      "div",
      null,
      (0, import_react7.createElement)("p", null, "Install Claude Code, Anthropic's own app. In a terminal:"),
      (0, import_react7.createElement)(Copyable, { text: CLAUDE_INSTALL }),
      (0, import_react7.createElement)("p", { className: "oai-muted" }, "Or follow ", (0, import_react7.createElement)("a", { className: "oai-link", href: "https://code.claude.com/docs/en/setup", target: "_blank", rel: "noreferrer" }, "Anthropic's setup guide"), ". Then flip this again.")
    );
  }
  if (row.needs === "restart") return (0, import_react7.createElement)("p", { className: "oai-error" }, "Claude Code is signed in, but this app cannot start it from where it is installed. Restart the app to pick it up.");
  return (0, import_react7.createElement)(
    "div",
    null,
    (0, import_react7.createElement)(ClaudeLoginTerminal, { onClose, onEnded: (reply) => {
      if (reply.state === "done") onSaved();
    } }),
    (0, import_react7.createElement)("p", { className: "oai-muted" }, "Press Enter in the terminal. Claude Code signs in with your own Claude account; Omni only talks to the Claude Code app.")
  );
}
function Setup({ row, onSaved, onClose }) {
  if (row.kind === "claude") return (0, import_react7.createElement)(ClaudeSetup, { row, onSaved, onClose });
  if (row.kind === "key") return (0, import_react7.createElement)(KeyForm, { row, provider: providerOf(row), onSaved });
  if (row.kind === "signin") {
    if (row.signIn) return (0, import_react7.createElement)(SignIn, { row, provider: providerOf(row), onSaved, onCancel: onClose });
    if (row.keyUrl) return (0, import_react7.createElement)(KeyForm, { row, provider: providerOf(row), onSaved });
    return (0, import_react7.createElement)("p", null, `This DSH offers no ${row.name} sign-in.`);
  }
  if (row.kind === "gateway") return (0, import_react7.createElement)(CliproxyForm, { onSaved });
  if (row.kind === "local") return (0, import_react7.createElement)("p", { className: "oai-muted" }, "Ollama is not running on this computer. Start it, then flip this again.");
  if (row.kind === "subscription") return (0, import_react7.createElement)(SubscriptionSignIn, { tile: row.tile, onBack: onClose, onSaved, glitch: () => {
  } });
  return null;
}
var PROVIDER_OF = { chatgpt: "openai-codex", kimi: "kimi-coding", copilot: "github-copilot", grok: "xai", openai: "openai", anthropic: "anthropic", openrouter: "openrouter", zai: "zai", moonshot: "moonshotai", opencode: "opencode", deepseek: "deepseek" };
var providerOf = (row) => PROVIDER_OF[row.id] ?? row.id;
function Duplicates({ row, onDedupe }) {
  if (!row.duplicates?.length) return null;
  const shown = row.duplicates.filter((duplicate) => !duplicate.hidden);
  return (0, import_react7.createElement)(
    "div",
    { className: "oai-dupes" },
    row.duplicates.map((duplicate) => (0, import_react7.createElement)(
      "p",
      { key: `${duplicate.via}:${duplicate.provider}`, className: "oai-muted" },
      `Also connected through ${duplicate.via}; Omni uses ${row.name} ${row.kind === "claude" ? "through Claude Code" : "here"}.`,
      duplicate.hidden ? " Its models are hidden." : null
    )),
    shown.length && row.on ? (0, import_react7.createElement)("button", { type: "button", className: "oai-ghost", onClick: onDedupe }, `Use only this ${row.name}`) : null
  );
}
function Row({ row, open, busy, problem, onFlip, onSaved, onClose, onDedupe }) {
  const logo = LOGOS[row.id] ?? row.name.slice(0, 1);
  return (0, import_react7.createElement)(
    "div",
    { className: `oai-ai${row.on ? " oai-ai-on" : ""}` },
    (0, import_react7.createElement)(
      "div",
      { className: "oai-ai-row" },
      (0, import_react7.createElement)("div", { className: "oai-logo", "aria-hidden": true }, logo),
      (0, import_react7.createElement)(
        "div",
        { className: "oai-ai-what" },
        (0, import_react7.createElement)("strong", null, row.name),
        (0, import_react7.createElement)("span", null, row.detail ? `${row.via} · ${row.detail}` : row.via)
      ),
      row.found ? (0, import_react7.createElement)("em", { className: "oai-found" }, row.found) : null,
      (0, import_react7.createElement)("button", { type: "button", role: "switch", className: "oai-switch", "aria-checked": row.on ? "true" : "false", "aria-label": row.name, disabled: busy, onClick: onFlip })
    ),
    open && !row.on ? (0, import_react7.createElement)("div", { className: "oai-ai-setup" }, (0, import_react7.createElement)(Setup, { row, onSaved, onClose })) : null,
    problem ? (0, import_react7.createElement)("p", { className: "oai-error oai-ai-problem", role: "alert" }, problem) : null,
    (0, import_react7.createElement)(Duplicates, { row, onDedupe })
  );
}
function ConnectAiStep(props) {
  const state = useGate(props);
  const finish2 = useFinish(props);
  const [glitching, glitch] = useGlitch();
  const [rows, setRows] = (0, import_react7.useState)(null);
  const [subs, setSubs] = (0, import_react7.useState)(null);
  const [open, setOpen] = (0, import_react7.useState)(null);
  const [busy, setBusy] = (0, import_react7.useState)(null);
  const [problems, setProblems] = (0, import_react7.useState)({});
  const [showAll, setShowAll] = (0, import_react7.useState)(false);
  const refresh = (0, import_react7.useCallback)(async () => {
    const reply = await call("ais").catch(() => ({ rows: [], subscriptions: null }));
    setRows(reply.rows ?? []);
    setSubs(reply.subscriptions ?? null);
  }, []);
  (0, import_react7.useEffect)(() => {
    void refresh();
  }, [refresh]);
  (0, import_react7.useEffect)(() => {
    if (state) glitch();
  }, [state, glitch]);
  if (!state) return null;
  const all = rows === null ? null : [...rows, ...subscriptionRows(subs)];
  const say = (id, message) => setProblems((previous) => ({ ...previous, [id]: message }));
  const flip = async (row) => {
    const action = flipAction(row);
    say(row.id, null);
    if (action === "setup") {
      setOpen((current) => current === row.id ? null : row.id);
      return;
    }
    setBusy(row.id);
    try {
      if (row.kind === "subscription") await call("ai-subscription", { provider: row.tile.provider, on: action === "on" });
      else await call("ai-switch", { id: row.id, on: action === "on" });
      if (action === "on") glitch();
      await refresh();
    } catch (error) {
      say(row.id, error.message);
    }
    setBusy(null);
  };
  const saved = (row) => async () => {
    setOpen(null);
    glitch();
    if (row.kind !== "subscription") await call("ai-dedupe", { id: row.id }).catch(() => {
    });
    await refresh();
  };
  const dedupe = (row) => async () => {
    say(row.id, null);
    try {
      await call("ai-dedupe", { id: row.id });
      await refresh();
    } catch (error) {
      say(row.id, error.message);
    }
  };
  const count = all ? onCount(all) : 0;
  const { found, others } = sections(all ?? []);
  const visible = showAll ? others : others.slice(0, FIRST_OTHERS);
  const rowOf = (row) => (0, import_react7.createElement)(Row, { key: row.id, row, open: open === row.id, busy: busy !== null, problem: problems[row.id], onFlip: () => flip(row), onSaved: saved(row), onClose: () => setOpen(null), onDedupe: dedupe(row) });
  return (0, import_react7.createElement)(
    Stage,
    {
      title: "Turn on your AIs",
      speech: count > 0 ? `Turn on everything you have. More brains, more ${state.companionName ?? "Omni"}.` : "Now give me a brain. Turn on every AI you have; you can change it any time.",
      at: "omni-connect-ai",
      glitching
    },
    all === null ? (0, import_react7.createElement)("p", { className: "oai-muted" }, "Looking at what this computer has…") : [
      found.length ? (0, import_react7.createElement)(
        "section",
        { key: "found", className: "oai-group", "aria-label": "Found on this computer" },
        (0, import_react7.createElement)("h2", null, "Found on this computer"),
        (0, import_react7.createElement)("div", { className: "oai-list" }, found.map(rowOf))
      ) : null,
      (0, import_react7.createElement)(
        "section",
        { key: "others", className: "oai-group", "aria-label": found.length ? "Add another" : "Your AIs" },
        (0, import_react7.createElement)("h2", null, found.length ? "Add another" : "Your AIs"),
        (0, import_react7.createElement)("p", { className: "oai-terms oai-muted" }, `Subscriptions: ${VENDOR_TERMS.toLowerCase()}.`),
        (0, import_react7.createElement)(
          "div",
          { className: "oai-list" },
          visible.map(rowOf),
          !showAll && others.length > FIRST_OTHERS ? (0, import_react7.createElement)("button", { type: "button", className: "oai-more", onClick: () => setShowAll(true) }, `Show ${others.length - FIRST_OTHERS} more`) : null
        )
      ),
      (0, import_react7.createElement)("p", { key: "more", className: "oai-muted oai-every" }, "Every other provider DSH knows is in ", (0, import_react7.createElement)("button", { type: "button", className: "oai-inline", onClick: () => finish2("models") }, "Settings → Models"), ".")
    ],
    (0, import_react7.createElement)(
      "div",
      { className: "oai-actions" },
      (0, import_react7.createElement)("button", { type: "button", className: "oai-quiet", onClick: () => finish2() }, "Skip for now"),
      (0, import_react7.createElement)("span", { className: "oai-count" }, count > 0 ? `${count} on` : "Turn on at least one"),
      (0, import_react7.createElement)("button", { type: "button", className: "oai-primary", disabled: count === 0, onClick: () => finish2() }, count > 0 ? "Continue →" : "Continue")
    )
  );
}

// src/client/index.js
var STEPS = [
  { id: "omni-companion", order: -300, component: CompanionStep },
  { id: "omni-team", order: -270, component: TeamStep },
  { id: "omni-connect-ai", order: -200, component: ConnectAiStep }
];
var inject = ["slots"];
function installStyles() {
  const style = document.createElement("style");
  style.dataset.omniAi = "";
  style.textContent = STAGE_CSS + ONBOARD_CSS + INK_CSS + TERMINAL_CSS;
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
/*! Bundled license information:

@xterm/xterm/lib/xterm.mjs:
  (**
   * Copyright (c) 2014-2024 The xterm.js authors. All rights reserved.
   * @license MIT
   *
   * Copyright (c) 2012-2013, Christopher Jeffrey (MIT License)
   * @license MIT
   *
   * Originally forked from (with the author's permission):
   *   Fabrice Bellard's javascript vt100 for jslinux:
   *   http://bellard.org/jslinux/
   *   Copyright (c) 2011 Fabrice Bellard
   *)
*/
return Object.defineProperty({ ...module.exports }, Symbol.toStringTag, { value: 'Module' })
  },
})
