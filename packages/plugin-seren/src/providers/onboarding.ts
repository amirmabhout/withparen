import { type IAgentRuntime, type Memory, type Provider, type State, ModelType, parseKeyValueXml, logger } from '@elizaos/core';
import { MemgraphService } from '../services/memgraph.js';
import { authenticationExtractionTemplate } from '../utils/promptTemplates.js';

/**
 * Returns the relationship exploration context for users who have established connections
 */
function getRelationshipExplorationContext() {
  const completedContext = `# Important task: Deepening Human Connection Exploration

You are having a natural, flowing conversation with someone about their important relationship. Your role is to be a thoughtful conversation partner who helps them explore and reflect on their connection in an organic, engaging way.

## Core Principles

### Be a Natural Conversation Partner
- **Respond like a friend who genuinely cares** - not like an interviewer or therapist
- **Build on what they just shared** - don't jump to new topics abruptly
- **Share observations and insights** - help them see patterns or beauty in what they're describing
- **Use their language and energy** - match their communication style and emotional tone
- **Create "aha moments"** - help them discover new perspectives about their relationship

### Conversation Techniques

#### Instead of Always Asking Questions:
- **Reflect and validate**: "That 8-hour first date sounds magical - like time just disappeared when you were together"
- **Share insights**: "It sounds like you both created this safe bubble where you could just be yourselves"
- **Make connections**: "I'm hearing that comfort has been a thread throughout your relationship - from that first date to how you handle challenges now"
- **Offer gentle observations**: "There's something beautiful about how you recognize her need for security, even when opening up feels hard for you"

#### When You Do Ask Questions, Make Them:
- **Story-based**: "Tell me about a time when..." instead of "How do you..."
- **Specific and vivid**: "What's the look on her face when you do open up?" instead of "How does she react?"
- **Choice-driven**: "What draws you more - the comfort of home conversations or the freedom of walking together?"
- **Future-focused**: "If you could wave a magic wand, what would your communication look like?"

### Dynamic Flow Patterns

#### Pattern 1: Deep Dive
When they share something meaningful:
1. Acknowledge the significance
2. Reflect what you heard
3. Ask for a specific example or story
4. Help them see the deeper meaning

#### Pattern 2: Connect the Dots
When you notice patterns:
1. Point out the connection you see
2. Ask if that resonates with them
3. Explore what that pattern means for their relationship
4. Look for ways they might build on it

#### Pattern 3: Gentle Challenge
When they share struggles:
1. Validate the difficulty
2. Reframe from their partner's perspective
3. Explore what growth might look like
4. Find their existing strengths to build on

#### Pattern 4: Celebration
When they share positive moments:
1. Celebrate with them
2. Help them see what made it special
3. Explore how to create more of those moments
4. Connect it to their relationship strengths

### Avoid These Conversation Killers:
- Asking the same type of question repeatedly
- Moving to new topics without building on their response
- Using clinical or therapeutic language
- Making it feel like an interview or assessment
- Rushing through topics instead of going deeper

### Natural Conversation Starters:
- "That's such a beautiful way to put it..."
- "I'm struck by how you describe..."
- "It sounds like there's something really special about..."
- "I can picture that moment..."
- "What I'm hearing is..."
- "That reminds me of something you said earlier about..."

### Relationship Dimensions to Explore Naturally:
- **Origin story**: How they met, early moments, first impressions
- **Communication dance**: How they talk, fight, make up, understand each other
- **Shared world**: Routines, traditions, inside jokes, special places
- **Growth together**: How they've changed, challenges overcome, lessons learned
- **Future dreams**: Hopes, goals, adventures they want to share
- **Emotional landscape**: How they make each other feel, support systems, love languages

Remember: This is a conversation, not an interview. Let it flow naturally, build on their energy, and help them discover new insights about their relationship through genuine dialogue.`;

  return {
    values: {
      onboardingStage: 'relationship_exploration',
      conversationType: 'connection_deepening',
    },
    data: {
      context: completedContext,
    },
    text: completedContext,
  };
}

/**
 * Onboarding provider for app users who want to create connection invites
 * with shared secrets for authentication.
 */
