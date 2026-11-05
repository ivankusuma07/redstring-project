/**
 * Compile contracts/AuditAnchor.sol and deploy it to Robinhood Chain.
 *
 *   ANCHOR_PRIVATE_KEY=0x… npm run deploy:anchor            # writer = the deploying account
 *   ANCHOR_PRIVATE_KEY=0x… npm run deploy:anchor -- --dry   # compile + estimate only
 *
 * Prints the contract address to put in ANCHOR_CONTRACT.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  formatEther,
  http,
  parseAbi,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { robinhood } from "../src/lib/seal/chain";

// @ts-expect-error solc-js ships no types
import solcModule from "solc";

const solc = solcModule as {
  compile(input: string): string;
  version(): string;
};

const dry = process.argv.includes("--dry");
const raw = process.env.ANCHOR_PRIVATE_KEY ?? "";
if (!raw) {
  console.error("Set ANCHOR_PRIVATE_KEY");
  process.exit(1);
}
const account = privateKeyToAccount(
  (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex,
);

const source = readFileSync(
  join(import.meta.dirname, "../contracts/AuditAnchor.sol"),
  "utf8",
);
const out = JSON.parse(
  solc.compile(
    JSON.stringify({
      language: "Solidity",
      sources: { "AuditAnchor.sol": { content: source } },
      settings: {
        optimizer: { enabled: true, runs: 200 },
        evmVersion: "paris",
        outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
      },
    }),
  ),
);
const errors = (out.errors ?? []).filter(
  (e: { severity: string }) => e.severity === "error",
);
if (errors.length) {
  console.error(
    errors
      .map((e: { formattedMessage: string }) => e.formattedMessage)
      .join("\n"),
  );
  process.exit(1);
}
const c = out.contracts["AuditAnchor.sol"].AuditAnchor;
const bytecode = `0x${c.evm.bytecode.object}` as Hex;
console.log(
  `compiled with solc ${solc.version()} (${(bytecode.length - 2) / 2} bytes)`,
);

async function main() {
  const pub = createPublicClient({ chain: robinhood, transport: http() });
  const wallet = createWalletClient({
    chain: robinhood,
    account,
    transport: http(),
  });
  const [balance, gasPrice, gas] = await Promise.all([
    pub.getBalance({ address: account.address }),
    pub.getGasPrice(),
    pub.estimateGas({
      account,
      data: `${bytecode}${account.address.slice(2).toLowerCase().padStart(64, "0")}` as Hex,
    }),
  ]);
  console.log(
    `deployer ${account.address}  balance ${formatEther(balance)} ETH  est. cost ${formatEther(gas * gasPrice)} ETH`,
  );
  if (dry) return;

  const hash = await wallet.deployContract({
    abi: c.abi,
    bytecode,
    args: [account.address],
  });
  console.log(`tx ${hash}`);
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success" || !receipt.contractAddress)
    throw new Error(`deploy failed: ${receipt.status}`);
  const writer = await pub.readContract({
    address: receipt.contractAddress,
    abi: parseAbi(["function writer() view returns (address)"]),
    functionName: "writer",
  });
  console.log(
    `AuditAnchor ${receipt.contractAddress}  block ${receipt.blockNumber}  writer ${writer}`,
  );
  console.log(`\nANCHOR_CONTRACT=${receipt.contractAddress}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
