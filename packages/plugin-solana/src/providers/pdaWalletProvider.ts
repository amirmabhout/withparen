import { Provider, IAgentRuntime, Memory, State, logger, ProviderResult } from '@elizaos/core';
import { PDAWalletService } from '../services/pdaWalletService';
import { Connection, PublicKey } from '@solana/web3.js';

/**
 * PDA Wallet information to provide to agent
 */
interface PDAWalletInfo {
  exists: boolean;
  address?: string;
  balance?: number;
  platform?: string;
  userId?: string;
}

/**
 * Provider that exposes PDA wallet information to the agent's context
 */
export const pdaWalletProvider: Provider = {
  name: 'pdaWallet',
  description: 'Provides PDA wallet information for users',
  get: async (runtime: IAgentRuntime, message: Memory, state?: State): Promise<ProviderResult> => {
    try {
      // Get PDA wallet service
      const pdaService = runtime.getService('pda_wallet') as PDAWalletService;
      if (!pdaService) {
        logger.warn('[pdaWalletProvider] PDAWalletService not available');
        return {
          text: 'PDA wallet service not initialized',
          data: { error: 'Service not available' }
        };
      }

      // Extract platform and user ID from message
      const platform = message.content?.source || 'telegram';
      const userId = message.entityId;

      if (!userId) {
        return {
          text: 'No user ID available for PDA wallet lookup',
          data: { error: 'Missing user ID' }
        };
      }

      // Get wallet address (doesn't create if not exists)
      const walletAddress = await pdaService.getUserWalletAddress(platform, userId);

      if (!walletAddress) {
        return {
          text: `User ${userId} on ${platform} does not have a PDA wallet yet. It will be created automatically when needed.`,
          values: { platform, userId },
          data: { exists: false, platform, userId }
        };
      }

      // Get wallet balance
      const balance = await pdaService.getWalletBalance(platform, userId);

      // Get connection for additional info if needed
      const connection = new Connection(
        runtime.getSetting('SOLANA_RPC_URL') || 'https://api.devnet.solana.com'
      );

      // Get recent activity (optional)
      let recentActivity = '';
      try {
        const signatures = await connection.getSignaturesForAddress(
          new PublicKey(walletAddress),
          { limit: 3 }
        );
        if (signatures.length > 0) {
          recentActivity = `\nRecent transactions: ${signatures.length}`;
        }
      } catch (error) {
        // Ignore errors for recent activity
      }

      // Format wallet information
      const walletInfo = `
PDA Wallet Information:
- Platform: ${platform}
- User ID: ${userId}
- Wallet Address: ${walletAddress}
- Balance: ${balance.toFixed(6)} SOL${recentActivity}
- Type: Program Derived Address (no private key needed)
- Status: Active and managed by the program
`.trim();

      return {
        text: walletInfo,
        values: {
          platform,
          userId,
          walletAddress,
          balance: balance.toFixed(6)
        },
        data: {
          exists: true,
          address: walletAddress,
          balance,
          platform,
          userId
        }
      };

    } catch (error) {
      logger.error(`[pdaWalletProvider] Error getting PDA wallet info: ${error}`);
      return {
        text: `Error retrieving PDA wallet information: ${error instanceof Error ? error.message : 'Unknown error'}`,
        data: {
          error: error instanceof Error ? error.message : 'Unknown error'
        }
      };
    }
  },
};