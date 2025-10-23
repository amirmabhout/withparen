import type { IAgentRuntime, Plugin } from '@elizaos/core';
import { executeSwap } from './actions/swap';
import transferToken from './actions/transfer';
import { SOLANA_SERVICE_NAME } from './constants';
import { walletProvider } from './providers/wallet';
import { userTokensProvider } from './providers/userTokens';
import { SolanaService } from './service';
import { UnifiedTokenService } from './services/unifiedTokenService';

// Export Unified Token Service for other plugins to use
export { UnifiedTokenService } from './services/unifiedTokenService';
export { SolanaService } from './service';

// Export helper functions for PDA derivation
export {
    hashUserId,
    hashPin,
    deriveGlobalStatePDA,
    deriveMemoMintPDA,
    deriveMeEscrowPDA,
    deriveUserAccountPDA,
    deriveMeMintPDA,
    deriveConnectionPDA,
} from './services/unifiedTokenService';

// Export types
export type { UserBalances, ConnectionInfo } from './services/unifiedTokenService';

export const solanaPlugin: Plugin = {
  name: SOLANA_SERVICE_NAME,
  description: 'Solana Plugin for Eliza with Unified Token Program support',
  actions: [],
  evaluators: [],
  providers: [userTokensProvider],
  services: [SolanaService, UnifiedTokenService],
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
