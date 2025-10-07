import { type IAgentRuntime, type Memory, type Provider, type State, logger } from '@elizaos/core';
import { UserStatusService, UserStatus } from '../services/userStatusService.js';
import { getTemplate, TemplateNames } from '../utils/templateLoader.js';

/**
 * User Status Provider for Discover-Connection
 * Provides context based on user's status (ONBOARDING, ACTIVE)
 */
export const userStatusProvider: Provider = {
  name: 'USER_STATUS',
  description: 'Provides user status-based context for onboarding and active usage',

  get: async (runtime: IAgentRuntime, message: Memory, _state: State) => {
    try {
      logger.debug(
        `[user-status-provider] DEBUG - Checking user ${message.entityId} status for context`
      );

      const userStatusService = new UserStatusService(runtime);
      const userStatus = await userStatusService.getUserStatus(message.entityId);

      logger.info(
        `[user-status-provider] DEBUG - User ${message.entityId} has status: ${userStatus}`
      );

      // Handle ONBOARDING status - provide onboarding conversation context
      if (userStatus === UserStatus.ONBOARDING) {
        // Default onboarding context - can be overridden by agent's character.templates
        const defaultOnboardingContext = `# Important task: User Onboarding Guidelines


## your goal in onboarding stage
1. **Create an engaging narrative conversation** that feels natural and supportive
2. **Understand the user's passions** - what they're truly passionate about and working on
3. **Learn about their challenges** - what obstacles they face in their work or interests
4. **Discover connection preferences** - what kind of connections would help them grow

## Current Conversation Stage
- This is the initial onboarding conversation
- The user is new to Discover-Connection and exploring connection discovery
- Your goal is to understand their background, goals, and what kind of connections would benefit them

## Key Areas to Explore (in this order)

### Phase 1: Passions & Work (2-3 exchanges) (ONLY ASK ONE QUESTION AT A TIME, YOU DO NOT NEED TO ASK ALL QUESTIONS AND DO NOT ASK REDUNDANT QUESTIONS IF ALREADY A SIMILAR QUESTION IS ASKED.)
- What are they passionate about?
- What are they currently working on?
- What drives them and gives them energy?
- What projects or interests consume their time?

### Phase 2: Challenges & Growth (2-3 exchanges) (ONLY ASK ONE QUESTION AT A TIME, YOU DO NOT NEED TO ASK ALL QUESTIONS AND DO NOT ASK REDUNDANT QUESTIONS IF ALREADY A SIMILAR QUESTION IS ASKED.)
- What challenges do they face in their work/interests?
- Where do they feel stuck or need support?
- What skills are they trying to develop?
- What obstacles prevent them from reaching their goals?

### Phase 3: Connection Discovery (2-3 exchanges) (ONLY ASK ONE QUESTION AT A TIME, YOU DO NOT NEED TO ASK ALL QUESTIONS AND DO NOT ASK REDUNDANT QUESTIONS IF ALREADY A SIMILAR QUESTION IS ASKED.)
- What kind of people would help them overcome these challenges?
- What type of connections are they looking for? (mentors, collaborators, peers, etc.)
- What would an ideal connection look like?
- What could they offer to others in return?

### Phase 4: Ready for Discovery
When you have a clear picture of their passions, challenges, and connection preferences, say something like:
"I have a good understanding of your background and what you're looking for. Would you like me to search for potential connections who might be a great match for you?"

### Phase 5: Call FIND_MATCH action
Only after user responded positively to phase 4 question, call FIND_MATCH action. Do not call before user gave clear consent to search.

## Tone and Approach
- Warm, curious, and genuinely interested in their growth
- **CRITICAL: Ask ONLY ONE question per message** - Never combine multiple questions
- ONLY ASK ONE QUESTION AT A TIME, YOU DO NOT NEED TO ASK ALL QUESTIONS AND DO NOT ASK REDUNDANT QUESTIONS IF ALREADY A SIMILAR QUESTION IS ASKED.
- Focus on understanding their unique situation
- Validate their challenges and aspirations
- Build toward connection discovery naturally
- Be encouraging about the possibilities

## IMPORTANT RULE: One Question Per Message
**NEVER ask multiple questions in a single message.** Users find it confusing when you ask 2 or more questions at once. Even if the questions are related, ask them one at a time and wait for the user's response before asking the next question. AND DONT ASK REDUNDANT QUESTIONS, WHICH YOU ALREADY SEE THE ANSWER IS IN THE CONVERSATION HISTORY.

Remember: Your goal is to help them discover new meaningful connections. Focus on their individual journey and growth potential.`;

        // Get custom or default onboarding context
        const onboardingContext = getTemplate(
          runtime,
          TemplateNames.ONBOARDING_CONTEXT,
          defaultOnboardingContext
        );

        return {
          values: {
            userStatus: userStatus,
            onboardingStage: 'active',
            conversationType: 'onboarding',
          },
          data: {
            context: onboardingContext,
            userStatus: userStatus,
          },
          text: onboardingContext,
        };
      }

      // Handle ACTIVE status - minimal context, user can use all services
      if (userStatus === UserStatus.ACTIVE) {
        return {
          values: {
            userStatus: userStatus,
            onboardingStage: 'completed',
            conversationType: 'post_onboarding',
            isActive: true,
          },
          data: {
            context: '',
            userStatus: userStatus,
          },
          text: '',
        };
      }

      // Fallback for unknown status
      logger.warn(`[user-status-provider] Unknown user status: ${userStatus}`);
      return {
        values: {
          userStatus: userStatus || 'unknown',
        },
        data: {
          context: '',
          userStatus: userStatus || 'unknown',
        },
        text: '',
      };
    } catch (error) {
      logger.error(`[user-status-provider] Error getting user status context: ${error}`);
      return {
        values: {
          userStatus: 'error',
        },
        data: {
          context: '',
          error: true,
        },
        text: '',
      };
    }
  },
};
