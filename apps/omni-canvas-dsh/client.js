// Generated from src/client by `npm run build` (scripts/build-client.mjs). Do not edit by hand.
window.__ModuleLoader__.load({
  id: '@automagik/omni-canvas-dsh',
  factory: (require) => {
const module = { exports: {} }
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// node_modules/@openuidev/devtools/dist/index.mjs
var dist_exports = {};
__export(dist_exports, {
  OpenUIDevtools: () => OpenUIDevtools
});
function normalizeCdnVersion(version2) {
  const trimmed = version2?.trim();
  if (!trimmed) return "latest";
  return VERSION_RE.test(trimmed) ? trimmed : null;
}
function browserBundleUrl(version2) {
  const tag = normalizeCdnVersion(version2);
  if (tag === null) return null;
  const url2 = `https://cdn.jsdelivr.net/npm/@openuidev/devtools@${tag}/dist/devtools.browser.js`;
  if (/^\d+\.\d+\.\d+$/.test(tag)) return url2;
  return `${url2}?t=${Math.floor(Date.now() / ALIAS_CACHE_MS)}`;
}
function mountOpenUIDevtoolsFromCdn(opts = {}) {
  const { version: version2, enabled, ...widgetProps } = opts;
  if (!(enabled ?? (typeof process === "undefined" || true)) || typeof document === "undefined") return () => {
  };
  const url2 = browserBundleUrl(version2);
  if (url2 === null) {
    console.warn(`[@openuidev/devtools] invalid version "${version2?.trim()}" — use a major ("0"), minor ("0.1"), or exact ("0.1.0") pin. Widget not mounted.`);
    return () => {
    };
  }
  let cancelled = false;
  let unmount = () => {
    cancelled = true;
  };
  Promise.all([
    import(
      /* webpackIgnore: true */
      /* @vite-ignore */
      url2
    ),
    import("react"),
    import("react-dom"),
    import("react-dom/client")
  ]).then(([devtools, react, reactDom, reactDomClient]) => {
    if (cancelled) return;
    const attach = () => {
      if (cancelled) return;
      unmount = devtools.mountOpenUIDevtools({
        React: react,
        ReactDOM: reactDom,
        ReactDOMClient: reactDomClient,
        loadReactLang: () => Promise.resolve().then(() => (init_dist4(), dist_exports2)),
        props: {
          ...widgetProps,
          enabled
        }
      });
    };
    if (document.body) attach();
    else document.addEventListener("DOMContentLoaded", attach, { once: true });
  }).catch(() => {
  });
  return () => unmount();
}
function OpenUIDevtools(props) {
  const { enabled, position, maxEvents, errorsOnly, autoOpenOnError, theme, version: version2, __autoMounted } = props;
  (0, import_react.useEffect)(() => {
    return mountOpenUIDevtoolsFromCdn({
      enabled,
      position,
      maxEvents,
      errorsOnly,
      autoOpenOnError,
      theme,
      version: version2,
      __autoMounted
    });
  }, [
    enabled,
    position,
    maxEvents,
    errorsOnly,
    autoOpenOnError,
    theme,
    version2,
    __autoMounted
  ]);
  return null;
}
var import_react, VERSION_RE, ALIAS_CACHE_MS;
var init_dist = __esm({
  "node_modules/@openuidev/devtools/dist/index.mjs"() {
    "use client";
    import_react = require("react");
    VERSION_RE = /^\d+(\.\d+){0,2}$/;
    ALIAS_CACHE_MS = 300 * 1e3;
  }
});

// node_modules/ci-info/vendors.json
var require_vendors = __commonJS({
  "node_modules/ci-info/vendors.json"(exports, module2) {
    module2.exports = [
      {
        name: "Agola CI",
        constant: "AGOLA",
        env: "AGOLA_GIT_REF",
        pr: "AGOLA_PULL_REQUEST_ID"
      },
      {
        name: "Alpic",
        constant: "ALPIC",
        env: "ALPIC_HOST"
      },
      {
        name: "Appcircle",
        constant: "APPCIRCLE",
        env: "AC_APPCIRCLE",
        pr: {
          env: "AC_GIT_PR",
          ne: "false"
        }
      },
      {
        name: "AppVeyor",
        constant: "APPVEYOR",
        env: "APPVEYOR",
        pr: "APPVEYOR_PULL_REQUEST_NUMBER"
      },
      {
        name: "AWS CodeBuild",
        constant: "CODEBUILD",
        env: "CODEBUILD_BUILD_ARN",
        pr: {
          env: "CODEBUILD_WEBHOOK_EVENT",
          any: [
            "PULL_REQUEST_CREATED",
            "PULL_REQUEST_UPDATED",
            "PULL_REQUEST_REOPENED"
          ]
        }
      },
      {
        name: "Azure Pipelines",
        constant: "AZURE_PIPELINES",
        env: "TF_BUILD",
        pr: {
          BUILD_REASON: "PullRequest"
        }
      },
      {
        name: "Bamboo",
        constant: "BAMBOO",
        env: "bamboo_planKey"
      },
      {
        name: "Bitbucket Pipelines",
        constant: "BITBUCKET",
        env: "BITBUCKET_COMMIT",
        pr: "BITBUCKET_PR_ID"
      },
      {
        name: "Bitrise",
        constant: "BITRISE",
        env: "BITRISE_IO",
        pr: "BITRISE_PULL_REQUEST"
      },
      {
        name: "Buddy",
        constant: "BUDDY",
        env: "BUDDY_WORKSPACE_ID",
        pr: "BUDDY_EXECUTION_PULL_REQUEST_ID"
      },
      {
        name: "Buildkite",
        constant: "BUILDKITE",
        env: "BUILDKITE",
        pr: {
          env: "BUILDKITE_PULL_REQUEST",
          ne: "false"
        }
      },
      {
        name: "CircleCI",
        constant: "CIRCLE",
        env: "CIRCLECI",
        pr: "CIRCLE_PULL_REQUEST"
      },
      {
        name: "Cirrus CI",
        constant: "CIRRUS",
        env: "CIRRUS_CI",
        pr: "CIRRUS_PR"
      },
      {
        name: "Cloudflare Pages",
        constant: "CLOUDFLARE_PAGES",
        env: "CF_PAGES"
      },
      {
        name: "Cloudflare Workers",
        constant: "CLOUDFLARE_WORKERS",
        env: "WORKERS_CI"
      },
      {
        name: "Codefresh",
        constant: "CODEFRESH",
        env: "CF_BUILD_ID",
        pr: {
          any: [
            "CF_PULL_REQUEST_NUMBER",
            "CF_PULL_REQUEST_ID"
          ]
        }
      },
      {
        name: "Codemagic",
        constant: "CODEMAGIC",
        env: "CM_BUILD_ID",
        pr: "CM_PULL_REQUEST"
      },
      {
        name: "Codeship",
        constant: "CODESHIP",
        env: {
          CI_NAME: "codeship"
        }
      },
      {
        name: "Drone",
        constant: "DRONE",
        env: "DRONE",
        pr: {
          DRONE_BUILD_EVENT: "pull_request"
        }
      },
      {
        name: "dsari",
        constant: "DSARI",
        env: "DSARI"
      },
      {
        name: "Earthly",
        constant: "EARTHLY",
        env: "EARTHLY_CI"
      },
      {
        name: "Expo Application Services",
        constant: "EAS",
        env: "EAS_BUILD"
      },
      {
        name: "Gerrit",
        constant: "GERRIT",
        env: "GERRIT_PROJECT"
      },
      {
        name: "Gitea Actions",
        constant: "GITEA_ACTIONS",
        env: "GITEA_ACTIONS"
      },
      {
        name: "GitHub Actions",
        constant: "GITHUB_ACTIONS",
        env: "GITHUB_ACTIONS",
        pr: {
          GITHUB_EVENT_NAME: "pull_request"
        }
      },
      {
        name: "GitLab CI",
        constant: "GITLAB",
        env: "GITLAB_CI",
        pr: "CI_MERGE_REQUEST_ID"
      },
      {
        name: "GoCD",
        constant: "GOCD",
        env: "GO_PIPELINE_LABEL"
      },
      {
        name: "Google Cloud Build",
        constant: "GOOGLE_CLOUD_BUILD",
        env: "BUILDER_OUTPUT"
      },
      {
        name: "Harness CI",
        constant: "HARNESS",
        env: "HARNESS_BUILD_ID"
      },
      {
        name: "Heroku",
        constant: "HEROKU",
        env: {
          env: "NODE",
          includes: "/app/.heroku/node/bin/node"
        }
      },
      {
        name: "Hudson",
        constant: "HUDSON",
        env: "HUDSON_URL"
      },
      {
        name: "Jenkins",
        constant: "JENKINS",
        env: [
          "JENKINS_URL",
          "BUILD_ID"
        ],
        pr: {
          any: [
            "ghprbPullId",
            "CHANGE_ID"
          ]
        }
      },
      {
        name: "LayerCI",
        constant: "LAYERCI",
        env: "LAYERCI",
        pr: "LAYERCI_PULL_REQUEST"
      },
      {
        name: "Magnum CI",
        constant: "MAGNUM",
        env: "MAGNUM"
      },
      {
        name: "Netlify CI",
        constant: "NETLIFY",
        env: "NETLIFY",
        pr: {
          env: "PULL_REQUEST",
          ne: "false"
        }
      },
      {
        name: "Nevercode",
        constant: "NEVERCODE",
        env: "NEVERCODE",
        pr: {
          env: "NEVERCODE_PULL_REQUEST",
          ne: "false"
        }
      },
      {
        name: "Prow",
        constant: "PROW",
        env: "PROW_JOB_ID"
      },
      {
        name: "ReleaseHub",
        constant: "RELEASEHUB",
        env: "RELEASE_BUILD_ID"
      },
      {
        name: "Render",
        constant: "RENDER",
        env: "RENDER",
        pr: {
          IS_PULL_REQUEST: "true"
        }
      },
      {
        name: "Sail CI",
        constant: "SAIL",
        env: "SAILCI",
        pr: "SAIL_PULL_REQUEST_NUMBER"
      },
      {
        name: "Screwdriver",
        constant: "SCREWDRIVER",
        env: "SCREWDRIVER",
        pr: {
          env: "SD_PULL_REQUEST",
          ne: "false"
        }
      },
      {
        name: "Semaphore",
        constant: "SEMAPHORE",
        env: "SEMAPHORE",
        pr: "PULL_REQUEST_NUMBER"
      },
      {
        name: "Sourcehut",
        constant: "SOURCEHUT",
        env: {
          CI_NAME: "sourcehut"
        }
      },
      {
        name: "Strider CD",
        constant: "STRIDER",
        env: "STRIDER"
      },
      {
        name: "TaskCluster",
        constant: "TASKCLUSTER",
        env: [
          "TASK_ID",
          "RUN_ID"
        ]
      },
      {
        name: "TeamCity",
        constant: "TEAMCITY",
        env: "TEAMCITY_VERSION"
      },
      {
        name: "Travis CI",
        constant: "TRAVIS",
        env: "TRAVIS",
        pr: {
          env: "TRAVIS_PULL_REQUEST",
          ne: "false"
        }
      },
      {
        name: "Vela",
        constant: "VELA",
        env: "VELA",
        pr: {
          VELA_PULL_REQUEST: "1"
        }
      },
      {
        name: "Vercel",
        constant: "VERCEL",
        env: {
          any: [
            "NOW_BUILDER",
            "VERCEL"
          ]
        },
        pr: "VERCEL_GIT_PULL_REQUEST_ID"
      },
      {
        name: "Visual Studio App Center",
        constant: "APPCENTER",
        env: "APPCENTER_BUILD_ID"
      },
      {
        name: "Woodpecker",
        constant: "WOODPECKER",
        env: {
          CI: "woodpecker"
        },
        pr: {
          CI_BUILD_EVENT: "pull_request"
        }
      },
      {
        name: "Xcode Cloud",
        constant: "XCODE_CLOUD",
        env: "CI_XCODE_PROJECT",
        pr: "CI_PULL_REQUEST_NUMBER"
      },
      {
        name: "Xcode Server",
        constant: "XCODE_SERVER",
        env: "XCS"
      }
    ];
  }
});

// node_modules/ci-info/index.js
var require_ci_info = __commonJS({
  "node_modules/ci-info/index.js"(exports) {
    "use strict";
    var vendors = require_vendors();
    var env = process.env;
    Object.defineProperty(exports, "_vendors", {
      value: vendors.map(function(v) {
        return v.constant;
      })
    });
    exports.name = null;
    exports.isPR = null;
    exports.id = null;
    if (env.CI !== "false") {
      vendors.forEach(function(vendor) {
        const envs = Array.isArray(vendor.env) ? vendor.env : [vendor.env];
        const isCI = envs.every(function(obj) {
          return checkEnv(obj);
        });
        exports[vendor.constant] = isCI;
        if (!isCI) {
          return;
        }
        exports.name = vendor.name;
        exports.isPR = checkPR(vendor);
        exports.id = vendor.constant;
      });
    }
    exports.isCI = !!(env.CI !== "false" && // Bypass all checks if CI env is explicitly set to 'false'
    (env.BUILD_ID || // Jenkins, Cloudbees
    env.BUILD_NUMBER || // Jenkins, TeamCity
    env.CI || // Travis CI, CircleCI, Cirrus CI, Gitlab CI, Appveyor, CodeShip, dsari, Cloudflare Pages/Workers
    env.CI_APP_ID || // Appflow
    env.CI_BUILD_ID || // Appflow
    env.CI_BUILD_NUMBER || // Appflow
    env.CI_NAME || // Codeship and others
    env.CONTINUOUS_INTEGRATION || // Travis CI, Cirrus CI
    env.RUN_ID || // TaskCluster, dsari
    exports.name || false));
    function checkEnv(obj) {
      if (typeof obj === "string") return !!env[obj];
      if ("env" in obj) {
        return env[obj.env] && env[obj.env].includes(obj.includes);
      }
      if ("any" in obj) {
        return obj.any.some(function(k) {
          return !!env[k];
        });
      }
      return Object.keys(obj).every(function(k) {
        return env[k] === obj[k];
      });
    }
    function checkPR(vendor) {
      switch (typeof vendor.pr) {
        case "string":
          return !!env[vendor.pr];
        case "object":
          if ("env" in vendor.pr) {
            if ("any" in vendor.pr) {
              return vendor.pr.any.some(function(key) {
                return env[vendor.pr.env] === key;
              });
            } else {
              return vendor.pr.env in env && env[vendor.pr.env] !== vendor.pr.ne;
            }
          } else if ("any" in vendor.pr) {
            return vendor.pr.any.some(function(key) {
              return !!env[key];
            });
          } else {
            return checkEnv(vendor.pr);
          }
        default:
          return null;
      }
    }
  }
});

// node_modules/@openuidev/lang-core/dist/shared-Dzgc28Wo.mjs
function getPostHogConfig(env) {
  const host = env?.["OPENUI_POSTHOG_HOST"] ?? "https://dgoeivjus9jfp.cloudfront.net";
  return {
    apiKey: env?.["OPENUI_POSTHOG_KEY"] ?? "phc_3OLW53x09ZTVZSV6BEpj5uycj3ooqR6KOemOjx04e3D",
    captureUrl: new URL("/capture/", host).toString()
  };
}
function isTruthyEnv(value) {
  return value === "1" || value?.toLowerCase() === "true";
}
function isTelemetryDisabled(env) {
  return isTruthyEnv(env?.["OPENUI_TELEMETRY_DISABLED"]) || isTruthyEnv(env?.["DO_NOT_TRACK"]);
}
function isRuntimeTelemetryEnabled(env) {
  return isTruthyEnv(env?.["OPENUI_RUNTIME_TELEMETRY_ENABLED"]) && !isTelemetryDisabled(env);
}
function normalizeProjectIdentity(rawValue) {
  const value = rawValue.trim();
  if (!value) return "";
  try {
    const url2 = new URL(value);
    const repositoryPath = normalizeRepositoryPath(decodeURIComponent(url2.pathname));
    if (url2.protocol === "file:") return `file:${repositoryPath}`;
    if (url2.host) return joinHostAndPath(url2.host, repositoryPath);
  } catch {
  }
  if (/^[A-Za-z]:[\\/]/.test(value)) return normalizeRepositoryPath(value);
  const scpMatch = /^(?:[^@/\s]+@)?([^:/\s]+):(.+)$/.exec(value);
  if (scpMatch) return joinHostAndPath(scpMatch[1], scpMatch[2]);
  return normalizeRepositoryPath(value);
}
function joinHostAndPath(host, repositoryPath) {
  const normalizedHost = host.trim().toLowerCase();
  const normalizedPath = normalizeRepositoryPath(repositoryPath);
  return normalizedPath ? `${normalizedHost}/${normalizedPath}` : normalizedHost;
}
function normalizeRepositoryPath(repositoryPath) {
  return repositoryPath.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "");
}
var TELEMETRY_REQUEST_TIMEOUT_MS;
var init_shared_Dzgc28Wo = __esm({
  "node_modules/@openuidev/lang-core/dist/shared-Dzgc28Wo.mjs"() {
    TELEMETRY_REQUEST_TIMEOUT_MS = 2e3;
  }
});

// node_modules/zod/v4/core/util.js
var util_exports = {};
__export(util_exports, {
  BIGINT_FORMAT_RANGES: () => BIGINT_FORMAT_RANGES,
  CONSTANT_CATCH: () => CONSTANT_CATCH,
  Class: () => Class,
  NUMBER_FORMAT_RANGES: () => NUMBER_FORMAT_RANGES,
  aborted: () => aborted,
  allowsEval: () => allowsEval,
  assert: () => assert,
  assertEqual: () => assertEqual,
  assertIs: () => assertIs,
  assertNever: () => assertNever,
  assertNotEqual: () => assertNotEqual,
  assignProp: () => assignProp,
  attachSchema: () => attachSchema,
  base64ToUint8Array: () => base64ToUint8Array,
  base64urlToUint8Array: () => base64urlToUint8Array,
  cached: () => cached,
  captureStackTrace: () => captureStackTrace,
  cleanEnum: () => cleanEnum,
  cleanRegex: () => cleanRegex,
  clone: () => clone,
  cloneDef: () => cloneDef,
  codePointLength: () => codePointLength,
  constantCatch: () => constantCatch,
  createTransparentProxy: () => createTransparentProxy,
  defineLazy: () => defineLazy,
  defineLazyInternal: () => defineLazyInternal,
  derived: () => derived,
  esc: () => esc,
  escapeRegex: () => escapeRegex,
  explicitlyAborted: () => explicitlyAborted,
  extend: () => extend,
  finalizeIssue: () => finalizeIssue,
  floatSafeRemainder: () => floatSafeRemainder,
  getElementAtPath: () => getElementAtPath,
  getEnumValues: () => getEnumValues,
  getLengthableOrigin: () => getLengthableOrigin,
  getParsedType: () => getParsedType,
  getSizableOrigin: () => getSizableOrigin,
  hexToUint8Array: () => hexToUint8Array,
  hide: () => hide,
  installLazyProp: () => installLazyProp,
  isObject: () => isObject,
  isPlainObject: () => isPlainObject,
  issue: () => issue,
  joinValues: () => joinValues,
  jsonStringifyReplacer: () => jsonStringifyReplacer,
  members: () => members,
  merge: () => merge,
  mergeDefs: () => mergeDefs,
  normalizeParams: () => normalizeParams,
  nullish: () => nullish,
  numKeys: () => numKeys,
  objectClone: () => objectClone,
  omit: () => omit,
  optionalKeys: () => optionalKeys,
  own: () => own,
  parsedType: () => parsedType,
  partial: () => partial,
  pick: () => pick,
  prefixIssues: () => prefixIssues,
  primitiveTypes: () => primitiveTypes,
  promiseAllObject: () => promiseAllObject,
  propertyKeyTypes: () => propertyKeyTypes,
  randomString: () => randomString,
  rawShape: () => rawShape,
  required: () => required,
  safeExtend: () => safeExtend,
  shallowClone: () => shallowClone,
  slugify: () => slugify,
  stringifyPrimitive: () => stringifyPrimitive,
  toZod: () => toZod,
  uint8ArrayToBase64: () => uint8ArrayToBase64,
  uint8ArrayToBase64url: () => uint8ArrayToBase64url,
  uint8ArrayToHex: () => uint8ArrayToHex,
  unwrapMessage: () => unwrapMessage
});
function assertEqual(val) {
  return val;
}
function assertNotEqual(val) {
  return val;
}
function toZod() {
  return (schema) => schema;
}
function assertIs(_arg) {
}
function assertNever(_x) {
  throw new Error("Unexpected value in exhaustive check");
}
function assert(_) {
}
function getEnumValues(entries) {
  const numericValues = Object.values(entries).filter((v) => typeof v === "number");
  const values = Object.entries(entries).filter(([k, _]) => numericValues.indexOf(+k) === -1).map(([_, v]) => v);
  return values;
}
function joinValues(array2, separator = "|") {
  return array2.map((val) => stringifyPrimitive(val)).join(separator);
}
function jsonStringifyReplacer(_, value) {
  if (typeof value === "bigint")
    return value.toString();
  return value;
}
function cached(getter) {
  return new Cached(getter);
}
function nullish(input2) {
  return input2 === null || input2 === void 0;
}
function cleanRegex(source) {
  const start = source.startsWith("^") ? 1 : 0;
  const end = source.endsWith("$") ? source.length - 1 : source.length;
  return source.slice(start, end);
}
function floatSafeRemainder(val, step) {
  const ratio = val / step;
  const roundedRatio = Math.round(ratio);
  const tolerance = 4 * Number.EPSILON * Math.max(Math.abs(ratio), 1);
  if (Math.abs(ratio - roundedRatio) < tolerance)
    return 0;
  return ratio - roundedRatio;
}
function defineLazy(object2, key, getter) {
  let value = void 0;
  Object.defineProperty(object2, key, {
    get() {
      if (value === EVALUATING) {
        return void 0;
      }
      if (value === void 0) {
        value = EVALUATING;
        value = getter();
      }
      return value;
    },
    set(v) {
      Object.defineProperty(object2, key, {
        value: v
        // configurable: true,
      });
    },
    configurable: true
  });
}
function objectClone(obj) {
  return Object.create(Object.getPrototypeOf(obj), Object.getOwnPropertyDescriptors(obj));
}
function assignProp(target, prop, value) {
  Object.defineProperty(target, prop, {
    value,
    writable: true,
    enumerable: true,
    configurable: true
  });
}
function rawShape(def) {
  const desc = Object.getOwnPropertyDescriptor(def, "shape");
  return desc?.get ? desc.get.raw : desc?.value;
}
function sourceShape(schema) {
  return rawShape(schema._zod.def) ?? schema._zod.def.shape;
}
function deferProp(target, key, getter) {
  Object.defineProperty(target, key, {
    get() {
      const value = getter();
      assignProp(this, key, value);
      return value;
    },
    enumerable: true,
    configurable: true
  });
}
function putProp(target, key, value) {
  if (key in target)
    assignProp(target, key, value);
  else
    target[key] = value;
}
function mirrorShape(target, source, keys, wrap) {
  const raw = sourceShape(source);
  for (const key of keys) {
    const desc = Object.getOwnPropertyDescriptor(raw, key);
    if (!desc.enumerable)
      continue;
    if (desc.get) {
      deferProp(target, key, () => {
        const value = source._zod.def.shape[key];
        return wrap ? wrap(value, key) : value;
      });
    } else
      putProp(target, key, wrap ? wrap(desc.value, key) : desc.value);
  }
}
function mirrorProps(target, source) {
  for (const key of Reflect.ownKeys(source)) {
    const desc = Object.getOwnPropertyDescriptor(source, key);
    if (!desc.enumerable)
      continue;
    if (desc.get)
      deferProp(target, key, () => source[key]);
    else
      putProp(target, key, desc.value);
  }
}
function mergeDefs(...defs) {
  const mergedDescriptors = {};
  for (const def of defs) {
    const descriptors = Object.getOwnPropertyDescriptors(def);
    Object.assign(mergedDescriptors, descriptors);
  }
  return Object.defineProperties({}, mergedDescriptors);
}
function cloneDef(schema) {
  return mergeDefs(schema._zod.def);
}
function getElementAtPath(obj, path) {
  if (!path)
    return obj;
  return path.reduce((acc, key) => acc?.[key], obj);
}
function promiseAllObject(promisesObj) {
  const keys = Object.keys(promisesObj);
  const promises = keys.map((key) => promisesObj[key]);
  return Promise.all(promises).then((results) => {
    const resolvedObj = {};
    for (let i = 0; i < keys.length; i++) {
      resolvedObj[keys[i]] = results[i];
    }
    return resolvedObj;
  });
}
function randomString(length = 10) {
  const chars = "abcdefghijklmnopqrstuvwxyz";
  let str = "";
  for (let i = 0; i < length; i++) {
    str += chars[Math.floor(Math.random() * chars.length)];
  }
  return str;
}
function esc(str) {
  return JSON.stringify(str);
}
function slugify(input2) {
  return input2.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");
}
function isObject(data) {
  return typeof data === "object" && data !== null && !Array.isArray(data);
}
function isPlainObject(o) {
  if (isObject(o) === false)
    return false;
  const ctor = o.constructor;
  if (ctor === void 0)
    return true;
  if (typeof ctor !== "function")
    return true;
  const prot = ctor.prototype;
  if (isObject(prot) === false)
    return false;
  if (Object.prototype.hasOwnProperty.call(prot, "isPrototypeOf") === false) {
    return false;
  }
  return true;
}
function shallowClone(o) {
  if (isPlainObject(o))
    return { ...o };
  if (Array.isArray(o))
    return [...o];
  if (o instanceof Map)
    return new Map(o);
  if (o instanceof Set)
    return new Set(o);
  return o;
}
function numKeys(data) {
  let keyCount = 0;
  for (const key in data) {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      keyCount++;
    }
  }
  return keyCount;
}
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function clone(inst, def, params) {
  const cl = new inst._zod.constr(def ?? inst._zod.def);
  if (!def || params?.parent)
    cl._zod.parent = inst;
  return cl;
}
function normalizeParams(_params) {
  const params = _params;
  if (!params)
    return {};
  if (typeof params === "string")
    return { error: () => params };
  if (params?.message !== void 0) {
    if (params?.error !== void 0)
      throw new Error("Cannot specify both `message` and `error` params");
    params.error = params.message;
  }
  delete params.message;
  if (typeof params.error === "string")
    return { ...params, error: () => params.error };
  return params;
}
function createTransparentProxy(getter) {
  let target;
  return new Proxy({}, {
    get(_, prop, receiver) {
      target ?? (target = getter());
      return Reflect.get(target, prop, receiver);
    },
    set(_, prop, value, receiver) {
      target ?? (target = getter());
      return Reflect.set(target, prop, value, receiver);
    },
    has(_, prop) {
      target ?? (target = getter());
      return Reflect.has(target, prop);
    },
    deleteProperty(_, prop) {
      target ?? (target = getter());
      return Reflect.deleteProperty(target, prop);
    },
    ownKeys(_) {
      target ?? (target = getter());
      return Reflect.ownKeys(target);
    },
    getOwnPropertyDescriptor(_, prop) {
      target ?? (target = getter());
      return Reflect.getOwnPropertyDescriptor(target, prop);
    },
    defineProperty(_, prop, descriptor) {
      target ?? (target = getter());
      return Reflect.defineProperty(target, prop, descriptor);
    }
  });
}
function stringifyPrimitive(value) {
  if (typeof value === "bigint")
    return value.toString() + "n";
  if (typeof value === "string")
    return `"${value}"`;
  return `${value}`;
}
function optionalKeys(shape) {
  return Object.keys(shape).filter((k) => {
    return shape[k]._zod.optin !== void 0 && shape[k]._zod.optout === "optional";
  });
}
function pick(schema, mask) {
  const currDef = schema._zod.def;
  const checks = currDef.checks;
  const hasChecks = checks && checks.length > 0;
  if (hasChecks) {
    throw new Error(".pick() cannot be used on object schemas containing refinements");
  }
  const newShape = {};
  mirrorShape(newShape, schema, maskedKeys(schema, mask));
  return clone(schema, mergeDefs(currDef, { shape: newShape, checks: [] }));
}
function maskedKeys(schema, mask) {
  const raw = sourceShape(schema);
  const keys = [];
  for (const key of Reflect.ownKeys(mask)) {
    if (!Object.getOwnPropertyDescriptor(raw, key)?.enumerable) {
      throw new Error(`Unrecognized key: "${String(key)}"`);
    }
    if (mask[key])
      keys.push(key);
  }
  return keys;
}
function omit(schema, mask) {
  const currDef = schema._zod.def;
  const checks = currDef.checks;
  const hasChecks = checks && checks.length > 0;
  if (hasChecks) {
    throw new Error(".omit() cannot be used on object schemas containing refinements");
  }
  const omitted = new Set(maskedKeys(schema, mask));
  const newShape = {};
  mirrorShape(newShape, schema, Reflect.ownKeys(sourceShape(schema)).filter((key) => !omitted.has(key)));
  return clone(schema, mergeDefs(currDef, { shape: newShape, checks: [] }));
}
function extend(schema, shape) {
  if (!isPlainObject(shape)) {
    throw new Error("Invalid input to extend: expected a plain object");
  }
  const checks = schema._zod.def.checks;
  const hasChecks = checks && checks.length > 0;
  if (hasChecks) {
    const existingShape = sourceShape(schema);
    for (const key of Reflect.ownKeys(shape)) {
      if (Object.getOwnPropertyDescriptor(existingShape, key) !== void 0) {
        throw new Error("Cannot overwrite keys on object schemas containing refinements. Use `.safeExtend()` instead.");
      }
    }
  }
  return clone(schema, mergeDefs(schema._zod.def, { shape: extended(schema, shape) }));
}
function extended(schema, shape) {
  const newShape = {};
  mirrorShape(newShape, schema, Reflect.ownKeys(sourceShape(schema)));
  mirrorProps(newShape, shape);
  return newShape;
}
function safeExtend(schema, shape) {
  if (!isPlainObject(shape)) {
    throw new Error("Invalid input to safeExtend: expected a plain object");
  }
  return clone(schema, mergeDefs(schema._zod.def, { shape: extended(schema, shape) }));
}
function merge(a, b) {
  if (!b?._zod?.def) {
    throw new Error("Invalid input to merge: expected an object schema. To merge a plain shape, use `.extend()`.");
  }
  if (a._zod.def.checks?.length) {
    throw new Error(".merge() cannot be used on object schemas containing refinements. Use .safeExtend() instead.");
  }
  const newShape = {};
  mirrorShape(newShape, a, Reflect.ownKeys(sourceShape(a)));
  mirrorShape(newShape, b, Reflect.ownKeys(sourceShape(b)));
  const def = mergeDefs(a._zod.def, {
    shape: newShape,
    get catchall() {
      return b._zod.def.catchall;
    },
    checks: b._zod.def.checks ?? []
  });
  return clone(a, def);
}
function partial(Class2, schema, mask, name = "partial") {
  const currDef = schema._zod.def;
  const checks = currDef.checks;
  const hasChecks = checks && checks.length > 0;
  if (hasChecks) {
    throw new Error(`.${name}() cannot be used on object schemas containing refinements`);
  }
  const selected = mask ? new Set(maskedKeys(schema, mask)) : void 0;
  const newShape = {};
  mirrorShape(newShape, schema, Reflect.ownKeys(sourceShape(schema)), Class2 && ((value, key) => selected && !selected.has(key) ? value : new Class2({ type: "optional", innerType: value })));
  return clone(schema, mergeDefs(schema._zod.def, { shape: newShape, checks: [] }));
}
function required(Class2, schema, mask) {
  const selected = mask ? new Set(maskedKeys(schema, mask)) : void 0;
  const newShape = {};
  mirrorShape(newShape, schema, Reflect.ownKeys(sourceShape(schema)), (value, key) => (
    // overwrite with non-optional
    selected && !selected.has(key) ? value : new Class2({ type: "nonoptional", innerType: value })
  ));
  return clone(schema, mergeDefs(schema._zod.def, { shape: newShape }));
}
function aborted(x, startIndex = 0) {
  if (x.aborted === true)
    return true;
  for (let i = startIndex; i < x.issues.length; i++) {
    if (x.issues[i]?.continue !== true) {
      return true;
    }
  }
  return false;
}
function explicitlyAborted(x, startIndex = 0) {
  if (x.aborted === true)
    return true;
  for (let i = startIndex; i < x.issues.length; i++) {
    if (x.issues[i]?.continue === false) {
      return true;
    }
  }
  return false;
}
function prefixIssues(path, issues) {
  return issues.map((iss) => {
    var _a3;
    (_a3 = iss).path ?? (_a3.path = []);
    iss.path.unshift(path);
    return iss;
  });
}
function unwrapMessage(message) {
  return typeof message === "string" ? message : message?.message;
}
function attachSchema(issues, start, inst) {
  var _a3;
  for (let i = start; i < issues.length; i++) {
    (_a3 = issues[i]).schema ?? (_a3.schema = inst);
  }
}
function finalizeIssue(iss, ctx, config2) {
  var _a3;
  const traits = iss.inst?._zod?.traits;
  if (traits?.has("$ZodType")) {
    if (traits.has("$ZodCheck"))
      (_a3 = iss).schema ?? (_a3.schema = iss.inst);
    else
      iss.schema = iss.inst;
  }
  const schemaError = iss.schema !== iss.inst ? iss.schema?._zod.def?.error : void 0;
  const message = iss.message ? iss.message : unwrapMessage(iss.inst?._zod.def?.error?.(iss)) ?? unwrapMessage(schemaError?.(iss)) ?? unwrapMessage(ctx?.error?.(iss)) ?? unwrapMessage(config2.customError?.(iss)) ?? unwrapMessage(config2.localeError?.(iss)) ?? "Invalid input";
  const full = {};
  for (const k of Object.keys(iss)) {
    if (k === "inst" || k === "schema" || k === "continue" || k === "input" || k === "__proto__")
      continue;
    full[k] = iss[k];
  }
  full.path ?? (full.path = []);
  full.message = message;
  if (ctx?.reportInput) {
    full.input = iss.input;
  }
  return full;
}
function getSizableOrigin(input2) {
  if (input2 instanceof Set)
    return "set";
  if (input2 instanceof Map)
    return "map";
  if (input2 instanceof File)
    return "file";
  return "unknown";
}
function codePointLength(str) {
  const units = str.length;
  if (!highSurrogate.test(str))
    return units;
  let count = units;
  for (let i = 0; i < units - 1; i++) {
    if ((str.charCodeAt(i) & 64512) === 55296 && (str.charCodeAt(i + 1) & 64512) === 56320) {
      count--;
      i++;
    }
  }
  return count;
}
function getLengthableOrigin(input2) {
  if (Array.isArray(input2))
    return "array";
  if (typeof input2 === "string")
    return "string";
  return "unknown";
}
function parsedType(data) {
  const t2 = typeof data;
  switch (t2) {
    case "number": {
      return Number.isNaN(data) ? "nan" : "number";
    }
    case "object": {
      if (data === null) {
        return "null";
      }
      if (Array.isArray(data)) {
        return "array";
      }
      const obj = data;
      if (obj && Object.getPrototypeOf(obj) !== Object.prototype && "constructor" in obj && obj.constructor) {
        return obj.constructor.name;
      }
    }
  }
  return t2;
}
function issue(...args) {
  const [iss, input2, inst] = args;
  if (typeof iss === "string") {
    return {
      message: iss,
      code: "custom",
      input: input2,
      inst
    };
  }
  return { ...iss };
}
function cleanEnum(obj) {
  return Object.entries(obj).filter(([k, _]) => {
    return Number.isNaN(Number.parseInt(k, 10));
  }).map((el) => el[1]);
}
function base64ToUint8Array(base643) {
  const binaryString = atob(base643);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}
function uint8ArrayToBase64(bytes) {
  let binaryString = "";
  for (let i = 0; i < bytes.length; i++) {
    binaryString += String.fromCharCode(bytes[i]);
  }
  return btoa(binaryString);
}
function base64urlToUint8Array(base64url3) {
  const base643 = base64url3.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - base643.length % 4) % 4);
  return base64ToUint8Array(base643 + padding);
}
function uint8ArrayToBase64url(bytes) {
  return uint8ArrayToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}
function hexToUint8Array(hex3) {
  const cleanHex = hex3.replace(/^0x/, "");
  if (cleanHex.length % 2 !== 0) {
    throw new Error("Invalid hex string length");
  }
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < cleanHex.length; i += 2) {
    bytes[i / 2] = Number.parseInt(cleanHex.slice(i, i + 2), 16);
  }
  return bytes;
}
function uint8ArrayToHex(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function members(proto, table) {
  for (const key in table) {
    const desc = Object.getOwnPropertyDescriptor(table, key);
    if (desc.get)
      Object.defineProperty(proto, key, { ...desc, enumerable: false });
    else
      defineBound(proto, key, desc.value);
  }
}
function own(inst, key, value, enumerable = true) {
  Object.defineProperty(inst, key, { configurable: true, writable: true, enumerable, value });
  return value;
}
function hide(inst, key, value) {
  return own(inst, key, value, false);
}
// @__NO_SIDE_EFFECTS__
function derived(computes, table) {
  for (const key in computes) {
    const compute = computes[key];
    Object.defineProperty(table, key, {
      configurable: true,
      enumerable: true,
      get() {
        return own(this, key, compute(this));
      },
      set(value) {
        own(this, key, value);
      }
    });
  }
  return table;
}
function defineBound(proto, key, fn) {
  Object.defineProperty(proto, key, {
    configurable: true,
    get() {
      return this == null ? fn : own(this, key, fn.bind(this));
    },
    set(value) {
      own(this, key, value);
    }
  });
}
function claim(inst, sentinel) {
  const proto = Object.getPrototypeOf(inst);
  return sentinel in proto ? void 0 : proto;
}
function defineLazyInternal(inst, key, compute) {
  const proto = Object.getPrototypeOf(inst._zod);
  if (key in proto && installing !== inst._zod) {
    installing = void 0;
    return;
  }
  installing = inst._zod;
  Object.defineProperty(proto, key, {
    configurable: true,
    get() {
      Object.defineProperty(this, key, breaker);
      const outer = broke;
      broke = false;
      try {
        const value = compute(this);
        if (broke)
          delete this[key];
        else
          Object.defineProperty(this, key, { configurable: true, writable: true, value });
        broke = broke || outer;
        return value;
      } catch (err) {
        delete this[key];
        broke = broke || outer;
        throw err;
      }
    },
    set(value) {
      Object.defineProperty(this, key, { configurable: true, writable: true, value });
    }
  });
}
function installLazyProp(inst, key, make, enumerable) {
  const proto = claim(inst, key);
  if (!proto)
    return;
  Object.defineProperty(proto, key, {
    configurable: true,
    get() {
      const desc = { configurable: true, writable: true, enumerable, value: void 0 };
      Object.defineProperty(this, key, desc);
      desc.value = make(this);
      Object.defineProperty(this, key, desc);
      return desc.value;
    },
    set(value) {
      Object.defineProperty(this, key, { configurable: true, writable: true, enumerable, value });
    }
  });
}
function constantCatch(value) {
  const fn = () => value;
  fn[CONSTANT_CATCH] = true;
  return fn;
}
var Cached, EVALUATING, captureStackTrace, allowsEval, getParsedType, propertyKeyTypes, primitiveTypes, NUMBER_FORMAT_RANGES, BIGINT_FORMAT_RANGES, highSurrogate, Class, installing, broke, breaker, CONSTANT_CATCH;
var init_util = __esm({
  "node_modules/zod/v4/core/util.js"() {
    init_core();
    Cached = class {
      constructor(getter) {
        this._getter = getter;
        this._value = void 0;
      }
      get value() {
        const getter = this._getter;
        if (getter !== void 0) {
          this._value = getter();
          this._getter = void 0;
        }
        return this._value;
      }
    };
    EVALUATING = /* @__PURE__ */ Symbol("evaluating");
    captureStackTrace = "captureStackTrace" in Error ? Error.captureStackTrace : (..._args) => {
    };
    allowsEval = /* @__PURE__ */ cached(() => {
      if (globalConfig.jitless) {
        return false;
      }
      if (typeof navigator !== "undefined" && navigator?.userAgent?.includes("Cloudflare")) {
        return false;
      }
      try {
        const F = Function;
        new F("");
        return true;
      } catch (_) {
        return false;
      }
    });
    getParsedType = (data) => {
      const t2 = typeof data;
      switch (t2) {
        case "undefined":
          return "undefined";
        case "string":
          return "string";
        case "number":
          return Number.isNaN(data) ? "nan" : "number";
        case "boolean":
          return "boolean";
        case "function":
          return "function";
        case "bigint":
          return "bigint";
        case "symbol":
          return "symbol";
        case "object":
          if (Array.isArray(data)) {
            return "array";
          }
          if (data === null) {
            return "null";
          }
          if (data.then && typeof data.then === "function" && data.catch && typeof data.catch === "function") {
            return "promise";
          }
          if (typeof Map !== "undefined" && data instanceof Map) {
            return "map";
          }
          if (typeof Set !== "undefined" && data instanceof Set) {
            return "set";
          }
          if (typeof Date !== "undefined" && data instanceof Date) {
            return "date";
          }
          if (typeof File !== "undefined" && data instanceof File) {
            return "file";
          }
          return "object";
        default:
          throw new Error(`Unknown data type: ${t2}`);
      }
    };
    propertyKeyTypes = /* @__PURE__ */ new Set(["string", "number", "symbol"]);
    primitiveTypes = /* @__PURE__ */ new Set([
      "string",
      "number",
      "bigint",
      "boolean",
      "symbol",
      "undefined"
    ]);
    NUMBER_FORMAT_RANGES = /* @__PURE__ */ (() => ({
      safeint: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
      int32: [-2147483648, 2147483647],
      uint32: [0, 4294967295],
      float32: [-34028234663852886e22, 34028234663852886e22],
      float64: [-Number.MAX_VALUE, Number.MAX_VALUE]
    }))();
    BIGINT_FORMAT_RANGES = {
      int64: [/* @__PURE__ */ BigInt("-9223372036854775808"), /* @__PURE__ */ BigInt("9223372036854775807")],
      uint64: [/* @__PURE__ */ BigInt(0), /* @__PURE__ */ BigInt("18446744073709551615")]
    };
    highSurrogate = /[\uD800-\uDBFF]/;
    Class = class {
      constructor(..._args) {
      }
    };
    broke = false;
    breaker = {
      configurable: true,
      get() {
        broke = true;
        return void 0;
      }
    };
    CONSTANT_CATCH = "~constantCatch";
  }
});

// node_modules/zod/v4/core/core.js
function newError(Definition) {
  const E = _E;
  if (E) {
    const saved = E.stackTraceLimit;
    if (typeof saved === "number") {
      try {
        E.stackTraceLimit = 0;
      } catch {
        _E = null;
        return new Definition();
      }
      try {
        return new Definition();
      } finally {
        E.stackTraceLimit = saved;
      }
    }
  }
  return new Definition();
}
// @__NO_SIDE_EFFECTS__
function $constructor(name, initializer3, proto, params) {
  const zodProto = {};
  function Internals(def) {
    this.def = def;
    this.constr = _;
    this.traits = /* @__PURE__ */ new Set();
  }
  Internals.prototype = zodProto;
  const protoMembers = proto;
  const initialized = protoMembers && /* @__PURE__ */ new WeakSet();
  function init(inst, def) {
    if (!inst._zod) {
      _zodDesc.value = new Internals(def);
      try {
        Object.defineProperty(inst, "_zod", _zodDesc);
      } finally {
        _zodDesc.value = void 0;
      }
    } else if (inst._zod.traits.has(name)) {
      return;
    }
    inst._zod.traits.add(name);
    initializer3(inst, def);
    if (initialized) {
      const own2 = Object.getPrototypeOf(inst);
      const ctorProto = inst._zod.constr.prototype;
      let up = own2;
      while (up && up !== ctorProto)
        up = Object.getPrototypeOf(up);
      const target = up ?? own2;
      if (!initialized.has(target)) {
        initialized.add(target);
        members(target, protoMembers);
      }
    }
    const proto2 = _.prototype;
    for (const k in proto2) {
      if (!Object.prototype.hasOwnProperty.call(proto2, k))
        continue;
      if (!(k in inst)) {
        inst[k] = proto2[k].bind(inst);
      }
    }
  }
  const Parent = params?.Parent ?? Object;
  class Definition extends Parent {
  }
  Object.defineProperty(Definition, "name", { value: name });
  function _(def) {
    const inst = params?.Parent ? newError(Definition) : this;
    init(inst, def);
    const deferred = inst._zod.deferred;
    if (deferred) {
      for (const fn of deferred) {
        fn();
      }
      inst._zod.deferred = void 0;
    }
    const pp = globalThis.__zod_globalConfig?.postProcessor;
    if (pp)
      pp(inst);
    return inst;
  }
  Object.defineProperty(_, "init", { value: init });
  Object.defineProperty(_, Symbol.hasInstance, {
    value: (inst) => {
      if (params?.Parent && inst instanceof params.Parent)
        return true;
      return inst?._zod?.traits?.has(name);
    }
  });
  Object.defineProperty(_, "name", { value: name });
  return _;
}
function config(newConfig) {
  if (newConfig)
    Object.assign(globalConfig, newConfig);
  return globalConfig;
}
var _a, NEVER, _zodDesc, _E, $brand, $ZodAsyncError, $ZodEncodeError, globalConfig;
var init_core = __esm({
  "node_modules/zod/v4/core/core.js"() {
    init_util();
    NEVER = /* @__PURE__ */ Object.freeze({
      status: "aborted"
    });
    _zodDesc = { value: void 0, enumerable: false };
    _E = "captureStackTrace" in Error ? Error : null;
    $brand = /* @__PURE__ */ Symbol("zod_brand");
    $ZodAsyncError = class extends Error {
      constructor() {
        super(`Encountered Promise during synchronous parse. Use .parseAsync() instead.`);
      }
    };
    $ZodEncodeError = class extends Error {
      constructor(name) {
        super(`Encountered unidirectional transform during encode: ${name}`);
        this.name = "ZodEncodeError";
      }
    };
    (_a = globalThis).__zod_globalConfig ?? (_a.__zod_globalConfig = {});
    globalConfig = globalThis.__zod_globalConfig;
  }
});

// node_modules/zod/v4/core/errors.js
function _getMessage() {
  const internals = this._zod;
  internals.message ?? (internals.message = JSON.stringify(internals.def, jsonStringifyReplacer, 2));
  return internals.message;
}
function _setMessage(value) {
  this._zod.message = value;
}
function node(obj, key, make) {
  if (!Object.prototype.hasOwnProperty.call(obj, key)) {
    if (key === "__proto__") {
      Object.defineProperty(obj, key, { value: make(), writable: true, enumerable: true, configurable: true });
    } else {
      obj[key] = make();
    }
  }
  return obj[key];
}
function flattenError(error2, mapper = (issue2) => issue2.message) {
  const fieldErrors = {};
  const formErrors = [];
  for (const sub of error2.issues) {
    if (sub.path.length > 0) {
      node(fieldErrors, sub.path[0], () => []).push(mapper(sub));
    } else {
      formErrors.push(mapper(sub));
    }
  }
  return { formErrors, fieldErrors };
}
function formatError(error2, mapper = (issue2) => issue2.message) {
  const fieldErrors = { _errors: [] };
  const processError = (error3, path = []) => {
    for (const issue2 of error3.issues) {
      if (issue2.code === "invalid_union" && issue2.errors.length) {
        issue2.errors.map((issues) => processError({ issues }, [...path, ...issue2.path]));
      } else if (issue2.code === "invalid_key") {
        processError({ issues: issue2.issues }, [...path, ...issue2.path]);
      } else if (issue2.code === "invalid_element") {
        processError({ issues: issue2.issues }, [...path, ...issue2.path]);
      } else {
        const fullpath = [...path, ...issue2.path];
        if (fullpath.length === 0) {
          fieldErrors._errors.push(mapper(issue2));
        } else {
          let curr = fieldErrors;
          let i = 0;
          while (i < fullpath.length) {
            const el = fullpath[i];
            const terminal = i === fullpath.length - 1;
            if (el === "_errors") {
              if (terminal)
                curr._errors.push(mapper(issue2));
              i++;
              continue;
            }
            if (!Object.prototype.hasOwnProperty.call(curr, el)) {
              Object.defineProperty(curr, el, {
                value: { _errors: [] },
                enumerable: true,
                writable: true,
                configurable: true
              });
            }
            const node2 = curr[el];
            if (terminal) {
              node2._errors.push(mapper(issue2));
            }
            curr = node2;
            i++;
          }
        }
      }
    }
  };
  processError(error2);
  return fieldErrors;
}
function treeifyError(error2, mapper = (issue2) => issue2.message) {
  const result = { errors: [] };
  const processError = (error3, path = []) => {
    var _a3;
    for (const issue2 of error3.issues) {
      if (issue2.code === "invalid_union" && issue2.errors.length) {
        issue2.errors.map((issues) => processError({ issues }, [...path, ...issue2.path]));
      } else if (issue2.code === "invalid_key") {
        processError({ issues: issue2.issues }, [...path, ...issue2.path]);
      } else if (issue2.code === "invalid_element") {
        processError({ issues: issue2.issues }, [...path, ...issue2.path]);
      } else {
        const fullpath = [...path, ...issue2.path];
        if (fullpath.length === 0) {
          result.errors.push(mapper(issue2));
          continue;
        }
        let curr = result;
        let i = 0;
        while (i < fullpath.length) {
          const el = fullpath[i];
          const terminal = i === fullpath.length - 1;
          if (typeof el === "string") {
            curr.properties ?? (curr.properties = {});
            if (!Object.prototype.hasOwnProperty.call(curr.properties, el)) {
              Object.defineProperty(curr.properties, el, {
                value: { errors: [] },
                enumerable: true,
                writable: true,
                configurable: true
              });
            }
            curr = curr.properties[el];
          } else {
            curr.items ?? (curr.items = []);
            (_a3 = curr.items)[el] ?? (_a3[el] = { errors: [] });
            curr = curr.items[el];
          }
          if (terminal) {
            curr.errors.push(mapper(issue2));
          }
          i++;
        }
      }
    }
  };
  processError(error2);
  return result;
}
function toDotPath(_path) {
  const segs = [];
  const path = _path.map((seg) => typeof seg === "object" ? seg.key : seg);
  for (const seg of path) {
    if (typeof seg === "number")
      segs.push(`[${seg}]`);
    else if (typeof seg === "symbol")
      segs.push(`[${JSON.stringify(String(seg))}]`);
    else if (/[^\w$]/.test(seg))
      segs.push(`[${JSON.stringify(seg)}]`);
    else {
      if (segs.length)
        segs.push(".");
      segs.push(seg);
    }
  }
  return segs.join("");
}
function prettifyError(error2) {
  const lines = [];
  const issues = [...error2.issues].sort((a, b) => (a.path ?? []).length - (b.path ?? []).length);
  for (const issue2 of issues) {
    lines.push(`✖ ${issue2.message}`);
    if (issue2.path?.length)
      lines.push(`  → at ${toDotPath(issue2.path)}`);
  }
  return lines.join("\n");
}
var _messageDesc, _issuesDesc, _installedToString, initializer, $ZodError, $ZodRealError;
var init_errors = __esm({
  "node_modules/zod/v4/core/errors.js"() {
    init_core();
    init_util();
    _messageDesc = {
      get: _getMessage,
      set: _setMessage,
      enumerable: true,
      configurable: true
    };
    _issuesDesc = { value: void 0, enumerable: false };
    _installedToString = /* @__PURE__ */ new WeakSet([Object.prototype, Error.prototype]);
    initializer = (inst, def) => {
      inst.name = "$ZodError";
      _issuesDesc.value = def;
      Object.defineProperty(inst, "issues", _issuesDesc);
      _issuesDesc.value = void 0;
      Object.defineProperty(inst, "message", _messageDesc);
      const proto = Object.getPrototypeOf(inst);
      if (!_installedToString.has(proto)) {
        _installedToString.add(proto);
        Object.defineProperty(proto, "toString", {
          configurable: true,
          enumerable: false,
          get() {
            const value = () => this.message;
            Object.defineProperty(this, "toString", { value, configurable: true, writable: true });
            return value;
          },
          set(value) {
            Object.defineProperty(this, "toString", { value, configurable: true, writable: true });
          }
        });
      }
    };
    $ZodError = $constructor("$ZodError", initializer);
    $ZodRealError = $constructor("$ZodError", initializer, void 0, {
      Parent: Error
    });
  }
});

// node_modules/zod/v4/core/parse.js
function finalizeParams(callee, params) {
  return { callee: params?.callee ?? callee, Err: params?.Err };
}
function failure(Err, issues, ctx) {
  let error2;
  return {
    success: false,
    get error() {
      if (!error2) {
        error2 = new Err(issues.map((iss) => finalizeIssue(iss, ctx, config())));
        issues = void 0;
        ctx = void 0;
      }
      return error2;
    },
    set error(e) {
      error2 = e;
      issues = void 0;
      ctx = void 0;
    }
  };
}
function validateFallback(schema, value, _ctx) {
  const ctx = _ctx ? { ..._ctx, async: false, abortEarly: true } : { async: false, abortEarly: true };
  const fallbackRun = schema._zod.bag.fallbackRun;
  let result;
  if (fallbackRun) {
    ctx[COMPILE_FALLBACK] = true;
    result = fallbackRun({ value, issues: [] }, ctx);
  } else {
    result = schema._zod.run({ value, issues: [] }, ctx);
  }
  if (result instanceof Promise) {
    throw new $ZodAsyncError();
  }
  return result.issues.length === 0;
}
var _parse, parse, _parseAsync, parseAsync, _safeParse, safeParse, _safeParseAsync, safeParseAsync, COMPILE_INVALID, COMPILE_FALLBACK, validate, validateAsync, _encode, encode, _decode, decode, _encodeAsync, encodeAsync, _decodeAsync, decodeAsync, _safeEncode, safeEncode, _safeDecode, safeDecode, _safeEncodeAsync, safeEncodeAsync, _safeDecodeAsync, safeDecodeAsync;
var init_parse = __esm({
  "node_modules/zod/v4/core/parse.js"() {
    init_core();
    init_errors();
    init_util();
    _parse = (_Err) => {
      const fn = (schema, value, _ctx, _params) => {
        const ctx = _ctx ? { ..._ctx, async: false } : { async: false };
        const result = schema._zod.run({ value, issues: [] }, ctx);
        if (result instanceof Promise) {
          throw new $ZodAsyncError();
        }
        if (result.issues.length) {
          const e = new (_params?.Err ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
          captureStackTrace(e, _params?.callee ?? fn);
          throw e;
        }
        return result.value;
      };
      return fn;
    };
    parse = /* @__PURE__ */ _parse($ZodRealError);
    _parseAsync = (_Err) => {
      const fn = async (schema, value, _ctx, params) => {
        const ctx = _ctx ? { ..._ctx, async: true } : { async: true };
        let result = schema._zod.run({ value, issues: [] }, ctx);
        if (result instanceof Promise)
          result = await result;
        if (result.issues.length) {
          const e = new (params?.Err ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
          captureStackTrace(e, params?.callee ?? fn);
          throw e;
        }
        return result.value;
      };
      return fn;
    };
    parseAsync = /* @__PURE__ */ _parseAsync($ZodRealError);
    _safeParse = (_Err) => (schema, value, _ctx) => {
      const ctx = _ctx ? { ..._ctx, async: false } : { async: false };
      const result = schema._zod.run({ value, issues: [] }, ctx);
      if (result instanceof Promise) {
        throw new $ZodAsyncError();
      }
      return result.issues.length ? failure(_Err, result.issues, ctx) : { success: true, data: result.value };
    };
    safeParse = /* @__PURE__ */ _safeParse($ZodRealError);
    _safeParseAsync = (_Err) => async (schema, value, _ctx) => {
      const ctx = _ctx ? { ..._ctx, async: true } : { async: true };
      let result = schema._zod.run({ value, issues: [] }, ctx);
      if (result instanceof Promise)
        result = await result;
      return result.issues.length ? failure(_Err, result.issues, ctx) : { success: true, data: result.value };
    };
    safeParseAsync = /* @__PURE__ */ _safeParseAsync($ZodRealError);
    COMPILE_INVALID = /* @__PURE__ */ Symbol.for("zod.compile.invalid");
    COMPILE_FALLBACK = /* @__PURE__ */ Symbol.for("zod.compile.fallback");
    validate = ((schema, value, _ctx) => {
      const validator = schema._zod.bag.validator;
      if (validator !== void 0) {
        if (validator(value) !== COMPILE_INVALID)
          return true;
        if (validator.definite === true && _ctx === void 0)
          return false;
      }
      return validateFallback(schema, value, _ctx);
    });
    validateAsync = async (schema, value, _ctx) => {
      const ctx = _ctx ? { ..._ctx, async: true, abortEarly: true } : { async: true, abortEarly: true };
      let result = schema._zod.run({ value, issues: [] }, ctx);
      if (result instanceof Promise)
        result = await result;
      return result.issues.length === 0;
    };
    _encode = (_Err) => {
      const parse4 = _parse(_Err);
      const fn = (schema, value, _ctx, _params) => {
        const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
        return parse4(schema, value, ctx, finalizeParams(fn, _params));
      };
      return fn;
    };
    encode = /* @__PURE__ */ _encode($ZodRealError);
    _decode = (_Err) => {
      const parse4 = _parse(_Err);
      const fn = (schema, value, _ctx, _params) => {
        return parse4(schema, value, _ctx, finalizeParams(fn, _params));
      };
      return fn;
    };
    decode = /* @__PURE__ */ _decode($ZodRealError);
    _encodeAsync = (_Err) => {
      const parseAsync3 = _parseAsync(_Err);
      const fn = async (schema, value, _ctx, _params) => {
        const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
        return await parseAsync3(schema, value, ctx, finalizeParams(fn, _params));
      };
      return fn;
    };
    encodeAsync = /* @__PURE__ */ _encodeAsync($ZodRealError);
    _decodeAsync = (_Err) => {
      const parseAsync3 = _parseAsync(_Err);
      const fn = async (schema, value, _ctx, _params) => {
        return await parseAsync3(schema, value, _ctx, finalizeParams(fn, _params));
      };
      return fn;
    };
    decodeAsync = /* @__PURE__ */ _decodeAsync($ZodRealError);
    _safeEncode = (_Err) => (schema, value, _ctx) => {
      const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
      return _safeParse(_Err)(schema, value, ctx);
    };
    safeEncode = /* @__PURE__ */ _safeEncode($ZodRealError);
    _safeDecode = (_Err) => (schema, value, _ctx) => {
      return _safeParse(_Err)(schema, value, _ctx);
    };
    safeDecode = /* @__PURE__ */ _safeDecode($ZodRealError);
    _safeEncodeAsync = (_Err) => async (schema, value, _ctx) => {
      const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
      return _safeParseAsync(_Err)(schema, value, ctx);
    };
    safeEncodeAsync = /* @__PURE__ */ _safeEncodeAsync($ZodRealError);
    _safeDecodeAsync = (_Err) => async (schema, value, _ctx) => {
      return _safeParseAsync(_Err)(schema, value, _ctx);
    };
    safeDecodeAsync = /* @__PURE__ */ _safeDecodeAsync($ZodRealError);
  }
});

// node_modules/zod/v4/core/regexes.js
var regexes_exports = {};
__export(regexes_exports, {
  anyString: () => anyString,
  base64: () => base64,
  base64url: () => base64url,
  bigint: () => bigint,
  boolean: () => boolean,
  browserEmail: () => browserEmail,
  cidrv4: () => cidrv4,
  cidrv6: () => cidrv6,
  creditCard: () => creditCard,
  cuid: () => cuid,
  cuid2: () => cuid2,
  currencyCode: () => currencyCode,
  date: () => date,
  datetime: () => datetime,
  domain: () => domain,
  duration: () => duration,
  e164: () => e164,
  email: () => email,
  emoji: () => emoji,
  extendedDuration: () => extendedDuration,
  guid: () => guid,
  hex: () => hex,
  hostname: () => hostname,
  html5Email: () => html5Email,
  httpProtocol: () => httpProtocol,
  iban: () => iban,
  idnEmail: () => idnEmail,
  integer: () => integer,
  ipv4: () => ipv4,
  ipv6: () => ipv6,
  ksuid: () => ksuid,
  lowercase: () => lowercase,
  mac: () => mac,
  md5_base64: () => md5_base64,
  md5_base64url: () => md5_base64url,
  md5_hex: () => md5_hex,
  nanoid: () => nanoid,
  nanoidOfLength: () => nanoidOfLength,
  null: () => _null,
  number: () => number,
  rfc5322Email: () => rfc5322Email,
  sha1_base64: () => sha1_base64,
  sha1_base64url: () => sha1_base64url,
  sha1_hex: () => sha1_hex,
  sha256_base64: () => sha256_base64,
  sha256_base64url: () => sha256_base64url,
  sha256_hex: () => sha256_hex,
  sha384_base64: () => sha384_base64,
  sha384_base64url: () => sha384_base64url,
  sha384_hex: () => sha384_hex,
  sha512_base64: () => sha512_base64,
  sha512_base64url: () => sha512_base64url,
  sha512_hex: () => sha512_hex,
  string: () => string,
  time: () => time,
  ulid: () => ulid,
  undefined: () => _undefined,
  unicodeEmail: () => unicodeEmail,
  uppercase: () => uppercase,
  uuid: () => uuid,
  uuid4: () => uuid4,
  uuid6: () => uuid6,
  uuid7: () => uuid7,
  xid: () => xid
});
function nanoidOfLength(length) {
  return new RegExp(`^[a-zA-Z0-9_-]{${length}}$`);
}
function emoji() {
  return new RegExp(_emoji, "u");
}
function anchor(source) {
  return new RegExp(`^${source}$`);
}
function timeSource(args) {
  const hhmm = `(?:[01]\\d|2[0-3]):[0-5]\\d`;
  const regex = typeof args.precision === "number" ? args.precision === -1 ? `${hhmm}` : args.precision === 0 ? `${hhmm}:[0-5]\\d` : `${hhmm}:[0-5]\\d\\.\\d{${args.precision}}` : args.seconds ? `${hhmm}:[0-5]\\d(?:\\.\\d+)?` : `${hhmm}(?::[0-5]\\d(?:\\.\\d+)?)?`;
  return regex;
}
function time(args) {
  return new RegExp(`^${timeSource(args)}$`);
}
function datetime(args) {
  const opts = ["Z"];
  if (args.offset)
    opts.push(`([+-](?:[01]\\d|2[0-3]):[0-5]\\d)`);
  const qualified = `${timeSource({ precision: args.precision, seconds: true })}(?:${opts.join("|")})`;
  const timeRegex = args.local ? `${qualified}|${timeSource({ precision: args.precision })}` : qualified;
  return new RegExp(`^${dateSource}T(?:${timeRegex})$`);
}
function fixedBase64(bodyLength, padding) {
  return new RegExp(`^[A-Za-z0-9+/]{${bodyLength}}${padding}$`);
}
function fixedBase64url(length) {
  return new RegExp(`^[A-Za-z0-9_-]{${length}}$`);
}
var cuid, cuid2, ulid, xid, ksuid, nanoid, duration, extendedDuration, guid, uuid, uuid4, uuid6, uuid7, email, html5Email, rfc5322Email, unicodeEmail, idnEmail, browserEmail, _emoji, ipv4, ipv6, mac, cidrv4, cidrv6, base64, base64url, hostname, domain, httpProtocol, e164, creditCard, currencyCode, iban, dateSource, date, anyString, string, bigint, integer, number, boolean, _null, _undefined, lowercase, uppercase, hex, md5_hex, md5_base64, md5_base64url, sha1_hex, sha1_base64, sha1_base64url, sha256_hex, sha256_base64, sha256_base64url, sha384_hex, sha384_base64, sha384_base64url, sha512_hex, sha512_base64, sha512_base64url;
var init_regexes = __esm({
  "node_modules/zod/v4/core/regexes.js"() {
    init_util();
    cuid = /^[cC][0-9a-z]{6,}$/;
    cuid2 = /^[0-9a-z]+$/;
    ulid = /^[0-7][0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{25}$/;
    xid = /^[0-9a-vA-V]{20}$/;
    ksuid = /^[A-Za-z0-9]{27}$/;
    nanoid = /^[a-zA-Z0-9_-]{21}$/;
    duration = /^P(?:(\d+W)|(?!.*W)(?=\d|T\d)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+([.,]\d+)?S)?)?)$/;
    extendedDuration = /^[-+]?P(?!$)(?:(?:[-+]?\d+Y)|(?:[-+]?\d+[.,]\d+Y$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:(?:[-+]?\d+W)|(?:[-+]?\d+[.,]\d+W$))?(?:(?:[-+]?\d+D)|(?:[-+]?\d+[.,]\d+D$))?(?:T(?=[\d+-])(?:(?:[-+]?\d+H)|(?:[-+]?\d+[.,]\d+H$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:[-+]?\d+(?:[.,]\d+)?S)?)??$/;
    guid = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;
    uuid = (version2) => {
      if (!version2)
        return /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/;
      return new RegExp(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-${version2}[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$`);
    };
    uuid4 = /* @__PURE__ */ uuid(4);
    uuid6 = /* @__PURE__ */ uuid(6);
    uuid7 = /* @__PURE__ */ uuid(7);
    email = /^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;
    html5Email = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
    rfc5322Email = /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
    unicodeEmail = /^[^\s@"]{1,64}@[^\s@]{1,255}$/u;
    idnEmail = unicodeEmail;
    browserEmail = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
    _emoji = `^(?=[\\s\\S]*[\\p{Extended_Pictographic}\\p{Regional_Indicator}\\u20E3])[\\p{Extended_Pictographic}\\p{Emoji_Component}]+$`;
    ipv4 = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
    ipv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/;
    mac = (delimiter) => {
      const escapedDelim = escapeRegex(delimiter ?? ":");
      return new RegExp(`^(?:[0-9A-F]{2}${escapedDelim}){5}[0-9A-F]{2}$|^(?:[0-9a-f]{2}${escapedDelim}){5}[0-9a-f]{2}$`);
    };
    cidrv4 = /^((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/([0-9]|[1-2][0-9]|3[0-2])$/;
    cidrv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
    base64 = /^$|^(?:[0-9a-zA-Z+/]{4})*(?:(?:[0-9a-zA-Z+/]{2}==)|(?:[0-9a-zA-Z+/]{3}=))?$/;
    base64url = /^(?:[A-Za-z0-9_-]{4})*(?:[A-Za-z0-9_-]{2,3})?$/;
    hostname = /^(?=.{1,253}\.?$)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[-0-9a-zA-Z]{0,61}[0-9a-zA-Z])?)*\.?$/;
    domain = /^(?=.{1,253}$)([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/;
    httpProtocol = /^https?$/;
    e164 = /^\+[1-9]\d{6,14}$/;
    creditCard = /^\d(?:[ -]?\d){11,18}$/;
    currencyCode = /^(?:AED|AFN|ALL|AMD|AOA|ARS|AUD|AWG|AZN|BAM|BBD|BDT|BHD|BIF|BMD|BND|BOB|BOV|BRL|BSD|BTN|BWP|BYN|BZD|CAD|CDF|CHE|CHF|CHW|CLF|CLP|CNY|COP|COU|CRC|CUP|CVE|CZK|DJF|DKK|DOP|DZD|EGP|ERN|ETB|EUR|FJD|FKP|GBP|GEL|GHS|GIP|GMD|GNF|GTQ|GYD|HKD|HNL|HTG|HUF|IDR|ILS|INR|IQD|IRR|ISK|JMD|JOD|JPY|KES|KGS|KHR|KMF|KPW|KRW|KWD|KYD|KZT|LAK|LBP|LKR|LRD|LSL|LYD|MAD|MDL|MGA|MKD|MMK|MNT|MOP|MRU|MUR|MVR|MWK|MXN|MXV|MYR|MZN|NAD|NGN|NIO|NOK|NPR|NZD|OMR|PAB|PEN|PGK|PHP|PKR|PLN|PYG|QAR|RON|RSD|RUB|RWF|SAR|SBD|SCR|SDG|SEK|SGD|SHP|SLE|SOS|SRD|SSP|STN|SVC|SYP|SZL|THB|TJS|TMT|TND|TOP|TRY|TTD|TWD|TZS|UAH|UGX|USD|USN|UYI|UYU|UYW|UZS|VED|VES|VND|VUV|WST|XAD|XAF|XAG|XAU|XBA|XBB|XBC|XBD|XCD|XCG|XDR|XOF|XPD|XPF|XPT|XSU|XTS|XUA|XXX|YER|ZAR|ZMW|ZWG)$/;
    iban = /^[A-Z]{2}(?!00|01|99)\d{2}[A-Z0-9]{11,30}$/;
    dateSource = `(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))`;
    date = /* @__PURE__ */ anchor(dateSource);
    anyString = /^[\s\S]{0,}$/;
    string = (params) => {
      const regex = params ? `[\\s\\S]{${params?.minimum ?? 0},${params?.maximum ?? ""}}` : `[\\s\\S]*`;
      return new RegExp(`^${regex}$`);
    };
    bigint = /^-?\d+n?$/;
    integer = /^-?\d+$/;
    number = /^-?\d+(?:\.\d+)?$/;
    boolean = /^(?:true|false)$/i;
    _null = /^null$/i;
    _undefined = /^undefined$/i;
    lowercase = /^[^A-Z]*$/;
    uppercase = /^[^a-z]*$/;
    hex = /^[0-9a-fA-F]*$/;
    md5_hex = /^[0-9a-fA-F]{32}$/;
    md5_base64 = /* @__PURE__ */ fixedBase64(22, "==");
    md5_base64url = /* @__PURE__ */ fixedBase64url(22);
    sha1_hex = /^[0-9a-fA-F]{40}$/;
    sha1_base64 = /* @__PURE__ */ fixedBase64(27, "=");
    sha1_base64url = /* @__PURE__ */ fixedBase64url(27);
    sha256_hex = /^[0-9a-fA-F]{64}$/;
    sha256_base64 = /* @__PURE__ */ fixedBase64(43, "=");
    sha256_base64url = /* @__PURE__ */ fixedBase64url(43);
    sha384_hex = /^[0-9a-fA-F]{96}$/;
    sha384_base64 = /* @__PURE__ */ fixedBase64(64, "");
    sha384_base64url = /* @__PURE__ */ fixedBase64url(64);
    sha512_hex = /^[0-9a-fA-F]{128}$/;
    sha512_base64 = /* @__PURE__ */ fixedBase64(86, "==");
    sha512_base64url = /* @__PURE__ */ fixedBase64url(86);
  }
});

// node_modules/zod/v4/core/checks.js
function handleCheckPropertyResult(result, payload, property) {
  if (result.issues.length) {
    payload.issues.push(...prefixIssues(property, result.issues));
  }
}
var $ZodCheck, _whenHasSize, _whenHasLength, numericOriginMap, $ZodCheckLessThan, $ZodCheckGreaterThan, $ZodCheckMultipleOf, $ZodCheckNumberFormat, $ZodCheckBigIntFormat, $ZodCheckMaxSize, $ZodCheckMinSize, $ZodCheckSizeEquals, $ZodCheckMaxLength, $ZodCheckMinLength, $ZodCheckLengthEquals, $ZodCheckStringFormat, $ZodCheckRegex, $ZodCheckLowerCase, $ZodCheckUpperCase, $ZodCheckIncludes, $ZodCheckStartsWith, $ZodCheckEndsWith, $ZodCheckProperty, $ZodCheckProperties, $ZodCheckMimeType, $ZodCheckOverwrite;
var init_checks = __esm({
  "node_modules/zod/v4/core/checks.js"() {
    init_core();
    init_regexes();
    init_util();
    $ZodCheck = /* @__PURE__ */ $constructor("$ZodCheck", (inst, def) => {
      var _a3;
      inst._zod ?? (inst._zod = {});
      inst._zod.def = def;
      (_a3 = inst._zod).onattach ?? (_a3.onattach = []);
    });
    _whenHasSize = (payload) => {
      const val = payload.value;
      return !nullish(val) && val.size !== void 0;
    };
    _whenHasLength = (payload) => {
      const val = payload.value;
      return !nullish(val) && val.length !== void 0;
    };
    numericOriginMap = {
      number: "number",
      bigint: "bigint",
      object: "date"
    };
    $ZodCheckLessThan = /* @__PURE__ */ $constructor("$ZodCheckLessThan", (inst, def) => {
      $ZodCheck.init(inst, def);
      const origin = numericOriginMap[typeof def.value];
      inst._zod.check = (payload) => {
        if (def.inclusive ? payload.value <= def.value : payload.value < def.value) {
          return;
        }
        payload.issues.push({
          origin: numericOriginMap[typeof payload.value] ?? origin,
          code: "too_big",
          maximum: typeof def.value === "object" ? def.value.getTime() : def.value,
          input: payload.value,
          inclusive: def.inclusive,
          inst,
          continue: !def.abort
        });
      };
    });
    $ZodCheckGreaterThan = /* @__PURE__ */ $constructor("$ZodCheckGreaterThan", (inst, def) => {
      $ZodCheck.init(inst, def);
      const origin = numericOriginMap[typeof def.value];
      inst._zod.check = (payload) => {
        if (def.inclusive ? payload.value >= def.value : payload.value > def.value) {
          return;
        }
        payload.issues.push({
          origin: numericOriginMap[typeof payload.value] ?? origin,
          code: "too_small",
          minimum: typeof def.value === "object" ? def.value.getTime() : def.value,
          input: payload.value,
          inclusive: def.inclusive,
          inst,
          continue: !def.abort
        });
      };
    });
    $ZodCheckMultipleOf = /* @__PURE__ */ $constructor("$ZodCheckMultipleOf", (inst, def) => {
      $ZodCheck.init(inst, def);
      inst._zod.check = (payload) => {
        if (typeof payload.value !== typeof def.value)
          throw new Error("Cannot mix number and bigint in multiple_of check.");
        const isMultiple = typeof payload.value === "bigint" ? (
          // `value % 0n` throws, and nothing is a multiple of zero — the number branch already fails this way via NaN
          def.value !== BigInt(0) && payload.value % def.value === BigInt(0)
        ) : floatSafeRemainder(payload.value, def.value) === 0;
        if (isMultiple)
          return;
        payload.issues.push({
          origin: typeof payload.value,
          code: "not_multiple_of",
          divisor: def.value,
          input: payload.value,
          inst,
          continue: !def.abort
        });
      };
    });
    $ZodCheckNumberFormat = /* @__PURE__ */ $constructor("$ZodCheckNumberFormat", (inst, def) => {
      $ZodCheck.init(inst, def);
      def.format = def.format || "float64";
      const isInt = def.format?.includes("int");
      const origin = isInt ? "int" : "number";
      const [minimum, maximum] = NUMBER_FORMAT_RANGES[def.format];
      inst._zod.check = (payload) => {
        const input2 = payload.value;
        if (isInt) {
          if (!Number.isInteger(input2)) {
            payload.issues.push({
              expected: origin,
              format: def.format,
              code: "invalid_type",
              continue: false,
              input: input2,
              inst
            });
            return;
          }
          if (!Number.isSafeInteger(input2)) {
            if (input2 > 0) {
              payload.issues.push({
                input: input2,
                code: "too_big",
                maximum: Number.MAX_SAFE_INTEGER,
                note: "Integers must be within the safe integer range.",
                inst,
                origin,
                inclusive: true,
                continue: !def.abort
              });
            } else {
              payload.issues.push({
                input: input2,
                code: "too_small",
                minimum: Number.MIN_SAFE_INTEGER,
                note: "Integers must be within the safe integer range.",
                inst,
                origin,
                inclusive: true,
                continue: !def.abort
              });
            }
            return;
          }
        }
        if (input2 < minimum) {
          payload.issues.push({
            origin: "number",
            input: input2,
            code: "too_small",
            minimum,
            inclusive: true,
            inst,
            continue: !def.abort
          });
        }
        if (input2 > maximum) {
          payload.issues.push({
            origin: "number",
            input: input2,
            code: "too_big",
            maximum,
            inclusive: true,
            inst,
            continue: !def.abort
          });
        }
      };
    });
    $ZodCheckBigIntFormat = /* @__PURE__ */ $constructor("$ZodCheckBigIntFormat", (inst, def) => {
      $ZodCheck.init(inst, def);
      const [minimum, maximum] = BIGINT_FORMAT_RANGES[def.format];
      inst._zod.check = (payload) => {
        const input2 = payload.value;
        if (input2 < minimum) {
          payload.issues.push({
            origin: "bigint",
            input: input2,
            code: "too_small",
            minimum,
            inclusive: true,
            inst,
            continue: !def.abort
          });
        }
        if (input2 > maximum) {
          payload.issues.push({
            origin: "bigint",
            input: input2,
            code: "too_big",
            maximum,
            inclusive: true,
            inst,
            continue: !def.abort
          });
        }
      };
    });
    $ZodCheckMaxSize = /* @__PURE__ */ $constructor("$ZodCheckMaxSize", (inst, def) => {
      var _a3;
      $ZodCheck.init(inst, def);
      (_a3 = inst._zod.def).when ?? (_a3.when = _whenHasSize);
      inst._zod.check = (payload) => {
        const input2 = payload.value;
        const size = input2.size;
        if (size <= def.maximum)
          return;
        payload.issues.push({
          origin: getSizableOrigin(input2),
          code: "too_big",
          maximum: def.maximum,
          inclusive: true,
          input: input2,
          inst,
          continue: !def.abort
        });
      };
    });
    $ZodCheckMinSize = /* @__PURE__ */ $constructor("$ZodCheckMinSize", (inst, def) => {
      var _a3;
      $ZodCheck.init(inst, def);
      (_a3 = inst._zod.def).when ?? (_a3.when = _whenHasSize);
      inst._zod.check = (payload) => {
        const input2 = payload.value;
        const size = input2.size;
        if (size >= def.minimum)
          return;
        payload.issues.push({
          origin: getSizableOrigin(input2),
          code: "too_small",
          minimum: def.minimum,
          inclusive: true,
          input: input2,
          inst,
          continue: !def.abort
        });
      };
    });
    $ZodCheckSizeEquals = /* @__PURE__ */ $constructor("$ZodCheckSizeEquals", (inst, def) => {
      var _a3;
      $ZodCheck.init(inst, def);
      (_a3 = inst._zod.def).when ?? (_a3.when = _whenHasSize);
      inst._zod.check = (payload) => {
        const input2 = payload.value;
        const size = input2.size;
        if (size === def.size)
          return;
        const tooBig = size > def.size;
        payload.issues.push({
          origin: getSizableOrigin(input2),
          ...tooBig ? { code: "too_big", maximum: def.size } : { code: "too_small", minimum: def.size },
          inclusive: true,
          exact: true,
          input: payload.value,
          inst,
          continue: !def.abort
        });
      };
    });
    $ZodCheckMaxLength = /* @__PURE__ */ $constructor("$ZodCheckMaxLength", (inst, def) => {
      var _a3;
      $ZodCheck.init(inst, def);
      (_a3 = inst._zod.def).when ?? (_a3.when = _whenHasLength);
      inst._zod.check = (payload) => {
        const input2 = payload.value;
        const units = input2.length;
        const length = typeof input2 === "string" && units > def.maximum ? codePointLength(input2) : units;
        if (length <= def.maximum)
          return;
        const origin = getLengthableOrigin(input2);
        payload.issues.push({
          origin,
          code: "too_big",
          maximum: def.maximum,
          inclusive: true,
          input: input2,
          inst,
          continue: !def.abort
        });
      };
    });
    $ZodCheckMinLength = /* @__PURE__ */ $constructor("$ZodCheckMinLength", (inst, def) => {
      var _a3;
      $ZodCheck.init(inst, def);
      (_a3 = inst._zod.def).when ?? (_a3.when = _whenHasLength);
      inst._zod.check = (payload) => {
        const input2 = payload.value;
        const units = input2.length;
        const length = typeof input2 === "string" && units >= def.minimum && units < def.minimum * 2 ? codePointLength(input2) : units;
        if (length >= def.minimum)
          return;
        const origin = getLengthableOrigin(input2);
        payload.issues.push({
          origin,
          code: "too_small",
          minimum: def.minimum,
          inclusive: true,
          input: input2,
          inst,
          continue: !def.abort
        });
      };
    });
    $ZodCheckLengthEquals = /* @__PURE__ */ $constructor("$ZodCheckLengthEquals", (inst, def) => {
      var _a3;
      $ZodCheck.init(inst, def);
      (_a3 = inst._zod.def).when ?? (_a3.when = _whenHasLength);
      inst._zod.check = (payload) => {
        const input2 = payload.value;
        const units = input2.length;
        const length = typeof input2 === "string" && units >= def.length && units <= def.length * 2 ? codePointLength(input2) : units;
        if (length === def.length)
          return;
        const origin = getLengthableOrigin(input2);
        const tooBig = length > def.length;
        payload.issues.push({
          origin,
          ...tooBig ? { code: "too_big", maximum: def.length } : { code: "too_small", minimum: def.length },
          inclusive: true,
          exact: true,
          input: payload.value,
          inst,
          continue: !def.abort
        });
      };
    });
    $ZodCheckStringFormat = /* @__PURE__ */ $constructor("$ZodCheckStringFormat", (inst, def) => {
      var _a3, _b;
      $ZodCheck.init(inst, def);
      if (def.pattern)
        (_a3 = inst._zod).check ?? (_a3.check = (payload) => {
          def.pattern.lastIndex = 0;
          if (def.pattern.test(payload.value))
            return;
          payload.issues.push({
            origin: "string",
            code: "invalid_format",
            format: def.format,
            input: payload.value,
            ...def.pattern ? { pattern: def.pattern.toString() } : {},
            inst,
            continue: !def.abort
          });
        });
      else
        (_b = inst._zod).check ?? (_b.check = () => {
        });
    });
    $ZodCheckRegex = /* @__PURE__ */ $constructor("$ZodCheckRegex", (inst, def) => {
      $ZodCheckStringFormat.init(inst, def);
      inst._zod.check = (payload) => {
        def.pattern.lastIndex = 0;
        if (def.pattern.test(payload.value))
          return;
        payload.issues.push({
          origin: "string",
          code: "invalid_format",
          format: "regex",
          input: payload.value,
          pattern: def.pattern.toString(),
          inst,
          continue: !def.abort
        });
      };
    });
    $ZodCheckLowerCase = /* @__PURE__ */ $constructor("$ZodCheckLowerCase", (inst, def) => {
      def.pattern ?? (def.pattern = lowercase);
      $ZodCheckStringFormat.init(inst, def);
    });
    $ZodCheckUpperCase = /* @__PURE__ */ $constructor("$ZodCheckUpperCase", (inst, def) => {
      def.pattern ?? (def.pattern = uppercase);
      $ZodCheckStringFormat.init(inst, def);
    });
    $ZodCheckIncludes = /* @__PURE__ */ $constructor("$ZodCheckIncludes", (inst, def) => {
      $ZodCheck.init(inst, def);
      const escapedRegex = escapeRegex(def.includes);
      const pattern = new RegExp(typeof def.position === "number" ? `^.{${def.position},}${escapedRegex}` : escapedRegex);
      def.pattern = pattern;
      inst._zod.check = (payload) => {
        if (payload.value.includes(def.includes, def.position))
          return;
        payload.issues.push({
          origin: "string",
          code: "invalid_format",
          format: "includes",
          includes: def.includes,
          input: payload.value,
          inst,
          continue: !def.abort
        });
      };
    });
    $ZodCheckStartsWith = /* @__PURE__ */ $constructor("$ZodCheckStartsWith", (inst, def) => {
      $ZodCheck.init(inst, def);
      const pattern = new RegExp(`^${escapeRegex(def.prefix)}.*`);
      def.pattern ?? (def.pattern = pattern);
      inst._zod.check = (payload) => {
        if (payload.value.startsWith(def.prefix))
          return;
        payload.issues.push({
          origin: "string",
          code: "invalid_format",
          format: "starts_with",
          prefix: def.prefix,
          input: payload.value,
          inst,
          continue: !def.abort
        });
      };
    });
    $ZodCheckEndsWith = /* @__PURE__ */ $constructor("$ZodCheckEndsWith", (inst, def) => {
      $ZodCheck.init(inst, def);
      const pattern = new RegExp(`.*${escapeRegex(def.suffix)}$`);
      def.pattern ?? (def.pattern = pattern);
      inst._zod.check = (payload) => {
        if (payload.value.endsWith(def.suffix))
          return;
        payload.issues.push({
          origin: "string",
          code: "invalid_format",
          format: "ends_with",
          suffix: def.suffix,
          input: payload.value,
          inst,
          continue: !def.abort
        });
      };
    });
    $ZodCheckProperty = /* @__PURE__ */ $constructor("$ZodCheckProperty", (inst, def) => {
      $ZodCheck.init(inst, def);
      inst._zod.check = (payload) => {
        const result = def.schema._zod.run({
          value: payload.value[def.property],
          issues: []
        }, {});
        if (result instanceof Promise) {
          return result.then((result2) => handleCheckPropertyResult(result2, payload, def.property));
        }
        handleCheckPropertyResult(result, payload, def.property);
        return;
      };
    });
    $ZodCheckProperties = /* @__PURE__ */ $constructor("$ZodCheckProperties", (inst, def) => {
      $ZodCheck.init(inst, def);
      hide(inst, Symbol.iterator, function* () {
        yield inst;
      });
      let entries;
      inst._zod.check = (payload) => {
        if (payload.value == null) {
          payload.issues.push({ expected: "object", code: "invalid_type", input: payload.value, inst });
          return void 0;
        }
        entries ?? (entries = Reflect.ownKeys(def.shape).map((key) => [key, def.shape[key]]));
        const input2 = payload.value;
        let proms;
        for (const [key, schema] of entries) {
          const result = schema._zod.run({ value: input2[key], issues: [] }, {});
          if (result instanceof Promise) {
            proms ?? (proms = []);
            proms.push(result.then((result2) => handleCheckPropertyResult(result2, payload, key)));
          } else {
            handleCheckPropertyResult(result, payload, key);
          }
        }
        if (proms)
          return Promise.all(proms).then(() => void 0);
        return void 0;
      };
    });
    $ZodCheckMimeType = /* @__PURE__ */ $constructor("$ZodCheckMimeType", (inst, def) => {
      $ZodCheck.init(inst, def);
      const mimeSet = new Set(def.mime);
      inst._zod.check = (payload) => {
        if (mimeSet.has(payload.value.type))
          return;
        payload.issues.push({
          code: "invalid_value",
          values: def.mime,
          input: payload.value.type,
          inst,
          continue: !def.abort
        });
      };
    });
    $ZodCheckOverwrite = /* @__PURE__ */ $constructor("$ZodCheckOverwrite", (inst, def) => {
      $ZodCheck.init(inst, def);
      inst._zod.check = (payload) => {
        payload.value = def.tx(payload.value);
      };
    });
  }
});

// node_modules/zod/v4/core/doc.js
var Doc;
var init_doc = __esm({
  "node_modules/zod/v4/core/doc.js"() {
    Doc = class {
      constructor(args = [], closed = {}) {
        this.content = [];
        this.indent = 0;
        this.args = args;
        this.closed = closed;
      }
      // the compiler catches a child's throw and keeps writing into this doc, so the indent has to unwind with it
      indented(fn) {
        this.indent += 1;
        try {
          fn(this);
        } finally {
          this.indent -= 1;
        }
      }
      write(arg) {
        if (typeof arg === "function") {
          arg(this, { execution: "sync" });
          arg(this, { execution: "async" });
          return;
        }
        const content = arg;
        const lines = content.split("\n").filter((x) => x);
        const minIndent = Math.min(...lines.map((x) => x.length - x.trimStart().length));
        const dedented = lines.map((x) => x.slice(minIndent)).map((x) => " ".repeat(this.indent * 2) + x);
        for (const line of dedented) {
          this.content.push(line);
        }
      }
      compile() {
        const F = Function;
        const content = this?.content ?? [``];
        const factory = new F(...Object.keys(this.closed), `return function (${this.args.join(", ")}) {
${content.join("\n")}
};`);
        return factory(...Object.values(this.closed));
      }
    };
  }
});

// node_modules/zod/v4/core/versions.js
var version;
var init_versions = __esm({
  "node_modules/zod/v4/core/versions.js"() {
    version = {
      major: 4,
      minor: 6,
      patch: 5
    };
  }
});

// node_modules/zod/v4/core/schemas.js
async function validateAsync2(inst, value) {
  const ctx = { async: true };
  return toStandardResult(await inst._zod.run({ value, issues: [] }, ctx), ctx);
}
function standardProps(inst) {
  return {
    validate: (value) => {
      const ctx = { async: false };
      try {
        const r = inst._zod.run({ value, issues: [] }, ctx);
        if (!(r instanceof Promise))
          return toStandardResult(r, ctx);
      } catch (_) {
      }
      return validateAsync2(inst, value);
    },
    vendor: "zod",
    version: 1
  };
}
function canParseURL(input2) {
  try {
    if (typeof URL !== "undefined" && typeof URL.canParse === "function")
      return URL.canParse(input2);
    new URL(input2);
    return true;
  } catch {
    return false;
  }
}
function validateURL(trimmed, def) {
  if (!("normalize" in def) && !("hostname" in def) && !("protocol" in def)) {
    return canParseURL(trimmed) || URL_UNPARSEABLE;
  }
  return parseURLObject(trimmed, def);
}
function parseURLObject(trimmed, def) {
  if (!def.normalize && def.protocol?.source === httpProtocol.source && !/^https?:\/\//i.test(trimmed)) {
    return URL_BAD_FORMAT;
  }
  try {
    if (typeof URL !== "undefined") {
      const URLStatic = URL;
      if (typeof URLStatic.parse === "function")
        return URLStatic.parse(trimmed) ?? URL_UNPARSEABLE;
    }
    return new URL(trimmed);
  } catch {
    return URL_UNPARSEABLE;
  }
}
function stripTabAndNewline(value) {
  return value.replace(asciiTabOrNewline, "");
}
function urlHostnameOk(url2, hostname3) {
  hostname3.lastIndex = 0;
  return hostname3.test(url2.hostname);
}
function urlProtocolOk(url2, protocol) {
  protocol.lastIndex = 0;
  return protocol.test(url2.protocol.endsWith(":") ? url2.protocol.slice(0, -1) : url2.protocol);
}
function isValidIPv6(value) {
  if (!ipv6Alphabet.test(value))
    return false;
  return canParseURL(`http://[${value}]`);
}
function isValidCIDRv6(value) {
  const parts = value.split("/");
  if (parts.length !== 2)
    return false;
  const [address, prefix] = parts;
  if (!prefix)
    return false;
  const prefixNum = Number(prefix);
  if (`${prefixNum}` !== prefix)
    return false;
  if (prefixNum < 0 || prefixNum > 128)
    return false;
  return isValidIPv6(address);
}
function isValidBase64(data) {
  if (data === "")
    return true;
  if (/\s/.test(data))
    return false;
  if (data.length % 4 !== 0)
    return false;
  try {
    atob(data);
    return true;
  } catch {
    return false;
  }
}
function isValidBase64URL(data) {
  if (!base64urlCharset.test(data))
    return false;
  const base643 = data.replace(/[-_]/g, (c) => c === "-" ? "+" : "/");
  const padded = base643.padEnd(Math.ceil(base643.length / 4) * 4, "=");
  return isValidBase64(padded);
}
function isLuhnAlgo(digits) {
  let length = digits.length;
  let bit = 1;
  let sum = 0;
  while (length) {
    const value = digits.charCodeAt(--length) - 48;
    bit ^= 1;
    sum += bit ? [0, 2, 4, 6, 8, 1, 3, 5, 7, 9][value] : value;
  }
  return sum % 10 === 0;
}
function isValidCreditCard(input2) {
  if (!creditCard.test(input2))
    return false;
  return isLuhnAlgo(input2.replace(CC_SANITIZE, ""));
}
function isIso7064Mod97(iban3) {
  let remainder = 0;
  const len = iban3.length;
  for (let i = 4; i < len; i++) {
    const code = iban3.charCodeAt(i);
    remainder = (code >= 65 ? remainder * 100 + (code - 55) : remainder * 10 + (code - 48)) % 97;
  }
  for (let i = 0; i < 4; i++) {
    const code = iban3.charCodeAt(i);
    remainder = (code >= 65 ? remainder * 100 + (code - 55) : remainder * 10 + (code - 48)) % 97;
  }
  return remainder === 1;
}
function isValidIBAN(input2) {
  if (!iban.test(input2))
    return false;
  return isIso7064Mod97(input2);
}
function isValidJWT(token, algorithm = null) {
  try {
    const tokensParts = token.split(".");
    if (tokensParts.length !== 3)
      return false;
    const [header] = tokensParts;
    if (!header)
      return false;
    const parsedHeader = JSON.parse(atob(header));
    if ("typ" in parsedHeader && parsedHeader?.typ !== "JWT")
      return false;
    if (!parsedHeader.alg)
      return false;
    if (algorithm && (!("alg" in parsedHeader) || parsedHeader.alg !== algorithm))
      return false;
    return true;
  } catch {
    return false;
  }
}
function handleArrayResult(result, final, index) {
  if (result.issues.length) {
    final.issues.push(...prefixIssues(index, result.issues));
  }
  final.value[index] = result.value;
}
function handlePropertyResult(result, final, key, input2, optin, optout) {
  const isPresent = key in input2;
  const isOptionalOut = optout === "optional";
  if (!isPresent && isOptionalOut && optin === "optional") {
    return;
  }
  if (result.issues.length) {
    if (optin !== void 0 && isOptionalOut && !isPresent) {
      return;
    }
    final.issues.push(...prefixIssues(key, result.issues));
  }
  if (!isPresent && optin === void 0) {
    if (!result.issues.length) {
      final.issues.push({
        code: "invalid_type",
        expected: "nonoptional",
        input: void 0,
        path: [key]
      });
    }
    return;
  }
  if (result.value === void 0) {
    if (isPresent || optin === "defaulted" && !isOptionalOut) {
      final.value[key] = void 0;
    }
  } else {
    final.value[key] = result.value;
  }
}
function normalizeDef(def) {
  const keys = Object.keys(def.shape);
  const ownSymbols = Object.getOwnPropertySymbols(def.shape);
  const symbolKeys = ownSymbols.length ? ownSymbols : NO_SYMBOL_KEYS;
  const allKeys = symbolKeys.length ? [...keys, ...symbolKeys] : keys;
  for (const k of allKeys) {
    if (!def.shape?.[k]?._zod?.traits?.has("$ZodType")) {
      throw new Error(`Invalid element at key "${String(k)}": expected a Zod schema`);
    }
  }
  const okeys = optionalKeys(def.shape);
  return {
    ...def,
    allKeys,
    symbolKeys,
    // string-only: handleCatchall matches it against `for...in`, which never yields a symbol
    keySet: new Set(keys),
    numKeys: keys.length,
    optionalKeys: new Set(okeys)
  };
}
function handleCatchall(proms, input2, payload, ctx, def, inst, abortEarly) {
  const unrecognized = [];
  const keySet = def.keySet;
  const _catchall = def.catchall._zod;
  const t2 = _catchall.def.type;
  const optin = _catchall.optin;
  const optout = _catchall.optout;
  let seen = 0;
  for (const key in input2) {
    if (abortEarly && payload.issues.length !== seen) {
      if (aborted(payload, seen))
        break;
      seen = payload.issues.length;
    }
    if (keySet.has(key))
      continue;
    if (key === "__proto__") {
      if (t2 === "never")
        unrecognized.push(key);
      continue;
    }
    if (t2 === "never") {
      unrecognized.push(key);
      continue;
    }
    const r = _catchall.run({ value: input2[key], issues: [] }, ctx);
    if (r instanceof Promise) {
      proms.push(r.then((r2) => handlePropertyResult(r2, payload, key, input2, optin, optout)));
    } else {
      handlePropertyResult(r, payload, key, input2, optin, optout);
    }
  }
  if (unrecognized.length) {
    payload.issues.push({
      code: "unrecognized_keys",
      keys: unrecognized,
      input: input2,
      inst,
      // Describes the shape of the input, not the validity of the parsed value, so it never aborts. The parse still fails; the schema's own checks just get to run first, and an enclosing intersection can reconcile the key against a sibling operand.
      continue: true
    });
  }
  if (!proms.length)
    return payload;
  return Promise.all(proms).then(() => {
    return payload;
  });
}
function handleUnionResults(results, final, inst, ctx) {
  for (const result of results) {
    if (result.issues.length === 0) {
      final.value = result.value;
      return final;
    }
  }
  const nonaborted = results.filter((r) => !aborted(r));
  if (nonaborted.length === 1) {
    final.value = nonaborted[0].value;
    return nonaborted[0];
  }
  final.issues.push({
    code: "invalid_union",
    input: final.value,
    inst,
    errors: results.map((result) => result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
  });
  return final;
}
function handleExclusiveUnionResults(results, final, inst, ctx) {
  const matches = [];
  for (let i = 0; i < results.length; i++) {
    if (results[i].issues.length === 0)
      matches.push(i);
  }
  if (matches.length === 1) {
    final.value = results[matches[0]].value;
    return final;
  }
  if (matches.length === 0) {
    final.issues.push({
      code: "invalid_union",
      input: final.value,
      inst,
      errors: results.map((result) => result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
    });
  } else {
    final.issues.push({
      code: "invalid_union",
      input: final.value,
      inst,
      errors: [],
      inclusive: false,
      matches
    });
  }
  return final;
}
function getDiscriminatedOption(union2, value) {
  const internals = union2._zod;
  let map2 = internals.bag.optionsMap;
  if (!map2) {
    map2 = discriminatorMap(internals.def);
    internals.bag.optionsMap = map2;
  }
  const option = map2.get(value);
  if (option === null)
    throw new Error(`Ambiguous discriminator value "${String(value)}"`);
  return option;
}
function discriminatorMap(def) {
  const map2 = /* @__PURE__ */ new Map();
  for (const option of def.options) {
    const values = option._zod.propValues?.[def.discriminator];
    if (!values || values.size === 0)
      throw new Error(`Invalid discriminated union option at index "${def.options.indexOf(option)}"`);
    for (const value of values) {
      if (map2.has(value)) {
        if (value !== void 0)
          throw new Error(`Duplicate discriminator value "${String(value)}"`);
        map2.set(value, null);
      } else {
        map2.set(value, option);
      }
    }
  }
  return map2;
}
function mergeValues(a, b) {
  if (a === b) {
    return { valid: true, data: a };
  }
  if (a instanceof Date && b instanceof Date && +a === +b) {
    return { valid: true, data: a };
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const bKeys = Object.keys(b);
    const sharedKeys = Object.keys(a).filter((key) => bKeys.indexOf(key) !== -1);
    const newObj = { ...a, ...b };
    if (Object.prototype.hasOwnProperty.call(newObj, "__proto__"))
      delete newObj.__proto__;
    for (const key of sharedKeys) {
      if (key === "__proto__")
        continue;
      const sharedValue = mergeValues(a[key], b[key]);
      if (!sharedValue.valid) {
        return {
          valid: false,
          mergeErrorPath: [key, ...sharedValue.mergeErrorPath]
        };
      }
      newObj[key] = sharedValue.data;
    }
    return { valid: true, data: newObj };
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      return { valid: false, mergeErrorPath: [] };
    }
    const newArray = [];
    for (let index = 0; index < a.length; index++) {
      const itemA = a[index];
      const itemB = b[index];
      const sharedValue = mergeValues(itemA, itemB);
      if (!sharedValue.valid) {
        return {
          valid: false,
          mergeErrorPath: [index, ...sharedValue.mergeErrorPath]
        };
      }
      newArray.push(sharedValue.data);
    }
    return { valid: true, data: newArray };
  }
  return { valid: false, mergeErrorPath: [] };
}
function handleIntersectionResults(result, left, right) {
  const unrecKeys = /* @__PURE__ */ new Map();
  let unrecIssue;
  const keyIssues = /* @__PURE__ */ new Map();
  const collect = (iss, side) => {
    let keys;
    if (iss.code === "unrecognized_keys" && !iss.path?.length) {
      unrecIssue ?? (unrecIssue = iss);
      keys = iss.keys;
    } else if (iss.code === "invalid_key" && iss.origin === "record" && iss.path?.length === 1) {
      const k = String(iss.path[0]);
      if (!keyIssues.has(k))
        keyIssues.set(k, iss);
      keys = [k];
    } else {
      return false;
    }
    for (const k of keys) {
      if (!unrecKeys.has(k))
        unrecKeys.set(k, {});
      unrecKeys.get(k)[side] = true;
    }
    return true;
  };
  for (const iss of left.issues) {
    if (!collect(iss, "l"))
      result.issues.push(iss);
  }
  for (const iss of right.issues) {
    if (!collect(iss, "r"))
      result.issues.push(iss);
  }
  const bothKeys = [...unrecKeys].filter(([, f]) => f.l && f.r).map(([k]) => k);
  if (bothKeys.length) {
    const aggregated = unrecIssue ? bothKeys.filter((k) => unrecIssue.keys.includes(k)) : [];
    if (aggregated.length)
      result.issues.push({ ...unrecIssue, keys: aggregated });
    for (const k of bothKeys) {
      if (!aggregated.includes(k) && keyIssues.has(k))
        result.issues.push(keyIssues.get(k));
    }
  }
  const merged = mergeValues(left.value, right.value);
  if (!merged.valid) {
    if (aborted(result))
      return result;
    throw new Error(`Unmergable intersection. Error path: ${JSON.stringify(merged.mergeErrorPath)}`);
  }
  result.value = merged.data;
  return result;
}
function getTupleOptStart(items, key) {
  for (let i = items.length - 1; i >= 0; i--) {
    const omittable = key === "optin" ? items[i]._zod.optin !== void 0 : items[i]._zod.optout === "optional";
    if (!omittable)
      return i + 1;
  }
  return 0;
}
function handleTupleResult(result, final, index) {
  if (result.issues.length) {
    final.issues.push(...prefixIssues(index, result.issues));
  }
  final.value[index] = result.value;
}
function handleTupleResults(itemResults, final, items, input2, optoutStart) {
  for (let i = 0; i < items.length; i++) {
    const r = itemResults[i];
    const isPresent = i < input2.length;
    if (!isPresent && i >= optoutStart && items[i]._zod.optin === "optional") {
      final.value.length = i;
      break;
    }
    if (r.issues.length) {
      if (!isPresent && i >= optoutStart) {
        final.value.length = i;
        break;
      }
      final.issues.push(...prefixIssues(i, r.issues));
    }
    final.value[i] = r.value;
  }
  for (let i = final.value.length - 1; i >= input2.length; i--) {
    if (items[i]._zod.optout === "optional" && final.value[i] === void 0) {
      final.value.length = i;
    } else {
      break;
    }
  }
  return final;
}
function handleMapResult(keyResult, valueResult, final, key, input2, inst, ctx) {
  if (keyResult.issues.length) {
    if (propertyKeyTypes.has(typeof key)) {
      final.issues.push(...prefixIssues(key, keyResult.issues));
    } else {
      final.issues.push({
        code: "invalid_key",
        origin: "map",
        input: input2,
        inst,
        issues: keyResult.issues.map((iss) => finalizeIssue(iss, ctx, config()))
      });
    }
  }
  if (valueResult.issues.length) {
    if (propertyKeyTypes.has(typeof key)) {
      final.issues.push(...prefixIssues(key, valueResult.issues));
    } else {
      final.issues.push({
        origin: "map",
        code: "invalid_element",
        input: input2,
        inst,
        key,
        issues: valueResult.issues.map((iss) => finalizeIssue(iss, ctx, config()))
      });
    }
  }
  final.value.set(keyResult.value, valueResult.value);
}
function handleSetResult(result, final) {
  if (result.issues.length) {
    final.issues.push(...result.issues);
  }
  final.value.add(result.value);
}
function handleOptionalResult(payload, result) {
  payload.value = result.issues.length ? void 0 : result.value;
  return payload;
}
function handleDefaultResult(payload, def) {
  if (payload.value === void 0) {
    payload.value = def.defaultValue;
  }
  return payload;
}
function handleNonOptionalResult(payload, inst) {
  if (!payload.issues.length && payload.value === void 0) {
    payload.issues.push({
      code: "invalid_type",
      expected: "nonoptional",
      input: payload.value,
      inst
    });
  }
  return payload;
}
function handleCatchResult(payload, result, def, ctx) {
  if (!result.issues.length) {
    payload.value = result.value;
    if (result.memo)
      payload.memo = true;
    return payload;
  }
  payload.value = def.catchValue({
    ...result,
    value: payload.value,
    error: {
      issues: result.issues.map((iss) => finalizeIssue(iss, ctx, config()))
    },
    input: payload.value
  });
  return payload;
}
function handlePipeResult(left, next, ctx) {
  if (left.issues.some((iss) => iss.code !== "unrecognized_keys")) {
    left.aborted = true;
    return left;
  }
  return next._zod.run({ value: left.value, issues: left.issues }, ctx);
}
function handleCodecAResult(result, def, ctx) {
  if (result.issues.length) {
    result.aborted = true;
    return result;
  }
  const direction = ctx.direction || "forward";
  if (direction === "forward") {
    const transformed = def.transform(result.value, result);
    if (transformed instanceof Promise) {
      return transformed.then((value) => handleCodecTxResult(result, value, def.out, ctx));
    }
    return handleCodecTxResult(result, transformed, def.out, ctx);
  } else {
    const transformed = def.reverseTransform(result.value, result);
    if (transformed instanceof Promise) {
      return transformed.then((value) => handleCodecTxResult(result, value, def.in, ctx));
    }
    return handleCodecTxResult(result, transformed, def.in, ctx);
  }
}
function handleCodecTxResult(left, value, nextSchema, ctx) {
  if (left.issues.length) {
    left.aborted = true;
    return left;
  }
  return nextSchema._zod.run({ value, issues: left.issues }, ctx);
}
function handleReadonlyResult(payload) {
  if (!payload.memo)
    payload.value = Object.freeze(payload.value);
  return payload;
}
function leafPattern(schema) {
  const def = schema._zod.def;
  let pattern = def.pattern;
  let isInt = !!def.format?.includes("int");
  let minimum;
  let maximum;
  for (const ch of def.checks ?? []) {
    const d = ch._zod.def;
    if (d.pattern)
      pattern = d.pattern;
    isInt || (isInt = !!d.format?.includes("int"));
    const lo = d.minimum ?? d.length;
    const hi = d.maximum ?? d.length;
    if (lo !== void 0 && (minimum === void 0 || lo > minimum))
      minimum = lo;
    if (hi !== void 0 && (maximum === void 0 || hi < maximum))
      maximum = hi;
  }
  if (pattern)
    return pattern.source;
  if (minimum !== void 0 && maximum !== void 0 && minimum > maximum)
    return "(?!)";
  if (minimum !== void 0 || maximum !== void 0)
    return string({ minimum, maximum }).source;
  const own2 = schema._zod.pattern;
  return (isInt && own2 === number ? integer : own2)?.source;
}
function partPattern(schema) {
  const def = schema._zod.def;
  const own2 = schema._zod.pattern?.source;
  const inner = def.innerType ?? schema._zod.innerType;
  if (inner) {
    const before = inner._zod.pattern?.source;
    const after = partPattern(inner);
    if (own2 && before && after && after !== before) {
      return own2.replace(cleanRegex(before), () => cleanRegex(after));
    }
    return own2;
  }
  if (def.options) {
    const sources = def.options.map(partPattern);
    if (sources.every(Boolean))
      return `^(${sources.map((s) => cleanRegex(s)).join("|")})$`;
  }
  return leafPattern(schema);
}
function handleRefineResult(result, payload, input2, inst) {
  if (!result) {
    const _iss = {
      code: "custom",
      input: input2,
      inst,
      // incorporates params.error into issue reporting
      path: [...inst._zod.def.path ?? []],
      // incorporates params.error into issue reporting
      continue: !inst._zod.def.abort
      // params: inst._zod.def.params,
    };
    if (inst._zod.def.params)
      _iss.params = inst._zod.def.params;
    payload.issues.push(issue(_iss));
  }
}
var $ZodType, toStandardResult, $ZodString, $ZodStringFormat, $ZodGUID, $ZodUUID, $ZodEmail, URL_BAD_FORMAT, URL_UNPARSEABLE, asciiTabOrNewline, $ZodURL, $ZodEmoji, $ZodNanoID, $ZodCUID, $ZodCUID2, $ZodULID, $ZodXID, $ZodKSUID, $ZodISODateTime, $ZodISODate, $ZodISOTime, $ZodISODuration, $ZodIPv4, ipv6Alphabet, $ZodIPv6, $ZodMAC, $ZodCIDRv4, $ZodCIDRv6, base64Charset, $ZodBase64, base64urlCharset, $ZodBase64URL, $ZodE164, CC_SANITIZE, $ZodCreditCard, $ZodIBAN, $ZodJWT, $ZodCustomStringFormat, $ZodNumber, $ZodNumberFormat, $ZodBoolean, $ZodBigInt, $ZodBigIntFormat, $ZodSymbol, $ZodUndefined, $ZodNull, $ZodAny, $ZodUnknown, $ZodNever, $ZodVoid, $ZodDate, $ZodArray, NO_SYMBOL_KEYS, $ZodObject, $ZodObjectJIT, $ZodUnion, $ZodXor, $ZodDiscriminatedUnion, $ZodIntersection, $ZodTuple, $ZodRecord, $ZodMap, $ZodSet, $ZodEnum, $ZodLiteral, $ZodFile, $ZodTransform, $ZodOptional, $ZodExactOptional, $ZodNullable, $ZodDefault, $ZodPrefault, $ZodNonOptional, $ZodSuccess, $ZodCatch, $ZodNaN, $ZodPipe, $ZodCodec, $ZodPreprocess, $ZodReadonly, $ZodTemplateLiteral, $ZodFunction, $ZodPromise, $ZodLazy, $ZodCustom;
var init_schemas = __esm({
  "node_modules/zod/v4/core/schemas.js"() {
    init_checks();
    init_core();
    init_doc();
    init_parse();
    init_regexes();
    init_util();
    init_versions();
    init_util();
    $ZodType = /* @__PURE__ */ $constructor("$ZodType", (inst, def) => {
      var _a3;
      inst ?? (inst = {});
      inst._zod.def = def;
      inst._zod.bag = inst._zod.bag || {};
      inst._zod.version = version;
      const defChecks = inst._zod.def.checks;
      const checks = inst._zod.traits.has("$ZodCheck") ? [inst, ...defChecks ?? []] : defChecks?.length ? [...defChecks] : [];
      for (const ch of checks) {
        for (const fn of ch._zod.onattach) {
          fn(inst);
        }
      }
      if (checks.length === 0) {
        (_a3 = inst._zod).deferred ?? (_a3.deferred = []);
        inst._zod.deferred?.push(() => {
          inst._zod.run = inst._zod.parse;
        });
      } else {
        const runChecks = (payload, checks2, ctx) => {
          if (payload.memo)
            return payload;
          let isAborted = aborted(payload);
          let asyncResult;
          for (const ch of checks2) {
            if (ch._zod.def.when) {
              if (explicitlyAborted(payload))
                continue;
              const shouldRun = ch._zod.def.when(payload);
              if (!shouldRun)
                continue;
            } else if (isAborted) {
              continue;
            }
            const currLen = payload.issues.length;
            const _ = ch._zod.check(payload);
            if (_ instanceof Promise && ctx?.async === false) {
              throw new $ZodAsyncError();
            }
            if (asyncResult || _ instanceof Promise) {
              asyncResult = (asyncResult ?? Promise.resolve()).then(async () => {
                await _;
                const nextLen = payload.issues.length;
                if (nextLen === currLen)
                  return;
                attachSchema(payload.issues, currLen, inst);
                if (!isAborted)
                  isAborted = aborted(payload, currLen);
              });
            } else {
              const nextLen = payload.issues.length;
              if (nextLen === currLen)
                continue;
              attachSchema(payload.issues, currLen, inst);
              if (!isAborted)
                isAborted = aborted(payload, currLen);
            }
          }
          if (asyncResult) {
            return asyncResult.then(() => {
              return payload;
            });
          }
          return payload;
        };
        const handleCanaryResult = (canary, payload, ctx) => {
          if (aborted(canary)) {
            canary.aborted = true;
            return canary;
          }
          const checkResult = runChecks(payload, checks, ctx);
          if (checkResult instanceof Promise) {
            if (ctx.async === false)
              throw new $ZodAsyncError();
            return checkResult.then((checkResult2) => inst._zod.parse(checkResult2, ctx));
          }
          return inst._zod.parse(checkResult, ctx);
        };
        inst._zod.run = (payload, ctx) => {
          if (ctx.skipChecks) {
            return inst._zod.parse(payload, ctx);
          }
          if (ctx.direction === "backward") {
            const canary = inst._zod.parse({ value: payload.value, issues: [] }, { ...ctx, skipChecks: true });
            if (canary instanceof Promise) {
              return canary.then((canary2) => {
                return handleCanaryResult(canary2, payload, ctx);
              });
            }
            return handleCanaryResult(canary, payload, ctx);
          }
          const result = inst._zod.parse(payload, ctx);
          if (result instanceof Promise) {
            if (ctx.async === false)
              throw new $ZodAsyncError();
            return result.then((result2) => runChecks(result2, checks, ctx));
          }
          return runChecks(result, checks, ctx);
        };
      }
    }, {
      // Wrappers extend this by installing a richer factory over it; reading it eagerly would defeat the laziness.
      get "~standard"() {
        return hide(this, "~standard", standardProps(this));
      },
      set "~standard"(value) {
        own(this, "~standard", value);
      }
    });
    toStandardResult = (r, ctx) => r.issues.length ? { issues: r.issues.map((iss) => finalizeIssue(iss, ctx, config())) } : { value: r.value };
    $ZodString = /* @__PURE__ */ $constructor("$ZodString", (inst, def) => {
      $ZodType.init(inst, def);
      inst._zod.pattern = def.pattern ?? anyString;
      inst._zod.parse = (payload, _) => {
        if (def.coerce)
          try {
            payload.value = String(payload.value);
          } catch (_2) {
          }
        if (typeof payload.value === "string")
          return payload;
        payload.issues.push({
          expected: "string",
          code: "invalid_type",
          input: payload.value,
          inst
        });
        return payload;
      };
    });
    $ZodStringFormat = /* @__PURE__ */ $constructor("$ZodStringFormat", (inst, def) => {
      $ZodCheckStringFormat.init(inst, def);
      $ZodString.init(inst, def);
    });
    $ZodGUID = /* @__PURE__ */ $constructor("$ZodGUID", (inst, def) => {
      def.pattern ?? (def.pattern = guid);
      $ZodStringFormat.init(inst, def);
    });
    $ZodUUID = /* @__PURE__ */ $constructor("$ZodUUID", (inst, def) => {
      if (def.version) {
        const versionMap = {
          v1: 1,
          v2: 2,
          v3: 3,
          v4: 4,
          v5: 5,
          v6: 6,
          v7: 7,
          v8: 8
        };
        const v = versionMap[def.version];
        if (v === void 0)
          throw new Error(`Invalid UUID version: "${def.version}"`);
        def.pattern ?? (def.pattern = uuid(v));
      } else
        def.pattern ?? (def.pattern = uuid());
      $ZodStringFormat.init(inst, def);
    });
    $ZodEmail = /* @__PURE__ */ $constructor("$ZodEmail", (inst, def) => {
      def.pattern ?? (def.pattern = email);
      $ZodStringFormat.init(inst, def);
    });
    URL_BAD_FORMAT = 1;
    URL_UNPARSEABLE = 2;
    asciiTabOrNewline = /[\t\n\r]/g;
    $ZodURL = /* @__PURE__ */ $constructor("$ZodURL", (inst, def) => {
      $ZodStringFormat.init(inst, def);
      inst._zod.check = (payload) => {
        try {
          const trimmed = payload.value.trim();
          const url2 = validateURL(trimmed, def);
          if (url2 === URL_BAD_FORMAT) {
            payload.issues.push({
              code: "invalid_format",
              format: "url",
              note: "Invalid URL format",
              input: payload.value,
              inst,
              continue: !def.abort
            });
            return;
          }
          if (url2 === URL_UNPARSEABLE) {
            payload.issues.push({
              code: "invalid_format",
              format: "url",
              input: payload.value,
              inst,
              continue: !def.abort
            });
            return;
          }
          if (url2 === true) {
            payload.value = stripTabAndNewline(trimmed);
            return;
          }
          if (def.hostname && !urlHostnameOk(url2, def.hostname)) {
            payload.issues.push({
              code: "invalid_format",
              format: "url",
              note: "Invalid hostname",
              pattern: def.hostname.source,
              input: payload.value,
              inst,
              continue: !def.abort
            });
          }
          if (def.protocol && !urlProtocolOk(url2, def.protocol)) {
            payload.issues.push({
              code: "invalid_format",
              format: "url",
              note: "Invalid protocol",
              pattern: def.protocol.source,
              input: payload.value,
              inst,
              continue: !def.abort
            });
          }
          payload.value = def.normalize ? url2.href : stripTabAndNewline(trimmed);
          return;
        } catch (_) {
          payload.issues.push({
            code: "invalid_format",
            format: "url",
            input: payload.value,
            inst,
            continue: !def.abort
          });
        }
      };
    });
    $ZodEmoji = /* @__PURE__ */ $constructor("$ZodEmoji", (inst, def) => {
      def.pattern ?? (def.pattern = emoji());
      $ZodStringFormat.init(inst, def);
    });
    $ZodNanoID = /* @__PURE__ */ $constructor("$ZodNanoID", (inst, def) => {
      if (def.length !== void 0 && (!Number.isInteger(def.length) || def.length < 1))
        throw new Error(`Invalid nanoid length: ${def.length}`);
      def.pattern ?? (def.pattern = def.length === void 0 ? nanoid : nanoidOfLength(def.length));
      $ZodStringFormat.init(inst, def);
    });
    $ZodCUID = /* @__PURE__ */ $constructor("$ZodCUID", (inst, def) => {
      def.pattern ?? (def.pattern = cuid);
      $ZodStringFormat.init(inst, def);
    });
    $ZodCUID2 = /* @__PURE__ */ $constructor("$ZodCUID2", (inst, def) => {
      def.pattern ?? (def.pattern = cuid2);
      $ZodStringFormat.init(inst, def);
    });
    $ZodULID = /* @__PURE__ */ $constructor("$ZodULID", (inst, def) => {
      def.pattern ?? (def.pattern = ulid);
      $ZodStringFormat.init(inst, def);
    });
    $ZodXID = /* @__PURE__ */ $constructor("$ZodXID", (inst, def) => {
      def.pattern ?? (def.pattern = xid);
      $ZodStringFormat.init(inst, def);
    });
    $ZodKSUID = /* @__PURE__ */ $constructor("$ZodKSUID", (inst, def) => {
      def.pattern ?? (def.pattern = ksuid);
      $ZodStringFormat.init(inst, def);
    });
    $ZodISODateTime = /* @__PURE__ */ $constructor("$ZodISODateTime", (inst, def) => {
      def.pattern ?? (def.pattern = datetime(def));
      $ZodStringFormat.init(inst, def);
    });
    $ZodISODate = /* @__PURE__ */ $constructor("$ZodISODate", (inst, def) => {
      def.pattern ?? (def.pattern = date);
      $ZodStringFormat.init(inst, def);
    });
    $ZodISOTime = /* @__PURE__ */ $constructor("$ZodISOTime", (inst, def) => {
      def.pattern ?? (def.pattern = time(def));
      $ZodStringFormat.init(inst, def);
    });
    $ZodISODuration = /* @__PURE__ */ $constructor("$ZodISODuration", (inst, def) => {
      def.pattern ?? (def.pattern = duration);
      $ZodStringFormat.init(inst, def);
    });
    $ZodIPv4 = /* @__PURE__ */ $constructor("$ZodIPv4", (inst, def) => {
      def.pattern ?? (def.pattern = ipv4);
      $ZodStringFormat.init(inst, def);
    });
    ipv6Alphabet = /^[0-9a-fA-F:.]+$/;
    $ZodIPv6 = /* @__PURE__ */ $constructor("$ZodIPv6", (inst, def) => {
      def.pattern ?? (def.pattern = ipv6);
      $ZodStringFormat.init(inst, def);
      inst._zod.check = (payload) => {
        if (!isValidIPv6(payload.value)) {
          payload.issues.push({
            code: "invalid_format",
            format: "ipv6",
            input: payload.value,
            inst,
            continue: !def.abort
          });
        }
      };
    });
    $ZodMAC = /* @__PURE__ */ $constructor("$ZodMAC", (inst, def) => {
      def.pattern ?? (def.pattern = mac(def.delimiter));
      $ZodStringFormat.init(inst, def);
    });
    $ZodCIDRv4 = /* @__PURE__ */ $constructor("$ZodCIDRv4", (inst, def) => {
      def.pattern ?? (def.pattern = cidrv4);
      $ZodStringFormat.init(inst, def);
    });
    $ZodCIDRv6 = /* @__PURE__ */ $constructor("$ZodCIDRv6", (inst, def) => {
      def.pattern ?? (def.pattern = cidrv6);
      $ZodStringFormat.init(inst, def);
      inst._zod.check = (payload) => {
        if (!isValidCIDRv6(payload.value)) {
          payload.issues.push({
            code: "invalid_format",
            format: "cidrv6",
            input: payload.value,
            inst,
            continue: !def.abort
          });
        }
      };
    });
    base64Charset = /^[0-9a-zA-Z+/]*={0,2}$/;
    $ZodBase64 = /* @__PURE__ */ $constructor("$ZodBase64", (inst, def) => {
      def.pattern ?? (def.pattern = base64Charset);
      $ZodStringFormat.init(inst, def);
      inst._zod.check = (payload) => {
        if (isValidBase64(payload.value))
          return;
        payload.issues.push({
          code: "invalid_format",
          format: "base64",
          input: payload.value,
          inst,
          continue: !def.abort
        });
      };
    });
    base64urlCharset = /^[A-Za-z0-9_-]*$/;
    $ZodBase64URL = /* @__PURE__ */ $constructor("$ZodBase64URL", (inst, def) => {
      def.pattern ?? (def.pattern = base64urlCharset);
      $ZodStringFormat.init(inst, def);
      inst._zod.check = (payload) => {
        if (isValidBase64URL(payload.value))
          return;
        payload.issues.push({
          code: "invalid_format",
          format: "base64url",
          input: payload.value,
          inst,
          continue: !def.abort
        });
      };
    });
    $ZodE164 = /* @__PURE__ */ $constructor("$ZodE164", (inst, def) => {
      def.pattern ?? (def.pattern = e164);
      $ZodStringFormat.init(inst, def);
    });
    CC_SANITIZE = /[- ]/g;
    $ZodCreditCard = /* @__PURE__ */ $constructor("$ZodCreditCard", (inst, def) => {
      def.pattern ?? (def.pattern = creditCard);
      $ZodStringFormat.init(inst, def);
      inst._zod.check = (payload) => {
        if (isValidCreditCard(payload.value))
          return;
        payload.issues.push({
          code: "invalid_format",
          format: "credit_card",
          input: payload.value,
          inst,
          continue: !def.abort
        });
      };
    });
    $ZodIBAN = /* @__PURE__ */ $constructor("$ZodIBAN", (inst, def) => {
      def.pattern ?? (def.pattern = iban);
      $ZodStringFormat.init(inst, def);
      inst._zod.check = (payload) => {
        if (isValidIBAN(payload.value))
          return;
        payload.issues.push({
          code: "invalid_format",
          format: "iban",
          input: payload.value,
          inst,
          continue: !def.abort
        });
      };
    });
    $ZodJWT = /* @__PURE__ */ $constructor("$ZodJWT", (inst, def) => {
      $ZodStringFormat.init(inst, def);
      inst._zod.check = (payload) => {
        if (isValidJWT(payload.value, def.alg))
          return;
        payload.issues.push({
          code: "invalid_format",
          format: "jwt",
          input: payload.value,
          inst,
          continue: !def.abort
        });
      };
    });
    $ZodCustomStringFormat = /* @__PURE__ */ $constructor("$ZodCustomStringFormat", (inst, def) => {
      $ZodStringFormat.init(inst, def);
      inst._zod.check = (payload) => {
        if (def.fn(payload.value))
          return;
        payload.issues.push({
          code: "invalid_format",
          format: def.format,
          input: payload.value,
          inst,
          continue: !def.abort
        });
      };
    });
    $ZodNumber = /* @__PURE__ */ $constructor("$ZodNumber", (inst, def) => {
      $ZodType.init(inst, def);
      inst._zod.pattern = number;
      inst._zod.parse = (payload, _ctx) => {
        if (def.coerce)
          try {
            payload.value = Number(payload.value);
          } catch (_) {
          }
        const input2 = payload.value;
        if (typeof input2 === "number" && !Number.isNaN(input2) && Number.isFinite(input2)) {
          return payload;
        }
        const received = typeof input2 === "number" ? Number.isNaN(input2) ? "NaN" : !Number.isFinite(input2) ? String(input2) : void 0 : void 0;
        payload.issues.push({
          expected: "number",
          code: "invalid_type",
          input: input2,
          inst,
          ...received ? { received } : {}
        });
        return payload;
      };
    });
    $ZodNumberFormat = /* @__PURE__ */ $constructor("$ZodNumberFormat", (inst, def) => {
      $ZodCheckNumberFormat.init(inst, def);
      $ZodNumber.init(inst, def);
    });
    $ZodBoolean = /* @__PURE__ */ $constructor("$ZodBoolean", (inst, def) => {
      $ZodType.init(inst, def);
      inst._zod.pattern = boolean;
      inst._zod.parse = (payload, _ctx) => {
        if (def.coerce)
          try {
            payload.value = Boolean(payload.value);
          } catch (_) {
          }
        const input2 = payload.value;
        if (typeof input2 === "boolean")
          return payload;
        payload.issues.push({
          expected: "boolean",
          code: "invalid_type",
          input: input2,
          inst
        });
        return payload;
      };
    });
    $ZodBigInt = /* @__PURE__ */ $constructor("$ZodBigInt", (inst, def) => {
      $ZodType.init(inst, def);
      inst._zod.pattern = bigint;
      inst._zod.parse = (payload, _ctx) => {
        if (def.coerce)
          try {
            payload.value = BigInt(payload.value);
          } catch (_) {
          }
        if (typeof payload.value === "bigint")
          return payload;
        payload.issues.push({
          expected: "bigint",
          code: "invalid_type",
          input: payload.value,
          inst
        });
        return payload;
      };
    });
    $ZodBigIntFormat = /* @__PURE__ */ $constructor("$ZodBigIntFormat", (inst, def) => {
      $ZodCheckBigIntFormat.init(inst, def);
      $ZodBigInt.init(inst, def);
    });
    $ZodSymbol = /* @__PURE__ */ $constructor("$ZodSymbol", (inst, def) => {
      $ZodType.init(inst, def);
      inst._zod.parse = (payload, _ctx) => {
        const input2 = payload.value;
        if (typeof input2 === "symbol")
          return payload;
        payload.issues.push({
          expected: "symbol",
          code: "invalid_type",
          input: input2,
          inst
        });
        return payload;
      };
    });
    $ZodUndefined = /* @__PURE__ */ $constructor("$ZodUndefined", (inst, def) => {
      $ZodType.init(inst, def);
      inst._zod.pattern = _undefined;
      inst._zod.values = /* @__PURE__ */ new Set([void 0]);
      inst._zod.parse = (payload, _ctx) => {
        const input2 = payload.value;
        if (typeof input2 === "undefined")
          return payload;
        payload.issues.push({
          expected: "undefined",
          code: "invalid_type",
          input: input2,
          inst
        });
        return payload;
      };
    });
    $ZodNull = /* @__PURE__ */ $constructor("$ZodNull", (inst, def) => {
      $ZodType.init(inst, def);
      inst._zod.pattern = _null;
      inst._zod.values = /* @__PURE__ */ new Set([null]);
      inst._zod.parse = (payload, _ctx) => {
        const input2 = payload.value;
        if (input2 === null)
          return payload;
        payload.issues.push({
          expected: "null",
          code: "invalid_type",
          input: input2,
          inst
        });
        return payload;
      };
    });
    $ZodAny = /* @__PURE__ */ $constructor("$ZodAny", (inst, def) => {
      $ZodType.init(inst, def);
      inst._zod.parse = (payload) => payload;
    });
    $ZodUnknown = /* @__PURE__ */ $constructor("$ZodUnknown", (inst, def) => {
      $ZodType.init(inst, def);
      inst._zod.parse = (payload) => payload;
    });
    $ZodNever = /* @__PURE__ */ $constructor("$ZodNever", (inst, def) => {
      $ZodType.init(inst, def);
      inst._zod.parse = (payload, _ctx) => {
        payload.issues.push({
          expected: "never",
          code: "invalid_type",
          input: payload.value,
          inst
        });
        return payload;
      };
    });
    $ZodVoid = /* @__PURE__ */ $constructor("$ZodVoid", (inst, def) => {
      $ZodType.init(inst, def);
      inst._zod.parse = (payload, _ctx) => {
        const input2 = payload.value;
        if (typeof input2 === "undefined")
          return payload;
        payload.issues.push({
          expected: "void",
          code: "invalid_type",
          input: input2,
          inst
        });
        return payload;
      };
    });
    $ZodDate = /* @__PURE__ */ $constructor("$ZodDate", (inst, def) => {
      $ZodType.init(inst, def);
      inst._zod.parse = (payload, _ctx) => {
        if (def.coerce) {
          try {
            payload.value = new Date(payload.value);
          } catch (_err) {
          }
        }
        const input2 = payload.value;
        const isDate = input2 instanceof Date;
        const isValidDate = isDate && !Number.isNaN(input2.getTime());
        if (isValidDate)
          return payload;
        payload.issues.push({
          expected: "date",
          code: "invalid_type",
          input: input2,
          ...isDate ? { received: "Invalid Date" } : {},
          inst
        });
        return payload;
      };
    });
    $ZodArray = /* @__PURE__ */ $constructor("$ZodArray", (inst, def) => {
      $ZodType.init(inst, def);
      const memo2 = globalConfig.memoizer;
      memo2?.attach(inst);
      inst._zod.parse = (payload, ctx) => {
        const input2 = payload.value;
        if (!Array.isArray(input2)) {
          payload.issues.push({
            expected: "array",
            code: "invalid_type",
            input: input2,
            inst
          });
          return payload;
        }
        payload.value = memo2 ? memo2.alloc(inst, payload, Array(input2.length), ctx) : Array(input2.length);
        const proms = [];
        const abortEarly = ctx?.abortEarly;
        for (let i = 0; i < input2.length; i++) {
          const item = input2[i];
          const result = def.element._zod.run({
            value: item,
            issues: []
          }, ctx);
          if (result instanceof Promise) {
            proms.push(result.then((result2) => handleArrayResult(result2, payload, i)));
          } else {
            handleArrayResult(result, payload, i);
            if (abortEarly && result.issues.length !== 0 && aborted(result))
              break;
          }
        }
        if (proms.length) {
          return Promise.all(proms).then(() => payload);
        }
        return payload;
      };
    });
    NO_SYMBOL_KEYS = [];
    $ZodObject = /* @__PURE__ */ $constructor("$ZodObject", (inst, def) => {
      $ZodType.init(inst, def);
      const desc = Object.getOwnPropertyDescriptor(def, "shape");
      const sh = desc?.get ? desc.get.raw : def.shape ?? {};
      if (sh) {
        const get = () => {
          const newSh = { ...sh };
          Object.defineProperty(def, "shape", { value: newSh });
          get.raw = newSh;
          return newSh;
        };
        get.raw = sh;
        Object.defineProperty(def, "shape", { get });
      }
      const _normalized = cached(() => normalizeDef(def));
      defineLazyInternal(inst, "propValues", (zod) => {
        const shape = zod.def.shape;
        const propValues = {};
        for (const key in shape) {
          const field = shape[key]._zod;
          if (field.values) {
            if (!Object.prototype.hasOwnProperty.call(propValues, key)) {
              assignProp(propValues, key, /* @__PURE__ */ new Set());
            }
            for (const v of field.values)
              propValues[key].add(v);
            if (field.optin !== void 0)
              propValues[key].add(void 0);
          }
        }
        return propValues;
      });
      const isObject2 = isObject;
      const catchall = def.catchall;
      let value;
      const memo2 = globalConfig.memoizer;
      memo2?.attach(inst);
      inst._zod.parse = (payload, ctx) => {
        value ?? (value = _normalized.value);
        const input2 = payload.value;
        if (!isObject2(input2)) {
          payload.issues.push({
            expected: "object",
            code: "invalid_type",
            input: input2,
            inst
          });
          return payload;
        }
        payload.value = memo2 ? memo2.alloc(inst, payload, {}, ctx) : {};
        const proms = [];
        const shape = value.shape;
        const abortEarly = ctx?.abortEarly;
        let seen = payload.issues.length;
        for (const key of value.allKeys) {
          if (abortEarly && payload.issues.length !== seen) {
            if (aborted(payload, seen))
              break;
            seen = payload.issues.length;
          }
          if (key === "__proto__")
            continue;
          const el = shape[key];
          const optin = el._zod.optin;
          const optout = el._zod.optout;
          const r = el._zod.run({ value: input2[key], issues: [] }, ctx);
          if (r instanceof Promise) {
            proms.push(r.then((r2) => handlePropertyResult(r2, payload, key, input2, optin, optout)));
          } else {
            handlePropertyResult(r, payload, key, input2, optin, optout);
          }
        }
        if (!catchall) {
          return proms.length ? Promise.all(proms).then(() => payload) : payload;
        }
        return handleCatchall(proms, input2, payload, ctx, _normalized.value, inst, abortEarly === true);
      };
    });
    $ZodObjectJIT = /* @__PURE__ */ $constructor("$ZodObjectJIT", (inst, def) => {
      $ZodObject.init(inst, def);
      const superParse = inst._zod.parse;
      const _normalized = cached(() => normalizeDef(def));
      const memo2 = globalConfig.memoizer;
      const generateFastpass = (shape) => {
        const normalized = _normalized.value;
        const syms = normalized.symbolKeys;
        const doc = new Doc(["payload", "ctx"], { shape, inst, memo: memo2, syms });
        const parseStr = (k) => `shape[${k}]._zod.run({ value: input[${k}], issues: [] }, ctx)`;
        const prefixStr = (id, k) => `
          let ${id}_ab = false;
          for (let i = 0; i < ${id}.issues.length; i++) {
            const iss = ${id}.issues[i];
            iss.path = iss.path ? [${k}, ...iss.path] : [${k}];
            payload.issues.push(iss);
            if (iss.continue !== true) ${id}_ab = true;
          }
          if (${id}_ab && ctx && ctx.abortEarly) {
            payload.value = newResult;
            return payload;
          }`;
        doc.write(`const input = payload.value;`);
        const ids = /* @__PURE__ */ Object.create(null);
        let counter = 0;
        for (const key of normalized.allKeys) {
          ids[key] = `key_${counter++}`;
        }
        doc.write(memo2 ? `const newResult = memo.alloc(inst, payload, {}, ctx);` : `const newResult = {};`);
        for (const key of normalized.allKeys) {
          if (key === "__proto__")
            continue;
          const id = ids[key];
          const k = typeof key === "symbol" ? `syms[${syms.indexOf(key)}]` : esc(key);
          const isPresent = `${k} in input`;
          const schema = shape[key];
          const optin = schema?._zod?.optin;
          const isOptionalIn = optin !== void 0;
          const isOptionalOut = schema?._zod?.optout === "optional";
          doc.write(`const ${id} = ${parseStr(k)};`);
          if (isOptionalIn && isOptionalOut) {
            const assign = optin === "optional" ? `${id}_present` : `${id}.value !== undefined || ${id}_present`;
            doc.write(`
        const ${id}_present = ${isPresent};
        if (!${id}.issues.length || ${id}_present) {
          if (${id}.issues.length) {${prefixStr(id, k)}
          }

          if (${assign}) {
            newResult[${k}] = ${id}.value;
          }
        }

      `);
          } else if (!isOptionalIn) {
            doc.write(`
        const ${id}_present = ${isPresent};
        if (${id}.issues.length) {${prefixStr(id, k)}
        }
        if (!${id}_present && !${id}.issues.length) {
          payload.issues.push({
            code: "invalid_type",
            expected: "nonoptional",
            input: undefined,
            path: [${k}]
          });
          if (ctx && ctx.abortEarly) {
            payload.value = newResult;
            return payload;
          }
        }

        if (${id}_present) {
          newResult[${k}] = ${id}.value;
        }

      `);
          } else {
            doc.write(`
        if (${id}.issues.length) {${prefixStr(id, k)}
        }
      `);
            if (optin === "defaulted") {
              doc.write(`newResult[${k}] = ${id}.value;`);
            } else {
              doc.write(`
        if (${id}.value !== undefined || ${isPresent}) {
          newResult[${k}] = ${id}.value;
        }
      `);
            }
          }
        }
        doc.write(`payload.value = newResult;`);
        doc.write(`return payload;`);
        return doc.compile();
      };
      let fastpass;
      const isObject2 = isObject;
      const jit = !globalConfig.jitless;
      const allowsEval2 = allowsEval;
      const fastEnabled = jit && allowsEval2.value;
      const catchall = def.catchall;
      let value;
      inst._zod.parse = (payload, ctx) => {
        value ?? (value = _normalized.value);
        const input2 = payload.value;
        if (!isObject2(input2)) {
          payload.issues.push({
            expected: "object",
            code: "invalid_type",
            input: input2,
            inst
          });
          return payload;
        }
        if (jit && fastEnabled && ctx?.async === false && ctx.jitless !== true) {
          if (!fastpass)
            fastpass = generateFastpass(def.shape);
          payload = fastpass(payload, ctx);
          if (!catchall)
            return payload;
          return handleCatchall([], input2, payload, ctx, value, inst, ctx?.abortEarly === true);
        }
        return superParse(payload, ctx);
      };
    });
    $ZodUnion = /* @__PURE__ */ $constructor("$ZodUnion", (inst, def) => {
      $ZodType.init(inst, def);
      defineLazyInternal(inst, "optin", (zod) => zod.def.options.some((o) => o._zod.optin === "defaulted") ? "defaulted" : zod.def.options.some((o) => o._zod.optin !== void 0) ? "optional" : void 0);
      defineLazyInternal(inst, "optout", (zod) => zod.def.options.some((o) => o._zod.optout === "optional") ? "optional" : void 0);
      defineLazyInternal(inst, "values", (zod) => {
        if (zod.def.options.every((o) => o._zod.values)) {
          return new Set(zod.def.options.flatMap((option) => Array.from(option._zod.values)));
        }
        return void 0;
      });
      defineLazyInternal(inst, "pattern", (zod) => {
        if (zod.def.options.every((o) => o._zod.pattern)) {
          const patterns = zod.def.options.map((o) => o._zod.pattern);
          return new RegExp(`^(${patterns.map((p) => cleanRegex(p.source)).join("|")})$`);
        }
        return void 0;
      });
      const first = def.options.length === 1 ? def.options[0]._zod.run : null;
      inst._zod.parse = (payload, ctx) => {
        if (first) {
          return first(payload, ctx);
        }
        let async = false;
        const results = [];
        for (const option of def.options) {
          const result = option._zod.run({
            value: payload.value,
            issues: []
          }, ctx);
          if (result instanceof Promise) {
            results.push(result);
            async = true;
          } else {
            if (result.issues.length === 0)
              return result;
            results.push(result);
          }
        }
        if (!async)
          return handleUnionResults(results, payload, inst, ctx);
        return Promise.all(results).then((results2) => {
          return handleUnionResults(results2, payload, inst, ctx);
        });
      };
    });
    $ZodXor = /* @__PURE__ */ $constructor("$ZodXor", (inst, def) => {
      $ZodUnion.init(inst, def);
      def.inclusive = false;
      const first = def.options.length === 1 ? def.options[0]._zod.run : null;
      inst._zod.parse = (payload, ctx) => {
        if (first) {
          return first(payload, ctx);
        }
        let async = false;
        const results = [];
        for (const option of def.options) {
          const result = option._zod.run({
            value: payload.value,
            issues: []
          }, ctx);
          if (result instanceof Promise) {
            results.push(result);
            async = true;
          } else {
            results.push(result);
          }
        }
        if (!async)
          return handleExclusiveUnionResults(results, payload, inst, ctx);
        return Promise.all(results).then((results2) => {
          return handleExclusiveUnionResults(results2, payload, inst, ctx);
        });
      };
    });
    $ZodDiscriminatedUnion = /* @__PURE__ */ $constructor("$ZodDiscriminatedUnion", (inst, def) => {
      def.inclusive = false;
      $ZodUnion.init(inst, def);
      const _super = inst._zod.parse;
      defineLazyInternal(inst, "propValues", (zod) => {
        const propValues = {};
        let undefinedCount = 0;
        for (const option of zod.def.options) {
          const pv = option._zod.propValues;
          if (!pv || Object.keys(pv).length === 0)
            throw new Error(`Invalid discriminated union option at index "${zod.def.options.indexOf(option)}"`);
          if (pv[zod.def.discriminator]?.has(void 0))
            undefinedCount++;
          for (const [k, v] of Object.entries(pv)) {
            if (!Object.prototype.hasOwnProperty.call(propValues, k)) {
              assignProp(propValues, k, /* @__PURE__ */ new Set());
            }
            for (const val of v) {
              propValues[k].add(val);
            }
          }
        }
        if (!zod.def.unionFallback && undefinedCount > 1)
          propValues[zod.def.discriminator]?.delete(void 0);
        return propValues;
      });
      def.options.forEach((option, i) => {
        const propShape = rawShape(option._zod.def);
        if (propShape && !Object.prototype.hasOwnProperty.call(propShape, def.discriminator)) {
          throw new Error(`Invalid discriminated union option at index "${i}"`);
        }
      });
      const disc = cached(() => discriminatorMap(def));
      inst._zod.parse = (payload, ctx) => {
        const input2 = payload.value;
        if (!isObject(input2)) {
          payload.issues.push({
            code: "invalid_type",
            expected: "object",
            input: input2,
            inst
          });
          return payload;
        }
        const value = input2?.[def.discriminator];
        const opt = disc.value.get(value);
        if (opt && (value !== void 0 || ctx.direction !== "backward")) {
          return opt._zod.run(payload, ctx);
        }
        if (def.unionFallback || ctx.direction === "backward") {
          return _super(payload, ctx);
        }
        payload.issues.push({
          code: "invalid_union",
          errors: [],
          note: "No matching discriminator",
          discriminator: def.discriminator,
          options: Array.from(disc.value.keys()).filter((value2) => disc.value.get(value2) !== null),
          input: input2,
          path: [def.discriminator],
          inst
        });
        return payload;
      };
    });
    $ZodIntersection = /* @__PURE__ */ $constructor("$ZodIntersection", (inst, def) => {
      $ZodType.init(inst, def);
      inst._zod.parse = (payload, ctx) => {
        const input2 = payload.value;
        const left = def.left._zod.run({ value: input2, issues: [] }, ctx);
        const right = def.right._zod.run({ value: input2, issues: [] }, ctx);
        const async = left instanceof Promise || right instanceof Promise;
        if (async) {
          return Promise.all([left, right]).then(([left2, right2]) => {
            return handleIntersectionResults(payload, left2, right2);
          });
        }
        return handleIntersectionResults(payload, left, right);
      };
    });
    $ZodTuple = /* @__PURE__ */ $constructor("$ZodTuple", (inst, def) => {
      $ZodType.init(inst, def);
      const items = def.items;
      const memo2 = globalConfig.memoizer;
      memo2?.attach(inst);
      inst._zod.parse = (payload, ctx) => {
        const input2 = payload.value;
        if (!Array.isArray(input2)) {
          payload.issues.push({
            input: input2,
            inst,
            expected: "tuple",
            code: "invalid_type"
          });
          return payload;
        }
        payload.value = memo2 ? memo2.alloc(inst, payload, [], ctx) : [];
        const proms = [];
        const optinStart = getTupleOptStart(items, "optin");
        const optoutStart = getTupleOptStart(items, "optout");
        if (!def.rest) {
          if (input2.length < optinStart) {
            payload.issues.push({
              code: "too_small",
              minimum: optinStart,
              inclusive: true,
              input: input2,
              inst,
              origin: "array"
            });
            return payload;
          }
          if (input2.length > items.length) {
            payload.issues.push({
              code: "too_big",
              maximum: items.length,
              inclusive: true,
              input: input2,
              inst,
              origin: "array"
            });
          }
        }
        const itemResults = new Array(items.length);
        const abortEarly = def.rest ? ctx?.abortEarly : void 0;
        let itemAborted = false;
        for (let i = 0; i < items.length; i++) {
          const r = items[i]._zod.run({ value: input2[i], issues: [] }, ctx);
          if (r instanceof Promise) {
            proms.push(r.then((rr) => {
              itemResults[i] = rr;
            }));
          } else {
            itemResults[i] = r;
            if (abortEarly && !itemAborted && r.issues.length)
              itemAborted = aborted(r);
          }
        }
        if (def.rest && !itemAborted) {
          let i = items.length - 1;
          const rest = input2.slice(items.length);
          let seen = payload.issues.length;
          for (const el of rest) {
            if (abortEarly && payload.issues.length !== seen) {
              if (aborted(payload, seen))
                break;
              seen = payload.issues.length;
            }
            i++;
            const result = def.rest._zod.run({ value: el, issues: [] }, ctx);
            if (result instanceof Promise) {
              proms.push(result.then((r) => handleTupleResult(r, payload, i)));
            } else {
              handleTupleResult(result, payload, i);
            }
          }
        }
        if (proms.length) {
          return Promise.all(proms).then(() => handleTupleResults(itemResults, payload, items, input2, optoutStart));
        }
        return handleTupleResults(itemResults, payload, items, input2, optoutStart);
      };
    });
    $ZodRecord = /* @__PURE__ */ $constructor("$ZodRecord", (inst, def) => {
      $ZodType.init(inst, def);
      const memo2 = globalConfig.memoizer;
      memo2?.attach(inst);
      inst._zod.parse = (payload, ctx) => {
        const input2 = payload.value;
        if (!isPlainObject(input2)) {
          payload.issues.push({
            expected: "record",
            code: "invalid_type",
            input: input2,
            inst
          });
          return payload;
        }
        const proms = [];
        const values = def.keyType._zod.values;
        if (values && !def.partial) {
          payload.value = memo2 ? memo2.alloc(inst, payload, {}, ctx) : {};
          const recordKeys = /* @__PURE__ */ new Set();
          for (const key of values) {
            if (typeof key === "string" || typeof key === "number" || typeof key === "symbol") {
              recordKeys.add(typeof key === "number" ? key.toString() : key);
              if (key === "__proto__")
                continue;
              const keyResult = def.keyType._zod.run({ value: key, issues: [] }, ctx);
              if (keyResult instanceof Promise) {
                throw new Error("Async schemas not supported in object keys currently");
              }
              if (keyResult.issues.length) {
                payload.issues.push({
                  code: "invalid_key",
                  origin: "record",
                  issues: keyResult.issues.map((iss) => finalizeIssue(iss, ctx, config())),
                  input: key,
                  path: [key],
                  inst
                });
                continue;
              }
              const outKey = keyResult.value;
              if (outKey === "__proto__")
                continue;
              const result = def.valueType._zod.run({ value: input2[key], issues: [] }, ctx);
              if (result instanceof Promise) {
                proms.push(result.then((result2) => {
                  if (result2.issues.length) {
                    payload.issues.push(...prefixIssues(key, result2.issues));
                  }
                  payload.value[outKey] = result2.value;
                }));
              } else {
                if (result.issues.length) {
                  payload.issues.push(...prefixIssues(key, result.issues));
                }
                payload.value[outKey] = result.value;
              }
            }
          }
          let unrecognized;
          for (const key in input2) {
            if (!recordKeys.has(key)) {
              if (def.mode === "loose") {
                if (key === "__proto__")
                  continue;
                payload.value[key] = input2[key];
              } else {
                unrecognized = unrecognized ?? [];
                unrecognized.push(key);
              }
            }
          }
          if (unrecognized && unrecognized.length > 0) {
            payload.issues.push({
              code: "unrecognized_keys",
              input: input2,
              inst,
              keys: unrecognized,
              continue: true
            });
          }
        } else {
          payload.value = memo2 ? memo2.alloc(inst, payload, {}, ctx) : {};
          let unrecognized;
          for (const key of Reflect.ownKeys(input2)) {
            if (key === "__proto__")
              continue;
            if (!Object.prototype.propertyIsEnumerable.call(input2, key))
              continue;
            let keyResult = def.keyType._zod.run({ value: key, issues: [] }, ctx);
            if (keyResult instanceof Promise) {
              throw new Error("Async schemas not supported in object keys currently");
            }
            const checkNumericKey = typeof key === "string" && number.test(key) && keyResult.issues.length;
            if (checkNumericKey) {
              const retryResult = def.keyType._zod.run({ value: Number(key), issues: [] }, ctx);
              if (retryResult instanceof Promise) {
                throw new Error("Async schemas not supported in object keys currently");
              }
              if (retryResult.issues.length === 0) {
                keyResult = retryResult;
              }
            }
            if (keyResult.issues.length) {
              if (def.mode === "loose") {
                payload.value[key] = input2[key];
              } else if (values) {
                unrecognized = unrecognized ?? [];
                unrecognized.push(key);
              } else {
                payload.issues.push({
                  code: "invalid_key",
                  origin: "record",
                  issues: keyResult.issues.map((iss) => finalizeIssue(iss, ctx, config())),
                  input: key,
                  path: [key],
                  inst
                });
              }
              continue;
            }
            const outKey = keyResult.value;
            if (outKey === "__proto__")
              continue;
            const result = def.valueType._zod.run({ value: input2[key], issues: [] }, ctx);
            if (result instanceof Promise) {
              proms.push(result.then((result2) => {
                if (result2.issues.length) {
                  payload.issues.push(...prefixIssues(key, result2.issues));
                }
                payload.value[outKey] = result2.value;
              }));
            } else {
              if (result.issues.length) {
                payload.issues.push(...prefixIssues(key, result.issues));
              }
              payload.value[outKey] = result.value;
            }
          }
          if (unrecognized && unrecognized.length > 0) {
            payload.issues.push({
              code: "unrecognized_keys",
              input: input2,
              inst,
              keys: unrecognized,
              continue: true
            });
          }
        }
        if (proms.length) {
          return Promise.all(proms).then(() => payload);
        }
        return payload;
      };
    });
    $ZodMap = /* @__PURE__ */ $constructor("$ZodMap", (inst, def) => {
      $ZodType.init(inst, def);
      const memo2 = globalConfig.memoizer;
      memo2?.attach(inst);
      inst._zod.parse = (payload, ctx) => {
        const input2 = payload.value;
        if (!(input2 instanceof Map)) {
          payload.issues.push({
            expected: "map",
            code: "invalid_type",
            input: input2,
            inst
          });
          return payload;
        }
        const proms = [];
        payload.value = memo2 ? memo2.alloc(inst, payload, /* @__PURE__ */ new Map(), ctx) : /* @__PURE__ */ new Map();
        const abortEarly = ctx?.abortEarly;
        let seen = payload.issues.length;
        for (const [key, value] of input2) {
          if (abortEarly && payload.issues.length !== seen) {
            if (aborted(payload, seen))
              break;
            seen = payload.issues.length;
          }
          const keyResult = def.keyType._zod.run({ value: key, issues: [] }, ctx);
          const valueResult = def.valueType._zod.run({ value, issues: [] }, ctx);
          if (keyResult instanceof Promise || valueResult instanceof Promise) {
            proms.push(Promise.all([keyResult, valueResult]).then(([keyResult2, valueResult2]) => {
              handleMapResult(keyResult2, valueResult2, payload, key, input2, inst, ctx);
            }));
          } else {
            handleMapResult(keyResult, valueResult, payload, key, input2, inst, ctx);
          }
        }
        if (proms.length)
          return Promise.all(proms).then(() => payload);
        return payload;
      };
    });
    $ZodSet = /* @__PURE__ */ $constructor("$ZodSet", (inst, def) => {
      $ZodType.init(inst, def);
      const memo2 = globalConfig.memoizer;
      memo2?.attach(inst);
      inst._zod.parse = (payload, ctx) => {
        const input2 = payload.value;
        if (!(input2 instanceof Set)) {
          payload.issues.push({
            input: input2,
            inst,
            expected: "set",
            code: "invalid_type"
          });
          return payload;
        }
        const proms = [];
        payload.value = memo2 ? memo2.alloc(inst, payload, /* @__PURE__ */ new Set(), ctx) : /* @__PURE__ */ new Set();
        const abortEarly = ctx?.abortEarly;
        let seen = payload.issues.length;
        for (const item of input2) {
          if (abortEarly && payload.issues.length !== seen) {
            if (aborted(payload, seen))
              break;
            seen = payload.issues.length;
          }
          const result = def.valueType._zod.run({ value: item, issues: [] }, ctx);
          if (result instanceof Promise) {
            proms.push(result.then((result2) => handleSetResult(result2, payload)));
          } else
            handleSetResult(result, payload);
        }
        if (proms.length)
          return Promise.all(proms).then(() => payload);
        return payload;
      };
    });
    $ZodEnum = /* @__PURE__ */ $constructor("$ZodEnum", (inst, def) => {
      $ZodType.init(inst, def);
      const values = getEnumValues(def.entries);
      const valuesSet = new Set(values);
      inst._zod.values = valuesSet;
      defineLazyInternal(inst, "pattern", (zod) => {
        const patternValues = getEnumValues(zod.def.entries).filter((k) => propertyKeyTypes.has(typeof k));
        return new RegExp(patternValues.length ? `^(${patternValues.map((o) => escapeRegex(o.toString())).join("|")})$` : "^[^\\s\\S]$");
      });
      inst._zod.parse = (payload, _ctx) => {
        const input2 = payload.value;
        if (valuesSet.has(input2)) {
          return payload;
        }
        payload.issues.push({
          code: "invalid_value",
          values,
          input: input2,
          inst
        });
        return payload;
      };
    });
    $ZodLiteral = /* @__PURE__ */ $constructor("$ZodLiteral", (inst, def) => {
      $ZodType.init(inst, def);
      const values = new Set(def.values);
      inst._zod.values = values;
      defineLazyInternal(inst, "pattern", (zod) => {
        const vals = zod.def.values;
        return new RegExp(vals.length ? `^(${vals.map((o) => typeof o === "string" ? escapeRegex(o) : o ? escapeRegex(o.toString()) : String(o)).join("|")})$` : "^[^\\s\\S]$");
      });
      inst._zod.parse = (payload, _ctx) => {
        const input2 = payload.value;
        if (values.has(input2)) {
          return payload;
        }
        payload.issues.push({
          code: "invalid_value",
          values: def.values,
          input: input2,
          inst
        });
        return payload;
      };
    });
    $ZodFile = /* @__PURE__ */ $constructor("$ZodFile", (inst, def) => {
      $ZodType.init(inst, def);
      inst._zod.parse = (payload, _ctx) => {
        const input2 = payload.value;
        if (input2 instanceof File)
          return payload;
        payload.issues.push({
          expected: "file",
          code: "invalid_type",
          input: input2,
          inst
        });
        return payload;
      };
    });
    $ZodTransform = /* @__PURE__ */ $constructor("$ZodTransform", (inst, def) => {
      $ZodType.init(inst, def);
      inst._zod.optin = "optional";
      globalConfig.memoizer?.guard(inst);
      inst._zod.parse = (payload, ctx) => {
        if (ctx.direction === "backward") {
          throw new $ZodEncodeError(inst.constructor.name);
        }
        const _out = def.transform(payload.value, payload);
        if (ctx.async) {
          const output2 = _out instanceof Promise ? _out : Promise.resolve(_out);
          return output2.then((output3) => {
            payload.value = output3;
            return payload;
          });
        }
        if (_out instanceof Promise) {
          throw new $ZodAsyncError();
        }
        payload.value = _out;
        return payload;
      };
    });
    $ZodOptional = /* @__PURE__ */ $constructor("$ZodOptional", (inst, def) => {
      $ZodType.init(inst, def);
      defineLazyInternal(inst, "optin", (zod) => zod.def.innerType._zod.optin === "defaulted" ? "defaulted" : "optional");
      inst._zod.optout = "optional";
      defineLazyInternal(inst, "values", (zod) => {
        const values = zod.def.innerType._zod.values;
        return values ? /* @__PURE__ */ new Set([...values, void 0]) : void 0;
      });
      defineLazyInternal(inst, "pattern", (zod) => {
        const pattern = zod.def.innerType._zod.pattern;
        return pattern ? new RegExp(`^(${cleanRegex(pattern.source)})?$`) : void 0;
      });
      inst._zod.parse = (payload, ctx) => {
        if (payload.value === void 0) {
          if (def.innerType._zod.optin !== "defaulted")
            return payload;
          const result = def.innerType._zod.run({ value: payload.value, issues: [] }, ctx);
          if (result instanceof Promise)
            return result.then((result2) => handleOptionalResult(payload, result2));
          return handleOptionalResult(payload, result);
        }
        return def.innerType._zod.run(payload, ctx);
      };
    });
    $ZodExactOptional = /* @__PURE__ */ $constructor("$ZodExactOptional", (inst, def) => {
      $ZodOptional.init(inst, def);
      defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
      defineLazyInternal(inst, "pattern", (zod) => zod.def.innerType._zod.pattern);
      inst._zod.parse = (payload, ctx) => {
        return def.innerType._zod.run(payload, ctx);
      };
    });
    $ZodNullable = /* @__PURE__ */ $constructor("$ZodNullable", (inst, def) => {
      $ZodType.init(inst, def);
      defineLazyInternal(inst, "optin", (zod) => zod.def.innerType._zod.optin);
      defineLazyInternal(inst, "optout", (zod) => zod.def.innerType._zod.optout);
      defineLazyInternal(inst, "pattern", (zod) => {
        const pattern = zod.def.innerType._zod.pattern;
        return pattern ? new RegExp(`^(${cleanRegex(pattern.source)}|null)$`) : void 0;
      });
      defineLazyInternal(inst, "values", (zod) => {
        return zod.def.innerType._zod.values ? /* @__PURE__ */ new Set([...zod.def.innerType._zod.values, null]) : void 0;
      });
      inst._zod.parse = (payload, ctx) => {
        if (payload.value === null)
          return payload;
        return def.innerType._zod.run(payload, ctx);
      };
    });
    $ZodDefault = /* @__PURE__ */ $constructor("$ZodDefault", (inst, def) => {
      $ZodType.init(inst, def);
      inst._zod.optin = "defaulted";
      defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
      inst._zod.parse = (payload, ctx) => {
        if (ctx.direction === "backward") {
          return def.innerType._zod.run(payload, ctx);
        }
        if (payload.value === void 0) {
          payload.value = def.defaultValue;
          return payload;
        }
        const result = def.innerType._zod.run(payload, ctx);
        if (result instanceof Promise) {
          return result.then((result2) => handleDefaultResult(result2, def));
        }
        return handleDefaultResult(result, def);
      };
    });
    $ZodPrefault = /* @__PURE__ */ $constructor("$ZodPrefault", (inst, def) => {
      $ZodType.init(inst, def);
      inst._zod.optin = "defaulted";
      defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
      inst._zod.parse = (payload, ctx) => {
        if (ctx.direction === "backward") {
          return def.innerType._zod.run(payload, ctx);
        }
        if (payload.value === void 0) {
          payload.value = def.defaultValue;
        }
        return def.innerType._zod.run(payload, ctx);
      };
    });
    $ZodNonOptional = /* @__PURE__ */ $constructor("$ZodNonOptional", (inst, def) => {
      $ZodType.init(inst, def);
      defineLazyInternal(inst, "values", (zod) => {
        const v = zod.def.innerType._zod.values;
        return v ? new Set([...v].filter((x) => x !== void 0)) : void 0;
      });
      inst._zod.parse = (payload, ctx) => {
        const result = def.innerType._zod.run(payload, ctx);
        if (result instanceof Promise) {
          return result.then((result2) => handleNonOptionalResult(result2, inst));
        }
        return handleNonOptionalResult(result, inst);
      };
    });
    $ZodSuccess = /* @__PURE__ */ $constructor("$ZodSuccess", (inst, def) => {
      $ZodType.init(inst, def);
      inst._zod.parse = (payload, ctx) => {
        if (ctx.direction === "backward") {
          throw new $ZodEncodeError("ZodSuccess");
        }
        const result = def.innerType._zod.run(payload, ctx);
        if (result instanceof Promise) {
          return result.then((result2) => {
            payload.value = result2.issues.length === 0;
            return payload;
          });
        }
        payload.value = result.issues.length === 0;
        return payload;
      };
    });
    $ZodCatch = /* @__PURE__ */ $constructor("$ZodCatch", (inst, def) => {
      $ZodType.init(inst, def);
      defineLazyInternal(inst, "optin", (zod) => zod.def.innerType._zod.optin === "defaulted" ? "defaulted" : "optional");
      defineLazyInternal(inst, "optout", (zod) => zod.def.innerType._zod.optout);
      defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
      inst._zod.parse = (payload, ctx) => {
        if (ctx.direction === "backward") {
          return def.innerType._zod.run(payload, ctx);
        }
        const result = def.innerType._zod.run({ value: payload.value, issues: [] }, ctx);
        if (result instanceof Promise) {
          return result.then((result2) => handleCatchResult(payload, result2, def, ctx));
        }
        return handleCatchResult(payload, result, def, ctx);
      };
    });
    $ZodNaN = /* @__PURE__ */ $constructor("$ZodNaN", (inst, def) => {
      $ZodType.init(inst, def);
      inst._zod.parse = (payload, _ctx) => {
        if (typeof payload.value !== "number" || !Number.isNaN(payload.value)) {
          payload.issues.push({
            input: payload.value,
            inst,
            expected: "nan",
            code: "invalid_type"
          });
          return payload;
        }
        return payload;
      };
    });
    $ZodPipe = /* @__PURE__ */ $constructor("$ZodPipe", (inst, def) => {
      $ZodType.init(inst, def);
      defineLazyInternal(inst, "values", (zod) => zod.def.in._zod.values);
      defineLazyInternal(inst, "optin", (zod) => zod.def.in._zod.optin);
      defineLazyInternal(inst, "optout", (zod) => zod.def.out._zod.optout);
      defineLazyInternal(inst, "propValues", (zod) => zod.def.in._zod.propValues);
      inst._zod.parse = (payload, ctx) => {
        if (ctx.direction === "backward") {
          const right = def.out._zod.run(payload, ctx);
          if (right instanceof Promise) {
            return right.then((right2) => handlePipeResult(right2, def.in, ctx));
          }
          return handlePipeResult(right, def.in, ctx);
        }
        const left = def.in._zod.run(payload, ctx);
        if (left instanceof Promise) {
          return left.then((left2) => handlePipeResult(left2, def.out, ctx));
        }
        return handlePipeResult(left, def.out, ctx);
      };
    });
    $ZodCodec = /* @__PURE__ */ $constructor("$ZodCodec", (inst, def) => {
      $ZodType.init(inst, def);
      defineLazyInternal(inst, "values", (zod) => zod.def.in._zod.values);
      defineLazyInternal(inst, "optin", (zod) => zod.def.in._zod.optin);
      defineLazyInternal(inst, "optout", (zod) => zod.def.out._zod.optout);
      defineLazyInternal(inst, "propValues", (zod) => zod.def.in._zod.propValues);
      inst._zod.parse = (payload, ctx) => {
        const direction = ctx.direction || "forward";
        if (direction === "forward") {
          const left = def.in._zod.run(payload, ctx);
          if (left instanceof Promise) {
            return left.then((left2) => handleCodecAResult(left2, def, ctx));
          }
          return handleCodecAResult(left, def, ctx);
        } else {
          const right = def.out._zod.run(payload, ctx);
          if (right instanceof Promise) {
            return right.then((right2) => handleCodecAResult(right2, def, ctx));
          }
          return handleCodecAResult(right, def, ctx);
        }
      };
    });
    $ZodPreprocess = /* @__PURE__ */ $constructor("$ZodPreprocess", (inst, def) => {
      $ZodPipe.init(inst, def);
    });
    $ZodReadonly = /* @__PURE__ */ $constructor("$ZodReadonly", (inst, def) => {
      $ZodType.init(inst, def);
      defineLazyInternal(inst, "propValues", (zod) => zod.def.innerType._zod.propValues);
      defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
      defineLazyInternal(inst, "optin", (zod) => zod.def.innerType?._zod?.optin);
      defineLazyInternal(inst, "optout", (zod) => zod.def.innerType?._zod?.optout);
      inst._zod.parse = (payload, ctx) => {
        if (ctx.direction === "backward") {
          return def.innerType._zod.run(payload, ctx);
        }
        const result = def.innerType._zod.run(payload, ctx);
        if (result instanceof Promise) {
          return result.then(handleReadonlyResult);
        }
        return handleReadonlyResult(result);
      };
    });
    $ZodTemplateLiteral = /* @__PURE__ */ $constructor("$ZodTemplateLiteral", (inst, def) => {
      $ZodType.init(inst, def);
      const regexParts = [];
      for (const part of def.parts) {
        if (typeof part === "object" && part !== null) {
          const source = partPattern(part);
          if (!source) {
            throw new Error(`Invalid template literal part, no pattern found: ${[...part._zod.traits].shift()}`);
          }
          regexParts.push(cleanRegex(source));
        } else if (part === null || primitiveTypes.has(typeof part)) {
          regexParts.push(escapeRegex(`${part}`));
        } else {
          throw new Error(`Invalid template literal part: ${part}`);
        }
      }
      inst._zod.pattern = new RegExp(`^${regexParts.join("")}$`);
      inst._zod.parse = (payload, _ctx) => {
        if (typeof payload.value !== "string") {
          payload.issues.push({
            input: payload.value,
            inst,
            expected: "string",
            code: "invalid_type"
          });
          return payload;
        }
        inst._zod.pattern.lastIndex = 0;
        if (!inst._zod.pattern.test(payload.value)) {
          payload.issues.push({
            input: payload.value,
            inst,
            code: "invalid_format",
            format: def.format ?? "template_literal",
            pattern: inst._zod.pattern.source
          });
          return payload;
        }
        return payload;
      };
    });
    $ZodFunction = /* @__PURE__ */ $constructor("$ZodFunction", (inst, def) => {
      $ZodType.init(inst, def);
      Object.defineProperty(inst, "_def", { value: def });
      inst._zod.def = def;
      inst.implement = (func) => {
        if (typeof func !== "function") {
          throw new Error("implement() must be called with a function");
        }
        return Object.defineProperty(function(...args) {
          const parsedArgs = inst._def.input ? parse(inst._def.input, args) : args;
          const result = Reflect.apply(func, this, parsedArgs);
          if (inst._def.output) {
            return parse(inst._def.output, result);
          }
          return result;
        }, "_zod", { value: inst._zod, enumerable: false });
      };
      inst.implementAsync = (func) => {
        if (typeof func !== "function") {
          throw new Error("implementAsync() must be called with a function");
        }
        return Object.defineProperty(async function(...args) {
          const parsedArgs = inst._def.input ? await parseAsync(inst._def.input, args) : args;
          const result = await Reflect.apply(func, this, parsedArgs);
          if (inst._def.output) {
            return await parseAsync(inst._def.output, result);
          }
          return result;
        }, "_zod", { value: inst._zod, enumerable: false });
      };
      inst._zod.parse = (payload, _ctx) => {
        if (typeof payload.value !== "function") {
          payload.issues.push({
            code: "invalid_type",
            expected: "function",
            input: payload.value,
            inst
          });
          return payload;
        }
        const hasPromiseOutput = inst._def.output && inst._def.output._zod.def.type === "promise";
        if (hasPromiseOutput) {
          payload.value = inst.implementAsync(payload.value);
        } else {
          payload.value = inst.implement(payload.value);
        }
        return payload;
      };
      inst.input = (...args) => {
        const F = inst.constructor;
        if (Array.isArray(args[0])) {
          return new F({
            type: "function",
            input: new $ZodTuple({
              type: "tuple",
              items: args[0],
              rest: args[1]
            }),
            output: inst._def.output
          });
        }
        return new F({
          type: "function",
          input: args[0],
          output: inst._def.output
        });
      };
      inst.output = (output2) => {
        const F = inst.constructor;
        return new F({
          type: "function",
          input: inst._def.input,
          output: output2
        });
      };
      return inst;
    });
    $ZodPromise = /* @__PURE__ */ $constructor("$ZodPromise", (inst, def) => {
      $ZodType.init(inst, def);
      inst._zod.parse = (payload, ctx) => {
        return Promise.resolve(payload.value).then((inner) => def.innerType._zod.run({ value: inner, issues: [] }, ctx));
      };
    });
    $ZodLazy = /* @__PURE__ */ $constructor("$ZodLazy", (inst, def) => {
      $ZodType.init(inst, def);
      defineLazy(inst._zod, "innerType", () => {
        const d = def;
        if (!d._cachedInner)
          d._cachedInner = def.getter();
        return d._cachedInner;
      });
      defineLazyInternal(inst, "pattern", (zod) => zod.innerType?._zod?.pattern);
      defineLazyInternal(inst, "propValues", (zod) => zod.innerType?._zod?.propValues);
      defineLazyInternal(inst, "optin", (zod) => zod.innerType?._zod?.optin ?? void 0);
      defineLazyInternal(inst, "optout", (zod) => zod.innerType?._zod?.optout ?? void 0);
      inst._zod.parse = (payload, ctx) => {
        const inner = inst._zod.innerType;
        return inner._zod.run(payload, ctx);
      };
    });
    $ZodCustom = /* @__PURE__ */ $constructor("$ZodCustom", (inst, def) => {
      $ZodCheck.init(inst, def);
      $ZodType.init(inst, def);
      inst._zod.parse = (payload, _) => {
        return payload;
      };
      inst._zod.check = (payload) => {
        const input2 = payload.value;
        const r = def.fn(input2);
        if (r instanceof Promise) {
          return r.then((r2) => handleRefineResult(r2, payload, input2, inst));
        }
        handleRefineResult(r, payload, input2, inst);
        return;
      };
    });
  }
});

// node_modules/zod/v4/core/memoizer.js
function isRef(value) {
  return value !== null && typeof value === "object";
}
function cloneIssues(issues) {
  return issues.map((iss) => iss.path ? { ...iss, path: iss.path.slice() } : { ...iss });
}
function isRecursive(inst, stack, resolve) {
  const cached2 = recursive.get(inst);
  if (cached2 !== void 0)
    return cached2 ? PROVEN : NONE;
  if (stack.has(inst))
    return PROVEN;
  stack.add(inst);
  let result = NONE;
  const check2 = (child) => {
    if (result !== PROVEN && child?._zod) {
      const answer = isRecursive(child, stack, resolve);
      if (answer > result)
        result = answer;
    }
  };
  const shape = (sh, spread) => {
    let answer = NONE;
    for (const key of Reflect.ownKeys(sh)) {
      const desc = Object.getOwnPropertyDescriptor(sh, key);
      if (spread && !desc.enumerable)
        continue;
      const child = desc.get ? ASSUMED : desc.value?._zod ? isRecursive(desc.value, stack, resolve) : NONE;
      if (child > answer)
        answer = child;
    }
    return answer;
  };
  const merge2 = (answer) => {
    if (answer > result)
      result = answer;
  };
  const def = inst._zod.def;
  const kind = def.type;
  switch (kind) {
    case "object": {
      const raw = rawShape(def);
      merge2(raw ? shape(raw, true) : ASSUMED);
      check2(def.catchall);
      break;
    }
    case "array":
      check2(def.element);
      break;
    case "tuple":
      for (const el of def.items)
        check2(el);
      check2(def.rest);
      break;
    case "record":
    case "map":
      check2(def.keyType);
      check2(def.valueType);
      break;
    case "set":
      check2(def.valueType);
      break;
    case "union":
      for (const el of def.options)
        check2(el);
      break;
    case "intersection":
      check2(def.left);
      check2(def.right);
      break;
    case "optional":
    case "nullable":
    case "default":
    case "prefault":
    case "catch":
    case "readonly":
    case "nonoptional":
    case "promise":
    case "success":
      check2(def.innerType);
      break;
    case "pipe":
      check2(def.in);
      check2(def.out);
      break;
    case "function":
      check2(def.input);
      check2(def.output);
      break;
    // `$ZodLazy` caches its inner on the def, so a resolved edge is followed exactly
    case "lazy": {
      const inner = def._cachedInner ?? (resolve ? inst._zod.innerType : void 0);
      merge2(inner ? isRecursive(inner, stack, false) : ASSUMED);
      break;
    }
    // a leaf by choice: `parts` are regex fragments, not data positions
    case "template_literal":
    // leaves
    case "string":
    case "number":
    case "int":
    case "boolean":
    case "bigint":
    case "symbol":
    case "undefined":
    case "null":
    case "void":
    case "never":
    case "any":
    case "unknown":
    case "date":
    case "nan":
    case "enum":
    case "literal":
    case "file":
    case "transform":
    case "custom":
      break;
    default: {
      kind;
      for (const key in def) {
        const desc = Object.getOwnPropertyDescriptor(def, key);
        if (!desc || desc.get)
          continue;
        const value = desc.value;
        if (!value || typeof value !== "object")
          continue;
        if (value._zod)
          check2(value);
        else if (Array.isArray(value))
          for (const el of value)
            check2(el);
      }
    }
  }
  stack.delete(inst);
  return settle(inst, result);
}
function settle(inst, answer) {
  if (answer !== ASSUMED)
    recursive.set(inst, answer === PROVEN);
  return answer;
}
function isRecursiveSchema(inst) {
  return isRecursive(inst, /* @__PURE__ */ new Set(), true) !== NONE;
}
function bucketFor(state, inst) {
  let bucket = state.buckets.get(inst);
  if (!bucket) {
    bucket = /* @__PURE__ */ new WeakMap();
    state.buckets.set(inst, bucket);
  }
  return bucket;
}
function memoizer() {
  return memo;
}
function isBackEdge(ctx, value) {
  const backEdges = ctx[STATE]?.backEdges;
  return backEdges !== void 0 && isRef(value) && backEdges.has(value);
}
var $ZodCyclicError, STATE, NO_ISSUES, recursive, NONE, ASSUMED, PROVEN, handoff, open, memo;
var init_memoizer = __esm({
  "node_modules/zod/v4/core/memoizer.js"() {
    init_util();
    $ZodCyclicError = class extends Error {
      constructor() {
        super(`Cannot parse a reference cycle that closes through a transform`);
        this.name = "ZodCyclicError";
      }
    };
    STATE = "~memo";
    NO_ISSUES = [];
    recursive = /* @__PURE__ */ new WeakMap();
    NONE = 0;
    ASSUMED = 1;
    PROVEN = 2;
    open = [];
    memo = {
      alloc(_inst, payload, empty) {
        const bucket = handoff;
        if (!bucket)
          return empty;
        handoff = void 0;
        const entry = { value: empty, issues: null };
        bucket.set(payload.value, entry);
        open.push(entry);
        return empty;
      },
      guard(inst) {
        var _a3;
        (_a3 = inst._zod).deferred ?? (_a3.deferred = []);
        inst._zod.deferred.push(() => {
          const base = inst._zod.parse;
          const wrapped = (payload, ctx) => {
            if (ctx.direction !== "backward" && isBackEdge(ctx, payload.value))
              throw new $ZodCyclicError();
            return base(payload, ctx);
          };
          inst._zod.parse = wrapped;
          if (inst._zod.run === base)
            inst._zod.run = wrapped;
        });
      },
      attach(inst) {
        var _a3;
        let isRecursiveInst;
        let rechecked = false;
        let lastCtx;
        let lastBucket;
        (_a3 = inst._zod).deferred ?? (_a3.deferred = []);
        inst._zod.deferred.push(() => {
          const base = inst._zod.parse;
          const wrapped = (payload, ctx) => {
            if (isRecursiveInst === void 0) {
              const walked = isRecursive(inst, /* @__PURE__ */ new Set(), false);
              if (walked === NONE) {
                inst._zod.parse = base;
                if (inst._zod.run === wrapped)
                  inst._zod.run = base;
                return base(payload, ctx);
              }
              if (walked === PROVEN || rechecked)
                isRecursiveInst = true;
              else
                rechecked = true;
            }
            const input2 = payload.value;
            if (!isRef(input2))
              return base(payload, ctx);
            let state = ctx[STATE];
            if (!state) {
              state = { buckets: /* @__PURE__ */ new WeakMap(), backEdges: void 0 };
              ctx[STATE] = state;
            }
            let bucket;
            if (lastCtx === ctx) {
              bucket = lastBucket;
            } else {
              bucket = bucketFor(state, inst);
              lastCtx = ctx;
              lastBucket = bucket;
            }
            const hit = bucket.get(input2);
            if (hit) {
              payload.value = hit.value;
              if (hit.issues) {
                if (hit.issues.length)
                  payload.issues.push(...cloneIssues(hit.issues));
              } else {
                payload.memo = true;
                state.backEdges ?? (state.backEdges = /* @__PURE__ */ new WeakSet());
                state.backEdges.add(hit.value);
              }
              return payload;
            }
            handoff = bucket;
            const depth = open.length;
            const result = base(payload, ctx);
            handoff = void 0;
            const entry = open.length > depth ? open.pop() : void 0;
            if (result instanceof Promise) {
              return result.then((r) => {
                if (entry)
                  entry.issues = r.issues.length ? cloneIssues(r.issues) : NO_ISSUES;
                return r;
              });
            }
            if (entry)
              entry.issues = result.issues.length ? cloneIssues(result.issues) : NO_ISSUES;
            return result;
          };
          inst._zod.parse = wrapped;
          if (inst._zod.run === base)
            inst._zod.run = wrapped;
        });
      }
    };
  }
});

// node_modules/zod/v4/locales/en.js
function en_default() {
  return {
    localeError: error()
  };
}
var error;
var init_en = __esm({
  "node_modules/zod/v4/locales/en.js"() {
    init_util();
    error = () => {
      const Sizable = {
        string: { unit: "characters", verb: "to have" },
        file: { unit: "bytes", verb: "to have" },
        array: { unit: "items", verb: "to have" },
        set: { unit: "items", verb: "to have" },
        map: { unit: "entries", verb: "to have" }
      };
      function getSizing(origin) {
        return Sizable[origin] ?? null;
      }
      const FormatDictionary = {
        regex: "input",
        email: "email address",
        url: "URL",
        emoji: "emoji",
        uuid: "UUID",
        uuidv4: "UUIDv4",
        uuidv6: "UUIDv6",
        nanoid: "nanoid",
        guid: "GUID",
        cuid: "cuid",
        cuid2: "cuid2",
        ulid: "ULID",
        xid: "XID",
        ksuid: "KSUID",
        datetime: "ISO datetime",
        date: "ISO date",
        time: "ISO time",
        duration: "ISO duration",
        ipv4: "IPv4 address",
        ipv6: "IPv6 address",
        mac: "MAC address",
        cidrv4: "IPv4 range",
        cidrv6: "IPv6 range",
        base64: "base64-encoded string",
        base64url: "base64url-encoded string",
        json_string: "JSON string",
        e164: "E.164 number",
        currency_code: "currency code",
        credit_card: "credit card number",
        iban: "IBAN",
        jwt: "JWT",
        template_literal: "input"
      };
      const TypeDictionary = {
        // Compatibility: "nan" -> "NaN" for display
        nan: "NaN"
        // All other type names omitted - they fall back to raw values via ?? operator
      };
      function getTypeName(type, input2) {
        if (type === "number" && typeof input2 === "number" && !Number.isFinite(input2)) {
          return String(input2);
        }
        return TypeDictionary[type] ?? type;
      }
      return (issue2) => {
        switch (issue2.code) {
          case "invalid_type": {
            const expected = getTypeName(issue2.expected);
            const receivedType = parsedType(issue2.input);
            const received = getTypeName(receivedType, issue2.input);
            return `Invalid input: expected ${expected}, received ${received}`;
          }
          case "invalid_value":
            if (issue2.values.length === 1)
              return `Invalid input: expected ${stringifyPrimitive(issue2.values[0])}`;
            return `Invalid option: expected one of ${joinValues(issue2.values, "|")}`;
          case "too_big": {
            const adj = issue2.exact ? "exactly " : issue2.inclusive ? "<=" : "<";
            const sizing = getSizing(issue2.origin);
            if (sizing)
              return `Too big: expected ${issue2.origin ?? "value"} to have ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "elements"}`;
            return `Too big: expected ${issue2.origin ?? "value"} to be ${adj}${issue2.maximum.toString()}`;
          }
          case "too_small": {
            const adj = issue2.exact ? "exactly " : issue2.inclusive ? ">=" : ">";
            const sizing = getSizing(issue2.origin);
            if (sizing) {
              return `Too small: expected ${issue2.origin} to have ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
            }
            return `Too small: expected ${issue2.origin} to be ${adj}${issue2.minimum.toString()}`;
          }
          case "invalid_format": {
            const _issue = issue2;
            if (_issue.format === "starts_with") {
              return `Invalid string: must start with "${_issue.prefix}"`;
            }
            if (_issue.format === "ends_with")
              return `Invalid string: must end with "${_issue.suffix}"`;
            if (_issue.format === "includes")
              return `Invalid string: must include "${_issue.includes}"`;
            if (_issue.format === "regex")
              return `Invalid string: must match pattern ${_issue.pattern}`;
            return `Invalid ${FormatDictionary[_issue.format] ?? issue2.format}`;
          }
          case "not_multiple_of":
            return `Invalid number: must be a multiple of ${issue2.divisor}`;
          case "unrecognized_keys":
            return `Unrecognized key${issue2.keys.length > 1 ? "s" : ""}: ${joinValues(issue2.keys, ", ")}`;
          case "invalid_key":
            return `Invalid key in ${issue2.origin}`;
          case "invalid_union":
            if (issue2.options && Array.isArray(issue2.options) && issue2.options.length > 0) {
              const opts = issue2.options.map((o) => `'${o}'`).join(" | ");
              return `Invalid discriminator value. Expected ${opts}`;
            }
            if (issue2.inclusive === false) {
              return "Invalid input: more than one option matched";
            }
            return "Invalid input";
          case "invalid_element":
            return `Invalid value in ${issue2.origin}`;
          default:
            return `Invalid input`;
        }
      };
    };
  }
});

// zod-english-only:zod-locales
var zod_locales_exports = {};
__export(zod_locales_exports, {
  en: () => en_default
});
var init_zod_locales = __esm({
  "zod-english-only:zod-locales"() {
    init_en();
  }
});

// node_modules/zod/v4/core/registries.js
function registry() {
  return new $ZodRegistry();
}
var _a2, $output, $input, $ZodRegistry, globalRegistry;
var init_registries = __esm({
  "node_modules/zod/v4/core/registries.js"() {
    $output = /* @__PURE__ */ Symbol("ZodOutput");
    $input = /* @__PURE__ */ Symbol("ZodInput");
    $ZodRegistry = class {
      constructor() {
        this._map = /* @__PURE__ */ new WeakMap();
        this._idmap = /* @__PURE__ */ new Map();
      }
      add(schema, ..._meta) {
        const meta3 = _meta[0];
        this._map.set(schema, meta3);
        if (meta3 && typeof meta3 === "object" && "id" in meta3) {
          this._idmap.set(meta3.id, schema);
        }
        return this;
      }
      clear() {
        this._map = /* @__PURE__ */ new WeakMap();
        this._idmap = /* @__PURE__ */ new Map();
        return this;
      }
      remove(schema) {
        const meta3 = this._map.get(schema);
        if (meta3 && typeof meta3 === "object" && "id" in meta3) {
          this._idmap.delete(meta3.id);
        }
        this._map.delete(schema);
        return this;
      }
      get(schema) {
        const p = schema._zod.parent;
        if (p) {
          const pm = { ...this.get(p) ?? {} };
          delete pm.id;
          const f = { ...pm, ...this._map.get(schema) };
          return Object.keys(f).length ? f : void 0;
        }
        return this._map.get(schema);
      }
      has(schema) {
        return this._map.has(schema);
      }
    };
    (_a2 = globalThis).__zod_globalRegistry ?? (_a2.__zod_globalRegistry = registry());
    globalRegistry = globalThis.__zod_globalRegistry;
  }
});

// node_modules/zod/v4/core/compile.js
function compileValidator(schema, parser2) {
  try {
    return compileFn(schema, { assertOnly: true });
  } catch {
    return parser2;
  }
}
function compile(schema, options) {
  try {
    const parser2 = compileFn(schema);
    const clone2 = withParser(schema, parser2);
    clone2._zod.bag.validator = compileValidator(schema, parser2);
    return clone2;
  } catch (err) {
    if (options?.strict)
      throw err;
    return schema;
  }
}
function withParser(schema, parser2) {
  if (isRecursiveSchema(schema)) {
    throw new ZodCompileUnsupportedError("a schema whose subtree contains a reference cycle");
  }
  const clone2 = clone(schema);
  const liveRun = schema._zod.run;
  const originalRun = liveRun.__originalRun ?? liveRun;
  const wrapped = (payload, ctx) => {
    if (ctx?.async || ctx?.direction === "backward" || ctx?.skipChecks || ctx?.[FALLBACK_FLAG]) {
      return originalRun(payload, ctx);
    }
    if (ctx && isBackEdge(ctx, payload.value)) {
      return originalRun(payload, ctx);
    }
    const out = parser2(payload.value);
    if (out !== INVALID) {
      payload.value = out;
      return payload;
    }
    if (ctx)
      ctx[FALLBACK_FLAG] = true;
    return originalRun(payload, ctx);
  };
  wrapped.__originalRun = originalRun;
  clone2._zod.bag.fallbackRun = originalRun;
  clone2._zod.bag.validator = parser2;
  clone2._zod.run = wrapped;
  if (!liveRun.__originalRun)
    installCompiledUserMethods(clone2, schema, parser2);
  return clone2;
}
function installCompiledUserMethods(target, source, parser2) {
  const targetAny = target;
  const sourceAny = source;
  if (typeof sourceAny.safeParse === "function") {
    const originalSafeParse = sourceAny.safeParse;
    targetAny.safeParse = (data, params) => {
      const out = parser2(data);
      if (out !== INVALID) {
        return { success: true, data: out };
      }
      return originalSafeParse(data, params);
    };
  }
  if (typeof sourceAny.parse === "function") {
    const originalParse = sourceAny.parse;
    targetAny.parse = (data, params) => {
      const out = parser2(data);
      if (out !== INVALID) {
        return out;
      }
      return originalParse(data, params);
    };
  }
}
function compileFn(schema, options) {
  let recursive2 = true;
  try {
    recursive2 = isRecursiveSchema(schema);
  } catch {
  }
  if (recursive2) {
    throw new ZodCompileUnsupportedError("a schema whose subtree contains a reference cycle");
  }
  const ctx = {
    constants: /* @__PURE__ */ new Map(),
    constantCounter: 0,
    varCounter: 0,
    definite: true
  };
  const doc = new Doc(["input"]);
  const outputAccessor = generateCheck(doc, ctx, schema, "input", !options?.assertOnly);
  doc.write(outputAccessor === null ? `return true;` : `return ${outputAccessor};`);
  const constantNames = ["INVALID", ...ctx.constants.keys()];
  const constantValues = [INVALID, ...ctx.constants.values()];
  const code = doc.content.join("\n");
  const fullCode = options?.debug ? constantNames.length > 0 ? `// Constants: ${constantNames.join(", ")}
${code}` : code : "";
  const F = Function;
  const factoryCode = `return (input) => {
${code}
}`;
  let fn;
  try {
    const factory = new F(...constantNames, factoryCode);
    fn = factory(...constantValues);
  } catch (err) {
    throw new ZodCompileUnsupportedError(`this schema (generated code failed to evaluate: ${err.message})`);
  }
  if (options?.debug) {
    fn.code = fullCode;
  }
  fn.definite = ctx.definite;
  return fn;
}
function addConstant(ctx, value) {
  for (const [name2, v] of ctx.constants) {
    if (v === value)
      return name2;
  }
  const name = `c${ctx.constantCounter++}`;
  ctx.constants.set(name, value);
  return name;
}
function addUserConstant(ctx, fn) {
  ctx.definite = false;
  return addConstant(ctx, fn);
}
function newVar(ctx) {
  return `v${ctx.varCounter++}`;
}
function runtimeRun(schema, value) {
  const result = schema._zod.run({ value, issues: [] }, {});
  if (result && typeof result.then === "function")
    return INVALID;
  const r = result;
  return r.issues.length === 0 ? r.value : INVALID;
}
function compileChild(doc, ctx, schema, accessor, needsValue = true) {
  const contentLen = doc.content.length;
  const constantCount = ctx.constants.size;
  const constantCounter = ctx.constantCounter;
  const varCounter = ctx.varCounter;
  try {
    return generateCheck(doc, ctx, schema, accessor, needsValue);
  } catch (err) {
    if (!(err instanceof ZodCompileUnsupportedError) || !err.islandable)
      throw err;
    doc.content.length = contentLen;
    if (ctx.constants.size > constantCount) {
      const trailing = Array.from(ctx.constants.keys()).slice(constantCount);
      for (const k of trailing)
        ctx.constants.delete(k);
    }
    ctx.constantCounter = constantCounter;
    ctx.varCounter = varCounter;
    return emitRuntimeIsland(doc, ctx, schema, accessor);
  }
}
function emitRuntimeIsland(doc, ctx, schema, accessor) {
  ctx.definite = false;
  const schemaConst = addConstant(ctx, schema);
  const runConst = addConstant(ctx, runtimeRun);
  const outVar = newVar(ctx);
  doc.write(`const ${outVar} = ${runConst}(${schemaConst}, ${accessor});`);
  doc.write(`if (${outVar} === INVALID) return INVALID;`);
  return outVar;
}
function generateChecks(doc, ctx, schema, accessor) {
  const schemaChecks = schema._zod.def.checks;
  if (!schemaChecks || schemaChecks.length === 0)
    return accessor;
  let currentAccessor = accessor;
  for (const check2 of schemaChecks) {
    const def = check2._zod.def;
    if (def.when && !WHEN_DEFAULTED_CHECKS.has(def.check)) {
      throw new ZodCompileUnsupportedError(`check with a custom "when" condition`);
    }
    switch (def.check) {
      case "greater_than":
        generateGreaterThanCheck(doc, ctx, def, currentAccessor);
        break;
      case "less_than":
        generateLessThanCheck(doc, ctx, def, currentAccessor);
        break;
      case "multiple_of":
        generateMultipleOfCheck(doc, ctx, def, currentAccessor);
        break;
      case "number_format":
        generateNumberFormatCheck(doc, def, currentAccessor);
        break;
      case "min_length": {
        const min = numericOperand(def.minimum, "min_length");
        const len = codePointLengthVar(doc, ctx, currentAccessor, `${currentAccessor}.length >= ${min} && ${currentAccessor}.length < ${def.minimum * 2}`);
        doc.write(`if (${len} < ${min}) return INVALID;`);
        break;
      }
      case "max_length": {
        const max = numericOperand(def.maximum, "max_length");
        const len = codePointLengthVar(doc, ctx, currentAccessor, `${currentAccessor}.length > ${max}`);
        doc.write(`if (${len} > ${max}) return INVALID;`);
        break;
      }
      case "length_equals": {
        const exact = numericOperand(def.length, "length_equals");
        const len = codePointLengthVar(doc, ctx, currentAccessor, `${currentAccessor}.length >= ${exact} && ${currentAccessor}.length <= ${def.length * 2}`);
        doc.write(`if (${len} !== ${exact}) return INVALID;`);
        break;
      }
      case "min_size":
        doc.write(`if (${currentAccessor}.size < ${numericOperand(def.minimum, "min_size")}) return INVALID;`);
        break;
      case "max_size":
        doc.write(`if (${currentAccessor}.size > ${numericOperand(def.maximum, "max_size")}) return INVALID;`);
        break;
      case "size_equals":
        doc.write(`if (${currentAccessor}.size !== ${numericOperand(def.size, "size_equals")}) return INVALID;`);
        break;
      case "string_format":
        currentAccessor = generateStringFormatCheck(doc, ctx, def, currentAccessor);
        break;
      case "custom":
        currentAccessor = generateCustomRefineCheck(doc, ctx, check2, currentAccessor);
        break;
      case "bigint_format":
        generateBigIntFormatCheck(doc, def, currentAccessor);
        break;
      case "mime_type":
        generateMimeTypeCheck(doc, ctx, def, currentAccessor);
        break;
      case "property":
        generatePropertyCheck(doc, ctx, def, currentAccessor);
        break;
      case "properties":
        generatePropertiesChecks(doc, ctx, def, currentAccessor);
        break;
      case "overwrite": {
        const newAccessor = newVar(ctx);
        generateOverwriteCheck(doc, ctx, check2, currentAccessor, newAccessor);
        currentAccessor = newAccessor;
        break;
      }
      default: {
        void def;
        throw new ZodCompileUnsupportedError(`check type ${def.check}`);
      }
    }
  }
  return currentAccessor;
}
function codePointLengthVar(doc, ctx, accessor, inDoubt) {
  const cpLen = addConstant(ctx, codePointLength);
  const v = newVar(ctx);
  doc.write(`const ${v} = typeof ${accessor} === "string" && ${inDoubt} ? ${cpLen}(${accessor}) : ${accessor}.length;`);
  return v;
}
function numericOperand(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ZodCompileUnsupportedError(`${label} bound of type ${typeof value}`);
  }
  return `${value}`;
}
function comparisonOperand(ctx, value) {
  if (typeof value === "bigint")
    return `${value}n`;
  if (typeof value === "number") {
    if (Number.isNaN(value))
      throw new ZodCompileUnsupportedError("comparison check with NaN bound");
    return `${value}`;
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new ZodCompileUnsupportedError("comparison check with Invalid Date bound");
    }
    return addConstant(ctx, value);
  }
  throw new ZodCompileUnsupportedError(`comparison check bound of type ${typeof value}`);
}
function generateGreaterThanCheck(doc, ctx, def, accessor) {
  const op = def.inclusive ? "<" : "<=";
  doc.write(`if (${accessor} ${op} ${comparisonOperand(ctx, def.value)}) return INVALID;`);
}
function generateLessThanCheck(doc, ctx, def, accessor) {
  const op = def.inclusive ? ">" : ">=";
  doc.write(`if (${accessor} ${op} ${comparisonOperand(ctx, def.value)}) return INVALID;`);
}
function generateMultipleOfCheck(doc, ctx, def, accessor) {
  if (typeof def.value === "bigint") {
    if (def.value === BigInt(0))
      throw new ZodCompileUnsupportedError("multiple_of check with a zero divisor");
    doc.write(`if (${accessor} % ${def.value}n !== 0n) return INVALID;`);
  } else {
    const remainder = addConstant(ctx, floatSafeRemainder);
    doc.write(`if (${remainder}(${accessor}, ${numericOperand(def.value, "multiple_of")}) !== 0) return INVALID;`);
  }
}
function generateNumberFormatCheck(doc, def, accessor) {
  const format = def.format;
  switch (format) {
    case "safeint":
      doc.write(`if (!Number.isSafeInteger(${accessor})) return INVALID;`);
      break;
    case "int32":
      doc.write(`if (!Number.isInteger(${accessor}) || ${accessor} < -2147483648 || ${accessor} > 2147483647) return INVALID;`);
      break;
    case "uint32":
      doc.write(`if (!Number.isInteger(${accessor}) || ${accessor} < 0 || ${accessor} > 4294967295) return INVALID;`);
      break;
    case "float32":
      doc.write(`if (!Number.isFinite(${accessor}) || ${accessor} < -3.4028234663852886e38 || ${accessor} > 3.4028234663852886e38) return INVALID;`);
      break;
    case "float64":
      doc.write(`if (!Number.isFinite(${accessor})) return INVALID;`);
      break;
    default: {
      void format;
      throw new ZodCompileUnsupportedError(`number format ${format}`);
    }
  }
}
function generateBigIntFormatCheck(doc, def, accessor) {
  const format = def.format;
  if (!format)
    return;
  switch (format) {
    case "int64":
      doc.write(`if (${accessor} < -9223372036854775808n || ${accessor} > 9223372036854775807n) return INVALID;`);
      break;
    case "uint64":
      doc.write(`if (${accessor} < 0n || ${accessor} > 18446744073709551615n) return INVALID;`);
      break;
    default: {
      void format;
      throw new ZodCompileUnsupportedError(`bigint format ${format}`);
    }
  }
}
function generateMimeTypeCheck(doc, ctx, def, accessor) {
  const mimeTypes = def.mime;
  if (mimeTypes && mimeTypes.length > 0) {
    const mimeSet = addConstant(ctx, new Set(mimeTypes));
    doc.write(`if (!${mimeSet}.has(${accessor}.type)) return INVALID;`);
  }
}
function generatePropertiesChecks(doc, ctx, def, accessor) {
  if (def.when) {
    throw new ZodCompileUnsupportedError(`check with a custom "when" condition`);
  }
  doc.write(`if (${accessor} == null) return INVALID;`);
  const shape = def.shape;
  for (const key of Reflect.ownKeys(shape)) {
    const keyExpr = typeof key === "symbol" ? addConstant(ctx, key) : esc(key);
    const inputVar = newVar(ctx);
    doc.write(`const ${inputVar} = ${accessor}[${keyExpr}];`);
    compileChild(doc, ctx, shape[key], inputVar, false);
  }
}
function generatePropertyCheck(doc, ctx, def, accessor) {
  const propAccessor = `${accessor}[${JSON.stringify(def.property)}]`;
  generateCheck(doc, ctx, def.schema, propAccessor);
}
function generateOverwriteCheck(doc, ctx, check2, currentAccessor, newAccessor) {
  const tx = check2._zod.def.tx;
  if (!tx) {
    throw new ZodCompileUnsupportedError("overwrite check without a transform function");
  }
  if (isAsyncFunction(tx)) {
    throw new ZodCompileAsyncError("z.compile: async overwrite transforms are not supported");
  }
  const txConst = addConstant(ctx, tx);
  doc.write(`const ${newAccessor} = ${txConst}(${currentAccessor});`);
}
function throwAsync() {
  throw new $ZodAsyncError();
}
function pushIssue(issue2) {
  this.issues.push(issue2);
}
function generateCustomRefineCheck(doc, ctx, check2, accessor) {
  const def = check2._zod.def;
  if (def.fn) {
    if (isAsyncFunction(def.fn)) {
      throw new ZodCompileAsyncError("z.compile: async .refine() predicates are not supported");
    }
    const fnConst = addUserConstant(ctx, def.fn);
    const throwAsyncConst = addConstant(ctx, throwAsync);
    const resVar = newVar(ctx);
    doc.write(`const ${resVar} = ${fnConst}(${accessor});`);
    doc.write(`if (${resVar} instanceof Promise) ${throwAsyncConst}();`);
    doc.write(`if (!${resVar}) return INVALID;`);
    return accessor;
  }
  if (check2._zod.check) {
    if (isAsyncFunction(check2._zod.check)) {
      throw new ZodCompileAsyncError("z.compile: async .superRefine() / check functions are not supported");
    }
    const checkFn = check2._zod.check;
    const helperFn = (value) => {
      const fakePayload = { value, issues: [], addIssue: pushIssue };
      const result = checkFn(fakePayload);
      if (result instanceof Promise)
        throwAsync();
      return fakePayload.issues.length === 0 ? fakePayload.value : INVALID;
    };
    const helperConst = addUserConstant(ctx, helperFn);
    const outVar = newVar(ctx);
    doc.write(`const ${outVar} = ${helperConst}(${accessor});`);
    doc.write(`if (${outVar} === INVALID) return INVALID;`);
    return outVar;
  }
  throw new ZodCompileUnsupportedError("custom check without a predicate or check function");
}
function generateStringFormatCheck(doc, ctx, def, accessor, needsValue = true) {
  const fmt = def.format;
  if (fmt === "base64") {
    const validator = addConstant(ctx, isValidBase64);
    doc.write(`if (!${validator}(${accessor})) return INVALID;`);
    return accessor;
  }
  if (fmt === "base64url") {
    const validator = addConstant(ctx, isValidBase64URL);
    doc.write(`if (!${validator}(${accessor})) return INVALID;`);
    return accessor;
  }
  if (fmt === "jwt") {
    const validator = addConstant(ctx, isValidJWT);
    const alg = addConstant(ctx, def.alg ?? null);
    doc.write(`if (!${validator}(${accessor}, ${alg})) return INVALID;`);
    return accessor;
  }
  if (fmt === "ipv6") {
    const validator = addConstant(ctx, isValidIPv6);
    doc.write(`if (!${validator}(${accessor})) return INVALID;`);
    return accessor;
  }
  if (fmt === "cidrv6") {
    const validator = addConstant(ctx, isValidCIDRv6);
    doc.write(`if (!${validator}(${accessor})) return INVALID;`);
    return accessor;
  }
  if (fmt === "credit_card") {
    const validator = addConstant(ctx, isValidCreditCard);
    doc.write(`if (!${validator}(${accessor})) return INVALID;`);
    return accessor;
  }
  if (fmt === "iban") {
    const validator = addConstant(ctx, isValidIBAN);
    doc.write(`if (!${validator}(${accessor})) return INVALID;`);
    return accessor;
  }
  const formatDef = def;
  if (fmt === "url" || fmt === "httpurl" || formatDef.normalize || formatDef.hostname !== void 0 || formatDef.protocol !== void 0) {
    const parseConst = addConstant(ctx, validateURL);
    const defConst = addConstant(ctx, def);
    const trimVar = newVar(ctx);
    const urlVar = newVar(ctx);
    doc.write(`const ${trimVar} = ${accessor}.trim();`);
    doc.write(`const ${urlVar} = ${parseConst}(${trimVar}, ${defConst});`);
    doc.write(`if (typeof ${urlVar} === "number") return INVALID;`);
    if (formatDef.hostname !== void 0) {
      const hostnameConst = addConstant(ctx, urlHostnameOk);
      doc.write(`if (!${hostnameConst}(${urlVar}, ${defConst}.hostname)) return INVALID;`);
    }
    if (formatDef.protocol !== void 0) {
      const protocolConst = addConstant(ctx, urlProtocolOk);
      doc.write(`if (!${protocolConst}(${urlVar}, ${defConst}.protocol)) return INVALID;`);
    }
    if (!needsValue)
      return null;
    const outputVar = newVar(ctx);
    const outputExpr = formatDef.normalize ? `${urlVar}.href` : `${addConstant(ctx, stripTabAndNewline)}(${trimVar})`;
    doc.write(`const ${outputVar} = ${outputExpr};`);
    return outputVar;
  }
  const customFn = def.fn;
  if (customFn) {
    if (isAsyncFunction(customFn))
      throw new ZodCompileUnsupportedError(`async string format ${fmt}`);
    const fnConst = addConstant(ctx, customFn);
    doc.write(`if (!${fnConst}(${accessor})) return INVALID;`);
    return accessor;
  }
  if (PATTERN_IS_COMPLETE.has(fmt) && def.pattern) {
    const patternConst = addConstant(ctx, def.pattern);
    doc.write(`${patternConst}.lastIndex = 0;`);
    doc.write(`if (!${patternConst}.test(${accessor})) return INVALID;`);
    return accessor;
  }
  const format = def.format;
  switch (format) {
    case "regex":
      throw new ZodCompileUnsupportedError("regex format without a pattern");
    case "lowercase":
      doc.write(`if (${accessor} !== ${accessor}.toLowerCase()) return INVALID;`);
      break;
    case "uppercase":
      doc.write(`if (${accessor} !== ${accessor}.toUpperCase()) return INVALID;`);
      break;
    case "includes":
      doc.write(`if (!${accessor}.includes(${esc(def.includes)})) return INVALID;`);
      break;
    case "starts_with": {
      const prefix = def.prefix;
      doc.write(`if (${accessor}.slice(0, ${prefix.length}) !== ${esc(prefix)}) return INVALID;`);
      break;
    }
    case "ends_with": {
      const suffix = def.suffix;
      doc.write(`if (${accessor}.slice(-${suffix.length}) !== ${esc(suffix)}) return INVALID;`);
      break;
    }
    default: {
      void format;
      throw new ZodCompileUnsupportedError(`string format ${format}`);
    }
  }
  return accessor;
}
function generateCheck(doc, ctx, schema, accessor, needsValue = true) {
  const def = schema._zod.def;
  const type = def.type;
  if (def.coerce) {
    throw new ZodCompileUnsupportedError(`coercion (z.coerce.${type}())`);
  }
  const buildsValue = needsValue || !!def.checks?.length;
  let typeAccessor;
  switch (type) {
    case "string":
      typeAccessor = generateStringCheck(doc, ctx, schema, accessor, buildsValue);
      break;
    case "number":
      typeAccessor = generateNumberCheck(doc, schema, accessor);
      break;
    case "boolean":
      typeAccessor = generateBooleanCheck(doc, accessor);
      break;
    case "bigint":
      typeAccessor = generateBigIntCheck(doc, schema, accessor);
      break;
    case "symbol":
      typeAccessor = generateSymbolCheck(doc, accessor);
      break;
    case "undefined":
      typeAccessor = generateUndefinedCheck(doc, accessor);
      break;
    case "null":
      typeAccessor = generateNullCheck(doc, accessor);
      break;
    case "any":
    case "unknown":
      typeAccessor = accessor;
      break;
    case "never":
      doc.write("return INVALID;");
      typeAccessor = accessor;
      break;
    case "void":
      typeAccessor = generateVoidCheck(doc, accessor);
      break;
    case "nan":
      typeAccessor = generateNaNCheck(doc, accessor);
      break;
    case "date":
      typeAccessor = generateDateCheck(doc, accessor);
      break;
    case "object":
      typeAccessor = generateObjectCheck(doc, ctx, schema, accessor, buildsValue);
      break;
    case "optional":
      typeAccessor = generateOptionalCheck(doc, ctx, schema, accessor, buildsValue);
      break;
    case "nullable":
      typeAccessor = generateNullableCheck(doc, ctx, schema, accessor, buildsValue);
      break;
    case "array":
      typeAccessor = generateArrayCheck(doc, ctx, schema, accessor, buildsValue);
      break;
    case "literal":
      typeAccessor = generateLiteralCheck(doc, ctx, schema, accessor);
      break;
    case "enum":
      typeAccessor = generateEnumCheck(doc, ctx, schema, accessor);
      break;
    case "readonly": {
      const innerOut = generateWrapperCheck(doc, ctx, schema, accessor);
      const frozenVar = newVar(ctx);
      doc.write(`const ${frozenVar} = Object.freeze(${innerOut});`);
      typeAccessor = frozenVar;
      break;
    }
    case "success":
      generateWrapperCheck(doc, ctx, schema, accessor);
      typeAccessor = "true";
      break;
    case "default":
    case "prefault":
      typeAccessor = generateDefaultCheck(doc, ctx, schema, accessor);
      break;
    case "nonoptional":
      typeAccessor = generateNonOptionalCheck(doc, ctx, schema, accessor);
      break;
    case "tuple":
      typeAccessor = generateTupleCheck(doc, ctx, schema, accessor);
      break;
    case "union":
      typeAccessor = generateUnionCheck(doc, ctx, schema, accessor);
      break;
    case "intersection":
      typeAccessor = generateIntersectionCheck(doc, ctx, schema, accessor);
      break;
    case "record":
      typeAccessor = generateRecordCheck(doc, ctx, schema, accessor);
      break;
    case "map":
      typeAccessor = generateMapCheck(doc, ctx, schema, accessor);
      break;
    case "set":
      typeAccessor = generateSetCheck(doc, ctx, schema, accessor);
      break;
    case "file":
      typeAccessor = generateFileCheck(doc, accessor);
      break;
    case "template_literal":
      typeAccessor = generateTemplateLiteralCheck(doc, ctx, schema, accessor);
      break;
    case "lazy":
      typeAccessor = generateLazyCheck(doc, ctx, schema, accessor);
      break;
    case "pipe":
      typeAccessor = generatePipeCheck(doc, ctx, schema, accessor);
      break;
    case "custom":
      typeAccessor = generateCustomCheck(doc, ctx, schema, accessor);
      break;
    case "transform":
      typeAccessor = generateTransformCheck(doc, ctx, schema, accessor);
      break;
    case "catch":
      typeAccessor = generateCatchCheck(doc, ctx, schema, accessor);
      break;
    default: {
      void type;
      throw new ZodCompileUnsupportedError(`schema type ${type}`);
    }
  }
  if (typeAccessor === null)
    return null;
  return generateChecks(doc, ctx, schema, typeAccessor);
}
function generateStringCheck(doc, ctx, schema, accessor, needsValue = true) {
  doc.write(`if (typeof ${accessor} !== "string") return INVALID;`);
  const def = schema._zod.def;
  if (def.format === void 0)
    return accessor;
  return generateStringFormatCheck(doc, ctx, def, accessor, needsValue);
}
function generateNumberCheck(doc, schema, accessor) {
  doc.write(`if (typeof ${accessor} !== "number" || !Number.isFinite(${accessor})) return INVALID;`);
  const def = schema._zod.def;
  if (def.check === "number_format" && def.format) {
    generateNumberFormatCheck(doc, { format: def.format }, accessor);
  }
  return accessor;
}
function generateBooleanCheck(doc, accessor) {
  doc.write(`if (typeof ${accessor} !== "boolean") return INVALID;`);
  return accessor;
}
function generateBigIntCheck(doc, schema, accessor) {
  doc.write(`if (typeof ${accessor} !== "bigint") return INVALID;`);
  const def = schema._zod.def;
  if (def.format) {
    switch (def.format) {
      case "int64":
        doc.write(`if (${accessor} < -9223372036854775808n || ${accessor} > 9223372036854775807n) return INVALID;`);
        break;
      case "uint64":
        doc.write(`if (${accessor} < 0n || ${accessor} > 18446744073709551615n) return INVALID;`);
        break;
    }
  }
  return accessor;
}
function generateSymbolCheck(doc, accessor) {
  doc.write(`if (typeof ${accessor} !== "symbol") return INVALID;`);
  return accessor;
}
function generateUndefinedCheck(doc, accessor) {
  doc.write(`if (${accessor} !== undefined) return INVALID;`);
  return accessor;
}
function generateNullCheck(doc, accessor) {
  doc.write(`if (${accessor} !== null) return INVALID;`);
  return accessor;
}
function generateVoidCheck(doc, accessor) {
  doc.write(`if (${accessor} !== undefined) return INVALID;`);
  return accessor;
}
function generateNaNCheck(doc, accessor) {
  doc.write(`if (typeof ${accessor} !== "number" || !Number.isNaN(${accessor})) return INVALID;`);
  return accessor;
}
function generateDateCheck(doc, accessor) {
  doc.write(`if (!(${accessor} instanceof Date) || Number.isNaN(${accessor}.getTime())) return INVALID;`);
  return accessor;
}
function generateObjectCheck(doc, ctx, schema, accessor, buildsValue = true) {
  const def = schema._zod.def;
  doc.write(`if (typeof ${accessor} !== "object" || ${accessor} === null || Array.isArray(${accessor})) return INVALID;`);
  const shape = def.shape;
  const keys = Object.keys(shape);
  const symbolKeys = Object.getOwnPropertySymbols(shape);
  const allKeys = symbolKeys.length ? [...keys, ...symbolKeys] : keys;
  const keyExpr = (k) => typeof k === "symbol" ? addConstant(ctx, k) : esc(k);
  const propKey = (k) => typeof k === "symbol" ? `[${keyExpr(k)}]` : esc(k);
  const propShape = shape;
  if (keys.includes("__proto__")) {
    throw new ZodCompileUnsupportedError('object shape key "__proto__"');
  }
  const propOutputs = /* @__PURE__ */ new Map();
  for (const key of allKeys) {
    const propSchema = propShape[key];
    const kx = keyExpr(key);
    const inputVar = newVar(ctx);
    doc.write(`const ${inputVar} = ${accessor}[${kx}];`);
    if (propSchema._zod.optin !== void 0) {
      const outputVar2 = newVar(ctx);
      doc.write(`let ${outputVar2} = (() => {`);
      doc.indented((d) => {
        const outputAccessor = compileChild(d, ctx, propSchema, inputVar);
        d.write(`return ${outputAccessor};`);
      });
      doc.write(`})();`);
      if (propSchema._zod.optout === "optional") {
        doc.write(`if (${outputVar2} === INVALID) {`);
        doc.indented((d) => {
          d.write(`if (${kx} in ${accessor}) return INVALID;`);
          d.write(`${outputVar2} = undefined;`);
        });
        doc.write(`}`);
      } else {
        doc.write(`if (${outputVar2} === INVALID) return INVALID;`);
      }
      propOutputs.set(key, outputVar2);
    } else {
      if (requiresPresenceCheck(propSchema)) {
        doc.write(`if (!(${kx} in ${accessor})) return INVALID;`);
      }
      const outputAccessor = compileChild(doc, ctx, propSchema, inputVar, buildsValue);
      if (outputAccessor !== null)
        propOutputs.set(key, outputAccessor);
    }
  }
  const catchall = def.catchall;
  let unknownKeysMode = "none";
  if (catchall) {
    const catchallType = catchall._zod.def.type;
    if (catchallType === "never") {
      const condition = keys.map((k) => `k !== ${esc(k)}`).join(" && ") || "true";
      doc.write(`for (const k in ${accessor}) {`);
      doc.indented((d) => {
        d.write(`if (${condition}) return INVALID;`);
      });
      doc.write(`}`);
    } else if ((catchallType === "unknown" || catchallType === "any") && !catchall._zod.def.checks?.length) {
      unknownKeysMode = "passthrough";
    } else {
      unknownKeysMode = "schema";
    }
  }
  const outputVar = newVar(ctx);
  const hasConditionalKeys = allKeys.some((k) => mayOmitUndefined(propShape[k]) || dropsWhenAbsent(propShape[k]));
  if (!buildsValue) {
    if (unknownKeysMode === "schema") {
      const knownSet = keys.length > 0 ? addConstant(ctx, new Set(keys)) : null;
      doc.write(`for (const k in ${accessor}) {`);
      doc.indented((d) => {
        d.write(`if (k === "__proto__") continue;`);
        if (knownSet)
          d.write(`if (${knownSet}.has(k)) continue;`);
        const valVar = newVar(ctx);
        d.write(`const ${valVar} = ${accessor}[k];`);
        compileChild(d, ctx, catchall, valVar, false);
      });
      doc.write(`}`);
    }
    return null;
  }
  if (!hasConditionalKeys) {
    const propLiterals = allKeys.map((k) => `${propKey(k)}: ${propOutputs.get(k)}`).join(", ");
    doc.write(`const ${outputVar} = { ${propLiterals} };`);
  } else {
    doc.write(`const ${outputVar} = {};`);
    for (const k of allKeys) {
      const kx = keyExpr(k);
      const out = propOutputs.get(k);
      if (dropsWhenAbsent(propShape[k])) {
        doc.write(`if (${kx} in ${accessor}) ${outputVar}[${kx}] = ${out};`);
      } else if (mayOmitUndefined(propShape[k])) {
        doc.write(`if (${out} !== undefined || ${kx} in ${accessor}) ${outputVar}[${kx}] = ${out};`);
      } else {
        doc.write(`${outputVar}[${kx}] = ${out};`);
      }
    }
  }
  if (unknownKeysMode !== "none") {
    const knownSet = keys.length > 0 ? addConstant(ctx, new Set(keys)) : null;
    doc.write(`for (const k in ${accessor}) {`);
    doc.indented((d) => {
      d.write(`if (k === "__proto__") continue;`);
      if (knownSet)
        d.write(`if (${knownSet}.has(k)) continue;`);
      if (unknownKeysMode === "passthrough") {
        d.write(`${outputVar}[k] = ${accessor}[k];`);
      } else {
        const valVar = newVar(ctx);
        d.write(`const ${valVar} = ${accessor}[k];`);
        const catchallOut = compileChild(d, ctx, catchall, valVar);
        d.write(`${outputVar}[k] = ${catchallOut};`);
      }
    });
    doc.write(`}`);
  }
  return outputVar;
}
function generateOptionalCheck(doc, ctx, schema, accessor, buildsValue = true) {
  const def = schema._zod.def;
  if (isExactOptional(schema)) {
    return generateCheck(doc, ctx, def.innerType, accessor, buildsValue);
  }
  if (def.innerType._zod.optin === "defaulted") {
    const outputVar2 = newVar(ctx);
    const branchVar = newVar(ctx);
    doc.write(`let ${outputVar2};`);
    doc.write(`if (${accessor} === undefined) {`);
    doc.indented((d) => {
      d.write(`const ${branchVar} = (() => {`);
      d.indented((d2) => {
        const innerOutput = generateCheck(d2, ctx, def.innerType, accessor);
        d2.write(`return ${innerOutput};`);
      });
      d.write(`})();`);
      d.write(`if (${branchVar} !== INVALID) ${outputVar2} = ${branchVar};`);
    });
    doc.write(`} else {`);
    doc.indented((d) => {
      const innerOutput = generateCheck(d, ctx, def.innerType, accessor);
      d.write(`${outputVar2} = ${innerOutput};`);
    });
    doc.write(`}`);
    return outputVar2;
  }
  const outputVar = buildsValue ? newVar(ctx) : null;
  if (outputVar)
    doc.write(`let ${outputVar};`);
  doc.write(`if (${accessor} !== undefined) {`);
  doc.indented((d) => {
    const innerOutput = generateCheck(d, ctx, def.innerType, accessor, buildsValue);
    if (outputVar && innerOutput !== null)
      d.write(`${outputVar} = ${innerOutput};`);
  });
  doc.write(`}`);
  return outputVar;
}
function isExactOptional(schema) {
  return schema._zod.traits?.has("$ZodExactOptional") === true;
}
function requiresPresenceCheck(schema) {
  return schema._zod.optin === void 0 && fastPathAcceptsAbsence(schema);
}
function fastPathAcceptsAbsence(schema) {
  if (schema._zod.def.coerce)
    return true;
  const def = schema._zod.def;
  switch (def.type) {
    case "any":
    case "unknown":
    case "undefined":
    case "void":
    case "default":
    case "prefault":
    case "transform":
    case "custom":
    case "lazy":
      return true;
    case "string":
    case "number":
    case "boolean":
    case "bigint":
    case "symbol":
    case "null":
    case "never":
    case "nan":
    case "date":
    case "object":
    case "array":
    case "tuple":
    case "record":
    case "map":
    case "set":
    case "file":
    case "template_literal":
      return false;
    case "nonoptional":
      return def.innerType ? fastPathAcceptsAbsence(def.innerType) : false;
    case "literal":
      return !!def.values?.includes(void 0);
    case "enum":
      return !!schema._zod.values?.has(void 0);
    case "optional":
    case "nullable":
    case "readonly":
    case "success":
      return def.innerType ? fastPathAcceptsAbsence(def.innerType) : true;
    case "catch":
      return true;
    case "union":
      return def.options ? def.options.some(fastPathAcceptsAbsence) : true;
    case "intersection":
      if (!def.left || !def.right)
        return true;
      return fastPathAcceptsAbsence(def.left) && fastPathAcceptsAbsence(def.right);
    case "pipe":
      return def.in ? fastPathAcceptsAbsence(def.in) : true;
    default:
      return true;
  }
}
function dropsWhenAbsent(schema) {
  return schema._zod.optin === "optional" && schema._zod.optout === "optional";
}
function mayOmitUndefined(schema) {
  return (schema._zod.optin !== "defaulted" || schema._zod.optout === "optional") && mayOutputUndefined(schema);
}
function mayOutputUndefined(schema) {
  const def = schema._zod.def;
  switch (def.type) {
    case "string":
    case "number":
    case "boolean":
    case "bigint":
    case "symbol":
    case "null":
    case "nan":
    case "date":
    case "object":
    case "array":
    case "tuple":
    case "record":
    case "map":
    case "set":
    case "file":
    case "template_literal":
    case "never":
    case "success":
      return false;
    case "literal":
      return !!def.values?.includes(void 0);
    case "enum":
      return !!schema._zod.values?.has(void 0);
    case "optional":
      return true;
    case "nullable":
    case "readonly":
    case "nonoptional":
      return def.innerType ? mayOutputUndefined(def.innerType) : true;
    case "union":
      return def.options ? def.options.some(mayOutputUndefined) : true;
    case "intersection":
      return !def.left || !def.right || mayOutputUndefined(def.left) || mayOutputUndefined(def.right);
    case "pipe":
      return def.out ? mayOutputUndefined(def.out) : true;
    default:
      return true;
  }
}
function generateNullableCheck(doc, ctx, schema, accessor, buildsValue = true) {
  const def = schema._zod.def;
  const outputVar = buildsValue ? newVar(ctx) : null;
  if (outputVar)
    doc.write(`let ${outputVar} = null;`);
  doc.write(`if (${accessor} !== null) {`);
  doc.indented((d) => {
    const innerOutput = generateCheck(d, ctx, def.innerType, accessor, buildsValue);
    if (outputVar && innerOutput !== null)
      d.write(`${outputVar} = ${innerOutput};`);
  });
  doc.write(`}`);
  return outputVar;
}
function generateArrayCheck(doc, ctx, schema, accessor, buildsValue = true) {
  const def = schema._zod.def;
  doc.write(`if (!Array.isArray(${accessor})) return INVALID;`);
  const outputVar = buildsValue ? newVar(ctx) : null;
  const iVar = newVar(ctx);
  const elemVar = newVar(ctx);
  if (outputVar)
    doc.write(`const ${outputVar} = new Array(${accessor}.length);`);
  doc.write(`for (let ${iVar} = 0; ${iVar} < ${accessor}.length; ${iVar}++) {`);
  doc.indented((d) => {
    d.write(`const ${elemVar} = ${accessor}[${iVar}];`);
    const elemOutput = compileChild(d, ctx, def.element, elemVar, buildsValue);
    if (outputVar && elemOutput !== null)
      d.write(`${outputVar}[${iVar}] = ${elemOutput};`);
  });
  doc.write(`}`);
  return outputVar;
}
function generateLiteralCheck(doc, ctx, schema, accessor) {
  const def = schema._zod.def;
  const values = def.values;
  if (values.length !== 1) {
    const literalSet = addConstant(ctx, new Set(values));
    doc.write(`if (!${literalSet}.has(${accessor})) return INVALID;`);
    return accessor;
  }
  const value = values[0];
  if (typeof value === "number" && Number.isNaN(value)) {
    const literalSet = addConstant(ctx, new Set(values));
    doc.write(`if (!${literalSet}.has(${accessor})) return INVALID;`);
    return accessor;
  }
  if (typeof value === "string") {
    doc.write(`if (${accessor} !== ${esc(value)}) return INVALID;`);
  } else if (typeof value === "number" || typeof value === "boolean") {
    doc.write(`if (${accessor} !== ${value}) return INVALID;`);
  } else if (value === null) {
    doc.write(`if (${accessor} !== null) return INVALID;`);
  } else if (value === void 0) {
    doc.write(`if (${accessor} !== undefined) return INVALID;`);
  } else if (typeof value === "bigint") {
    doc.write(`if (${accessor} !== ${value}n) return INVALID;`);
  } else {
    throw new ZodCompileUnsupportedError(`literal type ${typeof value}`);
  }
  return accessor;
}
function generateEnumCheck(doc, ctx, schema, accessor) {
  const values = schema._zod.values;
  if (!values) {
    throw new ZodCompileUnsupportedError("enum schema without enumerated values");
  }
  const enumSet = addConstant(ctx, values);
  doc.write(`if (!${enumSet}.has(${accessor})) return INVALID;`);
  return accessor;
}
function generateWrapperCheck(doc, ctx, schema, accessor) {
  const def = schema._zod.def;
  return generateCheck(doc, ctx, def.innerType, accessor);
}
function generateDefaultCheck(doc, ctx, schema, accessor) {
  const def = schema._zod.def;
  const descriptor = Object.getOwnPropertyDescriptor(schema._zod.def, "defaultValue");
  const defaultGetter = descriptor ? () => schema._zod.def.defaultValue : void 0;
  if (schema._zod.def.type === "prefault") {
    if (!defaultGetter) {
      return generateCheck(doc, ctx, def.innerType, accessor);
    }
    const defaultFn = addConstant(ctx, defaultGetter);
    const inputVar = newVar(ctx);
    doc.write(`let ${inputVar} = ${accessor};`);
    doc.write(`if (${accessor} === undefined) ${inputVar} = ${defaultFn}();`);
    return generateCheck(doc, ctx, def.innerType, inputVar);
  }
  const outputVar = newVar(ctx);
  if (defaultGetter) {
    const defaultFn = addConstant(ctx, defaultGetter);
    const cloneFn = addConstant(ctx, shallowClone);
    doc.write(`let ${outputVar};`);
    doc.write(`if (${accessor} === undefined) {`);
    doc.indented((d) => {
      d.write(`${outputVar} = ${cloneFn}(${defaultFn}());`);
    });
    doc.write(`} else {`);
    doc.indented((d) => {
      const innerOutput = generateCheck(d, ctx, def.innerType, accessor);
      d.write(`${outputVar} = ${innerOutput} === undefined ? ${cloneFn}(${defaultFn}()) : ${innerOutput};`);
    });
    doc.write(`}`);
  } else {
    doc.write(`let ${outputVar};`);
    doc.write(`if (${accessor} !== undefined) {`);
    doc.indented((d) => {
      const innerOutput = generateCheck(d, ctx, def.innerType, accessor);
      d.write(`${outputVar} = ${innerOutput};`);
    });
    doc.write(`}`);
  }
  return outputVar;
}
function generateNonOptionalCheck(doc, ctx, schema, accessor) {
  const def = schema._zod.def;
  const innerOutput = generateCheck(doc, ctx, def.innerType, accessor);
  const outputVar = newVar(ctx);
  doc.write(`const ${outputVar} = ${innerOutput};`);
  doc.write(`if (${outputVar} === undefined) return INVALID;`);
  return outputVar;
}
function generateTupleCheck(doc, ctx, schema, accessor) {
  const def = schema._zod.def;
  const items = def.items;
  const rest = def.rest;
  doc.write(`if (!Array.isArray(${accessor})) return INVALID;`);
  const optinStart = getTupleOptStart2(items, "optin");
  const optoutStart = getTupleOptStart2(items, "optout");
  if (rest) {
    doc.write(`if (${accessor}.length < ${optinStart}) return INVALID;`);
  } else {
    doc.write(`if (${accessor}.length < ${optinStart} || ${accessor}.length > ${items.length}) return INVALID;`);
  }
  const outputVar = newVar(ctx);
  doc.write(`const ${outputVar} = [];`);
  for (let i = 0; i < items.length; i++) {
    const itemSchema = items[i];
    if (i >= optoutStart) {
      doc.write(`if (${outputVar}.length === ${i}) {`);
      doc.indented((d) => {
        d.write(`if (${i} < ${accessor}.length) {`);
        d.indented((d2) => {
          const elemVar = newVar(ctx);
          d2.write(`const ${elemVar} = ${accessor}[${i}];`);
          const elemOutput = compileChild(d2, ctx, itemSchema, elemVar);
          d2.write(`${outputVar}[${i}] = ${elemOutput};`);
        });
        d.write(`} else {`);
        d.indented((d2) => {
          if (dropsWhenAbsent(itemSchema)) {
            d2.write(`${outputVar}.length = ${i};`);
            return;
          }
          const elemVar = newVar(ctx);
          const branchVar = newVar(ctx);
          d2.write(`const ${elemVar} = undefined;`);
          d2.write(`const ${branchVar} = (() => {`);
          d2.indented((d3) => {
            const elemOutput = compileChild(d3, ctx, itemSchema, elemVar);
            d3.write(`return ${elemOutput};`);
          });
          d2.write(`})();`);
          d2.write(`if (${branchVar} === INVALID || ${branchVar} === undefined) ${outputVar}.length = ${i};`);
          d2.write(`else ${outputVar}[${i}] = ${branchVar};`);
        });
        d.write(`}`);
      });
      doc.write(`}`);
    } else {
      const elemVar = newVar(ctx);
      doc.write(`const ${elemVar} = ${accessor}[${i}];`);
      const elemOutput = compileChild(doc, ctx, itemSchema, elemVar);
      doc.write(`${outputVar}[${i}] = ${elemOutput};`);
    }
  }
  if (rest) {
    const iVar = newVar(ctx);
    const elemVar = newVar(ctx);
    doc.write(`for (let ${iVar} = ${items.length}; ${iVar} < ${accessor}.length; ${iVar}++) {`);
    doc.indented((d) => {
      d.write(`const ${elemVar} = ${accessor}[${iVar}];`);
      const elemOutput = compileChild(d, ctx, rest, elemVar);
      d.write(`${outputVar}[${iVar}] = ${elemOutput};`);
    });
    doc.write(`}`);
  }
  return outputVar;
}
function getTupleOptStart2(items, key) {
  for (let i = items.length - 1; i >= 0; i--) {
    const omittable = key === "optin" ? items[i]._zod.optin !== void 0 : items[i]._zod.optout === "optional";
    if (!omittable)
      return i + 1;
  }
  return 0;
}
function generateUnionCheck(doc, ctx, schema, accessor) {
  const def = schema._zod.def;
  const options = def.options;
  if (def.discriminator) {
    return generateDiscriminatedUnionCheck(doc, ctx, def, accessor);
  }
  if (def.inclusive === false) {
    throw new ZodCompileUnsupportedError("exclusive unions (z.xor)");
  }
  if (options.length === 0) {
    doc.write("return INVALID;");
    return accessor;
  }
  if (options.length === 1) {
    return generateCheck(doc, ctx, options[0], accessor);
  }
  const allLiterals = options.every((opt) => opt._zod.def.type === "literal" && !opt._zod.def.checks?.length);
  if (allLiterals) {
    const values = new Set(options.flatMap((opt) => opt._zod.def.values));
    const valuesConst = addConstant(ctx, values);
    doc.write(`if (!${valuesConst}.has(${accessor})) return INVALID;`);
    return accessor;
  }
  const outputVar = newVar(ctx);
  doc.write(`let ${outputVar};`);
  for (let i = 0; i < options.length; i++) {
    const opt = options[i];
    if (i === 0) {
      doc.write(`${outputVar} = (() => {`);
    } else {
      doc.write(`if (${outputVar} === INVALID) ${outputVar} = (() => {`);
    }
    doc.indented((d) => {
      const branchOutput = generateCheck(d, ctx, opt, accessor);
      d.write(`return ${branchOutput};`);
    });
    doc.write(`})();`);
  }
  doc.write(`if (${outputVar} === INVALID) return INVALID;`);
  return outputVar;
}
function generateDiscriminatedUnionCheck(doc, ctx, def, accessor) {
  if (def.unionFallback) {
    throw new ZodCompileUnsupportedError("discriminated union with unionFallback");
  }
  if (def.options.length === 0) {
    doc.write("return INVALID;");
    return accessor;
  }
  const discVar = newVar(ctx);
  const outputVar = newVar(ctx);
  doc.write(`const ${discVar} = ${accessor}?.[${esc(def.discriminator)}];`);
  doc.write(`let ${outputVar};`);
  let firstBranch = true;
  const claimed = /* @__PURE__ */ new Set();
  for (const option of def.options) {
    const values = option._zod.propValues?.[def.discriminator];
    if (!values || values.size === 0) {
      throw new ZodCompileUnsupportedError("discriminated union option without static discriminator values");
    }
    for (const value of values) {
      if (claimed.has(value)) {
        throw new ZodCompileUnsupportedError(`duplicate discriminator value ${String(value)}`);
      }
      claimed.add(value);
    }
    const conditions = Array.from(values, (value) => literalEquality(ctx, discVar, value));
    const prefix = firstBranch ? "if" : "else if";
    doc.write(`${prefix} (${conditions.join(" || ")}) {`);
    doc.indented((d) => {
      const branchOutput = generateCheck(d, ctx, option, accessor);
      d.write(`${outputVar} = ${branchOutput};`);
    });
    doc.write(`}`);
    firstBranch = false;
  }
  doc.write(`else { return INVALID; }`);
  return outputVar;
}
function literalEquality(ctx, accessor, value) {
  if (typeof value === "string")
    return `${accessor} === ${esc(value)}`;
  if (typeof value === "number") {
    if (Number.isNaN(value))
      return `Number.isNaN(${accessor})`;
    return `${accessor} === ${value}`;
  }
  if (typeof value === "boolean")
    return `${accessor} === ${value}`;
  if (value === null)
    return `${accessor} === null`;
  if (value === void 0)
    return `${accessor} === undefined`;
  if (typeof value === "bigint")
    return `${accessor} === ${value}n`;
  if (typeof value === "symbol") {
    const symbolConst = addConstant(ctx, value);
    return `${accessor} === ${symbolConst}`;
  }
  throw new ZodCompileUnsupportedError(`literal discriminator value ${String(value)}`);
}
function generateIntersectionCheck(doc, ctx, schema, accessor) {
  const def = schema._zod.def;
  ctx.definite = false;
  const leftOutput = compileChild(doc, ctx, def.left, accessor);
  const rightOutput = compileChild(doc, ctx, def.right, accessor);
  const mergeConst = addConstant(ctx, mergeValues);
  const mergedVar = newVar(ctx);
  doc.write(`const ${mergedVar} = ${mergeConst}(${leftOutput}, ${rightOutput});`);
  doc.write(`if (!${mergedVar}.valid) return INVALID;`);
  return `${mergedVar}.data`;
}
function generateRecordCheck(doc, ctx, schema, accessor) {
  const def = schema._zod.def;
  const isPlainObjectConst = addConstant(ctx, isPlainObject);
  doc.write(`if (!${isPlainObjectConst}(${accessor})) return INVALID;`);
  const outputVar = newVar(ctx);
  const kVar = newVar(ctx);
  const valVar = newVar(ctx);
  doc.write(`const ${outputVar} = {};`);
  const recordDef = def;
  const keyValues = recordDef.partial ? void 0 : def.keyType._zod.values;
  if (keyValues) {
    const inputKeys = [];
    for (const key of keyValues) {
      if (!(typeof key === "string" || typeof key === "number" || typeof key === "symbol")) {
        throw new ZodCompileUnsupportedError(`record key value ${String(key)}`);
      }
      const inputKey = typeof key === "number" ? key.toString() : key;
      if (inputKey === "__proto__") {
        throw new ZodCompileUnsupportedError('record key "__proto__"');
      }
      inputKeys.push(inputKey);
      const keyConst = addConstant(ctx, key);
      const outKey = generateCheck(doc, ctx, def.keyType, keyConst);
      const valueVar = newVar(ctx);
      doc.write(`const ${valueVar} = ${accessor}[${literalPropertyKey(ctx, inputKey)}];`);
      const valOutput = compileChild(doc, ctx, def.valueType, valueVar);
      doc.write(`${outputVar}[${outKey}] = ${valOutput};`);
    }
    const knownKeysConst = addConstant(ctx, new Set(inputKeys));
    doc.write(`for (const ${kVar} in ${accessor}) {`);
    doc.indented((d) => {
      d.write(`if (${knownKeysConst}.has(${kVar})) continue;`);
      if (recordDef.mode === "loose") {
        d.write(`if (${kVar} !== "__proto__") ${outputVar}[${kVar}] = ${accessor}[${kVar}];`);
      } else {
        d.write(`return INVALID;`);
      }
    });
    doc.write(`}`);
    return outputVar;
  }
  const keyDef = def.keyType._zod.def;
  const keyIsBareString = keyDef.type === "string" && keyDef.format === void 0 && !keyDef.coerce && (keyDef.checks?.length ?? 0) === 0;
  if (!keyIsBareString) {
    const isLoose = def.mode === "loose";
    const keyFn = compileFn(def.keyType);
    if (keyFn.definite === false)
      ctx.definite = false;
    const keyFast = addConstant(ctx, keyFn);
    const numericConst = addConstant(ctx, number);
    const outKeyVar = newVar(ctx);
    emitOwnKeys(doc, ctx, accessor, kVar, (d) => {
      d.write(`let ${outKeyVar} = ${keyFast}(${kVar});`);
      d.write(`if (${outKeyVar} === INVALID && typeof ${kVar} === "string" && ${numericConst}.test(${kVar})) ${outKeyVar} = ${keyFast}(Number(${kVar}));`);
      if (isLoose) {
        d.write(`if (${outKeyVar} === INVALID) { ${outputVar}[${kVar}] = ${accessor}[${kVar}]; continue; }`);
      } else {
        d.write(`if (${outKeyVar} === INVALID) return INVALID;`);
      }
      d.write(`if (${outKeyVar} === "__proto__") continue;`);
      const valueVar = newVar(ctx);
      d.write(`const ${valueVar} = ${accessor}[${kVar}];`);
      const valOutput = compileChild(d, ctx, def.valueType, valueVar);
      d.write(`${outputVar}[${outKeyVar}] = ${valOutput};`);
    });
    return outputVar;
  }
  emitOwnKeys(doc, ctx, accessor, kVar, (d) => {
    d.write(`const ${valVar} = ${accessor}[${kVar}];`);
    const valOutput = compileChild(d, ctx, def.valueType, valVar);
    d.write(`${outputVar}[${kVar}] = ${valOutput};`);
  }, `return INVALID;`);
  return outputVar;
}
function emitOwnKeys(doc, ctx, accessor, kVar, body, onSymbol) {
  const propIsEnumerableConst = addConstant(ctx, Object.prototype.propertyIsEnumerable);
  const symsVar = newVar(ctx);
  const keysVar = newVar(ctx);
  const iVar = newVar(ctx);
  doc.write(`const ${symsVar} = Object.getOwnPropertySymbols(${accessor});`);
  doc.write(`const ${keysVar} = Object.getOwnPropertyNames(${accessor});`);
  doc.write(`for (let ${iVar} = 0; ${iVar} < ${keysVar}.length; ${iVar}++) {`);
  doc.indented((d) => {
    d.write(`const ${kVar} = ${keysVar}[${iVar}];`);
    d.write(`if (${kVar} === "__proto__" || !${propIsEnumerableConst}.call(${accessor}, ${kVar})) continue;`);
    body(d);
  });
  doc.write(`}`);
  doc.write(`for (let ${iVar} = 0; ${iVar} < ${symsVar}.length; ${iVar}++) {`);
  doc.indented((d) => {
    d.write(`const ${kVar} = ${symsVar}[${iVar}];`);
    d.write(`if (!${propIsEnumerableConst}.call(${accessor}, ${kVar})) continue;`);
    if (onSymbol)
      d.write(onSymbol);
    else
      body(d);
  });
  doc.write(`}`);
}
function literalPropertyKey(ctx, key) {
  if (typeof key === "string")
    return esc(key);
  return addConstant(ctx, key);
}
function generateMapCheck(doc, ctx, schema, accessor) {
  const def = schema._zod.def;
  doc.write(`if (!(${accessor} instanceof Map)) return INVALID;`);
  const outputVar = newVar(ctx);
  const kVar = newVar(ctx);
  const valVar = newVar(ctx);
  doc.write(`const ${outputVar} = new Map();`);
  doc.write(`for (const [${kVar}, ${valVar}] of ${accessor}) {`);
  doc.indented((d) => {
    const keyOutput = generateCheck(d, ctx, def.keyType, kVar);
    const valOutput = generateCheck(d, ctx, def.valueType, valVar);
    d.write(`${outputVar}.set(${keyOutput}, ${valOutput});`);
  });
  doc.write(`}`);
  return outputVar;
}
function generateSetCheck(doc, ctx, schema, accessor) {
  const def = schema._zod.def;
  doc.write(`if (!(${accessor} instanceof Set)) return INVALID;`);
  const outputVar = newVar(ctx);
  const valVar = newVar(ctx);
  doc.write(`const ${outputVar} = new Set();`);
  doc.write(`for (const ${valVar} of ${accessor}) {`);
  doc.indented((d) => {
    const valOutput = generateCheck(d, ctx, def.valueType, valVar);
    d.write(`${outputVar}.add(${valOutput});`);
  });
  doc.write(`}`);
  return outputVar;
}
function generateFileCheck(doc, accessor) {
  doc.write(`if (!(${accessor} instanceof File)) return INVALID;`);
  return accessor;
}
function generateTemplateLiteralCheck(doc, ctx, schema, accessor) {
  doc.write(`if (typeof ${accessor} !== "string") return INVALID;`);
  const pattern = schema._zod.pattern;
  if (pattern) {
    const patternConst = addConstant(ctx, pattern);
    doc.write(`${patternConst}.lastIndex = 0;`);
    doc.write(`if (!${patternConst}.test(${accessor})) return INVALID;`);
  }
  return accessor;
}
function generateLazyCheck(doc, ctx, schema, accessor) {
  const def = schema._zod.def;
  const getterConst = addUserConstant(ctx, def.getter);
  const cacheConst = addConstant(ctx, { parser: null });
  doc.write(`if (!${cacheConst}.parser) {`);
  doc.indented((d) => {
    d.write(`const inner = ${getterConst}();`);
    d.write(`${cacheConst}.parser = function(input) {`);
    d.indented((d2) => {
      d2.write(`const result = inner._zod.run({ value: input, issues: [] }, {});`);
      d2.write(`return result.issues.length === 0 ? result.value : INVALID;`);
    });
    d.write(`};`);
  });
  doc.write(`}`);
  const outputVar = newVar(ctx);
  doc.write(`const ${outputVar} = ${cacheConst}.parser(${accessor});`);
  doc.write(`if (${outputVar} === INVALID) return INVALID;`);
  return outputVar;
}
function generatePipeCheck(doc, ctx, schema, accessor) {
  const def = schema._zod.def;
  const inputOutput = generateCheck(doc, ctx, def.in, accessor);
  if (def.transform) {
    if (isAsyncFunction(def.transform)) {
      throw new ZodCompileAsyncError("z.compile: async transforms in pipes are not supported");
    }
    const transformFn = def.transform;
    const helperFn = (value) => {
      const fakePayload = { value, issues: [], addIssue: pushIssue };
      const result = transformFn(value, fakePayload);
      if (result instanceof Promise)
        return INVALID;
      return fakePayload.issues.length === 0 ? result : INVALID;
    };
    const helperConst = addUserConstant(ctx, helperFn);
    const transformedVar = newVar(ctx);
    doc.write(`const ${transformedVar} = ${helperConst}(${inputOutput});`);
    doc.write(`if (${transformedVar} === INVALID) return INVALID;`);
    return generateCheck(doc, ctx, def.out, transformedVar);
  } else {
    return generateCheck(doc, ctx, def.out, inputOutput);
  }
}
function isAsyncFunction(fn) {
  return typeof fn === "function" && (fn.constructor.name === "AsyncFunction" || fn[Symbol.toStringTag] === "AsyncFunction");
}
function generateCustomCheck(doc, ctx, schema, accessor) {
  const def = schema._zod.def;
  if (def.fn) {
    if (isAsyncFunction(def.fn)) {
      throw new ZodCompileAsyncError("z.compile: async custom predicates are not supported");
    }
    const fnConst = addUserConstant(ctx, def.fn);
    const throwAsyncConst = addConstant(ctx, throwAsync);
    const resVar = newVar(ctx);
    doc.write(`const ${resVar} = ${fnConst}(${accessor});`);
    doc.write(`if (${resVar} instanceof Promise) ${throwAsyncConst}();`);
    doc.write(`if (!${resVar}) return INVALID;`);
  } else {
    throw new ZodCompileUnsupportedError("custom schema without a predicate function");
  }
  return accessor;
}
function runtimeCatch(innerSchema, catchValue, value) {
  const result = innerSchema._zod.run({ value, issues: [] }, {});
  if (result && typeof result.then === "function")
    return INVALID;
  const r = result;
  if (r.issues.length === 0)
    return r.value;
  return catchValue();
}
function generateCatchCheck(doc, ctx, schema, accessor) {
  const def = schema._zod.def;
  if (!def.catchValue[CONSTANT_CATCH]) {
    throw new ZodCompileUnsupportedError("catch with a callback (only a constant catch value compiles)", false);
  }
  const outputVar = newVar(ctx);
  doc.write(`let ${outputVar} = (() => {`);
  doc.indented((d) => {
    const innerOut = compileChild(d, ctx, def.innerType, accessor);
    d.write(`return ${innerOut};`);
  });
  doc.write(`})();`);
  const innerConst = addConstant(ctx, def.innerType);
  const catchConst = addUserConstant(ctx, def.catchValue);
  const catchHelperConst = addConstant(ctx, runtimeCatch);
  doc.write(`if (${outputVar} === INVALID) {`);
  doc.indented((d) => {
    d.write(`${outputVar} = ${catchHelperConst}(${innerConst}, ${catchConst}, ${accessor});`);
    d.write(`if (${outputVar} === INVALID) return INVALID;`);
  });
  doc.write(`}`);
  return outputVar;
}
function generateTransformCheck(doc, ctx, schema, accessor) {
  const def = schema._zod.def;
  if (def.transform) {
    if (isAsyncFunction(def.transform)) {
      throw new ZodCompileAsyncError("z.compile: async transforms are not supported");
    }
    const transformFn = def.transform;
    const helperFn = (value) => {
      const fakePayload = { value, issues: [], addIssue: pushIssue };
      const result = transformFn(value, fakePayload);
      if (result instanceof Promise)
        return INVALID;
      return fakePayload.issues.length === 0 ? result : INVALID;
    };
    const helperConst = addUserConstant(ctx, helperFn);
    const outputVar = newVar(ctx);
    doc.write(`const ${outputVar} = ${helperConst}(${accessor});`);
    doc.write(`if (${outputVar} === INVALID) return INVALID;`);
    return outputVar;
  }
  return accessor;
}
var INVALID, FALLBACK_FLAG, ZodCompileAsyncError, ZodCompileUnsupportedError, WHEN_DEFAULTED_CHECKS, PATTERN_IS_COMPLETE;
var init_compile = __esm({
  "node_modules/zod/v4/core/compile.js"() {
    init_core();
    init_doc();
    init_memoizer();
    init_regexes();
    init_schemas();
    init_util();
    INVALID = /* @__PURE__ */ Symbol.for("zod.compile.invalid");
    FALLBACK_FLAG = /* @__PURE__ */ Symbol.for("zod.compile.fallback");
    ZodCompileAsyncError = class extends Error {
      constructor(message = "z.compile does not support async refinements, transforms, or checks") {
        super(message);
        this.name = "ZodCompileAsyncError";
      }
    };
    ZodCompileUnsupportedError = class extends Error {
      constructor(feature, islandable = true) {
        super(`z.compile does not support ${feature}; this schema must use the runtime parser`);
        this.name = "ZodCompileUnsupportedError";
        this.islandable = islandable;
      }
    };
    WHEN_DEFAULTED_CHECKS = /* @__PURE__ */ new Set([
      "max_size",
      "min_size",
      "size_equals",
      "max_length",
      "min_length",
      "length_equals"
    ]);
    PATTERN_IS_COMPLETE = /* @__PURE__ */ new Set([
      "cidrv4",
      "cuid",
      "cuid2",
      "date",
      "datetime",
      "duration",
      "e164",
      "email",
      "emoji",
      "ends_with",
      "guid",
      "includes",
      "ipv4",
      "ksuid",
      "lowercase",
      "mac",
      "nanoid",
      "regex",
      "starts_with",
      "time",
      "ulid",
      "uppercase",
      "uuid",
      "xid"
    ]);
  }
});

// node_modules/zod/v4/core/api.js
function snapshotChecks(def) {
  if (def.checks)
    def.checks = [...def.checks];
  return def;
}
// @__NO_SIDE_EFFECTS__
function _string(Class2, params) {
  return new Class2(snapshotChecks({ type: "string", ...normalizeParams(params) }));
}
// @__NO_SIDE_EFFECTS__
function _coercedString(Class2, params) {
  return new Class2(snapshotChecks({ type: "string", coerce: true, ...normalizeParams(params) }));
}
// @__NO_SIDE_EFFECTS__
function _email(Class2, params) {
  return new Class2({
    type: "string",
    format: "email",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _guid(Class2, params) {
  return new Class2({
    type: "string",
    format: "guid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _uuid(Class2, params) {
  return new Class2({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _uuidv4(Class2, params) {
  return new Class2({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    version: "v4",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _uuidv6(Class2, params) {
  return new Class2({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    version: "v6",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _uuidv7(Class2, params) {
  return new Class2({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    version: "v7",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _url(Class2, params) {
  return new Class2({
    type: "string",
    format: "url",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _emoji2(Class2, params) {
  return new Class2({
    type: "string",
    format: "emoji",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _nanoid(Class2, params) {
  return new Class2({
    type: "string",
    format: "nanoid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _cuid(Class2, params) {
  return new Class2({
    type: "string",
    format: "cuid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _cuid2(Class2, params) {
  return new Class2({
    type: "string",
    format: "cuid2",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _ulid(Class2, params) {
  return new Class2({
    type: "string",
    format: "ulid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _xid(Class2, params) {
  return new Class2({
    type: "string",
    format: "xid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _ksuid(Class2, params) {
  return new Class2({
    type: "string",
    format: "ksuid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _ipv4(Class2, params) {
  return new Class2({
    type: "string",
    format: "ipv4",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _ipv6(Class2, params) {
  return new Class2({
    type: "string",
    format: "ipv6",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _mac(Class2, params) {
  return new Class2({
    type: "string",
    format: "mac",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _cidrv4(Class2, params) {
  return new Class2({
    type: "string",
    format: "cidrv4",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _cidrv6(Class2, params) {
  return new Class2({
    type: "string",
    format: "cidrv6",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _base64(Class2, params) {
  return new Class2({
    type: "string",
    format: "base64",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _base64url(Class2, params) {
  return new Class2({
    type: "string",
    format: "base64url",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _e164(Class2, params) {
  return new Class2({
    type: "string",
    format: "e164",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _creditCard(Class2, params) {
  return new Class2({
    type: "string",
    format: "credit_card",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _iban(Class2, params) {
  return new Class2({
    type: "string",
    format: "iban",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _jwt(Class2, params) {
  return new Class2({
    type: "string",
    format: "jwt",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _isoDateTime(Class2, params) {
  return new Class2({
    type: "string",
    format: "datetime",
    check: "string_format",
    offset: false,
    local: false,
    precision: null,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _isoDate(Class2, params) {
  return new Class2({
    type: "string",
    format: "date",
    check: "string_format",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _isoTime(Class2, params) {
  return new Class2({
    type: "string",
    format: "time",
    check: "string_format",
    precision: null,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _isoDuration(Class2, params) {
  return new Class2({
    type: "string",
    format: "duration",
    check: "string_format",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _number(Class2, params) {
  return new Class2(snapshotChecks({ type: "number", checks: [], ...normalizeParams(params) }));
}
// @__NO_SIDE_EFFECTS__
function _coercedNumber(Class2, params) {
  return new Class2(snapshotChecks({ type: "number", coerce: true, checks: [], ...normalizeParams(params) }));
}
// @__NO_SIDE_EFFECTS__
function _int(Class2, params) {
  return new Class2({
    type: "number",
    check: "number_format",
    abort: false,
    format: "safeint",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _float32(Class2, params) {
  return new Class2({
    type: "number",
    check: "number_format",
    abort: false,
    format: "float32",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _float64(Class2, params) {
  return new Class2({
    type: "number",
    check: "number_format",
    abort: false,
    format: "float64",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _int32(Class2, params) {
  return new Class2({
    type: "number",
    check: "number_format",
    abort: false,
    format: "int32",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _uint32(Class2, params) {
  return new Class2({
    type: "number",
    check: "number_format",
    abort: false,
    format: "uint32",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _boolean(Class2, params) {
  return new Class2({
    type: "boolean",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _coercedBoolean(Class2, params) {
  return new Class2({
    type: "boolean",
    coerce: true,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _bigint(Class2, params) {
  return new Class2({
    type: "bigint",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _coercedBigint(Class2, params) {
  return new Class2({
    type: "bigint",
    coerce: true,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _int64(Class2, params) {
  return new Class2({
    type: "bigint",
    check: "bigint_format",
    abort: false,
    format: "int64",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _uint64(Class2, params) {
  return new Class2({
    type: "bigint",
    check: "bigint_format",
    abort: false,
    format: "uint64",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _symbol(Class2, params) {
  return new Class2({
    type: "symbol",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _undefined2(Class2, params) {
  return new Class2({
    type: "undefined",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _null2(Class2, params) {
  return new Class2({
    type: "null",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _any(Class2) {
  return new Class2({
    type: "any"
  });
}
// @__NO_SIDE_EFFECTS__
function _unknown(Class2) {
  return new Class2({
    type: "unknown"
  });
}
// @__NO_SIDE_EFFECTS__
function _never(Class2, params) {
  return new Class2({
    type: "never",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _void(Class2, params) {
  return new Class2({
    type: "void",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _date(Class2, params) {
  return new Class2({
    type: "date",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _coercedDate(Class2, params) {
  return new Class2({
    type: "date",
    coerce: true,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _nan(Class2, params) {
  return new Class2({
    type: "nan",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _lt(value, params) {
  return new $ZodCheckLessThan({
    check: "less_than",
    ...normalizeParams(params),
    value,
    inclusive: false
  });
}
// @__NO_SIDE_EFFECTS__
function _lte(value, params) {
  return new $ZodCheckLessThan({
    check: "less_than",
    ...normalizeParams(params),
    value,
    inclusive: true
  });
}
// @__NO_SIDE_EFFECTS__
function _gt(value, params) {
  return new $ZodCheckGreaterThan({
    check: "greater_than",
    ...normalizeParams(params),
    value,
    inclusive: false
  });
}
// @__NO_SIDE_EFFECTS__
function _gte(value, params) {
  return new $ZodCheckGreaterThan({
    check: "greater_than",
    ...normalizeParams(params),
    value,
    inclusive: true
  });
}
// @__NO_SIDE_EFFECTS__
function _positive(params) {
  return /* @__PURE__ */ _gt(0, params);
}
// @__NO_SIDE_EFFECTS__
function _negative(params) {
  return /* @__PURE__ */ _lt(0, params);
}
// @__NO_SIDE_EFFECTS__
function _nonpositive(params) {
  return /* @__PURE__ */ _lte(0, params);
}
// @__NO_SIDE_EFFECTS__
function _nonnegative(params) {
  return /* @__PURE__ */ _gte(0, params);
}
// @__NO_SIDE_EFFECTS__
function _multipleOf(value, params) {
  return new $ZodCheckMultipleOf({
    check: "multiple_of",
    ...normalizeParams(params),
    value
  });
}
// @__NO_SIDE_EFFECTS__
function _maxSize(maximum, params) {
  return new $ZodCheckMaxSize({
    check: "max_size",
    ...normalizeParams(params),
    maximum
  });
}
// @__NO_SIDE_EFFECTS__
function _minSize(minimum, params) {
  return new $ZodCheckMinSize({
    check: "min_size",
    ...normalizeParams(params),
    minimum
  });
}
// @__NO_SIDE_EFFECTS__
function _size(size, params) {
  return new $ZodCheckSizeEquals({
    check: "size_equals",
    ...normalizeParams(params),
    size
  });
}
// @__NO_SIDE_EFFECTS__
function _maxLength(maximum, params) {
  const ch = new $ZodCheckMaxLength({
    check: "max_length",
    ...normalizeParams(params),
    maximum
  });
  return ch;
}
// @__NO_SIDE_EFFECTS__
function _minLength(minimum, params) {
  return new $ZodCheckMinLength({
    check: "min_length",
    ...normalizeParams(params),
    minimum
  });
}
// @__NO_SIDE_EFFECTS__
function _length(length, params) {
  return new $ZodCheckLengthEquals({
    check: "length_equals",
    ...normalizeParams(params),
    length
  });
}
// @__NO_SIDE_EFFECTS__
function _regex(pattern, params) {
  return new $ZodCheckRegex({
    check: "string_format",
    format: "regex",
    ...normalizeParams(params),
    pattern
  });
}
// @__NO_SIDE_EFFECTS__
function _lowercase(params) {
  return new $ZodCheckLowerCase({
    check: "string_format",
    format: "lowercase",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _uppercase(params) {
  return new $ZodCheckUpperCase({
    check: "string_format",
    format: "uppercase",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _includes(includes, params) {
  return new $ZodCheckIncludes({
    check: "string_format",
    format: "includes",
    ...normalizeParams(params),
    includes
  });
}
// @__NO_SIDE_EFFECTS__
function _startsWith(prefix, params) {
  return new $ZodCheckStartsWith({
    check: "string_format",
    format: "starts_with",
    ...normalizeParams(params),
    prefix
  });
}
// @__NO_SIDE_EFFECTS__
function _endsWith(suffix, params) {
  return new $ZodCheckEndsWith({
    check: "string_format",
    format: "ends_with",
    ...normalizeParams(params),
    suffix
  });
}
// @__NO_SIDE_EFFECTS__
function _property(property, schema, params) {
  return new $ZodCheckProperty({
    check: "property",
    property,
    schema,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _properties(shape, params) {
  return new $ZodCheckProperties({
    check: "properties",
    shape,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _mime(types, params) {
  return new $ZodCheckMimeType({
    check: "mime_type",
    mime: types,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _overwrite(tx) {
  return new $ZodCheckOverwrite({
    check: "overwrite",
    tx
  });
}
// @__NO_SIDE_EFFECTS__
function _normalize(form) {
  return /* @__PURE__ */ _overwrite((input2) => input2.normalize(form));
}
// @__NO_SIDE_EFFECTS__
function _trim() {
  return /* @__PURE__ */ _overwrite((input2) => input2.trim());
}
// @__NO_SIDE_EFFECTS__
function _toLowerCase() {
  return /* @__PURE__ */ _overwrite((input2) => input2.toLowerCase());
}
// @__NO_SIDE_EFFECTS__
function _toUpperCase() {
  return /* @__PURE__ */ _overwrite((input2) => input2.toUpperCase());
}
// @__NO_SIDE_EFFECTS__
function _slugify() {
  return /* @__PURE__ */ _overwrite((input2) => slugify(input2));
}
// @__NO_SIDE_EFFECTS__
function _array(Class2, element, params) {
  return new Class2({
    type: "array",
    element,
    // get element() {
    //   return element;
    // },
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _union(Class2, options, params) {
  return new Class2({
    type: "union",
    options,
    ...normalizeParams(params)
  });
}
function _xor(Class2, options, params) {
  return new Class2({
    type: "union",
    options,
    inclusive: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _discriminatedUnion(Class2, discriminator, options, params) {
  return new Class2({
    type: "union",
    options,
    discriminator,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _intersection(Class2, left, right) {
  return new Class2({
    type: "intersection",
    left,
    right
  });
}
// @__NO_SIDE_EFFECTS__
function _tuple(Class2, items, _paramsOrRest, _params) {
  const hasRest = _paramsOrRest instanceof $ZodType;
  const params = hasRest ? _params : _paramsOrRest;
  const rest = hasRest ? _paramsOrRest : null;
  return new Class2({
    type: "tuple",
    items,
    rest,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _record(Class2, keyType, valueType, params) {
  return new Class2({
    type: "record",
    keyType,
    valueType,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _map(Class2, keyType, valueType, params) {
  return new Class2({
    type: "map",
    keyType,
    valueType,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _set(Class2, valueType, params) {
  return new Class2({
    type: "set",
    valueType,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _enum(Class2, values, params) {
  const entries = Array.isArray(values) ? Object.fromEntries(values.map((v) => [v, v])) : values;
  return new Class2({
    type: "enum",
    entries,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _nativeEnum(Class2, entries, params) {
  return new Class2({
    type: "enum",
    entries,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _literal(Class2, value, params) {
  return new Class2({
    type: "literal",
    values: Array.isArray(value) ? value : [value],
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _file(Class2, params) {
  return new Class2({
    type: "file",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _transform(Class2, fn) {
  return new Class2({
    type: "transform",
    transform: fn
  });
}
// @__NO_SIDE_EFFECTS__
function _optional(Class2, innerType) {
  return new Class2({
    type: "optional",
    innerType
  });
}
// @__NO_SIDE_EFFECTS__
function _nullable(Class2, innerType) {
  return new Class2({
    type: "nullable",
    innerType
  });
}
// @__NO_SIDE_EFFECTS__
function _default(Class2, innerType, defaultValue) {
  return new Class2({
    type: "default",
    innerType,
    get defaultValue() {
      return typeof defaultValue === "function" ? defaultValue() : shallowClone(defaultValue);
    }
  });
}
// @__NO_SIDE_EFFECTS__
function _nonoptional(Class2, innerType, params) {
  return new Class2({
    type: "nonoptional",
    innerType,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _success(Class2, innerType) {
  return new Class2({
    type: "success",
    innerType
  });
}
// @__NO_SIDE_EFFECTS__
function _catch(Class2, innerType, catchValue) {
  return new Class2({
    type: "catch",
    innerType,
    catchValue: typeof catchValue === "function" ? catchValue : constantCatch(catchValue)
  });
}
// @__NO_SIDE_EFFECTS__
function _pipe(Class2, in_, out) {
  return new Class2({
    type: "pipe",
    in: in_,
    out
  });
}
// @__NO_SIDE_EFFECTS__
function _readonly(Class2, innerType) {
  return new Class2({
    type: "readonly",
    innerType
  });
}
// @__NO_SIDE_EFFECTS__
function _templateLiteral(Class2, parts, params) {
  return new Class2({
    type: "template_literal",
    parts,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _lazy(Class2, getter) {
  return new Class2({
    type: "lazy",
    getter
  });
}
// @__NO_SIDE_EFFECTS__
function _promise(Class2, innerType) {
  return new Class2({
    type: "promise",
    innerType
  });
}
// @__NO_SIDE_EFFECTS__
function _custom(Class2, fn, _params) {
  const norm = normalizeParams(_params);
  norm.abort ?? (norm.abort = true);
  const schema = new Class2({
    type: "custom",
    check: "custom",
    fn,
    ...norm
  });
  return schema;
}
// @__NO_SIDE_EFFECTS__
function _refine(Class2, fn, _params) {
  const schema = new Class2({
    type: "custom",
    check: "custom",
    fn,
    ...normalizeParams(_params)
  });
  return schema;
}
// @__NO_SIDE_EFFECTS__
function _superRefine(fn, params) {
  const ch = /* @__PURE__ */ _check((payload) => {
    payload.addIssue = (issue2) => {
      if (typeof issue2 === "string") {
        payload.issues.push(issue(issue2, payload.value, ch._zod.def));
      } else {
        const _issue = issue2;
        if (_issue.fatal)
          _issue.continue = false;
        _issue.code ?? (_issue.code = "custom");
        if (!("input" in _issue))
          _issue.input = payload.value;
        _issue.inst ?? (_issue.inst = ch);
        _issue.continue ?? (_issue.continue = !ch._zod.def.abort);
        payload.issues.push(issue(_issue));
      }
    };
    return fn(payload.value, payload);
  }, params);
  return ch;
}
// @__NO_SIDE_EFFECTS__
function _check(fn, params) {
  const ch = new $ZodCheck({
    check: "custom",
    ...normalizeParams(params)
  });
  ch._zod.check = fn;
  return ch;
}
// @__NO_SIDE_EFFECTS__
function describe(description) {
  const ch = new $ZodCheck({ check: "describe" });
  ch._zod.onattach = [
    (inst) => {
      const existing = globalRegistry.get(inst) ?? {};
      globalRegistry.add(inst, { ...existing, description });
    }
  ];
  ch._zod.check = () => {
  };
  return ch;
}
// @__NO_SIDE_EFFECTS__
function meta(metadata) {
  const ch = new $ZodCheck({ check: "meta" });
  ch._zod.onattach = [
    (inst) => {
      const existing = globalRegistry.get(inst) ?? {};
      globalRegistry.add(inst, { ...existing, ...metadata });
    }
  ];
  ch._zod.check = () => {
  };
  return ch;
}
// @__NO_SIDE_EFFECTS__
function _stringbool(Classes, _params) {
  const params = normalizeParams(_params);
  let truthyArray = params.truthy ?? ["true", "1", "yes", "on", "y", "enabled"];
  let falsyArray = params.falsy ?? ["false", "0", "no", "off", "n", "disabled"];
  if (params.case !== "sensitive") {
    truthyArray = truthyArray.map((v) => typeof v === "string" ? v.toLowerCase() : v);
    falsyArray = falsyArray.map((v) => typeof v === "string" ? v.toLowerCase() : v);
  }
  const truthySet = new Set(truthyArray);
  const falsySet = new Set(falsyArray);
  const _Codec = Classes.Codec ?? $ZodCodec;
  const _Boolean = Classes.Boolean ?? $ZodBoolean;
  const _String = Classes.String ?? $ZodString;
  const stringSchema = new _String({ type: "string", error: params.error });
  const booleanSchema = new _Boolean({ type: "boolean", error: params.error });
  const codec2 = new _Codec({
    type: "pipe",
    in: stringSchema,
    out: booleanSchema,
    transform: ((input2, payload) => {
      let data = input2;
      if (params.case !== "sensitive")
        data = data.toLowerCase();
      if (truthySet.has(data)) {
        return true;
      } else if (falsySet.has(data)) {
        return false;
      } else {
        payload.issues.push({
          code: "invalid_value",
          expected: "stringbool",
          values: [...truthySet, ...falsySet],
          input: payload.value,
          inst: codec2,
          continue: false
        });
        return {};
      }
    }),
    reverseTransform: ((input2, _payload) => {
      if (input2 === true) {
        return truthyArray[0] || "true";
      } else {
        return falsyArray[0] || "false";
      }
    }),
    error: params.error
  });
  codec2._zod.bag.truthy = truthyArray;
  codec2._zod.bag.falsy = falsyArray;
  codec2._zod.bag.case = params.case ?? "insensitive";
  return codec2;
}
// @__NO_SIDE_EFFECTS__
function _stringFormat(Class2, format, fnOrRegex, _params = {}) {
  const params = normalizeParams(_params);
  const def = {
    check: "string_format",
    type: "string",
    format,
    fn: typeof fnOrRegex === "function" ? fnOrRegex : (val) => fnOrRegex.test(val),
    ...params
  };
  if (fnOrRegex instanceof RegExp) {
    def.pattern = fnOrRegex;
  }
  const inst = new Class2(def);
  return inst;
}
var TimePrecision;
var init_api = __esm({
  "node_modules/zod/v4/core/api.js"() {
    init_checks();
    init_registries();
    init_schemas();
    init_util();
    TimePrecision = {
      Any: null,
      Minute: -1,
      Second: 0,
      Millisecond: 3,
      Microsecond: 6
    };
  }
});

// node_modules/zod/v4/core/to-json-schema.js
function assignProps(target, ...sources) {
  for (const source of sources) {
    for (const key of Reflect.ownKeys(source)) {
      if (Object.prototype.propertyIsEnumerable.call(source, key)) {
        assignProp(target, key, source[key]);
      }
    }
  }
  return target;
}
function initializeContext(params) {
  let target = params?.target ?? "draft-2020-12";
  if (target === "draft-4")
    target = "draft-04";
  if (target === "draft-7")
    target = "draft-07";
  return {
    processors: params.processors ?? {},
    metadataRegistry: params?.metadata ?? globalRegistry,
    target,
    unrepresentable: params?.unrepresentable ?? "throw",
    override: params?.override ?? (() => {
    }),
    io: params?.io ?? "output",
    counter: 0,
    seen: /* @__PURE__ */ new Map(),
    sharedDefsExtractedFor: void 0,
    sharedEmitDoneFor: void 0,
    cycles: params?.cycles ?? "ref",
    reused: params?.reused ?? "inline",
    intersections: [],
    deferred: [],
    external: params?.external ?? void 0
  };
}
function handleUnrepresentable(schema, ctx, json2, params, message) {
  const result = typeof ctx.unrepresentable === "function" ? ctx.unrepresentable({ zodSchema: schema, path: params.path, message }) : ctx.unrepresentable;
  if (result === "any")
    return false;
  if (result === void 0 || result === "throw")
    throw new Error(message);
  Object.assign(json2, result);
  return true;
}
function processSchema(schema, ctx, _params = { path: [], schemaPath: [] }) {
  var _a3;
  const def = schema._zod.def;
  const seen = ctx.seen.get(schema);
  if (seen) {
    seen.count++;
    const isCycle = _params.schemaPath.includes(schema);
    if (isCycle) {
      seen.cycle = _params.path;
    }
    return seen.schema;
  }
  const result = { schema: {}, count: 1, cycle: void 0, path: _params.path };
  ctx.seen.set(schema, result);
  ctx.sharedDefsExtractedFor = void 0;
  ctx.sharedEmitDoneFor = void 0;
  const overrideSchema = schema._zod.toJSONSchema?.();
  if (overrideSchema) {
    result.schema = overrideSchema;
  } else {
    const params = {
      ..._params,
      schemaPath: [..._params.schemaPath, schema],
      path: _params.path
    };
    if (schema._zod.processJSONSchema) {
      schema._zod.processJSONSchema(ctx, result.schema, params);
    } else {
      const _json = result.schema;
      const processor = ctx.processors[def.type];
      if (!processor) {
        throw new Error(`[toJSONSchema]: Non-representable type encountered: ${def.type}`);
      }
      processor(schema, ctx, _json, params);
    }
    const parent = schema._zod.parent;
    if (parent) {
      if (!result.ref)
        result.ref = parent;
      processSchema(parent, ctx, params);
      ctx.seen.get(parent).isParent = true;
    }
  }
  const meta3 = ctx.metadataRegistry.get(schema);
  if (meta3)
    assignProps(result.schema, meta3);
  if (ctx.io === "input" && isTransforming(schema)) {
    delete result.schema.examples;
    delete result.schema.default;
  }
  if (ctx.io === "input" && "_prefault" in result.schema)
    (_a3 = result.schema).default ?? (_a3.default = result.schema._prefault);
  delete result.schema._prefault;
  const _result = ctx.seen.get(schema);
  return _result.schema;
}
function encodeJSONPointerSegment(segment) {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}
function extractDefs(ctx, schema) {
  const root = ctx.seen.get(schema);
  if (!root)
    throw new Error("Unprocessed schema. This is a bug in Zod.");
  if (ctx.external && ctx.sharedDefsExtractedFor === ctx.external)
    return;
  const idToSchema = /* @__PURE__ */ new Map();
  for (const entry of ctx.seen.entries()) {
    const id = ctx.metadataRegistry.get(entry[0])?.id;
    if (id) {
      const existing = idToSchema.get(id);
      if (existing && existing !== entry[0]) {
        throw new Error(`Duplicate schema id "${id}" detected during JSON Schema conversion. Two different schemas cannot share the same id when converted together.`);
      }
      idToSchema.set(id, entry[0]);
    }
  }
  const makeURI = (entry) => {
    const defsSegment = ctx.target === "draft-2020-12" ? "$defs" : "definitions";
    if (ctx.external) {
      const externalId = ctx.external.registry.get(entry[0])?.id;
      const uriGenerator = ctx.external.uri ?? ((id2) => id2);
      if (externalId) {
        return { ref: uriGenerator(externalId) };
      }
      const id = entry[1].defId ?? entry[1].schema.id ?? `schema${ctx.counter++}`;
      entry[1].defId = id;
      return { defId: id, ref: `${uriGenerator("__shared")}#/${defsSegment}/${encodeJSONPointerSegment(id)}` };
    }
    const uriPrefix = `#`;
    const defUriPrefix = `${uriPrefix}/${defsSegment}/`;
    if (entry[1] === root && !entry[1].schema.id) {
      return { ref: uriPrefix };
    }
    const defId = entry[1].schema.id ?? `__schema${ctx.counter++}`;
    return { defId, ref: defUriPrefix + encodeJSONPointerSegment(defId) };
  };
  const extractToDef = (entry) => {
    if (entry[1].schema.$ref) {
      return;
    }
    const seen = entry[1];
    const { ref, defId } = makeURI(entry);
    seen.def = { ...seen.schema };
    if (defId)
      seen.defId = defId;
    const schema2 = seen.schema;
    for (const key in schema2) {
      delete schema2[key];
    }
    schema2.$ref = ref;
  };
  if (ctx.cycles === "throw") {
    for (const entry of ctx.seen.entries()) {
      const seen = entry[1];
      if (seen.cycle) {
        throw new Error(`Cycle detected: #/${seen.cycle?.join("/")}/<root>

Set the \`cycles\` parameter to \`"ref"\` to resolve cyclical schemas with defs.`);
      }
    }
  }
  for (const entry of ctx.seen.entries()) {
    const seen = entry[1];
    if (schema === entry[0]) {
      extractToDef(entry);
      continue;
    }
    if (ctx.external) {
      const ext = ctx.external.registry.get(entry[0])?.id;
      if (schema !== entry[0] && ext) {
        extractToDef(entry);
        continue;
      }
    }
    const id = ctx.metadataRegistry.get(entry[0])?.id;
    if (id) {
      extractToDef(entry);
      continue;
    }
    if (seen.cycle) {
      extractToDef(entry);
      continue;
    }
    if (seen.count > 1) {
      if (ctx.reused === "ref") {
        extractToDef(entry);
      }
    }
  }
  if (ctx.external)
    ctx.sharedDefsExtractedFor = ctx.external;
}
function compactTypeUnion(schema) {
  const options = schema.anyOf;
  if (!Array.isArray(options) || options.length === 0 || schema.type !== void 0)
    return;
  const types = [];
  for (const option of options) {
    if (!option || typeof option !== "object")
      return;
    compactTypeUnion(option);
    const keys = Object.keys(option);
    if (keys.length !== 1 || keys[0] !== "type")
      return;
    const type = option.type;
    for (const member of Array.isArray(type) ? type : [type]) {
      if (typeof member !== "string")
        return;
      if (!types.includes(member))
        types.push(member);
    }
  }
  delete schema.anyOf;
  schema.type = types.length === 1 ? types[0] : types;
}
function undeclaredConstraint(member) {
  const extra = member.additionalProperties;
  if (extra === void 0 || extra === false || typeof extra !== "object" || extra === null)
    return null;
  return Object.keys(extra).length ? extra : null;
}
function foldObjects(members2) {
  const objects = [];
  for (const member of members2) {
    if (typeof member !== "object" || member.type !== "object")
      return null;
    for (const key in member) {
      if (!FOLDABLE_KEYS.has(key))
        return null;
    }
    objects.push(member);
  }
  const properties = {};
  const required2 = /* @__PURE__ */ new Set();
  for (const object2 of objects) {
    for (const key in object2.properties) {
      if (Object.prototype.hasOwnProperty.call(properties, key))
        continue;
      const parts = [];
      for (const other of objects) {
        const part = other.properties?.[key] ?? undeclaredConstraint(other);
        if (part === null || part === void 0)
          continue;
        if (!parts.some((seen) => JSON.stringify(seen) === JSON.stringify(part)))
          parts.push(part);
      }
      const merged = parts.length === 1 ? parts[0] : foldObjects(parts) ?? { allOf: parts };
      assignProp(properties, key, merged);
    }
    for (const key of object2.required ?? [])
      required2.add(key);
  }
  const folded = { type: "object", properties };
  if (required2.size)
    folded.required = [...required2];
  if (objects.every((object2) => object2.additionalProperties === false)) {
    folded.additionalProperties = false;
  } else {
    const constraints = [];
    for (const object2 of objects) {
      const constraint = undeclaredConstraint(object2);
      if (constraint && !constraints.some((seen) => JSON.stringify(seen) === JSON.stringify(constraint)))
        constraints.push(constraint);
    }
    if (constraints.length === 1)
      folded.additionalProperties = constraints[0];
    else if (constraints.length > 1)
      folded.additionalProperties = { allOf: constraints };
  }
  return folded;
}
function foldIntersection(json2) {
  const allOf = json2.allOf;
  if (!Array.isArray(allOf) || allOf.length < 2)
    return;
  for (const key of FOLDABLE_KEYS)
    if (key in json2)
      return;
  const unions = allOf.filter((m) => UNION_KEYS.some((k) => Array.isArray(m[k])));
  let folded = null;
  if (!unions.length) {
    folded = foldObjects(allOf);
  } else {
    const union2 = unions[0];
    const keyword = UNION_KEYS.find((k) => Array.isArray(union2[k]));
    if (Object.keys(union2).length !== 1)
      return;
    const rest = allOf.filter((m) => m !== union2);
    const branches = union2[keyword].map((branch) => foldObjects([...rest, branch]));
    if (branches.some((b) => !b))
      return;
    folded = { [keyword]: branches };
  }
  if (!folded)
    return;
  delete json2.allOf;
  assignProps(json2, folded);
}
function finalize(ctx, schema) {
  const root = ctx.seen.get(schema);
  if (!root)
    throw new Error("Unprocessed schema. This is a bug in Zod.");
  const flattenRef = (zodSchema) => {
    const seen = ctx.seen.get(zodSchema);
    if (seen.ref === null)
      return;
    const schema2 = seen.def ?? seen.schema;
    const _cached = { ...schema2 };
    const ref = seen.ref;
    seen.ref = null;
    if (ref) {
      flattenRef(ref);
      const refSeen = ctx.seen.get(ref);
      const refSchema = refSeen.schema;
      if (refSchema.$ref && (ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0")) {
        schema2.allOf = schema2.allOf ?? [];
        schema2.allOf.push(refSchema);
      } else {
        assignProps(schema2, refSchema);
      }
      assignProps(schema2, _cached);
      const isParentRef = zodSchema._zod.parent === ref;
      if (isParentRef) {
        for (const key in schema2) {
          if (key === "$ref" || key === "allOf")
            continue;
          if (!(key in _cached)) {
            delete schema2[key];
          }
        }
      }
      if (refSchema.$ref && refSeen.def) {
        for (const key in schema2) {
          if (key === "$ref" || key === "allOf")
            continue;
          if (key in refSeen.def && JSON.stringify(schema2[key]) === JSON.stringify(refSeen.def[key])) {
            delete schema2[key];
          }
        }
      }
    }
    const parent = zodSchema._zod.parent;
    if (parent && parent !== ref) {
      flattenRef(parent);
      const parentSeen = ctx.seen.get(parent);
      if (parentSeen?.schema.$ref) {
        schema2.$ref = parentSeen.schema.$ref;
        if (parentSeen.def) {
          for (const key in schema2) {
            if (key === "$ref" || key === "allOf")
              continue;
            if (key in parentSeen.def && JSON.stringify(schema2[key]) === JSON.stringify(parentSeen.def[key])) {
              delete schema2[key];
            }
          }
        }
      }
    }
    ctx.override({
      zodSchema,
      jsonSchema: schema2,
      path: seen.path ?? []
    });
  };
  if (!ctx.external || ctx.sharedEmitDoneFor !== ctx.external) {
    for (const entry of [...ctx.seen.entries()].reverse()) {
      flattenRef(entry[0]);
    }
    if (ctx.target !== "openapi-3.0") {
      for (const entry of ctx.seen.entries()) {
        compactTypeUnion(entry[1].def ?? entry[1].schema);
      }
    }
    for (const rewrite of ctx.deferred)
      rewrite();
    if (ctx.intersections.length) {
      const carriers = /* @__PURE__ */ new Map();
      for (const seen of ctx.seen.values()) {
        for (const json2 of [seen.schema, seen.def]) {
          const allOf = json2?.allOf;
          if (!Array.isArray(allOf))
            continue;
          const existing = carriers.get(allOf);
          if (existing)
            existing.push(json2);
          else
            carriers.set(allOf, [json2]);
        }
      }
      for (const allOf of ctx.intersections) {
        for (const json2 of carriers.get(allOf) ?? [])
          foldIntersection(json2);
      }
    }
  }
  const result = {};
  if (ctx.target === "draft-2020-12") {
    result.$schema = "https://json-schema.org/draft/2020-12/schema";
  } else if (ctx.target === "draft-07") {
    result.$schema = "http://json-schema.org/draft-07/schema#";
  } else if (ctx.target === "draft-04") {
    result.$schema = "http://json-schema.org/draft-04/schema#";
  } else if (ctx.target === "openapi-3.0") {
  } else {
  }
  if (ctx.external?.uri) {
    const id = ctx.external.registry.get(schema)?.id;
    if (!id)
      throw new Error("Schema is missing an `id` property");
    result.$id = ctx.external.uri(id);
  }
  assignProps(result, root.defId ? root.schema : root.def ?? root.schema);
  const rootMetaId = ctx.metadataRegistry.get(schema)?.id;
  if (rootMetaId !== void 0 && result.id === rootMetaId)
    delete result.id;
  const defs = ctx.external?.defs ?? {};
  if (!ctx.external || ctx.sharedEmitDoneFor !== ctx.external) {
    for (const entry of ctx.seen.entries()) {
      const seen = entry[1];
      if (seen.def && seen.defId) {
        if (seen.def.id === seen.defId)
          delete seen.def.id;
        assignProp(defs, seen.defId, seen.def);
      }
    }
  }
  if (ctx.external)
    ctx.sharedEmitDoneFor = ctx.external;
  if (ctx.external) {
  } else {
    if (Object.keys(defs).length > 0) {
      if (ctx.target === "draft-2020-12") {
        result.$defs = defs;
      } else {
        result.definitions = defs;
      }
    }
  }
  try {
    const finalized = JSON.parse(JSON.stringify(result));
    Object.defineProperty(finalized, "~standard", {
      value: {
        ...schema["~standard"],
        jsonSchema: {
          input: createStandardJSONSchemaMethod(schema, "input", ctx.processors),
          output: createStandardJSONSchemaMethod(schema, "output", ctx.processors)
        }
      },
      enumerable: false,
      writable: false
    });
    return finalized;
  } catch (_err) {
    throw new Error("Error converting schema to JSON.");
  }
}
function isTransforming(_schema, _ctx) {
  const ctx = _ctx ?? { seen: /* @__PURE__ */ new Set() };
  if (ctx.seen.has(_schema))
    return false;
  ctx.seen.add(_schema);
  const def = _schema._zod.def;
  if (def.type === "transform")
    return true;
  if (def.type === "array")
    return isTransforming(def.element, ctx);
  if (def.type === "set")
    return isTransforming(def.valueType, ctx);
  if (def.type === "lazy")
    return isTransforming(def.getter(), ctx);
  if (def.type === "promise" || def.type === "optional" || def.type === "nonoptional" || def.type === "nullable" || def.type === "readonly" || def.type === "default" || def.type === "prefault" || def.type === "catch") {
    return isTransforming(def.innerType, ctx);
  }
  if (def.type === "intersection") {
    return isTransforming(def.left, ctx) || isTransforming(def.right, ctx);
  }
  if (def.type === "record" || def.type === "map") {
    return isTransforming(def.keyType, ctx) || isTransforming(def.valueType, ctx);
  }
  if (def.type === "pipe") {
    if (_schema._zod.traits.has("$ZodCodec"))
      return true;
    return isTransforming(def.in, ctx) || isTransforming(def.out, ctx);
  }
  if (def.type === "object") {
    for (const key in def.shape) {
      if (isTransforming(def.shape[key], ctx))
        return true;
    }
    return false;
  }
  if (def.type === "union") {
    for (const option of def.options) {
      if (isTransforming(option, ctx))
        return true;
    }
    return false;
  }
  if (def.type === "tuple") {
    for (const item of def.items) {
      if (isTransforming(item, ctx))
        return true;
    }
    if (def.rest && isTransforming(def.rest, ctx))
      return true;
    return false;
  }
  return false;
}
var FOLDABLE_KEYS, UNION_KEYS, createToJSONSchemaMethod, createStandardJSONSchemaMethod;
var init_to_json_schema = __esm({
  "node_modules/zod/v4/core/to-json-schema.js"() {
    init_registries();
    init_util();
    FOLDABLE_KEYS = /* @__PURE__ */ new Set(["type", "properties", "required", "additionalProperties"]);
    UNION_KEYS = ["oneOf", "anyOf"];
    createToJSONSchemaMethod = (schema, processors = {}) => (params) => {
      const ctx = initializeContext({ ...params, processors });
      processSchema(schema, ctx);
      extractDefs(ctx, schema);
      return finalize(ctx, schema);
    };
    createStandardJSONSchemaMethod = (schema, io, processors = {}) => (params) => {
      const { libraryOptions, target } = params ?? {};
      const ctx = initializeContext({ ...libraryOptions ?? {}, target, io, processors });
      processSchema(schema, ctx);
      extractDefs(ctx, schema);
      return finalize(ctx, schema);
    };
  }
});

// node_modules/zod/v4/core/json-schema-processors.js
function aggregateChecks(schema) {
  const agg = {};
  const def = schema._zod.def;
  const list = schema._zod.traits.has("$ZodCheck") ? [schema, ...def.checks ?? []] : def.checks ?? [];
  for (const ch of list)
    contributors[ch._zod.def.check]?.(agg, ch._zod.def);
  const bag = schema._zod.bag;
  if (bag.minimum !== void 0)
    narrowMin(agg, "minimum", bag.minimum);
  if (bag.exclusiveMinimum !== void 0)
    narrowMin(agg, "exclusiveMinimum", bag.exclusiveMinimum);
  if (bag.maximum !== void 0)
    narrowMax(agg, "maximum", bag.maximum);
  if (bag.exclusiveMaximum !== void 0)
    narrowMax(agg, "exclusiveMaximum", bag.exclusiveMaximum);
  if (bag.multipleOf !== void 0)
    addDivisor(agg, bag.multipleOf);
  if (bag.format !== void 0) {
    agg.format ?? (agg.format = bag.format);
    if (bag.format.includes("int"))
      agg.isInt = true;
  }
  if (bag.mime)
    intersectMime(agg, bag.mime);
  for (const pattern of bag.patterns ?? [])
    addPattern(agg, pattern);
  return agg;
}
function inputOptin(schema) {
  const def = schema._zod.def;
  if (def.type === "pipe" && def.in._zod.traits.has("$ZodTransform")) {
    return inputOptin(def.out);
  }
  if (def.type === "catch") {
    return inputOptin(def.innerType);
  }
  return schema._zod.optin;
}
function stringifyKeyNames(bySchema, json2, visited) {
  if (json2.$ref) {
    if (visited.has(json2))
      return json2;
    visited.add(json2);
    const def = bySchema.get(json2)?.def;
    if (!def)
      return json2;
    const inlined = stringifyKeyNames(bySchema, def, visited);
    return inlined === def ? json2 : inlined;
  }
  for (const keyword of ["anyOf", "oneOf"]) {
    const branches = json2[keyword];
    if (!Array.isArray(branches))
      continue;
    const mapped = branches.map((branch) => stringifyKeyNames(bySchema, branch, visited));
    if (mapped.some((branch, i) => branch !== branches[i]))
      json2 = { ...json2, [keyword]: mapped };
  }
  const types = Array.isArray(json2.type) ? json2.type : [json2.type];
  const numericType = !types.includes("string") && types.some((t2) => t2 === "number" || t2 === "integer");
  const values = json2.enum ?? (json2.const !== void 0 ? [json2.const] : void 0);
  if (!numericType && !values?.some((v) => typeof v === "number"))
    return json2;
  const { minimum, maximum, exclusiveMinimum, exclusiveMaximum, multipleOf, format, id, ...rest } = json2;
  if (rest.enum)
    rest.enum = rest.enum.map((v) => typeof v === "number" ? String(v) : v);
  else if (typeof rest.const === "number")
    rest.const = String(rest.const);
  if (!numericType)
    return rest;
  rest.type = "string";
  if (!values)
    rest.pattern = (types.includes("number") ? number : integer).source;
  return rest;
}
function rewriteKeyNames(ctx) {
  const bySchema = /* @__PURE__ */ new Map();
  for (const entry of ctx.seen.values()) {
    if (entry.def && !bySchema.has(entry.schema))
      bySchema.set(entry.schema, entry);
  }
  const rewrites = /* @__PURE__ */ new Map();
  for (const record2 of pendingRecords.get(ctx) ?? []) {
    const seen = ctx.seen.get(record2);
    const names = (seen?.def ?? seen?.schema)?.propertyNames;
    if (!names || names === true || rewrites.has(names))
      continue;
    const rewritten = stringifyKeyNames(bySchema, names, /* @__PURE__ */ new Set());
    if (rewritten !== names)
      rewrites.set(names, rewritten);
  }
  if (!rewrites.size)
    return;
  for (const entry of ctx.seen.values()) {
    for (const carrier of [entry.schema, entry.def]) {
      const rewritten = carrier && rewrites.get(carrier.propertyNames);
      if (rewritten)
        carrier.propertyNames = rewritten;
    }
  }
}
function serializeDefaultValue(value, schema, ctx, json2, params) {
  let unrepresentable = false;
  const serialized = JSON.stringify(value, (_, val) => {
    if (typeof val !== "bigint")
      return val;
    unrepresentable = true;
    return null;
  });
  if (!unrepresentable)
    return JSON.parse(serialized);
  handleUnrepresentable(schema, ctx, json2, params, "BigInt defaults cannot be represented in JSON Schema");
  return UNREPRESENTABLE_DEFAULT;
}
function toJSONSchema(input2, params) {
  if ("_idmap" in input2) {
    const registry2 = input2;
    const ctx2 = initializeContext({ ...params, processors: allProcessors });
    const defs = {};
    for (const entry of registry2._idmap.entries()) {
      const [_, schema] = entry;
      processSchema(schema, ctx2);
    }
    const schemas = {};
    const external = {
      registry: registry2,
      uri: params?.uri,
      defs
    };
    ctx2.external = external;
    for (const entry of registry2._idmap.entries()) {
      const [key, schema] = entry;
      extractDefs(ctx2, schema);
      assignProp(schemas, key, finalize(ctx2, schema));
    }
    if (Object.keys(defs).length > 0) {
      const defsSegment = ctx2.target === "draft-2020-12" ? "$defs" : "definitions";
      schemas.__shared = {
        [defsSegment]: defs
      };
    }
    return { schemas };
  }
  const ctx = initializeContext({ ...params, processors: allProcessors });
  processSchema(input2, ctx);
  extractDefs(ctx, input2);
  return finalize(ctx, input2);
}
var narrowMin, narrowMax, narrowBoth, addDivisor, addPattern, intersectMime, setFormat, minContributor, maxContributor, formatContributor, contributors, formatMap, exactPatterns, exactPattern, stringProcessor, numberProcessor, booleanProcessor, bigintProcessor, symbolProcessor, nullProcessor, undefinedProcessor, voidProcessor, neverProcessor, anyProcessor, unknownProcessor, dateProcessor, enumProcessor, literalProcessor, nanProcessor, templateLiteralProcessor, fileProcessor, successProcessor, customProcessor, functionProcessor, transformProcessor, mapProcessor, setProcessor, arrayProcessor, objectProcessor, unionProcessor, intersectionProcessor, tupleProcessor, pendingRecords, recordProcessor, nullableProcessor, nonoptionalProcessor, UNREPRESENTABLE_DEFAULT, defaultProcessor, prefaultProcessor, catchProcessor, pipeProcessor, readonlyProcessor, promiseProcessor, optionalProcessor, lazyProcessor, allProcessors;
var init_json_schema_processors = __esm({
  "node_modules/zod/v4/core/json-schema-processors.js"() {
    init_regexes();
    init_schemas();
    init_to_json_schema();
    init_util();
    narrowMin = (agg, key, value) => {
      if (agg[key] === void 0 || value > agg[key])
        agg[key] = value;
    };
    narrowMax = (agg, key, value) => {
      if (agg[key] === void 0 || value < agg[key])
        agg[key] = value;
    };
    narrowBoth = (agg, value) => {
      narrowMin(agg, "minimum", value);
      narrowMax(agg, "maximum", value);
    };
    addDivisor = (agg, value) => {
      agg.multipleOf ?? (agg.multipleOf = []);
      if (!agg.multipleOf.includes(value))
        agg.multipleOf.push(value);
    };
    addPattern = (agg, pattern) => {
      agg.patterns ?? (agg.patterns = /* @__PURE__ */ new Set());
      agg.patterns.add(pattern);
    };
    intersectMime = (agg, mime) => {
      agg.mime = agg.mime ? agg.mime.filter((m) => mime.includes(m)) : [...mime];
    };
    setFormat = (agg, format) => {
      agg.format = format;
      if (format.includes("int"))
        agg.isInt = true;
    };
    minContributor = (agg, def) => narrowMin(agg, "minimum", def.minimum);
    maxContributor = (agg, def) => narrowMax(agg, "maximum", def.maximum);
    formatContributor = (ranges) => (agg, def) => {
      setFormat(agg, def.format);
      const [minimum, maximum] = ranges[def.format];
      narrowMin(agg, "minimum", minimum);
      narrowMax(agg, "maximum", maximum);
    };
    contributors = {
      greater_than: (agg, def) => narrowMin(agg, def.inclusive ? "minimum" : "exclusiveMinimum", def.value),
      less_than: (agg, def) => narrowMax(agg, def.inclusive ? "maximum" : "exclusiveMaximum", def.value),
      multiple_of: (agg, def) => addDivisor(agg, def.value),
      number_format: formatContributor(NUMBER_FORMAT_RANGES),
      bigint_format: formatContributor(BIGINT_FORMAT_RANGES),
      min_length: minContributor,
      max_length: maxContributor,
      length_equals: (agg, def) => narrowBoth(agg, def.length),
      min_size: minContributor,
      max_size: maxContributor,
      size_equals: (agg, def) => narrowBoth(agg, def.size),
      string_format: (agg, def) => {
        setFormat(agg, def.format);
        if (def.pattern)
          addPattern(agg, def.pattern);
        if (def.format === "base64" || def.format === "base64url")
          agg.contentEncoding = def.format;
        if (def.local || def.precision === -1)
          agg.laxFormat = true;
      },
      mime_type: (agg, def) => intersectMime(agg, def.mime)
    };
    formatMap = {
      guid: "uuid",
      url: "uri",
      datetime: "date-time",
      json_string: "json-string",
      regex: ""
      // do not set
    };
    exactPatterns = /* @__PURE__ */ new Map([
      [base64Charset, base64],
      [base64urlCharset, base64url]
    ]);
    exactPattern = (p) => exactPatterns.get(p) ?? p;
    stringProcessor = (schema, ctx, _json, _params) => {
      const json2 = _json;
      json2.type = "string";
      const { minimum, maximum, format, patterns, contentEncoding, laxFormat } = aggregateChecks(schema);
      if (typeof minimum === "number")
        json2.minLength = minimum;
      if (typeof maximum === "number")
        json2.maxLength = maximum;
      if (format) {
        json2.format = formatMap[format] ?? format;
        if (json2.format === "")
          delete json2.format;
        if (format === "time" || laxFormat) {
          delete json2.format;
        }
      }
      if (contentEncoding)
        json2.contentEncoding = contentEncoding;
      if (patterns && patterns.size > 0) {
        const patternList = [...patterns].map(exactPattern);
        if (patternList.length === 1)
          json2.pattern = patternList[0].source;
        else if (patternList.length > 1) {
          json2.allOf = [
            ...patternList.map((regex) => ({
              ...ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0" ? { type: "string" } : {},
              pattern: regex.source
            }))
          ];
        }
      }
    };
    numberProcessor = (schema, ctx, _json, params) => {
      const json2 = _json;
      const { minimum, maximum, multipleOf, exclusiveMaximum, exclusiveMinimum, isInt } = aggregateChecks(schema);
      json2.type = isInt ? "integer" : "number";
      const exMin = typeof exclusiveMinimum === "number" && exclusiveMinimum >= (minimum ?? Number.NEGATIVE_INFINITY);
      const exMax = typeof exclusiveMaximum === "number" && exclusiveMaximum <= (maximum ?? Number.POSITIVE_INFINITY);
      const legacy = ctx.target === "draft-04" || ctx.target === "openapi-3.0";
      if (exMin) {
        if (legacy) {
          json2.minimum = exclusiveMinimum;
          json2.exclusiveMinimum = true;
        } else {
          json2.exclusiveMinimum = exclusiveMinimum;
        }
      } else if (typeof minimum === "number") {
        json2.minimum = minimum;
      }
      if (exMax) {
        if (legacy) {
          json2.maximum = exclusiveMaximum;
          json2.exclusiveMaximum = true;
        } else {
          json2.exclusiveMaximum = exclusiveMaximum;
        }
      } else if (typeof maximum === "number") {
        json2.maximum = maximum;
      }
      if (multipleOf) {
        const divisors = /* @__PURE__ */ new Set();
        for (const divisor of multipleOf) {
          if (Number.isFinite(divisor) && divisor !== 0)
            divisors.add(Math.abs(divisor));
          else
            handleUnrepresentable(schema, ctx, json2, params, `A multipleOf divisor of ${divisor} cannot be represented in JSON Schema`);
        }
        const [first, ...rest] = divisors;
        if (first !== void 0)
          json2.multipleOf = first;
        if (rest.length)
          json2.allOf = [...json2.allOf ?? [], ...rest.map((m) => ({ multipleOf: m }))];
      }
    };
    booleanProcessor = (_schema, _ctx, json2, _params) => {
      json2.type = "boolean";
    };
    bigintProcessor = (schema, ctx, json2, params) => {
      handleUnrepresentable(schema, ctx, json2, params, "BigInt cannot be represented in JSON Schema");
    };
    symbolProcessor = (schema, ctx, json2, params) => {
      handleUnrepresentable(schema, ctx, json2, params, "Symbols cannot be represented in JSON Schema");
    };
    nullProcessor = (_schema, ctx, json2, _params) => {
      if (ctx.target === "openapi-3.0") {
        json2.type = "string";
        json2.nullable = true;
        json2.enum = [null];
      } else {
        json2.type = "null";
      }
    };
    undefinedProcessor = (schema, ctx, json2, params) => {
      handleUnrepresentable(schema, ctx, json2, params, "Undefined cannot be represented in JSON Schema");
    };
    voidProcessor = (schema, ctx, json2, params) => {
      handleUnrepresentable(schema, ctx, json2, params, "Void cannot be represented in JSON Schema");
    };
    neverProcessor = (_schema, _ctx, json2, _params) => {
      json2.not = {};
    };
    anyProcessor = (_schema, _ctx, _json, _params) => {
    };
    unknownProcessor = (_schema, _ctx, _json, _params) => {
    };
    dateProcessor = (schema, ctx, json2, params) => {
      handleUnrepresentable(schema, ctx, json2, params, "Date cannot be represented in JSON Schema");
    };
    enumProcessor = (schema, _ctx, json2, _params) => {
      const def = schema._zod.def;
      const values = getEnumValues(def.entries);
      if (values.length === 0) {
        json2.not = {};
        return;
      }
      if (values.every((v) => typeof v === "number"))
        json2.type = "number";
      if (values.every((v) => typeof v === "string"))
        json2.type = "string";
      json2.enum = values;
    };
    literalProcessor = (schema, ctx, json2, params) => {
      const def = schema._zod.def;
      if (def.values.length === 0) {
        json2.not = {};
        return;
      }
      const vals = [];
      for (const val of def.values) {
        if (val === void 0) {
          if (handleUnrepresentable(schema, ctx, json2, params, "Literal `undefined` cannot be represented in JSON Schema"))
            return;
        } else if (typeof val === "bigint") {
          if (handleUnrepresentable(schema, ctx, json2, params, "BigInt literals cannot be represented in JSON Schema"))
            return;
          vals.push(Number(val));
        } else {
          vals.push(val);
        }
      }
      if (vals.length === 0) {
      } else if (vals.length === 1) {
        const val = vals[0];
        json2.type = val === null ? "null" : typeof val;
        if (ctx.target === "draft-04" || ctx.target === "openapi-3.0") {
          json2.enum = [val];
        } else {
          json2.const = val;
        }
      } else {
        if (vals.every((v) => typeof v === "number"))
          json2.type = "number";
        if (vals.every((v) => typeof v === "string"))
          json2.type = "string";
        if (vals.every((v) => typeof v === "boolean"))
          json2.type = "boolean";
        if (vals.every((v) => v === null))
          json2.type = "null";
        json2.enum = vals;
      }
    };
    nanProcessor = (schema, ctx, json2, params) => {
      handleUnrepresentable(schema, ctx, json2, params, "NaN cannot be represented in JSON Schema");
    };
    templateLiteralProcessor = (schema, _ctx, json2, _params) => {
      const _json = json2;
      const pattern = schema._zod.pattern;
      if (!pattern)
        throw new Error("Pattern not found in template literal");
      _json.type = "string";
      _json.pattern = pattern.source;
    };
    fileProcessor = (schema, _ctx, json2, _params) => {
      const _json = json2;
      _json.type = "string";
      _json.format = "binary";
      _json.contentEncoding = "binary";
      const { minimum, maximum, mime } = aggregateChecks(schema);
      if (minimum !== void 0)
        _json.minLength = minimum;
      if (maximum !== void 0)
        _json.maxLength = maximum;
      if (!mime)
        return;
      if (mime.length === 0)
        _json.not = {};
      else if (mime.length === 1)
        _json.contentMediaType = mime[0];
      else
        _json.anyOf = mime.map((m) => ({ contentMediaType: m }));
    };
    successProcessor = (_schema, _ctx, json2, _params) => {
      json2.type = "boolean";
    };
    customProcessor = (schema, ctx, json2, params) => {
      handleUnrepresentable(schema, ctx, json2, params, "Custom types cannot be represented in JSON Schema");
    };
    functionProcessor = (schema, ctx, json2, params) => {
      handleUnrepresentable(schema, ctx, json2, params, "Function types cannot be represented in JSON Schema");
    };
    transformProcessor = (schema, ctx, json2, params) => {
      handleUnrepresentable(schema, ctx, json2, params, "Transforms cannot be represented in JSON Schema");
    };
    mapProcessor = (schema, ctx, json2, params) => {
      handleUnrepresentable(schema, ctx, json2, params, "Map cannot be represented in JSON Schema");
    };
    setProcessor = (schema, ctx, json2, params) => {
      handleUnrepresentable(schema, ctx, json2, params, "Set cannot be represented in JSON Schema");
    };
    arrayProcessor = (schema, ctx, _json, params) => {
      const json2 = _json;
      const def = schema._zod.def;
      const { minimum, maximum } = aggregateChecks(schema);
      if (typeof minimum === "number")
        json2.minItems = minimum;
      if (typeof maximum === "number")
        json2.maxItems = maximum;
      json2.type = "array";
      json2.items = processSchema(def.element, ctx, {
        ...params,
        path: [...params.path, "items"]
      });
    };
    objectProcessor = (schema, ctx, _json, params) => {
      const json2 = _json;
      const def = schema._zod.def;
      const shape = def.shape;
      const symbolKeys = Object.getOwnPropertySymbols(shape);
      if (symbolKeys.length && handleUnrepresentable(schema, ctx, json2, params, "Symbol keys cannot be represented in JSON Schema")) {
        return;
      }
      json2.type = "object";
      json2.properties = {};
      for (const key in shape) {
        assignProp(json2.properties, key, processSchema(shape[key], ctx, {
          ...params,
          path: [...params.path, "properties", key]
        }));
      }
      const requiredKeys = [];
      for (const key of Object.keys(shape)) {
        const field = def.shape[key];
        if (ctx.io === "input" ? inputOptin(field) === void 0 : field._zod.optout === void 0) {
          requiredKeys.push(key);
        }
      }
      if (requiredKeys.length > 0) {
        json2.required = requiredKeys;
      }
      if (def.catchall?._zod.def.type === "never") {
        json2.additionalProperties = false;
      } else if (!def.catchall) {
        if (ctx.io === "output")
          json2.additionalProperties = false;
      } else if (def.catchall) {
        json2.additionalProperties = processSchema(def.catchall, ctx, {
          ...params,
          path: [...params.path, "additionalProperties"]
        });
      }
    };
    unionProcessor = (schema, ctx, json2, params) => {
      const def = schema._zod.def;
      const isExclusive = def.inclusive === false;
      const options = def.options.map((x, i) => processSchema(x, ctx, {
        ...params,
        path: [...params.path, isExclusive ? "oneOf" : "anyOf", i]
      }));
      if (isExclusive) {
        json2.oneOf = options;
      } else {
        json2.anyOf = options;
      }
    };
    intersectionProcessor = (schema, ctx, json2, params) => {
      const def = schema._zod.def;
      const a = processSchema(def.left, ctx, {
        ...params,
        path: [...params.path, "allOf", 0]
      });
      const b = processSchema(def.right, ctx, {
        ...params,
        path: [...params.path, "allOf", 1]
      });
      const isSimpleIntersection = (val) => "allOf" in val && Object.keys(val).length === 1;
      const allOf = [
        ...isSimpleIntersection(a) ? a.allOf : [a],
        ...isSimpleIntersection(b) ? b.allOf : [b]
      ];
      json2.allOf = allOf;
      ctx.intersections.push(allOf);
    };
    tupleProcessor = (schema, ctx, _json, params) => {
      const json2 = _json;
      const def = schema._zod.def;
      json2.type = "array";
      const prefixPath = ctx.target === "draft-2020-12" ? "prefixItems" : "items";
      const restPath = ctx.target === "draft-2020-12" ? "items" : ctx.target === "openapi-3.0" ? "items" : "additionalItems";
      const prefixItems = def.items.map((x, i) => processSchema(x, ctx, {
        ...params,
        path: [...params.path, prefixPath, i]
      }));
      const rest = def.rest ? processSchema(def.rest, ctx, {
        ...params,
        path: [...params.path, restPath, ...ctx.target === "openapi-3.0" ? [def.items.length] : []]
      }) : null;
      let minItems = def.items.length;
      while (minItems > 0) {
        const item = def.items[minItems - 1];
        const optional2 = ctx.io === "input" ? inputOptin(item) !== void 0 : item._zod.optout === "optional";
        if (!optional2)
          break;
        minItems--;
      }
      const maxItems = def.items.length;
      const isClosed = !def.rest;
      if (ctx.target === "draft-2020-12") {
        json2.prefixItems = prefixItems;
        if (isClosed) {
          json2.items = false;
        } else if (rest) {
          json2.items = rest;
        }
        if (minItems > 0)
          json2.minItems = minItems;
        if (isClosed)
          json2.maxItems = maxItems;
      } else if (ctx.target === "openapi-3.0") {
        json2.items = {
          anyOf: prefixItems
        };
        if (rest) {
          json2.items.anyOf.push(rest);
        }
        if (minItems > 0)
          json2.minItems = minItems;
        if (isClosed)
          json2.maxItems = maxItems;
      } else {
        json2.items = prefixItems;
        if (isClosed) {
          json2.additionalItems = false;
        } else if (rest) {
          json2.additionalItems = rest;
        }
        if (minItems > 0)
          json2.minItems = minItems;
        if (isClosed)
          json2.maxItems = maxItems;
      }
      const { minimum, maximum } = aggregateChecks(schema);
      if (typeof minimum === "number")
        json2.minItems = minimum;
      if (typeof maximum === "number")
        json2.maxItems = maximum;
    };
    pendingRecords = /* @__PURE__ */ new WeakMap();
    recordProcessor = (schema, ctx, _json, params) => {
      const json2 = _json;
      const def = schema._zod.def;
      json2.type = "object";
      const keyType = def.keyType;
      const patterns = aggregateChecks(keyType).patterns;
      if (def.mode === "loose" && patterns && patterns.size > 0) {
        const valueSchema = processSchema(def.valueType, ctx, {
          ...params,
          path: [...params.path, "patternProperties", "*"]
        });
        json2.patternProperties = {};
        for (const pattern of patterns) {
          assignProp(json2.patternProperties, exactPattern(pattern).source, valueSchema);
        }
      } else {
        if (ctx.target === "draft-07" || ctx.target === "draft-2020-12") {
          json2.propertyNames = processSchema(def.keyType, ctx, {
            ...params,
            path: [...params.path, "propertyNames"]
          });
          let pending = pendingRecords.get(ctx);
          if (!pending) {
            pending = [];
            pendingRecords.set(ctx, pending);
            ctx.deferred.push(() => rewriteKeyNames(ctx));
          }
          pending.push(schema);
        }
        json2.additionalProperties = processSchema(def.valueType, ctx, {
          ...params,
          path: [...params.path, "additionalProperties"]
        });
      }
      const keyValues = keyType._zod.values;
      const omittableOnInput = ctx.io === "input" && inputOptin(def.valueType) !== void 0;
      if (keyValues && !def.partial && !omittableOnInput) {
        const validKeyValues = [...keyValues].filter((v) => typeof v === "string" || typeof v === "number");
        if (validKeyValues.length > 0) {
          json2.required = validKeyValues.map(String);
        }
      }
    };
    nullableProcessor = (schema, ctx, json2, params) => {
      const def = schema._zod.def;
      const inner = processSchema(def.innerType, ctx, params);
      const seen = ctx.seen.get(schema);
      if (ctx.target === "openapi-3.0") {
        seen.ref = def.innerType;
        json2.nullable = true;
      } else {
        json2.anyOf = [inner, { type: "null" }];
      }
    };
    nonoptionalProcessor = (schema, ctx, _json, params) => {
      const def = schema._zod.def;
      processSchema(def.innerType, ctx, params);
      const seen = ctx.seen.get(schema);
      seen.ref = def.innerType;
    };
    UNREPRESENTABLE_DEFAULT = /* @__PURE__ */ Symbol();
    defaultProcessor = (schema, ctx, json2, params) => {
      const def = schema._zod.def;
      processSchema(def.innerType, ctx, params);
      const seen = ctx.seen.get(schema);
      seen.ref = def.innerType;
      const value = serializeDefaultValue(def.defaultValue, schema, ctx, json2, params);
      if (value !== UNREPRESENTABLE_DEFAULT)
        json2.default = value;
    };
    prefaultProcessor = (schema, ctx, json2, params) => {
      const def = schema._zod.def;
      processSchema(def.innerType, ctx, params);
      const seen = ctx.seen.get(schema);
      seen.ref = def.innerType;
      if (ctx.io !== "input")
        return;
      const value = serializeDefaultValue(def.defaultValue, schema, ctx, json2, params);
      if (value !== UNREPRESENTABLE_DEFAULT)
        json2._prefault = value;
    };
    catchProcessor = (schema, ctx, json2, params) => {
      const def = schema._zod.def;
      processSchema(def.innerType, ctx, params);
      const seen = ctx.seen.get(schema);
      seen.ref = def.innerType;
      let catchValue;
      try {
        catchValue = def.catchValue(void 0);
      } catch {
        handleUnrepresentable(schema, ctx, json2, params, "Dynamic catch values are not supported in JSON Schema");
        return;
      }
      json2.default = catchValue;
    };
    pipeProcessor = (schema, ctx, _json, params) => {
      const def = schema._zod.def;
      const inIsTransform = def.in._zod.traits.has("$ZodTransform");
      const innerType = ctx.io === "input" ? inIsTransform ? def.out : def.in : def.out;
      processSchema(innerType, ctx, params);
      const seen = ctx.seen.get(schema);
      seen.ref = innerType;
    };
    readonlyProcessor = (schema, ctx, json2, params) => {
      const def = schema._zod.def;
      processSchema(def.innerType, ctx, params);
      const seen = ctx.seen.get(schema);
      seen.ref = def.innerType;
      json2.readOnly = true;
    };
    promiseProcessor = (schema, ctx, _json, params) => {
      const def = schema._zod.def;
      processSchema(def.innerType, ctx, params);
      const seen = ctx.seen.get(schema);
      seen.ref = def.innerType;
    };
    optionalProcessor = (schema, ctx, _json, params) => {
      const def = schema._zod.def;
      processSchema(def.innerType, ctx, params);
      const seen = ctx.seen.get(schema);
      seen.ref = def.innerType;
    };
    lazyProcessor = (schema, ctx, _json, params) => {
      const innerType = schema._zod.innerType;
      processSchema(innerType, ctx, params);
      const seen = ctx.seen.get(schema);
      seen.ref = innerType;
    };
    allProcessors = {
      string: stringProcessor,
      number: numberProcessor,
      boolean: booleanProcessor,
      bigint: bigintProcessor,
      symbol: symbolProcessor,
      null: nullProcessor,
      undefined: undefinedProcessor,
      void: voidProcessor,
      never: neverProcessor,
      any: anyProcessor,
      unknown: unknownProcessor,
      date: dateProcessor,
      enum: enumProcessor,
      literal: literalProcessor,
      nan: nanProcessor,
      template_literal: templateLiteralProcessor,
      file: fileProcessor,
      success: successProcessor,
      custom: customProcessor,
      function: functionProcessor,
      transform: transformProcessor,
      map: mapProcessor,
      set: setProcessor,
      array: arrayProcessor,
      object: objectProcessor,
      union: unionProcessor,
      intersection: intersectionProcessor,
      tuple: tupleProcessor,
      record: recordProcessor,
      nullable: nullableProcessor,
      nonoptional: nonoptionalProcessor,
      default: defaultProcessor,
      prefault: prefaultProcessor,
      catch: catchProcessor,
      pipe: pipeProcessor,
      readonly: readonlyProcessor,
      promise: promiseProcessor,
      optional: optionalProcessor,
      lazy: lazyProcessor
    };
  }
});

// node_modules/zod/v4/core/json-schema-generator.js
var JSONSchemaGenerator;
var init_json_schema_generator = __esm({
  "node_modules/zod/v4/core/json-schema-generator.js"() {
    init_json_schema_processors();
    init_to_json_schema();
    JSONSchemaGenerator = class {
      /** @deprecated Access via ctx instead */
      get metadataRegistry() {
        return this.ctx.metadataRegistry;
      }
      /** @deprecated Access via ctx instead */
      get target() {
        return this.ctx.target;
      }
      // annotated so the .d.cts emits an indexed access rather than an inline `import()` of an ESM path
      /** @deprecated Access via ctx instead */
      get unrepresentable() {
        return this.ctx.unrepresentable;
      }
      /** @deprecated Access via ctx instead */
      get override() {
        return this.ctx.override;
      }
      /** @deprecated Access via ctx instead */
      get io() {
        return this.ctx.io;
      }
      /** @deprecated Access via ctx instead */
      get counter() {
        return this.ctx.counter;
      }
      set counter(value) {
        this.ctx.counter = value;
      }
      /** @deprecated Access via ctx instead */
      get seen() {
        return this.ctx.seen;
      }
      constructor(params) {
        let normalizedTarget = params?.target ?? "draft-2020-12";
        if (normalizedTarget === "draft-4")
          normalizedTarget = "draft-04";
        if (normalizedTarget === "draft-7")
          normalizedTarget = "draft-07";
        this.ctx = initializeContext({
          processors: allProcessors,
          target: normalizedTarget,
          ...params?.metadata && { metadata: params.metadata },
          ...params?.unrepresentable && { unrepresentable: params.unrepresentable },
          ...params?.override && { override: params.override },
          ...params?.io && { io: params.io }
        });
      }
      /**
       * Process a schema to prepare it for JSON Schema generation.
       * This must be called before emit().
       */
      process(schema, _params = { path: [], schemaPath: [] }) {
        return processSchema(schema, this.ctx, _params);
      }
      /**
       * Emit the final JSON Schema after processing.
       * Must call process() first.
       */
      emit(schema, _params) {
        if (_params) {
          if (_params.cycles)
            this.ctx.cycles = _params.cycles;
          if (_params.reused)
            this.ctx.reused = _params.reused;
          if (_params.external)
            this.ctx.external = _params.external;
        }
        this.ctx.sharedDefsExtractedFor = void 0;
        this.ctx.sharedEmitDoneFor = void 0;
        extractDefs(this.ctx, schema);
        const result = finalize(this.ctx, schema);
        const { "~standard": _, ...plainResult } = result;
        return plainResult;
      }
    };
  }
});

// node_modules/zod/v4/core/json-schema.js
var json_schema_exports = {};
var init_json_schema = __esm({
  "node_modules/zod/v4/core/json-schema.js"() {
  }
});

// node_modules/zod/v4/core/index.js
var core_exports2 = {};
__export(core_exports2, {
  $ZodAny: () => $ZodAny,
  $ZodArray: () => $ZodArray,
  $ZodAsyncError: () => $ZodAsyncError,
  $ZodBase64: () => $ZodBase64,
  $ZodBase64URL: () => $ZodBase64URL,
  $ZodBigInt: () => $ZodBigInt,
  $ZodBigIntFormat: () => $ZodBigIntFormat,
  $ZodBoolean: () => $ZodBoolean,
  $ZodCIDRv4: () => $ZodCIDRv4,
  $ZodCIDRv6: () => $ZodCIDRv6,
  $ZodCUID: () => $ZodCUID,
  $ZodCUID2: () => $ZodCUID2,
  $ZodCatch: () => $ZodCatch,
  $ZodCheck: () => $ZodCheck,
  $ZodCheckBigIntFormat: () => $ZodCheckBigIntFormat,
  $ZodCheckEndsWith: () => $ZodCheckEndsWith,
  $ZodCheckGreaterThan: () => $ZodCheckGreaterThan,
  $ZodCheckIncludes: () => $ZodCheckIncludes,
  $ZodCheckLengthEquals: () => $ZodCheckLengthEquals,
  $ZodCheckLessThan: () => $ZodCheckLessThan,
  $ZodCheckLowerCase: () => $ZodCheckLowerCase,
  $ZodCheckMaxLength: () => $ZodCheckMaxLength,
  $ZodCheckMaxSize: () => $ZodCheckMaxSize,
  $ZodCheckMimeType: () => $ZodCheckMimeType,
  $ZodCheckMinLength: () => $ZodCheckMinLength,
  $ZodCheckMinSize: () => $ZodCheckMinSize,
  $ZodCheckMultipleOf: () => $ZodCheckMultipleOf,
  $ZodCheckNumberFormat: () => $ZodCheckNumberFormat,
  $ZodCheckOverwrite: () => $ZodCheckOverwrite,
  $ZodCheckProperties: () => $ZodCheckProperties,
  $ZodCheckProperty: () => $ZodCheckProperty,
  $ZodCheckRegex: () => $ZodCheckRegex,
  $ZodCheckSizeEquals: () => $ZodCheckSizeEquals,
  $ZodCheckStartsWith: () => $ZodCheckStartsWith,
  $ZodCheckStringFormat: () => $ZodCheckStringFormat,
  $ZodCheckUpperCase: () => $ZodCheckUpperCase,
  $ZodCodec: () => $ZodCodec,
  $ZodCreditCard: () => $ZodCreditCard,
  $ZodCustom: () => $ZodCustom,
  $ZodCustomStringFormat: () => $ZodCustomStringFormat,
  $ZodCyclicError: () => $ZodCyclicError,
  $ZodDate: () => $ZodDate,
  $ZodDefault: () => $ZodDefault,
  $ZodDiscriminatedUnion: () => $ZodDiscriminatedUnion,
  $ZodE164: () => $ZodE164,
  $ZodEmail: () => $ZodEmail,
  $ZodEmoji: () => $ZodEmoji,
  $ZodEncodeError: () => $ZodEncodeError,
  $ZodEnum: () => $ZodEnum,
  $ZodError: () => $ZodError,
  $ZodExactOptional: () => $ZodExactOptional,
  $ZodFile: () => $ZodFile,
  $ZodFunction: () => $ZodFunction,
  $ZodGUID: () => $ZodGUID,
  $ZodIBAN: () => $ZodIBAN,
  $ZodIPv4: () => $ZodIPv4,
  $ZodIPv6: () => $ZodIPv6,
  $ZodISODate: () => $ZodISODate,
  $ZodISODateTime: () => $ZodISODateTime,
  $ZodISODuration: () => $ZodISODuration,
  $ZodISOTime: () => $ZodISOTime,
  $ZodIntersection: () => $ZodIntersection,
  $ZodJWT: () => $ZodJWT,
  $ZodKSUID: () => $ZodKSUID,
  $ZodLazy: () => $ZodLazy,
  $ZodLiteral: () => $ZodLiteral,
  $ZodMAC: () => $ZodMAC,
  $ZodMap: () => $ZodMap,
  $ZodNaN: () => $ZodNaN,
  $ZodNanoID: () => $ZodNanoID,
  $ZodNever: () => $ZodNever,
  $ZodNonOptional: () => $ZodNonOptional,
  $ZodNull: () => $ZodNull,
  $ZodNullable: () => $ZodNullable,
  $ZodNumber: () => $ZodNumber,
  $ZodNumberFormat: () => $ZodNumberFormat,
  $ZodObject: () => $ZodObject,
  $ZodObjectJIT: () => $ZodObjectJIT,
  $ZodOptional: () => $ZodOptional,
  $ZodPipe: () => $ZodPipe,
  $ZodPrefault: () => $ZodPrefault,
  $ZodPreprocess: () => $ZodPreprocess,
  $ZodPromise: () => $ZodPromise,
  $ZodReadonly: () => $ZodReadonly,
  $ZodRealError: () => $ZodRealError,
  $ZodRecord: () => $ZodRecord,
  $ZodRegistry: () => $ZodRegistry,
  $ZodSet: () => $ZodSet,
  $ZodString: () => $ZodString,
  $ZodStringFormat: () => $ZodStringFormat,
  $ZodSuccess: () => $ZodSuccess,
  $ZodSymbol: () => $ZodSymbol,
  $ZodTemplateLiteral: () => $ZodTemplateLiteral,
  $ZodTransform: () => $ZodTransform,
  $ZodTuple: () => $ZodTuple,
  $ZodType: () => $ZodType,
  $ZodULID: () => $ZodULID,
  $ZodURL: () => $ZodURL,
  $ZodUUID: () => $ZodUUID,
  $ZodUndefined: () => $ZodUndefined,
  $ZodUnion: () => $ZodUnion,
  $ZodUnknown: () => $ZodUnknown,
  $ZodVoid: () => $ZodVoid,
  $ZodXID: () => $ZodXID,
  $ZodXor: () => $ZodXor,
  $brand: () => $brand,
  $constructor: () => $constructor,
  $input: () => $input,
  $output: () => $output,
  Doc: () => Doc,
  INVALID: () => INVALID,
  JSONSchema: () => json_schema_exports,
  JSONSchemaGenerator: () => JSONSchemaGenerator,
  NEVER: () => NEVER,
  TimePrecision: () => TimePrecision,
  URL_BAD_FORMAT: () => URL_BAD_FORMAT,
  URL_UNPARSEABLE: () => URL_UNPARSEABLE,
  ZodCompileAsyncError: () => ZodCompileAsyncError,
  ZodCompileUnsupportedError: () => ZodCompileUnsupportedError,
  _any: () => _any,
  _array: () => _array,
  _base64: () => _base64,
  _base64url: () => _base64url,
  _bigint: () => _bigint,
  _boolean: () => _boolean,
  _catch: () => _catch,
  _check: () => _check,
  _cidrv4: () => _cidrv4,
  _cidrv6: () => _cidrv6,
  _coercedBigint: () => _coercedBigint,
  _coercedBoolean: () => _coercedBoolean,
  _coercedDate: () => _coercedDate,
  _coercedNumber: () => _coercedNumber,
  _coercedString: () => _coercedString,
  _creditCard: () => _creditCard,
  _cuid: () => _cuid,
  _cuid2: () => _cuid2,
  _custom: () => _custom,
  _date: () => _date,
  _decode: () => _decode,
  _decodeAsync: () => _decodeAsync,
  _default: () => _default,
  _discriminatedUnion: () => _discriminatedUnion,
  _e164: () => _e164,
  _email: () => _email,
  _emoji: () => _emoji2,
  _encode: () => _encode,
  _encodeAsync: () => _encodeAsync,
  _endsWith: () => _endsWith,
  _enum: () => _enum,
  _file: () => _file,
  _float32: () => _float32,
  _float64: () => _float64,
  _gt: () => _gt,
  _gte: () => _gte,
  _guid: () => _guid,
  _iban: () => _iban,
  _includes: () => _includes,
  _int: () => _int,
  _int32: () => _int32,
  _int64: () => _int64,
  _intersection: () => _intersection,
  _ipv4: () => _ipv4,
  _ipv6: () => _ipv6,
  _isoDate: () => _isoDate,
  _isoDateTime: () => _isoDateTime,
  _isoDuration: () => _isoDuration,
  _isoTime: () => _isoTime,
  _jwt: () => _jwt,
  _ksuid: () => _ksuid,
  _lazy: () => _lazy,
  _length: () => _length,
  _literal: () => _literal,
  _lowercase: () => _lowercase,
  _lt: () => _lt,
  _lte: () => _lte,
  _mac: () => _mac,
  _map: () => _map,
  _max: () => _lte,
  _maxLength: () => _maxLength,
  _maxSize: () => _maxSize,
  _mime: () => _mime,
  _min: () => _gte,
  _minLength: () => _minLength,
  _minSize: () => _minSize,
  _multipleOf: () => _multipleOf,
  _nan: () => _nan,
  _nanoid: () => _nanoid,
  _nativeEnum: () => _nativeEnum,
  _negative: () => _negative,
  _never: () => _never,
  _nonnegative: () => _nonnegative,
  _nonoptional: () => _nonoptional,
  _nonpositive: () => _nonpositive,
  _normalize: () => _normalize,
  _null: () => _null2,
  _nullable: () => _nullable,
  _number: () => _number,
  _optional: () => _optional,
  _overwrite: () => _overwrite,
  _parse: () => _parse,
  _parseAsync: () => _parseAsync,
  _pipe: () => _pipe,
  _positive: () => _positive,
  _promise: () => _promise,
  _properties: () => _properties,
  _property: () => _property,
  _readonly: () => _readonly,
  _record: () => _record,
  _refine: () => _refine,
  _regex: () => _regex,
  _safeDecode: () => _safeDecode,
  _safeDecodeAsync: () => _safeDecodeAsync,
  _safeEncode: () => _safeEncode,
  _safeEncodeAsync: () => _safeEncodeAsync,
  _safeParse: () => _safeParse,
  _safeParseAsync: () => _safeParseAsync,
  _set: () => _set,
  _size: () => _size,
  _slugify: () => _slugify,
  _startsWith: () => _startsWith,
  _string: () => _string,
  _stringFormat: () => _stringFormat,
  _stringbool: () => _stringbool,
  _success: () => _success,
  _superRefine: () => _superRefine,
  _symbol: () => _symbol,
  _templateLiteral: () => _templateLiteral,
  _toLowerCase: () => _toLowerCase,
  _toUpperCase: () => _toUpperCase,
  _transform: () => _transform,
  _trim: () => _trim,
  _tuple: () => _tuple,
  _uint32: () => _uint32,
  _uint64: () => _uint64,
  _ulid: () => _ulid,
  _undefined: () => _undefined2,
  _union: () => _union,
  _unknown: () => _unknown,
  _uppercase: () => _uppercase,
  _url: () => _url,
  _uuid: () => _uuid,
  _uuidv4: () => _uuidv4,
  _uuidv6: () => _uuidv6,
  _uuidv7: () => _uuidv7,
  _void: () => _void,
  _xid: () => _xid,
  _xor: () => _xor,
  base64Charset: () => base64Charset,
  base64urlCharset: () => base64urlCharset,
  canParseURL: () => canParseURL,
  clone: () => clone,
  compile: () => compile,
  compileFn: () => compileFn,
  config: () => config,
  createStandardJSONSchemaMethod: () => createStandardJSONSchemaMethod,
  createToJSONSchemaMethod: () => createToJSONSchemaMethod,
  decode: () => decode,
  decodeAsync: () => decodeAsync,
  describe: () => describe,
  encode: () => encode,
  encodeAsync: () => encodeAsync,
  extractDefs: () => extractDefs,
  finalize: () => finalize,
  flattenError: () => flattenError,
  formatError: () => formatError,
  getDiscriminatedOption: () => getDiscriminatedOption,
  globalConfig: () => globalConfig,
  globalRegistry: () => globalRegistry,
  handleUnrepresentable: () => handleUnrepresentable,
  initializeContext: () => initializeContext,
  isBackEdge: () => isBackEdge,
  isRecursiveSchema: () => isRecursiveSchema,
  isValidBase64: () => isValidBase64,
  isValidBase64URL: () => isValidBase64URL,
  isValidCIDRv6: () => isValidCIDRv6,
  isValidCreditCard: () => isValidCreditCard,
  isValidIBAN: () => isValidIBAN,
  isValidIPv6: () => isValidIPv6,
  isValidJWT: () => isValidJWT,
  locales: () => zod_locales_exports,
  memoizer: () => memoizer,
  mergeValues: () => mergeValues,
  meta: () => meta,
  parse: () => parse,
  parseAsync: () => parseAsync,
  parseURLObject: () => parseURLObject,
  prettifyError: () => prettifyError,
  process: () => processSchema,
  processSchema: () => processSchema,
  regexes: () => regexes_exports,
  registry: () => registry,
  safeDecode: () => safeDecode,
  safeDecodeAsync: () => safeDecodeAsync,
  safeEncode: () => safeEncode,
  safeEncodeAsync: () => safeEncodeAsync,
  safeParse: () => safeParse,
  safeParseAsync: () => safeParseAsync,
  standardProps: () => standardProps,
  stripTabAndNewline: () => stripTabAndNewline,
  toDotPath: () => toDotPath,
  toJSONSchema: () => toJSONSchema,
  toZod: () => toZod,
  treeifyError: () => treeifyError,
  urlHostnameOk: () => urlHostnameOk,
  urlProtocolOk: () => urlProtocolOk,
  util: () => util_exports,
  validate: () => validate,
  validateAsync: () => validateAsync,
  validateURL: () => validateURL,
  version: () => version,
  withParser: () => withParser
});
var init_core2 = __esm({
  "node_modules/zod/v4/core/index.js"() {
    init_core();
    init_parse();
    init_errors();
    init_schemas();
    init_memoizer();
    init_checks();
    init_versions();
    init_util();
    init_util();
    init_regexes();
    init_zod_locales();
    init_registries();
    init_doc();
    init_compile();
    init_api();
    init_to_json_schema();
    init_json_schema_processors();
    init_json_schema_generator();
    init_json_schema();
  }
});

// node_modules/zod/v4/classic/checks.js
var checks_exports2 = {};
__export(checks_exports2, {
  endsWith: () => _endsWith,
  gt: () => _gt,
  gte: () => _gte,
  includes: () => _includes,
  length: () => _length,
  lowercase: () => _lowercase,
  lt: () => _lt,
  lte: () => _lte,
  maxLength: () => _maxLength,
  maxSize: () => _maxSize,
  mime: () => _mime,
  minLength: () => _minLength,
  minSize: () => _minSize,
  multipleOf: () => _multipleOf,
  negative: () => _negative,
  nonnegative: () => _nonnegative,
  nonpositive: () => _nonpositive,
  normalize: () => _normalize,
  overwrite: () => _overwrite,
  positive: () => _positive,
  properties: () => _properties,
  property: () => _property,
  regex: () => _regex,
  size: () => _size,
  slugify: () => _slugify,
  startsWith: () => _startsWith,
  toLowerCase: () => _toLowerCase,
  toUpperCase: () => _toUpperCase,
  trim: () => _trim,
  uppercase: () => _uppercase
});
var init_checks2 = __esm({
  "node_modules/zod/v4/classic/checks.js"() {
    init_core2();
  }
});

// node_modules/zod/v4/classic/errors.js
function _lazyMethod(proto, key, make) {
  Object.defineProperty(proto, key, {
    configurable: true,
    enumerable: false,
    get() {
      const value = make(this);
      Object.defineProperty(this, key, { value, configurable: true, writable: true });
      return value;
    },
    set(value) {
      Object.defineProperty(this, key, { value, configurable: true, writable: true });
    }
  });
}
var _installedErrorProtos, initializer2, ZodError, ZodRealError;
var init_errors2 = __esm({
  "node_modules/zod/v4/classic/errors.js"() {
    init_core2();
    init_core2();
    init_util();
    _installedErrorProtos = /* @__PURE__ */ new WeakSet([Object.prototype, Error.prototype]);
    initializer2 = (inst, issues) => {
      $ZodError.init(inst, issues);
      inst.name = "ZodError";
      const proto = Object.getPrototypeOf(inst);
      if (_installedErrorProtos.has(proto))
        return;
      _installedErrorProtos.add(proto);
      _lazyMethod(proto, "format", (self) => (mapper) => formatError(self, mapper));
      _lazyMethod(proto, "flatten", (self) => (mapper) => flattenError(self, mapper));
      _lazyMethod(proto, "addIssue", (self) => (issue2) => {
        self.issues.push(issue2);
        self.message = JSON.stringify(self.issues, jsonStringifyReplacer, 2);
      });
      _lazyMethod(proto, "addIssues", (self) => (issues2) => {
        self.issues.push(...issues2);
        self.message = JSON.stringify(self.issues, jsonStringifyReplacer, 2);
      });
      Object.defineProperty(proto, "isEmpty", {
        configurable: true,
        enumerable: false,
        get() {
          return this.issues.length === 0;
        }
      });
    };
    ZodError = /* @__PURE__ */ $constructor("ZodError", initializer2);
    ZodRealError = /* @__PURE__ */ $constructor("ZodError", initializer2, void 0, {
      Parent: Error
    });
  }
});

// node_modules/zod/v4/classic/parse.js
var parse2, parseAsync2, safeParse2, safeParseAsync2, encode2, decode2, encodeAsync2, decodeAsync2, safeEncode2, safeDecode2, safeEncodeAsync2, safeDecodeAsync2;
var init_parse2 = __esm({
  "node_modules/zod/v4/classic/parse.js"() {
    init_core2();
    init_errors2();
    init_core2();
    parse2 = /* @__PURE__ */ _parse(ZodRealError);
    parseAsync2 = /* @__PURE__ */ _parseAsync(ZodRealError);
    safeParse2 = /* @__PURE__ */ _safeParse(ZodRealError);
    safeParseAsync2 = /* @__PURE__ */ _safeParseAsync(ZodRealError);
    encode2 = /* @__PURE__ */ _encode(ZodRealError);
    decode2 = /* @__PURE__ */ _decode(ZodRealError);
    encodeAsync2 = /* @__PURE__ */ _encodeAsync(ZodRealError);
    decodeAsync2 = /* @__PURE__ */ _decodeAsync(ZodRealError);
    safeEncode2 = /* @__PURE__ */ _safeEncode(ZodRealError);
    safeDecode2 = /* @__PURE__ */ _safeDecode(ZodRealError);
    safeEncodeAsync2 = /* @__PURE__ */ _safeEncodeAsync(ZodRealError);
    safeDecodeAsync2 = /* @__PURE__ */ _safeDecodeAsync(ZodRealError);
  }
});

// node_modules/zod/v4/classic/schemas.js
var schemas_exports2 = {};
__export(schemas_exports2, {
  ZodAny: () => ZodAny,
  ZodArray: () => ZodArray,
  ZodBase64: () => ZodBase64,
  ZodBase64URL: () => ZodBase64URL,
  ZodBigInt: () => ZodBigInt,
  ZodBigIntFormat: () => ZodBigIntFormat,
  ZodBoolean: () => ZodBoolean,
  ZodCIDRv4: () => ZodCIDRv4,
  ZodCIDRv6: () => ZodCIDRv6,
  ZodCUID: () => ZodCUID,
  ZodCUID2: () => ZodCUID2,
  ZodCatch: () => ZodCatch,
  ZodCodec: () => ZodCodec,
  ZodCreditCard: () => ZodCreditCard,
  ZodCustom: () => ZodCustom,
  ZodCustomStringFormat: () => ZodCustomStringFormat,
  ZodDate: () => ZodDate,
  ZodDefault: () => ZodDefault,
  ZodDiscriminatedUnion: () => ZodDiscriminatedUnion,
  ZodE164: () => ZodE164,
  ZodEmail: () => ZodEmail,
  ZodEmoji: () => ZodEmoji,
  ZodEnum: () => ZodEnum,
  ZodExactOptional: () => ZodExactOptional,
  ZodFile: () => ZodFile,
  ZodFunction: () => ZodFunction,
  ZodGUID: () => ZodGUID,
  ZodIBAN: () => ZodIBAN,
  ZodIPv4: () => ZodIPv4,
  ZodIPv6: () => ZodIPv6,
  ZodISODate: () => ZodISODate,
  ZodISODateTime: () => ZodISODateTime,
  ZodISODuration: () => ZodISODuration,
  ZodISOTime: () => ZodISOTime,
  ZodInstanceOf: () => ZodInstanceOf,
  ZodIntersection: () => ZodIntersection,
  ZodJWT: () => ZodJWT,
  ZodKSUID: () => ZodKSUID,
  ZodLazy: () => ZodLazy,
  ZodLiteral: () => ZodLiteral,
  ZodMAC: () => ZodMAC,
  ZodMap: () => ZodMap,
  ZodNaN: () => ZodNaN,
  ZodNanoID: () => ZodNanoID,
  ZodNever: () => ZodNever,
  ZodNonOptional: () => ZodNonOptional,
  ZodNull: () => ZodNull,
  ZodNullable: () => ZodNullable,
  ZodNumber: () => ZodNumber,
  ZodNumberFormat: () => ZodNumberFormat,
  ZodObject: () => ZodObject,
  ZodOptional: () => ZodOptional,
  ZodPipe: () => ZodPipe,
  ZodPrefault: () => ZodPrefault,
  ZodPreprocess: () => ZodPreprocess,
  ZodPromise: () => ZodPromise,
  ZodReadonly: () => ZodReadonly,
  ZodRecord: () => ZodRecord,
  ZodSet: () => ZodSet,
  ZodString: () => ZodString,
  ZodStringFormat: () => ZodStringFormat,
  ZodSuccess: () => ZodSuccess,
  ZodSymbol: () => ZodSymbol,
  ZodTemplateLiteral: () => ZodTemplateLiteral,
  ZodTransform: () => ZodTransform,
  ZodTuple: () => ZodTuple,
  ZodType: () => ZodType,
  ZodULID: () => ZodULID,
  ZodURL: () => ZodURL,
  ZodUUID: () => ZodUUID,
  ZodUndefined: () => ZodUndefined,
  ZodUnion: () => ZodUnion,
  ZodUnknown: () => ZodUnknown,
  ZodVoid: () => ZodVoid,
  ZodXID: () => ZodXID,
  ZodXor: () => ZodXor,
  _ZodString: () => _ZodString,
  _default: () => _default2,
  _function: () => _function,
  any: () => any,
  array: () => array,
  base64: () => base642,
  base64url: () => base64url2,
  bigint: () => bigint2,
  boolean: () => boolean2,
  catch: () => _catch2,
  check: () => check,
  cidrv4: () => cidrv42,
  cidrv6: () => cidrv62,
  codec: () => codec,
  creditCard: () => creditCard2,
  cuid: () => cuid3,
  cuid2: () => cuid22,
  currencyCode: () => currencyCode2,
  custom: () => custom,
  date: () => date2,
  describe: () => describe2,
  discriminatedUnion: () => discriminatedUnion,
  e164: () => e1642,
  email: () => email2,
  emoji: () => emoji2,
  enum: () => _enum2,
  exactOptional: () => exactOptional,
  file: () => file,
  float32: () => float32,
  float64: () => float64,
  function: () => _function,
  guid: () => guid2,
  hash: () => hash,
  hex: () => hex2,
  hostname: () => hostname2,
  httpUrl: () => httpUrl,
  iban: () => iban2,
  instanceof: () => _instanceof,
  int: () => int,
  int32: () => int32,
  int64: () => int64,
  intersection: () => intersection,
  invertCodec: () => invertCodec,
  ipv4: () => ipv42,
  ipv6: () => ipv62,
  json: () => json,
  jwt: () => jwt,
  keyof: () => keyof,
  ksuid: () => ksuid2,
  lazy: () => lazy,
  literal: () => literal,
  looseObject: () => looseObject,
  looseRecord: () => looseRecord,
  mac: () => mac2,
  map: () => map,
  meta: () => meta2,
  nan: () => nan,
  nanoid: () => nanoid2,
  nativeEnum: () => nativeEnum,
  never: () => never,
  nonoptional: () => nonoptional,
  null: () => _null3,
  nullable: () => nullable,
  nullish: () => nullish2,
  number: () => number2,
  object: () => object,
  optional: () => optional,
  partialRecord: () => partialRecord,
  pipe: () => pipe,
  prefault: () => prefault,
  preprocess: () => preprocess,
  promise: () => promise,
  readonly: () => readonly,
  record: () => record,
  refine: () => refine,
  set: () => set,
  strictObject: () => strictObject,
  string: () => string2,
  stringFormat: () => stringFormat,
  stringbool: () => stringbool,
  success: () => success,
  superRefine: () => superRefine,
  symbol: () => symbol,
  templateLiteral: () => templateLiteral,
  transform: () => transform,
  tuple: () => tuple,
  uint32: () => uint32,
  uint64: () => uint64,
  ulid: () => ulid2,
  undefined: () => _undefined3,
  union: () => union,
  unknown: () => unknown,
  url: () => url,
  uuid: () => uuid2,
  uuidv4: () => uuidv4,
  uuidv6: () => uuidv6,
  uuidv7: () => uuidv7,
  void: () => _void2,
  xid: () => xid2,
  xor: () => xor
});
function _ensureDefaultLocale() {
  if (!globalConfig.localeError)
    config(en_default());
}
function _ensureDefaultMemoizer() {
  if (!globalConfig.memoizer)
    config({ memoizer: memoizer() });
}
function string2(params) {
  return _string(ZodString, params);
}
function email2(params) {
  return _email(ZodEmail, params);
}
function guid2(params) {
  return _guid(ZodGUID, params);
}
function uuid2(params) {
  return _uuid(ZodUUID, params);
}
function uuidv4(params) {
  return _uuidv4(ZodUUID, params);
}
function uuidv6(params) {
  return _uuidv6(ZodUUID, params);
}
function uuidv7(params) {
  return _uuidv7(ZodUUID, params);
}
function url(params) {
  return _url(ZodURL, params);
}
function httpUrl(params) {
  return _url(ZodURL, {
    protocol: httpProtocol,
    hostname: domain,
    ...util_exports.normalizeParams(params)
  });
}
function emoji2(params) {
  return _emoji2(ZodEmoji, params);
}
function nanoid2(params) {
  return _nanoid(ZodNanoID, params);
}
function cuid3(params) {
  return _cuid(ZodCUID, params);
}
function cuid22(params) {
  return _cuid2(ZodCUID2, params);
}
function ulid2(params) {
  return _ulid(ZodULID, params);
}
function xid2(params) {
  return _xid(ZodXID, params);
}
function ksuid2(params) {
  return _ksuid(ZodKSUID, params);
}
function ipv42(params) {
  return _ipv4(ZodIPv4, params);
}
function mac2(params) {
  return _mac(ZodMAC, params);
}
function ipv62(params) {
  return _ipv6(ZodIPv6, params);
}
function cidrv42(params) {
  return _cidrv4(ZodCIDRv4, params);
}
function cidrv62(params) {
  return _cidrv6(ZodCIDRv6, params);
}
function base642(params) {
  return _base64(ZodBase64, params);
}
function base64url2(params) {
  return _base64url(ZodBase64URL, params);
}
function e1642(params) {
  return _e164(ZodE164, params);
}
function creditCard2(params) {
  return _creditCard(ZodCreditCard, params);
}
function iban2(params) {
  return _iban(ZodIBAN, params);
}
function jwt(params) {
  return _jwt(ZodJWT, params);
}
function stringFormat(format, fnOrRegex, _params = {}) {
  return _stringFormat(ZodCustomStringFormat, format, fnOrRegex, _params);
}
function hostname2(_params) {
  return _stringFormat(ZodCustomStringFormat, "hostname", hostname, _params);
}
function hex2(_params) {
  return _stringFormat(ZodCustomStringFormat, "hex", hex, _params);
}
function currencyCode2(_params) {
  return _stringFormat(ZodCustomStringFormat, "currency_code", currencyCode, _params);
}
function hash(alg, params) {
  const enc = params?.enc ?? "hex";
  const format = `${alg}_${enc}`;
  const regex = regexes_exports[format];
  if (!regex)
    throw new Error(`Unrecognized hash format: ${format}`);
  return _stringFormat(ZodCustomStringFormat, format, regex, params);
}
function number2(params) {
  return _number(ZodNumber, params);
}
function int(params) {
  return _int(ZodNumberFormat, params);
}
function float32(params) {
  return _float32(ZodNumberFormat, params);
}
function float64(params) {
  return _float64(ZodNumberFormat, params);
}
function int32(params) {
  return _int32(ZodNumberFormat, params);
}
function uint32(params) {
  return _uint32(ZodNumberFormat, params);
}
function boolean2(params) {
  return _boolean(ZodBoolean, params);
}
function bigint2(params) {
  return _bigint(ZodBigInt, params);
}
function int64(params) {
  return _int64(ZodBigIntFormat, params);
}
function uint64(params) {
  return _uint64(ZodBigIntFormat, params);
}
function symbol(params) {
  return _symbol(ZodSymbol, params);
}
function _undefined3(params) {
  return _undefined2(ZodUndefined, params);
}
function _null3(params) {
  return _null2(ZodNull, params);
}
function any() {
  return _any(ZodAny);
}
function unknown() {
  return _unknown(ZodUnknown);
}
function never(params) {
  return _never(ZodNever, params);
}
function _void2(params) {
  return _void(ZodVoid, params);
}
function date2(params) {
  return _date(ZodDate, params);
}
function array(element, params) {
  return _array(ZodArray, element, params);
}
function keyof(schema) {
  const shape = schema._zod.def.shape;
  return _enum2(Object.keys(shape));
}
function object(shape, params) {
  const def = {
    type: "object",
    shape: shape ?? {},
    ...util_exports.normalizeParams(params)
  };
  return new ZodObject(def);
}
function strictObject(shape, params) {
  return new ZodObject({
    type: "object",
    shape,
    catchall: never(),
    ...util_exports.normalizeParams(params)
  });
}
function looseObject(shape, params) {
  return new ZodObject({
    type: "object",
    shape,
    catchall: unknown(),
    ...util_exports.normalizeParams(params)
  });
}
function union(options, params) {
  return new ZodUnion({
    type: "union",
    options,
    ...util_exports.normalizeParams(params)
  });
}
function xor(options, params) {
  return new ZodXor({
    type: "union",
    options,
    inclusive: false,
    ...util_exports.normalizeParams(params)
  });
}
function discriminatedUnion(discriminator, options, params) {
  return new ZodDiscriminatedUnion({
    type: "union",
    options,
    discriminator,
    ...util_exports.normalizeParams(params)
  });
}
function intersection(left, right) {
  return new ZodIntersection({
    type: "intersection",
    left,
    right
  });
}
function tuple(items, _paramsOrRest, _params) {
  const hasRest = _paramsOrRest instanceof $ZodType;
  const params = hasRest ? _params : _paramsOrRest;
  const rest = hasRest ? _paramsOrRest : null;
  return new ZodTuple({
    type: "tuple",
    items,
    rest,
    ...util_exports.normalizeParams(params)
  });
}
function record(keyType, valueType, params) {
  if (!valueType || !valueType._zod) {
    return new ZodRecord({
      type: "record",
      keyType: string2(),
      valueType: keyType,
      ...util_exports.normalizeParams(valueType)
    });
  }
  return new ZodRecord({
    type: "record",
    keyType,
    valueType,
    ...util_exports.normalizeParams(params)
  });
}
function partialRecord(keyType, valueType, params) {
  return new ZodRecord({
    type: "record",
    keyType,
    valueType,
    ...util_exports.normalizeParams(params),
    partial: true
  });
}
function looseRecord(keyType, valueType, params) {
  return new ZodRecord({
    type: "record",
    keyType,
    valueType,
    mode: "loose",
    ...util_exports.normalizeParams(params)
  });
}
function map(keyType, valueType, params) {
  return new ZodMap({
    type: "map",
    keyType,
    valueType,
    ...util_exports.normalizeParams(params)
  });
}
function set(valueType, params) {
  return new ZodSet({
    type: "set",
    valueType,
    ...util_exports.normalizeParams(params)
  });
}
function _enum2(values, params) {
  const entries = Array.isArray(values) ? Object.fromEntries(values.map((v) => [v, v])) : values;
  return new ZodEnum({
    type: "enum",
    entries,
    ...util_exports.normalizeParams(params)
  });
}
function nativeEnum(entries, params) {
  return new ZodEnum({
    type: "enum",
    entries,
    ...util_exports.normalizeParams(params)
  });
}
function literal(value, params) {
  return new ZodLiteral({
    type: "literal",
    values: Array.isArray(value) ? value : [value],
    ...util_exports.normalizeParams(params)
  });
}
function file(params) {
  return _file(ZodFile, params);
}
function transform(fn) {
  return new ZodTransform({
    type: "transform",
    transform: fn
  });
}
function optional(innerType) {
  return new ZodOptional({
    type: "optional",
    innerType
  });
}
function exactOptional(innerType) {
  return new ZodExactOptional({
    type: "optional",
    innerType
  });
}
function nullable(innerType) {
  return new ZodNullable({
    type: "nullable",
    innerType
  });
}
function nullish2(innerType) {
  return optional(nullable(innerType));
}
function _default2(innerType, defaultValue) {
  return new ZodDefault({
    type: "default",
    innerType,
    get defaultValue() {
      return typeof defaultValue === "function" ? defaultValue() : util_exports.shallowClone(defaultValue);
    }
  });
}
function prefault(innerType, defaultValue) {
  return new ZodPrefault({
    type: "prefault",
    innerType,
    get defaultValue() {
      return typeof defaultValue === "function" ? defaultValue() : util_exports.shallowClone(defaultValue);
    }
  });
}
function nonoptional(innerType, params) {
  return new ZodNonOptional({
    type: "nonoptional",
    innerType,
    ...util_exports.normalizeParams(params)
  });
}
function success(innerType) {
  return new ZodSuccess({
    type: "success",
    innerType
  });
}
function _catch2(innerType, catchValue) {
  return new ZodCatch({
    type: "catch",
    innerType,
    catchValue: typeof catchValue === "function" ? catchValue : util_exports.constantCatch(catchValue)
  });
}
function nan(params) {
  return _nan(ZodNaN, params);
}
function pipe(in_, out) {
  return new ZodPipe({
    type: "pipe",
    in: in_,
    out
    // ...util.normalizeParams(params),
  });
}
function codec(in_, out, params) {
  return new ZodCodec({
    type: "pipe",
    in: in_,
    out,
    transform: params.decode,
    reverseTransform: params.encode
  });
}
function invertCodec(codec2) {
  const def = codec2._zod.def;
  return new ZodCodec({
    type: "pipe",
    in: def.out,
    out: def.in,
    transform: def.reverseTransform,
    reverseTransform: def.transform
  });
}
function readonly(innerType) {
  return new ZodReadonly({
    type: "readonly",
    innerType
  });
}
function templateLiteral(parts, params) {
  return new ZodTemplateLiteral({
    type: "template_literal",
    parts,
    ...util_exports.normalizeParams(params)
  });
}
function lazy(getter) {
  return new ZodLazy({
    type: "lazy",
    getter
  });
}
function promise(innerType) {
  return new ZodPromise({
    type: "promise",
    innerType
  });
}
function _function(params) {
  return new ZodFunction({
    type: "function",
    input: Array.isArray(params?.input) ? tuple(params?.input) : params?.input ?? array(unknown()),
    output: params?.output ?? unknown()
  });
}
function check(fn) {
  const ch = new $ZodCheck({
    check: "custom"
    // ...util.normalizeParams(params),
  });
  ch._zod.check = fn;
  return ch;
}
function custom(fn, _params) {
  return _custom(ZodCustom, fn ?? (() => true), _params);
}
function refine(fn, _params = {}) {
  return _refine(ZodCustom, fn, _params);
}
function superRefine(fn, params) {
  return _superRefine(fn, params);
}
function _instanceof(cls, params = {}) {
  const inst = new ZodInstanceOf({
    type: "custom",
    check: "custom",
    fn: (data) => data instanceof cls,
    abort: true,
    ...util_exports.normalizeParams(params)
  });
  inst._zod.bag.Class = cls;
  inst._zod.check = (payload) => {
    if (!(payload.value instanceof cls)) {
      payload.issues.push({
        code: "invalid_type",
        expected: cls.name,
        input: payload.value,
        inst,
        path: [...inst._zod.def.path ?? []]
      });
    }
  };
  return inst;
}
function json(params) {
  const jsonSchema = lazy(() => {
    return union([string2(params), number2(), boolean2(), _null3(), array(jsonSchema), record(string2(), jsonSchema)]);
  });
  return jsonSchema;
}
function preprocess(fn, schema) {
  return new ZodPreprocess({
    type: "pipe",
    in: transform(fn),
    out: schema
  });
}
var ZodType, _ZodString, ZodString, ZodStringFormat, ZodISODateTime, ZodISODate, ZodISOTime, ZodISODuration, ZodEmail, ZodGUID, ZodUUID, ZodURL, ZodEmoji, ZodNanoID, ZodCUID, ZodCUID2, ZodULID, ZodXID, ZodKSUID, ZodIPv4, ZodMAC, ZodIPv6, ZodCIDRv4, ZodCIDRv6, ZodBase64, ZodBase64URL, ZodE164, ZodCreditCard, ZodIBAN, ZodJWT, ZodCustomStringFormat, ZodNumber, ZodNumberFormat, ZodBoolean, ZodBigInt, ZodBigIntFormat, ZodSymbol, ZodUndefined, ZodNull, ZodAny, ZodUnknown, ZodNever, ZodVoid, ZodDate, ZodArray, ZodObject, ZodUnion, ZodXor, ZodDiscriminatedUnion, ZodIntersection, ZodTuple, ZodRecord, ZodMap, ZodSet, ZodEnum, ZodLiteral, ZodFile, ZodTransform, ZodOptional, ZodExactOptional, ZodNullable, ZodDefault, ZodPrefault, ZodNonOptional, ZodSuccess, ZodCatch, ZodNaN, ZodPipe, ZodCodec, ZodPreprocess, ZodReadonly, ZodTemplateLiteral, ZodLazy, ZodPromise, ZodFunction, ZodCustom, describe2, meta2, ZodInstanceOf, stringbool;
var init_schemas2 = __esm({
  "node_modules/zod/v4/classic/schemas.js"() {
    init_core2();
    init_core2();
    init_json_schema_processors();
    init_regexes();
    init_to_json_schema();
    init_en();
    init_checks2();
    init_parse2();
    ZodType = /* @__PURE__ */ $constructor("ZodType", (inst, def) => {
      _ensureDefaultLocale();
      $ZodType.init(inst, def);
      inst.def = def;
      inst.type = def.type;
      return inst;
    }, {
      check(...chks) {
        const def = this.def;
        return this.clone(util_exports.mergeDefs(def, {
          checks: [
            ...def.checks ?? [],
            ...chks.map((ch) => typeof ch === "function" ? { _zod: { check: ch, def: { check: "custom" }, onattach: [] } } : ch)
          ]
        }), { parent: true });
      },
      with(...chks) {
        return this.check(...chks);
      },
      clone(def, params) {
        return clone(this, def, params);
      },
      brand() {
        return this;
      },
      register(reg, meta3) {
        reg.add(this, meta3);
        return this;
      },
      refine(check2, params) {
        return this.check(refine(check2, params));
      },
      superRefine(refinement, params) {
        return this.check(superRefine(refinement, params));
      },
      overwrite(fn) {
        return this.check(_overwrite(fn));
      },
      optional() {
        return optional(this);
      },
      exactOptional() {
        return exactOptional(this);
      },
      nullable() {
        return nullable(this);
      },
      nullish() {
        return optional(nullable(this));
      },
      nonoptional(params) {
        return nonoptional(this, params);
      },
      array() {
        return array(this);
      },
      or(arg) {
        return union([this, arg]);
      },
      and(arg) {
        return intersection(this, arg);
      },
      transform(tx) {
        return pipe(this, transform(tx));
      },
      default(d) {
        return _default2(this, d);
      },
      prefault(d) {
        return prefault(this, d);
      },
      catch(params) {
        return _catch2(this, params);
      },
      pipe(target) {
        return pipe(this, target);
      },
      readonly() {
        return readonly(this);
      },
      describe(description) {
        const cl = this.clone();
        globalRegistry.add(cl, { description });
        return cl;
      },
      meta(...args) {
        if (args.length === 0)
          return globalRegistry.get(this);
        const cl = this.clone();
        globalRegistry.add(cl, args[0]);
        return cl;
      },
      isOptional() {
        return this.safeParse(void 0).success;
      },
      isNullable() {
        return this.safeParse(null).success;
      },
      apply(fn, ...args) {
        return args.length === 0 ? fn(this) : fn(this, ...args);
      },
      // Overrides core's `~standard` to add `jsonSchema`. Must stay a prototype entry: redefining it per instance demotes instances to dictionary mode.
      get "~standard"() {
        return util_exports.hide(this, "~standard", {
          ...standardProps(this),
          jsonSchema: {
            input: createStandardJSONSchemaMethod(this, "input"),
            output: createStandardJSONSchemaMethod(this, "output")
          }
        });
      },
      set "~standard"(value) {
        util_exports.own(this, "~standard", value);
      },
      parse: function _parse2(data, params) {
        return parse2(this, data, params, { callee: _parse2 });
      },
      parseAsync: async function _parseAsync2(data, params) {
        return await parseAsync2(this, data, params, { callee: _parseAsync2 });
      },
      safeParse(data, params) {
        return safeParse2(this, data, params);
      },
      async safeParseAsync(data, params) {
        return safeParseAsync2(this, data, params);
      },
      // `spa` is an alias: same function object as `safeParseAsync`, as before.
      get spa() {
        return this?.safeParseAsync;
      },
      set spa(value) {
        util_exports.own(this, "spa", value);
      },
      validate(data, params) {
        return validate(this, data, params);
      },
      validateAsync(data, params) {
        return validateAsync(this, data, params);
      },
      encode: function _encode2(data, params) {
        return encode2(this, data, params, { callee: _encode2 });
      },
      decode: function _decode2(data, params) {
        return decode2(this, data, params, { callee: _decode2 });
      },
      encodeAsync: async function _encodeAsync2(data, params) {
        return await encodeAsync2(this, data, params, { callee: _encodeAsync2 });
      },
      decodeAsync: async function _decodeAsync2(data, params) {
        return await decodeAsync2(this, data, params, { callee: _decodeAsync2 });
      },
      safeEncode(data, params) {
        return safeEncode2(this, data, params);
      },
      safeDecode(data, params) {
        return safeDecode2(this, data, params);
      },
      async safeEncodeAsync(data, params) {
        return safeEncodeAsync2(this, data, params);
      },
      async safeDecodeAsync(data, params) {
        return safeDecodeAsync2(this, data, params);
      },
      toJSONSchema(params) {
        return createToJSONSchemaMethod(this, {})(params);
      },
      // Reads through to the registry on every access, so it must not cache.
      get description() {
        return globalRegistry.get(this)?.description;
      },
      // No setter: `schema._def = x` throws, as it did when `_def` was a non-writable own property.
      get _def() {
        return this._zod.def;
      }
    });
    _ZodString = /* @__PURE__ */ $constructor(
      "_ZodString",
      (inst, def) => {
        $ZodString.init(inst, def);
        ZodType.init(inst, def);
        inst._zod.processJSONSchema = (ctx, json2, params) => stringProcessor(inst, ctx, json2, params);
      },
      /* @__PURE__ */ util_exports.derived({
        format: (inst) => aggregateChecks(inst).format ?? null,
        minLength: (inst) => aggregateChecks(inst).minimum ?? null,
        maxLength: (inst) => aggregateChecks(inst).maximum ?? null
      }, {
        regex(...args) {
          return this.check(_regex(...args));
        },
        includes(...args) {
          return this.check(_includes(...args));
        },
        startsWith(...args) {
          return this.check(_startsWith(...args));
        },
        endsWith(...args) {
          return this.check(_endsWith(...args));
        },
        min(...args) {
          return this.check(_minLength(...args));
        },
        max(...args) {
          return this.check(_maxLength(...args));
        },
        length(...args) {
          return this.check(_length(...args));
        },
        nonempty(...args) {
          return this.check(_minLength(1, ...args));
        },
        lowercase(params) {
          return this.check(_lowercase(params));
        },
        uppercase(params) {
          return this.check(_uppercase(params));
        },
        trim() {
          return this.check(_trim());
        },
        normalize(...args) {
          return this.check(_normalize(...args));
        },
        toLowerCase() {
          return this.check(_toLowerCase());
        },
        toUpperCase() {
          return this.check(_toUpperCase());
        },
        slugify() {
          return this.check(_slugify());
        }
      })
    );
    ZodString = /* @__PURE__ */ $constructor("ZodString", (inst, def) => {
      $ZodString.init(inst, def);
      _ZodString.init(inst, def);
    }, {
      email(params) {
        return this.check(_email(ZodEmail, params));
      },
      url(params) {
        return this.check(_url(ZodURL, params));
      },
      jwt(params) {
        return this.check(_jwt(ZodJWT, params));
      },
      emoji(params) {
        return this.check(_emoji2(ZodEmoji, params));
      },
      guid(params) {
        return this.check(_guid(ZodGUID, params));
      },
      uuid(params) {
        return this.check(_uuid(ZodUUID, params));
      },
      uuidv4(params) {
        return this.check(_uuidv4(ZodUUID, params));
      },
      uuidv6(params) {
        return this.check(_uuidv6(ZodUUID, params));
      },
      uuidv7(params) {
        return this.check(_uuidv7(ZodUUID, params));
      },
      nanoid(params) {
        return this.check(_nanoid(ZodNanoID, params));
      },
      cuid(params) {
        return this.check(_cuid(ZodCUID, params));
      },
      cuid2(params) {
        return this.check(_cuid2(ZodCUID2, params));
      },
      ulid(params) {
        return this.check(_ulid(ZodULID, params));
      },
      base64(params) {
        return this.check(_base64(ZodBase64, params));
      },
      base64url(params) {
        return this.check(_base64url(ZodBase64URL, params));
      },
      xid(params) {
        return this.check(_xid(ZodXID, params));
      },
      ksuid(params) {
        return this.check(_ksuid(ZodKSUID, params));
      },
      ipv4(params) {
        return this.check(_ipv4(ZodIPv4, params));
      },
      ipv6(params) {
        return this.check(_ipv6(ZodIPv6, params));
      },
      cidrv4(params) {
        return this.check(_cidrv4(ZodCIDRv4, params));
      },
      cidrv6(params) {
        return this.check(_cidrv6(ZodCIDRv6, params));
      },
      e164(params) {
        return this.check(_e164(ZodE164, params));
      },
      datetime(params) {
        return this.check(_isoDateTime(ZodISODateTime, params));
      },
      date(params) {
        return this.check(_isoDate(ZodISODate, params));
      },
      time(params) {
        return this.check(_isoTime(ZodISOTime, params));
      },
      duration(params) {
        return this.check(_isoDuration(ZodISODuration, params));
      }
    });
    ZodStringFormat = /* @__PURE__ */ $constructor("ZodStringFormat", (inst, def) => {
      $ZodStringFormat.init(inst, def);
      _ZodString.init(inst, def);
    });
    ZodISODateTime = /* @__PURE__ */ $constructor("ZodISODateTime", (inst, def) => {
      $ZodISODateTime.init(inst, def);
      ZodStringFormat.init(inst, def);
    });
    ZodISODate = /* @__PURE__ */ $constructor("ZodISODate", (inst, def) => {
      $ZodISODate.init(inst, def);
      ZodStringFormat.init(inst, def);
    });
    ZodISOTime = /* @__PURE__ */ $constructor("ZodISOTime", (inst, def) => {
      $ZodISOTime.init(inst, def);
      ZodStringFormat.init(inst, def);
    });
    ZodISODuration = /* @__PURE__ */ $constructor("ZodISODuration", (inst, def) => {
      $ZodISODuration.init(inst, def);
      ZodStringFormat.init(inst, def);
    });
    ZodEmail = /* @__PURE__ */ $constructor("ZodEmail", (inst, def) => {
      $ZodEmail.init(inst, def);
      ZodStringFormat.init(inst, def);
    });
    ZodGUID = /* @__PURE__ */ $constructor("ZodGUID", (inst, def) => {
      $ZodGUID.init(inst, def);
      ZodStringFormat.init(inst, def);
    });
    ZodUUID = /* @__PURE__ */ $constructor("ZodUUID", (inst, def) => {
      $ZodUUID.init(inst, def);
      ZodStringFormat.init(inst, def);
    });
    ZodURL = /* @__PURE__ */ $constructor("ZodURL", (inst, def) => {
      $ZodURL.init(inst, def);
      ZodStringFormat.init(inst, def);
    });
    ZodEmoji = /* @__PURE__ */ $constructor("ZodEmoji", (inst, def) => {
      $ZodEmoji.init(inst, def);
      ZodStringFormat.init(inst, def);
    });
    ZodNanoID = /* @__PURE__ */ $constructor("ZodNanoID", (inst, def) => {
      $ZodNanoID.init(inst, def);
      ZodStringFormat.init(inst, def);
    });
    ZodCUID = /* @__PURE__ */ $constructor("ZodCUID", (inst, def) => {
      $ZodCUID.init(inst, def);
      ZodStringFormat.init(inst, def);
    });
    ZodCUID2 = /* @__PURE__ */ $constructor("ZodCUID2", (inst, def) => {
      $ZodCUID2.init(inst, def);
      ZodStringFormat.init(inst, def);
    });
    ZodULID = /* @__PURE__ */ $constructor("ZodULID", (inst, def) => {
      $ZodULID.init(inst, def);
      ZodStringFormat.init(inst, def);
    });
    ZodXID = /* @__PURE__ */ $constructor("ZodXID", (inst, def) => {
      $ZodXID.init(inst, def);
      ZodStringFormat.init(inst, def);
    });
    ZodKSUID = /* @__PURE__ */ $constructor("ZodKSUID", (inst, def) => {
      $ZodKSUID.init(inst, def);
      ZodStringFormat.init(inst, def);
    });
    ZodIPv4 = /* @__PURE__ */ $constructor("ZodIPv4", (inst, def) => {
      $ZodIPv4.init(inst, def);
      ZodStringFormat.init(inst, def);
    });
    ZodMAC = /* @__PURE__ */ $constructor("ZodMAC", (inst, def) => {
      $ZodMAC.init(inst, def);
      ZodStringFormat.init(inst, def);
    });
    ZodIPv6 = /* @__PURE__ */ $constructor("ZodIPv6", (inst, def) => {
      $ZodIPv6.init(inst, def);
      ZodStringFormat.init(inst, def);
    });
    ZodCIDRv4 = /* @__PURE__ */ $constructor("ZodCIDRv4", (inst, def) => {
      $ZodCIDRv4.init(inst, def);
      ZodStringFormat.init(inst, def);
    });
    ZodCIDRv6 = /* @__PURE__ */ $constructor("ZodCIDRv6", (inst, def) => {
      $ZodCIDRv6.init(inst, def);
      ZodStringFormat.init(inst, def);
    });
    ZodBase64 = /* @__PURE__ */ $constructor("ZodBase64", (inst, def) => {
      $ZodBase64.init(inst, def);
      ZodStringFormat.init(inst, def);
    });
    ZodBase64URL = /* @__PURE__ */ $constructor("ZodBase64URL", (inst, def) => {
      $ZodBase64URL.init(inst, def);
      ZodStringFormat.init(inst, def);
    });
    ZodE164 = /* @__PURE__ */ $constructor("ZodE164", (inst, def) => {
      $ZodE164.init(inst, def);
      ZodStringFormat.init(inst, def);
    });
    ZodCreditCard = /* @__PURE__ */ $constructor("ZodCreditCard", (inst, def) => {
      $ZodCreditCard.init(inst, def);
      ZodStringFormat.init(inst, def);
    });
    ZodIBAN = /* @__PURE__ */ $constructor("ZodIBAN", (inst, def) => {
      $ZodIBAN.init(inst, def);
      ZodStringFormat.init(inst, def);
    });
    ZodJWT = /* @__PURE__ */ $constructor("ZodJWT", (inst, def) => {
      $ZodJWT.init(inst, def);
      ZodStringFormat.init(inst, def);
    });
    ZodCustomStringFormat = /* @__PURE__ */ $constructor("ZodCustomStringFormat", (inst, def) => {
      $ZodCustomStringFormat.init(inst, def);
      ZodStringFormat.init(inst, def);
    });
    ZodNumber = /* @__PURE__ */ $constructor(
      "ZodNumber",
      (inst, def) => {
        $ZodNumber.init(inst, def);
        ZodType.init(inst, def);
        inst._zod.processJSONSchema = (ctx, json2, params) => numberProcessor(inst, ctx, json2, params);
        inst.isFinite = true;
      },
      /* @__PURE__ */ util_exports.derived({
        minValue: (inst) => {
          const { minimum, exclusiveMinimum } = aggregateChecks(inst);
          return Math.max(minimum ?? Number.NEGATIVE_INFINITY, exclusiveMinimum ?? Number.NEGATIVE_INFINITY);
        },
        maxValue: (inst) => {
          const { maximum, exclusiveMaximum } = aggregateChecks(inst);
          return Math.min(maximum ?? Number.POSITIVE_INFINITY, exclusiveMaximum ?? Number.POSITIVE_INFINITY);
        },
        isInt: (inst) => {
          const { isInt, multipleOf } = aggregateChecks(inst);
          return !!isInt || !!multipleOf?.some(Number.isSafeInteger);
        },
        format: (inst) => aggregateChecks(inst).format ?? null
      }, {
        gt(value, params) {
          return this.check(_gt(value, params));
        },
        gte(value, params) {
          return this.check(_gte(value, params));
        },
        min(value, params) {
          return this.check(_gte(value, params));
        },
        lt(value, params) {
          return this.check(_lt(value, params));
        },
        lte(value, params) {
          return this.check(_lte(value, params));
        },
        max(value, params) {
          return this.check(_lte(value, params));
        },
        int(params) {
          return this.check(int(params));
        },
        safe(params) {
          return this.check(int(params));
        },
        positive(params) {
          return this.check(_gt(0, params));
        },
        nonnegative(params) {
          return this.check(_gte(0, params));
        },
        negative(params) {
          return this.check(_lt(0, params));
        },
        nonpositive(params) {
          return this.check(_lte(0, params));
        },
        multipleOf(value, params) {
          return this.check(_multipleOf(value, params));
        },
        step(value, params) {
          return this.check(_multipleOf(value, params));
        },
        finite() {
          return this;
        }
      })
    );
    ZodNumberFormat = /* @__PURE__ */ $constructor("ZodNumberFormat", (inst, def) => {
      $ZodNumberFormat.init(inst, def);
      ZodNumber.init(inst, def);
    });
    ZodBoolean = /* @__PURE__ */ $constructor("ZodBoolean", (inst, def) => {
      $ZodBoolean.init(inst, def);
      ZodType.init(inst, def);
      inst._zod.processJSONSchema = (ctx, json2, params) => booleanProcessor(inst, ctx, json2, params);
    });
    ZodBigInt = /* @__PURE__ */ $constructor(
      "ZodBigInt",
      (inst, def) => {
        $ZodBigInt.init(inst, def);
        ZodType.init(inst, def);
        inst._zod.processJSONSchema = (ctx, json2, params) => bigintProcessor(inst, ctx, json2, params);
      },
      /* @__PURE__ */ util_exports.derived({
        minValue: (inst) => aggregateChecks(inst).minimum ?? null,
        maxValue: (inst) => aggregateChecks(inst).maximum ?? null,
        format: (inst) => aggregateChecks(inst).format ?? null
      }, {
        gte(value, params) {
          return this.check(_gte(value, params));
        },
        min(value, params) {
          return this.check(_gte(value, params));
        },
        gt(value, params) {
          return this.check(_gt(value, params));
        },
        lt(value, params) {
          return this.check(_lt(value, params));
        },
        lte(value, params) {
          return this.check(_lte(value, params));
        },
        max(value, params) {
          return this.check(_lte(value, params));
        },
        positive(params) {
          return this.check(_gt(BigInt(0), params));
        },
        negative(params) {
          return this.check(_lt(BigInt(0), params));
        },
        nonpositive(params) {
          return this.check(_lte(BigInt(0), params));
        },
        nonnegative(params) {
          return this.check(_gte(BigInt(0), params));
        },
        multipleOf(value, params) {
          return this.check(_multipleOf(value, params));
        }
      })
    );
    ZodBigIntFormat = /* @__PURE__ */ $constructor("ZodBigIntFormat", (inst, def) => {
      $ZodBigIntFormat.init(inst, def);
      ZodBigInt.init(inst, def);
    });
    ZodSymbol = /* @__PURE__ */ $constructor("ZodSymbol", (inst, def) => {
      $ZodSymbol.init(inst, def);
      ZodType.init(inst, def);
      inst._zod.processJSONSchema = (ctx, json2, params) => symbolProcessor(inst, ctx, json2, params);
    });
    ZodUndefined = /* @__PURE__ */ $constructor("ZodUndefined", (inst, def) => {
      $ZodUndefined.init(inst, def);
      ZodType.init(inst, def);
      inst._zod.processJSONSchema = (ctx, json2, params) => undefinedProcessor(inst, ctx, json2, params);
    });
    ZodNull = /* @__PURE__ */ $constructor("ZodNull", (inst, def) => {
      $ZodNull.init(inst, def);
      ZodType.init(inst, def);
      inst._zod.processJSONSchema = (ctx, json2, params) => nullProcessor(inst, ctx, json2, params);
    });
    ZodAny = /* @__PURE__ */ $constructor("ZodAny", (inst, def) => {
      $ZodAny.init(inst, def);
      ZodType.init(inst, def);
      inst._zod.processJSONSchema = (ctx, json2, params) => anyProcessor(inst, ctx, json2, params);
    });
    ZodUnknown = /* @__PURE__ */ $constructor("ZodUnknown", (inst, def) => {
      $ZodUnknown.init(inst, def);
      ZodType.init(inst, def);
      inst._zod.processJSONSchema = (ctx, json2, params) => unknownProcessor(inst, ctx, json2, params);
    });
    ZodNever = /* @__PURE__ */ $constructor("ZodNever", (inst, def) => {
      $ZodNever.init(inst, def);
      ZodType.init(inst, def);
      inst._zod.processJSONSchema = (ctx, json2, params) => neverProcessor(inst, ctx, json2, params);
    });
    ZodVoid = /* @__PURE__ */ $constructor("ZodVoid", (inst, def) => {
      $ZodVoid.init(inst, def);
      ZodType.init(inst, def);
      inst._zod.processJSONSchema = (ctx, json2, params) => voidProcessor(inst, ctx, json2, params);
    });
    ZodDate = /* @__PURE__ */ $constructor(
      "ZodDate",
      (inst, def) => {
        $ZodDate.init(inst, def);
        ZodType.init(inst, def);
        inst._zod.processJSONSchema = (ctx, json2, params) => dateProcessor(inst, ctx, json2, params);
        inst.min = (value, params) => inst.check(_gte(value, params));
        inst.max = (value, params) => inst.check(_lte(value, params));
      },
      /* @__PURE__ */ util_exports.derived({
        minDate: (inst) => {
          const { minimum } = aggregateChecks(inst);
          return minimum ? new Date(minimum) : null;
        },
        maxDate: (inst) => {
          const { maximum } = aggregateChecks(inst);
          return maximum ? new Date(maximum) : null;
        }
      }, {})
    );
    ZodArray = /* @__PURE__ */ $constructor("ZodArray", (inst, def) => {
      _ensureDefaultMemoizer();
      $ZodArray.init(inst, def);
      ZodType.init(inst, def);
      inst._zod.processJSONSchema = (ctx, json2, params) => arrayProcessor(inst, ctx, json2, params);
      inst.element = def.element;
    }, {
      min(n, params) {
        return this.check(_minLength(n, params));
      },
      nonempty(params) {
        return this.check(_minLength(1, params));
      },
      max(n, params) {
        return this.check(_maxLength(n, params));
      },
      length(n, params) {
        return this.check(_length(n, params));
      },
      unwrap() {
        return this.element;
      }
    });
    ZodObject = /* @__PURE__ */ $constructor("ZodObject", (inst, def) => {
      _ensureDefaultMemoizer();
      $ZodObjectJIT.init(inst, def);
      ZodType.init(inst, def);
      inst._zod.processJSONSchema = (ctx, json2, params) => objectProcessor(inst, ctx, json2, params);
      util_exports.installLazyProp(inst, "shape", (self) => self._zod.def.shape, false);
    }, {
      keyof() {
        return _enum2(Object.keys(this._zod.def.shape));
      },
      catchall(catchall) {
        return this.clone(util_exports.mergeDefs(this._zod.def, { catchall }));
      },
      passthrough() {
        return this.clone(util_exports.mergeDefs(this._zod.def, { catchall: unknown() }));
      },
      loose() {
        return this.clone(util_exports.mergeDefs(this._zod.def, { catchall: unknown() }));
      },
      strict() {
        return this.clone(util_exports.mergeDefs(this._zod.def, { catchall: never() }));
      },
      strip() {
        return this.clone(util_exports.mergeDefs(this._zod.def, { catchall: void 0 }));
      },
      extend(incoming) {
        return util_exports.extend(this, incoming);
      },
      safeExtend(incoming) {
        return util_exports.safeExtend(this, incoming);
      },
      merge(other) {
        return util_exports.merge(this, other);
      },
      pick(mask) {
        return util_exports.pick(this, mask);
      },
      omit(mask) {
        return util_exports.omit(this, mask);
      },
      partial(...args) {
        return util_exports.partial(ZodOptional, this, args[0]);
      },
      exactPartial(...args) {
        return util_exports.partial(ZodExactOptional, this, args[0], "exactPartial");
      },
      required(...args) {
        return util_exports.required(ZodNonOptional, this, args[0]);
      }
    });
    ZodUnion = /* @__PURE__ */ $constructor("ZodUnion", (inst, def) => {
      $ZodUnion.init(inst, def);
      ZodType.init(inst, def);
      inst._zod.processJSONSchema = (ctx, json2, params) => unionProcessor(inst, ctx, json2, params);
      inst.options = def.options;
    });
    ZodXor = /* @__PURE__ */ $constructor("ZodXor", (inst, def) => {
      ZodUnion.init(inst, def);
      $ZodXor.init(inst, def);
      inst._zod.processJSONSchema = (ctx, json2, params) => unionProcessor(inst, ctx, json2, params);
      inst.options = def.options;
    });
    ZodDiscriminatedUnion = /* @__PURE__ */ $constructor("ZodDiscriminatedUnion", (inst, def) => {
      ZodUnion.init(inst, def);
      $ZodDiscriminatedUnion.init(inst, def);
    });
    ZodIntersection = /* @__PURE__ */ $constructor("ZodIntersection", (inst, def) => {
      $ZodIntersection.init(inst, def);
      ZodType.init(inst, def);
      inst._zod.processJSONSchema = (ctx, json2, params) => intersectionProcessor(inst, ctx, json2, params);
    });
    ZodTuple = /* @__PURE__ */ $constructor("ZodTuple", (inst, def) => {
      _ensureDefaultMemoizer();
      $ZodTuple.init(inst, def);
      ZodType.init(inst, def);
      inst._zod.processJSONSchema = (ctx, json2, params) => tupleProcessor(inst, ctx, json2, params);
    }, {
      rest(rest) {
        return this.clone({
          ...this._zod.def,
          rest
        });
      },
      partial() {
        const def = this._zod.def;
        if (def.checks?.length)
          throw new Error(".partial() cannot be used on tuple schemas containing refinements");
        return this.clone({
          ...def,
          items: def.items.map((item) => new ZodOptional({ type: "optional", innerType: item }))
        });
      }
    });
    ZodRecord = /* @__PURE__ */ $constructor("ZodRecord", (inst, def) => {
      _ensureDefaultMemoizer();
      $ZodRecord.init(inst, def);
      ZodType.init(inst, def);
      inst._zod.processJSONSchema = (ctx, json2, params) => recordProcessor(inst, ctx, json2, params);
      inst.keyType = def.keyType;
      inst.valueType = def.valueType;
    });
    ZodMap = /* @__PURE__ */ $constructor("ZodMap", (inst, def) => {
      _ensureDefaultMemoizer();
      $ZodMap.init(inst, def);
      ZodType.init(inst, def);
      inst._zod.processJSONSchema = (ctx, json2, params) => mapProcessor(inst, ctx, json2, params);
      inst.keyType = def.keyType;
      inst.valueType = def.valueType;
      inst.min = (...args) => inst.check(_minSize(...args));
      inst.nonempty = (params) => inst.check(_minSize(1, params));
      inst.max = (...args) => inst.check(_maxSize(...args));
      inst.size = (...args) => inst.check(_size(...args));
    });
    ZodSet = /* @__PURE__ */ $constructor("ZodSet", (inst, def) => {
      _ensureDefaultMemoizer();
      $ZodSet.init(inst, def);
      ZodType.init(inst, def);
      inst._zod.processJSONSchema = (ctx, json2, params) => setProcessor(inst, ctx, json2, params);
      inst.min = (...args) => inst.check(_minSize(...args));
      inst.nonempty = (params) => inst.check(_minSize(1, params));
      inst.max = (...args) => inst.check(_maxSize(...args));
      inst.size = (...args) => inst.check(_size(...args));
    });
    ZodEnum = /* @__PURE__ */ $constructor("ZodEnum", (inst, def) => {
      $ZodEnum.init(inst, def);
      ZodType.init(inst, def);
      inst._zod.processJSONSchema = (ctx, json2, params) => enumProcessor(inst, ctx, json2, params);
      inst.enum = def.entries;
      inst.options = [...inst._zod.values];
      const keys = new Set(Object.keys(def.entries));
      inst.extract = (values, params) => {
        const newEntries = {};
        for (const value of values) {
          if (keys.has(value)) {
            newEntries[value] = def.entries[value];
          } else
            throw new Error(`Key ${value} not found in enum`);
        }
        return new ZodEnum({
          ...def,
          checks: [],
          ...util_exports.normalizeParams(params),
          entries: newEntries
        });
      };
      inst.exclude = (values, params) => {
        const newEntries = { ...def.entries };
        for (const value of values) {
          if (keys.has(value)) {
            delete newEntries[value];
          } else
            throw new Error(`Key ${value} not found in enum`);
        }
        return new ZodEnum({
          ...def,
          checks: [],
          ...util_exports.normalizeParams(params),
          entries: newEntries
        });
      };
    });
    ZodLiteral = /* @__PURE__ */ $constructor("ZodLiteral", (inst, def) => {
      $ZodLiteral.init(inst, def);
      ZodType.init(inst, def);
      inst._zod.processJSONSchema = (ctx, json2, params) => literalProcessor(inst, ctx, json2, params);
      inst.values = new Set(def.values);
      Object.defineProperty(inst, "value", {
        get() {
          if (def.values.length > 1) {
            throw new Error("This schema contains multiple valid literal values. Use `.values` instead.");
          }
          return def.values[0];
        }
      });
    });
    ZodFile = /* @__PURE__ */ $constructor("ZodFile", (inst, def) => {
      $ZodFile.init(inst, def);
      ZodType.init(inst, def);
      inst._zod.processJSONSchema = (ctx, json2, params) => fileProcessor(inst, ctx, json2, params);
      inst.min = (size, params) => inst.check(_minSize(size, params));
      inst.max = (size, params) => inst.check(_maxSize(size, params));
      inst.mime = (types, params) => inst.check(_mime(Array.isArray(types) ? types : [types], params));
    });
    ZodTransform = /* @__PURE__ */ $constructor("ZodTransform", (inst, def) => {
      _ensureDefaultMemoizer();
      $ZodTransform.init(inst, def);
      ZodType.init(inst, def);
      inst._zod.processJSONSchema = (ctx, json2, params) => transformProcessor(inst, ctx, json2, params);
      inst._zod.parse = (payload, _ctx) => {
        if (_ctx.direction === "backward") {
          throw new $ZodEncodeError(inst.constructor.name);
        }
        payload.addIssue = (issue2) => {
          if (typeof issue2 === "string") {
            payload.issues.push(util_exports.issue(issue2, payload.value, def));
          } else {
            const _issue = issue2;
            if (_issue.fatal)
              _issue.continue = false;
            _issue.code ?? (_issue.code = "custom");
            if (!("input" in _issue))
              _issue.input = payload.value;
            _issue.inst ?? (_issue.inst = inst);
            payload.issues.push(util_exports.issue(_issue));
          }
        };
        const output2 = def.transform(payload.value, payload);
        if (output2 instanceof Promise) {
          return output2.then((output3) => {
            payload.value = output3;
            return payload;
          });
        }
        payload.value = output2;
        return payload;
      };
    });
    ZodOptional = /* @__PURE__ */ $constructor("ZodOptional", (inst, def) => {
      $ZodOptional.init(inst, def);
      ZodType.init(inst, def);
      inst._zod.processJSONSchema = (ctx, json2, params) => optionalProcessor(inst, ctx, json2, params);
      inst.unwrap = () => inst._zod.def.innerType;
    });
    ZodExactOptional = /* @__PURE__ */ $constructor("ZodExactOptional", (inst, def) => {
      $ZodExactOptional.init(inst, def);
      ZodType.init(inst, def);
      inst._zod.processJSONSchema = (ctx, json2, params) => optionalProcessor(inst, ctx, json2, params);
      inst.unwrap = () => inst._zod.def.innerType;
    });
    ZodNullable = /* @__PURE__ */ $constructor("ZodNullable", (inst, def) => {
      $ZodNullable.init(inst, def);
      ZodType.init(inst, def);
      inst._zod.processJSONSchema = (ctx, json2, params) => nullableProcessor(inst, ctx, json2, params);
      inst.unwrap = () => inst._zod.def.innerType;
    });
    ZodDefault = /* @__PURE__ */ $constructor("ZodDefault", (inst, def) => {
      $ZodDefault.init(inst, def);
      ZodType.init(inst, def);
      inst._zod.processJSONSchema = (ctx, json2, params) => defaultProcessor(inst, ctx, json2, params);
      inst.unwrap = () => inst._zod.def.innerType;
      inst.removeDefault = inst.unwrap;
    });
    ZodPrefault = /* @__PURE__ */ $constructor("ZodPrefault", (inst, def) => {
      $ZodPrefault.init(inst, def);
      ZodType.init(inst, def);
      inst._zod.processJSONSchema = (ctx, json2, params) => prefaultProcessor(inst, ctx, json2, params);
      inst.unwrap = () => inst._zod.def.innerType;
    });
    ZodNonOptional = /* @__PURE__ */ $constructor("ZodNonOptional", (inst, def) => {
      $ZodNonOptional.init(inst, def);
      ZodType.init(inst, def);
      inst._zod.processJSONSchema = (ctx, json2, params) => nonoptionalProcessor(inst, ctx, json2, params);
      inst.unwrap = () => inst._zod.def.innerType;
    });
    ZodSuccess = /* @__PURE__ */ $constructor("ZodSuccess", (inst, def) => {
      $ZodSuccess.init(inst, def);
      ZodType.init(inst, def);
      inst._zod.processJSONSchema = (ctx, json2, params) => successProcessor(inst, ctx, json2, params);
      inst.unwrap = () => inst._zod.def.innerType;
    });
    ZodCatch = /* @__PURE__ */ $constructor("ZodCatch", (inst, def) => {
      $ZodCatch.init(inst, def);
      ZodType.init(inst, def);
      inst._zod.processJSONSchema = (ctx, json2, params) => catchProcessor(inst, ctx, json2, params);
      inst.unwrap = () => inst._zod.def.innerType;
      inst.removeCatch = inst.unwrap;
    });
    ZodNaN = /* @__PURE__ */ $constructor("ZodNaN", (inst, def) => {
      $ZodNaN.init(inst, def);
      ZodType.init(inst, def);
      inst._zod.processJSONSchema = (ctx, json2, params) => nanProcessor(inst, ctx, json2, params);
    });
    ZodPipe = /* @__PURE__ */ $constructor("ZodPipe", (inst, def) => {
      $ZodPipe.init(inst, def);
      ZodType.init(inst, def);
      inst._zod.processJSONSchema = (ctx, json2, params) => pipeProcessor(inst, ctx, json2, params);
      inst.in = def.in;
      inst.out = def.out;
    });
    ZodCodec = /* @__PURE__ */ $constructor("ZodCodec", (inst, def) => {
      ZodPipe.init(inst, def);
      $ZodCodec.init(inst, def);
    });
    ZodPreprocess = /* @__PURE__ */ $constructor("ZodPreprocess", (inst, def) => {
      ZodPipe.init(inst, def);
      $ZodPreprocess.init(inst, def);
    });
    ZodReadonly = /* @__PURE__ */ $constructor("ZodReadonly", (inst, def) => {
      $ZodReadonly.init(inst, def);
      ZodType.init(inst, def);
      inst._zod.processJSONSchema = (ctx, json2, params) => readonlyProcessor(inst, ctx, json2, params);
      inst.unwrap = () => inst._zod.def.innerType;
    });
    ZodTemplateLiteral = /* @__PURE__ */ $constructor("ZodTemplateLiteral", (inst, def) => {
      $ZodTemplateLiteral.init(inst, def);
      ZodType.init(inst, def);
      inst._zod.processJSONSchema = (ctx, json2, params) => templateLiteralProcessor(inst, ctx, json2, params);
    });
    ZodLazy = /* @__PURE__ */ $constructor("ZodLazy", (inst, def) => {
      $ZodLazy.init(inst, def);
      ZodType.init(inst, def);
      inst._zod.processJSONSchema = (ctx, json2, params) => lazyProcessor(inst, ctx, json2, params);
      inst.unwrap = () => inst._zod.def.getter();
    });
    ZodPromise = /* @__PURE__ */ $constructor("ZodPromise", (inst, def) => {
      $ZodPromise.init(inst, def);
      ZodType.init(inst, def);
      inst._zod.processJSONSchema = (ctx, json2, params) => promiseProcessor(inst, ctx, json2, params);
      inst.unwrap = () => inst._zod.def.innerType;
    });
    ZodFunction = /* @__PURE__ */ $constructor("ZodFunction", (inst, def) => {
      $ZodFunction.init(inst, def);
      ZodType.init(inst, def);
      inst._zod.processJSONSchema = (ctx, json2, params) => functionProcessor(inst, ctx, json2, params);
    });
    ZodCustom = /* @__PURE__ */ $constructor("ZodCustom", (inst, def) => {
      $ZodCustom.init(inst, def);
      ZodType.init(inst, def);
      inst._zod.processJSONSchema = (ctx, json2, params) => customProcessor(inst, ctx, json2, params);
    });
    describe2 = describe;
    meta2 = meta;
    ZodInstanceOf = /* @__PURE__ */ $constructor("ZodInstanceOf", (inst, def) => {
      ZodCustom.init(inst, def);
    }, {
      properties(shape, params) {
        return this.check(_properties(shape, params));
      }
    });
    stringbool = (...args) => _stringbool({
      Codec: ZodCodec,
      Boolean: ZodBoolean,
      String: ZodString
    }, ...args);
  }
});

// node_modules/zod/v4/classic/compat.js
function setErrorMap(map2) {
  config({
    customError: map2
  });
}
function getErrorMap() {
  return config().customError;
}
var ZodIssueCode, ZodFirstPartyTypeKind;
var init_compat = __esm({
  "node_modules/zod/v4/classic/compat.js"() {
    init_core2();
    init_core2();
    ZodIssueCode = {
      invalid_type: "invalid_type",
      too_big: "too_big",
      too_small: "too_small",
      invalid_format: "invalid_format",
      not_multiple_of: "not_multiple_of",
      unrecognized_keys: "unrecognized_keys",
      invalid_union: "invalid_union",
      invalid_key: "invalid_key",
      invalid_element: "invalid_element",
      invalid_value: "invalid_value",
      custom: "custom"
    };
    /* @__PURE__ */ (function(ZodFirstPartyTypeKind2) {
    })(ZodFirstPartyTypeKind || (ZodFirstPartyTypeKind = {}));
  }
});

// node_modules/zod/v4/classic/iso.js
var iso_exports = {};
__export(iso_exports, {
  ZodISODate: () => ZodISODate,
  ZodISODateTime: () => ZodISODateTime,
  ZodISODuration: () => ZodISODuration,
  ZodISOTime: () => ZodISOTime,
  date: () => date3,
  datetime: () => datetime2,
  duration: () => duration2,
  time: () => time2
});
function datetime2(params) {
  return _isoDateTime(ZodISODateTime, params);
}
function date3(params) {
  return _isoDate(ZodISODate, params);
}
function time2(params) {
  return _isoTime(ZodISOTime, params);
}
function duration2(params) {
  return _isoDuration(ZodISODuration, params);
}
var init_iso = __esm({
  "node_modules/zod/v4/classic/iso.js"() {
    init_core2();
    init_schemas2();
    init_schemas2();
  }
});

// node_modules/zod/v4/classic/from-json-schema.js
function detectVersion(schema, defaultTarget) {
  const $schema = schema.$schema;
  if ($schema === "https://json-schema.org/draft/2020-12/schema") {
    return "draft-2020-12";
  }
  if ($schema === "http://json-schema.org/draft-07/schema#") {
    return "draft-7";
  }
  if ($schema === "http://json-schema.org/draft-04/schema#") {
    return "draft-4";
  }
  return defaultTarget ?? "draft-2020-12";
}
function applyMinItems(items, minItems) {
  return items.map((item, index) => index < minItems ? item : item.optional());
}
function decodeJSONPointerSegment(segment) {
  return segment.replace(/~1/g, "/").replace(/~0/g, "~");
}
function resolveRef(ref, ctx) {
  if (!ref.startsWith("#")) {
    throw new Error("External $ref is not supported, only local refs (#/...) are allowed");
  }
  const path = ref.slice(1).split("/").filter(Boolean);
  if (path.length === 0) {
    return ctx.rootSchema;
  }
  const defsKey = ctx.version === "draft-2020-12" ? "$defs" : "definitions";
  if (path[0] === defsKey) {
    const key = path[1] === void 0 ? void 0 : decodeJSONPointerSegment(path[1]);
    if (!key || !ctx.defs[key]) {
      throw new Error(`Reference not found: ${ref}`);
    }
    return ctx.defs[key];
  }
  throw new Error(`Reference not found: ${ref}`);
}
function checkObjectGuards(objectSchema, guards) {
  const guard = z.transform((value) => value).check((payload) => {
    const value = payload.value;
    if (typeof value !== "object" || value === null || Array.isArray(value))
      return;
    const keys = Object.getOwnPropertyNames(value);
    if (guards.minProperties !== void 0 && keys.length < guards.minProperties) {
      payload.issues.push({
        origin: "object",
        code: "too_small",
        minimum: guards.minProperties,
        inclusive: true,
        message: `Too small: expected object to have >=${guards.minProperties} properties`,
        input: value,
        inst: objectSchema,
        continue: true
      });
    }
    if (guards.maxProperties !== void 0 && keys.length > guards.maxProperties) {
      payload.issues.push({
        origin: "object",
        code: "too_big",
        maximum: guards.maxProperties,
        inclusive: true,
        message: `Too big: expected object to have <=${guards.maxProperties} properties`,
        input: value,
        inst: objectSchema,
        continue: true
      });
    }
    if (guards.keySchema) {
      for (const key of keys) {
        const result = guards.keySchema.safeParse(key);
        if (result.success)
          continue;
        payload.issues.push({
          code: "invalid_key",
          origin: "record",
          issues: result.error.issues,
          input: key,
          path: [key],
          continue: true
        });
      }
    }
  });
  return guard.pipe(objectSchema);
}
function canonicalKey(value, seen) {
  if (value === null)
    return "z";
  const type = typeof value;
  if (type !== "object") {
    if (type === "number" && Number.isNaN(value))
      return null;
    const raw = String(value);
    return `${type[0]}${raw.length}:${raw}`;
  }
  if (seen.has(value))
    return null;
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const parts2 = [];
      for (const item of value) {
        const key = canonicalKey(item, seen);
        if (key === null)
          return null;
        parts2.push(key);
      }
      return `a${parts2.length}:[${parts2.join(",")}]`;
    }
    const keys = Object.keys(value).sort();
    const parts = [];
    for (const k of keys) {
      const key = canonicalKey(value[k], seen);
      if (key === null)
        return null;
      parts.push(`${k.length}:${k}=${key}`);
    }
    return `o${parts.length}:{${parts.join(",")}}`;
  } finally {
    seen.delete(value);
  }
}
function containsRef(value) {
  if (typeof value !== "object" || value === null)
    return false;
  if (Array.isArray(value))
    return value.some(containsRef);
  if (typeof value.$ref === "string")
    return true;
  return Object.entries(value).some(([key, sub]) => {
    if (SCHEMA_KEYWORDS.has(key))
      return containsRef(sub);
    if (!SCHEMA_MAP_KEYWORDS.has(key) || typeof sub !== "object" || sub === null)
      return false;
    return Object.values(sub).some(containsRef);
  });
}
function plural(n) {
  return n === 1 ? "element" : "elements";
}
function checkArrayGuards(arraySchema, guards) {
  const guard = z.transform((value) => value).check((payload) => {
    const items = payload.value;
    if (!Array.isArray(items))
      return;
    if (guards.uniqueItems === true) {
      const firstSeen = /* @__PURE__ */ new Map();
      for (let i = 0; i < items.length; i++) {
        const key = canonicalKey(items[i], /* @__PURE__ */ new Set());
        if (key === null)
          continue;
        const first = firstSeen.get(key);
        if (first === void 0) {
          firstSeen.set(key, i);
          continue;
        }
        payload.issues.push({
          code: "custom",
          message: `Array items must be unique: element at index ${i} duplicates the one at index ${first}`,
          input: items,
          path: [i],
          continue: true
        });
      }
    }
    if (guards.containsSchema) {
      const minContains = guards.minContains ?? 1;
      const ceiling = guards.maxContains !== void 0 ? guards.maxContains + 1 : Number.POSITIVE_INFINITY;
      let matches = 0;
      for (const item of items) {
        if (guards.containsSchema.safeParse(item).success && ++matches >= ceiling)
          break;
      }
      if (matches < minContains) {
        payload.issues.push({
          code: "custom",
          message: `Array must contain at least ${minContains} matching ${plural(minContains)}; found ${matches}`,
          input: items,
          continue: true
        });
      }
      if (guards.maxContains !== void 0 && matches > guards.maxContains) {
        payload.issues.push({
          code: "custom",
          message: `Array must contain at most ${guards.maxContains} matching ${plural(guards.maxContains)}`,
          input: items,
          continue: true
        });
      }
    }
  });
  return guard.pipe(arraySchema);
}
function getTupleRest(restSchema, ctx) {
  if (restSchema === false) {
    return void 0;
  }
  if (restSchema === void 0 || restSchema === true) {
    return z.any();
  }
  return convertSchema(restSchema, ctx);
}
function convertBaseSchema(schema, ctx) {
  if (schema.not !== void 0) {
    if (typeof schema.not === "object" && Object.keys(schema.not).length === 0) {
      return z.never();
    }
    throw new Error("not is not supported in Zod (except { not: {} } for never)");
  }
  if (schema.unevaluatedItems !== void 0) {
    throw new Error("unevaluatedItems is not supported");
  }
  if (schema.unevaluatedProperties !== void 0) {
    throw new Error("unevaluatedProperties is not supported");
  }
  if (schema.if !== void 0 || schema.then !== void 0 || schema.else !== void 0) {
    throw new Error("Conditional schemas (if/then/else) are not supported");
  }
  if (schema.dependentSchemas !== void 0 || schema.dependentRequired !== void 0) {
    throw new Error("dependentSchemas and dependentRequired are not supported");
  }
  if (schema.$ref) {
    const refPath = schema.$ref;
    if (ctx.refs.has(refPath)) {
      return ctx.refs.get(refPath);
    }
    if (ctx.processing.has(refPath)) {
      return z.lazy(() => {
        if (!ctx.refs.has(refPath)) {
          throw new Error(`Circular reference not resolved: ${refPath}`);
        }
        return ctx.refs.get(refPath);
      });
    }
    ctx.processing.add(refPath);
    const resolved = resolveRef(refPath, ctx);
    const zodSchema2 = convertSchema(resolved, ctx);
    ctx.refs.set(refPath, zodSchema2);
    ctx.processing.delete(refPath);
    return zodSchema2;
  }
  if (schema.enum !== void 0) {
    const enumValues = schema.enum;
    if (ctx.version === "openapi-3.0" && schema.nullable === true && enumValues.length === 1 && enumValues[0] === null) {
      return z.null();
    }
    if (enumValues.length === 0) {
      return z.never();
    }
    if (enumValues.length === 1) {
      return z.literal(enumValues[0]);
    }
    if (enumValues.every((v) => typeof v === "string")) {
      return z.enum(enumValues);
    }
    const literalSchemas = enumValues.map((v) => z.literal(v));
    if (literalSchemas.length < 2) {
      return literalSchemas[0];
    }
    return z.union([literalSchemas[0], literalSchemas[1], ...literalSchemas.slice(2)]);
  }
  if (schema.const !== void 0) {
    return z.literal(schema.const);
  }
  const type = schema.type;
  if (Array.isArray(type)) {
    const typeSchemas = type.map((t2) => {
      const typeSchema = { ...schema, type: t2 };
      return convertBaseSchema(typeSchema, ctx);
    });
    if (typeSchemas.length === 0) {
      return z.never();
    }
    if (typeSchemas.length === 1) {
      return typeSchemas[0];
    }
    return z.union(typeSchemas);
  }
  if (!type) {
    return z.any();
  }
  let zodSchema;
  switch (type) {
    case "string": {
      let stringSchema = z.string();
      if (schema.format) {
        const format = schema.format;
        if (format === "email") {
          stringSchema = stringSchema.check(z.email());
        } else if (format === "uri" || format === "uri-reference") {
          stringSchema = stringSchema.check(z.url());
        } else if (format === "uuid" || format === "guid") {
          stringSchema = stringSchema.check(z.uuid());
        } else if (format === "date-time") {
          stringSchema = stringSchema.check(z.iso.datetime({ offset: true }));
        } else if (format === "date") {
          stringSchema = stringSchema.check(z.iso.date());
        } else if (format === "time") {
          stringSchema = stringSchema.check(z.regex(fullTime));
        } else if (format === "duration") {
          stringSchema = stringSchema.check(z.iso.duration());
        } else if (format === "hostname") {
          stringSchema = stringSchema.check(z.hostname());
        } else if (format === "ipv4") {
          stringSchema = stringSchema.check(z.ipv4());
        } else if (format === "ipv6") {
          stringSchema = stringSchema.check(z.ipv6());
        } else if (format === "mac") {
          stringSchema = stringSchema.check(z.mac());
        } else if (format === "cidr") {
          stringSchema = stringSchema.check(z.cidrv4());
        } else if (format === "cidr-v6") {
          stringSchema = stringSchema.check(z.cidrv6());
        } else if (format === "base64") {
          stringSchema = stringSchema.check(z.base64());
        } else if (format === "base64url") {
          stringSchema = stringSchema.check(z.base64url());
        } else if (format === "e164") {
          stringSchema = stringSchema.check(z.e164());
        } else if (format === "credit_card") {
          stringSchema = stringSchema.check(z.creditCard());
        } else if (format === "iban") {
          stringSchema = stringSchema.check(z.iban());
        } else if (format === "jwt") {
          stringSchema = stringSchema.check(z.jwt());
        } else if (format === "emoji") {
          stringSchema = stringSchema.check(z.emoji());
        } else if (format === "nanoid") {
          stringSchema = stringSchema.check(z.nanoid());
        } else if (format === "cuid") {
          stringSchema = stringSchema.check(z.cuid());
        } else if (format === "cuid2") {
          stringSchema = stringSchema.check(z.cuid2());
        } else if (format === "ulid") {
          stringSchema = stringSchema.check(z.ulid());
        } else if (format === "xid") {
          stringSchema = stringSchema.check(z.xid());
        } else if (format === "ksuid") {
          stringSchema = stringSchema.check(z.ksuid());
        }
      }
      if (typeof schema.minLength === "number") {
        stringSchema = stringSchema.min(schema.minLength);
      }
      if (typeof schema.maxLength === "number") {
        stringSchema = stringSchema.max(schema.maxLength);
      }
      if (schema.pattern) {
        stringSchema = stringSchema.regex(new RegExp(schema.pattern));
      }
      zodSchema = stringSchema;
      break;
    }
    case "number":
    case "integer": {
      let numberSchema = type === "integer" ? z.number().int() : z.number();
      if (typeof schema.minimum === "number" && schema.exclusiveMinimum !== true) {
        numberSchema = numberSchema.min(schema.minimum);
      }
      if (typeof schema.maximum === "number" && schema.exclusiveMaximum !== true) {
        numberSchema = numberSchema.max(schema.maximum);
      }
      if (typeof schema.exclusiveMinimum === "number") {
        numberSchema = numberSchema.gt(schema.exclusiveMinimum);
      } else if (schema.exclusiveMinimum === true && typeof schema.minimum === "number") {
        numberSchema = numberSchema.gt(schema.minimum);
      }
      if (typeof schema.exclusiveMaximum === "number") {
        numberSchema = numberSchema.lt(schema.exclusiveMaximum);
      } else if (schema.exclusiveMaximum === true && typeof schema.maximum === "number") {
        numberSchema = numberSchema.lt(schema.maximum);
      }
      if (typeof schema.multipleOf === "number") {
        numberSchema = numberSchema.multipleOf(schema.multipleOf);
      }
      zodSchema = numberSchema;
      break;
    }
    case "boolean": {
      zodSchema = z.boolean();
      break;
    }
    case "null": {
      zodSchema = z.null();
      break;
    }
    case "object": {
      const shape = {};
      const properties = schema.properties || {};
      const requiredSet = new Set(schema.required || []);
      const additionalSchema = typeof schema.additionalProperties === "object" ? convertSchema(schema.additionalProperties, ctx) : void 0;
      for (const [key, propSchema] of Object.entries(properties)) {
        const propZodSchema = convertSchema(propSchema, ctx);
        assignProp(shape, key, requiredSet.has(key) ? propZodSchema : propZodSchema.optional());
      }
      if (schema.patternProperties) {
        const patternProps = schema.patternProperties;
        const patternKeys = Object.keys(patternProps);
        const looseRecords = [];
        for (const pattern of patternKeys) {
          const patternValue = convertSchema(patternProps[pattern], ctx);
          const keySchema = z.string().regex(new RegExp(pattern));
          looseRecords.push(z.looseRecord(keySchema, patternValue));
        }
        const schemasToIntersect = [];
        if (Object.keys(shape).length > 0) {
          schemasToIntersect.push(z.object(shape).passthrough());
        }
        schemasToIntersect.push(...looseRecords);
        if (schemasToIntersect.length === 0) {
          zodSchema = z.object({}).passthrough();
        } else if (schemasToIntersect.length === 1) {
          zodSchema = schemasToIntersect[0];
        } else {
          let result = z.intersection(schemasToIntersect[0], schemasToIntersect[1]);
          for (let i = 2; i < schemasToIntersect.length; i++) {
            result = z.intersection(result, schemasToIntersect[i]);
          }
          zodSchema = result;
        }
        if (schema.additionalProperties === false) {
          const propertyKeys = Object.keys(shape);
          const patterns = patternKeys.map((p) => new RegExp(p));
          const basePatternSchema = zodSchema;
          zodSchema = zodSchema.check((payload) => {
            if (!isPlainObject(payload.value))
              return;
            const unrecognized = [];
            for (const key of Object.keys(payload.value)) {
              if (propertyKeys.includes(key))
                continue;
              if (patterns.some((regex) => regex.test(key)))
                continue;
              unrecognized.push(key);
            }
            if (unrecognized.length) {
              payload.issues.push({
                code: "unrecognized_keys",
                keys: unrecognized,
                input: payload.value,
                inst: basePatternSchema
              });
            }
          });
        }
      } else {
        const objectSchema = z.object(shape);
        if (schema.additionalProperties === false) {
          zodSchema = objectSchema.strict();
        } else if (additionalSchema) {
          zodSchema = objectSchema.catchall(additionalSchema);
        } else {
          zodSchema = objectSchema.passthrough();
        }
      }
      const hasKeyGuard = schema.propertyNames !== void 0 && schema.propertyNames !== true;
      const minProperties = typeof schema.minProperties === "number" ? schema.minProperties : void 0;
      const maxProperties = typeof schema.maxProperties === "number" ? schema.maxProperties : void 0;
      if (hasKeyGuard || minProperties !== void 0 || maxProperties !== void 0) {
        let keySchema;
        if (hasKeyGuard) {
          const keyJSONSchema = typeof schema.propertyNames === "object" && schema.propertyNames.type === void 0 ? { type: "string", ...schema.propertyNames } : schema.propertyNames;
          keySchema = convertSchema(keyJSONSchema, ctx);
        }
        zodSchema = checkObjectGuards(zodSchema, { keySchema, minProperties, maxProperties });
      }
      break;
    }
    case "array": {
      const prefixItems = schema.prefixItems;
      const items = schema.items;
      if (prefixItems && Array.isArray(prefixItems)) {
        const minItems = typeof schema.minItems === "number" ? schema.minItems : 0;
        const tupleItems = prefixItems.map((item) => convertSchema(item, ctx));
        const positionalItems = applyMinItems(tupleItems, minItems);
        const rest = !Array.isArray(items) ? getTupleRest(items, ctx) : void 0;
        const tupleSchema = z.tuple(positionalItems);
        zodSchema = rest ? tupleSchema.rest(rest) : tupleSchema;
        if (typeof schema.minItems === "number") {
          zodSchema = zodSchema.check(z.minLength(schema.minItems));
        }
        if (typeof schema.maxItems === "number") {
          zodSchema = zodSchema.check(z.maxLength(schema.maxItems));
        }
      } else if (Array.isArray(items)) {
        const minItems = typeof schema.minItems === "number" ? schema.minItems : 0;
        const tupleItems = items.map((item) => convertSchema(item, ctx));
        const positionalItems = applyMinItems(tupleItems, minItems);
        const rest = getTupleRest(schema.additionalItems, ctx);
        const tupleSchema = z.tuple(positionalItems);
        zodSchema = rest ? tupleSchema.rest(rest) : tupleSchema;
        if (typeof schema.minItems === "number") {
          zodSchema = zodSchema.check(z.minLength(schema.minItems));
        }
        if (typeof schema.maxItems === "number") {
          zodSchema = zodSchema.check(z.maxLength(schema.maxItems));
        }
      } else if (items !== void 0) {
        const element = convertSchema(items, ctx);
        let arraySchema = z.array(element);
        if (typeof schema.minItems === "number") {
          arraySchema = arraySchema.min(schema.minItems);
        }
        if (typeof schema.maxItems === "number") {
          arraySchema = arraySchema.max(schema.maxItems);
        }
        zodSchema = arraySchema;
      } else {
        zodSchema = z.array(z.any());
      }
      if (schema.uniqueItems === true || schema.contains !== void 0) {
        zodSchema = checkArrayGuards(zodSchema, {
          uniqueItems: schema.uniqueItems === true,
          containsSchema: schema.contains !== void 0 ? convertSchema(schema.contains, ctx) : void 0,
          minContains: typeof schema.minContains === "number" ? schema.minContains : void 0,
          maxContains: typeof schema.maxContains === "number" ? schema.maxContains : void 0
        });
      }
      break;
    }
    default:
      throw new Error(`Unsupported type: ${type}`);
  }
  return zodSchema;
}
function convertSchema(schema, ctx) {
  if (typeof schema === "boolean") {
    return schema ? z.any() : z.never();
  }
  let baseSchema = convertBaseSchema(schema, ctx);
  const hasExplicitType = schema.type || schema.enum !== void 0 || schema.const !== void 0;
  if (schema.anyOf && Array.isArray(schema.anyOf)) {
    const options = schema.anyOf.map((s) => convertSchema(s, ctx));
    const anyOfUnion = z.union(options);
    baseSchema = hasExplicitType ? z.intersection(baseSchema, anyOfUnion) : anyOfUnion;
  }
  if (schema.oneOf && Array.isArray(schema.oneOf)) {
    const options = schema.oneOf.map((s) => convertSchema(s, ctx));
    const oneOfUnion = z.xor(options);
    baseSchema = hasExplicitType ? z.intersection(baseSchema, oneOfUnion) : oneOfUnion;
  }
  if (schema.allOf && Array.isArray(schema.allOf)) {
    if (schema.allOf.length === 0) {
      baseSchema = hasExplicitType ? baseSchema : z.any();
    } else {
      let result = hasExplicitType ? baseSchema : convertSchema(schema.allOf[0], ctx);
      const startIdx = hasExplicitType ? 0 : 1;
      for (let i = startIdx; i < schema.allOf.length; i++) {
        result = z.intersection(result, convertSchema(schema.allOf[i], ctx));
      }
      baseSchema = result;
    }
  }
  if (schema.nullable === true && ctx.version === "openapi-3.0") {
    baseSchema = z.nullable(baseSchema);
  }
  if (schema.readOnly === true) {
    baseSchema = z.readonly(baseSchema);
  }
  if (schema.default !== void 0) {
    baseSchema = baseSchema.default(schema.default);
  }
  const extraMeta = {};
  const coreMetadataKeys = ["$id", "id", "$comment", "$anchor", "$vocabulary", "$dynamicRef", "$dynamicAnchor"];
  for (const key of coreMetadataKeys) {
    if (key in schema) {
      extraMeta[key] = schema[key];
    }
  }
  const contentMetadataKeys = ["contentEncoding", "contentMediaType", "contentSchema"];
  for (const key of contentMetadataKeys) {
    if (key in schema) {
      extraMeta[key] = schema[key];
    }
  }
  if (schema.type === "object" && schema.$ref === void 0) {
    if (schema.propertyNames !== void 0 && !containsRef(schema.propertyNames)) {
      extraMeta.propertyNames = schema.propertyNames;
    }
    for (const key of ["minProperties", "maxProperties"]) {
      if (schema[key] !== void 0)
        extraMeta[key] = schema[key];
    }
  }
  if (schema.type === "array" && schema.$ref === void 0) {
    if (schema.contains !== void 0 && !containsRef(schema.contains)) {
      extraMeta.contains = schema.contains;
    }
    for (const key of ["uniqueItems", "minContains", "maxContains"]) {
      if (schema[key] !== void 0)
        extraMeta[key] = schema[key];
    }
  }
  for (const key of Object.keys(schema)) {
    if (!RECOGNIZED_KEYS.has(key)) {
      assignProp(extraMeta, key, schema[key]);
    }
  }
  if (Object.keys(extraMeta).length > 0) {
    ctx.registry.add(baseSchema, extraMeta);
  }
  if (schema.description) {
    baseSchema = baseSchema.describe(schema.description);
  }
  return baseSchema;
}
function fromJSONSchema(schema, params) {
  if (typeof schema === "boolean") {
    return schema ? z.any() : z.never();
  }
  let normalized;
  try {
    normalized = JSON.parse(JSON.stringify(schema));
  } catch {
    throw new Error("fromJSONSchema input is not valid JSON (possibly cyclic); use $defs/$ref for recursive schemas");
  }
  const version2 = detectVersion(normalized, params?.defaultTarget);
  const defs = normalized.$defs || normalized.definitions || {};
  const ctx = {
    version: version2,
    defs,
    refs: /* @__PURE__ */ new Map(),
    processing: /* @__PURE__ */ new Set(),
    rootSchema: normalized,
    registry: params?.registry ?? globalRegistry
  };
  return convertSchema(normalized, ctx);
}
var z, RECOGNIZED_KEYS, SCHEMA_KEYWORDS, SCHEMA_MAP_KEYWORDS, fullTime;
var init_from_json_schema = __esm({
  "node_modules/zod/v4/classic/from-json-schema.js"() {
    init_registries();
    init_util();
    init_checks2();
    init_iso();
    init_schemas2();
    z = {
      ...schemas_exports2,
      ...checks_exports2,
      iso: iso_exports
    };
    RECOGNIZED_KEYS = /* @__PURE__ */ new Set([
      // Schema identification
      "$schema",
      "$ref",
      "$defs",
      "definitions",
      // Core schema keywords
      "$id",
      "id",
      "$comment",
      "$anchor",
      "$vocabulary",
      "$dynamicRef",
      "$dynamicAnchor",
      // Type
      "type",
      "enum",
      "const",
      // Composition
      "anyOf",
      "oneOf",
      "allOf",
      "not",
      // Object
      "properties",
      "required",
      "additionalProperties",
      "patternProperties",
      "propertyNames",
      "minProperties",
      "maxProperties",
      // Array
      "items",
      "prefixItems",
      "additionalItems",
      "minItems",
      "maxItems",
      "uniqueItems",
      "contains",
      "minContains",
      "maxContains",
      // String
      "minLength",
      "maxLength",
      "pattern",
      "format",
      // Number
      "minimum",
      "maximum",
      "exclusiveMinimum",
      "exclusiveMaximum",
      "multipleOf",
      // Already handled metadata
      "description",
      "default",
      // Content
      "contentEncoding",
      "contentMediaType",
      "contentSchema",
      // Unsupported (error-throwing)
      "unevaluatedItems",
      "unevaluatedProperties",
      "if",
      "then",
      "else",
      "dependentSchemas",
      "dependentRequired",
      // OpenAPI
      "nullable",
      "readOnly"
    ]);
    SCHEMA_KEYWORDS = /* @__PURE__ */ new Set([
      "items",
      "prefixItems",
      "additionalItems",
      "additionalProperties",
      "contains",
      "propertyNames",
      "not",
      "if",
      "then",
      "else",
      "allOf",
      "anyOf",
      "oneOf",
      "unevaluatedItems",
      "unevaluatedProperties",
      "contentSchema"
    ]);
    SCHEMA_MAP_KEYWORDS = /* @__PURE__ */ new Set([
      "properties",
      "patternProperties",
      "dependentSchemas",
      "dependencies",
      "$defs",
      "definitions"
    ]);
    fullTime = /^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
  }
});

// node_modules/zod/v4/core/visit.js
function visit(schema, fnOrHandlers) {
  const fn = typeof fnOrHandlers === "function" ? fnOrHandlers : (node2, rewritten) => {
    const h3 = fnOrHandlers[node2._zod.def.type];
    return h3 ? h3(node2, rewritten) : node2;
  };
  const cache = /* @__PURE__ */ new Map();
  function run(s) {
    const cached2 = cache.get(s);
    if (cached2 === RESOLVING) {
      return new $ZodLazy({
        type: "lazy",
        getter: () => cache.get(s)
      });
    }
    if (cached2 !== void 0)
      return cached2;
    cache.set(s, RESOLVING);
    const inner = mapInner(s);
    const mapped = fn(inner, inner !== s);
    cache.set(s, mapped);
    return mapped;
  }
  function mapInner(s) {
    const def = s._zod.def;
    const kind = def.type;
    switch (kind) {
      case "object": {
        const oldShape = def.shape;
        const keys = Object.keys(oldShape);
        let changed = false;
        const newShape = {};
        for (const k of keys) {
          const mapped = run(oldShape[k]);
          if (mapped !== oldShape[k])
            changed = true;
          newShape[k] = mapped;
        }
        let newCatchall = def.catchall;
        if (def.catchall) {
          newCatchall = run(def.catchall);
          if (newCatchall !== def.catchall)
            changed = true;
        }
        return changed ? clone(s, { ...def, shape: newShape, catchall: newCatchall }) : s;
      }
      case "array": {
        const mapped = run(def.element);
        return mapped === def.element ? s : clone(s, { ...def, element: mapped });
      }
      case "tuple": {
        const oldItems = def.items;
        let changed = false;
        const newItems = [];
        for (const item of oldItems) {
          const mapped = run(item);
          if (mapped !== item)
            changed = true;
          newItems.push(mapped);
        }
        let newRest = def.rest;
        if (def.rest) {
          newRest = run(def.rest);
          if (newRest !== def.rest)
            changed = true;
        }
        return changed ? clone(s, { ...def, items: newItems, rest: newRest }) : s;
      }
      case "record":
      case "map": {
        const newKey = run(def.keyType);
        const newVal = run(def.valueType);
        return newKey === def.keyType && newVal === def.valueType ? s : clone(s, { ...def, keyType: newKey, valueType: newVal });
      }
      case "set": {
        const newVal = run(def.valueType);
        return newVal === def.valueType ? s : clone(s, { ...def, valueType: newVal });
      }
      case "union": {
        const oldOptions = def.options;
        let changed = false;
        const newOptions = [];
        for (const opt of oldOptions) {
          const mapped = run(opt);
          if (mapped !== opt)
            changed = true;
          newOptions.push(mapped);
        }
        return changed ? clone(s, { ...def, options: newOptions }) : s;
      }
      case "intersection": {
        const newLeft = run(def.left);
        const newRight = run(def.right);
        return newLeft === def.left && newRight === def.right ? s : clone(s, { ...def, left: newLeft, right: newRight });
      }
      case "optional":
      case "nullable":
      case "default":
      case "prefault":
      case "catch":
      case "readonly":
      case "nonoptional":
      case "promise":
      case "success": {
        const newInner = run(def.innerType);
        return newInner === def.innerType ? s : clone(s, { ...def, innerType: newInner });
      }
      case "pipe": {
        const newIn = run(def.in);
        const newOut = run(def.out);
        return newIn === def.in && newOut === def.out ? s : clone(s, { ...def, in: newIn, out: newOut });
      }
      case "function": {
        const newInput = run(def.input);
        const newOutput = run(def.output);
        return newInput === def.input && newOutput === def.output ? s : clone(s, { ...def, input: newInput, output: newOutput });
      }
      case "lazy": {
        const original = def.getter;
        const { _cachedInner, ...rest } = def;
        return clone(s, { ...rest, getter: () => run(original()) });
      }
      // A leaf by choice: `parts` are regex fragments, not data positions.
      case "template_literal":
      // Leaves.
      case "string":
      case "number":
      case "int":
      case "boolean":
      case "bigint":
      case "symbol":
      case "undefined":
      case "null":
      case "void":
      case "never":
      case "any":
      case "unknown":
      case "date":
      case "nan":
      case "enum":
      case "literal":
      case "file":
      case "transform":
      case "custom":
        return s;
      default: {
        kind;
        return s;
      }
    }
  }
  return run(schema);
}
var RESOLVING;
var init_visit = __esm({
  "node_modules/zod/v4/core/visit.js"() {
    init_schemas();
    init_util();
    RESOLVING = /* @__PURE__ */ Symbol("z.visit/resolving");
  }
});

// node_modules/zod/v4/classic/deep-partial.js
function deepPartial(schema) {
  return visit(schema, {
    object: (s) => s.partial(),
    // Every partialed option now admits `undefined`, which the constructor rejects as a duplicate.
    union: (s) => {
      const def = s._zod.def;
      return def.discriminator === void 0 ? s : union(def.options);
    }
  });
}
var init_deep_partial = __esm({
  "node_modules/zod/v4/classic/deep-partial.js"() {
    init_visit();
    init_schemas2();
  }
});

// node_modules/zod/v4/classic/in-out.js
function withChecks(side, checks) {
  if (!checks?.length)
    return side;
  const def = side._zod.def;
  return clone(side, mergeDefs(def, { checks: [...def.checks ?? [], ...checks] }), { parent: true });
}
function outSide(def) {
  return withChecks(def.out, def.checks);
}
function inSide(def) {
  return def.in._zod.traits.has("$ZodTransform") ? outSide(def) : def.in;
}
function input(schema) {
  return visit(schema, {
    pipe: (s) => inSide(s._zod.def),
    // A default value belongs to the output side, so a rewritten inner type leaves it stranded. `.default()` widens the declared input type with `undefined`, and `optional` is what carries that across.
    default: (s, rewritten) => rewritten ? optional(s._zod.def.innerType) : s,
    // A catch value is output-side too, but `.catch()` leaves the declared input type alone, so the inner schema stands on its own.
    catch: (s, rewritten) => rewritten ? s._zod.def.innerType : s
  });
}
function output(schema) {
  return visit(schema, {
    pipe: (s) => outSide(s._zod.def),
    // A prefault value is fed through the schema, which makes it input-side, so a rewritten inner type leaves it stranded.
    prefault: (s, rewritten) => rewritten ? s._zod.def.innerType : s
  });
}
var init_in_out = __esm({
  "node_modules/zod/v4/classic/in-out.js"() {
    init_util();
    init_visit();
    init_schemas2();
  }
});

// node_modules/zod/v4/classic/coerce.js
var coerce_exports = {};
__export(coerce_exports, {
  bigint: () => bigint3,
  boolean: () => boolean3,
  date: () => date4,
  number: () => number3,
  string: () => string3
});
function string3(params) {
  return _coercedString(ZodString, params);
}
function number3(params) {
  return _coercedNumber(ZodNumber, params);
}
function boolean3(params) {
  return _coercedBoolean(ZodBoolean, params);
}
function bigint3(params) {
  return _coercedBigint(ZodBigInt, params);
}
function date4(params) {
  return _coercedDate(ZodDate, params);
}
var init_coerce = __esm({
  "node_modules/zod/v4/classic/coerce.js"() {
    init_core2();
    init_schemas2();
  }
});

// node_modules/zod/v4/classic/external.js
var external_exports = {};
__export(external_exports, {
  $brand: () => $brand,
  $input: () => $input,
  $output: () => $output,
  INVALID: () => INVALID,
  NEVER: () => NEVER,
  TimePrecision: () => TimePrecision,
  ZodAny: () => ZodAny,
  ZodArray: () => ZodArray,
  ZodBase64: () => ZodBase64,
  ZodBase64URL: () => ZodBase64URL,
  ZodBigInt: () => ZodBigInt,
  ZodBigIntFormat: () => ZodBigIntFormat,
  ZodBoolean: () => ZodBoolean,
  ZodCIDRv4: () => ZodCIDRv4,
  ZodCIDRv6: () => ZodCIDRv6,
  ZodCUID: () => ZodCUID,
  ZodCUID2: () => ZodCUID2,
  ZodCatch: () => ZodCatch,
  ZodCodec: () => ZodCodec,
  ZodCompileAsyncError: () => ZodCompileAsyncError,
  ZodCompileUnsupportedError: () => ZodCompileUnsupportedError,
  ZodCreditCard: () => ZodCreditCard,
  ZodCustom: () => ZodCustom,
  ZodCustomStringFormat: () => ZodCustomStringFormat,
  ZodDate: () => ZodDate,
  ZodDefault: () => ZodDefault,
  ZodDiscriminatedUnion: () => ZodDiscriminatedUnion,
  ZodE164: () => ZodE164,
  ZodEmail: () => ZodEmail,
  ZodEmoji: () => ZodEmoji,
  ZodEnum: () => ZodEnum,
  ZodError: () => ZodError,
  ZodExactOptional: () => ZodExactOptional,
  ZodFile: () => ZodFile,
  ZodFirstPartyTypeKind: () => ZodFirstPartyTypeKind,
  ZodFunction: () => ZodFunction,
  ZodGUID: () => ZodGUID,
  ZodIBAN: () => ZodIBAN,
  ZodIPv4: () => ZodIPv4,
  ZodIPv6: () => ZodIPv6,
  ZodISODate: () => ZodISODate,
  ZodISODateTime: () => ZodISODateTime,
  ZodISODuration: () => ZodISODuration,
  ZodISOTime: () => ZodISOTime,
  ZodInstanceOf: () => ZodInstanceOf,
  ZodIntersection: () => ZodIntersection,
  ZodIssueCode: () => ZodIssueCode,
  ZodJWT: () => ZodJWT,
  ZodKSUID: () => ZodKSUID,
  ZodLazy: () => ZodLazy,
  ZodLiteral: () => ZodLiteral,
  ZodMAC: () => ZodMAC,
  ZodMap: () => ZodMap,
  ZodNaN: () => ZodNaN,
  ZodNanoID: () => ZodNanoID,
  ZodNever: () => ZodNever,
  ZodNonOptional: () => ZodNonOptional,
  ZodNull: () => ZodNull,
  ZodNullable: () => ZodNullable,
  ZodNumber: () => ZodNumber,
  ZodNumberFormat: () => ZodNumberFormat,
  ZodObject: () => ZodObject,
  ZodOptional: () => ZodOptional,
  ZodPipe: () => ZodPipe,
  ZodPrefault: () => ZodPrefault,
  ZodPreprocess: () => ZodPreprocess,
  ZodPromise: () => ZodPromise,
  ZodReadonly: () => ZodReadonly,
  ZodRealError: () => ZodRealError,
  ZodRecord: () => ZodRecord,
  ZodSet: () => ZodSet,
  ZodString: () => ZodString,
  ZodStringFormat: () => ZodStringFormat,
  ZodSuccess: () => ZodSuccess,
  ZodSymbol: () => ZodSymbol,
  ZodTemplateLiteral: () => ZodTemplateLiteral,
  ZodTransform: () => ZodTransform,
  ZodTuple: () => ZodTuple,
  ZodType: () => ZodType,
  ZodULID: () => ZodULID,
  ZodURL: () => ZodURL,
  ZodUUID: () => ZodUUID,
  ZodUndefined: () => ZodUndefined,
  ZodUnion: () => ZodUnion,
  ZodUnknown: () => ZodUnknown,
  ZodVoid: () => ZodVoid,
  ZodXID: () => ZodXID,
  ZodXor: () => ZodXor,
  _ZodString: () => _ZodString,
  _default: () => _default2,
  _function: () => _function,
  any: () => any,
  array: () => array,
  base64: () => base642,
  base64url: () => base64url2,
  bigint: () => bigint2,
  boolean: () => boolean2,
  catch: () => _catch2,
  check: () => check,
  cidrv4: () => cidrv42,
  cidrv6: () => cidrv62,
  clone: () => clone,
  codec: () => codec,
  coerce: () => coerce_exports,
  compile: () => compile,
  config: () => config,
  core: () => core_exports2,
  creditCard: () => creditCard2,
  cuid: () => cuid3,
  cuid2: () => cuid22,
  currencyCode: () => currencyCode2,
  custom: () => custom,
  date: () => date2,
  decode: () => decode2,
  decodeAsync: () => decodeAsync2,
  deepPartial: () => deepPartial,
  describe: () => describe2,
  discriminatedUnion: () => discriminatedUnion,
  e164: () => e1642,
  email: () => email2,
  emoji: () => emoji2,
  encode: () => encode2,
  encodeAsync: () => encodeAsync2,
  endsWith: () => _endsWith,
  enum: () => _enum2,
  exactOptional: () => exactOptional,
  file: () => file,
  flattenError: () => flattenError,
  float32: () => float32,
  float64: () => float64,
  formatError: () => formatError,
  fromJSONSchema: () => fromJSONSchema,
  function: () => _function,
  getDiscriminatedOption: () => getDiscriminatedOption,
  getErrorMap: () => getErrorMap,
  globalRegistry: () => globalRegistry,
  gt: () => _gt,
  gte: () => _gte,
  guid: () => guid2,
  hash: () => hash,
  hex: () => hex2,
  hostname: () => hostname2,
  httpUrl: () => httpUrl,
  iban: () => iban2,
  includes: () => _includes,
  input: () => input,
  instanceof: () => _instanceof,
  int: () => int,
  int32: () => int32,
  int64: () => int64,
  intersection: () => intersection,
  invertCodec: () => invertCodec,
  ipv4: () => ipv42,
  ipv6: () => ipv62,
  iso: () => iso_exports,
  json: () => json,
  jwt: () => jwt,
  keyof: () => keyof,
  ksuid: () => ksuid2,
  lazy: () => lazy,
  length: () => _length,
  literal: () => literal,
  locales: () => zod_locales_exports,
  looseObject: () => looseObject,
  looseRecord: () => looseRecord,
  lowercase: () => _lowercase,
  lt: () => _lt,
  lte: () => _lte,
  mac: () => mac2,
  map: () => map,
  maxLength: () => _maxLength,
  maxSize: () => _maxSize,
  memoizer: () => memoizer,
  meta: () => meta2,
  mime: () => _mime,
  minLength: () => _minLength,
  minSize: () => _minSize,
  multipleOf: () => _multipleOf,
  nan: () => nan,
  nanoid: () => nanoid2,
  nativeEnum: () => nativeEnum,
  negative: () => _negative,
  never: () => never,
  nonnegative: () => _nonnegative,
  nonoptional: () => nonoptional,
  nonpositive: () => _nonpositive,
  normalize: () => _normalize,
  null: () => _null3,
  nullable: () => nullable,
  nullish: () => nullish2,
  number: () => number2,
  object: () => object,
  optional: () => optional,
  output: () => output,
  overwrite: () => _overwrite,
  parse: () => parse2,
  parseAsync: () => parseAsync2,
  partialRecord: () => partialRecord,
  pipe: () => pipe,
  positive: () => _positive,
  prefault: () => prefault,
  preprocess: () => preprocess,
  prettifyError: () => prettifyError,
  promise: () => promise,
  properties: () => _properties,
  property: () => _property,
  readonly: () => readonly,
  record: () => record,
  refine: () => refine,
  regex: () => _regex,
  regexes: () => regexes_exports,
  registry: () => registry,
  safeDecode: () => safeDecode2,
  safeDecodeAsync: () => safeDecodeAsync2,
  safeEncode: () => safeEncode2,
  safeEncodeAsync: () => safeEncodeAsync2,
  safeParse: () => safeParse2,
  safeParseAsync: () => safeParseAsync2,
  set: () => set,
  setErrorMap: () => setErrorMap,
  size: () => _size,
  slugify: () => _slugify,
  startsWith: () => _startsWith,
  strictObject: () => strictObject,
  string: () => string2,
  stringFormat: () => stringFormat,
  stringbool: () => stringbool,
  success: () => success,
  superRefine: () => superRefine,
  symbol: () => symbol,
  templateLiteral: () => templateLiteral,
  toJSONSchema: () => toJSONSchema,
  toLowerCase: () => _toLowerCase,
  toUpperCase: () => _toUpperCase,
  toZod: () => toZod,
  transform: () => transform,
  treeifyError: () => treeifyError,
  trim: () => _trim,
  tuple: () => tuple,
  uint32: () => uint32,
  uint64: () => uint64,
  ulid: () => ulid2,
  undefined: () => _undefined3,
  union: () => union,
  unknown: () => unknown,
  uppercase: () => _uppercase,
  url: () => url,
  util: () => util_exports,
  uuid: () => uuid2,
  uuidv4: () => uuidv4,
  uuidv6: () => uuidv6,
  uuidv7: () => uuidv7,
  validate: () => validate,
  validateAsync: () => validateAsync,
  void: () => _void2,
  withParser: () => withParser,
  xid: () => xid2,
  xor: () => xor
});
var init_external = __esm({
  "node_modules/zod/v4/classic/external.js"() {
    init_core2();
    init_schemas2();
    init_checks2();
    init_errors2();
    init_parse2();
    init_compat();
    init_core2();
    init_json_schema_processors();
    init_from_json_schema();
    init_deep_partial();
    init_in_out();
    init_zod_locales();
    init_iso();
    init_iso();
    init_coerce();
  }
});

// node_modules/zod/v4/classic/index.js
var init_classic = __esm({
  "node_modules/zod/v4/classic/index.js"() {
    init_external();
    init_external();
  }
});

// node_modules/zod/v4/index.js
var init_v4 = __esm({
  "node_modules/zod/v4/index.js"() {
    init_external();
    init_classic();
  }
});

// node_modules/@openuidev/lang-core/dist/index.mjs
function buildSystemPromptConfigProjection(spec) {
  const hasTools = (spec.tools?.length ?? 0) > 0;
  const toolCalls = spec.toolCalls ?? hasTools;
  const bindings = spec.bindings ?? toolCalls;
  const components = Object.entries(spec.components).sort(([left], [right]) => left.localeCompare(right)).map(([name, component]) => ({
    name,
    signature: component.signature,
    description: component.description ?? null
  }));
  const componentGroups = (spec.componentGroups ?? []).map((group) => ({
    name: group.name,
    components: [...group.components].sort(),
    notes: [...group.notes ?? []]
  })).sort((left, right) => left.name.localeCompare(right.name));
  return {
    root: spec.root ?? "Root",
    components,
    componentGroups,
    modes: {
      toolCalls,
      bindings,
      editMode: spec.editMode === true,
      inlineMode: spec.inlineMode === true
    }
  };
}
async function sha256(value) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("Web Crypto is unavailable");
  const bytes = new TextEncoder().encode(value);
  const digest = await subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function calculateSystemPromptConfigHash(spec) {
  return sha256(JSON.stringify(buildSystemPromptConfigProjection(spec)));
}
function getProcess() {
  const candidate = globalThis.process;
  if (!candidate || typeof candidate !== "object") return void 0;
  return candidate;
}
function hasBrowserWindow() {
  const target = globalThis;
  return target.navigator?.product === "ReactNative" || Boolean(target.window && target.document);
}
function isBrowserWorker() {
  const workerGlobalScope = globalThis.WorkerGlobalScope;
  return Boolean(workerGlobalScope && workerGlobalScope.prototype.isPrototypeOf(globalThis));
}
function detectRuntime() {
  if (hasBrowserWindow()) return void 0;
  const target = globalThis;
  const processLike = getProcess();
  if (target.Bun && typeof target.Bun === "object") return {
    name: "bun",
    version: target.Bun.version,
    env: processLike?.env,
    process: processLike
  };
  if (target.Deno && typeof target.Deno === "object") return {
    name: "deno",
    version: target.Deno.version?.deno
  };
  if (typeof target.EdgeRuntime === "string") return {
    name: "edge",
    version: target.EdgeRuntime
  };
  if (typeof target.WebSocketPair === "function") return { name: "edge" };
  if (isBrowserWorker()) return void 0;
  if (processLike?.release?.name === "node" || typeof processLike?.versions?.node === "string" && processLike.versions.node.length > 0) return {
    name: "node",
    version: processLike.versions?.node,
    env: processLike.env,
    process: processLike
  };
}
function getEnvironment(env) {
  const value = env?.NODE_ENV;
  if (value === "production" || value === "development" || value === "test") return value;
  return "unknown";
}
function getState() {
  const registry2 = globalThis;
  registry2[STATE_KEY] ??= { runtimeId: globalThis.crypto.randomUUID() };
  return registry2[STATE_KEY];
}
function readGitOrigin(processLike) {
  const execFile = processLike.getBuiltinModule?.("node:child_process")?.execFile;
  if (!execFile) return Promise.resolve(void 0);
  return new Promise((resolve) => {
    try {
      execFile("git", [
        "config",
        "--local",
        "--get",
        "remote.origin.url"
      ], {
        encoding: "utf8",
        timeout: 1e3,
        windowsHide: true
      }, (error2, stdout) => {
        const origin = stdout?.trim();
        resolve(error2 || !origin ? void 0 : origin);
      });
    } catch {
      resolve(void 0);
    }
  });
}
async function getRepositoryIdentifier(processLike) {
  if (!processLike) return void 0;
  const rawValue = await readGitOrigin(processLike) || processLike.env?.REPOSITORY_URL || processLike.cwd?.();
  return rawValue ? normalizeProjectIdentity(rawValue) || void 0 : void 0;
}
function calculateProjectHash(repositoryIdentifier) {
  const normalized = normalizeProjectIdentity(repositoryIdentifier);
  if (!normalized) return Promise.reject(/* @__PURE__ */ new TypeError("Repository identifier is empty"));
  return sha256(normalized);
}
function getProjectHash(state, runtime) {
  if (runtime.name !== "node") return Promise.resolve(void 0);
  state.projectHash ??= Promise.resolve().then(() => getRepositoryIdentifier(runtime.process)).then((identifier) => identifier ? calculateProjectHash(identifier) : void 0).catch(() => void 0);
  return state.projectHash;
}
async function getCIInfo(runtime) {
  if (!runtime.env) return {
    id: null,
    isCI: false
  };
  try {
    const ciInfo = await Promise.resolve().then(() => __toESM(require_ci_info(), 1));
    return {
      id: ciInfo.id,
      isCI: ciInfo.isCI
    };
  } catch {
    return {
      id: null,
      isCI: false
    };
  }
}
async function postCapture(event, properties, runtime) {
  const postHog = getPostHogConfig(runtime.env);
  await globalThis.fetch(postHog.captureUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      api_key: postHog.apiKey,
      event,
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      properties
    }),
    keepalive: true,
    signal: globalThis.AbortSignal.timeout(TELEMETRY_REQUEST_TIMEOUT_MS)
  });
}
async function sendSystemPromptCapture(state, spec, configHash, inputShape, runtime, environment) {
  const [systemPromptConfigHash, projectHash, ciInfo] = await Promise.all([
    configHash,
    getProjectHash(state, runtime),
    getCIInfo(runtime)
  ]);
  await postCapture(SYSTEM_PROMPT_EVENT_NAME, {
    distinct_id: state.runtimeId,
    $process_person_profile: false,
    event_id: globalThis.crypto.randomUUID(),
    telemetry_schema_version: 1,
    system_prompt_config_hash_version: 1,
    system_prompt_config_hash: systemPromptConfigHash,
    component_count: Object.keys(spec.components).length,
    tool_count: spec.tools?.length ?? 0,
    sdk_name: "@openuidev/lang-core",
    sdk_version: SDK_VERSION,
    api_surface: "generate_system_prompt",
    input_shape: inputShape,
    runtime: runtime.name,
    runtime_version: runtime.version,
    environment,
    ci: ciInfo.isCI,
    ...ciInfo.id ? { ci_name: ciInfo.id } : {},
    sample_rate: SYSTEM_PROMPT_SAMPLE_RATE,
    ...projectHash ? {
      project_hash_version: 1,
      project_hash: projectHash
    } : {}
  }, runtime);
}
function recordSystemPromptGeneration(spec, inputShape) {
  try {
    const runtime = detectRuntime();
    if (!runtime || typeof globalThis.fetch !== "function" || !globalThis.crypto?.subtle || typeof globalThis.crypto.randomUUID !== "function" || typeof globalThis.AbortSignal?.timeout !== "function") return;
    const env = runtime.env;
    const environment = getEnvironment(env);
    if (!isRuntimeTelemetryEnabled(env)) return;
    if (Math.random() >= SYSTEM_PROMPT_SAMPLE_RATE) return;
    const state = getState();
    const configHash = calculateSystemPromptConfigHash(spec);
    Promise.resolve().then(() => sendSystemPromptCapture(state, spec, configHash, inputShape, runtime, environment)).catch(() => void 0);
  } catch {
  }
}
function getValidationErrorCounts(result) {
  const counts = {
    "unknown-component": 0,
    "missing-required": 0,
    "null-required": 0,
    "inline-reserved": 0,
    "excess-args": 0
  };
  for (const error2 of result.meta.errors) counts[error2.code] += 1;
  return {
    unknown_component_count: counts["unknown-component"],
    missing_required_count: counts["missing-required"],
    null_required_count: counts["null-required"],
    inline_reserved_count: counts["inline-reserved"],
    excess_args_count: counts["excess-args"]
  };
}
function summarizeParserParse(result) {
  return {
    outcome: result.meta.errors.length > 0 ? "invalid" : result.root ? "valid" : "no_renderable_root",
    incomplete: result.meta.incomplete,
    has_renderable_root: result.root !== null,
    statement_count: result.meta.statementCount,
    unresolved_count: result.meta.unresolved.length,
    orphaned_count: result.meta.orphaned.length,
    validation_error_count: result.meta.errors.length,
    ...getValidationErrorCounts(result)
  };
}
async function sendParserParseCapture(context, outcome) {
  const { state, runtime, environment } = context;
  const [projectHash, ciInfo] = await Promise.all([getProjectHash(state, runtime), getCIInfo(runtime)]);
  await postCapture(PARSER_PARSE_EVENT_NAME, {
    distinct_id: state.runtimeId,
    $process_person_profile: false,
    event_id: globalThis.crypto.randomUUID(),
    telemetry_schema_version: 1,
    sdk_name: "@openuidev/lang-core",
    sdk_version: SDK_VERSION,
    api_surface: "parser.parse",
    runtime: runtime.name,
    runtime_version: runtime.version,
    environment,
    ci: ciInfo.isCI,
    ...ciInfo.id ? { ci_name: ciInfo.id } : {},
    sample_rate: PARSER_PARSE_SAMPLE_RATE,
    ...outcome,
    ...projectHash ? {
      project_hash_version: 1,
      project_hash: projectHash
    } : {}
  }, runtime);
}
function prepareParserParseTelemetry() {
  try {
    const runtime = detectRuntime();
    if (!runtime || typeof globalThis.fetch !== "function" || typeof globalThis.crypto?.randomUUID !== "function" || typeof globalThis.AbortSignal?.timeout !== "function") return;
    const env = runtime.env;
    if (!isRuntimeTelemetryEnabled(env)) return void 0;
    if (Math.random() >= PARSER_PARSE_SAMPLE_RATE) return void 0;
    return {
      state: getState(),
      runtime,
      environment: getEnvironment(env)
    };
  } catch {
    return;
  }
}
function captureParserParseResult(context, result) {
  if (!context) return;
  try {
    const outcome = summarizeParserParse(result);
    Promise.resolve().then(() => sendParserParseCapture(context, outcome)).catch(() => void 0);
  } catch {
  }
}
function captureParserParseException(context) {
  if (!context) return;
  try {
    Promise.resolve().then(() => sendParserParseCapture(context, { outcome: "threw" })).catch(() => void 0);
  } catch {
  }
}
function resolveField(obj, path) {
  if (!path || obj == null) return void 0;
  if (!path.includes(".")) return obj[path];
  let cur = obj;
  for (const p of path.split(".")) {
    if (cur == null) return void 0;
    cur = cur[p];
  }
  return cur;
}
function toNumber(val) {
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    const n = Number(val);
    return isNaN(n) ? 0 : n;
  }
  if (typeof val === "boolean") return val ? 1 : 0;
  return 0;
}
function isBuiltin(name) {
  return BUILTIN_NAMES.has(name);
}
function isReservedCall(name) {
  return name in RESERVED_CALLS;
}
function isPlainObject2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function collectRefIssues(node2, path, defNames, issues) {
  if (Array.isArray(node2)) {
    node2.forEach((item, i) => collectRefIssues(item, `${path}/${i}`, defNames, issues));
    return;
  }
  if (!isPlainObject2(node2)) return;
  const ref = node2["$ref"];
  if (typeof ref === "string") {
    const match = REF_PATTERN.exec(ref);
    if (!match || !defNames.has(match[1])) issues.push({
      code: "unresolved-ref",
      message: `Unresolvable $ref "${ref}" at ${path} — refs must be "#/$defs/<name>" pointing at a component in $defs.`,
      path
    });
  }
  for (const [key, value] of Object.entries(node2)) {
    if (key === "$ref") continue;
    collectRefIssues(value, `${path}/${key}`, defNames, issues);
  }
}
function validateChatLibrary(library2) {
  const issues = [];
  if (!isPlainObject2(library2)) return [{
    code: "invalid-shape",
    message: "chatLibrary must be an object."
  }];
  const { root, schema, componentGroups } = library2;
  if (root !== void 0 && (typeof root !== "string" || root.length === 0)) issues.push({
    code: "invalid-shape",
    message: "chatLibrary.root, when present, must be a non-empty string.",
    path: "root"
  });
  if (!isPlainObject2(schema)) {
    issues.push({
      code: "invalid-shape",
      message: "chatLibrary.schema must be an object with a $defs map of component schemas.",
      path: "schema"
    });
    return issues;
  }
  const defs = schema.$defs;
  if (!isPlainObject2(defs) || Object.keys(defs).length === 0) {
    issues.push({
      code: "invalid-shape",
      message: "chatLibrary.schema.$defs must be a non-empty object keyed by component name.",
      path: "schema/$defs"
    });
    return issues;
  }
  const defNames = new Set(Object.keys(defs));
  if (typeof root === "string" && root.length > 0 && !defNames.has(root)) issues.push({
    code: "root-not-found",
    message: `Root component "${root}" was not found in schema.$defs. Available components: ${[...defNames].join(", ")}.`,
    path: "root"
  });
  for (const [name, def] of Object.entries(defs)) {
    const defPath = `$defs/${name}`;
    if (!isPlainObject2(def)) {
      issues.push({
        code: "invalid-shape",
        message: `${defPath} must be an object component schema.`,
        path: defPath
      });
      continue;
    }
    const properties = def["properties"];
    if (properties !== void 0 && !isPlainObject2(properties)) issues.push({
      code: "invalid-shape",
      message: `${defPath}/properties must be an object.`,
      path: `${defPath}/properties`
    });
    const required2 = def["required"];
    if (required2 !== void 0) if (!Array.isArray(required2) || required2.some((r) => typeof r !== "string")) issues.push({
      code: "invalid-required",
      message: `${defPath}/required must be an array of property names.`,
      path: `${defPath}/required`
    });
    else {
      const propKeys = new Set(isPlainObject2(properties) ? Object.keys(properties) : []);
      for (const r of required2) if (!propKeys.has(r)) issues.push({
        code: "invalid-required",
        message: `${defPath} lists required property "${r}" that is not in properties.`,
        path: `${defPath}/required`
      });
    }
    collectRefIssues(properties, `${defPath}/properties`, defNames, issues);
  }
  for (const group of componentGroups ?? []) {
    if (!isPlainObject2(group) || typeof group.name !== "string" || !Array.isArray(group.components)) {
      issues.push({
        code: "invalid-shape",
        message: "Each componentGroups entry must be {name: string, components: string[], notes?: string[]}.",
        path: "componentGroups"
      });
      continue;
    }
    for (const comp of group.components) if (typeof comp !== "string" || !defNames.has(comp)) issues.push({
      code: "unknown-group-component",
      message: `Component group "${group.name}" references unknown component "${String(comp)}".`,
      path: "componentGroups"
    });
  }
  return issues;
}
function pickCloudPromptOptions(options) {
  if (!options) return void 0;
  const picked = {};
  if (options.examples) picked.examples = options.examples;
  if (options.preamble) picked.preamble = options.preamble;
  if (options.additionalRules) picked.additionalRules = options.additionalRules;
  return Object.keys(picked).length > 0 ? picked : void 0;
}
function generateCloudConfig(spec) {
  let config2;
  if (spec.library) {
    const issues = validateChatLibrary(spec.library);
    if (issues.length > 0) throw new Error(`[generateSystemPrompt] Invalid library: ${issues.map((i) => i.message).join(" ")}`);
    const { components: _components, ...chatLibrary } = spec.library;
    const promptOptions = pickCloudPromptOptions(spec.promptOptions);
    config2 = {
      chatLibrary,
      ...promptOptions ? { systemPromptOptions: promptOptions } : {}
    };
  } else {
    if (spec.promptOptions && pickCloudPromptOptions(spec.promptOptions)) throw new Error("[generateSystemPrompt] promptOptions requires a library — the built-in library ignores it.");
    config2 = { libraryVersion: CLOUD_CHAT_LIBRARY_VERSION };
  }
  const block = `${CLOUD_CONFIG_MARKER}${JSON.stringify(config2)}`;
  return spec.instructions ? `${block}
${spec.instructions}` : block;
}
function jsonSchemaTypeStr(schema) {
  const type = schema.type;
  if (type === "string") {
    const enumVals = schema.enum;
    if (enumVals) return enumVals.map((v) => `"${v}"`).join(" | ");
    return "string";
  }
  if (type === "number" || type === "integer") return "number";
  if (type === "boolean") return "boolean";
  if (type === "array") {
    const items = schema.items;
    if (items) return `${jsonSchemaTypeStr(items)}[]`;
    return "any[]";
  }
  if (type === "object") {
    const props = schema.properties;
    if (props && Object.keys(props).length > 0) {
      const required2 = schema.required ?? [];
      return `{${Object.entries(props).map(([k, v]) => {
        return `${k}${required2.includes(k) ? "" : "?"}: ${jsonSchemaTypeStr(v)}`;
      }).join(", ")}}`;
    }
    return "object";
  }
  return "any";
}
function defaultForSchema(schema) {
  const type = schema.type;
  if (type === "string") return "";
  if (type === "number" || type === "integer") return 0;
  if (type === "boolean") return false;
  if (type === "array") return [];
  if (type === "object") {
    const props = schema.properties;
    if (props && Object.keys(props).length > 0) {
      const result = {};
      for (const [k, v] of Object.entries(props)) result[k] = defaultForSchema(v);
      return result;
    }
    return {};
  }
  return null;
}
function syntaxRules(rootName, flags) {
  const lines = [
    "## Syntax Rules",
    "",
    "1. Each statement is on its own line: `identifier = Expression`",
    `2. \`root\` is the entry point — every program must define \`root = ${rootName}(...)\``,
    '3. Expressions are: strings ("..."), numbers, booleans (true/false), null, arrays ([...]), objects ({...}), or component calls TypeName(arg1, arg2, ...)',
    "4. Use references for readability: define `name = ...` on one line, then use `name` later",
    "5. EVERY variable (except root) MUST be referenced by at least one other variable. Unreferenced variables are silently dropped and will NOT render. Always include defined variables in their parent's children/items array.",
    '6. Arguments are POSITIONAL (order matters, not names). Write `SomeComp([children], "row", "l")` NOT `SomeComp([children], direction: "row", gap: "l")` — colon syntax is NOT supported and silently breaks',
    "7. Optional arguments can be omitted from the end"
  ];
  let ruleNum = 8;
  if (flags.bindings) lines.push(`${ruleNum++}. Declare mutable state with \`$varName = defaultValue\`. Components marked with \`$binding\` can read/write these. Undeclared $variables are auto-created with null default.`);
  if (flags.supportsExpressions) lines.push(`${ruleNum++}. String concatenation: \`"text" + $var + "more"\``, `${ruleNum++}. Dot member access: \`query.field\` reads a field; on arrays it extracts that field from every element`, `${ruleNum++}. Index access: \`arr[0]\`, \`data[index]\``, `${ruleNum++}. Arithmetic operators: +, -, *, /, % (work on numbers; + is string concat when either side is a string)`, `${ruleNum++}. Comparison: ==, !=, >, <, >=, <=`, `${ruleNum++}. Logical: &&, ||, ! (prefix)`, `${ruleNum++}. Ternary: \`condition ? valueIfTrue : valueIfFalse\``, `${ruleNum++}. Parentheses for grouping: \`(a + b) * c\``);
  lines.push("- Strings use double quotes with backslash escaping");
  return lines.join("\n");
}
function builtinFunctionsSection() {
  const builtinLines = Object.values(BUILTINS).map((b) => `@${b.signature} — ${b.description}`);
  const lazyLines = Object.values(LAZY_BUILTIN_DEFS).map((b) => `@${b.signature} — ${b.description}`);
  return `## Built-in Functions

Data functions prefixed with \`@\` to distinguish from components. These are the ONLY functions available — do NOT invent new ones.
Use @-prefixed built-in functions (@Count, @Sum, @Avg, @Min, @Max, @Round) on Query results — do NOT hardcode computed values.

${[...builtinLines, ...lazyLines].join("\n")}

Builtins compose — output of one is input to the next:
\`@Count(@Filter(data.rows, "field", "==", "val"))\` for KPIs/chart values, \`@Round(@Avg(data.rows.score), 1)\`, \`@Each(data.rows, "item", Comp(item.field))\` for per-item rendering.
Array pluck: \`data.rows.field\` extracts a field from every row → use with @Sum, @Avg, charts, tables.

IMPORTANT @Each rule: The loop variable (e.g. "item") is ONLY available inside the @Each template expression. Always inline the template — do NOT extract it to a separate statement.
CORRECT: \`Col("Actions", @Each(rows, "t", Button("Edit", Action([@Set($id, t.id)]))))\`
WRONG: \`myBtn = Button("Edit", Action([@Set($id, t.id)]))\` then \`Col("Actions", @Each(rows, "t", myBtn))\` — t is undefined in myBtn.`;
}
function querySection() {
  return `## Query — Live Data Fetching

Fetch data from available tools. Returns defaults instantly, swaps in real data when it arrives.

\`\`\`
metrics = Query("tool_name", {arg1: value, arg2: $binding}, {defaultField: 0, defaultData: []}, refreshInterval?)
\`\`\`

- First arg: tool name (string)
- Second arg: arguments object (may reference $bindings — re-fetches automatically on change)
- Third arg: default data (rendered immediately before fetch resolves)
- Fourth arg (optional): refresh interval in seconds (e.g. 30 for auto-refresh every 30s)
- Use dot access on results: metrics.totalEvents, metrics.data.day (array pluck)
- Query results must use regular identifiers: \`metrics = Query(...)\`, NOT \`$metrics = Query(...)\`
- Manual refresh: \`Button("Refresh", Action([@Run(query1), @Run(query2)]), "secondary")\` — re-fetches the listed queries
- Refresh all queries: create Action with @Run for each query`;
}
function mutationSection() {
  return `## Mutation — Write Operations

Execute state-changing tool calls (create, update, delete). Unlike Query (auto-fetches on render), Mutation fires only on button click via Action.

\`\`\`
result = Mutation("tool_name", {arg1: $binding, arg2: "value"})
\`\`\`

- First arg: tool name (string)
- Second arg: arguments object (evaluated with current $binding values at click time)
- result.status: "idle" | "loading" | "success" | "error"
- result.data: tool response on success
- result.error: error message on failure
- Mutation results use regular identifiers: \`result = Mutation(...)\`, NOT \`$result\`
- Show loading state: \`result.status == "loading" ? TextContent("Saving...") : null\``;
}
function actionSection(flags) {
  const steps = ['- @ToAssistant("message") — Send a message to the assistant (for conversational buttons like "Tell me more", "Explain this")', '- @OpenUrl("https://...") — Navigate to a URL'];
  if (flags.bindings) steps.push("- @Set($variable, value) — Set a $variable to a specific value", '- @Reset($var1, $var2, ...) — Reset $variables to their declared defaults (e.g. @Reset($title, $priority) restores $title="" and $priority="medium")');
  if (flags.toolCalls) steps.unshift("- @Run(queryOrMutationRef) — Execute a Mutation or re-fetch a Query (ref must be a declared Query/Mutation)");
  const examples = [];
  if (flags.toolCalls) examples.push(`Example — mutation + refresh + reset (PREFERRED pattern):
\`\`\`
$binding = "default"
result = Mutation("tool_name", {field: $binding})
data = Query("tool_name", {}, {rows: []})
onSubmit = Action([@Run(result), @Run(data), @Reset($binding)])
\`\`\``);
  examples.push(`Example — simple nav:
\`\`\`
viewBtn = Button("View", Action([@OpenUrl("https://example.com")]))
\`\`\``);
  const rules = ['- Action can be assigned to a variable or inlined: Button("Go", onSubmit) and Button("Go", Action([...])) both work'];
  if (flags.toolCalls) rules.push("- If a @Run(mutation) step fails, remaining steps are skipped (halt on failure)", "- @Run(queryRef) re-fetches the query (fire-and-forget, cannot fail)");
  return `## Action — Button Behavior

Action([@steps...]) wires button clicks to operations. Steps are @-prefixed built-in actions. Steps execute in order.
Buttons without an explicit Action prop automatically send their label to the assistant (equivalent to Action([@ToAssistant(label)])).

Available steps:
${steps.join("\n")}

${examples.join("\n\n")}

${rules.join("\n")}`;
}
function interactiveFiltersSection() {
  return `## Interactive Filters

To let the user filter data with a dropdown:
1. Declare a $variable with a default: \`$dateRange = "14"\`
2. Create a Select with name, items, and binding: \`Select("dateRange", [SelectItem("7", "Last 7 days"), ...], null, null, $dateRange)\`
3. Wrap in FormControl for a label: \`FormControl("Date Range", Select(...))\`
4. Pass $dateRange in Query args: \`Query("tool", {dateRange: $dateRange}, {defaults})\`
5. When the user changes the Select, $dateRange updates and the Query automatically re-fetches

FILTER WIRING RULE: If a $binding filter is visible in the UI, EVERY relevant Query MUST reference that $binding in its args. Never show a filter dropdown while hardcoding the query args.

Rules for $variables:
- $variables hold simple values (strings or numbers), NOT arrays or objects
- $variables must be bound to a Select/Input component via the value argument (last positional arg) to be interactive
- Queries must use regular identifiers (NOT $variables): \`metrics = Query(...)\` not \`$metrics = Query(...)\`
- **Auto-declare**: You do NOT need to explicitly declare $variables. If you use \`$foo\` without declaring it, the parser auto-creates \`$foo = null\`. You can still declare explicitly to set a default: \`$days = "14"\`

## Forms

Simple form — no $bindings needed. Field values are managed internally by the Form via the name prop:
\`\`\`
contactForm = Form("contact", submitBtn, [nameField, emailField])
nameField = FormControl("Name", Input("name", "Your name", "text", {required: true}))
emailField = FormControl("Email", Input("email", "your@email.com", "email", {required: true, email: true}))
submitBtn = Button("Submit")
\`\`\`

Use $bindings when you need to read field values elsewhere (in Action context, Query args, or conditionals). They are auto-declared:
\`\`\`
$role = "engineer"
contactForm = Form("contact", submitBtn, [nameField, emailField, roleField])
nameField = FormControl("Name", Input("name", "Enter your name", "text", {required: true}, $name))
emailField = FormControl("Email", Input("email", "Enter your email", "email", {required: true, email: true}, $email))
roleField = FormControl("Role", Select("role", [SelectItem("engineer", "Engineer"), SelectItem("designer", "Designer"), SelectItem("pm", "PM")], null, {required: true}, $role))
submitBtn = Button("Submit")
\`\`\`

For form + mutation patterns (create, refresh, reset), see the Action section example above.

IMPORTANT: Always add validation rules to form fields used with Mutations. Use OBJECT syntax: {required: true, email: true, minLength: 8}. The renderer shows error messages automatically and blocks submit when validation fails.`;
}
function editModeSection() {
  return `## Edit Mode

The runtime merges by statement name: same name = replace, new name = append.
Output ONLY statements that changed or are new. Everything else is kept automatically.

### Delete
To remove a component, re-declare its parent without that component in the parent's children array. The removed component and any statements only it referenced are automatically garbage-collected.

### Patch size guide
- Changing a title or label: 1 statement
- Adding a component: 2-3 statements (the new component + parent update)
- Removing a component: 1 statement (re-declare parent without the removed child)
- Adding a filter + wiring to query: 3-5 statements
- Restructuring into tabs: 5-10 statements

### Rules
- Reuse existing statement names exactly — do not rename
- Do NOT re-emit unchanged statements — the runtime keeps them
- A typical edit patch is 1-10 statements, not 20+
- If the existing code already satisfies the request, output only the root statement
- NEVER output the entire program as a patch. Only output what actually changes
- If you are about to output more than 10 statements, reconsider — most edits need fewer`;
}
function streamingRules(rootName, flags) {
  const steps = [`1. \`root = ${rootName}(...)\` — UI shell appears immediately`];
  if (flags.supportsExpressions) {
    steps.push("2. $variable declarations — state ready for bindings");
    steps.push("3. Query statements — defaults resolve immediately so components render with data");
    steps.push("4. Component definitions — fill in with data already available");
    steps.push("5. Data values — leaf content last");
  } else {
    steps.push("2. Component definitions — fill in as they stream");
    steps.push("3. Data values — leaf content last");
  }
  return `## Hoisting & Streaming (CRITICAL)

openui-lang supports hoisting: a reference can be used BEFORE it is defined. The parser resolves all references after the full input is parsed.

During streaming, the output is re-parsed on every chunk. Undefined references are temporarily unresolved and appear once their definitions stream in. This creates a progressive top-down reveal — structure first, then data fills in.

**Recommended statement order for optimal streaming:**
${steps.join("\n")}

Always write the root = ${rootName}(...) statement first so the UI shell appears immediately, even before child data has streamed in.`;
}
function inlineModeSection() {
  return `## Inline Mode

You are in inline mode. You can respond in two ways:

### 1. Code response (when the user wants to CREATE or CHANGE the UI)
Wrap openui-lang code in triple-backtick fences. You can include explanatory text before/after:

Here's your dashboard:

\`\`\`openui-lang
root = RootComp([header, content])
header = SomeHeader("Title")
content = SomeContent("Hello world")
\`\`\`

I created a simple layout with a header.

### 2. Text-only response (when the user asks a QUESTION)
If the user asks "what is this?", "explain the chart", "how does this work", etc. — respond with plain text. Do NOT output any openui-lang code. The existing dashboard stays unchanged.

### Rules
- When the user asks for changes, output ONLY the changed/new statements in a fenced block
- When the user asks a question, respond with text only — NO code. The dashboard stays unchanged.
- The parser extracts code from fences automatically. Text outside fences is shown as chat.`;
}
function toolWorkflowSection() {
  return `## Data Workflow

When tools are available, follow this workflow:
1. FIRST: Call the most relevant tool to inspect the real data shape before generating code
2. Use Query() for READ operations (data that should stay live) — NEVER hardcode tool results as literal arrays or objects
3. Use Mutation() for WRITE operations (create, update, delete) — triggered by button clicks via Action([@Run(mutationRef)])
4. Use the real data from step 1 as condensed Query defaults (3-5 rows) so the UI renders immediately
5. Use @-prefixed builtins (@Count, @Filter, @Sort, @Sum) on Query results for KPIs and aggregations — the runtime evaluates these live on every refresh
6. Hardcoded arrays are ONLY for static display data (labels, options) where no tool exists

WRONG — you called a tool and got data back, but you inlined the results:
\`\`\`
openCount = 2
item1 = SomeComp("first item title")
item2 = SomeComp("second item title")
list = SomeList([item1, item2])
chart = SomeChart(["A", "B"], [12, 8])
\`\`\`
This is static — it shows stale data and won't update. Creating item1, item2, item3... manually is ALWAYS wrong when a tool exists.

RIGHT — use Query() for live data, Mutation() for writes, @builtins to derive values:
\`\`\`
data = Query("tool_name", {}, {rows: []})
openCount = @Count(@Filter(data.rows, "field", "==", "value"))
list = @Each(data.rows, "item", SomeComp(item.title, item.field))
createResult = Mutation("create_tool", {title: $title})
submitBtn = Button("Create", Action([@Run(createResult), @Run(data), @Reset($title)]))
\`\`\`
Everything derives from the Query — when data refreshes, the entire dashboard updates automatically.`;
}
function importantRules(rootName, flags) {
  const verifyLines = [`1. root = ${rootName}(...) is the FIRST line (for optimal streaming).`, "2. Every referenced name is defined. Every defined name (other than root) is reachable from root."];
  if (flags.toolCalls) verifyLines.push("3. Every Query result is referenced by at least one component.");
  if (flags.bindings) verifyLines.push(`${flags.toolCalls ? "4" : "3"}. Every $binding appears in at least one component or expression.`);
  if (flags.toolCalls && flags.bindings) verifyLines.push("5. Every visible filter $binding appears in at least one Query args object.");
  return `## Important Rules
- Choose components that best represent the content (tables for comparisons, charts for trends, forms for input, etc.)

## Final Verification
Before finishing, walk your output and verify:
${verifyLines.join("\n")}`;
}
function renderToolSignature(tool) {
  let args = "";
  if (tool.inputSchema) {
    const props = tool.inputSchema.properties;
    const required2 = tool.inputSchema.required ?? [];
    if (props && Object.keys(props).length > 0) args = Object.entries(props).map(([k, v]) => {
      return `${k}${required2.includes(k) ? "" : "?"}: ${jsonSchemaTypeStr(v)}`;
    }).join(", ");
  }
  let returnType = "";
  if (tool.outputSchema) returnType = ` → ${jsonSchemaTypeStr(tool.outputSchema)}`;
  let line = `- ${tool.name}(${args})${returnType}`;
  if (tool.description) line += `
  ${tool.description}`;
  return line;
}
function renderToolsSection(tools) {
  const lines = [];
  const stringTools = [];
  const specTools = [];
  for (const tool of tools) if (typeof tool === "string") stringTools.push(tool);
  else specTools.push(tool);
  lines.push("## Available Tools");
  lines.push("");
  lines.push("Use these with Query() for read operations or Mutation() for write operations. The LLM decides which is appropriate based on the tool's purpose.");
  lines.push("");
  for (const t2 of stringTools) lines.push(`- ${t2}`);
  for (const t2 of specTools) lines.push(renderToolSignature(t2));
  const toolsWithOutput = specTools.filter((t2) => t2.outputSchema);
  if (toolsWithOutput.length > 0) {
    lines.push("");
    lines.push("### Default values for Query results");
    lines.push("");
    lines.push("Use these shapes as minimal Query defaults:");
    for (const t2 of toolsWithOutput) {
      const defaults = defaultForSchema(t2.outputSchema);
      lines.push(`- ${t2.name}: \`${JSON.stringify(defaults)}\``);
    }
  }
  lines.push("");
  lines.push("CRITICAL: Use ONLY the tools listed above in Query() and Mutation() calls. Do NOT invent or guess tool names. If the user asks for functionality that doesn't match any available tool, use realistic mock data instead of fabricating a tool call.");
  return lines.join("\n");
}
function generateComponentSignatures(spec, flags) {
  const lines = [
    "## Component Signatures",
    "",
    "Arguments marked with ? are optional. Sub-components can be inline or referenced; prefer references for better streaming."
  ];
  if (flags.usesActionExpression) {
    const allSteps = [
      flags.toolCalls ? "@Run" : "",
      "@ToAssistant",
      "@OpenUrl",
      flags.bindings ? "@Set" : "",
      flags.bindings ? "@Reset" : ""
    ].filter(Boolean);
    lines.push(`Props typed \`ActionExpression\` accept an Action([@steps...]) expression. See the Action section for available steps (${allSteps.join(", ")}).`);
  }
  if (flags.bindings || Object.values(spec.components).some((c) => c.signature?.includes("$binding"))) lines.push("Props marked `$binding<type>` accept a `$variable` reference for two-way binding.");
  const formatSig = (comp) => comp.description ? `${comp.signature} — ${comp.description}` : comp.signature;
  if (spec.componentGroups?.length) {
    const grouped = /* @__PURE__ */ new Set();
    for (const group of spec.componentGroups) {
      lines.push("", `### ${group.name}`);
      for (const name of group.components) {
        if (grouped.has(name)) continue;
        const comp = spec.components[name];
        if (!comp) continue;
        grouped.add(name);
        lines.push(formatSig(comp));
      }
      if (group.notes?.length) for (const note of group.notes) lines.push(note);
    }
    const ungrouped = Object.keys(spec.components).filter((n) => !grouped.has(n));
    if (ungrouped.length) {
      lines.push("", "### Other");
      for (const name of ungrouped) {
        const comp = spec.components[name];
        lines.push(formatSig(comp));
      }
    }
  } else {
    lines.push("");
    for (const [, comp] of Object.entries(spec.components)) lines.push(formatSig(comp));
  }
  return lines.join("\n");
}
function generatePrompt(spec) {
  const rootName = spec.root ?? "Root";
  const hasTools = !!spec.tools?.length;
  const toolCalls = spec.toolCalls ?? hasTools;
  const bindings = spec.bindings ?? toolCalls;
  const supportsExpressions = toolCalls || bindings;
  const usesActionExpression = Object.values(spec.components).some((c) => c.signature?.includes("ActionExpression"));
  const parts = [];
  parts.push(spec.preamble ?? PREAMBLE);
  parts.push("");
  parts.push(syntaxRules(rootName, {
    supportsExpressions,
    bindings
  }));
  parts.push("");
  parts.push(generateComponentSignatures(spec, {
    toolCalls,
    bindings,
    usesActionExpression
  }));
  if (supportsExpressions) {
    parts.push("");
    parts.push(builtinFunctionsSection());
  }
  if (toolCalls) {
    parts.push("");
    parts.push(querySection());
    parts.push("");
    parts.push(mutationSection());
  }
  if (usesActionExpression) {
    parts.push("");
    parts.push(actionSection({
      toolCalls,
      bindings
    }));
  }
  if (toolCalls && bindings) {
    parts.push("");
    parts.push(interactiveFiltersSection());
  }
  if (toolCalls) {
    parts.push("");
    parts.push(toolWorkflowSection());
  }
  if (spec.tools?.length) {
    parts.push("");
    parts.push(renderToolsSection(spec.tools));
  }
  parts.push("");
  parts.push(streamingRules(rootName, { supportsExpressions }));
  const allExamples = [...spec.examples ?? [], ...spec.toolExamples ?? []];
  if (allExamples.length) {
    parts.push("");
    parts.push("## Examples");
    parts.push("");
    for (const ex of allExamples) {
      parts.push(ex);
      parts.push("");
    }
  }
  if (spec.editMode) {
    parts.push("");
    parts.push(editModeSection());
  }
  if (spec.inlineMode) {
    parts.push("");
    parts.push(inlineModeSection());
  }
  parts.push(importantRules(rootName, {
    toolCalls,
    bindings
  }));
  if (spec.additionalRules?.length) {
    parts.push("");
    for (const rule of spec.additionalRules) parts.push(`- ${rule}`);
  }
  return parts.join("\n");
}
function generateSystemPrompt(spec) {
  if (isCloudSpec(spec)) return generateCloudConfig(spec);
  if (!isSystemPromptSpec(spec)) {
    const prompt2 = generatePrompt(spec);
    recordSystemPromptGeneration(spec, "legacy_prompt_spec");
    return prompt2;
  }
  const merged = {
    ...spec.library,
    ...spec.promptOptions
  };
  const prompt = generatePrompt(merged);
  recordSystemPromptGeneration(merged, "library_spec");
  return prompt;
}
function isCloudSpec(spec) {
  return "cloud" in spec && spec.cloud === true;
}
function isSystemPromptSpec(spec) {
  return "library" in spec && typeof spec.library === "object";
}
function markReactive(schema) {
  reactiveSchemas.add(schema);
}
function isReactiveSchema(schema) {
  return typeof schema === "object" && schema !== null && reactiveSchemas.has(schema);
}
function tagSchemaId(schema, id) {
  schemaIdTags.set(schema, id);
}
function assertV4Schema(schema, componentName) {
  if (schema != null && typeof schema === "object" && "_def" in schema && !("_zod" in schema)) throw new Error(`[OpenUI] Component "${componentName}" was defined with a Zod 3 schema. OpenUI requires Zod 4 schemas. If you're on zod@3.25+, import from "zod/v4" instead of "zod". See: https://zod.dev/v4/versioning`);
}
function defineComponent(config2) {
  assertV4Schema(config2.props, config2.name);
  schemaIdTags.set(config2.props, config2.name);
  return {
    ...config2,
    ref: config2.props
  };
}
function getZodDef(schema) {
  return schema?._zod?.def;
}
function getZodType(schema) {
  return getZodDef(schema)?.type;
}
function isOptionalType(schema) {
  const type = getZodType(schema);
  return type === "optional" || type === "default" || type === "nullable";
}
function unwrap(schema) {
  let s = schema;
  let def = getZodDef(s);
  while (def?.type === "optional" || def?.type === "default" || def?.type === "nullable") {
    s = def.innerType;
    def = getZodDef(s);
  }
  return s;
}
function isArrayType(schema) {
  return getZodType(unwrap(schema)) === "array";
}
function getArrayInnerType(schema) {
  const def = getZodDef(unwrap(schema));
  if (def?.type === "array") return def.element ?? def.innerType;
}
function getEnumValues2(schema) {
  const def = getZodDef(unwrap(schema));
  if (def?.type !== "enum") return void 0;
  if (Array.isArray(def.values)) return def.values;
  if (def.entries && typeof def.entries === "object") return Object.keys(def.entries);
}
function getSchemaId(schema, reg) {
  try {
    const meta3 = reg.get(schema);
    if (meta3?.id) return meta3.id;
  } catch {
  }
  if (typeof schema === "object" && schema !== null) return schemaIdTags.get(schema);
}
function getUnionOptions(schema) {
  const def = getZodDef(schema);
  if (def?.type === "union" && Array.isArray(def.options)) return def.options;
}
function getObjectShape(schema) {
  const def = getZodDef(schema);
  if (def?.type === "object" && def.shape && typeof def.shape === "object") return def.shape;
}
function resolveTypeAnnotation(schema, reg) {
  const isReactive = isReactiveSchema(schema);
  const baseType = resolveBaseType(unwrap(schema), reg);
  if (!baseType) return void 0;
  return isReactive ? `$binding<${baseType}>` : baseType;
}
function resolveBaseType(inner, reg) {
  const directId = getSchemaId(inner, reg);
  if (directId) return directId;
  const unionOpts = getUnionOptions(inner);
  if (unionOpts) {
    const names = unionOpts.map((o) => resolveTypeAnnotation(o, reg)).filter(Boolean);
    if (names.length > 0) return names.join(" | ");
  }
  if (isArrayType(inner)) {
    const arrayInner = getArrayInnerType(inner);
    if (!arrayInner) return void 0;
    const innerType = resolveTypeAnnotation(arrayInner, reg);
    if (innerType) return getUnionOptions(unwrap(arrayInner)) !== void 0 ? `(${innerType})[]` : `${innerType}[]`;
    return;
  }
  const zodType = getZodType(inner);
  if (zodType === "string") return "string";
  if (zodType === "number") return "number";
  if (zodType === "boolean") return "boolean";
  if (zodType === "any") return "any";
  if (zodType === "record") {
    const def = getZodDef(inner);
    return `Record<${resolveTypeAnnotation(def?.keyType, reg) ?? "string"}, ${resolveTypeAnnotation(def?.valueType, reg) ?? "any"}>`;
  }
  const enumVals = getEnumValues2(inner);
  if (enumVals) return enumVals.map((v) => `"${v}"`).join(" | ");
  if (zodType === "literal") {
    const vals = getZodDef(inner)?.values;
    if (Array.isArray(vals) && vals.length === 1) {
      const v = vals[0];
      return typeof v === "string" ? `"${v}"` : String(v);
    }
  }
  const shape = getObjectShape(inner);
  if (shape) return `{${Object.entries(shape).map(([name, fieldSchema]) => {
    const opt = isOptionalType(fieldSchema) ? "?" : "";
    const fieldType = resolveTypeAnnotation(fieldSchema, reg);
    return fieldType ? `${name}${opt}: ${fieldType}` : `${name}${opt}`;
  }).join(", ")}}`;
  return "any";
}
function analyzeFields(shape, reg) {
  return Object.entries(shape).map(([name, schema]) => ({
    name,
    isOptional: isOptionalType(schema),
    isArray: isArrayType(schema),
    typeAnnotation: resolveTypeAnnotation(schema, reg)
  }));
}
function buildSignature(componentName, fields) {
  return `${componentName}(${fields.map((f) => {
    if (f.typeAnnotation) return f.isOptional ? `${f.name}?: ${f.typeAnnotation}` : `${f.name}: ${f.typeAnnotation}`;
    if (f.isArray) return f.isOptional ? `[${f.name}]?` : `[${f.name}]`;
    return f.isOptional ? `${f.name}?` : f.name;
  }).join(", ")})`;
}
function buildComponentSpecs(components, reg) {
  const specs = {};
  for (const [name, def] of Object.entries(components)) specs[name] = {
    signature: buildSignature(name, analyzeFields(def.props.shape, reg)),
    description: def.description
  };
  return specs;
}
function createLibraryId() {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  fallbackLibraryId += 1;
  return `openui-lib-${Date.now().toString(36)}-${fallbackLibraryId.toString(36)}`;
}
function createLibrary(input2) {
  const componentsRecord = {};
  const reg = registry();
  const __libraryId = createLibraryId();
  for (const comp of input2.components) {
    reg.add(comp.props, { id: comp.name });
    componentsRecord[comp.name] = comp;
  }
  if (input2.root && !componentsRecord[input2.root]) {
    const available = Object.keys(componentsRecord).join(", ");
    throw new Error(`[createLibrary] Root component "${input2.root}" was not found in components. Available components: ${available}`);
  }
  const library2 = {
    components: componentsRecord,
    componentGroups: input2.componentGroups,
    root: input2.root,
    id: input2.id,
    __libraryId,
    prompt(options) {
      return generatePrompt({
        root: input2.root,
        components: buildComponentSpecs(componentsRecord, reg),
        componentGroups: input2.componentGroups,
        ...options
      });
    },
    toSpec() {
      return {
        root: input2.root,
        components: buildComponentSpecs(componentsRecord, reg),
        componentGroups: input2.componentGroups,
        schema: buildJSONSchema(),
        ...input2.id !== void 0 ? { id: input2.id } : {}
      };
    },
    toJSONSchema() {
      return buildJSONSchema();
    }
  };
  function buildJSONSchema() {
    const combinedSchema = object(Object.fromEntries(Object.entries(componentsRecord).map(([k, v]) => [k, v.props])));
    const schema = toJSONSchema(combinedSchema, { metadata: reg });
    for (const [name, comp] of Object.entries(componentsRecord)) {
      const def = schema.$defs?.[name];
      if (def && comp.description) def.description = comp.description;
    }
    return schema;
  }
  return library2;
}
function isElementNode(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const node2 = value;
  return node2.type === "element" && typeof node2.typeName === "string" && typeof node2.props === "object" && node2.props !== null && typeof node2.partial === "boolean";
}
function isRuntimeExpr(node2) {
  switch (node2.k) {
    case "StateRef":
    case "RuntimeRef":
    case "BinOp":
    case "UnaryOp":
    case "Ternary":
    case "Member":
    case "Index":
    case "Assign":
      return true;
    default:
      return false;
  }
}
function isASTNode(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return AST_KINDS.has(value.k);
}
function walkAST(node2, visit2) {
  const walk = (current) => {
    visit2(current);
    switch (current.k) {
      case "Comp":
        current.args.forEach(walk);
        Object.values(current.mappedProps ?? {}).forEach(walk);
        break;
      case "Arr":
        current.els.forEach(walk);
        break;
      case "Obj":
        current.entries.forEach(([, value]) => walk(value));
        break;
      case "BinOp":
        walk(current.left);
        walk(current.right);
        break;
      case "UnaryOp":
        walk(current.operand);
        break;
      case "Ternary":
        walk(current.cond);
        walk(current.then);
        walk(current.else);
        break;
      case "Member":
        walk(current.obj);
        break;
      case "Index":
        walk(current.obj);
        walk(current.index);
        break;
      case "Assign":
        walk(current.value);
        break;
    }
  };
  walk(node2);
}
function parseExpression(tokens) {
  let pos = 0;
  const cur = () => tokens[pos] ?? { t: 13 };
  const adv = () => {
    const tok = cur();
    pos++;
    return tok;
  };
  const eat = (kind) => {
    if (cur().t === kind) pos++;
  };
  function getInfixPrec(tok) {
    switch (tok.t) {
      case 34:
        return PREC_TERNARY;
      case 32:
        return PREC_OR;
      case 31:
        return PREC_AND;
      case 25:
      case 26:
        return PREC_EQ;
      case 27:
      case 28:
      case 29:
      case 30:
        return PREC_CMP;
      case 20:
      case 21:
        return PREC_ADD;
      case 22:
      case 23:
      case 24:
        return PREC_MUL;
      case 19:
      case 3:
        return PREC_MEMBER;
      default:
        return 0;
    }
  }
  function parseExpr(minPrec = 0) {
    let left = parsePrefix();
    while (getInfixPrec(cur()) > minPrec) left = parseInfix(left);
    return left;
  }
  function parsePrefix() {
    const tok = cur();
    if (tok.t === 14) {
      adv();
      return {
        k: "Str",
        v: tok.v
      };
    }
    if (tok.t === 15) {
      adv();
      return {
        k: "Num",
        v: tok.v
      };
    }
    if (tok.t === 10) {
      adv();
      return {
        k: "Bool",
        v: true
      };
    }
    if (tok.t === 11) {
      adv();
      return {
        k: "Bool",
        v: false
      };
    }
    if (tok.t === 12) {
      adv();
      return { k: "Null" };
    }
    if (tok.t === 3) return parseArr();
    if (tok.t === 5) return parseObj();
    if (tok.t === 18) {
      const name = tok.v;
      adv();
      if (cur().t === 9) {
        adv();
        return {
          k: "Assign",
          target: name,
          value: parseExpr(0)
        };
      }
      return {
        k: "StateRef",
        n: name
      };
    }
    if (tok.t === 17) {
      const name = tok.v;
      if (tokens[pos + 1]?.t === 1 && (!isBuiltin(name) || name === "Action")) return parseComp();
      adv();
      return {
        k: "Ref",
        n: name
      };
    }
    if (tok.t === 35) {
      if (tokens[pos + 1]?.t === 1) return parseComp();
      adv();
      return {
        k: "Ref",
        n: tok.v
      };
    }
    if (tok.t === 16) {
      adv();
      return {
        k: "Ref",
        n: tok.v
      };
    }
    if (tok.t === 33) {
      adv();
      return {
        k: "UnaryOp",
        op: "!",
        operand: parseExpr(PREC_UNARY)
      };
    }
    if (tok.t === 21) {
      adv();
      return {
        k: "UnaryOp",
        op: "-",
        operand: parseExpr(PREC_UNARY)
      };
    }
    if (tok.t === 1) {
      adv();
      const inner = parseExpr(0);
      eat(2);
      return inner;
    }
    adv();
    return { k: "Null" };
  }
  function parseInfix(left) {
    const tok = cur();
    if (tok.t === 20) {
      adv();
      return {
        k: "BinOp",
        op: "+",
        left,
        right: parseExpr(PREC_ADD)
      };
    }
    if (tok.t === 21) {
      adv();
      return {
        k: "BinOp",
        op: "-",
        left,
        right: parseExpr(PREC_ADD)
      };
    }
    if (tok.t === 22) {
      adv();
      return {
        k: "BinOp",
        op: "*",
        left,
        right: parseExpr(PREC_MUL)
      };
    }
    if (tok.t === 23) {
      adv();
      return {
        k: "BinOp",
        op: "/",
        left,
        right: parseExpr(PREC_MUL)
      };
    }
    if (tok.t === 24) {
      adv();
      return {
        k: "BinOp",
        op: "%",
        left,
        right: parseExpr(PREC_MUL)
      };
    }
    if (tok.t === 25) {
      adv();
      return {
        k: "BinOp",
        op: "==",
        left,
        right: parseExpr(PREC_EQ)
      };
    }
    if (tok.t === 26) {
      adv();
      return {
        k: "BinOp",
        op: "!=",
        left,
        right: parseExpr(PREC_EQ)
      };
    }
    if (tok.t === 27) {
      adv();
      return {
        k: "BinOp",
        op: ">",
        left,
        right: parseExpr(PREC_CMP)
      };
    }
    if (tok.t === 28) {
      adv();
      return {
        k: "BinOp",
        op: "<",
        left,
        right: parseExpr(PREC_CMP)
      };
    }
    if (tok.t === 29) {
      adv();
      return {
        k: "BinOp",
        op: ">=",
        left,
        right: parseExpr(PREC_CMP)
      };
    }
    if (tok.t === 30) {
      adv();
      return {
        k: "BinOp",
        op: "<=",
        left,
        right: parseExpr(PREC_CMP)
      };
    }
    if (tok.t === 31) {
      adv();
      return {
        k: "BinOp",
        op: "&&",
        left,
        right: parseExpr(PREC_AND)
      };
    }
    if (tok.t === 32) {
      adv();
      return {
        k: "BinOp",
        op: "||",
        left,
        right: parseExpr(PREC_OR)
      };
    }
    if (tok.t === 34) {
      adv();
      const then = parseExpr(0);
      eat(8);
      return {
        k: "Ternary",
        cond: left,
        then,
        else: parseExpr(0)
      };
    }
    if (tok.t === 19) {
      adv();
      const fieldTok = cur();
      return {
        k: "Member",
        obj: left,
        field: fieldTok.t === 16 || fieldTok.t === 17 || fieldTok.t === 14 || fieldTok.t === 15 ? (adv(), String(fieldTok.v)) : fieldTok.t === 18 ? (adv(), fieldTok.v.replace(/^\$/, "")) : (adv(), "?")
      };
    }
    if (tok.t === 3) {
      adv();
      const index = parseExpr(0);
      eat(4);
      return {
        k: "Index",
        obj: left,
        index
      };
    }
    return left;
  }
  function parseComp() {
    const name = cur().v;
    adv();
    eat(1);
    const args = [];
    while (cur().t !== 2 && cur().t !== 13) {
      args.push(parseExpr(0));
      if (cur().t === 7) adv();
    }
    eat(2);
    return {
      k: "Comp",
      name,
      args
    };
  }
  function parseArr() {
    adv();
    const els = [];
    while (cur().t !== 4 && cur().t !== 13) {
      els.push(parseExpr(0));
      if (cur().t === 7) adv();
    }
    eat(4);
    return {
      k: "Arr",
      els
    };
  }
  function parseObj() {
    adv();
    const entries = [];
    while (cur().t !== 6 && cur().t !== 13) {
      const kt = cur();
      const key = kt.t === 16 || kt.t === 14 || kt.t === 17 || kt.t === 15 ? (adv(), String(kt.v)) : kt.t === 18 ? (adv(), kt.v.replace(/^\$/, "")) : (adv(), "?");
      eat(8);
      entries.push([key, parseExpr(0)]);
      if (cur().t === 7) adv();
    }
    eat(6);
    return {
      k: "Obj",
      entries
    };
  }
  return parseExpr(0);
}
function tokenize(src) {
  const tokens = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    while (i < n && (src[i] === " " || src[i] === "	" || src[i] === "\r")) i++;
    if (i >= n) break;
    const c = src[i];
    if (c === "\n") {
      tokens.push({ t: 0 });
      i++;
      continue;
    }
    if (c === "(") {
      tokens.push({ t: 1 });
      i++;
      continue;
    }
    if (c === ")") {
      tokens.push({ t: 2 });
      i++;
      continue;
    }
    if (c === "[") {
      tokens.push({ t: 3 });
      i++;
      continue;
    }
    if (c === "]") {
      tokens.push({ t: 4 });
      i++;
      continue;
    }
    if (c === "{") {
      tokens.push({ t: 5 });
      i++;
      continue;
    }
    if (c === "}") {
      tokens.push({ t: 6 });
      i++;
      continue;
    }
    if (c === ",") {
      tokens.push({ t: 7 });
      i++;
      continue;
    }
    if (c === ":") {
      tokens.push({ t: 8 });
      i++;
      continue;
    }
    if (c === "=") {
      if (i + 1 < n && src[i + 1] === "=") {
        tokens.push({ t: 25 });
        i += 2;
      } else {
        tokens.push({ t: 9 });
        i++;
      }
      continue;
    }
    if (c === "!") {
      if (i + 1 < n && src[i + 1] === "=") {
        tokens.push({ t: 26 });
        i += 2;
      } else {
        tokens.push({ t: 33 });
        i++;
      }
      continue;
    }
    if (c === ">") {
      if (i + 1 < n && src[i + 1] === "=") {
        tokens.push({ t: 29 });
        i += 2;
      } else {
        tokens.push({ t: 27 });
        i++;
      }
      continue;
    }
    if (c === "<") {
      if (i + 1 < n && src[i + 1] === "=") {
        tokens.push({ t: 30 });
        i += 2;
      } else {
        tokens.push({ t: 28 });
        i++;
      }
      continue;
    }
    if (c === "&") {
      if (i + 1 < n && src[i + 1] === "&") {
        tokens.push({ t: 31 });
        i += 2;
      } else {
        tokens.push({ t: 31 });
        i++;
      }
      continue;
    }
    if (c === "|") {
      if (i + 1 < n && src[i + 1] === "|") {
        tokens.push({ t: 32 });
        i += 2;
      } else {
        tokens.push({ t: 32 });
        i++;
      }
      continue;
    }
    if (c === ".") {
      tokens.push({ t: 19 });
      i++;
      continue;
    }
    if (c === "?") {
      tokens.push({ t: 34 });
      i++;
      continue;
    }
    if (c === "+") {
      tokens.push({ t: 20 });
      i++;
      continue;
    }
    if (c === "*") {
      tokens.push({ t: 22 });
      i++;
      continue;
    }
    if (c === "/") {
      tokens.push({ t: 23 });
      i++;
      continue;
    }
    if (c === "%") {
      tokens.push({ t: 24 });
      i++;
      continue;
    }
    if (c === '"') {
      const start = i;
      i++;
      let isClosed = false;
      while (i < n) if (src[i] === "\\") i += 2;
      else if (src[i] === '"') {
        i++;
        isClosed = true;
        break;
      } else i++;
      const rawString = src.slice(start, i);
      try {
        const validJsonString = isClosed ? rawString : rawString + '"';
        tokens.push({
          t: 14,
          v: JSON.parse(validJsonString)
        });
      } catch {
        const stripped = rawString.replace(/^"|"$/g, "");
        tokens.push({
          t: 14,
          v: stripped
        });
      }
      continue;
    }
    if (c === "'") {
      i++;
      let result = "";
      while (i < n) if (src[i] === "\\") {
        i++;
        if (i < n) {
          const esc2 = src[i];
          if (esc2 === "'") result += "'";
          else if (esc2 === "\\") result += "\\";
          else if (esc2 === "n") result += "\n";
          else if (esc2 === "t") result += "	";
          else result += esc2;
          i++;
        }
      } else if (src[i] === "'") {
        i++;
        break;
      } else {
        result += src[i];
        i++;
      }
      tokens.push({
        t: 14,
        v: result
      });
      continue;
    }
    if (c === "-") {
      const prev = tokens.length > 0 ? tokens[tokens.length - 1] : null;
      if (!(prev != null && (prev.t === 15 || prev.t === 14 || prev.t === 16 || prev.t === 17 || prev.t === 2 || prev.t === 4 || prev.t === 10 || prev.t === 11 || prev.t === 12 || prev.t === 18 || prev.t === 35)) && i + 1 < n && src[i + 1] >= "0" && src[i + 1] <= "9") {
      } else {
        tokens.push({ t: 21 });
        i++;
        continue;
      }
    }
    const isDigit = c >= "0" && c <= "9";
    const isNegDigit = c === "-" && i + 1 < n && src[i + 1] >= "0" && src[i + 1] <= "9";
    if (isDigit || isNegDigit) {
      const start = i;
      if (src[i] === "-") i++;
      while (i < n && src[i] >= "0" && src[i] <= "9") i++;
      if (i < n && src[i] === "." && i + 1 < n && src[i + 1] >= "0" && src[i + 1] <= "9") {
        i++;
        while (i < n && src[i] >= "0" && src[i] <= "9") i++;
      }
      if (i < n && (src[i] === "e" || src[i] === "E")) {
        i++;
        if (i < n && (src[i] === "+" || src[i] === "-")) i++;
        while (i < n && src[i] >= "0" && src[i] <= "9") i++;
      }
      tokens.push({
        t: 15,
        v: +src.slice(start, i)
      });
      continue;
    }
    if (c === "$" && i + 1 < n && (src[i + 1] >= "a" && src[i + 1] <= "z" || src[i + 1] >= "A" && src[i + 1] <= "Z" || src[i + 1] === "_")) {
      const start = i;
      i++;
      while (i < n && (src[i] >= "a" && src[i] <= "z" || src[i] >= "A" && src[i] <= "Z" || src[i] >= "0" && src[i] <= "9" || src[i] === "_")) i++;
      tokens.push({
        t: 18,
        v: src.slice(start, i)
      });
      continue;
    }
    if (c >= "a" && c <= "z" || c >= "A" && c <= "Z" || c === "_") {
      const start = i;
      while (i < n && (src[i] >= "a" && src[i] <= "z" || src[i] >= "A" && src[i] <= "Z" || src[i] >= "0" && src[i] <= "9" || src[i] === "_")) i++;
      const word = src.slice(start, i);
      if (word === "true") {
        tokens.push({ t: 10 });
        continue;
      }
      if (word === "false") {
        tokens.push({ t: 11 });
        continue;
      }
      if (word === "null") {
        tokens.push({ t: 12 });
        continue;
      }
      const kind = c >= "A" && c <= "Z" ? 17 : 16;
      tokens.push({
        t: kind,
        v: word
      });
      continue;
    }
    if (c === "@" && i + 1 < n && (src[i + 1] >= "a" && src[i + 1] <= "z" || src[i + 1] >= "A" && src[i + 1] <= "Z" || src[i + 1] === "_")) {
      i++;
      const start = i;
      while (i < n && (src[i] >= "a" && src[i] <= "z" || src[i] >= "A" && src[i] <= "Z" || src[i] >= "0" && src[i] <= "9" || src[i] === "_")) i++;
      tokens.push({
        t: 35,
        v: src.slice(start, i)
      });
      continue;
    }
    i++;
  }
  tokens.push({ t: 13 });
  return tokens;
}
function jsType(value) {
  return Array.isArray(value) ? "array" : typeof value;
}
function isCompositeSchema(s) {
  return "$ref" in s || "anyOf" in s || "oneOf" in s || "allOf" in s;
}
function getScalarTypeInfo(s) {
  if (Array.isArray(s["enum"])) return { enumValues: s["enum"] };
  if ("const" in s) return { enumValues: [s["const"]] };
  switch (s["type"]) {
    case "string":
      return { expectedType: "string" };
    case "number":
    case "integer":
      return { expectedType: "number" };
    case "boolean":
      return { expectedType: "boolean" };
    default:
      return {};
  }
}
function getSchemaDefaultValue(property) {
  if (!property || typeof property !== "object" || Array.isArray(property)) return;
  return property.default;
}
function getTypeFromSchema(property) {
  if (!property || typeof property !== "object" || Array.isArray(property)) return;
  const p = property;
  if (typeof p.$ref === "string") return p.$ref.split("/").pop();
  const leaf = getScalarTypeInfo(p);
  if (leaf.enumValues) return leaf.enumValues.map((v) => JSON.stringify(v)).join("|");
  if (leaf.expectedType) return leaf.expectedType;
  return typeof p.type === "string" ? p.type : void 0;
}
function buildParamsSignature(component, params) {
  return `${component}(${params.map((p) => {
    const type = getTypeFromSchema(p.schema);
    const marked = p.required ? `${p.name}*` : p.name;
    return type ? `${marked}: ${type}` : marked;
  }).join(", ")})`;
}
function checkTypeMismatch(value, info) {
  const actual = typeof value;
  if (info.enumValues) {
    if (!SCALAR_TYPEOFS.includes(actual)) return null;
    if (info.enumValues.includes(value)) return null;
    return {
      expected: `one of [${info.enumValues.map((v) => JSON.stringify(v)).join(", ")}]`,
      actual: JSON.stringify(value)
    };
  }
  if (info.expectedType && info.expectedType !== actual) return {
    expected: info.expectedType,
    actual: jsType(value)
  };
  return null;
}
function validationMessage(component, path, issue2) {
  switch (issue2.code) {
    case "type-mismatch":
      return `field "${path}" expects ${issue2.expected} but got ${issue2.actual}`;
    case "missing-required":
      return `missing required field "${path}"${issue2.signature ? ` — signature: ${issue2.signature}` : ""}`;
    case "null-required":
      return `required field "${path}" cannot be null${issue2.signature ? ` — signature: ${issue2.signature}` : ""}`;
    case "unknown-component":
      return `Unknown component "${component}" — not found in catalog or builtins${issue2.available?.length ? `. Available components: ${issue2.available.join(", ")}` : ""}`;
    case "inline-reserved":
      return `${component}() must be declared as a top-level statement, not used inline as a value`;
    case "excess-args":
      return `${component} takes ${issue2.declared} arg(s), got ${issue2.got} (${issue2.got - issue2.declared} excess dropped)`;
  }
}
function pushValidationIssue(ctx, component, path, issue2) {
  ctx.errors.push({
    code: issue2.code,
    component,
    path,
    message: validationMessage(component, path, issue2),
    statementId: ctx.currentStatementId
  });
}
function resolveInvalidValue(container, key, required2, defaultValue) {
  if (defaultValue !== void 0) {
    container[key] = defaultValue;
    return false;
  }
  if (required2) return true;
  delete container[key];
  return false;
}
function validateElementPosition(element, s, component, path, ctx) {
  if (isCompositeSchema(s)) return false;
  if (typeof s["type"] === "string" || Array.isArray(s["enum"]) || "const" in s) {
    pushValidationIssue(ctx, component, path, {
      code: "type-mismatch",
      expected: typeof s["type"] === "string" ? s["type"] : "a literal value",
      actual: `component "${element.typeName}"`
    });
    return true;
  }
  return false;
}
function validateObjectValue(value, s, component, path, ctx) {
  if (typeof value !== "object" || Array.isArray(value)) {
    pushValidationIssue(ctx, component, path, {
      code: "type-mismatch",
      expected: "object",
      actual: jsType(value)
    });
    return true;
  }
  const obj = value;
  const props = s["properties"] && typeof s["properties"] === "object" ? s["properties"] : NO_PROPS;
  const required2 = Array.isArray(s["required"]) ? s["required"] : NO_REQUIRED;
  let invalid = false;
  if (!ctx.partial) for (const key of required2) {
    const present = key in obj;
    if (!present || obj[key] == null) {
      const fallback = getSchemaDefaultValue(props[key]);
      if (fallback !== void 0) {
        obj[key] = fallback;
        continue;
      }
      pushValidationIssue(ctx, component, `${path}/${key}`, { code: present ? "null-required" : "missing-required" });
      invalid = true;
    }
  }
  for (const key of Object.keys(props)) if (key in obj) {
    const sub = props[key];
    if (validateSchemaValue(obj[key], sub, component, `${path}/${key}`, ctx)) {
      if (resolveInvalidValue(obj, key, required2.includes(key), getSchemaDefaultValue(sub))) invalid = true;
    }
  }
  return invalid;
}
function validateArrayValue(value, s, component, path, ctx) {
  if (!Array.isArray(value)) {
    pushValidationIssue(ctx, component, path, {
      code: "type-mismatch",
      expected: "array",
      actual: jsType(value)
    });
    return true;
  }
  const items = s["items"];
  if (!items || typeof items !== "object" || Array.isArray(items)) return false;
  let invalid;
  for (let i = 0; i < value.length; i++) if (validateSchemaValue(value[i], items, component, `${path}/${i}`, ctx)) (invalid ??= []).push(i);
  if (invalid) for (let i = invalid.length - 1; i >= 0; i--) value.splice(invalid[i], 1);
  return false;
}
function validateLeafValue(value, s, component, path, ctx) {
  const leaf = getScalarTypeInfo(s);
  if (leaf.expectedType == null && leaf.enumValues == null) return false;
  if (leaf.enumValues && ctx.partial) return false;
  const mismatch = checkTypeMismatch(value, leaf);
  if (mismatch) {
    pushValidationIssue(ctx, component, path, {
      code: "type-mismatch",
      ...mismatch
    });
    return true;
  }
  return false;
}
function validateSchemaValue(value, schema, component, path, ctx) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return false;
  const s = schema;
  if (value == null) return false;
  if (isASTNode(value)) return false;
  if (isElementNode(value)) return validateElementPosition(value, s, component, path, ctx);
  if (isCompositeSchema(s)) return false;
  const type = s["type"];
  if (type === "object") return validateObjectValue(value, s, component, path, ctx);
  if (type === "array") return validateArrayValue(value, s, component, path, ctx);
  return validateLeafValue(value, s, component, path, ctx);
}
function containsDynamicValue(v) {
  if (v == null || typeof v !== "object") return false;
  if (isASTNode(v)) return true;
  if (Array.isArray(v)) return v.some(containsDynamicValue);
  if (isElementNode(v)) return Object.values(v.props).some(containsDynamicValue);
  return Object.values(v).some(containsDynamicValue);
}
function resolveRef2(name, ctx, mode) {
  if (ctx.visited.has(name)) {
    ctx.unres.push(name);
    return mode === "expr" ? {
      k: "Ph",
      n: name
    } : null;
  }
  if (!ctx.syms.has(name)) {
    ctx.unres.push(name);
    return mode === "expr" ? {
      k: "Ph",
      n: name
    } : null;
  }
  const target = ctx.syms.get(name);
  ctx.unreached?.delete(name);
  if (target.k === "Comp" && isReservedCall(target.name)) return {
    k: "RuntimeRef",
    n: name,
    refType: target.name === RESERVED_CALLS.Mutation ? "mutation" : "query"
  };
  ctx.visited.add(name);
  const prevStatementId = ctx.currentStatementId;
  ctx.currentStatementId = name;
  try {
    const result = mode === "value" ? materializeValue(target, ctx) : materializeExpr(target, ctx);
    if (mode === "value" && isElementNode(result)) result.statementId = name;
    return result;
  } finally {
    ctx.currentStatementId = prevStatementId;
    ctx.visited.delete(name);
  }
}
function materializeLazyBuiltin(node2, ctx, scopedRefs) {
  if (!LAZY_BUILTINS.has(node2.name) || node2.args.length < 3) return null;
  const varArg = node2.args[1];
  const varName = varArg.k === "Ref" ? varArg.n : varArg.k === "Str" ? varArg.v : null;
  if (!varName) return null;
  const nextScopedRefs = new Set(scopedRefs);
  nextScopedRefs.add(varName);
  const recursedArgs = node2.args.map((a, i) => i === 1 ? a : materializeExprInternal(a, ctx, nextScopedRefs));
  return {
    ...node2,
    args: recursedArgs
  };
}
function materializeExprInternal(node2, ctx, scopedRefs) {
  switch (node2.k) {
    case "Ref":
      return scopedRefs.has(node2.n) ? node2 : resolveRef2(node2.n, ctx, "expr");
    case "Ph":
      return node2;
    case "Comp": {
      const lazy2 = materializeLazyBuiltin(node2, ctx, scopedRefs);
      if (lazy2) return lazy2;
      const recursedArgs = node2.args.map((a) => materializeExprInternal(a, ctx, scopedRefs));
      if (isBuiltin(node2.name) || isReservedCall(node2.name)) return {
        ...node2,
        args: recursedArgs
      };
      const def = ctx.cat?.get(node2.name);
      if (def) {
        const mappedProps = {};
        for (let i = 0; i < def.params.length && i < recursedArgs.length; i++) mappedProps[def.params[i].name] = recursedArgs[i];
        return {
          ...node2,
          args: recursedArgs,
          mappedProps
        };
      }
      pushValidationIssue(ctx, node2.name, "", {
        code: "unknown-component",
        available: ctx.cat && [...ctx.cat.keys()]
      });
      return {
        ...node2,
        args: recursedArgs
      };
    }
    case "Arr":
      return {
        ...node2,
        els: node2.els.map((e) => materializeExprInternal(e, ctx, scopedRefs))
      };
    case "Obj":
      return {
        ...node2,
        entries: node2.entries.map(([k, v]) => [k, materializeExprInternal(v, ctx, scopedRefs)])
      };
    case "BinOp":
      return {
        ...node2,
        left: materializeExprInternal(node2.left, ctx, scopedRefs),
        right: materializeExprInternal(node2.right, ctx, scopedRefs)
      };
    case "UnaryOp":
      return {
        ...node2,
        operand: materializeExprInternal(node2.operand, ctx, scopedRefs)
      };
    case "Ternary":
      return {
        ...node2,
        cond: materializeExprInternal(node2.cond, ctx, scopedRefs),
        then: materializeExprInternal(node2.then, ctx, scopedRefs),
        else: materializeExprInternal(node2.else, ctx, scopedRefs)
      };
    case "Member":
      return {
        ...node2,
        obj: materializeExprInternal(node2.obj, ctx, scopedRefs)
      };
    case "Index":
      return {
        ...node2,
        obj: materializeExprInternal(node2.obj, ctx, scopedRefs),
        index: materializeExprInternal(node2.index, ctx, scopedRefs)
      };
    case "Assign":
      return {
        ...node2,
        value: materializeExprInternal(node2.value, ctx, scopedRefs)
      };
    default:
      return node2;
  }
}
function materializeExpr(node2, ctx) {
  return materializeExprInternal(node2, ctx, /* @__PURE__ */ new Set());
}
function materializeValue(node2, ctx) {
  switch (node2.k) {
    case "Ref":
      return resolveRef2(node2.n, ctx, "value");
    case "Str":
      return node2.v;
    case "Num":
      return node2.v;
    case "Bool":
      return node2.v;
    case "Null":
      return null;
    case "Ph":
      return null;
    case "Arr": {
      const items = [];
      for (const e of node2.els) {
        if (e.k === "Ph") continue;
        const value = materializeValue(e, ctx);
        if (value === null && (e.k === "Comp" || e.k === "Ref")) continue;
        items.push(value);
      }
      return items;
    }
    case "Obj": {
      const o = {};
      for (const [k, v] of node2.entries) o[k] = materializeValue(v, ctx);
      return o;
    }
    case "Comp": {
      const { name, args } = node2;
      if (isBuiltin(name)) {
        const lazy2 = materializeLazyBuiltin(node2, ctx, /* @__PURE__ */ new Set());
        if (lazy2) return lazy2;
        return {
          ...node2,
          args: args.map((a) => materializeExpr(a, ctx))
        };
      }
      if (isReservedCall(name)) {
        pushValidationIssue(ctx, name, "", { code: "inline-reserved" });
        return null;
      }
      const def = ctx.cat?.get(name);
      const props = {};
      if (def) {
        let dropComponent = false;
        for (let i = 0; i < def.params.length && i < args.length; i++) {
          const param = def.params[i];
          const value = materializeValue(args[i], ctx);
          props[param.name] = value;
          if (param.schema !== void 0 && validateSchemaValue(value, param.schema, name, `/${param.name}`, ctx)) {
            if (resolveInvalidValue(props, param.name, param.required, param.defaultValue)) dropComponent = true;
          }
        }
        if (args.length > def.params.length) pushValidationIssue(ctx, name, "", {
          code: "excess-args",
          declared: def.params.length,
          got: args.length
        });
        const missingRequired = def.params.filter((p) => p.required && (!(p.name in props) || props[p.name] === null));
        if (missingRequired.length) {
          const stillInvalid = missingRequired.filter((p) => {
            if (p.defaultValue !== void 0) {
              props[p.name] = p.defaultValue;
              return false;
            }
            return true;
          });
          if (stillInvalid.length) {
            for (const p of stillInvalid) pushValidationIssue(ctx, name, `/${p.name}`, {
              code: p.name in props ? "null-required" : "missing-required",
              signature: buildParamsSignature(name, def.params)
            });
            return null;
          }
        }
        if (dropComponent) return null;
      } else if (!isBuiltin(name) && !isReservedCall(name)) {
        pushValidationIssue(ctx, name, "", {
          code: "unknown-component",
          available: ctx.cat && [...ctx.cat.keys()]
        });
        return null;
      }
      const hasDynamicProps = Object.values(props).some((v) => containsDynamicValue(v));
      return {
        type: "element",
        typeName: name,
        props,
        partial: ctx.partial,
        hasDynamicProps
      };
    }
    default:
      if (isRuntimeExpr(node2)) return materializeExpr(node2, ctx);
      return node2;
  }
}
function autoClose(input2) {
  const stack = [];
  let inStr = false;
  let esc2 = false;
  for (let i = 0; i < input2.length; i++) {
    const c = input2[i];
    if (esc2) {
      esc2 = false;
      continue;
    }
    if (c === "\\" && inStr) {
      esc2 = true;
      continue;
    }
    if (inStr) {
      if (c === inStr) inStr = false;
      continue;
    }
    if (c === '"' || c === "'") {
      inStr = c;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") stack.push(c);
    else if (c === ")" && stack[stack.length - 1] === "(") stack.pop();
    else if (c === "]" && stack[stack.length - 1] === "[") stack.pop();
    else if (c === "}" && stack[stack.length - 1] === "{") stack.pop();
  }
  if (!(!!inStr || stack.length > 0)) return {
    text: input2,
    wasIncomplete: false
  };
  let out = input2;
  if (inStr) {
    if (esc2) out += "\\";
    out += inStr;
  }
  for (let j = stack.length - 1; j >= 0; j--) out += stack[j] === "(" ? ")" : stack[j] === "[" ? "]" : "}";
  return {
    text: out,
    wasIncomplete: true
  };
}
function split(tokens) {
  const stmts = [];
  let pos = 0;
  while (pos < tokens.length) {
    while (pos < tokens.length && tokens[pos].t === 0) pos++;
    if (pos >= tokens.length || tokens[pos].t === 13) break;
    const tok = tokens[pos];
    if (tok.t !== 16 && tok.t !== 17 && tok.t !== 18) {
      while (pos < tokens.length && tokens[pos].t !== 0 && tokens[pos].t !== 13) pos++;
      continue;
    }
    const id = tok.v;
    const idTokenType = tok.t;
    pos++;
    if (pos >= tokens.length || tokens[pos].t !== 9) {
      while (pos < tokens.length && tokens[pos].t !== 0 && tokens[pos].t !== 13) pos++;
      continue;
    }
    pos++;
    const expr = [];
    let depth = 0;
    let ternaryDepth = 0;
    while (pos < tokens.length && tokens[pos].t !== 13) {
      const tt = tokens[pos].t;
      if (tt === 0 && depth <= 0 && ternaryDepth <= 0) {
        let peek = pos + 1;
        while (peek < tokens.length && tokens[peek].t === 0) peek++;
        const nextT = peek < tokens.length ? tokens[peek].t : 13;
        if (nextT === 34 || nextT === 8 && ternaryDepth > 0) {
          pos++;
          continue;
        }
        break;
      }
      if (tt === 0) {
        pos++;
        continue;
      }
      if (tt === 1 || tt === 3 || tt === 5) depth++;
      else if ((tt === 2 || tt === 4 || tt === 6) && depth > 0) depth--;
      else if (tt === 34 && depth === 0) ternaryDepth++;
      else if (tt === 8 && depth === 0 && ternaryDepth > 0) ternaryDepth--;
      expr.push(tokens[pos++]);
    }
    if (expr.length) stmts.push({
      id,
      idTokenType,
      tokens: expr
    });
  }
  return stmts;
}
function emptyResult(incomplete = true) {
  return {
    root: null,
    meta: {
      incomplete,
      unresolved: [],
      orphaned: [],
      statementCount: 0,
      errors: []
    },
    stateDeclarations: {},
    queryStatements: [],
    mutationStatements: []
  };
}
function collectQueryDeps(node2) {
  if (!isASTNode(node2)) return [];
  const refs = /* @__PURE__ */ new Set();
  walkAST(node2, (current) => {
    if (current.k === "StateRef") refs.add(current.n);
  });
  return [...refs];
}
function classifyStatement(raw, expr) {
  if (expr.k === "Comp" && expr.name === RESERVED_CALLS.Query) {
    const deps = collectQueryDeps(expr.args[1]);
    return {
      kind: "query",
      id: raw.id,
      call: {
        callee: RESERVED_CALLS.Query,
        args: expr.args
      },
      expr,
      deps: deps.length > 0 ? deps : void 0
    };
  }
  if (expr.k === "Comp" && expr.name === RESERVED_CALLS.Mutation) return {
    kind: "mutation",
    id: raw.id,
    call: {
      callee: RESERVED_CALLS.Mutation,
      args: expr.args
    },
    expr
  };
  if (raw.idTokenType === 18) return {
    kind: "state",
    id: raw.id,
    init: expr
  };
  return {
    kind: "value",
    id: raw.id,
    expr
  };
}
function extractStatements(stmts, ctx) {
  const stateDeclarations = {};
  const queryStatements = [];
  const mutationStatements = [];
  for (const stmt of stmts) switch (stmt.kind) {
    case "state":
      stateDeclarations[stmt.id] = materializeValue(stmt.init, ctx);
      break;
    case "query":
      queryStatements.push({
        statementId: stmt.id,
        toolAST: stmt.call.args[0] ?? null,
        argsAST: stmt.call.args[1] ?? null,
        defaultsAST: stmt.call.args[2] ?? null,
        refreshAST: stmt.call.args[3] ?? null,
        deps: stmt.deps,
        complete: true
      });
      break;
    case "mutation":
      mutationStatements.push({
        statementId: stmt.id,
        toolAST: stmt.call.args[0] ?? null,
        argsAST: stmt.call.args[1] ?? null
      });
      break;
  }
  for (const stmt of stmts) {
    const nodes = stmt.kind === "state" ? [stmt.init] : stmt.kind === "value" ? [stmt.expr] : stmt.kind === "query" || stmt.kind === "mutation" ? stmt.call.args : [];
    for (const node2 of nodes) for (const dep of collectQueryDeps(node2)) if (!(dep in stateDeclarations)) stateDeclarations[dep] = null;
  }
  return {
    stateDeclarations,
    queryStatements,
    mutationStatements
  };
}
function isComponentStatement(stmt) {
  return stmt.kind === "value" && stmt.expr.k === "Comp" && !isBuiltin(stmt.expr.name) && stmt.expr.name !== RESERVED_CALLS.Query && stmt.expr.name !== RESERVED_CALLS.Mutation;
}
function pickEntryId(stmtMap, typedStmts, firstId, rootName) {
  if (stmtMap.has(DEFAULT_ROOT_STATEMENT_ID)) return DEFAULT_ROOT_STATEMENT_ID;
  if (rootName && stmtMap.has(rootName)) return rootName;
  const preferredComponent = rootName ? typedStmts.find((stmt) => isComponentStatement(stmt) && stmt.expr.name === rootName) : void 0;
  if (preferredComponent) return preferredComponent.id;
  return typedStmts.find(isComponentStatement)?.id ?? firstId;
}
function buildResult(stmtMap, typedStmts, firstId, wasIncomplete, stmtCount, cat, rootName) {
  const entryId = pickEntryId(stmtMap, typedStmts, firstId, rootName);
  if (!stmtMap.has(entryId)) return emptyResult(wasIncomplete);
  const syms = /* @__PURE__ */ new Map();
  for (const [id, stmt] of stmtMap) syms.set(id, stmt.kind === "state" ? stmt.init : stmt.expr);
  const unres = [];
  const errors = [];
  const unreached = /* @__PURE__ */ new Set();
  for (const [id, stmt] of stmtMap) {
    if (id === entryId) continue;
    if (stmt.kind === "state" || stmt.kind === "query" || stmt.kind === "mutation") continue;
    unreached.add(id);
  }
  const ctx = {
    syms,
    cat,
    errors,
    unres,
    visited: /* @__PURE__ */ new Set(),
    partial: wasIncomplete,
    currentStatementId: entryId,
    unreached
  };
  const materialized = materializeValue(syms.get(entryId), ctx);
  const root = isElementNode(materialized) ? materialized : null;
  if (root) root.statementId = entryId;
  const { stateDeclarations, queryStatements, mutationStatements } = extractStatements(typedStmts, ctx);
  return {
    root,
    meta: {
      incomplete: wasIncomplete,
      unresolved: unres,
      orphaned: [...unreached],
      statementCount: stmtCount,
      errors
    },
    stateDeclarations,
    queryStatements,
    mutationStatements
  };
}
function skipString(input2, start) {
  if (input2[start] !== '"') return start;
  let i = start + 1;
  while (i < input2.length) {
    const c = input2[i];
    if (c === "\\") i += 2;
    else if (c === '"') return i + 1;
    else i++;
  }
  return i;
}
function stripFences(input2) {
  const blocks = [];
  let i = 0;
  while (i < input2.length) {
    let fenceStart = -1;
    while (i < input2.length) {
      const nextI = skipString(input2, i);
      if (nextI > i) {
        i = nextI;
        continue;
      }
      if (input2[i] === "`" && i + 1 < input2.length && input2[i + 1] === "`" && i + 2 < input2.length && input2[i + 2] === "`") {
        fenceStart = i;
        break;
      }
      i++;
    }
    if (fenceStart === -1) break;
    let j = fenceStart + 3;
    while (j < input2.length && input2[j] !== "\n") j++;
    if (j >= input2.length) {
      blocks.push(input2.slice(fenceStart + 3).replace(/^[^\n]*\n?/, ""));
      i = input2.length;
      break;
    }
    j++;
    let closePos = -1;
    let k = j;
    while (k < input2.length) {
      const nextK = skipString(input2, k);
      if (nextK > k) {
        k = nextK;
        continue;
      }
      if (input2[k] === "`" && k + 1 < input2.length && input2[k + 1] === "`" && k + 2 < input2.length && input2[k + 2] === "`") {
        closePos = k;
        break;
      }
      k++;
    }
    if (closePos !== -1) {
      blocks.push(input2.slice(j, closePos));
      i = closePos + 3;
    } else {
      blocks.push(input2.slice(j));
      i = input2.length;
    }
  }
  if (blocks.length > 0) return blocks.join("\n");
  if (input2.startsWith("```")) {
    let j = 3;
    while (j < input2.length && input2[j] !== "\n") j++;
    const start = j < input2.length ? j + 1 : 3;
    const body = input2.slice(start);
    const trailingFence = body.lastIndexOf("```");
    if (trailingFence !== -1) return body.slice(0, trailingFence);
    return body;
  }
  return input2;
}
function stripComments(input2) {
  let inStr = false;
  return input2.split("\n").map((line) => {
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inStr) {
        if (c === "\\" && i + 1 < line.length) {
          i++;
          continue;
        }
        if (c === inStr) inStr = false;
        continue;
      }
      if (c === '"' || c === "'") {
        inStr = c;
        continue;
      }
      if (c === "/" && line[i + 1] === "/") return line.substring(0, i).trimEnd();
      if (c === "#") return line.substring(0, i).trimEnd();
    }
    return line;
  }).join("\n");
}
function preprocess2(input2) {
  return stripComments(stripFences(input2.trim())).trim();
}
function parse3(input2, cat, rootName) {
  const trimmed = preprocess2(input2);
  if (!trimmed) return emptyResult();
  const { text, wasIncomplete } = autoClose(trimmed);
  const stmts = split(tokenize(text));
  if (!stmts.length) return emptyResult(wasIncomplete);
  const stmtMap = /* @__PURE__ */ new Map();
  let firstId = "";
  for (const s of stmts) {
    const stmt = classifyStatement(s, parseExpression(s.tokens));
    stmtMap.set(s.id, stmt);
    if (!firstId) firstId = s.id;
  }
  return buildResult(stmtMap, [...stmtMap.values()], firstId, wasIncomplete, stmtMap.size, cat, rootName);
}
function createStreamParser(cat, rootName) {
  let buf = "";
  let cleaned = "";
  let completedEnd = 0;
  const completedStmtMap = /* @__PURE__ */ new Map();
  let completedCount = 0;
  let firstId = "";
  function addStmt(text) {
    const t2 = text.trim();
    if (!t2) return;
    for (const s of split(tokenize(t2))) {
      const stmt = classifyStatement(s, parseExpression(s.tokens));
      completedStmtMap.set(s.id, stmt);
      completedCount++;
      if (!firstId) firstId = s.id;
    }
  }
  function refreshCleaned() {
    const next = preprocess2(buf);
    if (!next.startsWith(cleaned.slice(0, completedEnd))) {
      completedEnd = 0;
      completedStmtMap.clear();
      completedCount = 0;
      firstId = "";
    }
    cleaned = next;
  }
  function scanNewCompleted() {
    let depth = 0, ternaryDepth = 0, inStr = false, esc2 = false;
    let stmtStart = completedEnd;
    for (let i = completedEnd; i < cleaned.length; i++) {
      const c = cleaned[i];
      if (esc2) {
        esc2 = false;
        continue;
      }
      if (c === "\\" && inStr) {
        esc2 = true;
        continue;
      }
      if (inStr) {
        if (c === inStr) inStr = false;
        continue;
      }
      if (c === '"' || c === "'") {
        inStr = c;
        continue;
      }
      if (c === "(" || c === "[" || c === "{") depth++;
      else if (c === ")" || c === "]" || c === "}") depth = Math.max(0, depth - 1);
      else if (c === "?" && depth === 0) ternaryDepth++;
      else if (c === ":" && depth === 0 && ternaryDepth > 0) ternaryDepth--;
      else if (c === "\n" && depth <= 0 && ternaryDepth <= 0) {
        let peek = i + 1;
        while (peek < cleaned.length && (cleaned[peek] === " " || cleaned[peek] === "	" || cleaned[peek] === "\r" || cleaned[peek] === "\n")) peek++;
        if (peek < cleaned.length && (cleaned[peek] === "?" || cleaned[peek] === ":" && ternaryDepth > 0)) continue;
        const t2 = cleaned.slice(stmtStart, i).trim();
        if (t2) addStmt(t2);
        stmtStart = i + 1;
        completedEnd = i + 1;
      }
    }
    return stmtStart;
  }
  function currentResult() {
    refreshCleaned();
    const pendingStart = scanNewCompleted();
    const pendingText = cleaned.slice(pendingStart).trim();
    if (!pendingText) {
      if (completedCount === 0) return emptyResult();
      return buildResult(completedStmtMap, [...completedStmtMap.values()], firstId, false, completedCount, cat, rootName);
    }
    const { text: closed, wasIncomplete } = autoClose(pendingText);
    const stmts = split(tokenize(closed));
    if (!stmts.length) {
      if (completedCount === 0) return emptyResult(wasIncomplete);
      return buildResult(completedStmtMap, [...completedStmtMap.values()], firstId, wasIncomplete, completedCount, cat, rootName);
    }
    const allStmtMap = new Map(completedStmtMap);
    for (const s of stmts) {
      if (completedStmtMap.has(s.id)) continue;
      const stmt = classifyStatement(s, parseExpression(s.tokens));
      allStmtMap.set(s.id, stmt);
    }
    return buildResult(allStmtMap, [...allStmtMap.values()], firstId || stmts[0].id, wasIncomplete, completedCount + stmts.length, cat, rootName);
  }
  function reset() {
    buf = "";
    cleaned = "";
    completedEnd = 0;
    completedStmtMap.clear();
    completedCount = 0;
    firstId = "";
  }
  return {
    push(chunk) {
      buf += chunk;
      return currentResult();
    },
    set(fullText) {
      if (fullText.length < buf.length || !fullText.startsWith(buf)) reset();
      const delta = fullText.slice(buf.length);
      if (delta) buf += delta;
      return currentResult();
    },
    getResult: currentResult
  };
}
function compileSchema(schema) {
  const map2 = /* @__PURE__ */ new Map();
  const defs = schema.$defs ?? {};
  for (const [name, def] of Object.entries(defs)) {
    const properties = def.properties ?? {};
    const required2 = def.required ?? [];
    const params = Object.keys(properties).map((key) => ({
      name: key,
      required: required2.includes(key),
      defaultValue: getSchemaDefaultValue(properties[key]),
      schema: properties[key]
    }));
    map2.set(name, { params });
  }
  return map2;
}
function createParser(schema, rootName) {
  const paramMap = compileSchema(schema);
  return { parse(input2) {
    const telemetry = prepareParserParseTelemetry();
    try {
      const result = parse3(input2, paramMap, rootName);
      captureParserParseResult(telemetry, result);
      return result;
    } catch (error2) {
      captureParserParseException(telemetry);
      throw error2;
    }
  } };
}
function createStreamingParser(schema, rootName) {
  return createStreamParser(compileSchema(schema), rootName);
}
function buildSignatureHint(componentName, schema) {
  if (!schema?.properties) return void 0;
  const required2 = new Set(schema.required ?? []);
  return `Signature: ${componentName}(${Object.keys(schema.properties).map((k) => required2.has(k) ? `${k}*` : k).join(", ")}) — * marks required`;
}
function enrichErrors(validationErrors, schema, componentNames) {
  return validationErrors.map((ve) => {
    const error2 = {
      source: "parser",
      code: ve.code,
      message: ve.message,
      component: ve.component,
      path: ve.path || void 0,
      statementId: ve.statementId
    };
    if (ve.code === "unknown-component" && componentNames.length) error2.hint = `Available components: ${componentNames.join(", ")}`;
    else if (ve.code === "missing-required" || ve.code === "null-required") error2.hint = buildSignatureHint(ve.component, schema.$defs?.[ve.component]);
    else if (ve.code === "inline-reserved") error2.hint = `Declare as a top-level statement: myVar = ${ve.component}(...)`;
    return error2;
  });
}
function splitStatementSource(input2) {
  const stmts = [];
  let depth = 0;
  let inStr = false;
  let esc2 = false;
  let start = 0;
  for (let i = 0; i < input2.length; i++) {
    const c = input2[i];
    if (esc2) {
      esc2 = false;
      continue;
    }
    if (c === "\\" && inStr) {
      esc2 = true;
      continue;
    }
    if (inStr) {
      if (c === inStr) inStr = false;
      continue;
    }
    if (c === '"' || c === "'") {
      inStr = c;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth = Math.max(0, depth - 1);
    else if (c === "\n" && depth <= 0) {
      const stmt = input2.slice(start, i).trim();
      if (stmt) stmts.push(stmt);
      start = i + 1;
    }
  }
  const tail = input2.slice(start).trim();
  if (tail) stmts.push(tail);
  return stmts;
}
function parseStatements(input2) {
  const trimmed = input2.trim();
  if (!trimmed) return [];
  const result = [];
  for (const raw of splitStatementSource(trimmed)) {
    const stmt = split(tokenize(raw))[0];
    if (!stmt) continue;
    result.push({
      id: stmt.id,
      ast: parseExpression(stmt.tokens),
      raw
    });
  }
  return result;
}
function collectRefs(node2, out) {
  walkAST(node2, (current) => {
    if (current.k === "Ref") out.add(current.n);
    if (current.k === "RuntimeRef") out.add(current.n);
  });
}
function gcUnreachable(order, merged, asts, rootId = "root") {
  if (!asts.get(rootId)) return;
  const reachable = /* @__PURE__ */ new Set([rootId]);
  const queue = [rootId];
  while (queue.length > 0) {
    const id = queue.pop();
    const ast = asts.get(id);
    if (!ast) continue;
    const refs = /* @__PURE__ */ new Set();
    collectRefs(ast, refs);
    for (const ref of refs) if (!reachable.has(ref) && asts.has(ref)) {
      reachable.add(ref);
      queue.push(ref);
    }
  }
  for (const id of order) if (id.startsWith("$")) reachable.add(id);
  for (let i = order.length - 1; i >= 0; i--) if (!reachable.has(order[i])) {
    merged.delete(order[i]);
    order.splice(i, 1);
  }
}
function mergeStatements(existing, patch, rootId = "root") {
  const existingStmts = parseStatements(existing);
  const patchStmts = parseStatements(stripFences(patch));
  if (!existingStmts.length) return patchStmts.map((stmt) => stmt.raw).join("\n");
  if (!patchStmts.length) return existing;
  const merged = /* @__PURE__ */ new Map();
  const asts = /* @__PURE__ */ new Map();
  const order = [];
  for (const stmt of existingStmts) {
    merged.set(stmt.id, stmt.raw);
    asts.set(stmt.id, stmt.ast);
    order.push(stmt.id);
  }
  for (const stmt of patchStmts) {
    if (stmt.ast.k === "Null") {
      merged.delete(stmt.id);
      asts.delete(stmt.id);
      const idx = order.indexOf(stmt.id);
      if (idx !== -1) order.splice(idx, 1);
      continue;
    }
    if (!merged.has(stmt.id)) order.push(stmt.id);
    merged.set(stmt.id, stmt.raw);
    asts.set(stmt.id, stmt.ast);
  }
  gcUnreachable(order, merged, asts, rootId);
  return order.filter((id) => merged.has(id)).map((id) => merged.get(id)).join("\n");
}
function serializeASTNode(node2) {
  switch (node2.k) {
    case "Str":
      return JSON.stringify(node2.v);
    case "Num":
      return String(node2.v);
    case "Bool":
      return node2.v ? "true" : "false";
    case "Null":
      return "null";
    case "Ph":
      return node2.n;
    case "StateRef":
      return node2.n;
    case "RuntimeRef":
      return node2.n;
    case "Arr":
      return "[" + node2.els.map(serializeASTNode).join(", ") + "]";
    case "Obj":
      return "{" + node2.entries.map(([k, v]) => `${k}: ${serializeASTNode(v)}`).join(", ") + "}";
    case "BinOp": {
      const left = serializeBinOpChild(node2.left, node2.op, "left");
      const right = serializeBinOpChild(node2.right, node2.op, "right");
      return `${left} ${node2.op} ${right}`;
    }
    case "UnaryOp":
      return `${node2.op}${serializeASTNode(node2.operand)}`;
    case "Ternary":
      return `${serializeASTNode(node2.cond)} ? ${serializeASTNode(node2.then)} : ${serializeASTNode(node2.else)}`;
    case "Member":
      return `${serializeASTNode(node2.obj)}.${node2.field}`;
    case "Index":
      return `${serializeASTNode(node2.obj)}[${serializeASTNode(node2.index)}]`;
    case "Assign":
      return `${node2.target} = ${serializeASTNode(node2.value)}`;
    case "Comp": {
      const args = node2.args.map(serializeASTNode).join(", ");
      if (isBuiltin(node2.name) && node2.name !== "Action") return `@${node2.name}(${args})`;
      return `${node2.name}(${args})`;
    }
    case "Ref":
      return node2.n;
    default:
      return "null";
  }
}
function serializeBinOpChild(child, parentOp, _side) {
  const inner = serializeASTNode(child);
  if (child.k !== "BinOp") return inner;
  const parentPrec = PRECEDENCE[parentOp] ?? 0;
  if ((PRECEDENCE[child.op] ?? 0) < parentPrec) return `(${inner})`;
  return inner;
}
function serializeValue(value, paramMap, collector) {
  if (value === null || value === void 0) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (isElementNode(value)) return serializeElementValue(value, paramMap, collector);
  if (isASTNode(value)) return serializeASTNode(value);
  if (Array.isArray(value)) return "[" + value.map((el) => serializeValue(el, paramMap, collector)).join(", ") + "]";
  if (typeof value === "object") return "{" + Object.entries(value).map(([k, v]) => `${k}: ${serializeValue(v, paramMap, collector)}`).join(", ") + "}";
  return "null";
}
function serializeElementValue(node2, paramMap, collector) {
  if (node2.statementId) {
    if (!collector.has(node2.statementId)) {
      const expr = serializeElementExpr(node2, paramMap, collector);
      collector.register(node2.statementId, `${node2.statementId} = ${expr}`);
    }
    return node2.statementId;
  }
  return serializeElementExpr(node2, paramMap, collector);
}
function serializeElementExpr(node2, paramMap, collector) {
  const def = paramMap.get(node2.typeName);
  if (def) {
    const args = [];
    for (const param of def.params) {
      const val = node2.props[param.name];
      args.push(serializeValue(val, paramMap, collector));
    }
    while (args.length > 0) {
      if (args[args.length - 1] !== "null") break;
      const paramIdx = args.length - 1;
      const param = def.params[paramIdx];
      if (!param) break;
      if (param.required) break;
      args.pop();
    }
    return `${node2.typeName}(${args.join(", ")})`;
  }
  const fallbackArgs = Object.values(node2.props).map((v) => serializeValue(v, paramMap, collector));
  return `${node2.typeName}(${fallbackArgs.join(", ")})`;
}
function serializeStateDeclarations(stateDeclarations, paramMap, collector) {
  const lines = [];
  for (const [name, value] of Object.entries(stateDeclarations)) {
    if (value === null) continue;
    lines.push(`${name} = ${serializeValue(value, paramMap, collector)}`);
  }
  return lines;
}
function jsonToOpenUI(json2, library2, options) {
  const paramMap = compileSchema(library2.toJSONSchema());
  const collector = new StatementCollector();
  const rootExpr = serializeElementExpr(json2, paramMap, collector);
  const rootId = json2.statementId || "root";
  const lines = [];
  lines.push(`${rootId} = ${rootExpr}`);
  for (const stmt of collector.getStatements()) {
    if (stmt.id === rootId) continue;
    lines.push(stmt.text);
  }
  if (options?.stateDeclarations) {
    const stateLines = serializeStateDeclarations(options.stateDeclarations, paramMap, collector);
    lines.push(...stateLines);
  }
  return lines.join("\n");
}
function isReactiveAssign(value) {
  return typeof value === "object" && value !== null && value.__reactive === "assign";
}
function evaluate(node2, context, schemaCtx) {
  switch (node2.k) {
    case "Str":
      return node2.v;
    case "Num":
      return node2.v;
    case "Bool":
      return node2.v;
    case "Null":
      return null;
    case "Ph":
      return null;
    case "StateRef":
      return context.extraScope?.[node2.n] ?? context.getState(node2.n);
    case "Ref":
    case "RuntimeRef":
      return context.resolveRef(node2.n);
    case "Arr":
      return node2.els.map((el) => evaluate(el, context));
    case "Obj":
      return Object.fromEntries(node2.entries.map(([k, v]) => [k, evaluate(v, context)]));
    case "Comp": {
      if (LAZY_BUILTINS.has(node2.name)) return evaluateLazyBuiltin(node2.name, node2.args, context, schemaCtx);
      const builtin = BUILTINS[node2.name];
      if (builtin) {
        const args = node2.args.map((a) => evaluate(a, context));
        return builtin.fn(...args);
      }
      if (ACTION_NAMES.has(node2.name)) return evaluateActionCall(node2.name, node2.args, context);
      if (node2.mappedProps) {
        const def = schemaCtx?.library.components[node2.name];
        const props = {};
        for (const [key, val] of Object.entries(node2.mappedProps)) {
          const propSchema = def?.props?.shape?.[key];
          if (val.k === "StateRef" && propSchema && isReactiveSchema(propSchema)) props[key] = {
            __reactive: "assign",
            target: val.n,
            expr: {
              k: "StateRef",
              n: "$value"
            }
          };
          else if (val.k === "StateRef") props[key] = schemaCtx ? context.getState(val.n) : val;
          else props[key] = evaluate(val, context, schemaCtx);
        }
        const result = {
          type: "element",
          typeName: node2.name,
          props,
          partial: false,
          hasDynamicProps: true
        };
        if (schemaCtx) {
          for (const [key, val] of Object.entries(props)) if (isElementNode(val)) props[key] = evaluateElementInline(val, context, schemaCtx);
          else if (Array.isArray(val)) props[key] = val.map((item) => isElementNode(item) ? evaluateElementInline(item, context, schemaCtx) : item);
        }
        return result;
      }
      console.warn(`[openui] Unexpected unmapped Comp node: ${node2.name}`);
      return null;
    }
    case "BinOp": {
      if (node2.op === "&&") {
        const left2 = evaluate(node2.left, context);
        return left2 ? evaluate(node2.right, context) : left2;
      }
      if (node2.op === "||") {
        const left2 = evaluate(node2.left, context);
        return left2 ? left2 : evaluate(node2.right, context);
      }
      const left = evaluate(node2.left, context);
      const right = evaluate(node2.right, context);
      switch (node2.op) {
        case "+":
          if (typeof left === "string" || typeof right === "string") return String(left ?? "") + String(right ?? "");
          return toNumber(left) + toNumber(right);
        case "-":
          return toNumber(left) - toNumber(right);
        case "*":
          return toNumber(left) * toNumber(right);
        case "/":
          return toNumber(right) === 0 ? 0 : toNumber(left) / toNumber(right);
        case "%":
          return toNumber(right) === 0 ? 0 : toNumber(left) % toNumber(right);
        case "==":
          return left == right;
        case "!=":
          return left != right;
        case ">":
          return toNumber(left) > toNumber(right);
        case "<":
          return toNumber(left) < toNumber(right);
        case ">=":
          return toNumber(left) >= toNumber(right);
        case "<=":
          return toNumber(left) <= toNumber(right);
        default:
          return null;
      }
    }
    case "UnaryOp":
      if (node2.op === "!") return !evaluate(node2.operand, context);
      if (node2.op === "-") return -toNumber(evaluate(node2.operand, context));
      return null;
    case "Ternary":
      return evaluate(node2.cond, context) ? evaluate(node2.then, context) : evaluate(node2.else, context);
    case "Member": {
      const obj = evaluate(node2.obj, context);
      if (obj == null) return null;
      if (Array.isArray(obj)) {
        if (node2.field === "length") return obj.length;
        return obj.map((item) => item?.[node2.field] ?? null);
      }
      return obj[node2.field];
    }
    case "Index": {
      const obj = evaluate(node2.obj, context);
      const idx = evaluate(node2.index, context);
      if (obj == null || idx == null) return null;
      if (Array.isArray(obj)) return obj[toNumber(idx)];
      return obj[String(idx)];
    }
    case "Assign":
      return {
        __reactive: "assign",
        target: node2.target,
        expr: node2.value
      };
  }
}
function stripReactiveAssign(value, context) {
  if (!isReactiveAssign(value)) return value;
  return context.getState(value.target) ?? null;
}
function evaluateElementInline(el, context, schemaCtx) {
  if (el.hasDynamicProps === false) return el;
  const def = schemaCtx.library.components[el.typeName];
  const evaluated = {};
  for (const [key, value] of Object.entries(el.props)) {
    const propSchema = def?.props?.shape?.[key];
    evaluated[key] = evaluatePropInline(value, context, schemaCtx, propSchema);
  }
  return {
    ...el,
    props: evaluated
  };
}
function evaluatePropInline(value, context, schemaCtx, reactiveSchema) {
  return evaluatePropCore(value, context, schemaCtx, reactiveSchema, {
    recurseElement: (el) => evaluateElementInline(el, context, schemaCtx),
    recurse: (v, rs) => evaluatePropInline(v, context, schemaCtx, rs)
  });
}
function toLiteralAST(value) {
  if (value === null || value === void 0) return { k: "Null" };
  if (typeof value === "string") return {
    k: "Str",
    v: value
  };
  if (typeof value === "number") return {
    k: "Num",
    v: value
  };
  if (typeof value === "boolean") return {
    k: "Bool",
    v: value
  };
  if (Array.isArray(value)) return {
    k: "Arr",
    els: value.map(toLiteralAST)
  };
  if (typeof value === "object") return {
    k: "Obj",
    entries: Object.entries(value).map(([k, v]) => [k, toLiteralAST(v)])
  };
  return { k: "Null" };
}
function evaluateActionCall(name, args, context) {
  switch (name) {
    case "Action": {
      const stepsArg = args.length > 0 ? evaluate(args[0], context) : [];
      return { steps: (Array.isArray(stepsArg) ? stepsArg : []).filter((s) => s != null && typeof s === "object" && "type" in s) };
    }
    case "Run": {
      if (args.length === 0) return null;
      const refNode = args[0];
      if (refNode.k === "RuntimeRef") return {
        type: ACTION_STEPS.Run,
        statementId: refNode.n,
        refType: refNode.refType
      };
      return null;
    }
    case "ToAssistant": {
      const message = args.length > 0 ? String(evaluate(args[0], context) ?? "") : "";
      const ctx = args.length > 1 ? String(evaluate(args[1], context) ?? "") : void 0;
      return {
        type: ACTION_STEPS.ToAssistant,
        message,
        context: ctx
      };
    }
    case "OpenUrl": {
      const url2 = args.length > 0 ? String(evaluate(args[0], context) ?? "") : "";
      return {
        type: ACTION_STEPS.OpenUrl,
        url: url2
      };
    }
    case "Set": {
      if (args.length < 2) return null;
      const targetNode = args[0];
      if (targetNode.k !== "StateRef") return null;
      return {
        type: ACTION_STEPS.Set,
        target: targetNode.n,
        valueAST: args[1]
      };
    }
    case "Reset": {
      const targets = args.filter((a) => a.k === "StateRef").map((a) => a.n);
      if (targets.length === 0) return null;
      return {
        type: ACTION_STEPS.Reset,
        targets
      };
    }
    default:
      return null;
  }
}
function substituteRef(node2, varName, value) {
  switch (node2.k) {
    case "Ref":
      return node2.n === varName ? toLiteralAST(value) : node2;
    case "Member":
      if (isASTNode(node2.obj)) {
        const subObj = substituteRef(node2.obj, varName, value);
        if (subObj.k === "Obj") {
          const entry = subObj.entries.find(([k]) => k === node2.field);
          if (entry) return entry[1];
        }
        return {
          ...node2,
          obj: subObj
        };
      }
      return node2;
    case "Index":
      return {
        ...node2,
        obj: isASTNode(node2.obj) ? substituteRef(node2.obj, varName, value) : node2.obj,
        index: isASTNode(node2.index) ? substituteRef(node2.index, varName, value) : node2.index
      };
    case "BinOp":
      return {
        ...node2,
        left: substituteRef(node2.left, varName, value),
        right: substituteRef(node2.right, varName, value)
      };
    case "UnaryOp":
      return {
        ...node2,
        operand: substituteRef(node2.operand, varName, value)
      };
    case "Ternary":
      return {
        ...node2,
        cond: substituteRef(node2.cond, varName, value),
        then: substituteRef(node2.then, varName, value),
        else: substituteRef(node2.else, varName, value)
      };
    case "Arr":
      return {
        ...node2,
        els: node2.els.map((e) => substituteRef(e, varName, value))
      };
    case "Obj":
      return {
        ...node2,
        entries: node2.entries.map(([k, v]) => [k, substituteRef(v, varName, value)])
      };
    case "Comp": {
      const result = {
        ...node2,
        args: node2.args.map((a) => substituteRef(a, varName, value))
      };
      if (node2.mappedProps) {
        const subProps = {};
        for (const [k, v] of Object.entries(node2.mappedProps)) subProps[k] = substituteRef(v, varName, value);
        result.mappedProps = subProps;
      }
      return result;
    }
    case "Assign":
      return {
        ...node2,
        value: substituteRef(node2.value, varName, value)
      };
    default:
      return node2;
  }
}
function evaluateLazyBuiltin(name, args, context, schemaCtx) {
  if (name === "Each") {
    if (args.length < 3) return [];
    const arr = evaluate(args[0], context);
    if (!Array.isArray(arr)) return [];
    const varName = args[1].k === "Ref" ? args[1].n : args[1].k === "Str" ? args[1].v : null;
    if (!varName) return [];
    const template = args[2];
    return arr.map((item, _idx) => {
      const substituted = substituteRef(template, varName, item);
      const childCtx = {
        ...context,
        resolveRef: (refName) => {
          if (refName === varName) return item;
          return context.resolveRef(refName);
        }
      };
      const result = evaluate(substituted, childCtx, schemaCtx);
      if (schemaCtx && isElementNode(result)) return evaluateElementInline(result, childCtx, schemaCtx);
      return result;
    });
  }
  return null;
}
function evaluatePropCore(value, context, schemaCtx, reactiveSchema, callbacks) {
  if (value == null) return value;
  if (typeof value !== "object") return value;
  if (isASTNode(value)) {
    if (value.k === "StateRef" && reactiveSchema && isReactiveSchema(reactiveSchema)) return {
      __reactive: "assign",
      target: value.n,
      expr: {
        k: "StateRef",
        n: "$value"
      }
    };
    const result = evaluate(value, context, schemaCtx);
    if (isElementNode(result)) return callbacks.recurseElement(result);
    if (Array.isArray(result)) return result.map((item) => isElementNode(item) ? callbacks.recurseElement(item) : item);
    if (isReactiveAssign(result) && !(reactiveSchema && isReactiveSchema(reactiveSchema))) return context.getState(result.target) ?? null;
    return result;
  }
  if (typeof value === "string" && reactiveSchema && isReactiveSchema(reactiveSchema)) return value;
  if (Array.isArray(value)) return value.map((v) => callbacks.recurse(v, reactiveSchema));
  if (isElementNode(value)) return callbacks.recurseElement(value);
  const obj = value;
  if ("steps" in obj && Array.isArray(obj.steps)) return value;
  if ("type" in obj && "valueAST" in obj) return value;
  let needsEval = false;
  for (const val of Object.values(obj)) if (typeof val === "object" && val !== null) {
    needsEval = true;
    break;
  }
  if (needsEval) {
    const result = {};
    for (const [k, v] of Object.entries(obj)) result[k] = callbacks.recurse(v, reactiveSchema);
    return result;
  }
  return value;
}
function evaluateElementProps(el, evalCtx) {
  if (el.hasDynamicProps === false) return el;
  const schemaCtx = { library: evalCtx.library };
  const def = evalCtx.library.components[el.typeName];
  const evaluated = {};
  for (const [key, value] of Object.entries(el.props)) {
    const propSchema = def?.props?.shape?.[key];
    try {
      evaluated[key] = evaluatePropValue(value, evalCtx, schemaCtx, propSchema);
    } catch (e) {
      evaluated[key] = value;
      const msg = e instanceof Error ? e.message : String(e);
      evalCtx.errors?.push({
        source: "runtime",
        code: "runtime-error",
        component: el.typeName,
        statementId: el.statementId,
        message: `Evaluating prop "${key}" on ${el.typeName} failed: ${msg}`,
        hint: `Check the expression used for prop "${key}"`
      });
    }
  }
  return {
    ...el,
    props: evaluated
  };
}
function evaluatePropValue(value, evalCtx, schemaCtx, reactiveSchema) {
  return evaluatePropCore(value, evalCtx.ctx, schemaCtx, reactiveSchema, {
    recurseElement: (el) => evaluateElementProps(el, evalCtx),
    recurse: (v, rs) => evaluatePropValue(v, evalCtx, schemaCtx, rs)
  });
}
function extractToolResult(result) {
  if (result.isError) {
    const errorText = result.content?.filter((c) => c.type === "text").map((c) => c.text).join("\n");
    throw new McpToolError(errorText || "Unknown error");
  }
  if (result.structuredContent != null) return result.structuredContent;
  const textParts = result.content?.filter((c) => c.type === "text").map((c) => c.text ?? "");
  if (textParts?.length) {
    const text = textParts.join("");
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return null;
}
function stableStringify(value) {
  return JSON.stringify(value, (_key, val) => {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const sorted = {};
      for (const k of Object.keys(val).sort()) sorted[k] = val[k];
      return sorted;
    }
    if (val === void 0) return "__undefined__";
    if (typeof val === "number") {
      if (Number.isNaN(val)) return "__NaN__";
      if (val === Infinity) return "__Inf__";
      if (val === -Infinity) return "__-Inf__";
    }
    return val;
  });
}
function buildCacheKey(toolName, args, deps) {
  const depsKey = deps != null ? "::" + stableStringify(deps) : "";
  return toolName + "::" + stableStringify(args) + depsKey;
}
function createQueryManager(toolProvider) {
  const queries = /* @__PURE__ */ new Map();
  const mutations = /* @__PURE__ */ new Map();
  const cache = /* @__PURE__ */ new Map();
  const listeners = /* @__PURE__ */ new Set();
  let snapshot = {
    __openui_loading: [],
    __openui_refetching: [],
    __openui_errors: []
  };
  let snapshotJson = JSON.stringify(snapshot);
  let disposed = false;
  let generation = 0;
  function rebuildSnapshot() {
    const out = {
      __openui_loading: [],
      __openui_refetching: [],
      __openui_errors: []
    };
    for (const [sid, q] of queries) {
      const entry = cache.get(q.cacheKey);
      if (entry && entry.data !== void 0) out[sid] = entry.data;
      else if (q.prevCacheKey) {
        const prev = cache.get(q.prevCacheKey);
        if (prev && prev.data !== void 0) out[sid] = prev.data;
        else out[sid] = q.defaults;
      } else out[sid] = q.defaults;
      if (q.loading) {
        out.__openui_loading.push(sid);
        if (q.everFetched) out.__openui_refetching.push(sid);
      }
      if (q.error) out.__openui_errors.push(q.error);
    }
    for (const [sid, m] of mutations) {
      out[sid] = m.result;
      if (m.error) out.__openui_errors.push(m.error);
    }
    try {
      const outJson = JSON.stringify(out);
      if (outJson === snapshotJson) return false;
      snapshot = out;
      snapshotJson = outJson;
    } catch {
      snapshot = out;
      snapshotJson = "";
    }
    return true;
  }
  function notify() {
    for (const listener of [...listeners]) listener();
  }
  async function executeFetch(cacheKey, statementId) {
    if (!toolProvider) return;
    const q = queries.get(statementId);
    if (!q) return;
    const fetchKey = cacheKey;
    const toolName = q.toolName;
    const args = q.args;
    let entry = cache.get(fetchKey);
    if (!entry) {
      entry = {
        data: void 0,
        inFlight: true
      };
      cache.set(fetchKey, entry);
    } else entry.inFlight = true;
    q.loading = true;
    rebuildSnapshot();
    notify();
    try {
      const data = await toolProvider.callTool(toolName, args ?? {});
      if (disposed) return;
      const current = queries.get(statementId);
      if (!current || current.cacheKey !== fetchKey) {
        entry.inFlight = false;
        return;
      }
      entry.data = data ?? null;
      current.everFetched = true;
      current.error = void 0;
      if (current.prevCacheKey && current.prevCacheKey !== fetchKey) {
        const prevKey = current.prevCacheKey;
        current.prevCacheKey = void 0;
        cleanupCacheEntry(prevKey);
      }
    } catch (err) {
      const current = queries.get(statementId);
      if (current && current.cacheKey === fetchKey) if (err instanceof ToolNotFoundError) current.error = {
        source: "query",
        code: "tool-not-found",
        message: `Query tool "${toolName}" not found`,
        statementId,
        component: "Query",
        toolName,
        hint: err.availableTools.length ? `Available tools: ${err.availableTools.join(", ")}` : void 0
      };
      else if (err instanceof McpToolError) current.error = {
        source: "query",
        code: "mcp-error",
        message: `Query "${toolName}" returned an error: ${err.toolErrorText}`,
        statementId,
        component: "Query",
        toolName
      };
      else current.error = {
        source: "query",
        code: "tool-error",
        message: `Query "${toolName}" failed: ${err instanceof Error ? err.message : String(err)}`,
        statementId,
        component: "Query",
        toolName
      };
      console.error(`Query "${toolName}" failed:`, err);
    } finally {
      entry.inFlight = false;
      const current = queries.get(statementId);
      if (current && current.cacheKey === fetchKey) {
        current.loading = false;
        if (rebuildSnapshot()) notify();
        if (current.needsRefetch) {
          current.needsRefetch = false;
          executeFetch(current.cacheKey, statementId);
        }
      } else if (rebuildSnapshot()) notify();
    }
  }
  function cleanupCacheEntry(cacheKey) {
    for (const q of queries.values()) if (q.cacheKey === cacheKey || q.prevCacheKey === cacheKey) return;
    cache.delete(cacheKey);
  }
  function evaluateQueries(queryNodes) {
    if (disposed) return;
    const activeIds = new Set(queryNodes.map((n) => n.statementId));
    for (const [sid, q] of queries) if (!activeIds.has(sid)) {
      if (q.timer) clearInterval(q.timer);
      queries.delete(sid);
      cleanupCacheEntry(q.cacheKey);
      if (q.prevCacheKey) cleanupCacheEntry(q.prevCacheKey);
    }
    for (const node2 of queryNodes) {
      if (!node2.complete) continue;
      const cacheKey = buildCacheKey(node2.toolName, node2.args, node2.deps);
      const existing = queries.get(node2.statementId);
      if (existing) {
        if (existing.cacheKey !== cacheKey) existing.prevCacheKey = existing.cacheKey;
        existing.toolName = node2.toolName;
        existing.args = node2.args;
        existing.defaults = node2.defaults;
        existing.cacheKey = cacheKey;
      } else queries.set(node2.statementId, {
        toolName: node2.toolName,
        args: node2.args,
        defaults: node2.defaults,
        cacheKey,
        loading: false,
        everFetched: false,
        refreshInterval: 0,
        needsRefetch: false
      });
      const q = queries.get(node2.statementId);
      const entry = cache.get(cacheKey);
      const hasSettledData = entry && entry.data !== void 0 && !entry.inFlight;
      if (toolProvider && !hasSettledData && !entry?.inFlight) executeFetch(cacheKey, node2.statementId);
      const newInterval = node2.refreshInterval ?? 0;
      if (newInterval !== q.refreshInterval) {
        if (q.timer) {
          clearInterval(q.timer);
          q.timer = void 0;
        }
        if (newInterval > 0) q.timer = setInterval(() => {
          if (disposed || !toolProvider) return;
          if (!cache.get(q.cacheKey)?.inFlight) executeFetch(q.cacheKey, node2.statementId);
        }, newInterval * 1e3);
        q.refreshInterval = newInterval;
      }
    }
    if (rebuildSnapshot()) notify();
  }
  function getResult(statementId) {
    const q = queries.get(statementId);
    if (!q) return null;
    const entry = cache.get(q.cacheKey);
    if (entry && entry.data !== void 0) return entry.data;
    if (q.prevCacheKey) {
      const prev = cache.get(q.prevCacheKey);
      if (prev && prev.data !== void 0) return prev.data;
    }
    return q.defaults;
  }
  function isLoading(statementId) {
    return queries.get(statementId)?.loading ?? false;
  }
  function isAnyLoading() {
    for (const q of queries.values()) if (q.loading) return true;
    return false;
  }
  function invalidate(statementIds) {
    if (disposed || !toolProvider) return;
    const targets = statementIds?.length ? statementIds.filter((sid) => queries.has(sid)) : [...queries.keys()];
    for (const sid of targets) {
      const q = queries.get(sid);
      if (!q) continue;
      if (cache.get(q.cacheKey)?.inFlight) q.needsRefetch = true;
      else executeFetch(q.cacheKey, sid);
    }
  }
  function registerMutations(nodes) {
    const activeIds = new Set(nodes.map((n) => n.statementId));
    for (const sid of mutations.keys()) if (!activeIds.has(sid)) mutations.delete(sid);
    for (const node2 of nodes) {
      const existing = mutations.get(node2.statementId);
      if (existing) {
        if (existing.toolName !== node2.toolName) {
          existing.toolName = node2.toolName;
          existing.result = {
            status: "idle",
            data: null,
            error: null
          };
          existing.error = void 0;
        }
      } else mutations.set(node2.statementId, {
        toolName: node2.toolName,
        result: { status: "idle" }
      });
    }
    if (rebuildSnapshot()) notify();
  }
  async function fireMutation(statementId, evaluatedArgs, refreshQueryIds) {
    if (disposed || !toolProvider) return false;
    const m = mutations.get(statementId);
    if (!m) return false;
    if (m.result.status === "loading") return false;
    const gen = generation;
    m.result = { status: "loading" };
    rebuildSnapshot();
    notify();
    let success2 = false;
    try {
      const data = await toolProvider.callTool(m.toolName, evaluatedArgs);
      if (disposed || gen !== generation) return false;
      m.result = {
        status: "success",
        data
      };
      m.error = void 0;
      success2 = true;
    } catch (err) {
      if (disposed || gen !== generation) return false;
      const msg = err instanceof Error ? err.message : String(err);
      m.result = {
        status: "error",
        error: msg
      };
      if (err instanceof ToolNotFoundError) m.error = {
        source: "mutation",
        code: "tool-not-found",
        message: `Mutation tool "${m.toolName}" not found`,
        statementId,
        component: "Mutation",
        toolName: m.toolName,
        hint: err.availableTools.length ? `Available tools: ${err.availableTools.join(", ")}` : void 0
      };
      else if (err instanceof McpToolError) m.error = {
        source: "mutation",
        code: "mcp-error",
        message: `Mutation "${m.toolName}" returned an error: ${err.toolErrorText}`,
        statementId,
        component: "Mutation",
        toolName: m.toolName
      };
      else m.error = {
        source: "mutation",
        code: "tool-error",
        message: `Mutation "${m.toolName}" failed: ${msg}`,
        statementId,
        component: "Mutation",
        toolName: m.toolName
      };
    }
    rebuildSnapshot();
    notify();
    if (success2 && refreshQueryIds?.length) invalidate(refreshQueryIds);
    return success2;
  }
  function getMutationResult(statementId) {
    return mutations.get(statementId)?.result ?? null;
  }
  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }
  function getSnapshot() {
    return snapshot;
  }
  function activate() {
    disposed = false;
  }
  function dispose() {
    disposed = true;
    generation++;
    listeners.clear();
    for (const q of queries.values()) {
      if (q.timer) {
        clearInterval(q.timer);
        q.timer = void 0;
      }
      q.refreshInterval = 0;
      q.loading = false;
      q.needsRefetch = false;
    }
    mutations.clear();
  }
  return {
    evaluateQueries,
    getResult,
    isLoading,
    isAnyLoading,
    invalidate,
    registerMutations,
    fireMutation,
    getMutationResult,
    subscribe,
    getSnapshot,
    activate,
    dispose
  };
}
function resolveStateField(name, bindingValue, store2, evaluationContext, fieldGetter, fieldSetter) {
  if (isReactiveAssign(bindingValue) && store2 && evaluationContext) {
    const { target, expr } = bindingValue;
    return {
      name,
      value: store2.get(target),
      setValue: (value) => {
        const extraScope = { $value: value };
        const nextValue = evaluate(expr, {
          ...evaluationContext,
          extraScope
        });
        store2.set(target, nextValue);
      },
      isReactive: true
    };
  }
  return {
    name,
    value: fieldGetter(name) ?? bindingValue,
    setValue: (value) => fieldSetter(name, value),
    isReactive: false
  };
}
function createStore() {
  const state = /* @__PURE__ */ new Map();
  const listeners = /* @__PURE__ */ new Set();
  let snapshot = {};
  function notify() {
    const currentListeners = [...listeners];
    for (const listener of currentListeners) listener();
  }
  function rebuildSnapshot() {
    snapshot = Object.fromEntries(state);
  }
  function get(name) {
    return state.get(name);
  }
  function set2(name, value) {
    const existing = state.get(name);
    if (Object.is(existing, value)) return;
    if (value && existing && typeof value === "object" && typeof existing === "object" && !Array.isArray(value) && !Array.isArray(existing)) {
      const nk = Object.keys(value);
      const ok = Object.keys(existing);
      if (nk.length === ok.length && nk.every((k) => Object.is(value[k], existing[k]))) return;
    }
    state.set(name, value);
    rebuildSnapshot();
    notify();
  }
  function subscribe(listener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }
  function getSnapshot() {
    return snapshot;
  }
  function initialize(defaults, persisted) {
    for (const key of Object.keys(persisted)) state.set(key, persisted[key]);
    for (const key of Object.keys(defaults)) if (!state.has(key)) state.set(key, defaults[key]);
    rebuildSnapshot();
    notify();
  }
  function dispose() {
    state.clear();
    listeners.clear();
    snapshot = {};
  }
  return {
    get,
    set: set2,
    subscribe,
    getSnapshot,
    initialize,
    dispose
  };
}
function parseRule(rule) {
  const colonIdx = rule.indexOf(":");
  if (colonIdx === -1) return { type: rule };
  const type = rule.slice(0, colonIdx);
  const rawArg = rule.slice(colonIdx + 1);
  return {
    type,
    arg: NUMERIC_RULES.has(type) && !Number.isNaN(Number(rawArg)) ? Number(rawArg) : rawArg
  };
}
function parseRules(rules) {
  if (!Array.isArray(rules)) return [];
  return rules.filter((r) => typeof r === "string").map(parseRule);
}
function isEmpty(value) {
  if (value === null || value === void 0 || value === "") return true;
  if (Array.isArray(value) && value.length === 0) return true;
  if (value && typeof value === "object" && !Array.isArray(value) && "value" in value) return isEmpty(value.value);
  if (typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).length === 0) return true;
  return false;
}
function validate2(value, rules, customValidators) {
  for (const rule of rules) {
    const validator = customValidators?.[rule.type] ?? builtInValidators[rule.type];
    if (!validator) {
      console.warn(`[openui] Unknown validation rule type: "${rule.type}"`);
      continue;
    }
    const error2 = validator(value, rule.arg);
    if (error2) return error2;
  }
}
function parseStructuredRules(rules) {
  if (!rules || typeof rules !== "object" || Array.isArray(rules)) return [];
  const obj = rules;
  const result = [];
  for (const [key, val] of Object.entries(obj)) {
    if (val === false || val === void 0 || val === null) continue;
    if (val === true) result.push({ type: key });
    else result.push({
      type: key,
      arg: val
    });
  }
  return result;
}
var SYSTEM_PROMPT_EVENT_NAME, PARSER_PARSE_EVENT_NAME, SYSTEM_PROMPT_SAMPLE_RATE, PARSER_PARSE_SAMPLE_RATE, SDK_VERSION, STATE_KEY, BUILTINS, LAZY_BUILTINS, LAZY_BUILTIN_DEFS, ACTION_STEPS, ACTION_NAMES, BUILTIN_NAMES, RESERVED_CALLS, REF_PATTERN, CLOUD_CONFIG_MARKER, CLOUD_CHAT_LIBRARY_VERSION, PREAMBLE, reactiveSchemas, schemaIdTags, fallbackLibraryId, BuiltinActionType, AST_KINDS, PREC_TERNARY, PREC_OR, PREC_AND, PREC_EQ, PREC_CMP, PREC_ADD, PREC_MUL, PREC_UNARY, PREC_MEMBER, SCALAR_TYPEOFS, NO_PROPS, NO_REQUIRED, DEFAULT_ROOT_STATEMENT_ID, PRECEDENCE, StatementCollector, McpToolError, ToolNotFoundError, NUMERIC_RULES, builtInValidators;
var init_dist2 = __esm({
  "node_modules/@openuidev/lang-core/dist/index.mjs"() {
    init_shared_Dzgc28Wo();
    init_v4();
    init_core2();
    SYSTEM_PROMPT_EVENT_NAME = "lang_core_system_prompt_generation_used";
    PARSER_PARSE_EVENT_NAME = "lang_core_parser_parse_used";
    SYSTEM_PROMPT_SAMPLE_RATE = 0.1;
    PARSER_PARSE_SAMPLE_RATE = 0.1;
    SDK_VERSION = "0.2.18";
    STATE_KEY = /* @__PURE__ */ Symbol.for("@openuidev/lang-core/telemetry/v1");
    BUILTINS = {
      Count: {
        name: "Count",
        signature: "Count(array) → number",
        description: "Returns array length",
        fn: (arr) => Array.isArray(arr) ? arr.length : 0
      },
      First: {
        name: "First",
        signature: "First(array) → element",
        description: "Returns first element of array",
        fn: (arr) => Array.isArray(arr) ? arr[0] ?? null : null
      },
      Last: {
        name: "Last",
        signature: "Last(array) → element",
        description: "Returns last element of array",
        fn: (arr) => Array.isArray(arr) ? arr[arr.length - 1] ?? null : null
      },
      Sum: {
        name: "Sum",
        signature: "Sum(numbers[]) → number",
        description: "Sum of numeric array",
        fn: (arr) => Array.isArray(arr) ? arr.reduce((a, b) => a + toNumber(b), 0) : 0
      },
      Avg: {
        name: "Avg",
        signature: "Avg(numbers[]) → number",
        description: "Average of numeric array",
        fn: (arr) => Array.isArray(arr) && arr.length ? arr.reduce((a, b) => a + toNumber(b), 0) / arr.length : 0
      },
      Min: {
        name: "Min",
        signature: "Min(numbers[]) → number",
        description: "Minimum value in array",
        fn: (arr) => Array.isArray(arr) && arr.length ? arr.reduce((acc, b) => Math.min(acc, toNumber(b)), toNumber(arr[0])) : 0
      },
      Max: {
        name: "Max",
        signature: "Max(numbers[]) → number",
        description: "Maximum value in array",
        fn: (arr) => Array.isArray(arr) && arr.length ? arr.reduce((acc, b) => Math.max(acc, toNumber(b)), toNumber(arr[0])) : 0
      },
      Sort: {
        name: "Sort",
        signature: "Sort(array, field, direction?) → sorted array",
        description: 'Sort array by field. Direction: "asc" (default) or "desc"',
        fn: (arr, field, dir) => {
          if (!Array.isArray(arr)) return arr;
          const f = String(field ?? "");
          const desc = String(dir ?? "asc") === "desc";
          return [...arr].sort((a, b) => {
            const av = f ? resolveField(a, f) : a;
            const bv = f ? resolveField(b, f) : b;
            const aIsNumeric = typeof av === "number" || typeof av === "string" && !isNaN(Number(av)) && av !== "";
            const bIsNumeric = typeof bv === "number" || typeof bv === "string" && !isNaN(Number(bv)) && bv !== "";
            if (aIsNumeric && bIsNumeric) {
              const diff = toNumber(av) - toNumber(bv);
              return desc ? -diff : diff;
            }
            const cmp = String(av ?? "").localeCompare(String(bv ?? ""));
            return desc ? -cmp : cmp;
          });
        }
      },
      Filter: {
        name: "Filter",
        signature: 'Filter(array, field, operator: "==" | "!=" | ">" | "<" | ">=" | "<=" | "contains", value) → filtered array',
        description: "Filter array by field value",
        fn: (arr, field, op, value) => {
          if (!Array.isArray(arr)) return [];
          const f = String(field ?? "");
          const o = String(op ?? "==");
          return arr.filter((item) => {
            const v = f ? resolveField(item, f) : item;
            switch (o) {
              case "==":
                return v == value;
              case "!=":
                return v != value;
              case ">":
                return toNumber(v) > toNumber(value);
              case "<":
                return toNumber(v) < toNumber(value);
              case ">=":
                return toNumber(v) >= toNumber(value);
              case "<=":
                return toNumber(v) <= toNumber(value);
              case "contains":
                return String(v ?? "").includes(String(value ?? ""));
              default:
                return false;
            }
          });
        }
      },
      Round: {
        name: "Round",
        signature: "Round(number, decimals?) → number",
        description: "Round to N decimal places (default 0)",
        fn: (n, decimals) => {
          const num = toNumber(n);
          const d = decimals != null ? toNumber(decimals) : 0;
          const factor = Math.pow(10, d);
          return Math.round(num * factor) / factor;
        }
      },
      Abs: {
        name: "Abs",
        signature: "Abs(number) → number",
        description: "Absolute value",
        fn: (n) => Math.abs(toNumber(n))
      },
      Floor: {
        name: "Floor",
        signature: "Floor(number) → number",
        description: "Round down to nearest integer",
        fn: (n) => Math.floor(toNumber(n))
      },
      Ceil: {
        name: "Ceil",
        signature: "Ceil(number) → number",
        description: "Round up to nearest integer",
        fn: (n) => Math.ceil(toNumber(n))
      }
    };
    LAZY_BUILTINS = /* @__PURE__ */ new Set(["Each"]);
    LAZY_BUILTIN_DEFS = { Each: {
      signature: "Each(array, varName, template)",
      description: "Evaluate template for each element. varName is the loop variable — use it ONLY inside the template expression (inline). Do NOT create a separate statement for the template."
    } };
    ACTION_STEPS = {
      Run: "run",
      ToAssistant: "continue_conversation",
      OpenUrl: "open_url",
      Set: "set",
      Reset: "reset"
    };
    ACTION_NAMES = /* @__PURE__ */ new Set(["Action", ...Object.keys(ACTION_STEPS)]);
    BUILTIN_NAMES = /* @__PURE__ */ new Set([
      ...Object.keys(BUILTINS),
      ...LAZY_BUILTINS,
      ...ACTION_NAMES
    ]);
    RESERVED_CALLS = {
      Query: "Query",
      Mutation: "Mutation"
    };
    REF_PATTERN = /^#\/\$defs\/(.+)$/;
    CLOUD_CONFIG_MARKER = "]]>openui:config\n";
    CLOUD_CHAT_LIBRARY_VERSION = "0.1.0";
    PREAMBLE = `You are an AI assistant that responds using openui-lang, a declarative UI language. Your ENTIRE response must be valid openui-lang code — no markdown, no explanations, just openui-lang.`;
    reactiveSchemas = /* @__PURE__ */ new WeakSet();
    schemaIdTags = /* @__PURE__ */ new WeakMap();
    fallbackLibraryId = 0;
    BuiltinActionType = /* @__PURE__ */ (function(BuiltinActionType2) {
      BuiltinActionType2["ContinueConversation"] = "continue_conversation";
      BuiltinActionType2["OpenUrl"] = "open_url";
      return BuiltinActionType2;
    })({});
    AST_KINDS = /* @__PURE__ */ new Set([
      "Comp",
      "Ref",
      "StateRef",
      "RuntimeRef",
      "BinOp",
      "UnaryOp",
      "Ternary",
      "Member",
      "Index",
      "Assign",
      "Str",
      "Num",
      "Bool",
      "Null",
      "Arr",
      "Obj",
      "Ph"
    ]);
    PREC_TERNARY = 1;
    PREC_OR = 2;
    PREC_AND = 3;
    PREC_EQ = 4;
    PREC_CMP = 5;
    PREC_ADD = 6;
    PREC_MUL = 7;
    PREC_UNARY = 8;
    PREC_MEMBER = 9;
    SCALAR_TYPEOFS = [
      "string",
      "number",
      "boolean"
    ];
    NO_PROPS = {};
    NO_REQUIRED = [];
    DEFAULT_ROOT_STATEMENT_ID = "root";
    PRECEDENCE = {
      "||": 2,
      "&&": 3,
      "==": 4,
      "!=": 4,
      ">": 5,
      "<": 5,
      ">=": 5,
      "<=": 5,
      "+": 6,
      "-": 6,
      "*": 7,
      "/": 7,
      "%": 7
    };
    StatementCollector = class {
      statements = [];
      registered = /* @__PURE__ */ new Set();
      /** Register an ElementNode as a named statement. Returns the statementId for use as a reference. */
      register(id, text) {
        if (this.registered.has(id)) return;
        this.registered.add(id);
        this.statements.push({
          id,
          text
        });
      }
      has(id) {
        return this.registered.has(id);
      }
      getStatements() {
        return this.statements;
      }
    };
    McpToolError = class extends Error {
      toolErrorText;
      constructor(errorText) {
        super(`MCP tool error: ${errorText || "Unknown error"}`);
        this.name = "McpToolError";
        this.toolErrorText = errorText;
      }
    };
    ToolNotFoundError = class extends Error {
      toolName;
      availableTools;
      constructor(toolName, availableTools = []) {
        super(`[openui] No handler for tool "${toolName}". Available: ${availableTools.join(", ") || "(none)"}`);
        this.name = "ToolNotFoundError";
        this.toolName = toolName;
        this.availableTools = availableTools;
      }
    };
    NUMERIC_RULES = /* @__PURE__ */ new Set([
      "min",
      "max",
      "minLength",
      "maxLength"
    ]);
    builtInValidators = {
      required: (value) => {
        if (isEmpty(value)) return "This field is required";
        if (typeof value === "object" && !Array.isArray(value) && value !== null) {
          const vals = Object.values(value);
          if (vals.length > 0 && vals.every((v) => typeof v === "boolean") && !vals.some(Boolean)) return "At least one option is required";
        }
      },
      email: (value) => {
        if (isEmpty(value)) return void 0;
        if (typeof value !== "string") return "Please enter a valid email";
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? void 0 : "Please enter a valid email";
      },
      url: (value) => {
        if (isEmpty(value)) return void 0;
        if (typeof value !== "string") return "Please enter a valid URL";
        try {
          new URL(value);
          return;
        } catch {
          return "Please enter a valid URL";
        }
      },
      numeric: (value) => {
        if (isEmpty(value)) return void 0;
        if (typeof value === "number" && !isNaN(value)) return void 0;
        if (typeof value === "string" && !isNaN(parseFloat(value)) && value.trim() !== "") return void 0;
        return "Must be a number";
      },
      min: (value, arg) => {
        if (isEmpty(value)) return void 0;
        const n = typeof value === "number" ? value : parseFloat(String(value));
        if (isNaN(n)) return void 0;
        const min = Number(arg);
        return n >= min ? void 0 : `Must be at least ${min}`;
      },
      max: (value, arg) => {
        if (isEmpty(value)) return void 0;
        const n = typeof value === "number" ? value : parseFloat(String(value));
        if (isNaN(n)) return void 0;
        const max = Number(arg);
        return n <= max ? void 0 : `Must be no more than ${max}`;
      },
      minLength: (value, arg) => {
        if (isEmpty(value)) return void 0;
        if (typeof value !== "string") return void 0;
        const min = Number(arg);
        return value.length >= min ? void 0 : `Must be at least ${min} characters`;
      },
      maxLength: (value, arg) => {
        if (isEmpty(value)) return void 0;
        if (typeof value !== "string") return void 0;
        const max = Number(arg);
        return value.length <= max ? void 0 : `Must be no more than ${max} characters`;
      },
      pattern: (value, arg) => {
        if (isEmpty(value)) return void 0;
        if (typeof value !== "string" || typeof arg !== "string") return void 0;
        try {
          return new RegExp(arg).test(value) ? void 0 : "Invalid format";
        } catch {
          return;
        }
      }
    };
  }
});

// node_modules/@openuidev/observability/dist/index.mjs
function createObservability() {
  const listeners = /* @__PURE__ */ new Map();
  const deliver = (listener, event) => {
    try {
      listener(event);
    } catch (error2) {
      console.error("[@openuidev/observability] listener threw", error2);
    }
  };
  const subscribe = (key, handler) => {
    let set2 = listeners.get(key);
    if (!set2) {
      set2 = /* @__PURE__ */ new Set();
      listeners.set(key, set2);
    }
    set2.add(handler);
    return () => {
      set2.delete(handler);
    };
  };
  const emit = (level, detail) => {
    const event = {
      level,
      timestamp: Date.now(),
      detail
    };
    const targets = /* @__PURE__ */ new Set();
    listeners.get(level)?.forEach((listener) => targets.add(listener));
    listeners.get(ALL_KEY)?.forEach((listener) => targets.add(listener));
    targets.forEach((listener) => deliver(listener, event));
  };
  const bus = emit;
  bus.listen = (level, handler) => {
    const removers = (Array.isArray(level) ? level : [level]).map((l) => subscribe(l, handler));
    return () => removers.forEach((remove) => remove());
  };
  bus.listenAll = (handler) => subscribe(ALL_KEY, handler);
  bus.info = (detail) => emit("info", detail);
  bus.warn = (detail) => emit("warning", detail);
  bus.error = (detail) => emit("error", detail);
  return bus;
}
function toErrorInfo(value) {
  if (value instanceof Error) return {
    name: value.name,
    message: value.message,
    stack: value.stack,
    cause: value
  };
  let message;
  if (typeof value === "string") message = value;
  else try {
    message = JSON.stringify(value) ?? String(value);
  } catch {
    message = String(value);
  }
  return {
    message,
    cause: value
  };
}
var ALL_KEY, BUS_KEY, store, observability;
var init_dist3 = __esm({
  "node_modules/@openuidev/observability/dist/index.mjs"() {
    ALL_KEY = "all";
    BUS_KEY = /* @__PURE__ */ Symbol.for("openui.observability");
    store = globalThis;
    observability = store[BUS_KEY] ??= createObservability();
  }
});

// node_modules/@openuidev/react-lang/dist/exports-Cab8UG5o.mjs
function libraryKey(library2) {
  return library2.id ?? library2.root ?? Object.keys(library2.components).sort().join(",");
}
function getRegistry() {
  const store2 = globalThis;
  return store2[DEVTOOLS_LIBRARIES_KEY] ??= {};
}
function upsertRegistry(library2) {
  getRegistry()[libraryKey(library2)] = library2;
}
function publishLibrary(library2) {
  upsertRegistry(library2);
  observability.info({
    kind: LIBRARY_EVENT_KIND,
    __libraryId: library2.__libraryId,
    ...library2.id !== void 0 ? { id: library2.id } : {},
    ...library2.root !== void 0 ? { root: library2.root } : {},
    components: Object.keys(library2.components),
    message: library2.id ? `Library "${library2.id}" registered` : `Library registered (root: ${library2.root ?? "none"})`
  });
}
function defineComponent$1(config2) {
  return defineComponent(config2);
}
function createLibrary$1(input2) {
  const library2 = createLibrary(input2);
  if (true) publishLibrary(library2);
  return library2;
}
function useOpenUI() {
  const ctx = (0, import_react2.useContext)(OpenUIContext);
  if (!ctx) throw new Error("useOpenUI must be used within a <Renderer /> component.");
  return ctx;
}
function useRenderNode() {
  return useOpenUI().renderNode;
}
function useTriggerAction() {
  return useOpenUI().triggerAction;
}
function useIsStreaming() {
  return useOpenUI().isStreaming;
}
function useIsQueryLoading() {
  return useOpenUI().isQueryLoading;
}
function useGetFieldValue() {
  return useOpenUI().getFieldValue;
}
function useSetFieldValue() {
  return useOpenUI().setFieldValue;
}
function useFormName() {
  return (0, import_react2.useContext)(FormNameContext);
}
function useSetDefaultValue({ formName, componentType, name, existingValue, defaultValue, shouldTriggerSaveCallback = false }) {
  const setFieldValue = useSetFieldValue();
  const isStreaming = useIsStreaming();
  (0, import_react2.useEffect)(() => {
    if (!isStreaming && existingValue === void 0 && defaultValue !== void 0) setFieldValue(formName, componentType, name, defaultValue, shouldTriggerSaveCallback);
  }, [
    defaultValue,
    existingValue,
    formName,
    componentType,
    name,
    isStreaming,
    setFieldValue,
    shouldTriggerSaveCallback
  ]);
}
function useOpenUIErrors({ response, isStreaming, result, evaluatedResult, library: library2, querySnapshot, parseExceptionRef, runtimeErrorsRef, renderErrorsRef, onError }) {
  const errorsRef = (0, import_react2.useRef)([]);
  const [errorRevision, setErrorRevision] = (0, import_react2.useState)(0);
  const lastErrorKeyRef = (0, import_react2.useRef)("");
  const onErrorRef = (0, import_react2.useRef)(onError);
  onErrorRef.current = onError;
  (0, import_react2.useEffect)(() => {
    if (isStreaming) {
      errorsRef.current = [];
      if (lastErrorKeyRef.current !== "") {
        lastErrorKeyRef.current = "";
        onErrorRef.current?.([]);
      }
      return;
    }
    const errors = [];
    if (parseExceptionRef.current) errors.push(parseExceptionRef.current);
    if (response && !result?.root && !parseExceptionRef.current) errors.push({
      source: "parser",
      code: "parse-failed",
      message: result ? "Code parsed but produced no renderable root component" : "Response could not be parsed as valid openui-lang",
      hint: `The entire response must be valid openui-lang code starting with root = ${library2.root ?? "Root"}(...)`
    });
    if (result?.meta.errors.length) errors.push(...enrichErrors(result.meta.errors, library2.toJSONSchema(), Object.keys(library2.components)));
    errors.push(...runtimeErrorsRef.current);
    errors.push(...renderErrorsRef.current);
    renderErrorsRef.current = [];
    errors.push(...querySnapshot.__openui_errors ?? []);
    errorsRef.current = errors;
    const errorKey = JSON.stringify(errors);
    if (errorKey === lastErrorKeyRef.current) return;
    lastErrorKeyRef.current = errorKey;
    setErrorRevision((revision) => revision + 1);
    if (onErrorRef.current) onErrorRef.current(errors);
    else if (errors.length > 0) for (const error2 of errors) console.warn(`[openui] ${error2.source}/${error2.code}: ${error2.message}`);
  }, [
    isStreaming,
    response,
    result,
    evaluatedResult,
    querySnapshot,
    library2,
    parseExceptionRef,
    runtimeErrorsRef,
    renderErrorsRef
  ]);
  return {
    errorsRef,
    errorRevision
  };
}
function createStreamId() {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  fallbackId += 1;
  return `openui-lang-${Date.now().toString(36)}-${fallbackId.toString(36)}`;
}
function createStreamingObservabilityState() {
  return {
    id: null,
    updateIndex: 0,
    lastResponse: null,
    hasPublishedStreamingSnapshot: false,
    settled: false,
    lastSettledErrorKey: null,
    startedAt: null,
    durationMs: null
  };
}
function captureStreamTiming(state, now = Date.now()) {
  state.startedAt ??= now;
  if (state.settled) state.durationMs ??= Math.max(0, now - state.startedAt);
  const elapsedMs = state.durationMs ?? Math.max(0, now - state.startedAt);
  return {
    startedAt: state.startedAt,
    elapsedMs,
    ...state.durationMs != null ? { durationMs: state.durationMs } : {}
  };
}
function advanceStreamingObservability(state, isStreaming, response, settledErrorKey = null, idFactory = createStreamId) {
  if (isStreaming) {
    if (state.settled) Object.assign(state, createStreamingObservabilityState());
    state.id ??= idFactory();
    if (state.hasPublishedStreamingSnapshot && state.lastResponse === response) return null;
    state.hasPublishedStreamingSnapshot = true;
    state.lastResponse = response;
    state.updateIndex += 1;
    return {
      id: state.id,
      phase: STREAM_PHASE_STREAMING,
      updateIndex: state.updateIndex
    };
  }
  if (!state.id) return null;
  if (state.settled && (settledErrorKey === null || state.lastSettledErrorKey === settledErrorKey)) return null;
  state.updateIndex += 1;
  state.settled = true;
  state.lastSettledErrorKey = settledErrorKey;
  return {
    id: state.id,
    phase: STREAM_PHASE_SETTLED,
    updateIndex: state.updateIndex
  };
}
function parserMetadata(result) {
  if (!result) return void 0;
  return {
    incomplete: result.meta.incomplete,
    unresolved: result.meta.unresolved,
    orphaned: result.meta.orphaned,
    statementCount: result.meta.statementCount
  };
}
function useStreamingObservability({ response, isStreaming, result, errorsRef, errorRevision, publish = true, __libraryId }) {
  const streamRef = (0, import_react2.useRef)(createStreamingObservabilityState());
  (0, import_react2.useEffect)(() => {
    if (!publish) return;
    const errors = errorsRef.current;
    const settledErrorKey = isStreaming ? null : JSON.stringify(errors);
    const update = advanceStreamingObservability(streamRef.current, isStreaming, response, settledErrorKey);
    const libraryIdFields = __libraryId !== void 0 ? { __libraryId } : {};
    if (isStreaming) {
      if (update) observability.info({
        id: update.id,
        kind: STREAM_EVENT_KIND,
        phase: update.phase,
        updateIndex: update.updateIndex,
        response,
        responseLength: response?.length ?? 0,
        parser: parserMetadata(result),
        ...captureStreamTiming(streamRef.current),
        ...libraryIdFields,
        message: "OpenUI Lang is streaming"
      });
      return;
    }
    if (update?.phase === "settled") observability(errors.length > 0 ? "error" : "info", {
      id: update.id,
      kind: STREAM_EVENT_KIND,
      phase: STREAM_PHASE_SETTLED,
      updateIndex: update.updateIndex,
      response,
      responseLength: response?.length ?? 0,
      parser: parserMetadata(result),
      errors,
      errorCount: errors.length,
      ...captureStreamTiming(streamRef.current),
      ...libraryIdFields,
      message: errors.length > 0 ? `OpenUI Lang settled with ${errors.length} error${errors.length === 1 ? "" : "s"}` : "OpenUI Lang settled"
    });
  }, [
    publish,
    isStreaming,
    response,
    result,
    errorsRef,
    errorRevision,
    __libraryId
  ]);
}
function unwrapFieldValue(v) {
  if (v && typeof v === "object" && !Array.isArray(v) && "value" in v) return v.value;
  return v;
}
function useOpenUIState({ response, library: library2, isStreaming, onAction, onStateUpdate, initialState, toolProvider, onError, publishObservability }, renderDeep2) {
  const sp = (0, import_react2.useMemo)(() => createStreamingParser(library2.toJSONSchema(), library2.root), [library2]);
  const parseExceptionRef = (0, import_react2.useRef)(null);
  const result = (0, import_react2.useMemo)(() => {
    parseExceptionRef.current = null;
    if (!response) return null;
    try {
      return sp.set(response);
    } catch (e) {
      parseExceptionRef.current = {
        source: "parser",
        code: "parse-exception",
        message: `Parser crashed: ${e instanceof Error ? e.message : String(e)}`,
        hint: "The response may contain syntax the parser cannot handle"
      };
      return null;
    }
  }, [sp, response]);
  const store2 = (0, import_react2.useMemo)(() => createStore(), []);
  const queryManager = (0, import_react2.useMemo)(() => createQueryManager(toolProvider ?? null), [toolProvider]);
  (0, import_react2.useEffect)(() => {
    queryManager.activate();
    return () => queryManager.dispose();
  }, [queryManager]);
  const storeInitKeyRef = (0, import_react2.useRef)(/* @__PURE__ */ Symbol());
  (0, import_react2.useEffect)(() => {
    if (!result?.stateDeclarations && !initialState) return;
    const key = `${JSON.stringify(result?.stateDeclarations)}::${JSON.stringify(initialState)}`;
    if (storeInitKeyRef.current === key) return;
    storeInitKeyRef.current = key;
    const bindingDefaults = {};
    if (initialState) for (const [key2, value] of Object.entries(initialState)) if (key2.startsWith("$")) bindingDefaults[key2] = value;
    else store2.set(key2, value);
    store2.initialize(result?.stateDeclarations ?? {}, bindingDefaults);
  }, [
    result?.stateDeclarations,
    store2,
    initialState
  ]);
  const storeSnapshot = (0, import_react2.useSyncExternalStore)(store2.subscribe, store2.getSnapshot, store2.getSnapshot);
  const querySnapshot = (0, import_react2.useSyncExternalStore)(queryManager.subscribe, queryManager.getSnapshot, queryManager.getSnapshot);
  const evaluationContext = (0, import_react2.useMemo)(() => ({
    getState: (name) => unwrapFieldValue(store2.get(name)),
    resolveRef: (name) => {
      const mutResult = queryManager.getMutationResult(name);
      if (mutResult) return mutResult;
      return queryManager.getResult(name);
    }
  }), [store2, queryManager]);
  (0, import_react2.useEffect)(() => {
    if (isStreaming) return;
    const evaluatedNodes = (result?.queryStatements ?? []).map((qn) => {
      const relevantDeps = {};
      if (qn.deps) for (const ref of qn.deps) relevantDeps[ref] = storeSnapshot[ref];
      return {
        statementId: qn.statementId,
        toolName: qn.toolAST ? evaluate(qn.toolAST, evaluationContext) : "",
        args: qn.argsAST ? evaluate(qn.argsAST, evaluationContext) : null,
        defaults: qn.defaultsAST ? evaluate(qn.defaultsAST, evaluationContext) : null,
        refreshInterval: qn.refreshAST ? evaluate(qn.refreshAST, evaluationContext) : void 0,
        deps: Object.keys(relevantDeps).length > 0 ? relevantDeps : void 0,
        complete: qn.complete
      };
    });
    queryManager.evaluateQueries(evaluatedNodes);
  }, [
    isStreaming,
    result?.queryStatements,
    evaluationContext,
    queryManager,
    storeSnapshot
  ]);
  (0, import_react2.useEffect)(() => {
    if (isStreaming) return;
    const nodes = (result?.mutationStatements ?? []).map((mn) => ({
      statementId: mn.statementId,
      toolName: mn.toolAST ? evaluate(mn.toolAST, evaluationContext) : ""
    }));
    queryManager.registerMutations(nodes);
  }, [
    isStreaming,
    result?.mutationStatements,
    evaluationContext,
    queryManager
  ]);
  const propsRef = (0, import_react2.useRef)({
    onAction,
    onStateUpdate
  });
  propsRef.current = {
    onAction,
    onStateUpdate
  };
  const resultRef = (0, import_react2.useRef)(result);
  resultRef.current = result;
  const lastInitSnapshotRef = (0, import_react2.useRef)(null);
  (0, import_react2.useEffect)(() => {
    lastInitSnapshotRef.current = store2.getSnapshot();
    return store2.subscribe(() => {
      const currentSnapshot = store2.getSnapshot();
      if (currentSnapshot === lastInitSnapshotRef.current) return;
      lastInitSnapshotRef.current = null;
      propsRef.current.onStateUpdate?.(currentSnapshot);
    });
  }, [store2]);
  const getFieldValue = (0, import_react2.useCallback)((formName, name) => {
    if (!formName) return unwrapFieldValue(store2.get(name));
    const formData = store2.get(formName);
    if (!formData || typeof formData !== "object" || Array.isArray(formData)) return void 0;
    return unwrapFieldValue(formData[name]);
  }, [store2]);
  const setFieldValue = (0, import_react2.useCallback)((formName, componentType, name, value, shouldTriggerSaveCallback = true) => {
    const wrapped = {
      value,
      componentType
    };
    if (!formName) store2.set(name, wrapped);
    else {
      const raw = store2.get(formName);
      const formData = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
      store2.set(formName, {
        ...formData,
        [name]: wrapped
      });
    }
    if (shouldTriggerSaveCallback) propsRef.current.onStateUpdate?.(store2.getSnapshot());
  }, [store2]);
  const getFormPayload = (0, import_react2.useCallback)((formName) => {
    if (formName) {
      const raw = store2.get(formName);
      if (raw && typeof raw === "object" && !Array.isArray(raw)) return { [formName]: raw };
    }
    return store2.getSnapshot();
  }, [store2]);
  const triggerAction = (0, import_react2.useCallback)(async (userMessage, formName, action) => {
    const formPayload = getFormPayload(formName);
    const { onAction: handler } = propsRef.current;
    if (action && !("steps" in action)) {
      const actionType = action.type || BuiltinActionType.ContinueConversation;
      const params = { ...action.params || {} };
      if (action.url) params.url = action.url;
      if (action.context) params.context = action.context;
      handler?.({
        type: actionType,
        params,
        humanFriendlyMessage: userMessage,
        formState: formPayload,
        formName
      });
      return;
    }
    const actionPlan = action;
    if (actionPlan?.steps) {
      for (const step of actionPlan.steps) switch (step.type) {
        case ACTION_STEPS.Run:
          if (step.refType === "mutation") {
            const mn = resultRef.current?.mutationStatements?.find((m) => m.statementId === step.statementId);
            const evaluatedArgs = mn?.argsAST ? evaluate(mn.argsAST, evaluationContext) : {};
            if (!await queryManager.fireMutation(step.statementId, evaluatedArgs)) return;
          } else queryManager.invalidate([step.statementId]);
          break;
        case ACTION_STEPS.ToAssistant:
          handler?.({
            type: BuiltinActionType.ContinueConversation,
            params: step.context ? { context: step.context } : {},
            humanFriendlyMessage: step.message,
            formState: formPayload,
            formName
          });
          break;
        case ACTION_STEPS.OpenUrl:
          handler?.({
            type: BuiltinActionType.OpenUrl,
            params: { url: step.url },
            humanFriendlyMessage: "",
            formState: formPayload,
            formName
          });
          break;
        case ACTION_STEPS.Set: {
          if (!step.valueAST) {
            console.warn(`[openui] Set action for ${step.target} has no valueAST — skipping`);
            break;
          }
          const value = evaluate(step.valueAST, evaluationContext);
          store2.set(step.target, value);
          break;
        }
        case ACTION_STEPS.Reset: {
          const decls = resultRef.current?.stateDeclarations ?? {};
          for (const target of step.targets) store2.set(target, decls[target] ?? null);
          break;
        }
      }
      return;
    }
    handler?.({
      type: BuiltinActionType.ContinueConversation,
      params: {},
      humanFriendlyMessage: userMessage,
      formState: formPayload,
      formName
    });
  }, [
    queryManager,
    evaluationContext,
    getFormPayload,
    store2
  ]);
  const renderErrorsRef = (0, import_react2.useRef)([]);
  const isStreamingRef = (0, import_react2.useRef)(isStreaming);
  isStreamingRef.current = isStreaming;
  const reportError = (0, import_react2.useCallback)((error2) => {
    if (isStreamingRef.current) return;
    renderErrorsRef.current.push(error2);
  }, []);
  const isQueryLoading = querySnapshot.__openui_loading.length > 0;
  const contextValue = (0, import_react2.useMemo)(() => ({
    library: library2,
    renderNode: renderDeep2,
    triggerAction,
    isStreaming,
    getFieldValue,
    setFieldValue,
    store: store2,
    evaluationContext,
    reportError,
    isQueryLoading
  }), [
    library2,
    renderDeep2,
    isStreaming,
    isQueryLoading,
    triggerAction,
    getFieldValue,
    setFieldValue,
    store2,
    evaluationContext,
    reportError
  ]);
  const runtimeErrorsRef = (0, import_react2.useRef)([]);
  const evaluatedResult = (0, import_react2.useMemo)(() => {
    if (!result?.root) return result;
    const errors = [];
    const evalCtx = {
      ctx: evaluationContext,
      library: library2,
      store: store2,
      errors
    };
    try {
      const evaluatedRoot = evaluateElementProps(result.root, evalCtx);
      runtimeErrorsRef.current = errors;
      return {
        ...result,
        root: evaluatedRoot
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push({
        source: "runtime",
        code: "runtime-error",
        message: `Prop evaluation failed: ${msg}`
      });
      runtimeErrorsRef.current = errors;
      return result;
    }
  }, [
    result,
    evaluationContext,
    library2,
    store2,
    storeSnapshot,
    querySnapshot
  ]);
  const { errorsRef, errorRevision } = useOpenUIErrors({
    response,
    isStreaming,
    result,
    evaluatedResult,
    library: library2,
    querySnapshot,
    parseExceptionRef,
    runtimeErrorsRef,
    renderErrorsRef,
    onError
  });
  useStreamingObservability({
    response,
    isStreaming,
    result,
    errorsRef,
    errorRevision,
    publish: publishObservability,
    __libraryId: library2.__libraryId
  });
  return {
    result: evaluatedResult,
    parseResult: result,
    contextValue,
    isQueryLoading
  };
}
function renderDeep(value) {
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map((v, i) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_react2.Fragment, { children: renderDeep(v) }, i));
  if (typeof value === "object" && value !== null) {
    const obj = value;
    if (obj.type === "element") return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(RenderNode, { node: obj });
  }
  return null;
}
function RenderNode({ node: node2 }) {
  const { library: library2, reportError } = useOpenUI();
  const Comp = library2.components[node2.typeName]?.component;
  if (!Comp) return null;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ElementErrorBoundary, {
    componentName: node2.typeName,
    onError: reportError,
    children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(RenderNodeInner, {
      el: node2,
      Comp
    })
  });
}
function RenderNodeInner({ el, Comp }) {
  const renderNode = useRenderNode();
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Comp, {
    props: el.props,
    renderNode,
    statementId: el.statementId
  });
}
function ensureLoadingStyle() {
  if (loadingStyleInjected || typeof document === "undefined") return;
  loadingStyleInjected = true;
  const style = document.createElement("style");
  style.textContent = `@keyframes openui-spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`;
  document.head.appendChild(style);
}
function Renderer({ response, library: library2, isStreaming = false, onAction, onStateUpdate, initialState, onParseResult, toolProvider, queryLoader, onError, publishObservability }) {
  (0, import_react2.useInsertionEffect)(() => {
    ensureLoadingStyle();
  }, []);
  const onParseResultRef = (0, import_react2.useRef)(onParseResult);
  onParseResultRef.current = onParseResult;
  const toolProviderInputRef = (0, import_react2.useRef)(toolProvider);
  toolProviderInputRef.current = toolProvider;
  const stableToolProvider = (0, import_react2.useRef)({ async callTool(toolName, args) {
    const current = toolProviderInputRef.current ?? null;
    if (current == null) throw new Error("[openui] toolProvider is null");
    if (typeof current.callTool === "function") return extractToolResult(await current.callTool({
      name: toolName,
      arguments: args
    }));
    const map2 = current;
    const fn = map2[toolName];
    if (!fn) throw new ToolNotFoundError(toolName, Object.keys(map2));
    return fn(args);
  } });
  const { result, parseResult, contextValue, isQueryLoading } = useOpenUIState({
    response,
    library: library2,
    isStreaming,
    onAction,
    onStateUpdate,
    initialState,
    toolProvider: toolProvider != null ? stableToolProvider.current : null,
    onError,
    publishObservability
  }, renderDeep);
  (0, import_react2.useEffect)(() => {
    onParseResultRef.current?.(parseResult);
  }, [parseResult]);
  if (!result?.root) return null;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(OpenUIContext.Provider, {
    value: contextValue,
    children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
      style: { position: "relative" },
      children: [isQueryLoading && (queryLoader ?? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(DefaultQueryLoader, {})), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
        style: {
          opacity: isQueryLoading ? 0.7 : 1,
          transition: "opacity 0.2s ease"
        },
        children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(RenderNode, { node: result.root })
      })]
    })
  });
}
function reactive(schema) {
  markReactive(schema);
  return schema;
}
function useStateField(name, value) {
  const ctx = useOpenUI();
  const formName = useFormName();
  return resolveStateField(name, value, ctx.store ?? null, ctx.evaluationContext ?? null, (fieldName) => ctx.getFieldValue(formName, fieldName), (fieldName, nextValue) => ctx.setFieldValue(formName, void 0, fieldName, nextValue));
}
function useFormValidation() {
  return (0, import_react2.useContext)(FormValidationContext);
}
function useCreateFormValidation() {
  const [errors, setErrors] = (0, import_react2.useState)({});
  const errorsRef = (0, import_react2.useRef)(errors);
  errorsRef.current = errors;
  const fieldsRef = (0, import_react2.useRef)({});
  const getFieldError = (0, import_react2.useCallback)((name) => errorsRef.current[name], []);
  const validateField = (0, import_react2.useCallback)((name, value, rules) => {
    const error2 = validate2(value, rules);
    setErrors((prev) => {
      if (prev[name] === error2) return prev;
      return {
        ...prev,
        [name]: error2
      };
    });
    return !error2;
  }, []);
  const registerField = (0, import_react2.useCallback)((name, rules, getValue) => {
    fieldsRef.current[name] = {
      rules,
      getValue
    };
  }, []);
  const unregisterField = (0, import_react2.useCallback)((name) => {
    delete fieldsRef.current[name];
  }, []);
  const validateForm = (0, import_react2.useCallback)(() => {
    let allValid = true;
    const newErrors = {};
    for (const [name, reg] of Object.entries(fieldsRef.current)) {
      let value = reg.getValue();
      if (value != null && typeof value === "object" && "value" in value && "componentType" in value) value = value.value;
      const error2 = validate2(value, reg.rules);
      newErrors[name] = error2;
      if (error2) allValid = false;
    }
    setErrors(newErrors);
    return allValid;
  }, []);
  const clearFieldError = (0, import_react2.useCallback)((name) => {
    setErrors((prev) => {
      if (prev[name] === void 0) return prev;
      return {
        ...prev,
        [name]: void 0
      };
    });
  }, []);
  return (0, import_react2.useMemo)(() => ({
    errors,
    getFieldError,
    validateField,
    registerField,
    unregisterField,
    validateForm,
    clearFieldError
  }), [
    errors,
    getFieldError,
    validateField,
    registerField,
    unregisterField,
    validateForm,
    clearFieldError
  ]);
}
var import_react2, import_jsx_runtime, DEVTOOLS_LIBRARIES_KEY, LIBRARY_EVENT_KIND, OpenUIContext, FormNameContext, STREAM_EVENT_KIND, STREAM_PHASE_STREAMING, STREAM_PHASE_SETTLED, fallbackId, ElementErrorBoundary, loadingStyleInjected, DefaultQueryLoader, FormValidationContext;
var init_exports_Cab8UG5o = __esm({
  "node_modules/@openuidev/react-lang/dist/exports-Cab8UG5o.mjs"() {
    init_dist2();
    init_dist3();
    import_react2 = require("react");
    import_jsx_runtime = require("react/jsx-runtime");
    DEVTOOLS_LIBRARIES_KEY = /* @__PURE__ */ Symbol.for("openui.devtools.libraries");
    LIBRARY_EVENT_KIND = "react-lang:library";
    OpenUIContext = (0, import_react2.createContext)(null);
    FormNameContext = (0, import_react2.createContext)(void 0);
    STREAM_EVENT_KIND = "react-lang:stream";
    STREAM_PHASE_STREAMING = "streaming";
    STREAM_PHASE_SETTLED = "settled";
    fallbackId = 0;
    ElementErrorBoundary = class extends import_react2.Component {
      lastValidChildren = null;
      constructor(props) {
        super(props);
        this.state = { hasError: false };
      }
      static getDerivedStateFromError() {
        return { hasError: true };
      }
      componentDidMount() {
        if (!this.state.hasError) this.lastValidChildren = this.props.children;
      }
      componentDidUpdate(prevProps) {
        if (!this.state.hasError) this.lastValidChildren = this.props.children;
        if (this.state.hasError && prevProps.children !== this.props.children) this.setState({ hasError: false });
      }
      componentDidCatch(error2) {
        const name = this.props.componentName ?? "Unknown";
        this.props.onError?.({
          source: "runtime",
          code: "render-error",
          component: name,
          message: `Component ${name} render failed: ${error2.message}`
        });
      }
      render() {
        if (this.state.hasError) return this.lastValidChildren;
        return this.props.children;
      }
    };
    loadingStyleInjected = false;
    DefaultQueryLoader = () => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: {
      position: "absolute",
      top: 8,
      right: 8,
      width: 16,
      height: 16,
      border: "2px solid #e5e7eb",
      borderTopColor: "#3b82f6",
      borderRadius: "50%",
      animation: "openui-spin 0.6s linear infinite",
      zIndex: 10
    } });
    FormValidationContext = (0, import_react2.createContext)(null);
  }
});

// node_modules/@openuidev/react-lang/dist/index.mjs
var dist_exports2 = {};
__export(dist_exports2, {
  ACTION_STEPS: () => ACTION_STEPS,
  BuiltinActionType: () => BuiltinActionType,
  FormNameContext: () => FormNameContext,
  FormValidationContext: () => FormValidationContext,
  Renderer: () => Renderer,
  ToolNotFoundError: () => ToolNotFoundError,
  builtInValidators: () => builtInValidators,
  createLibrary: () => createLibrary$1,
  createParser: () => createParser,
  createStreamingParser: () => createStreamingParser,
  defineComponent: () => defineComponent$1,
  extractToolResult: () => extractToolResult,
  generatePrompt: () => generatePrompt,
  generateSystemPrompt: () => generateSystemPrompt,
  isReactiveAssign: () => isReactiveAssign,
  mergeStatements: () => mergeStatements,
  parseRules: () => parseRules,
  parseStructuredRules: () => parseStructuredRules,
  reactive: () => reactive,
  tagSchemaId: () => tagSchemaId,
  useCreateFormValidation: () => useCreateFormValidation,
  useFormName: () => useFormName,
  useFormValidation: () => useFormValidation,
  useGetFieldValue: () => useGetFieldValue,
  useIsQueryLoading: () => useIsQueryLoading,
  useIsStreaming: () => useIsStreaming,
  useRenderNode: () => useRenderNode,
  useSetDefaultValue: () => useSetDefaultValue,
  useSetFieldValue: () => useSetFieldValue,
  useStateField: () => useStateField,
  useTriggerAction: () => useTriggerAction,
  validate: () => validate2
});
var init_dist4 = __esm({
  "node_modules/@openuidev/react-lang/dist/index.mjs"() {
    init_exports_Cab8UG5o();
    if (true) {
      const AUTO_MOUNT_FLAG = /* @__PURE__ */ Symbol.for("openui.devtools.autoMount");
      const flags = globalThis;
      if (!flags[AUTO_MOUNT_FLAG]) {
        flags[AUTO_MOUNT_FLAG] = true;
        Promise.resolve().then(() => {
          if (typeof document === "undefined") return;
          Promise.all([
            Promise.resolve().then(() => (init_dist(), dist_exports)),
            import("react"),
            import("react-dom/client")
          ]).then(([{ OpenUIDevtools: OpenUIDevtools2 }, React, ReactDOMClient]) => {
            const attach = () => {
              const host = document.createElement("div");
              host.setAttribute("data-openui-devtools-auto-mount", "");
              document.body.appendChild(host);
              ReactDOMClient.createRoot(host).render(React.createElement(OpenUIDevtools2, {
                version: "0",
                __autoMounted: true
              }));
            };
            if (document.body) attach();
            else document.addEventListener("DOMContentLoaded", attach, { once: true });
          }).catch(() => {
          });
        });
      }
    }
  }
});

// src/client/index.js
var index_exports = {};
__export(index_exports, {
  apply: () => apply
});
module.exports = __toCommonJS(index_exports);

// src/client/omni-ui-spec.js
init_dist2();
init_v4();
var FENCE = "openui-lang";
var QUERY_TOOL = "omni_get";
var CHANNELS_TOOL = "omni_channels";
var READ_TOOLS = [
  { name: CHANNELS_TOOL, description: 'Every channel with its live state: {items: [{id, name, channel, state ("connected", "connecting", "paused"…), profile, phone, active}]}.', inputSchema: { type: "object", properties: {} } },
  { name: "omni_chats", description: "Chats and groups, most recent first: {items: [{id, name, type, channelId, unread, lastMessageAt, preview}], more}.", inputSchema: { type: "object", properties: { channel: { type: "string", description: "Channel id or exact name" }, search: { type: "string" }, unread_only: { type: "boolean" }, limit: { type: "number" } } } },
  { name: "omni_messages", description: "A chat's latest messages, oldest first: {chat: {id, name, channel}, items: [{from, at, text}]}.", inputSchema: { type: "object", properties: { chat: { type: "string", description: "Chat id" }, limit: { type: "number" } }, required: ["chat"] } },
  { name: QUERY_TOOL, description: "GET one documented omni API operation and return its JSON ({data} for one record, {items, meta} for lists).", inputSchema: { type: "object", properties: { path: { type: "string", description: "API path under /api/v2 with ids, e.g. /automations" }, query: { type: "object", description: "Query parameters, e.g. {limit: 20}" } }, required: ["path"] } }
];
var QUERY_TOOLS = READ_TOOLS.map((tool) => tool.name);
var ActionExpression = external_exports.any();
tagSchemaId(ActionExpression, "ActionExpression");
var tone = external_exports.enum(["ok", "warn", "bad", "info", "muted"]);
var point = external_exports.object({ label: external_exports.string().max(200), value: external_exports.number().finite() });
var SPECS = [
  ["Stack", 'Vertical group; the root of every canvas. gap: "s" | "m" | "l".', external_exports.object({ children: external_exports.array(external_exports.any()).max(40), gap: external_exports.enum(["s", "m", "l"]).optional() })],
  ["Row", "Side-by-side group that wraps on narrow screens (stats, buttons, cards).", external_exports.object({ children: external_exports.array(external_exports.any()).max(12), gap: external_exports.enum(["s", "m", "l"]).optional() })],
  ["Card", "A bordered section with a title.", external_exports.object({ title: external_exports.string().max(200), children: external_exports.array(external_exports.any()).max(40), subtitle: external_exports.string().max(300).optional() })],
  ["Heading", "A section title.", external_exports.object({ text: external_exports.string().max(200) })],
  ["Text", 'A paragraph. tone "muted" for secondary text.', external_exports.object({ content: external_exports.string().max(4e3), tone: external_exports.enum(["normal", "muted"]).optional() })],
  ["Badge", "A short status label.", external_exports.object({ text: external_exports.string().max(80), tone: tone.optional() })],
  ["Stat", "A key number with its label and an optional hint.", external_exports.object({ label: external_exports.string().max(120), value: external_exports.union([external_exports.number().finite(), external_exports.string().max(120)]), hint: external_exports.string().max(200).optional() })],
  ["Table", "Rows of values under column titles. Each row is an array in column order.", external_exports.object({ columns: external_exports.array(external_exports.string().max(80)).min(1).max(10), rows: external_exports.array(external_exports.array(external_exports.any()).max(10)).max(200) })],
  ["Chart", "Bars, a line or a donut from {label, value} points (at most 50).", external_exports.object({ kind: external_exports.enum(["bars", "line", "donut"]), data: external_exports.array(point).max(50), title: external_exports.string().max(200).optional() })],
  ["KeyValue", "Label/value pairs, for the fields of one record.", external_exports.object({ pairs: external_exports.array(external_exports.object({ label: external_exports.string().max(120), value: external_exports.any() })).max(40) })],
  ["Select", "A choice bound to a $variable; changing it only changes what the canvas shows.", external_exports.object({ name: external_exports.string().max(100), label: external_exports.string().max(200), options: external_exports.array(external_exports.string().max(200)).min(1).max(30), value: external_exports.string().max(200) })],
  ["Button", 'A button. Its action asks you (@ToAssistant) to do something, or opens a link (@OpenUrl). tone: "primary" | "normal" | "danger".', external_exports.object({ label: external_exports.string().max(80), action: ActionExpression, tone: external_exports.enum(["primary", "normal", "danger"]).optional() })],
  ["Channel", "Live card of one omni channel (instance): name, kind, connection state, profile. Updates by itself.", external_exports.object({ id: external_exports.string().max(100) })],
  ["QrCode", 'Live WhatsApp QR code for connecting a channel (instance id). Refreshes as WhatsApp rotates it and turns into "Connected" once scanned.', external_exports.object({ channelId: external_exports.string().max(100) })],
  ["Chat", "Live card of one chat with its latest messages.", external_exports.object({ id: external_exports.string().max(100), limit: external_exports.number().int().min(1).max(30).optional() })]
];
var ROOT = "Stack";
var BINDINGS = { Select: "value" };
function libraryOf({ createLibrary: createLibrary2, defineComponent: defineComponent2, reactive: reactive2 }, render = {}) {
  return createLibrary2({
    root: ROOT,
    components: SPECS.map(([name, description, props]) => {
      const bound = BINDINGS[name];
      const shaped = bound && reactive2 ? props.extend({ [bound]: reactive2(props.shape[bound]) }) : props;
      return defineComponent2({ name, description, props: shaped, component: render[name] ?? (() => null) });
    })
  });
}
var PROMPT_OPTIONS = {
  preamble: "A canvas is an openui-lang program, passed to show_canvas: it renders as native, live UI in the chat.",
  tools: READ_TOOLS,
  bindings: true,
  additionalRules: [
    'A Query reads omni live with your own read tools, same names and arguments: Query("omni_chats", {channel: "sales", unread_only: true}, {items: []}, 20). The last argument refreshes it every N seconds.',
    `Connection state comes from Query("${CHANNELS_TOOL}", {}, {items: []}, 10): its items carry state; /instances items do not.`,
    'Mutation() is not available. Changes are yours to make with omni_call; a Button asks you for one with Action([@ToAssistant("...")]).',
    "Channel, QrCode and Chat fetch and refresh their own data from an id: prefer them to rebuilding those views from a Query. A channel's live state is what Channel shows; /instances items carry no connection state.",
    "Use only fields you have seen in a real record (read one with omni_call first). Instances carry name, channel, isActive and profileName; whether one is connected comes from /instances/{id}/status, which Channel already shows.",
    'A @Each loop variable exists only inside its template: write @Each(inst.items, "i", Channel(i.id)), never i.name in another statement.',
    "A canvas cannot read secrets, call other services or run code."
  ],
  examples: [
    'root = Stack([title, row, list])\ntitle = Heading("Channels")\nrow = Row([Stat("Connected", @Count(@Filter(ch.items, "state", "==", "connected"))), Stat("Total", @Count(ch.items))])\nch = Query("omni_channels", {}, {items: []}, 10)\nlist = Stack(@Each(ch.items, "c", Channel(c.id)))',
    'root = Stack([qr, again])\nqr = QrCode("5f0c1d2e-…")\nagain = Button("Get a new code", Action([@ToAssistant("Restart the connection of that channel")]))'
  ]
};

// src/client/omni-ui-check.js
init_dist2();
var PROGRAM_MAX = 32768;
var TOKENS_MAX = 6e3;
var STATEMENTS_MAX = 128;
var NODES_MAX = 4e3;
var DEPTH_MAX = 48;
var library = libraryOf({ createLibrary, defineComponent, reactive: (schema) => {
  markReactive(schema);
  return schema;
} });
var parser = createParser(library.toJSONSchema(), library.root);
var ALLOWED = /* @__PURE__ */ new Set([...SPECS.map(([name]) => name), ...BUILTIN_NAMES, "Query"]);
var say = (text, params) => params ? { text, params } : { text };
function unclosedLine(program) {
  const lines = program.split("\n");
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue;
    const stack = [];
    let quoted = false;
    for (let at = 0; at < line.length; at += 1) {
      const char = line[at];
      if (quoted) {
        if (char === "\\") at += 1;
        else if (char === '"') quoted = false;
        continue;
      }
      if (char === '"') quoted = true;
      else if ("([{".includes(char)) stack.push(char);
      else if (")]}".includes(char)) {
        const open2 = stack.pop();
        if (open2 !== { ")": "(", "]": "[", "}": "{" }[char]) return { line: index + 1, text: line.trim().slice(0, 60) };
      }
    }
    if (quoted || stack.length > 0) return { line: index + 1, text: line.trim().slice(0, 60) };
  }
  return null;
}
function checkProgram(program) {
  const source = String(program ?? "");
  if (!source.trim()) return say("The canvas is empty.");
  if (source.length > PROGRAM_MAX) return say("The canvas is too long.");
  try {
    const tokens = tokenize(source);
    if (tokens.length > TOKENS_MAX) return say("The canvas is too complex.");
    const statements = split(tokens);
    if (statements.length > STATEMENTS_MAX) return say("The canvas is too complex.");
    let nodes = 0;
    for (const statement of statements) {
      const expression = parseExpression(statement.tokens);
      const pending = [[expression, 0]];
      while (pending.length) {
        const [value, depth] = pending.pop();
        if (depth > DEPTH_MAX) return say("The canvas is nested too deeply.");
        if (value && typeof value === "object") {
          for (const child of Object.values(value)) if (child && typeof child === "object") pending.push([child, depth + 1]);
        }
      }
      let refusal = null;
      walkAST(expression, (node2) => {
        if (++nodes > NODES_MAX) refusal ??= say("The canvas is too complex.");
        if (node2.k === "Comp" && node2.name === "Mutation") refusal ??= say("A canvas cannot change omni; ask Omni instead.");
        else if (node2.k === "Comp" && !ALLOWED.has(node2.name)) refusal ??= say("Unknown component {name}.", { name: node2.name });
      });
      if (refusal) return refusal;
    }
    const result = parser.parse(source);
    if (result.meta.incomplete) {
      const open3 = unclosedLine(source);
      return open3 ? say("Line {line} does not close its brackets or quotes: {text}", open3) : say("The canvas is incomplete.");
    }
    if (result.mutationStatements.length > 0) return say("A canvas cannot change omni; ask Omni instead.");
    if (result.queryStatements.some((query) => query.toolAST?.k !== "Str" || !QUERY_TOOLS.includes(query.toolAST.v))) return say("A canvas can only read omni.");
    if (!result.root || result.root.typeName !== library.root) return say("The canvas must start with root = Stack(...).");
    const errors = result.meta.errors.filter((error2) => error2.code !== "excess-args");
    if (errors.length > 0) return say(errors.slice(0, 3).map((error2) => error2.message).join(" "));
    if (result.meta.unresolved.length > 0) return say("The canvas names something it never defines: {names}.", { names: result.meta.unresolved.slice(0, 3).join(", ") });
    const open2 = unclosedLine(source);
    if (open2) return say("Line {line} does not close its brackets or quotes: {text}", open2);
    return null;
  } catch (error2) {
    return say(error2 instanceof Error ? error2.message : "The canvas could not be read.");
  }
}
var refusalText = (refusal) => refusal.text.replace(/\{(\w+)\}/g, (whole, key) => String(refusal.params?.[key] ?? whole));

// src/client/core.js
var import_client = require("@automagik/omni-dsh/client");
var import_client2 = require("@automagik/omni-channels-dsh/client");
var { call, t, addStrings, onShell, toolCards, setCanvasRenderer } = import_client.omni;
var live = import_client2.channels;

// src/client/omni-ui.js
var import_react3 = require("react");
init_dist4();
var { Badge, KeyValue, LiveChannel, LiveChat, LiveQr, Table } = live;
var RuntimeReady = (0, import_react3.createContext)(false);
var nodeOf = (value, renderNode) => value && typeof value === "object" && "typeName" in value ? renderNode(value) : value === null || value === void 0 ? null : String(value);
function Stack({ props, renderNode }) {
  if (!(0, import_react3.useContext)(RuntimeReady)) return null;
  return (0, import_react3.createElement)("div", { className: "ou-stack", "data-gap": props.gap ?? "m" }, (props.children ?? []).map((child, index) => (0, import_react3.createElement)(import_react3.Fragment, { key: index }, nodeOf(child, renderNode))));
}
var Row = ({ props, renderNode }) => (0, import_react3.createElement)("div", { className: "ou-row", "data-gap": props.gap ?? "m" }, (props.children ?? []).map((child, index) => (0, import_react3.createElement)(import_react3.Fragment, { key: index }, nodeOf(child, renderNode))));
var Card = ({ props, renderNode }) => (0, import_react3.createElement)(
  "section",
  { className: "ou-section" },
  (0, import_react3.createElement)("header", null, (0, import_react3.createElement)("strong", null, props.title), props.subtitle ? (0, import_react3.createElement)("span", { className: "ou-muted" }, props.subtitle) : null),
  (props.children ?? []).map((child, index) => (0, import_react3.createElement)(import_react3.Fragment, { key: index }, nodeOf(child, renderNode)))
);
var Heading = ({ props }) => (0, import_react3.createElement)("div", { className: "ou-heading", role: "heading", "aria-level": 3 }, props.text);
var Text = ({ props }) => (0, import_react3.createElement)("p", { className: "ou-text", "data-tone": props.tone ?? "normal" }, props.content);
var BadgeNode = ({ props }) => (0, import_react3.createElement)(Badge, { text: props.text, tone: props.tone });
var Stat = ({ props }) => (0, import_react3.createElement)(
  "div",
  { className: "ou-stat" },
  (0, import_react3.createElement)("span", { className: "ou-stat-label" }, props.label),
  (0, import_react3.createElement)("strong", { className: "ou-stat-value" }, typeof props.value === "number" ? props.value.toLocaleString() : props.value ?? "—"),
  props.hint ? (0, import_react3.createElement)("span", { className: "ou-muted" }, props.hint) : null
);
var TableNode = ({ props, renderNode }) => (0, import_react3.createElement)(Table, { columns: props.columns, rows: (props.rows ?? []).map((row) => (Array.isArray(row) ? row : [row]).map((value) => value && typeof value === "object" && "typeName" in value ? renderNode(value) : value)) });
var KeyValueNode = ({ props }) => (0, import_react3.createElement)(KeyValue, { pairs: props.pairs ?? [] });
function Chart({ props }) {
  const data = (props.data ?? []).filter((point2) => Number.isFinite(point2?.value));
  if (data.length === 0) return (0, import_react3.createElement)("span", { className: "ou-muted" }, t("No data to chart."));
  const title = props.title ? (0, import_react3.createElement)("strong", { className: "ou-chart-title" }, props.title) : null;
  if (props.kind === "donut") {
    const total = data.reduce((sum, point2) => sum + Math.max(0, point2.value), 0) || 1;
    let start = 0;
    const R = 15.9155;
    return (0, import_react3.createElement)(
      "figure",
      { className: "ou-chart ou-donut" },
      title,
      (0, import_react3.createElement)(
        "div",
        { className: "ou-donut-row" },
        (0, import_react3.createElement)(
          "svg",
          { viewBox: "0 0 42 42", width: 120, height: 120, role: "img", "aria-label": props.title ?? t("Chart") },
          data.map((point2, index) => {
            const share = Math.max(0, point2.value) / total * 100;
            const arc = (0, import_react3.createElement)("circle", { key: index, cx: 21, cy: 21, r: R, fill: "none", stroke: `hsl(${(index * 57 + 200) % 360} 65% 55%)`, strokeWidth: 6, strokeDasharray: `${share} ${100 - share}`, strokeDashoffset: 25 - start });
            start += share;
            return arc;
          })
        ),
        (0, import_react3.createElement)("ul", { className: "ou-legend" }, data.map((point2, index) => (0, import_react3.createElement)("li", { key: index }, (0, import_react3.createElement)("i", { style: { background: `hsl(${(index * 57 + 200) % 360} 65% 55%)` } }), point2.label, (0, import_react3.createElement)("span", { className: "ou-muted" }, point2.value.toLocaleString()))))
      )
    );
  }
  if (props.kind === "line") {
    const max2 = Math.max(...data.map((point2) => point2.value));
    const min = Math.min(0, ...data.map((point2) => point2.value));
    const span = max2 - min || 1;
    const x = (index) => data.length === 1 ? 50 : index / (data.length - 1) * 100;
    const y = (value) => 38 - (value - min) / span * 34;
    return (0, import_react3.createElement)(
      "figure",
      { className: "ou-chart" },
      title,
      (0, import_react3.createElement)(
        "svg",
        { viewBox: "0 0 100 40", preserveAspectRatio: "none", className: "ou-line", role: "img", "aria-label": props.title ?? t("Chart") },
        (0, import_react3.createElement)("polyline", { points: data.map((point2, index) => `${x(index)},${y(point2.value)}`).join(" "), fill: "none", stroke: "var(--bt-accent)", strokeWidth: 1.4, vectorEffect: "non-scaling-stroke" })
      ),
      (0, import_react3.createElement)("div", { className: "ou-line-axis" }, (0, import_react3.createElement)("span", null, data[0].label), (0, import_react3.createElement)("span", null, data.at(-1).label))
    );
  }
  const max = Math.max(...data.map((point2) => Math.abs(point2.value))) || 1;
  return (0, import_react3.createElement)(
    "figure",
    { className: "ou-chart" },
    title,
    (0, import_react3.createElement)("div", { className: "ou-bars" }, data.map((point2, index) => (0, import_react3.createElement)(
      "div",
      { key: index, className: "ou-bar" },
      (0, import_react3.createElement)("span", { className: "ou-bar-label" }, point2.label),
      (0, import_react3.createElement)("span", { className: "ou-bar-track" }, (0, import_react3.createElement)("span", { className: "ou-bar-fill", style: { width: `${Math.abs(point2.value) / max * 100}%` } })),
      (0, import_react3.createElement)("span", { className: "ou-bar-value" }, point2.value.toLocaleString())
    )))
  );
}
function Select({ props }) {
  const field = useStateField(props.name, props.value);
  const options = props.options ?? [];
  return (0, import_react3.createElement)(
    "label",
    { className: "ou-select" },
    (0, import_react3.createElement)("span", null, props.label),
    (0, import_react3.createElement)(
      "select",
      { name: field.name, value: field.value ?? options[0] ?? "", onChange: (event) => {
        if (options.includes(event.target.value)) field.setValue(event.target.value);
      } },
      options.map((option) => (0, import_react3.createElement)("option", { key: option, value: option }, option))
    )
  );
}
function Button({ props }) {
  const trigger = useTriggerAction();
  return (0, import_react3.createElement)("button", { type: "button", className: "ou-button", "data-tone": props.tone ?? "normal", onClick: () => trigger(props.label, void 0, props.action) }, props.label);
}
var RENDER = {
  Stack,
  Row,
  Card,
  Heading,
  Text,
  Badge: BadgeNode,
  Stat,
  Table: TableNode,
  Chart,
  KeyValue: KeyValueNode,
  Select,
  Button,
  Channel: ({ props }) => (0, import_react3.createElement)(LiveChannel, { id: props.id }),
  QrCode: ({ props }) => (0, import_react3.createElement)(LiveQr, { channelId: props.channelId }),
  Chat: ({ props }) => (0, import_react3.createElement)(LiveChat, { id: props.id, limit: props.limit })
};
var omniLibrary = libraryOf({ createLibrary: createLibrary$1, defineComponent: defineComponent$1, reactive }, RENDER);
var checkProgram2 = (program) => {
  const refusal = checkProgram(program);
  return refusal === null ? null : t(refusal.text, refusal.params);
};
var readOmni = Object.fromEntries(QUERY_TOOLS.map((name) => [name, async (args) => call("omni-read", { tool: name, args })]));
function Fallback({ program, reason, onAsk }) {
  return (0, import_react3.createElement)(
    "div",
    { className: "ou-fallback" },
    (0, import_react3.createElement)("p", { role: "alert" }, t("This view could not be drawn: {reason}", { reason })),
    (0, import_react3.createElement)(
      "div",
      { className: "ou-fallback-row" },
      onAsk ? (0, import_react3.createElement)("button", { type: "button", className: "ou-button", onClick: () => onAsk(`Your canvas could not be drawn: ${reason}
Send a corrected one.`) }, t("Ask to fix it")) : null,
      (0, import_react3.createElement)("details", null, (0, import_react3.createElement)("summary", null, t("Source")), (0, import_react3.createElement)("pre", null, program))
    )
  );
}
var Boundary = class extends import_react3.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (0, import_react3.createElement)(Fallback, { program: this.props.program, reason: t("it failed while rendering."), onAsk: this.props.onAsk }) : this.props.children;
  }
};
function Canvas({ program, onAsk }) {
  const invalid = (0, import_react3.useMemo)(() => checkProgram2(program), [program]);
  const [ready, setReady] = (0, import_react3.useState)(false);
  const [failed, setFailed] = (0, import_react3.useState)(null);
  (0, import_react3.useEffect)(() => setReady(true), []);
  const onError = (0, import_react3.useCallback)((errors) => {
    if (errors.length > 0) setFailed(errors[0]?.message ?? t("a part could not be rendered."));
  }, []);
  const onAction = (0, import_react3.useCallback)((event) => {
    if (event.type === "continue_conversation") onAsk(String(event.params?.message ?? event.humanFriendlyMessage ?? ""));
    else if (event.type === "open_url" && /^https?:\/\//i.test(String(event.params?.url ?? ""))) window.open(event.params.url, "_blank", "noopener,noreferrer");
  }, [onAsk]);
  if (invalid || failed) return (0, import_react3.createElement)(Fallback, { program, reason: invalid ?? failed, onAsk });
  return (0, import_react3.createElement)(
    RuntimeReady.Provider,
    { value: ready },
    (0, import_react3.createElement)(Renderer, { response: program, library: omniLibrary, isStreaming: false, toolProvider: readOmni, onAction, onError, publishObservability: false })
  );
}
function OmniCanvas({ program, complete, onAsk }) {
  if (!complete) return (0, import_react3.createElement)("div", { className: "ou-canvas ou-drawing" }, (0, import_react3.createElement)("span", { className: "ou-live-dot", "aria-hidden": true }), t("Drawing…"));
  return (0, import_react3.createElement)("div", { className: "ou-canvas" }, (0, import_react3.createElement)(Boundary, { key: program, program, onAsk }, (0, import_react3.createElement)(Canvas, { program, onAsk })));
}
var OMNI_UI_CSS = `
.bt-canvas-line{display:flex;margin:4px 0;min-width:0}
.ou-canvas{margin:6px 0;width:100%;max-width:680px;color:var(--bt-ink);font-size:14px}
.ou-drawing{display:inline-flex;align-items:center;gap:8px;padding:10px 14px;border:1px dashed var(--bt-line-2);border-radius:14px;color:var(--bt-ink-3);font-size:13px}
.ou-stack{display:flex;flex-direction:column;gap:12px;min-width:0}
.ou-stack[data-gap=s]{gap:6px}
.ou-stack[data-gap=l]{gap:20px}
.ou-row{display:flex;flex-wrap:wrap;gap:10px;align-items:stretch}
.ou-row>*{flex:1 1 140px;min-width:0}
.ou-row[data-gap=s]{gap:6px}
.ou-row[data-gap=l]{gap:18px}
.ou-section{display:flex;flex-direction:column;gap:10px;padding:14px;border:1px solid var(--bt-line);border-radius:16px;background:var(--bt-card)}
.ou-section>header{display:flex;flex-direction:column;gap:2px}
.ou-section>header strong{font-size:14px;font-weight:600}
.ou-heading{font-size:16px;font-weight:600;line-height:22px}
.ou-text{margin:0;line-height:1.5}
.ou-text[data-tone=muted]{color:var(--bt-ink-3);font-size:13px}
.ou-stat{display:flex;flex-direction:column;gap:2px;padding:12px 14px;border:1px solid var(--bt-line);border-radius:14px;background:var(--bt-card)}
.ou-stat-label{font-size:12.5px;color:var(--bt-ink-3)}
.ou-stat-value{font-size:22px;line-height:28px;font-weight:600;font-variant-numeric:tabular-nums}
.ou-chart{margin:0;display:flex;flex-direction:column;gap:8px;padding:12px 14px;border:1px solid var(--bt-line);border-radius:14px;background:var(--bt-card)}
.ou-chart-title{font-size:13px;font-weight:600}
.ou-bars{display:flex;flex-direction:column;gap:6px}
.ou-bar{display:grid;grid-template-columns:minmax(60px,30%) 1fr auto;gap:10px;align-items:center;font-size:12.5px}
.ou-bar-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--bt-ink-2)}
.ou-bar-track{height:8px;border-radius:4px;background:var(--bt-hover);overflow:hidden}
.ou-bar-fill{display:block;height:100%;border-radius:4px;background:var(--bt-accent)}
.ou-bar-value{font-variant-numeric:tabular-nums;color:var(--bt-ink-2)}
.ou-line{width:100%;height:90px}
.ou-line-axis{display:flex;justify-content:space-between;font-size:11px;color:var(--bt-ink-3)}
.ou-donut-row{display:flex;align-items:center;gap:18px;flex-wrap:wrap}
.ou-legend{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px;font-size:12.5px}
.ou-legend li{display:flex;align-items:center;gap:6px}
.ou-legend i{width:9px;height:9px;border-radius:3px}
.ou-select{display:inline-flex;align-items:center;gap:8px;font-size:13px;color:var(--bt-ink-2)}
.ou-select select,.ou-button{height:34px;padding:0 12px;border:1px solid var(--bt-line-2);border-radius:10px;background:var(--bt-card);color:var(--bt-ink);font:inherit;font-size:13.5px;cursor:pointer}
.ou-button[data-tone=primary]{border-color:transparent;background:var(--bt-ink);color:var(--bt-main)}
.ou-button[data-tone=danger]{color:#d13438}
.ou-button:hover{background:var(--bt-hover)}
.ou-button[data-tone=primary]:hover{opacity:.9;background:var(--bt-ink)}
.ou-row>.ou-button{flex:0 0 auto}
.ou-fallback{padding:10px 12px;border-left:3px solid #ff9800;font-size:13px}
.ou-fallback p{margin:0 0 6px}
.ou-fallback-row{display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap}
.ou-fallback summary{cursor:pointer;color:var(--bt-ink-3);line-height:34px}
.ou-fallback pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}
`;

// src/client/strings.js
var STRINGS = {
  "A canvas cannot change omni; ask Omni instead.": "画布不能修改 omni；请让 Omni 来做。",
  "A canvas can only read omni.": "画布只能读取 omni。",
  "a part could not be rendered.": "有一部分无法显示。",
  "Drawing…": "正在绘制…",
  "it failed while rendering.": "显示时出错。",
  "No data to chart.": "没有可绘制的数据。",
  "Source": "源码",
  "The canvas could not be read.": "无法读取这个画布。",
  "The canvas is empty.": "画布是空的。",
  "The canvas is incomplete.": "画布不完整。",
  "The canvas is nested too deeply.": "画布嵌套层级太深。",
  "The canvas is too complex.": "画布太复杂了。",
  "The canvas is too long.": "画布太长了。",
  "The canvas must start with root = Stack(...).": "画布必须以 root = Stack(...) 开头。",
  "The canvas names something it never defines: {names}.": "画布引用了未定义的内容：{names}。",
  "This view could not be drawn: {reason}": "无法绘制这个视图：{reason}",
  "Unknown component {name}.": "未知组件 {name}。",
  "Ask to fix it": "让它修正",
  "Drawing it": "正在绘制",
  "Line {line} does not close its brackets or quotes: {text}": "第 {line} 行的括号或引号没有闭合：{text}"
};

// src/client/index.js
var import_react4 = require("react");
var canvasCard = ({ arg, argValue, done, content, sessionId, actions }) => {
  if (done && !content.startsWith("Shown")) return null;
  return (0, import_react4.createElement)("div", { className: "bt-canvas-line" }, (0, import_react4.createElement)(OmniCanvas, { program: argValue("program") ?? arg("program") ?? "", complete: done, onAsk: (message) => message && actions.send(sessionId, message) }));
};
function apply(ctx) {
  ctx.effect(() => addStrings(STRINGS), "ds-bot: canvas copy");
  ctx.effect(() => setCanvasRenderer(OmniCanvas), "ds-bot: canvases");
  ctx.effect(() => toolCards.register("show_canvas", canvasCard, { phrase: () => ({ label: t("Drawing it"), state: "working" }) }), "ds-bot: canvas card");
  ctx.effect(() => onShell(({ installCompiledStyles }) => [() => installCompiledStyles(OMNI_UI_CSS, "canvases")]), "ds-bot: canvas styles");
}
return Object.defineProperty({ ...module.exports }, Symbol.toStringTag, { value: 'Module' })
  },
})
