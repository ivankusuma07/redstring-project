import { defineChain } from "viem";
import { CHAINS } from "../chains";

/** Robinhood Chain for viem clients (sealing + scripts). */
export const robinhood = defineChain({
  id: CHAINS.robinhood.id,
  name: CHAINS.robinhood.name,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [CHAINS.robinhood.rpc] } },
  blockExplorers: {
    default: { name: "Explorer", url: CHAINS.robinhood.explorer },
  },
});
