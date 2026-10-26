// prediction-widget.js
// Framework-agnostic SDK: connect wallet, place a prediction, read round status.
// Plain ES module, only dependency is ethers v6 (loaded from a CDN).

import {
  BrowserProvider,
  Contract,
  parseEther,
  formatEther,
} from "https://esm.sh/ethers@6.13.4";

const ABI = [
  "function roundCount() view returns (uint256)",
  "function getRound(uint256 id) view returns (tuple(string question, uint64 closesAt, bool resolved, bool yesWon, uint256 yesPool, uint256 noPool))",
  "function getStakes(uint256 id, address user) view returns (uint256 yesStake, uint256 noStake)",
  "function predict(uint256 id, bool yes) payable",
  "function claim(uint256 id)",
  "event Predicted(uint256 indexed roundId, address indexed user, bool yes, uint256 amount)",
  "event Resolved(uint256 indexed roundId, bool yesWon)",
];

export class PredictionWidget {
  /**
   * @param {object} cfg
   * @param {string} cfg.contractAddress  deployed PredictionMarket address
   * @param {number} cfg.chainId          e.g. 84532 (Base Sepolia)
   * @param {object} [cfg.chainParams]    params for wallet_addEthereumChain if the chain is unknown to the wallet
   */
  constructor({ contractAddress, chainId, chainParams }) {
    this.contractAddress = contractAddress;
    this.chainId = chainId;
    this.chainParams = chainParams;
    this.provider = null;
    this.signer = null;
    this.account = null;
    this.contract = null;
  }

  /** Connect an injected wallet (MetaMask etc.) and switch to the right chain. */
  async connect() {
    if (!window.ethereum) throw new Error("No wallet found. Install MetaMask or open in a wallet browser.");
    this.provider = new BrowserProvider(window.ethereum);
    await this.provider.send("eth_requestAccounts", []);
    await this._ensureChain();

    // re-create the provider after a chain switch so ethers does not hold a stale network
    this.provider = new BrowserProvider(window.ethereum);
    this.signer = await this.provider.getSigner();
    this.account = await this.signer.getAddress();
    this.contract = new Contract(this.contractAddress, ABI, this.signer);
    return this.account;
  }

  async _ensureChain() {
    const hex = "0x" + this.chainId.toString(16);
    try {
      await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
    } catch (err) {
      // 4902 = chain not added to the wallet yet
      if (err.code === 4902 && this.chainParams) {
        await window.ethereum.request({ method: "wallet_addEthereumChain", params: [this.chainParams] });
      } else {
        throw err;
      }
    }
  }

  _requireConnected() {
    if (!this.contract) throw new Error("Call connect() first.");
  }

  /** Read the status of a round, including the connected user's stakes and implied odds. */
  async getRound(roundId) {
    this._requireConnected();
    const r = await this.contract.getRound(roundId);
    const [myYes, myNo] = await this.contract.getStakes(roundId, this.account);

    const yesPool = r.yesPool;
    const noPool = r.noPool;
    const total = yesPool + noPool;
    const closesAt = Number(r.closesAt);
    if (closesAt === 0) throw new Error(`Round ${roundId} does not exist.`);

    // status: open -> closed (waiting for resolver) -> resolved
    const now = Math.floor(Date.now() / 1000);
    const status = r.resolved ? "resolved" : now >= closesAt ? "closed" : "open";

    // payout multiplier if you bet 1 unit on a side right now (ignores your own stake's effect)
    const mult = (side) => (side > 0n ? Number(total) / Number(side) : null);

    return {
      id: Number(roundId),
      question: r.question,
      status,
      closesAt: new Date(closesAt * 1000),
      result: r.resolved ? (r.yesWon ? "YES" : "NO") : null,
      yesPool: formatEther(yesPool),
      noPool: formatEther(noPool),
      totalPool: formatEther(total),
      yesMultiplier: mult(yesPool),
      noMultiplier: mult(noPool),
      myYesStake: formatEther(myYes),
      myNoStake: formatEther(myNo),
    };
  }

  /** Place a prediction. side: "YES" | "NO", amount in native coin as a string, e.g. "0.01". */
  async predict(roundId, side, amount) {
    this._requireConnected();
    const yes = String(side).toUpperCase() === "YES";
    const tx = await this.contract.predict(roundId, yes, { value: parseEther(String(amount)) });
    return tx.wait(); // resolves with the receipt once mined
  }

  /** Claim winnings (or refund) after the round is resolved. */
  async claim(roundId) {
    this._requireConnected();
    const tx = await this.contract.claim(roundId);
    return tx.wait();
  }

  /** Subscribe to live updates for a round; returns an unsubscribe function. */
  onUpdate(roundId, callback) {
    this._requireConnected();
    const handler = (id) => {
      if (Number(id) === Number(roundId)) callback();
    };
    this.contract.on("Predicted", handler);
    this.contract.on("Resolved", handler);
    return () => {
      this.contract.off("Predicted", handler);
      this.contract.off("Resolved", handler);
    };
  }
}
