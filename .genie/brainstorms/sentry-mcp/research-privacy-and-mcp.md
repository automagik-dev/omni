# Sentry Research: Privacy, Data Scrubbing & MCP Server

> Exhaustive research from docs.sentry.io — March 2026
> Sources: sentry-mcp GitHub repo, Sentry docs (filtering, sensitive-data, scrubbing, relay, integrations)

---

## Part 1: Privacy & Data Scrubbing

### 1.1 What Sentry Captures by Default

Sentry automatically captures data from these sources:

| Data Source | Default Behavior | PII Risk |
|---|---|---|
| **Stack traces** | Variable values in traces (stack-locals) | HIGH - may contain user data in variables |
| **Breadcrumbs** | Console logs, HTTP requests, DB queries, UI clicks | HIGH - log statements may contain names, messages |
| **HTTP request data** | Query strings, fragments, headers, body | HIGH - URLs may contain phone numbers, tokens |
| **Transaction names** | Raw URL paths (e.g., `/users/1234/details`) | HIGH - user IDs, phone numbers in URLs |
| **HTTP spans** | Request/response metadata | MEDIUM - URLs, headers |
| **User context** | IP address (only if `sendDefaultPii: true`) | HIGH |
| **Error messages** | Exception messages | HIGH - may contain user data |
| **Tags** | Custom and auto-generated tags | MEDIUM |

### 1.2 `sendDefaultPii` — What It Controls

```typescript
Sentry.init({
  sendDefaultPii: false, // DEFAULT — false
});
```

- **Default: `false`** — PII is NOT automatically collected
- **When `true`**: Enables automatic IP address collection on events. On servers, IP addresses are inferred from incoming HTTP requests
- **When `false`**: No automatic PII collection, but manually-set user context (via `Sentry.setUser()`) is still sent
- **Recommendation for Omni**: Keep `false`. Never set to `true` for a messaging platform.

### 1.3 `beforeSend` — Error Event Filtering

The primary client-side hook for scrubbing/dropping error events.

```typescript
Sentry.init({
  dsn: "...",
  beforeSend(event, hint) {
    // ACCESS: event.user, event.breadcrumbs, event.contexts, event.extra, event.tags
    // hint.originalException — the original thrown error
    // hint.syntheticException — synthetic for string/non-error throws

    // Return event to send, null to DROP entirely
    return event;
  },
});
```

#### Full Scrubbing Example for Omni:

```typescript
beforeSend(event, hint) {
  // 1. Strip ALL user context
  if (event.user) {
    delete event.user.email;
    delete event.user.ip_address;
    delete event.user.username;
    // Keep only anonymous ID
    event.user = event.user.id ? { id: event.user.id } : undefined;
  }

  // 2. Scrub breadcrumbs — remove message content, phone numbers
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map(crumb => {
      if (crumb.category === "console") {
        delete crumb.data; // Console logs may contain chat messages
        crumb.message = "[scrubbed]";
      }
      if (crumb.category === "http" || crumb.category === "fetch") {
        // Scrub URLs that might contain phone numbers
        if (crumb.data?.url) {
          crumb.data.url = scrubUrl(crumb.data.url);
        }
      }
      return crumb;
    });
  }

  // 3. Scrub error messages (may contain phone numbers, chat content)
  if (event.exception?.values) {
    event.exception.values = event.exception.values.map(ex => {
      if (ex.value) {
        ex.value = scrubPii(ex.value);
      }
      return ex;
    });
  }

  // 4. Scrub transaction names
  if (event.transaction) {
    event.transaction = parameterizeTransaction(event.transaction);
  }

  // 5. Scrub request data
  if (event.request) {
    delete event.request.cookies;
    delete event.request.data; // POST body
    if (event.request.query_string) {
      event.request.query_string = "[scrubbed]";
    }
    if (event.request.url) {
      event.request.url = scrubUrl(event.request.url);
    }
    // Scrub sensitive headers
    if (event.request.headers) {
      delete event.request.headers["Authorization"];
      delete event.request.headers["Cookie"];
      delete event.request.headers["X-Forwarded-For"];
    }
  }

  // 6. Scrub tags
  if (event.tags) {
    delete event.tags.server_name; // hostname is PII-adjacent
  }

  return event;
},
```

