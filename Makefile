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
	@echo "  make deploy-local    - Build, load, upgrade, and verify all local services"
	@echo "  make e2e             - Run all unit and integration tests"
	@echo "  make e2e-gateway     - Run Gateway MCP E2E test suite"
	@echo "  make e2e-ui          - Run Phase 4 Dashboard Playwright smoke test"
	@echo "  make e2e-dod         - Run Definition of Done verification suite"

.PHONY: cluster-up
cluster-up:
	@bash scripts/cluster-up.sh

.PHONY: cluster-down
cluster-down:
	@bash scripts/cluster-down.sh

.PHONY: secrets
secrets:
	@bash scripts/gen-secrets.sh

GIT_SHA ?= $(shell git rev-parse --short HEAD)

.PHONY: build
build:
	npm run build --workspace=@conduit/shared
	npm run build --workspace=@conduit/gateway
	npm run build --workspace=@conduit/woo-mcp
	npm run build --workspace=@conduit/dashboard
	npm run build --workspace=@conduit/notes-mcp
	npm run build --workspace=@conduit/utils-mcp
	docker build -t conduit/wordpress:6.7.2-wc9.6.2 -t conduit/wordpress:$(GIT_SHA) images/wordpress
	docker build -t conduit/woo-mcp:$(GIT_SHA) -t conduit/woo-mcp:latest -f apps/woo-mcp/Dockerfile .
	docker build -t conduit/gateway:$(GIT_SHA) -t conduit/gateway:latest -t conduit/gateway:0.1.0 -f apps/gateway/Dockerfile .
	docker build -t conduit/dashboard:$(GIT_SHA) -t conduit/dashboard:latest -t conduit/dashboard:0.1.0 -f apps/dashboard/Dockerfile .
	docker build -t conduit/notes-mcp:$(GIT_SHA) -t conduit/notes-mcp:latest -f apps/notes-mcp/Dockerfile .
	docker build -t conduit/utils-mcp:$(GIT_SHA) -t conduit/utils-mcp:latest -f apps/utils-mcp/Dockerfile .

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
	k3d image import mongo:7 -c conduit
	k3d image import conduit/wordpress:6.7.2-wc9.6.2 -c conduit
	k3d image import conduit/woo-mcp:$(GIT_SHA) conduit/woo-mcp:latest -c conduit
	k3d image import conduit/gateway:$(GIT_SHA) conduit/gateway:latest conduit/gateway:0.1.0 -c conduit
	k3d image import conduit/dashboard:$(GIT_SHA) conduit/dashboard:latest conduit/dashboard:0.1.0 -c conduit
	k3d image import conduit/notes-mcp:$(GIT_SHA) conduit/notes-mcp:latest conduit/utils-mcp:$(GIT_SHA) conduit/utils-mcp:latest -c conduit || true

.PHONY: deploy-local
deploy-local: build load
	@echo "Deploying local releases with image tag $(GIT_SHA)..."
	helm upgrade --install conduit charts/conduit -n conduit-system --create-namespace -f values/values-local.yaml --set images.tag=$(GIT_SHA)
	helm upgrade --install store charts/woocommerce-store -n store-default --create-namespace -f values/values-local.yaml --set images.wooMcp=conduit/woo-mcp:$(GIT_SHA)
	kubectl rollout status deployment/conduit-gateway -n conduit-system --timeout=120s
	kubectl rollout status deployment/conduit-dashboard -n conduit-system --timeout=120s
	kubectl rollout status deployment/store-woocommerce-store-woo-mcp -n store-default --timeout=120s
	@echo "Local deployment successfully rolled out."

.PHONY: e2e
e2e:
	@echo "Running E2E tests..."
	npm run test

.PHONY: e2e-gateway
e2e-gateway:
	@echo "Running Gateway E2E Flow..."
	npx tsx dev/e2e/gateway-flow.ts

.PHONY: e2e-ui
e2e-ui:
	@echo "Running Phase 4 Dashboard Playwright smoke test..."
	npx tsx dev/e2e/ui-smoke.ts

.PHONY: e2e-dod
e2e-dod:
	@echo "Running Definition of Done (DoD) verification..."
	npx tsx dev/e2e/dod.ts
