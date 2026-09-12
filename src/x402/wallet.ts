import { createPublicClient, defineChain, formatEther, formatUnits, http, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { AVALANCHE_FUJI_CHAIN_ID, USDC_DECIMALS, type X402Config } from "./config.js";
import { X402Error } from "./errors.js";

export const avalancheFuji = defineChain({
  id: AVALANCHE_FUJI_CHAIN_ID,
  name: "Avalanche Fuji",
  nativeCurrency: { name: "Avalanche", symbol: "AVAX", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://api.avax-test.network/ext/bc/C/rpc"] },
  },
  blockExplorers: {
    default: { name: "Snowtrace Testnet", url: "https://subnets-test.avax.network/c-chain" },
  },
  testnet: true,
});

const erc20BalanceAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export function getAgentAccount(config: X402Config) {
  if (!config.agentPrivateKey) {
    throw new X402Error("X402_CLIENT_NOT_CONFIGURED", "X402_AGENT_PRIVATE_KEY no está configurada.");
  }
  return privateKeyToAccount(config.agentPrivateKey);
}

export function getFujiPublicClient(config: X402Config) {
  return createPublicClient({
    chain: avalancheFuji,
    transport: http(config.rpcUrl, { timeout: 15_000 }),
  });
}

export async function readWalletBalances(config: X402Config, address: Address) {
  if (!config.usdcAddress) {
    return { avax: undefined, usdc: undefined };
  }

  const client = getFujiPublicClient(config);
  const [avaxBalance, usdcBalance] = await Promise.all([
    client.getBalance({ address }),
    client.readContract({
      address: config.usdcAddress,
      abi: erc20BalanceAbi,
      functionName: "balanceOf",
      args: [address],
    }),
  ]);

  return {
    avax: formatEther(avaxBalance),
    usdc: formatUnits(usdcBalance, USDC_DECIMALS),
  };
}