### 1.4 `beforeSendTransaction` — Transaction Event Filtering

```typescript
Sentry.init({
  beforeSendTransaction(event) {
    // Drop health-check noise
    if (event.transaction === "/health" || event.transaction === "/ready") {
      return null;
    }

    // Parameterize URLs to avoid PII leaks
    // /chat/5511999887766 -> /chat/:phoneNumber
    if (event.transaction) {
      event.transaction = event.transaction
        .replace(/\/\d{10,15}/g, "/:phoneNumber")
        .replace(/\/[a-f0-9-]{36}/g, "/:uuid");
    }

    return event;
  },
});
```

### 1.5 `beforeBreadcrumb` — Breadcrumb Filtering

```typescript
Sentry.init({
  beforeBreadcrumb(breadcrumb, hint) {
    // DROP UI click breadcrumbs (not relevant for server)
    if (breadcrumb.category === "ui.click") return null;

    // Scrub console breadcrumbs (may contain chat messages)
    if (breadcrumb.category === "console") {
      breadcrumb.message = "[scrubbed]";
      delete breadcrumb.data;
    }

    // Scrub HTTP breadcrumbs
    if (breadcrumb.category === "http" || breadcrumb.category === "fetch") {
      if (breadcrumb.data?.url) {
        breadcrumb.data.url = scrubUrl(breadcrumb.data.url);
      }
      // Remove response body
      delete breadcrumb.data?.response;
    }

    return breadcrumb;
  },
});
```

**Hint contents for breadcrumbs:**
- `hint.event` — Browser event (for UI breadcrumbs)
- `hint.level`, `hint.input` — Console log level and arguments
- `hint.response`, `hint.input` — Fetch response and parameters
- `hint.request`, `hint.response`, `hint.event` — Node HTTP request/response
- `hint.xhr` — Legacy XMLHttpRequest object

### 1.6 `beforeSendSpan` — Span Filtering

```typescript
Sentry.init({
  beforeSendSpan(span) {
    // NOTE: Cannot return null — cannot DROP spans, only MODIFY
    if (span.description) {
      span.description = span.description
        .replace(/\/\d{10,15}/g, "/:phoneNumber")
        .replace(/\/[a-f0-9-]{36}/g, "/:uuid");
    }
    return span;
  },
});
```

**Important**: `beforeSendSpan` CANNOT drop spans. To drop an entire transaction (with all spans), use `beforeSendTransaction` returning `null`.

### 1.7 `ignoreErrors` — Error Message Filtering

```typescript
Sentry.init({
  ignoreErrors: [
    // Strings = partial match (substring)
    "ResizeObserver loop",
    "Network request failed",

    // Regex = exact control
    /^Loading chunk \d+ failed$/,
    /database unavailable/i,
  ],
});
```

- **Strings**: Partial match — any error message containing the substring is filtered
- **Regex**: Precise pattern matching

### 1.8 `denyUrls` and `allowUrls` — Source Filtering

Filters errors **based on their stack frame URLs**, NOT the page URL.

```typescript
Sentry.init({
  // Only accept errors from our own code
  allowUrls: [/https?:\/\/((cdn|www)\.)?example\.com/],

  // Block errors from third-party scripts
  denyUrls: [
    /extensions\//i,
    /^chrome:\/\//i,
    /^chrome-extension:\/\//i,
  ],
});
```

### 1.9 Integrations to Disable for Privacy

```typescript
Sentry.init({
  integrations: function(integrations) {
    return integrations.filter(integration => {
      // Remove integrations that capture PII-risk data
      return ![
        "Console",           // consoleIntegration — captures log content
        "Http",              // httpIntegration — captures HTTP request details
        "NodeFetch",         // nativeNodeFetchIntegration — captures fetch details
        "RequestData",       // requestDataIntegration — adds incoming request data
      ].includes(integration.name);
    });
  },
});
```

