import {
  type IAgentRuntime,
  type Memory,
  type Action,
  type State,
  type ActionExample,
  type HandlerCallback,
  type ActionResult,
  logger,
  ModelType,
  parseKeyValueXml,
} from '@elizaos/core';

import { MatchStatus } from '../services/userStatusService.js';
import { MemgraphService } from '../services/memgraph.js';
import {
  buildCoordinationPrompt,
  type CoordinationTemplateContext,
} from '../utils/coordinationTemplate.js';
import { getUserInfo } from '../utils/userUtils.js';
import {
  parseToISO,
  getCurrentISO,
} from '../utils/timeHelpers.js';
import type { UnifiedTokenService } from '@elizaos/plugin-solana';

/**
 * Helper function to format message memories into readable conversation history
 */
function formatMessages(memories: Memory[], userName: string, agentName: string = 'Agent'): string {
  if (!memories || memories.length === 0) {
    return 'No recent messages available';
  }

  return memories
    .filter((m) => m.content?.text)
    .reverse() // Show chronological order (oldest first)
    .map((m) => {
      const role = m.entityId === m.agentId ? agentName : userName;
      const timestamp = m.createdAt ? new Date(m.createdAt).toLocaleString() : '';
      return `[${timestamp}] ${role}: ${m.content.text}`;
    })
    .join('\n');
}

/**
 * Unified Coordinate Action
 * Handles ALL coordination from match proposal through to completion
 * Replaces: introProposal, introAccept, passMessage, and old coordinate actions
 */
