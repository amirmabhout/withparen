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
import { connectionExtractionTemplate } from '../utils/promptTemplates.js';
import { sendConnectionCreatedNotification } from '../utils/adminNotifications.js';

/**
 * Action to create a new HumanConnection - extracts data from conversation and creates connection
 */
export const createConnectionAction: Action = {
  name: 'CREATE_CONNECTION',
  description: 'Creates a new human connection, When you have userName + partnerName + secret for new connection call this action',
  similes: ['CREATE_HUMAN_CONNECTION', 'SETUP_CONNECTION', 'START_CONNECTION', 'NEW_CONNECTION'],
  examples: [] as ActionExample[][],
  validate: async (_runtime: IAgentRuntime, _message: Memory, _state?: State) => {
    // Simple validation - let the action handler do the heavy lifting
    // Action will be called when conversation flow reaches this point
    return true;
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

      const userId = message.entityId;

      // Check if user already has connections
      const hasConnections = await memgraphService.hasHumanConnections(userId);
      if (hasConnections) {
        const responseText =
          "I see you already have an existing connection. If you'd like to create another or need help with your current one, let me know.";

        if (callback) {
          await callback({
            text: responseText,
            thought: 'User already has connections',
            actions: ['NONE'],
          });
        }

        return {
          text: responseText,
          success: false,
          error: new Error('User already has connections'),
        };
      }

      // Get recent messages for extraction
      const recentMessages = await runtime.getMemories({
        roomId: message.roomId,
        tableName: 'messages',
        count: 15,
        unique: false,
      });

      // Format messages for extraction
      const formattedMessages = recentMessages
        .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
        .map((msg: any) => {
          const role = msg.entityId === userId ? 'User' : 'Seren';
          return `${role}: ${msg.content?.text || ''}`;
        })
        .join('\n');

      // Extract connection information from conversation
      const extractionPrompt = connectionExtractionTemplate.replace(
        '{{recentMessages}}',
        formattedMessages
      );

      const extractionResponse = await runtime.useModel(ModelType.TEXT_SMALL, {
        prompt: extractionPrompt,
        temperature: 0.1,
      });

      const extracted = parseKeyValueXml(extractionResponse);

      if (!extracted) {
        logger.error('[createConnection] Failed to parse extraction response');
        const fallbackText =
          "I'm having trouble understanding the information. Let's start fresh - what's your first name?";

        if (callback) {
          await callback({
            text: fallbackText,
            thought: 'Failed to extract information',
            actions: ['NONE'],
          });
        }

        return {
          text: fallbackText,
          success: false,
          error: new Error('Failed to parse extraction'),
        };
      }

      const userName = extracted.userName?.trim().toLowerCase() || '';
      const partnerName = extracted.partnerName?.trim().toLowerCase() || '';
      const secret = extracted.secret?.trim().toLowerCase() || '';

      logger.debug(
        `[createConnection] Extracted - userName: "${userName}", partnerName: "${partnerName}", secret: "${!!secret}"`
      );

      // Validate we have all required information
      if (!userName || !partnerName || !secret) {
        const missing = extracted.missing || 'some information';
        const errorText = `I still need ${missing}. Can you provide that?`;

        logger.info(`[createConnection] Missing data: ${missing}`);

        if (callback) {
          await callback({
            text: errorText,
            thought: `Missing: ${missing}`,
            actions: ['NONE'],
          });
        }

        return {
          text: errorText,
          success: false,
          error: new Error(`Missing required information: ${missing}`),
        };
      }

      // Create the HumanConnection
      const connectionId = `${userId}_${Date.now()}`;
      const connection = await memgraphService.createHumanConnectionWithWaitlist(
        connectionId,
        userName,
        partnerName,
        secret
      );
      logger.info(`[createConnection] Created HumanConnection: ${JSON.stringify(connection)}`);

      // Create Person node and link to HumanConnection
      await memgraphService.ensurePerson(userId, message.roomId, userName);
      await memgraphService.linkPersonToHumanConnection(userId, connection);
      logger.info(`[createConnection] Linked Person ${userId} to HumanConnection ${connectionId}`);

      // Send admin notification for connection creation (non-blocking)
      sendConnectionCreatedNotification(connection, userId, userName).catch((error) =>
        logger.error(
          `[createConnection] Admin notification failed: ${error instanceof Error ? error.message : String(error)}`
        )
      );

      // Success response
      const successText = `Beautiful! Your invite for ${partnerName} is ready.

Now, invite ${partnerName} to join you here:
https://t.me/withseren_bot

When they start chatting with me, they should mention they are invited and I'll ask them for the secret memory"${secret}" to verify it's really them.

Once ${partnerName} joins, we'll begin our journey together. I'll have separate, private conversations with each of you to help deepen what you already share.`;

      if (callback) {
        await callback({
          text: successText,
          thought: 'Connection successfully created',
          actions: ['NONE'],
        });
      }

      return {
        text: successText,
        success: true,
        values: {
          connectionCreated: true,
          userName,
          partnerName,
          status: connection?.status || 'waitlist',
        },
        data: { connection },
      };
    } catch (error) {
      logger.error(
        `[createConnection] Error: ${error instanceof Error ? error.message : String(error)}`
      );

      const errorText = 'I encountered an error creating your connection. Please try again.';

      if (callback) {
        await callback({
          text: errorText,
          thought: 'System error occurred',
          actions: ['NONE'],
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
