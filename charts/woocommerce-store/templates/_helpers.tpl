{{/*
Expand the name of the chart.
*/}}
{{- define "woocommerce-store.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "woocommerce-store.fullname" -}}
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

{{/*
Common labels
*/}}
{{- define "woocommerce-store.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{ include "woocommerce-store.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "woocommerce-store.selectorLabels" -}}
app.kubernetes.io/name: {{ include "woocommerce-store.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
MariaDB host
*/}}
{{- define "woocommerce-store.mariadbHost" -}}
{{- printf "%s-mariadb" (include "woocommerce-store.fullname" .) -}}
{{- end }}

{{/*
Shop public URL
*/}}
{{- define "woocommerce-store.shopUrl" -}}
{{- $port := .Values.global.publicPort | default 80 | int -}}
{{- if eq $port 80 -}}
{{- printf "http://shop.%s" .Values.global.domain -}}
{{- else if eq $port 443 -}}
{{- printf "https://shop.%s" .Values.global.domain -}}
{{- else -}}
{{- printf "http://shop.%s:%d" .Values.global.domain $port -}}
{{- end -}}
{{- end }}
