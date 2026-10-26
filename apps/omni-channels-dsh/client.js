// Generated from src/client by `npm run build` (scripts/build-client.mjs). Do not edit by hand.
window.__ModuleLoader__.load({
  id: '@automagik/omni-channels-dsh',
  factory: (dshRequire) => {
const require = (spec) => { if (spec !== '@automagik/bots-dsh/client') return dshRequire(spec); try { return dshRequire(spec) } catch (error) { try { return dshRequire('@automagik/omni-dsh/client') } catch { throw error } } }
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
function kl(s15, t2) {
  return t2 ? "\x1B[200~" + s15 + "\x1B[201~" : s15;
}
function Vs(s15, t2) {
  s15.clipboardData && s15.clipboardData.setData("text/plain", t2.selectionText), s15.preventDefault();
}
function qs(s15, t2, e, i) {
  if (s15.stopPropagation(), s15.clipboardData) {
    let r = s15.clipboardData.getData("text/plain");
    Cn(r, t2, e, i);
  }
}
function Cn(s15, t2, e, i) {
  s15 = Al(s15), s15 = kl(s15, e.decPrivateModes.bracketedPasteMode && i.rawOptions.ignoreBracketedPasteMode !== true), e.triggerDataEvent(s15, true), t2.value = "";
}
function Mn(s15, t2, e) {
  let i = e.getBoundingClientRect(), r = s15.clientX - i.left - 10, n = s15.clientY - i.top - 10;
  t2.style.width = "20px", t2.style.height = "20px", t2.style.left = `${r}px`, t2.style.top = `${n}px`, t2.style.zIndex = "1000", t2.focus();
}
function Pn(s15, t2, e, i, r) {
  Mn(s15, t2, e), r && i.rightClickSelect(s15), t2.value = i.selectionText, t2.select();
}
function Ce(s15) {
  return s15 > 65535 ? (s15 -= 65536, String.fromCharCode((s15 >> 10) + 55296) + String.fromCharCode(s15 % 1024 + 56320)) : String.fromCharCode(s15);
}
function It(s15, t2 = 0, e = s15.length) {
  let i = "";
  for (let r = t2; r < e; ++r) {
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
  let t2 = function(e, i, r) {
    if (arguments.length !== 3) throw new Error("@IServiceName-decorator can only be used to decorate a parameter");
    Pl(t2, e, r);
  };
  return t2._id = s15, Fn.set(s15, t2), t2;
}
function Pl(s15, t2, e) {
  t2[js] === t2 ? t2[Hn].push({ id: s15, index: e }) : (t2[Hn] = [{ id: s15, index: e }], t2[js] = t2);
}
function Ol(s15, t2) {
  if (confirm(`Do you want to navigate to ${t2}?

WARNING: This link could potentially be dangerous`)) {
    let i = window.open();
    if (i) {
      try {
        i.opener = null;
      } catch {
      }
      i.location.href = t2;
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
function Fl(s15, t2, e = 0, i = s15.length) {
  let r = e, n = i;
  for (; r < n; ) {
    let o = Math.floor((r + n) / 2);
    t2(s15[o]) ? r = o + 1 : n = o;
  }
  return r - 1;
}
function Se(s15, t2 = 0) {
  return s15[s15.length - (1 + t2)];
}
function no(s15, t2) {
  return (e, i) => t2(s15(e), s15(i));
}
function co(s15, t2) {
  let e = /* @__PURE__ */ Object.create(null);
  for (let i of s15) {
    let r = t2(i), n = e[r];
    n || (n = e[r] = []), n.push(i);
  }
  return e;
}
function Kn(s15, t2) {
  let e = this, i = false, r;
  return function() {
    if (i) return r;
    if (i = true, t2) try {
      r = s15.apply(e, arguments);
    } finally {
      t2();
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
function vi(s15, t2) {
  dt?.setParent(s15, t2);
}
function Kl(s15, t2) {
  if (dt) for (let e of s15) dt.setParent(e, t2);
}
function Gn(s15) {
  return dt?.markAsSingleton(s15), s15;
}
function Ne(s15) {
  if (zn.is(s15)) {
    let t2 = [];
    for (let e of s15) if (e) try {
      e.dispose();
    } catch (i) {
      t2.push(i);
    }
    if (t2.length === 1) throw t2[0];
    if (t2.length > 1) throw new AggregateError(t2, "Encountered errors while disposing of store");
    return Array.isArray(s15) ? [] : s15;
  } else if (s15) return s15.dispose(), s15;
}
function ho(...s15) {
  let t2 = C(() => Ne(s15));
  return Kl(s15, t2), t2;
}
function C(s15) {
  let t2 = fr({ dispose: Kn(() => {
    pr(t2), s15();
  }) });
  return t2;
}
function Xl(s15, t2, e) {
  typeof t2 == "string" && (t2 = s15.matchMedia(t2)), t2.addEventListener("change", e);
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
  let t2 = s15.keyCode;
  if (t2 === 3) return 7;
  if (Ei) switch (t2) {
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
    if (Te && t2 === 93) return 57;
    if (!Te && t2 === 92) return 57;
  }
  return yo[t2] || 0;
}
function pa(s15) {
  if (!s15.parent || s15.parent === s15) return null;
  try {
    let t2 = s15.location, e = s15.parent.location;
    if (t2.origin !== "null" && e.origin !== "null" && t2.origin !== e.origin) return null;
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
function Ao(s15, t2) {
  return (s15 - 55296 << 10) + (t2 - 56320) + 65536;
}
function Mo(s15) {
  return ns(s15, 0);
}
function ns(s15, t2) {
  switch (typeof s15) {
    case "object":
      return s15 === null ? je(349, t2) : Array.isArray(s15) ? Ea(s15, t2) : Ta(s15, t2);
    case "string":
      return Po(s15, t2);
    case "boolean":
      return Sa(s15, t2);
    case "number":
      return je(s15, t2);
    case "undefined":
      return je(937, t2);
    default:
      return je(617, t2);
  }
}
function je(s15, t2) {
  return (t2 << 5) - t2 + s15 | 0;
}
function Sa(s15, t2) {
  return je(s15 ? 433 : 863, t2);
}
function Po(s15, t2) {
  t2 = je(149417, t2);
  for (let e = 0, i = s15.length; e < i; e++) t2 = je(s15.charCodeAt(e), t2);
  return t2;
}
function Ea(s15, t2) {
  return t2 = je(104579, t2), s15.reduce((e, i) => ns(i, e), t2);
}
function Ta(s15, t2) {
  return t2 = je(181387, t2), Object.keys(s15).sort().reduce((e, i) => (e = Po(i, e), ns(s15[i], e)), t2);
}
function rs(s15, t2, e = 32) {
  let i = e - t2, r = ~((1 << i) - 1);
  return (s15 << t2 | (r & s15) >>> i) >>> 0;
}
function ko(s15, t2 = 0, e = s15.byteLength, i = 0) {
  for (let r = 0; r < e; r++) s15[t2 + r] = i;
}
function Ia(s15, t2, e = "0") {
  for (; s15.length < t2; ) s15 = e + s15;
  return s15;
}
function wi(s15, t2 = 32) {
  return s15 instanceof ArrayBuffer ? Array.from(new Uint8Array(s15)).map((e) => e.toString(16).padStart(2, "0")).join("") : Ia((s15 >>> 0).toString(16), t2 / 4);
}
function L(s15, t2, e, i) {
  return new ss(s15, t2, e, i);
}
function ya(s15, t2) {
  return function(e) {
    return t2(new qe(s15, e));
  };
}
function xa(s15) {
  return function(t2) {
    return s15(new ft(t2));
  };
}
function Fo(s15) {
  let t2 = s15.getBoundingClientRect(), e = be(s15);
  return { left: t2.left + e.scrollX, top: t2.top + e.scrollY, width: t2.width, height: t2.height };
}
function Ho(s15, t2, e, ...i) {
  let r = Da.exec(t2);
  if (!r) throw new Error("Bad use of emmet");
  let n = r[1] || "div", o;
  return s15 !== "http://www.w3.org/1999/xhtml" ? o = document.createElementNS(s15, n) : o = document.createElement(n), r[3] && (o.id = r[3]), r[4] && (o.className = r[4].replace(/\./g, " ").trim()), e && Object.entries(e).forEach(([l, a]) => {
    typeof a > "u" || (/^on\w+$/.test(l) ? o[l] = a : l === "selected" ? a && o.setAttribute(l, "true") : o.setAttribute(l, a));
  }), o.append(...i), o;
}
function Ra(s15, t2, ...e) {
  return Ho("http://www.w3.org/1999/xhtml", s15, t2, ...e);
}
function Ie(s15) {
  return typeof s15 == "number" ? `${s15}px` : s15;
}
function _t(s15) {
  return new ls(s15);
}
function Wo(s15, t2, e) {
  let i = null, r = null;
  if (typeof e.value == "function" ? (i = "value", r = e.value, r.length !== 0 && console.warn("Memoize should only be used in functions with zero parameters")) : typeof e.get == "function" && (i = "get", r = e.get), !r) throw new Error("not supported");
  let n = `$memoize$${t2}`;
  e[i] = function(...o) {
    return this.hasOwnProperty(n) || Object.defineProperty(this, n, { configurable: false, enumerable: false, writable: false, value: r.apply(this, o) }), this[n];
  };
}
function as(s15, t2) {
  let e = t2 - s15;
  return function(i) {
    return s15 + e * ka(i);
  };
}
function La(s15, t2, e) {
  return function(i) {
    return i < e ? s15(i / e) : t2((i - e) / (1 - e));
  };
}
function Aa(s15) {
  return Math.pow(s15, 3);
}
function ka(s15) {
  return 1 - Aa(1 - s15);
}
function Pa(s15) {
  let t2 = { lazyRender: typeof s15.lazyRender < "u" ? s15.lazyRender : false, className: typeof s15.className < "u" ? s15.className : "", useShadows: typeof s15.useShadows < "u" ? s15.useShadows : true, handleMouseWheel: typeof s15.handleMouseWheel < "u" ? s15.handleMouseWheel : true, flipAxes: typeof s15.flipAxes < "u" ? s15.flipAxes : false, consumeMouseWheelIfScrollbarIsNeeded: typeof s15.consumeMouseWheelIfScrollbarIsNeeded < "u" ? s15.consumeMouseWheelIfScrollbarIsNeeded : false, alwaysConsumeMouseWheel: typeof s15.alwaysConsumeMouseWheel < "u" ? s15.alwaysConsumeMouseWheel : false, scrollYToX: typeof s15.scrollYToX < "u" ? s15.scrollYToX : false, mouseWheelScrollSensitivity: typeof s15.mouseWheelScrollSensitivity < "u" ? s15.mouseWheelScrollSensitivity : 1, fastScrollSensitivity: typeof s15.fastScrollSensitivity < "u" ? s15.fastScrollSensitivity : 5, scrollPredominantAxis: typeof s15.scrollPredominantAxis < "u" ? s15.scrollPredominantAxis : true, mouseWheelSmoothScroll: typeof s15.mouseWheelSmoothScroll < "u" ? s15.mouseWheelSmoothScroll : true, arrowSize: typeof s15.arrowSize < "u" ? s15.arrowSize : 11, listenOnDomNode: typeof s15.listenOnDomNode < "u" ? s15.listenOnDomNode : null, horizontal: typeof s15.horizontal < "u" ? s15.horizontal : 1, horizontalScrollbarSize: typeof s15.horizontalScrollbarSize < "u" ? s15.horizontalScrollbarSize : 10, horizontalSliderSize: typeof s15.horizontalSliderSize < "u" ? s15.horizontalSliderSize : 0, horizontalHasArrows: typeof s15.horizontalHasArrows < "u" ? s15.horizontalHasArrows : false, vertical: typeof s15.vertical < "u" ? s15.vertical : 1, verticalScrollbarSize: typeof s15.verticalScrollbarSize < "u" ? s15.verticalScrollbarSize : 10, verticalHasArrows: typeof s15.verticalHasArrows < "u" ? s15.verticalHasArrows : false, verticalSliderSize: typeof s15.verticalSliderSize < "u" ? s15.verticalSliderSize : 0, scrollByPage: typeof s15.scrollByPage < "u" ? s15.scrollByPage : false };
  return t2.horizontalSliderSize = typeof s15.horizontalSliderSize < "u" ? s15.horizontalSliderSize : t2.horizontalScrollbarSize, t2.verticalSliderSize = typeof s15.verticalSliderSize < "u" ? s15.verticalSliderSize : t2.verticalScrollbarSize, Te && (t2.className += " mac"), t2;
}
function vt(s15) {
  let t2 = s15.toString(16);
  return t2.length < 2 ? "0" + t2 : t2;
}
function Xe(s15, t2) {
  return s15 < t2 ? (t2 + 0.05) / (s15 + 0.05) : (s15 + 0.05) / (t2 + 0.05);
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
function qo(s15, t2, e) {
  for (; s15.length < e; ) s15 = t2 + s15;
  return s15;
}
function Yo() {
  return new ms();
}
function Ci(s15, t2, e) {
  let i = e.getBoundingClientRect(), r = s15.getComputedStyle(e), n = parseInt(r.getPropertyValue("padding-left")), o = parseInt(r.getPropertyValue("padding-top"));
  return [t2.clientX - i.left - n, t2.clientY - i.top - o];
}
function Xo(s15, t2, e, i, r, n, o, l, a) {
  if (!n) return;
  let u = Ci(s15, t2, e);
  if (u) return u[0] = Math.ceil((u[0] + (a ? o / 2 : 0)) / o), u[1] = Math.ceil(u[1] / l), u[0] = Math.min(Math.max(u[0], 1), i + (a ? 1 : 0)), u[1] = Math.min(Math.max(u[1], 1), r), u;
}
function Ha() {
  if (!Zo) return 0;
  let s15 = Pi.match(/Version\/(\d+)/);
  return s15 === null || s15.length < 2 ? 0 : parseInt(s15[1]);
}
function Jo(s15, t2, e, i) {
  let r = e.buffer.x, n = e.buffer.y;
  if (!e.buffer.hasScrollback) return Ga(r, n, s15, t2, e, i) + sn(n, t2, e, i) + $a(r, n, s15, t2, e, i);
  let o;
  if (n === t2) return o = r > s15 ? "D" : "C", Fi(Math.abs(r - s15), Ni(o, i));
  o = n > t2 ? "D" : "C";
  let l = Math.abs(n - t2), a = za(n > t2 ? s15 : r, e) + (l - 1) * e.cols + 1 + Ka(n > t2 ? r : s15, e);
  return Fi(a, Ni(o, i));
}
function Ka(s15, t2) {
  return s15 - 1;
}
function za(s15, t2) {
  return t2.cols - s15;
}
function Ga(s15, t2, e, i, r, n) {
  return sn(t2, i, r, n).length === 0 ? "" : Fi(el(s15, t2, s15, t2 - gt(t2, r), false, r).length, Ni("D", n));
}
function sn(s15, t2, e, i) {
  let r = s15 - gt(s15, e), n = t2 - gt(t2, e), o = Math.abs(r - n) - Va(s15, t2, e);
  return Fi(o, Ni(Qo(s15, t2), i));
}
function $a(s15, t2, e, i, r, n) {
  let o;
  sn(t2, i, r, n).length > 0 ? o = i - gt(i, r) : o = t2;
  let l = i, a = qa(s15, t2, e, i, r, n);
  return Fi(el(s15, o, e, l, a === "C", r).length, Ni(a, n));
}
function Va(s15, t2, e) {
  let i = 0, r = s15 - gt(s15, e), n = t2 - gt(t2, e);
  for (let o = 0; o < Math.abs(r - n); o++) {
    let l = Qo(s15, t2) === "A" ? -1 : 1;
    e.buffer.lines.get(r + l * o)?.isWrapped && i++;
  }
  return i;
}
function gt(s15, t2) {
  let e = 0, i = t2.buffer.lines.get(s15), r = i?.isWrapped;
  for (; r && s15 >= 0 && s15 < t2.rows; ) e++, i = t2.buffer.lines.get(--s15), r = i?.isWrapped;
  return e;
}
function qa(s15, t2, e, i, r, n) {
  let o;
  return sn(e, i, r, n).length > 0 ? o = i - gt(i, r) : o = t2, s15 < e && o <= i || s15 >= e && o < i ? "C" : "D";
}
function Qo(s15, t2) {
  return s15 > t2 ? "A" : "B";
}
function el(s15, t2, e, i, r, n) {
  let o = s15, l = t2, a = "";
  for (; (o !== e || l !== i) && l >= 0 && l < n.buffer.lines.length; ) o += r ? 1 : -1, r && o > n.cols - 1 ? (a += n.buffer.translateBufferLineToString(l, false, s15, o), o = 0, s15 = 0, l++) : !r && o < 0 && (a += n.buffer.translateBufferLineToString(l, false, 0, s15 + 1), o = n.cols - 1, s15 = o, l--);
  return a + n.buffer.translateBufferLineToString(l, false, s15, o);
}
function Ni(s15, t2) {
  let e = t2 ? "O" : "[";
  return b.ESC + e + s15;
}
function Fi(s15, t2) {
  s15 = Math.floor(s15);
  let e = "";
  for (let i = 0; i < s15; i++) e += t2;
  return e;
}
function ws(s15, t2) {
  if (s15.start.y > s15.end.y) throw new Error(`Buffer range end (${s15.end.x}, ${s15.end.y}) cannot be before start (${s15.start.x}, ${s15.start.y})`);
  return t2 * (s15.end.y - s15.start.y) + (s15.end.x - s15.start.x + 1);
}
function K(s15, t2) {
  if (s15 !== void 0) try {
    return z.toColor(s15);
  } catch {
  }
  return t2;
}
function sl(s15, t2, e, i, r, n) {
  let o = [];
  for (let l = 0; l < s15.length - 1; l++) {
    let a = l, u = s15.get(++a);
    if (!u.isWrapped) continue;
    let h16 = [s15.get(l)];
    for (; a < s15.length && u.isWrapped; ) h16.push(u), u = s15.get(++a);
    if (!n && i >= l && i < a) {
      l += h16.length - 1;
      continue;
    }
    let c = 0, d = ri(h16, c, t2), _ = 1, p = 0;
    for (; _ < h16.length; ) {
      let f = ri(h16, _, t2), A = f - p, R = e - d, O = Math.min(A, R);
      h16[c].copyCellsFrom(h16[_], p, d, O, false), d += O, d === e && (c++, d = 0), p += O, p === f && (_++, p = 0), d === 0 && c !== 0 && h16[c - 1].getWidth(e - 1) === 2 && (h16[c].copyCellsFrom(h16[c - 1], e - 1, d++, 1, false), h16[c - 1].setCell(e - 1, r));
    }
    h16[c].replaceCells(d, e, r);
    let m = 0;
    for (let f = h16.length - 1; f > 0 && (f > c || h16[f].getTrimmedLength() === 0); f--) m++;
    m > 0 && (o.push(l + h16.length - m), o.push(m)), l += h16.length - 1;
  }
  return o;
}
function ol(s15, t2) {
  let e = [], i = 0, r = t2[i], n = 0;
  for (let o = 0; o < s15.length; o++) if (r === o) {
    let l = t2[++i];
    s15.onDeleteEmitter.fire({ index: o - n, amount: l }), o += l - 1, n += l, r = t2[++i];
  } else e.push(o);
  return { layout: e, countRemoved: n };
}
function ll(s15, t2) {
  let e = [];
  for (let i = 0; i < t2.length; i++) e.push(s15.get(t2[i]));
  for (let i = 0; i < e.length; i++) s15.set(i, e[i]);
  s15.length = t2.length;
}
function al(s15, t2, e) {
  let i = [], r = s15.map((a, u) => ri(s15, u, t2)).reduce((a, u) => a + u), n = 0, o = 0, l = 0;
  for (; l < r; ) {
    if (r - l < e) {
      i.push(r - l);
      break;
    }
    n += e;
    let a = ri(s15, o, t2);
    n > a && (n -= a, o++);
    let u = s15[o].getWidth(n - 1) === 2;
    u && n--;
    let h16 = u ? e - 1 : e;
    i.push(h16), l += h16;
  }
  return i;
}
function ri(s15, t2, e) {
  if (t2 === s15.length - 1) return s15[t2].getTrimmedLength();
  let i = !s15[t2].hasContent(e - 1) && s15[t2].getWidth(e - 1) === 1, r = s15[t2 + 1].getWidth(0) === 2;
  return i && r ? e - 1 : e;
}
function sc(s15) {
  return s15 === "block" || s15 === "underline" || s15 === "bar";
}
function oi(s15, t2 = 5) {
  if (typeof s15 != "object") return s15;
  let e = Array.isArray(s15) ? [] : {};
  for (let i in s15) e[i] = t2 <= 1 ? s15[i] : s15[i] && oi(s15[i], t2 - 1);
  return e;
}
function Ms(s15, t2) {
  let e = (s15.ctrl ? 16 : 0) | (s15.shift ? 4 : 0) | (s15.alt ? 8 : 0);
  return s15.button === 4 ? (e |= 64, e |= s15.action) : (e |= s15.button & 3, s15.button & 4 && (e |= 64), s15.button & 8 && (e |= 128), s15.action === 32 ? e |= 32 : s15.action === 0 && !t2 && (e |= 3)), e;
}
function cc(s15, t2) {
  let e = 0, i = t2.length - 1, r;
  if (s15 < t2[0][0] || s15 > t2[i][1]) return false;
  for (; i >= e; ) if (r = e + i >> 1, s15 > t2[r][1]) e = r + 1;
  else if (s15 < t2[r][0]) i = r - 1;
  else return true;
  return false;
}
function Bs(s15) {
  let e = s15.buffer.lines.get(s15.buffer.ybase + s15.buffer.y - 1)?.get(s15.cols - 1), i = s15.buffer.lines.get(s15.buffer.ybase + s15.buffer.y);
  i && e && (i.isWrapped = e[3] !== 0 && e[3] !== 32);
}
function Ws(s15) {
  if (!s15) return;
  let t2 = s15.toLowerCase();
  if (t2.indexOf("rgb:") === 0) {
    t2 = t2.slice(4);
    let e = dc.exec(t2);
    if (e) {
      let i = e[1] ? 15 : e[4] ? 255 : e[7] ? 4095 : 65535;
      return [Math.round(parseInt(e[1] || e[4] || e[7] || e[10], 16) / i * 255), Math.round(parseInt(e[2] || e[5] || e[8] || e[11], 16) / i * 255), Math.round(parseInt(e[3] || e[6] || e[9] || e[12], 16) / i * 255)];
    }
  } else if (t2.indexOf("#") === 0 && (t2 = t2.slice(1), fc.exec(t2) && [3, 6, 9, 12].includes(t2.length))) {
    let e = t2.length / 3, i = [0, 0, 0];
    for (let r = 0; r < 3; ++r) {
      let n = parseInt(t2.slice(e * r, e * r + e), 16);
      i[r] = e === 1 ? n << 4 : e === 2 ? n : e === 3 ? n >> 4 : n >> 8;
    }
    return i;
  }
}
function Hs(s15, t2) {
  let e = s15.toString(16), i = e.length < 2 ? "0" + e : e;
  switch (t2) {
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
function ml(s15, t2 = 16) {
  let [e, i, r] = s15;
  return `rgb:${Hs(e, t2)}/${Hs(i, t2)}/${Hs(r, t2)}`;
}
function bl(s15, t2) {
  if (s15 > 24) return t2.setWinLines || false;
  switch (s15) {
    case 1:
      return !!t2.restoreWin;
    case 2:
      return !!t2.minimizeWin;
    case 3:
      return !!t2.setWinPosition;
    case 4:
      return !!t2.setWinSizePixels;
    case 5:
      return !!t2.raiseWin;
    case 6:
      return !!t2.lowerWin;
    case 7:
      return !!t2.refreshWin;
    case 8:
      return !!t2.setWinSizeChars;
    case 9:
      return !!t2.maximizeWin;
    case 10:
      return !!t2.fullscreenWin;
    case 11:
      return !!t2.getWinState;
    case 13:
      return !!t2.getWinPosition;
    case 14:
      return !!t2.getWinSizePixels;
    case 15:
      return !!t2.getScreenSizePixels;
    case 16:
      return !!t2.getCellSizePixels;
    case 18:
      return !!t2.getWinSizeChars;
    case 19:
      return !!t2.getScreenSizeChars;
    case 20:
      return !!t2.getIconTitle;
    case 21:
      return !!t2.getWinTitle;
    case 22:
      return !!t2.pushTitle;
    case 23:
      return !!t2.popTitle;
    case 24:
      return !!t2.setWinLines;
  }
  return false;
}
function Sl(s15) {
  return 0 <= s15 && s15 < 256;
}
function Il(s15, t2, e, i) {
  let r = { type: 0, cancel: false, key: void 0 }, n = (s15.shiftKey ? 1 : 0) | (s15.altKey ? 2 : 0) | (s15.ctrlKey ? 4 : 0) | (s15.metaKey ? 8 : 0);
  switch (s15.keyCode) {
    case 0:
      s15.key === "UIKeyInputUpArrow" ? t2 ? r.key = b.ESC + "OA" : r.key = b.ESC + "[A" : s15.key === "UIKeyInputLeftArrow" ? t2 ? r.key = b.ESC + "OD" : r.key = b.ESC + "[D" : s15.key === "UIKeyInputRightArrow" ? t2 ? r.key = b.ESC + "OC" : r.key = b.ESC + "[C" : s15.key === "UIKeyInputDownArrow" && (t2 ? r.key = b.ESC + "OB" : r.key = b.ESC + "[B");
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
      n ? r.key = b.ESC + "[1;" + (n + 1) + "D" : t2 ? r.key = b.ESC + "OD" : r.key = b.ESC + "[D";
      break;
    case 39:
      if (s15.metaKey) break;
      n ? r.key = b.ESC + "[1;" + (n + 1) + "C" : t2 ? r.key = b.ESC + "OC" : r.key = b.ESC + "[C";
      break;
    case 38:
      if (s15.metaKey) break;
      n ? r.key = b.ESC + "[1;" + (n + 1) + "A" : t2 ? r.key = b.ESC + "OA" : r.key = b.ESC + "[A";
      break;
    case 40:
      if (s15.metaKey) break;
      n ? r.key = b.ESC + "[1;" + (n + 1) + "B" : t2 ? r.key = b.ESC + "OB" : r.key = b.ESC + "[B";
      break;
    case 45:
      !s15.shiftKey && !s15.ctrlKey && (r.key = b.ESC + "[2~");
      break;
    case 46:
      n ? r.key = b.ESC + "[3;" + (n + 1) + "~" : r.key = b.ESC + "[3~";
      break;
    case 36:
      n ? r.key = b.ESC + "[1;" + (n + 1) + "H" : t2 ? r.key = b.ESC + "OH" : r.key = b.ESC + "[H";
      break;
    case 35:
      n ? r.key = b.ESC + "[1;" + (n + 1) + "F" : t2 ? r.key = b.ESC + "OF" : r.key = b.ESC + "[F";
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
function Ec(s15, t2) {
  return s15.text === t2.text && s15.range.start.x === t2.range.start.x && s15.range.start.y === t2.range.start.y && s15.range.end.x === t2.range.end.x && s15.range.end.y === t2.range.end.y;
}
function Tc(s15) {
  return s15.keyCode === 16 || s15.keyCode === 17 || s15.keyCode === 18;
}
var zs, Rl, Ll, M, S, Gs, mi, $s, _i, er, tr, ir, we, De, rt, q, js, Hn, Fn, F, rr, ge, Zs, xt, nr, H, sr, Js, Be, wt, nt, ae, Dt, ce, Qs, or, Re, lr, Wn, Bl, Un, bi, ar, Rt, cr, to, ro, so, At, io, lo, ao, oo, ur, zn, Wl, dt, hr, uo, dr, Ee, D, ye, fe, kt, G, Ct, zl, mr, Gl, fo, $l, $, Mt, $n, po, br, Vn, gi, qn, Yn, Vl, Pt, ql, Yl, _r, v, jn, gr, Si, Eu, Tu, Ot, Ei, Bt, Ti, Sr, Iu, yu, vr, Nt, yr, xr, Ii, Zl, vo, go, Jl, Ql, ea, ta, Tr, Ir, bo, ia, $e, Ve, xe, So, ra, Xn, wr, Te, Zn, Dr, na, xu, Fe, st, sa, oa, Eo, la, wu, Du, Ru, Lu, ot, aa, yi, Jn, To, Io, yo, Qn, Rr, es, ua, ha, da, fa, ft, wo, Lr, qe, xi, Do, ma, ts, _a, Ye, kr, ba, Ar, va, _e, Ro, Cr, Co, Bh, be, Nh, Fh, Hh, Oo, Wh, Uh, No, Kh, zh, ss, os, wa, mt, Mr, Di, pt, Bo, Gh, Y, Da, ls, Wt, He, Q, Pr, lt, Uo, Or, cs, Ri, Br, Nr, Fr, Ca, Ut, Kt, Wr, Ur, Ma, Ko, zo, us, zr, hs, ds, Kr, zt, Gt, Gr, We, at, Li, bt, b, Ai, fs, $t, ue, he, de, J, ps, j, U, z, ve, $r, Vr, ct, Vt, Yr, ms, _s, Le, jr, jo, ki, Xr, Na, Yt, jt, Zr, bs, vs, Jr, gs, Qr, Xt, en, tn, Mi, Pi, Oi, Ss, Fa, Zo, Zt, Wa, Ua, Es, Bi, Ts, rn, Is, ys, Jt, nn, Qt, xs, on, Ds, Ya, ja, Xa, Za, Ja, ei, Hi, Wi, re, St, Ki, tl, il, Ui, Qa, ti, Rs, ln, ec, tc, ii, ic, zi, B, X, an, Ls, Ze, un, cn, ne, Je, cl, $i, hn, ks, Cs, ni, si, nc, dn, ul, hl, li, dl, Ps, fl, ai, Os, ac, se, fn, Ae, pn, Vi, uc, ci, qi, mn, pe, Yi, _n, ji, Xi, Fs, ke, hc, bn, dc, fc, mc, ut, _l, vl, gl, vn, Zi, _c, El, bc, gn, ui, Tl, Sn, gc, ee, En, Us, yl, Tn, Ks, Sc, In, xl, wl, Tt, hi, yn, xn, wn, Ji, Dn, Rn, Ln, Ic, Ue, Dl;
var init_xterm = __esm({
  "node_modules/@xterm/xterm/lib/xterm.mjs"() {
    zs = Object.defineProperty;
    Rl = Object.getOwnPropertyDescriptor;
    Ll = (s15, t2) => {
      for (var e in t2) zs(s15, e, { get: t2[e], enumerable: true });
    };
    M = (s15, t2, e, i) => {
      for (var r = i > 1 ? void 0 : i ? Rl(t2, e) : t2, n = s15.length - 1, o; n >= 0; n--) (o = s15[n]) && (r = (i ? o(t2, e, r) : o(r)) || r);
      return i && r && zs(t2, e, r), r;
    }, S = (s15, t2) => (e, i) => t2(e, i, s15);
    Gs = "Terminal input", mi = { get: () => Gs, set: (s15) => Gs = s15 }, $s = "Too much output to announce, navigate to rows manually to read", _i = { get: () => $s, set: (s15) => $s = s15 };
    er = class {
      constructor() {
        this._interim = 0;
      }
      clear() {
        this._interim = 0;
      }
      decode(t2, e) {
        let i = t2.length;
        if (!i) return 0;
        let r = 0, n = 0;
        if (this._interim) {
          let o = t2.charCodeAt(n++);
          56320 <= o && o <= 57343 ? e[r++] = (this._interim - 55296) * 1024 + o - 56320 + 65536 : (e[r++] = this._interim, e[r++] = o), this._interim = 0;
        }
        for (let o = n; o < i; ++o) {
          let l = t2.charCodeAt(o);
          if (55296 <= l && l <= 56319) {
            if (++o >= i) return this._interim = l, r;
            let a = t2.charCodeAt(o);
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
      decode(t2, e) {
        let i = t2.length;
        if (!i) return 0;
        let r = 0, n, o, l, a, u = 0, h16 = 0;
        if (this.interim[0]) {
          let _ = false, p = this.interim[0];
          p &= (p & 224) === 192 ? 31 : (p & 240) === 224 ? 15 : 7;
          let m = 0, f;
          for (; (f = this.interim[++m] & 63) && m < 4; ) p <<= 6, p |= f;
          let A = (this.interim[0] & 224) === 192 ? 2 : (this.interim[0] & 240) === 224 ? 3 : 4, R = A - m;
          for (; h16 < R; ) {
            if (h16 >= i) return 0;
            if (f = t2[h16++], (f & 192) !== 128) {
              h16--, _ = true;
              break;
            } else this.interim[m++] = f, p <<= 6, p |= f & 63;
          }
          _ || (A === 2 ? p < 128 ? h16-- : e[r++] = p : A === 3 ? p < 2048 || p >= 55296 && p <= 57343 || p === 65279 || (e[r++] = p) : p < 65536 || p > 1114111 || (e[r++] = p)), this.interim.fill(0);
        }
        let c = i - 4, d = h16;
        for (; d < i; ) {
          for (; d < c && !((n = t2[d]) & 128) && !((o = t2[d + 1]) & 128) && !((l = t2[d + 2]) & 128) && !((a = t2[d + 3]) & 128); ) e[r++] = n, e[r++] = o, e[r++] = l, e[r++] = a, d += 4;
          if (n = t2[d++], n < 128) e[r++] = n;
          else if ((n & 224) === 192) {
            if (d >= i) return this.interim[0] = n, r;
            if (o = t2[d++], (o & 192) !== 128) {
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
            if (o = t2[d++], (o & 192) !== 128) {
              d--;
              continue;
            }
            if (d >= i) return this.interim[0] = n, this.interim[1] = o, r;
            if (l = t2[d++], (l & 192) !== 128) {
              d--;
              continue;
            }
            if (u = (n & 15) << 12 | (o & 63) << 6 | l & 63, u < 2048 || u >= 55296 && u <= 57343 || u === 65279) continue;
            e[r++] = u;
          } else if ((n & 248) === 240) {
            if (d >= i) return this.interim[0] = n, r;
            if (o = t2[d++], (o & 192) !== 128) {
              d--;
              continue;
            }
            if (d >= i) return this.interim[0] = n, this.interim[1] = o, r;
            if (l = t2[d++], (l & 192) !== 128) {
              d--;
              continue;
            }
            if (d >= i) return this.interim[0] = n, this.interim[1] = o, this.interim[2] = l, r;
            if (a = t2[d++], (a & 192) !== 128) {
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
      static toColorRGB(t2) {
        return [t2 >>> 16 & 255, t2 >>> 8 & 255, t2 & 255];
      }
      static fromColorRGB(t2) {
        return (t2[0] & 255) << 16 | (t2[1] & 255) << 8 | t2[2] & 255;
      }
      clone() {
        let t2 = new s();
        return t2.fg = this.fg, t2.bg = this.bg, t2.extended = this.extended.clone(), t2;
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
      constructor(t2 = 0, e = 0) {
        this._ext = 0;
        this._urlId = 0;
        this._ext = t2, this._urlId = e;
      }
      get ext() {
        return this._urlId ? this._ext & -469762049 | this.underlineStyle << 26 : this._ext;
      }
      set ext(t2) {
        this._ext = t2;
      }
      get underlineStyle() {
        return this._urlId ? 5 : (this._ext & 469762048) >> 26;
      }
      set underlineStyle(t2) {
        this._ext &= -469762049, this._ext |= t2 << 26 & 469762048;
      }
      get underlineColor() {
        return this._ext & 67108863;
      }
      set underlineColor(t2) {
        this._ext &= -67108864, this._ext |= t2 & 67108863;
      }
      get urlId() {
        return this._urlId;
      }
      set urlId(t2) {
        this._urlId = t2;
      }
      get underlineVariantOffset() {
        let t2 = (this._ext & 3758096384) >> 29;
        return t2 < 0 ? t2 ^ 4294967288 : t2;
      }
      set underlineVariantOffset(t2) {
        this._ext &= 536870911, this._ext |= t2 << 29 & 3758096384;
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
      constructor(t2, e, i) {
        this._bufferService = t2;
        this._optionsService = e;
        this._oscLinkService = i;
      }
      provideLinks(t2, e) {
        let i = this._bufferService.buffer.lines.get(t2 - 1);
        if (!i) {
          e(void 0);
          return;
        }
        let r = [], n = this._optionsService.rawOptions.linkHandler, o = new q(), l = i.getTrimmedLength(), a = -1, u = -1, h16 = false;
        for (let c = 0; c < l; c++) if (!(u === -1 && !i.hasContent(c))) {
          if (i.loadCell(c, o), o.hasExtendedAttrs() && o.extended.urlId) if (u === -1) {
            u = c, a = o.extended.urlId;
            continue;
          } else h16 = o.extended.urlId !== a;
          else u !== -1 && (h16 = true);
          if (h16 || u !== -1 && c === l - 1) {
            let d = this._oscLinkService.getLinkData(a)?.uri;
            if (d) {
              let _ = { start: { x: u + 1, y: t2 }, end: { x: c + (!h16 && c === l - 1 ? 1 : 0), y: t2 } }, p = false;
              if (!n?.allowNonHttpProtocols) try {
                let m = new URL(d);
                ["http:", "https:"].includes(m.protocol) || (p = true);
              } catch {
                p = true;
              }
              p || r.push({ text: d, range: _, activate: (m, f) => n ? n.activate(m, f, _) : Ol(m, f), hover: (m, f) => n?.hover?.(m, f, _), leave: (m, f) => n?.leave?.(m, f, _) });
            }
            h16 = false, o.hasExtendedAttrs() && o.extended.urlId ? (u = c, a = o.extended.urlId) : (u = -1, a = -1);
          }
        }
        e(r);
      }
    };
    wt = M([S(0, F), S(1, H), S(2, sr)], wt);
    nt = ie("CharSizeService"), ae = ie("CoreBrowserService"), Dt = ie("MouseService"), ce = ie("RenderService"), Qs = ie("SelectionService"), or = ie("CharacterJoinerService"), Re = ie("ThemeService"), lr = ie("LinkProviderService");
    Wn = class {
      constructor() {
        this.listeners = [], this.unexpectedErrorHandler = function(t2) {
          setTimeout(() => {
            throw t2.stack ? ar.isErrorNoTelemetry(t2) ? new ar(t2.message + `

` + t2.stack) : new Error(t2.message + `

` + t2.stack) : t2;
          }, 0);
        };
      }
      addListener(t2) {
        return this.listeners.push(t2), () => {
          this._removeListener(t2);
        };
      }
      emit(t2) {
        this.listeners.forEach((e) => {
          e(t2);
        });
      }
      _removeListener(t2) {
        this.listeners.splice(this.listeners.indexOf(t2), 1);
      }
      setUnexpectedErrorHandler(t2) {
        this.unexpectedErrorHandler = t2;
      }
      getUnexpectedErrorHandler() {
        return this.unexpectedErrorHandler;
      }
      onUnexpectedError(t2) {
        this.unexpectedErrorHandler(t2), this.emit(t2);
      }
      onUnexpectedExternalError(t2) {
        this.unexpectedErrorHandler(t2);
      }
    }, Bl = new Wn();
    Un = "Canceled";
    bi = class extends Error {
      constructor() {
        super(Un), this.name = this.message;
      }
    };
    ar = class s4 extends Error {
      constructor(t2) {
        super(t2), this.name = "CodeExpectedError";
      }
      static fromError(t2) {
        if (t2 instanceof s4) return t2;
        let e = new s4();
        return e.message = t2.message, e.stack = t2.stack, e;
      }
      static isErrorNoTelemetry(t2) {
        return t2.name === "CodeExpectedError";
      }
    }, Rt = class s5 extends Error {
      constructor(t2) {
        super(t2 || "An unexpected bug occurred."), Object.setPrototypeOf(this, s5.prototype);
      }
    };
    cr = class cr2 {
      constructor(t2) {
        this._array = t2;
        this._findLastMonotonousLastIdx = 0;
      }
      findLastMonotonous(t2) {
        if (cr2.assertInvariants) {
          if (this._prevFindLastPredicate) {
            for (let i of this._array) if (this._prevFindLastPredicate(i) && !t2(i)) throw new Error("MonotonousArray: current predicate must be weaker than (or equal to) the previous predicate.");
          }
          this._prevFindLastPredicate = t2;
        }
        let e = Fl(this._array, t2, this._findLastMonotonousLastIdx);
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
      function t2(a) {
        return a <= 0;
      }
      l.isLessThanOrEqual = t2;
      function e(a) {
        return a > 0;
      }
      l.isGreaterThan = e;
      function i(a) {
        return a === 0;
      }
      l.isNeitherLessOrGreaterThan = i, l.greaterThan = 1, l.lessThan = -1, l.neitherLessOrGreaterThan = 0;
    })(ro ||= {});
    so = (s15, t2) => s15 - t2;
    At = class At2 {
      constructor(t2) {
        this.iterate = t2;
      }
      forEach(t2) {
        this.iterate((e) => (t2(e), true));
      }
      toArray() {
        let t2 = [];
        return this.iterate((e) => (t2.push(e), true)), t2;
      }
      filter(t2) {
        return new At2((e) => this.iterate((i) => t2(i) ? e(i) : true));
      }
      map(t2) {
        return new At2((e) => this.iterate((i) => e(t2(i))));
      }
      some(t2) {
        let e = false;
        return this.iterate((i) => (e = t2(i), !e)), e;
      }
      findFirst(t2) {
        let e;
        return this.iterate((i) => t2(i) ? (e = i, false) : true), e;
      }
      findLast(t2) {
        let e;
        return this.iterate((i) => (t2(i) && (e = i), true)), e;
      }
      findLastMaxBy(t2) {
        let e, i = true;
        return this.iterate((r) => ((i || ro.isGreaterThan(t2(r, e))) && (i = false, e = r), true)), e;
      }
    };
    At.empty = new At((t2) => {
    });
    io = At;
    oo = class {
      constructor(t2, e) {
        this.toKey = e;
        this._map = /* @__PURE__ */ new Map();
        this[lo] = "SetWithKey";
        for (let i of t2) this.add(i);
      }
      get size() {
        return this._map.size;
      }
      add(t2) {
        let e = this.toKey(t2);
        return this._map.set(e, t2), this;
      }
      delete(t2) {
        return this._map.delete(this.toKey(t2));
      }
      has(t2) {
        return this._map.has(this.toKey(t2));
      }
      *entries() {
        for (let t2 of this._map.values()) yield [t2, t2];
      }
      keys() {
        return this.values();
      }
      *values() {
        for (let t2 of this._map.values()) yield t2;
      }
      clear() {
        this._map.clear();
      }
      forEach(t2, e) {
        this._map.forEach((i) => t2.call(e, i, i, this));
      }
      [(ao = Symbol.iterator, lo = Symbol.toStringTag, ao)]() {
        return this.values();
      }
    };
    ur = class {
      constructor() {
        this.map = /* @__PURE__ */ new Map();
      }
      add(t2, e) {
        let i = this.map.get(t2);
        i || (i = /* @__PURE__ */ new Set(), this.map.set(t2, i)), i.add(e);
      }
      delete(t2, e) {
        let i = this.map.get(t2);
        i && (i.delete(e), i.size === 0 && this.map.delete(t2));
      }
      forEach(t2, e) {
        let i = this.map.get(t2);
        i && i.forEach(e);
      }
      get(t2) {
        let e = this.map.get(t2);
        return e || /* @__PURE__ */ new Set();
      }
    };
    ((O) => {
      function s15(I) {
        return I && typeof I == "object" && typeof I[Symbol.iterator] == "function";
      }
      O.is = s15;
      let t2 = Object.freeze([]);
      function e() {
        return t2;
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
        return I || t2;
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
      function h16(I, k) {
        for (let P of I) if (k(P)) return P;
      }
      O.find = h16;
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
      getDisposableData(t2) {
        let e = this.livingDisposables.get(t2);
        return e || (e = { parent: null, source: null, isSingleton: false, value: t2, idx: hr2.idx++ }, this.livingDisposables.set(t2, e)), e;
      }
      trackDisposable(t2) {
        let e = this.getDisposableData(t2);
        e.source || (e.source = new Error().stack);
      }
      setParent(t2, e) {
        let i = this.getDisposableData(t2);
        i.parent = e;
      }
      markAsDisposed(t2) {
        this.livingDisposables.delete(t2);
      }
      markAsSingleton(t2) {
        this.getDisposableData(t2).isSingleton = true;
      }
      getRootParent(t2, e) {
        let i = e.get(t2);
        if (i) return i;
        let r = t2.parent ? this.getRootParent(this.getDisposableData(t2.parent), e) : t2;
        return e.set(t2, r), r;
      }
      getTrackedDisposables() {
        let t2 = /* @__PURE__ */ new Map();
        return [...this.livingDisposables.entries()].filter(([, i]) => i.source !== null && !this.getRootParent(i, t2).isSingleton).flatMap(([i]) => i);
      }
      computeLeakingDisposables(t2 = 10, e) {
        let i;
        if (e) i = e;
        else {
          let a = /* @__PURE__ */ new Map(), u = [...this.livingDisposables.values()].filter((c) => c.source !== null && !this.getRootParent(c, a).isSingleton);
          if (u.length === 0) return;
          let h16 = new Set(u.map((c) => c.value));
          if (i = u.filter((c) => !(c.parent && h16.has(c.parent))), i.length === 0) throw new Error("There are cyclic diposable chains!");
        }
        if (!i) return;
        function r(a) {
          function u(c, d) {
            for (; c.length > 0 && d.some((_) => typeof _ == "string" ? _ === c[0] : c[0].match(_)); ) c.shift();
          }
          let h16 = a.source.split(`
`).map((c) => c.trim().replace("at ", "")).filter((c) => c !== "");
          return u(h16, ["Error", /^trackDisposable \(.*\)$/, /^DisposableTracker.trackDisposable \(.*\)$/]), h16.reverse();
        }
        let n = new ur();
        for (let a of i) {
          let u = r(a);
          for (let h16 = 0; h16 <= u.length; h16++) n.add(u.slice(0, h16).join(`
`), a);
        }
        i.sort(no((a) => a.idx, so));
        let o = "", l = 0;
        for (let a of i.slice(0, t2)) {
          l++;
          let u = r(a), h16 = [];
          for (let c = 0; c < u.length; c++) {
            let d = u[c];
            d = `(shared with ${n.get(u.slice(0, c + 1).join(`
`)).size}/${i.length} leaks) at ${d}`;
            let p = n.get(u.slice(0, c).join(`
`)), m = co([...p].map((f) => r(f)[c]), (f) => f);
            delete m[u[c]];
            for (let [f, A] of Object.entries(m)) h16.unshift(`    - stacktraces of ${A.length} other leaks continue with ${f}`);
            h16.unshift(d);
          }
          o += `


==================== Leaking disposable ${l}/${i.length}: ${a.value.constructor.name} ====================
${h16.join(`
`)}
============================================================

`;
        }
        return i.length > t2 && (o += `


... and ${i.length - t2} more leaking disposables

`), { leaks: i, details: o };
      }
    };
    hr.idx = 0;
    uo = hr;
    if (Wl) {
      let s15 = "__is_disposable_tracked__";
      Ul(new class {
        trackDisposable(t2) {
          let e = new Error("Potentially leaked disposable").stack;
          setTimeout(() => {
            t2[s15] || console.log(e);
          }, 3e3);
        }
        setParent(t2, e) {
          if (t2 && t2 !== D.None) try {
            t2[s15] = true;
          } catch {
          }
        }
        markAsDisposed(t2) {
          if (t2 && t2 !== D.None) try {
            t2[s15] = true;
          } catch {
          }
        }
        markAsSingleton(t2) {
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
      add(t2) {
        if (!t2) return t2;
        if (t2 === this) throw new Error("Cannot register a disposable on itself!");
        return vi(t2, this), this._isDisposed ? dr2.DISABLE_DISPOSED_WARNING || console.warn(new Error("Trying to add a disposable to a DisposableStore that has already been disposed of. The added object will be leaked!").stack) : this._toDispose.add(t2), t2;
      }
      delete(t2) {
        if (t2) {
          if (t2 === this) throw new Error("Cannot dispose a disposable on itself!");
          this._toDispose.delete(t2), t2.dispose();
        }
      }
      deleteAndLeak(t2) {
        t2 && this._toDispose.has(t2) && (this._toDispose.delete(t2), vi(t2, null));
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
      _register(t2) {
        if (t2 === this) throw new Error("Cannot register a disposable on itself!");
        return this._store.add(t2);
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
      set value(t2) {
        this._isDisposed || t2 === this._value || (this._value?.dispose(), t2 && vi(t2, this), this._value = t2);
      }
      clear() {
        this.value = void 0;
      }
      dispose() {
        this._isDisposed = true, pr(this), this._value?.dispose(), this._value = void 0;
      }
      clearAndLeak() {
        let t2 = this._value;
        return this._value = void 0, t2 && vi(t2, null), t2;
      }
    };
    fe = typeof window == "object" ? window : globalThis;
    kt = class kt2 {
      constructor(t2) {
        this.element = t2, this.next = kt2.Undefined, this.prev = kt2.Undefined;
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
        let t2 = this._first;
        for (; t2 !== G.Undefined; ) {
          let e = t2.next;
          t2.prev = G.Undefined, t2.next = G.Undefined, t2 = e;
        }
        this._first = G.Undefined, this._last = G.Undefined, this._size = 0;
      }
      unshift(t2) {
        return this._insert(t2, false);
      }
      push(t2) {
        return this._insert(t2, true);
      }
      _insert(t2, e) {
        let i = new G(t2);
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
          let t2 = this._first.element;
          return this._remove(this._first), t2;
        }
      }
      pop() {
        if (this._last !== G.Undefined) {
          let t2 = this._last.element;
          return this._remove(this._last), t2;
        }
      }
      _remove(t2) {
        if (t2.prev !== G.Undefined && t2.next !== G.Undefined) {
          let e = t2.prev;
          e.next = t2.next, t2.next.prev = e;
        } else t2.prev === G.Undefined && t2.next === G.Undefined ? (this._first = G.Undefined, this._last = G.Undefined) : t2.next === G.Undefined ? (this._last = this._last.prev, this._last.next = G.Undefined) : t2.prev === G.Undefined && (this._first = this._first.next, this._first.prev = G.Undefined);
        this._size -= 1;
      }
      *[Symbol.iterator]() {
        let t2 = this._first;
        for (; t2 !== G.Undefined; ) yield t2.element, t2 = t2.next;
      }
    };
    zl = globalThis.performance && typeof globalThis.performance.now == "function", mr = class s6 {
      static create(t2) {
        return new s6(t2);
      }
      constructor(t2) {
        this._now = zl && t2 === false ? Date.now : globalThis.performance.now.bind(globalThis.performance), this._startTime = this._now(), this._stopTime = -1;
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
      function t2(y) {
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
        return h16((w, E = null, x) => y((N) => w.call(E, T(N)), null, x), g);
      }
      Qe.map = r;
      function n(y, T, g) {
        return h16((w, E = null, x) => y((N) => {
          T(N), w.call(E, N);
        }, null, x), g);
      }
      Qe.forEach = n;
      function o(y, T, g) {
        return h16((w, E = null, x) => y((N) => T(N) && w.call(E, N), null, x), g);
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
      function h16(y, T) {
        let g, w = { onWillAddFirstListener() {
          g = y(E.fire, E);
        }, onDidRemoveLastListener() {
          g?.dispose();
        } };
        T || t2(w);
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
        N || t2(et);
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
          g || t2(w), this.emitter = new v(w), g && g.add(this.emitter);
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
      constructor(t2) {
        this.listenerCount = 0;
        this.invocationCount = 0;
        this.elapsedOverall = 0;
        this.durations = [];
        this.name = `${t2}_${Mt2._idPool++}`, Mt2.all.add(this);
      }
      start(t2) {
        this._stopWatch = new mr(), this.listenerCount = t2;
      }
      stop() {
        if (this._stopWatch) {
          let t2 = this._stopWatch.elapsed();
          this.durations.push(t2), this.elapsedOverall += t2, this.invocationCount += 1, this._stopWatch = void 0;
        }
      }
    };
    Mt.all = /* @__PURE__ */ new Set(), Mt._idPool = 0;
    $n = Mt, po = -1;
    br = class br2 {
      constructor(t2, e, i = (br2._idPool++).toString(16).padStart(3, "0")) {
        this._errorHandler = t2;
        this.threshold = e;
        this.name = i;
        this._warnCountdown = 0;
      }
      dispose() {
        this._stacks?.clear();
      }
      check(t2, e) {
        let i = this.threshold;
        if (i <= 0 || e < i) return;
        this._stacks || (this._stacks = /* @__PURE__ */ new Map());
        let r = this._stacks.get(t2.value) || 0;
        if (this._stacks.set(t2.value, r + 1), this._warnCountdown -= 1, this._warnCountdown <= 0) {
          this._warnCountdown = i * 0.5;
          let [n, o] = this.getMostFrequentStack(), l = `[${this.name}] potential listener LEAK detected, having ${e} listeners already. MOST frequent listener (${o}):`;
          console.warn(l), console.warn(n);
          let a = new qn(l, n);
          this._errorHandler(a);
        }
        return () => {
          let n = this._stacks.get(t2.value) || 0;
          this._stacks.set(t2.value, n - 1);
        };
      }
      getMostFrequentStack() {
        if (!this._stacks) return;
        let t2, e = 0;
        for (let [i, r] of this._stacks) (!t2 || e < r) && (t2 = [i, r], e = r);
        return t2;
      }
    };
    br._idPool = 1;
    Vn = br, gi = class s7 {
      constructor(t2) {
        this.value = t2;
      }
      static create() {
        let t2 = new Error();
        return new s7(t2.stack ?? "");
      }
      print() {
        console.warn(this.value.split(`
`).slice(2).join(`
`));
      }
    }, qn = class extends Error {
      constructor(t2, e) {
        super(t2), this.name = "ListenerLeakError", this.stack = e;
      }
    }, Yn = class extends Error {
      constructor(t2, e) {
        super(t2), this.name = "ListenerRefusalError", this.stack = e;
      }
    }, Vl = 0, Pt = class {
      constructor(t2) {
        this.value = t2;
        this.id = Vl++;
      }
    }, ql = 2, Yl = (s15, t2) => {
      if (s15 instanceof Pt) t2(s15);
      else for (let e = 0; e < s15.length; e++) {
        let i = s15[e];
        i && t2(i);
      }
    };
    if (Gl) {
      let s15 = [];
      setInterval(() => {
        s15.length !== 0 && (console.warn("[LEAKING LISTENERS] GC'ed these listeners that were NOT yet disposed:"), console.warn(s15.join(`
`)), s15.length = 0);
      }, 3e3), _r = new FinalizationRegistry((t2) => {
        typeof t2 == "string" && s15.push(t2);
      });
    }
    v = class {
      constructor(t2) {
        this._size = 0;
        this._options = t2, this._leakageMon = po > 0 || this._options?.leakWarningThreshold ? new Vn(t2?.onListenerError ?? Lt, this._options?.leakWarningThreshold ?? po) : void 0, this._perfMon = this._options?._profName ? new $n(this._options._profName) : void 0, this._deliveryQueue = this._options?.deliveryQueue;
      }
      dispose() {
        if (!this._disposed) {
          if (this._disposed = true, this._deliveryQueue?.current === this && this._deliveryQueue.reset(), this._listeners) {
            if (fo) {
              let t2 = this._listeners;
              queueMicrotask(() => {
                Yl(t2, (e) => e.stack?.print());
              });
            }
            this._listeners = void 0, this._size = 0;
          }
          this._options?.onDidRemoveLastListener?.(), this._leakageMon?.dispose();
        }
      }
      get event() {
        return this._event ??= (t2, e, i) => {
          if (this._leakageMon && this._size > this._leakageMon.threshold ** 2) {
            let a = `[${this._leakageMon.name}] REFUSES to accept new listeners because it exceeded its threshold by far (${this._size} vs ${this._leakageMon.threshold})`;
            console.warn(a);
            let u = this._leakageMon.getMostFrequentStack() ?? ["UNKNOWN stack", -1], h16 = new Yn(`${a}. HINT: Stack shows most frequent listener (${u[1]}-times)`, u[0]);
            return (this._options?.onListenerError || Lt)(h16), D.None;
          }
          if (this._disposed) return D.None;
          e && (t2 = t2.bind(e));
          let r = new Pt(t2), n, o;
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
      _removeListener(t2) {
        if (this._options?.onWillRemoveListener?.(this), !this._listeners) return;
        if (this._size === 1) {
          this._listeners = void 0, this._options?.onDidRemoveLastListener?.(this), this._size = 0;
          return;
        }
        let e = this._listeners, i = e.indexOf(t2);
        if (i === -1) throw console.log("disposed?", this._disposed), console.log("size?", this._size), console.log("arr?", JSON.stringify(this._listeners)), new Error("Attempted to dispose unknown listener");
        this._size--, e[i] = void 0;
        let r = this._deliveryQueue.current === this;
        if (this._size * ql <= e.length) {
          let n = 0;
          for (let o = 0; o < e.length; o++) e[o] ? e[n++] = e[o] : r && (this._deliveryQueue.end--, n < this._deliveryQueue.i && this._deliveryQueue.i--);
          e.length = n;
        }
      }
      _deliver(t2, e) {
        if (!t2) return;
        let i = this._options?.onListenerError || Lt;
        if (!i) {
          t2.value(e);
          return;
        }
        try {
          t2.value(e);
        } catch (r) {
          i(r);
        }
      }
      _deliverQueue(t2) {
        let e = t2.current._listeners;
        for (; t2.i < t2.end; ) this._deliver(e[t2.i++], t2.value);
        t2.reset();
      }
      fire(t2) {
        if (this._deliveryQueue?.current && (this._deliverQueue(this._deliveryQueue), this._perfMon?.stop()), this._perfMon?.start(this._size), this._listeners) if (this._listeners instanceof Pt) this._deliver(this._listeners, t2);
        else {
          let e = this._deliveryQueue;
          e.enqueue(this, t2, this._listeners.length), this._deliverQueue(e);
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
      enqueue(t2, e, i) {
        this.i = 0, this.end = i, this.current = t2, this.value = e;
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
      getZoomLevel(t2) {
        return this.mapWindowIdToZoomLevel.get(this.getWindowId(t2)) ?? 0;
      }
      setZoomLevel(t2, e) {
        if (this.getZoomLevel(e) === t2) return;
        let i = this.getWindowId(e);
        this.mapWindowIdToZoomLevel.set(i, t2), this._onDidChangeZoomLevel.fire(i);
      }
      getZoomFactor(t2) {
        return this.mapWindowIdToZoomFactor.get(this.getWindowId(t2)) ?? 1;
      }
      setZoomFactor(t2, e) {
        this.mapWindowIdToZoomFactor.set(this.getWindowId(e), t2);
      }
      setFullscreen(t2, e) {
        if (this.isFullscreen(e) === t2) return;
        let i = this.getWindowId(e);
        this.mapWindowIdToFullScreen.set(i, t2), this._onDidChangeFullscreen.fire(i);
      }
      isFullscreen(t2) {
        return !!this.mapWindowIdToFullScreen.get(this.getWindowId(t2));
      }
      getWindowId(t2) {
        return t2.vscodeWindowId;
      }
    };
    gr.INSTANCE = new gr();
    Si = gr;
    Eu = Si.INSTANCE.onDidChangeZoomLevel;
    Tu = Si.INSTANCE.onDidChangeFullscreen, Ot = typeof navigator == "object" ? navigator.userAgent : "", Ei = Ot.indexOf("Firefox") >= 0, Bt = Ot.indexOf("AppleWebKit") >= 0, Ti = Ot.indexOf("Chrome") >= 0, Sr = !Ti && Ot.indexOf("Safari") >= 0;
    Iu = Ot.indexOf("Electron/") >= 0, yu = Ot.indexOf("Android") >= 0, vr = false;
    if (typeof fe.matchMedia == "function") {
      let s15 = fe.matchMedia("(display-mode: standalone) or (display-mode: window-controls-overlay)"), t2 = fe.matchMedia("(display-mode: fullscreen)");
      vr = s15.matches, Xl(fe, s15, ({ matches: e }) => {
        vr && t2.matches || (vr = e);
      });
    }
    Nt = "en", yr = false, xr = false, Ii = false, Zl = false, vo = false, go = false, Jl = false, Ql = false, ea = false, ta = false, Ir = Nt, bo = Nt, Ve = globalThis;
    typeof Ve.vscode < "u" && typeof Ve.vscode.process < "u" ? xe = Ve.vscode.process : typeof process < "u" && typeof process?.versions?.node == "string" && (xe = process);
    So = typeof xe?.versions?.electron == "string", ra = So && xe?.type === "renderer";
    if (typeof xe == "object") {
      yr = xe.platform === "win32", xr = xe.platform === "darwin", Ii = xe.platform === "linux", Zl = Ii && !!xe.env.SNAP && !!xe.env.SNAP_REVISION, Jl = So, ea = !!xe.env.CI || !!xe.env.BUILD_ARTIFACTSTAGINGDIRECTORY, Tr = Nt, Ir = Nt;
      let s15 = xe.env.VSCODE_NLS_CONFIG;
      if (s15) try {
        let t2 = JSON.parse(s15);
        Tr = t2.userLocale, bo = t2.osLocale, Ir = t2.resolvedLanguage || Nt, ia = t2.languagePack?.translationsConfigFile;
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
      function t2() {
        return st.length === 2 ? st === "en" : st.length >= 3 ? st[0] === "e" && st[1] === "n" && st[2] === "-" : false;
      }
      i.isDefaultVariant = t2;
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
        let t2 = 0;
        return (e) => {
          let i = ++t2;
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
      define(t2, e) {
        this._keyCodeToStr[t2] = e, this._strToKeyCode[e.toLowerCase()] = t2;
      }
      keyCodeToStr(t2) {
        return this._keyCodeToStr[t2];
      }
      strToKeyCode(t2) {
        return this._strToKeyCode[t2.toLowerCase()] || 0;
      }
    }, Jn = new yi(), To = new yi(), Io = new yi(), yo = new Array(230);
    ((o) => {
      function s15(l) {
        return Jn.keyCodeToStr(l);
      }
      o.toString = s15;
      function t2(l) {
        return Jn.strToKeyCode(l);
      }
      o.fromString = t2;
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
      constructor(t2, e, i, r, n) {
        this.ctrlKey = t2;
        this.shiftKey = e;
        this.altKey = i;
        this.metaKey = r;
        this.keyCode = n;
      }
      equals(t2) {
        return t2 instanceof s8 && this.ctrlKey === t2.ctrlKey && this.shiftKey === t2.shiftKey && this.altKey === t2.altKey && this.metaKey === t2.metaKey && this.keyCode === t2.keyCode;
      }
      getHashCode() {
        let t2 = this.ctrlKey ? "1" : "0", e = this.shiftKey ? "1" : "0", i = this.altKey ? "1" : "0", r = this.metaKey ? "1" : "0";
        return `K${t2}${e}${i}${r}${this.keyCode}`;
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
      constructor(t2) {
        if (t2.length === 0) throw eo("chords");
        this.chords = t2;
      }
      getHashCode() {
        let t2 = "";
        for (let e = 0, i = this.chords.length; e < i; e++) e !== 0 && (t2 += ";"), t2 += this.chords[e].getHashCode();
        return t2;
      }
      equals(t2) {
        if (t2 === null || this.chords.length !== t2.chords.length) return false;
        for (let e = 0; e < this.chords.length; e++) if (!this.chords[e].equals(t2.chords[e])) return false;
        return true;
      }
    };
    ua = Te ? 256 : 2048, ha = 512, da = 1024, fa = Te ? 2048 : 256;
    ft = class {
      constructor(t2) {
        this._standardKeyboardEventBrand = true;
        let e = t2;
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
      equals(t2) {
        return this._asKeybinding === t2;
      }
      _computeKeybinding() {
        let t2 = 0;
        this.keyCode !== 5 && this.keyCode !== 4 && this.keyCode !== 6 && this.keyCode !== 57 && (t2 = this.keyCode);
        let e = 0;
        return this.ctrlKey && (e |= ua), this.altKey && (e |= ha), this.shiftKey && (e |= da), this.metaKey && (e |= fa), e |= t2, e;
      }
      _computeKeyCodeChord() {
        let t2 = 0;
        return this.keyCode !== 5 && this.keyCode !== 4 && this.keyCode !== 6 && this.keyCode !== 57 && (t2 = this.keyCode), new Rr(this.ctrlKey, this.shiftKey, this.altKey, this.metaKey, t2);
      }
    };
    wo = /* @__PURE__ */ new WeakMap();
    Lr = class {
      static getSameOriginWindowChain(t2) {
        let e = wo.get(t2);
        if (!e) {
          e = [], wo.set(t2, e);
          let i = t2, r;
          do
            r = pa(i), r ? e.push({ window: new WeakRef(i), iframeElement: i.frameElement || null }) : e.push({ window: new WeakRef(i), iframeElement: null }), i = r;
          while (i);
        }
        return e.slice(0);
      }
      static getPositionOfChildWindowRelativeToAncestorWindow(t2, e) {
        if (!e || t2 === e) return { top: 0, left: 0 };
        let i = 0, r = 0, n = this.getSameOriginWindowChain(t2);
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
      constructor(t2, e) {
        this.timestamp = Date.now(), this.browserEvent = e, this.leftButton = e.button === 0, this.middleButton = e.button === 1, this.rightButton = e.button === 2, this.buttons = e.buttons, this.target = e.target, this.detail = e.detail || 1, e.type === "dblclick" && (this.detail = 2), this.ctrlKey = e.ctrlKey, this.shiftKey = e.shiftKey, this.altKey = e.altKey, this.metaKey = e.metaKey, typeof e.pageX == "number" ? (this.posx = e.pageX, this.posy = e.pageY) : (this.posx = e.clientX + this.target.ownerDocument.body.scrollLeft + this.target.ownerDocument.documentElement.scrollLeft, this.posy = e.clientY + this.target.ownerDocument.body.scrollTop + this.target.ownerDocument.documentElement.scrollTop);
        let i = Lr.getPositionOfChildWindowRelativeToAncestorWindow(t2, e.view);
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
      constructor(t2, e = 0, i = 0) {
        this.browserEvent = t2 || null, this.target = t2 ? t2.target || t2.targetNode || t2.srcElement : null, this.deltaY = i, this.deltaX = e;
        let r = false;
        if (Ti) {
          let n = navigator.userAgent.match(/Chrome\/(\d+)/);
          r = (n ? parseInt(n[1]) : 123) <= 122;
        }
        if (t2) {
          let n = t2, o = t2, l = t2.view?.devicePixelRatio || 1;
          if (typeof n.wheelDeltaY < "u") r ? this.deltaY = n.wheelDeltaY / (120 * l) : this.deltaY = n.wheelDeltaY / 120;
          else if (typeof o.VERTICAL_AXIS < "u" && o.axis === o.VERTICAL_AXIS) this.deltaY = -o.detail / 3;
          else if (t2.type === "wheel") {
            let a = t2;
            a.deltaMode === a.DOM_DELTA_LINE ? Ei && !Te ? this.deltaY = -t2.deltaY / 3 : this.deltaY = -t2.deltaY : this.deltaY = -t2.deltaY / 40;
          }
          if (typeof n.wheelDeltaX < "u") Sr && wr ? this.deltaX = -(n.wheelDeltaX / 120) : r ? this.deltaX = n.wheelDeltaX / (120 * l) : this.deltaX = n.wheelDeltaX / 120;
          else if (typeof o.HORIZONTAL_AXIS < "u" && o.axis === o.HORIZONTAL_AXIS) this.deltaX = -t2.detail / 3;
          else if (t2.type === "wheel") {
            let a = t2;
            a.deltaMode === a.DOM_DELTA_LINE ? Ei && !Te ? this.deltaX = -t2.deltaX / 3 : this.deltaX = -t2.deltaX : this.deltaX = -t2.deltaX / 40;
          }
          this.deltaY === 0 && this.deltaX === 0 && t2.wheelDelta && (r ? this.deltaY = t2.wheelDelta / (120 * l) : this.deltaY = t2.wheelDelta / 120);
        }
      }
      preventDefault() {
        this.browserEvent?.preventDefault();
      }
      stopPropagation() {
        this.browserEvent?.stopPropagation();
      }
    };
    Do = Object.freeze(function(s15, t2) {
      let e = setTimeout(s15.bind(t2), 0);
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
      constructor(t2, e) {
        this._isDisposed = false;
        this._token = -1, typeof t2 == "function" && typeof e == "number" && this.setIfNotSet(t2, e);
      }
      dispose() {
        this.cancel(), this._isDisposed = true;
      }
      cancel() {
        this._token !== -1 && (clearTimeout(this._token), this._token = -1);
      }
      cancelAndSet(t2, e) {
        if (this._isDisposed) throw new Rt("Calling 'cancelAndSet' on a disposed TimeoutTimer");
        this.cancel(), this._token = setTimeout(() => {
          this._token = -1, t2();
        }, e);
      }
      setIfNotSet(t2, e) {
        if (this._isDisposed) throw new Rt("Calling 'setIfNotSet' on a disposed TimeoutTimer");
        this._token === -1 && (this._token = setTimeout(() => {
          this._token = -1, t2();
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
      cancelAndSet(t2, e, i = globalThis) {
        if (this.isDisposed) throw new Rt("Calling 'cancelAndSet' on a disposed IntervalTimer");
        this.cancel();
        let r = i.setInterval(() => {
          t2();
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
      typeof globalThis.requestIdleCallback != "function" || typeof globalThis.cancelIdleCallback != "function" ? Ar = (s15, t2) => {
        Eo(() => {
          if (e) return;
          let i = Date.now() + 15;
          t2(Object.freeze({ didTimeout: true, timeRemaining() {
            return Math.max(0, i - Date.now());
          } }));
        });
        let e = false;
        return { dispose() {
          e || (e = true);
        } };
      } : Ar = (s15, t2, e) => {
        let i = s15.requestIdleCallback(t2, typeof e == "number" ? { timeout: e } : void 0), r = false;
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
      function t2(i) {
        return new Promise(async (r, n) => {
          try {
            await i(r, n);
          } catch (o) {
            n(o);
          }
        });
      }
      e.withAsyncBody = t2;
    })(va ||= {});
    _e = class _e2 {
      static fromArray(t2) {
        return new _e2((e) => {
          e.emitMany(t2);
        });
      }
      static fromPromise(t2) {
        return new _e2(async (e) => {
          e.emitMany(await t2);
        });
      }
      static fromPromises(t2) {
        return new _e2(async (e) => {
          await Promise.all(t2.map(async (i) => e.emitOne(await i)));
        });
      }
      static merge(t2) {
        return new _e2(async (e) => {
          await Promise.all(t2.map(async (i) => {
            for await (let r of i) e.emitOne(r);
          }));
        });
      }
      constructor(t2, e) {
        this._state = 0, this._results = [], this._error = null, this._onReturn = e, this._onStateChanged = new v(), queueMicrotask(async () => {
          let i = { emitOne: (r) => this.emitOne(r), emitMany: (r) => this.emitMany(r), reject: (r) => this.reject(r) };
          try {
            await Promise.resolve(t2(i)), this.resolve();
          } catch (r) {
            this.reject(r);
          } finally {
            i.emitOne = void 0, i.emitMany = void 0, i.reject = void 0;
          }
        });
      }
      [Symbol.asyncIterator]() {
        let t2 = 0;
        return { next: async () => {
          do {
            if (this._state === 2) throw this._error;
            if (t2 < this._results.length) return { done: false, value: this._results[t2++] };
            if (this._state === 1) return { done: true, value: void 0 };
            await $.toPromise(this._onStateChanged.event);
          } while (true);
        }, return: async () => (this._onReturn?.(), { done: true, value: void 0 }) };
      }
      static map(t2, e) {
        return new _e2(async (i) => {
          for await (let r of t2) i.emitOne(e(r));
        });
      }
      map(t2) {
        return _e2.map(this, t2);
      }
      static filter(t2, e) {
        return new _e2(async (i) => {
          for await (let r of t2) e(r) && i.emitOne(r);
        });
      }
      filter(t2) {
        return _e2.filter(this, t2);
      }
      static coalesce(t2) {
        return _e2.filter(t2, (e) => !!e);
      }
      coalesce() {
        return _e2.coalesce(this);
      }
      static async toPromise(t2) {
        let e = [];
        for await (let i of t2) e.push(i);
        return e;
      }
      toPromise() {
        return _e2.toPromise(this);
      }
      emitOne(t2) {
        this._state === 0 && (this._results.push(t2), this._onStateChanged.fire());
      }
      emitMany(t2) {
        this._state === 0 && (this._results = this._results.concat(t2), this._onStateChanged.fire());
      }
      resolve() {
        this._state === 0 && (this._state = 1, this._onStateChanged.fire());
      }
      reject(t2) {
        this._state === 0 && (this._state = 2, this._error = t2, this._onStateChanged.fire());
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
      update(t2) {
        let e = t2.length;
        if (e === 0) return;
        let i = this._buff, r = this._buffLen, n = this._leftoverHighSurrogate, o, l;
        for (n !== 0 ? (o = n, l = -1, n = 0) : (o = t2.charCodeAt(0), l = 0); ; ) {
          let a = o;
          if (Lo(o)) if (l + 1 < e) {
            let u = t2.charCodeAt(l + 1);
            is(u) ? (l++, a = Ao(o, u)) : a = 65533;
          } else {
            n = o;
            break;
          }
          else is(o) && (a = 65533);
          if (r = this._push(i, r, a), l++, l < e) o = t2.charCodeAt(l);
          else break;
        }
        this._buffLen = r, this._leftoverHighSurrogate = n;
      }
      _push(t2, e, i) {
        return i < 128 ? t2[e++] = i : i < 2048 ? (t2[e++] = 192 | (i & 1984) >>> 6, t2[e++] = 128 | (i & 63) >>> 0) : i < 65536 ? (t2[e++] = 224 | (i & 61440) >>> 12, t2[e++] = 128 | (i & 4032) >>> 6, t2[e++] = 128 | (i & 63) >>> 0) : (t2[e++] = 240 | (i & 1835008) >>> 18, t2[e++] = 128 | (i & 258048) >>> 12, t2[e++] = 128 | (i & 4032) >>> 6, t2[e++] = 128 | (i & 63) >>> 0), e >= 64 && (this._step(), e -= 64, this._totalLen += 64, t2[0] = t2[64], t2[1] = t2[65], t2[2] = t2[66]), e;
      }
      digest() {
        return this._finished || (this._finished = true, this._leftoverHighSurrogate && (this._leftoverHighSurrogate = 0, this._buffLen = this._push(this._buff, this._buffLen, 65533)), this._totalLen += this._buffLen, this._wrapUp()), wi(this._h0) + wi(this._h1) + wi(this._h2) + wi(this._h3) + wi(this._h4);
      }
      _wrapUp() {
        this._buff[this._buffLen++] = 128, ko(this._buff, this._buffLen), this._buffLen > 56 && (this._step(), ko(this._buff));
        let t2 = 8 * this._totalLen;
        this._buffDV.setUint32(56, Math.floor(t2 / 4294967296), false), this._buffDV.setUint32(60, t2 % 4294967296, false), this._step();
      }
      _step() {
        let t2 = Cr2._bigBlock32, e = this._buffDV;
        for (let c = 0; c < 64; c += 4) t2.setUint32(c, e.getUint32(c, false), false);
        for (let c = 64; c < 320; c += 4) t2.setUint32(c, rs(t2.getUint32(c - 12, false) ^ t2.getUint32(c - 32, false) ^ t2.getUint32(c - 56, false) ^ t2.getUint32(c - 64, false), 1), false);
        let i = this._h0, r = this._h1, n = this._h2, o = this._h3, l = this._h4, a, u, h16;
        for (let c = 0; c < 80; c++) c < 20 ? (a = r & n | ~r & o, u = 1518500249) : c < 40 ? (a = r ^ n ^ o, u = 1859775393) : c < 60 ? (a = r & n | r & o | n & o, u = 2400959708) : (a = r ^ n ^ o, u = 3395469782), h16 = rs(i, 5) + a + l + u + t2.getUint32(c * 4, false) & 4294967295, l = o, o = n, n = rs(r, 30), r = i, i = h16;
        this._h0 = this._h0 + i & 4294967295, this._h1 = this._h1 + r & 4294967295, this._h2 = this._h2 + n & 4294967295, this._h3 = this._h3 + o & 4294967295, this._h4 = this._h4 + l & 4294967295;
      }
    };
    Cr._bigBlock32 = new DataView(new ArrayBuffer(320));
    Co = Cr;
    ({ registerWindow: Bh, getWindow: be, getDocument: Nh, getWindows: Fh, getWindowsCount: Hh, getWindowId: Oo, getWindowById: Wh, hasWindow: Uh, onDidRegisterWindow: No, onWillUnregisterWindow: Kh, onDidUnregisterWindow: zh } = (function() {
      let s15 = /* @__PURE__ */ new Map();
      fe;
      let t2 = { window: fe, disposables: new Ee() };
      s15.set(fe.vscodeWindowId, t2);
      let e = new v(), i = new v(), r = new v();
      function n(o, l) {
        return (typeof o == "number" ? s15.get(o) : void 0) ?? (l ? t2 : void 0);
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
      constructor(t2, e, i, r) {
        this._node = t2, this._type = e, this._handler = i, this._options = r || false, this._node.addEventListener(this._type, this._handler, this._options);
      }
      dispose() {
        this._handler && (this._node.removeEventListener(this._type, this._handler, this._options), this._node = null, this._handler = null);
      }
    };
    os = function(t2, e, i, r) {
      let n = i;
      return e === "click" || e === "mousedown" || e === "contextmenu" ? n = ya(be(t2), i) : (e === "keydown" || e === "keypress" || e === "keyup") && (n = xa(i)), L(t2, e, n, r);
    };
    Mr = class extends kr {
      constructor(t2) {
        super(), this.defaultTarget = t2 && be(t2);
      }
      cancelAndSet(t2, e, i) {
        return super.cancelAndSet(t2, e, i ?? this.defaultTarget);
      }
    }, Di = class {
      constructor(t2, e = 0) {
        this._runner = t2, this.priority = e, this._canceled = false;
      }
      dispose() {
        this._canceled = true;
      }
      execute() {
        if (!this._canceled) try {
          this._runner();
        } catch (t2) {
          Lt(t2);
        }
      }
      static sort(t2, e) {
        return e.priority - t2.priority;
      }
    };
    (function() {
      let s15 = /* @__PURE__ */ new Map(), t2 = /* @__PURE__ */ new Map(), e = /* @__PURE__ */ new Map(), i = /* @__PURE__ */ new Map(), r = (n) => {
        e.set(n, false);
        let o = s15.get(n) ?? [];
        for (t2.set(n, o), s15.set(n, []), i.set(n, true); o.length > 0; ) o.sort(Di.sort), o.shift().execute();
        i.set(n, false);
      };
      mt = (n, o, l = 0) => {
        let a = Oo(n), u = new Di(o, l), h16 = s15.get(a);
        return h16 || (h16 = [], s15.set(a, h16)), h16.push(u), e.get(a) || (e.set(a, true), n.requestAnimationFrame(() => r(a))), u;
      }, wa = (n, o, l) => {
        let a = Oo(n);
        if (i.get(a)) {
          let u = new Di(o, l), h16 = t2.get(a);
          return h16 || (h16 = [], t2.set(a, h16)), h16.push(u), u;
        } else return mt(n, o, l);
      };
    })();
    pt = class pt2 {
      constructor(t2, e) {
        this.width = t2;
        this.height = e;
      }
      with(t2 = this.width, e = this.height) {
        return t2 !== this.width || e !== this.height ? new pt2(t2, e) : this;
      }
      static is(t2) {
        return typeof t2 == "object" && typeof t2.height == "number" && typeof t2.width == "number";
      }
      static lift(t2) {
        return t2 instanceof pt2 ? t2 : new pt2(t2.width, t2.height);
      }
      static equals(t2, e) {
        return t2 === e ? true : !t2 || !e ? false : t2.width === e.width && t2.height === e.height;
      }
    };
    pt.None = new pt(0, 0);
    Bo = pt;
    Gh = new class {
      constructor() {
        this.mutationObservers = /* @__PURE__ */ new Map();
      }
      observe(s15, t2, e) {
        let i = this.mutationObservers.get(s15);
        i || (i = /* @__PURE__ */ new Map(), this.mutationObservers.set(s15, i));
        let r = Mo(e), n = i.get(r);
        if (n) n.users += 1;
        else {
          let o = new v(), l = new MutationObserver((u) => o.fire(u));
          l.observe(s15, e);
          let a = n = { users: 1, observer: l, onDidMutate: o.event };
          t2.add(C(() => {
            a.users -= 1, a.users === 0 && (o.dispose(), l.disconnect(), i?.delete(r), i?.size === 0 && this.mutationObservers.delete(s15));
          })), i.set(r, n);
        }
        return n.onDidMutate;
      }
    }();
    Y = { CLICK: "click", AUXCLICK: "auxclick", DBLCLICK: "dblclick", MOUSE_UP: "mouseup", MOUSE_DOWN: "mousedown", MOUSE_OVER: "mouseover", MOUSE_MOVE: "mousemove", MOUSE_OUT: "mouseout", MOUSE_ENTER: "mouseenter", MOUSE_LEAVE: "mouseleave", MOUSE_WHEEL: "wheel", POINTER_UP: "pointerup", POINTER_DOWN: "pointerdown", POINTER_MOVE: "pointermove", POINTER_LEAVE: "pointerleave", CONTEXT_MENU: "contextmenu", WHEEL: "wheel", KEY_DOWN: "keydown", KEY_PRESS: "keypress", KEY_UP: "keyup", LOAD: "load", BEFORE_UNLOAD: "beforeunload", UNLOAD: "unload", PAGE_SHOW: "pageshow", PAGE_HIDE: "pagehide", PASTE: "paste", ABORT: "abort", ERROR: "error", RESIZE: "resize", SCROLL: "scroll", FULLSCREEN_CHANGE: "fullscreenchange", WK_FULLSCREEN_CHANGE: "webkitfullscreenchange", SELECT: "select", CHANGE: "change", SUBMIT: "submit", RESET: "reset", FOCUS: "focus", FOCUS_IN: "focusin", FOCUS_OUT: "focusout", BLUR: "blur", INPUT: "input", STORAGE: "storage", DRAG_START: "dragstart", DRAG: "drag", DRAG_ENTER: "dragenter", DRAG_LEAVE: "dragleave", DRAG_OVER: "dragover", DROP: "drop", DRAG_END: "dragend", ANIMATION_START: Bt ? "webkitAnimationStart" : "animationstart", ANIMATION_END: Bt ? "webkitAnimationEnd" : "animationend", ANIMATION_ITERATION: Bt ? "webkitAnimationIteration" : "animationiteration" };
    Da = /([\w\-]+)?(#([\w\-]+))?((\.([\w\-]+))*)/;
    Ra.SVG = function(s15, t2, ...e) {
      return Ho("http://www.w3.org/2000/svg", s15, t2, ...e);
    };
    ls = class {
      constructor(t2) {
        this.domNode = t2;
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
      setMaxWidth(t2) {
        let e = Ie(t2);
        this._maxWidth !== e && (this._maxWidth = e, this.domNode.style.maxWidth = this._maxWidth);
      }
      setWidth(t2) {
        let e = Ie(t2);
        this._width !== e && (this._width = e, this.domNode.style.width = this._width);
      }
      setHeight(t2) {
        let e = Ie(t2);
        this._height !== e && (this._height = e, this.domNode.style.height = this._height);
      }
      setTop(t2) {
        let e = Ie(t2);
        this._top !== e && (this._top = e, this.domNode.style.top = this._top);
      }
      setLeft(t2) {
        let e = Ie(t2);
        this._left !== e && (this._left = e, this.domNode.style.left = this._left);
      }
      setBottom(t2) {
        let e = Ie(t2);
        this._bottom !== e && (this._bottom = e, this.domNode.style.bottom = this._bottom);
      }
      setRight(t2) {
        let e = Ie(t2);
        this._right !== e && (this._right = e, this.domNode.style.right = this._right);
      }
      setPaddingTop(t2) {
        let e = Ie(t2);
        this._paddingTop !== e && (this._paddingTop = e, this.domNode.style.paddingTop = this._paddingTop);
      }
      setPaddingLeft(t2) {
        let e = Ie(t2);
        this._paddingLeft !== e && (this._paddingLeft = e, this.domNode.style.paddingLeft = this._paddingLeft);
      }
      setPaddingBottom(t2) {
        let e = Ie(t2);
        this._paddingBottom !== e && (this._paddingBottom = e, this.domNode.style.paddingBottom = this._paddingBottom);
      }
      setPaddingRight(t2) {
        let e = Ie(t2);
        this._paddingRight !== e && (this._paddingRight = e, this.domNode.style.paddingRight = this._paddingRight);
      }
      setFontFamily(t2) {
        this._fontFamily !== t2 && (this._fontFamily = t2, this.domNode.style.fontFamily = this._fontFamily);
      }
      setFontWeight(t2) {
        this._fontWeight !== t2 && (this._fontWeight = t2, this.domNode.style.fontWeight = this._fontWeight);
      }
      setFontSize(t2) {
        let e = Ie(t2);
        this._fontSize !== e && (this._fontSize = e, this.domNode.style.fontSize = this._fontSize);
      }
      setFontStyle(t2) {
        this._fontStyle !== t2 && (this._fontStyle = t2, this.domNode.style.fontStyle = this._fontStyle);
      }
      setFontFeatureSettings(t2) {
        this._fontFeatureSettings !== t2 && (this._fontFeatureSettings = t2, this.domNode.style.fontFeatureSettings = this._fontFeatureSettings);
      }
      setFontVariationSettings(t2) {
        this._fontVariationSettings !== t2 && (this._fontVariationSettings = t2, this.domNode.style.fontVariationSettings = this._fontVariationSettings);
      }
      setTextDecoration(t2) {
        this._textDecoration !== t2 && (this._textDecoration = t2, this.domNode.style.textDecoration = this._textDecoration);
      }
      setLineHeight(t2) {
        let e = Ie(t2);
        this._lineHeight !== e && (this._lineHeight = e, this.domNode.style.lineHeight = this._lineHeight);
      }
      setLetterSpacing(t2) {
        let e = Ie(t2);
        this._letterSpacing !== e && (this._letterSpacing = e, this.domNode.style.letterSpacing = this._letterSpacing);
      }
      setClassName(t2) {
        this._className !== t2 && (this._className = t2, this.domNode.className = this._className);
      }
      toggleClassName(t2, e) {
        this.domNode.classList.toggle(t2, e), this._className = this.domNode.className;
      }
      setDisplay(t2) {
        this._display !== t2 && (this._display = t2, this.domNode.style.display = this._display);
      }
      setPosition(t2) {
        this._position !== t2 && (this._position = t2, this.domNode.style.position = this._position);
      }
      setVisibility(t2) {
        this._visibility !== t2 && (this._visibility = t2, this.domNode.style.visibility = this._visibility);
      }
      setColor(t2) {
        this._color !== t2 && (this._color = t2, this.domNode.style.color = this._color);
      }
      setBackgroundColor(t2) {
        this._backgroundColor !== t2 && (this._backgroundColor = t2, this.domNode.style.backgroundColor = this._backgroundColor);
      }
      setLayerHinting(t2) {
        this._layerHint !== t2 && (this._layerHint = t2, this.domNode.style.transform = this._layerHint ? "translate3d(0px, 0px, 0px)" : "");
      }
      setBoxShadow(t2) {
        this._boxShadow !== t2 && (this._boxShadow = t2, this.domNode.style.boxShadow = t2);
      }
      setContain(t2) {
        this._contain !== t2 && (this._contain = t2, this.domNode.style.contain = this._contain);
      }
      setAttribute(t2, e) {
        this.domNode.setAttribute(t2, e);
      }
      removeAttribute(t2) {
        this.domNode.removeAttribute(t2);
      }
      appendChild(t2) {
        this.domNode.appendChild(t2.domNode);
      }
      removeChild(t2) {
        this.domNode.removeChild(t2.domNode);
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
      stopMonitoring(t2, e) {
        if (!this.isMonitoring()) return;
        this._hooks.clear(), this._pointerMoveCallback = null;
        let i = this._onStopCallback;
        this._onStopCallback = null, t2 && i && i(e);
      }
      isMonitoring() {
        return !!this._pointerMoveCallback;
      }
      startMonitoring(t2, e, i, r, n) {
        this.isMonitoring() && this.stopMonitoring(false), this._pointerMoveCallback = r, this._onStopCallback = n;
        let o = t2;
        try {
          t2.setPointerCapture(e), this._hooks.add(C(() => {
            try {
              t2.releasePointerCapture(e);
            } catch {
            }
          }));
        } catch {
          o = be(t2);
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
          let u = this.activeTouches[a.identifier], h16 = Date.now() - u.initialTimeStamp;
          if (h16 < Q2.HOLD_DELAY && Math.abs(u.initialPageX - Se(u.rollingPageX)) < 30 && Math.abs(u.initialPageY - Se(u.rollingPageY)) < 30) {
            let c = this.newGestureEvent(He.Tap, u.initialTarget);
            c.pageX = Se(u.rollingPageX), c.pageY = Se(u.rollingPageY), this.dispatchEvent(c);
          } else if (h16 >= Q2.HOLD_DELAY && Math.abs(u.initialPageX - Se(u.rollingPageX)) < 30 && Math.abs(u.initialPageY - Se(u.rollingPageY)) < 30) {
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
      inertia(e, i, r, n, o, l, a, u, h16) {
        this.handle = mt(e, () => {
          let c = Date.now(), d = c - r, _ = 0, p = 0, m = true;
          n += Q2.SCROLL_FRICTION * d, a += Q2.SCROLL_FRICTION * d, n > 0 && (m = false, _ = o * n * d), a > 0 && (m = false, p = u * a * d);
          let f = this.newGestureEvent(He.Change);
          f.translationX = _, f.translationY = p, i.forEach((A) => A.dispatchEvent(f)), m || this.inertia(e, i, c, n, o, l + _, a, u, h16 + p);
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
      onclick(t2, e) {
        this._register(L(t2, Y.CLICK, (i) => e(new qe(be(t2), i))));
      }
      onmousedown(t2, e) {
        this._register(L(t2, Y.MOUSE_DOWN, (i) => e(new qe(be(t2), i))));
      }
      onmouseover(t2, e) {
        this._register(L(t2, Y.MOUSE_OVER, (i) => e(new qe(be(t2), i))));
      }
      onmouseleave(t2, e) {
        this._register(L(t2, Y.MOUSE_LEAVE, (i) => e(new qe(be(t2), i))));
      }
      onkeydown(t2, e) {
        this._register(L(t2, Y.KEY_DOWN, (i) => e(new ft(i))));
      }
      onkeyup(t2, e) {
        this._register(L(t2, Y.KEY_UP, (i) => e(new ft(i))));
      }
      oninput(t2, e) {
        this._register(L(t2, Y.INPUT, e));
      }
      onblur(t2, e) {
        this._register(L(t2, Y.BLUR, e));
      }
      onfocus(t2, e) {
        this._register(L(t2, Y.FOCUS, e));
      }
      onchange(t2, e) {
        this._register(L(t2, Y.CHANGE, e));
      }
      ignoreGesture(t2) {
        return Pr.ignoreTarget(t2);
      }
    };
    Uo = 11, Or = class extends lt {
      constructor(t2) {
        super(), this._onActivate = t2.onActivate, this.bgDomNode = document.createElement("div"), this.bgDomNode.className = "arrow-background", this.bgDomNode.style.position = "absolute", this.bgDomNode.style.width = t2.bgWidth + "px", this.bgDomNode.style.height = t2.bgHeight + "px", typeof t2.top < "u" && (this.bgDomNode.style.top = "0px"), typeof t2.left < "u" && (this.bgDomNode.style.left = "0px"), typeof t2.bottom < "u" && (this.bgDomNode.style.bottom = "0px"), typeof t2.right < "u" && (this.bgDomNode.style.right = "0px"), this.domNode = document.createElement("div"), this.domNode.className = t2.className, this.domNode.style.position = "absolute", this.domNode.style.width = Uo + "px", this.domNode.style.height = Uo + "px", typeof t2.top < "u" && (this.domNode.style.top = t2.top + "px"), typeof t2.left < "u" && (this.domNode.style.left = t2.left + "px"), typeof t2.bottom < "u" && (this.domNode.style.bottom = t2.bottom + "px"), typeof t2.right < "u" && (this.domNode.style.right = t2.right + "px"), this._pointerMoveMonitor = this._register(new Wt()), this._register(os(this.bgDomNode, Y.POINTER_DOWN, (e) => this._arrowPointerDown(e))), this._register(os(this.domNode, Y.POINTER_DOWN, (e) => this._arrowPointerDown(e))), this._pointerdownRepeatTimer = this._register(new Mr()), this._pointerdownScheduleRepeatTimer = this._register(new Ye());
      }
      _arrowPointerDown(t2) {
        if (!t2.target || !(t2.target instanceof Element)) return;
        let e = () => {
          this._pointerdownRepeatTimer.cancelAndSet(() => this._onActivate(), 1e3 / 24, be(t2));
        };
        this._onActivate(), this._pointerdownRepeatTimer.cancel(), this._pointerdownScheduleRepeatTimer.cancelAndSet(e, 200), this._pointerMoveMonitor.startMonitoring(t2.target, t2.pointerId, t2.buttons, (i) => {
        }, () => {
          this._pointerdownRepeatTimer.cancel(), this._pointerdownScheduleRepeatTimer.cancel();
        }), t2.preventDefault();
      }
    };
    cs = class s9 {
      constructor(t2, e, i, r, n, o, l) {
        this._forceIntegerValues = t2;
        this._scrollStateBrand = void 0;
        this._forceIntegerValues && (e = e | 0, i = i | 0, r = r | 0, n = n | 0, o = o | 0, l = l | 0), this.rawScrollLeft = r, this.rawScrollTop = l, e < 0 && (e = 0), r + e > i && (r = i - e), r < 0 && (r = 0), n < 0 && (n = 0), l + n > o && (l = o - n), l < 0 && (l = 0), this.width = e, this.scrollWidth = i, this.scrollLeft = r, this.height = n, this.scrollHeight = o, this.scrollTop = l;
      }
      equals(t2) {
        return this.rawScrollLeft === t2.rawScrollLeft && this.rawScrollTop === t2.rawScrollTop && this.width === t2.width && this.scrollWidth === t2.scrollWidth && this.scrollLeft === t2.scrollLeft && this.height === t2.height && this.scrollHeight === t2.scrollHeight && this.scrollTop === t2.scrollTop;
      }
      withScrollDimensions(t2, e) {
        return new s9(this._forceIntegerValues, typeof t2.width < "u" ? t2.width : this.width, typeof t2.scrollWidth < "u" ? t2.scrollWidth : this.scrollWidth, e ? this.rawScrollLeft : this.scrollLeft, typeof t2.height < "u" ? t2.height : this.height, typeof t2.scrollHeight < "u" ? t2.scrollHeight : this.scrollHeight, e ? this.rawScrollTop : this.scrollTop);
      }
      withScrollPosition(t2) {
        return new s9(this._forceIntegerValues, this.width, this.scrollWidth, typeof t2.scrollLeft < "u" ? t2.scrollLeft : this.rawScrollLeft, this.height, this.scrollHeight, typeof t2.scrollTop < "u" ? t2.scrollTop : this.rawScrollTop);
      }
      createScrollEvent(t2, e) {
        let i = this.width !== t2.width, r = this.scrollWidth !== t2.scrollWidth, n = this.scrollLeft !== t2.scrollLeft, o = this.height !== t2.height, l = this.scrollHeight !== t2.scrollHeight, a = this.scrollTop !== t2.scrollTop;
        return { inSmoothScrolling: e, oldWidth: t2.width, oldScrollWidth: t2.scrollWidth, oldScrollLeft: t2.scrollLeft, width: this.width, scrollWidth: this.scrollWidth, scrollLeft: this.scrollLeft, oldHeight: t2.height, oldScrollHeight: t2.scrollHeight, oldScrollTop: t2.scrollTop, height: this.height, scrollHeight: this.scrollHeight, scrollTop: this.scrollTop, widthChanged: i, scrollWidthChanged: r, scrollLeftChanged: n, heightChanged: o, scrollHeightChanged: l, scrollTopChanged: a };
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
      constructor(t2, e, i) {
        this.scrollLeft = t2, this.scrollTop = e, this.isDone = i;
      }
    };
    Nr = class s10 {
      constructor(t2, e, i, r) {
        this.from = t2, this.to = e, this.duration = r, this.startTime = i, this.animationFrameDisposable = null, this._initAnimations();
      }
      _initAnimations() {
        this.scrollLeft = this._initAnimation(this.from.scrollLeft, this.to.scrollLeft, this.to.width), this.scrollTop = this._initAnimation(this.from.scrollTop, this.to.scrollTop, this.to.height);
      }
      _initAnimation(t2, e, i) {
        if (Math.abs(t2 - e) > 2.5 * i) {
          let n, o;
          return t2 < e ? (n = t2 + 0.75 * i, o = e - 0.75 * i) : (n = t2 - 0.75 * i, o = e + 0.75 * i), La(as(t2, n), as(o, e), 0.33);
        }
        return as(t2, e);
      }
      dispose() {
        this.animationFrameDisposable !== null && (this.animationFrameDisposable.dispose(), this.animationFrameDisposable = null);
      }
      acceptScrollDimensions(t2) {
        this.to = t2.withScrollPosition(this.to), this._initAnimations();
      }
      tick() {
        return this._tick(Date.now());
      }
      _tick(t2) {
        let e = (t2 - this.startTime) / this.duration;
        if (e < 1) {
          let i = this.scrollLeft(e), r = this.scrollTop(e);
          return new Br(i, r, false);
        }
        return new Br(this.to.scrollLeft, this.to.scrollTop, true);
      }
      combine(t2, e, i) {
        return s10.start(t2, e, i);
      }
      static start(t2, e, i) {
        i = i + 10;
        let r = Date.now() - 10;
        return new s10(t2, e, r, i);
      }
    };
    Fr = class extends D {
      constructor(t2, e, i) {
        super(), this._visibility = t2, this._visibleClassName = e, this._invisibleClassName = i, this._domNode = null, this._isVisible = false, this._isNeeded = false, this._rawShouldBeVisible = false, this._shouldBeVisible = false, this._revealTimer = this._register(new Ye());
      }
      setVisibility(t2) {
        this._visibility !== t2 && (this._visibility = t2, this._updateShouldBeVisible());
      }
      setShouldBeVisible(t2) {
        this._rawShouldBeVisible = t2, this._updateShouldBeVisible();
      }
      _applyVisibilitySetting() {
        return this._visibility === 2 ? false : this._visibility === 3 ? true : this._rawShouldBeVisible;
      }
      _updateShouldBeVisible() {
        let t2 = this._applyVisibilitySetting();
        this._shouldBeVisible !== t2 && (this._shouldBeVisible = t2, this.ensureVisibility());
      }
      setIsNeeded(t2) {
        this._isNeeded !== t2 && (this._isNeeded = t2, this.ensureVisibility());
      }
      setDomNode(t2) {
        this._domNode = t2, this._domNode.setClassName(this._invisibleClassName), this.setShouldBeVisible(false);
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
      _hide(t2) {
        this._revealTimer.cancel(), this._isVisible && (this._isVisible = false, this._domNode?.setClassName(this._invisibleClassName + (t2 ? " fade" : "")));
      }
    };
    Ca = 140, Ut = class extends lt {
      constructor(t2) {
        super(), this._lazyRender = t2.lazyRender, this._host = t2.host, this._scrollable = t2.scrollable, this._scrollByPage = t2.scrollByPage, this._scrollbarState = t2.scrollbarState, this._visibilityController = this._register(new Fr(t2.visibility, "visible scrollbar " + t2.extraScrollbarClassName, "invisible scrollbar " + t2.extraScrollbarClassName)), this._visibilityController.setIsNeeded(this._scrollbarState.isNeeded()), this._pointerMoveMonitor = this._register(new Wt()), this._shouldRender = true, this.domNode = _t(document.createElement("div")), this.domNode.setAttribute("role", "presentation"), this.domNode.setAttribute("aria-hidden", "true"), this._visibilityController.setDomNode(this.domNode), this.domNode.setPosition("absolute"), this._register(L(this.domNode.domNode, Y.POINTER_DOWN, (e) => this._domNodePointerDown(e)));
      }
      _createArrow(t2) {
        let e = this._register(new Or(t2));
        this.domNode.domNode.appendChild(e.bgDomNode), this.domNode.domNode.appendChild(e.domNode);
      }
      _createSlider(t2, e, i, r) {
        this.slider = _t(document.createElement("div")), this.slider.setClassName("slider"), this.slider.setPosition("absolute"), this.slider.setTop(t2), this.slider.setLeft(e), typeof i == "number" && this.slider.setWidth(i), typeof r == "number" && this.slider.setHeight(r), this.slider.setLayerHinting(true), this.slider.setContain("strict"), this.domNode.domNode.appendChild(this.slider.domNode), this._register(L(this.slider.domNode, Y.POINTER_DOWN, (n) => {
          n.button === 0 && (n.preventDefault(), this._sliderPointerDown(n));
        })), this.onclick(this.slider.domNode, (n) => {
          n.leftButton && n.stopPropagation();
        });
      }
      _onElementSize(t2) {
        return this._scrollbarState.setVisibleSize(t2) && (this._visibilityController.setIsNeeded(this._scrollbarState.isNeeded()), this._shouldRender = true, this._lazyRender || this.render()), this._shouldRender;
      }
      _onElementScrollSize(t2) {
        return this._scrollbarState.setScrollSize(t2) && (this._visibilityController.setIsNeeded(this._scrollbarState.isNeeded()), this._shouldRender = true, this._lazyRender || this.render()), this._shouldRender;
      }
      _onElementScrollPosition(t2) {
        return this._scrollbarState.setScrollPosition(t2) && (this._visibilityController.setIsNeeded(this._scrollbarState.isNeeded()), this._shouldRender = true, this._lazyRender || this.render()), this._shouldRender;
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
      _domNodePointerDown(t2) {
        t2.target === this.domNode.domNode && this._onPointerDown(t2);
      }
      delegatePointerDown(t2) {
        let e = this.domNode.domNode.getClientRects()[0].top, i = e + this._scrollbarState.getSliderPosition(), r = e + this._scrollbarState.getSliderPosition() + this._scrollbarState.getSliderSize(), n = this._sliderPointerPosition(t2);
        i <= n && n <= r ? t2.button === 0 && (t2.preventDefault(), this._sliderPointerDown(t2)) : this._onPointerDown(t2);
      }
      _onPointerDown(t2) {
        let e, i;
        if (t2.target === this.domNode.domNode && typeof t2.offsetX == "number" && typeof t2.offsetY == "number") e = t2.offsetX, i = t2.offsetY;
        else {
          let n = Fo(this.domNode.domNode);
          e = t2.pageX - n.left, i = t2.pageY - n.top;
        }
        let r = this._pointerDownRelativePosition(e, i);
        this._setDesiredScrollPositionNow(this._scrollByPage ? this._scrollbarState.getDesiredScrollPositionFromOffsetPaged(r) : this._scrollbarState.getDesiredScrollPositionFromOffset(r)), t2.button === 0 && (t2.preventDefault(), this._sliderPointerDown(t2));
      }
      _sliderPointerDown(t2) {
        if (!t2.target || !(t2.target instanceof Element)) return;
        let e = this._sliderPointerPosition(t2), i = this._sliderOrthogonalPointerPosition(t2), r = this._scrollbarState.clone();
        this.slider.toggleClassName("active", true), this._pointerMoveMonitor.startMonitoring(t2.target, t2.pointerId, t2.buttons, (n) => {
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
      _setDesiredScrollPositionNow(t2) {
        let e = {};
        this.writeScrollPosition(e, t2), this._scrollable.setScrollPositionNow(e);
      }
      updateScrollbarSize(t2) {
        this._updateScrollbarSize(t2), this._scrollbarState.setScrollbarSize(t2), this._shouldRender = true, this._lazyRender || this.render();
      }
      isNeeded() {
        return this._scrollbarState.isNeeded();
      }
    };
    Kt = class s11 {
      constructor(t2, e, i, r, n, o) {
        this._scrollbarSize = Math.round(e), this._oppositeScrollbarSize = Math.round(i), this._arrowSize = Math.round(t2), this._visibleSize = r, this._scrollSize = n, this._scrollPosition = o, this._computedAvailableSize = 0, this._computedIsNeeded = false, this._computedSliderSize = 0, this._computedSliderRatio = 0, this._computedSliderPosition = 0, this._refreshComputedValues();
      }
      clone() {
        return new s11(this._arrowSize, this._scrollbarSize, this._oppositeScrollbarSize, this._visibleSize, this._scrollSize, this._scrollPosition);
      }
      setVisibleSize(t2) {
        let e = Math.round(t2);
        return this._visibleSize !== e ? (this._visibleSize = e, this._refreshComputedValues(), true) : false;
      }
      setScrollSize(t2) {
        let e = Math.round(t2);
        return this._scrollSize !== e ? (this._scrollSize = e, this._refreshComputedValues(), true) : false;
      }
      setScrollPosition(t2) {
        let e = Math.round(t2);
        return this._scrollPosition !== e ? (this._scrollPosition = e, this._refreshComputedValues(), true) : false;
      }
      setScrollbarSize(t2) {
        this._scrollbarSize = Math.round(t2);
      }
      setOppositeScrollbarSize(t2) {
        this._oppositeScrollbarSize = Math.round(t2);
      }
      static _computeValues(t2, e, i, r, n) {
        let o = Math.max(0, i - t2), l = Math.max(0, o - 2 * e), a = r > 0 && r > i;
        if (!a) return { computedAvailableSize: Math.round(o), computedIsNeeded: a, computedSliderSize: Math.round(l), computedSliderRatio: 0, computedSliderPosition: 0 };
        let u = Math.round(Math.max(20, Math.floor(i * l / r))), h16 = (l - u) / (r - i), c = n * h16;
        return { computedAvailableSize: Math.round(o), computedIsNeeded: a, computedSliderSize: Math.round(u), computedSliderRatio: h16, computedSliderPosition: Math.round(c) };
      }
      _refreshComputedValues() {
        let t2 = s11._computeValues(this._oppositeScrollbarSize, this._arrowSize, this._visibleSize, this._scrollSize, this._scrollPosition);
        this._computedAvailableSize = t2.computedAvailableSize, this._computedIsNeeded = t2.computedIsNeeded, this._computedSliderSize = t2.computedSliderSize, this._computedSliderRatio = t2.computedSliderRatio, this._computedSliderPosition = t2.computedSliderPosition;
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
      getDesiredScrollPositionFromOffset(t2) {
        if (!this._computedIsNeeded) return 0;
        let e = t2 - this._arrowSize - this._computedSliderSize / 2;
        return Math.round(e / this._computedSliderRatio);
      }
      getDesiredScrollPositionFromOffsetPaged(t2) {
        if (!this._computedIsNeeded) return 0;
        let e = t2 - this._arrowSize, i = this._scrollPosition;
        return e < this._computedSliderPosition ? i -= this._visibleSize : i += this._visibleSize, i;
      }
      getDesiredScrollPositionFromDelta(t2) {
        if (!this._computedIsNeeded) return 0;
        let e = this._computedSliderPosition + t2;
        return Math.round(e / this._computedSliderRatio);
      }
    };
    Wr = class extends Ut {
      constructor(t2, e, i) {
        let r = t2.getScrollDimensions(), n = t2.getCurrentScrollPosition();
        if (super({ lazyRender: e.lazyRender, host: i, scrollbarState: new Kt(e.horizontalHasArrows ? e.arrowSize : 0, e.horizontal === 2 ? 0 : e.horizontalScrollbarSize, e.vertical === 2 ? 0 : e.verticalScrollbarSize, r.width, r.scrollWidth, n.scrollLeft), visibility: e.horizontal, extraScrollbarClassName: "horizontal", scrollable: t2, scrollByPage: e.scrollByPage }), e.horizontalHasArrows) throw new Error("horizontalHasArrows is not supported in xterm.js");
        this._createSlider(Math.floor((e.horizontalScrollbarSize - e.horizontalSliderSize) / 2), 0, void 0, e.horizontalSliderSize);
      }
      _updateSlider(t2, e) {
        this.slider.setWidth(t2), this.slider.setLeft(e);
      }
      _renderDomNode(t2, e) {
        this.domNode.setWidth(t2), this.domNode.setHeight(e), this.domNode.setLeft(0), this.domNode.setBottom(0);
      }
      onDidScroll(t2) {
        return this._shouldRender = this._onElementScrollSize(t2.scrollWidth) || this._shouldRender, this._shouldRender = this._onElementScrollPosition(t2.scrollLeft) || this._shouldRender, this._shouldRender = this._onElementSize(t2.width) || this._shouldRender, this._shouldRender;
      }
      _pointerDownRelativePosition(t2, e) {
        return t2;
      }
      _sliderPointerPosition(t2) {
        return t2.pageX;
      }
      _sliderOrthogonalPointerPosition(t2) {
        return t2.pageY;
      }
      _updateScrollbarSize(t2) {
        this.slider.setHeight(t2);
      }
      writeScrollPosition(t2, e) {
        t2.scrollLeft = e;
      }
      updateOptions(t2) {
        this.updateScrollbarSize(t2.horizontal === 2 ? 0 : t2.horizontalScrollbarSize), this._scrollbarState.setOppositeScrollbarSize(t2.vertical === 2 ? 0 : t2.verticalScrollbarSize), this._visibilityController.setVisibility(t2.horizontal), this._scrollByPage = t2.scrollByPage;
      }
    };
    Ur = class extends Ut {
      constructor(t2, e, i) {
        let r = t2.getScrollDimensions(), n = t2.getCurrentScrollPosition();
        if (super({ lazyRender: e.lazyRender, host: i, scrollbarState: new Kt(e.verticalHasArrows ? e.arrowSize : 0, e.vertical === 2 ? 0 : e.verticalScrollbarSize, 0, r.height, r.scrollHeight, n.scrollTop), visibility: e.vertical, extraScrollbarClassName: "vertical", scrollable: t2, scrollByPage: e.scrollByPage }), e.verticalHasArrows) throw new Error("horizontalHasArrows is not supported in xterm.js");
        this._createSlider(0, Math.floor((e.verticalScrollbarSize - e.verticalSliderSize) / 2), e.verticalSliderSize, void 0);
      }
      _updateSlider(t2, e) {
        this.slider.setHeight(t2), this.slider.setTop(e);
      }
      _renderDomNode(t2, e) {
        this.domNode.setWidth(e), this.domNode.setHeight(t2), this.domNode.setRight(0), this.domNode.setTop(0);
      }
      onDidScroll(t2) {
        return this._shouldRender = this._onElementScrollSize(t2.scrollHeight) || this._shouldRender, this._shouldRender = this._onElementScrollPosition(t2.scrollTop) || this._shouldRender, this._shouldRender = this._onElementSize(t2.height) || this._shouldRender, this._shouldRender;
      }
      _pointerDownRelativePosition(t2, e) {
        return e;
      }
      _sliderPointerPosition(t2) {
        return t2.pageY;
      }
      _sliderOrthogonalPointerPosition(t2) {
        return t2.pageX;
      }
      _updateScrollbarSize(t2) {
        this.slider.setWidth(t2);
      }
      writeScrollPosition(t2, e) {
        t2.scrollTop = e;
      }
      updateOptions(t2) {
        this.updateScrollbarSize(t2.vertical === 2 ? 0 : t2.verticalScrollbarSize), this._scrollbarState.setOppositeScrollbarSize(0), this._visibilityController.setVisibility(t2.vertical), this._scrollByPage = t2.scrollByPage;
      }
    };
    Ma = 500, Ko = 50, zo = true, us = class {
      constructor(t2, e, i) {
        this.timestamp = t2, this.deltaX = e, this.deltaY = i, this.score = 0;
      }
    }, zr = class zr2 {
      constructor() {
        this._capacity = 5, this._memory = [], this._front = -1, this._rear = -1;
      }
      isPhysicalMouseWheel() {
        if (this._front === -1 && this._rear === -1) return false;
        let t2 = 1, e = 0, i = 1, r = this._rear;
        do {
          let n = r === this._front ? t2 : Math.pow(2, -i);
          if (t2 -= n, e += this._memory[r].score * n, r === this._front) break;
          r = (this._capacity + r - 1) % this._capacity, i++;
        } while (true);
        return e <= 0.5;
      }
      acceptStandardWheelEvent(t2) {
        if (Ti) {
          let e = be(t2.browserEvent), i = mo(e);
          this.accept(Date.now(), t2.deltaX * i, t2.deltaY * i);
        } else this.accept(Date.now(), t2.deltaX, t2.deltaY);
      }
      accept(t2, e, i) {
        let r = null, n = new us(t2, e, i);
        this._front === -1 && this._rear === -1 ? (this._memory[0] = n, this._front = 0, this._rear = 0) : (r = this._memory[this._rear], this._rear = (this._rear + 1) % this._capacity, this._rear === this._front && (this._front = (this._front + 1) % this._capacity), this._memory[this._rear] = n), n.score = this._computeScore(n, r);
      }
      _computeScore(t2, e) {
        if (Math.abs(t2.deltaX) > 0 && Math.abs(t2.deltaY) > 0) return 1;
        let i = 0.5;
        if ((!this._isAlmostInt(t2.deltaX) || !this._isAlmostInt(t2.deltaY)) && (i += 0.25), e) {
          let r = Math.abs(t2.deltaX), n = Math.abs(t2.deltaY), o = Math.abs(e.deltaX), l = Math.abs(e.deltaY), a = Math.max(Math.min(r, o), 1), u = Math.max(Math.min(n, l), 1), h16 = Math.max(r, o), c = Math.max(n, l);
          h16 % a === 0 && c % u === 0 && (i -= 0.5);
        }
        return Math.min(Math.max(i, 0), 1);
      }
      _isAlmostInt(t2) {
        return Math.abs(Math.round(t2) - t2) < 0.01;
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
          let u = this._scrollable.getFutureScrollPosition(), h16 = {};
          if (o) {
            let c = Ko * o, d = u.scrollTop - (c < 0 ? Math.floor(c) : Math.ceil(c));
            this._verticalScrollbar.writeScrollPosition(h16, d);
          }
          if (l) {
            let c = Ko * l, d = u.scrollLeft - (c < 0 ? Math.floor(c) : Math.ceil(c));
            this._horizontalScrollbar.writeScrollPosition(h16, d);
          }
          h16 = this._scrollable.validateScrollPosition(h16), (u.scrollLeft !== h16.scrollLeft || u.scrollTop !== h16.scrollTop) && (zo && this._options.mouseWheelSmoothScroll && i.isPhysicalMouseWheel() ? this._scrollable.setScrollPositionSmooth(h16) : this._scrollable.setScrollPositionNow(h16), r = true);
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
      constructor(t2, e, i) {
        super(t2, e, i);
      }
      setScrollPosition(t2) {
        t2.reuseAnimation ? this._scrollable.setScrollPositionSmooth(t2, t2.reuseAnimation) : this._scrollable.setScrollPositionNow(t2);
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
        let h16 = this._register(new Ri({ forceIntegerValues: false, smoothScrollDuration: this._optionsService.rawOptions.smoothScrollDuration, scheduleAtNextAnimationFrame: (c) => mt(n.window, c) }));
        this._register(this._optionsService.onSpecificOptionChange("smoothScrollDuration", () => {
          h16.setSmoothScrollDuration(this._optionsService.rawOptions.smoothScrollDuration);
        })), this._scrollableElement = this._register(new Kr(i, { vertical: 1, horizontal: 2, useShadows: false, mouseWheelSmoothScroll: true, ...this._getChangeOptions() }, h16)), this._register(this._optionsService.onMultipleOptionChange(["scrollSensitivity", "fastScrollSensitivity", "overviewRuler"], () => this._scrollableElement.updateOptions(this._getChangeOptions()))), this._register(o.onProtocolChange((c) => {
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
      addDecoration(t2) {
        if (t2.options.overviewRulerOptions) {
          for (let e of this._zones) if (e.color === t2.options.overviewRulerOptions.color && e.position === t2.options.overviewRulerOptions.position) {
            if (this._lineIntersectsZone(e, t2.marker.line)) return;
            if (this._lineAdjacentToZone(e, t2.marker.line, t2.options.overviewRulerOptions.position)) {
              this._addLineToZone(e, t2.marker.line);
              return;
            }
          }
          if (this._zonePoolIndex < this._zonePool.length) {
            this._zonePool[this._zonePoolIndex].color = t2.options.overviewRulerOptions.color, this._zonePool[this._zonePoolIndex].position = t2.options.overviewRulerOptions.position, this._zonePool[this._zonePoolIndex].startBufferLine = t2.marker.line, this._zonePool[this._zonePoolIndex].endBufferLine = t2.marker.line, this._zones.push(this._zonePool[this._zonePoolIndex++]);
            return;
          }
          this._zones.push({ color: t2.options.overviewRulerOptions.color, position: t2.options.overviewRulerOptions.position, startBufferLine: t2.marker.line, endBufferLine: t2.marker.line }), this._zonePool.push(this._zones[this._zones.length - 1]), this._zonePoolIndex++;
        }
      }
      setPadding(t2) {
        this._linePadding = t2;
      }
      _lineIntersectsZone(t2, e) {
        return e >= t2.startBufferLine && e <= t2.endBufferLine;
      }
      _lineAdjacentToZone(t2, e, i) {
        return e >= t2.startBufferLine - this._linePadding[i || "full"] && e <= t2.endBufferLine + this._linePadding[i || "full"];
      }
      _addLineToZone(t2, e) {
        t2.startBufferLine = Math.min(t2.startBufferLine, e), t2.endBufferLine = Math.max(t2.endBufferLine, e);
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
        let h16 = this._canvas.getContext("2d");
        if (h16) this._ctx = h16;
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
    ((t2) => t2.ST = `${b.ESC}\\`)(fs ||= {});
    $t = class {
      constructor(t2, e, i, r, n, o) {
        this._textarea = t2;
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
      compositionupdate(t2) {
        this._compositionView.textContent = t2.data, this.updateCompositionElements(), setTimeout(() => {
          this._compositionPosition.end = this._textarea.value.length;
        }, 0);
      }
      compositionend() {
        this._finalizeComposition(true);
      }
      keydown(t2) {
        if (this._isComposing || this._isSendingComposition) {
          if (t2.keyCode === 20 || t2.keyCode === 229 || t2.keyCode === 16 || t2.keyCode === 17 || t2.keyCode === 18) return false;
          this._finalizeComposition(false);
        }
        return t2.keyCode === 229 ? (this._handleAnyTextareaChanges(), false) : true;
      }
      _finalizeComposition(t2) {
        if (this._compositionView.classList.remove("active"), this._isComposing = false, t2) {
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
        let t2 = this._textarea.value;
        setTimeout(() => {
          if (!this._isComposing) {
            let e = this._textarea.value, i = e.replace(t2, "");
            this._dataAlreadySent = i, e.length > t2.length ? this._coreService.triggerDataEvent(i, true) : e.length < t2.length ? this._coreService.triggerDataEvent(`${b.DEL}`, true) : e.length === t2.length && e !== t2 && this._coreService.triggerDataEvent(e, true);
          }
        }, 0);
      }
      updateCompositionElements(t2) {
        if (this._isComposing) {
          if (this._bufferService.buffer.isCursorInViewport) {
            let e = Math.min(this._bufferService.buffer.x, this._bufferService.cols - 1), i = this._renderService.dimensions.css.cell.height, r = this._bufferService.buffer.y * this._renderService.dimensions.css.cell.height, n = e * this._renderService.dimensions.css.cell.width;
            this._compositionView.style.left = n + "px", this._compositionView.style.top = r + "px", this._compositionView.style.height = i + "px", this._compositionView.style.lineHeight = i + "px", this._compositionView.style.fontFamily = this._optionsService.rawOptions.fontFamily, this._compositionView.style.fontSize = this._optionsService.rawOptions.fontSize + "px";
            let o = this._compositionView.getBoundingClientRect();
            this._textarea.style.left = n + "px", this._textarea.style.top = r + "px", this._textarea.style.width = Math.max(o.width, 1) + "px", this._textarea.style.height = Math.max(o.height, 1) + "px", this._textarea.style.lineHeight = o.height + "px";
          }
          t2 || setTimeout(() => this.updateCompositionElements(true), 0);
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
      function t2(r, n, o, l = 255) {
        return (r << 24 | n << 16 | o << 8 | l) >>> 0;
      }
      i.toRgba = t2;
      function e(r, n, o, l) {
        return { css: i.toCss(r, n, o, l), rgba: i.toRgba(r, n, o, l) };
      }
      i.toColor = e;
    })(j ||= {});
    ((l) => {
      function s15(a, u) {
        if (J = (u.rgba & 255) / 255, J === 1) return { css: u.css, rgba: u.rgba };
        let h16 = u.rgba >> 24 & 255, c = u.rgba >> 16 & 255, d = u.rgba >> 8 & 255, _ = a.rgba >> 24 & 255, p = a.rgba >> 16 & 255, m = a.rgba >> 8 & 255;
        ue = _ + Math.round((h16 - _) * J), he = p + Math.round((c - p) * J), de = m + Math.round((d - m) * J);
        let f = j.toCss(ue, he, de), A = j.toRgba(ue, he, de);
        return { css: f, rgba: A };
      }
      l.blend = s15;
      function t2(a) {
        return (a.rgba & 255) === 255;
      }
      l.isOpaque = t2;
      function e(a, u, h16) {
        let c = $r.ensureContrastRatio(a.rgba, u.rgba, h16);
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
      let s15, t2;
      try {
        let r = document.createElement("canvas");
        r.width = 1, r.height = 1;
        let n = r.getContext("2d", { willReadFrequently: true });
        n && (s15 = n, s15.globalCompositeOperation = "copy", t2 = s15.createLinearGradient(0, 0, 1, 1));
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
        if (!s15 || !t2) throw new Error("css.toColor: Unsupported css format");
        if (s15.fillStyle = t2, s15.fillStyle = r, typeof s15.fillStyle != "string") throw new Error("css.toColor: Unsupported css format");
        if (s15.fillRect(0, 0, 1, 1), [ue, he, de, J] = s15.getImageData(0, 0, 1, 1).data, J !== 255) throw new Error("css.toColor: Unsupported css format");
        return { rgba: j.toRgba(ue, he, de, J), css: r };
      }
      i.toColor = e;
    })(z ||= {});
    ((e) => {
      function s15(i) {
        return t2(i >> 16 & 255, i >> 8 & 255, i & 255);
      }
      e.relativeLuminance = s15;
      function t2(i, r, n) {
        let o = i / 255, l = r / 255, a = n / 255, u = o <= 0.03928 ? o / 12.92 : Math.pow((o + 0.055) / 1.055, 2.4), h16 = l <= 0.03928 ? l / 12.92 : Math.pow((l + 0.055) / 1.055, 2.4), c = a <= 0.03928 ? a / 12.92 : Math.pow((a + 0.055) / 1.055, 2.4);
        return u * 0.2126 + h16 * 0.7152 + c * 0.0722;
      }
      e.relativeLuminance2 = t2;
    })(ve ||= {});
    ((n) => {
      function s15(o, l) {
        if (J = (l & 255) / 255, J === 1) return l;
        let a = l >> 24 & 255, u = l >> 16 & 255, h16 = l >> 8 & 255, c = o >> 24 & 255, d = o >> 16 & 255, _ = o >> 8 & 255;
        return ue = c + Math.round((a - c) * J), he = d + Math.round((u - d) * J), de = _ + Math.round((h16 - _) * J), j.toRgba(ue, he, de);
      }
      n.blend = s15;
      function t2(o, l, a) {
        let u = ve.relativeLuminance(o >> 8), h16 = ve.relativeLuminance(l >> 8);
        if (Xe(u, h16) < a) {
          if (h16 < u) {
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
      n.ensureContrastRatio = t2;
      function e(o, l, a) {
        let u = o >> 24 & 255, h16 = o >> 16 & 255, c = o >> 8 & 255, d = l >> 24 & 255, _ = l >> 16 & 255, p = l >> 8 & 255, m = Xe(ve.relativeLuminance2(d, _, p), ve.relativeLuminance2(u, h16, c));
        for (; m < a && (d > 0 || _ > 0 || p > 0); ) d -= Math.max(0, Math.ceil(d * 0.1)), _ -= Math.max(0, Math.ceil(_ * 0.1)), p -= Math.max(0, Math.ceil(p * 0.1)), m = Xe(ve.relativeLuminance2(d, _, p), ve.relativeLuminance2(u, h16, c));
        return (d << 24 | _ << 16 | p << 8 | 255) >>> 0;
      }
      n.reduceLuminance = e;
      function i(o, l, a) {
        let u = o >> 24 & 255, h16 = o >> 16 & 255, c = o >> 8 & 255, d = l >> 24 & 255, _ = l >> 16 & 255, p = l >> 8 & 255, m = Xe(ve.relativeLuminance2(d, _, p), ve.relativeLuminance2(u, h16, c));
        for (; m < a && (d < 255 || _ < 255 || p < 255); ) d = Math.min(255, d + Math.ceil((255 - d) * 0.1)), _ = Math.min(255, _ + Math.ceil((255 - _) * 0.1)), p = Math.min(255, p + Math.ceil((255 - p) * 0.1)), m = Xe(ve.relativeLuminance2(d, _, p), ve.relativeLuminance2(u, h16, c));
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
      constructor(t2) {
        this._bufferService = t2;
        this._characterJoiners = [];
        this._nextCharacterJoinerId = 0;
        this._workCell = new q();
      }
      register(t2) {
        let e = { id: this._nextCharacterJoinerId++, handler: t2 };
        return this._characterJoiners.push(e), e.id;
      }
      deregister(t2) {
        for (let e = 0; e < this._characterJoiners.length; e++) if (this._characterJoiners[e].id === t2) return this._characterJoiners.splice(e, 1), true;
        return false;
      }
      getJoinedCharacters(t2) {
        if (this._characterJoiners.length === 0) return [];
        let e = this._bufferService.buffer.lines.get(t2);
        if (!e || e.length === 0) return [];
        let i = [], r = e.translateToString(true), n = 0, o = 0, l = 0, a = e.getFg(0), u = e.getBg(0);
        for (let h16 = 0; h16 < e.getTrimmedLength(); h16++) if (e.loadCell(h16, this._workCell), this._workCell.getWidth() !== 0) {
          if (this._workCell.fg !== a || this._workCell.bg !== u) {
            if (h16 - n > 1) {
              let c = this._getJoinedRanges(r, l, o, e, n);
              for (let d = 0; d < c.length; d++) i.push(c[d]);
            }
            n = h16, l = o, a = this._workCell.fg, u = this._workCell.bg;
          }
          o += this._workCell.getChars().length || we.length;
        }
        if (this._bufferService.cols - n > 1) {
          let h16 = this._getJoinedRanges(r, l, o, e, n);
          for (let c = 0; c < h16.length; c++) i.push(h16[c]);
        }
        return i;
      }
      _getJoinedRanges(t2, e, i, r, n) {
        let o = t2.substring(e, i), l = [];
        try {
          l = this._characterJoiners[0].handler(o);
        } catch (a) {
          console.error(a);
        }
        for (let a = 1; a < this._characterJoiners.length; a++) try {
          let u = this._characterJoiners[a].handler(o);
          for (let h16 = 0; h16 < u.length; h16++) ct._mergeRanges(l, u[h16]);
        } catch (u) {
          console.error(u);
        }
        return this._stringRangesToCellRanges(l, r, n), l;
      }
      _stringRangesToCellRanges(t2, e, i) {
        let r = 0, n = false, o = 0, l = t2[r];
        if (l) {
          for (let a = i; a < this._bufferService.cols; a++) {
            let u = e.getWidth(a), h16 = e.getString(a).length || we.length;
            if (u !== 0) {
              if (!n && l[0] <= o && (l[0] = a, n = true), l[1] <= o) {
                if (l[1] = a, l = t2[++r], !l) break;
                l[0] <= o ? (l[0] = a, n = true) : n = false;
              }
              o += h16;
            }
          }
          l && (l[1] = this._bufferService.cols);
        }
      }
      static _mergeRanges(t2, e) {
        let i = false;
        for (let r = 0; r < t2.length; r++) {
          let n = t2[r];
          if (i) {
            if (e[1] <= n[0]) return t2[r - 1][1] = e[1], t2;
            if (e[1] <= n[1]) return t2[r - 1][1] = Math.max(e[1], n[1]), t2.splice(r, 1), t2;
            t2.splice(r, 1), r--;
          } else {
            if (e[1] <= n[0]) return t2.splice(r, 0, e), t2;
            if (e[1] <= n[1]) return n[0] = Math.min(e[0], n[0]), t2;
            e[0] < n[1] && (n[0] = Math.min(e[0], n[0]), i = true);
            continue;
          }
        }
        return i ? t2[t2.length - 1][1] = e[1] : t2.push(e), t2;
      }
    };
    ct = M([S(0, F)], ct);
    Vt = class {
      constructor(t2, e, i, r, n, o, l) {
        this._document = t2;
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
      handleSelectionChanged(t2, e, i) {
        this._selectionStart = t2, this._selectionEnd = e, this._columnSelectMode = i;
      }
      createRow(t2, e, i, r, n, o, l, a, u, h16, c) {
        let d = [], _ = this._characterJoinerService.getJoinedCharacters(e), p = this._themeService.colors, m = t2.getNoBgTrimmedLength();
        i && m < o + 1 && (m = o + 1);
        let f, A = 0, R = "", O = 0, I = 0, k = 0, P = 0, oe = false, Me = 0, Pe = false, Ke = 0, di = 0, V = [], Qe = h16 !== -1 && c !== -1;
        for (let y = 0; y < m; y++) {
          t2.loadCell(y, this._workCell);
          let T = this._workCell.getWidth();
          if (T === 0) continue;
          let g = false, w = y >= di, E = y, x = this._workCell;
          if (_.length > 0 && y === _[0][0] && w) {
            let W = _.shift(), An = this._isCellInSelection(W[0], e);
            for (O = W[0] + 1; O < W[1]; O++) w &&= An === this._isCellInSelection(O, e);
            w &&= !i || o < W[0] || o >= W[1], w ? (g = true, x = new Vr(this._workCell, t2.translateToString(true, W[0], W[1]), W[1] - W[0]), E = W[1] - 1, T = x.getWidth()) : di = W[1];
          }
          let N = this._isCellInSelection(y, e), Z = i && y === o, te = Qe && y >= h16 && y <= c, Oe = false;
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
      _applyMinimumContrast(t2, e, i, r, n, o) {
        if (this._optionsService.rawOptions.minimumContrastRatio === 1 || $o(r.getCode())) return false;
        let l = this._getContrastCache(r), a;
        if (!n && !o && (a = l.getColor(e.rgba, i.rgba)), a === void 0) {
          let u = this._optionsService.rawOptions.minimumContrastRatio / (r.isDim() ? 2 : 1);
          a = U.ensureContrastRatio(n || e, o || i, u), l.setColor((n || e).rgba, (o || i).rgba, a ?? null);
        }
        return a ? (this._addStyle(t2, `color:${a.css}`), true) : false;
      }
      _getContrastCache(t2) {
        return t2.isDim() ? this._themeService.colors.halfContrastCache : this._themeService.colors.contrastCache;
      }
      _addStyle(t2, e) {
        t2.setAttribute("style", `${t2.getAttribute("style") || ""}${e};`);
      }
      _isCellInSelection(t2, e) {
        let i = this._selectionStart, r = this._selectionEnd;
        return !i || !r ? false : this._columnSelectMode ? i[0] <= r[0] ? t2 >= i[0] && e >= i[1] && t2 < r[0] && e <= r[1] : t2 < i[0] && e >= i[1] && t2 >= r[0] && e <= r[1] : e > i[1] && e < r[1] || i[1] === r[1] && e === i[1] && t2 >= i[0] && t2 < r[0] || i[1] < r[1] && e === r[1] && t2 < r[0] || i[1] < r[1] && e === i[1] && t2 >= i[0];
      }
    };
    Vt = M([S(1, or), S(2, H), S(3, ae), S(4, ge), S(5, Be), S(6, Re)], Vt);
    Yr = class {
      constructor(t2, e) {
        this._flat = new Float32Array(256);
        this._font = "";
        this._fontSize = 0;
        this._weight = "normal";
        this._weightBold = "bold";
        this._measureElements = [];
        this._container = t2.createElement("div"), this._container.classList.add("xterm-width-cache-measure-container"), this._container.setAttribute("aria-hidden", "true"), this._container.style.whiteSpace = "pre", this._container.style.fontKerning = "none";
        let i = t2.createElement("span");
        i.classList.add("xterm-char-measure-element");
        let r = t2.createElement("span");
        r.classList.add("xterm-char-measure-element"), r.style.fontWeight = "bold";
        let n = t2.createElement("span");
        n.classList.add("xterm-char-measure-element"), n.style.fontStyle = "italic";
        let o = t2.createElement("span");
        o.classList.add("xterm-char-measure-element"), o.style.fontWeight = "bold", o.style.fontStyle = "italic", this._measureElements = [i, r, n, o], this._container.appendChild(i), this._container.appendChild(r), this._container.appendChild(n), this._container.appendChild(o), e.appendChild(this._container), this.clear();
      }
      dispose() {
        this._container.remove(), this._measureElements.length = 0, this._holey = void 0;
      }
      clear() {
        this._flat.fill(-9999), this._holey = /* @__PURE__ */ new Map();
      }
      setFont(t2, e, i, r) {
        t2 === this._font && e === this._fontSize && i === this._weight && r === this._weightBold || (this._font = t2, this._fontSize = e, this._weight = i, this._weightBold = r, this._container.style.fontFamily = this._font, this._container.style.fontSize = `${this._fontSize}px`, this._measureElements[0].style.fontWeight = `${i}`, this._measureElements[1].style.fontWeight = `${r}`, this._measureElements[2].style.fontWeight = `${i}`, this._measureElements[3].style.fontWeight = `${r}`, this.clear());
      }
      get(t2, e, i) {
        let r = 0;
        if (!e && !i && t2.length === 1 && (r = t2.charCodeAt(0)) < 256) {
          if (this._flat[r] !== -9999) return this._flat[r];
          let l = this._measure(t2, 0);
          return l > 0 && (this._flat[r] = l), l;
        }
        let n = t2;
        e && (n += "B"), i && (n += "I");
        let o = this._holey.get(n);
        if (o === void 0) {
          let l = 0;
          e && (l |= 1), i && (l |= 2), o = this._measure(t2, l), o > 0 && this._holey.set(n, o);
        }
        return o;
      }
      _measure(t2, e) {
        let i = this._measureElements[e];
        return i.textContent = t2.repeat(32), i.offsetWidth / 32;
      }
    };
    ms = class {
      constructor() {
        this.clear();
      }
      clear() {
        this.hasSelection = false, this.columnSelectMode = false, this.viewportStartRow = 0, this.viewportEndRow = 0, this.viewportCappedStartRow = 0, this.viewportCappedEndRow = 0, this.startCol = 0, this.endCol = 0, this.selectionStart = void 0, this.selectionEnd = void 0;
      }
      update(t2, e, i, r = false) {
        if (this.selectionStart = e, this.selectionEnd = i, !e || !i || e[0] === i[0] && e[1] === i[1]) {
          this.clear();
          return;
        }
        let n = t2.buffers.active.ydisp, o = e[1] - n, l = i[1] - n, a = Math.max(o, 0), u = Math.min(l, t2.rows - 1);
        if (a >= t2.rows || u < 0) {
          this.clear();
          return;
        }
        this.hasSelection = true, this.columnSelectMode = r, this.viewportStartRow = o, this.viewportEndRow = l, this.viewportCappedStartRow = a, this.viewportCappedEndRow = u, this.startCol = e[0], this.endCol = i[0];
      }
      isCellSelected(t2, e, i) {
        return this.hasSelection ? (i -= t2.buffer.active.viewportY, this.columnSelectMode ? this.startCol <= this.endCol ? e >= this.startCol && i >= this.viewportCappedStartRow && e < this.endCol && i <= this.viewportCappedEndRow : e < this.startCol && i >= this.viewportCappedStartRow && e >= this.endCol && i <= this.viewportCappedEndRow : i > this.viewportStartRow && i < this.viewportEndRow || this.viewportStartRow === this.viewportEndRow && i === this.viewportStartRow && e >= this.startCol && e < this.endCol || this.viewportStartRow < this.viewportEndRow && i === this.viewportEndRow && e < this.endCol || this.viewportStartRow < this.viewportEndRow && i === this.viewportStartRow && e >= this.startCol) : false;
      }
    };
    _s = "xterm-dom-renderer-owner-", Le = "xterm-rows", jr = "xterm-fg-", jo = "xterm-bg-", ki = "xterm-focus", Xr = "xterm-selection", Na = 1, Yt = class extends D {
      constructor(e, i, r, n, o, l, a, u, h16, c, d, _, p, m) {
        super();
        this._terminal = e;
        this._document = i;
        this._element = r;
        this._screenElement = n;
        this._viewportElement = o;
        this._helperContainer = l;
        this._linkifier2 = a;
        this._charSizeService = h16;
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
          let h16 = e[0] > i[0];
          u.appendChild(this._createSelectionElement(l, h16 ? i[0] : e[0], h16 ? e[0] : i[0], a - l + 1));
        } else {
          let h16 = n === l ? e[0] : 0, c = l === o ? i[0] : this._bufferService.cols;
          u.appendChild(this._createSelectionElement(l, h16, c));
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
        for (let h16 = e; h16 <= i; h16++) {
          let c = h16 + r.ydisp, d = this._rowElements[h16], _ = r.lines.get(c);
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
        let u = this._bufferService.buffer, h16 = u.ybase + u.y, c = Math.min(u.x, o - 1), d = this._optionsService.rawOptions.cursorBlink, _ = this._optionsService.rawOptions.cursorStyle, p = this._optionsService.rawOptions.cursorInactiveStyle;
        for (let m = r; m <= n; ++m) {
          let f = m + u.ydisp, A = this._rowElements[m], R = u.lines.get(f);
          if (!A || !R) break;
          A.replaceChildren(...this._rowFactory.createRow(R, f, f === h16, _, p, c, d, this.dimensions.css.cell.width, this._widthCache, l ? m === r ? e : 0 : -1, l ? (m === n ? i : o) - 1 : -1));
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
      constructor(t2, e) {
        this._renderService = t2;
        this._charSizeService = e;
      }
      getCoords(t2, e, i, r, n) {
        return Xo(window, t2, e, i, r, this._charSizeService.hasValidSize, this._renderService.dimensions.css.cell.width, this._renderService.dimensions.css.cell.height, n);
      }
      getMouseReportCoords(t2, e) {
        let i = Ci(window, t2, e);
        if (this._charSizeService.hasValidSize) return i[0] = Math.min(Math.max(i[0], 0), this._renderService.dimensions.css.canvas.width - 1), i[1] = Math.min(Math.max(i[1], 0), this._renderService.dimensions.css.canvas.height - 1), { col: Math.floor(i[0] / this._renderService.dimensions.css.cell.width), row: Math.floor(i[1] / this._renderService.dimensions.css.cell.height), x: Math.floor(i[0]), y: Math.floor(i[1]) };
      }
    };
    Xt = M([S(0, ce), S(1, nt)], Xt);
    en = class {
      constructor(t2, e) {
        this._renderCallback = t2;
        this._coreBrowserService = e;
        this._refreshCallbacks = [];
      }
      dispose() {
        this._animationFrame && (this._coreBrowserService.window.cancelAnimationFrame(this._animationFrame), this._animationFrame = void 0);
      }
      addRefreshCallback(t2) {
        return this._refreshCallbacks.push(t2), this._animationFrame || (this._animationFrame = this._coreBrowserService.window.requestAnimationFrame(() => this._innerRefresh())), this._animationFrame;
      }
      refresh(t2, e, i) {
        this._rowCount = i, t2 = t2 !== void 0 ? t2 : 0, e = e !== void 0 ? e : this._rowCount - 1, this._rowStart = this._rowStart !== void 0 ? Math.min(this._rowStart, t2) : t2, this._rowEnd = this._rowEnd !== void 0 ? Math.max(this._rowEnd, e) : e, !this._animationFrame && (this._animationFrame = this._coreBrowserService.window.requestAnimationFrame(() => this._innerRefresh()));
      }
      _innerRefresh() {
        if (this._animationFrame = void 0, this._rowStart === void 0 || this._rowEnd === void 0 || this._rowCount === void 0) {
          this._runRefreshCallbacks();
          return;
        }
        let t2 = Math.max(this._rowStart, 0), e = Math.min(this._rowEnd, this._rowCount - 1);
        this._rowStart = void 0, this._rowEnd = void 0, this._renderCallback(t2, e), this._runRefreshCallbacks();
      }
      _runRefreshCallbacks() {
        for (let t2 of this._refreshCallbacks) t2(0);
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
      enqueue(t2) {
        this._tasks.push(t2), this._start();
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
      _process(t2) {
        this._idleCallback = void 0;
        let e = 0, i = 0, r = t2.timeRemaining(), n = 0;
        for (; this._i < this._tasks.length; ) {
          if (e = performance.now(), this._tasks[this._i]() || this._i++, e = Math.max(1, performance.now() - e), i = Math.max(e, i), n = t2.timeRemaining(), i * 1.5 > n) {
            r - e < -20 && console.warn(`task queue exceeded allotted deadline by ${Math.abs(Math.round(r - e))}ms`), this._start();
            return;
          }
          r = n;
        }
        this.clear();
      }
    }, Is = class extends rn {
      _requestCallback(t2) {
        return setTimeout(() => t2(this._createDeadline(16)));
      }
      _cancelCallback(t2) {
        clearTimeout(t2);
      }
      _createDeadline(t2) {
        let e = performance.now() + t2;
        return { timeRemaining: () => Math.max(0, e - performance.now()) };
      }
    }, ys = class extends rn {
      _requestCallback(t2) {
        return requestIdleCallback(t2);
      }
      _cancelCallback(t2) {
        cancelIdleCallback(t2);
      }
    }, Jt = !Mi && "requestIdleCallback" in window ? ys : Is, nn = class {
      constructor() {
        this._queue = new Jt();
      }
      set(t2) {
        this._queue.clear(), this._queue.enqueue(t2);
      }
      flush() {
        this._queue.flush();
      }
    };
    Qt = class extends D {
      constructor(e, i, r, n, o, l, a, u, h16) {
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
        })), this._register(this._optionsService.onMultipleOptionChange(["cursorBlink", "cursorStyle"], () => this.refreshRows(a.buffer.y, a.buffer.y, true))), this._register(h16.onChangeColors(() => this._fullRefresh())), this._registerIntersectionObserver(this._coreBrowserService.window, i), this._register(this._coreBrowserService.onWindowChange((c) => this._registerIntersectionObserver(c, i)));
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
      constructor(t2, e, i) {
        this._coreBrowserService = t2;
        this._coreService = e;
        this._onTimeout = i;
        this._start = 0;
        this._end = 0;
        this._isBuffering = false;
      }
      bufferRows(t2, e) {
        this._isBuffering ? (this._start = Math.min(this._start, t2), this._end = Math.max(this._end, e)) : (this._start = t2, this._end = e, this._isBuffering = true), this._timeout === void 0 && (this._timeout = this._coreBrowserService.window.setTimeout(() => {
          this._timeout = void 0, this._coreService.decPrivateModes.synchronizedOutput = false, this._onTimeout();
        }, 1e3));
      }
      flush() {
        if (this._timeout !== void 0 && (this._coreBrowserService.window.clearTimeout(this._timeout), this._timeout = void 0), !this._isBuffering) return;
        let t2 = { start: this._start, end: this._end };
        return this._isBuffering = false, t2;
      }
      dispose() {
        this._timeout !== void 0 && (this._coreBrowserService.window.clearTimeout(this._timeout), this._timeout = void 0);
      }
    };
    on = class {
      constructor(t2) {
        this._bufferService = t2;
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
            let t2 = this.selectionStart[0] + this.selectionStartLength;
            return t2 > this._bufferService.cols ? t2 % this._bufferService.cols === 0 ? [this._bufferService.cols, this.selectionStart[1] + Math.floor(t2 / this._bufferService.cols) - 1] : [t2 % this._bufferService.cols, this.selectionStart[1] + Math.floor(t2 / this._bufferService.cols)] : [t2, this.selectionStart[1]];
          }
          if (this.selectionStartLength && this.selectionEnd[1] === this.selectionStart[1]) {
            let t2 = this.selectionStart[0] + this.selectionStartLength;
            return t2 > this._bufferService.cols ? [t2 % this._bufferService.cols, this.selectionStart[1] + Math.floor(t2 / this._bufferService.cols)] : [Math.max(t2, this.selectionEnd[0]), this.selectionEnd[1]];
          }
          return this.selectionEnd;
        }
      }
      areSelectionValuesReversed() {
        let t2 = this.selectionStart, e = this.selectionEnd;
        return !t2 || !e ? false : t2[1] > e[1] || t2[1] === e[1] && t2[0] > e[0];
      }
      handleTrim(t2) {
        return this.selectionStart && (this.selectionStart[1] -= t2), this.selectionEnd && (this.selectionEnd[1] -= t2), this.selectionEnd && this.selectionEnd[1] < 0 ? (this.clearSelection(), true) : (this.selectionStart && this.selectionStart[1] < 0 && (this.selectionStart[1] = 0), false);
      }
    };
    Ds = 50, Ya = 15, ja = 50, Xa = 500, Za = " ", Ja = new RegExp(Za, "g");
    ei = class extends D {
      constructor(e, i, r, n, o, l, a, u, h16) {
        super();
        this._element = e;
        this._screenElement = i;
        this._linkifier = r;
        this._bufferService = n;
        this._coreService = o;
        this._mouseService = l;
        this._optionsService = a;
        this._renderService = u;
        this._coreBrowserService = h16;
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
            let h16 = r.translateBufferLineToString(u, true, l, a);
            n.push(h16);
          }
        } else {
          let l = e[1] === i[1] ? i[0] : void 0;
          n.push(r.translateBufferLineToString(e[1], true, e[0], l));
          for (let a = e[1] + 1; a <= i[1] - 1; a++) {
            let u = r.lines.get(a), h16 = r.translateBufferLineToString(a, true);
            u?.isWrapped ? n[n.length - 1] += h16 : n.push(h16);
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
        let a = o.translateBufferLineToString(e[1], false), u = this._convertViewportColToCharacterIndex(l, e[0]), h16 = u, c = e[0] - u, d = 0, _ = 0, p = 0, m = 0;
        if (a.charAt(u) === " ") {
          for (; u > 0 && a.charAt(u - 1) === " "; ) u--;
          for (; h16 < a.length && a.charAt(h16 + 1) === " "; ) h16++;
        } else {
          let R = e[0], O = e[0];
          l.getWidth(R) === 0 && (d++, R--), l.getWidth(O) === 2 && (_++, O++);
          let I = l.getString(O).length;
          for (I > 1 && (m += I - 1, h16 += I - 1); R > 0 && u > 0 && !this._isCharWordSeparator(l.loadCell(R - 1, this._workCell)); ) {
            l.loadCell(R - 1, this._workCell);
            let k = this._workCell.getChars().length;
            this._workCell.getWidth() === 0 ? (d++, R--) : k > 1 && (p += k - 1, u -= k - 1), u--, R--;
          }
          for (; O < l.length && h16 + 1 < a.length && !this._isCharWordSeparator(l.loadCell(O + 1, this._workCell)); ) {
            l.loadCell(O + 1, this._workCell);
            let k = this._workCell.getChars().length;
            this._workCell.getWidth() === 2 ? (_++, O++) : k > 1 && (m += k - 1, h16 += k - 1), h16++, O++;
          }
        }
        h16++;
        let f = u + c - d + p, A = Math.min(this._bufferService.cols, h16 - u + d + _ - p - m);
        if (!(!i && a.slice(u, h16).trim() === "")) {
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
      set(t2, e, i) {
        this._data[t2] || (this._data[t2] = {}), this._data[t2][e] = i;
      }
      get(t2, e) {
        return this._data[t2] ? this._data[t2][e] : void 0;
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
      setCss(t2, e, i) {
        this._css.set(t2, e, i);
      }
      getCss(t2, e) {
        return this._css.get(t2, e);
      }
      setColor(t2, e, i) {
        this._color.set(t2, e, i);
      }
      getColor(t2, e) {
        return this._color.get(t2, e);
      }
      clear() {
        this._color.clear(), this._css.clear();
      }
    };
    re = Object.freeze((() => {
      let s15 = [z.toColor("#2e3436"), z.toColor("#cc0000"), z.toColor("#4e9a06"), z.toColor("#c4a000"), z.toColor("#3465a4"), z.toColor("#75507b"), z.toColor("#06989a"), z.toColor("#d3d7cf"), z.toColor("#555753"), z.toColor("#ef2929"), z.toColor("#8ae234"), z.toColor("#fce94f"), z.toColor("#729fcf"), z.toColor("#ad7fa8"), z.toColor("#34e2e2"), z.toColor("#eeeeec")], t2 = [0, 95, 135, 175, 215, 255];
      for (let e = 0; e < 216; e++) {
        let i = t2[e / 36 % 6 | 0], r = t2[e / 6 % 6 | 0], n = t2[e % 6];
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
      constructor(...t2) {
        this._entries = /* @__PURE__ */ new Map();
        for (let [e, i] of t2) this.set(e, i);
      }
      set(t2, e) {
        let i = this._entries.get(t2);
        return this._entries.set(t2, e), i;
      }
      forEach(t2) {
        for (let [e, i] of this._entries.entries()) t2(e, i);
      }
      has(t2) {
        return this._entries.has(t2);
      }
      get(t2) {
        return this._entries.get(t2);
      }
    }, ln = class {
      constructor() {
        this._services = new Rs();
        this._services.set(xt, this);
      }
      setService(t2, e) {
        this._services.set(t2, e);
      }
      getService(t2) {
        return this._services.get(t2);
      }
      createInstance(t2, ...e) {
        let i = Xs(t2).sort((o, l) => o.index - l.index), r = [];
        for (let o of i) {
          let l = this._services.get(o.id);
          if (!l) throw new Error(`[createInstance] ${t2.name} depends on UNKNOWN service ${o.id._id}.`);
          r.push(l);
        }
        let n = i.length > 0 ? i[0].index : e.length;
        if (e.length !== n) throw new Error(`[createInstance] First service dependency of ${t2.name} at position ${n + 1} conflicts with ${e.length} static arguments`);
        return new t2(...e, ...r);
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
      constructor(t2, e, i = false) {
        this.isWrapped = i;
        this._combined = {};
        this._extendedAttrs = {};
        this._data = new Uint32Array(t2 * B);
        let r = e || q.fromCharData([0, ir, 1, 0]);
        for (let n = 0; n < t2; ++n) this.setCell(n, r);
        this.length = t2;
      }
      get(t2) {
        let e = this._data[t2 * B + 0], i = e & 2097151;
        return [this._data[t2 * B + 1], e & 2097152 ? this._combined[t2] : i ? Ce(i) : "", e >> 22, e & 2097152 ? this._combined[t2].charCodeAt(this._combined[t2].length - 1) : i];
      }
      set(t2, e) {
        this._data[t2 * B + 1] = e[0], e[1].length > 1 ? (this._combined[t2] = e[1], this._data[t2 * B + 0] = t2 | 2097152 | e[2] << 22) : this._data[t2 * B + 0] = e[1].charCodeAt(0) | e[2] << 22;
      }
      getWidth(t2) {
        return this._data[t2 * B + 0] >> 22;
      }
      hasWidth(t2) {
        return this._data[t2 * B + 0] & 12582912;
      }
      getFg(t2) {
        return this._data[t2 * B + 1];
      }
      getBg(t2) {
        return this._data[t2 * B + 2];
      }
      hasContent(t2) {
        return this._data[t2 * B + 0] & 4194303;
      }
      getCodePoint(t2) {
        let e = this._data[t2 * B + 0];
        return e & 2097152 ? this._combined[t2].charCodeAt(this._combined[t2].length - 1) : e & 2097151;
      }
      isCombined(t2) {
        return this._data[t2 * B + 0] & 2097152;
      }
      getString(t2) {
        let e = this._data[t2 * B + 0];
        return e & 2097152 ? this._combined[t2] : e & 2097151 ? Ce(e & 2097151) : "";
      }
      isProtected(t2) {
        return this._data[t2 * B + 2] & 536870912;
      }
      loadCell(t2, e) {
        return an = t2 * B, e.content = this._data[an + 0], e.fg = this._data[an + 1], e.bg = this._data[an + 2], e.content & 2097152 && (e.combinedData = this._combined[t2]), e.bg & 268435456 && (e.extended = this._extendedAttrs[t2]), e;
      }
      setCell(t2, e) {
        e.content & 2097152 && (this._combined[t2] = e.combinedData), e.bg & 268435456 && (this._extendedAttrs[t2] = e.extended), this._data[t2 * B + 0] = e.content, this._data[t2 * B + 1] = e.fg, this._data[t2 * B + 2] = e.bg;
      }
      setCellFromCodepoint(t2, e, i, r) {
        r.bg & 268435456 && (this._extendedAttrs[t2] = r.extended), this._data[t2 * B + 0] = e | i << 22, this._data[t2 * B + 1] = r.fg, this._data[t2 * B + 2] = r.bg;
      }
      addCodepointToCell(t2, e, i) {
        let r = this._data[t2 * B + 0];
        r & 2097152 ? this._combined[t2] += Ce(e) : r & 2097151 ? (this._combined[t2] = Ce(r & 2097151) + Ce(e), r &= -2097152, r |= 2097152) : r = e | 1 << 22, i && (r &= -12582913, r |= i << 22), this._data[t2 * B + 0] = r;
      }
      insertCells(t2, e, i) {
        if (t2 %= this.length, t2 && this.getWidth(t2 - 1) === 2 && this.setCellFromCodepoint(t2 - 1, 0, 1, i), e < this.length - t2) {
          let r = new q();
          for (let n = this.length - t2 - e - 1; n >= 0; --n) this.setCell(t2 + e + n, this.loadCell(t2 + n, r));
          for (let n = 0; n < e; ++n) this.setCell(t2 + n, i);
        } else for (let r = t2; r < this.length; ++r) this.setCell(r, i);
        this.getWidth(this.length - 1) === 2 && this.setCellFromCodepoint(this.length - 1, 0, 1, i);
      }
      deleteCells(t2, e, i) {
        if (t2 %= this.length, e < this.length - t2) {
          let r = new q();
          for (let n = 0; n < this.length - t2 - e; ++n) this.setCell(t2 + n, this.loadCell(t2 + e + n, r));
          for (let n = this.length - e; n < this.length; ++n) this.setCell(n, i);
        } else for (let r = t2; r < this.length; ++r) this.setCell(r, i);
        t2 && this.getWidth(t2 - 1) === 2 && this.setCellFromCodepoint(t2 - 1, 0, 1, i), this.getWidth(t2) === 0 && !this.hasContent(t2) && this.setCellFromCodepoint(t2, 0, 1, i);
      }
      replaceCells(t2, e, i, r = false) {
        if (r) {
          for (t2 && this.getWidth(t2 - 1) === 2 && !this.isProtected(t2 - 1) && this.setCellFromCodepoint(t2 - 1, 0, 1, i), e < this.length && this.getWidth(e - 1) === 2 && !this.isProtected(e) && this.setCellFromCodepoint(e, 0, 1, i); t2 < e && t2 < this.length; ) this.isProtected(t2) || this.setCell(t2, i), t2++;
          return;
        }
        for (t2 && this.getWidth(t2 - 1) === 2 && this.setCellFromCodepoint(t2 - 1, 0, 1, i), e < this.length && this.getWidth(e - 1) === 2 && this.setCellFromCodepoint(e, 0, 1, i); t2 < e && t2 < this.length; ) this.setCell(t2++, i);
      }
      resize(t2, e) {
        if (t2 === this.length) return this._data.length * 4 * Ls < this._data.buffer.byteLength;
        let i = t2 * B;
        if (t2 > this.length) {
          if (this._data.buffer.byteLength >= i * 4) this._data = new Uint32Array(this._data.buffer, 0, i);
          else {
            let r = new Uint32Array(i);
            r.set(this._data), this._data = r;
          }
          for (let r = this.length; r < t2; ++r) this.setCell(r, e);
        } else {
          this._data = this._data.subarray(0, i);
          let r = Object.keys(this._combined);
          for (let o = 0; o < r.length; o++) {
            let l = parseInt(r[o], 10);
            l >= t2 && delete this._combined[l];
          }
          let n = Object.keys(this._extendedAttrs);
          for (let o = 0; o < n.length; o++) {
            let l = parseInt(n[o], 10);
            l >= t2 && delete this._extendedAttrs[l];
          }
        }
        return this.length = t2, i * 4 * Ls < this._data.buffer.byteLength;
      }
      cleanupMemory() {
        if (this._data.length * 4 * Ls < this._data.buffer.byteLength) {
          let t2 = new Uint32Array(this._data.length);
          return t2.set(this._data), this._data = t2, 1;
        }
        return 0;
      }
      fill(t2, e = false) {
        if (e) {
          for (let i = 0; i < this.length; ++i) this.isProtected(i) || this.setCell(i, t2);
          return;
        }
        this._combined = {}, this._extendedAttrs = {};
        for (let i = 0; i < this.length; ++i) this.setCell(i, t2);
      }
      copyFrom(t2) {
        this.length !== t2.length ? this._data = new Uint32Array(t2._data) : this._data.set(t2._data), this.length = t2.length, this._combined = {};
        for (let e in t2._combined) this._combined[e] = t2._combined[e];
        this._extendedAttrs = {};
        for (let e in t2._extendedAttrs) this._extendedAttrs[e] = t2._extendedAttrs[e];
        this.isWrapped = t2.isWrapped;
      }
      clone() {
        let t2 = new s12(0);
        t2._data = new Uint32Array(this._data), t2.length = this.length;
        for (let e in this._combined) t2._combined[e] = this._combined[e];
        for (let e in this._extendedAttrs) t2._extendedAttrs[e] = this._extendedAttrs[e];
        return t2.isWrapped = this.isWrapped, t2;
      }
      getTrimmedLength() {
        for (let t2 = this.length - 1; t2 >= 0; --t2) if (this._data[t2 * B + 0] & 4194303) return t2 + (this._data[t2 * B + 0] >> 22);
        return 0;
      }
      getNoBgTrimmedLength() {
        for (let t2 = this.length - 1; t2 >= 0; --t2) if (this._data[t2 * B + 0] & 4194303 || this._data[t2 * B + 2] & 50331648) return t2 + (this._data[t2 * B + 0] >> 22);
        return 0;
      }
      copyCellsFrom(t2, e, i, r, n) {
        let o = t2._data;
        if (n) for (let a = r - 1; a >= 0; a--) {
          for (let u = 0; u < B; u++) this._data[(i + a) * B + u] = o[(e + a) * B + u];
          o[(e + a) * B + 2] & 268435456 && (this._extendedAttrs[i + a] = t2._extendedAttrs[e + a]);
        }
        else for (let a = 0; a < r; a++) {
          for (let u = 0; u < B; u++) this._data[(i + a) * B + u] = o[(e + a) * B + u];
          o[(e + a) * B + 2] & 268435456 && (this._extendedAttrs[i + a] = t2._extendedAttrs[e + a]);
        }
        let l = Object.keys(t2._combined);
        for (let a = 0; a < l.length; a++) {
          let u = parseInt(l[a], 10);
          u >= e && (this._combined[u - e + i] = t2._combined[u]);
        }
      }
      translateToString(t2, e, i, r) {
        e = e ?? 0, i = i ?? this.length, t2 && (i = Math.min(i, this.getTrimmedLength())), r && (r.length = 0);
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
      constructor(t2) {
        this.line = t2;
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
      register(t2) {
        return this._disposables.push(t2), t2;
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
      constructor(t2, e, i) {
        this._hasScrollback = t2;
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
      getNullCell(t2) {
        return t2 ? (this._nullCell.fg = t2.fg, this._nullCell.bg = t2.bg, this._nullCell.extended = t2.extended) : (this._nullCell.fg = 0, this._nullCell.bg = 0, this._nullCell.extended = new rt()), this._nullCell;
      }
      getWhitespaceCell(t2) {
        return t2 ? (this._whitespaceCell.fg = t2.fg, this._whitespaceCell.bg = t2.bg, this._whitespaceCell.extended = t2.extended) : (this._whitespaceCell.fg = 0, this._whitespaceCell.bg = 0, this._whitespaceCell.extended = new rt()), this._whitespaceCell;
      }
      getBlankLine(t2, e) {
        return new Ze(this._bufferService.cols, this.getNullCell(t2), e);
      }
      get hasScrollback() {
        return this._hasScrollback && this.lines.maxLength > this._rows;
      }
      get isCursorInViewport() {
        let e = this.ybase + this.y - this.ydisp;
        return e >= 0 && e < this._rows;
      }
      _getCorrectBufferLength(t2) {
        if (!this._hasScrollback) return t2;
        let e = t2 + this._optionsService.rawOptions.scrollback;
        return e > cl ? cl : e;
      }
      fillViewportRows(t2) {
        if (this.lines.length === 0) {
          t2 === void 0 && (t2 = X);
          let e = this._rows;
          for (; e--; ) this.lines.push(this.getBlankLine(t2));
        }
      }
      clear() {
        this.ydisp = 0, this.ybase = 0, this.y = 0, this.x = 0, this.lines = new zi(this._getCorrectBufferLength(this._rows)), this.scrollTop = 0, this.scrollBottom = this._rows - 1, this.setupTabStops();
      }
      resize(t2, e) {
        let i = this.getNullCell(X), r = 0, n = this._getCorrectBufferLength(e);
        if (n > this.lines.maxLength && (this.lines.maxLength = n), this.lines.length > 0) {
          if (this._cols < t2) for (let l = 0; l < this.lines.length; l++) r += +this.lines.get(l).resize(t2, i);
          let o = 0;
          if (this._rows < e) for (let l = this._rows; l < e; l++) this.lines.length < e + this.ybase && (this._optionsService.rawOptions.windowsMode || this._optionsService.rawOptions.windowsPty.backend !== void 0 || this._optionsService.rawOptions.windowsPty.buildNumber !== void 0 ? this.lines.push(new Ze(t2, i)) : this.ybase > 0 && this.lines.length <= this.ybase + this.y + o + 1 ? (this.ybase--, o++, this.ydisp > 0 && this.ydisp--) : this.lines.push(new Ze(t2, i)));
          else for (let l = this._rows; l > e; l--) this.lines.length > e + this.ybase && (this.lines.length > this.ybase + this.y + 1 ? this.lines.pop() : (this.ybase++, this.ydisp++));
          if (n < this.lines.maxLength) {
            let l = this.lines.length - n;
            l > 0 && (this.lines.trimStart(l), this.ybase = Math.max(this.ybase - l, 0), this.ydisp = Math.max(this.ydisp - l, 0), this.savedY = Math.max(this.savedY - l, 0)), this.lines.maxLength = n;
          }
          this.x = Math.min(this.x, t2 - 1), this.y = Math.min(this.y, e - 1), o && (this.y += o), this.savedX = Math.min(this.savedX, t2 - 1), this.scrollTop = 0;
        }
        if (this.scrollBottom = e - 1, this._isReflowEnabled && (this._reflow(t2, e), this._cols > t2)) for (let o = 0; o < this.lines.length; o++) r += +this.lines.get(o).resize(t2, i);
        this._cols = t2, this._rows = e, this._memoryCleanupQueue.clear(), r > 0.1 * this.lines.length && (this._memoryCleanupPosition = 0, this._memoryCleanupQueue.enqueue(() => this._batchedMemoryCleanup()));
      }
      _batchedMemoryCleanup() {
        let t2 = true;
        this._memoryCleanupPosition >= this.lines.length && (this._memoryCleanupPosition = 0, t2 = false);
        let e = 0;
        for (; this._memoryCleanupPosition < this.lines.length; ) if (e += this.lines.get(this._memoryCleanupPosition++).cleanupMemory(), e > 100) return true;
        return t2;
      }
      get _isReflowEnabled() {
        let t2 = this._optionsService.rawOptions.windowsPty;
        return t2 && t2.buildNumber ? this._hasScrollback && t2.backend === "conpty" && t2.buildNumber >= 21376 : this._hasScrollback && !this._optionsService.rawOptions.windowsMode;
      }
      _reflow(t2, e) {
        this._cols !== t2 && (t2 > this._cols ? this._reflowLarger(t2, e) : this._reflowSmaller(t2, e));
      }
      _reflowLarger(t2, e) {
        let i = this._optionsService.rawOptions.reflowCursorLine, r = sl(this.lines, this._cols, t2, this.ybase + this.y, this.getNullCell(X), i);
        if (r.length > 0) {
          let n = ol(this.lines, r);
          ll(this.lines, n.layout), this._reflowLargerAdjustViewport(t2, e, n.countRemoved);
        }
      }
      _reflowLargerAdjustViewport(t2, e, i) {
        let r = this.getNullCell(X), n = i;
        for (; n-- > 0; ) this.ybase === 0 ? (this.y > 0 && this.y--, this.lines.length < e && this.lines.push(new Ze(t2, r))) : (this.ydisp === this.ybase && this.ydisp--, this.ybase--);
        this.savedY = Math.max(this.savedY - i, 0);
      }
      _reflowSmaller(t2, e) {
        let i = this._optionsService.rawOptions.reflowCursorLine, r = this.getNullCell(X), n = [], o = 0;
        for (let l = this.lines.length - 1; l >= 0; l--) {
          let a = this.lines.get(l);
          if (!a || !a.isWrapped && a.getTrimmedLength() <= t2) continue;
          let u = [a];
          for (; a.isWrapped && l > 0; ) a = this.lines.get(--l), u.unshift(a);
          if (!i) {
            let I = this.ybase + this.y;
            if (I >= l && I < l + u.length) continue;
          }
          let h16 = u[u.length - 1].getTrimmedLength(), c = al(u, this._cols, t2), d = c.length - u.length, _;
          this.ybase === 0 && this.y !== this.lines.length - 1 ? _ = Math.max(0, this.y - this.lines.maxLength + d) : _ = Math.max(0, this.lines.length - this.lines.maxLength + d);
          let p = [];
          for (let I = 0; I < d; I++) {
            let k = this.getBlankLine(X, true);
            p.push(k);
          }
          p.length > 0 && (n.push({ start: l + u.length + o, newLines: p }), o += p.length), u.push(...p);
          let m = c.length - 1, f = c[m];
          f === 0 && (m--, f = c[m]);
          let A = u.length - d - 1, R = h16;
          for (; A >= 0; ) {
            let I = Math.min(R, f);
            if (u[m] === void 0) break;
            if (u[m].copyCellsFrom(u[A], R - I, f - I, I, true), f -= I, f === 0 && (m--, f = c[m]), R -= I, R === 0) {
              A--;
              let k = Math.max(A, 0);
              R = ri(u, k, this._cols);
            }
          }
          for (let I = 0; I < u.length; I++) c[I] < t2 && u[I].setCell(c[I], r);
          let O = d - _;
          for (; O-- > 0; ) this.ybase === 0 ? this.y < e - 1 ? (this.y++, this.lines.pop()) : (this.ybase++, this.ydisp++) : this.ybase < Math.min(this.lines.maxLength, this.lines.length + o) - e && (this.ybase === this.ydisp && this.ydisp++, this.ybase++);
          this.savedY = Math.min(this.savedY + d, this.ybase + e - 1);
        }
        if (n.length > 0) {
          let l = [], a = [];
          for (let f = 0; f < this.lines.length; f++) a.push(this.lines.get(f));
          let u = this.lines.length, h16 = u - 1, c = 0, d = n[c];
          this.lines.length = Math.min(this.lines.maxLength, this.lines.length + o);
          let _ = 0;
          for (let f = Math.min(this.lines.maxLength - 1, u + o - 1); f >= 0; f--) if (d && d.start > h16 + _) {
            for (let A = d.newLines.length - 1; A >= 0; A--) this.lines.set(f--, d.newLines[A]);
            f++, l.push({ index: h16 + 1, amount: d.newLines.length }), _ += d.newLines.length, d = n[++c];
          } else this.lines.set(f, a[h16--]);
          let p = 0;
          for (let f = l.length - 1; f >= 0; f--) l[f].index += p, this.lines.onInsertEmitter.fire(l[f]), p += l[f].amount;
          let m = Math.max(0, u + o - this.lines.maxLength);
          m > 0 && this.lines.onTrimEmitter.fire(m);
        }
      }
      translateBufferLineToString(t2, e, i = 0, r) {
        let n = this.lines.get(t2);
        return n ? n.translateToString(e, i, r) : "";
      }
      getWrappedRangeForLine(t2) {
        let e = t2, i = t2;
        for (; e > 0 && this.lines.get(e).isWrapped; ) e--;
        for (; i + 1 < this.lines.length && this.lines.get(i + 1).isWrapped; ) i++;
        return { first: e, last: i };
      }
      setupTabStops(t2) {
        for (t2 != null ? this.tabs[t2] || (t2 = this.prevStop(t2)) : (this.tabs = {}, t2 = 0); t2 < this._cols; t2 += this._optionsService.rawOptions.tabStopWidth) this.tabs[t2] = true;
      }
      prevStop(t2) {
        for (t2 == null && (t2 = this.x); !this.tabs[--t2] && t2 > 0; ) ;
        return t2 >= this._cols ? this._cols - 1 : t2 < 0 ? 0 : t2;
      }
      nextStop(t2) {
        for (t2 == null && (t2 = this.x); !this.tabs[++t2] && t2 < this._cols; ) ;
        return t2 >= this._cols ? this._cols - 1 : t2 < 0 ? 0 : t2;
      }
      clearMarkers(t2) {
        this._isClearing = true;
        for (let e = 0; e < this.markers.length; e++) this.markers[e].line === t2 && (this.markers[e].dispose(), this.markers.splice(e--, 1));
        this._isClearing = false;
      }
      clearAllMarkers() {
        this._isClearing = true;
        for (let t2 = 0; t2 < this.markers.length; t2++) this.markers[t2].dispose();
        this.markers.length = 0, this._isClearing = false;
      }
      addMarker(t2) {
        let e = new cn(t2);
        return this.markers.push(e), e.register(this.lines.onTrim((i) => {
          e.line -= i, e.line < 0 && e.dispose();
        })), e.register(this.lines.onInsert((i) => {
          e.line >= i.index && (e.line += i.amount);
        })), e.register(this.lines.onDelete((i) => {
          e.line >= i.index && e.line < i.index + i.amount && e.dispose(), e.line > i.index && (e.line -= i.amount);
        })), e.register(e.onDispose(() => this._removeMarker(e))), e;
      }
      _removeMarker(t2) {
        this._isClearing || this.markers.splice(this.markers.indexOf(t2), 1);
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
      let t2 = [Ms(s15, false) + 32, s15.col + 32, s15.row + 32];
      return t2[0] > 255 || t2[1] > 255 || t2[2] > 255 ? "" : `\x1B[M${Ps(t2[0])}${Ps(t2[1])}${Ps(t2[2])}`;
    }, SGR: (s15) => {
      let t2 = s15.action === 0 && s15.button !== 4 ? "m" : "M";
      return `\x1B[<${Ms(s15, true)};${s15.col};${s15.row}${t2}`;
    }, SGR_PIXELS: (s15) => {
      let t2 = s15.action === 0 && s15.button !== 4 ? "m" : "M";
      return `\x1B[<${Ms(s15, true)};${s15.x};${s15.y}${t2}`;
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
          for (let t2 = 0; t2 < Os.length; ++t2) se.fill(0, Os[t2][0], Os[t2][1] + 1);
        }
      }
      wcwidth(t2) {
        return t2 < 32 ? 0 : t2 < 127 ? 1 : t2 < 65536 ? se[t2] : cc(t2, ac) ? 0 : t2 >= 131072 && t2 <= 196605 || t2 >= 196608 && t2 <= 262141 ? 2 : 1;
      }
      charProperties(t2, e) {
        let i = this.wcwidth(t2), r = i === 0 && e !== 0;
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
        let t2 = new fn();
        this.register(t2), this._active = t2.version, this._activeProvider = t2;
      }
      static extractShouldJoin(t2) {
        return (t2 & 1) !== 0;
      }
      static extractWidth(t2) {
        return t2 >> 1 & 3;
      }
      static extractCharKind(t2) {
        return t2 >> 3;
      }
      static createPropertyValue(t2, e, i = false) {
        return (t2 & 16777215) << 3 | (e & 3) << 1 | (i ? 1 : 0);
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
      set activeVersion(t2) {
        if (!this._providers[t2]) throw new Error(`unknown Unicode version "${t2}"`);
        this._active = t2, this._activeProvider = this._providers[t2], this._onChange.fire(t2);
      }
      register(t2) {
        this._providers[t2.version] = t2;
      }
      wcwidth(t2) {
        return this._activeProvider.wcwidth(t2);
      }
      getStringCellWidth(t2) {
        let e = 0, i = 0, r = t2.length;
        for (let n = 0; n < r; ++n) {
          let o = t2.charCodeAt(n);
          if (55296 <= o && o <= 56319) {
            if (++n >= r) return e + this.wcwidth(o);
            let u = t2.charCodeAt(n);
            56320 <= u && u <= 57343 ? o = (o - 55296) * 1024 + u - 56320 + 65536 : e += this.wcwidth(u);
          }
          let l = this.charProperties(o, i), a = s13.extractWidth(l);
          s13.extractShouldJoin(l) && (a -= s13.extractWidth(i)), e += a, i = l;
        }
        return e;
      }
      charProperties(t2, e) {
        return this._activeProvider.charProperties(t2, e);
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
      setgLevel(t2) {
        this.glevel = t2, this.charset = this._charsets[t2];
      }
      setgCharset(t2, e) {
        this._charsets[t2] = e, this.glevel === t2 && (this.charset = e);
      }
    };
    Vi = 2147483647, uc = 256, ci = class s14 {
      constructor(t2 = 32, e = 32) {
        this.maxLength = t2;
        this.maxSubParamsLength = e;
        if (e > uc) throw new Error("maxSubParamsLength must not be greater than 256");
        this.params = new Int32Array(t2), this.length = 0, this._subParams = new Int32Array(e), this._subParamsLength = 0, this._subParamsIdx = new Uint16Array(t2), this._rejectDigits = false, this._rejectSubDigits = false, this._digitIsSub = false;
      }
      static fromArray(t2) {
        let e = new s14();
        if (!t2.length) return e;
        for (let i = Array.isArray(t2[0]) ? 1 : 0; i < t2.length; ++i) {
          let r = t2[i];
          if (Array.isArray(r)) for (let n = 0; n < r.length; ++n) e.addSubParam(r[n]);
          else e.addParam(r);
        }
        return e;
      }
      clone() {
        let t2 = new s14(this.maxLength, this.maxSubParamsLength);
        return t2.params.set(this.params), t2.length = this.length, t2._subParams.set(this._subParams), t2._subParamsLength = this._subParamsLength, t2._subParamsIdx.set(this._subParamsIdx), t2._rejectDigits = this._rejectDigits, t2._rejectSubDigits = this._rejectSubDigits, t2._digitIsSub = this._digitIsSub, t2;
      }
      toArray() {
        let t2 = [];
        for (let e = 0; e < this.length; ++e) {
          t2.push(this.params[e]);
          let i = this._subParamsIdx[e] >> 8, r = this._subParamsIdx[e] & 255;
          r - i > 0 && t2.push(Array.prototype.slice.call(this._subParams, i, r));
        }
        return t2;
      }
      reset() {
        this.length = 0, this._subParamsLength = 0, this._rejectDigits = false, this._rejectSubDigits = false, this._digitIsSub = false;
      }
      addParam(t2) {
        if (this._digitIsSub = false, this.length >= this.maxLength) {
          this._rejectDigits = true;
          return;
        }
        if (t2 < -1) throw new Error("values lesser than -1 are not allowed");
        this._subParamsIdx[this.length] = this._subParamsLength << 8 | this._subParamsLength, this.params[this.length++] = t2 > Vi ? Vi : t2;
      }
      addSubParam(t2) {
        if (this._digitIsSub = true, !!this.length) {
          if (this._rejectDigits || this._subParamsLength >= this.maxSubParamsLength) {
            this._rejectSubDigits = true;
            return;
          }
          if (t2 < -1) throw new Error("values lesser than -1 are not allowed");
          this._subParams[this._subParamsLength++] = t2 > Vi ? Vi : t2, this._subParamsIdx[this.length - 1]++;
        }
      }
      hasSubParams(t2) {
        return (this._subParamsIdx[t2] & 255) - (this._subParamsIdx[t2] >> 8) > 0;
      }
      getSubParams(t2) {
        let e = this._subParamsIdx[t2] >> 8, i = this._subParamsIdx[t2] & 255;
        return i - e > 0 ? this._subParams.subarray(e, i) : null;
      }
      getSubParamsAll() {
        let t2 = {};
        for (let e = 0; e < this.length; ++e) {
          let i = this._subParamsIdx[e] >> 8, r = this._subParamsIdx[e] & 255;
          r - i > 0 && (t2[e] = this._subParams.slice(i, r));
        }
        return t2;
      }
      addDigit(t2) {
        let e;
        if (this._rejectDigits || !(e = this._digitIsSub ? this._subParamsLength : this.length) || this._digitIsSub && this._rejectSubDigits) return;
        let i = this._digitIsSub ? this._subParams : this.params, r = i[e - 1];
        i[e - 1] = ~r ? Math.min(r * 10 + t2, Vi) : t2;
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
      registerHandler(t2, e) {
        this._handlers[t2] === void 0 && (this._handlers[t2] = []);
        let i = this._handlers[t2];
        return i.push(e), { dispose: () => {
          let r = i.indexOf(e);
          r !== -1 && i.splice(r, 1);
        } };
      }
      clearHandler(t2) {
        this._handlers[t2] && delete this._handlers[t2];
      }
      setHandlerFallback(t2) {
        this._handlerFb = t2;
      }
      dispose() {
        this._handlers = /* @__PURE__ */ Object.create(null), this._handlerFb = () => {
        }, this._active = qi;
      }
      reset() {
        if (this._state === 2) for (let t2 = this._stack.paused ? this._stack.loopPosition - 1 : this._active.length - 1; t2 >= 0; --t2) this._active[t2].end(false);
        this._stack.paused = false, this._active = qi, this._id = -1, this._state = 0;
      }
      _start() {
        if (this._active = this._handlers[this._id] || qi, !this._active.length) this._handlerFb(this._id, "START");
        else for (let t2 = this._active.length - 1; t2 >= 0; t2--) this._active[t2].start();
      }
      _put(t2, e, i) {
        if (!this._active.length) this._handlerFb(this._id, "PUT", It(t2, e, i));
        else for (let r = this._active.length - 1; r >= 0; r--) this._active[r].put(t2, e, i);
      }
      start() {
        this.reset(), this._state = 1;
      }
      put(t2, e, i) {
        if (this._state !== 3) {
          if (this._state === 1) for (; e < i; ) {
            let r = t2[e++];
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
          this._state === 2 && i - e > 0 && this._put(t2, e, i);
        }
      }
      end(t2, e = true) {
        if (this._state !== 0) {
          if (this._state !== 3) if (this._state === 1 && this._start(), !this._active.length) this._handlerFb(this._id, "END", t2);
          else {
            let i = false, r = this._active.length - 1, n = false;
            if (this._stack.paused && (r = this._stack.loopPosition - 1, i = e, n = this._stack.fallThrough, this._stack.paused = false), !n && i === false) {
              for (; r >= 0 && (i = this._active[r].end(t2), i !== true); r--) if (i instanceof Promise) return this._stack.paused = true, this._stack.loopPosition = r, this._stack.fallThrough = false, i;
              r--;
            }
            for (; r >= 0; r--) if (i = this._active[r].end(false), i instanceof Promise) return this._stack.paused = true, this._stack.loopPosition = r, this._stack.fallThrough = true, i;
          }
          this._active = qi, this._id = -1, this._state = 0;
        }
      }
    }, pe = class {
      constructor(t2) {
        this._handler = t2;
        this._data = "";
        this._hitLimit = false;
      }
      start() {
        this._data = "", this._hitLimit = false;
      }
      put(t2, e, i) {
        this._hitLimit || (this._data += It(t2, e, i), this._data.length > 1e7 && (this._data = "", this._hitLimit = true));
      }
      end(t2) {
        let e = false;
        if (this._hitLimit) e = false;
        else if (t2 && (e = this._handler(this._data), e instanceof Promise)) return e.then((i) => (this._data = "", this._hitLimit = false, i));
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
      registerHandler(t2, e) {
        this._handlers[t2] === void 0 && (this._handlers[t2] = []);
        let i = this._handlers[t2];
        return i.push(e), { dispose: () => {
          let r = i.indexOf(e);
          r !== -1 && i.splice(r, 1);
        } };
      }
      clearHandler(t2) {
        this._handlers[t2] && delete this._handlers[t2];
      }
      setHandlerFallback(t2) {
        this._handlerFb = t2;
      }
      reset() {
        if (this._active.length) for (let t2 = this._stack.paused ? this._stack.loopPosition - 1 : this._active.length - 1; t2 >= 0; --t2) this._active[t2].unhook(false);
        this._stack.paused = false, this._active = Yi, this._ident = 0;
      }
      hook(t2, e) {
        if (this.reset(), this._ident = t2, this._active = this._handlers[t2] || Yi, !this._active.length) this._handlerFb(this._ident, "HOOK", e);
        else for (let i = this._active.length - 1; i >= 0; i--) this._active[i].hook(e);
      }
      put(t2, e, i) {
        if (!this._active.length) this._handlerFb(this._ident, "PUT", It(t2, e, i));
        else for (let r = this._active.length - 1; r >= 0; r--) this._active[r].put(t2, e, i);
      }
      unhook(t2, e = true) {
        if (!this._active.length) this._handlerFb(this._ident, "UNHOOK", t2);
        else {
          let i = false, r = this._active.length - 1, n = false;
          if (this._stack.paused && (r = this._stack.loopPosition - 1, i = e, n = this._stack.fallThrough, this._stack.paused = false), !n && i === false) {
            for (; r >= 0 && (i = this._active[r].unhook(t2), i !== true); r--) if (i instanceof Promise) return this._stack.paused = true, this._stack.loopPosition = r, this._stack.fallThrough = false, i;
            r--;
          }
          for (; r >= 0; r--) if (i = this._active[r].unhook(false), i instanceof Promise) return this._stack.paused = true, this._stack.loopPosition = r, this._stack.fallThrough = true, i;
        }
        this._active = Yi, this._ident = 0;
      }
    }, ji = new ci();
    ji.addParam(0);
    Xi = class {
      constructor(t2) {
        this._handler = t2;
        this._data = "";
        this._params = ji;
        this._hitLimit = false;
      }
      hook(t2) {
        this._params = t2.length > 1 || t2.params[0] ? t2.clone() : ji, this._data = "", this._hitLimit = false;
      }
      put(t2, e, i) {
        this._hitLimit || (this._data += It(t2, e, i), this._data.length > 1e7 && (this._data = "", this._hitLimit = true));
      }
      unhook(t2) {
        let e = false;
        if (this._hitLimit) e = false;
        else if (t2 && (e = this._handler(this._data, this._params), e instanceof Promise)) return e.then((i) => (this._params = ji, this._data = "", this._hitLimit = false, i));
        return this._params = ji, this._data = "", this._hitLimit = false, e;
      }
    };
    Fs = class {
      constructor(t2) {
        this.table = new Uint8Array(t2);
      }
      setDefault(t2, e) {
        this.table.fill(t2 << 4 | e);
      }
      add(t2, e, i, r) {
        this.table[e << 8 | t2] = i << 4 | r;
      }
      addMany(t2, e, i, r) {
        for (let n = 0; n < t2.length; n++) this.table[e << 8 | t2[n]] = i << 4 | r;
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
          let u = this._parseStack.handlers, h16 = this._parseStack.handlerPos - 1;
          switch (this._parseStack.state) {
            case 3:
              if (r === false && h16 > -1) {
                for (; h16 >= 0 && (a = u[h16](this._params), a !== true); h16--) if (a instanceof Promise) return this._parseStack.handlerPos = h16, a;
              }
              this._parseStack.handlers = [];
              break;
            case 4:
              if (r === false && h16 > -1) {
                for (; h16 >= 0 && (a = u[h16](), a !== true); h16--) if (a instanceof Promise) return this._parseStack.handlerPos = h16, a;
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
      constructor(e, i, r, n, o, l, a, u, h16 = new bn()) {
        super();
        this._bufferService = e;
        this._charsetService = i;
        this._coreService = r;
        this._logService = n;
        this._optionsService = o;
        this._oscLinkService = l;
        this._coreMouseService = a;
        this._unicodeService = u;
        this._parser = h16;
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
        let u = this._dirtyRowTracker.end + (this._bufferService.buffer.ybase - this._bufferService.buffer.ydisp), h16 = this._dirtyRowTracker.start + (this._bufferService.buffer.ybase - this._bufferService.buffer.ydisp);
        h16 < this._bufferService.rows && this._onRequestRefreshRows.fire({ start: Math.min(h16, this._bufferService.rows - 1), end: Math.min(u, this._bufferService.rows - 1) });
      }
      print(e, i, r) {
        let n, o, l = this._charsetService.charset, a = this._optionsService.rawOptions.screenReaderMode, u = this._bufferService.cols, h16 = this._coreService.decPrivateModes.wraparound, c = this._coreService.modes.insertMode, d = this._curAttrData, _ = this._activeBuffer.lines.get(this._activeBuffer.ybase + this._activeBuffer.y);
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
            if (h16) {
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
        let r = e.params[0] || 1, n = Ae.extractWidth(i), o = this._activeBuffer.x - n, a = this._activeBuffer.lines.get(this._activeBuffer.ybase + this._activeBuffer.y).getString(o), u = new Uint32Array(a.length * r), h16 = 0;
        for (let d = 0; d < a.length; ) {
          let _ = a.codePointAt(d) || 0;
          u[h16++] = _, d += _ > 65535 ? 2 : 1;
        }
        let c = h16;
        for (let d = 1; d < r; ++d) u.copyWithin(c, 0, h16), c += h16;
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
        let n = this._coreService.decPrivateModes, { activeProtocol: o, activeEncoding: l } = this._coreMouseService, a = this._coreService, { buffers: u, cols: h16 } = this._bufferService, { active: c, alt: d } = u, _ = this._optionsService.rawOptions, p = (A, R) => (a.triggerDataEvent(`${b.ESC}[${i ? "" : "?"}${A};${R}$y`), true), m = (A) => A ? 1 : 2, f = e.params[0];
        return i ? f === 2 ? p(f, 4) : f === 4 ? p(f, m(a.modes.insertMode)) : f === 12 ? p(f, 3) : f === 20 ? p(f, m(_.convertEol)) : p(f, 0) : f === 1 ? p(f, m(n.applicationCursorKeys)) : f === 3 ? p(f, _.windowOptions.setWinLines ? h16 === 80 ? 2 : h16 === 132 ? 1 : 0 : 0) : f === 6 ? p(f, m(n.origin)) : f === 7 ? p(f, m(n.wraparound)) : f === 8 ? p(f, 3) : f === 9 ? p(f, m(o === "X10")) : f === 12 ? p(f, m(_.cursorBlink)) : f === 25 ? p(f, m(!a.isCursorHidden)) : f === 45 ? p(f, m(n.reverseWraparound)) : f === 66 ? p(f, m(n.applicationKeypad)) : f === 67 ? p(f, 4) : f === 1e3 ? p(f, m(o === "VT200")) : f === 1002 ? p(f, m(o === "DRAG")) : f === 1003 ? p(f, m(o === "ANY")) : f === 1004 ? p(f, m(n.sendFocus)) : f === 1005 ? p(f, 4) : f === 1006 ? p(f, m(l === "SGR")) : f === 1015 ? p(f, 4) : f === 1016 ? p(f, m(l === "SGR_PIXELS")) : f === 1048 ? p(f, 1) : f === 47 || f === 1047 || f === 1049 ? p(f, m(c === d)) : f === 2004 ? p(f, m(n.bracketedPasteMode)) : f === 2026 ? p(f, m(n.synchronizedOutput)) : p(f, 0);
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
      constructor(t2) {
        this._bufferService = t2;
        this.clearRange();
      }
      clearRange() {
        this.start = this._bufferService.buffer.y, this.end = this._bufferService.buffer.y;
      }
      markDirty(t2) {
        t2 < this.start ? this.start = t2 : t2 > this.end && (this.end = t2);
      }
      markRangeDirty(t2, e) {
        t2 > e && (gl = t2, t2 = e, e = gl), t2 < this.start && (this.start = t2), e > this.end && (this.end = e);
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
      constructor(t2) {
        this._bufferService = t2;
        this._nextId = 1;
        this._entriesWithId = /* @__PURE__ */ new Map();
        this._dataByLinkId = /* @__PURE__ */ new Map();
      }
      registerLink(t2) {
        let e = this._bufferService.buffer;
        if (t2.id === void 0) {
          let a = e.addMarker(e.ybase + e.y), u = { data: t2, id: this._nextId++, lines: [a] };
          return a.onDispose(() => this._removeMarkerFromLink(u, a)), this._dataByLinkId.set(u.id, u), u.id;
        }
        let i = t2, r = this._getEntryIdKey(i), n = this._entriesWithId.get(r);
        if (n) return this.addLineToLink(n.id, e.ybase + e.y), n.id;
        let o = e.addMarker(e.ybase + e.y), l = { id: this._nextId++, key: this._getEntryIdKey(i), data: i, lines: [o] };
        return o.onDispose(() => this._removeMarkerFromLink(l, o)), this._entriesWithId.set(l.key, l), this._dataByLinkId.set(l.id, l), l.id;
      }
      addLineToLink(t2, e) {
        let i = this._dataByLinkId.get(t2);
        if (i && i.lines.every((r) => r.line !== e)) {
          let r = this._bufferService.buffer.addMarker(e);
          i.lines.push(r), r.onDispose(() => this._removeMarkerFromLink(i, r));
        }
      }
      getLinkData(t2) {
        return this._dataByLinkId.get(t2)?.data;
      }
      _getEntryIdKey(t2) {
        return `${t2.id};;${t2.uri}`;
      }
      _removeMarkerFromLink(t2, e) {
        let i = t2.lines.indexOf(e);
        i !== -1 && (t2.lines.splice(i, 1), t2.lines.length === 0 && (t2.data.id !== void 0 && this._entriesWithId.delete(t2.key), this._dataByLinkId.delete(t2.id)));
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
      constructor(t2) {
        this._getKey = t2;
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
      insert(t2) {
        this._flushCleanupDeleted(), this._insertedValues.length === 0 && this._flushInsertedTask.enqueue(() => this._flushInserted()), this._insertedValues.push(t2);
      }
      _flushInserted() {
        let t2 = this._insertedValues.sort((n, o) => this._getKey(n) - this._getKey(o)), e = 0, i = 0, r = new Array(this._array.length + this._insertedValues.length);
        for (let n = 0; n < r.length; n++) i >= this._array.length || this._getKey(t2[e]) <= this._getKey(this._array[i]) ? (r[n] = t2[e], e++) : r[n] = this._array[i++];
        this._array = r, this._insertedValues.length = 0;
      }
      _flushCleanupInserted() {
        !this._isFlushingInserted && this._insertedValues.length > 0 && this._flushInsertedTask.flush();
      }
      delete(t2) {
        if (this._flushCleanupInserted(), this._array.length === 0) return false;
        let e = this._getKey(t2);
        if (e === void 0 || (ee = this._search(e), ee === -1) || this._getKey(this._array[ee]) !== e) return false;
        do
          if (this._array[ee] === t2) return this._deletedIndices.length === 0 && this._flushDeletedTask.enqueue(() => this._flushDeleted()), this._deletedIndices.push(ee), true;
        while (++ee < this._array.length && this._getKey(this._array[ee]) === e);
        return false;
      }
      _flushDeleted() {
        this._isFlushingDeleted = true;
        let t2 = this._deletedIndices.sort((n, o) => n - o), e = 0, i = new Array(this._array.length - t2.length), r = 0;
        for (let n = 0; n < this._array.length; n++) t2[e] === n ? e++ : i[r++] = this._array[n];
        this._array = i, this._deletedIndices.length = 0, this._isFlushingDeleted = false;
      }
      _flushCleanupDeleted() {
        !this._isFlushingDeleted && this._deletedIndices.length > 0 && this._flushDeletedTask.flush();
      }
      *getKeyIterator(t2) {
        if (this._flushCleanupInserted(), this._flushCleanupDeleted(), this._array.length !== 0 && (ee = this._search(t2), !(ee < 0 || ee >= this._array.length) && this._getKey(this._array[ee]) === t2)) do
          yield this._array[ee];
        while (++ee < this._array.length && this._getKey(this._array[ee]) === t2);
      }
      forEachByKey(t2, e) {
        if (this._flushCleanupInserted(), this._flushCleanupDeleted(), this._array.length !== 0 && (ee = this._search(t2), !(ee < 0 || ee >= this._array.length) && this._getKey(this._array[ee]) === t2)) do
          e(this._array[ee]);
        while (++ee < this._array.length && this._getKey(this._array[ee]) === t2);
      }
      values() {
        return this._flushCleanupInserted(), this._flushCleanupDeleted(), [...this._array].values();
      }
      _search(t2) {
        let e = 0, i = this._array.length - 1;
        for (; i >= e; ) {
          let r = e + i >> 1, n = this._getKey(this._array[r]);
          if (n > t2) i = r - 1;
          else if (n < t2) e = r + 1;
          else {
            for (; r > 0 && this._getKey(this._array[r - 1]) === t2; ) r--;
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
      constructor(t2, e = Sc) {
        this._renderCallback = t2;
        this._debounceThresholdMS = e;
        this._lastRefreshMs = 0;
        this._additionalRefreshRequested = false;
      }
      dispose() {
        this._refreshTimeoutID && clearTimeout(this._refreshTimeoutID);
      }
      refresh(t2, e, i) {
        this._rowCount = i, t2 = t2 !== void 0 ? t2 : 0, e = e !== void 0 ? e : this._rowCount - 1, this._rowStart = this._rowStart !== void 0 ? Math.min(this._rowStart, t2) : t2, this._rowEnd = this._rowEnd !== void 0 ? Math.max(this._rowEnd, e) : e;
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
        let t2 = Math.max(this._rowStart, 0), e = Math.min(this._rowEnd, this._rowCount - 1);
        this._rowStart = void 0, this._rowEnd = void 0, this._renderCallback(t2, e);
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
          let l = r.lines.get(r.ydisp + o), a = [], u = l?.translateToString(true, void 0, void 0, a) || "", h16 = (r.ydisp + o + 1).toString(), c = this._rowElements[o];
          c && (u.length === 0 ? (c.textContent = " ", this._rowColumns.set(c, [0, 1])) : (c.textContent = u, this._rowColumns.set(c, a)), c.setAttribute("aria-posinset", h16), c.setAttribute("aria-setsize", n), this._alignRowWidth(c));
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
          let h16 = this._createAccessibilityTreeNode();
          this._rowElements.unshift(h16), this._rowContainer.insertAdjacentElement("afterbegin", h16);
        } else {
          let h16 = this._createAccessibilityTreeNode();
          this._rowElements.push(h16), this._rowContainer.appendChild(h16);
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
        let o = ({ node: u, offset: h16 }) => {
          let c = u instanceof Text ? u.parentNode : u, d = parseInt(c?.getAttribute("aria-posinset"), 10) - 1;
          if (isNaN(d)) return console.warn("row is invalid. Race condition?"), null;
          let _ = this._rowColumns.get(c);
          if (!_) return console.warn("columns is null. Race condition?"), null;
          let p = h16 < _.length ? _[h16] : _.slice(-1)[0] + 1;
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
            let a = o[l], u = a.link.range.start.y < e ? 0 : a.link.range.start.x, h16 = a.link.range.end.y > e ? this._bufferService.cols : a.link.range.end.x;
            for (let c = u; c <= h16; c++) {
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
          let u, h16;
          switch (l.overrideType || l.type) {
            case "mousemove":
              h16 = 32, l.buttons === void 0 ? (u = 3, l.button !== void 0 && (u = l.button < 3 ? l.button : 3)) : u = l.buttons & 1 ? 0 : l.buttons & 4 ? 1 : l.buttons & 2 ? 2 : 3;
              break;
            case "mouseup":
              h16 = 0, u = l.button < 3 ? l.button : 3;
              break;
            case "mousedown":
              h16 = 1, u = l.button < 3 ? l.button : 3;
              break;
            case "wheel":
              if (e._customWheelEventHandler && e._customWheelEventHandler(l) === false) return false;
              let c = l.deltaY;
              if (c === 0 || e.coreMouseService.consumeWheelEvent(l, e._renderService?.dimensions?.device?.cell?.height, e._coreBrowserService?.dpr) === 0) return false;
              h16 = c < 0 ? 0 : 1, u = 4;
              break;
            default:
              return false;
          }
          return h16 === void 0 || u === void 0 || u > 4 ? false : e.coreMouseService.triggerMouseEvent({ col: a.col, row: a.row, x: a.x, y: a.y, button: u, action: h16, ctrl: l.ctrlKey, alt: l.altKey, shift: l.shiftKey });
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
              let h16 = b.ESC + (this.coreService.decPrivateModes.applicationCursorKeys ? "O" : "[") + (l.deltaY < 0 ? "A" : "B");
              return this.coreService.triggerDataEvent(h16, true), this.cancel(l, true);
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
        for (let t2 = this._addons.length - 1; t2 >= 0; t2--) this._addons[t2].instance.dispose();
      }
      loadAddon(t2, e) {
        let i = { instance: e, dispose: e.dispose, isDisposed: false };
        this._addons.push(i), e.dispose = () => this._wrappedAddonDispose(i), e.activate(t2);
      }
      _wrappedAddonDispose(t2) {
        if (t2.isDisposed) return;
        let e = -1;
        for (let i = 0; i < this._addons.length; i++) if (this._addons[i] === t2) {
          e = i;
          break;
        }
        if (e === -1) throw new Error("Could not dispose an addon that has not been loaded");
        t2.isDisposed = true, t2.dispose.apply(t2.instance), this._addons.splice(e, 1);
      }
    };
    wn = class {
      constructor(t2) {
        this._line = t2;
      }
      get isWrapped() {
        return this._line.isWrapped;
      }
      get length() {
        return this._line.length;
      }
      getCell(t2, e) {
        if (!(t2 < 0 || t2 >= this._line.length)) return e ? (this._line.loadCell(t2, e), e) : this._line.loadCell(t2, new q());
      }
      translateToString(t2, e, i) {
        return this._line.translateToString(t2, e, i);
      }
    };
    Ji = class {
      constructor(t2, e) {
        this._buffer = t2;
        this.type = e;
      }
      init(t2) {
        return this._buffer = t2, this;
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
      getLine(t2) {
        let e = this._buffer.lines.get(t2);
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
      constructor(t2) {
        this._core = t2;
      }
      registerCsiHandler(t2, e) {
        return this._core.registerCsiHandler(t2, (i) => e(i.toArray()));
      }
      addCsiHandler(t2, e) {
        return this.registerCsiHandler(t2, e);
      }
      registerDcsHandler(t2, e) {
        return this._core.registerDcsHandler(t2, (i, r) => e(i, r.toArray()));
      }
      addDcsHandler(t2, e) {
        return this.registerDcsHandler(t2, e);
      }
      registerEscHandler(t2, e) {
        return this._core.registerEscHandler(t2, e);
      }
      addEscHandler(t2, e) {
        return this.registerEscHandler(t2, e);
      }
      registerOscHandler(t2, e) {
        return this._core.registerOscHandler(t2, e);
      }
      addOscHandler(t2, e) {
        return this.registerOscHandler(t2, e);
      }
    };
    Ln = class {
      constructor(t2) {
        this._core = t2;
      }
      register(t2) {
        this._core.unicodeService.register(t2);
      }
      get versions() {
        return this._core.unicodeService.versions;
      }
      get activeVersion() {
        return this._core.unicodeService.activeVersion;
      }
      set activeVersion(t2) {
        this._core.unicodeService.activeVersion = t2;
      }
    };
    Ic = ["cols", "rows"], Ue = 0, Dl = class extends D {
      constructor(t2) {
        super(), this._core = this._register(new yn(t2)), this._addonManager = this._register(new xn()), this._publicOptions = { ...this._core.options };
        let e = (r) => this._core.options[r], i = (r, n) => {
          this._checkReadonlyOptions(r), this._core.options[r] = n;
        };
        for (let r in this._core.options) {
          let n = { get: e.bind(this, r), set: i.bind(this, r) };
          Object.defineProperty(this._publicOptions, r, n);
        }
      }
      _checkReadonlyOptions(t2) {
        if (Ic.includes(t2)) throw new Error(`Option "${t2}" can only be set in the constructor`);
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
        let t2 = this._core.coreService.decPrivateModes, e = "none";
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
        return { applicationCursorKeysMode: t2.applicationCursorKeys, applicationKeypadMode: t2.applicationKeypad, bracketedPasteMode: t2.bracketedPasteMode, insertMode: this._core.coreService.modes.insertMode, mouseTrackingMode: e, originMode: t2.origin, reverseWraparoundMode: t2.reverseWraparound, sendFocusMode: t2.sendFocus, synchronizedOutputMode: t2.synchronizedOutput, wraparoundMode: t2.wraparound };
      }
      get options() {
        return this._publicOptions;
      }
      set options(t2) {
        for (let e in t2) this._publicOptions[e] = t2[e];
      }
      blur() {
        this._core.blur();
      }
      focus() {
        this._core.focus();
      }
      input(t2, e = true) {
        this._core.input(t2, e);
      }
      resize(t2, e) {
        this._verifyIntegers(t2, e), this._core.resize(t2, e);
      }
      open(t2) {
        this._core.open(t2);
      }
      attachCustomKeyEventHandler(t2) {
        this._core.attachCustomKeyEventHandler(t2);
      }
      attachCustomWheelEventHandler(t2) {
        this._core.attachCustomWheelEventHandler(t2);
      }
      registerLinkProvider(t2) {
        return this._core.registerLinkProvider(t2);
      }
      registerCharacterJoiner(t2) {
        return this._checkProposedApi(), this._core.registerCharacterJoiner(t2);
      }
      deregisterCharacterJoiner(t2) {
        this._checkProposedApi(), this._core.deregisterCharacterJoiner(t2);
      }
      registerMarker(t2 = 0) {
        return this._verifyIntegers(t2), this._core.registerMarker(t2);
      }
      registerDecoration(t2) {
        return this._checkProposedApi(), this._verifyPositiveIntegers(t2.x ?? 0, t2.width ?? 0, t2.height ?? 0), this._core.registerDecoration(t2);
      }
      hasSelection() {
        return this._core.hasSelection();
      }
      select(t2, e, i) {
        this._verifyIntegers(t2, e, i), this._core.select(t2, e, i);
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
      selectLines(t2, e) {
        this._verifyIntegers(t2, e), this._core.selectLines(t2, e);
      }
      dispose() {
        super.dispose();
      }
      scrollLines(t2) {
        this._verifyIntegers(t2), this._core.scrollLines(t2);
      }
      scrollPages(t2) {
        this._verifyIntegers(t2), this._core.scrollPages(t2);
      }
      scrollToTop() {
        this._core.scrollToTop();
      }
      scrollToBottom() {
        this._core.scrollToBottom();
      }
      scrollToLine(t2) {
        this._verifyIntegers(t2), this._core.scrollToLine(t2);
      }
      clear() {
        this._core.clear();
      }
      write(t2, e) {
        this._core.write(t2, e);
      }
      writeln(t2, e) {
        this._core.write(t2), this._core.write(`\r
`, e);
      }
      paste(t2) {
        this._core.paste(t2);
      }
      refresh(t2, e) {
        this._verifyIntegers(t2, e), this._core.refresh(t2, e);
      }
      reset() {
        this._core.reset();
      }
      clearTextureAtlas() {
        this._core.clearTextureAtlas();
      }
      loadAddon(t2) {
        this._addonManager.loadAddon(this, t2);
      }
      static get strings() {
        return { get promptLabel() {
          return mi.get();
        }, set promptLabel(t2) {
          mi.set(t2);
        }, get tooMuchOutput() {
          return _i.get();
        }, set tooMuchOutput(t2) {
          _i.set(t2);
        } };
      }
      _verifyIntegers(...t2) {
        for (Ue of t2) if (Ue === 1 / 0 || isNaN(Ue) || Ue % 1 !== 0) throw new Error("This API only accepts integers");
      }
      _verifyPositiveIntegers(...t2) {
        for (Ue of t2) if (Ue && (Ue === 1 / 0 || isNaN(Ue) || Ue % 1 !== 0 || Ue < 0)) throw new Error("This API only accepts positive integers");
      }
    };
  }
});

// src/client/index.js
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  channels: () => channels,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);

// src/client/connect-link.js
var APP_PAGE = /\/api\/login\/app\/?$/;
var GRANT = /^[A-Za-z0-9_-]{24}$/;
var omniBase = (text) => {
  try {
    const url = new URL(text);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;
    return `${url.origin}${url.pathname.replace(/\/api\/v2\/?$/, "").replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
};
function parseConnectLink(text) {
  let link;
  try {
    link = new URL(String(text ?? "").trim());
  } catch {
    return null;
  }
  const grant = link.searchParams.get("grant") ?? "";
  if (!GRANT.test(grant)) return null;
  if (link.protocol === "omni:") {
    const url2 = link.hostname === "connect" || link.pathname.replace(/^\/+/, "") === "connect" ? omniBase(link.searchParams.get("url") ?? "") : null;
    return url2 ? { url: url2, grant } : null;
  }
  if (link.protocol !== "https:" && link.protocol !== "http:" || !APP_PAGE.test(link.pathname)) return null;
  const url = omniBase(`${link.origin}${link.pathname.replace(APP_PAGE, "")}`);
  return url ? { url, grant } : null;
}

// node_modules/qrcode-generator/dist/qrcode.mjs
var qrcode = function(typeNumber, errorCorrectionLevel) {
  const PAD0 = 236;
  const PAD1 = 17;
  let _typeNumber = typeNumber;
  const _errorCorrectionLevel = QRErrorCorrectionLevel[errorCorrectionLevel];
  let _modules = null;
  let _moduleCount = 0;
  let _dataCache = null;
  const _dataList = [];
  const _this = {};
  const makeImpl = function(test, maskPattern) {
    _moduleCount = _typeNumber * 4 + 17;
    _modules = (function(moduleCount) {
      const modules = new Array(moduleCount);
      for (let row = 0; row < moduleCount; row += 1) {
        modules[row] = new Array(moduleCount);
        for (let col = 0; col < moduleCount; col += 1) {
          modules[row][col] = null;
        }
      }
      return modules;
    })(_moduleCount);
    setupPositionProbePattern(0, 0);
    setupPositionProbePattern(_moduleCount - 7, 0);
    setupPositionProbePattern(0, _moduleCount - 7);
    setupPositionAdjustPattern();
    setupTimingPattern();
    setupTypeInfo(test, maskPattern);
    if (_typeNumber >= 7) {
      setupTypeNumber(test);
    }
    if (_dataCache == null) {
      _dataCache = createData(_typeNumber, _errorCorrectionLevel, _dataList);
    }
    mapData(_dataCache, maskPattern);
  };
  const setupPositionProbePattern = function(row, col) {
    for (let r = -1; r <= 7; r += 1) {
      if (row + r <= -1 || _moduleCount <= row + r) continue;
      for (let c = -1; c <= 7; c += 1) {
        if (col + c <= -1 || _moduleCount <= col + c) continue;
        if (0 <= r && r <= 6 && (c == 0 || c == 6) || 0 <= c && c <= 6 && (r == 0 || r == 6) || 2 <= r && r <= 4 && 2 <= c && c <= 4) {
          _modules[row + r][col + c] = true;
        } else {
          _modules[row + r][col + c] = false;
        }
      }
    }
  };
  const getBestMaskPattern = function() {
    let minLostPoint = 0;
    let pattern = 0;
    for (let i = 0; i < 8; i += 1) {
      makeImpl(true, i);
      const lostPoint = QRUtil.getLostPoint(_this);
      if (i == 0 || minLostPoint > lostPoint) {
        minLostPoint = lostPoint;
        pattern = i;
      }
    }
    return pattern;
  };
  const setupTimingPattern = function() {
    for (let r = 8; r < _moduleCount - 8; r += 1) {
      if (_modules[r][6] != null) {
        continue;
      }
      _modules[r][6] = r % 2 == 0;
    }
    for (let c = 8; c < _moduleCount - 8; c += 1) {
      if (_modules[6][c] != null) {
        continue;
      }
      _modules[6][c] = c % 2 == 0;
    }
  };
  const setupPositionAdjustPattern = function() {
    const pos = QRUtil.getPatternPosition(_typeNumber);
    for (let i = 0; i < pos.length; i += 1) {
      for (let j2 = 0; j2 < pos.length; j2 += 1) {
        const row = pos[i];
        const col = pos[j2];
        if (_modules[row][col] != null) {
          continue;
        }
        for (let r = -2; r <= 2; r += 1) {
          for (let c = -2; c <= 2; c += 1) {
            if (r == -2 || r == 2 || c == -2 || c == 2 || r == 0 && c == 0) {
              _modules[row + r][col + c] = true;
            } else {
              _modules[row + r][col + c] = false;
            }
          }
        }
      }
    }
  };
  const setupTypeNumber = function(test) {
    const bits = QRUtil.getBCHTypeNumber(_typeNumber);
    for (let i = 0; i < 18; i += 1) {
      const mod = !test && (bits >> i & 1) == 1;
      _modules[Math.floor(i / 3)][i % 3 + _moduleCount - 8 - 3] = mod;
    }
    for (let i = 0; i < 18; i += 1) {
      const mod = !test && (bits >> i & 1) == 1;
      _modules[i % 3 + _moduleCount - 8 - 3][Math.floor(i / 3)] = mod;
    }
  };
  const setupTypeInfo = function(test, maskPattern) {
    const data = _errorCorrectionLevel << 3 | maskPattern;
    const bits = QRUtil.getBCHTypeInfo(data);
    for (let i = 0; i < 15; i += 1) {
      const mod = !test && (bits >> i & 1) == 1;
      if (i < 6) {
        _modules[i][8] = mod;
      } else if (i < 8) {
        _modules[i + 1][8] = mod;
      } else {
        _modules[_moduleCount - 15 + i][8] = mod;
      }
    }
    for (let i = 0; i < 15; i += 1) {
      const mod = !test && (bits >> i & 1) == 1;
      if (i < 8) {
        _modules[8][_moduleCount - i - 1] = mod;
      } else if (i < 9) {
        _modules[8][15 - i - 1 + 1] = mod;
      } else {
        _modules[8][15 - i - 1] = mod;
      }
    }
    _modules[_moduleCount - 8][8] = !test;
  };
  const mapData = function(data, maskPattern) {
    let inc = -1;
    let row = _moduleCount - 1;
    let bitIndex = 7;
    let byteIndex = 0;
    const maskFunc = QRUtil.getMaskFunction(maskPattern);
    for (let col = _moduleCount - 1; col > 0; col -= 2) {
      if (col == 6) col -= 1;
      while (true) {
        for (let c = 0; c < 2; c += 1) {
          if (_modules[row][col - c] == null) {
            let dark = false;
            if (byteIndex < data.length) {
              dark = (data[byteIndex] >>> bitIndex & 1) == 1;
            }
            const mask = maskFunc(row, col - c);
            if (mask) {
              dark = !dark;
            }
            _modules[row][col - c] = dark;
            bitIndex -= 1;
            if (bitIndex == -1) {
              byteIndex += 1;
              bitIndex = 7;
            }
          }
        }
        row += inc;
        if (row < 0 || _moduleCount <= row) {
          row -= inc;
          inc = -inc;
          break;
        }
      }
    }
  };
  const createBytes = function(buffer, rsBlocks) {
    let offset = 0;
    let maxDcCount = 0;
    let maxEcCount = 0;
    const dcdata = new Array(rsBlocks.length);
    const ecdata = new Array(rsBlocks.length);
    for (let r = 0; r < rsBlocks.length; r += 1) {
      const dcCount = rsBlocks[r].dataCount;
      const ecCount = rsBlocks[r].totalCount - dcCount;
      maxDcCount = Math.max(maxDcCount, dcCount);
      maxEcCount = Math.max(maxEcCount, ecCount);
      dcdata[r] = new Array(dcCount);
      for (let i = 0; i < dcdata[r].length; i += 1) {
        dcdata[r][i] = 255 & buffer.getBuffer()[i + offset];
      }
      offset += dcCount;
      const rsPoly = QRUtil.getErrorCorrectPolynomial(ecCount);
      const rawPoly = qrPolynomial(dcdata[r], rsPoly.getLength() - 1);
      const modPoly = rawPoly.mod(rsPoly);
      ecdata[r] = new Array(rsPoly.getLength() - 1);
      for (let i = 0; i < ecdata[r].length; i += 1) {
        const modIndex = i + modPoly.getLength() - ecdata[r].length;
        ecdata[r][i] = modIndex >= 0 ? modPoly.getAt(modIndex) : 0;
      }
    }
    let totalCodeCount = 0;
    for (let i = 0; i < rsBlocks.length; i += 1) {
      totalCodeCount += rsBlocks[i].totalCount;
    }
    const data = new Array(totalCodeCount);
    let index = 0;
    for (let i = 0; i < maxDcCount; i += 1) {
      for (let r = 0; r < rsBlocks.length; r += 1) {
        if (i < dcdata[r].length) {
          data[index] = dcdata[r][i];
          index += 1;
        }
      }
    }
    for (let i = 0; i < maxEcCount; i += 1) {
      for (let r = 0; r < rsBlocks.length; r += 1) {
        if (i < ecdata[r].length) {
          data[index] = ecdata[r][i];
          index += 1;
        }
      }
    }
    return data;
  };
  const createData = function(typeNumber2, errorCorrectionLevel2, dataList) {
    const rsBlocks = QRRSBlock.getRSBlocks(typeNumber2, errorCorrectionLevel2);
    const buffer = qrBitBuffer();
    for (let i = 0; i < dataList.length; i += 1) {
      const data = dataList[i];
      buffer.put(data.getMode(), 4);
      buffer.put(data.getLength(), QRUtil.getLengthInBits(data.getMode(), typeNumber2));
      data.write(buffer);
    }
    let totalDataCount = 0;
    for (let i = 0; i < rsBlocks.length; i += 1) {
      totalDataCount += rsBlocks[i].dataCount;
    }
    if (buffer.getLengthInBits() > totalDataCount * 8) {
      throw "code length overflow. (" + buffer.getLengthInBits() + ">" + totalDataCount * 8 + ")";
    }
    if (buffer.getLengthInBits() + 4 <= totalDataCount * 8) {
      buffer.put(0, 4);
    }
    while (buffer.getLengthInBits() % 8 != 0) {
      buffer.putBit(false);
    }
    while (true) {
      if (buffer.getLengthInBits() >= totalDataCount * 8) {
        break;
      }
      buffer.put(PAD0, 8);
      if (buffer.getLengthInBits() >= totalDataCount * 8) {
        break;
      }
      buffer.put(PAD1, 8);
    }
    return createBytes(buffer, rsBlocks);
  };
  _this.addData = function(data, mode) {
    mode = mode || "Byte";
    let newData = null;
    switch (mode) {
      case "Numeric":
        newData = qrNumber(data);
        break;
      case "Alphanumeric":
        newData = qrAlphaNum(data);
        break;
      case "Byte":
        newData = qr8BitByte(data);
        break;
      case "Kanji":
        newData = qrKanji(data);
        break;
      default:
        throw "mode:" + mode;
    }
    _dataList.push(newData);
    _dataCache = null;
  };
  _this.isDark = function(row, col) {
    if (row < 0 || _moduleCount <= row || col < 0 || _moduleCount <= col) {
      throw row + "," + col;
    }
    return _modules[row][col];
  };
  _this.getModuleCount = function() {
    return _moduleCount;
  };
  _this.make = function() {
    if (_typeNumber < 1) {
      let typeNumber2 = 1;
      for (; typeNumber2 < 40; typeNumber2++) {
        const rsBlocks = QRRSBlock.getRSBlocks(typeNumber2, _errorCorrectionLevel);
        const buffer = qrBitBuffer();
        for (let i = 0; i < _dataList.length; i++) {
          const data = _dataList[i];
          buffer.put(data.getMode(), 4);
          buffer.put(data.getLength(), QRUtil.getLengthInBits(data.getMode(), typeNumber2));
          data.write(buffer);
        }
        let totalDataCount = 0;
        for (let i = 0; i < rsBlocks.length; i++) {
          totalDataCount += rsBlocks[i].dataCount;
        }
        if (buffer.getLengthInBits() <= totalDataCount * 8) {
          break;
        }
      }
      _typeNumber = typeNumber2;
    }
    makeImpl(false, getBestMaskPattern());
  };
  _this.createTableTag = function(cellSize, margin) {
    cellSize = cellSize || 2;
    margin = typeof margin == "undefined" ? cellSize * 4 : margin;
    let qrHtml = "";
    qrHtml += '<table style="';
    qrHtml += " border-width: 0px; border-style: none;";
    qrHtml += " border-collapse: collapse;";
    qrHtml += " padding: 0px; margin: " + margin + "px;";
    qrHtml += '">';
    qrHtml += "<tbody>";
    for (let r = 0; r < _this.getModuleCount(); r += 1) {
      qrHtml += "<tr>";
      for (let c = 0; c < _this.getModuleCount(); c += 1) {
        qrHtml += '<td style="';
        qrHtml += " border-width: 0px; border-style: none;";
        qrHtml += " border-collapse: collapse;";
        qrHtml += " padding: 0px; margin: 0px;";
        qrHtml += " width: " + cellSize + "px;";
        qrHtml += " height: " + cellSize + "px;";
        qrHtml += " background-color: ";
        qrHtml += _this.isDark(r, c) ? "#000000" : "#ffffff";
        qrHtml += ";";
        qrHtml += '"/>';
      }
      qrHtml += "</tr>";
    }
    qrHtml += "</tbody>";
    qrHtml += "</table>";
    return qrHtml;
  };
  _this.createSvgTag = function(cellSize, margin, alt, title) {
    let opts = {};
    if (typeof arguments[0] == "object") {
      opts = arguments[0];
      cellSize = opts.cellSize;
      margin = opts.margin;
      alt = opts.alt;
      title = opts.title;
    }
    cellSize = cellSize || 2;
    margin = typeof margin == "undefined" ? cellSize * 4 : margin;
    alt = typeof alt === "string" ? { text: alt } : alt || {};
    alt.text = alt.text || null;
    alt.id = alt.text ? alt.id || "qrcode-description" : null;
    title = typeof title === "string" ? { text: title } : title || {};
    title.text = title.text || null;
    title.id = title.text ? title.id || "qrcode-title" : null;
    const size = _this.getModuleCount() * cellSize + margin * 2;
    let c, mc2, r, mr2, qrSvg = "", rect;
    rect = "l" + cellSize + ",0 0," + cellSize + " -" + cellSize + ",0 0,-" + cellSize + "z ";
    qrSvg += '<svg version="1.1" xmlns="http://www.w3.org/2000/svg"';
    qrSvg += !opts.scalable ? ' width="' + size + 'px" height="' + size + 'px"' : "";
    qrSvg += ' viewBox="0 0 ' + size + " " + size + '" ';
    qrSvg += ' preserveAspectRatio="xMinYMin meet"';
    qrSvg += title.text || alt.text ? ' role="img" aria-labelledby="' + escapeXml([title.id, alt.id].join(" ").trim()) + '"' : "";
    qrSvg += ">";
    qrSvg += title.text ? '<title id="' + escapeXml(title.id) + '">' + escapeXml(title.text) + "</title>" : "";
    qrSvg += alt.text ? '<description id="' + escapeXml(alt.id) + '">' + escapeXml(alt.text) + "</description>" : "";
    qrSvg += '<rect width="100%" height="100%" fill="white" cx="0" cy="0"/>';
    qrSvg += '<path d="';
    for (r = 0; r < _this.getModuleCount(); r += 1) {
      mr2 = r * cellSize + margin;
      for (c = 0; c < _this.getModuleCount(); c += 1) {
        if (_this.isDark(r, c)) {
          mc2 = c * cellSize + margin;
          qrSvg += "M" + mc2 + "," + mr2 + rect;
        }
      }
    }
    qrSvg += '" stroke="transparent" fill="black"/>';
    qrSvg += "</svg>";
    return qrSvg;
  };
  _this.createDataURL = function(cellSize, margin) {
    cellSize = cellSize || 2;
    margin = typeof margin == "undefined" ? cellSize * 4 : margin;
    const size = _this.getModuleCount() * cellSize + margin * 2;
    const min = margin;
    const max = size - margin;
    return createDataURL(size, size, function(x, y) {
      if (min <= x && x < max && min <= y && y < max) {
        const c = Math.floor((x - min) / cellSize);
        const r = Math.floor((y - min) / cellSize);
        return _this.isDark(r, c) ? 0 : 1;
      } else {
        return 1;
      }
    });
  };
  _this.createImgTag = function(cellSize, margin, alt) {
    cellSize = cellSize || 2;
    margin = typeof margin == "undefined" ? cellSize * 4 : margin;
    const size = _this.getModuleCount() * cellSize + margin * 2;
    let img = "";
    img += "<img";
    img += ' src="';
    img += _this.createDataURL(cellSize, margin);
    img += '"';
    img += ' width="';
    img += size;
    img += '"';
    img += ' height="';
    img += size;
    img += '"';
    if (alt) {
      img += ' alt="';
      img += escapeXml(alt);
      img += '"';
    }
    img += "/>";
    return img;
  };
  const escapeXml = function(s15) {
    let escaped = "";
    for (let i = 0; i < s15.length; i += 1) {
      const c = s15.charAt(i);
      switch (c) {
        case "<":
          escaped += "&lt;";
          break;
        case ">":
          escaped += "&gt;";
          break;
        case "&":
          escaped += "&amp;";
          break;
        case '"':
          escaped += "&quot;";
          break;
        default:
          escaped += c;
          break;
      }
    }
    return escaped;
  };
  const _createHalfASCII = function(margin) {
    const cellSize = 1;
    margin = typeof margin == "undefined" ? cellSize * 2 : margin;
    const size = _this.getModuleCount() * cellSize + margin * 2;
    const min = margin;
    const max = size - margin;
    let y, x, r1, r2, p;
    const blocks = {
      "██": "█",
      "█ ": "▀",
      " █": "▄",
      "  ": " "
    };
    const blocksLastLineNoMargin = {
      "██": "▀",
      "█ ": "▀",
      " █": " ",
      "  ": " "
    };
    let ascii = "";
    for (y = 0; y < size; y += 2) {
      r1 = Math.floor((y - min) / cellSize);
      r2 = Math.floor((y + 1 - min) / cellSize);
      for (x = 0; x < size; x += 1) {
        p = "█";
        if (min <= x && x < max && min <= y && y < max && _this.isDark(r1, Math.floor((x - min) / cellSize))) {
          p = " ";
        }
        if (min <= x && x < max && min <= y + 1 && y + 1 < max && _this.isDark(r2, Math.floor((x - min) / cellSize))) {
          p += " ";
        } else {
          p += "█";
        }
        ascii += margin < 1 && y + 1 >= max ? blocksLastLineNoMargin[p] : blocks[p];
      }
      ascii += "\n";
    }
    if (size % 2 && margin > 0) {
      return ascii.substring(0, ascii.length - size - 1) + Array(size + 1).join("▀");
    }
    return ascii.substring(0, ascii.length - 1);
  };
  _this.createASCII = function(cellSize, margin) {
    cellSize = cellSize || 1;
    if (cellSize < 2) {
      return _createHalfASCII(margin);
    }
    cellSize -= 1;
    margin = typeof margin == "undefined" ? cellSize * 2 : margin;
    const size = _this.getModuleCount() * cellSize + margin * 2;
    const min = margin;
    const max = size - margin;
    let y, x, r, p;
    const white = Array(cellSize + 1).join("██");
    const black = Array(cellSize + 1).join("  ");
    let ascii = "";
    let line = "";
    for (y = 0; y < size; y += 1) {
      r = Math.floor((y - min) / cellSize);
      line = "";
      for (x = 0; x < size; x += 1) {
        p = 1;
        if (min <= x && x < max && min <= y && y < max && _this.isDark(r, Math.floor((x - min) / cellSize))) {
          p = 0;
        }
        line += p ? white : black;
      }
      for (r = 0; r < cellSize; r += 1) {
        ascii += line + "\n";
      }
    }
    return ascii.substring(0, ascii.length - 1);
  };
  _this.renderTo2dContext = function(context, cellSize) {
    cellSize = cellSize || 2;
    const length = _this.getModuleCount();
    for (let row = 0; row < length; row++) {
      for (let col = 0; col < length; col++) {
        context.fillStyle = _this.isDark(row, col) ? "black" : "white";
        context.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);
      }
    }
  };
  return _this;
};
qrcode.stringToBytes = function(s15) {
  const bytes = [];
  for (let i = 0; i < s15.length; i += 1) {
    const c = s15.charCodeAt(i);
    bytes.push(c & 255);
  }
  return bytes;
};
qrcode.createStringToBytes = function(unicodeData, numChars) {
  const unicodeMap = (function() {
    const bin = base64DecodeInputStream(unicodeData);
    const read = function() {
      const b2 = bin.read();
      if (b2 == -1) throw "eof";
      return b2;
    };
    let count = 0;
    const unicodeMap2 = {};
    while (true) {
      const b0 = bin.read();
      if (b0 == -1) break;
      const b1 = read();
      const b2 = read();
      const b3 = read();
      const k = String.fromCharCode(b0 << 8 | b1);
      const v2 = b2 << 8 | b3;
      unicodeMap2[k] = v2;
      count += 1;
    }
    if (count != numChars) {
      throw count + " != " + numChars;
    }
    return unicodeMap2;
  })();
  const unknownChar = "?".charCodeAt(0);
  return function(s15) {
    const bytes = [];
    for (let i = 0; i < s15.length; i += 1) {
      const c = s15.charCodeAt(i);
      if (c < 128) {
        bytes.push(c);
      } else {
        const b2 = unicodeMap[s15.charAt(i)];
        if (typeof b2 == "number") {
          if ((b2 & 255) == b2) {
            bytes.push(b2);
          } else {
            bytes.push(b2 >>> 8);
            bytes.push(b2 & 255);
          }
        } else {
          bytes.push(unknownChar);
        }
      }
    }
    return bytes;
  };
};
var QRMode = {
  MODE_NUMBER: 1 << 0,
  MODE_ALPHA_NUM: 1 << 1,
  MODE_8BIT_BYTE: 1 << 2,
  MODE_KANJI: 1 << 3
};
var QRErrorCorrectionLevel = {
  L: 1,
  M: 0,
  Q: 3,
  H: 2
};
var QRMaskPattern = {
  PATTERN000: 0,
  PATTERN001: 1,
  PATTERN010: 2,
  PATTERN011: 3,
  PATTERN100: 4,
  PATTERN101: 5,
  PATTERN110: 6,
  PATTERN111: 7
};
var QRUtil = (function() {
  const PATTERN_POSITION_TABLE = [
    [],
    [6, 18],
    [6, 22],
    [6, 26],
    [6, 30],
    [6, 34],
    [6, 22, 38],
    [6, 24, 42],
    [6, 26, 46],
    [6, 28, 50],
    [6, 30, 54],
    [6, 32, 58],
    [6, 34, 62],
    [6, 26, 46, 66],
    [6, 26, 48, 70],
    [6, 26, 50, 74],
    [6, 30, 54, 78],
    [6, 30, 56, 82],
    [6, 30, 58, 86],
    [6, 34, 62, 90],
    [6, 28, 50, 72, 94],
    [6, 26, 50, 74, 98],
    [6, 30, 54, 78, 102],
    [6, 28, 54, 80, 106],
    [6, 32, 58, 84, 110],
    [6, 30, 58, 86, 114],
    [6, 34, 62, 90, 118],
    [6, 26, 50, 74, 98, 122],
    [6, 30, 54, 78, 102, 126],
    [6, 26, 52, 78, 104, 130],
    [6, 30, 56, 82, 108, 134],
    [6, 34, 60, 86, 112, 138],
    [6, 30, 58, 86, 114, 142],
    [6, 34, 62, 90, 118, 146],
    [6, 30, 54, 78, 102, 126, 150],
    [6, 24, 50, 76, 102, 128, 154],
    [6, 28, 54, 80, 106, 132, 158],
    [6, 32, 58, 84, 110, 136, 162],
    [6, 26, 54, 82, 110, 138, 166],
    [6, 30, 58, 86, 114, 142, 170]
  ];
  const G15 = 1 << 10 | 1 << 8 | 1 << 5 | 1 << 4 | 1 << 2 | 1 << 1 | 1 << 0;
  const G18 = 1 << 12 | 1 << 11 | 1 << 10 | 1 << 9 | 1 << 8 | 1 << 5 | 1 << 2 | 1 << 0;
  const G15_MASK = 1 << 14 | 1 << 12 | 1 << 10 | 1 << 4 | 1 << 1;
  const _this = {};
  const getBCHDigit = function(data) {
    let digit = 0;
    while (data != 0) {
      digit += 1;
      data >>>= 1;
    }
    return digit;
  };
  _this.getBCHTypeInfo = function(data) {
    let d = data << 10;
    while (getBCHDigit(d) - getBCHDigit(G15) >= 0) {
      d ^= G15 << getBCHDigit(d) - getBCHDigit(G15);
    }
    return (data << 10 | d) ^ G15_MASK;
  };
  _this.getBCHTypeNumber = function(data) {
    let d = data << 12;
    while (getBCHDigit(d) - getBCHDigit(G18) >= 0) {
      d ^= G18 << getBCHDigit(d) - getBCHDigit(G18);
    }
    return data << 12 | d;
  };
  _this.getPatternPosition = function(typeNumber) {
    return PATTERN_POSITION_TABLE[typeNumber - 1];
  };
  _this.getMaskFunction = function(maskPattern) {
    switch (maskPattern) {
      case QRMaskPattern.PATTERN000:
        return function(i, j2) {
          return (i + j2) % 2 == 0;
        };
      case QRMaskPattern.PATTERN001:
        return function(i, j2) {
          return i % 2 == 0;
        };
      case QRMaskPattern.PATTERN010:
        return function(i, j2) {
          return j2 % 3 == 0;
        };
      case QRMaskPattern.PATTERN011:
        return function(i, j2) {
          return (i + j2) % 3 == 0;
        };
      case QRMaskPattern.PATTERN100:
        return function(i, j2) {
          return (Math.floor(i / 2) + Math.floor(j2 / 3)) % 2 == 0;
        };
      case QRMaskPattern.PATTERN101:
        return function(i, j2) {
          return i * j2 % 2 + i * j2 % 3 == 0;
        };
      case QRMaskPattern.PATTERN110:
        return function(i, j2) {
          return (i * j2 % 2 + i * j2 % 3) % 2 == 0;
        };
      case QRMaskPattern.PATTERN111:
        return function(i, j2) {
          return (i * j2 % 3 + (i + j2) % 2) % 2 == 0;
        };
      default:
        throw "bad maskPattern:" + maskPattern;
    }
  };
  _this.getErrorCorrectPolynomial = function(errorCorrectLength) {
    let a = qrPolynomial([1], 0);
    for (let i = 0; i < errorCorrectLength; i += 1) {
      a = a.multiply(qrPolynomial([1, QRMath.gexp(i)], 0));
    }
    return a;
  };
  _this.getLengthInBits = function(mode, type) {
    if (1 <= type && type < 10) {
      switch (mode) {
        case QRMode.MODE_NUMBER:
          return 10;
        case QRMode.MODE_ALPHA_NUM:
          return 9;
        case QRMode.MODE_8BIT_BYTE:
          return 8;
        case QRMode.MODE_KANJI:
          return 8;
        default:
          throw "mode:" + mode;
      }
    } else if (type < 27) {
      switch (mode) {
        case QRMode.MODE_NUMBER:
          return 12;
        case QRMode.MODE_ALPHA_NUM:
          return 11;
        case QRMode.MODE_8BIT_BYTE:
          return 16;
        case QRMode.MODE_KANJI:
          return 10;
        default:
          throw "mode:" + mode;
      }
    } else if (type < 41) {
      switch (mode) {
        case QRMode.MODE_NUMBER:
          return 14;
        case QRMode.MODE_ALPHA_NUM:
          return 13;
        case QRMode.MODE_8BIT_BYTE:
          return 16;
        case QRMode.MODE_KANJI:
          return 12;
        default:
          throw "mode:" + mode;
      }
    } else {
      throw "type:" + type;
    }
  };
  _this.getLostPoint = function(qrcode2) {
    const moduleCount = qrcode2.getModuleCount();
    let lostPoint = 0;
    for (let row = 0; row < moduleCount; row += 1) {
      for (let col = 0; col < moduleCount; col += 1) {
        let sameCount = 0;
        const dark = qrcode2.isDark(row, col);
        for (let r = -1; r <= 1; r += 1) {
          if (row + r < 0 || moduleCount <= row + r) {
            continue;
          }
          for (let c = -1; c <= 1; c += 1) {
            if (col + c < 0 || moduleCount <= col + c) {
              continue;
            }
            if (r == 0 && c == 0) {
              continue;
            }
            if (dark == qrcode2.isDark(row + r, col + c)) {
              sameCount += 1;
            }
          }
        }
        if (sameCount > 5) {
          lostPoint += 3 + sameCount - 5;
        }
      }
    }
    ;
    for (let row = 0; row < moduleCount - 1; row += 1) {
      for (let col = 0; col < moduleCount - 1; col += 1) {
        let count = 0;
        if (qrcode2.isDark(row, col)) count += 1;
        if (qrcode2.isDark(row + 1, col)) count += 1;
        if (qrcode2.isDark(row, col + 1)) count += 1;
        if (qrcode2.isDark(row + 1, col + 1)) count += 1;
        if (count == 0 || count == 4) {
          lostPoint += 3;
        }
      }
    }
    for (let row = 0; row < moduleCount; row += 1) {
      for (let col = 0; col < moduleCount - 6; col += 1) {
        if (qrcode2.isDark(row, col) && !qrcode2.isDark(row, col + 1) && qrcode2.isDark(row, col + 2) && qrcode2.isDark(row, col + 3) && qrcode2.isDark(row, col + 4) && !qrcode2.isDark(row, col + 5) && qrcode2.isDark(row, col + 6)) {
          lostPoint += 40;
        }
      }
    }
    for (let col = 0; col < moduleCount; col += 1) {
      for (let row = 0; row < moduleCount - 6; row += 1) {
        if (qrcode2.isDark(row, col) && !qrcode2.isDark(row + 1, col) && qrcode2.isDark(row + 2, col) && qrcode2.isDark(row + 3, col) && qrcode2.isDark(row + 4, col) && !qrcode2.isDark(row + 5, col) && qrcode2.isDark(row + 6, col)) {
          lostPoint += 40;
        }
      }
    }
    let darkCount = 0;
    for (let col = 0; col < moduleCount; col += 1) {
      for (let row = 0; row < moduleCount; row += 1) {
        if (qrcode2.isDark(row, col)) {
          darkCount += 1;
        }
      }
    }
    const ratio = Math.abs(100 * darkCount / moduleCount / moduleCount - 50) / 5;
    lostPoint += ratio * 10;
    return lostPoint;
  };
  return _this;
})();
var QRMath = (function() {
  const EXP_TABLE = new Array(256);
  const LOG_TABLE = new Array(256);
  for (let i = 0; i < 8; i += 1) {
    EXP_TABLE[i] = 1 << i;
  }
  for (let i = 8; i < 256; i += 1) {
    EXP_TABLE[i] = EXP_TABLE[i - 4] ^ EXP_TABLE[i - 5] ^ EXP_TABLE[i - 6] ^ EXP_TABLE[i - 8];
  }
  for (let i = 0; i < 255; i += 1) {
    LOG_TABLE[EXP_TABLE[i]] = i;
  }
  const _this = {};
  _this.glog = function(n) {
    if (n < 1) {
      throw "glog(" + n + ")";
    }
    return LOG_TABLE[n];
  };
  _this.gexp = function(n) {
    while (n < 0) {
      n += 255;
    }
    while (n >= 256) {
      n -= 255;
    }
    return EXP_TABLE[n];
  };
  return _this;
})();
var qrPolynomial = function(num, shift) {
  if (typeof num.length == "undefined") {
    throw num.length + "/" + shift;
  }
  const _num = (function() {
    let offset = 0;
    while (offset < num.length && num[offset] == 0) {
      offset += 1;
    }
    const _num2 = new Array(num.length - offset + shift);
    for (let i = 0; i < num.length - offset; i += 1) {
      _num2[i] = num[i + offset];
    }
    return _num2;
  })();
  const _this = {};
  _this.getAt = function(index) {
    return _num[index];
  };
  _this.getLength = function() {
    return _num.length;
  };
  _this.multiply = function(e) {
    const num2 = new Array(_this.getLength() + e.getLength() - 1);
    for (let i = 0; i < _this.getLength(); i += 1) {
      for (let j2 = 0; j2 < e.getLength(); j2 += 1) {
        num2[i + j2] ^= QRMath.gexp(QRMath.glog(_this.getAt(i)) + QRMath.glog(e.getAt(j2)));
      }
    }
    return qrPolynomial(num2, 0);
  };
  _this.mod = function(e) {
    if (_this.getLength() - e.getLength() < 0) {
      return _this;
    }
    const ratio = QRMath.glog(_this.getAt(0)) - QRMath.glog(e.getAt(0));
    const num2 = new Array(_this.getLength());
    for (let i = 0; i < _this.getLength(); i += 1) {
      num2[i] = _this.getAt(i);
    }
    for (let i = 0; i < e.getLength(); i += 1) {
      num2[i] ^= QRMath.gexp(QRMath.glog(e.getAt(i)) + ratio);
    }
    return qrPolynomial(num2, 0).mod(e);
  };
  return _this;
};
var QRRSBlock = (function() {
  const RS_BLOCK_TABLE = [
    // L
    // M
    // Q
    // H
    // 1
    [1, 26, 19],
    [1, 26, 16],
    [1, 26, 13],
    [1, 26, 9],
    // 2
    [1, 44, 34],
    [1, 44, 28],
    [1, 44, 22],
    [1, 44, 16],
    // 3
    [1, 70, 55],
    [1, 70, 44],
    [2, 35, 17],
    [2, 35, 13],
    // 4
    [1, 100, 80],
    [2, 50, 32],
    [2, 50, 24],
    [4, 25, 9],
    // 5
    [1, 134, 108],
    [2, 67, 43],
    [2, 33, 15, 2, 34, 16],
    [2, 33, 11, 2, 34, 12],
    // 6
    [2, 86, 68],
    [4, 43, 27],
    [4, 43, 19],
    [4, 43, 15],
    // 7
    [2, 98, 78],
    [4, 49, 31],
    [2, 32, 14, 4, 33, 15],
    [4, 39, 13, 1, 40, 14],
    // 8
    [2, 121, 97],
    [2, 60, 38, 2, 61, 39],
    [4, 40, 18, 2, 41, 19],
    [4, 40, 14, 2, 41, 15],
    // 9
    [2, 146, 116],
    [3, 58, 36, 2, 59, 37],
    [4, 36, 16, 4, 37, 17],
    [4, 36, 12, 4, 37, 13],
    // 10
    [2, 86, 68, 2, 87, 69],
    [4, 69, 43, 1, 70, 44],
    [6, 43, 19, 2, 44, 20],
    [6, 43, 15, 2, 44, 16],
    // 11
    [4, 101, 81],
    [1, 80, 50, 4, 81, 51],
    [4, 50, 22, 4, 51, 23],
    [3, 36, 12, 8, 37, 13],
    // 12
    [2, 116, 92, 2, 117, 93],
    [6, 58, 36, 2, 59, 37],
    [4, 46, 20, 6, 47, 21],
    [7, 42, 14, 4, 43, 15],
    // 13
    [4, 133, 107],
    [8, 59, 37, 1, 60, 38],
    [8, 44, 20, 4, 45, 21],
    [12, 33, 11, 4, 34, 12],
    // 14
    [3, 145, 115, 1, 146, 116],
    [4, 64, 40, 5, 65, 41],
    [11, 36, 16, 5, 37, 17],
    [11, 36, 12, 5, 37, 13],
    // 15
    [5, 109, 87, 1, 110, 88],
    [5, 65, 41, 5, 66, 42],
    [5, 54, 24, 7, 55, 25],
    [11, 36, 12, 7, 37, 13],
    // 16
    [5, 122, 98, 1, 123, 99],
    [7, 73, 45, 3, 74, 46],
    [15, 43, 19, 2, 44, 20],
    [3, 45, 15, 13, 46, 16],
    // 17
    [1, 135, 107, 5, 136, 108],
    [10, 74, 46, 1, 75, 47],
    [1, 50, 22, 15, 51, 23],
    [2, 42, 14, 17, 43, 15],
    // 18
    [5, 150, 120, 1, 151, 121],
    [9, 69, 43, 4, 70, 44],
    [17, 50, 22, 1, 51, 23],
    [2, 42, 14, 19, 43, 15],
    // 19
    [3, 141, 113, 4, 142, 114],
    [3, 70, 44, 11, 71, 45],
    [17, 47, 21, 4, 48, 22],
    [9, 39, 13, 16, 40, 14],
    // 20
    [3, 135, 107, 5, 136, 108],
    [3, 67, 41, 13, 68, 42],
    [15, 54, 24, 5, 55, 25],
    [15, 43, 15, 10, 44, 16],
    // 21
    [4, 144, 116, 4, 145, 117],
    [17, 68, 42],
    [17, 50, 22, 6, 51, 23],
    [19, 46, 16, 6, 47, 17],
    // 22
    [2, 139, 111, 7, 140, 112],
    [17, 74, 46],
    [7, 54, 24, 16, 55, 25],
    [34, 37, 13],
    // 23
    [4, 151, 121, 5, 152, 122],
    [4, 75, 47, 14, 76, 48],
    [11, 54, 24, 14, 55, 25],
    [16, 45, 15, 14, 46, 16],
    // 24
    [6, 147, 117, 4, 148, 118],
    [6, 73, 45, 14, 74, 46],
    [11, 54, 24, 16, 55, 25],
    [30, 46, 16, 2, 47, 17],
    // 25
    [8, 132, 106, 4, 133, 107],
    [8, 75, 47, 13, 76, 48],
    [7, 54, 24, 22, 55, 25],
    [22, 45, 15, 13, 46, 16],
    // 26
    [10, 142, 114, 2, 143, 115],
    [19, 74, 46, 4, 75, 47],
    [28, 50, 22, 6, 51, 23],
    [33, 46, 16, 4, 47, 17],
    // 27
    [8, 152, 122, 4, 153, 123],
    [22, 73, 45, 3, 74, 46],
    [8, 53, 23, 26, 54, 24],
    [12, 45, 15, 28, 46, 16],
    // 28
    [3, 147, 117, 10, 148, 118],
    [3, 73, 45, 23, 74, 46],
    [4, 54, 24, 31, 55, 25],
    [11, 45, 15, 31, 46, 16],
    // 29
    [7, 146, 116, 7, 147, 117],
    [21, 73, 45, 7, 74, 46],
    [1, 53, 23, 37, 54, 24],
    [19, 45, 15, 26, 46, 16],
    // 30
    [5, 145, 115, 10, 146, 116],
    [19, 75, 47, 10, 76, 48],
    [15, 54, 24, 25, 55, 25],
    [23, 45, 15, 25, 46, 16],
    // 31
    [13, 145, 115, 3, 146, 116],
    [2, 74, 46, 29, 75, 47],
    [42, 54, 24, 1, 55, 25],
    [23, 45, 15, 28, 46, 16],
    // 32
    [17, 145, 115],
    [10, 74, 46, 23, 75, 47],
    [10, 54, 24, 35, 55, 25],
    [19, 45, 15, 35, 46, 16],
    // 33
    [17, 145, 115, 1, 146, 116],
    [14, 74, 46, 21, 75, 47],
    [29, 54, 24, 19, 55, 25],
    [11, 45, 15, 46, 46, 16],
    // 34
    [13, 145, 115, 6, 146, 116],
    [14, 74, 46, 23, 75, 47],
    [44, 54, 24, 7, 55, 25],
    [59, 46, 16, 1, 47, 17],
    // 35
    [12, 151, 121, 7, 152, 122],
    [12, 75, 47, 26, 76, 48],
    [39, 54, 24, 14, 55, 25],
    [22, 45, 15, 41, 46, 16],
    // 36
    [6, 151, 121, 14, 152, 122],
    [6, 75, 47, 34, 76, 48],
    [46, 54, 24, 10, 55, 25],
    [2, 45, 15, 64, 46, 16],
    // 37
    [17, 152, 122, 4, 153, 123],
    [29, 74, 46, 14, 75, 47],
    [49, 54, 24, 10, 55, 25],
    [24, 45, 15, 46, 46, 16],
    // 38
    [4, 152, 122, 18, 153, 123],
    [13, 74, 46, 32, 75, 47],
    [48, 54, 24, 14, 55, 25],
    [42, 45, 15, 32, 46, 16],
    // 39
    [20, 147, 117, 4, 148, 118],
    [40, 75, 47, 7, 76, 48],
    [43, 54, 24, 22, 55, 25],
    [10, 45, 15, 67, 46, 16],
    // 40
    [19, 148, 118, 6, 149, 119],
    [18, 75, 47, 31, 76, 48],
    [34, 54, 24, 34, 55, 25],
    [20, 45, 15, 61, 46, 16]
  ];
  const qrRSBlock = function(totalCount, dataCount) {
    const _this2 = {};
    _this2.totalCount = totalCount;
    _this2.dataCount = dataCount;
    return _this2;
  };
  const _this = {};
  const getRsBlockTable = function(typeNumber, errorCorrectionLevel) {
    switch (errorCorrectionLevel) {
      case QRErrorCorrectionLevel.L:
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 0];
      case QRErrorCorrectionLevel.M:
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 1];
      case QRErrorCorrectionLevel.Q:
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 2];
      case QRErrorCorrectionLevel.H:
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 3];
      default:
        return void 0;
    }
  };
  _this.getRSBlocks = function(typeNumber, errorCorrectionLevel) {
    const rsBlock = getRsBlockTable(typeNumber, errorCorrectionLevel);
    if (typeof rsBlock == "undefined") {
      throw "bad rs block @ typeNumber:" + typeNumber + "/errorCorrectionLevel:" + errorCorrectionLevel;
    }
    const length = rsBlock.length / 3;
    const list = [];
    for (let i = 0; i < length; i += 1) {
      const count = rsBlock[i * 3 + 0];
      const totalCount = rsBlock[i * 3 + 1];
      const dataCount = rsBlock[i * 3 + 2];
      for (let j2 = 0; j2 < count; j2 += 1) {
        list.push(qrRSBlock(totalCount, dataCount));
      }
    }
    return list;
  };
  return _this;
})();
var qrBitBuffer = function() {
  const _buffer = [];
  let _length = 0;
  const _this = {};
  _this.getBuffer = function() {
    return _buffer;
  };
  _this.getAt = function(index) {
    const bufIndex = Math.floor(index / 8);
    return (_buffer[bufIndex] >>> 7 - index % 8 & 1) == 1;
  };
  _this.put = function(num, length) {
    for (let i = 0; i < length; i += 1) {
      _this.putBit((num >>> length - i - 1 & 1) == 1);
    }
  };
  _this.getLengthInBits = function() {
    return _length;
  };
  _this.putBit = function(bit) {
    const bufIndex = Math.floor(_length / 8);
    if (_buffer.length <= bufIndex) {
      _buffer.push(0);
    }
    if (bit) {
      _buffer[bufIndex] |= 128 >>> _length % 8;
    }
    _length += 1;
  };
  return _this;
};
var qrNumber = function(data) {
  const _mode = QRMode.MODE_NUMBER;
  const _data = data;
  const _this = {};
  _this.getMode = function() {
    return _mode;
  };
  _this.getLength = function(buffer) {
    return _data.length;
  };
  _this.write = function(buffer) {
    const data2 = _data;
    let i = 0;
    while (i + 2 < data2.length) {
      buffer.put(strToNum(data2.substring(i, i + 3)), 10);
      i += 3;
    }
    if (i < data2.length) {
      if (data2.length - i == 1) {
        buffer.put(strToNum(data2.substring(i, i + 1)), 4);
      } else if (data2.length - i == 2) {
        buffer.put(strToNum(data2.substring(i, i + 2)), 7);
      }
    }
  };
  const strToNum = function(s15) {
    let num = 0;
    for (let i = 0; i < s15.length; i += 1) {
      num = num * 10 + chatToNum(s15.charAt(i));
    }
    return num;
  };
  const chatToNum = function(c) {
    if ("0" <= c && c <= "9") {
      return c.charCodeAt(0) - "0".charCodeAt(0);
    }
    throw "illegal char :" + c;
  };
  return _this;
};
var qrAlphaNum = function(data) {
  const _mode = QRMode.MODE_ALPHA_NUM;
  const _data = data;
  const _this = {};
  _this.getMode = function() {
    return _mode;
  };
  _this.getLength = function(buffer) {
    return _data.length;
  };
  _this.write = function(buffer) {
    const s15 = _data;
    let i = 0;
    while (i + 1 < s15.length) {
      buffer.put(
        getCode(s15.charAt(i)) * 45 + getCode(s15.charAt(i + 1)),
        11
      );
      i += 2;
    }
    if (i < s15.length) {
      buffer.put(getCode(s15.charAt(i)), 6);
    }
  };
  const getCode = function(c) {
    if ("0" <= c && c <= "9") {
      return c.charCodeAt(0) - "0".charCodeAt(0);
    } else if ("A" <= c && c <= "Z") {
      return c.charCodeAt(0) - "A".charCodeAt(0) + 10;
    } else {
      switch (c) {
        case " ":
          return 36;
        case "$":
          return 37;
        case "%":
          return 38;
        case "*":
          return 39;
        case "+":
          return 40;
        case "-":
          return 41;
        case ".":
          return 42;
        case "/":
          return 43;
        case ":":
          return 44;
        default:
          throw "illegal char :" + c;
      }
    }
  };
  return _this;
};
var qr8BitByte = function(data) {
  const _mode = QRMode.MODE_8BIT_BYTE;
  const _data = data;
  const _bytes = qrcode.stringToBytes(data);
  const _this = {};
  _this.getMode = function() {
    return _mode;
  };
  _this.getLength = function(buffer) {
    return _bytes.length;
  };
  _this.write = function(buffer) {
    for (let i = 0; i < _bytes.length; i += 1) {
      buffer.put(_bytes[i], 8);
    }
  };
  return _this;
};
var qrKanji = function(data) {
  const _mode = QRMode.MODE_KANJI;
  const _data = data;
  const stringToBytes2 = qrcode.stringToBytes;
  !(function(c, code) {
    const test = stringToBytes2(c);
    if (test.length != 2 || (test[0] << 8 | test[1]) != code) {
      throw "sjis not supported.";
    }
  })("友", 38726);
  const _bytes = stringToBytes2(data);
  const _this = {};
  _this.getMode = function() {
    return _mode;
  };
  _this.getLength = function(buffer) {
    return ~~(_bytes.length / 2);
  };
  _this.write = function(buffer) {
    const data2 = _bytes;
    let i = 0;
    while (i + 1 < data2.length) {
      let c = (255 & data2[i]) << 8 | 255 & data2[i + 1];
      if (33088 <= c && c <= 40956) {
        c -= 33088;
      } else if (57408 <= c && c <= 60351) {
        c -= 49472;
      } else {
        throw "illegal char at " + (i + 1) + "/" + c;
      }
      c = (c >>> 8 & 255) * 192 + (c & 255);
      buffer.put(c, 13);
      i += 2;
    }
    if (i < data2.length) {
      throw "illegal char at " + (i + 1);
    }
  };
  return _this;
};
var byteArrayOutputStream = function() {
  const _bytes = [];
  const _this = {};
  _this.writeByte = function(b2) {
    _bytes.push(b2 & 255);
  };
  _this.writeShort = function(i) {
    _this.writeByte(i);
    _this.writeByte(i >>> 8);
  };
  _this.writeBytes = function(b2, off, len) {
    off = off || 0;
    len = len || b2.length;
    for (let i = 0; i < len; i += 1) {
      _this.writeByte(b2[i + off]);
    }
  };
  _this.writeString = function(s15) {
    for (let i = 0; i < s15.length; i += 1) {
      _this.writeByte(s15.charCodeAt(i));
    }
  };
  _this.toByteArray = function() {
    return _bytes;
  };
  _this.toString = function() {
    let s15 = "";
    s15 += "[";
    for (let i = 0; i < _bytes.length; i += 1) {
      if (i > 0) {
        s15 += ",";
      }
      s15 += _bytes[i];
    }
    s15 += "]";
    return s15;
  };
  return _this;
};
var base64EncodeOutputStream = function() {
  let _buffer = 0;
  let _buflen = 0;
  let _length = 0;
  let _base64 = "";
  const _this = {};
  const writeEncoded = function(b2) {
    _base64 += String.fromCharCode(encode(b2 & 63));
  };
  const encode = function(n) {
    if (n < 0) {
      throw "n:" + n;
    } else if (n < 26) {
      return 65 + n;
    } else if (n < 52) {
      return 97 + (n - 26);
    } else if (n < 62) {
      return 48 + (n - 52);
    } else if (n == 62) {
      return 43;
    } else if (n == 63) {
      return 47;
    } else {
      throw "n:" + n;
    }
  };
  _this.writeByte = function(n) {
    _buffer = _buffer << 8 | n & 255;
    _buflen += 8;
    _length += 1;
    while (_buflen >= 6) {
      writeEncoded(_buffer >>> _buflen - 6);
      _buflen -= 6;
    }
  };
  _this.flush = function() {
    if (_buflen > 0) {
      writeEncoded(_buffer << 6 - _buflen);
      _buffer = 0;
      _buflen = 0;
    }
    if (_length % 3 != 0) {
      const padlen = 3 - _length % 3;
      for (let i = 0; i < padlen; i += 1) {
        _base64 += "=";
      }
    }
  };
  _this.toString = function() {
    return _base64;
  };
  return _this;
};
var base64DecodeInputStream = function(str) {
  const _str = str;
  let _pos = 0;
  let _buffer = 0;
  let _buflen = 0;
  const _this = {};
  _this.read = function() {
    while (_buflen < 8) {
      if (_pos >= _str.length) {
        if (_buflen == 0) {
          return -1;
        }
        throw "unexpected end of file./" + _buflen;
      }
      const c = _str.charAt(_pos);
      _pos += 1;
      if (c == "=") {
        _buflen = 0;
        return -1;
      } else if (c.match(/^\s$/)) {
        continue;
      }
      _buffer = _buffer << 6 | decode(c.charCodeAt(0));
      _buflen += 6;
    }
    const n = _buffer >>> _buflen - 8 & 255;
    _buflen -= 8;
    return n;
  };
  const decode = function(c) {
    if (65 <= c && c <= 90) {
      return c - 65;
    } else if (97 <= c && c <= 122) {
      return c - 97 + 26;
    } else if (48 <= c && c <= 57) {
      return c - 48 + 52;
    } else if (c == 43) {
      return 62;
    } else if (c == 47) {
      return 63;
    } else {
      throw "c:" + c;
    }
  };
  return _this;
};
var gifImage = function(width, height) {
  const _width = width;
  const _height = height;
  const _data = new Array(width * height);
  const _this = {};
  _this.setPixel = function(x, y, pixel) {
    _data[y * _width + x] = pixel;
  };
  _this.write = function(out) {
    out.writeString("GIF87a");
    out.writeShort(_width);
    out.writeShort(_height);
    out.writeByte(128);
    out.writeByte(0);
    out.writeByte(0);
    out.writeByte(0);
    out.writeByte(0);
    out.writeByte(0);
    out.writeByte(255);
    out.writeByte(255);
    out.writeByte(255);
    out.writeString(",");
    out.writeShort(0);
    out.writeShort(0);
    out.writeShort(_width);
    out.writeShort(_height);
    out.writeByte(0);
    const lzwMinCodeSize = 2;
    const raster = getLZWRaster(lzwMinCodeSize);
    out.writeByte(lzwMinCodeSize);
    let offset = 0;
    while (raster.length - offset > 255) {
      out.writeByte(255);
      out.writeBytes(raster, offset, 255);
      offset += 255;
    }
    out.writeByte(raster.length - offset);
    out.writeBytes(raster, offset, raster.length - offset);
    out.writeByte(0);
    out.writeString(";");
  };
  const bitOutputStream = function(out) {
    const _out = out;
    let _bitLength = 0;
    let _bitBuffer = 0;
    const _this2 = {};
    _this2.write = function(data, length) {
      if (data >>> length != 0) {
        throw "length over";
      }
      while (_bitLength + length >= 8) {
        _out.writeByte(255 & (data << _bitLength | _bitBuffer));
        length -= 8 - _bitLength;
        data >>>= 8 - _bitLength;
        _bitBuffer = 0;
        _bitLength = 0;
      }
      _bitBuffer = data << _bitLength | _bitBuffer;
      _bitLength = _bitLength + length;
    };
    _this2.flush = function() {
      if (_bitLength > 0) {
        _out.writeByte(_bitBuffer);
      }
    };
    return _this2;
  };
  const getLZWRaster = function(lzwMinCodeSize) {
    const clearCode = 1 << lzwMinCodeSize;
    const endCode = (1 << lzwMinCodeSize) + 1;
    let bitLength = lzwMinCodeSize + 1;
    const table = lzwTable();
    for (let i = 0; i < clearCode; i += 1) {
      table.add(String.fromCharCode(i));
    }
    table.add(String.fromCharCode(clearCode));
    table.add(String.fromCharCode(endCode));
    const byteOut = byteArrayOutputStream();
    const bitOut = bitOutputStream(byteOut);
    bitOut.write(clearCode, bitLength);
    let dataIndex = 0;
    let s15 = String.fromCharCode(_data[dataIndex]);
    dataIndex += 1;
    while (dataIndex < _data.length) {
      const c = String.fromCharCode(_data[dataIndex]);
      dataIndex += 1;
      if (table.contains(s15 + c)) {
        s15 = s15 + c;
      } else {
        bitOut.write(table.indexOf(s15), bitLength);
        if (table.size() < 4095) {
          if (table.size() == 1 << bitLength) {
            bitLength += 1;
          }
          table.add(s15 + c);
        }
        s15 = c;
      }
    }
    bitOut.write(table.indexOf(s15), bitLength);
    bitOut.write(endCode, bitLength);
    bitOut.flush();
    return byteOut.toByteArray();
  };
  const lzwTable = function() {
    const _map = {};
    let _size = 0;
    const _this2 = {};
    _this2.add = function(key) {
      if (_this2.contains(key)) {
        throw "dup key:" + key;
      }
      _map[key] = _size;
      _size += 1;
    };
    _this2.size = function() {
      return _size;
    };
    _this2.indexOf = function(key) {
      return _map[key];
    };
    _this2.contains = function(key) {
      return typeof _map[key] != "undefined";
    };
    return _this2;
  };
  return _this;
};
var createDataURL = function(width, height, getPixel) {
  const gif = gifImage(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      gif.setPixel(x, y, getPixel(x, y));
    }
  }
  const b2 = byteArrayOutputStream();
  gif.write(b2);
  const base64 = base64EncodeOutputStream();
  const bytes = b2.toByteArray();
  for (let i = 0; i < bytes.length; i += 1) {
    base64.writeByte(bytes[i]);
  }
  base64.flush();
  return "data:image/gif;base64," + base64;
};
var qrcode_default = qrcode;
var stringToBytes = qrcode.stringToBytes;

// src/client/onboarding.js
var CONNECT_STEP = Object.freeze({ id: "omni-connect", order: -250 });
var SKIPPED_KEY = "omni-ui:connect-omni-skipped";
var OMNI_AI_ROUTE = "api/omni-ai";
async function callOmniAi(endpoint, payload, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(OMNI_AI_ROUTE, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ endpoint, payload: payload ?? null })
  });
  if (!response.ok) throw Object.assign(new Error(`omni-ai answered HTTP ${response.status}`), { code: `HTTP_${response.status}` });
  const result = await response.json();
  if (result?.ok !== true) throw Object.assign(new Error(result?.error?.message ?? "omni-ai refused"), { code: result?.error?.code ?? "omni-ai/error" });
  return result.value;
}
var localStore = () => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};
function skippedHere(storage2 = localStore()) {
  try {
    return storage2?.getItem(SKIPPED_KEY) === "1";
  } catch {
    return false;
  }
}
function keepSkipHere(storage2 = localStore()) {
  try {
    storage2?.setItem(SKIPPED_KEY, "1");
  } catch {
  }
}
var stepsShown = 0;
function noteStepShown() {
  stepsShown += 1;
  return () => {
    stepsShown -= 1;
  };
}
var OMNI_AI_SHOWING = /* @__PURE__ */ Symbol.for("automagik.omni.onboarding-showing");
var stepShown = (scope = globalThis) => stepsShown > 0 || (scope[OMNI_AI_SHOWING] ?? 0) > 0;
var isConnected = (link) => link?.linked === true || link?.configured === true;
async function gateConnect({ explicit, complete }, { request, omniAi = callOmniAi, storage: storage2 = localStore() } = {}) {
  let link = null;
  try {
    link = await request("omni-link");
  } catch {
  }
  if (explicit === true) return { link };
  if (isConnected(link)) {
    complete();
    return null;
  }
  let skipped = skippedHere(storage2);
  if (!skipped) {
    try {
      skipped = (await omniAi("state"))?.connectOmniSkipped === true;
    } catch {
    }
  }
  if (skipped) {
    complete();
    return null;
  }
  return { link };
}
async function skipConnect({ complete }, { omniAi = callOmniAi, storage: storage2 = localStore() } = {}) {
  try {
    await omniAi("done", { stepId: CONNECT_STEP.id });
  } catch {
    keepSkipHere(storage2);
  }
  complete();
}

// src/client/core.js
var import_client = require("@automagik/bots-dsh/client");
var { call, t, addStrings, onShell, toolCards, nav, badges, botChildren, headerButtons, botSettings } = import_client.omni;
var { OmniMark, BotMark, MAIN_LOOK, CHARACTERS, relativeShort, createSource } = import_client.omni.ui;
var icons = import_client.omni.ui.icons;

// src/client/wizard.js
var import_react = require("react");
var isOpen = false;
var listeners = /* @__PURE__ */ new Set();
var emit = () => {
  for (const listener of listeners) listener();
};
var subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
var wizardOpen = () => isOpen;
function openConnectWizard() {
  if (isOpen) return;
  isOpen = true;
  emit();
}
function closeConnectWizard() {
  if (!isOpen) return;
  isOpen = false;
  emit();
}
var AUTO_OPENED = "omni-channels:connect-wizard-opened";
var AUTO_OPEN_DELAY_MS = 1500;
async function autoOpenOnce({ request = call, omniAi = callOmniAi, storage: storage2 = localStore(), gate = gateConnect, shown = stepShown, open = openConnectWizard, wait = (ms2) => new Promise((resolve) => setTimeout(resolve, ms2)) } = {}) {
  try {
    if (storage2?.getItem(AUTO_OPENED) === "1") return false;
  } catch {
  }
  const state = await gate({ stepId: CONNECT_STEP.id, complete: () => {
  } }, { request, omniAi, storage: storage2 }).catch(() => null);
  if (!state) return false;
  await wait(AUTO_OPEN_DELAY_MS);
  if (shown()) return false;
  try {
    storage2?.setItem(AUTO_OPENED, "1");
  } catch {
  }
  open();
  return true;
}
function WizardHost() {
  const open = (0, import_react.useSyncExternalStore)(subscribe, wizardOpen, wizardOpen);
  (0, import_react.useEffect)(() => {
    void autoOpenOnce();
  }, []);
  if (!open) return null;
  return (0, import_react.createElement)(ConnectOmniStep, { stepId: CONNECT_STEP.id, explicit: true, onDemand: true, complete: closeConnectWizard, openSection: () => {
  } });
}
function ConnectPrompt() {
  return (0, import_react.createElement)(
    "section",
    { className: "oc-connect-prompt" },
    (0, import_react.createElement)(
      "div",
      null,
      (0, import_react.createElement)("strong", null, t("Connect your Omni")),
      (0, import_react.createElement)("p", null, t("This page shows sample data until this DSH is linked to your Omni."))
    ),
    (0, import_react.createElement)("button", { type: "button", className: "oc-primary", onClick: openConnectWizard }, t("Connect your Omni"))
  );
}

// src/client/update-bar.js
var KEY = "omni-ui:update-dismissed:";
function updateBar(status, dismissed = null) {
  const latest = status?.latest;
  switch (status?.state) {
    case "available":
      if (dismissed === latest) return null;
      return { kind: "available", latest, current: status.current ?? null, action: "update", ...status.confirm === "app" ? { confirm: "app" } : {} };
    case "off":
    case "forbidden":
      if (!latest || dismissed === latest) return null;
      return { kind: "admin", latest, action: "how", command: status.command ?? null };
    case "pending":
      return { kind: "pending", version: status.version, action: "none" };
    case "updating":
      return { kind: "updating", version: status.version, action: "none" };
    default:
      return null;
  }
}
var storage = () => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};
function dismissedFor(origin, store = storage()) {
  try {
    return store?.getItem(KEY + origin) ?? null;
  } catch {
    return null;
  }
}
function dismiss(origin, version, store = storage()) {
  try {
    store?.setItem(KEY + origin, version);
  } catch {
  }
}

// src/client/omni-update.js
var import_react2 = require("react");
function rich(template, parts) {
  const marks = Object.fromEntries(Object.keys(parts).map((key) => [key, `${key}`]));
  return t(template, marks).split(/\uE000(\w+)\uE000/).map((piece, index) => index % 2 === 1 ? (0, import_react2.createElement)(import_react2.Fragment, { key: index }, parts[piece]) : piece);
}
function CopyCommand({ command }) {
  const [copied, setCopied] = (0, import_react2.useState)(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
    } catch {
    }
  };
  return (0, import_react2.createElement)(
    "span",
    { className: "ox-command" },
    (0, import_react2.createElement)("code", null, command),
    (0, import_react2.createElement)("button", { type: "button", className: "oc-ghost ox-copy", onClick: copy }, copied ? t("Copied") : t("Copy"))
  );
}
function updateWords(status) {
  switch (status?.state) {
    case "available":
      return t("Omni {latest} is out. This one runs {current}.", { latest: status.latest, current: status.current ?? "?" });
    case "off":
      return t("Omni {latest} is out, but updates from the app are off on this Omni. Update it where it runs:", { latest: status.latest });
    case "pending":
      return t("An update to {version} is waiting for your yes on WhatsApp.", { version: status.version });
    case "updating":
      return t("Updating to {version}…", { version: status.version });
    case "current":
      return t("Up to date ({version}).", { version: status.current ?? status.latest });
    case "terminal":
      return t("Update it from a terminal:");
    case "forbidden":
      return status.message;
    case "unreachable":
      return t("Could not reach this Omni to check for updates.");
    case "unknown":
      return t("Could not tell whether this Omni has an update.");
    default:
      return null;
  }
}
var CONFIRM_ON_WHATSAPP = "Confirm on WhatsApp: your Omni sent you a code. Reply update and that code in your chat with yourself.";
var UPDATING_HERE = "Updating to {version}. Omni restarts by itself in a minute or two.";
function UpdateBar({ origin }) {
  const [status, setStatus] = (0, import_react2.useState)(null);
  const [dismissed, setDismissed] = (0, import_react2.useState)(() => dismissedFor(origin));
  const [asked, setAsked] = (0, import_react2.useState)(null);
  const [sure, setSure] = (0, import_react2.useState)(false);
  const [how, setHow] = (0, import_react2.useState)(false);
  const [busy, setBusy] = (0, import_react2.useState)(false);
  const [problem, setProblem] = (0, import_react2.useState)(null);
  const alive = (0, import_react2.useRef)(true);
  (0, import_react2.useEffect)(() => () => {
    alive.current = false;
  }, []);
  (0, import_react2.useEffect)(() => {
    call("omni-update-status", {}).then((reply) => {
      if (alive.current) setStatus(reply);
    }, () => {
    });
  }, [origin]);
  const bar = updateBar(status, dismissed);
  if (!bar) return null;
  const close = () => {
    dismiss(origin, bar.latest);
    setDismissed(bar.latest);
  };
  const ask = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const reply = await call("omni-update-request", { version: bar.latest });
      if (alive.current) setAsked(reply?.state === "updating" ? "updating" : "awaiting-confirmation");
    } catch (error) {
      if (alive.current) setProblem(error.message);
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const here = bar.confirm === "app";
  let words;
  if (asked === "updating") words = t(UPDATING_HERE, { version: bar.latest });
  else if (asked) words = t(CONFIRM_ON_WHATSAPP);
  else if (sure) words = rich("Update the Omni on this computer to {version}? It stops for a minute or two and comes back by itself.", { version: (0, import_react2.createElement)("b", null, bar.latest) });
  else if (bar.kind === "available") {
    const version = (0, import_react2.createElement)("b", null, `Omni ${bar.latest}`);
    words = bar.current ? rich("{version} is available · you're on {current}", { version, current: bar.current }) : rich("{version} is available", { version });
  } else if (bar.kind === "admin") words = rich("{version} is available. Its admin updates this Omni.", { version: (0, import_react2.createElement)("b", null, `Omni ${bar.latest}`) });
  else words = updateWords({ state: bar.kind, version: bar.version });
  return (0, import_react2.createElement)(
    "div",
    { className: "ox-bar", role: "status", "data-kind": bar.kind },
    (0, import_react2.createElement)("span", { className: "ox-bar-dot", "aria-hidden": true }),
    (0, import_react2.createElement)("span", { className: "ox-bar-text" }, words),
    !asked && bar.action === "update" && !sure ? (0, import_react2.createElement)("button", { type: "button", className: "oc-primary ox-bar-go", disabled: busy, onClick: here ? () => setSure(true) : ask }, busy ? t("Asking…") : t("Update")) : null,
    !asked && sure ? (0, import_react2.createElement)("button", { type: "button", className: "oc-primary ox-bar-go", disabled: busy, onClick: ask }, busy ? t("Starting…") : t("Update now")) : null,
    !asked && sure && !busy ? (0, import_react2.createElement)("button", { type: "button", className: "oc-link", onClick: () => setSure(false) }, t("Not now")) : null,
    bar.action === "how" ? (0, import_react2.createElement)("button", { type: "button", className: "oc-link", "aria-expanded": how, onClick: () => setHow((value) => !value) }, t("How")) : null,
    bar.action !== "none" ? (0, import_react2.createElement)("button", { type: "button", className: "ox-bar-x", "aria-label": t("Hide until the next version"), title: t("Hide until the next version"), onClick: close }, "×") : null,
    how ? (0, import_react2.createElement)("div", { className: "ox-bar-how" }, bar.command ? (0, import_react2.createElement)(import_react2.Fragment, null, (0, import_react2.createElement)("span", null, t("Whoever runs this Omni updates it with:")), (0, import_react2.createElement)(CopyCommand, { command: bar.command })) : (0, import_react2.createElement)("span", null, t("Ask whoever runs your Omni to update it."))) : null,
    problem ? (0, import_react2.createElement)("span", { className: "ox-problem", role: "alert" }, problem) : null
  );
}
var OMNI_UPDATE_CSS = `
.ox-bar{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;margin:0 0 6px;padding:9px 12px 9px 14px;border:1px solid var(--bt-line-2);border-radius:12px;background:var(--bt-card);font-size:13.5px}
.ox-bar-dot{width:8px;height:8px;border-radius:50%;background:var(--bt-accent);flex:none}
.ox-bar[data-kind=admin] .ox-bar-dot{background:var(--bt-ink-3)}
.ox-bar-text{flex:1;min-width:200px;color:var(--bt-ink-2)}
.ox-bar-text b{color:var(--bt-ink);font-weight:600}
.ox-bar-go{height:30px!important;padding:0 12px!important;font-size:13px!important}
.ox-bar-x{width:26px;height:26px;border:0;border-radius:8px;background:none;color:var(--bt-ink-3);font-size:18px;line-height:1;cursor:pointer}
.ox-bar-x:hover{background:var(--bt-hover);color:var(--bt-ink)}
.ox-bar-how{flex-basis:100%;display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:8px 0 2px 20px;color:var(--bt-ink-2)}
.ox-command{display:inline-flex;align-items:center;gap:8px}
.ox-command code{padding:4px 8px;border-radius:8px;background:var(--bt-bg,rgba(0,0,0,.2));font:13px ui-monospace,SFMono-Regular,Menlo,monospace;user-select:all}
.ox-copy{height:28px!important;padding:0 10px!important;font-size:12.5px!important}
.ox-confirm{display:flex;flex-direction:column;gap:10px;padding:12px 14px;border:1px solid var(--bt-line-2);border-radius:12px}
.ox-progress{display:inline-flex;align-items:center;gap:8px;color:var(--bt-ink-2);font-size:13px}
`;

// src/client/omni-store.js
var CHANNELS_PANEL = "omni-channels";
var CHAT_PANEL = "omni-chat";
var typeOf = (type) => CHANNEL_TYPES[type] ?? { label: type, tile: "#64748B", glyph: "chat", pairing: "token", blurb: "" };
var CHANNEL_TYPES = {
  "whatsapp-baileys": { label: "WhatsApp", tile: "#25D366", glyph: "whatsapp", pairing: "qr", blurb: "Your own number, linked like WhatsApp Web." },
  "whatsapp-business": { label: "WhatsApp Business", tile: "#128C7E", glyph: "whatsapp", pairing: "meta", signIn: "Meta", blurb: "The official Business API, through your Meta account." },
  slack: { label: "Slack", tile: "#4A154B", glyph: "slack", pairing: "oauth", signIn: "Slack", blurb: "Channels and DMs, as a bot or as yourself." },
  telegram: { label: "Telegram", tile: "#229ED9", glyph: "telegram", pairing: "token", blurb: "A bot of yours, in chats and groups." },
  discord: { label: "Discord", tile: "#5865F2", glyph: "discord", pairing: "token", blurb: "Servers, threads and DMs, through your bot." }
};
var STATUS = {
  connected: { label: "Connected", tone: "ok" },
  connecting: { label: "Reconnecting", tone: "busy" },
  attention: { label: "Needs attention", tone: "warn" },
  paused: { label: "Paused", tone: "off" }
};
var MIN = 6e4;
var HOUR = 60 * MIN;
function sample(now) {
  const ago = (ms2) => now - ms2;
  const channels2 = [
    {
      id: "wa-sales",
      type: "whatsapp-baileys",
      name: "Sales",
      detail: "+55 11 9xxxx-2291",
      status: "connected",
      answeredBy: "Omni",
      health: { lastEventAt: ago(2 * MIN), messagesToday: 128, replyMedianSec: 41, uptime: 0.998, week: [42, 58, 61, 49, 77, 90, 128] }
    },
    {
      id: "wa-personal",
      type: "whatsapp-baileys",
      name: "Personal",
      detail: "+55 21 9xxxx-7810",
      status: "connected",
      answeredBy: "You",
      health: { lastEventAt: ago(26 * MIN), messagesToday: 14, replyMedianSec: null, uptime: 0.991, week: [9, 12, 6, 15, 11, 8, 14] }
    },
    {
      id: "slack-namastex",
      type: "slack",
      name: "Namastex",
      detail: "#support · #sales",
      status: "connected",
      answeredBy: "Omni",
      health: { lastEventAt: ago(6 * MIN), messagesToday: 57, replyMedianSec: 95, uptime: 1, week: [33, 40, 51, 38, 44, 21, 57] }
    },
    {
      id: "tg-helper",
      type: "telegram",
      name: "Omni helper",
      detail: "@omni_helper_bot",
      status: "attention",
      answeredBy: "Omni",
      problem: "The bot token was revoked in BotFather. Paste a new token to reconnect.",
      health: { lastEventAt: ago(19 * HOUR), messagesToday: 0, replyMedianSec: null, uptime: 0.62, week: [18, 22, 25, 19, 7, 0, 0] }
    }
  ];
  const chats = [
    { id: "c-marina", channelId: "wa-sales", name: "Marina Lopes", initials: "ML", preview: "Pode me mandar o orçamento de novo?", at: ago(3 * MIN), unread: 2 },
    { id: "c-support", channelId: "slack-namastex", name: "#support", initials: "#", kind: "group", preview: "Omni: Ticket 482 answered, link resent", at: ago(7 * MIN), unread: 5 },
    { id: "c-rafael", channelId: "slack-namastex", name: "Rafael Costa", initials: "RC", preview: "Deploy after lunch", at: ago(41 * MIN), unread: 0 },
    { id: "c-alpha", channelId: "wa-sales", name: "Alpha Construções", initials: "AC", preview: "Recebido, obrigado!", at: ago(2 * HOUR), unread: 0 },
    { id: "c-familia", channelId: "wa-personal", name: "Família", initials: "FA", kind: "group", preview: "Almoço domingo?", at: ago(3 * HOUR), unread: 1 },
    { id: "c-obras", channelId: "wa-sales", name: "Grupo Obras", initials: "GO", kind: "group", preview: "Rafael: fotos no drive", at: ago(26 * HOUR), unread: 0 },
    { id: "c-beta", channelId: "tg-helper", name: "Beta testers", initials: "BT", kind: "group", preview: "Is the bot down?", at: ago(19 * HOUR), unread: 0 },
    { id: "c-ci", channelId: "slack-namastex", name: "#ci-alerts", initials: "#", kind: "group", preview: "build #1932 failed on dev", at: ago(12 * MIN), unread: 0 },
    { id: "c-self", channelId: "wa-personal", name: "Me (notes)", initials: "ME", kind: "self", preview: "Voice note (0:14)", at: ago(52 * MIN), unread: 0 }
  ];
  const messages = {
    "c-marina": [
      { id: "m1", from: "them", text: "Oi! Vi o anúncio. Quanto fica o plano anual?", at: ago(15 * MIN) },
      { id: "m2", from: "omni", text: "Oi Marina! O plano anual sai por R$ 1.190, com a instalação inclusa.", at: ago(14 * MIN) },
      { id: "m3", from: "them", text: "Perdi o arquivo do orçamento 😅", at: ago(4 * MIN) },
      { id: "m4", from: "them", text: "Pode me mandar o orçamento de novo?", at: ago(3 * MIN) }
    ],
    "c-support": [
      { id: "m1", from: "them", author: "Ana", text: "Ticket 482: the payment link does not open on mobile.", at: ago(12 * MIN) },
      { id: "m2", from: "omni", text: "I resent the link with the fixed version. Ana, can you confirm it opens now?", at: ago(7 * MIN) }
    ],
    "c-beta": [
      { id: "m1", from: "them", author: "Leo", text: "Is the bot down?", at: ago(19 * HOUR) }
    ]
  };
  return { channels: channels2, chats, messages };
}
var omniStore = createSource({
  ...sample(Date.now()),
  // Which channel the sidebar's Chats section shows (null: all), and the open chat.
  filter: null,
  chatId: null,
  // The Channels page: the overview, one channel, or the connect flow.
  page: { view: "overview", channelId: null, type: null, step: 0 },
  // preview: sample data, every action works locally. live: the host's omni endpoints,
  // read-only. `source` says which, and why the preview stays when omni is not set up.
  preview: true,
  source: { kind: "preview" },
  // Chats opened here, with the newest message seen, so a poll does not bring the
  // unread count back for messages already read.
  seen: {}
});
var channelOf = (state, id) => state.channels.find((channel) => channel.id === id);
var chatOf = (state, id) => state.chats.find((chat) => chat.id === id);
function visibleChats(state) {
  const chats = state.filter === null ? state.chats : state.chats.filter((chat) => chat.channelId === state.filter);
  return [...chats].sort((a, b2) => b2.at - a.at);
}
var isOmniBot = (bot) => bot?.kind === "omni";
function chatsOf(state, channelId, shown) {
  const all = state.chats.filter((chat) => chat.channelId === channelId).toSorted((a, b2) => b2.at - a.at);
  return { chats: all.slice(0, shown), more: Math.max(0, all.length - shown) };
}
var unreadOf = (state, channelId) => state.chats.filter((chat) => channelId === void 0 || chat.channelId === channelId).reduce((sum, chat) => sum + chat.unread, 0);
function healthSummary(state) {
  const count = (status) => state.channels.filter((channel) => channel.status === status).length;
  return {
    total: state.channels.length,
    connected: count("connected"),
    attention: count("attention") + count("connecting"),
    messagesToday: state.channels.reduce((sum, channel) => sum + (channel.health?.messagesToday ?? 0), 0)
  };
}
var canWrite = (state) => state.preview || state.source.kind === "live" && state.abilities?.changeChannels === true;
var canSend = (state) => state.preview || state.source.kind === "live" && state.abilities?.send === true;
var set = (patch) => omniStore.set((state) => ({ ...state, ...typeof patch === "function" ? patch(state) : patch }));
var patchChannel = (id, patch) => set((state) => ({ channels: state.channels.map((channel) => channel.id === id ? { ...channel, ...patch } : channel) }));
function omniActions(select, call2) {
  const liveAct = (channelId, action, local, token) => {
    if (omniStore.getSnapshot().preview || !call2) return local();
    patchChannel(channelId, { busy: action, actionError: void 0 });
    call2("omni-channel-act", { id: channelId, action, ...token ? { token } : {} }).then(() => refreshLive(call2)).then(() => patchChannel(channelId, { busy: void 0 }), (error) => patchChannel(channelId, { busy: void 0, actionError: error.message }));
  };
  return {
    setFilter: (filter) => set({ filter }),
    openChat(chatId) {
      set((state) => ({
        chatId,
        chats: state.chats.map((chat) => chat.id === chatId ? { ...chat, unread: 0 } : chat),
        seen: { ...state.seen, [chatId]: chatOf(state, chatId)?.at ?? Date.now() }
      }));
      select(CHAT_PANEL);
      if (!omniStore.getSnapshot().preview && call2) void loadMessages(call2, chatId);
    },
    openChannels(view = "overview", channelId = null) {
      set({ page: { view, channelId, type: null, step: 0 } });
      select(CHANNELS_PANEL);
    },
    showPage: (page) => set((state) => ({ page: { ...state.page, ...page } })),
    sendText(chatId, text) {
      const body = text.trim();
      const before = omniStore.getSnapshot();
      if (body === "" || !canSend(before)) return;
      const at2 = Date.now();
      const localId = `local-${at2}`;
      set((state) => ({
        messages: { ...state.messages, [chatId]: [...state.messages[chatId] ?? [], { id: localId, from: "you", text: body, at: at2, ...state.preview ? {} : { sending: true } }] },
        chats: state.chats.map((chat) => chat.id === chatId ? { ...chat, preview: `You: ${body}`, at: at2 } : chat),
        sendError: null
      }));
      if (before.preview || !call2) return;
      call2("omni-send", { chatId, text: body }).then(
        () => {
          set((state) => ({ messages: { ...state.messages, [chatId]: (state.messages[chatId] ?? []).map((message) => message.id === localId ? { ...message, sending: false } : message) } }));
          void loadMessages(call2, chatId);
        },
        (error) => set((state) => ({
          messages: { ...state.messages, [chatId]: (state.messages[chatId] ?? []).filter((message) => message.id !== localId) },
          chats: state.chats.map((chat) => chat.id === chatId ? chatOf(before, chatId) ?? chat : chat),
          sendError: { chatId, text: body, message: error.message }
        }))
      );
    },
    setAnsweredBy: (channelId, answeredBy) => patchChannel(channelId, { answeredBy }),
    pause: (channelId) => liveAct(channelId, "pause", () => patchChannel(channelId, { status: "paused" })),
    resume: (channelId) => liveAct(channelId, "resume", () => patchChannel(channelId, { status: "connected", problem: void 0 })),
    reconnect(channelId, token) {
      liveAct(channelId, token ? "token" : "reconnect", () => {
        patchChannel(channelId, { status: "connecting", problem: void 0 });
        setTimeout(() => patchChannel(channelId, { status: "connected", health: { ...channelOf(omniStore.getSnapshot(), channelId)?.health, lastEventAt: Date.now() } }), 1600);
      }, token);
    },
    // The preview's connect flow ends with a new sample channel; a live one with the channel
    // omni just connected (`id`), shown once the overview has it.
    finishConnect(type, name, liveId) {
      if (liveId) {
        set({ page: { view: "channel", channelId: liveId, type: null, step: 0 } });
        if (call2) void refreshLive(call2).catch(() => {
        });
        return;
      }
      const id = `${type}-${Date.now()}`;
      set((state) => ({
        channels: [...state.channels, {
          id,
          type,
          name: name || CHANNEL_TYPES[type].label,
          detail: "Just connected",
          status: "connected",
          answeredBy: "Omni",
          health: { lastEventAt: Date.now(), messagesToday: 0, replyMedianSec: null, uptime: 1, week: [0, 0, 0, 0, 0, 0, 0] }
        }],
        page: { view: "channel", channelId: id, type: null, step: 0 }
      }));
    },
    remove: (channelId) => set((state) => ({
      channels: state.channels.filter((channel) => channel.id !== channelId),
      chats: state.chats.filter((chat) => chat.channelId !== channelId),
      filter: state.filter === channelId ? null : state.filter,
      page: { view: "overview", channelId: null, type: null, step: 0 }
    }))
  };
}
var POLL_MS = 15e3;
var polling = null;
var markSeen = (seen, chats) => chats.map((chat) => (seen[chat.id] ?? -1) >= chat.at ? { ...chat, unread: 0 } : chat);
async function loadMessages(call2, chatId) {
  try {
    const { messages } = await call2("omni-messages", { chatId });
    set((state) => ({ messages: { ...state.messages, [chatId]: messages } }));
  } catch (error) {
    set((state) => ({ messages: { ...state.messages, [chatId]: state.messages[chatId] ?? [] }, source: { ...state.source, error: error.message } }));
  }
}
async function refreshLive(call2) {
  const reply = await call2("omni-overview");
  if (!reply.configured) {
    set((state) => state.preview ? { source: { kind: "preview", missing: reply.missing } } : {});
    return;
  }
  const abilities = omniStore.getSnapshot().abilities ?? await call2("omni-channel-abilities").catch(() => ({ changeChannels: false, send: false }));
  set((state) => ({
    // The first live answer drops every sample: their chats and messages are not omni's.
    ...state.preview ? { messages: {}, chatId: null, page: { view: "overview", channelId: null, type: null, step: 0 } } : {},
    abilities,
    preview: false,
    source: { kind: "live", origin: reply.origin, at: Date.now() },
    channels: reply.channels.map((channel) => {
      const kept = channelOf(state, channel.id);
      return kept?.busy || kept?.actionError ? { ...channel, busy: kept.busy, actionError: kept.actionError } : channel;
    }),
    chats: markSeen(state.seen, reply.chats),
    filter: reply.channels.some((channel) => channel.id === state.filter) ? state.filter : null
  }));
  const open = omniStore.getSnapshot().chatId;
  if (open) await loadMessages(call2, open);
}
function startLive(call2, every = POLL_MS) {
  if (polling) return polling;
  let timer = 0;
  let stopped = false;
  const tick = async () => {
    if (typeof document === "undefined" || !document.hidden) {
      try {
        await refreshLive(call2);
      } catch (error) {
        set((state) => ({ source: { ...state.source, error: error.message } }));
      }
    }
    if (!stopped) timer = setTimeout(tick, every);
  };
  void tick();
  polling = () => {
    stopped = true;
    clearTimeout(timer);
    polling = null;
  };
  return polling;
}
var TRIGGERS = {
  reaction: { label: "You react with", short: "reaction", icon: "reaction" },
  message: { label: "Any new message", short: "new message", icon: "message" },
  mention: { label: "Someone mentions you", short: "mention", icon: "mention" },
  keyword: { label: "A message contains", short: "keyword", icon: "keyword" },
  voice: { label: "A voice note arrives", short: "voice note", icon: "voice" },
  media: { label: "A photo or file arrives", short: "file", icon: "media" },
  down: { label: "The channel disconnects", short: "disconnect", icon: "down" }
};
var runsOf = (roster, subId) => (roster?.subscriptionRuns ?? []).filter((run) => subId === void 0 || run.subId === subId).toSorted((a, b2) => b2.at - a.at);
var waitingRuns = (roster, waiting = /* @__PURE__ */ new Set()) => (roster?.subscriptionRuns ?? []).filter((run) => run.status === "working" && waiting.has(run.sessionId)).length;

// src/client/channel-add.js
var ADD = {
  "whatsapp-baileys": { time: "1 min", how: "Scan a code", steps: ["Name it", "Scan", "Done"] },
  "whatsapp-business": { time: "3 min", how: "Enter your Meta details", steps: ["Enter the details", "Done"] },
  slack: { time: "1 min", how: "Connect with Slack", steps: ["Choose how it joins", "Approve in Slack", "Done"] },
  telegram: { time: "2 min", how: "Create a bot", steps: ["Create the bot", "Paste its token", "Say hi"] },
  discord: { time: "2 min", how: "Add your bot", steps: ["Paste the bot token", "Invite it to a server", "Done"] }
};
var ORDER = ["whatsapp-baileys", "whatsapp-business", "slack", "telegram", "discord"];
var offered = (supported) => ORDER.filter((type) => supported === null || supported === void 0 || supported.includes(type));
var TELEGRAM_TOKEN = /^\d{6,12}:[A-Za-z0-9_-]{30,}$/;
var isTelegramToken = (text) => typeof text === "string" && TELEGRAM_TOKEN.test(text.trim());
async function copiedTelegramToken(readText) {
  try {
    const text = await readText();
    return isTelegramToken(text) ? text.trim() : null;
  } catch {
    return null;
  }
}
function telegramChat(detail) {
  const name = typeof detail === "string" ? detail.trim().replace(/^@/, "") : "";
  return /^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(name) ? `https://t.me/${name}` : null;
}
var stepState = (index, at2) => index < at2 ? "done" : index === at2 ? "now" : void 0;

// src/client/channel-connect-live.js
var import_react3 = require("react");
var { ChevronLeftIcon } = icons;
var POLL_MS2 = 2e3;
function LiveConnectFlow({ state, omni: omni2, Tile: Tile2, PreviewChip: PreviewChip2 }) {
  const { type } = state.page;
  const [supported, setSupported] = (0, import_react3.useState)(void 0);
  (0, import_react3.useEffect)(() => {
    let live = true;
    call("omni-channel-types").then((reply) => {
      if (live) setSupported(reply.types ?? null);
    }, () => {
      if (live) setSupported(null);
    });
    return () => {
      live = false;
    };
  }, []);
  if (type === null) {
    return (0, import_react3.createElement)(AddGrid, {
      types: supported === void 0 ? [] : offered(supported),
      loading: supported === void 0,
      writable: canWrite(state),
      onPick: (id) => omni2.showPage({ type: id, step: 0 }),
      onBack: () => omni2.showPage({ view: "overview" }),
      Tile: Tile2,
      PreviewChip: PreviewChip2
    });
  }
  const props = { key: type, type, omni: omni2, Tile: Tile2, PreviewChip: PreviewChip2 };
  if (type === "slack") return (0, import_react3.createElement)(SlackFlow, props);
  if (type === "whatsapp-business") return (0, import_react3.createElement)(BusinessFlow, props);
  if (type === "telegram" || type === "discord") return (0, import_react3.createElement)(TokenFlow, props);
  return (0, import_react3.createElement)(WhatsAppFlow, props);
}
function AddGrid({ types, loading = false, writable = true, onPick, onBack, Tile: Tile2, PreviewChip: PreviewChip2 }) {
  return (0, import_react3.createElement)(
    import_react3.Fragment,
    null,
    (0, import_react3.createElement)("button", { type: "button", className: "oc-back", onClick: onBack }, (0, import_react3.createElement)(ChevronLeftIcon), t("Channels")),
    (0, import_react3.createElement)("header", { className: "oc-head" }, (0, import_react3.createElement)(
      "div",
      null,
      (0, import_react3.createElement)("h1", null, t("Add a channel"), (0, import_react3.createElement)(PreviewChip2)),
      (0, import_react3.createElement)("p", null, writable ? t("Pick where people talk to you. Every option connects from here.") : t("This device's key can't change channels; ask your Omni's owner."))
    )),
    loading ? (0, import_react3.createElement)("span", { className: "oc-qr-wait" }, (0, import_react3.createElement)("span", { className: "oc-spinner", "aria-hidden": true }), t("Looking at what this Omni offers…")) : null,
    (0, import_react3.createElement)("div", { className: "oc-types" }, types.map((id) => {
      const info = CHANNEL_TYPES[id];
      const add = ADD[id];
      return (0, import_react3.createElement)(
        "button",
        { key: id, type: "button", className: "oc-type", disabled: !writable, onClick: () => onPick(id) },
        (0, import_react3.createElement)("span", { className: "oc-type-top" }, (0, import_react3.createElement)(Tile2, { type: id, size: 44 }), (0, import_react3.createElement)("strong", null, info.label), (0, import_react3.createElement)("span", { className: "oc-type-time" }, add.time)),
        (0, import_react3.createElement)("span", { className: "oc-type-blurb" }, t(info.blurb)),
        (0, import_react3.createElement)("span", { className: "oc-type-how" }, (0, import_react3.createElement)("span", null, t("How")), (0, import_react3.createElement)("b", null, t(add.how), " →"))
      );
    }))
  );
}
function FlowShell({ type, at: at2, Tile: Tile2, PreviewChip: PreviewChip2, onBack, children }) {
  const info = CHANNEL_TYPES[type];
  const add = ADD[type];
  return (0, import_react3.createElement)(
    import_react3.Fragment,
    null,
    (0, import_react3.createElement)("button", { type: "button", className: "oc-back", onClick: onBack }, (0, import_react3.createElement)(ChevronLeftIcon), t("All channels")),
    (0, import_react3.createElement)("header", { className: "oc-head" }, (0, import_react3.createElement)(
      "div",
      null,
      (0, import_react3.createElement)("h1", null, (0, import_react3.createElement)(Tile2, { type, size: 34 }), info.label, (0, import_react3.createElement)(PreviewChip2)),
      (0, import_react3.createElement)("p", null, t("About {time}. You can disconnect any time from the channel's page.", { time: add.time }))
    )),
    (0, import_react3.createElement)(
      "div",
      { className: "oc-guide" },
      (0, import_react3.createElement)("ol", { className: "oc-guide-steps" }, add.steps.map((label, index) => (0, import_react3.createElement)(
        "li",
        { key: label, "data-state": stepState(index, at2) },
        (0, import_react3.createElement)("span", null, index < at2 ? "✓" : String(index + 1)),
        t(label)
      ))),
      (0, import_react3.createElement)("section", { className: "oc-guide-pane" }, children)
    )
  );
}
var Problem = ({ text }) => text ? (0, import_react3.createElement)("p", { className: "oc-problem", role: "alert" }, text) : null;
var Spinner = ({ text }) => (0, import_react3.createElement)("span", { className: "oc-qr-wait" }, (0, import_react3.createElement)("span", { className: "oc-spinner", "aria-hidden": true }), text);
function useUnfinished() {
  const unfinished = (0, import_react3.useRef)(null);
  (0, import_react3.useEffect)(() => () => {
    if (unfinished.current) void call("omni-channel-cancel", { id: unfinished.current }).catch(() => {
    });
  }, []);
  return unfinished;
}
function usePairing(channel, on2, onConnected) {
  const [pairing, setPairing] = (0, import_react3.useState)(null);
  const [problem, setProblem] = (0, import_react3.useState)(null);
  (0, import_react3.useEffect)(() => {
    if (!on2 || !channel) return void 0;
    let live = true;
    let timer = 0;
    const poll = async () => {
      try {
        const reply = await call("omni-channel-pairing", { id: channel.id });
        if (!live) return;
        setPairing(reply);
        setProblem(null);
        if (reply.connected) return onConnected(reply);
      } catch (error) {
        if (live) setProblem(error.message);
      }
      if (live) timer = setTimeout(poll, POLL_MS2);
    };
    void poll();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [on2, channel?.id]);
  return { pairing, problem };
}
function Connected({ type, channel, detail, omni: omni2, children }) {
  const info = CHANNEL_TYPES[type];
  return (0, import_react3.createElement)(
    import_react3.Fragment,
    null,
    (0, import_react3.createElement)("h2", null, t("{app} is connected", { app: info.label })),
    (0, import_react3.createElement)("p", null, [detail, t("New chats appear under your Bots. Nothing is sent to your contacts until Omni or you reply.")].filter(Boolean).join(" · ")),
    children,
    (0, import_react3.createElement)("div", { className: "oc-row" }, (0, import_react3.createElement)("button", { type: "button", className: "oc-primary", onClick: () => omni2.finishConnect(type, channel.name, channel.id) }, t("See its health")))
  );
}
function WhatsAppFlow({ type, omni: omni2, Tile: Tile2, PreviewChip: PreviewChip2 }) {
  const info = CHANNEL_TYPES[type];
  const [name, setName] = (0, import_react3.useState)("");
  const [channel, setChannel] = (0, import_react3.useState)(null);
  const [done, setDone] = (0, import_react3.useState)(null);
  const [busy, setBusy] = (0, import_react3.useState)(false);
  const [problem, setProblem] = (0, import_react3.useState)(null);
  const unfinished = useUnfinished();
  const { pairing, problem: pollProblem } = usePairing(channel, channel !== null && done === null, (reply) => {
    unfinished.current = null;
    setDone(reply);
  });
  const start = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const made = await call("omni-channel-create", { type, name: name.trim() || info.label });
      unfinished.current = made.id;
      setChannel(made);
    } catch (error) {
      setProblem(error.message);
    } finally {
      setBusy(false);
    }
  };
  const at2 = done ? 2 : channel ? 1 : 0;
  return (0, import_react3.createElement)(
    FlowShell,
    { type, at: at2, Tile: Tile2, PreviewChip: PreviewChip2, onBack: () => omni2.showPage({ type: null, step: 0 }) },
    done ? (0, import_react3.createElement)(Connected, { type, channel, detail: done.detail, omni: omni2 }) : channel ? (0, import_react3.createElement)(QrStep, { info, channel, pairing }) : (0, import_react3.createElement)(
      import_react3.Fragment,
      null,
      (0, import_react3.createElement)("h2", null, t("Name this number")),
      (0, import_react3.createElement)("p", null, t("So you can tell your channels apart, for example Sales or Personal.")),
      (0, import_react3.createElement)("label", { className: "oc-field" }, (0, import_react3.createElement)("span", null, t("Name")), (0, import_react3.createElement)("input", {
        value: name,
        placeholder: info.label,
        autoFocus: true,
        onChange: (event) => setName(event.target.value),
        onKeyDown: (event) => {
          if (event.key === "Enter" && !busy) void start();
        }
      })),
      (0, import_react3.createElement)("div", { className: "oc-row" }, (0, import_react3.createElement)("button", { type: "button", className: "oc-primary", disabled: busy, onClick: start }, busy ? t("Starting…") : t("Show the code")))
    ),
    (0, import_react3.createElement)(Problem, { text: problem ?? pollProblem })
  );
}
function QrStep({ info, channel, pairing }) {
  const [byPhone, setByPhone] = (0, import_react3.useState)(false);
  const [phone, setPhone] = (0, import_react3.useState)("");
  const [code, setCode] = (0, import_react3.useState)(null);
  const [problem, setProblem] = (0, import_react3.useState)(null);
  const askCode = async () => {
    setProblem(null);
    try {
      setCode((await call("omni-channel-phone-code", { id: channel.id, phone })).code);
    } catch (error) {
      setProblem(error.message);
    }
  };
  if (byPhone) {
    return (0, import_react3.createElement)(
      import_react3.Fragment,
      null,
      (0, import_react3.createElement)("h2", null, t("Link with a phone number")),
      code === null ? (0, import_react3.createElement)(
        import_react3.Fragment,
        null,
        (0, import_react3.createElement)("p", null, t("Omni shows an 8-character code. Type it on your phone instead of scanning.")),
        (0, import_react3.createElement)("label", { className: "oc-field" }, (0, import_react3.createElement)("span", null, t("Phone number with country code")), (0, import_react3.createElement)("input", { value: phone, inputMode: "tel", placeholder: "+55 11 91234-5678", onChange: (event) => setPhone(event.target.value), autoFocus: true })),
        (0, import_react3.createElement)("div", { className: "oc-row" }, (0, import_react3.createElement)("button", { type: "button", className: "oc-primary", disabled: phone.replace(/\D/g, "").length < 8, onClick: askCode }, t("Get code")))
      ) : (0, import_react3.createElement)(
        import_react3.Fragment,
        null,
        (0, import_react3.createElement)(
          "ol",
          { className: "oc-howto" },
          (0, import_react3.createElement)("li", null, t("On your phone, open {app} → Linked devices → Link a device", { app: info.label })),
          (0, import_react3.createElement)("li", null, t("Tap “Link with phone number instead”")),
          (0, import_react3.createElement)("li", null, t("Type this code"))
        ),
        (0, import_react3.createElement)("div", { className: "oc-code", "aria-label": t("Pairing code") }, code.split("").map((char, index) => (0, import_react3.createElement)("span", { key: index, "data-dash": char === "-" || void 0 }, char))),
        (0, import_react3.createElement)(Spinner, { text: t("Waiting for your phone…") })
      ),
      (0, import_react3.createElement)(Problem, { text: problem }),
      (0, import_react3.createElement)("button", { type: "button", className: "oc-link", onClick: () => {
        setByPhone(false);
        setCode(null);
      } }, t("Scan a QR code instead"))
    );
  }
  return (0, import_react3.createElement)(
    "div",
    { className: "oc-qr-row" },
    (0, import_react3.createElement)(
      "div",
      { className: "oc-qr" },
      pairing?.qr ? (0, import_react3.createElement)("span", { className: "oc-qr-code" }, (0, import_react3.createElement)(QrSvg, { text: pairing.qr, size: 196 })) : (0, import_react3.createElement)("span", { className: "oc-qr-empty" }, (0, import_react3.createElement)("span", { className: "oc-spinner", "aria-hidden": true }))
    ),
    (0, import_react3.createElement)(
      "div",
      { className: "oc-qr-side" },
      (0, import_react3.createElement)("h2", null, t("Scan with your phone")),
      (0, import_react3.createElement)(
        "ol",
        { className: "oc-howto" },
        (0, import_react3.createElement)("li", null, t("Open {app} → Settings → Linked devices", { app: info.label })),
        (0, import_react3.createElement)("li", null, t("Tap Link a device and point the camera here"))
      ),
      (0, import_react3.createElement)(Spinner, { text: pairing?.qr ? t("The code refreshes by itself") : t("Waiting for a code…") }),
      (0, import_react3.createElement)("button", { type: "button", className: "oc-link", onClick: () => setByPhone(true) }, t("No camera? Link with your number instead"))
    )
  );
}
var TOKEN_HELP = {
  telegram: () => (0, import_react3.createElement)(
    import_react3.Fragment,
    null,
    (0, import_react3.createElement)("h2", null, t("Make a Telegram bot for Omni")),
    (0, import_react3.createElement)(
      "ol",
      { className: "oc-numbered" },
      (0, import_react3.createElement)("li", null, rich("Open {bot} in Telegram", { bot: (0, import_react3.createElement)("a", { href: "https://t.me/BotFather", target: "_blank", rel: "noreferrer" }, "@BotFather") })),
      (0, import_react3.createElement)("li", null, rich("Send {command}, then pick a name and a username", { command: (0, import_react3.createElement)("code", null, "/newbot") })),
      (0, import_react3.createElement)("li", null, t("Copy the token it sends you and paste it here"))
    )
  ),
  discord: () => (0, import_react3.createElement)(
    import_react3.Fragment,
    null,
    (0, import_react3.createElement)("h2", null, t("Connect your Discord bot")),
    (0, import_react3.createElement)(
      "ol",
      { className: "oc-numbered" },
      (0, import_react3.createElement)("li", null, rich("In the {portal}, open your app → Bot", { portal: (0, import_react3.createElement)("a", { href: "https://discord.com/developers/applications", target: "_blank", rel: "noreferrer" }, t("Discord Developer Portal")) })),
      (0, import_react3.createElement)("li", null, t("Turn on Message Content Intent, then Reset Token and copy it"))
    )
  )
};
function TokenFlow({ type, omni: omni2, Tile: Tile2, PreviewChip: PreviewChip2 }) {
  const info = CHANNEL_TYPES[type];
  const [token, setToken] = (0, import_react3.useState)("");
  const [copied, setCopied] = (0, import_react3.useState)(null);
  const [channel, setChannel] = (0, import_react3.useState)(null);
  const [done, setDone] = (0, import_react3.useState)(null);
  const [invited, setInvited] = (0, import_react3.useState)(false);
  const [busy, setBusy] = (0, import_react3.useState)(false);
  const [problem, setProblem] = (0, import_react3.useState)(null);
  const unfinished = useUnfinished();
  const { pairing, problem: pollProblem } = usePairing(channel, channel !== null && done === null, (reply) => {
    unfinished.current = null;
    setDone(reply);
  });
  (0, import_react3.useEffect)(() => {
    if (type !== "telegram" || channel) return void 0;
    const onFocus = () => {
      if (token.trim() !== "" || !navigator.clipboard?.readText) return;
      void copiedTelegramToken(() => navigator.clipboard.readText()).then((found) => setCopied(found));
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [type, channel, token]);
  const connect = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const made = await call("omni-channel-create", { type, name: info.label, token: token.trim() });
      unfinished.current = made.id;
      setToken("");
      setChannel(made);
    } catch (error) {
      setProblem(error.message);
    } finally {
      setBusy(false);
    }
  };
  const at2 = type === "discord" ? invited ? 2 : done ? 1 : 0 : done ? 2 : 1;
  let body;
  if (done && type === "telegram") {
    const chat = telegramChat(done.detail);
    body = (0, import_react3.createElement)(
      Connected,
      { type, channel, detail: done.detail, omni: omni2 },
      chat ? (0, import_react3.createElement)("a", { className: "oc-secondary", href: chat, target: "_blank", rel: "noreferrer" }, t("Say hi to your bot")) : null
    );
  } else if (done && type === "discord" && !invited) {
    body = (0, import_react3.createElement)(
      import_react3.Fragment,
      null,
      (0, import_react3.createElement)("h2", null, t("Invite it to a server")),
      (0, import_react3.createElement)("p", null, t("One click: Discord asks which server, with the permissions Omni needs filled in.")),
      (0, import_react3.createElement)(
        "div",
        { className: "oc-row" },
        channel.inviteUrl ? (0, import_react3.createElement)("a", { className: "oc-primary", href: channel.inviteUrl, target: "_blank", rel: "noreferrer", onClick: () => setInvited(true) }, t("Invite to a server")) : null,
        (0, import_react3.createElement)("button", { type: "button", className: "oc-link", onClick: () => setInvited(true) }, channel.inviteUrl ? t("It is already on my server") : t("Continue"))
      )
    );
  } else if (done) {
    body = (0, import_react3.createElement)(Connected, { type, channel, detail: done.detail, omni: omni2 });
  } else if (channel) {
    body = (0, import_react3.createElement)(import_react3.Fragment, null, (0, import_react3.createElement)("h2", null, t("Connecting…")), (0, import_react3.createElement)(Spinner, { text: pairing?.message ?? t("Waiting for Omni to say the bot is up") }));
  } else {
    body = (0, import_react3.createElement)(
      import_react3.Fragment,
      null,
      TOKEN_HELP[type](),
      copied ? (0, import_react3.createElement)(
        "div",
        { className: "oc-suggest" },
        (0, import_react3.createElement)("span", null, t("Use the token you just copied?")),
        (0, import_react3.createElement)("button", { type: "button", className: "oc-secondary", onClick: () => {
          setToken(copied);
          setCopied(null);
        } }, t("Use it"))
      ) : null,
      (0, import_react3.createElement)("label", { className: "oc-field" }, (0, import_react3.createElement)("span", null, t("Bot token")), (0, import_react3.createElement)("input", {
        type: "password",
        value: token,
        autoComplete: "off",
        autoFocus: true,
        placeholder: type === "telegram" ? "123456:ABC-DEF…" : "MTA…",
        onChange: (event) => setToken(event.target.value),
        onKeyDown: (event) => {
          if (event.key === "Enter" && token.trim().length >= 8 && !busy) void connect();
        }
      })),
      (0, import_react3.createElement)("div", { className: "oc-row" }, (0, import_react3.createElement)("button", { type: "button", className: "oc-primary", disabled: token.trim().length < 8 || busy, onClick: connect }, busy ? t("Connecting…") : type === "discord" ? t("Continue") : t("Connect"))),
      (0, import_react3.createElement)("p", { className: "oc-fine" }, type === "telegram" ? t("Next we show a link to your bot so you can send it a first message.") : t("Next: one click to invite it to your server."))
    );
  }
  return (0, import_react3.createElement)(FlowShell, { type, at: at2, Tile: Tile2, PreviewChip: PreviewChip2, onBack: () => omni2.showPage({ type: null, step: 0 }) }, body, (0, import_react3.createElement)(Problem, { text: problem ?? pollProblem }));
}
function SlackFlow({ type, omni: omni2, Tile: Tile2, PreviewChip: PreviewChip2 }) {
  const [app, setApp] = (0, import_react3.useState)(void 0);
  const [mode, setMode] = (0, import_react3.useState)("bot");
  const [flow, setFlow] = (0, import_react3.useState)(null);
  const [done, setDone] = (0, import_react3.useState)(null);
  const [problem, setProblem] = (0, import_react3.useState)(null);
  (0, import_react3.useEffect)(() => {
    let live = true;
    call("omni-slack-app").then((reply) => {
      if (live) setApp(reply.configured);
    }, () => {
      if (live) setApp(null);
    });
    return () => {
      live = false;
    };
  }, []);
  (0, import_react3.useEffect)(() => {
    if (!flow) return void 0;
    let live = true;
    let timer = 0;
    const poll = async () => {
      try {
        const reply = await call("omni-slack-result", { nonce: flow.nonce });
        if (!live) return;
        if (reply.status === "done") return setDone({ id: reply.id });
        if (reply.status === "error") {
          setFlow(null);
          return setProblem(reply.message);
        }
      } catch (error) {
        if (live) setProblem(error.message);
      }
      if (live) timer = setTimeout(poll, POLL_MS2);
    };
    timer = setTimeout(poll, POLL_MS2);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [flow?.nonce]);
  const start = async () => {
    setProblem(null);
    try {
      const reply = await call("omni-slack-start", { mode });
      if (!reply.configured) return setApp(false);
      setFlow(reply);
      window.open(reply.authorizeUrl, "_blank", "noopener,noreferrer");
    } catch (error) {
      setProblem(error.message);
    }
  };
  const at2 = done ? 2 : flow ? 1 : 0;
  const channel = done ? { id: done.id, name: "Slack" } : null;
  let body;
  if (app === false) {
    body = (0, import_react3.createElement)(
      import_react3.Fragment,
      null,
      (0, import_react3.createElement)("h2", null, t("Slack isn't set up on this Omni yet")),
      (0, import_react3.createElement)("p", null, t("Your Omni's owner sets up its Slack app once in Omni's settings. After that, everyone connects with one button here."))
    );
  } else if (done) {
    body = (0, import_react3.createElement)(Connected, { type, channel, detail: mode === "bot" ? t("As a bot") : t("As you"), omni: omni2 });
  } else if (flow) {
    body = (0, import_react3.createElement)(
      import_react3.Fragment,
      null,
      (0, import_react3.createElement)("h2", null, t("Approve in Slack")),
      (0, import_react3.createElement)("p", null, t("Slack opened in your browser. Pick the workspace and allow Omni; this page goes on by itself.")),
      (0, import_react3.createElement)(Spinner, { text: t("Waiting for Slack…") }),
      (0, import_react3.createElement)(
        "div",
        { className: "oc-row" },
        (0, import_react3.createElement)("a", { className: "oc-link", href: flow.authorizeUrl, target: "_blank", rel: "noreferrer" }, t("Open Slack again")),
        (0, import_react3.createElement)("button", { type: "button", className: "oc-link", onClick: () => setFlow(null) }, t("Start over"))
      )
    );
  } else {
    body = (0, import_react3.createElement)(
      import_react3.Fragment,
      null,
      (0, import_react3.createElement)("h2", null, t("How should Omni join your workspace?")),
      (0, import_react3.createElement)("p", null, t("You can change this later by connecting again.")),
      (0, import_react3.createElement)(
        "div",
        { className: "oc-seg", role: "radiogroup", "aria-label": t("How Omni joins Slack") },
        [
          ["bot", t("As a bot"), t("Omni shows up as its own app. People @mention it, and it only sees channels it is invited to.")],
          ["user", t("As yourself"), t("Omni reads and replies as you, in your DMs and channels, and can search them.")]
        ].map(([value, title, text]) => (0, import_react3.createElement)("button", {
          key: value,
          type: "button",
          role: "radio",
          "aria-checked": mode === value,
          className: "oc-seg-opt",
          onClick: () => setMode(value)
        }, (0, import_react3.createElement)("strong", null, title), (0, import_react3.createElement)("span", null, text)))
      ),
      (0, import_react3.createElement)(
        "div",
        { className: "oc-row" },
        (0, import_react3.createElement)("button", { type: "button", className: "oc-brand", style: { background: "#4A154B" }, disabled: app === void 0, onClick: start }, t("Connect with Slack")),
        (0, import_react3.createElement)("span", { className: "oc-fine" }, t("Opens Slack in your browser."))
      )
    );
  }
  return (0, import_react3.createElement)(FlowShell, { type, at: at2, Tile: Tile2, PreviewChip: PreviewChip2, onBack: () => omni2.showPage({ type: null, step: 0 }) }, body, (0, import_react3.createElement)(Problem, { text: problem }));
}
function BusinessFlow({ type, omni: omni2, Tile: Tile2, PreviewChip: PreviewChip2 }) {
  const info = CHANNEL_TYPES[type];
  const [fields, setFields] = (0, import_react3.useState)({ accessToken: "", phoneNumberId: "", wabaId: "" });
  const [channel, setChannel] = (0, import_react3.useState)(null);
  const [busy, setBusy] = (0, import_react3.useState)(false);
  const [problem, setProblem] = (0, import_react3.useState)(null);
  const set2 = (key) => (event) => setFields((value) => ({ ...value, [key]: event.target.value }));
  const ready = fields.accessToken.trim().length >= 8 && /^\d{5,25}$/.test(fields.phoneNumberId.trim()) && /^\d{5,25}$/.test(fields.wabaId.trim());
  const connect = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const made = await call("omni-wab-connect", { name: info.label, accessToken: fields.accessToken.trim(), phoneNumberId: fields.phoneNumberId.trim(), wabaId: fields.wabaId.trim() });
      setFields({ accessToken: "", phoneNumberId: "", wabaId: "" });
      setChannel(made);
    } catch (error) {
      setProblem(error.message);
    } finally {
      setBusy(false);
    }
  };
  const field = (key, label, extra) => (0, import_react3.createElement)("label", { className: "oc-field" }, (0, import_react3.createElement)("span", null, label), (0, import_react3.createElement)("input", { value: fields[key], onChange: set2(key), autoComplete: "off", ...extra }));
  return (0, import_react3.createElement)(
    FlowShell,
    { type, at: channel ? 1 : 0, Tile: Tile2, PreviewChip: PreviewChip2, onBack: () => omni2.showPage({ type: null, step: 0 }) },
    channel ? (0, import_react3.createElement)(Connected, { type, channel, omni: omni2 }) : (0, import_react3.createElement)(
      import_react3.Fragment,
      null,
      (0, import_react3.createElement)("h2", null, t("Connect your Business number")),
      (0, import_react3.createElement)("p", null, rich("Find these in Meta's {manager} → API setup.", { manager: (0, import_react3.createElement)("a", { href: "https://business.facebook.com/wa/manage/home/", target: "_blank", rel: "noreferrer" }, t("WhatsApp Manager")) })),
      field("accessToken", t("Access token"), { type: "password", placeholder: "EAAG…", autoFocus: true }),
      field("phoneNumberId", t("Phone number ID"), { inputMode: "numeric", placeholder: "123456789012345" }),
      field("wabaId", t("WhatsApp Business Account ID"), { inputMode: "numeric", placeholder: "987654321098765" }),
      (0, import_react3.createElement)("div", { className: "oc-row" }, (0, import_react3.createElement)("button", { type: "button", className: "oc-primary", disabled: !ready || busy, onClick: connect }, busy ? t("Connecting…") : t("Connect"))),
      (0, import_react3.createElement)("p", { className: "oc-fine" }, t("The token stays with your Omni. Omni only gets that number's messages."))
    ),
    (0, import_react3.createElement)(Problem, { text: problem })
  );
}

// src/client/channels.js
var import_react4 = require("react");
var { ArrowUpIcon, ChevronLeftIcon: ChevronLeftIcon2, ChevronRightIcon, PlusIcon } = icons;
var useOmni = () => (0, import_react4.useSyncExternalStore)(omniStore.subscribe, omniStore.getSnapshot, omniStore.getSnapshot);
var useActions = (actions) => (0, import_react4.useMemo)(() => omniActions((id) => actions.selectPanel(id), call), [actions]);
var stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round", strokeLinejoin: "round" };
var GLYPHS = {
  whatsapp: () => [
    (0, import_react4.createElement)("path", { key: "b", d: "M12 3.6a8.4 8.4 0 0 0-7.2 12.8L3.7 20.3l4-1.1A8.4 8.4 0 1 0 12 3.6z", ...stroke }),
    (0, import_react4.createElement)("path", { key: "p", d: "M9.2 8.3c-.3 0-.7.1-.9.5-.3.5-.5 1.2-.2 2.1.6 1.8 2.3 3.5 4.1 4.1.9.3 1.6.1 2.1-.2.4-.2.5-.6.5-.9l-.1-.4-1.6-.8-.9 1c-1-.4-1.9-1.3-2.3-2.3l1-.9-.8-1.6z", fill: "currentColor" })
  ],
  telegram: () => [
    (0, import_react4.createElement)("path", { key: "a", d: "M20.5 4.5 3.5 11.2l5.3 1.9 2 6.1 3-3.3 4.4 3.3z", ...stroke }),
    (0, import_react4.createElement)("path", { key: "b", d: "M8.8 13.1 16.8 8", ...stroke })
  ],
  slack: () => [(0, import_react4.createElement)("path", { key: "a", d: "M9.5 4.5v6M14.5 13.5v6M4.5 14.5h6M13.5 9.5h6", ...stroke, strokeWidth: 2.8 })],
  chat: () => [(0, import_react4.createElement)("path", { key: "a", d: "M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v8.5A1.5 1.5 0 0 1 19 17H10l-4.5 3.5V17H5a1.5 1.5 0 0 1-1.5-1.5V7A1.5 1.5 0 0 1 5 5.5z", ...stroke })],
  discord: () => [
    (0, import_react4.createElement)("path", { key: "a", d: "M7.6 7.2c2.9-1.2 5.9-1.2 8.8 0 1.5 2.4 2.1 5 1.9 8-1.6 1.2-3.1 1.8-4.2 2l-.8-1.5m-2.6 0-.8 1.5c-1.1-.2-2.6-.8-4.2-2-.2-3 .4-5.6 1.9-8z", ...stroke }),
    (0, import_react4.createElement)("circle", { key: "l", cx: 9.6, cy: 12.4, r: 1.3, fill: "currentColor" }),
    (0, import_react4.createElement)("circle", { key: "r", cx: 14.4, cy: 12.4, r: 1.3, fill: "currentColor" })
  ]
};
function Tile({ type, size = 40, ring = false }) {
  return (0, import_react4.createElement)("span", {
    className: `oc-tile${ring ? " oc-tile-ring" : ""}`,
    style: { width: size, height: size, borderRadius: Math.round(size * 0.32), background: typeOf(type).tile }
  }, (0, import_react4.createElement)("svg", { width: Math.round(size * 0.62), height: Math.round(size * 0.62), viewBox: "0 0 24 24", "aria-hidden": true, focusable: "false" }, (GLYPHS[typeOf(type).glyph] ?? GLYPHS.chat)()));
}
var StatusDot = ({ status }) => (0, import_react4.createElement)("span", { className: "oc-dot", "data-tone": STATUS[status].tone, "aria-hidden": true });
var StatusPill = ({ status }) => (0, import_react4.createElement)(
  "span",
  { className: "oc-pill", "data-tone": STATUS[status].tone },
  (0, import_react4.createElement)("span", { className: "oc-pill-dot", "aria-hidden": true }),
  t(STATUS[status].label)
);
var HUES = [168, 200, 222, 262, 290, 330, 18, 38, 140];
function hueOf(name) {
  let sum = 0;
  for (const char of name) sum = sum * 31 + char.charCodeAt(0) >>> 0;
  return HUES[sum % HUES.length];
}
function ChatAvatar({ chat, channel, size = 36 }) {
  const hue = hueOf(chat.name);
  return (0, import_react4.createElement)(
    "span",
    { className: "oc-ava", style: { width: size, height: size, "--oc-hue": hue } },
    (0, import_react4.createElement)("span", { className: "oc-ava-face", style: { fontSize: Math.round(size * 0.34) } }, chat.initials),
    chat.avatarUrl ? (0, import_react4.createElement)("img", { className: "oc-ava-img", src: chat.avatarUrl, alt: "", loading: "lazy", referrerPolicy: "no-referrer", onError: (event) => {
      event.currentTarget.remove();
    } }) : null,
    channel ? (0, import_react4.createElement)("span", { className: "oc-ava-badge" }, (0, import_react4.createElement)(Tile, { type: channel.type, size: Math.round(size * 0.4) })) : null
  );
}
function PreviewChip() {
  const source = useOmni().source;
  if (source.kind === "live") {
    return (0, import_react4.createElement)(
      "span",
      { className: "oc-preview-chip oc-live-chip", "data-error": source.error ? true : void 0, title: source.error ?? t("Read from omni every 15 seconds.") },
      (0, import_react4.createElement)("span", { className: "oc-live-dot", "aria-hidden": true }),
      source.error ? t("Live · last refresh failed") : t("Live · {origin}", { origin: source.origin })
    );
  }
  const missing = source.missing?.join(", ");
  return (0, import_react4.createElement)(
    "button",
    { type: "button", className: "oc-preview-chip oc-chip-action", onClick: openConnectWizard, title: missing ? t("Sample data until DSH has {missing}.", { missing }) : t("Nothing here reaches a real channel yet.") },
    t("Preview · sample data"),
    (0, import_react4.createElement)("span", { className: "oc-chip-go" }, t("Connect your Omni"))
  );
}
var dayKey = (at2) => new Date(at2).toDateString();
function dayLabel(at2) {
  const today = /* @__PURE__ */ new Date();
  if (dayKey(at2) === today.toDateString()) return t("Today");
  if (dayKey(at2) === new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1).toDateString()) return t("Yesterday");
  return new Date(at2).toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
}
function ChatPage({ actions }) {
  const state = useOmni();
  const omni2 = useActions(actions);
  const chat = chatOf(state, state.chatId);
  const channel = chat ? channelOf(state, chat.channelId) : void 0;
  const loaded = chat ? state.messages[chat.id] : void 0;
  const loading = chat !== void 0 && loaded === void 0 && !state.preview;
  const messages = chat ? loaded ?? (state.preview ? [{ id: "preview", from: "them", text: chat.preview, at: chat.at }] : []) : [];
  const scroller = (0, import_react4.useRef)(null);
  const [draft, setDraft] = (0, import_react4.useState)("");
  (0, import_react4.useLayoutEffect)(() => {
    const node = scroller.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [chat?.id, messages.length]);
  (0, import_react4.useEffect)(() => {
    setDraft("");
  }, [chat?.id]);
  if (!chat || !channel) {
    return (0, import_react4.createElement)("div", { className: "oc-page oc-chat-empty" }, (0, import_react4.createElement)(OmniMark, { size: 40 }), (0, import_react4.createElement)("p", null, t("Pick a chat under your Bots.")));
  }
  const type = typeOf(channel.type);
  const writable = canSend(state);
  const live = channel.status === "connected" && writable;
  const send = () => {
    omni2.sendText(chat.id, draft);
    setDraft("");
  };
  const failed = state.sendError?.chatId === chat.id ? state.sendError : null;
  return (0, import_react4.createElement)(
    "div",
    { className: "oc-page oc-chat" },
    (0, import_react4.createElement)(
      "header",
      { className: "oc-chat-head" },
      (0, import_react4.createElement)(ChatAvatar, { chat, channel, size: 40 }),
      (0, import_react4.createElement)(
        "div",
        { className: "oc-chat-who" },
        (0, import_react4.createElement)("strong", null, chat.name),
        (0, import_react4.createElement)("span", null, `${type.label} · ${channel.name}`)
      ),
      (0, import_react4.createElement)(
        "span",
        { className: "oc-answer", "data-by": channel.answeredBy === "Omni" ? "omni" : "you" },
        channel.answeredBy === "Omni" ? (0, import_react4.createElement)(import_react4.Fragment, null, (0, import_react4.createElement)(OmniMark, { size: 14 }), t("Omni answers here")) : t("You answer here")
      ),
      (0, import_react4.createElement)("button", { type: "button", className: "oc-ghost", onClick: () => omni2.openChannels("channel", channel.id) }, (0, import_react4.createElement)(StatusDot, { status: channel.status }), t("Channel health")),
      (0, import_react4.createElement)(PreviewChip)
    ),
    (0, import_react4.createElement)(
      "div",
      { ref: scroller, className: "oc-thread", role: "log", "aria-label": t("Conversation with {name}", { name: chat.name }) },
      (0, import_react4.createElement)(
        "div",
        { className: "oc-thread-in" },
        loading ? (0, import_react4.createElement)("div", { className: "oc-day" }, (0, import_react4.createElement)("span", { className: "oc-spinner", "aria-hidden": true }), t("Loading messages…")) : null,
        messages.map((message, index) => {
          const mine = message.from !== "them";
          const newDay = index === 0 || dayKey(messages[index - 1].at) !== dayKey(message.at);
          const first = newDay || messages[index - 1].from !== message.from || messages[index - 1].author !== message.author;
          return (0, import_react4.createElement)(import_react4.Fragment, { key: message.id }, newDay ? (0, import_react4.createElement)("div", { className: "oc-day" }, dayLabel(message.at)) : null, (0, import_react4.createElement)(
            "div",
            { className: `oc-msg oc-msg-${message.from}${first ? " oc-msg-first" : ""}` },
            first && !mine && message.author ? (0, import_react4.createElement)("span", { className: "oc-msg-author" }, message.author) : null,
            first && message.from === "omni" ? (0, import_react4.createElement)("span", { className: "oc-msg-author oc-msg-omni" }, (0, import_react4.createElement)(OmniMark, { size: 12 }), "Omni") : null,
            (0, import_react4.createElement)("div", { className: "oc-bubble", "data-sending": message.sending || void 0 }, message.text, (0, import_react4.createElement)("time", null, message.sending ? t("Sending…") : new Date(message.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })))
          ));
        })
      )
    ),
    (0, import_react4.createElement)(
      "footer",
      { className: "oc-compose-wrap" },
      failed ? (0, import_react4.createElement)("button", { type: "button", className: "oc-compose-note oc-compose-fail", role: "alert", onClick: () => setDraft(failed.text) }, t("Not sent: {reason}", { reason: failed.message }), " ", (0, import_react4.createElement)("u", null, t("Put it back"))) : null,
      !writable ? (0, import_react4.createElement)("div", { className: "oc-compose-note oc-compose-info" }, t("This device's key can't send messages; ask your Omni's owner.")) : live ? null : (0, import_react4.createElement)(
        "button",
        { type: "button", className: "oc-compose-note", onClick: () => omni2.openChannels("channel", channel.id) },
        (0, import_react4.createElement)(StatusDot, { status: channel.status }),
        t("{name} is not connected. Fix it to reply.", { name: channel.name })
      ),
      (0, import_react4.createElement)(
        "div",
        { className: "oc-compose", "data-off": live ? void 0 : true },
        (0, import_react4.createElement)("textarea", {
          rows: 1,
          value: draft,
          disabled: !live,
          placeholder: t("Reply on {channel}", { channel: type.label }),
          "aria-label": t("Reply"),
          onChange: (event) => setDraft(event.target.value),
          onKeyDown: (event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              send();
            }
          }
        }),
        (0, import_react4.createElement)("button", { type: "button", className: "oc-send", disabled: !live || draft.trim() === "", "aria-label": t("Send"), onClick: send }, (0, import_react4.createElement)(ArrowUpIcon))
      )
    )
  );
}
function ChannelsPage({ actions }) {
  const state = useOmni();
  const omni2 = useActions(actions);
  const { page } = state;
  const channel = page.view === "channel" ? channelOf(state, page.channelId) : void 0;
  return (0, import_react4.createElement)(
    "div",
    { className: "oc-page oc-channels" },
    (0, import_react4.createElement)(
      "div",
      { className: "oc-channels-in" },
      page.view === "connect" ? (0, import_react4.createElement)(ConnectFlow, { state, omni: omni2 }) : channel ? (0, import_react4.createElement)(ChannelDetail, { channel, state, omni: omni2 }) : (0, import_react4.createElement)(Overview, { state, omni: omni2 })
    )
  );
}
function Overview({ state, omni: omni2 }) {
  const summary = healthSummary(state);
  const troubled = state.channels.filter((channel) => channel.status === "attention" || channel.status === "connecting");
  const replies = state.channels.map((channel) => channel.health?.replyMedianSec).filter((value) => typeof value === "number");
  const median = replies.length === 0 ? null : Math.round(replies.reduce((a, b2) => a + b2, 0) / replies.length);
  return (0, import_react4.createElement)(
    import_react4.Fragment,
    null,
    (0, import_react4.createElement)(
      "header",
      { className: "oc-head" },
      (0, import_react4.createElement)(
        "div",
        null,
        (0, import_react4.createElement)("h1", null, t("Channels"), (0, import_react4.createElement)(PreviewChip)),
        (0, import_react4.createElement)("p", null, t("Connect the apps people already use to reach you. Omni answers there, and every chat shows up under your Bots."))
      ),
      (0, import_react4.createElement)("button", { type: "button", className: "oc-primary", disabled: !canWrite(state), title: canWrite(state) ? void 0 : t("This device's key can't change channels; ask your Omni's owner."), onClick: () => omni2.showPage({ view: "connect", type: null, step: 0 }) }, (0, import_react4.createElement)(PlusIcon), t("Add channel"))
    ),
    // Sample data means no Omni is linked yet: connecting one comes first, in the Connect
    // wizard (wizard.js). A linked one says when an update is out.
    state.preview ? (0, import_react4.createElement)(ConnectPrompt) : (0, import_react4.createElement)(UpdateBar, { origin: state.source.origin }),
    troubled.map((channel) => (0, import_react4.createElement)(
      "button",
      { key: channel.id, type: "button", className: "oc-callout", "data-tone": STATUS[channel.status].tone, onClick: () => omni2.showPage({ view: "channel", channelId: channel.id }) },
      (0, import_react4.createElement)(Tile, { type: channel.type, size: 36 }),
      (0, import_react4.createElement)(
        "span",
        { className: "oc-callout-text" },
        (0, import_react4.createElement)("strong", null, t("{name} needs attention", { name: `${typeOf(channel.type).label} · ${channel.name}` })),
        (0, import_react4.createElement)("span", null, channel.problem ?? t(STATUS[channel.status].label))
      ),
      (0, import_react4.createElement)("span", { className: "oc-callout-go" }, t("Fix now"), (0, import_react4.createElement)(ChevronRightIcon))
    )),
    (0, import_react4.createElement)(
      "div",
      { className: "oc-stats" },
      (0, import_react4.createElement)(Stat, { value: `${summary.connected}/${summary.total}`, label: t("connected") }),
      (0, import_react4.createElement)(Stat, { value: String(summary.attention), label: t("need attention"), tone: summary.attention > 0 ? "warn" : void 0 }),
      state.preview ? (0, import_react4.createElement)(Stat, { value: String(summary.messagesToday), label: t("messages today") }) : (0, import_react4.createElement)(Stat, { value: String(state.chats.length), label: t("recent chats") }),
      state.preview ? (0, import_react4.createElement)(Stat, { value: median === null ? "–" : median < 60 ? t("{n} s", { n: median }) : t("{n} min", { n: Math.round(median / 60) }), label: t("typical reply") }) : (0, import_react4.createElement)(Stat, { value: String(unreadOf(state)), label: t("unread") })
    ),
    (0, import_react4.createElement)("h2", { className: "oc-section" }, t("Your channels")),
    state.channels.length === 0 ? (0, import_react4.createElement)("div", { className: "oc-empty" }, t("No channels yet. Add one to start.")) : (0, import_react4.createElement)("div", { className: "oc-cards" }, state.channels.map((channel) => (0, import_react4.createElement)(ChannelCard, { key: channel.id, channel, state, omni: omni2 })))
  );
}
var Stat = ({ value, label, tone }) => (0, import_react4.createElement)("div", { className: "oc-stat", "data-tone": tone }, (0, import_react4.createElement)("strong", null, value), (0, import_react4.createElement)("span", null, label));
function Spark({ week }) {
  const top = Math.max(1, ...week);
  return (0, import_react4.createElement)("span", { className: "oc-spark", "aria-hidden": true }, week.map((value, index) => (0, import_react4.createElement)("span", { key: index, style: { height: `${Math.max(8, value / top * 100)}%` }, "data-zero": value === 0 || void 0 })));
}
function ChannelCard({ channel, state, omni: omni2 }) {
  const unread = unreadOf(state, channel.id);
  return (0, import_react4.createElement)(
    "button",
    { type: "button", className: "oc-card", onClick: () => omni2.showPage({ view: "channel", channelId: channel.id }) },
    (0, import_react4.createElement)(
      "span",
      { className: "oc-card-top" },
      (0, import_react4.createElement)(Tile, { type: channel.type, size: 42 }),
      (0, import_react4.createElement)("span", { className: "oc-card-who" }, (0, import_react4.createElement)("strong", null, channel.name), (0, import_react4.createElement)("span", null, `${typeOf(channel.type).label} · ${channel.detail}`)),
      (0, import_react4.createElement)(StatusPill, { status: channel.status })
    ),
    (0, import_react4.createElement)(
      "span",
      { className: "oc-card-bottom" },
      channel.health.week ? (0, import_react4.createElement)(Spark, { week: channel.health.week }) : null,
      (0, import_react4.createElement)(
        "span",
        { className: "oc-card-facts" },
        channel.health.messagesToday === null ? null : (0, import_react4.createElement)("span", null, t("{n} today", { n: channel.health.messagesToday })),
        (0, import_react4.createElement)("span", null, channel.health.lastEventAt ? t("last message {time}", { time: relativeShort(channel.health.lastEventAt) }) : t("no messages yet")),
        unread > 0 ? (0, import_react4.createElement)("span", { className: "oc-card-unread" }, t("{n} unread", { n: unread })) : null
      )
    )
  );
}
var replyText = (seconds) => seconds === null ? "–" : seconds < 60 ? t("{n} s", { n: seconds }) : t("{n} min", { n: Math.round(seconds / 60) });
function ChannelDetail({ channel, state, omni: omni2 }) {
  const [confirming, setConfirming] = (0, import_react4.useState)(false);
  (0, import_react4.useEffect)(() => {
    setConfirming(false);
  }, [channel.id]);
  const type = typeOf(channel.type);
  const writable = canWrite(state);
  const { health } = channel;
  const firstChat = visibleChats({ ...state, filter: channel.id })[0];
  const chats = state.chats.filter((chat) => chat.channelId === channel.id);
  const troubled = channel.status === "attention" || channel.status === "connecting";
  return (0, import_react4.createElement)(
    import_react4.Fragment,
    null,
    (0, import_react4.createElement)("button", { type: "button", className: "oc-back", onClick: () => omni2.showPage({ view: "overview", channelId: null }) }, (0, import_react4.createElement)(ChevronLeftIcon2), t("Channels")),
    (0, import_react4.createElement)(
      "header",
      { className: "oc-detail-head" },
      (0, import_react4.createElement)(Tile, { type: channel.type, size: 56 }),
      (0, import_react4.createElement)(
        "div",
        { className: "oc-detail-who" },
        (0, import_react4.createElement)("h1", null, channel.name),
        (0, import_react4.createElement)("p", null, `${type.label} · ${channel.detail}`)
      ),
      (0, import_react4.createElement)(StatusPill, { status: channel.status })
    ),
    troubled ? (0, import_react4.createElement)(
      "div",
      { className: "oc-callout oc-callout-static", "data-tone": STATUS[channel.status].tone },
      (0, import_react4.createElement)(
        "span",
        { className: "oc-callout-text" },
        (0, import_react4.createElement)("strong", null, channel.status === "connecting" ? t("Reconnecting…") : t("This channel stopped working")),
        (0, import_react4.createElement)("span", null, channel.status === "connecting" ? t("Omni is bringing {name} back. Messages sent meanwhile are delivered after.", { name: channel.name }) : channel.problem)
      ),
      writable && channel.status === "attention" && type.pairing !== "token" ? (0, import_react4.createElement)("button", { type: "button", className: "oc-primary", disabled: Boolean(channel.busy), onClick: () => omni2.reconnect(channel.id) }, channel.busy === "reconnect" ? t("Reconnecting…") : t("Reconnect")) : null,
      channel.status === "connecting" || channel.busy ? (0, import_react4.createElement)("span", { className: "oc-spinner", "aria-hidden": true }) : null
    ) : null,
    channel.actionError ? (0, import_react4.createElement)("p", { className: "oc-problem", role: "alert" }, channel.actionError) : null,
    writable && channel.status === "attention" && type.pairing === "token" ? (0, import_react4.createElement)(TokenFix, { channel, type, omni: omni2 }) : null,
    (0, import_react4.createElement)(
      "div",
      { className: "oc-actions" },
      firstChat ? (0, import_react4.createElement)("button", { type: "button", className: "oc-secondary", onClick: () => {
        omni2.setFilter(channel.id);
        omni2.openChat(firstChat.id);
      } }, t("Open chats")) : null,
      !writable ? null : channel.status === "paused" ? (0, import_react4.createElement)("button", { type: "button", className: "oc-secondary", disabled: Boolean(channel.busy), onClick: () => omni2.resume(channel.id) }, channel.busy === "resume" ? t("Resuming…") : t("Resume")) : channel.status === "connected" ? (0, import_react4.createElement)("button", { type: "button", className: "oc-secondary", disabled: Boolean(channel.busy), onClick: () => omni2.pause(channel.id) }, channel.busy === "pause" ? t("Pausing…") : t("Pause")) : null
    ),
    (0, import_react4.createElement)("h2", { className: "oc-section" }, t("Health")),
    (0, import_react4.createElement)(
      "div",
      { className: "oc-stats" },
      health.uptime === null ? (0, import_react4.createElement)(Stat, { value: t(STATUS[channel.status].label), label: t("right now"), tone: channel.status === "connected" ? void 0 : "warn" }) : (0, import_react4.createElement)(Stat, { value: `${(health.uptime * 100).toFixed(health.uptime === 1 ? 0 : 1)}%`, label: t("online, last 7 days"), tone: health.uptime < 0.95 ? "warn" : void 0 }),
      health.messagesToday === null ? (0, import_react4.createElement)(Stat, { value: String(chats.reduce((sum, chat) => sum + chat.unread, 0)), label: t("unread") }) : (0, import_react4.createElement)(Stat, { value: String(health.messagesToday), label: t("messages today") }),
      health.replyMedianSec === null && health.lastSeenAt ? (0, import_react4.createElement)(Stat, { value: relativeShort(health.lastSeenAt), label: t("last seen online") }) : (0, import_react4.createElement)(Stat, { value: replyText(health.replyMedianSec), label: t("typical reply") }),
      (0, import_react4.createElement)(Stat, { value: health.lastEventAt ? relativeShort(health.lastEventAt) : "–", label: t("last message") })
    ),
    health.week ? (0, import_react4.createElement)(WeekChart, { week: health.week }) : null,
    (0, import_react4.createElement)("h2", { className: "oc-section" }, t("Who answers")),
    // Who answers is the agent omni routes a channel to; on a live Omni, Omni changes that by talking.
    state.preview ? (0, import_react4.createElement)(
      "div",
      { className: "oc-seg", role: "radiogroup", "aria-label": t("Who answers") },
      [["Omni", t("Omni answers"), t("Omni replies on its own and hands over when it should.")], ["You", t("You answer"), t("Chats wait for you. Omni only drafts.")]].map(([value, title, text]) => (0, import_react4.createElement)("button", {
        key: value,
        type: "button",
        role: "radio",
        "aria-checked": channel.answeredBy === value,
        className: "oc-seg-opt",
        onClick: () => omni2.setAnsweredBy(channel.id, value)
      }, (0, import_react4.createElement)("strong", null, value === "Omni" ? (0, import_react4.createElement)(OmniMark, { size: 16 }) : null, title), (0, import_react4.createElement)("span", null, text)))
    ) : (0, import_react4.createElement)("div", { className: "oc-seg-opt oc-seg-static" }, channel.answeredBy === "Omni" ? (0, import_react4.createElement)(import_react4.Fragment, null, (0, import_react4.createElement)("strong", null, (0, import_react4.createElement)(OmniMark, { size: 16 }), t("Omni answers")), (0, import_react4.createElement)("span", null, t("An agent is assigned to this channel in omni."))) : (0, import_react4.createElement)(import_react4.Fragment, null, (0, import_react4.createElement)("strong", null, t("You answer")), (0, import_react4.createElement)("span", null, t("No agent is assigned to this channel in omni.")))),
    state.preview ? (0, import_react4.createElement)(
      "div",
      { className: "oc-danger" },
      (0, import_react4.createElement)("div", null, (0, import_react4.createElement)("strong", null, t("Disconnect {name}", { name: channel.name })), (0, import_react4.createElement)("span", null, t("Omni stops reading and answering here. Its chats leave the sidebar."))),
      (0, import_react4.createElement)("button", {
        type: "button",
        className: confirming ? "oc-danger-go oc-danger-armed" : "oc-danger-go",
        onClick: () => confirming ? omni2.remove(channel.id) : setConfirming(true),
        onBlur: () => setConfirming(false)
      }, confirming ? t("Click again to disconnect") : t("Disconnect"))
    ) : null
  );
}
function WeekChart({ week }) {
  const days = [6, 5, 4, 3, 2, 1, 0].map((back) => new Date(Date.now() - back * 864e5).toLocaleDateString([], { weekday: "short" }));
  const top = Math.max(1, ...week);
  return (0, import_react4.createElement)(
    "div",
    { className: "oc-chart", role: "img", "aria-label": t("Messages per day, last 7 days: {list}", { list: week.join(", ") }) },
    week.map((value, index) => (0, import_react4.createElement)(
      "span",
      { key: index, className: "oc-chart-col" },
      (0, import_react4.createElement)("span", { className: "oc-chart-n" }, value > 0 ? String(value) : ""),
      (0, import_react4.createElement)("span", { className: "oc-chart-bar", style: { height: `${Math.max(3, value / top * 100)}%` }, "data-zero": value === 0 || void 0 }),
      (0, import_react4.createElement)("span", { className: "oc-chart-day" }, days[index])
    ))
  );
}
function ConnectFlow({ state, omni: omni2 }) {
  return state.preview ? (0, import_react4.createElement)(PreviewConnectFlow, { state, omni: omni2 }) : (0, import_react4.createElement)(LiveConnectFlow, { state, omni: omni2, Tile, PreviewChip });
}
function PreviewConnectFlow({ state, omni: omni2 }) {
  const { type, step } = state.page;
  const [name, setName] = (0, import_react4.useState)("");
  const [token, setToken] = (0, import_react4.useState)("");
  (0, import_react4.useEffect)(() => {
    setName("");
    setToken("");
  }, [type]);
  if (type === null) {
    return (0, import_react4.createElement)(AddGrid, { types: ORDER, onPick: (id) => omni2.showPage({ type: id, step: 0 }), onBack: () => omni2.showPage({ view: "overview" }), Tile, PreviewChip });
  }
  const info = CHANNEL_TYPES[type];
  const steps = [t("Name it"), info.pairing === "qr" ? t("Scan") : info.pairing === "token" ? t("Paste token") : t("Sign in"), t("Done")];
  return (0, import_react4.createElement)(
    import_react4.Fragment,
    null,
    (0, import_react4.createElement)("button", { type: "button", className: "oc-back", onClick: () => omni2.showPage({ type: null, step: 0 }) }, (0, import_react4.createElement)(ChevronLeftIcon2), t("All channels")),
    (0, import_react4.createElement)("ol", { className: "oc-steps" }, steps.map((label, index) => (0, import_react4.createElement)("li", { key: label, "data-state": index < step ? "done" : index === step ? "now" : void 0 }, (0, import_react4.createElement)("span", null, index < step ? "✓" : String(index + 1)), label))),
    (0, import_react4.createElement)(
      "div",
      { className: "oc-flow" },
      (0, import_react4.createElement)(Tile, { type, size: 64, ring: true }),
      step === 0 ? (0, import_react4.createElement)(
        import_react4.Fragment,
        null,
        (0, import_react4.createElement)("h1", null, t("Connect {app}", { app: info.label })),
        (0, import_react4.createElement)("p", null, info.blurb),
        (0, import_react4.createElement)("label", { className: "oc-field" }, (0, import_react4.createElement)("span", null, t("Name")), (0, import_react4.createElement)("input", {
          value: name,
          placeholder: t("For example: Sales, Support, Personal"),
          onChange: (event) => setName(event.target.value),
          autoFocus: true,
          onKeyDown: (event) => {
            if (event.key === "Enter") omni2.showPage({ step: 1 });
          }
        })),
        (0, import_react4.createElement)("button", { type: "button", className: "oc-primary", onClick: () => omni2.showPage({ step: 1 }) }, t("Continue"))
      ) : step === 1 ? (0, import_react4.createElement)(Pairing, { info, token, setToken, onDone: () => omni2.showPage({ step: 2 }) }) : (0, import_react4.createElement)(
        import_react4.Fragment,
        null,
        (0, import_react4.createElement)("h1", null, state.preview ? t("{app} is connected", { app: info.label }) : t("That is the whole flow")),
        (0, import_react4.createElement)("p", null, state.preview ? t("New chats appear under your Bots. Nothing is sent to your contacts until Omni or you reply.") : t("Connecting from here is switched on after you approve it; this run changed nothing in omni.")),
        state.preview ? (0, import_react4.createElement)("button", { type: "button", className: "oc-primary", onClick: () => omni2.finishConnect(type, name.trim()) }, t("See its health")) : (0, import_react4.createElement)("button", { type: "button", className: "oc-primary", onClick: () => omni2.showPage({ view: "overview", type: null, step: 0 }) }, t("Back to channels"))
      )
    )
  );
}
function Pairing({ info, token, setToken, onDone }) {
  if (info.pairing === "qr") return (0, import_react4.createElement)(QrPairing, { info, onDone });
  if (info.pairing === "token") {
    return (0, import_react4.createElement)(
      import_react4.Fragment,
      null,
      (0, import_react4.createElement)("h1", null, t("Paste the {app} token", { app: info.label })),
      (0, import_react4.createElement)("p", null, info.label === "Telegram" ? t("Message @BotFather, send /newbot, and copy the token it gives you.") : t("Create the token in {app}'s settings and paste it here.", { app: info.label })),
      (0, import_react4.createElement)("label", { className: "oc-field" }, (0, import_react4.createElement)("span", null, t("Token")), (0, import_react4.createElement)("input", { type: "password", value: token, onChange: (event) => setToken(event.target.value), placeholder: "123456:ABC-…", autoComplete: "off" })),
      (0, import_react4.createElement)("button", { type: "button", className: "oc-primary", disabled: token.trim() === "", onClick: onDone }, t("Connect"))
    );
  }
  return (0, import_react4.createElement)(
    import_react4.Fragment,
    null,
    (0, import_react4.createElement)("h1", null, t("Sign in with {app}", { app: info.signIn })),
    (0, import_react4.createElement)("p", null, t("A {app} window opens. Approve Omni there and come back.", { app: info.signIn })),
    (0, import_react4.createElement)("button", { type: "button", className: "oc-primary", onClick: onDone }, t("Continue to {app}", { app: info.signIn }))
  );
}
function TokenFix({ channel, type, omni: omni2 }) {
  const [token, setToken] = (0, import_react4.useState)("");
  return (0, import_react4.createElement)(
    "div",
    { className: "oc-fix" },
    (0, import_react4.createElement)(
      "label",
      { className: "oc-field" },
      (0, import_react4.createElement)("span", null, t("New {app} token", { app: type.label })),
      (0, import_react4.createElement)("input", {
        type: "password",
        value: token,
        autoComplete: "off",
        placeholder: "123456:ABC-…",
        onChange: (event) => setToken(event.target.value),
        onKeyDown: (event) => {
          if (event.key === "Enter" && token.trim() !== "") omni2.reconnect(channel.id, token.trim());
        }
      })
    ),
    (0, import_react4.createElement)("button", { type: "button", className: "oc-primary", disabled: token.trim() === "" || Boolean(channel.busy), onClick: () => omni2.reconnect(channel.id, token.trim()) }, t("Reconnect"))
  );
}
function useCountdown(seconds) {
  const [left, setLeft] = (0, import_react4.useState)(seconds);
  (0, import_react4.useEffect)(() => {
    const timer = setInterval(() => setLeft((value) => value <= 1 ? seconds : value - 1), 1e3);
    return () => clearInterval(timer);
  }, [seconds]);
  return left;
}
function QrPairing({ info, onDone }) {
  const [byPhone, setByPhone] = (0, import_react4.useState)(false);
  const [phone, setPhone] = (0, import_react4.useState)("");
  const [code, setCode] = (0, import_react4.useState)(null);
  const left = useCountdown(60);
  if (byPhone) {
    return (0, import_react4.createElement)(
      import_react4.Fragment,
      null,
      (0, import_react4.createElement)("h1", null, t("Link with a phone number")),
      code === null ? (0, import_react4.createElement)(
        import_react4.Fragment,
        null,
        (0, import_react4.createElement)("p", null, t("Omni shows an 8-character code. Type it on your phone instead of scanning.")),
        (0, import_react4.createElement)("label", { className: "oc-field" }, (0, import_react4.createElement)("span", null, t("Phone number with country code")), (0, import_react4.createElement)("input", { value: phone, inputMode: "tel", placeholder: "+55 11 91234-5678", onChange: (event) => setPhone(event.target.value), autoFocus: true })),
        (0, import_react4.createElement)("button", { type: "button", className: "oc-primary", disabled: phone.replace(/\D/g, "").length < 8, onClick: () => setCode("K7QX-4M2P") }, t("Get code"))
      ) : (0, import_react4.createElement)(
        import_react4.Fragment,
        null,
        (0, import_react4.createElement)(
          "ol",
          { className: "oc-howto" },
          (0, import_react4.createElement)("li", null, t("On your phone, open {app} → Linked devices → Link a device", { app: info.label })),
          (0, import_react4.createElement)("li", null, t("Tap “Link with phone number instead”")),
          (0, import_react4.createElement)("li", null, t("Type this code"))
        ),
        (0, import_react4.createElement)("div", { className: "oc-code", "aria-label": t("Pairing code") }, code.split("").map((char, index) => (0, import_react4.createElement)("span", { key: index, "data-dash": char === "-" || void 0 }, char))),
        (0, import_react4.createElement)("span", { className: "oc-qr-wait" }, (0, import_react4.createElement)("span", { className: "oc-spinner", "aria-hidden": true }), t("Waiting for your phone… the code works for {n} s", { n: left })),
        (0, import_react4.createElement)("button", { type: "button", className: "oc-link", onClick: onDone }, t("Preview: pretend I typed it"))
      ),
      (0, import_react4.createElement)("button", { type: "button", className: "oc-link", onClick: () => {
        setByPhone(false);
        setCode(null);
      } }, t("Scan a QR code instead"))
    );
  }
  return (0, import_react4.createElement)(
    import_react4.Fragment,
    null,
    (0, import_react4.createElement)("h1", null, t("Scan with your phone")),
    (0, import_react4.createElement)(
      "ol",
      { className: "oc-howto" },
      (0, import_react4.createElement)("li", null, t("Open {app} on your phone", { app: info.label })),
      (0, import_react4.createElement)("li", null, t("Tap Settings, then Linked devices")),
      (0, import_react4.createElement)("li", null, t("Tap Link a device and point the camera here"))
    ),
    (0, import_react4.createElement)(
      "div",
      { className: "oc-qr" },
      (0, import_react4.createElement)("span", { className: "oc-qr-code" }, (0, import_react4.createElement)(SampleQr, { seed: Math.floor(Date.now() / 6e4) }), (0, import_react4.createElement)("span", { className: "oc-qr-logo" }, (0, import_react4.createElement)(Tile, { type: "whatsapp-baileys", size: 34 }))),
      (0, import_react4.createElement)("span", { className: "oc-qr-wait" }, (0, import_react4.createElement)("span", { className: "oc-spinner", "aria-hidden": true }), t("Waiting for your phone · new code in {n} s", { n: left }))
    ),
    (0, import_react4.createElement)(
      "span",
      { className: "oc-alt" },
      (0, import_react4.createElement)("button", { type: "button", className: "oc-link", onClick: () => setByPhone(true) }, t("Use a phone number instead")),
      (0, import_react4.createElement)("button", { type: "button", className: "oc-link", onClick: onDone }, t("Preview: pretend I scanned it"))
    )
  );
}
function SampleQr({ seed = 1 }) {
  const N = 25;
  const finder = (x, y) => [[0, 0], [N - 7, 0], [0, N - 7]].find(([fx, fy]) => x >= fx && x < fx + 7 && y >= fy && y < fy + 7);
  const logo = (x, y) => Math.abs(x - 12) <= 3 && Math.abs(y - 12) <= 3;
  const cells = [];
  let state = seed * 2654435761 >>> 0;
  for (let y = 0; y < N; y += 1) for (let x = 0; x < N; x += 1) {
    state = state * 1103515245 + 12345 >>> 0;
    if (finder(x, y) || logo(x, y) || (x === 7 || y === 7) && (x < 8 && y < 8 || x > N - 9 && y < 8 || x < 8 && y > N - 9)) continue;
    if ((state >>> 16) % 100 < 48) cells.push((0, import_react4.createElement)("rect", { key: `${x}-${y}`, x, y, width: 1, height: 1, rx: 0.3 }));
  }
  const eyes = [[0, 0], [N - 7, 0], [0, N - 7]].map(([x, y]) => (0, import_react4.createElement)(
    "g",
    { key: `${x}-${y}` },
    (0, import_react4.createElement)("rect", { x: x + 0.5, y: y + 0.5, width: 6, height: 6, rx: 1.6, fill: "none", stroke: "currentColor", strokeWidth: 1 }),
    (0, import_react4.createElement)("rect", { x: x + 2, y: y + 2, width: 3, height: 3, rx: 0.9 })
  ));
  return (0, import_react4.createElement)("svg", { viewBox: `-1 -1 ${N + 2} ${N + 2}`, width: 196, height: 196, "aria-hidden": true }, (0, import_react4.createElement)("g", { fill: "currentColor" }, cells, eyes));
}
var TONES = "[data-tone=ok]{--oc-tone:#16a34a}[data-tone=busy]{--oc-tone:#0ea5e9}[data-tone=warn]{--oc-tone:#f59e0b}[data-tone=off]{--oc-tone:#94a3b8}";
function ChannelsFooter({ wide, actions }) {
  const state = useOmni();
  (0, import_react4.useEffect)(() => {
    startLive(call);
  }, []);
  if (!wide) return null;
  const summary = healthSummary(state);
  const label = summary.attention > 0 ? t("{n} channel needs attention", { n: summary.attention }) : t("Channels and their health");
  return (0, import_react4.createElement)("span", { className: "bt-connect-wrap" }, (0, import_react4.createElement)(
    "button",
    { type: "button", className: "bt-connect bt-connect-foot bt-channels-foot", title: label, "aria-label": `${t("Channels")}, ${label}`, onClick: () => actions.selectPanel(CHANNELS_PANEL) },
    (0, import_react4.createElement)("span", { className: "bt-channels-tiles", "aria-hidden": true }, state.channels.slice(0, 4).map((channel) => (0, import_react4.createElement)(Tile, { key: channel.id, type: channel.type, size: 18 }))),
    t("Channels"),
    summary.attention > 0 ? (0, import_react4.createElement)("span", { className: "oc-warn-dot", "aria-hidden": true }) : (0, import_react4.createElement)("span", { className: "bt-channels-count" }, `${summary.connected}/${summary.total}`)
  ));
}
var CHANNELS_CSS = `
.bt-channels-foot{gap:8px;justify-content:flex-start;padding:0 12px 0 8px}
.bt-channels-tiles{display:inline-flex}
.bt-channels-tiles .oc-tile{margin-left:-5px;box-shadow:0 0 0 1.5px var(--bt-main)}
.bt-channels-tiles .oc-tile:first-child{margin-left:0}
.bt-channels-count{margin-left:auto;font-size:12px;color:var(--bt-ink-3)}
.bt-channels-foot .oc-warn-dot{margin-left:auto}
${TONES}
.oc-tile{display:inline-grid;place-items:center;flex:none;color:#fff;box-shadow:inset 0 0 0 .5px rgba(0,0,0,.08)}
.oc-tile svg{display:block}
.oc-tile-ring{box-shadow:0 0 0 6px color-mix(in srgb,var(--bt-accent) 14%,transparent)}
.oc-dot{width:9px;height:9px;border-radius:50%;background:var(--oc-tone);flex:none}
.oc-pill{display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 10px;border-radius:999px;font-size:12px;font-weight:500;white-space:nowrap;color:color-mix(in srgb,var(--oc-tone) 70%,var(--bt-ink));background:color-mix(in srgb,var(--oc-tone) 13%,transparent)}
.oc-pill-dot{width:6px;height:6px;border-radius:50%;background:var(--oc-tone)}
.oc-pill[data-tone=busy] .oc-pill-dot,.oc-filter .oc-dot[data-tone=busy]{animation:oc-pulse 1.2s ease-in-out infinite}
@keyframes oc-pulse{50%{opacity:.35}}
.oc-preview-chip{display:inline-flex;align-items:center;height:22px;padding:0 9px;margin-left:10px;border-radius:999px;border:1px dashed var(--bt-line-2);color:var(--bt-ink-2);font-size:11.5px;font-weight:500;vertical-align:middle;white-space:nowrap}
.oc-chip-action{cursor:pointer;font:inherit;font-size:11.5px;background:none;gap:6px}
.oc-chip-action:hover{border-color:var(--bt-accent);color:var(--bt-ink)}
.oc-chip-go{color:var(--bt-accent);font-weight:600}
.oc-connect-prompt{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;margin:4px 0 22px;padding:18px 20px;border:1px solid var(--bt-line);border-radius:16px;background:color-mix(in srgb,var(--bt-accent) 6%,var(--bt-surface,transparent))}
.oc-connect-prompt strong{font-size:15px;font-weight:600}
.oc-connect-prompt p{margin:4px 0 0;color:var(--bt-ink-2);font-size:13px}

/* Chat avatars carry a small channel tile in the corner. */
.oc-ava{position:relative;flex:none;display:inline-grid;place-items:center;border-radius:50%;background:hsl(var(--oc-hue) 55% 88%);color:hsl(var(--oc-hue) 45% 30%)}
body[data-ds-dark-theme] .oc-ava{background:hsl(var(--oc-hue) 30% 26%);color:hsl(var(--oc-hue) 60% 82%)}
.oc-ava-face{font-weight:600;letter-spacing:.01em}
.oc-ava-img{position:absolute;inset:0;width:100%;height:100%;border-radius:50%;object-fit:cover}
.oc-ava-badge{position:absolute;right:-4px;bottom:-4px;display:inline-flex;border-radius:32%;box-shadow:0 0 0 2px var(--bt-sidebar)}
.oc-chat .oc-ava-badge{box-shadow:0 0 0 2px var(--bt-main)}

/* Main panels */
.oc-page{position:relative;height:100%;min-height:0;display:flex;flex-direction:column;background:var(--bt-main);color:var(--bt-ink);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;animation:oc-page-in .22s cubic-bezier(.2,0,0,1)}
@keyframes oc-page-in{from{opacity:0;transform:translateY(6px)}}
.oc-primary,.oc-secondary,.oc-ghost{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:38px;padding:0 16px;border-radius:999px;font:inherit;font-size:14px;font-weight:500;cursor:pointer;white-space:nowrap;transition:transform .12s ease,opacity .12s ease,background-color .12s ease}
.oc-primary{border:0;background:var(--bt-accent);color:var(--bt-accent-ink,#fff)}
.oc-primary svg{width:16px;height:16px}
.oc-primary:hover:not(:disabled){opacity:.92}
.oc-primary:active:not(:disabled),.oc-secondary:active{transform:scale(.97)}
.oc-primary:disabled{opacity:.45;cursor:default}
.oc-secondary{border:1px solid var(--bt-line-2);background:var(--bt-card);color:var(--bt-ink)}
.oc-secondary:hover{background:var(--bt-hover)}
.oc-ghost{height:32px;padding:0 12px;border:0;background:none;color:var(--bt-ink-2);font-size:13px}
.oc-ghost:hover{background:var(--bt-hover);color:var(--bt-ink)}
.oc-link{border:0;background:none;padding:0;color:var(--bt-ink-2);font:inherit;font-size:13px;text-decoration:underline;text-underline-offset:3px;cursor:pointer}
.oc-spinner{width:14px;height:14px;border-radius:50%;border:2px solid color-mix(in srgb,var(--bt-accent) 25%,transparent);border-top-color:var(--bt-accent);animation:oc-spin .8s linear infinite;flex:none}
@keyframes oc-spin{to{transform:rotate(360deg)}}

/* Chat */
.oc-chat-empty{align-items:center;justify-content:center;gap:12px;color:var(--bt-ink-3)}
.oc-chat-head{display:flex;align-items:center;gap:12px;padding:12px 20px;border-bottom:.5px solid var(--bt-line-2);flex-wrap:wrap}
.oc-chat-who{display:flex;flex-direction:column;min-width:0;margin-right:auto}
.oc-chat-who strong{font-size:15px;line-height:20px;font-weight:600}
.oc-chat-who span{font-size:12.5px;color:var(--bt-ink-2)}
.oc-answer{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 11px;border-radius:999px;font-size:12.5px;color:var(--bt-accent);background:color-mix(in srgb,var(--bt-accent) 10%,transparent)}
.oc-answer[data-by=you]{color:var(--bt-ink-2);background:var(--bt-hover)}
.oc-thread{flex:1;min-height:0;overflow-y:auto}
.oc-thread-in{display:flex;flex-direction:column;gap:2px;max-width:var(--dsh-chat-content-width,748px);margin:0 auto;padding:20px 24px 12px}
.oc-day{align-self:center;margin:4px 0 12px;font-size:11.5px;color:var(--bt-ink-3)}
.oc-msg{display:flex;flex-direction:column;max-width:72%;animation:oc-msg-in .2s cubic-bezier(.2,0,0,1)}
@keyframes oc-msg-in{from{opacity:0;transform:translateY(4px)}}
.oc-msg-first{margin-top:10px}
.oc-msg-them{align-self:flex-start;align-items:flex-start}
.oc-msg-omni,.oc-msg-you{align-self:flex-end;align-items:flex-end}
.oc-msg-author{display:inline-flex;align-items:center;gap:4px;margin:0 12px 3px;font-size:12px;font-weight:500;color:var(--bt-ink-2)}
.oc-msg-omni .oc-msg-author{color:var(--bt-accent)}
.oc-bubble{position:relative;padding:8px 12px 7px;border-radius:18px;font-size:14.5px;line-height:21px;white-space:pre-wrap;overflow-wrap:anywhere;margin-top:2px}
.oc-bubble time{float:right;margin:5px 0 -3px 10px;font-size:10.5px;line-height:14px;opacity:.55}
.oc-msg-them .oc-bubble{background:var(--bt-bubble);color:var(--bt-ink)}
.oc-msg-omni .oc-bubble{background:color-mix(in srgb,var(--bt-accent) 14%,var(--bt-main));color:var(--bt-ink)}
.oc-msg-you .oc-bubble{background:var(--bt-user);color:var(--bt-user-ink)}
.oc-compose-wrap{padding:8px 24px 20px}
.oc-compose-note{display:flex;align-items:center;gap:8px;max-width:var(--dsh-chat-content-width,748px);margin:0 auto 8px;width:100%;padding:8px 12px;border:0;border-radius:12px;background:color-mix(in srgb,#f59e0b 12%,transparent);color:var(--bt-ink);font:inherit;font-size:13px;text-align:left;cursor:pointer;box-sizing:border-box}
.oc-compose{display:flex;align-items:flex-end;gap:8px;max-width:var(--dsh-chat-content-width,748px);margin:0 auto;padding:6px 6px 6px 16px;border-radius:24px;border:1px solid var(--bt-line-2);background:var(--bt-card);box-shadow:0 2px 8px -2px rgba(0,0,0,.06);box-sizing:border-box}
.oc-compose[data-off]{opacity:.6}
.oc-compose textarea{flex:1;height:36px;min-height:36px;max-height:160px;padding:8px 0;box-sizing:border-box;border:0;background:none;color:var(--bt-ink);font:inherit;font-size:14.5px;line-height:20px;resize:none;outline:none;field-sizing:content}
.oc-send{width:36px;height:36px;border-radius:50%;border:0;background:var(--bt-accent);color:var(--bt-accent-ink,#fff);display:inline-grid;place-items:center;cursor:pointer;flex:none;transition:opacity .12s ease,transform .12s ease}
.oc-send:disabled{opacity:.3;cursor:default}
.oc-send:active:not(:disabled){transform:scale(.94)}

/* Channels */
.oc-channels{overflow-y:auto}
.oc-channels-in{width:100%;max-width:880px;margin:0 auto;padding:28px 32px 48px;box-sizing:border-box;display:flex;flex-direction:column;gap:16px}
.oc-head{display:flex;align-items:flex-start;justify-content:space-between;gap:20px}
.oc-head h1,.oc-detail-who h1,.oc-flow h1{margin:0;font-size:24px;line-height:32px;font-weight:650;letter-spacing:-.01em}
.oc-head p{margin:6px 0 0;max-width:560px;font-size:14px;line-height:21px;color:var(--bt-ink-2)}
.oc-callout{display:flex;align-items:center;gap:14px;width:100%;padding:14px 16px;border:1px solid color-mix(in srgb,var(--oc-tone) 35%,transparent);border-radius:16px;background:color-mix(in srgb,var(--oc-tone) 9%,var(--bt-main));color:var(--bt-ink);font:inherit;text-align:left;cursor:pointer;box-sizing:border-box;transition:transform .12s ease}
.oc-callout:hover:not(.oc-callout-static){transform:translateY(-1px)}
.oc-callout-static{cursor:default}
.oc-callout-text{display:flex;flex-direction:column;gap:2px;flex:1;min-width:0;font-size:13.5px;line-height:19px;color:var(--bt-ink-2)}
.oc-callout-text strong{font-size:14px;color:var(--bt-ink);font-weight:600}
.oc-callout-go{display:inline-flex;align-items:center;gap:2px;font-size:13.5px;font-weight:600;color:color-mix(in srgb,var(--oc-tone) 70%,var(--bt-ink));white-space:nowrap}
.oc-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
.oc-stat{display:flex;flex-direction:column;gap:2px;padding:14px 16px;border-radius:14px;background:var(--bt-card);border:.5px solid var(--bt-line-2)}
.oc-stat strong{font-size:22px;line-height:28px;font-weight:650;font-variant-numeric:tabular-nums}
.oc-stat span{font-size:12.5px;color:var(--bt-ink-2)}
.oc-stat[data-tone=warn] strong{color:#d97706}
.oc-section{margin:10px 0 0;font-size:13px;font-weight:600;letter-spacing:.03em;text-transform:uppercase;color:var(--bt-ink-3)}
.oc-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:12px}
.oc-card{display:flex;flex-direction:column;gap:16px;padding:16px;border-radius:18px;border:.5px solid var(--bt-line-2);background:var(--bt-card);color:var(--bt-ink);font:inherit;text-align:left;cursor:pointer;transition:transform .14s ease,box-shadow .14s ease}
.oc-card:hover{transform:translateY(-2px);box-shadow:0 12px 28px -12px rgba(0,0,0,.18)}
.oc-card-top{display:flex;align-items:center;gap:12px}
.oc-card-who{display:flex;flex-direction:column;flex:1;min-width:0}
.oc-card-who strong{font-size:15px;line-height:20px;font-weight:600}
.oc-card-who span{font-size:12.5px;color:var(--bt-ink-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.oc-card-bottom{display:flex;align-items:flex-end;gap:14px}
.oc-card-facts{display:flex;flex-direction:column;gap:2px;font-size:12.5px;color:var(--bt-ink-2);margin-left:auto;text-align:right}
.oc-card-unread{color:var(--bt-accent);font-weight:600}
.oc-spark{display:flex;align-items:flex-end;gap:3px;height:34px;width:96px}
.oc-spark span{flex:1;border-radius:3px;background:color-mix(in srgb,var(--bt-accent) 55%,transparent)}
.oc-spark span:last-child:not([data-zero]){background:var(--bt-accent)}
.oc-spark span[data-zero]{background:var(--bt-line-2)}
.oc-back{align-self:flex-start;display:inline-flex;align-items:center;gap:2px;height:30px;padding:0 10px 0 4px;margin-left:-4px;border:0;border-radius:999px;background:none;color:var(--bt-ink-2);font:inherit;font-size:13.5px;cursor:pointer}
.oc-back:hover{background:var(--bt-hover);color:var(--bt-ink)}
.oc-detail-head{display:flex;align-items:center;gap:16px}
.oc-detail-who{flex:1;min-width:0}
.oc-detail-who p{margin:2px 0 0;font-size:13.5px;color:var(--bt-ink-2)}
.oc-actions{display:flex;gap:8px;flex-wrap:wrap}
.oc-chart{display:flex;align-items:stretch;gap:10px;height:150px;padding:16px 16px 10px;border-radius:16px;background:var(--bt-card);border:.5px solid var(--bt-line-2)}
.oc-chart-col{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:6px;min-width:0}
.oc-chart-n{font-size:11px;color:var(--bt-ink-3);font-variant-numeric:tabular-nums;min-height:14px}
.oc-chart-bar{width:100%;max-width:38px;border-radius:8px 8px 4px 4px;background:color-mix(in srgb,var(--bt-accent) 50%,transparent);transform-origin:bottom;animation:oc-grow .5s cubic-bezier(.2,0,0,1) both}
.oc-chart-col:last-child .oc-chart-bar:not([data-zero]){background:var(--bt-accent)}
.oc-chart-bar[data-zero]{background:var(--bt-line-2)}
@keyframes oc-grow{from{transform:scaleY(0)}}
.oc-chart-day{font-size:11.5px;color:var(--bt-ink-2)}
.oc-seg{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.oc-seg-opt{display:flex;flex-direction:column;gap:4px;padding:14px 16px;border-radius:14px;border:1px solid var(--bt-line-2);background:var(--bt-card);color:var(--bt-ink);font:inherit;text-align:left;cursor:pointer;transition:border-color .12s ease,background-color .12s ease}
.oc-seg-opt strong{display:inline-flex;align-items:center;gap:6px;font-size:14px;font-weight:600}
.oc-seg-opt span{font-size:12.5px;line-height:18px;color:var(--bt-ink-2)}
.oc-seg-opt[aria-checked=true]{border-color:var(--bt-accent);background:color-mix(in srgb,var(--bt-accent) 8%,var(--bt-card));box-shadow:0 0 0 3px color-mix(in srgb,var(--bt-accent) 14%,transparent)}
.oc-danger{display:flex;align-items:center;gap:16px;margin-top:14px;padding:16px;border-radius:14px;border:1px solid color-mix(in srgb,var(--bt-danger) 25%,transparent)}
.oc-danger div{display:flex;flex-direction:column;gap:2px;flex:1;font-size:12.5px;color:var(--bt-ink-2)}
.oc-danger strong{font-size:14px;color:var(--bt-ink)}
.oc-danger-go{height:34px;padding:0 14px;border-radius:999px;border:1px solid color-mix(in srgb,var(--bt-danger) 40%,transparent);background:none;color:var(--bt-danger);font:inherit;font-size:13px;font-weight:500;cursor:pointer;white-space:nowrap}
.oc-danger-armed{background:var(--bt-danger);color:#fff;border-color:transparent}
.oc-types{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px;align-items:stretch}
.oc-type{display:flex;flex-direction:column;align-items:stretch;gap:10px;min-height:184px;padding:18px;border-radius:18px;border:.5px solid var(--bt-line-2);background:var(--bt-card);color:var(--bt-ink);font:inherit;text-align:left;cursor:pointer;transition:transform .14s ease,box-shadow .14s ease,border-color .14s ease}
.oc-type:hover:not(:disabled){transform:translateY(-2px);border-color:var(--bt-line);box-shadow:0 12px 28px -12px rgba(0,0,0,.18)}
.oc-type-top{display:flex;align-items:center;gap:12px}
.oc-type-top strong{flex:1;min-width:0;font-size:16px;font-weight:600}
.oc-type-time{flex:none;padding:2px 8px;border-radius:999px;border:1px solid var(--bt-line-2);color:var(--bt-ink-3);font-size:11.5px;white-space:nowrap}
.oc-type-blurb{flex:1;font-size:13.5px;line-height:20px;color:var(--bt-ink-2)}
.oc-type-how{display:flex;align-items:center;justify-content:space-between;gap:8px;padding-top:12px;border-top:.5px solid var(--bt-line-2);font-size:12.5px;color:var(--bt-ink-3)}
.oc-type-how b{color:var(--bt-accent);font-weight:600}
.oc-head h1 .oc-tile{margin-right:10px;vertical-align:-6px}
.oc-guide{display:grid;grid-template-columns:200px minmax(0,1fr);gap:28px;margin-top:6px;align-items:start}
.oc-guide-steps{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px;font-size:13.5px;color:var(--bt-ink-3)}
.oc-guide-steps li{display:flex;align-items:center;gap:10px;padding:6px 0}
.oc-guide-steps span{width:24px;height:24px;border-radius:50%;display:inline-grid;place-items:center;flex:none;border:1px solid var(--bt-line-2);font-size:11.5px;font-weight:600}
.oc-guide-steps li[data-state=now]{color:var(--bt-ink);font-weight:500}
.oc-guide-steps li[data-state=now] span{border-color:var(--bt-accent);color:var(--bt-accent)}
.oc-guide-steps li[data-state=done] span{background:color-mix(in srgb,#16a34a 14%,transparent);border-color:transparent;color:#16a34a}
.oc-guide-pane{display:flex;flex-direction:column;align-items:flex-start;gap:14px;padding:22px;border-radius:18px;border:.5px solid var(--bt-line-2);background:var(--bt-card);animation:oc-page-in .22s cubic-bezier(.2,0,0,1)}
.oc-guide-pane h2{margin:0;font-size:19px;line-height:26px;font-weight:650}
.oc-guide-pane>p{margin:-6px 0 0;font-size:14px;line-height:21px;color:var(--bt-ink-2)}
.oc-guide-pane a:not(.oc-primary):not(.oc-secondary){color:var(--bt-accent)}
.oc-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.oc-fine{margin:0;font-size:12.5px;color:var(--bt-ink-3)}
.oc-numbered{list-style:none;counter-reset:oc-n;margin:0;padding:0;display:flex;flex-direction:column;gap:8px;font-size:14px;color:var(--bt-ink-2)}
.oc-numbered li{counter-increment:oc-n;display:flex;align-items:baseline;gap:10px}
.oc-numbered li::before{content:counter(oc-n);flex:none;width:22px;height:22px;border-radius:7px;display:inline-grid;place-items:center;background:color-mix(in srgb,var(--bt-accent) 12%,transparent);color:var(--bt-accent);font-size:12px;font-weight:600}
.oc-numbered code{padding:1px 6px;border-radius:6px;background:var(--bt-hover);font:13px ui-monospace,SFMono-Regular,Menlo,monospace}
.oc-suggest{display:flex;align-items:center;gap:12px;width:100%;padding:10px 12px;border-radius:12px;background:color-mix(in srgb,var(--bt-accent) 9%,transparent);font-size:13.5px;box-sizing:border-box}
.oc-suggest span{flex:1}
.oc-brand{display:inline-flex;align-items:center;justify-content:center;height:40px;padding:0 18px;border:0;border-radius:12px;color:#fff;font:inherit;font-size:14px;font-weight:600;cursor:pointer}
.oc-brand:disabled{opacity:.5;cursor:default}
.oc-qr-row{display:flex;gap:24px;align-items:flex-start;flex-wrap:wrap}
.oc-qr-side{display:flex;flex-direction:column;align-items:flex-start;gap:12px;flex:1;min-width:220px}
.oc-qr-side h2{margin:0}
.oc-guide-pane .oc-seg{width:100%}
.oc-steps{display:flex;gap:6px;list-style:none;margin:0;padding:0;font-size:13px;color:var(--bt-ink-3)}
.oc-steps li{display:flex;align-items:center;gap:8px}
.oc-steps li+li::before{content:"";width:28px;height:1px;background:var(--bt-line-2);margin-right:2px}
.oc-steps span{width:22px;height:22px;border-radius:50%;display:inline-grid;place-items:center;border:1px solid var(--bt-line-2);font-size:11px;font-weight:600}
.oc-steps li[data-state=now]{color:var(--bt-ink);font-weight:500}
.oc-steps li[data-state=now] span{background:var(--bt-accent);border-color:transparent;color:var(--bt-accent-ink,#fff)}
.oc-steps li[data-state=done] span{background:color-mix(in srgb,var(--bt-accent) 15%,transparent);border-color:transparent;color:var(--bt-accent)}
.oc-flow{display:flex;flex-direction:column;align-items:flex-start;gap:14px;max-width:520px;margin-top:10px;animation:oc-page-in .22s cubic-bezier(.2,0,0,1)}
.oc-flow p{margin:0;font-size:14px;line-height:21px;color:var(--bt-ink-2)}
.oc-field{display:flex;flex-direction:column;gap:6px;width:100%}
.oc-field span{font-size:12.5px;font-weight:500;color:var(--bt-ink-2)}
.oc-field input{height:42px;padding:0 14px;border-radius:12px;border:1px solid var(--bt-line-2);background:var(--bt-card);color:var(--bt-ink);font:inherit;font-size:14px;outline:none;transition:border-color .12s ease,box-shadow .12s ease}
.oc-field input:focus{border-color:var(--bt-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--bt-accent) 16%,transparent)}
.oc-howto{margin:0;padding-left:20px;font-size:14px;line-height:24px;color:var(--bt-ink-2)}
.oc-qr{display:flex;flex-direction:column;align-items:center;gap:12px;padding:20px 20px 14px;border-radius:20px;background:#fff;color:#0c2630;border:.5px solid var(--bt-line-2);box-shadow:0 10px 30px -14px rgba(0,0,0,.25)}
.oc-live-chip{gap:6px;border-style:solid;border-color:color-mix(in srgb,#16a34a 35%,transparent);color:color-mix(in srgb,#16a34a 70%,var(--bt-ink))}
.oc-live-chip[data-error]{border-color:color-mix(in srgb,#f59e0b 45%,transparent);color:color-mix(in srgb,#d97706 80%,var(--bt-ink))}
.oc-live-dot{width:6px;height:6px;border-radius:50%;background:currentColor;animation:oc-pulse 2s ease-in-out infinite}
.oc-compose-info{cursor:default;background:var(--bt-hover);color:var(--bt-ink-2)}
.oc-seg-static{cursor:default}
.oc-day{display:inline-flex;align-items:center;gap:8px}
.oc-qr-wait{display:inline-flex;align-items:center;gap:8px;font-size:12.5px;color:var(--bt-ink-2)}
.oc-qr .oc-qr-wait{color:#475569}
.oc-qr-code{position:relative;display:inline-flex}
.oc-qr-logo{position:absolute;inset:0;display:grid;place-items:center}
.oc-qr-logo .oc-tile{box-shadow:0 0 0 5px #fff}
.oc-alt{display:flex;gap:18px;flex-wrap:wrap}
.oc-code{display:flex;gap:6px}
.oc-code span{display:inline-grid;place-items:center;width:40px;height:52px;border-radius:12px;background:var(--bt-card);border:1px solid var(--bt-line-2);font-size:24px;font-weight:650;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.oc-code span[data-dash]{width:14px;border:0;background:none;color:var(--bt-ink-3)}
.oc-fix{display:flex;align-items:flex-end;gap:10px}
.oc-fix .oc-field{flex:1}
.oc-problem{margin:4px 0 0;padding:10px 12px;border-radius:12px;font-size:13px;color:color-mix(in srgb,#d97706 85%,var(--bt-ink));background:color-mix(in srgb,#f59e0b 12%,transparent)}
.oc-compose-fail{color:color-mix(in srgb,#d97706 85%,var(--bt-ink));background:color-mix(in srgb,#f59e0b 12%,transparent)}
.oc-bubble[data-sending]{opacity:.6}
.oc-type:disabled{opacity:.5;cursor:not-allowed}
.oc-qr-empty{display:grid;place-items:center;width:196px;height:196px}
@media (max-width:720px){.oc-guide{grid-template-columns:1fr;gap:12px}.oc-guide-steps{flex-direction:row;flex-wrap:wrap;gap:4px 14px}.oc-stats{grid-template-columns:repeat(2,minmax(0,1fr))}.oc-seg{grid-template-columns:1fr}.oc-channels-in{padding:20px 16px 40px}.oc-head{flex-direction:column}}
@media (prefers-reduced-motion:reduce){.oc-page,.oc-msg,.oc-flow,.oc-guide-pane,.oc-chart-bar{animation:none}.oc-card,.oc-type,.oc-filter{transition:none}}
`;

// src/client/omni-peek.js
var import_react5 = require("react");
var PREVIEW = 4;
var HUES2 = [168, 200, 222, 262, 290, 330, 18, 38, 140];
var hueOf2 = (name) => {
  let sum = 0;
  for (const char of String(name ?? "")) sum = sum * 31 + char.charCodeAt(0) >>> 0;
  return HUES2[sum % HUES2.length];
};
var initialsOf = (name) => String(name ?? "?").replace(/[^\p{L}\p{N} ]/gu, "").trim().split(/\s+/).slice(0, 2).map((word) => word[0] ?? "").join("").toUpperCase() || "?";
function Avatar({ name, url, size = 28 }) {
  return (0, import_react5.createElement)(
    "span",
    { className: "op-ava", style: { width: size, height: size, "--op-hue": hueOf2(name), fontSize: Math.round(size * 0.38) } },
    initialsOf(name),
    url ? (0, import_react5.createElement)("img", { src: url, alt: "", loading: "lazy", referrerPolicy: "no-referrer", onError: (event) => {
      event.currentTarget.remove();
    } }) : null
  );
}
var still = () => typeof window !== "undefined" && (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || document.body?.dataset.btMotion === "quiet");
function useCountUp(to2) {
  const [shown, setShown] = (0, import_react5.useState)(still() ? to2 : 0);
  (0, import_react5.useEffect)(() => {
    if (still() || !Number.isFinite(to2)) {
      setShown(to2);
      return void 0;
    }
    const start = performance.now();
    let frame;
    const step = (now) => {
      const progress = Math.min(1, (now - start) / 600);
      setShown(Math.round(to2 * (1 - (1 - progress) ** 3)));
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [to2]);
  return shown;
}
var when = (at2) => Date.parse(at2) || Number(at2) ? relativeShort(Date.parse(at2) || Number(at2)) : "";
var chipText = (value) => {
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}(T|$)/.test(text) && Number.isFinite(Date.parse(text))) {
    return new Date(text).toLocaleDateString([], { month: "short", day: "numeric", .../T\d{2}:\d{2}/.test(text) && !/T00:00(:00)?/.test(text) ? { hour: "numeric", minute: "2-digit" } : {} });
  }
  return text.slice(0, 40);
};
var ICONS = {
  messages: "M4 5.5A2.5 2.5 0 0 1 6.5 3h7A2.5 2.5 0 0 1 16 5.5v5A2.5 2.5 0 0 1 13.5 13H9l-3.5 3v-3A2.5 2.5 0 0 1 3 10.5",
  chats: "M3 5.5A2.5 2.5 0 0 1 5.5 3h6A2.5 2.5 0 0 1 14 5.5v3A2.5 2.5 0 0 1 11.5 11H8l-3 2.5V11A2.5 2.5 0 0 1 3 8.5zM14 7h.5A2.5 2.5 0 0 1 17 9.5v3a2.5 2.5 0 0 1-2 2.45V17l-2.5-2H10",
  channels: "M10 11.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM6.5 13.5a5 5 0 0 1 0-7M13.5 6.5a5 5 0 0 1 0 7M4 16a8.5 8.5 0 0 1 0-12M16 4a8.5 8.5 0 0 1 0 12",
  events: "M2.5 10h3l2-5 3 10 2-5h5",
  automations: "M11 2.5 4.5 11H10l-1 6.5L15.5 9H10z",
  people: "M10 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM4 17c.6-3 3-4.5 6-4.5s5.4 1.5 6 4.5",
  records: "M4 5c0-1.1 2.7-2 6-2s6 .9 6 2-2.7 2-6 2-6-.9-6-2zM4 5v10c0 1.1 2.7 2 6 2s6-.9 6-2V5M4 10c0 1.1 2.7 2 6 2s6-.9 6-2",
  write: "M13.5 3.5l3 3L7 16H4v-3z",
  remove: "M5 6h10M8 6V4h4v2M6.5 6l.7 10h5.6l.7-10"
};
var Icon = ({ kind }) => (0, import_react5.createElement)("svg", { width: 16, height: 16, viewBox: "0 0 20 20", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true }, (0, import_react5.createElement)("path", { d: ICONS[kind] ?? ICONS.records }));
var listOf = (data) => Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : null;
function kindOf(items) {
  const item = items.find((entry) => entry && typeof entry === "object") ?? {};
  if ("textContent" in item || "messageType" in item || "text" in item && ("from" in item || "at" in item)) return "messages";
  if ("chatType" in item || "lastMessagePreview" in item || "unread" in item && "name" in item) return "chats";
  if ("eventType" in item) return "events";
  if ("channel" in item && ("isActive" in item || "state" in item || "profileName" in item)) return "channels";
  if ("trigger" in item || "triggerType" in item || "actions" in item && "name" in item) return "automations";
  if ("displayName" in item || "primaryPhone" in item) return "people";
  return "records";
}
var Row = ({ index, children, className = "" }) => (0, import_react5.createElement)("div", { className: `op-row ${className}`, style: { "--i": index } }, children);
function MessageRows({ items }) {
  return items.map((item, index) => {
    const mine = item.isFromMe === true || item.from === "you";
    const name = mine ? t("You") : item.senderDisplayName ?? item.from ?? item.senderName ?? t("Someone");
    const text = item.textContent ?? item.text ?? item.transcription ?? (item.hasMedia ? `[${item.messageType ?? "media"}]` : "");
    return (0, import_react5.createElement)(
      Row,
      { key: item.id ?? index, index, className: mine ? "op-msg op-msg-mine" : "op-msg" },
      mine ? null : (0, import_react5.createElement)(Avatar, { name, size: 26 }),
      (0, import_react5.createElement)(
        "div",
        { className: "op-bubble" },
        mine ? null : (0, import_react5.createElement)("span", { className: "op-bubble-who" }, name),
        (0, import_react5.createElement)("span", { className: "op-bubble-text" }, String(text || "…").slice(0, 220)),
        (0, import_react5.createElement)("span", { className: "op-bubble-at" }, when(item.platformTimestamp ?? item.at ?? item.createdAt))
      )
    );
  });
}
var kindTag = (item) => {
  const type = item.isGroup ? "group" : item.type ?? item.chatType;
  if (String(item.externalId ?? item.name ?? "").startsWith("status@")) return "status";
  return type && type !== "dm" ? type : null;
};
function ChatRows({ items }) {
  return items.map((item, index) => {
    const unread = item.unread ?? item.unreadCount ?? 0;
    return (0, import_react5.createElement)(
      Row,
      { key: item.id ?? index, index, className: "op-chat" },
      (0, import_react5.createElement)(Avatar, { name: item.name, url: item.avatarUrl, size: 30 }),
      (0, import_react5.createElement)(
        "div",
        { className: "op-chat-body" },
        (0, import_react5.createElement)("span", { className: "op-chat-name" }, (0, import_react5.createElement)("span", { className: "op-chat-name-text" }, item.name ?? t("Chat")), kindTag(item) ? (0, import_react5.createElement)("span", { className: "op-tag" }, t(kindTag(item))) : null),
        (0, import_react5.createElement)("span", { className: "op-chat-preview" }, String(item.preview ?? item.lastMessagePreview ?? "").slice(0, 120))
      ),
      (0, import_react5.createElement)(
        "div",
        { className: "op-chat-side" },
        (0, import_react5.createElement)("span", { className: "op-chat-at" }, when(item.lastMessageAt)),
        unread > 0 ? (0, import_react5.createElement)("span", { className: "op-unread" }, unread > 99 ? "99+" : unread) : null
      )
    );
  });
}
function ChannelTiles({ items }) {
  return (0, import_react5.createElement)("div", { className: "op-tiles" }, items.map((item, index) => {
    const state = item.state ?? (item.isActive === false ? "paused" : "unknown");
    return (0, import_react5.createElement)(
      "div",
      { key: item.id ?? index, className: "op-tile", style: { "--i": index }, "data-state": state },
      (0, import_react5.createElement)(Tile, { type: item.channel, size: 30 }),
      (0, import_react5.createElement)("span", { className: "op-tile-name" }, item.name),
      (0, import_react5.createElement)("span", { className: "op-tile-state" }, (0, import_react5.createElement)("i", { "aria-hidden": true }), item.profile ?? item.profileName ?? state)
    );
  }));
}
function EventLine({ items }) {
  return (0, import_react5.createElement)("div", { className: "op-events" }, items.map((item, index) => (0, import_react5.createElement)(
    Row,
    { key: item.id ?? index, index, className: "op-event" },
    (0, import_react5.createElement)("span", { className: "op-event-dot", "aria-hidden": true }),
    (0, import_react5.createElement)("span", { className: "op-event-type" }, item.eventType),
    (0, import_react5.createElement)("span", { className: "op-event-text" }, String(item.textContent ?? item.chatName ?? item.source ?? "").slice(0, 100)),
    (0, import_react5.createElement)("span", { className: "op-event-at" }, when(item.receivedAt ?? item.createdAt ?? item.timestamp))
  )));
}
function NamedRows({ items, kind }) {
  return items.map((item, index) => (0, import_react5.createElement)(
    Row,
    { key: item.id ?? index, index, className: "op-named" },
    kind === "people" ? (0, import_react5.createElement)(Avatar, { name: item.displayName ?? item.name, size: 26 }) : (0, import_react5.createElement)("span", { className: "op-named-icon" }, (0, import_react5.createElement)(Icon, { kind })),
    (0, import_react5.createElement)("span", { className: "op-named-name" }, String(item.displayName ?? item.name ?? item.title ?? item.id ?? "—").slice(0, 80)),
    (0, import_react5.createElement)("span", { className: "op-named-meta" }, String(item.status ?? item.state ?? item.type ?? item.triggerType ?? item.channel ?? "").slice(0, 40))
  ));
}
function RecordFields({ record }) {
  const pairs = Object.entries(record).filter(([, value]) => value !== null && value !== void 0 && value !== "" && typeof value !== "object").slice(0, 8);
  return (0, import_react5.createElement)("dl", { className: "op-fields" }, pairs.map(([key, value], index) => (0, import_react5.createElement)(
    import_react5.Fragment,
    { key },
    (0, import_react5.createElement)("dt", { style: { "--i": index } }, key),
    (0, import_react5.createElement)("dd", { style: { "--i": index } }, String(value).slice(0, 120))
  )));
}
function Seen({ data, kind: forced }) {
  const [all, setAll] = (0, import_react5.useState)(false);
  const list = listOf(data);
  if (list === null) {
    const record = data?.data ?? data;
    return record && typeof record === "object" ? (0, import_react5.createElement)(RecordFields, { record }) : null;
  }
  if (list.length === 0) return (0, import_react5.createElement)("p", { className: "op-empty" }, t("Nothing came back."));
  const kind = forced ?? kindOf(list);
  const shown = list.slice(0, PREVIEW);
  const rest = list.length - shown.length;
  const view = kind === "messages" ? (0, import_react5.createElement)(MessageRows, { items: shown }) : kind === "chats" ? (0, import_react5.createElement)(ChatRows, { items: shown }) : kind === "channels" ? (0, import_react5.createElement)(ChannelTiles, { items: shown }) : kind === "events" ? (0, import_react5.createElement)(EventLine, { items: shown }) : (0, import_react5.createElement)(NamedRows, { items: shown, kind });
  return (0, import_react5.createElement)(
    import_react5.Fragment,
    null,
    (0, import_react5.createElement)("div", { className: "op-seen", "data-kind": kind }, view),
    rest > 0 || kind === "records" ? (0, import_react5.createElement)(
      "div",
      { className: "op-more" },
      (0, import_react5.createElement)("button", { type: "button", className: "op-more-btn", onClick: () => setAll((value) => !value) }, all ? t("Hide") : t("Show all {count}", { count: list.length }))
    ) : null,
    all ? (0, import_react5.createElement)("div", { className: "op-all" }, (0, import_react5.createElement)(DataView2, { value: data })) : null
  );
}
function PeekCard({ kind = "records", verb, title, count, unit, chips = [], state, failure, children, accent = false }) {
  const shownCount = useCountUp(Number.isFinite(count) ? count : 0);
  return (0, import_react5.createElement)(
    "section",
    { className: "op-card", "data-state": state, "data-accent": accent || void 0 },
    (0, import_react5.createElement)(
      "header",
      { className: "op-head" },
      (0, import_react5.createElement)("span", { className: "op-icon", "data-kind": kind }, (0, import_react5.createElement)(Icon, { kind })),
      (0, import_react5.createElement)("span", { className: "op-verb" }, verb),
      (0, import_react5.createElement)("span", { className: "op-title" }, title),
      state === "working" ? (0, import_react5.createElement)("span", { className: "op-working" }, t("looking…")) : state === "failed" ? (0, import_react5.createElement)("span", { className: "op-failed" }, t("failed")) : Number.isFinite(count) ? (0, import_react5.createElement)("span", { className: "op-count" }, (0, import_react5.createElement)("b", null, shownCount), " ", unit ?? (count === 1 ? t("item") : t("items"))) : null
    ),
    chips.length > 0 ? (0, import_react5.createElement)("div", { className: "op-chips" }, chips.map(([key, value]) => (0, import_react5.createElement)("span", { key, className: "op-chip" }, (0, import_react5.createElement)("span", null, key), chipText(value)))) : null,
    state === "working" ? (0, import_react5.createElement)("div", { className: "op-skeleton", "aria-hidden": true }, [0, 1, 2].map((index) => (0, import_react5.createElement)("span", { key: index, style: { "--i": index } }))) : state === "failed" ? (0, import_react5.createElement)("p", { className: "op-problem", role: "alert" }, failure) : children ? (0, import_react5.createElement)("div", { className: "op-body" }, children) : null
  );
}
var OMNI_PEEK_CSS = `
@property --op-angle{syntax:'<angle>';inherits:false;initial-value:0deg}
.op-card{position:relative;display:flex;flex-direction:column;gap:10px;max-width:640px;padding:12px 14px 14px;border-radius:18px;background:linear-gradient(180deg,color-mix(in srgb,var(--bt-card) 92%,var(--bt-accent) 8%),var(--bt-card));border:1px solid color-mix(in srgb,var(--bt-line) 70%,var(--bt-accent) 30%);box-shadow:0 1px 0 rgba(255,255,255,.4) inset,0 8px 24px -16px color-mix(in srgb,var(--bt-accent) 60%,transparent);animation:op-card-in .42s cubic-bezier(.2,.8,.2,1)}
.op-card[data-state=working]{border-color:transparent;background:linear-gradient(var(--bt-card),var(--bt-card)) padding-box,conic-gradient(from var(--op-angle),transparent 0 60%,var(--bt-accent) 75%,#a78bfa 85%,transparent 95%) border-box;animation:op-card-in .42s cubic-bezier(.2,.8,.2,1),op-spin 1.6s linear infinite}
.op-card[data-state=failed]{border-color:color-mix(in srgb,#e5484d 40%,var(--bt-line))}
@keyframes op-spin{to{--op-angle:360deg}}
@keyframes op-card-in{from{opacity:0;transform:translateY(8px) scale(.985);filter:blur(3px)}}
.op-head{display:flex;align-items:center;gap:8px;min-width:0;font-size:13.5px}
.op-icon{position:relative;flex:none;display:grid;place-items:center;width:28px;height:28px;border-radius:9px;color:var(--bt-accent);background:color-mix(in srgb,var(--bt-accent) 13%,transparent)}
.op-card[data-state=working] .op-icon::after{content:"";position:absolute;inset:-3px;border-radius:12px;border:1.5px solid var(--bt-accent);opacity:0;animation:op-ping 1.4s cubic-bezier(0,0,.2,1) infinite}
@keyframes op-ping{0%{opacity:.7;transform:scale(.85)}100%{opacity:0;transform:scale(1.35)}}
.op-verb{flex:none;font-weight:600;color:var(--bt-ink)}
.op-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--bt-ink-2)}
.op-count{flex:none;margin-left:auto;font-size:12px;color:var(--bt-ink-3);font-variant-numeric:tabular-nums}
.op-count b{font-size:14px;font-weight:650;color:var(--bt-ink)}
.op-working{flex:none;margin-left:auto;font-size:12px;color:var(--bt-accent);animation:op-breathe 1.2s ease-in-out infinite}
.op-failed{flex:none;margin-left:auto;font-size:12px;color:#d13438;font-weight:600}
@keyframes op-breathe{50%{opacity:.45}}
.op-chips{display:flex;flex-wrap:wrap;gap:6px}
.op-chip{display:inline-flex;align-items:center;gap:5px;height:22px;padding:0 8px;border-radius:999px;background:var(--bt-hover);font-size:11.5px;color:var(--bt-ink-2)}
.op-chip>span{color:var(--bt-ink-3)}
.op-skeleton{display:flex;flex-direction:column;gap:8px}
.op-skeleton span{height:30px;border-radius:10px;background:linear-gradient(90deg,var(--bt-hover) 0%,color-mix(in srgb,var(--bt-accent) 14%,var(--bt-hover)) 45%,var(--bt-hover) 90%);background-size:220% 100%;animation:op-shimmer 1.3s ease-in-out infinite;animation-delay:calc(var(--i) * 120ms);opacity:calc(1 - var(--i) * .25)}
@keyframes op-shimmer{from{background-position:120% 0}to{background-position:-120% 0}}
.op-problem{margin:0;padding:8px 10px;border-radius:10px;background:color-mix(in srgb,#e5484d 10%,transparent);color:#d13438;font-size:13px}
.op-body{display:flex;flex-direction:column;gap:8px;min-width:0}
.op-row,.op-tile,.op-fields dt,.op-fields dd{animation:op-row-in .45s cubic-bezier(.2,.8,.2,1) both;animation-delay:calc(var(--i, 0) * 70ms + 80ms)}
@keyframes op-row-in{from{opacity:0;transform:translateY(6px);filter:blur(2px)}}
.op-seen{display:flex;flex-direction:column;gap:6px;min-width:0}
.op-ava{position:relative;overflow:hidden;flex:none;display:grid;place-items:center;border-radius:50%;font-weight:600;color:hsl(var(--op-hue) 55% 32%);background:hsl(var(--op-hue) 70% 88%)}
.op-ava img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
body[data-ds-dark-theme] .op-ava{color:hsl(var(--op-hue) 70% 82%);background:hsl(var(--op-hue) 35% 28%)}
.op-msg{display:flex;align-items:flex-end;gap:8px;min-width:0}
.op-msg-mine{justify-content:flex-end}
.op-bubble{display:flex;flex-direction:column;gap:1px;max-width:78%;padding:6px 10px 5px;border-radius:14px 14px 14px 4px;background:var(--bt-hover);font-size:13px;line-height:18px}
.op-msg-mine .op-bubble{border-radius:14px 14px 4px 14px;background:color-mix(in srgb,var(--bt-accent) 16%,var(--bt-card))}
.op-bubble-who{font-size:11.5px;font-weight:600;color:var(--bt-ink-2)}
.op-bubble-text{overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.op-bubble-at{align-self:flex-end;font-size:10.5px;color:var(--bt-ink-3)}
.op-chat{display:flex;align-items:center;gap:10px;min-width:0;padding:6px 8px;border-radius:12px;transition:background-color .12s}
.op-chat:hover{background:var(--bt-hover)}
.op-chat-body{display:flex;flex-direction:column;flex:1;min-width:0}
.op-chat-name{display:flex;align-items:center;gap:6px;min-width:0;font-size:13.5px;font-weight:600;white-space:nowrap}
.op-chat-name-text{min-width:0;overflow:hidden;text-overflow:ellipsis}
.op-chat-name .op-tag{flex:none}
.op-chat-preview{font-size:12.5px;color:var(--bt-ink-3);overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.op-chat-side{display:flex;flex-direction:column;align-items:flex-end;gap:3px;flex:none}
.op-chat-at{font-size:11px;color:var(--bt-ink-3)}
.op-unread{min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:var(--bt-accent);color:#fff;font-size:11px;font-weight:700;display:grid;place-items:center;animation:op-pop .5s cubic-bezier(.3,1.6,.5,1) both;animation-delay:calc(var(--i,0) * 70ms + 300ms)}
@keyframes op-pop{from{transform:scale(0)}}
.op-tag{font-size:10.5px;font-weight:500;padding:1px 6px;border-radius:6px;background:var(--bt-tag-bg);color:var(--bt-tag-ink)}
.op-tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px}
.op-tile{display:flex;flex-direction:column;gap:6px;padding:10px;border-radius:14px;background:var(--bt-hover)}
.op-tile-name{font-size:13px;font-weight:600;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.op-tile-state{display:flex;align-items:center;gap:5px;font-size:11.5px;color:var(--bt-ink-3);overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.op-tile-state i{flex:none;width:7px;height:7px;border-radius:50%;background:var(--bt-ink-3)}
.op-tile[data-state=connected] .op-tile-state i{background:#00c972;box-shadow:0 0 0 0 rgba(0,201,114,.5);animation:op-live 2s infinite}
@keyframes op-live{70%{box-shadow:0 0 0 6px rgba(0,201,114,0)}100%{box-shadow:0 0 0 0 rgba(0,201,114,0)}}
.op-events{position:relative;display:flex;flex-direction:column;gap:6px;padding-left:14px}
.op-events::before{content:"";position:absolute;left:4px;top:6px;bottom:6px;width:2px;border-radius:1px;background:linear-gradient(var(--bt-accent),transparent)}
.op-event{position:relative;display:flex;align-items:baseline;gap:8px;font-size:12.5px;min-width:0}
.op-event-dot{position:absolute;left:-14px;top:5px;width:10px;height:10px;border-radius:50%;background:var(--bt-card);border:2px solid var(--bt-accent)}
.op-event-type{flex:none;font-weight:600}
.op-event-text{flex:1;min-width:0;color:var(--bt-ink-2);overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.op-event-at{flex:none;font-size:11px;color:var(--bt-ink-3)}
.op-named{display:flex;align-items:center;gap:10px;font-size:13px;min-width:0}
.op-named-icon{display:grid;place-items:center;width:26px;height:26px;border-radius:8px;background:var(--bt-hover);color:var(--bt-ink-2)}
.op-named-name{flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-weight:500}
.op-named-meta{flex:none;font-size:11.5px;color:var(--bt-ink-3)}
.op-fields{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:4px 14px;margin:0;font-size:12.5px}
.op-fields dt{color:var(--bt-ink-3)}
.op-fields dd{margin:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.op-empty{margin:0;font-size:12.5px;color:var(--bt-ink-3)}
.op-more{display:flex}
.op-more-btn{padding:0;border:0;background:none;color:var(--bt-accent);font:inherit;font-size:12.5px;font-weight:500;cursor:pointer}
.op-all{animation:op-row-in .3s ease both}
@media (prefers-reduced-motion:reduce){.op-card,.op-row,.op-tile,.op-fields dt,.op-fields dd,.op-unread,.op-skeleton span,.op-icon::after{animation:none!important}}
body[data-bt-motion=quiet] :is(.op-card,.op-row,.op-tile,.op-fields dt,.op-fields dd,.op-unread,.op-skeleton span,.op-icon::after){animation:none!important}
`;

// src/client/omni-live.js
var import_react6 = require("react");
function useOmniGet(path, every = 0) {
  const [state, setState] = (0, import_react6.useState)({ loading: true, data: null, error: null });
  (0, import_react6.useEffect)(() => {
    if (!path) return void 0;
    let live = true;
    let timer;
    const load = async () => {
      try {
        const reply = await call("omni-get", { path });
        if (live) setState({ loading: false, data: reply.data, error: reply.ok ? null : errorText(reply.data, reply.status) });
      } catch (error) {
        if (live) setState((previous) => ({ ...previous, loading: false, error: error.message }));
      }
      if (live && every > 0) timer = setTimeout(load, document.hidden ? every * 4 : every);
    };
    void load();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [path, every]);
  return state;
}
var errorText = (data, status) => data?.error?.message ?? (typeof data === "string" && data ? data.slice(0, 200) : `omni answered ${status}`);
function stateOf(instance, status) {
  if (instance?.isActive === false) return "paused";
  const state = status?.state;
  if (status?.isConnected || state === "connected") return "connected";
  if (state === "connecting" || state === "qr" || state === "reconnecting") return "connecting";
  return "attention";
}
var STATE = {
  connected: { tone: "ok", label: "Connected" },
  connecting: { tone: "warn", label: "Connecting" },
  paused: { tone: "muted", label: "Paused" },
  attention: { tone: "bad", label: "Not connected" }
};
var phoneOf = (owner) => typeof owner === "string" ? owner.replace(/[:@].*$/, "").replace(/^(\d{6,})$/, "+$1") : "";
var Badge = ({ text, tone = "muted" }) => (0, import_react6.createElement)("span", { className: "ou-badge", "data-tone": tone }, text);
var Problem2 = ({ text }) => (0, import_react6.createElement)("p", { className: "ou-problem", role: "alert" }, text);
function LiveChannel({ id }) {
  const instance = useOmniGet(id ? `/instances/${encodeURIComponent(id)}` : null, 3e4);
  const status = useOmniGet(id ? `/instances/${encodeURIComponent(id)}/status` : null, 8e3);
  const record = instance.data?.data;
  const live = status.data?.data;
  if (instance.error) return (0, import_react6.createElement)(Problem2, { text: instance.error });
  if (!record) return (0, import_react6.createElement)("div", { className: "ou-card ou-loading" }, t("Loading channel…"));
  const state = stateOf(record, live);
  return (0, import_react6.createElement)(
    "div",
    { className: "ou-card ou-channel" },
    (0, import_react6.createElement)(Tile, { type: record.channel, size: 38 }),
    (0, import_react6.createElement)(
      "div",
      { className: "ou-channel-body" },
      (0, import_react6.createElement)("strong", null, record.name),
      (0, import_react6.createElement)("span", { className: "ou-muted" }, [typeOf(record.channel).label ?? record.channel, live?.profileName ?? record.profileName, phoneOf(live?.ownerIdentifier ?? record.ownerIdentifier)].filter(Boolean).join(" · "))
    ),
    (0, import_react6.createElement)(Badge, { text: t(STATE[state].label), tone: STATE[state].tone })
  );
}
function QrSvg({ text, size = 208 }) {
  const path = (0, import_react6.useMemo)(() => {
    const code = qrcode_default(0, "L");
    code.addData(text);
    code.make();
    const count = code.getModuleCount();
    let d = "";
    for (let row = 0; row < count; row += 1) for (let col = 0; col < count; col += 1) if (code.isDark(row, col)) d += `M${col} ${row}h1v1h-1z`;
    return { d, count };
  }, [text]);
  return (0, import_react6.createElement)(
    "svg",
    { className: "ou-qr-svg", width: size, height: size, viewBox: `-2 -2 ${path.count + 4} ${path.count + 4}`, role: "img", "aria-label": t("QR code"), shapeRendering: "crispEdges" },
    (0, import_react6.createElement)("rect", { x: -2, y: -2, width: path.count + 4, height: path.count + 4, fill: "#fff" }),
    (0, import_react6.createElement)("path", { d: path.d, fill: "#000" })
  );
}
function LiveQr({ channelId }) {
  const base = channelId ? `/instances/${encodeURIComponent(channelId)}` : null;
  const status = useOmniGet(base && `${base}/status`, 2500);
  const connected = status.data?.data?.isConnected === true || status.data?.data?.state === "connected";
  const qr2 = useOmniGet(base && !connected ? `${base}/qr` : null, 2500);
  const code = qr2.data?.data?.qr;
  if (connected) {
    const live = status.data.data;
    return (0, import_react6.createElement)(
      "div",
      { className: "ou-card ou-qr ou-qr-done" },
      (0, import_react6.createElement)("span", { className: "ou-qr-check", "aria-hidden": true }, "✓"),
      (0, import_react6.createElement)("strong", null, t("Connected")),
      (0, import_react6.createElement)("span", { className: "ou-muted" }, [live.profileName, phoneOf(live.ownerIdentifier)].filter(Boolean).join(" · "))
    );
  }
  return (0, import_react6.createElement)(
    "div",
    { className: "ou-card ou-qr" },
    code ? (0, import_react6.createElement)(QrSvg, { text: code }) : (0, import_react6.createElement)("div", { className: "ou-qr-wait" }, qr2.error ? (0, import_react6.createElement)(Problem2, { text: qr2.error }) : t("Waiting for a code…")),
    (0, import_react6.createElement)(
      "div",
      { className: "ou-qr-help" },
      (0, import_react6.createElement)("strong", null, t("Scan with WhatsApp")),
      (0, import_react6.createElement)("span", { className: "ou-muted" }, t("On the phone: Settings → Linked devices → Link a device.")),
      (0, import_react6.createElement)("span", { className: "ou-live" }, (0, import_react6.createElement)("span", { className: "ou-live-dot", "aria-hidden": true }), qr2.data?.data?.message || t("Live · refreshes by itself"))
    )
  );
}
function LiveChat({ id, limit = 8 }) {
  const chat = useOmniGet(id ? `/chats/${encodeURIComponent(id)}` : null, 6e4);
  const messages = useOmniGet(id ? `/chats/${encodeURIComponent(id)}/messages?limit=${Math.min(30, Math.max(1, limit))}` : null, 1e4);
  const record = chat.data?.data;
  if (chat.error) return (0, import_react6.createElement)(Problem2, { text: chat.error });
  const items = [...messages.data?.items ?? []].sort((a, b2) => (Date.parse(a.platformTimestamp ?? a.createdAt) || 0) - (Date.parse(b2.platformTimestamp ?? b2.createdAt) || 0));
  return (0, import_react6.createElement)(
    "div",
    { className: "ou-card ou-chat" },
    (0, import_react6.createElement)(
      "div",
      { className: "ou-chat-head" },
      (0, import_react6.createElement)(Tile, { type: record?.channel, size: 26 }),
      (0, import_react6.createElement)("strong", null, record?.name ?? t("Chat")),
      record?.isGroup ? (0, import_react6.createElement)(Badge, { text: t("Group") }) : null
    ),
    items.length === 0 ? (0, import_react6.createElement)("span", { className: "ou-muted" }, messages.loading ? t("Loading messages…") : t("no messages yet")) : (0, import_react6.createElement)("div", { className: "ou-chat-lines" }, items.map((message) => (0, import_react6.createElement)(
      "div",
      { key: message.id, className: "ou-chat-line", "data-me": message.isFromMe ? "" : void 0 },
      message.isFromMe ? null : (0, import_react6.createElement)("span", { className: "ou-chat-who" }, message.senderDisplayName ?? ""),
      (0, import_react6.createElement)("span", { className: "ou-chat-text" }, message.textContent || message.transcription || (message.hasMedia ? `[${message.messageType ?? "media"}]` : "")),
      (0, import_react6.createElement)("span", { className: "ou-chat-at" }, relativeShort(Date.parse(message.platformTimestamp ?? message.createdAt) || Date.now()))
    )))
  );
}
var PLAIN = (value) => value === null || ["string", "number", "boolean"].includes(typeof value);
var cell = (value) => {
  if (value === null || value === void 0) return "";
  if (typeof value === "boolean") return value ? t("yes") : t("no");
  if (PLAIN(value)) return String(value).slice(0, 160);
  return Array.isArray(value) ? t("{count} items", { count: value.length }) : "{…}";
};
var COLUMNS_MAX = 6;
var ROWS_MAX = 50;
var FIRST = ["name", "title", "displayName", "channel", "status", "state", "type", "eventType", "textContent", "isActive", "createdAt", "id"];
function DataView2({ value }) {
  const list = Array.isArray(value) ? value : Array.isArray(value?.items) ? value.items : null;
  if (list) {
    if (list.length === 0) return (0, import_react6.createElement)("span", { className: "ou-muted" }, t("Nothing here."));
    if (!list.every((item) => item && typeof item === "object" && !Array.isArray(item))) return (0, import_react6.createElement)("span", null, list.slice(0, ROWS_MAX).map(cell).join(", "));
    const keys = new Set(list.slice(0, 20).flatMap((item) => Object.keys(item).filter((key) => PLAIN(item[key]))));
    const columns = [...FIRST.filter((key) => keys.has(key)), ...[...keys].filter((key) => !FIRST.includes(key))].slice(0, COLUMNS_MAX);
    return (0, import_react6.createElement)(
      import_react6.Fragment,
      null,
      (0, import_react6.createElement)(Table, { columns, rows: list.slice(0, ROWS_MAX).map((item) => columns.map((key) => item[key])) }),
      list.length > ROWS_MAX || value?.meta?.hasMore ? (0, import_react6.createElement)("span", { className: "ou-muted" }, t("First {count} shown.", { count: Math.min(list.length, ROWS_MAX) })) : null
    );
  }
  const record = value && typeof value === "object" && !Array.isArray(value) ? value.data ?? value : null;
  if (record && typeof record === "object") {
    const pairs = Object.entries(record).filter(([, item]) => item !== null && item !== void 0 && item !== "").slice(0, 24);
    return (0, import_react6.createElement)(KeyValue, { pairs: pairs.map(([label, item]) => ({ label, value: item })) });
  }
  return (0, import_react6.createElement)("span", null, cell(value));
}
function Table({ columns, rows }) {
  return (0, import_react6.createElement)(
    "div",
    { className: "ou-table-wrap" },
    (0, import_react6.createElement)(
      "table",
      { className: "ou-table" },
      (0, import_react6.createElement)("thead", null, (0, import_react6.createElement)("tr", null, columns.map((column, index) => (0, import_react6.createElement)("th", { key: index }, column)))),
      (0, import_react6.createElement)("tbody", null, rows.map((row, index) => (0, import_react6.createElement)("tr", { key: index }, columns.map((_, col) => (0, import_react6.createElement)("td", { key: col }, cell(row[col]))))))
    )
  );
}
function KeyValue({ pairs }) {
  return (0, import_react6.createElement)("dl", { className: "ou-kv" }, pairs.map(({ label, value }, index) => (0, import_react6.createElement)(import_react6.Fragment, { key: index }, (0, import_react6.createElement)("dt", null, label), (0, import_react6.createElement)("dd", null, cell(value)))));
}
var VERB = { GET: "Read", POST: "Ran", PUT: "Set", PATCH: "Changed", DELETE: "Deleted" };
var INSTANCE = /^\/instances\/([0-9a-f-]{36})(?:\/(connect|pair|qr|restart|status|disconnect|logout))?$/i;
var parseJson = (text) => {
  if (!text) return void 0;
  try {
    return JSON.parse(text);
  } catch {
    return void 0;
  }
};
function parseCall(argText, content) {
  let result = null;
  try {
    result = JSON.parse(content);
  } catch {
    result = content ? { status: 0, error: String(content).slice(0, 300) } : null;
  }
  return { method: String(argText("method") ?? "GET").toUpperCase(), path: String(argText("path") ?? ""), query: parseJson(argText("query")), result };
}
var failureOf = (result, done) => !done ? null : !result ? t("No answer.") : result.error ? result.error : result.status >= 200 && result.status < 300 ? null : errorText(result.data, result.status);
var callState = (done, failure) => !done ? "working" : failure ? "failed" : "done";
var PATH_KINDS = [[/^\/chats\/[^/]+\/messages|^\/messages/, "messages"], [/^\/chats/, "chats"], [/^\/instances/, "channels"], [/^\/events/, "events"], [/^\/automations|^\/automation-/, "automations"], [/^\/persons|^\/contacts/, "people"]];
var kindOfPath = (path) => PATH_KINDS.find(([pattern]) => pattern.test(path))?.[1];
var pathWords = (path) => path.split("/").filter((part) => part && !/^[0-9a-f-]{20,}$/i.test(part)).map((part) => part.replace(/[-_]/g, " ")).join(" · ");
var chipsOf = (args) => Object.entries(args && typeof args === "object" ? args : {}).filter(([, value]) => value !== void 0 && value !== null && value !== "" && typeof value !== "object");
function OmniCallCard({ method, path, query, result, done }) {
  const failure = failureOf(result, done);
  const state = callState(done, failure);
  const title = result?.operation || pathWords(path) || path;
  const [, instance, action] = INSTANCE.exec(path) ?? [];
  const verb = t(VERB[method] ?? method);
  if (method === "GET" && action !== "qr") {
    const list = listOf(result?.data);
    const kind = kindOfPath(path) ?? (list ? kindOf(list) : "records");
    return (0, import_react6.createElement)(
      PeekCard,
      { kind, verb, title, count: list?.length, chips: chipsOf(query), state, failure },
      state === "done" ? (0, import_react6.createElement)(Seen, { data: result?.data, kind: list && kind !== "records" ? kind : void 0 }) : null
    );
  }
  const live = state !== "done" ? null : instance && ["connect", "pair", "qr", "restart"].includes(action) ? (0, import_react6.createElement)(LiveQr, { channelId: instance }) : instance ? (0, import_react6.createElement)(LiveChannel, { id: instance }) : method === "POST" && path === "/instances" && result?.data?.data?.id ? (0, import_react6.createElement)(LiveChannel, { id: result.data.data.id }) : (0, import_react6.createElement)(Seen, { data: result?.data });
  return (0, import_react6.createElement)(PeekCard, { kind: method === "DELETE" ? "remove" : "write", verb, title, chips: chipsOf(query), state, failure, accent: true }, live);
}
var ACTED = { omni_send: "Sent a message", omni_react: "Reacted", omni_media: "Opened a file", omni_delete: "Deleted a message" };
function OmniToolCard({ tool, arg, content, done }) {
  let result = null;
  try {
    result = done ? JSON.parse(content) : null;
  } catch {
    result = done ? { status: 0, error: String(content ?? "").slice(0, 300) } : null;
  }
  const failure = failureOf(result, done);
  const state = callState(done, failure);
  const items = result?.data?.items ?? [];
  if (tool === "omni_channels") {
    return (0, import_react6.createElement)(
      PeekCard,
      { kind: "channels", verb: t("Read"), title: t("Channels"), count: done ? items.length : void 0, unit: t("channels"), state, failure },
      state === "done" ? (0, import_react6.createElement)(Seen, { data: items, kind: "channels" }) : null
    );
  }
  if (tool === "omni_chats") {
    const chips = [["channel", arg("channel")], ["search", arg("search")], ["unread only", arg("unread_only") === "true" || arg("unread_only") === true ? t("yes") : void 0], ["limit", arg("limit")]].filter(([, value]) => value !== void 0 && value !== null && value !== "");
    return (0, import_react6.createElement)(
      PeekCard,
      { kind: "chats", verb: t("Read"), title: t("Chats"), count: done ? items.length : void 0, unit: t("chats"), chips, state, failure },
      state === "done" ? (0, import_react6.createElement)(Seen, { data: items, kind: "chats" }) : null
    );
  }
  if (tool === "omni_messages") {
    const chat = result?.data?.chat;
    return (0, import_react6.createElement)(
      PeekCard,
      { kind: "messages", verb: t("Read"), title: chat?.name ?? t("Chat"), count: done ? items.length : void 0, unit: t("messages"), state, failure },
      state === "done" ? (0, import_react6.createElement)(Seen, { data: items, kind: "messages" }) : null
    );
  }
  if (tool === "omni_connect") {
    return (0, import_react6.createElement)(
      PeekCard,
      { kind: "channels", verb: t("Ran"), title: t("Connect channel"), state, failure, accent: true },
      state === "done" && result?.channelId ? (0, import_react6.createElement)(LiveQr, { channelId: result.channelId }) : null
    );
  }
  const acted = ACTED[tool];
  if (acted) return (0, import_react6.createElement)(PeekCard, { kind: "messages", verb: t("Ran"), title: t(acted), state, failure, accent: true });
  return null;
}
var OMNI_LIVE_CSS = `
.ou-card{display:flex;align-items:center;gap:12px;padding:12px 14px;border:1px solid var(--bt-line);border-radius:14px;background:var(--bt-card);color:var(--bt-ink);min-width:0}
.ou-loading{color:var(--bt-ink-3);font-size:13px}
.ou-muted{color:var(--bt-ink-3);font-size:12.5px}
.ou-problem{margin:0;padding:8px 12px;border-radius:10px;background:color-mix(in srgb,#e5484d 10%,transparent);color:#e5484d;font-size:13px}
.ou-badge{flex:none;display:inline-flex;align-items:center;height:22px;padding:0 9px;border-radius:999px;font-size:12px;font-weight:500;background:var(--bt-tag-bg);color:var(--bt-tag-ink)}
.ou-badge[data-tone=ok]{background:color-mix(in srgb,#00c972 16%,transparent);color:#00a35c}
.ou-badge[data-tone=warn]{background:color-mix(in srgb,#ff9800 18%,transparent);color:#c76f00}
.ou-badge[data-tone=bad]{background:color-mix(in srgb,#e5484d 14%,transparent);color:#d13438}
.ou-badge[data-tone=info]{background:color-mix(in srgb,var(--bt-accent) 15%,transparent);color:var(--bt-accent)}
.ou-channel-body{display:flex;flex-direction:column;gap:2px;flex:1;min-width:0}
.ou-channel-body strong{font-size:14px;font-weight:600}
.ou-channel-body .ou-muted{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ou-qr{align-items:center;gap:18px;flex-wrap:wrap}
.ou-qr-svg{flex:none;border-radius:10px;box-shadow:0 0 0 1px var(--bt-line)}
.ou-qr-wait{display:grid;place-items:center;width:208px;height:208px;border-radius:10px;background:var(--bt-hover);color:var(--bt-ink-3);font-size:13px;text-align:center;padding:12px}
.ou-qr-help{display:flex;flex-direction:column;gap:6px;max-width:260px}
.ou-qr-done{gap:10px}
.ou-qr-check{display:grid;place-items:center;width:28px;height:28px;border-radius:50%;background:#00c972;color:#fff;font-weight:700}
.ou-live{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--bt-ink-3)}
.ou-live-dot{width:7px;height:7px;border-radius:50%;background:#00c972;animation:ou-pulse 1.6s ease-in-out infinite}
@keyframes ou-pulse{50%{opacity:.35}}
.ou-chat{flex-direction:column;align-items:stretch;gap:8px}
.ou-chat-head{display:flex;align-items:center;gap:8px}
.ou-chat-head strong{font-size:14px}
.ou-chat-lines{display:flex;flex-direction:column;gap:4px}
.ou-chat-line{display:flex;gap:8px;align-items:baseline;font-size:13px;line-height:18px}
.ou-chat-line[data-me]{color:var(--bt-ink-2)}
.ou-chat-who{flex:none;font-weight:600;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ou-chat-text{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ou-chat-at{flex:none;font-size:11px;color:var(--bt-ink-3)}
.ou-table-wrap{overflow-x:auto;border:1px solid var(--bt-line);border-radius:12px;background:var(--bt-card)}
.ou-table{width:100%;border-collapse:collapse;font-size:13px}
.ou-table th{text-align:left;font-weight:500;color:var(--bt-ink-3);padding:8px 12px;border-bottom:1px solid var(--bt-line);white-space:nowrap}
.ou-table td{padding:7px 12px;border-bottom:1px solid var(--bt-line);max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ou-table tr:last-child td{border-bottom:0}
.ou-kv{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:4px 16px;margin:0;font-size:13px}
.ou-kv dt{color:var(--bt-ink-3)}
.ou-kv dd{margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ou-chev{flex:none;margin-left:auto;color:var(--bt-ink-3);transition:transform .15s}
.ou-chev[data-open]{transform:rotate(90deg)}
.ou-channel-list{display:flex;flex-direction:column;gap:6px}
.ou-chat-list{display:flex;flex-direction:column;border:1px solid var(--bt-line);border-radius:14px;background:var(--bt-card);overflow:hidden}
.ou-chat-row{display:flex;align-items:center;gap:10px;min-width:0;padding:8px 12px;font-size:13px;border-top:1px solid var(--bt-line)}
.ou-chat-row:first-child{border-top:0}
.ou-chat-row-name{flex:none;max-width:40%;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ou-chat-row-preview{flex:1;min-width:0;color:var(--bt-ink-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ou-chat-row-at{flex:none;font-size:11.5px;color:var(--bt-ink-3)}
.ou-channel-list .ou-card{padding:9px 12px}
`;

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

// src/client/omni-terminal.js
var import_react7 = require("react");
var READ_MS = 150;
var ROWS = 12;
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
function footFor({ state, step, entered, exitCode, error }) {
  if (state === "preparing") return step === "download-bun" ? t("Getting Bun (checked against its published checksum)…") : t("Opening a terminal…");
  if (state === "ready") return entered ? t("Running… This closes on its own when it finishes.") : t("The command is ready. Press Enter to run it, or edit it first.");
  if (state === "linking") return t("Finished. Connecting…");
  if (state === "done") return t("Finished. Closing the terminal…");
  if (state === "cancelled") return t("Nothing ran. Open it again when you are ready.");
  if (error) return error;
  return t("It stopped with exit code {code}. Read what it printed above, then try again.", { code: exitCode ?? "?" });
}
function InlineTerminal({ kind, id, title, onEnded, onClose }) {
  const box = (0, import_react7.useRef)(null);
  const [status, setStatus] = (0, import_react7.useState)({ state: "preparing", step: null, entered: false });
  const ended = (0, import_react7.useRef)(onEnded);
  ended.current = onEnded;
  (0, import_react7.useEffect)(() => {
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
      if (terminal !== null) void call("omni-terminal-resize", { terminal, cols, rows: ROWS }).catch(() => {
      });
    };
    const read = async () => {
      try {
        const reply = await call("omni-terminal-read", { terminal, from: offset });
        if (!alive) return;
        if (reply.data) term.write(reply.data);
        offset = reply.next ?? offset;
        setStatus({ state: reply.state, step: reply.step ?? null, entered, exitCode: reply.exitCode, error: reply.error });
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
        writing = writing.then(() => call("omni-terminal-write", { terminal, data })).catch(() => {
        });
      });
      observer = typeof ResizeObserver === "function" ? new ResizeObserver(fit) : null;
      observer?.observe(box.current);
      const reply = await call("omni-terminal-open", { kind, ...id ? { id } : {}, cols: term.cols, rows: ROWS });
      if (!alive) {
        void call("omni-terminal-close", { terminal: reply.terminal }).catch(() => {
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
      if (terminal !== null) void call("omni-terminal-close", { terminal }).catch(() => {
      });
    };
  }, [kind, id]);
  const stopped = status.state === "failed" || status.state === "cancelled";
  return (0, import_react7.createElement)(
    "div",
    { className: `ot-term${stopped ? " ot-stopped" : ""}` },
    (0, import_react7.createElement)(
      "div",
      { className: "ot-bar" },
      (0, import_react7.createElement)("span", { className: "ot-dots", "aria-hidden": true }, (0, import_react7.createElement)("i"), (0, import_react7.createElement)("i"), (0, import_react7.createElement)("i")),
      (0, import_react7.createElement)("span", { className: "ot-title" }, title),
      onClose ? (0, import_react7.createElement)("button", { type: "button", className: "ot-close", onClick: onClose, "aria-label": t("Close the terminal") }, "×") : (0, import_react7.createElement)("span")
    ),
    (0, import_react7.createElement)("div", { className: "ot-screen", ref: box, role: "application", "aria-label": t("{title} terminal", { title }) }),
    (0, import_react7.createElement)("div", { className: "ot-foot", role: "status" }, footFor(status))
  );
}
var OMNI_TERMINAL_CSS = xterm_default + `
.ot-term{margin-top:12px;border:1px solid var(--bt-line-2);border-radius:12px;overflow:hidden;background:#05080e}
.ot-term.ot-stopped{border-color:color-mix(in srgb,var(--oc-bad,#ff6b6b) 55%,transparent)}
.ot-bar{display:grid;grid-template-columns:44px 1fr 44px;align-items:center;padding:7px 12px;border-bottom:1px solid var(--bt-line);color:var(--bt-ink-2);font-size:12px}
.ot-dots{display:inline-flex;gap:6px}.ot-dots i{width:9px;height:9px;border-radius:50%;background:#253247}
.ot-title{text-align:center}
.ot-close{justify-self:end;background:none;border:0;color:var(--bt-ink-2);font-size:16px;line-height:1;cursor:pointer;padding:0 2px}
.ot-screen{padding:10px 12px;min-height:180px}
.ot-screen .xterm-viewport{background:#05080e!important}
.ot-foot{padding:8px 14px;border-top:1px solid var(--bt-line);color:var(--bt-ink-2);font-size:12.5px}
`;

// src/client/omni-connect.js
var import_react8 = require("react");
var DEFAULT_POLL_MS = 2e3;
var PAIRING_EVENT = "omni:pairing";
var REMOTE = "remote";
var LOCAL = "local";
async function connectFromApp(url, grant) {
  if (typeof url !== "string" || url === "") return;
  try {
    if (typeof grant === "string" && grant !== "") {
      const reply2 = await call("omni-connect-grant", { url, grant });
      await refreshLive(call).catch(() => {
      });
      window.dispatchEvent(new CustomEvent(PAIRING_EVENT, { detail: { paired: reply2.origin } }));
      return;
    }
    const reply = await call("omni-pair-start", { url, auto: true });
    if (reply.status === "unavailable") {
      window.dispatchEvent(new CustomEvent(PAIRING_EVENT, { detail: { problem: unavailableWords(reply) } }));
      return;
    }
    window.dispatchEvent(new CustomEvent(PAIRING_EVENT, { detail: reply.pairing }));
    if (reply.pairing?.approveUrl) window.open(reply.pairing.approveUrl, "_blank", "noopener");
  } catch (error) {
    window.dispatchEvent(new CustomEvent(PAIRING_EVENT, { detail: { problem: error.message } }));
  }
}
var onMac = (scope = globalThis) => /Mac/i.test(scope.navigator?.platform ?? "") || /Mac OS X/.test(scope.navigator?.userAgent ?? "");
var portOf = (url) => {
  try {
    return new URL(url).port;
  } catch {
    return "";
  }
};
var hostOf = (url) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};
function foundRow(omni2, { mac = false, linked = false } = {}) {
  const title = omni2.source === "sandbox" ? mac ? t("Your Omni on this Mac") : t("Your Omni on this computer") : !omni2.local ? hostOf(omni2.url) : mac ? t("Omni on this Mac") : t("Omni on this computer");
  const port = portOf(omni2.url);
  const where = omni2.local ? port ? t("port {port}", { port }) : null : omni2.name && omni2.name !== "default" ? t("saved in your Omni CLI as {name}", { name: omni2.name }) : t("saved in your Omni CLI");
  const sub = [omni2.version ? `v${omni2.version}` : null, where].filter(Boolean).join(" · ");
  const keyEntry = !linked && !omni2.hasKey && omni2.reachable !== false && ["too-old", "off", "unclaimed"].includes(omni2.pairing);
  const row = (badge, tone, action, note) => ({ title, sub, badge, tone, action, note, keyEntry, keyHint: keyEntry && action === "elsewhere" });
  if (linked) return row(t("Connected"), "ok", null, null);
  if (omni2.local && omni2.reachable === false) return row(t("Not answering"), "muted", null, t("It is not answering right now."));
  if (omni2.updateTo) return row(t("Needs an update"), "warn", "reinstall", t("It runs an older Omni than this app. Updating takes about a minute and keeps its chats and channels."));
  if (omni2.outdated && omni2.manager === "cli") return row(t("Needs an update"), "warn", "update", t("It runs an older Omni than this app. Updating takes about a minute and keeps its chats and channels."));
  if (omni2.pairing === "too-old") {
    if (omni2.manager === "cli") return row(t("Needs an update"), "warn", "update", t("It is too old to pair with this app. Updating takes about a minute and keeps your chats and channels."));
    if (omni2.hasKey) return row(t("Ready"), "ok", "use", t("This computer has its key, so it connects without a code."));
    return row(t("Managed by another app"), "muted", "elsewhere", mac ? t("It is too old to pair with this app, and another app runs it, so this one cannot update it. Update it where it runs, or run a new Omni on this Mac.") : t("It is too old to pair with this app, and another app runs it, so this one cannot update it. Update it where it runs, or run a new Omni on this computer."));
  }
  if (omni2.hasKey) return row(t("Ready"), "ok", "use", t("This computer has its key, so it connects without a code."));
  if (omni2.pairing === "off") return row(t("Sign-in off"), "muted", null, t("Sign-in from devices is off on this Omni."));
  return row(t("Ready"), "ok", "connect", t("Approve this device from your phone."));
}
function unavailableWords(reply) {
  if (reply?.reason === "too-old") {
    return reply.version ? t("Omni {version} is too old to pair from here. Update it, or paste an API key or the link it sent you.", { version: reply.version }) : t("This Omni is too old to pair from here. Update it, or paste an API key or the link it sent you.");
  }
  if (reply?.reason === "off") return t("Pairing is off on this Omni. Its owner can turn it on, or you can paste an API key.");
  return reply?.message ?? null;
}
var noticeWords = (notice) => notice === "broad-key" ? t("This key can do everything on your Omni; consider giving this device its own key.") : null;
function firstOpen(found, { mac = false } = {}) {
  const ready = found.find((omni2) => ["use", "connect", "update", "reinstall"].includes(foundRow(omni2, { mac }).action));
  return ready ? ready.id : REMOTE;
}
function readRemote(text) {
  const value = String(text ?? "").trim();
  if (value === "") return null;
  const link = parseConnectLink(value);
  if (link) return { kind: "grant", ...link };
  if (/^omni:/i.test(value) || /[?&]grant=/.test(value)) return { kind: "bad-link" };
  return { kind: "address", url: value };
}
function Choice({ id, open, icon, accent, title, sub, badge, tone, onToggle, children }) {
  return (0, import_react8.createElement)(
    "li",
    { className: `ox-choice${open ? " ox-open" : ""}` },
    (0, import_react8.createElement)(
      "button",
      { type: "button", className: "ox-head", "aria-expanded": open, "aria-controls": `ox-body-${id}`, onClick: onToggle },
      (0, import_react8.createElement)("span", { className: `ox-icon${accent ? " ox-accent" : ""}`, "aria-hidden": true }, icon),
      (0, import_react8.createElement)("span", { className: "ox-what" }, (0, import_react8.createElement)("strong", null, title), sub ? (0, import_react8.createElement)("small", null, sub) : null),
      badge ? (0, import_react8.createElement)("span", { className: `ox-badge ox-${tone}` }, badge) : null,
      (0, import_react8.createElement)("span", { className: "ox-chev", "aria-hidden": true }, "›")
    ),
    open ? (0, import_react8.createElement)("div", { className: "ox-body", id: `ox-body-${id}` }, children) : null
  );
}
function KeyEntry({ hint, disabled, onConnect, startOpen = false }) {
  const [open, setOpen] = (0, import_react8.useState)(startOpen);
  const [value, setValue] = (0, import_react8.useState)("");
  if (!open) return (0, import_react8.createElement)("button", { type: "button", className: "ox-link", onClick: () => setOpen(true) }, t("Use it with an API key"));
  const submit = (event) => {
    event.preventDefault();
    const key = value.trim();
    if (key === "") return;
    setValue("");
    onConnect(key);
  };
  return (0, import_react8.createElement)(
    "form",
    { className: "ox-keyform", onSubmit: submit },
    (0, import_react8.createElement)("p", { className: "ox-muted" }, t("Older Omnis can't approve this app. Paste its API key instead; it stays on this computer.")),
    hint ? (0, import_react8.createElement)("p", { className: "ox-muted" }, t("Find the key where that app keeps its settings.")) : null,
    (0, import_react8.createElement)(
      "div",
      { className: "ox-field" },
      (0, import_react8.createElement)("input", { className: "ox-input", type: "password", autoComplete: "off", spellCheck: false, value, placeholder: t("API key"), "aria-label": t("API key for this Omni"), onChange: (event) => setValue(event.target.value) }),
      (0, import_react8.createElement)("button", { type: "submit", className: "oc-primary", disabled: disabled || value.trim() === "" }, t("Connect"))
    )
  );
}
var Linked = ({ text }) => (0, import_react8.createElement)("p", { className: "ox-linked", role: "status" }, (0, import_react8.createElement)("span", { "aria-hidden": true }, "✓"), text);
function ConnectOmni({ onPaired, embedded = false } = {}) {
  const mac = onMac();
  const [found, setFound] = (0, import_react8.useState)(null);
  const [sandbox, setSandbox] = (0, import_react8.useState)(null);
  const [open, setOpen] = (0, import_react8.useState)(null);
  const [remote, setRemote] = (0, import_react8.useState)("");
  const [pairing, setPairing] = (0, import_react8.useState)(null);
  const [busy, setBusy] = (0, import_react8.useState)(null);
  const [problem, setProblem] = (0, import_react8.useState)(null);
  const [note, setNote] = (0, import_react8.useState)(null);
  const [linked, setLinked] = (0, import_react8.useState)(null);
  const [terminal, setTerminal] = (0, import_react8.useState)(null);
  const [remoteKey, setRemoteKey] = (0, import_react8.useState)(null);
  const alive = (0, import_react8.useRef)(true);
  (0, import_react8.useEffect)(() => () => {
    alive.current = false;
  }, []);
  (0, import_react8.useEffect)(() => {
    call("omni-link").then((link) => {
      if (alive.current && link?.pairing) setPairing(link.pairing);
    }, () => {
    });
    call("omni-discover").then((reply) => {
      if (!alive.current) return;
      const omnis2 = Array.isArray(reply?.omnis) ? reply.omnis : [];
      setFound(omnis2);
      setSandbox(reply?.sandbox ?? null);
      setOpen((current) => current ?? firstOpen(omnis2, { mac }));
    }, () => {
      if (!alive.current) return;
      setFound([]);
      setOpen((current) => current ?? REMOTE);
    });
    const onPairing = (event) => {
      if (!alive.current) return;
      if (event.detail?.problem) setProblem(event.detail.problem);
      else if (event.detail?.paired) void finish(REMOTE, event.detail.paired);
      else if (event.detail) setPairing(event.detail);
    };
    window.addEventListener(PAIRING_EVENT, onPairing);
    return () => window.removeEventListener(PAIRING_EVENT, onPairing);
  }, []);
  const pairingRow = (0, import_react8.useRef)(REMOTE);
  const finish = async (row, origin, version = null) => {
    setPairing(null);
    setTerminal(null);
    setLinked({ row, origin, version });
    setOpen(row);
    await refreshLive(call).catch(() => {
    });
    if (alive.current) onPaired?.(origin);
  };
  (0, import_react8.useEffect)(() => {
    if (!pairing) return void 0;
    let timer = 0;
    const tick = async () => {
      try {
        const reply = await call("omni-pair-poll");
        if (!alive.current) return;
        if (reply.status === "paired") return finish(pairingRow.current, reply.origin);
        if (reply.status !== "pending") {
          setPairing(null);
          setProblem(reply.status === "denied" ? t("The sign-in was denied.") : reply.status === "cancelled" ? t("The pairing was cancelled.") : t("The code expired. Start again for a new one."));
          return;
        }
      } catch (error) {
        if (alive.current) setProblem(error.message);
      }
      if (alive.current) timer = setTimeout(tick, pairing.pollIntervalMs ?? DEFAULT_POLL_MS);
    };
    timer = setTimeout(tick, pairing.pollIntervalMs ?? DEFAULT_POLL_MS);
    return () => clearTimeout(timer);
  }, [pairing]);
  const run = async (row, endpoint, payload) => {
    setBusy(row);
    setProblem(null);
    setNote(null);
    try {
      const reply = await call(endpoint, payload);
      if (!alive.current) return;
      if (reply.status === "paired") {
        await finish(row, reply.origin);
        if (alive.current) setNote(noticeWords(reply.notice));
      } else if (reply.status === "unavailable") {
        if (row === REMOTE) setRemoteKey({ url: reply.url, reason: reply.reason, version: reply.version ?? null });
        setProblem(unavailableWords(reply));
      } else if (reply.pairing) {
        pairingRow.current = row;
        setPairing(reply.pairing);
      } else if (reply.message) setNote(reply.message);
    } catch (error) {
      if (alive.current) setProblem(error.message);
    } finally {
      if (alive.current) setBusy(null);
    }
  };
  const submitRemote = (event) => {
    event.preventDefault();
    const wanted = readRemote(remote);
    if (wanted === null) return void 0;
    if (wanted.kind === "bad-link") {
      setNote(null);
      setProblem(t("That is not a link your Omni sends. It looks like https://your-omni/api/login/app?grant=…"));
      return void 0;
    }
    return wanted.kind === "grant" ? run(REMOTE, "omni-connect-grant", { url: wanted.url, grant: wanted.grant }) : run(REMOTE, "omni-pair-start", { url: wanted.url });
  };
  const openTerminal = (row, kind, id) => {
    setProblem(null);
    setNote(null);
    setTerminal({ row, kind, id, title: kind === "update" ? t("Update Omni") : mac ? t("Install Omni on this Mac") : t("Install Omni on this computer") });
  };
  const terminalEnded = (reply) => {
    if (reply.state !== "done" || !reply.result) return;
    if (reply.result.status === "paired") void finish(terminal?.row ?? LOCAL, reply.result.origin, reply.result.version ?? null);
    else if (reply.result.pairing) {
      pairingRow.current = terminal?.row ?? REMOTE;
      setTerminal(null);
      setPairing(reply.result.pairing);
    }
  };
  const cancelPairing = async () => {
    setPairing(null);
    await call("omni-pair-cancel").catch(() => {
    });
  };
  if (pairing) {
    return (0, import_react8.createElement)(
      "section",
      { className: "ox-card", "aria-live": "polite" },
      (0, import_react8.createElement)(
        "div",
        { className: "ox-steps" },
        (0, import_react8.createElement)("h2", null, t("Approve this device")),
        (0, import_react8.createElement)("p", { className: "ox-muted" }, pairing.waLink ? t("Scan the QR with your phone: it opens your WhatsApp chat with yourself with the code typed. Send it, and this page goes live.") : t("Open the approval page on your phone or here, and approve with Face ID, Touch ID, your fingerprint or a code.")),
        (0, import_react8.createElement)("div", { className: "ox-code", "aria-label": t("Pairing code") }, pairing.code),
        // The operator owns the Omni, so approving from its own terminal works without a phone.
        (0, import_react8.createElement)("p", { className: "ox-muted" }, t("Or, on the computer that runs that Omni:"), " ", (0, import_react8.createElement)("code", null, `omni approve ${pairing.code}`)),
        (0, import_react8.createElement)(
          "div",
          { className: "ox-row" },
          pairing.waLink ? (0, import_react8.createElement)("a", { className: "oc-primary", href: pairing.waLink, target: "_blank", rel: "noreferrer" }, t("Open WhatsApp")) : null,
          pairing.approveUrl ? (0, import_react8.createElement)("a", { className: pairing.waLink ? "oc-ghost" : "oc-primary", href: pairing.approveUrl, target: "_blank", rel: "noreferrer" }, t("Approve with Face ID or fingerprint")) : null,
          (0, import_react8.createElement)("button", { type: "button", className: "oc-ghost", onClick: cancelPairing }, t("Cancel"))
        ),
        (0, import_react8.createElement)("span", { className: "ox-wait" }, (0, import_react8.createElement)("span", { className: "oc-spinner", "aria-hidden": true }), t("Waiting for the code to arrive at {origin}…", { origin: pairing.origin })),
        problem ? (0, import_react8.createElement)("p", { className: "ox-problem", role: "alert" }, problem) : null
      ),
      (0, import_react8.createElement)(
        "div",
        { className: "ox-qr" },
        (0, import_react8.createElement)(QrSvg, { text: pairing.waLink ?? pairing.approveUrl, size: 168 }),
        (0, import_react8.createElement)("span", { className: "ox-muted" }, pairing.waLink ? t("Scan to send it on WhatsApp") : t("Scan to approve on your phone"))
      )
    );
  }
  const omnis = found ?? [];
  const hasSandbox = omnis.some((omni2) => omni2.source === "sandbox");
  const anyBusy = busy !== null || terminal !== null;
  const toggle = (row) => () => setOpen((current) => current === row ? null : row);
  const terminalOn = (row) => terminal?.row === row ? (0, import_react8.createElement)(InlineTerminal, { key: `${terminal.kind}:${terminal.id ?? ""}`, kind: terminal.kind, id: terminal.id, title: terminal.title, onEnded: terminalEnded, onClose: () => setTerminal(null) }) : null;
  const primary = (label, onClick, disabled = false) => (0, import_react8.createElement)("button", { type: "button", className: "oc-primary", disabled: disabled || anyBusy, onClick }, label);
  const whatRuns = (command) => (0, import_react8.createElement)(
    "details",
    { className: "ox-more" },
    (0, import_react8.createElement)("summary", null, t("What runs")),
    (0, import_react8.createElement)("code", null, command),
    " ",
    t("runs in a terminal you can watch. Nothing runs until you press Enter.")
  );
  const rows = omnis.map((omni2) => {
    const isLinked = linked?.row === omni2.id;
    const view = foundRow(omni2, { mac, linked: isLinked });
    let body;
    if (isLinked) body = (0, import_react8.createElement)(Linked, { text: linked.version ? t("Connected to Omni {version}", { version: linked.version }) : t("Connected to {origin}", { origin: linked.origin }) });
    else if (terminal?.row === omni2.id) body = terminalOn(omni2.id);
    else {
      const action = view.action === "update" ? (0, import_react8.createElement)("div", null, primary(t("Update and connect"), () => openTerminal(omni2.id, "update", omni2.id)), whatRuns("omni update --yes")) : view.action === "reinstall" ? (0, import_react8.createElement)("div", null, primary(t("Update and connect"), () => openTerminal(omni2.id, "install")), whatRuns(`bun x --bun @automagik/omni@${omni2.updateTo} install --sandbox --at-login`)) : view.action === "use" ? primary(busy === omni2.id ? t("Connecting…") : t("Use it"), () => run(omni2.id, "omni-discover-use", { id: omni2.id })) : view.action === "connect" ? primary(busy === omni2.id ? t("Connecting…") : t("Connect"), () => run(omni2.id, "omni-discover-use", { id: omni2.id })) : view.action === "elsewhere" && !hasSandbox ? (0, import_react8.createElement)("button", { type: "button", className: "oc-ghost", onClick: () => setOpen(LOCAL) }, mac ? t("Run Omni on this Mac") : t("Run Omni on this computer")) : null;
      body = (0, import_react8.createElement)(
        "div",
        null,
        view.note ? (0, import_react8.createElement)("p", { className: "ox-muted" }, view.note) : null,
        action ? (0, import_react8.createElement)("div", { className: "ox-row ox-act" }, action) : null,
        view.keyEntry ? (0, import_react8.createElement)(KeyEntry, { hint: view.keyHint, disabled: anyBusy, onConnect: (apiKey) => run(omni2.id, "omni-discover-key", { id: omni2.id, apiKey }) }) : null
      );
    }
    return (0, import_react8.createElement)(Choice, { key: omni2.id, id: omni2.id, open: open === omni2.id, icon: "◉", title: view.title, sub: view.sub, badge: view.badge, tone: view.tone, onToggle: toggle(omni2.id) }, body);
  });
  const remoteLinked = linked?.row === REMOTE;
  rows.push((0, import_react8.createElement)(Choice, {
    key: REMOTE,
    id: REMOTE,
    open: open === REMOTE,
    icon: "⌁",
    title: t("An Omni somewhere else"),
    sub: t("On a server, a VPS, or another computer"),
    badge: remoteLinked ? t("Connected") : null,
    tone: "ok",
    onToggle: toggle(REMOTE)
  }, remoteLinked ? (0, import_react8.createElement)(Linked, { text: t("Connected to {origin}", { origin: linked.origin }) }) : (0, import_react8.createElement)(
    "div",
    null,
    (0, import_react8.createElement)(
      "form",
      { className: "ox-field", onSubmit: submitRemote },
      (0, import_react8.createElement)("input", {
        className: "ox-input",
        type: "text",
        inputMode: "url",
        autoComplete: "off",
        spellCheck: false,
        value: remote,
        placeholder: t("omni.example.com, or the link Omni sent you"),
        "aria-label": t("Omni address or link"),
        onChange: (event) => {
          setRemote(event.target.value);
          setRemoteKey(null);
        }
      }),
      (0, import_react8.createElement)("button", { type: "submit", className: "oc-primary", disabled: anyBusy || readRemote(remote) === null }, busy === REMOTE ? t("Connecting…") : t("Continue"))
    ),
    (0, import_react8.createElement)("p", { className: "ox-muted ox-hint" }, t("No address? Text connect to yourself on WhatsApp, and your Omni replies with a link that connects this app.")),
    remoteKey ? (0, import_react8.createElement)(KeyEntry, { key: remoteKey.url, startOpen: true, disabled: anyBusy, onConnect: (apiKey) => run(REMOTE, "omni-discover-key", { url: remoteKey.url, apiKey }) }) : null
  )));
  if (!hasSandbox) {
    const localLinked = linked?.row === LOCAL;
    rows.push((0, import_react8.createElement)(Choice, {
      key: LOCAL,
      id: LOCAL,
      open: open === LOCAL,
      icon: "✦",
      accent: true,
      title: mac ? t("Run Omni on this Mac") : t("Run Omni on this computer"),
      sub: mac ? t("A private Omni just for this Mac · about 1 GB") : t("A private Omni just for this computer · about 1 GB"),
      badge: localLinked ? t("Connected") : null,
      tone: "ok",
      onToggle: toggle(LOCAL)
    }, localLinked ? (0, import_react8.createElement)(Linked, { text: linked.version ? t("Connected to Omni {version}", { version: linked.version }) : t("Connected to {origin}", { origin: linked.origin }) }) : terminal?.row === LOCAL ? terminalOn(LOCAL) : (0, import_react8.createElement)(
      "div",
      null,
      (0, import_react8.createElement)("p", { className: "ox-muted" }, mac ? t("It starts with your Mac, stays on it, and never touches another Omni.") : t("It starts with your computer, stays on it, and never touches another Omni.")),
      (0, import_react8.createElement)("div", { className: "ox-row ox-act" }, primary(t("Set it up"), () => openTerminal(LOCAL, "install"))),
      sandbox?.home ? (0, import_react8.createElement)("details", { className: "ox-more" }, (0, import_react8.createElement)("summary", null, t("Where it lives")), t("{home}, with its own database, NATS and ports.", { home: sandbox.home })) : null
    )));
  }
  const lede = linked ? null : omnis.length > 0 ? mac ? t("We found an Omni on this Mac. Use it, or pick another.") : t("We found an Omni on this computer. Use it, or pick another.") : t("Where does your Omni live?");
  return (0, import_react8.createElement)(
    "section",
    { className: "ox-card ox-start" },
    embedded ? null : (0, import_react8.createElement)("span", { className: "ox-mark", "aria-hidden": true }, (0, import_react8.createElement)(OmniMark, { size: 34 })),
    (0, import_react8.createElement)(
      "div",
      { className: "ox-steps" },
      embedded ? null : (0, import_react8.createElement)("h2", null, t("Connect your Omni")),
      lede ? (0, import_react8.createElement)("p", { className: "ox-muted ox-lede" }, lede) : null,
      found === null ? (0, import_react8.createElement)("span", { className: "ox-wait" }, (0, import_react8.createElement)("span", { className: "oc-spinner", "aria-hidden": true }), t("Looking for Omnis on this computer…")) : (0, import_react8.createElement)("ul", { className: "ox-choices" }, rows),
      note ? (0, import_react8.createElement)("p", { className: "ox-muted ox-note", role: "status" }, note) : null,
      problem ? (0, import_react8.createElement)("p", { className: "ox-problem", role: "alert" }, problem) : null
    )
  );
}
var OMNI_CONNECT_CSS = OMNI_UPDATE_CSS + OMNI_TERMINAL_CSS + `
.ox-card{display:flex;gap:22px;align-items:flex-start;margin:4px 0 22px;padding:20px 22px;border:1px solid var(--bt-line);border-radius:16px;background:color-mix(in srgb,var(--bt-accent) 5%,var(--bt-surface,transparent))}
.ox-mark{flex:none;display:inline-grid;place-items:center;width:56px;height:56px;border-radius:16px;background:color-mix(in srgb,var(--bt-accent) 12%,transparent);color:var(--bt-ink)}
.ox-steps{display:flex;flex-direction:column;gap:10px;min-width:0;flex:1}
.ox-steps h2{margin:0;font-size:16px;font-weight:600}
.ox-muted{margin:0;color:var(--bt-ink-2);font-size:13px;line-height:1.45}
.ox-lede{font-size:14px}
.ox-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.ox-input{flex:1;min-width:200px;height:38px;padding:0 12px;border-radius:10px;border:1px solid var(--bt-line-2);background:var(--bt-bg,transparent);color:var(--bt-ink);font:inherit;font-size:14px}
.ox-input:focus{outline:2px solid color-mix(in srgb,var(--bt-accent) 55%,transparent);outline-offset:1px}
.ox-field{display:flex;gap:8px;flex-wrap:wrap}
.ox-code{font:600 34px/1.1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.12em;color:var(--bt-ink);user-select:all}
.ox-wait{display:inline-flex;align-items:center;gap:8px;color:var(--bt-ink-2);font-size:12.5px}
.ox-problem{margin:0;color:var(--oc-bad,#c0392b);font-size:13px}
.ox-qr{flex:none;display:flex;flex-direction:column;align-items:center;gap:8px;padding:10px;border-radius:12px;background:#fff}
.ox-qr .ox-muted{color:#555;font-size:11.5px}
.ox-choices{display:flex;flex-direction:column;gap:10px;margin:0;padding:0;list-style:none}
.ox-choice{border:1px solid var(--bt-line);border-radius:14px;background:var(--bt-bg,transparent);transition:border-color .15s}
.ox-choice.ox-open{border-color:var(--bt-line-2);background:color-mix(in srgb,var(--bt-accent) 4%,var(--bt-bg,transparent))}
.ox-head{display:flex;align-items:center;gap:14px;width:100%;padding:14px 16px;border:0;background:none;color:inherit;font:inherit;text-align:left;cursor:pointer;border-radius:14px}
.ox-head:focus-visible{outline:2px solid var(--bt-accent);outline-offset:-2px}
.ox-icon{flex:none;display:grid;place-items:center;width:36px;height:36px;border-radius:10px;background:color-mix(in srgb,var(--bt-accent) 10%,transparent);color:var(--bt-accent);font-size:17px}
.ox-icon.ox-accent{color:var(--oxs-accent-2,#ff3bd4);background:color-mix(in srgb,var(--oxs-accent-2,#ff3bd4) 10%,transparent)}
.ox-what{flex:1;min-width:0;display:flex;flex-direction:column}
.ox-what strong{font-size:14.5px;font-weight:600;overflow-wrap:anywhere}
.ox-what small{color:var(--bt-ink-2);font-size:12.5px}
.ox-badge{flex:none;font-size:11px;padding:3px 8px;border-radius:999px;border:1px solid var(--bt-line-2);color:var(--bt-ink-2);white-space:nowrap}
.ox-badge.ox-warn{border-color:#5a4a1c;color:#f0c86a}
.ox-badge.ox-ok{border-color:#1c5a44;color:#4fe0a8}
.ox-chev{flex:none;color:var(--bt-ink-2);transition:transform .15s}
.ox-open .ox-chev{transform:rotate(90deg)}
.ox-body{padding:0 16px 16px 66px;display:flex;flex-direction:column;gap:10px}
.ox-act{margin-top:2px}
.ox-hint,.ox-note{font-size:12.5px}
.ox-more{color:var(--bt-ink-2);font-size:12.5px;margin-top:8px}
.ox-more summary{cursor:pointer}
.ox-more code{font:12px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--bt-ink)}
.ox-link{align-self:flex-start;margin-top:8px;padding:0;border:0;background:none;color:var(--bt-accent);font:inherit;font-size:13px;cursor:pointer;text-decoration:underline;text-underline-offset:3px}
.ox-keyform{display:flex;flex-direction:column;gap:8px;margin-top:10px}
.ox-linked{display:flex;align-items:center;gap:10px;margin:0;color:#4fe0a8;font-weight:600}
@media (max-width:720px){.ox-card{flex-direction:column}.ox-qr{align-self:center}.ox-body{padding-left:16px}}
`;

// src/client/connect-step.js
var import_react9 = require("react");
var import_react_dom = require("react-dom");
var RAIL = [["omni-welcome", "Welcome"], ["omni-connect", "Connect Omni"], ["omni-connect-ai", "Connect AI"]];
var ANNOUNCED = /* @__PURE__ */ Symbol.for("automagik.omni.onboarding-steps");
function announceStep(id, scope = globalThis) {
  const steps = scope[ANNOUNCED] ??= /* @__PURE__ */ new Set();
  steps.add(id);
  return () => steps.delete(id);
}
function railSteps(scope = globalThis) {
  const steps = scope[ANNOUNCED];
  return RAIL.filter(([id]) => id === CONNECT_STEP.id || steps?.has(id) === true);
}
function continueButton(linked, scope = globalThis, { onDemand = false } = {}) {
  if (onDemand) return linked ? { label: t("Done"), disabled: false, title: void 0 } : { label: t("Done"), disabled: true, title: t("Connect an Omni first, or close this") };
  if (!linked) return { label: t("Continue"), disabled: true, title: t("Connect an Omni first, or skip for now") };
  const next = railSteps(scope).some(([id]) => id === "omni-connect-ai");
  return { label: next ? t("Continue to Connect AI →") : t("Continue"), disabled: false, title: void 0 };
}
var reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
var OCTOPUS = CHARACTERS.octopus;
var OCTOPUS_SVG = `<svg class="oxs-octo" viewBox="0 0 100 100" aria-hidden="true">
<defs><radialGradient id="oxs-octo-skin" cx=".35" cy=".25" r=".9"><stop offset="0" style="stop-color:color-mix(in srgb,var(--oxs-skin) 55%,#fff)"/><stop offset=".55" style="stop-color:var(--oxs-skin)"/><stop offset="1" style="stop-color:var(--oxs-skin-shade)"/></radialGradient></defs>
<path class="oxs-ghost oxs-cyan" d="${OCTOPUS.body}"/><path class="oxs-ghost oxs-magenta" d="${OCTOPUS.body}"/>
<path d="${OCTOPUS.body}" fill="url(#oxs-octo-skin)"/><path d="${OCTOPUS.shade}" style="fill:var(--oxs-skin-shade)" opacity=".45"/>
<path d="${OCTOPUS.light}" fill="#fff" opacity=".4"/>
<g class="oxs-eyes">${OCTOPUS.eyes.map(([cx, cy, width, height]) => `<ellipse cx="${cx}" cy="${cy}" rx="${width}" ry="${height}" fill="#2a2233"/><circle cx="${cx + 2}" cy="${cy - 5}" r="2.4" fill="#fff"/>`).join("")}</g>
<path d="M44 54Q50 59 56 54" stroke="#2a2233" stroke-width="2.4" fill="none" stroke-linecap="round"/>
<ellipse cx="31" cy="50" rx="5" ry="2.8" fill="#e98bbf" opacity=".55"/><ellipse cx="69" cy="50" rx="5" ry="2.8" fill="#e98bbf" opacity=".55"/>
</svg>`;
function useGlitch() {
  const [on2, setOn] = (0, import_react9.useState)(false);
  const timer = (0, import_react9.useRef)(0);
  (0, import_react9.useEffect)(() => () => clearTimeout(timer.current), []);
  const glitch = (0, import_react9.useCallback)(() => {
    if (reducedMotion()) return;
    setOn(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOn(false), 900);
  }, []);
  return [on2, glitch];
}
function useTypewriter(text) {
  const [shown, setShown] = (0, import_react9.useState)(() => reducedMotion() ? text : "");
  (0, import_react9.useEffect)(() => {
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
function Stage({ title, speech, glitching, rail = true, children }) {
  const titleRef = (0, import_react9.useRef)(null);
  (0, import_react9.useEffect)(() => {
    const root = document.getElementById("root");
    if (root === null) return void 0;
    const previous = root.inert;
    root.inert = true;
    return () => {
      root.inert = previous;
    };
  }, []);
  (0, import_react9.useEffect)(() => {
    titleRef.current?.focus();
  }, [title]);
  const shown = useTypewriter(speech);
  return (0, import_react_dom.createPortal)((0, import_react9.createElement)(
    "div",
    { className: "oxs-overlay", role: "dialog", "aria-modal": "true", "aria-labelledby": "oxs-title" },
    (0, import_react9.createElement)(
      "div",
      { className: `oxs-stage${glitching ? " oxs-glitch" : ""}` },
      (0, import_react9.createElement)("div", { dangerouslySetInnerHTML: { __html: OCTOPUS_SVG } }),
      (0, import_react9.createElement)(
        "div",
        { className: "oxs-bubble" },
        (0, import_react9.createElement)("span", { className: "oxs-hidden", role: "status" }, speech),
        (0, import_react9.createElement)("span", { "aria-hidden": "true" }, shown, shown.length < speech.length ? (0, import_react9.createElement)("span", { className: "oxs-caret" }) : null)
      ),
      rail ? (0, import_react9.createElement)("ol", { className: "oxs-rail", "aria-label": t("Setup steps") }, railSteps().map(([id, label], index, steps) => {
        const at2 = steps.findIndex(([step]) => step === CONNECT_STEP.id);
        return (0, import_react9.createElement)("li", {
          key: id,
          className: index < at2 ? "oxs-done" : index === at2 ? "oxs-on" : "",
          "aria-current": index === at2 ? "step" : void 0
        }, t(label));
      })) : null,
      (0, import_react9.createElement)(
        "main",
        { className: "oxs-card" },
        (0, import_react9.createElement)("h1", { id: "oxs-title", ref: titleRef, tabIndex: -1 }, title),
        children
      )
    )
  ), document.body);
}
function useGate(props) {
  const first = (0, import_react9.useRef)(props);
  const [state, setState] = (0, import_react9.useState)(void 0);
  (0, import_react9.useEffect)(() => {
    let alive = true;
    gateConnect(first.current, { request: call }).then((next) => {
      if (alive) setState(next);
    });
    return () => {
      alive = false;
    };
  }, []);
  return state;
}
function ConnectOmniStep(props) {
  const state = useGate(props);
  const [glitching, glitch] = useGlitch();
  const [paired, setPaired] = (0, import_react9.useState)(null);
  const finished = (0, import_react9.useRef)(false);
  const onDemand = props.onDemand === true;
  (0, import_react9.useEffect)(() => {
    if (state) glitch();
  }, [state, glitch]);
  (0, import_react9.useEffect)(() => state && !onDemand ? noteStepShown() : void 0, [state, onDemand]);
  const complete = (0, import_react9.useCallback)(() => {
    if (finished.current) return;
    finished.current = true;
    props.complete();
  }, [props]);
  const skip = (0, import_react9.useCallback)(() => {
    if (finished.current) return;
    finished.current = true;
    if (onDemand) props.complete();
    else void skipConnect({ complete: props.complete });
  }, [props, onDemand]);
  const onPaired = (0, import_react9.useCallback)((origin) => {
    setPaired(origin);
    glitch();
  }, [glitch]);
  if (!state) return null;
  if (isConnected(state.link) && !onDemand) {
    const origin = state.link.origin ?? "";
    return (0, import_react9.createElement)(
      Stage,
      { title: t("Omni connected"), speech: origin ? t("Connected to {origin}! Now I can see your channels.", { origin }) : t("Your Omni is connected. Now I can see your channels."), glitching },
      (0, import_react9.createElement)("button", { type: "button", className: "oxs-primary", onClick: complete }, t("Continue"))
    );
  }
  const next = continueButton(paired !== null, globalThis, { onDemand });
  return (0, import_react9.createElement)(
    Stage,
    { title: t("Connect your Omni"), speech: paired !== null ? t("Connected to {origin}! Now I can see your channels.", { origin: paired }) : t("Show me your Omni, so I can see your channels."), glitching, rail: !onDemand },
    (0, import_react9.createElement)(ConnectOmni, { onPaired, embedded: true }),
    (0, import_react9.createElement)(
      "div",
      { className: "oxs-actions" },
      (0, import_react9.createElement)("button", { type: "button", className: "oxs-quiet", onClick: skip }, onDemand ? t("Close") : t("Skip for now")),
      (0, import_react9.createElement)("button", { type: "button", className: "oxs-primary", disabled: next.disabled, title: next.title, onClick: complete }, next.label)
    )
  );
}
var raised = (fill, depth = 4) => `background:${fill};box-shadow:inset 2px 3px 4px color-mix(in srgb,${fill} var(--oxs-hi),var(--oxs-shine)),inset -3px -4px 6px color-mix(in srgb,${fill} var(--oxs-lo),var(--oxs-umber)),0 ${depth}px 0 color-mix(in srgb,${fill} var(--oxs-ledge),var(--oxs-umber)),0 ${depth + 3}px ${depth + 5}px var(--oxs-cast),0 ${depth * 3 + 4}px ${depth * 5 + 8}px var(--oxs-cast-far)`;
var pressed = (fill, depth = 4) => `transform:translateY(${depth - 1}px);box-shadow:inset 3px 4px 6px color-mix(in srgb,${fill} var(--oxs-lo),var(--oxs-umber)),inset -1px -2px 3px color-mix(in srgb,${fill} var(--oxs-hi),var(--oxs-shine)),0 1px 0 color-mix(in srgb,${fill} var(--oxs-ledge),var(--oxs-umber)),0 2px 3px var(--oxs-cast)`;
var recessed = (fill) => `background:${fill};box-shadow:inset 3px 4px 6px color-mix(in srgb,${fill} var(--oxs-lo),var(--oxs-umber)),inset -2px -2px 3px color-mix(in srgb,${fill} var(--oxs-hi),var(--oxs-shine)),0 1px 0 color-mix(in srgb,var(--oxs-bg) var(--oxs-hi),var(--oxs-shine))`;
var STAGE_CSS = `
.oxs-overlay{
  --oxs-bg:#f6eee2;--oxs-card:#fbf5ec;--oxs-clay:#f2e6d5;--oxs-niche:#ebdecb;
  --oxs-ink:#3c3049;--oxs-ink2:#6c5f71;--oxs-line:#e0d0bd;
  --oxs-accent:#1b7f96;--oxs-accent-2:#b4498f;--oxs-bad:#b93a32;--oxs-ok:#2f8a63;--oxs-warn:#a8700f;--oxs-ok-ink:#1a5c3f;--oxs-warn-ink:#7a5108;
  --oxs-cyan:#8fdcec;--oxs-cyan-ink:#1d4753;--oxs-pink:#f0bddf;--oxs-lilac:#e0cff3;--oxs-lilac-ink:#45305e;
  --oxs-skin:#2bc3b6;--oxs-skin-shade:#16867d;
  --oxs-shine:#fff;--oxs-umber:#5b3b22;--oxs-hi:42%;--oxs-lo:80%;--oxs-ledge:72%;
  --oxs-cast:rgba(111,81,53,.2);--oxs-cast-far:rgba(121,91,53,.1);--oxs-ring:#b4498f;
  --oxs-r:19px 22px 18px 21px;--oxs-r-sm:12px 14px 12px 13px;
  --oxs-font:"DM Sans",ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  --oxs-head:Manrope,"DM Sans",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
  --bt-line:var(--oxs-line);--bt-line-2:color-mix(in srgb,var(--oxs-line) 70%,var(--oxs-ink2));--bt-accent:var(--oxs-accent);--bt-accent-ink:#fff;
  --bt-ink:var(--oxs-ink);--bt-ink-2:var(--oxs-ink2);--bt-ink-3:var(--oxs-ink2);--bt-surface:transparent;--bt-bg:var(--oxs-niche);--bt-card:var(--oxs-card);
  --bt-hover:color-mix(in srgb,var(--oxs-clay) 70%,var(--oxs-niche));--oc-bad:var(--oxs-bad);
  position:fixed;inset:0;z-index:2000;overflow:auto;display:grid;place-items:center;padding:24px 16px;box-sizing:border-box;color-scheme:light;color:var(--oxs-ink);
  font:15px/1.55 var(--oxs-font);background:var(--oxs-bg)}
body[data-ds-dark-theme] .oxs-overlay{
  --oxs-bg:#1e1923;--oxs-card:#2a2330;--oxs-clay:#322a39;--oxs-niche:#16121a;
  --oxs-ink:#f3e9dd;--oxs-ink2:#bcadb8;--oxs-line:#40364a;
  --oxs-accent:#7fd8ea;--oxs-accent-2:#f2a6dc;--oxs-bad:#ff9a8f;--oxs-ok:#7ad9a8;--oxs-warn:#f2c25b;--oxs-ok-ink:#7ad9a8;--oxs-warn-ink:#f2c25b;
  --oxs-cyan:#5cbdd1;--oxs-cyan-ink:#0d262c;--oxs-pink:#b76aa1;--oxs-lilac:#55456b;--oxs-lilac-ink:#f4ecff;
  --oxs-skin:#3fd3c5;--oxs-skin-shade:#1c8f86;
  --oxs-shine:#fff;--oxs-umber:#000;--oxs-hi:84%;--oxs-lo:62%;--oxs-ledge:50%;
  --oxs-cast:rgba(0,0,0,.42);--oxs-cast-far:rgba(0,0,0,.28);--oxs-ring:#f2a6dc;--bt-accent-ink:#0d262c;
  color-scheme:dark}
.oxs-overlay *{box-sizing:border-box}
.oxs-overlay ::selection{background:var(--oxs-lilac);color:var(--oxs-lilac-ink)}
.oxs-overlay::before{content:"";position:fixed;inset:0;pointer-events:none;background:radial-gradient(1100px 620px at 30% -12%,color-mix(in srgb,var(--oxs-bg) 55%,var(--oxs-shine)),transparent 70%)}
body[data-ds-dark-theme] .oxs-overlay::before{background:radial-gradient(1100px 620px at 30% -12%,color-mix(in srgb,var(--oxs-bg) 88%,var(--oxs-cyan)),transparent 70%)}
.oxs-stage{position:relative;z-index:1;width:min(600px,100%);display:flex;flex-direction:column;align-items:center}
.oxs-octo{width:124px;height:124px;filter:drop-shadow(0 10px 8px var(--oxs-cast)) drop-shadow(0 22px 22px var(--oxs-cast-far));animation:oxs-float 4.5s ease-in-out infinite}
.oxs-ghost{opacity:0}.oxs-cyan{fill:var(--oxs-cyan)}.oxs-magenta{fill:var(--oxs-pink)}
.oxs-glitch .oxs-cyan{opacity:.7;transform:translate(-2px,0);animation:oxs-wobble .9s ease-out}
.oxs-glitch .oxs-magenta{opacity:.7;transform:translate(2px,0);animation:oxs-wobble .9s ease-out reverse}
.oxs-eyes{transform-origin:50px 36px;animation:oxs-blink 5s infinite}
@keyframes oxs-float{0%,100%{transform:translateY(0) rotate(-2deg)}50%{transform:translateY(-10px) rotate(2deg)}}
@keyframes oxs-blink{0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(.1)}}
@keyframes oxs-wobble{from{opacity:.7}to{opacity:0}}
.oxs-bubble{position:relative;margin:10px 0 20px;padding:11px 18px;border-radius:var(--oxs-r);${raised("var(--oxs-cyan)", 4)};color:var(--oxs-cyan-ink);font:500 15px/1.45 var(--oxs-font);min-height:46px;max-width:100%}
.oxs-bubble::before{content:"";position:absolute;top:-7px;left:50%;width:14px;height:14px;border-radius:3px 0 0 0;transform:translateX(-50%) rotate(45deg);background:var(--oxs-cyan);box-shadow:inset 2px 2px 3px color-mix(in srgb,var(--oxs-cyan) var(--oxs-hi),var(--oxs-shine))}
.oxs-caret{display:inline-block;width:.5em;height:1.05em;margin-left:2px;vertical-align:-2px;border-radius:2px;background:var(--oxs-accent-2);animation:oxs-caret 1s steps(1) infinite}
@keyframes oxs-caret{50%{opacity:0}}
.oxs-hidden{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.oxs-rail{display:flex;flex-wrap:wrap;justify-content:center;gap:10px;margin:0 0 18px;padding:0;list-style:none;font:600 12.5px/1 var(--oxs-font);color:var(--oxs-ink2)}
.oxs-rail li{padding:8px 12px;border-radius:var(--oxs-r-sm);${recessed("var(--oxs-niche)")}}
.oxs-rail li.oxs-on{color:var(--oxs-lilac-ink);${raised("var(--oxs-lilac)", 3)};transform:translateY(-2px)}
.oxs-rail li.oxs-done{color:var(--oxs-cyan-ink);${raised("color-mix(in srgb,var(--oxs-cyan) 80%,var(--oxs-clay))", 2)}}
.oxs-card{width:100%;border-radius:26px 30px 25px 29px;padding:26px;${raised("var(--oxs-card)", 6)}}
.oxs-card h1{font:800 24px/1.2 var(--oxs-head);letter-spacing:-.02em;margin:0 0 12px;outline:none}
/* The connect card inside (omni-connect.js), in the same clay: choices are pieces, fields are hollows. */
.oxs-card .ox-card{display:block;margin:4px 0 8px;padding:0;border:0;background:none}
.oxs-card .ox-mark,.oxs-card .ox-icon{${raised("var(--oxs-clay)", 2)};border-radius:11px 12px 10px 12px;color:var(--oxs-ink)}
.oxs-card .ox-icon.ox-accent{${raised("var(--oxs-pink)", 2)};color:var(--oxs-ink)}
.oxs-card .ox-choice{border:0;border-radius:var(--oxs-r);${raised("var(--oxs-clay)", 3)};transition:transform .16s cubic-bezier(.3,1.4,.5,1)}
.oxs-card .ox-choice.ox-open{${raised("var(--oxs-card)", 3)}}
.oxs-card .ox-choice:not(.ox-open):hover{transform:translateY(-2px)}
.oxs-card .ox-head{border-radius:var(--oxs-r)}
.oxs-card .ox-head:focus-visible{outline:3px solid var(--oxs-ring);outline-offset:2px}
.oxs-card .ox-badge{border:0;${recessed("var(--oxs-niche)")};color:var(--oxs-ink2)}
.oxs-card .ox-badge.ox-ok{background:color-mix(in srgb,var(--oxs-ok) 22%,var(--oxs-card));box-shadow:none;color:var(--oxs-ok-ink)}
.oxs-card .ox-badge.ox-warn{background:color-mix(in srgb,var(--oxs-warn) 22%,var(--oxs-card));box-shadow:none;color:var(--oxs-warn-ink)}
.oxs-card .ox-linked{color:var(--oxs-ok)}
.oxs-card .ox-input{height:44px;padding:0 14px;border:0;border-radius:var(--oxs-r-sm);${recessed("var(--oxs-niche)")};color:var(--oxs-ink);font:15px/1.3 var(--oxs-font)}
.oxs-card .ox-input::placeholder{color:color-mix(in srgb,var(--oxs-ink2) 80%,transparent)}
.oxs-card .ox-input:focus{outline:3px solid var(--oxs-ring);outline-offset:2px}
.oxs-card .ox-code{font-weight:700;color:var(--oxs-ink)}
.oxs-card .ox-qr{${raised("#fff", 3)}}
.oxs-card .oc-primary,.oxs-card .oc-ghost{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:40px;padding:0 16px;border:0;border-radius:var(--oxs-r-sm);font:inherit;font-size:14px;font-weight:600;cursor:pointer;white-space:nowrap;text-decoration:none;transition:transform .16s cubic-bezier(.3,1.4,.5,1)}
.oxs-card .oc-primary{${raised("var(--oxs-cyan)", 4)};color:var(--oxs-cyan-ink)}
.oxs-card .oc-primary:active:not(:disabled){${pressed("var(--oxs-cyan)", 4)}}
.oxs-card .oc-ghost{${raised("var(--oxs-clay)", 3)};color:var(--oxs-ink)}
.oxs-card .oc-ghost:active:not(:disabled){${pressed("var(--oxs-clay)", 3)}}
.oxs-card .oc-primary:hover:not(:disabled),.oxs-card .oc-ghost:hover:not(:disabled){transform:translateY(-2px)}
.oxs-card .oc-primary:disabled,.oxs-card .oc-ghost:disabled{${recessed("var(--oxs-niche)")};color:var(--oxs-ink2);cursor:default;transform:none}
.oxs-card .oc-spinner{width:14px;height:14px;border-radius:50%;border:2px solid color-mix(in srgb,var(--oxs-accent) 25%,transparent);border-top-color:var(--oxs-accent);animation:oxs-spin .8s linear infinite;flex:none}
@keyframes oxs-spin{to{transform:rotate(360deg)}}
.oxs-card .ox-link{color:var(--oxs-accent)}
.oxs-card button.oxs-primary,.oxs-card button.oxs-quiet{display:block;width:100%;min-height:44px;padding:12px 16px;margin:10px 0 0;border:0;border-radius:var(--oxs-r-sm);font:inherit;font-weight:600;cursor:pointer;text-align:center;transition:transform .16s cubic-bezier(.3,1.4,.5,1),box-shadow .16s ease}
.oxs-card button.oxs-primary{${raised("var(--oxs-cyan)", 5)};color:var(--oxs-cyan-ink)}
.oxs-card button.oxs-primary:hover:not(:disabled){transform:translateY(-2px)}
.oxs-card button.oxs-primary:active:not(:disabled){${pressed("var(--oxs-cyan)", 5)}}
/* Off until an Omni is linked: a flat hollow, not a piece, so it never reads as pressable. */
.oxs-card button.oxs-primary:disabled{${recessed("var(--oxs-niche)")};color:var(--oxs-ink2);cursor:not-allowed;transform:none}
.oxs-card button.oxs-quiet{background:none;box-shadow:none;color:var(--oxs-ink2);font-weight:500}
.oxs-actions{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:20px;padding-top:16px;border-top:2px solid color-mix(in srgb,var(--oxs-line) 70%,transparent)}
.oxs-card .oxs-actions button.oxs-primary,.oxs-card .oxs-actions button.oxs-quiet{display:inline-flex;width:auto;margin:0;padding:11px 18px}
.oxs-card .oxs-actions button.oxs-quiet{padding-left:0}
.oxs-card button:focus-visible,.oxs-card a:focus-visible{outline:3px solid var(--oxs-ring);outline-offset:3px}
@media (prefers-reduced-motion:reduce){.oxs-overlay *,.oxs-overlay::before,.oxs-overlay::after{animation:none!important;transition:none!important}}
`;
function installStageStyles() {
  const style = document.createElement("style");
  style.dataset.omniConnectStep = "";
  style.textContent = OMNI_CONNECT_CSS + STAGE_CSS;
  document.head.append(style);
  return () => style.remove();
}
function registerConnectStep(ctx) {
  ctx.effect(installStageStyles, "omni-ui: onboarding stage styles");
  ctx.effect(() => announceStep(CONNECT_STEP.id), "omni-channels: omni-connect on the rail");
  ctx.slots.inject("settings.onboarding", () => ctx.slots.register({ name: "settings.onboarding", id: CONNECT_STEP.id, order: CONNECT_STEP.order }, ConnectOmniStep));
}

// src/client/omni-settings.js
var import_react10 = require("react");
var SETTINGS_SECTION = Object.freeze({ id: "omni", order: 60 });
function settingsView(info, { confirming = false } = {}) {
  if (!info?.linked && !info?.configured) {
    return {
      title: t("Connect your Omni"),
      lines: [t("Link this DSH to your Omni to see your channels and chats here, and let your Bots work with them.")],
      actions: [{ id: "connect", label: t("Connect your Omni"), primary: true }]
    };
  }
  if (!info.linked) {
    return {
      title: t("Omni connected"),
      lines: [t("This DSH reaches an Omni through its profile settings (omni.url and its key).")],
      actions: [{ id: "change", label: t("Change"), primary: false }]
    };
  }
  const lines = [info.version ? t("Omni {version}", { version: info.version }) : info.reachable === false ? t("Not answering right now.") : null].filter(Boolean);
  if (confirming) {
    return {
      title: t("Connected to {origin}", { origin: info.origin }),
      lines: [...lines, t("Disconnect from {origin}? Your Bots stop seeing its channels until you connect again.", { origin: info.origin })],
      actions: [{ id: "confirm-disconnect", label: t("Disconnect"), primary: true, danger: true }, { id: "cancel", label: t("Cancel"), primary: false }]
    };
  }
  return {
    title: t("Connected to {origin}", { origin: info.origin }),
    lines,
    actions: [{ id: "change", label: t("Change"), primary: false }, { id: "disconnect", label: t("Disconnect"), primary: false }]
  };
}
async function runSettingsAction(id, { info, close = () => {
}, request = call, open = openConnectWizard, refresh = () => refreshLive(call) } = {}) {
  if (id === "connect" || id === "change") {
    close();
    open();
    return null;
  }
  if (id === "disconnect") return { info, confirming: true };
  if (id === "cancel") return { info, confirming: false };
  if (id === "confirm-disconnect") {
    await request("omni-disconnect");
    await Promise.resolve(refresh()).catch(() => {
    });
    return { info: await request("omni-link-info"), confirming: false };
  }
  return null;
}
function OmniSettingsSection({ close }) {
  const [info, setInfo] = (0, import_react10.useState)(void 0);
  const [confirming, setConfirming] = (0, import_react10.useState)(false);
  const [busy, setBusy] = (0, import_react10.useState)(false);
  const [problem, setProblem] = (0, import_react10.useState)(null);
  const alive = (0, import_react10.useRef)(true);
  (0, import_react10.useEffect)(() => () => {
    alive.current = false;
  }, []);
  (0, import_react10.useEffect)(() => {
    call("omni-link-info").then((reply) => {
      if (alive.current) setInfo(reply);
    }, () => {
      if (alive.current) setInfo({ linked: false, configured: false });
    });
  }, []);
  const act = async (id) => {
    setBusy(true);
    setProblem(null);
    try {
      const next = await runSettingsAction(id, { info, close });
      if (!alive.current || next === null) return;
      setInfo(next.info);
      setConfirming(next.confirming);
    } catch (error) {
      if (alive.current) setProblem(error.message);
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const view = info === void 0 ? null : settingsView(info, { confirming });
  return (0, import_react10.createElement)(
    "div",
    { className: "oset-page" },
    (0, import_react10.createElement)("h2", { className: "oset-heading" }, "Omni"),
    view === null ? (0, import_react10.createElement)("p", { className: "oset-muted" }, t("Looking for your Omni…")) : (0, import_react10.createElement)(
      "section",
      { className: "oset-card" },
      (0, import_react10.createElement)(
        "div",
        { className: "oset-text" },
        (0, import_react10.createElement)("strong", null, view.title),
        view.lines.map((line) => (0, import_react10.createElement)("p", { key: line, className: "oset-muted" }, line))
      ),
      (0, import_react10.createElement)("div", { className: "oset-actions" }, view.actions.map((action) => (0, import_react10.createElement)("button", {
        key: action.id,
        type: "button",
        className: `oset-button${action.primary ? " oset-primary" : ""}${action.danger ? " oset-danger" : ""}`,
        disabled: busy,
        onClick: () => act(action.id)
      }, action.label)))
    ),
    problem ? (0, import_react10.createElement)("p", { className: "oset-problem", role: "alert" }, problem) : null
  );
}
var OMNI_SETTINGS_CSS = `
.oset-page{display:flex;flex-direction:column;gap:14px;max-width:640px}
.oset-heading{margin:0;font-size:18px;font-weight:600}
.oset-card{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;padding:18px 20px;border:1px solid color-mix(in srgb,currentColor 16%,transparent);border-radius:14px;background:color-mix(in srgb,#22d3ee 5%,transparent)}
.oset-text{display:flex;flex-direction:column;gap:4px;min-width:0;flex:1}
.oset-text strong{font-size:15px;font-weight:600;overflow-wrap:anywhere}
.oset-muted{margin:0;opacity:.72;font-size:13px;line-height:1.45}
.oset-actions{display:flex;gap:8px;flex-wrap:wrap}
.oset-button{height:36px;padding:0 16px;border-radius:999px;border:1px solid color-mix(in srgb,currentColor 22%,transparent);background:none;color:inherit;font:inherit;font-size:13.5px;font-weight:600;cursor:pointer;white-space:nowrap}
.oset-button:disabled{opacity:.5;cursor:default}
.oset-primary{border:0;background:linear-gradient(135deg,#22d3ee,#ff3bd4);color:#06060f}
.oset-danger{background:#e5484d;color:#fff}
.oset-problem{margin:0;color:#e5484d;font-size:13px}
`;
function registerSettings(ctx) {
  ctx.effect(() => {
    const style = document.createElement("style");
    style.dataset.omniSettings = "";
    style.textContent = OMNI_SETTINGS_CSS;
    document.head.append(style);
    return () => style.remove();
  }, "omni-channels: settings styles");
  ctx.slots.inject("settings.section", () => ctx.slots.register({ name: "settings.section", id: SETTINGS_SECTION.id, order: SETTINGS_SECTION.order, label: "Omni" }, OmniSettingsSection));
}

// src/client/subscriptions.js
var import_react11 = require("react");
var { AtIcon, FileIcon, KeywordIcon, MessageIcon, ShieldIcon, UnplugIcon, VoiceIcon } = icons;
var TRIGGER_ICONS = { message: MessageIcon, mention: AtIcon, keyword: KeywordIcon, voice: VoiceIcon, media: FileIcon, down: UnplugIcon };
var FRESH_MS = 6e3;
var isEventsBot = (roster, id) => Boolean(roster?.eventsBotId) && roster.byId?.[id]?.id === roster.eventsBotId;
var headCount = (roster) => (roster?.subscriptions ?? []).length || null;
function workerOf(worker, roster) {
  if (worker.kind === "events" || worker.kind === "main") {
    const bot2 = roster?.byId?.[roster.eventsBotId ?? roster.mainBotId];
    return { name: bot2?.name ?? "Omni", bot: bot2, look: MAIN_LOOK };
  }
  if (worker.kind === "session") return { name: worker.mode === "ongoing" ? t("One ongoing session") : t("A new session each time"), session: true };
  const bot = roster?.byId?.[worker.botId];
  return { name: bot?.name ?? t("A deleted Bot"), bot, look: MAIN_LOOK };
}
function WorkerMark({ worker, roster, size = 24 }) {
  const info = workerOf(worker, roster);
  if (info.session) return (0, import_react11.createElement)("span", { className: "os-session", style: { width: size, height: size } }, (0, import_react11.createElement)(OmniMark, { size: Math.round(size * 0.62) }));
  return (0, import_react11.createElement)(BotMark, info.bot ? { bot: info.bot, size } : { look: info.look, size });
}
var TriggerBadge = ({ trigger, size = 36 }) => (0, import_react11.createElement)(
  "span",
  { className: "os-trigger", "data-kind": trigger.kind, style: { width: size, height: size, fontSize: Math.round(size * 0.5), "--os-icon": `${Math.round(size * 0.52)}px` } },
  trigger.kind === "reaction" ? trigger.emoji : (0, import_react11.createElement)(TRIGGER_ICONS[trigger.kind])
);
function triggerText(trigger) {
  if (trigger.kind === "reaction") return t("you react");
  if (trigger.kind === "keyword") return t("a message says {words}", { words: trigger.words.map((word) => `“${word}”`).join(t(" or ")) });
  return t(TRIGGERS[trigger.kind].label).toLowerCase();
}
function sourcesText(sources) {
  if (sources.length === 1) return sources[0].kind === "channel" ? t("anywhere on {name}", { name: sources[0].name }) : sources[0].name;
  const channels2 = sources.filter((source) => source.kind === "channel").length;
  const groups = sources.filter((source) => source.kind === "chat" && source.chatKind === "group").length;
  const chats = sources.length - channels2 - groups;
  const count = (n, one, many) => n === 0 ? "" : n === 1 ? t(one) : t(many, { n });
  return [count(channels2, "1 channel", "{n} channels"), count(groups, "1 group", "{n} groups"), count(chats, "1 chat", "{n} chats")].filter(Boolean).join(" + ");
}
var initials = (name) => name.startsWith("#") ? "#" : name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join("").toUpperCase() || "?";
var SourceMark = ({ source, size }) => source.kind === "channel" ? (0, import_react11.createElement)(Tile, { type: source.type, size }) : (0, import_react11.createElement)(ChatAvatar, { chat: { name: source.name, initials: initials(source.name) }, size });
function SourceStack({ sources, size = 16 }) {
  return (0, import_react11.createElement)(
    "span",
    { className: "os-stack" },
    sources.slice(0, 3).map((source) => (0, import_react11.createElement)("span", { key: `${source.kind}-${source.id}`, className: "os-stack-item" }, (0, import_react11.createElement)(SourceMark, { source, size }))),
    sources.length > 3 ? (0, import_react11.createElement)("span", { className: "os-stack-more" }, `+${sources.length - 3}`) : null
  );
}
function Sentence({ sub, roster }) {
  return (0, import_react11.createElement)(
    "p",
    { className: "os-sentence" },
    (0, import_react11.createElement)("span", { className: "os-w" }, t("When")),
    " ",
    (0, import_react11.createElement)("span", { className: "os-chip os-chip-trigger" }, sub.trigger.kind === "reaction" ? (0, import_react11.createElement)("b", { className: "os-emoji" }, sub.trigger.emoji) : null, triggerText(sub.trigger)),
    " ",
    (0, import_react11.createElement)("span", { className: "os-w" }, t("in")),
    " ",
    (0, import_react11.createElement)("span", { className: "os-chip" }, (0, import_react11.createElement)(SourceStack, { sources: sub.sources }), sourcesText(sub.sources)),
    " ",
    (0, import_react11.createElement)("span", { className: "os-w" }, "→"),
    " ",
    (0, import_react11.createElement)("span", { className: "os-chip os-chip-worker" }, (0, import_react11.createElement)(WorkerMark, { worker: sub.worker, roster, size: 18 }), workerOf(sub.worker, roster).name),
    sub.outputs.react ? (0, import_react11.createElement)(import_react11.Fragment, null, " ", (0, import_react11.createElement)("span", { className: "os-chip os-chip-soft" }, t("reacts 👀 then ✅"))) : null,
    sub.outputs.replyToMe ? (0, import_react11.createElement)(import_react11.Fragment, null, " ", (0, import_react11.createElement)("span", { className: "os-chip os-chip-soft" }, t("replies to you"))) : null
  );
}
var RUN_STATUS = {
  waiting: { label: "Needs you", tone: "warn" },
  working: { label: "Working", tone: "busy" },
  done: { label: "Done", tone: "ok" },
  failed: { label: "Did not finish", tone: "bad" }
};
var useWaiting = (useWork) => new Set((useWork ? useWork((work) => (work.approvals ?? []).map((entry) => entry.sessionId).join(",")) : "").split(",").filter(Boolean));
function EventsBadge({ roster, useWork }) {
  const waiting = waitingRuns(roster, useWaiting(useWork));
  return waiting > 0 ? (0, import_react11.createElement)("span", { className: "os-pending", title: t("{n} waiting for you", { n: waiting }) }, String(waiting)) : null;
}
function SubscriptionsButton({ roster, onToggle, useWork }) {
  const count = headCount(roster);
  const waiting = waitingRuns(roster, useWaiting(useWork));
  return (0, import_react11.createElement)(
    "button",
    { type: "button", className: "os-head-btn", onClick: onToggle },
    t("Automations"),
    count === null ? null : (0, import_react11.createElement)("span", { className: "os-head-count" }, String(count)),
    waiting > 0 ? (0, import_react11.createElement)("span", { className: "os-pending" }, String(waiting)) : null
  );
}
var SAVED = /^Saved (sub-[a-z0-9]+) · (.*?): when /;
function savedOf(content, roster, askFirstArg) {
  const match = SAVED.exec(String(content ?? ""));
  if (!match) return null;
  const sub = (roster?.subscriptions ?? []).find((entry) => entry.id === match[1]);
  const askFirst = askFirstArg !== void 0 ? askFirstArg === true || askFirstArg === "true" || askFirstArg === "yes" : sub ? sub.askFirst !== false : true;
  return { id: match[1], name: sub?.name ?? match[2], sub, askFirst };
}
function savedNotice({ askFirst, main }) {
  return askFirst ? { loud: false, text: t("Anyone in a watched chat can write text that tries to steer a Bot. The work this starts reads on its own and asks you before anything else.") } : { loud: true, text: t("This automation acts without asking you. Anyone in a watched chat can write text that tries to steer a Bot, and the work it starts runs shell, file, web and connector actions with that Bot's own permissions and keys. Tell {name} to ask first to change that.", { name: main }) };
}
function SavedAutomationCard({ argValue, content, done, roster }) {
  if (!done) return null;
  const saved = savedOf(content, roster, argValue?.("ask_first"));
  if (saved === null) return (0, import_react11.createElement)("div", { className: "bt-event", title: content }, String(content ?? "").slice(0, 160));
  const notice = savedNotice({ askFirst: saved.askFirst, main: roster?.byId?.[roster.eventsBotId]?.name ?? "Omni" });
  return (0, import_react11.createElement)(
    "div",
    { className: "os-saved", "data-loud": notice.loud || void 0 },
    (0, import_react11.createElement)(
      "div",
      { className: "os-saved-top" },
      saved.sub ? (0, import_react11.createElement)(TriggerBadge, { trigger: saved.sub.trigger, size: 22 }) : null,
      (0, import_react11.createElement)("span", null, t("Saved automation")),
      (0, import_react11.createElement)("strong", null, saved.name)
    ),
    (0, import_react11.createElement)("p", { className: "os-saved-note", role: notice.loud ? "alert" : void 0 }, (0, import_react11.createElement)(ShieldIcon), (0, import_react11.createElement)("span", null, notice.text))
  );
}
var BOARD_KIND = "omni-subscriptions";
var BOARD_TAB_ID = "ds-bot/omni-subscriptions";
var boardTabDefinition = () => ({ id: BOARD_TAB_ID, kind: BOARD_KIND, title: () => t("Automations") });
function BoardTab({ useRoster, useWork, actions }) {
  const roster = useRoster((value) => value);
  const waiting = useWaiting(useWork);
  const bot = roster.byId?.[roster.eventsBotId];
  if (!bot) return (0, import_react11.createElement)("div", { className: "os-board" }, (0, import_react11.createElement)("p", { className: "os-board-note" }, t("Automations belong to the Main Bot, which this team does not have.")));
  return (0, import_react11.createElement)(SubscriptionsBoard, { bot, roster, actions, waiting });
}
function SubscriptionsBoard({ bot, roster, actions, waiting }) {
  const omni2 = useOmni();
  (0, import_react11.useEffect)(() => {
    startLive(call);
  }, []);
  const subs = roster.subscriptions ?? [];
  const runs = runsOf(roster);
  const watched = new Set(subs.filter((sub) => sub.on).flatMap((sub) => sub.sources.map((source) => `${source.kind}:${source.id}`))).size;
  const listening = (roster.omniEvents?.listening ?? []).length > 0;
  return (0, import_react11.createElement)(
    "div",
    { className: "os-board" },
    subs.length === 0 ? (0, import_react11.createElement)(Empty, { bot, live: omni2.source.kind === "live" }) : (0, import_react11.createElement)(
      import_react11.Fragment,
      null,
      (0, import_react11.createElement)(
        "div",
        { className: "os-board-status" },
        (0, import_react11.createElement)("span", { className: "oc-live-dot", "data-on": listening || void 0, "aria-hidden": true }),
        !subs.some((sub) => sub.on) ? t("Everything is paused.") : `${watched === 1 ? t("Watching 1 chat or channel.") : t("Watching {n} chats and channels.", { n: watched })} ${listening ? t("Listening to omni.") : t("Connecting to omni…")}`
      ),
      subs.some((sub) => sub.on && (sub.outputs.react || sub.outputs.replyToMe)) ? (0, import_react11.createElement)("div", { className: "os-board-note os-board-pending" }, t("Reactions and replies to you are not sent yet. Results stay in the runs below.")) : null,
      (0, import_react11.createElement)("div", { className: "os-list" }, subs.map((sub) => (0, import_react11.createElement)(AutomationRow, { key: sub.id, sub, roster, runs: runs.filter((run) => run.subId === sub.id) }))),
      runs.length > 0 ? (0, import_react11.createElement)(
        import_react11.Fragment,
        null,
        (0, import_react11.createElement)("div", { className: "os-board-h" }, t("Runs")),
        (0, import_react11.createElement)("div", { className: "os-list" }, runs.slice(0, 20).map((run) => (0, import_react11.createElement)(RunRow, { key: run.id, run, sub: subs.find((sub) => sub.id === run.subId), roster, actions, asking: waiting?.has(run.sessionId) && run.status === "working" })))
      ) : null
    ),
    (0, import_react11.createElement)(
      "div",
      { className: "os-safety" },
      (0, import_react11.createElement)(ShieldIcon),
      (0, import_react11.createElement)("span", null, t("Anyone in a watched chat can write text that tries to steer a Bot. Work started by an event reads on its own and asks you before any shell command, file change, web or connector call, or message, unless you tell {name} otherwise. What you allow runs with that Bot's keys.", { name: bot.name }))
    )
  );
}
function Empty({ bot, live }) {
  const examples = [
    t("Watch #ci-alerts for “failed” or “error” and hand it to Ops"),
    t("When I react 📌 to a message in any WhatsApp chat, save it to my notes"),
    t("Voice notes in my own chat go to one ongoing session")
  ];
  return (0, import_react11.createElement)(
    "div",
    { className: "os-empty-board" },
    (0, import_react11.createElement)(BotMark, { bot, size: 48, live: true }),
    (0, import_react11.createElement)("strong", null, t("Tell {name} what to watch", { name: bot.name })),
    (0, import_react11.createElement)("span", null, live ? t("Say it in the chat. {name} finds the chats, asks what is missing, and the subscription shows up here.", { name: bot.name }) : t("Omni is not connected to this DSH yet, so there is nothing to watch.")),
    (0, import_react11.createElement)("ul", { className: "os-examples" }, examples.map((text) => (0, import_react11.createElement)("li", { key: text }, text)))
  );
}
function AutomationRow({ sub, roster, runs, onOpen }) {
  const [confirming, setConfirming] = (0, import_react11.useState)(false);
  const [busy, setBusy] = (0, import_react11.useState)("");
  const fresh = Date.now() - (sub.updatedAt ?? 0) < FRESH_MS;
  const run = async (endpoint, payload) => {
    setBusy(endpoint);
    try {
      await call(endpoint, payload);
    } finally {
      setBusy("");
    }
  };
  const last = runs[0];
  return (0, import_react11.createElement)(
    "div",
    { className: "os-row", "data-off": sub.on ? void 0 : true, "data-fresh": fresh || void 0 },
    (0, import_react11.createElement)(TriggerBadge, { trigger: sub.trigger, size: 28 }),
    (0, import_react11.createElement)(
      "div",
      { className: "os-row-body" },
      (0, import_react11.createElement)(
        "div",
        { className: "os-row-top" },
        onOpen ? (0, import_react11.createElement)("button", { type: "button", className: "os-row-name os-row-open", onClick: onOpen }, sub.name) : (0, import_react11.createElement)("span", { className: "os-row-name" }, sub.name),
        (0, import_react11.createElement)("button", {
          type: "button",
          role: "switch",
          "aria-checked": sub.on,
          className: "os-switch",
          disabled: busy !== "",
          "aria-label": sub.on ? t("Pause {name}", { name: sub.name }) : t("Resume {name}", { name: sub.name }),
          onClick: () => run("automation-set-on", { id: sub.id, on: !sub.on })
        }, (0, import_react11.createElement)("span"))
      ),
      (0, import_react11.createElement)(Sentence, { sub, roster }),
      (0, import_react11.createElement)(
        "div",
        { className: "os-row-foot" },
        (0, import_react11.createElement)("span", null, last ? t("last run {time}", { time: relativeShort(last.at) }) : t("not fired yet")),
        sub.askFirst ? null : (0, import_react11.createElement)("span", { className: "os-row-warn" }, t("acts without asking")),
        (0, import_react11.createElement)(
          "span",
          { className: "os-row-actions" },
          (0, import_react11.createElement)("button", { type: "button", className: "os-link", disabled: busy !== "", onClick: () => run("automation-test", { id: sub.id }) }, t("Test")),
          (0, import_react11.createElement)("button", {
            type: "button",
            className: confirming ? "os-link os-link-danger" : "os-link",
            disabled: busy !== "",
            onBlur: () => setConfirming(false),
            onClick: () => confirming ? run("automation-delete", { id: sub.id }) : setConfirming(true)
          }, confirming ? t("Click again to delete") : t("Delete"))
        )
      )
    )
  );
}
function RunRow({ run, sub, roster, actions, asking = false }) {
  if (!sub) return null;
  const status = RUN_STATUS[asking ? "waiting" : run.status];
  const open = run.sessionId ? () => actions.openSession(run.sessionId) : void 0;
  return (0, import_react11.createElement)(
    "button",
    { type: "button", className: "os-run", "data-tone": status.tone, disabled: !open, onClick: open, title: open ? t("Open this run") : void 0 },
    (0, import_react11.createElement)(WorkerMark, { worker: sub.worker, roster, size: 22 }),
    (0, import_react11.createElement)(
      "span",
      { className: "os-run-body" },
      (0, import_react11.createElement)(
        "span",
        { className: "os-run-top" },
        (0, import_react11.createElement)("span", { className: "os-run-name" }, workerOf(sub.worker, roster).name),
        (0, import_react11.createElement)("span", { className: "os-run-status" }, run.test ? `${t("Test")} · ${t(status.label)}` : t(status.label)),
        (0, import_react11.createElement)("time", null, relativeShort(run.at))
      ),
      run.excerpt && !run.test ? (0, import_react11.createElement)("span", { className: "os-run-quote" }, run.from ? `${run.from}: ` : "", run.excerpt) : null,
      (0, import_react11.createElement)("span", { className: "os-run-text" }, run.summary)
    )
  );
}
var SUBSCRIPTIONS_CSS = `
.os-trigger{display:inline-grid;place-items:center;flex:none;border-radius:30%;background:color-mix(in srgb,var(--bt-accent) 12%,var(--bt-card));box-shadow:inset 0 0 0 .5px var(--bt-line-2);line-height:1}
.os-trigger:not([data-kind=reaction]){color:var(--bt-accent)}
.os-trigger svg{width:var(--os-icon,18px);height:var(--os-icon,18px)}
.os-session{display:inline-grid;place-items:center;flex:none;border-radius:30%;background:var(--bt-ink);color:var(--bt-main)}
.os-stack{display:inline-flex;align-items:center;flex:none}
.os-stack-item{display:inline-flex;margin-left:-4px;border-radius:50%;box-shadow:0 0 0 1.5px var(--bt-card)}
.os-stack-item:first-child{margin-left:0}
.os-stack-item .oc-ava-badge{display:none}
.os-stack-more{margin-left:3px;font-size:10.5px;color:var(--bt-ink-3)}
.os-pending{flex:none;min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:#f59e0b;color:#fff;font-size:11px;font-weight:600;line-height:18px;text-align:center;box-sizing:border-box}
[data-tone=bad]{--oc-tone:#e5484d}

/* Omni's header button */
.os-head-btn{display:inline-flex;align-items:center;gap:7px;height:32px;padding:0 10px 0 12px;margin-left:8px;border-radius:999px;border:.5px solid var(--bt-line-2);background:var(--bt-main);color:var(--bt-ink);font:inherit;font-size:13px;cursor:pointer;pointer-events:auto;box-shadow:0 2px 8px -1px rgba(0,0,0,.06)}
.os-head-btn:hover{background:var(--bt-hover)}
.os-head-count{min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:var(--bt-hover);color:var(--bt-ink-2);font-size:11px;line-height:18px;text-align:center;box-sizing:border-box}

/* Board: a plain list in the sidebar's own type and spacing */
.os-board{height:100%;overflow-y:auto;padding:10px 8px 16px;box-sizing:border-box;display:flex;flex-direction:column;gap:6px;color:var(--bt-ink);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;font-size:13px}
.os-board-status{display:flex;align-items:center;gap:8px;padding:2px 8px 6px;font-size:12px;color:var(--bt-ink-2)}
.os-board-status .oc-live-dot{width:6px;height:6px;border-radius:50%;background:var(--bt-ink-3)}
.os-board-status .oc-live-dot[data-on]{background:#16a34a}
.os-board-h{margin:10px 8px 2px;font-size:11.5px;font-weight:600;color:var(--bt-ink-3)}
.os-board-note{margin:8px;font-size:12.5px;color:var(--bt-ink-2)}
.os-board-pending{margin:0 8px 4px;padding:7px 10px;border-radius:8px;background:var(--bt-hover);font-size:11.5px;line-height:16px;color:var(--bt-ink-2)}
.os-list{display:flex;flex-direction:column}
.os-row{display:flex;gap:10px;padding:10px 8px;border-radius:10px;transition:background-color .12s ease}
.os-row+.os-row{border-top:.5px solid var(--bt-line)}
.os-row:hover{background:var(--bt-hover)}
.os-row[data-off]{opacity:.55}
.os-row[data-fresh]{animation:os-fresh 2.4s cubic-bezier(.2,0,0,1)}
@keyframes os-fresh{0%{background:color-mix(in srgb,var(--bt-accent) 22%,transparent);transform:translateY(4px)}25%{transform:none}100%{background:transparent}}
.os-row-body{display:flex;flex-direction:column;gap:4px;flex:1;min-width:0}
.os-row-top{display:flex;align-items:center;gap:8px;min-height:22px}
.os-row-name{flex:1;min-width:0;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.os-row-open{border:0;background:none;padding:0;color:inherit;font:inherit;font-weight:600;text-align:left;cursor:pointer}
.os-row-open:hover{text-decoration:underline}
.os-row-foot{display:flex;align-items:center;gap:10px;font-size:11.5px;color:var(--bt-ink-3)}
.os-row-warn{color:#d97706}
.os-row-actions{display:inline-flex;gap:10px;margin-left:auto;opacity:0;transition:opacity .12s ease}
.os-row:hover .os-row-actions,.os-row:focus-within .os-row-actions{opacity:1}
.os-empty-board{display:flex;flex-direction:column;align-items:center;gap:8px;padding:28px 12px 8px;text-align:center}
.os-empty-board>strong{font-size:14px;font-weight:600}
.os-empty-board>span{max-width:300px;font-size:12.5px;line-height:18px;color:var(--bt-ink-2)}
.os-examples{list-style:none;margin:8px 0 0;padding:0;width:100%;display:flex;flex-direction:column;text-align:left}
.os-examples li{padding:8px 10px;font-size:12.5px;line-height:18px;color:var(--bt-ink-2)}
.os-examples li+li{border-top:.5px solid var(--bt-line)}
.os-examples li::before{content:"“";color:var(--bt-ink-3)}
.os-examples li::after{content:"”";color:var(--bt-ink-3)}

/* Sentence: inline, quiet */
.os-sentence{margin:0;display:flex;flex-wrap:wrap;align-items:center;gap:3px 4px;font-size:12.5px;line-height:20px;color:var(--bt-ink-2)}
.os-w{color:var(--bt-ink-3)}
.os-chip{display:inline-flex;align-items:center;gap:4px;max-width:100%;color:var(--bt-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.os-chip-soft{color:var(--bt-ink-3)}
.os-emoji{font-size:13px;font-weight:400}

.os-link{border:0;background:none;padding:0;color:var(--bt-ink-2);font:inherit;font-size:11.5px;cursor:pointer}
.os-link:hover:not(:disabled){color:var(--bt-ink);text-decoration:underline}
.os-link:disabled{opacity:.5;cursor:default}
.os-link-danger{color:var(--bt-danger);font-weight:600}
.os-switch{position:relative;flex:none;width:30px;height:18px;border-radius:999px;border:0;padding:0;background:var(--bt-line-2);cursor:pointer;transition:background-color .15s ease}
.os-switch span{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.25);transition:transform .18s cubic-bezier(.2,0,0,1)}
.os-switch[aria-checked=true]{background:var(--bt-accent)}
.os-switch[aria-checked=true] span{transform:translateX(12px)}
.os-switch:disabled{opacity:.6}

/* Runs */
.os-run{display:flex;gap:9px;width:100%;padding:8px;border:0;border-radius:10px;background:none;color:var(--bt-ink);font:inherit;text-align:left;cursor:pointer}
.os-run:hover:not(:disabled){background:var(--bt-hover)}
.os-run:disabled{cursor:default}
.os-run-body{display:flex;flex-direction:column;gap:2px;flex:1;min-width:0}
.os-run-top{display:flex;align-items:center;gap:6px;font-size:12.5px}
.os-run-name{font-weight:500}
.os-run-top time{margin-left:auto;font-size:11px;color:var(--bt-ink-3)}
.os-run-status{font-size:11px;font-weight:600;color:color-mix(in srgb,var(--oc-tone) 75%,var(--bt-ink))}
.os-run[data-tone=busy] .os-run-status{animation:oc-pulse 1.4s ease-in-out infinite}
.os-run-quote{font-size:12px;color:var(--bt-ink-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.os-run-text{font-size:12.5px;line-height:18px;color:var(--bt-ink-2);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}

.os-safety{display:flex;gap:8px;margin-top:auto;padding:10px 8px 0;border-top:.5px solid var(--bt-line);font-size:11.5px;line-height:16px;color:var(--bt-ink-3)}
.os-safety svg{flex:none;margin-top:1px}

/* Omni's confirmation of a saved automation, in its chat */
.os-saved{display:flex;flex-direction:column;gap:6px;max-width:560px;margin:6px 0;padding:10px 12px;border-radius:12px;border:.5px solid var(--bt-line-2);background:var(--bt-card);font-size:12.5px;line-height:18px;color:var(--bt-ink-2)}
.os-saved-top{display:flex;align-items:center;gap:8px;min-width:0}
.os-saved-top strong{min-width:0;color:var(--bt-ink);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.os-saved-note{display:flex;gap:8px;margin:0;font-size:11.5px;line-height:16px;color:var(--bt-ink-3)}
.os-saved-note svg{flex:none;margin-top:1px}
.os-saved[data-loud]{border-color:color-mix(in srgb,#d97706 50%,var(--bt-line-2));background:color-mix(in srgb,#f59e0b 9%,var(--bt-card))}
.os-saved[data-loud] .os-saved-note{font-size:12.5px;line-height:18px;color:var(--bt-ink)}
.os-saved[data-loud] .os-saved-note svg{color:#d97706}
@media (prefers-reduced-motion:reduce){.os-row[data-fresh]{animation:none}}
`;

// src/client/automation-time.js
var pad = (value) => String(value).padStart(2, "0");
var WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function whenText(task) {
  if (task.kind === "every") {
    const seconds = task.everySeconds ?? 0;
    if (seconds % 86400 === 0) return t("Every {n} days", { n: seconds / 86400 });
    if (seconds % 3600 === 0) return seconds === 3600 ? t("Every hour") : t("Every {n} hours", { n: seconds / 3600 });
    return t("Every {n} min", { n: Math.round(seconds / 60) });
  }
  if (task.kind === "daily") return t("Every day at {time}", { time: task.time });
  if (task.kind === "weekly") {
    const days = [...task.weekdays ?? []].sort();
    const label = days.join(",") === "1,2,3,4,5" ? t("Weekdays") : days.map((day) => t(WEEKDAYS[day] ?? String(day))).join(", ");
    return t("{days} at {time}", { days: label, time: task.time });
  }
  if (task.kind === "cron") return t("Custom ({expression})", { expression: task.expression });
  if (task.scheduledAt) {
    const at2 = new Date(task.scheduledAt);
    return t("Once, {date} {time}", { date: at2.toLocaleDateString([], { month: "short", day: "numeric" }), time: `${pad(at2.getHours())}:${pad(at2.getMinutes())}` });
  }
  return t("Once");
}

// src/client/automations-page.js
var import_react12 = require("react");
var { ClockIcon, PlusIcon: PlusIcon2, SearchIcon } = icons;
var AUTOMATIONS_PANEL = "omni-automations";
function AutomationsPage({ useRoster, actions }) {
  const roster = useRoster((value) => value);
  const [filter, setFilter] = (0, import_react12.useState)("all");
  const [query, setQuery] = (0, import_react12.useState)("");
  const [schedules, setSchedules] = (0, import_react12.useState)({ available: false, tasks: [] });
  (0, import_react12.useEffect)(() => {
    let live = true;
    const load = () => call("schedules").then((value) => {
      if (live) setSchedules(value);
    }, () => {
    });
    load();
    const timer = setInterval(load, 1e4);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);
  const events = roster.subscriptions ?? [];
  const runs = runsOf(roster);
  const autopilot = roster.byId?.[roster.eventsBotId];
  const needle = query.trim().toLowerCase();
  const rows = (0, import_react12.useMemo)(() => {
    const list = [
      ...events.map((sub) => ({ kind: "event", id: sub.id, on: sub.on, title: sub.name, sort: sub.createdAt, sub })),
      ...schedules.tasks.map((task) => ({ kind: "schedule", id: `${task.sessionId}:${task.id}`, on: task.status === "active", title: task.title, sort: Date.parse(task.scheduledAt) || 0, task }))
    ];
    return list.filter((row) => filter === "all" || (filter === "enabled" ? row.on : !row.on)).filter((row) => needle === "" || row.title.toLowerCase().includes(needle) || (row.task?.prompt ?? "").toLowerCase().includes(needle));
  }, [events, schedules, filter, needle]);
  const talk = () => {
    if (autopilot) actions.openSession(autopilot.id);
  };
  return (0, import_react12.createElement)(
    "div",
    { className: "oa-page" },
    (0, import_react12.createElement)(
      "div",
      { className: "oa-in" },
      (0, import_react12.createElement)(
        "header",
        { className: "oa-head" },
        (0, import_react12.createElement)("h1", null, t("Automations")),
        (0, import_react12.createElement)("button", { type: "button", className: "oa-new", disabled: !autopilot, onClick: talk, title: autopilot ? t("Tell {name} what to automate", { name: autopilot.name }) : void 0 }, (0, import_react12.createElement)(PlusIcon2), t("New"))
      ),
      (0, import_react12.createElement)("p", { className: "oa-lede" }, autopilot ? t("Things that run on their own: when something happens in your chats, or on a schedule. Say what you want to {name}; it sets it up and it shows here.", { name: autopilot.name }) : t("Things that run on their own, on a schedule or when something happens in your chats.")),
      (0, import_react12.createElement)(
        "div",
        { className: "oa-filters", role: "radiogroup", "aria-label": t("Show") },
        [["all", t("All")], ["enabled", t("Enabled")], ["inactive", t("Inactive")]].map(([value, label]) => (0, import_react12.createElement)("button", {
          key: value,
          type: "button",
          role: "radio",
          "aria-checked": filter === value,
          onClick: () => setFilter(value)
        }, label))
      ),
      (0, import_react12.createElement)("label", { className: "oa-search" }, (0, import_react12.createElement)(SearchIcon), (0, import_react12.createElement)("input", { value: query, placeholder: t("Search automations"), "aria-label": t("Search automations"), onChange: (event) => setQuery(event.target.value) })),
      rows.length === 0 ? (0, import_react12.createElement)(
        "div",
        { className: "oa-empty" },
        (0, import_react12.createElement)(ClockIcon),
        (0, import_react12.createElement)("span", null, events.length + schedules.tasks.length === 0 ? t("Nothing runs on its own yet.") : t("No automations match.")),
        autopilot ? (0, import_react12.createElement)("button", { type: "button", className: "oa-empty-go", onClick: talk }, t("Tell {name} what to automate", { name: autopilot.name })) : null
      ) : (0, import_react12.createElement)("div", { className: "oa-list" }, rows.map((row) => row.kind === "event" ? (0, import_react12.createElement)(AutomationRow, { key: row.id, sub: row.sub, roster, runs: runs.filter((run) => run.subId === row.id), onOpen: talk }) : (0, import_react12.createElement)(ScheduleRow, { key: row.id, task: row.task, roster, actions })))
    )
  );
}
function ScheduleRow({ task, roster, actions }) {
  const owner = roster.byId?.[task.botId];
  const room = roster.roomsById?.[task.roomId];
  const active = task.status === "active";
  return (0, import_react12.createElement)(
    "button",
    { type: "button", className: "os-row oa-schedule", "data-off": active ? void 0 : true, onClick: () => actions.selectPanel("schedules"), title: t("Edit the timing in Automation tasks") },
    (0, import_react12.createElement)("span", { className: "os-trigger", "data-kind": "schedule", style: { width: 28, height: 28, "--os-icon": "15px" } }, (0, import_react12.createElement)(ClockIcon)),
    (0, import_react12.createElement)(
      "span",
      { className: "os-row-body" },
      (0, import_react12.createElement)(
        "span",
        { className: "os-row-top" },
        (0, import_react12.createElement)("span", { className: "os-row-name" }, task.title),
        (0, import_react12.createElement)("span", { className: "oa-tag" }, active ? t("Scheduled") : t("Inactive"))
      ),
      (0, import_react12.createElement)(
        "span",
        { className: "os-sentence" },
        (0, import_react12.createElement)("span", { className: "os-chip" }, whenText(task)),
        (0, import_react12.createElement)("span", { className: "os-w" }, "→"),
        (0, import_react12.createElement)("span", { className: "os-chip" }, owner ? (0, import_react12.createElement)(import_react12.Fragment, null, (0, import_react12.createElement)(BotMark, { bot: owner, size: 16 }), owner.name) : room?.name ?? t("a chat"))
      ),
      (0, import_react12.createElement)(
        "span",
        { className: "os-row-foot" },
        (0, import_react12.createElement)("span", null, active && task.scheduledAt ? t("next run {time}", { time: new Date(task.scheduledAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) }) : task.lastDelivery ? t("last run {time}", { time: relativeShort(Date.parse(task.lastDelivery.deliveredAt ?? task.lastDelivery) || Date.now()) }) : t("not run yet"))
      )
    )
  );
}
var AUTOMATIONS_CSS = `
.oa-page{height:100%;overflow-y:auto;background:var(--bt-main);color:var(--bt-ink);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif}
.oa-in{max-width:880px;margin:0 auto;padding:32px 32px 48px;display:flex;flex-direction:column;gap:14px}
.oa-head{display:flex;align-items:center;justify-content:space-between}
.oa-head h1{margin:0;font-size:24px;line-height:32px;font-weight:600}
.oa-new{display:inline-flex;align-items:center;gap:6px;height:38px;padding:0 16px;border:0;border-radius:999px;background:var(--bt-ink);color:var(--bt-main);font:inherit;font-size:14px;font-weight:500;cursor:pointer}
.oa-new svg{width:15px;height:15px}
.oa-new:disabled{opacity:.4;cursor:default}
.oa-lede{margin:-6px 0 4px;max-width:620px;font-size:13.5px;line-height:20px;color:var(--bt-ink-2)}
.oa-filters{display:flex;gap:4px}
.oa-filters button{height:32px;padding:0 14px;border:0;border-radius:10px;background:none;color:var(--bt-ink-2);font:inherit;font-size:14px;cursor:pointer}
.oa-filters button[aria-checked=true]{background:var(--bt-hover);color:var(--bt-ink)}
.oa-search{display:flex;align-items:center;gap:10px;height:42px;padding:0 14px;border-radius:12px;border:1px solid var(--bt-line-2);background:var(--bt-card);color:var(--bt-ink-3)}
.oa-search input{flex:1;min-width:0;border:0;background:none;color:var(--bt-ink);font:inherit;font-size:14px;outline:none}
.oa-list{display:flex;flex-direction:column;border:1px solid var(--bt-line);border-radius:14px;background:var(--bt-card);padding:4px}
.oa-list .os-row{font-size:13.5px}
.oa-schedule{width:100%;border:0;background:none;color:inherit;font:inherit;text-align:left;cursor:pointer}
.os-trigger[data-kind=schedule]{color:var(--bt-ink-2)}
.oa-tag{flex:none;font-size:11px;color:var(--bt-ink-3)}
.oa-empty{display:flex;flex-direction:column;align-items:center;gap:12px;padding:64px 16px;color:var(--bt-ink-3);font-size:14px}
.oa-empty svg{width:28px;height:28px}
.oa-empty-go{height:38px;padding:0 16px;border-radius:12px;border:1px solid var(--bt-line-2);background:var(--bt-card);color:var(--bt-ink);font:inherit;font-size:14px;cursor:pointer}
@media (max-width:720px){.oa-in{padding:20px 16px 40px}}
`;

// src/client/omni-tree.js
var import_react13 = require("react");
var { ChevronRightIcon: ChevronRightIcon2 } = icons;
var SHOWN = 8;
var OPEN_KEY = "omni.tree.open";
function readOpen() {
  try {
    return new Set(JSON.parse(localStorage.getItem(OPEN_KEY) ?? "[]"));
  } catch {
    return /* @__PURE__ */ new Set();
  }
}
function saveOpen(open) {
  try {
    localStorage.setItem(OPEN_KEY, JSON.stringify([...open]));
  } catch {
  }
}
function ChannelItem({ channel, state, bot, omni: omni2, open, onToggle }) {
  const { chats, more } = chatsOf(state, channel.id, SHOWN);
  const unread = unreadOf(state, channel.id);
  const type = typeOf(channel.type);
  const panelId = `omni-tree-${channel.id}`;
  return (0, import_react13.createElement)(
    "div",
    { className: "ot-channel" },
    (0, import_react13.createElement)(
      "button",
      {
        type: "button",
        className: "ot-channel-row",
        "aria-expanded": open,
        "aria-controls": panelId,
        title: `${type.label} · ${channel.name}`,
        onClick: onToggle
      },
      (0, import_react13.createElement)("span", { className: "ot-chevron", "aria-hidden": true }, (0, import_react13.createElement)(ChevronRightIcon2)),
      (0, import_react13.createElement)(Tile, { type: channel.type, size: 18 }),
      (0, import_react13.createElement)("span", { className: "ot-channel-name" }, channel.name),
      unread > 0 ? (0, import_react13.createElement)("span", { className: "ot-count", "aria-label": t("{n} unread", { n: unread }) }, unread) : (0, import_react13.createElement)(StatusDot, { status: channel.status })
    ),
    (0, import_react13.createElement)(
      "div",
      { id: panelId, className: "ot-chats", "data-open": open || void 0 },
      (0, import_react13.createElement)(
        "div",
        { className: "ot-chats-in" },
        chats.length === 0 ? (0, import_react13.createElement)("span", { className: "ot-empty" }, t("No chats yet")) : null,
        chats.map((chat, index) => (0, import_react13.createElement)(
          "button",
          {
            key: chat.id,
            type: "button",
            className: "ot-chat",
            style: { "--i": index },
            "aria-current": state.chatId === chat.id ? "page" : void 0,
            title: chat.preview || chat.name,
            tabIndex: open ? void 0 : -1,
            onClick: () => omni2.openChat(chat.id)
          },
          (0, import_react13.createElement)(ChatAvatar, { chat, size: 22 }),
          (0, import_react13.createElement)("span", { className: "ot-chat-name" }, chat.name),
          chat.unread > 0 ? (0, import_react13.createElement)("span", { className: "ot-unread", "aria-hidden": true }) : (0, import_react13.createElement)("span", { className: "ot-time" }, relativeShort(chat.at)),
          (0, import_react13.createElement)("span", { className: "ot-helper", title: t("{name} helps in this chat", { name: bot.name }) }, (0, import_react13.createElement)(BotMark, { bot, size: 16 }))
        )),
        (0, import_react13.createElement)(
          "button",
          { type: "button", className: "ot-chat ot-all", tabIndex: open ? void 0 : -1, onClick: () => omni2.openChannels("channel", channel.id) },
          more > 0 ? t("All chats (+{n})", { n: more }) : t("Channel health")
        )
      )
    )
  );
}
function OmniTree({ bot, actions }) {
  const state = useOmni();
  const omni2 = (0, import_react13.useMemo)(() => omniActions((id) => actions.selectPanel(id), call), [actions]);
  const [open, setOpen] = (0, import_react13.useState)(readOpen);
  (0, import_react13.useEffect)(() => {
    startLive(call);
  }, []);
  if (!isOmniBot(bot)) return null;
  if (state.preview) {
    return (0, import_react13.createElement)("div", { className: "ot-tree" }, (0, import_react13.createElement)("button", { type: "button", className: "ot-channel-row ot-link", onClick: openConnectWizard }, t("Connect Omni"), (0, import_react13.createElement)("span", { "aria-hidden": true }, " →")));
  }
  const toggle = (id) => setOpen((before) => {
    const next = new Set(before);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    saveOpen(next);
    return next;
  });
  return (0, import_react13.createElement)(
    "div",
    { className: "ot-tree", role: "group", "aria-label": t("{name}'s channels", { name: bot.name }) },
    state.channels.map((channel) => (0, import_react13.createElement)(ChannelItem, { key: channel.id, channel, state, bot, omni: omni2, open: open.has(channel.id), onToggle: () => toggle(channel.id) }))
  );
}
var OMNI_TREE_CSS = `
.ot-tree{display:grid;gap:1px;margin:0 0 4px 26px;padding-left:10px;border-left:1px solid var(--bt-line, rgba(127,127,127,.2))}
.ot-channel-row{display:flex;align-items:center;gap:7px;width:100%;padding:5px 8px 5px 4px;border:0;border-radius:8px;background:none;color:var(--bt-ink);font:inherit;font-size:13px;line-height:20px;text-align:left;cursor:pointer}
.ot-channel-row:hover{background:var(--bt-hover)}
.ot-channel-row .oc-tile{flex:none}
.ot-link{color:var(--bt-ink-2);font-size:12.5px}
.ot-chevron{display:grid;place-items:center;width:14px;height:14px;flex:none;color:var(--bt-ink-3);transition:transform .18s ease}
.ot-chevron svg{width:12px;height:12px}
.ot-channel-row[aria-expanded=true] .ot-chevron{transform:rotate(90deg)}
.ot-channel-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ot-count{flex:none;min-width:18px;padding:0 5px;border-radius:9px;background:var(--bt-accent, #22d3ee);color:#fff;font-size:11px;line-height:18px;text-align:center;font-weight:600}
.ot-chats{display:grid;grid-template-rows:0fr;transition:grid-template-rows .26s ease}
.ot-chats[data-open]{grid-template-rows:1fr}
.ot-chats-in{overflow:hidden;min-height:0;margin-left:14px}
.ot-chat{display:flex;align-items:center;gap:7px;width:100%;padding:3px 6px 3px 4px;border:0;border-radius:8px;background:none;color:var(--bt-ink-2);font:inherit;font-size:12.5px;line-height:20px;text-align:left;cursor:pointer}
.ot-chat:hover{background:var(--bt-hover);color:var(--bt-ink)}
.ot-chat[aria-current=page]{background:var(--bt-active, var(--bt-hover));color:var(--bt-ink);font-weight:500}
.ot-chat .oc-ava{flex:none}
.ot-chat-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ot-time{flex:none;font-size:10.5px;color:var(--bt-ink-3)}
.ot-unread{flex:none;width:7px;height:7px;border-radius:50%;background:var(--bt-accent, #22d3ee)}
.ot-helper{flex:none;display:grid;place-items:center;width:18px;height:18px;opacity:.9}
.ot-all{color:var(--bt-ink-3);font-size:12px;padding-left:33px}
.ot-empty{display:block;padding:3px 6px 3px 33px;color:var(--bt-ink-3);font-size:12px}
.ot-chats[data-open] .ot-chat{animation:ot-in .22s ease both;animation-delay:calc(var(--i, 0)*25ms)}
@keyframes ot-in{from{opacity:0;transform:translateY(-3px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.ot-chats{transition:none}.ot-chats .ot-chat{animation:none}.ot-chevron{transition:none}}
`;

// src/client/permissions.js
var import_react14 = require("react");
var NONE = {};
var ASKING_TOOLS = ["omni_messages", "omni_send", "omni_react", "omni_media", "omni_delete", "omni_call"];
var KIND_OF = { chat: "chat", group: "group", self: "your own chat", channel: "channel" };
var kindText = (resource) => t(KIND_OF[resource?.type] ?? "chat");
function askTitle(bot, entry) {
  const where = entry.resource?.name ?? t("a chat");
  if (entry.action === "read") return t("{bot} wants to read {where}", { bot: bot.name, where });
  if (entry.action === "media") return t("{bot} wants to open a file in {where}", { bot: bot.name, where });
  if (entry.action === "send") return t("{bot} wants to send to {where}", { bot: bot.name, where });
  if (entry.action === "react") return t("{bot} wants to react in {where}", { bot: bot.name, where });
  if (entry.action === "delete") return t("{bot} wants to delete a message in {where}", { bot: bot.name, where });
  if (entry.action === "disconnect") return t("{bot} wants to disconnect a channel", { bot: bot.name });
  return t("{bot} wants to change Omni", { bot: bot.name });
}
function reachText(entry) {
  const kind = kindText(entry.resource);
  if (entry.kind === "confirm") {
    if (entry.action === "send") return entry.resource?.type === "call" ? t("Sends as you. Asks every time.") : t("Sends as you to a person. Asks every time.");
    if (entry.action === "delete") return t("Deletes for everyone. Asks every time.");
    if (entry.action === "disconnect") return t("Disconnects the channel. Asks every time.");
    return t("Asks every time.");
  }
  if (entry.action === "read") return t("Read the messages of this {kind}.", { kind });
  if (entry.action === "media") return t("Open photos, audio and files in this {kind}.", { kind });
  if (entry.action === "send") return t("Send messages in this {kind}, as you.", { kind });
  if (entry.action === "react") return t("React to messages in this {kind}.", { kind });
  return "";
}
var CONFIRM_LABEL = { send: "Send", delete: "Delete", disconnect: "Disconnect", react: "React" };
function Preview({ entry }) {
  const preview = entry.preview ?? NONE;
  const lines = [];
  if (entry.resource?.type === "call") lines.push((0, import_react14.createElement)("code", { key: "op", className: "om-perm-op" }, `${preview.method ?? ""} ${preview.path ?? ""}${preview.query ? ` ?${preview.query}` : ""}`.trim()));
  if (preview.channel) lines.push((0, import_react14.createElement)("div", { key: "channel", className: "om-perm-to" }, t("From {channel}", { channel: preview.channel })));
  if (preview.to) lines.push((0, import_react14.createElement)("div", { key: "to", className: "om-perm-to" }, t("To {to}", { to: preview.to })));
  if (preview.emoji) lines.push((0, import_react14.createElement)("div", { key: "emoji", className: "om-perm-emoji" }, preview.emoji));
  if (preview.text) lines.push((0, import_react14.createElement)("blockquote", { key: "text", className: "om-perm-text" }, preview.text));
  if (preview.body) lines.push((0, import_react14.createElement)("pre", { key: "body", className: "om-perm-body" }, preview.body));
  return lines.length === 0 ? null : (0, import_react14.createElement)("div", { className: "om-perm-preview" }, lines);
}
function ConsentCard({ bot, entry }) {
  const [busy, setBusy] = (0, import_react14.useState)("");
  const [error, setError] = (0, import_react14.useState)("");
  const answer = (choice) => {
    if (busy) return;
    setBusy(choice);
    setError("");
    Promise.resolve(call("omni-consent-answer", { id: entry.id, answer: choice })).catch((failure) => setError(failure?.message ?? String(failure))).finally(() => setBusy(""));
  };
  const running = entry.status === "running";
  const confirm2 = entry.kind === "confirm";
  const button = (choice, label, primary = false) => (0, import_react14.createElement)("button", {
    type: "button",
    className: primary ? "bt-q-submit" : "bt-q-btn",
    disabled: Boolean(busy) || running,
    onClick: () => answer(choice)
  }, busy === choice ? "…" : label);
  return (0, import_react14.createElement)(
    "div",
    { className: "bt-q om-perm", role: "group", "aria-label": askTitle(bot, entry), "data-kind": entry.kind },
    (0, import_react14.createElement)(
      "div",
      { className: "bt-q-head" },
      (0, import_react14.createElement)("span", { className: "om-perm-who" }, (0, import_react14.createElement)(BotMark, { bot, size: 28 })),
      (0, import_react14.createElement)(
        "div",
        { className: "bt-q-text" },
        (0, import_react14.createElement)("p", { className: "bt-q-title" }, askTitle(bot, entry)),
        (0, import_react14.createElement)("div", { className: "bt-q-detail" }, reachText(entry))
      )
    ),
    (0, import_react14.createElement)(Preview, { entry }),
    error ? (0, import_react14.createElement)("div", { className: "om-perm-error", role: "alert" }, error) : null,
    (0, import_react14.createElement)(
      "div",
      { className: "bt-q-foot" },
      running ? (0, import_react14.createElement)("span", { className: "om-perm-running" }, t("Running…")) : null,
      confirm2 ? [(0, import_react14.createElement)("span", { key: "deny" }, button("deny", t("Cancel"))), (0, import_react14.createElement)("span", { key: "once" }, button("once", t(CONFIRM_LABEL[entry.action] ?? "Allow"), true))] : [
        (0, import_react14.createElement)("span", { key: "deny" }, button("deny", t("No"))),
        (0, import_react14.createElement)("span", { key: "once" }, button("once", t("Once"))),
        entry.resource?.channelId && entry.resource.channelName ? (0, import_react14.createElement)("span", { key: "channel" }, button("channel", t("Always, all of {channel}", { channel: entry.resource.channelName }))) : null,
        (0, import_react14.createElement)("span", { key: "always" }, button("always", t("Always"), true))
      ]
    )
  );
}
var SETTLED = {
  once: "Allowed once",
  always: "Allowed from now on",
  channel: "Allowed on the whole channel",
  interrupted: "Interrupted by a restart",
  confirmed: "Confirmed",
  denied: "Not allowed",
  replaced: "Asked again"
};
function Settled({ bot, entry }) {
  return (0, import_react14.createElement)(
    "div",
    { className: "bt-event om-perm-done", "data-status": entry.status },
    (0, import_react14.createElement)(BotMark, { bot, size: 16 }),
    ` ${askTitle(bot, entry)} · ${t(SETTLED[entry.status] ?? entry.status)}`
  );
}
var entryAt = (roster, bot, sessionId, callId) => (roster.omniConsents?.[bot.id] ?? []).find((item) => item.callId === callId && item.sessionId === sessionId);
function withConsent(render) {
  return (props) => {
    const bot = props.roster?.byId?.[props.sessionId];
    const callId = props.call?.callId;
    const entry = bot && callId ? entryAt(props.roster, bot, props.sessionId, callId) : void 0;
    if (entry === void 0) {
      if (props.done && /^(consent|confirmation)_required:/.test(props.content ?? "")) return (0, import_react14.createElement)("div", { className: "bt-event" }, t("Asked you for permission in its chat"));
      return render ? render(props) : null;
    }
    return (0, import_react14.createElement)("div", { className: "bt-q-inline" }, entry.status === "pending" || entry.status === "running" ? (0, import_react14.createElement)(ConsentCard, { bot, entry }) : (0, import_react14.createElement)(Settled, { bot, entry }));
  };
}
function ConsentDock({ sessionId, useRoster, useCards }) {
  const roster = useRoster((value) => value);
  const shown = useCards?.((state) => state[sessionId]) ?? NONE;
  const bot = roster.byId?.[sessionId];
  if (!bot || (bot.sessionId ?? bot.id) !== sessionId) return null;
  const drawn = (entry) => entry.callId && entry.sessionId === sessionId && shown[entry.callId] > 0;
  const waiting = (roster.omniConsents?.[bot.id] ?? []).filter((entry) => (entry.status === "pending" || entry.status === "running") && !drawn(entry));
  if (waiting.length === 0) return null;
  return (0, import_react14.createElement)("div", { className: "bt-q-dock om-perm-dock" }, waiting.map((entry) => (0, import_react14.createElement)(ConsentCard, { key: entry.id, bot, entry })));
}
var ACTION_TEXT = { read: "read", media: "files", send: "send", react: "react", delete: "delete" };
function PermissionsCard({ bot, roster, run, Card, SwitchRow }) {
  if (!roster.omniGrants) return null;
  const main = (roster.mainBotIds ?? []).includes(bot.id);
  const grants = (roster.omniGrants ?? []).filter((grant) => grant.botId === bot.id);
  const now = Date.now();
  if (main) {
    return (0, import_react14.createElement)(
      Card,
      { title: t("On Omni") },
      (0, import_react14.createElement)("div", { className: "bt-set-row bt-bs-row" }, (0, import_react14.createElement)(
        "span",
        { className: "bt-set-copy" },
        (0, import_react14.createElement)("span", { className: "bt-bs-label" }, t("All of Omni")),
        (0, import_react14.createElement)("span", { className: "bt-set-hint" }, t("A Main Bot operates Omni. Messaging a person, deleting and disconnecting still ask you first."))
      ))
    );
  }
  return (0, import_react14.createElement)(
    Card,
    { title: t("On Omni") },
    grants.length === 0 ? (0, import_react14.createElement)("div", { className: "bt-set-row bt-bs-row" }, (0, import_react14.createElement)(
      "span",
      { className: "bt-set-copy" },
      (0, import_react14.createElement)("span", { className: "bt-bs-label" }, t("Nothing yet")),
      (0, import_react14.createElement)("span", { className: "bt-set-hint" }, t("When {bot} needs a chat, it asks you there, on a card.", { bot: bot.name }))
    )) : grants.map((grant) => (0, import_react14.createElement)(
      "div",
      { key: grant.id, className: "om-grant" },
      (0, import_react14.createElement)(SwitchRow, {
        label: `${grant.resource?.name ?? t("a chat")} · ${grant.actions.map((action) => t(ACTION_TEXT[action] ?? action)).join(", ")}`,
        hint: [kindText(grant.resource), typeof grant.expiresAt === "number" && grant.expiresAt <= now ? t("expired") : "", t("Ask each time")].filter(Boolean).join(" · "),
        on: grant.approval === "confirm",
        onChange: (on2) => run(call("omni-grant-approval", { id: grant.id, approval: on2 ? "confirm" : "auto" }))
      }),
      (0, import_react14.createElement)("button", { type: "button", className: "bt-soft bt-soft-sm om-grant-revoke", onClick: () => run(call("omni-grant-revoke", { id: grant.id })) }, t("Revoke"))
    ))
  );
}
var PERMISSIONS_CSS = `
.om-perm-who{flex:none;display:grid;place-items:center}
.om-perm-preview{margin:8px 0 2px;display:flex;flex-direction:column;gap:6px}
.om-perm-text{margin:0;padding:8px 10px;border-left:3px solid var(--accent,#22d3ee);border-radius:6px;background:rgba(127,127,127,.08);white-space:pre-wrap;overflow-wrap:anywhere;max-height:220px;overflow:auto}
.om-perm-body{margin:0;padding:8px 10px;border-radius:6px;background:rgba(127,127,127,.08);font:11.5px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;overflow-wrap:anywhere;max-height:240px;overflow:auto}
.om-perm-to,.om-perm-op{font-size:12px;opacity:.8;overflow-wrap:anywhere}
.om-perm-emoji{font-size:22px;line-height:1}
.om-perm-error{color:#e5484d;font-size:12px;margin-top:6px}
.om-perm-running{font-size:12px;opacity:.7;margin-right:auto}
.om-perm-done{display:flex;align-items:center;gap:4px}
.om-grant{display:flex;align-items:center;gap:8px}
.om-grant>:first-child{flex:1;min-width:0}
.om-grant-revoke{flex:none;margin-right:12px}
`;

// src/client/strings.js
var STRINGS = {
  "Every {n} days": "每 {n} 天",
  "Every {n} hours": "每 {n} 小时",
  "Every {n} min": "每 {n} 分钟",
  "Weekdays": "工作日",
  "{days} at {time}": "{days} {time}",
  "Custom ({expression})": "自定义（{expression}）",
  "Once, {date} {time}": "一次，{date} {time}",
  "Tell {name} what to automate": "告诉 {name} 要自动化什么",
  "Things that run on their own: when something happens in your chats, or on a schedule. Say what you want to {name}; it sets it up and it shows here.": "会自己运行的事：在你的聊天中发生某件事时，或按计划。把你想要的告诉 {name}；它会设置好并显示在这里。",
  "Things that run on their own, on a schedule or when something happens in your chats.": "会自己运行的事：按计划，或在你的聊天中发生某件事时。",
  "Enabled": "已启用",
  "Inactive": "未启用",
  "Search automations": "搜索自动化",
  "Nothing runs on its own yet.": "还没有会自己运行的事。",
  "No automations match.": "没有匹配的自动化。",
  "Edit the timing in Automation tasks": "在自动化任务中编辑时间",
  "Scheduled": "计划中",
  "a chat": "一个聊天",
  "next run {time}": "下次运行 {time}",
  "not run yet": "还没有运行",
  "Sun": "周日",
  "Mon": "周一",
  "Tue": "周二",
  "Wed": "周三",
  "Thu": "周四",
  "Fri": "周五",
  "Sat": "周六",
  "Reactions and replies to you are not sent yet. Results stay in the runs below.": "回应和回复你暂时还不会发送。结果保留在下方的运行记录中。",
  "Listening to omni.": "正在接收 omni 事件。",
  "Connecting to omni…": "正在连接 omni…",
  "Automations belong to the Main Bot, which this team does not have.": "自动化由主 Bot 负责，但这个团队没有主 Bot。",
  "Open this run": "打开这次运行",
  "acts without asking": "不询问直接执行",
  "A deleted Bot": "已删除的 Bot",
  "Anyone in a watched chat can write text that tries to steer a Bot. Work started by an event reads on its own and asks you before any shell command, file change, web or connector call, or message, unless you tell {name} otherwise. What you allow runs with that Bot's keys.": "被关注聊天中的任何人都可能写下试图操控 Bot 的文字。由事件触发的工作可以自行读取，但在执行任何命令、修改文件、访问网络或连接器、发送消息之前都会先问你，除非你告诉 {name} 不必询问。你允许的操作会使用该 Bot 的密钥运行。",
  "Anyone in a watched chat can write text that tries to steer a Bot. The work this starts reads on its own and asks you before anything else.": "被关注聊天中的任何人都可能写下试图操控 Bot 的文字。它触发的工作可以自行读取，做其他任何事之前都会先问你。",
  "This automation acts without asking you. Anyone in a watched chat can write text that tries to steer a Bot, and the work it starts runs shell, file, web and connector actions with that Bot's own permissions and keys. Tell {name} to ask first to change that.": "这个自动化不会先问你就行动。被关注聊天中的任何人都可能写下试图操控 Bot 的文字，而它触发的工作会以该 Bot 自己的权限和密钥执行命令、文件、网络和连接器操作。告诉 {name} 先问你，即可改变这一点。",
  "Saved automation": "已保存自动化",
  "Saving an automation": "正在保存自动化",
  "Everything is paused.": "全部已暂停。",
  "last run {time}": "上次运行 {time}",
  "not fired yet": "还没有触发过",
  "Omni is not connected to this DSH yet, so there is nothing to watch.": "Omni 还没有连接到这个 DSH，所以暂时没有可关注的内容。",
  "Pause {name}": "暂停 {name}",
  "Resume {name}": "恢复 {name}",
  "Say it in the chat. {name} finds the chats, asks what is missing, and the subscription shows up here.": "在聊天中说出来。{name} 会找到对应的聊天，询问缺少的信息，订阅就会出现在这里。",
  "Tell {name} what to watch": "告诉 {name} 要关注什么",
  "Test": "测试",
  "Voice notes in my own chat go to one ongoing session": "我自己聊天中的语音消息交给一个持续的会话",
  "Watch #ci-alerts for “failed” or “error” and hand it to Ops": "关注 #ci-alerts 中的“failed”或“error”，交给 Ops",
  "Watching 1 chat or channel.": "正在关注 1 个聊天或渠道。",
  "Watching {n} chats and channels.": "正在关注 {n} 个聊天和渠道。",
  "When I react 📌 to a message in any WhatsApp chat, save it to my notes": "当我在任意 WhatsApp 聊天中对消息回应 📌 时，保存到我的笔记",
  "reaction": "回应",
  "new message": "新消息",
  "mention": "提及",
  "keyword": "关键词",
  "voice note": "语音消息",
  "disconnect": "断开",
  "All": "全部",
  "a message says {words}": "消息包含 {words}",
  "A new session each time": "每次新建会话",
  "anywhere on {name}": "{name} 上的任何地方",
  "Group": "群组",
  "{n} waiting for you": "{n} 项等待你",
  "One ongoing session": "一个持续的会话",
  " or ": " 或 ",
  "reacts 👀 then ✅": "回应 👀 然后 ✅",
  "replies to you": "回复你",
  "Runs": "运行记录",
  "you react": "你回应",
  "You react with": "你回应",
  "Any new message": "任何新消息",
  "Someone mentions you": "有人提到你",
  "A message contains": "消息包含",
  "A voice note arrives": "收到语音消息",
  "A photo or file arrives": "收到照片或文件",
  "The channel disconnects": "渠道断开",
  "Did not finish": "未完成",
  "1 channel": "1 个渠道",
  "{n} channels": "{n} 个渠道",
  "1 group": "1 个群组",
  "{n} groups": "{n} 个群组",
  "1 chat": "1 个聊天",
  "{n} chats": "{n} 个聊天",
  "An agent is assigned to this channel in omni.": "omni 中已为此渠道分配了智能体。",
  "Back to channels": "返回渠道",
  "Connecting from here is switched on after you approve it; this run changed nothing in omni.": "从这里连接渠道的功能会在你批准后开启；这次操作没有改动 omni。",
  "last seen online": "最近在线",
  "Live · last refresh failed": "实时 · 上次刷新失败",
  "Live · {origin}": "实时 · {origin}",
  "Loading messages…": "正在加载消息…",
  "No agent is assigned to this channel in omni.": "omni 中没有为此渠道分配智能体。",
  "no messages yet": "还没有消息",
  "Preview: add channel": "预览：添加渠道",
  "Read from omni every 15 seconds. To connect, pause or change a channel, ask Omni.": "每 15 秒从 omni 读取一次。要连接、暂停或修改渠道，请告诉 Omni。",
  "Read-only for now: replying from here is switched on after you approve this view.": "目前只读：你批准此视图后，才会开启从这里回复。",
  "recent chats": "最近聊天",
  "right now": "当前",
  "Sample data until DSH has {missing}.": "在 DSH 配置 {missing} 之前显示示例数据。",
  "That is the whole flow": "流程就是这样",
  "unread": "未读",
  "Yesterday": "昨天",
  "Create the token in {app}'s settings and paste it here.": "在 {app} 的设置中创建 token，然后粘贴到这里。",
  "A {app} window opens. Approve Omni there and come back.": "会打开 {app} 窗口。在那里允许 Omni，然后回到这里。",
  "Add a channel": "添加渠道",
  "Add channel": "添加渠道",
  "The sign-in was denied.": "登录请求被拒绝。",
  "Approve this device": "批准此设备",
  "Scan the QR with your phone: it opens your WhatsApp chat with yourself with the code typed. Send it, and this page goes live.": "用手机扫描二维码：它会打开你与自己的 WhatsApp 聊天并填好验证码。发送后，此页面即接入实时数据。",
  "Open the approval page on your phone or here, and approve with Face ID, Touch ID, your fingerprint or a code.": "在手机或此处打开批准页面，用面容 ID、触控 ID、指纹或验证码批准。",
  "Approve with Face ID or fingerprint": "用面容 ID 或指纹批准",
  "Scan to send it on WhatsApp": "扫码在 WhatsApp 上发送",
  "Scan to approve on your phone": "扫码在手机上批准",
  "Type its address, then approve this device from your phone: on WhatsApp, or with Face ID or your fingerprint. No keys to copy.": "输入它的地址，然后用手机批准此设备：通过 WhatsApp，或用面容 ID 或指纹。无需复制任何密钥。",
  "The pairing was cancelled.": "配对已取消。",
  "The code expired. Start again for a new one.": "验证码已过期，请重新开始获取新的验证码。",
  "Connected to {origin}": "已连接到 {origin}",
  "Open WhatsApp": "打开 WhatsApp",
  "Waiting for the code to arrive at {origin}…": "正在等待验证码送达 {origin}…",
  "Connect your Omni": "连接你的 Omni",
  "Connect an Omni first, or skip for now": "请先连接一个 Omni，或暂时跳过",
  "Continue to Connect AI →": "继续连接 AI →",
  "Show me your Omni, so I can see your channels.": "告诉我你的 Omni 在哪里，这样我就能看到你的渠道。",
  "Your Omni on this Mac": "这台 Mac 上你的 Omni",
  "Your Omni on this computer": "这台电脑上你的 Omni",
  "Omni on this Mac": "这台 Mac 上的 Omni",
  "port {port}": "端口 {port}",
  "saved in your Omni CLI as {name}": "保存在你的 Omni CLI 中，名为 {name}",
  "saved in your Omni CLI": "保存在你的 Omni CLI 中",
  "Not answering": "没有响应",
  "It is not answering right now.": "它目前没有响应。",
  "Needs an update": "需要更新",
  "It runs an older Omni than this app. Updating takes about a minute and keeps its chats and channels.": "它运行的 Omni 比这个应用旧。更新大约需要一分钟，聊天和渠道都会保留。",
  "It is too old to pair with this app. Updating takes about a minute and keeps your chats and channels.": "它太旧，无法与这个应用配对。更新大约需要一分钟，你的聊天和渠道都会保留。",
  "This computer has its key, so it connects without a code.": "这台电脑有它的密钥，无需验证码即可连接。",
  "Managed by another app": "由另一个应用管理",
  "It is too old to pair with this app, and another app runs it, so this one cannot update it. Update it where it runs, or run a new Omni on this Mac.": "它太旧，无法与这个应用配对，而且由另一个应用运行，所以这里无法更新它。请在它运行的地方更新，或在这台 Mac 上运行一个新的 Omni。",
  "It is too old to pair with this app, and another app runs it, so this one cannot update it. Update it where it runs, or run a new Omni on this computer.": "它太旧，无法与这个应用配对，而且由另一个应用运行，所以这里无法更新它。请在它运行的地方更新，或在这台电脑上运行一个新的 Omni。",
  "Sign-in off": "登录已关闭",
  "Approve this device from your phone.": "用手机批准此设备。",
  "Update Omni": "更新 Omni",
  "Install Omni on this Mac": "在这台 Mac 上安装 Omni",
  "Install Omni on this computer": "在这台电脑上安装 Omni",
  "What runs": "会运行什么",
  "runs in a terminal you can watch. Nothing runs until you press Enter.": "在一个你能看到的终端里运行。按下回车之前什么都不会运行。",
  "Connected to Omni {version}": "已连接到 Omni {version}",
  "Update and connect": "更新并连接",
  "Run Omni on this Mac": "在这台 Mac 上运行 Omni",
  "An Omni somewhere else": "其他地方的 Omni",
  "On a server, a VPS, or another computer": "在服务器、VPS 或另一台电脑上",
  "omni.example.com, or the link Omni sent you": "omni.example.com，或 Omni 发给你的链接",
  "Omni address or link": "Omni 地址或链接",
  "No address? Text connect to yourself on WhatsApp, and your Omni replies with a link that connects this app.": "没有地址？在 WhatsApp 上给自己发送 connect，你的 Omni 会回复一个可连接此应用的链接。",
  "A private Omni just for this Mac · about 1 GB": "只属于这台 Mac 的私人 Omni · 约 1 GB",
  "A private Omni just for this computer · about 1 GB": "只属于这台电脑的私人 Omni · 约 1 GB",
  "It starts with your Mac, stays on it, and never touches another Omni.": "它随你的 Mac 启动，只留在这台 Mac 上，不会动到其他 Omni。",
  "It starts with your computer, stays on it, and never touches another Omni.": "它随你的电脑启动，只留在这台电脑上，不会动到其他 Omni。",
  "Set it up": "设置",
  "Where it lives": "它在哪里",
  "{home}, with its own database, NATS and ports.": "{home}，有自己的数据库、NATS 和端口。",
  "We found an Omni on this Mac. Use it, or pick another.": "我们在这台 Mac 上找到了一个 Omni。使用它，或选择另一个。",
  "We found an Omni on this computer. Use it, or pick another.": "我们在这台电脑上找到了一个 Omni。使用它，或选择另一个。",
  "Where does your Omni live?": "你的 Omni 在哪里？",
  "Looking for Omnis on this computer…": "正在查找这台电脑上的 Omni…",
  "Getting Bun (checked against its published checksum)…": "正在获取 Bun（已对照其公布的校验和检查）…",
  "Opening a terminal…": "正在打开终端…",
  "Running… This closes on its own when it finishes.": "正在运行… 完成后会自动关闭。",
  "The command is ready. Press Enter to run it, or edit it first.": "命令已就绪。按回车运行，或先编辑它。",
  "Finished. Connecting…": "已完成。正在连接…",
  "Finished. Closing the terminal…": "已完成。正在关闭终端…",
  "Nothing ran. Open it again when you are ready.": "什么都没有运行。准备好后再打开它。",
  "It stopped with exit code {code}. Read what it printed above, then try again.": "它以退出码 {code} 停止。请阅读上面的输出，然后重试。",
  "Close the terminal": "关闭终端",
  "{title} terminal": "{title} 终端",
  "Connect an Omni first, or close this": "请先连接一个 Omni，或关闭此窗口",
  "Link this DSH to your Omni to see your channels and chats here, and let your Bots work with them.": "把这个 DSH 关联到你的 Omni，就能在这里看到你的渠道和聊天，并让你的 Bot 处理它们。",
  "This DSH reaches an Omni through its profile settings (omni.url and its key).": "这个 DSH 通过它的配置文件设置（omni.url 和其密钥）连接到一个 Omni。",
  "Not answering right now.": "目前没有响应。",
  "Disconnect from {origin}? Your Bots stop seeing its channels until you connect again.": "要断开与 {origin} 的连接吗？在你重新连接之前，你的 Bot 将看不到它的渠道。",
  "Looking for your Omni…": "正在查找你的 Omni…",
  "This page shows sample data until this DSH is linked to your Omni.": "在这个 DSH 关联到你的 Omni 之前，此页面显示示例数据。",
  "Use it with an API key": "用 API 密钥使用它",
  "Older Omnis can't approve this app. Paste its API key instead; it stays on this computer.": "较旧的 Omni 无法批准这个应用。请改为粘贴它的 API 密钥；密钥只保存在这台电脑上。",
  "Find the key where that app keeps its settings.": "在那个应用保存设置的地方找到密钥。",
  "API key for this Omni": "这个 Omni 的 API 密钥",
  "Omni {version} is too old to pair from here. Update it, or paste an API key or the link it sent you.": "Omni {version} 太旧，无法从这里配对。请更新它，或粘贴 API 密钥或它发给你的链接。",
  "This Omni is too old to pair from here. Update it, or paste an API key or the link it sent you.": "这个 Omni 太旧，无法从这里配对。请更新它，或粘贴 API 密钥或它发给你的链接。",
  "Pairing is off on this Omni. Its owner can turn it on, or you can paste an API key.": "这个 Omni 已关闭配对。它的所有者可以开启，或者你可以粘贴 API 密钥。",
  "This key can do everything on your Omni; consider giving this device its own key.": "这个密钥可以在你的 Omni 上做任何事；建议为这台设备单独创建一个密钥。",
  "Omni on this computer": "这台电脑上的 Omni",
  "Use it": "使用它",
  "Sign-in from devices is off on this Omni.": "这个 Omni 已关闭设备登录。",
  "That is not a link your Omni sends. It looks like https://your-omni/api/login/app?grant=…": "这不是你的 Omni 发送的链接。它看起来像 https://your-omni/api/login/app?grant=…",
  "Run Omni on this computer": "在这台电脑上运行 Omni",
  "Update it from a terminal:": "在终端里更新它：",
  "Update to {version}": "更新到 {version}",
  "Omni {latest} is out. This one runs {current}.": "Omni {latest} 已发布。这个 Omni 运行的是 {current}。",
  "Omni {latest} is out, but updates from the app are off on this Omni. Update it where it runs:": "Omni {latest} 已发布，但这个 Omni 关闭了从应用更新。请在它运行的地方更新：",
  "An update to {version} is waiting for your yes on WhatsApp.": "更新到 {version} 正在等待你在 WhatsApp 上确认。",
  "Updating to {version}…": "正在更新到 {version}…",
  "Up to date ({version}).": "已是最新（{version}）。",
  "Could not reach this Omni to check for updates.": "无法连接这个 Omni 来检查更新。",
  "Could not tell whether this Omni has an update.": "无法判断这个 Omni 是否有更新。",
  "Confirm on WhatsApp: your Omni sent you a code. Reply update and that code in your chat with yourself.": "在 WhatsApp 上确认：你的 Omni 给你发了一个验证码。在你和自己的聊天里回复 update 加上这个验证码。",
  "Updating to {version}. Omni restarts by itself in a minute or two.": "正在更新到 {version}。Omni 会在一两分钟内自行重启。",
  "Update the Omni on this computer to {version}? It stops for a minute or two and comes back by itself.": "要把这台电脑上的 Omni 更新到 {version} 吗？它会停一两分钟，然后自行恢复。",
  "Update now": "立即更新",
  "Not now": "暂不",
  "Setup steps": "设置步骤",
  "Welcome": "欢迎",
  "Connect Omni": "连接 Omni",
  "Connect AI": "连接 AI",
  "Omni connected": "Omni 已连接",
  "Connected to {origin}! Now I can see your channels.": "已连接到 {origin}！现在我能看到你的渠道了。",
  "Your Omni is connected. Now I can see your channels.": "你的 Omni 已连接。现在我能看到你的渠道了。",
  "Skip for now": "暂时跳过",
  "All channels": "全部渠道",
  "{app} is connected": "{app} 已连接",
  "Channel health": "渠道状态",
  "Channels and their health": "渠道及其状态",
  "Chats": "聊天",
  "Chats wait for you. Omni only drafts.": "聊天由你回复，Omni 只起草。",
  "Click again to disconnect": "再点一次以断开",
  "Connect {app}": "连接 {app}",
  "Connect the apps people already use to reach you. Omni answers there, and every chat shows up under your Bots.": "连接大家已经用来联系你的应用。Omni 在那里回复，每个聊天都会显示在你的 Bot 下方。",
  "Continue to {app}": "前往 {app}",
  "Conversation with {name}": "与 {name} 的对话",
  "Disconnect {name}": "断开 {name}",
  "Fix now": "立即修复",
  "For example: Sales, Support, Personal": "例如：销售、支持、个人",
  "Get code": "获取代码",
  "Health": "状态",
  "last message": "最近消息",
  "last message {time}": "最近消息 {time}",
  "Link with a phone number": "用手机号关联",
  "Message @BotFather, send /newbot, and copy the token it gives you.": "给 @BotFather 发消息，发送 /newbot，然后复制它给你的 token。",
  "Messages per day, last 7 days: {list}": "最近 7 天每天的消息数：{list}",
  "messages today": "今日消息",
  "{name} is not connected. Fix it to reply.": "{name} 未连接。修复后才能回复。",
  "Name it": "命名",
  "{name} needs attention": "{name} 需要处理",
  "{n} channel needs attention": "{n} 个渠道需要处理",
  "need attention": "需要处理",
  "New {app} token": "新的 {app} token",
  "New chats appear under your Bots. Nothing is sent to your contacts until Omni or you reply.": "新聊天会显示在你的 Bot 下方。在 Omni 或你回复之前，不会向联系人发送任何内容。",
  "No channels yet. Add one to start.": "还没有渠道。添加一个开始吧。",
  "Nothing here reaches a real channel yet.": "这里的内容还不会发到真实渠道。",
  "{n} s": "{n} 秒",
  "{n} today": "今日 {n}",
  "{n} unread": "{n} 条未读",
  "Omni answers": "Omni 回复",
  "Omni answers here": "Omni 在这里回复",
  "Omni is bringing {name} back. Messages sent meanwhile are delivered after.": "Omni 正在恢复 {name}。期间发出的消息会在恢复后送达。",
  "Omni replies on its own and hands over when it should.": "Omni 自动回复，必要时转交给你。",
  "Omni shows an 8-character code. Type it on your phone instead of scanning.": "Omni 会显示一个 8 位代码。在手机上输入它，无需扫码。",
  "Omni stops reading and answering here. Its chats leave the sidebar.": "Omni 将不再读取和回复这里的消息，它的聊天也会从侧边栏移除。",
  "online, last 7 days": "在线率，最近 7 天",
  "On your phone, open {app} → Linked devices → Link a device": "在手机上打开 {app} → 已关联的设备 → 关联新设备",
  "Open {app} on your phone": "在手机上打开 {app}",
  "Open chats": "打开聊天",
  "Pairing code": "配对代码",
  "Or, on the computer that runs that Omni:": "或者在运行该 Omni 的电脑上执行：",
  "Paste a token": "粘贴 token",
  "Paste the {app} token": "粘贴 {app} token",
  "Paste token": "粘贴 token",
  "Phone number with country code": "带国家代码的手机号",
  "Pick a chat under your Bots.": "在你的 Bot 下方选择一个聊天。",
  "Pick where people talk to you. It takes about a minute, and you can disconnect at any time.": "选择大家联系你的地方。大约一分钟即可完成，随时可以断开。",
  "Preview: pretend I scanned it": "预览：假装我已扫码",
  "Preview: pretend I typed it": "预览：假装我已输入",
  "Preview · sample data": "预览 · 示例数据",
  "Reconnect": "重新连接",
  "Reconnecting…": "正在重新连接…",
  "Reply on {channel}": "在 {channel} 回复",
  "Resume": "恢复",
  "Scan": "扫码",
  "Scan a QR code": "扫描二维码",
  "Scan a QR code instead": "改为扫描二维码",
  "Scan with your phone": "用手机扫码",
  "See its health": "查看状态",
  "Sign in": "登录",
  "Sign in with {app}": "使用 {app} 登录",
  "Tap Link a device and point the camera here": "点按“关联新设备”，然后将相机对准这里",
  "Tap “Link with phone number instead”": "点按“改用手机号关联”",
  "Tap Settings, then Linked devices": "点按“设置”，然后点按“已关联的设备”",
  "This channel stopped working": "此渠道已停止工作",
  "Today": "今天",
  "Token": "Token",
  "Type this code": "输入这个代码",
  "typical reply": "通常回复用时",
  "Use a phone number instead": "改用手机号",
  "Waiting for your phone · new code in {n} s": "等待手机 · {n} 秒后换新码",
  "Waiting for your phone… the code works for {n} s": "等待手机… 代码 {n} 秒内有效",
  "You answer": "你来回复",
  "You answer here": "你在这里回复",
  "Your channels": "你的渠道",
  "{count} items": "{count} 项",
  "First {count} shown.": "只显示前 {count} 条。",
  "Live · refreshes by itself": "实时 · 自动刷新",
  "Loading channel…": "正在加载渠道…",
  "Nothing here.": "这里什么都没有。",
  "On the phone: Settings → Linked devices → Link a device.": "在手机上：设置 → 已关联的设备 → 关联新设备。",
  "QR code": "二维码",
  "Scan with WhatsApp": "用 WhatsApp 扫码",
  "Waiting for a code…": "正在等待二维码…",
  "Ran": "执行",
  "Set": "设置",
  "Changed": "修改",
  "Connecting": "连接中",
  "Not connected": "未连接",
  "Changing omni": "正在修改 omni",
  "Checking your channels": "正在查看你的渠道",
  "Connect channel": "连接渠道",
  "Connecting a channel": "正在连接渠道",
  "Looking up omni": "正在查找 omni 接口",
  "No answer.": "没有回应。",
  "Reading omni": "正在读取 omni",
  "Reading your chats": "正在读取你的聊天",
  "channels": "个渠道",
  "chats": "个聊天",
  "item": "项",
  "looking…": "查看中…",
  "messages": "条消息",
  "Nothing came back.": "没有返回内容。",
  "Show all {count}": "显示全部 {count} 项",
  "Someone": "某人",
  "channel": "频道",
  "{name}’s profile": "{name} 的资料",
  "Events start arriving once omni’s event stream is connected here.": "连接 omni 的事件流后，事件就会开始到达。",
  "Event router": "事件路由",
  "Pick chats, groups or whole channels and the moment you care about. {name} picks it up, acts or hands it to the right Bot, and you see what happened here.": "选择聊天、群组或整个渠道，以及你关心的时刻。{name} 会接手，自己处理或交给合适的 Bot，你可以在这里看到结果。",
  "Event router: acts, or hands it to the right Bot": "事件路由：自己处理，或交给合适的 Bot",
  "Add a word, then Enter": "输入一个词后按回车",
  "Add a word to look for.": "添加一个要查找的词。",
  "All of {name}": "{name} 全部",
  "a new session each time": "每次新建会话",
  "A plain agent session, no Bot": "普通的智能体会话，不使用 Bot",
  "Ask me first": "先问我",
  "Chats, groups, whole channels, or a mix.": "聊天、群组、整个渠道，或它们的组合。",
  "Create subscription": "创建订阅",
  "Decline": "拒绝",
  "Delete {name}": "删除 {name}",
  "Describe a subscription": "描述一个订阅",
  "direct chat": "私聊",
  "Direct chat": "私聊",
  "Draft it": "起草",
  "DSH session": "DSH 会话",
  "Edit subscription": "编辑订阅",
  "Everything on {name}": "{name} 上的全部",
  "Find a chat or group": "查找聊天或群组",
  "Groups": "群组",
  "It gets the message, who sent it, and the chat around it.": "它会收到这条消息、发送者，以及上下文聊天。",
  "Its runs stay in the Bot’s chat; nothing new fires.": "已有的运行记录保留在 Bot 的聊天中；之后不再触发。",
  "Main Bot: triages, or hands it to the right Bot": "主 Bot：分拣，或交给合适的 Bot",
  "Messages come from other people": "消息来自其他人",
  "Name it (optional)": "命名（可选）",
  "New subscription": "新建订阅",
  "{n} need you": "{n} 项需要你",
  "no chats yet": "还没有聊天",
  "Nothing fired yet. Test it to see what {name} gets.": "还没有触发过。测试一下，看看 {name} 会收到什么。",
  "On": "开启",
  "one ongoing session": "一个持续的会话",
  "On · fired {n} times today": "已开启 · 今天触发 {n} 次",
  "Only to your own number: the key Omni uses cannot message anyone else.": "只发给你自己的号码：Omni 使用的密钥无法给其他人发消息。",
  "Pick at least one chat, group or channel.": "至少选择一个聊天、群组或渠道。",
  "Pick chats and what to watch for. A Bot acts when it happens.": "选择聊天和要关注的事件。事件发生时由 Bot 处理。",
  "Pick chats, groups or whole channels and the moment you care about. A Bot or a DSH session acts on it, and you see what it did here.": "选择聊天、群组或整个渠道，以及你关心的时刻。由 Bot 或 DSH 会话处理，你可以在这里看到它做了什么。",
  "React on the message: 👀 when it starts, ✅ when done": "在消息上回应：开始时 👀，完成时 ✅",
  "Reply to me in my own chat": "在我自己的聊天中回复我",
  "Results always land in the worker’s chat here.": "结果总会出现在这里的处理者聊天中。",
  "Subscriptions": "订阅",
  "Tell {name} what to watch: “when I react 📌 in Grupo Obras, have Ops file it”": "告诉 {name} 要关注什么：“当我在 Grupo Obras 回应 📌 时，让 Ops 归档”",
  "Test with the latest match": "用最近的匹配测试",
  "The moment that wakes the worker.": "唤醒处理者的时刻。",
  "Then": "然后",
  "This came from a chat message, so the Bot asks before running commands.": "这来自一条聊天消息，所以 Bot 在运行命令前会先询问。",
  "Watching": "关注范围",
  "Where": "在哪里",
  "Who acts": "谁来处理",
  "whole channel": "整个渠道",
  "your own chat": "你自己的聊天",
  "Your own chat": "你自己的聊天",
  "Your reaction on any message in these chats hands it over:": "在这些聊天中对任意消息做出此回应，就会把它交出去：",
  "Your subscriptions": "你的订阅",
  "You see progress in the chat you are already in.": "你在所在的聊天中就能看到进度。",
  "a new session": "新会话",
  "Or scan with the phone camera": "或用手机相机扫描",
  "All chats": "全部聊天",
  "Connect a channel": "连接渠道",
  "Connect a channel and its chats show up here.": "连接一个渠道，它的聊天就会显示在这里。",
  "Fix": "修复",
  "No chats on {name} yet.": "{name} 上还没有聊天。",
  "Show chats from": "显示来自以下渠道的聊天",
  // What a Bot may do on Omni (permissions.js).
  "Sending a message": "正在发送消息",
  "Reacting": "正在回应",
  "Deleting a message": "正在删除消息",
  "{bot} wants to read {where}": "{bot} 想读取 {where}",
  "{bot} wants to open a file in {where}": "{bot} 想打开 {where} 中的文件",
  "{bot} wants to send to {where}": "{bot} 想发送到 {where}",
  "{bot} wants to react in {where}": "{bot} 想在 {where} 中回应",
  "{bot} wants to delete a message in {where}": "{bot} 想删除 {where} 中的一条消息",
  "{bot} wants to disconnect a channel": "{bot} 想断开一个渠道",
  "{bot} wants to change Omni": "{bot} 想更改 Omni",
  "Sends as you. Asks every time.": "以你的身份发送。每次都会询问。",
  "Sends as you to a person. Asks every time.": "以你的身份发给一个人。每次都会询问。",
  "Deletes for everyone. Asks every time.": "为所有人删除。每次都会询问。",
  "Disconnects the channel. Asks every time.": "断开该渠道。每次都会询问。",
  "Asks every time.": "每次都会询问。",
  "Read the messages of this {kind}.": "读取这个{kind}的消息。",
  "Open photos, audio and files in this {kind}.": "打开这个{kind}中的照片、音频和文件。",
  "Send messages in this {kind}, as you.": "以你的身份在这个{kind}中发送消息。",
  "React to messages in this {kind}.": "回应这个{kind}中的消息。",
  "To {to}": "发给 {to}",
  "Running…": "运行中…",
  "No": "不",
  "Always": "总是",
  "Asked you for permission in its chat": "已在它的聊天中请求你的许可",
  "On Omni": "在 Omni 上",
  "All of Omni": "Omni 的全部",
  "A Main Bot operates Omni. Messaging a person, deleting and disconnecting still ask you first.": "主 Bot 操作 Omni。给某人发消息、删除和断开连接仍会先询问你。",
  "Nothing yet": "还没有",
  "When {bot} needs a chat, it asks you there, on a card.": "当 {bot} 需要某个聊天时，它会在那里用卡片询问你。",
  "expired": "已过期",
  "Ask each time": "每次询问",
  "Revoke": "撤销",
  "chat": "聊天",
  "Allowed once": "已允许一次",
  "Allowed from now on": "已允许，从现在起",
  "Confirmed": "已确认",
  "Not allowed": "未允许",
  "Asked again": "已再次询问",
  "read": "读取",
  "files": "文件",
  "send": "发送",
  "react": "回应",
  "delete": "删除",
  "React": "回应",
  "Sent a message": "已发送消息",
  "Reacted": "已回应",
  "Opened a file": "已打开文件",
  "Deleted a message": "已删除消息",
  "From {channel}": "来自 {channel}",
  "Always, all of {channel}": "总是，{channel} 的全部",
  "Allowed on the whole channel": "已在整个渠道上允许",
  "Interrupted by a restart": "因重启而中断",
  // Changing channels on a linked Omni (channels.js, channel-connect-live.js).
  "This device's key can't change channels; ask your Omni's owner.": "此设备的密钥无法更改渠道；请联系你的 Omni 的所有者。",
  "This device's key can't send messages; ask your Omni's owner.": "此设备的密钥无法发送消息；请联系你的 Omni 的所有者。",
  "Set up from the CLI": "请用命令行设置",
  "Starting…": "正在开始…",
  "Waiting for Omni to say the channel is up": "正在等待 Omni 确认渠道已连接",
  "Waiting for your phone…": "正在等待你的手机…",
  "Waiting for your phone · the code refreshes by itself": "正在等待你的手机 · 二维码会自动刷新",
  "Read from omni every 15 seconds.": "每 15 秒从 omni 读取一次。",
  "Not sent: {reason}": "未发送：{reason}",
  "Put it back": "放回输入框",
  "Resuming…": "正在恢复…",
  "Pausing…": "正在暂停…",
  // Adding a channel and the update bar (channel-connect-live.js, channel-add.js, omni-update.js).
  "Pick where people talk to you. Every option connects from here.": "选择别人联系你的地方。每一种都在这里直接连接。",
  "Looking at what this Omni offers…": "正在查看这个 Omni 支持哪些渠道…",
  "How": "方式",
  "About {time}. You can disconnect any time from the channel's page.": "大约 {time}。你随时可以在渠道页面断开连接。",
  "Name this number": "给这个号码起个名字",
  "So you can tell your channels apart, for example Sales or Personal.": "方便区分你的渠道，例如“销售”或“个人”。",
  "Show the code": "显示二维码",
  "Open {app} → Settings → Linked devices": "打开 {app} → 设置 → 已关联的设备",
  "The code refreshes by itself": "二维码会自动刷新",
  "No camera? Link with your number instead": "没有摄像头？改用手机号关联",
  "Make a Telegram bot for Omni": "为 Omni 创建一个 Telegram 机器人",
  "Open {bot} in Telegram": "在 Telegram 中打开 {bot}",
  "Send {command}, then pick a name and a username": "发送 {command}，然后设置名称和用户名",
  "Copy the token it sends you and paste it here": "复制它发给你的令牌并粘贴到这里",
  "Connect your Discord bot": "连接你的 Discord 机器人",
  "In the {portal}, open your app → Bot": "在 {portal} 中打开你的应用 → Bot",
  "Discord Developer Portal": "Discord 开发者门户",
  "Turn on Message Content Intent, then Reset Token and copy it": "开启 Message Content Intent，然后点 Reset Token 并复制",
  "Say hi to your bot": "跟你的机器人打个招呼",
  "Invite it to a server": "邀请它加入服务器",
  "One click: Discord asks which server, with the permissions Omni needs filled in.": "只需一步：Discord 会询问加入哪个服务器，Omni 需要的权限已填好。",
  "Invite to a server": "邀请加入服务器",
  "It is already on my server": "它已经在我的服务器里了",
  "Waiting for Omni to say the bot is up": "正在等待 Omni 确认机器人已上线",
  "Use the token you just copied?": "使用你刚复制的令牌？",
  "Bot token": "机器人令牌",
  "Next we show a link to your bot so you can send it a first message.": "接下来会显示你的机器人链接，方便你发第一条消息。",
  "Next: one click to invite it to your server.": "下一步：一键邀请它加入你的服务器。",
  "Slack isn't set up on this Omni yet": "这个 Omni 还没有设置 Slack",
  "Your Omni's owner sets up its Slack app once in Omni's settings. After that, everyone connects with one button here.": "你的 Omni 的所有者需要在 Omni 设置中配置一次 Slack 应用。之后，每个人都可以在这里一键连接。",
  "As a bot": "作为机器人",
  "As you": "以你的身份",
  "As yourself": "以你自己的身份",
  "Approve in Slack": "在 Slack 中批准",
  "Slack opened in your browser. Pick the workspace and allow Omni; this page goes on by itself.": "Slack 已在浏览器中打开。选择工作区并允许 Omni；此页面会自动继续。",
  "Waiting for Slack…": "正在等待 Slack…",
  "Open Slack again": "再次打开 Slack",
  "Start over": "重新开始",
  "How should Omni join your workspace?": "Omni 应该以什么方式加入你的工作区？",
  "You can change this later by connecting again.": "之后可以重新连接来更改。",
  "How Omni joins Slack": "Omni 加入 Slack 的方式",
  "Omni shows up as its own app. People @mention it, and it only sees channels it is invited to.": "Omni 以独立应用出现。大家 @ 它，它只能看到被邀请加入的频道。",
  "Omni reads and replies as you, in your DMs and channels, and can search them.": "Omni 以你的身份在私信和频道中阅读和回复，并且可以搜索它们。",
  "Connect with Slack": "通过 Slack 连接",
  "Opens Slack in your browser.": "会在浏览器中打开 Slack。",
  "Connect your Business number": "连接你的企业号码",
  "Find these in Meta's {manager} → API setup.": "在 Meta 的 {manager} → API 设置中找到这些信息。",
  "WhatsApp Manager": "WhatsApp 管理工具",
  "Access token": "访问令牌",
  "Phone number ID": "电话号码 ID",
  "WhatsApp Business Account ID": "WhatsApp 企业账户 ID",
  "The token stays with your Omni. Omni only gets that number's messages.": "令牌只保存在你的 Omni 中。Omni 只会收到该号码的消息。",
  "{version} is available": "{version} 已发布",
  "{version} is available · you're on {current}": "{version} 已发布 · 你当前使用 {current}",
  "{version} is available. Its admin updates this Omni.": "{version} 已发布。由管理员更新这个 Omni。",
  "Hide until the next version": "在下个版本前隐藏",
  "Whoever runs this Omni updates it with:": "运行这个 Omni 的人可以用以下命令更新：",
  "Ask whoever runs your Omni to update it.": "请让运行你的 Omni 的人更新它。",
  "Enter your Meta details": "填写你的 Meta 信息",
  "Scan a code": "扫码",
  "Create a bot": "创建机器人",
  "Add your bot": "添加你的机器人",
  "Enter the details": "填写信息",
  "Choose how it joins": "选择加入方式",
  "Create the bot": "创建机器人",
  "Paste its token": "粘贴令牌",
  "Say hi": "打个招呼",
  "Paste the bot token": "粘贴机器人令牌",
  "Your own number, linked like WhatsApp Web.": "你自己的号码，像 WhatsApp 网页版一样关联。",
  "The official Business API, through your Meta account.": "官方企业 API，通过你的 Meta 账户接入。",
  "Channels and DMs, as a bot or as yourself.": "频道和私信，以机器人或你自己的身份。",
  "A bot of yours, in chats and groups.": "你自己的机器人，用于私聊和群组。",
  "Servers, threads and DMs, through your bot.": "服务器、话题和私信，通过你的机器人。",
  // The Omni Bot's channels and chats in the sidebar (omni-tree.js).
  "No chats yet": "还没有聊天",
  "{name} helps in this chat": "{name} 在这个聊天里帮忙",
  "All chats (+{n})": "全部聊天（+{n}）",
  "{name}'s channels": "{name} 的渠道"
};

// src/client/index.js
var import_react15 = require("react");
var { ClockIcon: ClockIcon2 } = icons;
var inject = ["slots"];
var channels = Object.freeze({ Badge, KeyValue, LiveChannel, LiveChat, LiveQr, Table });
var boardRight = null;
function toggleBoard(reportError) {
  const right = boardRight;
  if (!right) return;
  try {
    if (right.isExpanded() && right.active()?.kind === BOARD_KIND) right.toggleExpanded();
    else right.openTab(BOARD_KIND);
  } catch (error) {
    reportError?.(error, "board");
  }
}
function installBoard(ctx, face) {
  const fiber = ctx.inject(["sidebarRight", "sidebarRightTabs"], (scope) => {
    scope.effect(() => scope.sidebarRightTabs.register(boardTabDefinition()), "ds-bot: subscriptions tab type");
    scope.effect(() => ctx.slots.inject("sidebar.right.pane.tab", () => ctx.slots.register({ name: "sidebar.right.pane.tab", key: BOARD_TAB_ID, inject: face }, BoardTab)), "ds-bot: subscriptions tab");
    scope.effect(() => {
      boardRight = scope.sidebarRight;
      return () => {
        boardRight = null;
      };
    }, "ds-bot: the automations board for the header button");
  });
  return () => fiber.dispose();
}
var PHRASES = {
  omni_channels: () => ({ label: t("Checking your channels"), state: "searching" }),
  omni_chats: () => ({ label: t("Reading your chats"), state: "searching" }),
  omni_messages: () => ({ label: t("Reading your chats"), state: "searching" }),
  find_chats: () => ({ label: t("Reading your chats"), state: "searching" }),
  save_automation: () => ({ label: t("Saving an automation"), state: "working" }),
  omni_endpoints: () => ({ label: t("Looking up omni"), state: "searching" }),
  omni_call: (arg) => arg("method") === "GET" || arg("method") === void 0 ? { label: t("Reading omni"), state: "searching" } : { label: t("Changing omni"), state: "working" },
  omni_connect: () => ({ label: t("Connecting a channel"), state: "working" }),
  omni_send: () => ({ label: t("Sending a message"), state: "working" }),
  omni_react: () => ({ label: t("Reacting"), state: "working" }),
  omni_media: () => ({ label: t("Opening a file"), state: "working" }),
  omni_delete: () => ({ label: t("Deleting a message"), state: "working" })
};
var callCard = ({ arg, content, done }) => (0, import_react15.createElement)(OmniCallCard, { ...parseCall(arg, content), done });
var toolCard = ({ tool, arg, content, done }) => (0, import_react15.createElement)(OmniToolCard, { tool, arg, content, done });
function apply(ctx) {
  ctx.effect(() => addStrings(STRINGS), "ds-bot: channels copy");
  registerConnectStep(ctx);
  registerSettings(ctx);
  ctx.effect(() => {
    if (typeof window === "undefined" || typeof window.addEventListener !== "function") return void 0;
    const onConnect = (event) => void connectFromApp(event.detail?.url, event.detail?.grant);
    window.addEventListener("omni-desktop:connect", onConnect);
    return () => window.removeEventListener("omni-desktop:connect", onConnect);
  }, "ds-bot: omni:// links");
  ctx.effect(() => toolCards.register("omni_call", withConsent(callCard), { phrase: PHRASES.omni_call, asks: true }), "ds-bot: omni call card");
  for (const name of ["omni_channels", "omni_chats", "omni_messages", "omni_connect", "omni_send", "omni_react", "omni_media", "omni_delete"]) {
    const asks = ASKING_TOOLS.includes(name);
    ctx.effect(() => toolCards.register(name, asks ? withConsent(toolCard) : toolCard, { phrase: PHRASES[name], asks }), `ds-bot: ${name} card`);
  }
  if (botSettings) ctx.effect(() => botSettings.register({ id: "omni-permissions", order: 0, Component: PermissionsCard }), "ds-bot: Omni permissions settings");
  for (const name of ["find_chats", "omni_endpoints"]) ctx.effect(() => toolCards.register(name, null, { phrase: PHRASES[name] }), `ds-bot: ${name} phrase`);
  ctx.effect(() => toolCards.register("save_automation", (props) => (0, import_react15.createElement)(SavedAutomationCard, props), { phrase: PHRASES.save_automation }), "ds-bot: save_automation card");
  ctx.effect(() => badges.register({ id: "omni-events", Component: ({ bot, roster, useWork }) => bot.id === roster.eventsBotId ? (0, import_react15.createElement)(EventsBadge, { roster, useWork }) : null }), "ds-bot: automations badge");
  if (botChildren) ctx.effect(() => botChildren.register({ id: "omni-channels", Component: OmniTree }), "ds-bot: Omni channels in the sidebar");
  ctx.effect(() => headerButtons.register({
    id: "omni-board",
    Component: ({ bot, roster, actions, useWork }) => bot.id === roster.eventsBotId ? (0, import_react15.createElement)(SubscriptionsButton, { roster, useWork, onToggle: () => toggleBoard(actions.reportError) }) : null
  }), "ds-bot: automations button");
  ctx.effect(() => nav.register({ id: "automations", label: () => t("Automations"), icon: ClockIcon2, run: (actions) => actions.selectPanel(AUTOMATIONS_PANEL) }), "ds-bot: automations nav");
  ctx.effect(() => onShell(({ face, shadow, installCompiledStyles }) => [
    () => installCompiledStyles(CHANNELS_CSS + OMNI_TREE_CSS + SUBSCRIPTIONS_CSS + AUTOMATIONS_CSS + OMNI_LIVE_CSS + OMNI_PEEK_CSS + OMNI_CONNECT_CSS + PERMISSIONS_CSS, "channels"),
    () => shadow("conversation.input.dock", { id: "omni-consent", order: -80, inject: face }, ConsentDock),
    () => shadow("sidebar.footer.action", { id: "bot-connect", order: -100, inject: face }, ChannelsFooter),
    // The Connect wizard opened on demand (settings, Channels, or once after install) mounts here.
    () => shadow("sidebar.footer.action", { id: "omni-connect-wizard", order: 1e3, inject: face }, WizardHost),
    () => shadow("main", { key: CHANNELS_PANEL, inject: face }, ChannelsPage),
    () => shadow("main", { key: CHAT_PANEL, inject: face }, ChatPage),
    () => shadow("main", { key: AUTOMATIONS_PANEL, inject: face }, AutomationsPage),
    () => installBoard(ctx, face)
  ]), "ds-bot: channels on the Bot surface");
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
