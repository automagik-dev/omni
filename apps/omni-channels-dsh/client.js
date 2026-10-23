// Generated from src/client by `npm run build` (scripts/build-client.mjs). Do not edit by hand.
window.__ModuleLoader__.load({
  id: '@automagik/omni-channels-dsh',
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
      for (let j = 0; j < pos.length; j += 1) {
        const row = pos[i];
        const col = pos[j];
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
    let c, mc, r, mr, qrSvg = "", rect;
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
      mr = r * cellSize + margin;
      for (c = 0; c < _this.getModuleCount(); c += 1) {
        if (_this.isDark(r, c)) {
          mc = c * cellSize + margin;
          qrSvg += "M" + mc + "," + mr + rect;
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
  const escapeXml = function(s) {
    let escaped = "";
    for (let i = 0; i < s.length; i += 1) {
      const c = s.charAt(i);
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
qrcode.stringToBytes = function(s) {
  const bytes = [];
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    bytes.push(c & 255);
  }
  return bytes;
};
qrcode.createStringToBytes = function(unicodeData, numChars) {
  const unicodeMap = (function() {
    const bin = base64DecodeInputStream(unicodeData);
    const read = function() {
      const b = bin.read();
      if (b == -1) throw "eof";
      return b;
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
      const v = b2 << 8 | b3;
      unicodeMap2[k] = v;
      count += 1;
    }
    if (count != numChars) {
      throw count + " != " + numChars;
    }
    return unicodeMap2;
  })();
  const unknownChar = "?".charCodeAt(0);
  return function(s) {
    const bytes = [];
    for (let i = 0; i < s.length; i += 1) {
      const c = s.charCodeAt(i);
      if (c < 128) {
        bytes.push(c);
      } else {
        const b = unicodeMap[s.charAt(i)];
        if (typeof b == "number") {
          if ((b & 255) == b) {
            bytes.push(b);
          } else {
            bytes.push(b >>> 8);
            bytes.push(b & 255);
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
        return function(i, j) {
          return (i + j) % 2 == 0;
        };
      case QRMaskPattern.PATTERN001:
        return function(i, j) {
          return i % 2 == 0;
        };
      case QRMaskPattern.PATTERN010:
        return function(i, j) {
          return j % 3 == 0;
        };
      case QRMaskPattern.PATTERN011:
        return function(i, j) {
          return (i + j) % 3 == 0;
        };
      case QRMaskPattern.PATTERN100:
        return function(i, j) {
          return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 == 0;
        };
      case QRMaskPattern.PATTERN101:
        return function(i, j) {
          return i * j % 2 + i * j % 3 == 0;
        };
      case QRMaskPattern.PATTERN110:
        return function(i, j) {
          return (i * j % 2 + i * j % 3) % 2 == 0;
        };
      case QRMaskPattern.PATTERN111:
        return function(i, j) {
          return (i * j % 3 + (i + j) % 2) % 2 == 0;
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
      for (let j = 0; j < e.getLength(); j += 1) {
        num2[i + j] ^= QRMath.gexp(QRMath.glog(_this.getAt(i)) + QRMath.glog(e.getAt(j)));
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
      for (let j = 0; j < count; j += 1) {
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
  const strToNum = function(s) {
    let num = 0;
    for (let i = 0; i < s.length; i += 1) {
      num = num * 10 + chatToNum(s.charAt(i));
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
    const s = _data;
    let i = 0;
    while (i + 1 < s.length) {
      buffer.put(
        getCode(s.charAt(i)) * 45 + getCode(s.charAt(i + 1)),
        11
      );
      i += 2;
    }
    if (i < s.length) {
      buffer.put(getCode(s.charAt(i)), 6);
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
  _this.writeByte = function(b) {
    _bytes.push(b & 255);
  };
  _this.writeShort = function(i) {
    _this.writeByte(i);
    _this.writeByte(i >>> 8);
  };
  _this.writeBytes = function(b, off, len) {
    off = off || 0;
    len = len || b.length;
    for (let i = 0; i < len; i += 1) {
      _this.writeByte(b[i + off]);
    }
  };
  _this.writeString = function(s) {
    for (let i = 0; i < s.length; i += 1) {
      _this.writeByte(s.charCodeAt(i));
    }
  };
  _this.toByteArray = function() {
    return _bytes;
  };
  _this.toString = function() {
    let s = "";
    s += "[";
    for (let i = 0; i < _bytes.length; i += 1) {
      if (i > 0) {
        s += ",";
      }
      s += _bytes[i];
    }
    s += "]";
    return s;
  };
  return _this;
};
var base64EncodeOutputStream = function() {
  let _buffer = 0;
  let _buflen = 0;
  let _length = 0;
  let _base64 = "";
  const _this = {};
  const writeEncoded = function(b) {
    _base64 += String.fromCharCode(encode(b & 63));
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
    let s = String.fromCharCode(_data[dataIndex]);
    dataIndex += 1;
    while (dataIndex < _data.length) {
      const c = String.fromCharCode(_data[dataIndex]);
      dataIndex += 1;
      if (table.contains(s + c)) {
        s = s + c;
      } else {
        bitOut.write(table.indexOf(s), bitLength);
        if (table.size() < 4095) {
          if (table.size() == 1 << bitLength) {
            bitLength += 1;
          }
          table.add(s + c);
        }
        s = c;
      }
    }
    bitOut.write(table.indexOf(s), bitLength);
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
  const b = byteArrayOutputStream();
  gif.write(b);
  const base64 = base64EncodeOutputStream();
  const bytes = b.toByteArray();
  for (let i = 0; i < bytes.length; i += 1) {
    base64.writeByte(bytes[i]);
  }
  base64.flush();
  return "data:image/gif;base64," + base64;
};
var qrcode_default = qrcode;
var stringToBytes = qrcode.stringToBytes;

// src/client/core.js
var import_client = require("@automagik/omni-dsh/client");
var { call, t, addStrings, onShell, toolCards, nav, badges, headerButtons, botSettings } = import_client.omni;
var { OmniMark, BotMark, MAIN_LOOK, CHARACTERS, relativeShort, createSource } = import_client.omni.ui;
var icons = import_client.omni.ui.icons;

// src/client/omni-store.js
var CHANNELS_PANEL = "omni-channels";
var CHAT_PANEL = "omni-chat";
var typeOf = (type) => CHANNEL_TYPES[type] ?? { label: type, tile: "#64748B", glyph: "chat", pairing: "token", blurb: "" };
var CHANNEL_TYPES = {
  "whatsapp-baileys": { label: "WhatsApp", tile: "#25D366", glyph: "whatsapp", pairing: "qr", blurb: "Link a phone number by scanning a code, like WhatsApp Web." },
  "whatsapp-business": { label: "WhatsApp Business", tile: "#128C7E", glyph: "whatsapp", pairing: "oauth", signIn: "Meta", blurb: "The official Business API, through your Meta account." },
  telegram: { label: "Telegram", tile: "#229ED9", glyph: "telegram", pairing: "token", blurb: "A bot of yours, in direct chats and groups." },
  slack: { label: "Slack", tile: "#4A154B", glyph: "slack", pairing: "oauth", signIn: "Slack", blurb: "Workspace channels and direct messages." },
  discord: { label: "Discord", tile: "#5865F2", glyph: "discord", pairing: "token", blurb: "Servers, threads and direct messages." }
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
  const ago = (ms) => now - ms;
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
  return [...chats].sort((a, b) => b.at - a.at);
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
var canWrite = (state) => state.preview;
var set = (patch) => omniStore.set((state) => ({ ...state, ...typeof patch === "function" ? patch(state) : patch }));
var patchChannel = (id, patch) => set((state) => ({ channels: state.channels.map((channel) => channel.id === id ? { ...channel, ...patch } : channel) }));
function omniActions(select, call2) {
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
      if (body === "" || !canWrite(omniStore.getSnapshot())) return;
      const at = Date.now();
      set((state) => ({
        messages: { ...state.messages, [chatId]: [...state.messages[chatId] ?? [], { id: `local-${at}`, from: "you", text: body, at }] },
        chats: state.chats.map((chat) => chat.id === chatId ? { ...chat, preview: `You: ${body}`, at } : chat)
      }));
    },
    setAnsweredBy: (channelId, answeredBy) => patchChannel(channelId, { answeredBy }),
    pause: (channelId) => patchChannel(channelId, { status: "paused" }),
    resume: (channelId) => patchChannel(channelId, { status: "connected", problem: void 0 }),
    reconnect(channelId) {
      patchChannel(channelId, { status: "connecting", problem: void 0 });
      setTimeout(() => patchChannel(channelId, { status: "connected", health: { ...channelOf(omniStore.getSnapshot(), channelId)?.health, lastEventAt: Date.now() } }), 1600);
    },
    // The preview's connect flow ends with a new sample channel.
    finishConnect(type, name) {
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
  set((state) => ({
    // The first live answer drops every sample: their chats and messages are not omni's.
    ...state.preview ? { messages: {}, chatId: null, page: { view: "overview", channelId: null, type: null, step: 0 } } : {},
    preview: false,
    source: { kind: "live", origin: reply.origin, at: Date.now() },
    channels: reply.channels,
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
var runsOf = (roster, subId) => (roster?.subscriptionRuns ?? []).filter((run) => subId === void 0 || run.subId === subId).toSorted((a, b) => b.at - a.at);
var waitingRuns = (roster, waiting = /* @__PURE__ */ new Set()) => (roster?.subscriptionRuns ?? []).filter((run) => run.status === "working" && waiting.has(run.sessionId)).length;

// src/client/channels.js
var import_react = require("react");
var { ArrowUpIcon, ChevronLeftIcon, ChevronRightIcon, PlusIcon } = icons;
var useOmni = () => (0, import_react.useSyncExternalStore)(omniStore.subscribe, omniStore.getSnapshot, omniStore.getSnapshot);
var useActions = (actions) => (0, import_react.useMemo)(() => omniActions((id) => actions.selectPanel(id), call), [actions]);
var stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round", strokeLinejoin: "round" };
var GLYPHS = {
  whatsapp: () => [
    (0, import_react.createElement)("path", { key: "b", d: "M12 3.6a8.4 8.4 0 0 0-7.2 12.8L3.7 20.3l4-1.1A8.4 8.4 0 1 0 12 3.6z", ...stroke }),
    (0, import_react.createElement)("path", { key: "p", d: "M9.2 8.3c-.3 0-.7.1-.9.5-.3.5-.5 1.2-.2 2.1.6 1.8 2.3 3.5 4.1 4.1.9.3 1.6.1 2.1-.2.4-.2.5-.6.5-.9l-.1-.4-1.6-.8-.9 1c-1-.4-1.9-1.3-2.3-2.3l1-.9-.8-1.6z", fill: "currentColor" })
  ],
  telegram: () => [
    (0, import_react.createElement)("path", { key: "a", d: "M20.5 4.5 3.5 11.2l5.3 1.9 2 6.1 3-3.3 4.4 3.3z", ...stroke }),
    (0, import_react.createElement)("path", { key: "b", d: "M8.8 13.1 16.8 8", ...stroke })
  ],
  slack: () => [(0, import_react.createElement)("path", { key: "a", d: "M9.5 4.5v6M14.5 13.5v6M4.5 14.5h6M13.5 9.5h6", ...stroke, strokeWidth: 2.8 })],
  chat: () => [(0, import_react.createElement)("path", { key: "a", d: "M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v8.5A1.5 1.5 0 0 1 19 17H10l-4.5 3.5V17H5a1.5 1.5 0 0 1-1.5-1.5V7A1.5 1.5 0 0 1 5 5.5z", ...stroke })],
  discord: () => [
    (0, import_react.createElement)("path", { key: "a", d: "M7.6 7.2c2.9-1.2 5.9-1.2 8.8 0 1.5 2.4 2.1 5 1.9 8-1.6 1.2-3.1 1.8-4.2 2l-.8-1.5m-2.6 0-.8 1.5c-1.1-.2-2.6-.8-4.2-2-.2-3 .4-5.6 1.9-8z", ...stroke }),
    (0, import_react.createElement)("circle", { key: "l", cx: 9.6, cy: 12.4, r: 1.3, fill: "currentColor" }),
    (0, import_react.createElement)("circle", { key: "r", cx: 14.4, cy: 12.4, r: 1.3, fill: "currentColor" })
  ]
};
function Tile({ type, size = 40, ring = false }) {
  return (0, import_react.createElement)("span", {
    className: `oc-tile${ring ? " oc-tile-ring" : ""}`,
    style: { width: size, height: size, borderRadius: Math.round(size * 0.32), background: typeOf(type).tile }
  }, (0, import_react.createElement)("svg", { width: Math.round(size * 0.62), height: Math.round(size * 0.62), viewBox: "0 0 24 24", "aria-hidden": true, focusable: "false" }, (GLYPHS[typeOf(type).glyph] ?? GLYPHS.chat)()));
}
var StatusDot = ({ status }) => (0, import_react.createElement)("span", { className: "oc-dot", "data-tone": STATUS[status].tone, "aria-hidden": true });
var StatusPill = ({ status }) => (0, import_react.createElement)(
  "span",
  { className: "oc-pill", "data-tone": STATUS[status].tone },
  (0, import_react.createElement)("span", { className: "oc-pill-dot", "aria-hidden": true }),
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
  return (0, import_react.createElement)(
    "span",
    { className: "oc-ava", style: { width: size, height: size, "--oc-hue": hue } },
    (0, import_react.createElement)("span", { className: "oc-ava-face", style: { fontSize: Math.round(size * 0.34) } }, chat.initials),
    chat.avatarUrl ? (0, import_react.createElement)("img", { className: "oc-ava-img", src: chat.avatarUrl, alt: "", loading: "lazy", referrerPolicy: "no-referrer", onError: (event) => {
      event.currentTarget.remove();
    } }) : null,
    channel ? (0, import_react.createElement)("span", { className: "oc-ava-badge" }, (0, import_react.createElement)(Tile, { type: channel.type, size: Math.round(size * 0.4) })) : null
  );
}
function PreviewChip() {
  const source = useOmni().source;
  if (source.kind === "live") {
    return (0, import_react.createElement)(
      "span",
      { className: "oc-preview-chip oc-live-chip", "data-error": source.error ? true : void 0, title: source.error ?? t("Read from omni every 15 seconds. To connect, pause or change a channel, ask Omni.") },
      (0, import_react.createElement)("span", { className: "oc-live-dot", "aria-hidden": true }),
      source.error ? t("Live · last refresh failed") : t("Live · {origin}", { origin: source.origin })
    );
  }
  const missing = source.missing?.join(", ");
  return (0, import_react.createElement)("span", { className: "oc-preview-chip", title: missing ? t("Sample data until DSH has {missing}.", { missing }) : t("Nothing here reaches a real channel yet.") }, t("Preview · sample data"));
}
var dayKey = (at) => new Date(at).toDateString();
function dayLabel(at) {
  const today = /* @__PURE__ */ new Date();
  if (dayKey(at) === today.toDateString()) return t("Today");
  if (dayKey(at) === new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1).toDateString()) return t("Yesterday");
  return new Date(at).toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
}
function ChatPage({ actions }) {
  const state = useOmni();
  const omni2 = useActions(actions);
  const chat = chatOf(state, state.chatId);
  const channel = chat ? channelOf(state, chat.channelId) : void 0;
  const loaded = chat ? state.messages[chat.id] : void 0;
  const loading = chat !== void 0 && loaded === void 0 && !state.preview;
  const messages = chat ? loaded ?? (state.preview ? [{ id: "preview", from: "them", text: chat.preview, at: chat.at }] : []) : [];
  const scroller = (0, import_react.useRef)(null);
  const [draft, setDraft] = (0, import_react.useState)("");
  (0, import_react.useLayoutEffect)(() => {
    const node = scroller.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [chat?.id, messages.length]);
  (0, import_react.useEffect)(() => {
    setDraft("");
  }, [chat?.id]);
  if (!chat || !channel) {
    return (0, import_react.createElement)("div", { className: "oc-page oc-chat-empty" }, (0, import_react.createElement)(OmniMark, { size: 40 }), (0, import_react.createElement)("p", null, t("Pick a chat under your Bots.")));
  }
  const type = typeOf(channel.type);
  const writable = canWrite(state);
  const live = channel.status === "connected" && writable;
  const send = () => {
    omni2.sendText(chat.id, draft);
    setDraft("");
  };
  return (0, import_react.createElement)(
    "div",
    { className: "oc-page oc-chat" },
    (0, import_react.createElement)(
      "header",
      { className: "oc-chat-head" },
      (0, import_react.createElement)(ChatAvatar, { chat, channel, size: 40 }),
      (0, import_react.createElement)(
        "div",
        { className: "oc-chat-who" },
        (0, import_react.createElement)("strong", null, chat.name),
        (0, import_react.createElement)("span", null, `${type.label} · ${channel.name}`)
      ),
      (0, import_react.createElement)(
        "span",
        { className: "oc-answer", "data-by": channel.answeredBy === "Omni" ? "omni" : "you" },
        channel.answeredBy === "Omni" ? (0, import_react.createElement)(import_react.Fragment, null, (0, import_react.createElement)(OmniMark, { size: 14 }), t("Omni answers here")) : t("You answer here")
      ),
      (0, import_react.createElement)("button", { type: "button", className: "oc-ghost", onClick: () => omni2.openChannels("channel", channel.id) }, (0, import_react.createElement)(StatusDot, { status: channel.status }), t("Channel health")),
      (0, import_react.createElement)(PreviewChip)
    ),
    (0, import_react.createElement)(
      "div",
      { ref: scroller, className: "oc-thread", role: "log", "aria-label": t("Conversation with {name}", { name: chat.name }) },
      (0, import_react.createElement)(
        "div",
        { className: "oc-thread-in" },
        loading ? (0, import_react.createElement)("div", { className: "oc-day" }, (0, import_react.createElement)("span", { className: "oc-spinner", "aria-hidden": true }), t("Loading messages…")) : null,
        messages.map((message, index) => {
          const mine = message.from !== "them";
          const newDay = index === 0 || dayKey(messages[index - 1].at) !== dayKey(message.at);
          const first = newDay || messages[index - 1].from !== message.from || messages[index - 1].author !== message.author;
          return (0, import_react.createElement)(import_react.Fragment, { key: message.id }, newDay ? (0, import_react.createElement)("div", { className: "oc-day" }, dayLabel(message.at)) : null, (0, import_react.createElement)(
            "div",
            { className: `oc-msg oc-msg-${message.from}${first ? " oc-msg-first" : ""}` },
            first && !mine && message.author ? (0, import_react.createElement)("span", { className: "oc-msg-author" }, message.author) : null,
            first && message.from === "omni" ? (0, import_react.createElement)("span", { className: "oc-msg-author oc-msg-omni" }, (0, import_react.createElement)(OmniMark, { size: 12 }), "Omni") : null,
            (0, import_react.createElement)("div", { className: "oc-bubble" }, message.text, (0, import_react.createElement)("time", null, new Date(message.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })))
          ));
        })
      )
    ),
    (0, import_react.createElement)(
      "footer",
      { className: "oc-compose-wrap" },
      !writable ? (0, import_react.createElement)("div", { className: "oc-compose-note oc-compose-info" }, t("Read-only for now: replying from here is switched on after you approve this view.")) : live ? null : (0, import_react.createElement)(
        "button",
        { type: "button", className: "oc-compose-note", onClick: () => omni2.openChannels("channel", channel.id) },
        (0, import_react.createElement)(StatusDot, { status: channel.status }),
        t("{name} is not connected. Fix it to reply.", { name: channel.name })
      ),
      (0, import_react.createElement)(
        "div",
        { className: "oc-compose", "data-off": live ? void 0 : true },
        (0, import_react.createElement)("textarea", {
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
        (0, import_react.createElement)("button", { type: "button", className: "oc-send", disabled: !live || draft.trim() === "", "aria-label": t("Send"), onClick: send }, (0, import_react.createElement)(ArrowUpIcon))
      )
    )
  );
}
function ChannelsPage({ actions }) {
  const state = useOmni();
  const omni2 = useActions(actions);
  const { page } = state;
  const channel = page.view === "channel" ? channelOf(state, page.channelId) : void 0;
  return (0, import_react.createElement)(
    "div",
    { className: "oc-page oc-channels" },
    (0, import_react.createElement)(
      "div",
      { className: "oc-channels-in" },
      page.view === "connect" ? (0, import_react.createElement)(ConnectFlow, { state, omni: omni2 }) : channel ? (0, import_react.createElement)(ChannelDetail, { channel, state, omni: omni2 }) : (0, import_react.createElement)(Overview, { state, omni: omni2 })
    )
  );
}
function Overview({ state, omni: omni2 }) {
  const summary = healthSummary(state);
  const troubled = state.channels.filter((channel) => channel.status === "attention" || channel.status === "connecting");
  const replies = state.channels.map((channel) => channel.health?.replyMedianSec).filter((value) => typeof value === "number");
  const median = replies.length === 0 ? null : Math.round(replies.reduce((a, b) => a + b, 0) / replies.length);
  return (0, import_react.createElement)(
    import_react.Fragment,
    null,
    (0, import_react.createElement)(
      "header",
      { className: "oc-head" },
      (0, import_react.createElement)(
        "div",
        null,
        (0, import_react.createElement)("h1", null, t("Channels"), (0, import_react.createElement)(PreviewChip)),
        (0, import_react.createElement)("p", null, t("Connect the apps people already use to reach you. Omni answers there, and every chat shows up under your Bots."))
      ),
      (0, import_react.createElement)("button", { type: "button", className: "oc-primary", onClick: () => omni2.showPage({ view: "connect", type: null, step: 0 }) }, (0, import_react.createElement)(PlusIcon), state.preview ? t("Add channel") : t("Preview: add channel"))
    ),
    // Sample data means no Omni is linked yet: connecting one comes first.
    state.preview ? (0, import_react.createElement)(ConnectOmni) : null,
    troubled.map((channel) => (0, import_react.createElement)(
      "button",
      { key: channel.id, type: "button", className: "oc-callout", "data-tone": STATUS[channel.status].tone, onClick: () => omni2.showPage({ view: "channel", channelId: channel.id }) },
      (0, import_react.createElement)(Tile, { type: channel.type, size: 36 }),
      (0, import_react.createElement)(
        "span",
        { className: "oc-callout-text" },
        (0, import_react.createElement)("strong", null, t("{name} needs attention", { name: `${typeOf(channel.type).label} · ${channel.name}` })),
        (0, import_react.createElement)("span", null, channel.problem ?? t(STATUS[channel.status].label))
      ),
      (0, import_react.createElement)("span", { className: "oc-callout-go" }, t("Fix now"), (0, import_react.createElement)(ChevronRightIcon))
    )),
    (0, import_react.createElement)(
      "div",
      { className: "oc-stats" },
      (0, import_react.createElement)(Stat, { value: `${summary.connected}/${summary.total}`, label: t("connected") }),
      (0, import_react.createElement)(Stat, { value: String(summary.attention), label: t("need attention"), tone: summary.attention > 0 ? "warn" : void 0 }),
      state.preview ? (0, import_react.createElement)(Stat, { value: String(summary.messagesToday), label: t("messages today") }) : (0, import_react.createElement)(Stat, { value: String(state.chats.length), label: t("recent chats") }),
      state.preview ? (0, import_react.createElement)(Stat, { value: median === null ? "–" : median < 60 ? t("{n} s", { n: median }) : t("{n} min", { n: Math.round(median / 60) }), label: t("typical reply") }) : (0, import_react.createElement)(Stat, { value: String(unreadOf(state)), label: t("unread") })
    ),
    (0, import_react.createElement)("h2", { className: "oc-section" }, t("Your channels")),
    state.channels.length === 0 ? (0, import_react.createElement)("div", { className: "oc-empty" }, t("No channels yet. Add one to start.")) : (0, import_react.createElement)("div", { className: "oc-cards" }, state.channels.map((channel) => (0, import_react.createElement)(ChannelCard, { key: channel.id, channel, state, omni: omni2 })))
  );
}
var Stat = ({ value, label, tone }) => (0, import_react.createElement)("div", { className: "oc-stat", "data-tone": tone }, (0, import_react.createElement)("strong", null, value), (0, import_react.createElement)("span", null, label));
function Spark({ week }) {
  const top = Math.max(1, ...week);
  return (0, import_react.createElement)("span", { className: "oc-spark", "aria-hidden": true }, week.map((value, index) => (0, import_react.createElement)("span", { key: index, style: { height: `${Math.max(8, value / top * 100)}%` }, "data-zero": value === 0 || void 0 })));
}
function ChannelCard({ channel, state, omni: omni2 }) {
  const unread = unreadOf(state, channel.id);
  return (0, import_react.createElement)(
    "button",
    { type: "button", className: "oc-card", onClick: () => omni2.showPage({ view: "channel", channelId: channel.id }) },
    (0, import_react.createElement)(
      "span",
      { className: "oc-card-top" },
      (0, import_react.createElement)(Tile, { type: channel.type, size: 42 }),
      (0, import_react.createElement)("span", { className: "oc-card-who" }, (0, import_react.createElement)("strong", null, channel.name), (0, import_react.createElement)("span", null, `${typeOf(channel.type).label} · ${channel.detail}`)),
      (0, import_react.createElement)(StatusPill, { status: channel.status })
    ),
    (0, import_react.createElement)(
      "span",
      { className: "oc-card-bottom" },
      channel.health.week ? (0, import_react.createElement)(Spark, { week: channel.health.week }) : null,
      (0, import_react.createElement)(
        "span",
        { className: "oc-card-facts" },
        channel.health.messagesToday === null ? null : (0, import_react.createElement)("span", null, t("{n} today", { n: channel.health.messagesToday })),
        (0, import_react.createElement)("span", null, channel.health.lastEventAt ? t("last message {time}", { time: relativeShort(channel.health.lastEventAt) }) : t("no messages yet")),
        unread > 0 ? (0, import_react.createElement)("span", { className: "oc-card-unread" }, t("{n} unread", { n: unread })) : null
      )
    )
  );
}
var replyText = (seconds) => seconds === null ? "–" : seconds < 60 ? t("{n} s", { n: seconds }) : t("{n} min", { n: Math.round(seconds / 60) });
function ChannelDetail({ channel, state, omni: omni2 }) {
  const [confirming, setConfirming] = (0, import_react.useState)(false);
  (0, import_react.useEffect)(() => {
    setConfirming(false);
  }, [channel.id]);
  const type = typeOf(channel.type);
  const writable = canWrite(state);
  const { health } = channel;
  const firstChat = visibleChats({ ...state, filter: channel.id })[0];
  const chats = state.chats.filter((chat) => chat.channelId === channel.id);
  const troubled = channel.status === "attention" || channel.status === "connecting";
  return (0, import_react.createElement)(
    import_react.Fragment,
    null,
    (0, import_react.createElement)("button", { type: "button", className: "oc-back", onClick: () => omni2.showPage({ view: "overview", channelId: null }) }, (0, import_react.createElement)(ChevronLeftIcon), t("Channels")),
    (0, import_react.createElement)(
      "header",
      { className: "oc-detail-head" },
      (0, import_react.createElement)(Tile, { type: channel.type, size: 56 }),
      (0, import_react.createElement)(
        "div",
        { className: "oc-detail-who" },
        (0, import_react.createElement)("h1", null, channel.name),
        (0, import_react.createElement)("p", null, `${type.label} · ${channel.detail}`)
      ),
      (0, import_react.createElement)(StatusPill, { status: channel.status })
    ),
    troubled ? (0, import_react.createElement)(
      "div",
      { className: "oc-callout oc-callout-static", "data-tone": STATUS[channel.status].tone },
      (0, import_react.createElement)(
        "span",
        { className: "oc-callout-text" },
        (0, import_react.createElement)("strong", null, channel.status === "connecting" ? t("Reconnecting…") : t("This channel stopped working")),
        (0, import_react.createElement)("span", null, channel.status === "connecting" ? t("Omni is bringing {name} back. Messages sent meanwhile are delivered after.", { name: channel.name }) : channel.problem)
      ),
      writable && channel.status === "attention" && type.pairing !== "token" ? (0, import_react.createElement)("button", { type: "button", className: "oc-primary", onClick: () => omni2.reconnect(channel.id) }, t("Reconnect")) : null,
      channel.status === "connecting" ? (0, import_react.createElement)("span", { className: "oc-spinner", "aria-hidden": true }) : null
    ) : null,
    writable && channel.status === "attention" && type.pairing === "token" ? (0, import_react.createElement)(TokenFix, { channel, type, omni: omni2 }) : null,
    (0, import_react.createElement)(
      "div",
      { className: "oc-actions" },
      firstChat ? (0, import_react.createElement)("button", { type: "button", className: "oc-secondary", onClick: () => {
        omni2.setFilter(channel.id);
        omni2.openChat(firstChat.id);
      } }, t("Open chats")) : null,
      !writable ? null : channel.status === "paused" ? (0, import_react.createElement)("button", { type: "button", className: "oc-secondary", onClick: () => omni2.resume(channel.id) }, t("Resume")) : channel.status === "connected" ? (0, import_react.createElement)("button", { type: "button", className: "oc-secondary", onClick: () => omni2.pause(channel.id) }, t("Pause")) : null
    ),
    (0, import_react.createElement)("h2", { className: "oc-section" }, t("Health")),
    (0, import_react.createElement)(
      "div",
      { className: "oc-stats" },
      health.uptime === null ? (0, import_react.createElement)(Stat, { value: t(STATUS[channel.status].label), label: t("right now"), tone: channel.status === "connected" ? void 0 : "warn" }) : (0, import_react.createElement)(Stat, { value: `${(health.uptime * 100).toFixed(health.uptime === 1 ? 0 : 1)}%`, label: t("online, last 7 days"), tone: health.uptime < 0.95 ? "warn" : void 0 }),
      health.messagesToday === null ? (0, import_react.createElement)(Stat, { value: String(chats.reduce((sum, chat) => sum + chat.unread, 0)), label: t("unread") }) : (0, import_react.createElement)(Stat, { value: String(health.messagesToday), label: t("messages today") }),
      health.replyMedianSec === null && health.lastSeenAt ? (0, import_react.createElement)(Stat, { value: relativeShort(health.lastSeenAt), label: t("last seen online") }) : (0, import_react.createElement)(Stat, { value: replyText(health.replyMedianSec), label: t("typical reply") }),
      (0, import_react.createElement)(Stat, { value: health.lastEventAt ? relativeShort(health.lastEventAt) : "–", label: t("last message") })
    ),
    health.week ? (0, import_react.createElement)(WeekChart, { week: health.week }) : null,
    (0, import_react.createElement)("h2", { className: "oc-section" }, t("Who answers")),
    writable ? (0, import_react.createElement)(
      "div",
      { className: "oc-seg", role: "radiogroup", "aria-label": t("Who answers") },
      [["Omni", t("Omni answers"), t("Omni replies on its own and hands over when it should.")], ["You", t("You answer"), t("Chats wait for you. Omni only drafts.")]].map(([value, title, text]) => (0, import_react.createElement)("button", {
        key: value,
        type: "button",
        role: "radio",
        "aria-checked": channel.answeredBy === value,
        className: "oc-seg-opt",
        onClick: () => omni2.setAnsweredBy(channel.id, value)
      }, (0, import_react.createElement)("strong", null, value === "Omni" ? (0, import_react.createElement)(OmniMark, { size: 16 }) : null, title), (0, import_react.createElement)("span", null, text)))
    ) : (0, import_react.createElement)("div", { className: "oc-seg-opt oc-seg-static" }, channel.answeredBy === "Omni" ? (0, import_react.createElement)(import_react.Fragment, null, (0, import_react.createElement)("strong", null, (0, import_react.createElement)(OmniMark, { size: 16 }), t("Omni answers")), (0, import_react.createElement)("span", null, t("An agent is assigned to this channel in omni."))) : (0, import_react.createElement)(import_react.Fragment, null, (0, import_react.createElement)("strong", null, t("You answer")), (0, import_react.createElement)("span", null, t("No agent is assigned to this channel in omni.")))),
    writable ? (0, import_react.createElement)(
      "div",
      { className: "oc-danger" },
      (0, import_react.createElement)("div", null, (0, import_react.createElement)("strong", null, t("Disconnect {name}", { name: channel.name })), (0, import_react.createElement)("span", null, t("Omni stops reading and answering here. Its chats leave the sidebar."))),
      (0, import_react.createElement)("button", {
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
  return (0, import_react.createElement)(
    "div",
    { className: "oc-chart", role: "img", "aria-label": t("Messages per day, last 7 days: {list}", { list: week.join(", ") }) },
    week.map((value, index) => (0, import_react.createElement)(
      "span",
      { key: index, className: "oc-chart-col" },
      (0, import_react.createElement)("span", { className: "oc-chart-n" }, value > 0 ? String(value) : ""),
      (0, import_react.createElement)("span", { className: "oc-chart-bar", style: { height: `${Math.max(3, value / top * 100)}%` }, "data-zero": value === 0 || void 0 }),
      (0, import_react.createElement)("span", { className: "oc-chart-day" }, days[index])
    ))
  );
}
function ConnectFlow({ state, omni: omni2 }) {
  const { type, step } = state.page;
  const [name, setName] = (0, import_react.useState)("");
  const [token, setToken] = (0, import_react.useState)("");
  (0, import_react.useEffect)(() => {
    setName("");
    setToken("");
  }, [type]);
  if (type === null) {
    return (0, import_react.createElement)(
      import_react.Fragment,
      null,
      (0, import_react.createElement)("button", { type: "button", className: "oc-back", onClick: () => omni2.showPage({ view: "overview" }) }, (0, import_react.createElement)(ChevronLeftIcon), t("Channels")),
      (0, import_react.createElement)("header", { className: "oc-head" }, (0, import_react.createElement)(
        "div",
        null,
        (0, import_react.createElement)("h1", null, t("Add a channel"), (0, import_react.createElement)(PreviewChip)),
        (0, import_react.createElement)("p", null, t("Pick where people talk to you. It takes about a minute, and you can disconnect at any time."))
      )),
      (0, import_react.createElement)("div", { className: "oc-types" }, Object.entries(CHANNEL_TYPES).map(([id, info2]) => (0, import_react.createElement)(
        "button",
        {
          key: id,
          type: "button",
          className: "oc-type",
          onClick: () => omni2.showPage({ type: id, step: 0 })
        },
        (0, import_react.createElement)(Tile, { type: id, size: 48 }),
        (0, import_react.createElement)("strong", null, info2.label),
        (0, import_react.createElement)("span", null, info2.blurb),
        (0, import_react.createElement)("em", null, info2.pairing === "qr" ? t("Scan a QR code") : info2.pairing === "token" ? t("Paste a token") : t("Sign in with {app}", { app: info2.signIn }))
      )))
    );
  }
  const info = CHANNEL_TYPES[type];
  const steps = [t("Name it"), info.pairing === "qr" ? t("Scan") : info.pairing === "token" ? t("Paste token") : t("Sign in"), t("Done")];
  return (0, import_react.createElement)(
    import_react.Fragment,
    null,
    (0, import_react.createElement)("button", { type: "button", className: "oc-back", onClick: () => omni2.showPage({ type: null, step: 0 }) }, (0, import_react.createElement)(ChevronLeftIcon), t("All channels")),
    (0, import_react.createElement)("ol", { className: "oc-steps" }, steps.map((label, index) => (0, import_react.createElement)("li", { key: label, "data-state": index < step ? "done" : index === step ? "now" : void 0 }, (0, import_react.createElement)("span", null, index < step ? "✓" : String(index + 1)), label))),
    (0, import_react.createElement)(
      "div",
      { className: "oc-flow" },
      (0, import_react.createElement)(Tile, { type, size: 64, ring: true }),
      step === 0 ? (0, import_react.createElement)(
        import_react.Fragment,
        null,
        (0, import_react.createElement)("h1", null, t("Connect {app}", { app: info.label })),
        (0, import_react.createElement)("p", null, info.blurb),
        (0, import_react.createElement)("label", { className: "oc-field" }, (0, import_react.createElement)("span", null, t("Name")), (0, import_react.createElement)("input", {
          value: name,
          placeholder: t("For example: Sales, Support, Personal"),
          onChange: (event) => setName(event.target.value),
          autoFocus: true,
          onKeyDown: (event) => {
            if (event.key === "Enter") omni2.showPage({ step: 1 });
          }
        })),
        (0, import_react.createElement)("button", { type: "button", className: "oc-primary", onClick: () => omni2.showPage({ step: 1 }) }, t("Continue"))
      ) : step === 1 ? (0, import_react.createElement)(Pairing, { info, token, setToken, onDone: () => omni2.showPage({ step: 2 }) }) : (0, import_react.createElement)(
        import_react.Fragment,
        null,
        (0, import_react.createElement)("h1", null, state.preview ? t("{app} is connected", { app: info.label }) : t("That is the whole flow")),
        (0, import_react.createElement)("p", null, state.preview ? t("New chats appear under your Bots. Nothing is sent to your contacts until Omni or you reply.") : t("Connecting from here is switched on after you approve it; this run changed nothing in omni.")),
        state.preview ? (0, import_react.createElement)("button", { type: "button", className: "oc-primary", onClick: () => omni2.finishConnect(type, name.trim()) }, t("See its health")) : (0, import_react.createElement)("button", { type: "button", className: "oc-primary", onClick: () => omni2.showPage({ view: "overview", type: null, step: 0 }) }, t("Back to channels"))
      )
    )
  );
}
function Pairing({ info, token, setToken, onDone }) {
  if (info.pairing === "qr") return (0, import_react.createElement)(QrPairing, { info, onDone });
  if (info.pairing === "token") {
    return (0, import_react.createElement)(
      import_react.Fragment,
      null,
      (0, import_react.createElement)("h1", null, t("Paste the {app} token", { app: info.label })),
      (0, import_react.createElement)("p", null, info.label === "Telegram" ? t("Message @BotFather, send /newbot, and copy the token it gives you.") : t("Create the token in {app}'s settings and paste it here.", { app: info.label })),
      (0, import_react.createElement)("label", { className: "oc-field" }, (0, import_react.createElement)("span", null, t("Token")), (0, import_react.createElement)("input", { type: "password", value: token, onChange: (event) => setToken(event.target.value), placeholder: "123456:ABC-…", autoComplete: "off" })),
      (0, import_react.createElement)("button", { type: "button", className: "oc-primary", disabled: token.trim() === "", onClick: onDone }, t("Connect"))
    );
  }
  return (0, import_react.createElement)(
    import_react.Fragment,
    null,
    (0, import_react.createElement)("h1", null, t("Sign in with {app}", { app: info.signIn })),
    (0, import_react.createElement)("p", null, t("A {app} window opens. Approve Omni there and come back.", { app: info.signIn })),
    (0, import_react.createElement)("button", { type: "button", className: "oc-primary", onClick: onDone }, t("Continue to {app}", { app: info.signIn }))
  );
}
function TokenFix({ channel, type, omni: omni2 }) {
  const [token, setToken] = (0, import_react.useState)("");
  return (0, import_react.createElement)(
    "div",
    { className: "oc-fix" },
    (0, import_react.createElement)(
      "label",
      { className: "oc-field" },
      (0, import_react.createElement)("span", null, t("New {app} token", { app: type.label })),
      (0, import_react.createElement)("input", {
        type: "password",
        value: token,
        autoComplete: "off",
        placeholder: "123456:ABC-…",
        onChange: (event) => setToken(event.target.value),
        onKeyDown: (event) => {
          if (event.key === "Enter" && token.trim() !== "") omni2.reconnect(channel.id);
        }
      })
    ),
    (0, import_react.createElement)("button", { type: "button", className: "oc-primary", disabled: token.trim() === "", onClick: () => omni2.reconnect(channel.id) }, t("Reconnect"))
  );
}
function useCountdown(seconds) {
  const [left, setLeft] = (0, import_react.useState)(seconds);
  (0, import_react.useEffect)(() => {
    const timer = setInterval(() => setLeft((value) => value <= 1 ? seconds : value - 1), 1e3);
    return () => clearInterval(timer);
  }, [seconds]);
  return left;
}
function QrPairing({ info, onDone }) {
  const [byPhone, setByPhone] = (0, import_react.useState)(false);
  const [phone, setPhone] = (0, import_react.useState)("");
  const [code, setCode] = (0, import_react.useState)(null);
  const left = useCountdown(60);
  if (byPhone) {
    return (0, import_react.createElement)(
      import_react.Fragment,
      null,
      (0, import_react.createElement)("h1", null, t("Link with a phone number")),
      code === null ? (0, import_react.createElement)(
        import_react.Fragment,
        null,
        (0, import_react.createElement)("p", null, t("Omni shows an 8-character code. Type it on your phone instead of scanning.")),
        (0, import_react.createElement)("label", { className: "oc-field" }, (0, import_react.createElement)("span", null, t("Phone number with country code")), (0, import_react.createElement)("input", { value: phone, inputMode: "tel", placeholder: "+55 11 91234-5678", onChange: (event) => setPhone(event.target.value), autoFocus: true })),
        (0, import_react.createElement)("button", { type: "button", className: "oc-primary", disabled: phone.replace(/\D/g, "").length < 8, onClick: () => setCode("K7QX-4M2P") }, t("Get code"))
      ) : (0, import_react.createElement)(
        import_react.Fragment,
        null,
        (0, import_react.createElement)(
          "ol",
          { className: "oc-howto" },
          (0, import_react.createElement)("li", null, t("On your phone, open {app} → Linked devices → Link a device", { app: info.label })),
          (0, import_react.createElement)("li", null, t("Tap “Link with phone number instead”")),
          (0, import_react.createElement)("li", null, t("Type this code"))
        ),
        (0, import_react.createElement)("div", { className: "oc-code", "aria-label": t("Pairing code") }, code.split("").map((char, index) => (0, import_react.createElement)("span", { key: index, "data-dash": char === "-" || void 0 }, char))),
        (0, import_react.createElement)("span", { className: "oc-qr-wait" }, (0, import_react.createElement)("span", { className: "oc-spinner", "aria-hidden": true }), t("Waiting for your phone… the code works for {n} s", { n: left })),
        (0, import_react.createElement)("button", { type: "button", className: "oc-link", onClick: onDone }, t("Preview: pretend I typed it"))
      ),
      (0, import_react.createElement)("button", { type: "button", className: "oc-link", onClick: () => {
        setByPhone(false);
        setCode(null);
      } }, t("Scan a QR code instead"))
    );
  }
  return (0, import_react.createElement)(
    import_react.Fragment,
    null,
    (0, import_react.createElement)("h1", null, t("Scan with your phone")),
    (0, import_react.createElement)(
      "ol",
      { className: "oc-howto" },
      (0, import_react.createElement)("li", null, t("Open {app} on your phone", { app: info.label })),
      (0, import_react.createElement)("li", null, t("Tap Settings, then Linked devices")),
      (0, import_react.createElement)("li", null, t("Tap Link a device and point the camera here"))
    ),
    (0, import_react.createElement)(
      "div",
      { className: "oc-qr" },
      (0, import_react.createElement)("span", { className: "oc-qr-code" }, (0, import_react.createElement)(SampleQr, { seed: Math.floor(Date.now() / 6e4) }), (0, import_react.createElement)("span", { className: "oc-qr-logo" }, (0, import_react.createElement)(Tile, { type: "whatsapp-baileys", size: 34 }))),
      (0, import_react.createElement)("span", { className: "oc-qr-wait" }, (0, import_react.createElement)("span", { className: "oc-spinner", "aria-hidden": true }), t("Waiting for your phone · new code in {n} s", { n: left }))
    ),
    (0, import_react.createElement)(
      "span",
      { className: "oc-alt" },
      (0, import_react.createElement)("button", { type: "button", className: "oc-link", onClick: () => setByPhone(true) }, t("Use a phone number instead")),
      (0, import_react.createElement)("button", { type: "button", className: "oc-link", onClick: onDone }, t("Preview: pretend I scanned it"))
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
    if ((state >>> 16) % 100 < 48) cells.push((0, import_react.createElement)("rect", { key: `${x}-${y}`, x, y, width: 1, height: 1, rx: 0.3 }));
  }
  const eyes = [[0, 0], [N - 7, 0], [0, N - 7]].map(([x, y]) => (0, import_react.createElement)(
    "g",
    { key: `${x}-${y}` },
    (0, import_react.createElement)("rect", { x: x + 0.5, y: y + 0.5, width: 6, height: 6, rx: 1.6, fill: "none", stroke: "currentColor", strokeWidth: 1 }),
    (0, import_react.createElement)("rect", { x: x + 2, y: y + 2, width: 3, height: 3, rx: 0.9 })
  ));
  return (0, import_react.createElement)("svg", { viewBox: `-1 -1 ${N + 2} ${N + 2}`, width: 196, height: 196, "aria-hidden": true }, (0, import_react.createElement)("g", { fill: "currentColor" }, cells, eyes));
}
var TONES = "[data-tone=ok]{--oc-tone:#16a34a}[data-tone=busy]{--oc-tone:#0ea5e9}[data-tone=warn]{--oc-tone:#f59e0b}[data-tone=off]{--oc-tone:#94a3b8}";
function ChannelsFooter({ wide, actions }) {
  const state = useOmni();
  (0, import_react.useEffect)(() => {
    startLive(call);
  }, []);
  if (!wide) return null;
  const summary = healthSummary(state);
  const label = summary.attention > 0 ? t("{n} channel needs attention", { n: summary.attention }) : t("Channels and their health");
  return (0, import_react.createElement)("span", { className: "bt-connect-wrap" }, (0, import_react.createElement)(
    "button",
    { type: "button", className: "bt-connect bt-connect-foot bt-channels-foot", title: label, "aria-label": `${t("Channels")}, ${label}`, onClick: () => actions.selectPanel(CHANNELS_PANEL) },
    (0, import_react.createElement)("span", { className: "bt-channels-tiles", "aria-hidden": true }, state.channels.slice(0, 4).map((channel) => (0, import_react.createElement)(Tile, { key: channel.id, type: channel.type, size: 18 }))),
    t("Channels"),
    summary.attention > 0 ? (0, import_react.createElement)("span", { className: "oc-warn-dot", "aria-hidden": true }) : (0, import_react.createElement)("span", { className: "bt-channels-count" }, `${summary.connected}/${summary.total}`)
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
.oc-types{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px}
.oc-type{display:flex;flex-direction:column;align-items:flex-start;gap:8px;padding:18px;border-radius:18px;border:.5px solid var(--bt-line-2);background:var(--bt-card);color:var(--bt-ink);font:inherit;text-align:left;cursor:pointer;transition:transform .14s ease,box-shadow .14s ease}
.oc-type:hover{transform:translateY(-2px);box-shadow:0 12px 28px -12px rgba(0,0,0,.18)}
.oc-type strong{margin-top:4px;font-size:15px;font-weight:600}
.oc-type>span:not(.oc-tile){font-size:13px;line-height:19px;color:var(--bt-ink-2)}
.oc-type em{margin-top:auto;padding-top:6px;font-style:normal;font-size:12.5px;font-weight:500;color:var(--bt-accent)}
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
@media (max-width:720px){.oc-stats{grid-template-columns:repeat(2,minmax(0,1fr))}.oc-seg{grid-template-columns:1fr}.oc-channels-in{padding:20px 16px 40px}.oc-head{flex-direction:column}}
@media (prefers-reduced-motion:reduce){.oc-page,.oc-msg,.oc-flow,.oc-chart-bar{animation:none}.oc-card,.oc-type,.oc-filter{transition:none}}
`;

// src/client/omni-peek.js
var import_react2 = require("react");
var PREVIEW = 4;
var HUES2 = [168, 200, 222, 262, 290, 330, 18, 38, 140];
var hueOf2 = (name) => {
  let sum = 0;
  for (const char of String(name ?? "")) sum = sum * 31 + char.charCodeAt(0) >>> 0;
  return HUES2[sum % HUES2.length];
};
var initialsOf = (name) => String(name ?? "?").replace(/[^\p{L}\p{N} ]/gu, "").trim().split(/\s+/).slice(0, 2).map((word) => word[0] ?? "").join("").toUpperCase() || "?";
function Avatar({ name, url, size = 28 }) {
  return (0, import_react2.createElement)(
    "span",
    { className: "op-ava", style: { width: size, height: size, "--op-hue": hueOf2(name), fontSize: Math.round(size * 0.38) } },
    initialsOf(name),
    url ? (0, import_react2.createElement)("img", { src: url, alt: "", loading: "lazy", referrerPolicy: "no-referrer", onError: (event) => {
      event.currentTarget.remove();
    } }) : null
  );
}
var still = () => typeof window !== "undefined" && (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || document.body?.dataset.btMotion === "quiet");
function useCountUp(to) {
  const [shown, setShown] = (0, import_react2.useState)(still() ? to : 0);
  (0, import_react2.useEffect)(() => {
    if (still() || !Number.isFinite(to)) {
      setShown(to);
      return void 0;
    }
    const start = performance.now();
    let frame;
    const step = (now) => {
      const progress = Math.min(1, (now - start) / 600);
      setShown(Math.round(to * (1 - (1 - progress) ** 3)));
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [to]);
  return shown;
}
var when = (at) => Date.parse(at) || Number(at) ? relativeShort(Date.parse(at) || Number(at)) : "";
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
var Icon = ({ kind }) => (0, import_react2.createElement)("svg", { width: 16, height: 16, viewBox: "0 0 20 20", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true }, (0, import_react2.createElement)("path", { d: ICONS[kind] ?? ICONS.records }));
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
var Row = ({ index, children, className = "" }) => (0, import_react2.createElement)("div", { className: `op-row ${className}`, style: { "--i": index } }, children);
function MessageRows({ items }) {
  return items.map((item, index) => {
    const mine = item.isFromMe === true || item.from === "you";
    const name = mine ? t("You") : item.senderDisplayName ?? item.from ?? item.senderName ?? t("Someone");
    const text = item.textContent ?? item.text ?? item.transcription ?? (item.hasMedia ? `[${item.messageType ?? "media"}]` : "");
    return (0, import_react2.createElement)(
      Row,
      { key: item.id ?? index, index, className: mine ? "op-msg op-msg-mine" : "op-msg" },
      mine ? null : (0, import_react2.createElement)(Avatar, { name, size: 26 }),
      (0, import_react2.createElement)(
        "div",
        { className: "op-bubble" },
        mine ? null : (0, import_react2.createElement)("span", { className: "op-bubble-who" }, name),
        (0, import_react2.createElement)("span", { className: "op-bubble-text" }, String(text || "…").slice(0, 220)),
        (0, import_react2.createElement)("span", { className: "op-bubble-at" }, when(item.platformTimestamp ?? item.at ?? item.createdAt))
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
    return (0, import_react2.createElement)(
      Row,
      { key: item.id ?? index, index, className: "op-chat" },
      (0, import_react2.createElement)(Avatar, { name: item.name, url: item.avatarUrl, size: 30 }),
      (0, import_react2.createElement)(
        "div",
        { className: "op-chat-body" },
        (0, import_react2.createElement)("span", { className: "op-chat-name" }, (0, import_react2.createElement)("span", { className: "op-chat-name-text" }, item.name ?? t("Chat")), kindTag(item) ? (0, import_react2.createElement)("span", { className: "op-tag" }, t(kindTag(item))) : null),
        (0, import_react2.createElement)("span", { className: "op-chat-preview" }, String(item.preview ?? item.lastMessagePreview ?? "").slice(0, 120))
      ),
      (0, import_react2.createElement)(
        "div",
        { className: "op-chat-side" },
        (0, import_react2.createElement)("span", { className: "op-chat-at" }, when(item.lastMessageAt)),
        unread > 0 ? (0, import_react2.createElement)("span", { className: "op-unread" }, unread > 99 ? "99+" : unread) : null
      )
    );
  });
}
function ChannelTiles({ items }) {
  return (0, import_react2.createElement)("div", { className: "op-tiles" }, items.map((item, index) => {
    const state = item.state ?? (item.isActive === false ? "paused" : "unknown");
    return (0, import_react2.createElement)(
      "div",
      { key: item.id ?? index, className: "op-tile", style: { "--i": index }, "data-state": state },
      (0, import_react2.createElement)(Tile, { type: item.channel, size: 30 }),
      (0, import_react2.createElement)("span", { className: "op-tile-name" }, item.name),
      (0, import_react2.createElement)("span", { className: "op-tile-state" }, (0, import_react2.createElement)("i", { "aria-hidden": true }), item.profile ?? item.profileName ?? state)
    );
  }));
}
function EventLine({ items }) {
  return (0, import_react2.createElement)("div", { className: "op-events" }, items.map((item, index) => (0, import_react2.createElement)(
    Row,
    { key: item.id ?? index, index, className: "op-event" },
    (0, import_react2.createElement)("span", { className: "op-event-dot", "aria-hidden": true }),
    (0, import_react2.createElement)("span", { className: "op-event-type" }, item.eventType),
    (0, import_react2.createElement)("span", { className: "op-event-text" }, String(item.textContent ?? item.chatName ?? item.source ?? "").slice(0, 100)),
    (0, import_react2.createElement)("span", { className: "op-event-at" }, when(item.receivedAt ?? item.createdAt ?? item.timestamp))
  )));
}
function NamedRows({ items, kind }) {
  return items.map((item, index) => (0, import_react2.createElement)(
    Row,
    { key: item.id ?? index, index, className: "op-named" },
    kind === "people" ? (0, import_react2.createElement)(Avatar, { name: item.displayName ?? item.name, size: 26 }) : (0, import_react2.createElement)("span", { className: "op-named-icon" }, (0, import_react2.createElement)(Icon, { kind })),
    (0, import_react2.createElement)("span", { className: "op-named-name" }, String(item.displayName ?? item.name ?? item.title ?? item.id ?? "—").slice(0, 80)),
    (0, import_react2.createElement)("span", { className: "op-named-meta" }, String(item.status ?? item.state ?? item.type ?? item.triggerType ?? item.channel ?? "").slice(0, 40))
  ));
}
function RecordFields({ record }) {
  const pairs = Object.entries(record).filter(([, value]) => value !== null && value !== void 0 && value !== "" && typeof value !== "object").slice(0, 8);
  return (0, import_react2.createElement)("dl", { className: "op-fields" }, pairs.map(([key, value], index) => (0, import_react2.createElement)(
    import_react2.Fragment,
    { key },
    (0, import_react2.createElement)("dt", { style: { "--i": index } }, key),
    (0, import_react2.createElement)("dd", { style: { "--i": index } }, String(value).slice(0, 120))
  )));
}
function Seen({ data, kind: forced }) {
  const [all, setAll] = (0, import_react2.useState)(false);
  const list = listOf(data);
  if (list === null) {
    const record = data?.data ?? data;
    return record && typeof record === "object" ? (0, import_react2.createElement)(RecordFields, { record }) : null;
  }
  if (list.length === 0) return (0, import_react2.createElement)("p", { className: "op-empty" }, t("Nothing came back."));
  const kind = forced ?? kindOf(list);
  const shown = list.slice(0, PREVIEW);
  const rest = list.length - shown.length;
  const view = kind === "messages" ? (0, import_react2.createElement)(MessageRows, { items: shown }) : kind === "chats" ? (0, import_react2.createElement)(ChatRows, { items: shown }) : kind === "channels" ? (0, import_react2.createElement)(ChannelTiles, { items: shown }) : kind === "events" ? (0, import_react2.createElement)(EventLine, { items: shown }) : (0, import_react2.createElement)(NamedRows, { items: shown, kind });
  return (0, import_react2.createElement)(
    import_react2.Fragment,
    null,
    (0, import_react2.createElement)("div", { className: "op-seen", "data-kind": kind }, view),
    rest > 0 || kind === "records" ? (0, import_react2.createElement)(
      "div",
      { className: "op-more" },
      (0, import_react2.createElement)("button", { type: "button", className: "op-more-btn", onClick: () => setAll((value) => !value) }, all ? t("Hide") : t("Show all {count}", { count: list.length }))
    ) : null,
    all ? (0, import_react2.createElement)("div", { className: "op-all" }, (0, import_react2.createElement)(DataView, { value: data })) : null
  );
}
function PeekCard({ kind = "records", verb, title, count, unit, chips = [], state, failure, children, accent = false }) {
  const shownCount = useCountUp(Number.isFinite(count) ? count : 0);
  return (0, import_react2.createElement)(
    "section",
    { className: "op-card", "data-state": state, "data-accent": accent || void 0 },
    (0, import_react2.createElement)(
      "header",
      { className: "op-head" },
      (0, import_react2.createElement)("span", { className: "op-icon", "data-kind": kind }, (0, import_react2.createElement)(Icon, { kind })),
      (0, import_react2.createElement)("span", { className: "op-verb" }, verb),
      (0, import_react2.createElement)("span", { className: "op-title" }, title),
      state === "working" ? (0, import_react2.createElement)("span", { className: "op-working" }, t("looking…")) : state === "failed" ? (0, import_react2.createElement)("span", { className: "op-failed" }, t("failed")) : Number.isFinite(count) ? (0, import_react2.createElement)("span", { className: "op-count" }, (0, import_react2.createElement)("b", null, shownCount), " ", unit ?? (count === 1 ? t("item") : t("items"))) : null
    ),
    chips.length > 0 ? (0, import_react2.createElement)("div", { className: "op-chips" }, chips.map(([key, value]) => (0, import_react2.createElement)("span", { key, className: "op-chip" }, (0, import_react2.createElement)("span", null, key), chipText(value)))) : null,
    state === "working" ? (0, import_react2.createElement)("div", { className: "op-skeleton", "aria-hidden": true }, [0, 1, 2].map((index) => (0, import_react2.createElement)("span", { key: index, style: { "--i": index } }))) : state === "failed" ? (0, import_react2.createElement)("p", { className: "op-problem", role: "alert" }, failure) : children ? (0, import_react2.createElement)("div", { className: "op-body" }, children) : null
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
var import_react3 = require("react");
function useOmniGet(path, every = 0) {
  const [state, setState] = (0, import_react3.useState)({ loading: true, data: null, error: null });
  (0, import_react3.useEffect)(() => {
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
var Badge = ({ text, tone = "muted" }) => (0, import_react3.createElement)("span", { className: "ou-badge", "data-tone": tone }, text);
var Problem = ({ text }) => (0, import_react3.createElement)("p", { className: "ou-problem", role: "alert" }, text);
function LiveChannel({ id }) {
  const instance = useOmniGet(id ? `/instances/${encodeURIComponent(id)}` : null, 3e4);
  const status = useOmniGet(id ? `/instances/${encodeURIComponent(id)}/status` : null, 8e3);
  const record = instance.data?.data;
  const live = status.data?.data;
  if (instance.error) return (0, import_react3.createElement)(Problem, { text: instance.error });
  if (!record) return (0, import_react3.createElement)("div", { className: "ou-card ou-loading" }, t("Loading channel…"));
  const state = stateOf(record, live);
  return (0, import_react3.createElement)(
    "div",
    { className: "ou-card ou-channel" },
    (0, import_react3.createElement)(Tile, { type: record.channel, size: 38 }),
    (0, import_react3.createElement)(
      "div",
      { className: "ou-channel-body" },
      (0, import_react3.createElement)("strong", null, record.name),
      (0, import_react3.createElement)("span", { className: "ou-muted" }, [typeOf(record.channel).label ?? record.channel, live?.profileName ?? record.profileName, phoneOf(live?.ownerIdentifier ?? record.ownerIdentifier)].filter(Boolean).join(" · "))
    ),
    (0, import_react3.createElement)(Badge, { text: t(STATE[state].label), tone: STATE[state].tone })
  );
}
function QrSvg({ text, size = 208 }) {
  const path = (0, import_react3.useMemo)(() => {
    const code = qrcode_default(0, "L");
    code.addData(text);
    code.make();
    const count = code.getModuleCount();
    let d = "";
    for (let row = 0; row < count; row += 1) for (let col = 0; col < count; col += 1) if (code.isDark(row, col)) d += `M${col} ${row}h1v1h-1z`;
    return { d, count };
  }, [text]);
  return (0, import_react3.createElement)(
    "svg",
    { className: "ou-qr-svg", width: size, height: size, viewBox: `-2 -2 ${path.count + 4} ${path.count + 4}`, role: "img", "aria-label": t("QR code"), shapeRendering: "crispEdges" },
    (0, import_react3.createElement)("rect", { x: -2, y: -2, width: path.count + 4, height: path.count + 4, fill: "#fff" }),
    (0, import_react3.createElement)("path", { d: path.d, fill: "#000" })
  );
}
function LiveQr({ channelId }) {
  const base = channelId ? `/instances/${encodeURIComponent(channelId)}` : null;
  const status = useOmniGet(base && `${base}/status`, 2500);
  const connected = status.data?.data?.isConnected === true || status.data?.data?.state === "connected";
  const qr = useOmniGet(base && !connected ? `${base}/qr` : null, 2500);
  const code = qr.data?.data?.qr;
  if (connected) {
    const live = status.data.data;
    return (0, import_react3.createElement)(
      "div",
      { className: "ou-card ou-qr ou-qr-done" },
      (0, import_react3.createElement)("span", { className: "ou-qr-check", "aria-hidden": true }, "✓"),
      (0, import_react3.createElement)("strong", null, t("Connected")),
      (0, import_react3.createElement)("span", { className: "ou-muted" }, [live.profileName, phoneOf(live.ownerIdentifier)].filter(Boolean).join(" · "))
    );
  }
  return (0, import_react3.createElement)(
    "div",
    { className: "ou-card ou-qr" },
    code ? (0, import_react3.createElement)(QrSvg, { text: code }) : (0, import_react3.createElement)("div", { className: "ou-qr-wait" }, qr.error ? (0, import_react3.createElement)(Problem, { text: qr.error }) : t("Waiting for a code…")),
    (0, import_react3.createElement)(
      "div",
      { className: "ou-qr-help" },
      (0, import_react3.createElement)("strong", null, t("Scan with WhatsApp")),
      (0, import_react3.createElement)("span", { className: "ou-muted" }, t("On the phone: Settings → Linked devices → Link a device.")),
      (0, import_react3.createElement)("span", { className: "ou-live" }, (0, import_react3.createElement)("span", { className: "ou-live-dot", "aria-hidden": true }), qr.data?.data?.message || t("Live · refreshes by itself"))
    )
  );
}
function LiveChat({ id, limit = 8 }) {
  const chat = useOmniGet(id ? `/chats/${encodeURIComponent(id)}` : null, 6e4);
  const messages = useOmniGet(id ? `/chats/${encodeURIComponent(id)}/messages?limit=${Math.min(30, Math.max(1, limit))}` : null, 1e4);
  const record = chat.data?.data;
  if (chat.error) return (0, import_react3.createElement)(Problem, { text: chat.error });
  const items = [...messages.data?.items ?? []].sort((a, b) => (Date.parse(a.platformTimestamp ?? a.createdAt) || 0) - (Date.parse(b.platformTimestamp ?? b.createdAt) || 0));
  return (0, import_react3.createElement)(
    "div",
    { className: "ou-card ou-chat" },
    (0, import_react3.createElement)(
      "div",
      { className: "ou-chat-head" },
      (0, import_react3.createElement)(Tile, { type: record?.channel, size: 26 }),
      (0, import_react3.createElement)("strong", null, record?.name ?? t("Chat")),
      record?.isGroup ? (0, import_react3.createElement)(Badge, { text: t("Group") }) : null
    ),
    items.length === 0 ? (0, import_react3.createElement)("span", { className: "ou-muted" }, messages.loading ? t("Loading messages…") : t("no messages yet")) : (0, import_react3.createElement)("div", { className: "ou-chat-lines" }, items.map((message) => (0, import_react3.createElement)(
      "div",
      { key: message.id, className: "ou-chat-line", "data-me": message.isFromMe ? "" : void 0 },
      message.isFromMe ? null : (0, import_react3.createElement)("span", { className: "ou-chat-who" }, message.senderDisplayName ?? ""),
      (0, import_react3.createElement)("span", { className: "ou-chat-text" }, message.textContent || message.transcription || (message.hasMedia ? `[${message.messageType ?? "media"}]` : "")),
      (0, import_react3.createElement)("span", { className: "ou-chat-at" }, relativeShort(Date.parse(message.platformTimestamp ?? message.createdAt) || Date.now()))
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
function DataView({ value }) {
  const list = Array.isArray(value) ? value : Array.isArray(value?.items) ? value.items : null;
  if (list) {
    if (list.length === 0) return (0, import_react3.createElement)("span", { className: "ou-muted" }, t("Nothing here."));
    if (!list.every((item) => item && typeof item === "object" && !Array.isArray(item))) return (0, import_react3.createElement)("span", null, list.slice(0, ROWS_MAX).map(cell).join(", "));
    const keys = new Set(list.slice(0, 20).flatMap((item) => Object.keys(item).filter((key) => PLAIN(item[key]))));
    const columns = [...FIRST.filter((key) => keys.has(key)), ...[...keys].filter((key) => !FIRST.includes(key))].slice(0, COLUMNS_MAX);
    return (0, import_react3.createElement)(
      import_react3.Fragment,
      null,
      (0, import_react3.createElement)(Table, { columns, rows: list.slice(0, ROWS_MAX).map((item) => columns.map((key) => item[key])) }),
      list.length > ROWS_MAX || value?.meta?.hasMore ? (0, import_react3.createElement)("span", { className: "ou-muted" }, t("First {count} shown.", { count: Math.min(list.length, ROWS_MAX) })) : null
    );
  }
  const record = value && typeof value === "object" && !Array.isArray(value) ? value.data ?? value : null;
  if (record && typeof record === "object") {
    const pairs = Object.entries(record).filter(([, item]) => item !== null && item !== void 0 && item !== "").slice(0, 24);
    return (0, import_react3.createElement)(KeyValue, { pairs: pairs.map(([label, item]) => ({ label, value: item })) });
  }
  return (0, import_react3.createElement)("span", null, cell(value));
}
function Table({ columns, rows }) {
  return (0, import_react3.createElement)(
    "div",
    { className: "ou-table-wrap" },
    (0, import_react3.createElement)(
      "table",
      { className: "ou-table" },
      (0, import_react3.createElement)("thead", null, (0, import_react3.createElement)("tr", null, columns.map((column, index) => (0, import_react3.createElement)("th", { key: index }, column)))),
      (0, import_react3.createElement)("tbody", null, rows.map((row, index) => (0, import_react3.createElement)("tr", { key: index }, columns.map((_, col) => (0, import_react3.createElement)("td", { key: col }, cell(row[col]))))))
    )
  );
}
function KeyValue({ pairs }) {
  return (0, import_react3.createElement)("dl", { className: "ou-kv" }, pairs.map(({ label, value }, index) => (0, import_react3.createElement)(import_react3.Fragment, { key: index }, (0, import_react3.createElement)("dt", null, label), (0, import_react3.createElement)("dd", null, cell(value)))));
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
    return (0, import_react3.createElement)(
      PeekCard,
      { kind, verb, title, count: list?.length, chips: chipsOf(query), state, failure },
      state === "done" ? (0, import_react3.createElement)(Seen, { data: result?.data, kind: list && kind !== "records" ? kind : void 0 }) : null
    );
  }
  const live = state !== "done" ? null : instance && ["connect", "pair", "qr", "restart"].includes(action) ? (0, import_react3.createElement)(LiveQr, { channelId: instance }) : instance ? (0, import_react3.createElement)(LiveChannel, { id: instance }) : method === "POST" && path === "/instances" && result?.data?.data?.id ? (0, import_react3.createElement)(LiveChannel, { id: result.data.data.id }) : (0, import_react3.createElement)(Seen, { data: result?.data });
  return (0, import_react3.createElement)(PeekCard, { kind: method === "DELETE" ? "remove" : "write", verb, title, chips: chipsOf(query), state, failure, accent: true }, live);
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
    return (0, import_react3.createElement)(
      PeekCard,
      { kind: "channels", verb: t("Read"), title: t("Channels"), count: done ? items.length : void 0, unit: t("channels"), state, failure },
      state === "done" ? (0, import_react3.createElement)(Seen, { data: items, kind: "channels" }) : null
    );
  }
  if (tool === "omni_chats") {
    const chips = [["channel", arg("channel")], ["search", arg("search")], ["unread only", arg("unread_only") === "true" || arg("unread_only") === true ? t("yes") : void 0], ["limit", arg("limit")]].filter(([, value]) => value !== void 0 && value !== null && value !== "");
    return (0, import_react3.createElement)(
      PeekCard,
      { kind: "chats", verb: t("Read"), title: t("Chats"), count: done ? items.length : void 0, unit: t("chats"), chips, state, failure },
      state === "done" ? (0, import_react3.createElement)(Seen, { data: items, kind: "chats" }) : null
    );
  }
  if (tool === "omni_messages") {
    const chat = result?.data?.chat;
    return (0, import_react3.createElement)(
      PeekCard,
      { kind: "messages", verb: t("Read"), title: chat?.name ?? t("Chat"), count: done ? items.length : void 0, unit: t("messages"), state, failure },
      state === "done" ? (0, import_react3.createElement)(Seen, { data: items, kind: "messages" }) : null
    );
  }
  if (tool === "omni_connect") {
    return (0, import_react3.createElement)(
      PeekCard,
      { kind: "channels", verb: t("Ran"), title: t("Connect channel"), state, failure, accent: true },
      state === "done" && result?.channelId ? (0, import_react3.createElement)(LiveQr, { channelId: result.channelId }) : null
    );
  }
  const acted = ACTED[tool];
  if (acted) return (0, import_react3.createElement)(PeekCard, { kind: "messages", verb: t("Ran"), title: t(acted), state, failure, accent: true });
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

// src/client/omni-connect.js
var import_react4 = require("react");
var DEFAULT_POLL_MS = 2e3;
var PAIRING_EVENT = "omni:pairing";
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
    window.dispatchEvent(new CustomEvent(PAIRING_EVENT, { detail: reply.pairing }));
    if (reply.pairing?.approveUrl) window.open(reply.pairing.approveUrl, "_blank", "noopener");
  } catch (error) {
    window.dispatchEvent(new CustomEvent(PAIRING_EVENT, { detail: { problem: error.message } }));
  }
}
function foundLabel(omni2) {
  if (omni2.source === "sandbox") return t("Your sandboxed Omni on this computer");
  if (!omni2.local) return new URL(omni2.url).host;
  if (omni2.source === "running") return t("An Omni running on this computer");
  return omni2.name && omni2.name !== "default" ? t("{name} on this computer", { name: omni2.name }) : t("Omni on this computer");
}
function foundDetail(omni2) {
  const port = new URL(omni2.url).port;
  const where = omni2.source === "cli" ? t("from your Omni CLI") : omni2.source === "cli-server" ? omni2.name ? t("from your Omni CLI as {name}", { name: omni2.name }) : t("from your Omni CLI") : omni2.source === "running" && port ? t("answering on port {port}", { port }) : null;
  return [omni2.version ? `v${omni2.version}` : null, where].filter(Boolean).join(" · ");
}
function FoundOmni({ omni: omni2, busy, onUse }) {
  const action = (label, disabled = false) => (0, import_react4.createElement)("button", { type: "button", className: "oc-primary", disabled: disabled || busy, onClick: disabled ? void 0 : () => onUse(omni2) }, label);
  let note = null;
  let button = null;
  if (omni2.local && omni2.reachable === false) note = t("Not answering right now.");
  else if (omni2.hasKey) button = action(t("Use it"));
  else if (omni2.pairing === "too-old") {
    note = t("Omni {version} on this computer is too old to pair. Update it to connect.", { version: omni2.version ?? "" });
    button = action(t("Update"), true);
  } else if (omni2.pairing === "off") note = t("Sign-in from devices is off on this Omni.");
  else button = action(t("Connect"));
  const detail = foundDetail(omni2);
  return (0, import_react4.createElement)(
    "li",
    { className: "ox-found-row" },
    (0, import_react4.createElement)("span", { className: "ox-found-dot", "aria-hidden": true }),
    (0, import_react4.createElement)(
      "div",
      { className: "ox-found-text" },
      (0, import_react4.createElement)("strong", null, foundLabel(omni2)),
      detail ? (0, import_react4.createElement)("span", { className: "ox-muted" }, detail) : null,
      note ? (0, import_react4.createElement)("span", { className: "ox-muted" }, note) : null
    ),
    button
  );
}
function ConnectOmni({ onPaired, embedded = false } = {}) {
  const [address, setAddress] = (0, import_react4.useState)("");
  const [linkText, setLinkText] = (0, import_react4.useState)("");
  const [pairing, setPairing] = (0, import_react4.useState)(null);
  const [found, setFound] = (0, import_react4.useState)([]);
  const [busy, setBusy] = (0, import_react4.useState)(null);
  const [problem, setProblem] = (0, import_react4.useState)(null);
  const [note, setNote] = (0, import_react4.useState)(null);
  const [done, setDone] = (0, import_react4.useState)(null);
  const alive = (0, import_react4.useRef)(true);
  (0, import_react4.useEffect)(() => () => {
    alive.current = false;
  }, []);
  (0, import_react4.useEffect)(() => {
    call("omni-link").then((link) => {
      if (alive.current && link?.pairing) setPairing(link.pairing);
    }, () => {
    });
    call("omni-discover").then((reply) => {
      if (alive.current) setFound(Array.isArray(reply?.omnis) ? reply.omnis : []);
    }, () => {
    });
    const onPairing = (event) => {
      if (!alive.current) return;
      if (event.detail?.problem) setProblem(event.detail.problem);
      else if (event.detail?.paired) void finish(event.detail.paired);
      else if (event.detail) setPairing(event.detail);
    };
    window.addEventListener(PAIRING_EVENT, onPairing);
    return () => window.removeEventListener(PAIRING_EVENT, onPairing);
  }, []);
  const finish = async (origin) => {
    setPairing(null);
    setDone(origin);
    await refreshLive(call).catch(() => {
    });
    if (alive.current) onPaired?.(origin);
  };
  (0, import_react4.useEffect)(() => {
    if (!pairing) return void 0;
    let timer = 0;
    const tick = async () => {
      try {
        const reply = await call("omni-pair-poll");
        if (!alive.current) return;
        if (reply.status === "paired") return finish(reply.origin);
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
  const run = async (which, endpoint, payload) => {
    setBusy(which);
    setProblem(null);
    setNote(null);
    try {
      const reply = await call(endpoint, payload);
      if (!alive.current) return;
      if (reply.status === "paired") await finish(reply.origin);
      else if (reply.pairing) setPairing(reply.pairing);
      else if (reply.message) setNote(reply.message);
    } catch (error) {
      if (alive.current) setProblem(error.message);
    } finally {
      if (alive.current) setBusy(null);
    }
  };
  const start = (event) => {
    event.preventDefault();
    return run("address", "omni-pair-start", { url: address });
  };
  const pasteLink = (event) => {
    event.preventDefault();
    const link = parseConnectLink(linkText);
    if (link === null) {
      setNote(null);
      setProblem(t("That is not a link your Omni sends. It looks like https://your-omni/api/login/app?grant=…"));
      return void 0;
    }
    return run("link", "omni-connect-grant", link);
  };
  const cancel = async () => {
    setPairing(null);
    await call("omni-pair-cancel").catch(() => {
    });
  };
  if (done) {
    return (0, import_react4.createElement)(
      "section",
      { className: "ox-card ox-done" },
      (0, import_react4.createElement)("span", { className: "ox-check", "aria-hidden": true }, "✓"),
      (0, import_react4.createElement)("strong", null, t("Connected to {origin}", { origin: done }))
    );
  }
  if (pairing) {
    return (0, import_react4.createElement)(
      "section",
      { className: "ox-card", "aria-live": "polite" },
      (0, import_react4.createElement)(
        "div",
        { className: "ox-steps" },
        (0, import_react4.createElement)("h2", null, t("Approve this device")),
        (0, import_react4.createElement)("p", { className: "ox-muted" }, pairing.waLink ? t("Scan the QR with your phone: it opens your WhatsApp chat with yourself with the code typed. Send it, and this page goes live.") : t("Open the approval page on your phone or here, and approve with Face ID, Touch ID, your fingerprint or a code.")),
        (0, import_react4.createElement)("div", { className: "ox-code", "aria-label": t("Pairing code") }, pairing.code),
        (0, import_react4.createElement)(
          "div",
          { className: "ox-row" },
          pairing.waLink ? (0, import_react4.createElement)("a", { className: "oc-primary", href: pairing.waLink, target: "_blank", rel: "noreferrer" }, t("Open WhatsApp")) : null,
          pairing.approveUrl ? (0, import_react4.createElement)("a", { className: pairing.waLink ? "oc-ghost" : "oc-primary", href: pairing.approveUrl, target: "_blank", rel: "noreferrer" }, t("Approve with Face ID or fingerprint")) : null,
          (0, import_react4.createElement)("button", { type: "button", className: "oc-ghost", onClick: cancel }, t("Cancel"))
        ),
        (0, import_react4.createElement)("span", { className: "ox-wait" }, (0, import_react4.createElement)("span", { className: "oc-spinner", "aria-hidden": true }), t("Waiting for the code to arrive at {origin}…", { origin: pairing.origin })),
        problem ? (0, import_react4.createElement)("p", { className: "ox-problem", role: "alert" }, problem) : null
      ),
      (0, import_react4.createElement)(
        "div",
        { className: "ox-qr" },
        (0, import_react4.createElement)(QrSvg, { text: pairing.waLink ?? pairing.approveUrl, size: 168 }),
        (0, import_react4.createElement)("span", { className: "ox-muted" }, pairing.waLink ? t("Scan to send it on WhatsApp") : t("Scan to approve on your phone"))
      )
    );
  }
  const anyBusy = busy !== null;
  return (0, import_react4.createElement)(
    "section",
    { className: "ox-card ox-start" },
    embedded ? null : (0, import_react4.createElement)("span", { className: "ox-mark", "aria-hidden": true }, (0, import_react4.createElement)(OmniMark, { size: 34 })),
    (0, import_react4.createElement)(
      "div",
      { className: "ox-steps" },
      embedded ? null : (0, import_react4.createElement)("h2", null, t("Connect your Omni")),
      found.length > 0 ? (0, import_react4.createElement)("h3", { className: "ox-sub" }, t("We found")) : null,
      found.length > 0 ? (0, import_react4.createElement)("ul", { className: "ox-found" }, found.map((omni2) => (0, import_react4.createElement)(FoundOmni, { key: omni2.id, omni: omni2, busy: anyBusy, onUse: (entry) => run(entry.id, "omni-discover-use", { id: entry.id }) }))) : null,
      found.length > 0 ? (0, import_react4.createElement)("h3", { className: "ox-sub" }, t("Connect another Omni")) : null,
      (0, import_react4.createElement)("p", { className: "ox-muted" }, t("Type your Omni's address, or paste the link it sent you. Then approve with Face ID, Touch ID, your fingerprint or a code on WhatsApp. No keys to copy.")),
      (0, import_react4.createElement)(
        "form",
        { className: "ox-row", onSubmit: start },
        (0, import_react4.createElement)("input", {
          className: "ox-input",
          type: "text",
          inputMode: "url",
          autoComplete: "url",
          spellCheck: false,
          value: address,
          placeholder: "omni.example.com",
          "aria-label": t("Omni address"),
          onChange: (event) => setAddress(event.target.value)
        }),
        (0, import_react4.createElement)("button", { type: "submit", className: "oc-primary", disabled: anyBusy || address.trim() === "" }, busy === "address" ? t("Connecting…") : t("Get a code"))
      ),
      (0, import_react4.createElement)(
        "form",
        { className: "ox-row", onSubmit: pasteLink },
        (0, import_react4.createElement)("input", {
          className: "ox-input",
          type: "text",
          inputMode: "url",
          autoComplete: "off",
          spellCheck: false,
          value: linkText,
          placeholder: t("or paste the link your Omni sent you"),
          "aria-label": t("Link from your Omni"),
          onChange: (event) => setLinkText(event.target.value)
        }),
        (0, import_react4.createElement)("button", { type: "submit", className: "oc-ghost", disabled: anyBusy || linkText.trim() === "" }, busy === "link" ? t("Connecting…") : t("Connect"))
      ),
      (0, import_react4.createElement)("p", { className: "ox-muted ox-hint" }, t("Text connect to yourself on WhatsApp and your Omni sends you the link.")),
      (0, import_react4.createElement)(
        "div",
        { className: "ox-row" },
        (0, import_react4.createElement)("button", { type: "button", className: "oc-ghost", disabled: anyBusy, onClick: () => run("local", "omni-local-install") }, busy === "local" ? t("Starting…") : t("Run Omni on this computer"))
      ),
      note ? (0, import_react4.createElement)("p", { className: "ox-muted ox-note", role: "status" }, note) : null,
      problem ? (0, import_react4.createElement)("p", { className: "ox-problem", role: "alert" }, problem) : null
    )
  );
}
var OMNI_CONNECT_CSS = `
.ox-card{display:flex;gap:22px;align-items:flex-start;margin:4px 0 22px;padding:20px 22px;border:1px solid var(--bt-line);border-radius:16px;background:color-mix(in srgb,var(--bt-accent) 5%,var(--bt-surface,transparent))}
.ox-start{align-items:center}
.ox-mark{flex:none;display:inline-grid;place-items:center;width:56px;height:56px;border-radius:16px;background:color-mix(in srgb,var(--bt-accent) 12%,transparent);color:var(--bt-ink)}
.ox-steps{display:flex;flex-direction:column;gap:10px;min-width:0;flex:1}
.ox-steps h2{margin:0;font-size:16px;font-weight:600}
.ox-muted{margin:0;color:var(--bt-ink-2);font-size:13px;line-height:1.45}
.ox-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.ox-input{flex:1;min-width:200px;height:36px;padding:0 12px;border-radius:10px;border:1px solid var(--bt-line-2);background:var(--bt-bg,transparent);color:var(--bt-ink);font:inherit;font-size:14px}
.ox-input:focus{outline:2px solid color-mix(in srgb,var(--bt-accent) 55%,transparent);outline-offset:1px}
.ox-code{font:600 34px/1.1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.12em;color:var(--bt-ink);user-select:all}
.ox-wait{display:inline-flex;align-items:center;gap:8px;color:var(--bt-ink-2);font-size:12.5px}
.ox-problem{margin:0;color:var(--oc-bad,#c0392b);font-size:13px}
.ox-qr{flex:none;display:flex;flex-direction:column;align-items:center;gap:8px;padding:10px;border-radius:12px;background:#fff}
.ox-qr .ox-muted{color:#555;font-size:11.5px}
.ox-sub{margin:4px 0 0;font-size:11.5px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--bt-ink-2)}
.ox-found{display:flex;flex-direction:column;gap:8px;margin:0;padding:0;list-style:none}
.ox-found-row{display:flex;align-items:center;gap:12px;padding:10px 12px;border:1px solid var(--bt-line);border-radius:12px;background:var(--bt-bg,transparent)}
.ox-found-dot{flex:none;width:9px;height:9px;border-radius:50%;background:var(--bt-accent);box-shadow:0 0 0 4px color-mix(in srgb,var(--bt-accent) 18%,transparent)}
.ox-found-text{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}
.ox-found-text strong{font-size:14px;font-weight:600;overflow-wrap:anywhere}
.ox-hint,.ox-note{font-size:12.5px}
.ox-done{align-items:center;gap:12px}
.ox-check{display:inline-grid;place-items:center;width:28px;height:28px;border-radius:50%;background:var(--bt-accent);color:#fff;font-weight:700}
@media (max-width:720px){.ox-card{flex-direction:column}.ox-qr{align-self:center}}
`;

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
function skippedHere(storage = localStore()) {
  try {
    return storage?.getItem(SKIPPED_KEY) === "1";
  } catch {
    return false;
  }
}
function keepSkipHere(storage = localStore()) {
  try {
    storage?.setItem(SKIPPED_KEY, "1");
  } catch {
  }
}
var isConnected = (link) => link?.linked === true || link?.configured === true;
async function gateConnect({ explicit, complete }, { request, omniAi = callOmniAi, storage = localStore() } = {}) {
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
  let skipped = skippedHere(storage);
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
async function skipConnect({ complete }, { omniAi = callOmniAi, storage = localStore() } = {}) {
  try {
    await omniAi("done", { stepId: CONNECT_STEP.id });
  } catch {
    keepSkipHere(storage);
  }
  complete();
}

// src/client/connect-step.js
var import_react5 = require("react");
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
var PAIRED_BEAT_MS = 1600;
var reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
var OCTOPUS = CHARACTERS.octopus;
var OCTOPUS_SVG = `<svg class="oxs-octo" viewBox="0 0 100 100" aria-hidden="true">
<defs><linearGradient id="oxs-octo-skin" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8ff4ff"/><stop offset=".5" stop-color="#22d3ee"/><stop offset="1" stop-color="#0e7490"/></linearGradient></defs>
<path class="oxs-ghost oxs-cyan" d="${OCTOPUS.body}"/><path class="oxs-ghost oxs-magenta" d="${OCTOPUS.body}"/>
<path d="${OCTOPUS.body}" fill="url(#oxs-octo-skin)"/><path d="${OCTOPUS.shade}" fill="#0b4f6c" opacity=".55"/>
<path d="${OCTOPUS.light}" fill="#fff" opacity=".45"/>
<g class="oxs-eyes">${OCTOPUS.eyes.map(([cx, cy, width, height]) => `<ellipse cx="${cx}" cy="${cy}" rx="${width}" ry="${height}" fill="#06121f"/><circle cx="${cx + 2}" cy="${cy - 5}" r="2.4" fill="#fff"/>`).join("")}</g>
<path d="M44 54Q50 59 56 54" stroke="#06121f" stroke-width="2.4" fill="none" stroke-linecap="round"/>
<ellipse cx="31" cy="50" rx="5" ry="2.8" fill="#ff5fb8" opacity=".5"/><ellipse cx="69" cy="50" rx="5" ry="2.8" fill="#ff5fb8" opacity=".5"/>
</svg>`;
function useGlitch() {
  const [on, setOn] = (0, import_react5.useState)(false);
  const timer = (0, import_react5.useRef)(0);
  (0, import_react5.useEffect)(() => () => clearTimeout(timer.current), []);
  const glitch = (0, import_react5.useCallback)(() => {
    if (reducedMotion()) return;
    setOn(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOn(false), 900);
  }, []);
  return [on, glitch];
}
function useTypewriter(text) {
  const [shown, setShown] = (0, import_react5.useState)(() => reducedMotion() ? text : "");
  (0, import_react5.useEffect)(() => {
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
function Stage({ title, speech, glitching, children }) {
  const titleRef = (0, import_react5.useRef)(null);
  (0, import_react5.useEffect)(() => {
    const root = document.getElementById("root");
    if (root === null) return void 0;
    const previous = root.inert;
    root.inert = true;
    return () => {
      root.inert = previous;
    };
  }, []);
  (0, import_react5.useEffect)(() => {
    titleRef.current?.focus();
  }, [title]);
  const shown = useTypewriter(speech);
  return (0, import_react_dom.createPortal)((0, import_react5.createElement)(
    "div",
    { className: "oxs-overlay", role: "dialog", "aria-modal": "true", "aria-labelledby": "oxs-title" },
    (0, import_react5.createElement)(
      "div",
      { className: `oxs-stage${glitching ? " oxs-glitch" : ""}` },
      (0, import_react5.createElement)("div", { dangerouslySetInnerHTML: { __html: OCTOPUS_SVG } }),
      (0, import_react5.createElement)(
        "div",
        { className: "oxs-bubble" },
        (0, import_react5.createElement)("span", { className: "oxs-hidden", role: "status" }, speech),
        (0, import_react5.createElement)("span", { "aria-hidden": "true" }, shown, shown.length < speech.length ? (0, import_react5.createElement)("span", { className: "oxs-caret" }) : null)
      ),
      (0, import_react5.createElement)("ol", { className: "oxs-rail", "aria-label": t("Setup steps") }, railSteps().map(([id, label], index, steps) => {
        const at = steps.findIndex(([step]) => step === CONNECT_STEP.id);
        return (0, import_react5.createElement)("li", {
          key: id,
          className: index < at ? "oxs-done" : index === at ? "oxs-on" : "",
          "aria-current": index === at ? "step" : void 0
        }, t(label));
      })),
      (0, import_react5.createElement)(
        "main",
        { className: "oxs-card" },
        (0, import_react5.createElement)("div", { className: "oxs-mark", "aria-hidden": "true" }, "OMNI"),
        (0, import_react5.createElement)("h1", { id: "oxs-title", ref: titleRef, tabIndex: -1 }, title),
        children
      )
    )
  ), document.body);
}
function useGate(props) {
  const first = (0, import_react5.useRef)(props);
  const [state, setState] = (0, import_react5.useState)(void 0);
  (0, import_react5.useEffect)(() => {
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
  const [paired, setPaired] = (0, import_react5.useState)(null);
  const finished = (0, import_react5.useRef)(false);
  const timer = (0, import_react5.useRef)(0);
  (0, import_react5.useEffect)(() => () => clearTimeout(timer.current), []);
  (0, import_react5.useEffect)(() => {
    if (state) glitch();
  }, [state, glitch]);
  const complete = (0, import_react5.useCallback)(() => {
    if (finished.current) return;
    finished.current = true;
    clearTimeout(timer.current);
    props.complete();
  }, [props]);
  const skip = (0, import_react5.useCallback)(() => {
    if (finished.current) return;
    finished.current = true;
    void skipConnect({ complete: props.complete });
  }, [props]);
  const onPaired = (0, import_react5.useCallback)((origin) => {
    setPaired(origin);
    glitch();
    timer.current = setTimeout(complete, reducedMotion() ? 0 : PAIRED_BEAT_MS);
  }, [complete, glitch]);
  if (!state) return null;
  if (paired !== null) {
    return (0, import_react5.createElement)(
      Stage,
      { title: t("Omni connected"), speech: t("Connected to {origin}! Now I can see your channels.", { origin: paired }), glitching },
      (0, import_react5.createElement)("button", { type: "button", className: "oxs-primary", onClick: complete }, t("Continue"))
    );
  }
  if (isConnected(state.link)) {
    const origin = state.link.origin ?? "";
    return (0, import_react5.createElement)(
      Stage,
      { title: t("Omni connected"), speech: origin ? t("Connected to {origin}! Now I can see your channels.", { origin }) : t("Your Omni is connected. Now I can see your channels."), glitching },
      (0, import_react5.createElement)("button", { type: "button", className: "oxs-primary", onClick: complete }, t("Continue"))
    );
  }
  return (0, import_react5.createElement)(
    Stage,
    { title: t("Connect your Omni"), speech: t("Show me your Omni, so I can see your channels. Approve this device from your phone."), glitching },
    (0, import_react5.createElement)(ConnectOmni, { onPaired, embedded: true }),
    (0, import_react5.createElement)("button", { type: "button", className: "oxs-quiet", onClick: skip }, t("Skip for now"))
  );
}
var STAGE_CSS = `
.oxs-overlay{--oxs-bg:#05070f;--oxs-card:rgba(13,20,36,.8);--oxs-ink:#eef3ff;--oxs-ink2:#9fb0cc;--oxs-line:rgba(120,160,220,.22);--oxs-accent:#22d3ee;--oxs-accent-2:#ff3bd4;
  --bt-line:var(--oxs-line);--bt-line-2:rgba(120,160,220,.32);--bt-accent:var(--oxs-accent);--bt-accent-ink:#03141a;--bt-ink:var(--oxs-ink);--bt-ink-2:var(--oxs-ink2);--bt-surface:transparent;--bt-bg:rgba(0,0,0,.25);--bt-hover:rgba(255,255,255,.06);--oc-bad:#ff6b6b;
  position:fixed;inset:0;z-index:2000;overflow:auto;display:grid;place-items:center;padding:24px 16px;box-sizing:border-box;color-scheme:dark;color:var(--oxs-ink);
  font:15px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
  background:radial-gradient(1200px 600px at 50% -10%,rgba(34,211,238,.18),transparent 60%),radial-gradient(900px 500px at 100% 110%,rgba(255,59,212,.16),transparent 60%),var(--oxs-bg)}
.oxs-overlay *{box-sizing:border-box}
.oxs-overlay::before{content:"";position:fixed;inset:0;pointer-events:none;opacity:.55;
  background-image:radial-gradient(1px 1px at 12% 18%,#fff,transparent),radial-gradient(1px 1px at 72% 12%,#cde,transparent),radial-gradient(1.5px 1.5px at 38% 72%,#fff,transparent),radial-gradient(1px 1px at 86% 64%,#bcd,transparent),radial-gradient(1px 1px at 22% 88%,#fff,transparent),radial-gradient(1.5px 1.5px at 58% 40%,#def,transparent);
  animation:oxs-twinkle 6s ease-in-out infinite alternate}
.oxs-overlay::after{content:"";position:fixed;left:-50%;right:-50%;bottom:-30vh;height:60vh;pointer-events:none;opacity:.35;
  background-image:linear-gradient(rgba(34,211,238,.35) 1px,transparent 1px),linear-gradient(90deg,rgba(255,59,212,.22) 1px,transparent 1px);background-size:56px 56px;
  transform:perspective(420px) rotateX(62deg);mask-image:linear-gradient(to top,#000,transparent);animation:oxs-grid 9s linear infinite}
@keyframes oxs-twinkle{from{opacity:.35}to{opacity:.7}}
@keyframes oxs-grid{from{background-position:0 0}to{background-position:0 56px}}
.oxs-stage{position:relative;z-index:1;width:min(640px,100%);display:flex;flex-direction:column;align-items:center}
.oxs-octo{width:124px;height:124px;filter:drop-shadow(0 12px 30px rgba(34,211,238,.35));animation:oxs-float 4.5s ease-in-out infinite}
.oxs-ghost{opacity:0}.oxs-cyan{fill:#00f0ff}.oxs-magenta{fill:#ff2bd6}
.oxs-octo:hover .oxs-cyan,.oxs-glitch .oxs-cyan{opacity:.55;transform:translate(-2.5px,0);animation:oxs-glitch 2.4s steps(1) infinite}
.oxs-octo:hover .oxs-magenta,.oxs-glitch .oxs-magenta{opacity:.55;transform:translate(2.5px,0);animation:oxs-glitch 2.4s steps(1) infinite reverse}
.oxs-eyes{transform-origin:50px 36px;animation:oxs-blink 5s infinite}
@keyframes oxs-float{0%,100%{transform:translateY(0) rotate(-2deg)}50%{transform:translateY(-10px) rotate(2deg)}}
@keyframes oxs-blink{0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(.1)}}
@keyframes oxs-glitch{0%{clip-path:inset(0 0 70% 0)}25%{clip-path:inset(40% 0 30% 0)}50%{clip-path:inset(75% 0 0 0)}75%{clip-path:inset(10% 0 60% 0)}}
.oxs-bubble{position:relative;margin:6px 0 18px;padding:10px 16px;border-radius:14px;background:rgba(34,211,238,.12);border:1px solid rgba(34,211,238,.35);color:#d6f8ff;font:500 15px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;min-height:44px;max-width:100%}
.oxs-bubble::before{content:"";position:absolute;top:-7px;left:50%;width:12px;height:12px;border-left:inherit;border-top:inherit;transform:translateX(-50%) rotate(45deg);background:#0d2232}
.oxs-caret{display:inline-block;width:.55em;height:1.05em;margin-left:2px;vertical-align:-2px;background:var(--oxs-accent-2);animation:oxs-caret 1s steps(1) infinite}
@keyframes oxs-caret{50%{opacity:0}}
.oxs-hidden{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.oxs-rail{display:flex;flex-wrap:wrap;justify-content:center;gap:8px;margin:0 0 14px;padding:0;list-style:none;font:600 11px/1 ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase;color:var(--oxs-ink2)}
.oxs-rail li{padding:6px 10px;border-radius:999px;border:1px solid var(--oxs-line)}.oxs-rail li.oxs-on{color:#05070f;background:var(--oxs-accent);border-color:var(--oxs-accent)}.oxs-rail li.oxs-done{color:var(--oxs-accent);border-color:rgba(34,211,238,.5)}
.oxs-card{width:100%;background:var(--oxs-card);border:1px solid var(--oxs-line);border-radius:20px;padding:24px;backdrop-filter:blur(14px);box-shadow:0 30px 80px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,255,255,.04)}
.oxs-card h1{font-size:21px;margin:0 0 10px;letter-spacing:-.01em;outline:none}
.oxs-mark{font:700 12px/1 ui-monospace,monospace;letter-spacing:.32em;color:var(--oxs-accent);margin-bottom:14px}
.oxs-card .ox-card{margin:4px 0 8px;background:rgba(0,0,0,.2)}
.oxs-card .oc-primary,.oxs-card .oc-ghost{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:38px;padding:0 16px;border-radius:999px;font:inherit;font-size:14px;font-weight:600;cursor:pointer;white-space:nowrap;text-decoration:none}
.oxs-card .oc-primary{border:0;background:linear-gradient(135deg,var(--oxs-accent),var(--oxs-accent-2));color:#06060f}.oxs-card .oc-primary:disabled{opacity:.45;cursor:default}
.oxs-card .oc-ghost{border:1px solid var(--oxs-line);background:none;color:var(--oxs-ink2)}
.oxs-card .oc-spinner{width:14px;height:14px;border-radius:50%;border:2px solid rgba(34,211,238,.25);border-top-color:var(--oxs-accent);animation:oxs-spin .8s linear infinite;flex:none}
@keyframes oxs-spin{to{transform:rotate(360deg)}}
.oxs-card button.oxs-primary,.oxs-card button.oxs-quiet{display:block;width:100%;padding:12px 14px;margin:8px 0 0;border-radius:13px;font:inherit;font-weight:600;cursor:pointer;text-align:center}
.oxs-card button.oxs-primary{border:1px solid transparent;background:linear-gradient(135deg,var(--oxs-accent),var(--oxs-accent-2));color:#06060f}
.oxs-card button.oxs-quiet{border:1px solid transparent;background:none;color:var(--oxs-ink2);font-weight:500}
.oxs-card button:focus-visible,.oxs-card a:focus-visible,.oxs-card input:focus-visible{outline:2px solid var(--oxs-accent);outline-offset:2px}
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

// src/client/subscriptions.js
var import_react6 = require("react");
var { AtIcon, FileIcon, KeywordIcon, MessageIcon, ShieldIcon, UnplugIcon, VoiceIcon } = icons;
var TRIGGER_ICONS = { message: MessageIcon, mention: AtIcon, keyword: KeywordIcon, voice: VoiceIcon, media: FileIcon, down: UnplugIcon };
var FRESH_MS = 6e3;
var isEventsBot = (roster, id) => Boolean(roster?.eventsBotId) && roster.byId?.[id]?.id === roster.eventsBotId;
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
  if (info.session) return (0, import_react6.createElement)("span", { className: "os-session", style: { width: size, height: size } }, (0, import_react6.createElement)(OmniMark, { size: Math.round(size * 0.62) }));
  return (0, import_react6.createElement)(BotMark, info.bot ? { bot: info.bot, size } : { look: info.look, size });
}
var TriggerBadge = ({ trigger, size = 36 }) => (0, import_react6.createElement)(
  "span",
  { className: "os-trigger", "data-kind": trigger.kind, style: { width: size, height: size, fontSize: Math.round(size * 0.5), "--os-icon": `${Math.round(size * 0.52)}px` } },
  trigger.kind === "reaction" ? trigger.emoji : (0, import_react6.createElement)(TRIGGER_ICONS[trigger.kind])
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
var SourceMark = ({ source, size }) => source.kind === "channel" ? (0, import_react6.createElement)(Tile, { type: source.type, size }) : (0, import_react6.createElement)(ChatAvatar, { chat: { name: source.name, initials: initials(source.name) }, size });
function SourceStack({ sources, size = 16 }) {
  return (0, import_react6.createElement)(
    "span",
    { className: "os-stack" },
    sources.slice(0, 3).map((source) => (0, import_react6.createElement)("span", { key: `${source.kind}-${source.id}`, className: "os-stack-item" }, (0, import_react6.createElement)(SourceMark, { source, size }))),
    sources.length > 3 ? (0, import_react6.createElement)("span", { className: "os-stack-more" }, `+${sources.length - 3}`) : null
  );
}
function Sentence({ sub, roster }) {
  return (0, import_react6.createElement)(
    "p",
    { className: "os-sentence" },
    (0, import_react6.createElement)("span", { className: "os-w" }, t("When")),
    " ",
    (0, import_react6.createElement)("span", { className: "os-chip os-chip-trigger" }, sub.trigger.kind === "reaction" ? (0, import_react6.createElement)("b", { className: "os-emoji" }, sub.trigger.emoji) : null, triggerText(sub.trigger)),
    " ",
    (0, import_react6.createElement)("span", { className: "os-w" }, t("in")),
    " ",
    (0, import_react6.createElement)("span", { className: "os-chip" }, (0, import_react6.createElement)(SourceStack, { sources: sub.sources }), sourcesText(sub.sources)),
    " ",
    (0, import_react6.createElement)("span", { className: "os-w" }, "→"),
    " ",
    (0, import_react6.createElement)("span", { className: "os-chip os-chip-worker" }, (0, import_react6.createElement)(WorkerMark, { worker: sub.worker, roster, size: 18 }), workerOf(sub.worker, roster).name),
    sub.outputs.react ? (0, import_react6.createElement)(import_react6.Fragment, null, " ", (0, import_react6.createElement)("span", { className: "os-chip os-chip-soft" }, t("reacts 👀 then ✅"))) : null,
    sub.outputs.replyToMe ? (0, import_react6.createElement)(import_react6.Fragment, null, " ", (0, import_react6.createElement)("span", { className: "os-chip os-chip-soft" }, t("replies to you"))) : null
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
  return waiting > 0 ? (0, import_react6.createElement)("span", { className: "os-pending", title: t("{n} waiting for you", { n: waiting }) }, String(waiting)) : null;
}
function SubscriptionsButton({ roster, onToggle, useWork }) {
  const count = (roster.subscriptions ?? []).filter((sub) => sub.on).length;
  const waiting = waitingRuns(roster, useWaiting(useWork));
  return (0, import_react6.createElement)(
    "button",
    { type: "button", className: "os-head-btn", onClick: onToggle },
    t("Automations"),
    (0, import_react6.createElement)("span", { className: "os-head-count" }, String(count)),
    waiting > 0 ? (0, import_react6.createElement)("span", { className: "os-pending" }, String(waiting)) : null
  );
}
var BOARD_KIND = "omni-subscriptions";
var BOARD_TAB_ID = "ds-bot/omni-subscriptions";
var boardTabDefinition = () => ({ id: BOARD_TAB_ID, kind: BOARD_KIND, title: () => t("Automations") });
function BoardTab({ useRoster, useWork, actions }) {
  const roster = useRoster((value) => value);
  const waiting = useWaiting(useWork);
  const bot = roster.byId?.[roster.eventsBotId];
  if (!bot) return (0, import_react6.createElement)("div", { className: "os-board" }, (0, import_react6.createElement)("p", { className: "os-board-note" }, t("Automations belong to the Main Bot, which this team does not have.")));
  return (0, import_react6.createElement)(SubscriptionsBoard, { bot, roster, actions, waiting });
}
function SubscriptionsBoard({ bot, roster, actions, waiting }) {
  const omni2 = useOmni();
  (0, import_react6.useEffect)(() => {
    startLive(call);
  }, []);
  const subs = roster.subscriptions ?? [];
  const runs = runsOf(roster);
  const watched = new Set(subs.filter((sub) => sub.on).flatMap((sub) => sub.sources.map((source) => `${source.kind}:${source.id}`))).size;
  const listening = (roster.omniEvents?.listening ?? []).length > 0;
  return (0, import_react6.createElement)(
    "div",
    { className: "os-board" },
    subs.length === 0 ? (0, import_react6.createElement)(Empty, { bot, live: omni2.source.kind === "live" }) : (0, import_react6.createElement)(
      import_react6.Fragment,
      null,
      (0, import_react6.createElement)(
        "div",
        { className: "os-board-status" },
        (0, import_react6.createElement)("span", { className: "oc-live-dot", "data-on": listening || void 0, "aria-hidden": true }),
        !subs.some((sub) => sub.on) ? t("Everything is paused.") : `${watched === 1 ? t("Watching 1 chat or channel.") : t("Watching {n} chats and channels.", { n: watched })} ${listening ? t("Listening to omni.") : t("Connecting to omni…")}`
      ),
      subs.some((sub) => sub.on && (sub.outputs.react || sub.outputs.replyToMe)) ? (0, import_react6.createElement)("div", { className: "os-board-note os-board-pending" }, t("Reactions and replies to you are not sent yet. Results stay in the runs below.")) : null,
      (0, import_react6.createElement)("div", { className: "os-list" }, subs.map((sub) => (0, import_react6.createElement)(AutomationRow, { key: sub.id, sub, roster, runs: runs.filter((run) => run.subId === sub.id) }))),
      runs.length > 0 ? (0, import_react6.createElement)(
        import_react6.Fragment,
        null,
        (0, import_react6.createElement)("div", { className: "os-board-h" }, t("Runs")),
        (0, import_react6.createElement)("div", { className: "os-list" }, runs.slice(0, 20).map((run) => (0, import_react6.createElement)(RunRow, { key: run.id, run, sub: subs.find((sub) => sub.id === run.subId), roster, actions, asking: waiting?.has(run.sessionId) && run.status === "working" })))
      ) : null
    ),
    (0, import_react6.createElement)(
      "div",
      { className: "os-safety" },
      (0, import_react6.createElement)(ShieldIcon),
      (0, import_react6.createElement)("span", null, t("Anyone in a watched chat can write text that tries to steer a Bot. Work started by an event runs with no secrets and asks you before shell, file or network actions, unless you tell {name} otherwise.", { name: bot.name }))
    )
  );
}
function Empty({ bot, live }) {
  const examples = [
    t("Watch #ci-alerts for “failed” or “error” and hand it to Ops"),
    t("When I react 📌 to a message in any WhatsApp chat, save it to my notes"),
    t("Voice notes in my own chat go to one ongoing session")
  ];
  return (0, import_react6.createElement)(
    "div",
    { className: "os-empty-board" },
    (0, import_react6.createElement)(BotMark, { bot, size: 48, live: true }),
    (0, import_react6.createElement)("strong", null, t("Tell {name} what to watch", { name: bot.name })),
    (0, import_react6.createElement)("span", null, live ? t("Say it in the chat. {name} finds the chats, asks what is missing, and the subscription shows up here.", { name: bot.name }) : t("Omni is not connected to this DSH yet, so there is nothing to watch.")),
    (0, import_react6.createElement)("ul", { className: "os-examples" }, examples.map((text) => (0, import_react6.createElement)("li", { key: text }, text)))
  );
}
function AutomationRow({ sub, roster, runs, onOpen }) {
  const [confirming, setConfirming] = (0, import_react6.useState)(false);
  const [busy, setBusy] = (0, import_react6.useState)("");
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
  return (0, import_react6.createElement)(
    "div",
    { className: "os-row", "data-off": sub.on ? void 0 : true, "data-fresh": fresh || void 0 },
    (0, import_react6.createElement)(TriggerBadge, { trigger: sub.trigger, size: 28 }),
    (0, import_react6.createElement)(
      "div",
      { className: "os-row-body" },
      (0, import_react6.createElement)(
        "div",
        { className: "os-row-top" },
        onOpen ? (0, import_react6.createElement)("button", { type: "button", className: "os-row-name os-row-open", onClick: onOpen }, sub.name) : (0, import_react6.createElement)("span", { className: "os-row-name" }, sub.name),
        (0, import_react6.createElement)("button", {
          type: "button",
          role: "switch",
          "aria-checked": sub.on,
          className: "os-switch",
          disabled: busy !== "",
          "aria-label": sub.on ? t("Pause {name}", { name: sub.name }) : t("Resume {name}", { name: sub.name }),
          onClick: () => run("automation-set-on", { id: sub.id, on: !sub.on })
        }, (0, import_react6.createElement)("span"))
      ),
      (0, import_react6.createElement)(Sentence, { sub, roster }),
      (0, import_react6.createElement)(
        "div",
        { className: "os-row-foot" },
        (0, import_react6.createElement)("span", null, last ? t("last run {time}", { time: relativeShort(last.at) }) : t("not fired yet")),
        sub.askFirst ? null : (0, import_react6.createElement)("span", { className: "os-row-warn" }, t("acts without asking")),
        (0, import_react6.createElement)(
          "span",
          { className: "os-row-actions" },
          (0, import_react6.createElement)("button", { type: "button", className: "os-link", disabled: busy !== "", onClick: () => run("automation-test", { id: sub.id }) }, t("Test")),
          (0, import_react6.createElement)("button", {
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
  return (0, import_react6.createElement)(
    "button",
    { type: "button", className: "os-run", "data-tone": status.tone, disabled: !open, onClick: open, title: open ? t("Open this run") : void 0 },
    (0, import_react6.createElement)(WorkerMark, { worker: sub.worker, roster, size: 22 }),
    (0, import_react6.createElement)(
      "span",
      { className: "os-run-body" },
      (0, import_react6.createElement)(
        "span",
        { className: "os-run-top" },
        (0, import_react6.createElement)("span", { className: "os-run-name" }, workerOf(sub.worker, roster).name),
        (0, import_react6.createElement)("span", { className: "os-run-status" }, run.test ? `${t("Test")} · ${t(status.label)}` : t(status.label)),
        (0, import_react6.createElement)("time", null, relativeShort(run.at))
      ),
      run.excerpt && !run.test ? (0, import_react6.createElement)("span", { className: "os-run-quote" }, run.from ? `${run.from}: ` : "", run.excerpt) : null,
      (0, import_react6.createElement)("span", { className: "os-run-text" }, run.summary)
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
    const at = new Date(task.scheduledAt);
    return t("Once, {date} {time}", { date: at.toLocaleDateString([], { month: "short", day: "numeric" }), time: `${pad(at.getHours())}:${pad(at.getMinutes())}` });
  }
  return t("Once");
}

// src/client/automations-page.js
var import_react7 = require("react");
var { ClockIcon, PlusIcon: PlusIcon2, SearchIcon } = icons;
var AUTOMATIONS_PANEL = "omni-automations";
function AutomationsPage({ useRoster, actions }) {
  const roster = useRoster((value) => value);
  const [filter, setFilter] = (0, import_react7.useState)("all");
  const [query, setQuery] = (0, import_react7.useState)("");
  const [schedules, setSchedules] = (0, import_react7.useState)({ available: false, tasks: [] });
  (0, import_react7.useEffect)(() => {
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
  const rows = (0, import_react7.useMemo)(() => {
    const list = [
      ...events.map((sub) => ({ kind: "event", id: sub.id, on: sub.on, title: sub.name, sort: sub.createdAt, sub })),
      ...schedules.tasks.map((task) => ({ kind: "schedule", id: `${task.sessionId}:${task.id}`, on: task.status === "active", title: task.title, sort: Date.parse(task.scheduledAt) || 0, task }))
    ];
    return list.filter((row) => filter === "all" || (filter === "enabled" ? row.on : !row.on)).filter((row) => needle === "" || row.title.toLowerCase().includes(needle) || (row.task?.prompt ?? "").toLowerCase().includes(needle));
  }, [events, schedules, filter, needle]);
  const talk = () => {
    if (autopilot) actions.openSession(autopilot.id);
  };
  return (0, import_react7.createElement)(
    "div",
    { className: "oa-page" },
    (0, import_react7.createElement)(
      "div",
      { className: "oa-in" },
      (0, import_react7.createElement)(
        "header",
        { className: "oa-head" },
        (0, import_react7.createElement)("h1", null, t("Automations")),
        (0, import_react7.createElement)("button", { type: "button", className: "oa-new", disabled: !autopilot, onClick: talk, title: autopilot ? t("Tell {name} what to automate", { name: autopilot.name }) : void 0 }, (0, import_react7.createElement)(PlusIcon2), t("New"))
      ),
      (0, import_react7.createElement)("p", { className: "oa-lede" }, autopilot ? t("Things that run on their own: when something happens in your chats, or on a schedule. Say what you want to {name}; it sets it up and it shows here.", { name: autopilot.name }) : t("Things that run on their own, on a schedule or when something happens in your chats.")),
      (0, import_react7.createElement)(
        "div",
        { className: "oa-filters", role: "radiogroup", "aria-label": t("Show") },
        [["all", t("All")], ["enabled", t("Enabled")], ["inactive", t("Inactive")]].map(([value, label]) => (0, import_react7.createElement)("button", {
          key: value,
          type: "button",
          role: "radio",
          "aria-checked": filter === value,
          onClick: () => setFilter(value)
        }, label))
      ),
      (0, import_react7.createElement)("label", { className: "oa-search" }, (0, import_react7.createElement)(SearchIcon), (0, import_react7.createElement)("input", { value: query, placeholder: t("Search automations"), "aria-label": t("Search automations"), onChange: (event) => setQuery(event.target.value) })),
      rows.length === 0 ? (0, import_react7.createElement)(
        "div",
        { className: "oa-empty" },
        (0, import_react7.createElement)(ClockIcon),
        (0, import_react7.createElement)("span", null, events.length + schedules.tasks.length === 0 ? t("Nothing runs on its own yet.") : t("No automations match.")),
        autopilot ? (0, import_react7.createElement)("button", { type: "button", className: "oa-empty-go", onClick: talk }, t("Tell {name} what to automate", { name: autopilot.name })) : null
      ) : (0, import_react7.createElement)("div", { className: "oa-list" }, rows.map((row) => row.kind === "event" ? (0, import_react7.createElement)(AutomationRow, { key: row.id, sub: row.sub, roster, runs: runs.filter((run) => run.subId === row.id), onOpen: talk }) : (0, import_react7.createElement)(ScheduleRow, { key: row.id, task: row.task, roster, actions })))
    )
  );
}
function ScheduleRow({ task, roster, actions }) {
  const owner = roster.byId?.[task.botId];
  const room = roster.roomsById?.[task.roomId];
  const active = task.status === "active";
  return (0, import_react7.createElement)(
    "button",
    { type: "button", className: "os-row oa-schedule", "data-off": active ? void 0 : true, onClick: () => actions.selectPanel("schedules"), title: t("Edit the timing in Automation tasks") },
    (0, import_react7.createElement)("span", { className: "os-trigger", "data-kind": "schedule", style: { width: 28, height: 28, "--os-icon": "15px" } }, (0, import_react7.createElement)(ClockIcon)),
    (0, import_react7.createElement)(
      "span",
      { className: "os-row-body" },
      (0, import_react7.createElement)(
        "span",
        { className: "os-row-top" },
        (0, import_react7.createElement)("span", { className: "os-row-name" }, task.title),
        (0, import_react7.createElement)("span", { className: "oa-tag" }, active ? t("Scheduled") : t("Inactive"))
      ),
      (0, import_react7.createElement)(
        "span",
        { className: "os-sentence" },
        (0, import_react7.createElement)("span", { className: "os-chip" }, whenText(task)),
        (0, import_react7.createElement)("span", { className: "os-w" }, "→"),
        (0, import_react7.createElement)("span", { className: "os-chip" }, owner ? (0, import_react7.createElement)(import_react7.Fragment, null, (0, import_react7.createElement)(BotMark, { bot: owner, size: 16 }), owner.name) : room?.name ?? t("a chat"))
      ),
      (0, import_react7.createElement)(
        "span",
        { className: "os-row-foot" },
        (0, import_react7.createElement)("span", null, active && task.scheduledAt ? t("next run {time}", { time: new Date(task.scheduledAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) }) : task.lastDelivery ? t("last run {time}", { time: relativeShort(Date.parse(task.lastDelivery.deliveredAt ?? task.lastDelivery) || Date.now()) }) : t("not run yet"))
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

// src/client/permissions.js
var import_react8 = require("react");
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
  if (entry.resource?.type === "call") lines.push((0, import_react8.createElement)("code", { key: "op", className: "om-perm-op" }, `${preview.method ?? ""} ${preview.path ?? ""}${preview.query ? ` ?${preview.query}` : ""}`.trim()));
  if (preview.channel) lines.push((0, import_react8.createElement)("div", { key: "channel", className: "om-perm-to" }, t("From {channel}", { channel: preview.channel })));
  if (preview.to) lines.push((0, import_react8.createElement)("div", { key: "to", className: "om-perm-to" }, t("To {to}", { to: preview.to })));
  if (preview.emoji) lines.push((0, import_react8.createElement)("div", { key: "emoji", className: "om-perm-emoji" }, preview.emoji));
  if (preview.text) lines.push((0, import_react8.createElement)("blockquote", { key: "text", className: "om-perm-text" }, preview.text));
  if (preview.body) lines.push((0, import_react8.createElement)("pre", { key: "body", className: "om-perm-body" }, preview.body));
  return lines.length === 0 ? null : (0, import_react8.createElement)("div", { className: "om-perm-preview" }, lines);
}
function ConsentCard({ bot, entry }) {
  const [busy, setBusy] = (0, import_react8.useState)("");
  const [error, setError] = (0, import_react8.useState)("");
  const answer = (choice) => {
    if (busy) return;
    setBusy(choice);
    setError("");
    Promise.resolve(call("omni-consent-answer", { id: entry.id, answer: choice })).catch((failure) => setError(failure?.message ?? String(failure))).finally(() => setBusy(""));
  };
  const running = entry.status === "running";
  const confirm = entry.kind === "confirm";
  const button = (choice, label, primary = false) => (0, import_react8.createElement)("button", {
    type: "button",
    className: primary ? "bt-q-submit" : "bt-q-btn",
    disabled: Boolean(busy) || running,
    onClick: () => answer(choice)
  }, busy === choice ? "…" : label);
  return (0, import_react8.createElement)(
    "div",
    { className: "bt-q om-perm", role: "group", "aria-label": askTitle(bot, entry), "data-kind": entry.kind },
    (0, import_react8.createElement)(
      "div",
      { className: "bt-q-head" },
      (0, import_react8.createElement)("span", { className: "om-perm-who" }, (0, import_react8.createElement)(BotMark, { bot, size: 28 })),
      (0, import_react8.createElement)(
        "div",
        { className: "bt-q-text" },
        (0, import_react8.createElement)("p", { className: "bt-q-title" }, askTitle(bot, entry)),
        (0, import_react8.createElement)("div", { className: "bt-q-detail" }, reachText(entry))
      )
    ),
    (0, import_react8.createElement)(Preview, { entry }),
    error ? (0, import_react8.createElement)("div", { className: "om-perm-error", role: "alert" }, error) : null,
    (0, import_react8.createElement)(
      "div",
      { className: "bt-q-foot" },
      running ? (0, import_react8.createElement)("span", { className: "om-perm-running" }, t("Running…")) : null,
      confirm ? [(0, import_react8.createElement)("span", { key: "deny" }, button("deny", t("Cancel"))), (0, import_react8.createElement)("span", { key: "once" }, button("once", t(CONFIRM_LABEL[entry.action] ?? "Allow"), true))] : [
        (0, import_react8.createElement)("span", { key: "deny" }, button("deny", t("No"))),
        (0, import_react8.createElement)("span", { key: "once" }, button("once", t("Once"))),
        entry.resource?.channelId && entry.resource.channelName ? (0, import_react8.createElement)("span", { key: "channel" }, button("channel", t("Always, all of {channel}", { channel: entry.resource.channelName }))) : null,
        (0, import_react8.createElement)("span", { key: "always" }, button("always", t("Always"), true))
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
  return (0, import_react8.createElement)(
    "div",
    { className: "bt-event om-perm-done", "data-status": entry.status },
    (0, import_react8.createElement)(BotMark, { bot, size: 16 }),
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
      if (props.done && /^(consent|confirmation)_required:/.test(props.content ?? "")) return (0, import_react8.createElement)("div", { className: "bt-event" }, t("Asked you for permission in its chat"));
      return render ? render(props) : null;
    }
    return (0, import_react8.createElement)("div", { className: "bt-q-inline" }, entry.status === "pending" || entry.status === "running" ? (0, import_react8.createElement)(ConsentCard, { bot, entry }) : (0, import_react8.createElement)(Settled, { bot, entry }));
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
  return (0, import_react8.createElement)("div", { className: "bt-q-dock om-perm-dock" }, waiting.map((entry) => (0, import_react8.createElement)(ConsentCard, { key: entry.id, bot, entry })));
}
var ACTION_TEXT = { read: "read", media: "files", send: "send", react: "react", delete: "delete" };
function PermissionsCard({ bot, roster, run, Card, SwitchRow }) {
  if (!roster.omniGrants) return null;
  const main = (roster.mainBotIds ?? []).includes(bot.id);
  const grants = (roster.omniGrants ?? []).filter((grant) => grant.botId === bot.id);
  const now = Date.now();
  if (main) {
    return (0, import_react8.createElement)(
      Card,
      { title: t("On Omni") },
      (0, import_react8.createElement)("div", { className: "bt-set-row bt-bs-row" }, (0, import_react8.createElement)(
        "span",
        { className: "bt-set-copy" },
        (0, import_react8.createElement)("span", { className: "bt-bs-label" }, t("All of Omni")),
        (0, import_react8.createElement)("span", { className: "bt-set-hint" }, t("A Main Bot operates Omni. Messaging a person, deleting and disconnecting still ask you first."))
      ))
    );
  }
  return (0, import_react8.createElement)(
    Card,
    { title: t("On Omni") },
    grants.length === 0 ? (0, import_react8.createElement)("div", { className: "bt-set-row bt-bs-row" }, (0, import_react8.createElement)(
      "span",
      { className: "bt-set-copy" },
      (0, import_react8.createElement)("span", { className: "bt-bs-label" }, t("Nothing yet")),
      (0, import_react8.createElement)("span", { className: "bt-set-hint" }, t("When {bot} needs a chat, it asks you there, on a card.", { bot: bot.name }))
    )) : grants.map((grant) => (0, import_react8.createElement)(
      "div",
      { key: grant.id, className: "om-grant" },
      (0, import_react8.createElement)(SwitchRow, {
        label: `${grant.resource?.name ?? t("a chat")} · ${grant.actions.map((action) => t(ACTION_TEXT[action] ?? action)).join(", ")}`,
        hint: [kindText(grant.resource), typeof grant.expiresAt === "number" && grant.expiresAt <= now ? t("expired") : "", t("Ask each time")].filter(Boolean).join(" · "),
        on: grant.approval === "confirm",
        onChange: (on) => run(call("omni-grant-approval", { id: grant.id, approval: on ? "confirm" : "auto" }))
      }),
      (0, import_react8.createElement)("button", { type: "button", className: "bt-soft bt-soft-sm om-grant-revoke", onClick: () => run(call("omni-grant-revoke", { id: grant.id })) }, t("Revoke"))
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
  "Anyone in a watched chat can write text that tries to steer a Bot. Work started by an event runs with no secrets and asks you before shell, file or network actions, unless you tell {name} otherwise.": "被关注聊天中的任何人都可能写下试图操控 Bot 的文字。由事件触发的工作不带任何密钥运行，执行命令、文件或网络操作前会先问你，除非你告诉 {name} 不必询问。",
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
  "Automations": "自动化",
  "you react": "你回应",
  "You react with": "你回应",
  "Any new message": "任何新消息",
  "Someone mentions you": "有人提到你",
  "A message contains": "消息包含",
  "A voice note arrives": "收到语音消息",
  "A photo or file arrives": "收到照片或文件",
  "The channel disconnects": "渠道断开",
  "Needs you": "需要你",
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
  "Type your Omni's address, or paste the link it sent you. Then approve with Face ID, Touch ID, your fingerprint or a code on WhatsApp. No keys to copy.": "输入你的 Omni 的地址，或粘贴它发给你的链接。然后用面容 ID、触控 ID、指纹或 WhatsApp 验证码批准。无需复制任何密钥。",
  "We found": "我们找到了",
  "Connect another Omni": "连接另一个 Omni",
  "Your sandboxed Omni on this computer": "这台电脑上你的沙盒 Omni",
  "An Omni running on this computer": "这台电脑上正在运行的 Omni",
  "{name} on this computer": "这台电脑上的 {name}",
  "Omni on this computer": "这台电脑上的 Omni",
  "from your Omni CLI": "来自你的 Omni CLI",
  "from your Omni CLI as {name}": "来自你的 Omni CLI，名为 {name}",
  "answering on port {port}": "在端口 {port} 上响应",
  "Not answering right now.": "目前没有响应。",
  "Use it": "使用它",
  "Omni {version} on this computer is too old to pair. Update it to connect.": "这台电脑上的 Omni {version} 版本太旧，无法配对。请更新后再连接。",
  "Sign-in from devices is off on this Omni.": "这个 Omni 已关闭设备登录。",
  "or paste the link your Omni sent you": "或粘贴你的 Omni 发给你的链接",
  "Link from your Omni": "来自你的 Omni 的链接",
  "That is not a link your Omni sends. It looks like https://your-omni/api/login/app?grant=…": "这不是你的 Omni 发送的链接。它看起来像 https://your-omni/api/login/app?grant=…",
  "Text connect to yourself on WhatsApp and your Omni sends you the link.": "在 WhatsApp 上给自己发送 connect，你的 Omni 就会把链接发给你。",
  "Run Omni on this computer": "在这台电脑上运行 Omni",
  "Starting…": "正在启动…",
  "Omni address": "Omni 地址",
  "Get a code": "获取验证码",
  "Setup steps": "设置步骤",
  "Welcome": "欢迎",
  "Connect Omni": "连接 Omni",
  "Connect AI": "连接 AI",
  "Omni connected": "Omni 已连接",
  "Connected to {origin}! Now I can see your channels.": "已连接到 {origin}！现在我能看到你的渠道了。",
  "Your Omni is connected. Now I can see your channels.": "你的 Omni 已连接。现在我能看到你的渠道了。",
  "Show me your Omni, so I can see your channels. Approve this device from your phone.": "告诉我你的 Omni 在哪里，这样我就能看到你的渠道。用手机批准此设备。",
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
  "Continue": "继续",
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
  "Anyone in a watched chat can write text that tries to steer the Bot. It runs with no secrets, and asks you first before shell, file or network actions.": "被订阅聊天中的任何人都可能写下试图操控 Bot 的文字。它运行时不带任何密钥，执行命令、文件或网络操作前会先问你。",
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
  "Waiting for you": "等待你处理",
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
  "Interrupted by a restart": "因重启而中断"
};

// src/client/index.js
var import_react9 = require("react");
var { ClockIcon: ClockIcon2 } = icons;
var inject = ["slots"];
var channels = Object.freeze({ Badge, KeyValue, LiveChannel, LiveChat, LiveQr, Table });
var BOARD_OPENED = "omni.board.opened";
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
  const roster = face().hooks.roster;
  const fiber = ctx.inject(["sidebarRight", "sidebarRightTabs"], (scope) => {
    scope.effect(() => scope.sidebarRightTabs.register(boardTabDefinition()), "ds-bot: subscriptions tab type");
    scope.effect(() => ctx.slots.inject("sidebar.right.pane.tab", () => ctx.slots.register({ name: "sidebar.right.pane.tab", key: BOARD_TAB_ID, inject: face }, BoardTab)), "ds-bot: subscriptions tab");
    scope.effect(() => {
      const right = scope.sidebarRight;
      boardRight = right;
      let opened;
      try {
        opened = new Set(JSON.parse(localStorage.getItem(BOARD_OPENED) ?? "[]"));
      } catch {
        opened = /* @__PURE__ */ new Set();
      }
      const check = () => {
        const id = right.mounted.getSnapshot();
        if (!id || opened.has(id) || !isEventsBot(roster.getSnapshot(), id)) return;
        opened.add(id);
        try {
          localStorage.setItem(BOARD_OPENED, JSON.stringify([...opened]));
        } catch {
        }
        queueMicrotask(() => {
          try {
            right.openTab(BOARD_KIND);
          } catch (error) {
            console.warn("[ds-bot] board", error);
          }
        });
      };
      const offs = [right.mounted.subscribe(check), roster.subscribe(check)];
      check();
      return () => {
        boardRight = null;
        for (const off of offs) off();
      };
    }, "ds-bot: open the automations board");
  });
  return () => fiber.dispose();
}
var PHRASES = {
  omni_channels: () => ({ label: t("Checking your channels"), state: "searching" }),
  omni_chats: () => ({ label: t("Reading your chats"), state: "searching" }),
  omni_messages: () => ({ label: t("Reading your chats"), state: "searching" }),
  find_chats: () => ({ label: t("Reading your chats"), state: "searching" }),
  omni_endpoints: () => ({ label: t("Looking up omni"), state: "searching" }),
  omni_call: (arg) => arg("method") === "GET" || arg("method") === void 0 ? { label: t("Reading omni"), state: "searching" } : { label: t("Changing omni"), state: "working" },
  omni_connect: () => ({ label: t("Connecting a channel"), state: "working" }),
  omni_send: () => ({ label: t("Sending a message"), state: "working" }),
  omni_react: () => ({ label: t("Reacting"), state: "working" }),
  omni_media: () => ({ label: t("Opening a file"), state: "working" }),
  omni_delete: () => ({ label: t("Deleting a message"), state: "working" })
};
var callCard = ({ arg, content, done }) => (0, import_react9.createElement)(OmniCallCard, { ...parseCall(arg, content), done });
var toolCard = ({ tool, arg, content, done }) => (0, import_react9.createElement)(OmniToolCard, { tool, arg, content, done });
function apply(ctx) {
  ctx.effect(() => addStrings(STRINGS), "ds-bot: channels copy");
  registerConnectStep(ctx);
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
  ctx.effect(() => badges.register({ id: "omni-events", Component: ({ bot, roster, useWork }) => bot.id === roster.eventsBotId ? (0, import_react9.createElement)(EventsBadge, { roster, useWork }) : null }), "ds-bot: automations badge");
  ctx.effect(() => headerButtons.register({
    id: "omni-board",
    Component: ({ bot, roster, actions, useWork }) => bot.id === roster.eventsBotId ? (0, import_react9.createElement)(SubscriptionsButton, { roster, useWork, onToggle: () => toggleBoard(actions.reportError) }) : null
  }), "ds-bot: automations button");
  ctx.effect(() => nav.register({ id: "automations", label: () => t("Automations"), icon: ClockIcon2, run: (actions) => actions.selectPanel(AUTOMATIONS_PANEL) }), "ds-bot: automations nav");
  ctx.effect(() => onShell(({ face, shadow, installCompiledStyles }) => [
    () => installCompiledStyles(CHANNELS_CSS + SUBSCRIPTIONS_CSS + AUTOMATIONS_CSS + OMNI_LIVE_CSS + OMNI_PEEK_CSS + OMNI_CONNECT_CSS + PERMISSIONS_CSS, "channels"),
    () => shadow("conversation.input.dock", { id: "omni-consent", order: -80, inject: face }, ConsentDock),
    () => shadow("sidebar.footer.action", { id: "bot-connect", order: -100, inject: face }, ChannelsFooter),
    () => shadow("main", { key: CHANNELS_PANEL, inject: face }, ChannelsPage),
    () => shadow("main", { key: CHAT_PANEL, inject: face }, ChatPage),
    () => shadow("main", { key: AUTOMATIONS_PANEL, inject: face }, AutomationsPage),
    () => installBoard(ctx, face)
  ]), "ds-bot: channels on the Bot surface");
}
return Object.defineProperty({ ...module.exports }, Symbol.toStringTag, { value: 'Module' })
  },
})
