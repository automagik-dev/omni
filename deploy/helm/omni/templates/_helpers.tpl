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
Selector labels for the omni-api workload.
*/}}
{{- define "omni.selectorLabels" -}}
app.kubernetes.io/name: {{ include "omni.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/component: api
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
Whether the chart-minted Secret renders at all: it does when DATABASE_URL is
assembled here (no external DB secret) OR when secret.env has entries.
Returns "true" / "".
*/}}
{{- define "omni.mintsSecret" -}}
{{- if or (not .Values.database.existingSecret) (gt (len (default (dict) .Values.secret.env)) 0) -}}
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
{{- else -}}
{{- include "omni.minio.fullname" . -}}
{{- end -}}
{{- end }}
