import { type IAgentRuntime, type Memory, logger } from '@elizaos/core';
import { UserStatus, MatchStatus } from './userStatusService.js';
import { MemgraphService } from './memgraph.js';

/**
 * Auto Proposal Service
 * Handles automatic proposal triggering when users become eligible
 * Single point of control to prevent race conditions and duplicates
 */
export class AutoProposalService {
  private runtime: IAgentRuntime;

  constructor(runtime: IAgentRuntime) {
    this.runtime = runtime;
  }

  /**
   * Check if user has matches ready for proposals and trigger them
   * This is the single source of truth for automatic proposal logic
   */
  async triggerAutoProposalsForUser(
    userId: string,
    userStatus: UserStatus,
    callback?: any
  ): Promise<void> {
    try {
      logger.debug(
        `[auto-proposal] Checking auto-trigger conditions for user ${userId} with status ${userStatus}`
      );

      // Only auto-trigger if user can send proposals (has provided verification data)
      if (
        userStatus !== UserStatus.VERIFICATION_PENDING &&
        userStatus !== UserStatus.GROUP_MEMBER
      ) {
        logger.debug(
          `[auto-proposal] Auto-trigger skipped: User ${userId} status ${userStatus} cannot send proposals`
        );
        return;
      }

      // Get Memgraph service - REQUIRED for match queries
      const memgraphService = this.runtime.getService('memgraph') as MemgraphService;
      if (!memgraphService) {
        logger.error(`[auto-proposal] Memgraph service not available for user ${userId}`);
        return;
      }

      // Get all outgoing matches with MATCH_FOUND status from Memgraph
      const memgraphMatches = await memgraphService.getOutgoingMatches(userId, 'match_found');

      // Convert Memgraph matches to expected format
      const readyMatches = memgraphMatches.map((match) => ({
        id: `memgraph-${match.from}-${match.to}`,
        content: {
          user1Id: match.from,
          user2Id: match.to,
          status: match.status,
          reasoning: match.reasoning,
        },
      }));

      logger.debug(
        `[auto-proposal] Found ${readyMatches.length} ready matches for user ${userId} from Memgraph`
      );

      // Check for existing introduction records to prevent duplicates
      const existingIntroductions = await this.runtime.getMemories({
        tableName: 'introductions',
        count: 100,
      });

      // Filter out matches that already have introduction proposals
      const matchesWithoutProposals = readyMatches.filter((match) => {
        const matchData = match.content as any;
        const matchId = match.id;

        // Determine the target user for this match
        const targetUserId = matchData.user1Id === userId ? matchData.user2Id : matchData.user1Id;

        // Check if introduction record already exists for this user-match pair
        const hasExistingIntroduction = existingIntroductions.some((intro) => {
          const introData = intro.content as any;
          return (
            (introData.fromUserId === userId && introData.toUserId === targetUserId) ||
            (introData.matchId === matchId && introData.fromUserId === userId) ||
            (introData.type === 'introduction_proposal' &&
              introData.fromUserId === userId &&
              introData.toUserId === targetUserId)
          );
        });

        if (hasExistingIntroduction) {
          logger.debug(
            `[auto-proposal] Skipping match ${matchId} - introduction proposal already exists for ${userId} -> ${targetUserId}`
          );
          return false;
        }

        return true;
      });

      logger.debug(
        `[auto-proposal] Auto-trigger check: User ${userId} has ${readyMatches.length} total matches, ${matchesWithoutProposals.length} without existing proposals`
      );

      if (matchesWithoutProposals.length > 0) {
        logger.info(
          `[auto-proposal] Auto-trigger condition met: User ${userId} (status: ${userStatus}) has ${matchesWithoutProposals.length} matches ready for proposals (${readyMatches.length - matchesWithoutProposals.length} already have proposals)`
        );

        // Create a synthetic message to trigger the INTRO_PROPOSAL action
        const syntheticMessage: Memory = {
          id: `auto-proposal-${userId}-${Date.now()}`,
          entityId: userId,
          agentId: this.runtime.agentId,
          roomId: userId, // For DMs, roomId equals userId
          content: {
            text: 'Please send the introduction proposal to my match.',
            attachments: [],
          },
          createdAt: Date.now(),
        };

        // Check if the intro proposal action would validate
        const introProposalAction = this.runtime.actions.find(
          (action) => action.name === 'INTRO_PROPOSAL'
        );

        if (introProposalAction) {
          const isValid = await introProposalAction.validate(this.runtime, syntheticMessage);

          if (isValid) {
            logger.info(`[auto-proposal] Auto-triggering INTRO_PROPOSAL action for user ${userId}`);

            // Execute the intro proposal action
            await introProposalAction.handler(
              this.runtime,
              syntheticMessage,
              undefined, // state
              {}, // options
              callback
            );
          } else {
            logger.debug(
              `[auto-proposal] INTRO_PROPOSAL validation failed during auto-trigger for user ${userId}`
            );
          }
        } else {
          logger.warn('[auto-proposal] INTRO_PROPOSAL action not found during auto-trigger check');
        }
      } else {
        if (readyMatches.length > 0) {
          logger.debug(
            `[auto-proposal] Auto-trigger skipped: User ${userId} has ${readyMatches.length} matches but all already have introduction proposals`
          );
        } else {
          logger.debug(`[auto-proposal] Auto-trigger skipped: User ${userId} has no ready matches`);
        }
      }
    } catch (error) {
      logger.error(`[auto-proposal] Error in auto-trigger check for user ${userId}: ${error}`);
    }
  }
}