export const coordinateAction: Action = {
  name: 'COORDINATE',
  description:
    'Handles all coordination for matched users from proposal through meeting completion. Validates when user has an active match.',
  similes: [
    'COORDINATION',
    'MATCH_COORDINATION',
    'MEETUP',
    'MEETING',
    'PROPOSE_MEETING',
    'ACCEPT_MEETING',
    'COORDINATE_MEETING',
    'SEND_MESSAGE',
    'PASS_MESSAGE',
  ],
  examples: [] as ActionExample[][],

  validate: async (runtime: IAgentRuntime, message: Memory): Promise<boolean> => {
    try {
      // Check if user has any active MATCHED_WITH relationship from Memgraph
      const memgraphService = runtime.getService('memgraph') as MemgraphService;
      if (!memgraphService) {
        logger.warn(`[coordinate] Memgraph service not available for validation`);
        return false;
      }

      const allMatches = await memgraphService.getAllMatches(message.entityId);

      const activeStatuses = [
        MatchStatus.MATCH_FOUND,
        MatchStatus.PROPOSAL_SENT,
        MatchStatus.ACCEPTED,
      ];

      const activeMatches = allMatches.filter((match) =>
        activeStatuses.includes(match.status as any)
      );

      return activeMatches.length > 0;
    } catch (error) {
      logger.error(`[coordinate] Error validating coordinate action: ${error}`);
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
      logger.info(`[coordinate] Processing coordination for user ${message.entityId}`);

      // Get Memgraph service - REQUIRED for match queries
      const memgraphService = runtime.getService('memgraph') as MemgraphService;
      if (!memgraphService) {
        const errorText =
          'Match coordination service is currently unavailable. Please try again later.';
        if (callback) {
          await callback({ text: errorText, actions: ['REPLY'] });
        }
        return {
          text: errorText,
          success: false,
          error: new Error('Memgraph service not available'),
        };
      }

      // Get user's active matches from Memgraph (both directions)
      const allMatches = await memgraphService.getAllMatches(message.entityId);

      const activeStatuses = [
        MatchStatus.MATCH_FOUND,
        MatchStatus.PROPOSAL_SENT,
        MatchStatus.ACCEPTED,
      ];

      const activeMatches = allMatches
        .filter((match) => activeStatuses.includes(match.status as any))
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

      if (activeMatches.length === 0) {
        const noMatchText =
          "You don't have an active match right now. Would you like me to search for connections?";
        if (callback) {
          await callback({ text: noMatchText, actions: ['REPLY'] });
        }
        return {
          text: noMatchText,
          success: false,
          error: new Error('No active matches'),
        };
      }

      // Get the most recent active match
      const activeMatch = activeMatches[0];

      // Determine user roles (from/to are directional in Memgraph)
      const isInitiator = activeMatch.from === message.entityId;
      const currentUserId = message.entityId;
      const otherUserId = isInitiator ? activeMatch.to : activeMatch.from;
      const user1Id = activeMatch.from; // Always the initiator
      const user2Id = activeMatch.to; // Always the matched user

      // Get user information
      const currentUserInfo = await getUserInfo(runtime, currentUserId);
      const otherUserInfo = await getUserInfo(runtime, otherUserId);

      // Fetch persona contexts from PersonaProfile nodes (not from match relationship)
      const user1PersonaContext =
        (await memgraphService.getUserPersonaProfile(user1Id)) || 'Not available';
      const user2PersonaContext =
        (await memgraphService.getUserPersonaProfile(user2Id)) || 'Not available';

      // Get recent messages for both users
      const [currentUserMessages, otherUserMessages] = await Promise.all([
        runtime
          .getMemoriesByRoomIds({
            tableName: 'messages',
            roomIds: [currentUserId],
          })
          .then((memories) => memories.slice(0, 5)),
        runtime
          .getMemoriesByRoomIds({
            tableName: 'messages',
            roomIds: [otherUserId],
          })
          .then((memories) => memories.slice(0, 5)),
      ]);

      // Format messages with proper user identification
      const initiatorMessages = isInitiator
        ? formatMessages(currentUserMessages, currentUserInfo.displayName)
        : formatMessages(otherUserMessages, otherUserInfo.displayName);

      const matchedMessages = isInitiator
        ? formatMessages(otherUserMessages, otherUserInfo.displayName)
        : formatMessages(currentUserMessages, currentUserInfo.displayName);

      // Format existing feedback for template
      const existingFeedback =
        activeMatch.feedback && activeMatch.feedback.length > 0
          ? activeMatch.feedback
              .map((fb: any) => {
                const userId = fb.userId;
                const userName =
                  userId === user1Id
                    ? isInitiator
                      ? 'You'
                      : otherUserInfo.displayName
                    : isInitiator
                      ? otherUserInfo.displayName
                      : 'You';
                return `${userName}: "${fb.text}"`;
              })
              .join('\n')
          : 'No feedback provided yet';

      // Format clues for display - get latest clue from each user's array
      const user1CluesArray = activeMatch.user1Clues || [];
      const user2CluesArray = activeMatch.user2Clues || [];

      // Get all clues as comma-separated list or use latest single clue
      const user1ClueText = user1CluesArray.length > 0
        ? user1CluesArray.map(c => c.text).join(', ')
        : activeMatch.user1Clue || 'Not provided';

      const user2ClueText = user2CluesArray.length > 0
        ? user2CluesArray.map(c => c.text).join(', ')
        : activeMatch.user2Clue || 'Not provided';

      // Get current date/time for LLM context
      const nowDate = new Date();
      const currentDate = nowDate.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
      const currentTime = getCurrentISO();

      // Build template context
      const templateContext: CoordinationTemplateContext = {
        // Match details
        userFromId: user1Id || '',
        userFromName: isInitiator ? currentUserInfo.displayName : otherUserInfo.displayName,
        userToId: user2Id || '',
        userToName: isInitiator ? otherUserInfo.displayName : currentUserInfo.displayName,
        compatibilityScore: activeMatch.compatibilityScore || 80,
        reasoning: activeMatch.reasoning || 'Good compatibility',

        // Current context
        currentUserId: currentUserId,
        isInitiator: isInitiator,
        status: activeMatch.status || MatchStatus.MATCH_FOUND,
        venue: activeMatch.venue || 'Not set',
        proposedTime: activeMatch.proposedTime || 'Not set',

        // Date/Time context for LLM
        currentDate: currentDate,
        currentTime: currentTime,

        // Initiator user details
        initiatorPersona: user1PersonaContext,
        initiatorMessages: initiatorMessages,
        initiatorClue: user1ClueText,

        // Matched user details
        matchedPersona: user2PersonaContext,
        matchedMessages: matchedMessages,
        matchedClue: user2ClueText,

        // Current interaction
        userMessage: message.content.text || '',
        existingFeedback: existingFeedback,
      };

      const prompt = buildCoordinationPrompt(
        activeMatch.status || MatchStatus.MATCH_FOUND,
        templateContext
      );

      // Generate coordination response
      const response = await runtime.useModel(ModelType.TEXT_LARGE, { prompt });
      const parsed = parseKeyValueXml(response);

      if (!parsed) {
        logger.error('[coordinate] Failed to parse coordination response');
        const errorText = 'I had trouble processing that. Could you rephrase?';
        if (callback) {
          await callback({ text: errorText, actions: ['REPLY'] });
        }
        return {
          text: errorText,
          success: false,
          error: new Error('Failed to parse response'),
        };
      }

      // Extract parsed values
      const newStatus = (parsed.newStatus || activeMatch.status) as string;
      let proposedTime = parsed.proposedTime || activeMatch.proposedTime;

      // Validate and ensure proposedTime is in ISO format if it's being set/updated
      if (parsed.proposedTime && parsed.proposedTime !== activeMatch.proposedTime) {
        const isoTime = parseToISO(parsed.proposedTime);
        if (isoTime) {
          proposedTime = isoTime;
          logger.info(`[coordinate] Converted proposedTime to ISO: ${proposedTime}`);
        } else {
          logger.warn(`[coordinate] Failed to parse proposedTime to ISO, keeping as-is: ${parsed.proposedTime}`);
        }
      }

      const venue = parsed.venue || activeMatch.venue || 'Bantabaa Restaurant';
      const clue = parsed.clue;
      const feedback = parsed.feedback;
      const messageToUser = parsed.messageToUser || 'Processing your request...';
      const messageToOther = parsed.messageToOther;

      // Process feedback if provided
      let updatedFeedbackArray = activeMatch.feedback || [];
      if (feedback) {
        // Check if current user already provided feedback
        const existingFeedbackFromUser = updatedFeedbackArray.find(
          (fb: any) => fb.userId === currentUserId
        );

        if (!existingFeedbackFromUser) {
          // Add new feedback from current user
          updatedFeedbackArray = [
            ...updatedFeedbackArray,
            {
              userId: currentUserId,
              text: feedback,
              timestamp: Date.now(),
            },
          ];
          logger.info(`[coordinate] Added feedback from user ${currentUserId}`);
        } else {
          logger.info(
            `[coordinate] User ${currentUserId} already provided feedback, skipping duplicate`
          );
        }
      }

      // Track when proposal was sent for expiry calculations
      const nowTimestamp = Date.now();
      const proposalSentAt =
        newStatus === MatchStatus.PROPOSAL_SENT && activeMatch.status !== MatchStatus.PROPOSAL_SENT
          ? nowTimestamp
          : activeMatch.proposalSentAt;

      // Process clues if provided (append to array similar to feedback)
      let updatedUser1Clues = activeMatch.user1Clues || [];
      let updatedUser2Clues = activeMatch.user2Clues || [];

      if (clue) {
        const clueEntry = {
          text: clue,
          timestamp: Date.now()
        };

        if (isInitiator) {
          // Check if this clue text already exists for user1
          const existingClue = updatedUser1Clues.find((c: any) => c.text === clue);
          if (!existingClue) {
            updatedUser1Clues = [...updatedUser1Clues, clueEntry];
            logger.info(`[coordinate] Added new clue for user1: ${clue}`);
          } else {
            logger.info(`[coordinate] User1 already provided this clue, skipping duplicate`);
          }
        } else {
          // Check if this clue text already exists for user2
          const existingClue = updatedUser2Clues.find((c: any) => c.text === clue);
          if (!existingClue) {
            updatedUser2Clues = [...updatedUser2Clues, clueEntry];
            logger.info(`[coordinate] Added new clue for user2: ${clue}`);
          } else {
            logger.info(`[coordinate] User2 already provided this clue, skipping duplicate`);
          }
        }
      }

      // Initialize HumanConnection on-chain when status transitions to "accepted"
      let connectionData: any = {};
      if (
        newStatus === MatchStatus.ACCEPTED &&
        activeMatch.status !== MatchStatus.ACCEPTED &&
        !activeMatch.connectionId
      ) {
        try {
          logger.info(`[coordinate] Creating connection for match ${user1Id} -> ${user2Id}`);

          // Get UnifiedTokenService
          const unifiedTokenService = runtime.getService<UnifiedTokenService>('UNIFIED_TOKEN');
          if (!unifiedTokenService || !('createConnection' in unifiedTokenService)) {
            logger.error('[coordinate] UnifiedTokenService not available, skipping connection creation');
          } else {
            // Format user IDs (assume telegram platform)
            const platform = 'telegram';
            const fullUser1Id = `${platform}:${user1Id}`;
            const fullUser2Id = `${platform}:${user2Id}`;

            // Generate random 4-digit PINs
            const pinA = Math.floor(1000 + Math.random() * 9000).toString();
            const pinB = Math.floor(1000 + Math.random() * 9000).toString();

            // Create connection ID
            const connectionId = `${fullUser1Id}-${fullUser2Id}`;

            // Create connection on-chain
            const tx = await unifiedTokenService.createConnection(
              connectionId,
              fullUser1Id,
              fullUser2Id,
              pinA,
              pinB
            );

            connectionData = {
              connectionId,
              pinA,
              pinB,
              pdaWalletA: fullUser1Id, // Store full user ID for reference
              pdaWalletB: fullUser2Id,
            };

            logger.info(`[coordinate] ✓ Connection created: ${connectionId}`);
            logger.info(`[coordinate] User A (${user1Id}) gets PIN B: ${pinB}`);
            logger.info(`[coordinate] User B (${user2Id}) gets PIN A: ${pinA}`);
            logger.info(`[coordinate] Transaction: https://explorer.solana.com/tx/${tx}?cluster=devnet`);
          }
        } catch (error: any) {
          logger.error(`[coordinate] Failed to create connection: ${error?.message || String(error)}`);
          // Continue with match coordination even if connection creation fails
        }
      }

      // Build properties to update in Memgraph
      const propertiesToUpdate: any = {
        status: newStatus,
        venue,
        proposedTime: proposedTime || activeMatch.proposedTime,
        feedback: updatedFeedbackArray,
        proposalSentAt,
        user1Clues: updatedUser1Clues.length > 0 ? updatedUser1Clues : activeMatch.user1Clues,
        user2Clues: updatedUser2Clues.length > 0 ? updatedUser2Clues : activeMatch.user2Clues,
        ...connectionData, // Add connectionId, pinA, pinB, pdaWalletA, pdaWalletB if created
      };

      // Update match properties in Memgraph (single source of truth)
      const updateSuccess = await memgraphService.updateMatchProperties(
        user1Id,
        user2Id,
        propertiesToUpdate
      );

      if (updateSuccess) {
        logger.info(`[coordinate] Updated match ${user1Id} -> ${user2Id} to status: ${newStatus}`);
      } else {
        logger.error(`[coordinate] Failed to update match ${user1Id} -> ${user2Id}`);
      }

      // Append PIN information to messages if HumanConnection was created
      let finalMessageToUser = messageToUser;
      let finalMessageToOther = messageToOther;

      if (connectionData.connectionId) {
        // User A (initiator, from) receives pinB to submit
        // User B (matched, to) receives pinA to submit
        const pinForCurrentUser = isInitiator ? connectionData.pinB : connectionData.pinA;
        const pinForOtherUser = isInitiator ? connectionData.pinA : connectionData.pinB;

        const pinMessage = `\n\n🔐 Your connection PIN: ${pinForCurrentUser}\n\nShare this PIN with your match when you meet! When ${otherUserInfo.displayName} submits your PIN, you both unlock 8 $MEMO tokens! 🎉`;
        finalMessageToUser = messageToUser + pinMessage;

        if (finalMessageToOther) {
          const otherPinMessage = `\n\n🔐 Your connection PIN: ${pinForOtherUser}\n\nShare this PIN with your match when you meet! When ${currentUserInfo.displayName} submits your PIN, you both unlock 8 $MEMO tokens! 🎉`;
          finalMessageToOther = finalMessageToOther + otherPinMessage;
        }
      }

      // Send message to other user if needed
      if (finalMessageToOther) {
        try {
          const targetInfo = {
            source: 'telegram',
            roomId: otherUserId,
            entityId: otherUserId,
          };

          await runtime.sendMessageToTarget(targetInfo, {
            text: finalMessageToOther,
            source: 'agent_coordination',
            type: 'coordination_message',
          });

          logger.info(`[coordinate] Sent message to other user ${otherUserId}`);
        } catch (messageError) {
          logger.error(`[coordinate] Failed to send message to ${otherUserId}: ${messageError}`);
          // Continue with workflow
        }
      }

      // Send message back to current user
      if (callback) {
        await callback({ text: finalMessageToUser, actions: ['REPLY'] });
      }

      return {
        text: messageToUser,
        success: true,
        values: {
          matchId: `${user1Id}-${user2Id}`,
          newStatus,
          proposedTime,
          venue,
          clue, // Latest clue added
          user1Clues: updatedUser1Clues,
          user2Clues: updatedUser2Clues,
          feedback: updatedFeedbackArray,
          currentUserId,
          otherUserId,
        },
      };
    } catch (error) {
      logger.error(`[coordinate] Error in coordination: ${error}`);

      const errorText = 'I encountered an issue while coordinating. Please try again.';

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
