# Prediction widget PoC

Minimal proof of concept: a YES/NO prediction market (parimutuel, native coin) plus a framework-agnostic JS SDK that a website widget can use to connect a wallet, place a prediction and read round status.

```
contracts/PredictionMarket.sol   Solidity contract (EVM)
sdk/prediction-widget.js         ES module SDK (ethers v6 via CDN)
demo/index.html                  Drop-in widget example
```

## How it works

1. Resolver (the deployer) calls `createRound(question, closesAt)`.
2. Users call `predict(roundId, yes)` with value attached. Stakes go into the YES or NO pool.
3. After `closesAt`, the resolver calls `resolve(roundId, yesWon)`.
4. Winners call `claim(roundId)` and get `stake * totalPool / winningPool`. If nobody bet on the winning side, everyone is refunded.

## Deploy to a testnet (no local setup)

1. Open [Remix](https://remix.ethereum.org), paste `contracts/PredictionMarket.sol`, compile with Solidity 0.8.20+.
2. Deploy with MetaMask on Base Sepolia (chain id 84532). Faucet ETH is free.
3. Create a round. Example in Remix, `createRound`:
   - question: `Will ETH close above $4000 on Friday?`
   - closesAt: a unix timestamp a few minutes in the future (e.g. `date +%s` plus 300)
4. Contract address on testnet: `0x... (paste here after deploy)`

Foundry alternative:

```bash
forge create contracts/PredictionMarket.sol:PredictionMarket \
  --rpc-url https://sepolia.base.org --private-key $PK
```

## Run the demo

1. In `demo/index.html` set `contractAddress` (and `ROUND_ID` if not 1).
2. Serve the folder over HTTP, wallets do not inject into `file://` pages reliably:

```bash
npx serve .
# open http://localhost:3000/demo/
```

## Use in your own site

```html
<script type="module">
  import { PredictionWidget } from "./sdk/prediction-widget.js";
  const w = new PredictionWidget({ contractAddress: "0x...", chainId: 84532 });
  await w.connect();
  console.log(await w.getRound(1));      // status, pools, odds, your stakes
  await w.predict(1, "YES", "0.01");     // place a prediction
  await w.claim(1);                      // after resolve
  const stop = w.onUpdate(1, () => {});  // live updates
</script>
```

## Known limitations (it is a PoC)

- Single trusted resolver, no oracle. Production would use UMA, Chainlink or similar.
- No platform fee, no pausing, no min/max stake, no ERC-20 support.
- Not audited. Do not use with real funds.
- Real-money predictions may fall under gambling or derivatives regulation depending on jurisdiction.
