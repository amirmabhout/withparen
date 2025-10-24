import {
  type IAgentRuntime,
  type Memory,
  type Action,
  type State,
  type ActionExample,
  type HandlerCallback,
  type ActionResult,
  logger,
} from '@elizaos/core';

import { MatchStatus } from '../services/userStatusService.js';
import { MemgraphService } from '../services/memgraph.js';

/**
 * Submit PIN Action
 * Allows users to submit their match partner's PIN to unlock MEMO rewards
 */
export const submitPinAction: Action = {
  name: 'SUBMIT_PIN',
  description:
    "Allows users to submit their match partner's PIN to unlock MEMO token rewards after meeting IRL",
  similes: ['PIN', 'UNLOCK', 'SUBMIT_CODE', 'ENTER_PIN', 'VERIFY_MEETING', 'CLAIM_REWARD'],
  examples: [] as ActionExample[][],

  validate: async (runtime: IAgentRuntime, message: Memory): Promise<boolean> => {
    try {
      // Check if user has an active accepted match with connectionId
      const memgraphService = runtime.getService('memgraph') as MemgraphService;
      if (!memgraphService) {
        logger.warn(`[submitPin] Memgraph service not available for validation`);
        return false;
      }

      const allMatches = await memgraphService.getAllMatches(message.entityId);

      // Check for accepted matches with connectionId
      const acceptedMatches = allMatches.filter(
        (match) =>
          match.status === MatchStatus.ACCEPTED &&
          match.connectionId &&
          match.connectionId.length > 0
      );

      if (acceptedMatches.length === 0) {
        return false;
      }

      // Check if message contains a 4-digit PIN
      const text = message.content?.text || '';
      const pinPattern = /\b\d{4}\b/;
      return pinPattern.test(text);
    } catch (error) {
      logger.error(`[submitPin] Error validating submit PIN action: ${error}`);
      return false;
    }
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options: any,
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    try {
      logger.info(`[submitPin] Processing PIN submission for user ${message.entityId}`);

      // Get Memgraph service
      const memgraphService = runtime.getService('memgraph') as MemgraphService;
      if (!memgraphService) {
        const errorText = 'Service is currently unavailable. Please try again later.';
        if (callback) {
          await callback({ text: errorText, actions: ['REPLY'] });
        }
        return {
          text: errorText,
          success: false,
          error: new Error('Memgraph service not available'),
        };
      }

      // Get TokenService
      const tokenService = runtime.getService('TOKEN');
      if (!tokenService || !('submitPin' in tokenService)) {
        const errorText = 'Token service is currently unavailable. Please try again later.';
        if (callback) {
          await callback({ text: errorText, actions: ['REPLY'] });
        }
        return {
          text: errorText,
          success: false,
          error: new Error('TokenService not available'),
        };
      }

      // Get PDAWalletService
      const pdaWalletService = runtime.getService('pda_wallet');
      if (!pdaWalletService || !('getPDAWallet' in pdaWalletService)) {
        const errorText = 'Wallet service is currently unavailable. Please try again later.';
        if (callback) {
          await callback({ text: errorText, actions: ['REPLY'] });
        }
        return {
          text: errorText,
          success: false,
          error: new Error('PDAWalletService not available'),
        };
      }

      // Extract PIN from message
      const text = message.content?.text || '';
      const pinMatch = text.match(/\b(\d{4})\b/);
      if (!pinMatch) {
        const errorText = 'Could not find a valid 4-digit PIN in your message. Please try again.';
        if (callback) {
          await callback({ text: errorText, actions: ['REPLY'] });
        }
        return {
          text: errorText,
          success: false,
          error: new Error('No valid PIN found'),
        };
      }

      const submittedPin = pinMatch[1];

      // Get user's accepted matches with connectionId
      const allMatches = await memgraphService.getAllMatches(message.entityId);
      const acceptedMatches = allMatches.filter(
        (match) =>
          match.status === MatchStatus.ACCEPTED &&
          match.connectionId &&
          match.connectionId.length > 0
      );

      if (acceptedMatches.length === 0) {
        const errorText =
          "You don't have an active accepted match with a connection set up. Please coordinate with your match first.";
        if (callback) {
          await callback({ text: errorText, actions: ['REPLY'] });
        }
        return {
          text: errorText,
          success: false,
          error: new Error('No active accepted match'),
        };
      }

      // Use the most recent accepted match
      const activeMatch = acceptedMatches[0];
      const connectionId = activeMatch.connectionId!;

      // Get user's PDA wallet
      const platform = 'telegram'; // Default platform
      const pdaResult = await (pdaWalletService as any).getPDAWallet(platform, message.entityId);
      if (!pdaResult?.address) {
        const errorText = 'Could not find your wallet. Please contact support.';
        if (callback) {
          await callback({ text: errorText, actions: ['REPLY'] });
        }
        return {
          text: errorText,
          success: false,
          error: new Error('PDA wallet not found'),
        };
      }

      // Get payer keypair from agent wallet
      const agentPrivateKey =
        runtime.getSetting('SOLANA_PRIVATE_KEY') || runtime.getSetting('WALLET_PRIVATE_KEY');
      if (!agentPrivateKey) {
        const errorText = 'Agent wallet not configured. Please contact support.';
        if (callback) {
          await callback({ text: errorText, actions: ['REPLY'] });
        }
        return {
          text: errorText,
          success: false,
          error: new Error('No agent private key'),
        };
      }

      const { Keypair, PublicKey } = await import('@solana/web3.js');
      const bs58 = await import('bs58');

      const signerKeypair = Keypair.fromSecretKey(bs58.default.decode(agentPrivateKey));
      const userPda = new PublicKey(pdaResult.address);

      // Submit PIN to unlock rewards
      logger.info(`[submitPin] Submitting PIN for connection ${connectionId}`);

      try {
        const result = await (tokenService as any).submitPin(
          connectionId,
          submittedPin,
          userPda,
          signerKeypair
        );

        // Success! Display reward message
        let successMessage = `✅ PIN verified! You unlocked 8 $MEMO tokens! 🎉\n\nTransaction: ${result.signature}`;

        if (result.bothUnlocked) {
          successMessage += `\n\n🤝 Both matches have unlocked! Your agent receives an 8 $MEMO bonus for facilitating this connection!`;
        }

        if (callback) {
          await callback({ text: successMessage, actions: ['REPLY'] });
        }

        return {
          text: successMessage,
          success: true,
          values: {
            connectionId,
            signature: result.signature,
            memoReward: result.memoReward,
            bothUnlocked: result.bothUnlocked,
          },
        };
      } catch (submitError: any) {
        logger.error(`[submitPin] Error submitting PIN: ${submitError}`);

        // Parse error message for user-friendly feedback
        let errorMessage = 'Failed to submit PIN. ';

        if (submitError.message?.includes('Invalid PIN')) {
          errorMessage +=
            'The PIN you entered is incorrect. Please check with your match and try again.';
        } else if (submitError.message?.includes('Already unlocked')) {
          errorMessage += 'You have already unlocked this connection!';
        } else if (submitError.message?.includes('Unauthorized')) {
          errorMessage += 'You are not authorized to unlock this connection.';
        } else {
          errorMessage += `Error: ${submitError.message || 'Unknown error'}`;
        }

        if (callback) {
          await callback({ text: errorMessage, actions: ['REPLY'] });
        }

        return {
          text: errorMessage,
          success: false,
          error: submitError,
        };
      }
    } catch (error) {
      logger.error(`[submitPin] Error in PIN submission: ${error}`);

      const errorText = 'An error occurred while submitting your PIN. Please try again.';

      if (callback) {
        await callback({ text: errorText, actions: ['REPLY'] });
      }

      return {
        text: errorText,
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  },
};
