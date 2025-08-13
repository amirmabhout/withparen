import { type IAgentRuntime, type Memory, type Provider, type State, ModelType, parseKeyValueXml, logger } from '@elizaos/core';
import { MemgraphService, type HumanConnectionNode } from '../services/memgraph.js';
import { authenticationExtractionTemplate, authenticationFlexibleVerificationTemplate } from '../utils/promptTemplates.js';
import { getDailyPlan } from './dailyPlan.js';

/**
 * Returns the relationship exploration context for users who have established connections (active)
 */
function getRelationshipExplorationContextActive() {
  const completedContext = `# Important task: Exploring the Heart of Their Connection

You are having a warm, curious conversation with someone about their important relationship. Your goal is to help them tell the story of their connection - starting from the very beginning and exploring what makes it special.

## Conversation Flow & Phases

### Phase 1: Origin Story (Turn 3-6)
Guide them to share their beginning:
- "I'd love to hear how you two first met - what's that story?"
- "What was your very first impression of them?"
- "Tell me about that first moment when you thought 'there's something special here'"
- "What drew you to each other in those early days?"

### Phase 2: Deepening Understanding (Turn 7-10)
Explore what makes their connection unique:
- "What's something about them that still surprises you?"
- "When do you feel most connected to each other?"
- "What's a moment that really showed you who they are?"
- "How do you two handle the tough moments together?"

### Phase 3: Natural Closure (Turn 11+)
After 8-12 meaningful exchanges, begin wrapping up:
- Reflect back the beautiful themes you've heard
- Thank them for sharing their story
- "Thank you for letting me into your world - there's something really beautiful about what you two have"
- "I can see why this person means so much to you"
- End with: "That's all for now, but I'd love to continue this conversation tomorrow"

## Conversation Techniques

### Ask One Question at a Time
- Pose a single, thoughtful question and wait
- Let their answer guide your next response
- Don't overwhelm with multiple questions

### Listen, Reflect, Then Ask
1. **Listen** to what they share
2. **Reflect** back what you heard: "That sounds like it was magical" or "I can hear how much that meant to you"
3. **Ask** a gentle follow-up if necessary: "What was that like for you?" or "How did that change things?"

### Use Natural Transitions
- "That's such a beautiful way to put it..."
- "I'm struck by how you describe..."
- "What I'm hearing is..."
- "That reminds me of something you mentioned..."

### Validate and Encourage
- "That must have been special"
- "I can picture that moment"
- "There's something really beautiful about that"
- "That sounds like it was exactly what you both needed"

## What to Avoid
- Don't ask rapid-fire questions
- Don't jump topics without building on their response
- Don't use clinical or therapeutic language
- Don't make it feel like an interview
- Don't give advice unless they specifically ask

## Conversation Ending
After 5-10 meaningful exchanges (depending on their engagement), naturally wind down:
- Summarize the beautiful themes you heard
- Express gratitude for them sharing
- Let them know this is just the beginning
- Tell them you'll continue tomorrow

Remember: This is about helping them tell their love story, not conducting an interview. Be genuinely curious, warmly reflective, and let their narrative guide the conversation naturally to its conclusion.`;

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
 * Returns the relationship exploration context for users who are currently waitlisted
 */
function getRelationshipExplorationContextWaitlist() {
  const waitlistContext = `# Important task: Exploring the Heart of Their Connection (Waitlist)

You are having a warm, curious conversation with someone about their important relationship. Your goal is to help them tell the story of their connection - starting from the very beginning and exploring what makes it special.

## Conversation Flow & Phases

### Phase 1: Origin Story (Turn 3-6)
Guide them to share their beginning:
- "I'd love to hear how you two first met - what's that story?"
- "What was your very first impression of them?"
- "Tell me about that first moment when you thought 'there's something special here'"
- "What drew you to each other in those early days?"

### Phase 2: Deepening Understanding (Turn 7-10)
Explore what makes their connection unique:
- "What's something about them that still surprises you?"
- "When do you feel most connected to each other?"
- "What's a moment that really showed you who they are?"
- "How do you two handle the tough moments together?"

### Phase 3: Gentle Pause (Turn 11+)
After 8-12 meaningful exchanges, begin wrapping up:
- Reflect back the beautiful themes you've heard
- Thank them for sharing their story
- Let them know: "As soon as your spot opens up, I’ll be here to get you fully set up."
- Invite them to continue: "In the meantime, I’m right here to keep exploring your relationship from different angles whenever you’d like."

## Conversation Techniques

### Ask One Question at a Time
- Pose a single, thoughtful question and wait
- Let their answer guide your next response
- Don't overwhelm with multiple questions

### Listen, Reflect, Then Ask
1. **Listen** to what they share
2. **Reflect** back what you heard: "That sounds like it was magical" or "I can hear how much that meant to you"
3. **Ask** a gentle follow-up if necessary: "What was that like for you?" or "How did that change things?"

### Use Natural Transitions
- "That's such a beautiful way to put it..."
- "I'm struck by how you describe..."
- "What I'm hearing is..."
- "That reminds me of something you mentioned..."

### Validate and Encourage
- "That must have been special"
- "I can picture that moment"
- "There's something really beautiful about that"
- "That sounds like it was exactly what you both needed"

## What to Avoid
- Don't ask rapid-fire questions
- Don't jump topics without building on their response
- Don't use clinical or therapeutic language
- Don't make it feel like an interview
- Don't give advice unless they specifically ask

## Conversation Ending
After 5-10 meaningful exchanges (depending on their engagement), naturally wind down:
- Summarize the themes you heard
- Express gratitude for them sharing
- Let them know: "I’ll check back as soon as your waitlist clears and you’re in."
- Encourage them: "Until then, I’m here anytime you want to keep exploring your story together."

Remember: This is about helping them tell their love story, not conducting an interview. Be genuinely curious, warmly reflective, and let their narrative guide the conversation naturally to its conclusion.`;

  return {
    values: {
      onboardingStage: 'relationship_exploration_waitlist',
      conversationType: 'connection_deepening',
    },
    data: {
      context: waitlistContext,
    },
    text: waitlistContext,
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
    // Extract entityId from message (this is the userId)
    const userId = message.entityId;

    // Check if user has a daily plan for today - if they do, disable onboarding provider
    if (userId) {
      try {
        const dailyPlan = await getDailyPlan(_runtime, userId);
        if (dailyPlan) {
          logger.debug(`[onboarding] User ${userId} has daily plan for today, skipping onboarding provider`);
          return {
            values: {
              onboarding: '',
            },
            data: {
              context: null,
            },
            text: '',
          };
        }
      } catch (error) {
        logger.warn('[onboarding] Error checking daily plan, continuing with onboarding:', error);
      }
    }

    const memgraphService = new MemgraphService();

    try {
      await memgraphService.connect();

      const roomId = message.roomId;

      // Check if Person node exists for this runtime user. Do NOT auto-create here to avoid
      // duplicates if a Person already exists in the connection from the web app. Only update
      // roomId if an existing node is found.
      const person = await memgraphService.getPersonByUserId(userId);
      if (person && person.roomId !== roomId) {
        await memgraphService.updatePersonRoomId(userId, roomId);
        logger.info(`[onboarding] Updated Person node roomId for userId: ${userId} to roomId: ${roomId}`);
      }

      // Check if Person has any HumanConnection relationships
      const hasConnections = await memgraphService.hasHumanConnections(userId);

      // If user doesn't have connections, try authentication first
      let shouldProceedToRelationshipExploration = hasConnections;

      let lastAuthConnection: HumanConnectionNode | undefined;
      if (!hasConnections) {
        const authResult = await tryAuthentication(_runtime, message, userId, memgraphService);
        shouldProceedToRelationshipExploration = authResult.success;
        lastAuthConnection = authResult.matchingConnection;
      }

      if (shouldProceedToRelationshipExploration) {
        // Determine status-based context
        let chosenStatus: string | undefined;
        if (hasConnections) {
          const connections = await memgraphService.getHumanConnections(userId);
          // Prefer active if any; otherwise use the first connection's status
          const hasActive = connections.some(c => (c.status || 'active') === 'active');
          chosenStatus = hasActive ? 'active' : (connections[0]?.status || 'active');
        } else if (lastAuthConnection) {
          chosenStatus = lastAuthConnection.status || 'active';
        } else {
          chosenStatus = 'active';
        }

        if ((chosenStatus || 'active') === 'waitlist') {
          return getRelationshipExplorationContextWaitlist();
        }
        return getRelationshipExplorationContextActive();
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
): Promise<{ success: boolean; message?: string; matchingConnection?: HumanConnectionNode }> {
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

    // Check if we have at least the two names; secret may be validated flexibly later
    if (!extractedInfo.userName || !extractedInfo.partnerName) {
      return { success: false, message: 'Missing names for authentication' };
    }

    // Update person's name if provided
    if (extractedInfo.userName) {
      await memgraphService.updatePersonName(userId, extractedInfo.userName);
    }

    // Find candidate connections by partner names
    const candidates = await memgraphService.findConnectionsByPartnerNames(
      extractedInfo.userName,
      extractedInfo.partnerName
    );

    if (!candidates || candidates.length === 0) {
      logger.info('[onboarding] No candidate HumanConnection found by partner names');
      return { success: false, message: 'No matching connection candidates' };
    }

    // If we have a secret, run flexible verification to choose the best match
    if (!extractedInfo.secret) {
      logger.info('[onboarding] Secret not provided yet; cannot verify connection');
      return { success: false, message: 'Missing secret for verification' };
    }

    const verificationPrompt = authenticationFlexibleVerificationTemplate
      .replace('{{userName}}', extractedInfo.userName)
      .replace('{{partnerName}}', extractedInfo.partnerName)
      .replace('{{userSecretText}}', extractedInfo.secret)
      .replace('{{candidatesJson}}', JSON.stringify(candidates));

    const verificationResponse = await runtime.useModel(ModelType.TEXT_SMALL, {
      prompt: verificationPrompt,
      temperature: 0.1,
    });

    let verification;
    try {
      verification = parseKeyValueXml(verificationResponse);
    } catch (e) {
      logger.error('[onboarding] Failed to parse flexible verification response:', e);
      return { success: false, message: 'Failed to verify secret' };
    }

    const decision = (verification?.decision || '').toLowerCase();
    if (decision !== 'matched') {
      logger.info('[onboarding] Flexible verification did not find a confident match');
      return { success: false, message: 'Secret did not match' };
    }

    // Resolve the selected connection from the verification result
    let selected: any | null = null;
    if (verification.raw) {
      try {
        selected = JSON.parse(verification.raw);
      } catch (_e) {
        selected = null;
      }
    }

    let matchingConnection = null as any;
    if (selected && (selected.connectionId || selected.secret)) {
      matchingConnection = candidates.find(c => {
        if (selected.connectionId && c.connectionId) {
          return c.connectionId === selected.connectionId;
        }
        return c.secret === selected.secret;
      }) || null;
    }
    if (!matchingConnection) {
      const matchId = verification.match || '';
      if (matchId && matchId !== 'partners+secret') {
        matchingConnection = candidates.find(c => c.connectionId === matchId) || null;
      }
    }
    if (!matchingConnection) {
      // Last resort: try partners + secret from response
      const partnersCsv = verification.partners || '';
      const secret = verification.secret || '';
      const partners = partnersCsv ? partnersCsv.split(',').map((s: string) => s.trim()) : undefined;
      matchingConnection = candidates.find(c => !!partners && JSON.stringify(c.partners) === JSON.stringify(partners) && c.secret === secret) || null;
    }

    if (!matchingConnection) {
      logger.info('[onboarding] Could not resolve selected HumanConnection from verification');
      return { success: false, message: 'Verification did not select a connection' };
    }

    logger.info('[onboarding] Flexible verification matched HumanConnection:', matchingConnection);

    // Try to update existing Person node by name within the selected connection
    const nameMatchPerson = await memgraphService.findPersonByNameInConnection(
      extractedInfo.userName,
      matchingConnection
    );

    if (nameMatchPerson) {
      await memgraphService.updatePersonByNameInConnection(
        extractedInfo.userName,
        matchingConnection,
        { userId, roomId: message.roomId }
      );
      logger.info('[onboarding] Updated existing Person in connection with userId/roomId');
    } else {
      // Ensure or create a person node for this runtime user, then link
      await memgraphService.ensurePerson(userId, message.roomId, extractedInfo.userName);
    }

    // Link the person (now identified by userId) to the connection
    const linkSuccess = await memgraphService.linkPersonToHumanConnection(userId, matchingConnection);

    if (linkSuccess) {
      // Safety: deduplicate if an older Person node with same userId exists
      try {
        await memgraphService.deduplicatePersonsByUserId(userId);
      } catch (e) {
        logger.warn('[onboarding] Deduplication warning:', e);
      }
      logger.info(`[onboarding] Successfully authenticated and linked user ${userId} to HumanConnection`);
      return { success: true, message: 'Authentication successful', matchingConnection };
    }

    logger.error('[onboarding] Failed to create connection link');
    return { success: false, message: 'Failed to create connection link' };

  } catch (error) {
    logger.error('[onboarding] Authentication error:', error);
    return { success: false, message: 'Authentication process failed' };
  }
}