| Integration | Default | PII Risk | Recommendation |
|---|---|---|---|
| `consoleIntegration` | ON | HIGH — captures log content which may contain messages | Disable or use beforeBreadcrumb to scrub |
| `httpIntegration` | ON | HIGH — captures HTTP request URLs, headers | Keep but scrub URLs via beforeBreadcrumb |
| `nativeNodeFetchIntegration` | ON | HIGH — captures fetch URLs | Keep but scrub |
| `requestDataIntegration` | ON | MEDIUM — adds incoming request context | Keep but scrub via beforeSend |

### 1.10 Other Privacy-Relevant SDK Options

```typescript
Sentry.init({
  sendDefaultPii: false,        // DEFAULT false — never enable for messaging
  maxBreadcrumbs: 20,           // Reduce from default 100 to limit exposure
  sendClientReports: false,     // Disable SDK operation reports
  enabled: true,                // Set false to fully disable
});
```

### 1.11 URL & Transaction Parameterization

SDKs can auto-parameterize routes (e.g., `/users/1234/details` -> `/users/:userid/details`) but this depends on framework routing setup. For Omni's custom routes:

```typescript
// Manual parameterization helper
function parameterizeTransaction(name: string): string {
  return name
    .replace(/\d{10,15}/g, ":phoneNumber")     // WhatsApp JIDs / phone numbers
    .replace(/[a-f0-9-]{36}/g, ":uuid")         // UUIDs
    .replace(/\d{18,22}/g, ":discordId")        // Discord snowflakes
    .replace(/@[^/]+/g, ":chatId")              // Chat identifiers
    .replace(/[A-Z0-9]{10,}@[a-z.]+/g, ":waid"); // WhatsApp IDs
}
```

### 1.12 `Sentry.setUser()` — Controlled User Context

```typescript
// GOOD — anonymous ID only
Sentry.setUser({ id: instanceId });

// BAD — leaks PII
Sentry.setUser({
  email: "user@example.com",  // NEVER
  username: "John Doe",        // NEVER
  ip_address: "1.2.3.4",      // NEVER
});

// GOOD — hash if you need correlation
Sentry.setTag("instance", checksumOrHash(instanceId));
```

---

## Part 2: Server-Side Scrubbing (Sentry UI)

### 2.1 Default Server-Side Scrubbing

Sentry automatically scrubs by default:

1. **Credit card numbers** — regex-based detection
2. **Password-like fields** — any key containing: `password`, `secret`, `passwd`, `api_key`, `apikey`, `auth`, `credentials`, `mysql_pwd`, `privatekey`, `private_key`, `token`, `bearer`
3. **IP addresses** — optional setting to prevent storage

### 2.2 Configuration Locations

- **Organization-level**: Settings > Security & Privacy > DATA SCRUBBING
- **Project-level**: Settings > Projects > [project] > Security & Privacy > DATA SCRUBBING
- **Note**: Organization-wide settings OVERRIDE project settings

### 2.3 Additional Sensitive Fields

In project settings, add custom field names to scrub:

```
phoneNumber
chatName
messageContent
senderName
recipientName
groupName
```

**Important behavior**: An entry like `phoneNumber` will remove any field named `phoneNumber` AND any field *value* that contains the text `phoneNumber`.

### 2.4 Safe Fields

Exclude specific fields from scrubbing:

```
event_id
timestamp
level
platform
```

Supports path-based selection:
- `user.id` — exact path
- `extra.safe_field` — specific extra field
- `tags.*` — all tag values (if needed)

### 2.5 IP Address Storage Prevention

In Project Settings > Security & Privacy:
- Toggle "Prevent Storing of IP Addresses"
- Recommended for Omni — we don't need IP geo data

---

## Part 3: Advanced Data Scrubbing

### 3.1 Rule Structure

Rules consist of three parts: **[Method] [Data Type] from [Source]**

Example: `[Remove] [Anything] from [$user.geo.**]`

### 3.2 Scrubbing Methods

| Method | Behavior |
|---|---|
| **Remove** | Set to `null`, remove entirely, or replace with empty string |
| **Mask** | Replace all characters with `******` |
| **Hash** | Replace with hashed value (one-way, deterministic) |
| **Replace** | Replace with constant placeholder (default: `[Filtered]`) |

### 3.3 Built-in Data Types

