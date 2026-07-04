{{/*
Expand the name of the chart.
*/}}
{{- define "autopg.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
Fully qualified app name. Truncated at 63 chars for DNS-name safety.
*/}}
{{- define "autopg.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "autopg.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
Common labels.
*/}}
{{- define "autopg.labels" -}}
helm.sh/chart: {{ include "autopg.chart" . }}
{{ include "autopg.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- with .Values.commonLabels }}
{{ toYaml . }}
{{- end }}
{{- end -}}

{{/*
Selector labels — stable across upgrades (do NOT add version here).
*/}}
{{- define "autopg.selectorLabels" -}}
app.kubernetes.io/name: {{ include "autopg.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{/*
The headless Service name (StatefulSet serviceName).
*/}}
{{- define "autopg.headlessServiceName" -}}
{{- printf "%s-headless" (include "autopg.fullname" .) -}}
{{- end -}}

{{/*
The Secret name holding passwords — an existing one if provided, else managed.
*/}}
{{- define "autopg.secretName" -}}
{{- if .Values.auth.existingSecret -}}
{{- .Values.auth.existingSecret -}}
{{- else -}}
{{- printf "%s-auth" (include "autopg.fullname" .) -}}
{{- end -}}
{{- end -}}

{{/*
Secret key for a provisioned app role's password.
*/}}
{{- define "autopg.appPasswordKey" -}}
{{- printf "%s-password" .role -}}
{{- end -}}

{{/*
Render settings.json content.

listen_addresses goes under postgres._extra (no curated default shadows it);
operator tuning goes as curated top-level postgres.* keys (these WIN over
_extra in autopg). Both merged from values.
*/}}
{{- define "autopg.settingsJson" -}}
{{- $postgres := dict -}}
{{- range $k, $v := .Values.settings.gucs -}}
{{- $_ := set $postgres $k $v -}}
{{- end -}}
{{- $extra := dict "listen_addresses" .Values.settings.listenAddresses -}}
{{- range $k, $v := .Values.settings.extraGucs -}}
{{- $_ := set $extra $k $v -}}
{{- end -}}
{{- $_ := set $postgres "_extra" $extra -}}
{{- dict "postgres" $postgres | toPrettyJson -}}
{{- end -}}
