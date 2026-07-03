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
Secret name that holds OMNI_API_KEY + DB/NATS credentials. If the operator
supplies an existing secret, reference it verbatim; otherwise the chart mints
one named "<fullname>-secret".
*/}}
{{- define "omni.secretName" -}}
{{- if .Values.secret.existingSecret }}
{{- .Values.secret.existingSecret }}
{{- else }}
{{- printf "%s-secret" (include "omni.fullname" .) }}
{{- end }}
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
