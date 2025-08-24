import type {
  Action,
  ActionResult,
  HandlerCallback,
  IAgentRuntime,
  Memory,
  State,
} from '@elizaos/core';
import { logger } from '@elizaos/core';
import { SafeWalletService } from '../services/SafeWalletService';

export const createWalletAction: Action = {
  name: 'CREATE_WALLET',
  similes: ['GENERATE_WALLET', 'NEW_WALLET', 'SETUP_WALLET'],
  description: 'Creates a new Safe smart account for the user with delegated permissions',

  validate: async (
    _runtime: IAgentRuntime,
    message: Memory,
    _state?: State
  ): Promise<boolean> => {
    // Always available for wallet-related conversations
    // The LLM will decide when to trigger this action
    return true;
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: any,
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    try {
      const service = runtime.getService<SafeWalletService>('safe-wallet');
      if (!service) {
        throw new Error('Safe Wallet Service not available');
      }

      const userId = (message as any).userId || message.agentId || message.roomId;
      if (!userId) {
        throw new Error('User ID not found');
      }

      // Check if user already has a wallet
      let wallet = await service.getUserWallet(userId);
      
      if (wallet) {
        const response = `You already have an active Safe smart account!\n\n🔒 Safe Address: ${wallet.safeAddress}\n👥 Owners: ${wallet.owners.length}\n📅 Created: ${new Date(wallet.createdAt).toLocaleString()}\n\n✅ Your Safe is managed by our agent with delegated permissions for seamless transactions.`;
        
        if (callback) {
          await callback({
            text: response,
            action: 'CREATE_WALLET',
          });
        }

        return {
          success: true,
          text: response,
          data: {
            action: 'CREATE_WALLET',
            walletExists: true,
            address: wallet.safeAddress,
            owners: wallet.owners,
            threshold: wallet.threshold,
          },
        };
      }

      // Create new wallet
      logger.info(`Creating new Safe smart account for user ${userId}`);
      wallet = await service.createWalletForUser(userId);

      const response = `🎉 Your Safe smart account has been created!\n\n🔒 Safe Address: ${wallet.safeAddress}\n👥 Owners: ${wallet.owners.length} (You and our agent)\n🔄 Threshold: ${wallet.threshold} signature required\n\n✨ **What this means:**\n✅ You have your own secure multi-signature wallet\n✅ Our agent can execute transactions on your behalf\n✅ All transactions are secured by Safe's battle-tested smart contracts\n\nTry saying "check balance" to verify your setup!`;

      if (callback) {
        await callback({
          text: response,
          action: 'CREATE_WALLET',
        });
      }

      return {
        success: true,
        text: response,
        data: {
          action: 'CREATE_WALLET',
          walletCreated: true,
          address: wallet.safeAddress,
          owners: wallet.owners,
          threshold: wallet.threshold,
          status: wallet.status,
        },
      };
    } catch (error) {
      logger.error('Error in CREATE_WALLET action:', error);
      
      const errorMessage = 'Sorry, I encountered an error creating your Safe smart account. Please try again.';
      
      if (callback) {
        await callback({
          text: errorMessage,
          error: true,
        });
      }

      return {
        success: false,
        text: errorMessage,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  },

  examples: [
    [
      {
        name: '{{userName}}',
        content: {
          text: 'Create a wallet for me',
        },
      },
      {
        name: '{{agentName}}',
        content: {
          text: '🎉 Your Safe smart account has been created!\n\n🔒 Safe Address: 0x742d35Cc6634C0532925a3b844Bc454e4438f44e\n\nThis wallet is secured by Safe Protocol with delegated permissions for seamless transactions.',
          action: 'CREATE_WALLET',
        },
      },
    ],
    [
      {
        name: '{{userName}}',
        content: {
          text: 'I need a new wallet',
        },
      },
      {
        name: '{{agentName}}',
        content: {
          text: '🎉 Your Safe smart account has been created!\n\n🔒 Safe Address: 0x123...',
          action: 'CREATE_WALLET',
        },
      },
    ],
  ],
};