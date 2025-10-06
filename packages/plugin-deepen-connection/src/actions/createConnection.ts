import {
  type IAgentRuntime,
  type Memory,
  type Action,
  type State,
  type ActionExample,
  type HandlerCallback,
  type ActionResult,
  ModelType,
  parseKeyValueXml,
  logger,
} from '@elizaos/core';
import { MemgraphService } from '../services/memgraph.js';
import {
  connectionCreationNarrativeTemplate,
  connectionExtractionTemplate,
  connectionResponseTemplate,
} from '../utils/promptTemplates.js';

/**
 * Action to create a new HumanConnection with waitlist status through narrative conversation
 */
export const createConnectionAction: Action = {
  name: 'CREATE_CONNECTION',
  description:
    'Creates a new human connection through a narrative conversation about their relationship',
  similes: [
    'CREATE_HUMAN_CONNECTION',
    'SETUP_CONNECTION',
    'START_CONNECTION',
    'NEW_CONNECTION',
    'INVITE_PARTNER',
    'CREATE_INVITE',
  ],
  examples: [] as ActionExample[][],
  validate: async (_runtime: IAgentRuntime, message: Memory) => {
    const messageText = message.content?.text?.trim() || '';

    // Only exclude completely empty messages
    if (messageText.length === 0) {
      return false;
    }

    // Check if the message indicates intent to create a connection
    const createIntentKeywords = [
      'create',
      'new connection',
      'invite',
      'start',
      'set up',
      'begin',
      'initiate',
      'partner',
      'relationship',
      'deepen',
    ];

    const lowerText = messageText.toLowerCase();
    const hasCreateIntent = createIntentKeywords.some((keyword) => lowerText.includes(keyword));

    if (hasCreateIntent) {
      logger.debug(
        `[createConnection] Validation passed: Create intent detected for userId: ${message.entityId}`
      );
      return true;
    }

    // Also validate if we're in the middle of a connection creation flow
    // This would be tracked through conversation state
    return false;
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options: any,
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    const memgraphService = new MemgraphService();

    try {
      await memgraphService.connect();

      // Get the user's entityId as userId
      const userId = message.entityId;

      // Check if user already has connections
      const hasConnections = await memgraphService.hasHumanConnections(userId);
      if (hasConnections) {
        const responseText =
          "I see you already have an existing connection. If you'd like to create another connection or need help with your current one, please let me know how I can assist you.";

        if (callback) {
          await callback({
            text: responseText,
            thought: 'User already has connections',
            actions: ['CREATE_CONNECTION'],
          });
        }

        return {
          text: responseText,
          success: false,
          error: new Error('User already has connections'),
        };
      }

      // Get recent messages for context (limit to last 30 for narrative understanding)
      const recentMessages = await runtime.getMemories({
        tableName: 'messages',
        roomId: message.roomId,
        count: 30,
        unique: false,
      });

      // Sort chronologically and format with role + time for clarity
      const formattedMessages = recentMessages
        .sort((a: any, b: any) => (a.createdAt || 0) - (b.createdAt || 0))
        .map((msg: any) => {
          const text = (msg.content?.text || '').trim();
          if (!text) return '';
          const isAgent = msg.entityId === runtime.agentId;
          const sender = isAgent ? 'Seren' : 'User';
          const time = msg.createdAt ? new Date(msg.createdAt).toISOString() : '';
          return `${time} ${sender}: ${text}`.trim();
        })
        .filter((line: string) => line.length > 0)
        .join('\n');

      // First, engage with narrative to understand the relationship
      const narrativePrompt = connectionCreationNarrativeTemplate.replace(
        '{{recentMessages}}',
        formattedMessages
      );

      const narrativeResponse = await runtime.useModel(ModelType.TEXT_SMALL, {
        prompt: narrativePrompt,
        temperature: 0.7,
      });

      const parsedNarrative = parseKeyValueXml(narrativeResponse);
      const narrativePhase = parsedNarrative?.phase || 'exploration';

      // If we're still in exploration phase, continue the narrative
      if (narrativePhase === 'exploration' || narrativePhase === 'understanding') {
        const narrativeText =
          parsedNarrative?.message ||
          "I'd love to hear more about this special person in your life. What makes your connection with them meaningful to you?";

        if (callback) {
          await callback({
            text: narrativeText,
            thought: parsedNarrative?.thought || 'Exploring relationship narrative',
            actions: ['CREATE_CONNECTION'],
          });
        }

        return {
          text: narrativeText,
          success: true,
          values: {
            phase: narrativePhase,
            readyForDetails: false,
          },
        };
      }

      // If we're ready to collect details, extract connection info
      const extractionPrompt = connectionExtractionTemplate.replace(
        '{{recentMessages}}',
        formattedMessages
      );

      const extractionResponse = await runtime.useModel(ModelType.TEXT_SMALL, {
        prompt: extractionPrompt,
        temperature: 0.1,
      });

      let extractedInfo;
      try {
        extractedInfo = parseKeyValueXml(extractionResponse);
        if (!extractedInfo) {
          throw new Error('Failed to parse XML response');
        }
        logger.debug('[createConnection] Successfully extracted connection info:', extractedInfo);
      } catch (e) {
        logger.error(`[createConnection] Failed to extract connection information: ${e}`);

        // Continue narrative if extraction fails
        const continueText =
          "Let's take this step by step. First, what's your first name? Just your first name is perfect.";

        if (callback) {
          await callback({
            text: continueText,
            thought: 'Need to gather basic information',
            actions: ['CREATE_CONNECTION'],
          });
        }

        return {
          text: continueText,
          success: true,
          values: {
            phase: 'gathering_details',
            needsInfo: true,
          },
        };
      }

      // Generate a connection ID for this user
      const connectionId = `${userId}_${Date.now()}`;

      // Prepare connection details
      const updates: any = {};
      if (extractedInfo.username && extractedInfo.username.trim()) {
        updates.username = extractedInfo.username.trim().toLowerCase();
      }
      if (extractedInfo.partnername && extractedInfo.partnername.trim()) {
        updates.partnername = extractedInfo.partnername.trim().toLowerCase();
      }
      if (extractedInfo.secret && extractedInfo.secret.trim()) {
        updates.secret = extractedInfo.secret.trim();
      }
      if (extractedInfo.relationshipInsight) {
        updates.relationshipInsight = extractedInfo.relationshipInsight;
      }

      // Check if we have minimum required information
      const hasMinimumInfo = updates.username && updates.partnername && updates.secret;

      if (!hasMinimumInfo) {
        // Determine what's missing and continue conversation
        const missingItems: string[] = [];
        if (!updates.username) missingItems.push('your first name');
        if (!updates.partnername) missingItems.push("your partner's first name");
        if (!updates.secret) missingItems.push('a special word or phrase that only you two would know');

        const gatheringPrompt = connectionResponseTemplate
          .replace('{{username}}', updates.username || '')
          .replace('{{partnername}}', updates.partnername || '')
          .replace('{{secret}}', updates.secret || '')
          .replace('{{missingInfo}}', missingItems.join(', '))
          .replace('{{connectionExists}}', 'false')
          .replace('{{connectionCreated}}', 'false')
          .replace('{{phase}}', 'gathering');

        const gatheringResponse = await runtime.useModel(ModelType.TEXT_SMALL, {
          prompt: gatheringPrompt,
          temperature: 0.5,
        });

        const parsedGathering = parseKeyValueXml(gatheringResponse);
        const gatheringText =
          parsedGathering?.message || `To set things up, I still need ${missingItems[0]}. Could you share that with me?`;

        if (callback) {
          await callback({
            text: gatheringText,
            thought: parsedGathering?.thought || 'Gathering missing information',
            actions: ['CREATE_CONNECTION'],
          });
        }

        return {
          text: gatheringText,
          success: true,
          values: {
            phase: 'gathering_details',
            missingInfo: missingItems,
            partialInfo: updates,
          },
        };
      }

      // Create the HumanConnection
      const connection = await memgraphService.createHumanConnectionWithWaitlist(
        connectionId,
        updates.username,
        updates.partnername,
        updates.secret
      );
      logger.info(`[createConnection] Created new HumanConnection: ${JSON.stringify(connection)}`);

      // Ensure Person node exists and link to HumanConnection
      try {
        // Create or update Person node
        await memgraphService.ensurePerson(userId, message.roomId, updates.username);
        logger.debug(`[createConnection] Ensured Person node for userId: ${userId}`);

        // Link Person to HumanConnection
        await memgraphService.linkPersonToHumanConnection(userId, connection);
        logger.debug('[createConnection] Linked Person to HumanConnection via PARTICIPATES_IN');
      } catch (linkError) {
        logger.warn(`[createConnection] Failed to link Person to HumanConnection: ${linkError}`);
      }

      // Generate success response with next steps
      const successPrompt = connectionResponseTemplate
        .replace('{{username}}', updates.username)
        .replace('{{partnername}}', updates.partnername)
        .replace('{{secret}}', '***') // Don't echo back the secret
        .replace('{{missingInfo}}', '')
        .replace('{{connectionExists}}', 'false')
        .replace('{{connectionCreated}}', 'true')
        .replace('{{phase}}', 'complete')
        .replace('{{relationshipInsight}}', updates.relationshipInsight || '');

      const successResponse = await runtime.useModel(ModelType.TEXT_SMALL, {
        prompt: successPrompt,
        temperature: 0.5,
      });

      const parsedSuccess = parseKeyValueXml(successResponse);
      const successText =
        parsedSuccess?.message ||
        `Beautiful! I've created your connection with ${updates.partnername}. Now ${updates.partnername} can join using your shared secret when they're ready. In the meantime, I'm here to help you explore and deepen your connection. Would you like to tell me more about what brought you two together?`;

      if (callback) {
        await callback({
          text: successText,
          thought: parsedSuccess?.thought || 'Connection successfully created',
          actions: ['CREATE_CONNECTION'],
        });
      }

      return {
        text: successText,
        success: true,
        values: {
          connectionCreated: true,
          username: updates.username,
          partnername: updates.partnername,
          hasSecret: true,
          status: connection?.status || 'waitlist',
          phase: 'complete',
        },
        data: {
          connection,
        },
      };
    } catch (error) {
      logger.error(`[createConnection] Error creating connection: ${error}`);

      const errorText =
        "I'm having a moment of difficulty creating your connection. Let's try again - could you tell me your first name?";

      if (callback) {
        await callback({
          text: errorText,
          thought: 'System error occurred',
          actions: ['CREATE_CONNECTION'],
        });
      }

      return {
        text: errorText,
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    } finally {
      await memgraphService.disconnect();
    }
  },
};