| Type | What It Detects |
|---|---|
| **Anything** | Any value regardless of content |
| **Credit Card Numbers** | Credit card format patterns |
| **Password Fields** | Keys/values matching password, auth, credentials, token patterns |
| **IP Addresses** | IPv4 and IPv6 |
| **IMEI Numbers** | IMEI/IMEISV patterns |
| **Email Addresses** | Standard email format |
| **UUIDs** | UUID identifiers |
| **PEM Keys** | Private key content |
| **Auth in URLs** | `https://user:pass@example.com/foo` |
| **US Social Security Numbers** | 9-digit SSN format |
| **Usernames in Filepaths** | `/Users/myuser/file.txt` |
| **MAC Addresses** | Hardware addresses |

### 3.4 Custom Regex Rules

```
# Syntax — do NOT include slashes
[Remove] [Regex: \d{10,15}] from [$message]
[Mask] [Regex: (?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b] from [**]

# Case-insensitive: prefix with (?i)
# Capture groups: wrap in () and check "Only replace first capture match"
# Uses Rust regex dialect (compatible with regex101.com)
# Escape special chars: \* \. \+ \? \( \) \| \[ \] \{ \} \^ \$
```

### 3.5 Source Selectors

#### Standard Selectors

| Selector | Target |
|---|---|
| `$string` | Any string value |
| `$number` | Integer or float |
| `$datetime` | Timestamps |
| `$array` | JSON arrays |
| `$object` | JSON objects |
| `$error` | Single exception instance (`exception.values.*`) |
| `$stack` | Stack trace instance |
| `$frame` | Stack trace frame (`$stacktrace.frames.*`) |
| `$http` | HTTP request context (`request`) |
| `$user` | User context |
| `$message` | Top-level log message (`$logentry.formatted`) |
| `$logentry` | Event logentry attribute |
| `$thread` | Single thread instance |
| `$breadcrumb` | Single breadcrumb (`breadcrumbs.values.*`) |
| `$span` | Trace span (`spans.*`) |
| `$sdk` | SDK context |
| `$attachments` | Attachment root |
| `$minidump` | Minidump attachments |
| `$binary` | Binary data in attachments |

#### Custom Path Selectors (case-insensitive)

```
extra.'My Value'           # Additional Data key
extra.**                   # ALL Additional Data
$error.value               # Exception message
$http.headers.x-custom-token  # Request header
$user.ip_address           # User IP address
$frame.vars.foo            # Stack frame variable
contexts.device.timezone   # Device context
tags.server_name           # Event tag
```

#### Wildcards

- `**` — All subpaths (only applies to default event PII fields)
- `*` — Single path level
- `foo.**` — All keys within foo
- `foo.*` — Keys one level below foo

#### Boolean Logic

```
!foo            # Everything EXCEPT foo
foo && !extra.foo  # AND conjunction
foo || bar         # OR disjunction
```

### 3.6 Recommended Advanced Rules for Omni

```
# Remove phone numbers from everything
[Remove] [Regex: \+?\d{10,15}] from [**]

# Remove WhatsApp JIDs
[Remove] [Regex: \d+@[sc]\.whatsapp\.net] from [**]

# Remove chat message content from breadcrumbs
[Remove] [Anything] from [$breadcrumb.data.message]
[Remove] [Anything] from [$breadcrumb.data.body]

# Remove user geo data
[Remove] [Anything] from [$user.geo.**]

# Remove email addresses everywhere
[Remove] [Email Addresses] from [**]

# Remove IP addresses
[Remove] [IP Addresses] from [**]

# Mask auth tokens
[Mask] [Regex: (?i)(bearer|token|key|auth)[=:\s]+\S+] from [**]

# Remove request body (may contain message content)
[Remove] [Anything] from [$http.data]

# Remove query strings
[Remove] [Anything] from [$http.query_string]
```

### 3.7 Limitations

1. Hashing/masking JSON objects, arrays, or numbers may fail — value set to `null` instead
2. User IP address must remain valid IPv4/IPv6 or `null`; hashing moves value to user ID
3. Stack trace scrubbing works on file paths but NOT on base file names (use SDK-level)
4. `**` wildcards only apply to default event PII fields — custom fields need explicit paths
5. Advanced rules take PRECEDENCE over basic server-side scrubbing and Safe Fields

