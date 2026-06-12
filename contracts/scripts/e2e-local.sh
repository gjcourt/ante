#!/usr/bin/env bash
# End-to-end smoke test against a local anvil node: real deploy + real
# broadcast txs through the full Ante lifecycle (post / tip / flag / withdraw /
# slash). Proves the deployed contract behaves on a live node, not just in the
# forge test VM. Requires a running `anvil` on 127.0.0.1:8545.
set -euo pipefail
export PATH="$HOME/.foundry/bin:$PATH"
cd "$(dirname "$0")/.."

RPC=http://127.0.0.1:8545

# anvil well-known dev accounts
OWNER_PK=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
OWNER=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
AUTHOR_PK=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
AUTHOR=0x70997970C51812dc3A010C7d01b50e0d17dc79C8
TIPPER_PK=0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a
TIPPER=0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC
TREASURY=0x90F79bf6EB2c4f870365E785982E1f101E93b906

MIN_STAKE=250000      # 0.25 pathUSD (6 decimals)
WINDOW=2              # 2s so we can withdraw after a real sleep
TOPIC=$(cast keccak "anvil-e2e-post")   # per-thread scope (keccak of a slug)
say(){ printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
bal(){ cast call "$TOKEN" "balanceOf(address)(uint256)" "$1" --rpc-url $RPC; }

say "deploy MockERC20 (pathUSD, 6dp)"
# NOTE: --constructor-args is greedy, so it MUST be the last flag on the line.
TOKEN=$(forge create src/mocks/MockERC20.sol:MockERC20 --rpc-url $RPC --private-key $OWNER_PK --broadcast --json \
  --constructor-args "pathUSD" "pUSD" 6 | python3 -c 'import sys,json;print(json.load(sys.stdin)["deployedTo"])')
echo "TOKEN=$TOKEN"

say "deploy Ante (window=${WINDOW}s, minStake=${MIN_STAKE})"
ANTE=$(forge create src/Ante.sol:Ante --rpc-url $RPC --private-key $OWNER_PK --broadcast --json \
  --constructor-args "$TOKEN" "$TREASURY" "$MIN_STAKE" "$WINDOW" "$OWNER" | python3 -c 'import sys,json;print(json.load(sys.stdin)["deployedTo"])')
echo "ANTE=$ANTE"

say "fund + approve author and tipper"
cast send "$TOKEN" "mint(address,uint256)" "$AUTHOR" 100000000 --rpc-url $RPC --private-key $OWNER_PK >/dev/null
cast send "$TOKEN" "mint(address,uint256)" "$TIPPER" 100000000 --rpc-url $RPC --private-key $OWNER_PK >/dev/null
cast send "$TOKEN" "approve(address,uint256)" "$ANTE" \
  0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff --rpc-url $RPC --private-key $AUTHOR_PK >/dev/null
cast send "$TOKEN" "approve(address,uint256)" "$ANTE" \
  0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff --rpc-url $RPC --private-key $TIPPER_PK >/dev/null
echo "author bal=$(bal $AUTHOR)  tipper bal=$(bal $TIPPER)"

say "author posts comment #1 (stake 0.25)"
cast send "$ANTE" "post(bytes32,uint256,string)" "$TOPIC" "$MIN_STAKE" "gm from anvil" --rpc-url $RPC --private-key $AUTHOR_PK >/dev/null
echo "nextId=$(cast call $ANTE 'nextId()(uint256)' --rpc-url $RPC)"
echo "escrow(ante) bal=$(bal $ANTE)  author bal=$(bal $AUTHOR)"
echo "isWithdrawable(1) before window: $(cast call $ANTE 'isWithdrawable(uint256)(bool)' 1 --rpc-url $RPC)"

say "tipper tips #1 (5.0)"
A_BEFORE=$(bal $AUTHOR)
cast send "$ANTE" "tip(uint256,uint256)" 1 5000000 --rpc-url $RPC --private-key $TIPPER_PK >/dev/null
echo "author bal after tip: $A_BEFORE -> $(bal $AUTHOR)  (expect +5000000)"

say "flagger stakes a bond to challenge #1; moderator REJECTS (comment was fine)"
F_BEFORE=$(bal $TIPPER); T_BEFORE=$(bal $TREASURY)
cast send "$ANTE" "flag(uint256,uint256,string)" 1 "$MIN_STAKE" "i think this is spam" --rpc-url $RPC --private-key $TIPPER_PK >/dev/null
echo "totalEscrowed after flag=$(cast call $ANTE 'totalEscrowed()(uint256)' --rpc-url $RPC)  (expect 500000 = stake+bond)"
cast send "$ANTE" "resolveFlag(uint256,bool,string)" 1 false "comment is fine" --rpc-url $RPC --private-key $OWNER_PK >/dev/null
echo "flagger bal: $F_BEFORE -> $(bal $TIPPER)  (bond forfeited, expect -250000)"
echo "treasury bal: $T_BEFORE -> $(bal $TREASURY)  (expect +250000 forfeited bond)"

say "wait out the window, author withdraws the vindicated #1"
sleep 3
cast send "$ANTE" "withdraw(uint256)" 1 --rpc-url $RPC --private-key $AUTHOR_PK >/dev/null
echo "author bal=$(bal $AUTHOR)  (stake returned)"

say "author posts #2; flagger challenges; moderator UPHOLDS -> slash + 50% bounty"
cast send "$ANTE" "post(bytes32,uint256,string)" "$TOPIC" "$MIN_STAKE" "spammy" --rpc-url $RPC --private-key $AUTHOR_PK >/dev/null
F2=$(bal $TIPPER); T2=$(bal $TREASURY)
cast send "$ANTE" "flag(uint256,uint256,string)" 2 "$MIN_STAKE" "definitely spam" --rpc-url $RPC --private-key $TIPPER_PK >/dev/null
cast send "$ANTE" "resolveFlag(uint256,bool,string)" 2 true "confirmed spam" --rpc-url $RPC --private-key $OWNER_PK >/dev/null
echo "flagger bal: $F2 -> $(bal $TIPPER)  (bond back + 125000 bounty = net +125000)"
echo "treasury bal: $T2 -> $(bal $TREASURY)  (stake remainder = +125000)"
echo "totalEscrowed=$(cast call $ANTE 'totalEscrowed()(uint256)' --rpc-url $RPC)  (expect 0)"

say "DONE — full lifecycle (post / tip / staked-flag / reject / uphold+bounty) on a live node"
