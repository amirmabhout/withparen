import {
  type IAgentRuntime,
  type Memory,
  type Provider,
  type State,
  logger,
} from '@elizaos/core';
import { MemgraphService } from '../services/memgraph.js';
import { getDailyPlan } from './dailyPlan.js';

/**
 * Onboarding provider for deepen-connection
 * Provides narrative context for users who need to create or join connections
 */
export const onboardingProvider: Provider = {
  name: 'ONBOARDING',
  description: 'Provides onboarding narrative context for users creating or joining connections',
  get: async (runtime: IAgentRuntime, message: Memory, _state: State) => {
    const userId = message.entityId;

    // Check if user has a daily plan - if yes, skip onboarding (they're already connected)
    if (userId) {
      try {
        const dailyPlan = await getDailyPlan(runtime, userId);
        if (dailyPlan) {
          logger.debug(`[onboarding] User ${userId} has daily plan, skipping onboarding`);
          return {
            values: { userStatus: 'active' },
            data: { context: '' },
            text: '',
          };
        }
      } catch (error) {
        logger.warn(
          `[onboarding] Error checking daily plan: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    const memgraphService = new MemgraphService();

    try {
      await memgraphService.connect();

      // Update Person node roomId if needed
      const person = await memgraphService.getPersonByUserId(userId);
      if (person && person.roomId !== message.roomId) {
        await memgraphService.updatePersonRoomId(userId, message.roomId);
        logger.info(`[onboarding] Updated Person roomId for userId: ${userId}`);
      }

      // Check if user has connections
      const hasConnections = await memgraphService.hasHumanConnections(userId);

      if (hasConnections) {
        // User has connections but no daily plan - they're in transition
        logger.debug(`[onboarding] User ${userId} has connections, no daily plan yet`);
        return {
          values: { userStatus: 'connected_pending' },
          data: { context: '' },
          text: '',
        };
      }

      // User needs onboarding - provide narrative context
      const onboardingNarrative = `# Onboarding Task

Your goal: Help the user create a new connection OR join an existing connection with their partner.

Current status: User has no connections yet.

First message to send: 
"Hi! I'm Seren 👋

I help couples build deeper connections by having separate, private conversations with each partner. Think of me as your personal relationship coach who understands both of you.

First things first, did your partner invite you, or are you here to explore and then invite them?"

## If Creating New Connection / exploring and creating invite

Start with: Ask about their partner and what makes the connection special (1-3 exchanges for rapport)

Then collect to craete the invite:
- User's first name
- Partner's first name
- A secret memory only they share (like a fun memory, special song, inside joke, etc)

When you have all three: Call CREATE_CONNECTION action

## If Joining Existing Connection and partner invited them

Collect:
- User's first name
- Partner's first name (who created the invitation)
- The secret word or phrase they chose together

When you have all three: Call JOIN_CONNECTION action

## Key Guidelines
- Ask ONE question at a time
- Keep responses natural and conversational
- For creating new: build rapport first, then collect info
- For joining: collect info directly, user was already invited
- Once you have all required info for either path, call the appropriate action
`;

      return {
        values: {
          userStatus: 'onboarding',
          onboardingStage: 'active',
          conversationType: 'connection_onboarding',
        },
        data: {
          context: onboardingNarrative,
        },
        text: onboardingNarrative,
      };
    } catch (error) {
      logger.error(
        `[onboarding] Error in provider: ${error instanceof Error ? error.message : String(error)}`
      );
      return {
        values: { userStatus: 'error' },
        data: { context: '' },
        text: '',
      };
    } finally {
      await memgraphService.disconnect();
    }
  },
};