---

## Part 4: Relay for On-Prem Scrubbing

### 4.1 What Relay Does

Relay is a standalone service acting as a middle layer between your application SDK and sentry.io. It provides:

1. **Three-tier scrubbing architecture**:
   - SDK-level scrubbing (on device/server, via `beforeSend`)
   - Relay-level scrubbing (in your infrastructure, before data leaves)
   - Sentry infrastructure scrubbing (server-side, in Sentry cloud)

2. **Domain restriction** — acts as opaque proxy, allowing HTTP restriction to custom domain names
3. **Latency improvement** — reduce roundtrip for regions with low bandwidth

### 4.2 How Relay Scrubs

- Relay uses the **same privacy settings configured in Sentry UI**
- Scrubs PII **before forwarding** any data to Sentry cloud
- This means data never leaves your infrastructure un-scrubbed

### 4.3 When to Use Relay

| Scenario | Use Relay? |
|---|---|
| Regulatory compliance (GDPR, LGPD) | YES — scrub before data leaves infrastructure |
| Need domain restriction | YES — proxy through custom domain |
| Self-hosted Sentry | BUILT-IN |
| SaaS Sentry + standard privacy | NO — SDK + server-side rules sufficient |
| Need to guarantee no PII reaches cloud | YES — defense in depth |

### 4.4 Relay for Omni

For a messaging platform handling WhatsApp/Telegram/Discord messages:
- **Recommended**: Use Relay if self-hosting, especially for LGPD (Brazil) compliance
- **Alternative**: If using Sentry SaaS, SDK-level `beforeSend` + server-side Advanced Scrubbing provides strong protection
- Relay adds a third layer of defense but requires infrastructure to deploy

---

## Part 5: Sentry MCP Server

### 5.1 Overview

The Sentry MCP (Model Context Protocol) Server provides **26 tools** for interacting with Sentry data from LLM coding agents. It's designed for "human-in-the-loop coding agents" with tool selection focused on developer workflows and debugging.

### 5.2 Complete Tool List (26 Tools)

#### Identity & Organization (3 tools)

| # | Tool | Description | Scopes |
|---|---|---|---|
| 1 | `whoami` | Identify authenticated user (name, email, user ID, session constraints) | None |
| 2 | `find_organizations` | Find organizations user has access to | `org:read` |
| 3 | `find_teams` | Find teams in an organization | `team:read` |

#### Project & DSN Management (5 tools)

| # | Tool | Description | Scopes |
|---|---|---|---|
| 4 | `find_projects` | Find/search projects | `project:read` |
| 5 | `create_project` | Create new project (includes DSN automatically) | `project:write`, `team:read` |
| 6 | `update_project` | Update project settings (name, slug, platform, team) | `project:write` |
| 7 | `find_dsns` | List all DSNs for a project | `project:read` |
| 8 | `create_dsn` | Create additional DSN for existing project | `project:write` |

#### Team Management (2 tools)

| # | Tool | Description | Scopes |
|---|---|---|---|
| 9 | `create_team` | Create new team | `team:write` |
| 10 | `find_releases` | Find releases for a project | `project:read` |

#### Issue Investigation (5 tools)

| # | Tool | Description | Scopes |
|---|---|---|---|
| 11 | `get_issue_details` | Get detailed info about a specific issue (by ID or URL) | `event:read` |
| 12 | `get_issue_tag_values` | Get tag value distribution for an issue | `event:read` |
| 13 | `update_issue` | Update issue status or assignment (resolve, ignore, assign) | `event:write` |
| 14 | `get_event_attachment` | Download attachments from a Sentry event | `event:read` |
| 15 | `get_sentry_resource` | Fetch any Sentry resource by URL or type+ID | `event:read` |

#### AI-Powered Search (3 tools — require LLM provider)

| # | Tool | Description | Scopes |
|---|---|---|---|
| 16 | `search_issues` | NL search for grouped issues — returns LIST, NOT counts | `event:read` |
| 17 | `search_events` | NL search for events AND counts/aggregations — ONLY tool for statistics | `event:read` |
| 18 | `search_issue_events` | NL search events within a specific issue | `event:read` |

