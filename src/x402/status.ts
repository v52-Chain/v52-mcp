import { getAgentAccount, readWalletBalances } from "./wallet.js";
import { atomicToUsdc, loadX402Config } from "./config.js";

/** Returns only public configuration and optional read-only Fuji balances. */
export async function getX402Status() {
  try {
    const config = loadX402Config();
    const account = config.agentPrivateKey ? getAgentAccount(config) : undefined;
    let balances: { avax?: string; usdc?: string } | undefined;
    let balanceError: string | undefined;

    if (account) {
      try {
        balances = await readWalletBalances(config, account.address);
      } catch {
        balanceError = "No fue posible consultar balances en Avalanche Fuji.";
      }
    }

    return {
      configured: Boolean(account),
      network: "Avalanche Fuji",
      chainId: config.chainId,
      x402Network: config.network,
      walletAddress: account?.address,
      usdcAddress: config.usdcAddress,
      maxPaymentUsdc: atomicToUsdc(config.maxPaymentAtomic),
      maxSessionSpendUsdc: atomicToUsdc(config.maxSessionSpendAtomic),
      balances,
      balanceError,
    };
  } catch {
    return {
      configured: false,
      network: "Avalanche Fuji",
      chainId: 43113,
      x402Network: "eip155:43113",
    };
  }
}
