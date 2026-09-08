{{/*
Expand the name of the chart.
*/}}
{{- define "omni.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Fully qualified app name.
*/}}
{{- define "omni.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{- define "omni.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Immutable omni-api image reference. A non-empty digest wins over tag and must
be one lowercase sha256 digest; empty preserves the historical tag/appVersion
rendering byte-for-byte.
*/}}
{{- define "omni.image" -}}
{{- $digest := default "" .Values.image.digest -}}
{{- if $digest -}}
{{- if not (regexMatch "^sha256:[0-9a-f]{64}$" $digest) -}}
{{- fail "image.digest must be a lowercase sha256 digest (sha256 followed by 64 hexadecimal characters)" -}}
{{- end -}}
{{- printf "%s@%s" .Values.image.repository $digest -}}
{{- else -}}
{{- printf "%s:%s" .Values.image.repository (.Values.image.tag | default (printf "v%s" .Chart.AppVersion)) -}}
{{- end -}}
{{- end }}

{{/*
Common labels.
*/}}
{{- define "omni.labels" -}}
helm.sh/chart: {{ include "omni.chart" . }}
{{ include "omni.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Base selector labels shared by every workload in this chart. The component
label is deliberately NOT set here — each workload appends its own
app.kubernetes.io/component exactly once (api/minio/nats/...), so no manifest
carries a duplicate key (kubeconform -strict / kubectl --strict reject those).
*/}}
{{- define "omni.selectorLabels" -}}
app.kubernetes.io/name: {{ include "omni.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Selector labels for the omni-api workload. Rendered output is IDENTICAL to the
pre-split selector (name+instance+component: api), so the api Deployment's
immutable spec.selector is stable across upgrades.
*/}}
{{- define "omni.apiSelectorLabels" -}}
{{ include "omni.selectorLabels" . }}
app.kubernetes.io/component: api
{{- end }}

