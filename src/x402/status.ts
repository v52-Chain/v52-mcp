import { getAgentAccount, readWalletBalances } from "./wallet.js";
import { atomicToUsdc, loadX402Config } from "./config.js";

/** Returns only public configuration and optional read-only Fuji balances. */
export async function getX402Status() {
  try {
    const config = loadX402Config();
    const account = config.agentPrivateKey ? getAgentAccount(config) : undefined;
    let balances: { avax?: string; usdc?: string } | undefined;
    let balanceError: string | undefined;

    if (account && config.usdcAddress) {
      try {
        balances = await readWalletBalances(config, account.address);
      } catch {
        balanceError = "No fue posible consultar balances en Avalanche Fuji.";
      }
    }

    return {
      configured: Boolean(config.usdcAddress && account),
      clientConfigured: Boolean(config.usdcAddress && account),
      demoConfigured: Boolean(config.usdcAddress && config.facilitatorUrl && config.merchantAddress),
      network: "Avalanche Fuji",
      chainId: config.chainId,
      x402Network: config.network,
      vector52ApiUrl: config.vector52ApiUrl,
      walletAddress: account?.address,
      merchantAddress: config.merchantAddress,
      usdcAddress: config.usdcAddress,
      maxPaymentUsdc: atomicToUsdc(config.maxPaymentAtomic),
      maxSessionSpendUsdc: atomicToUsdc(config.maxSessionSpendAtomic),
      facilitatorConfigured: Boolean(config.facilitatorUrl),
      balances,
      balanceError,
    };
  } catch {
    return {
      configured: false,
      clientConfigured: false,
      demoConfigured: false,
      network: "Avalanche Fuji",
      chainId: 43113,
      x402Network: "eip155:43113",
      facilitatorConfigured: false,
    };
  }
}