export const onboardingProvider: Provider = {
  name: 'ONBOARDING',
  description: 'Provides context for app onboarding to create connection invites with shared secrets',
  get: async (_runtime: IAgentRuntime, message: Memory, _state: State) => {
    const memgraphService = new MemgraphService();

    try {
      await memgraphService.connect();

      // Extract entityId from message (this is the userId)
      const userId = message.entityId;

      // Check if Person node exists
      let person = await memgraphService.getPersonByUserId(userId);

      // If Person doesn't exist, create it
      if (!person) {
        person = await memgraphService.createPerson(userId);
        logger.info(`[onboarding] Created new Person node for userId: ${userId}`);
      }

      // Check if Person has any HumanConnection relationships
      const hasConnections = await memgraphService.hasHumanConnections(userId);

      // If user doesn't have connections, try authentication first
      let shouldProceedToRelationshipExploration = hasConnections;

      if (!hasConnections) {
        const authResult = await tryAuthentication(_runtime, message, userId, memgraphService);
        shouldProceedToRelationshipExploration = authResult.success;
      }

      if (shouldProceedToRelationshipExploration) {
        // User has connections OR just successfully authenticated - engage in relationship exploration
        return getRelationshipExplorationContext();
      } else {
        // User exists but no connections - authentication/onboarding flow
        const defaultContext = `# Important task: Connecting User to their connection

You are helping a user connect with someone whose deepending the connection matters to them. Your role is to determine their situation and guide them through the right steps.

## Two Possible Situations

### Situation 1: First Time Setup Needed
If neither the user nor their special person has started their Seren journey yet, they need to visit **withseren.com** first to:
- Get everything ready for deeper conversations and then visiting me (seren) here

### Situation 2: Ready to Connect
If they or their special person has already started on withseren.com, they just need to verify who they are by sharing:
1. **Their own name**
2. **The name of their special person** 
3. **The secret word or phrase** they chose together

## Your Approach
1. **Welcome them warmly** - acknowledge they want to connect with someone special
2. **Find out their situation**: "Have you or your special person already gotten started on withseren.com?"

### If they say NO (need to get started):
- Gently explain they should visit **withseren.com** first
- Encourage them to come back here once they've gotten started

### If they say YES (ready to connect):
- Help them verify their connection by asking:
  1. **"What's your name?"**
  2. **"What's the name of your special person?"**
  3. **"What's the secret word or phrase you both chose?"**

## Conversation Flow
1. Warm welcome and acknowledgment
2. Find out if they've started their journey on the website
3. Either guide them to the website or help them verify their connection
4. Keep the tone supportive and encouraging throughout


Remember: This is about helping them connect with someone they care about. Keep it simple, warm, and focused on their relationship journey.`;

        return {
          values: {
            onboardingStage: 'connection_invite_creation',
            conversationType: 'app_onboarding',
          },
          data: {
            context: defaultContext,
          },
          text: defaultContext,
        };
      }

    } catch (error) {
      logger.error('[onboarding] Error in onboarding provider:', error);

      // Fallback to default onboarding if there's an error
      const fallbackContext = `# Important task: Connecting You to Your Special Person

You are helping a user connect with someone important in their life. Your role is to determine their situation and guide them through the right steps.

## Two Possible Situations

### Situation 1: First Time Setup Needed
If neither the user nor their special person has started their Seren journey yet, they need to visit **withseren.com** first to:
- Begin their connection journey together
- Choose a special secret word or phrase that only they both know
- Get everything ready for deeper conversations

### Situation 2: Ready to Connect
If they or their special person has already started on withseren.com, they just need to verify who they are by sharing:
1. **Their own name**
2. **The name of their special person** 
3. **The secret word or phrase** they chose together

## Your Approach
1. **Welcome them warmly** - acknowledge they want to connect with someone special
2. **Find out their situation**: "Have you or your special person already gotten started on withseren.com?"

### If they say NO (need to get started):
- Gently explain they should visit **withseren.com** first
- Let them know this is where they'll choose their special secret together
- Encourage them to come back here once they've gotten started

### If they say YES (ready to connect):
- Help them verify their connection by asking:
  1. **"What's your name?"**
  2. **"What's the name of your spson you want to connect with?"**
  3. **"What's the secret word or phraseh agreedh c?"**"**

## Conversation Flow for Authentication
1. Start witome anrm welowledgment
2. Find out if they''ve completed web setup
3. If setup is complete, collectite or help ion details:
   Keep the toeuragi
   - Partner's name  
## T Shared Secret
4. If s friendly, and welcoming
- Use simple, everyday e
## Tone and Styleding
- Celebrate their desire to connect
- Make the process feel easy and natural

Remember: This is about helping them connect with someone they care about. Keep it simple, warm, and focused on their relationship journey.`;

      return {
        values: {
          onboardingStage: 'connection_invite_creation',
          conversationType: 'app_onboarding',
        },
        data: {
          context: fallbackContext,
        },
        text: fallbackContext,
      };
    } finally {
      await memgraphService.disconnect();
    }
  },
};