{{/*
Admin UI (khal-ui) workload — an optional second Deployment+Service gated on
adminUi.enabled. Its own component label keeps it clear of the api workload's
PDB / anti-affinity / networkpolicy selectors (which key on component: api).
*/}}
{{- define "omni.adminUi.fullname" -}}
{{- printf "%s-admin-ui" (include "omni.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "omni.adminUiSelectorLabels" -}}
{{ include "omni.selectorLabels" . }}
app.kubernetes.io/component: admin-ui
{{- end }}

{{/*
Name of the chart-minted admin-ui Secret (OMNI_API_KEY from adminUi.secret.env).
*/}}
{{- define "omni.adminUi.secretName" -}}
{{- printf "%s-secret" (include "omni.adminUi.fullname" .) }}
{{- end }}

{{/*
OMNI_BASE_URL the admin UI's BFF proxies to: an explicit
adminUi.config.OMNI_BASE_URL wins, else the in-cluster omni-api Service.
*/}}
{{- define "omni.adminUi.baseUrl" -}}
{{- if .Values.adminUi.config.OMNI_BASE_URL -}}
{{- .Values.adminUi.config.OMNI_BASE_URL -}}
{{- else -}}
{{- printf "http://%s:%v" (include "omni.fullname" .) .Values.service.port -}}
{{- end -}}
{{- end }}

{{/*
Service account name.
*/}}
{{- define "omni.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "omni.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Name of the chart-minted Secret (assembled DATABASE_URL + optional secret.env).
*/}}
{{- define "omni.secretName" -}}
{{- printf "%s-secret" (include "omni.fullname" .) }}
{{- end }}

{{/*
The autopg subchart's fullname as seen from this parent chart — mirrors
charts/autopg/templates/_helpers.tpl "autopg.fullname" (subchart values are
coalesced under .Values.autopg, so nameOverride/fullnameOverride are visible).
*/}}
{{- define "omni.autopg.fullname" -}}
{{- $av := .Values.autopg | default dict -}}
{{- if $av.fullnameOverride -}}
{{- $av.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default "autopg" $av.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end }}

{{/*
Name of the Secret omni-api reads DATABASE_URL from (Option A), or "" when the
chart assembles the URL itself (Option B). Resolution order:
  1. database.existingSecret — explicit operator override.
  2. bundled autopg (autopg.enabled) with no database.host set — the autopg
     subchart publishes <release>-autopg-app holding a ready, percent-encoded
     DATABASE_URL (see charts/autopg/templates/secret.yaml).
  3. "" — Option B: assemble from database.* (requires database.host).
*/}}
{{- define "omni.databaseSecretName" -}}
{{- if .Values.database.existingSecret -}}
{{- .Values.database.existingSecret -}}
{{- else if and .Values.autopg.enabled (not .Values.database.host) -}}
{{- printf "%s-app" (include "omni.autopg.fullname" .) -}}
{{- end -}}
{{- end }}

{{/*
Whether the chart-minted Secret renders at all: it does when DATABASE_URL is
assembled here (no external/autopg DB secret) OR when secret.env has entries.
Returns "true" / "".
*/}}
{{- define "omni.mintsSecret" -}}
{{- if or (not (include "omni.databaseSecretName" .)) (gt (len (default (dict) .Values.secret.env)) 0) -}}
true
{{- end -}}
{{- end }}

{{/*
Bundled-NATS resource name + in-cluster URL.
*/}}
{{- define "omni.nats.fullname" -}}
{{- printf "%s-nats" (include "omni.fullname" .) }}
{{- end }}

{{/*
Convert a k8s-style quantity (e.g. 256Mi, 1Gi, 512M) to an integer byte count
for the NATS JetStream store limits (which want raw bytes).
*/}}
{{- define "omni.nats.bytes" -}}
{{- $v := . | toString -}}
{{- if hasSuffix "Gi" $v -}}
{{- mul (trimSuffix "Gi" $v | int) 1073741824 -}}
{{- else if hasSuffix "Mi" $v -}}
{{- mul (trimSuffix "Mi" $v | int) 1048576 -}}
{{- else if hasSuffix "Ki" $v -}}
{{- mul (trimSuffix "Ki" $v | int) 1024 -}}
{{- else if hasSuffix "G" $v -}}
{{- mul (trimSuffix "G" $v | int) 1000000000 -}}
{{- else if hasSuffix "M" $v -}}
{{- mul (trimSuffix "M" $v | int) 1000000 -}}
{{- else -}}
{{- $v -}}
{{- end -}}
{{- end }}

{{/*
NATS_URL: prefer an explicit override, else the bundled NATS Service, else
the conventional name the operator wires by hand.
*/}}
{{- define "omni.natsUrl" -}}
{{- if .Values.env.natsUrl }}
{{- .Values.env.natsUrl }}
{{- else if .Values.nats.enabled }}
{{- printf "nats://%s:%v" (include "omni.nats.fullname" .) .Values.nats.port }}
{{- else }}
{{- printf "nats://%s:4222" (default "nats" .Values.nats.externalHost) }}
{{- end }}
{{- end }}

{{/*
Bundled-MinIO resource name (StatefulSet + Service + Secret + bootstrap Job).
*/}}
{{- define "omni.minio.fullname" -}}
{{- printf "%s-minio" (include "omni.fullname" .) }}
{{- end }}

{{/*
Whether the media backend runs in remote (S3/MinIO) mode. Returns "true" / "".
Mirrors resolveMediaBackendConfig(): OMNI_MEDIA_MODE defaults to "local".
*/}}
{{- define "omni.media.remote" -}}
{{- if eq (lower (default "local" .Values.media.mode)) "remote" -}}
true
{{- end -}}
{{- end }}

{{/*
S3 endpoint for the media backend: an explicit media.s3.endpoint override wins,
else the in-cluster bundled MinIO Service, else empty (real AWS S3 — the SDK
derives the endpoint from the region).
*/}}
{{- define "omni.media.s3Endpoint" -}}
{{- if .Values.media.s3.endpoint -}}
{{- .Values.media.s3.endpoint -}}
{{- else if .Values.minio.enabled -}}
{{- printf "http://%s:%v" (include "omni.minio.fullname" .) .Values.minio.service.port -}}
{{- end -}}
{{- end }}

{{/*
Name of the Secret carrying OMNI_MEDIA_S3_ACCESS_KEY / _SECRET_KEY: the
operator-supplied external Secret (prod) when media.s3.existingSecret is set,
else the chart-minted MinIO Secret (bundled dev). Never renders plaintext creds
into omni-api's env — they are always pulled by secretKeyRef.
*/}}
{{- define "omni.media.secretName" -}}
{{- if .Values.media.s3.existingSecret -}}
{{- .Values.media.s3.existingSecret -}}
{{- else if .Values.minio.enabled -}}
{{- include "omni.minio.fullname" . -}}
{{- else -}}
{{- fail "media.mode=remote requires either minio.enabled=true (bundled MinIO) or media.s3.existingSecret (external S3 creds) — neither is set, so omni-api's S3 secretKeyRef would point at a Secret that is never created" -}}
{{- end -}}
{{- end }}
