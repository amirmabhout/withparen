import type { IAgentRuntime, Memory, Provider, State } from '@elizaos/core';
import { elizaLogger } from '@elizaos/core';
import { UNIFIED_TOKEN_SERVICE_NAME } from '../constants';
import type { UnifiedTokenService } from '../services/unifiedTokenService';

const logger = elizaLogger;

/**
 * Represents the result returned by a provider.
 */
interface ProviderResult {
    data?: any;
    values?: Record<string, string>;
    text?: string;
}

/**
 * User token balances provider for Solana Unified Token Program.
 * Shows the current user's $ME and $MEMO token balances.
 *
 * @param {IAgentRuntime} runtime - The agent runtime.
 * @param {Memory} message - The memory message containing user info.
 * @param {State} [state] - Optional state parameter.
 * @returns {Promise<ProviderResult>} The result containing user token balances.
 */
export const userTokensProvider: Provider = {
    name: 'user-tokens',
    description: "current user's ME and MEMO token balances",
    dynamic: false, // Always include in context
    get: async (runtime: IAgentRuntime, message: Memory, state?: State): Promise<ProviderResult> => {
        try {
            // Get the UnifiedTokenService
            const unifiedTokenService = runtime.getService<UnifiedTokenService>(UNIFIED_TOKEN_SERVICE_NAME);

            if (!unifiedTokenService || !('getUserBalances' in unifiedTokenService)) {
                logger.debug('[userTokensProvider] UnifiedTokenService not available');
                return { data: null, values: {}, text: '' };
            }

            // Get user ID from message
            const userId = message.userId;
            if (!userId) {
                logger.debug('[userTokensProvider] No user ID in message');
                return { data: null, values: {}, text: '' };
            }

            // Get agent's wallet public key (used to derive the user's token accounts)
            // In agent-custodial model, token accounts are owned by agent wallet
            const agentWallet = runtime.getSetting('SOLANA_PUBLIC_KEY');
            if (!agentWallet) {
                logger.debug('[userTokensProvider] No agent wallet configured');
                return { data: null, values: {}, text: '' };
            }

            // Fetch user balances
            // Note: getUserBalances is currently stubbed and needs implementation
            const balances = await unifiedTokenService.getUserBalances(
                userId,
                agentWallet as any // PublicKey will be created in the service
            );

            if (!balances) {
                logger.debug(`[userTokensProvider] No balances found for user ${userId}`);
                return {
                    data: null,
                    values: {},
                    text: `User ${userId} has not been initialized yet. Use /start to initialize.`
                };
            }

            // Prepare values for template interpolation
            const values: Record<string, string> = {
                me_balance: balances.meBalance.toFixed(2),
                memo_balance: balances.memoBalance.toFixed(2),
                daily_available: balances.dailyAvailable.toString(),
                total_minted: balances.totalMinted.toString(),
                total_locked: balances.totalLocked.toString(),
                total_memo_earned: balances.totalMemoEarned.toString(),
                connections_count: balances.connectionsCount.toString(),
            };

            // Format the text output
            let text = `\n\nUser ${userId} Token Balances\n\n`;
            text += `$ME Tokens: ${values.me_balance}\n`;
            text += `$MEMO Tokens: ${values.memo_balance}\n`;
            text += `Daily Available: ${values.daily_available} ME\n\n`;

            text += `Stats:\n`;
            text += `- Total ME Minted: ${values.total_minted}\n`;
            text += `- Total ME Locked: ${values.total_locked}\n`;
            text += `- Total MEMO Earned: ${values.total_memo_earned}\n`;
            text += `- Connections: ${values.connections_count}\n`;

            return {
                data: balances,
                values: values,
                text: text,
            };
        } catch (error: any) {
            logger.error('[userTokensProvider] Error fetching user balances:', error);
            return {
                data: null,
                values: {},
                text: `Error fetching token balances: ${error?.message || 'Unknown error'}`
            };
        }
    },
};