**Important**: These tools use embedded AI agents to translate natural language into Sentry query syntax. They require an LLM provider (OpenAI or Anthropic) configured on the MCP server. Without it, they are replaced by the `list_*` equivalents.

#### Direct Query (Non-AI Fallbacks) (3 tools)

| # | Tool | Description | Scopes |
|---|---|---|---|
| 19 | `list_issues` | List issues using Sentry query syntax directly (no AI) | `event:read` |
| 20 | `list_events` | Search events using Sentry query syntax directly (no AI) | `event:read` |
| 21 | `list_issue_events` | List events within an issue using Sentry query syntax (no AI) | `event:read` |

#### Trace & Performance (2 tools)

| # | Tool | Description | Scopes |
|---|---|---|---|
| 22 | `get_trace_details` | Get detailed trace information by trace ID | `event:read` |
| 23 | `get_profile` | Get profiling data (referenced in code, may be conditional) | `event:read` |

#### AI Analysis (1 tool)

| # | Tool | Description | Scopes |
|---|---|---|---|
| 24 | `analyze_issue_with_seer` | Seer AI root cause analysis with code fix suggestions | None |

#### Documentation (2 tools)

| # | Tool | Description | Scopes |
|---|---|---|---|
| 25 | `search_docs` | Search Sentry docs for SDK setup, instrumentation, config | None |
| 26 | `get_doc` | Fetch full markdown content of a specific docs page | None |

#### Meta / Composite (1 tool)

| # | Tool | Description | Scopes |
|---|---|---|---|
| 27 | `use_sentry` | Natural language interface to ALL Sentry capabilities via embedded AI agent | None |

### 5.3 Tool Groups

During OAuth, users select which tool groups to enable. This keeps the LLM context window focused. Groups map roughly to:

1. **Core** — `whoami`, `find_organizations`, `find_teams`, `find_projects`, `find_dsns`
2. **Management** — `create_project`, `create_team`, `create_dsn`, `update_project`, `update_issue`
3. **Issues** — `get_issue_details`, `get_issue_tag_values`, `search_issues`, `list_issues`
4. **Events** — `search_events`, `list_events`, `search_issue_events`, `list_issue_events`, `get_event_attachment`
5. **Performance** — `get_trace_details`, `get_profile`, `find_releases`
6. **AI/Seer** — `analyze_issue_with_seer`, `use_sentry`
7. **Docs** — `search_docs`, `get_doc`

### 5.4 Read vs. Write Capabilities

**Read-only tools**: Most tools (find_*, get_*, search_*, list_*)

**Write tools** (can CREATE or MODIFY):
- `create_project` (project:write)
- `create_team` (team:write)
- `create_dsn` (project:write)
- `update_project` (project:write)
- `update_issue` (event:write) — can resolve, ignore, assign issues

**Cannot** create issues — only investigate and manage existing ones.

### 5.5 OAuth Flow

1. Add MCP server to your client
2. On first use, browser opens Sentry OAuth flow
3. **Step 1**: Log in with your Sentry organization
4. **Step 2**: Accept OAuth authorization
5. **Step 3**: Grant access to necessary permission scopes
6. **Step 4**: Select tool groups to enable

Required scopes for full access:
- `org:read` — read organizations
- `project:read`, `project:write` — read/create projects
- `team:read`, `team:write` — read/create teams
- `event:read`, `event:write` — read events, update issues

### 5.6 Claude Code Integration

```bash
# Add Sentry MCP server
claude mcp add --transport http sentry https://mcp.sentry.dev/mcp

# Launch Claude Code
claude

# Re-authenticate if needed
# Type /mcp > select Sentry > "Clear authentication" or "Authenticate"
```

**Configuration (mcp_servers.json):**
```json
{
  "mcpServers": {
    "Sentry": {
      "url": "https://mcp.sentry.dev/mcp"
    }
  }
}
```

### 5.7 Self-Hosted Sentry Setup

For self-hosted instances, use STDIO transport instead of remote HTTP:

```bash
# Requires User Auth Token with scopes:
# org:read, project:read, project:write, team:read, team:write, event:write

export SENTRY_ACCESS_TOKEN=your-token
export SENTRY_HOST=your-sentry-host
```

