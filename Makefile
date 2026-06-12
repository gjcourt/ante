# Ante — project command surface.
#
# Wraps the contract + web flow so the common operations are one command each.
# Foundry is added to PATH automatically (it installs outside the default path).
#
# Quick start for a testnet deploy:
#   make wallet                       # (optional) generate a throwaway key
#   make fund ADDR=0xYourDeployer     # faucet pathUSD for gas
#   make deploy OWNER=0x.. TREASURY=0x.. PRIVATE_KEY=0x..
#   make verify ANTE=0xDeployedAddr   # sanity-check it's live
#
# Override any default on the command line, e.g. `make deploy CHALLENGE_WINDOW=60 ...`.

export PATH := $(HOME)/.foundry/bin:$(PATH)

CONTRACTS := contracts
WEB       := web

# --- Tempo testnet defaults (override as needed) ---------------------------
# NOTE: no inline comments after these values — Make would fold the trailing
# spaces into the value (e.g. MIN_STAKE="250000   "), breaking vm.envUint.
RPC_URL          ?= https://rpc.moderato.tempo.xyz
STAKE_TOKEN      ?= 0x20c0000000000000000000000000000000000000
MIN_STAKE        ?= 250000
CHALLENGE_WINDOW ?= 86400
ORIGIN           ?= https://burntbytes.com

# Signing: prefer an encrypted keystore (ACCOUNT) over a raw key (PRIVATE_KEY).
ifdef ACCOUNT
SIGN_FLAG := --account $(ACCOUNT)
else
SIGN_FLAG := --private-key $(PRIVATE_KEY)
endif

.PHONY: help build test e2e fund deploy verify cors-check web-build web-embed wallet clean

help: ## Show this help
	@echo "Ante — make targets:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
	  | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "Deploy vars: OWNER (admin+moderator), TREASURY (slash/forfeit sink),"
	@echo "             PRIVATE_KEY or ACCOUNT (signer). Defaults: STAKE_TOKEN=pathUSD,"
	@echo "             MIN_STAKE=$(MIN_STAKE), CHALLENGE_WINDOW=$(CHALLENGE_WINDOW)s."

# --- Contracts -------------------------------------------------------------

build: ## Compile the contracts
	cd $(CONTRACTS) && forge build

test: ## Run the full Foundry test suite
	cd $(CONTRACTS) && forge test

e2e: ## Spin up a throwaway anvil and run the full live-node lifecycle
	@bash -c 'anvil --silent & A=$$!; trap "kill $$A 2>/dev/null" EXIT; sleep 3; \
	  bash $(CONTRACTS)/scripts/e2e-local.sh'

wallet: ## Generate a throwaway wallet (address + key) for a smoke-test deploy
	@cast wallet new

fund: ## Faucet pathUSD to ADDR on Tempo testnet (Usage: make fund ADDR=0x..)
	@test -n "$(ADDR)" || { echo "Usage: make fund ADDR=0xDeployerAddress"; exit 1; }
	@curl -s -X POST $(RPC_URL) -H 'content-type: application/json' \
	  --data '{"jsonrpc":"2.0","id":1,"method":"tempo_fundAddress","params":["$(ADDR)"]}'; echo

deploy: ## Deploy Ante to Tempo testnet (needs OWNER, TREASURY, PRIVATE_KEY|ACCOUNT)
	@test -n "$(OWNER)"    || { echo "set OWNER=0x...    (admin + first moderator)"; exit 1; }
	@test -n "$(TREASURY)" || { echo "set TREASURY=0x... (slash/forfeit sink)"; exit 1; }
	@test -n "$(PRIVATE_KEY)$(ACCOUNT)" || { echo "set PRIVATE_KEY=0x... or ACCOUNT=<keystore-name>"; exit 1; }
	cd $(CONTRACTS) && \
	  STAKE_TOKEN=$(STAKE_TOKEN) TREASURY=$(TREASURY) MIN_STAKE=$(MIN_STAKE) \
	  CHALLENGE_WINDOW=$(CHALLENGE_WINDOW) OWNER=$(OWNER) \
	  forge script script/Deploy.s.sol:Deploy --rpc-url $(RPC_URL) --broadcast $(SIGN_FLAG)
	@echo ">> Set VITE_ANTE_ADDRESS (and VITE_DEPLOY_BLOCK) from the output above."

verify: ## Sanity-check a deployed instance (Usage: make verify ANTE=0x..)
	@test -n "$(ANTE)" || { echo "Usage: make verify ANTE=0xDeployedAddress"; exit 1; }
	@echo "minStake:        $$(cast call $(ANTE) 'minStake()(uint256)' --rpc-url $(RPC_URL))"
	@echo "minFlagBond:     $$(cast call $(ANTE) 'minFlagBond()(uint256)' --rpc-url $(RPC_URL))"
	@echo "flagBountyBps:   $$(cast call $(ANTE) 'flagBountyBps()(uint256)' --rpc-url $(RPC_URL))"
	@echo "challengeWindow: $$(cast call $(ANTE) 'challengeWindow()(uint256)' --rpc-url $(RPC_URL))"
	@echo "treasury:        $$(cast call $(ANTE) 'treasury()(address)' --rpc-url $(RPC_URL))"

# --- Ops / web -------------------------------------------------------------

cors-check: ## Check the RPC allows browser calls from the blog origin
	@echo "Checking CORS on $(RPC_URL) for origin $(ORIGIN) (preflight) ..."
	@curl -s -o /dev/null -D - -X OPTIONS $(RPC_URL) \
	  -H 'Origin: $(ORIGIN)' \
	  -H 'Access-Control-Request-Method: POST' \
	  -H 'Access-Control-Request-Headers: content-type' \
	  | grep -i 'access-control-allow-origin' \
	  && echo "  OK — RPC allows browser calls; no proxy needed." \
	  || echo "  NO CORS header — front the RPC with a proxy (see web/EMBEDDING.md)."

web-build: ## Build the standalone web app
	cd $(WEB) && npm run build

web-embed: ## Build the <ante-comments> embed bundle (dist-embed/ante.js)
	cd $(WEB) && npm run build:embed

clean: ## Remove build artifacts
	cd $(CONTRACTS) && forge clean
	rm -rf $(WEB)/dist $(WEB)/dist-embed