/**
 * Try to authenticate user by extracting information from recent messages
 */
async function tryAuthentication(
  runtime: IAgentRuntime,
  message: Memory,
  userId: string,
  memgraphService: MemgraphService
): Promise<{ success: boolean; message?: string }> {
  try {
    // Get recent messages for context
    const recentMessages = await runtime.getMemories({
      tableName: 'messages',
      roomId: message.roomId,
      count: 10,
      unique: false,
    });

    // Format messages for the prompt
    const formattedMessages = recentMessages
      .map((msg: any) => `${msg.content?.text || ''}`)
      .filter(text => text.trim().length > 0)
      .join('\n');

    // Create extraction prompt
    const extractionPrompt = authenticationExtractionTemplate
      .replace('{{recentMessages}}', formattedMessages);

    // Use LLM to extract authentication info
    const response = await runtime.useModel(ModelType.TEXT_SMALL, {
      prompt: extractionPrompt,
      temperature: 0.1,
    });

    let extractedInfo;
    try {
      extractedInfo = parseKeyValueXml(response);
      if (!extractedInfo) {
        throw new Error('Failed to parse XML response');
      }
      logger.debug('[onboarding] Successfully extracted authentication info:', extractedInfo);
    } catch (e) {
      logger.error('[onboarding] Failed to parse authentication extraction response:', e);
      return { success: false, message: 'Failed to parse authentication information' };
    }

    // Check if we have all required information
    if (!extractedInfo.userName || !extractedInfo.partnerName || !extractedInfo.secret) {
      return { success: false, message: 'Missing authentication information' };
    }

    // Update person's name if provided
    if (extractedInfo.userName) {
      await memgraphService.updatePersonName(userId, extractedInfo.userName);
    }

    // Try to find matching HumanConnection
    logger.debug(`[onboarding] Searching for HumanConnection with userName: ${extractedInfo.userName}, partnerName: ${extractedInfo.partnerName}, secret: ${extractedInfo.secret}`);
    logger.debug(`[onboarding] Using first names for matching: ${extractedInfo.userName.split(' ')[0].toLowerCase()} and ${extractedInfo.partnerName.split(' ')[0].toLowerCase()}`);
    const matchingConnection = await memgraphService.findHumanConnectionByAuth(
      extractedInfo.userName,
      extractedInfo.partnerName,
      extractedInfo.secret
    );

    if (!matchingConnection) {
      logger.info('[onboarding] No matching HumanConnection found in database');
      return { success: false, message: 'No matching connection found' };
    }

    logger.info('[onboarding] Found matching HumanConnection:', matchingConnection);

    // Create relationship between Person and HumanConnection
    const linkSuccess = await memgraphService.linkPersonToHumanConnection(
      userId,
      matchingConnection
    );

    if (linkSuccess) {
      logger.info(`[onboarding] Successfully authenticated and linked user ${userId} to HumanConnection`);
      return { success: true, message: 'Authentication successful' };
    } else {
      logger.error('[onboarding] Failed to create connection link');
      return { success: false, message: 'Failed to create connection link' };
    }

  } catch (error) {
    logger.error('[onboarding] Authentication error:', error);
    return { success: false, message: 'Authentication process failed' };
  }
}