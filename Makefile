# Local deployment: build a release, verify it, review a Terraform plan, apply exactly that plan.
#
#   make help        list the targets
#   make deploy      release + verify + plan, then asks before applying
#
# Credentials come from the environment, or, when CLOUDFLARE_API_TOKEN is not set, from the .envrc (or
# .env) in the Terraform directory, which is how a 1Password local env file is read: it is a named
# pipe, so it is read here rather than loaded by direnv. See infra/terraform/README.md.
#
# Written for the make that ships with macOS (3.81): no .ONESHELL, no $(file ...).

SHELL := /bin/sh

# The Terraform root to deploy (a copy of infra/terraform/examples/pool or silo).
TF_DIR      ?= infra/terraform/live-pool
# Where the release is built. Passed to Terraform as release_dir, so what is verified is what is
# deployed, whatever the tfvars say.
RELEASE_DIR ?= release-out
# The frontend build the router serves: "standard" signs in through Clerk.
VARIANT     ?= standard
# Names the release after its commit, so a deployed id says what it is.
RELEASE_ID  ?= dev-$(shell git rev-parse --short HEAD)$(shell git diff --quiet HEAD -- || echo -dirty)
# Set YES=1 to apply without the confirmation prompt.
YES         ?=

PLAN_FILE := release.tfplan
# Read with cat, not `.`: sh's `.` silently reads nothing from the named pipe 1Password serves.
TF_ENV    := if [ -z "$$CLOUDFLARE_API_TOKEN" ]; then for f in .envrc .env; do if [ -e $$f ]; then set -a; eval "$$(cat $$f)"; set +a; break; fi; done; fi
TF        := cd $(TF_DIR) && $(TF_ENV) && terraform
MANIFEST  := $(RELEASE_DIR)/manifest.json

.DEFAULT_GOAL := help
.NOTPARALLEL:
.PHONY: help release verify release-info init plan apply deploy output url fmt validate test check clean

help: ## List the targets
	@awk 'BEGIN { FS = ":.*## " } /^[a-zA-Z_-]+:.*## / { printf "  %-14s %s\n", $$1, $$2 }' $(MAKEFILE_LIST)
	@echo ""
	@echo "  TF_DIR=$(TF_DIR)  RELEASE_DIR=$(RELEASE_DIR)  VARIANT=$(VARIANT)"

release: ## Build a fresh release (every Worker and both frontends), then verify it
	node scripts/release/build-release.ts --out $(RELEASE_DIR) --release-id $(RELEASE_ID)
	@$(MAKE) --no-print-directory verify

$(MANIFEST):
	@echo "No release at $(RELEASE_DIR): building one."
	@$(MAKE) --no-print-directory release

verify: ## Check the release's files against its manifest and lay out the asset tree
	node scripts/terraform/verify-release.ts $(RELEASE_DIR) --variant $(VARIANT) --materialize

release-info: $(MANIFEST) ## Show which release (and commit) would be deployed, and warn if it is stale
	@node -e 'const m = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); \
	  const head = require("child_process").execSync("git rev-parse HEAD").toString().trim(); \
	  console.log("release " + m.releaseId + "  commit " + m.commit.slice(0, 10) + "  built " + m.createdAt); \
	  if (m.commit !== head) console.log("WARNING: the release is not built from HEAD (" + head.slice(0, 10) + "). Run: make release");' $(MANIFEST)
	@stale=$$(git ls-files -m -o --exclude-standard -- packages scripts | grep -Ev '(__tests__/|\.test\.|\.md$$)' | while read f; do if [ "$$f" -nt $(MANIFEST) ]; then echo "$$f"; break; fi; done); \
	  if [ -n "$$stale" ]; then echo "WARNING: $$stale changed after this release was built, so it is not what is in your working tree. Run: make release"; fi

init: ## terraform init
	$(TF) init -input=false

plan: $(MANIFEST) release-info verify init ## Plan against the current release and save the plan
	$(TF) plan -input=false -var 'release_dir=$(abspath $(RELEASE_DIR))' -out=$(PLAN_FILE)

apply: ## Apply the saved plan (run `make plan` first)
	@test -f $(TF_DIR)/$(PLAN_FILE) || { echo "No saved plan: run 'make plan' first."; exit 1; }
	$(TF) apply -input=false $(PLAN_FILE)
	@rm -f $(TF_DIR)/$(PLAN_FILE)
	@$(MAKE) --no-print-directory url

deploy: release plan ## Build, verify, plan, then apply after you confirm (YES=1 skips the prompt)
	@if [ -z "$(YES)" ]; then \
	  printf 'Apply this plan to %s? [y/N] ' '$(TF_DIR)'; read answer; \
	  [ "$$answer" = y ] || { echo "Not applied. The plan is saved; 'make apply' applies it."; exit 1; }; \
	fi
	@$(MAKE) --no-print-directory apply

output: ## Show the Terraform outputs (public URL, Clerk webhook URL, ...)
	$(TF) output

url: ## Show the public URL and the Clerk webhook URL to register
	@$(TF) output -raw public_base_url; echo
	@$(TF) output -raw clerk_webhook_url; echo

fmt: ## Format the Terraform code
	terraform fmt -recursive infra/terraform

validate: ## Validate the module
	cd infra/terraform/modules/instance && terraform init -backend=false -input=false >/dev/null && terraform validate

test: ## Run the Terraform module tests and the uploader tests (no Cloudflare account needed)
	cd infra/terraform/modules/instance && terraform init -backend=false -input=false >/dev/null && terraform test
	node --test scripts/terraform/*.test.ts

check: fmt validate test ## fmt, validate and test everything under infra/terraform
	pnpm run types:scripts

clean: ## Remove the built release and any saved plan (state and tfvars are untouched)
	rm -rf $(RELEASE_DIR) $(TF_DIR)/$(PLAN_FILE)
