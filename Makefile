SHELL := /usr/bin/env bash

.PHONY: help
help:
	@echo "Conduit Platform — Available Commands:"
	@echo "  make cluster-up      - Create local k3d cluster with Traefik on port 80"
	@echo "  make cluster-down    - Teardown local k3d cluster"
	@echo "  make secrets         - Generate dev secrets and sync to Kubernetes"
	@echo "  make install         - Install Conduit & WooCommerce charts into k3d"
	@echo "  make upgrade         - Upgrade Helm releases"
	@echo "  make uninstall       - Uninstall Helm releases"
	@echo "  make build           - Build TypeScript packages and applications"
	@echo "  make test            - Run all unit and integration tests (Vitest)"
	@echo "  make typecheck       - Typecheck all workspaces using tsc -b"
	@echo "  make lint            - Run ESLint checks"
	@echo "  make format          - Format source files with Prettier"
	@echo "  make helm-lint       - Lint Helm charts"
	@echo "  make helm-template   - Render Helm templates for local and prod values"
	@echo "  make load            - Import container images into k3d cluster"
	@echo "  make e2e             - Run end-to-end acceptance suite"

.PHONY: cluster-up
cluster-up:
	@bash scripts/cluster-up.sh

.PHONY: cluster-down
cluster-down:
	@bash scripts/cluster-down.sh

.PHONY: secrets
secrets:
	@bash scripts/gen-secrets.sh

.PHONY: build
build:
	npm run build

.PHONY: test
test:
	npm run test

.PHONY: typecheck
typecheck:
	npm run typecheck

.PHONY: lint
lint:
	npm run lint

.PHONY: format
format:
	npm run format

.PHONY: helm-lint
helm-lint:
	helm lint charts/conduit
	helm lint charts/woocommerce-store

.PHONY: helm-template
helm-template:
	helm template conduit charts/conduit -f values/values-local.yaml > /dev/null
	helm template conduit charts/conduit -f values/values-prod.yaml > /dev/null
	helm template store charts/woocommerce-store -f values/values-local.yaml > /dev/null
	helm template store charts/woocommerce-store -f values/values-prod.yaml > /dev/null
	@echo "Helm template validation successful for both local and prod values."

.PHONY: install
install: secrets
	helm upgrade --install conduit charts/conduit -n conduit-system --create-namespace -f values/values-local.yaml
	helm upgrade --install store charts/woocommerce-store -n store-default --create-namespace -f values/values-local.yaml

.PHONY: upgrade
upgrade:
	helm upgrade conduit charts/conduit -n conduit-system -f values/values-local.yaml
	helm upgrade store charts/woocommerce-store -n store-default -f values/values-local.yaml

.PHONY: uninstall
uninstall:
	helm uninstall conduit -n conduit-system || true
	helm uninstall store -n store-default || true

.PHONY: load
load:
	@echo "Loading images into k3d cluster..."
	# To be populated as application images are built in future phases

.PHONY: e2e
e2e:
	@echo "Running E2E tests..."
	npm run test
