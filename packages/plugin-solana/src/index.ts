import type { IAgentRuntime, Plugin } from '@elizaos/core';
import { executeSwap } from './actions/swap';
import transferToken from './actions/transfer';
import { SOLANA_SERVICE_NAME } from './constants';
import { walletProvider } from './providers/wallet';
import { pdaWalletProvider } from './providers/pdaWalletProvider';
import { SolanaService } from './service';
import { PDAWalletService } from './services/pdaWalletService';
import { TokenService } from './services/tokenService';

// Export PDA functionality and TokenService for other plugins to use
export { PDAWalletService } from './services/pdaWalletService';
export { TokenService } from './services/tokenService';
export { pdaWalletProvider } from './providers/pdaWalletProvider';
export { SolanaService } from './service';

// Export token program IDs for use by other plugins
export { ME_TOKEN_PROGRAM_ID } from './programs/me-token';
export { HUMAN_CONNECTION_PROGRAM_ID } from './programs/human-connection';

export const solanaPlugin: Plugin = {
  name: SOLANA_SERVICE_NAME,
  description: 'Solana Plugin for Eliza with PDA wallet and token management support',
  actions: [],
  evaluators: [],
  providers: [pdaWalletProvider],
  services: [SolanaService, PDAWalletService, TokenService],
  init: async (_, runtime: IAgentRuntime) => {
    console.log('solana init');

    // DISABLED: TRADER_CHAIN service integration (not needed for basic Solana functionality)
    // Uncomment below when you want to enable trader chain functionality
    /*
    new Promise<void>(async (resolve) => {
      resolve();
      const asking = 'solana';
      const serviceType = 'TRADER_CHAIN';
      let traderChainService = runtime.getService(serviceType) as any;
      while (!traderChainService) {
        // console.log(asking, 'waiting for', serviceType, 'service...');
        traderChainService = runtime.getService(serviceType) as any;
        if (!traderChainService) {
          await new Promise((waitResolve) => setTimeout(waitResolve, 1000));
        } else {
          // console.log(asking, 'Acquired', serviceType, 'service...');
        }
      }

      const me = {
        name: 'Solana services',
        chain: 'solana',
        service: SOLANA_SERVICE_NAME,
      };
      traderChainService.registerChain(me);

      // console.log('solana init done');
    });
    */
  },
};
export default solanaPlugin;