### 5.8 Seer AI via MCP

The `analyze_issue_with_seer` tool provides:
- **Root cause analysis** — AI-powered analysis of production errors
- **Code fix suggestions** — specific code changes to resolve the issue
- **Fix status monitoring** — track if Seer's suggestions have been applied

Parameters:
- `organizationSlug` — the Sentry org
- `issueId` — the issue to analyze (or `issueUrl`)
- `instruction` — optional custom instructions for Seer
- `regionUrl` — for multi-region setups

**Note**: Seer is purpose-built for deep issue analysis. MCP brings Sentry context into your LLM; Seer provides the domain-specific debugging intelligence.

### 5.9 The `use_sentry` Meta-Tool

The most powerful tool — a natural language interface to all Sentry capabilities via an embedded AI agent:

```
Parameters:
  - request: string — natural language description of what you want
  - trace: boolean — enable tracing for debugging
```

This tool can:
- Query any Sentry data via natural language
- Combine multiple operations
- Handle complex investigative workflows
- Fall back gracefully when specific tools aren't available

### 5.10 MCP Limitations

1. **Developing technology** — "MCP is a developing technology and changes should be expected. There will be bugs."
2. **AI search requires LLM provider** — Without OpenAI or Anthropic configured on the server, `search_*` tools are unavailable (replaced by `list_*`)
3. **Multi-org requires re-auth** — Joining a new org requires logout/login to refresh access
4. **Cannot create issues** — Can only investigate and manage existing ones
5. **No alert/monitor management** — No tools for alert rules or monitors
6. **No server-side scrubbing config** — Cannot modify privacy/scrubbing rules via MCP

---

## Part 6: Comprehensive Omni Privacy Strategy

### 6.1 Three-Layer Defense

```
Layer 1: SDK (beforeSend, beforeBreadcrumb, beforeSendTransaction)
    ↓ scrubbed events
Layer 2: Relay (optional, for on-prem compliance)
    ↓ double-scrubbed events
Layer 3: Server-side (Advanced Data Scrubbing rules in Sentry UI)
    ↓ stored events are clean
```

### 6.2 What to Scrub for a Messaging Platform

| Data Type | Where It Appears | How to Scrub |
|---|---|---|
| Phone numbers | URLs, transactions, breadcrumbs, error messages | Regex: `\+?\d{10,15}` |
| WhatsApp JIDs | URLs, extra data, tags | Regex: `\d+@[sc]\.whatsapp\.net` |
| Chat message content | Console breadcrumbs, error messages, HTTP bodies | Remove breadcrumb data, scrub error values |
| User names / group names | Tags, extra data, breadcrumbs | Remove or hash |
| Email addresses | User context, extra data | Built-in email scrubbing |
| IP addresses | User context, request headers | `sendDefaultPii: false` + server-side rule |
| Auth tokens | Headers, URLs, extra data | Built-in password/token scrubbing |
| Profile pictures / media URLs | Extra data, breadcrumbs | Custom regex or remove |
| Discord/Telegram user IDs | URLs, tags, extra | Regex: `\d{17,22}` |

### 6.3 Minimal Sentry Init for Omni

```typescript
import * as Sentry from "@sentry/bun";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  release: process.env.APP_VERSION,

  // Privacy: never auto-collect PII
  sendDefaultPii: false,
  maxBreadcrumbs: 30,
  sendClientReports: false,

  // Performance sampling
  tracesSampleRate: 0.1,

  // Strip PII from errors
  beforeSend(event, hint) {
    return scrubEvent(event);
  },

  // Strip PII from transactions
  beforeSendTransaction(event) {
    return scrubTransaction(event);
  },

  // Strip PII from breadcrumbs
  beforeBreadcrumb(breadcrumb, hint) {
    return scrubBreadcrumb(breadcrumb);
  },

  // Parameterize span descriptions
  beforeSendSpan(span) {
    if (span.description) {
      span.description = parameterize(span.description);
    }
    return span;
  },

  // Drop noisy errors
  ignoreErrors: [
    "ResizeObserver loop",
    /ECONNRESET/,
    /ETIMEDOUT/,
    /socket hang up/,
  ],
});
```
