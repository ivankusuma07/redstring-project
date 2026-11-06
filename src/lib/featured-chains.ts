import type { ChainKey } from "./types";

/**
 * The token each chain opens on when you switch chains from a map page.
 * Picked because their history is already read and stored, so the map shows up at once.
 */
export const FEATURED_BY_CHAIN: Record<ChainKey, string> = {
  robinhood: "0x008df4b3e857d06c4603aeb11f267ccd32ce2005", // $ROBINHOOD
  base: "0x5b5dee44552546ecea05edea01dcd7be7aa6144a", // $TN100x
  ethereum: "0xee2a03aa6dacf51c18679c516ad5283d8e7c2637", // $NEIRO
};

/** Brand swatch per chain, used by the chain switcher. */
export const CHAIN_COLOR: Record<ChainKey, string> = {
  robinhood: "#ccff00",
  base: "#0052ff",
  ethereum: "#627eea",
};
