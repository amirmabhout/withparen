import {
  type IAgentRuntime,
  type Memory,
  type State,
  type Action,
  ModelType,
  parseKeyValueXml,
  logger
} from '@elizaos/core';
import { MemgraphService } from '../services/memgraph.js';
import { connectionExtractionTemplate } from '../utils/promptTemplates.js';

export const createConnectionAction: Action = {
  name: 'CREATE_CONNECTION',
  description: 'Creates a new HumanConnection node in the database with waitlist status',
  similes: [
    'CREATE_HUMAN_CONNECTION',
    'MAKE_CONNECTION',
    'ESTABLISH_CONNECTION',
    'REGISTER_CONNECTION',
    'SETUP_CONNECTION'
  ],
  examples: [
    [
      {
        name: '{{user1}}',
        content: {
          text: 'My name is Sarah and I want to connect with my partner Mike. Our secret word is "sunset".',
        },
      },
      {
        name: '{{agentName}}',
        content: {
          text: 'Perfect! I\'ve created your connection with Mike using your secret word "sunset". Your connection is now on the waitlist and will be activated soon.',
          action: 'CREATE_CONNECTION',
        },
      },
    ],
    [
      {
        name: '{{user1}}',
        content: {
          text: 'I\'m John and my girlfriend is Emma. We chose "starlight" as our secret phrase.',
        },
      },
      {
        name: '{{agentName}}',
        content: {
          text: 'Wonderful! I\'ve set up your connection with Emma using "starlight" as your secret phrase. Your connection is now registered and on the waitlist.',
          action: 'CREATE_CONNECTION',
        },
      },
    ],
  ],
  validate: async (_runtime: IAgentRuntime, message: Memory) => {
    // Check if user has provided connection information
    const text = message.content.text?.toLowerCase() || '';

    // Look for indicators that user wants to create a connection
    const hasConnectionIntent =
      text.includes('connect') ||
      text.includes('my name is') ||
      text.includes('secret') ||
      text.includes('partner') ||
      text.includes('girlfriend') ||
      text.includes('boyfriend') ||
      text.includes('husband') ||
      text.includes('wife');

    return hasConnectionIntent;
  },
  handler: async (runtime: IAgentRuntime, message: Memory, _state?: State): Promise<void> => {
    try {
      logger.info('[createConnection] Starting connection creation process');

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
      const extractionPrompt = connectionExtractionTemplate
        .replace('{{recentMessages}}', formattedMessages);

      // Use LLM to extract connection info
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
        logger.debug('[createConnection] Successfully extracted connection info:', extractedInfo);
      } catch (e) {
        logger.error('[createConnection] Failed to parse connection extraction response:', e);
        return false;
      }

      // Check if we have all required information
      if (!extractedInfo.userName || !extractedInfo.partnerName || !extractedInfo.secret) {
        logger.info('[createConnection] Missing required information:', {
          userName: !!extractedInfo.userName,
          partnerName: !!extractedInfo.partnerName,
          secret: !!extractedInfo.secret,
          missing: extractedInfo.missing
        });

        // Provide feedback about what's missing
        const missingItems: string[] = [];
        if (!extractedInfo.userName) missingItems.push('your name');
        if (!extractedInfo.partnerName) missingItems.push('your partner\'s name');
        if (!extractedInfo.secret) missingItems.push('your secret word or phrase');

        const responseText = `I need a bit more information to create your connection. Please provide: ${missingItems.join(', ')}.`;

        await runtime.createMemory({
          id: runtime.agentId,
          entityId: runtime.agentId,
          agentId: runtime.agentId,
          content: {
            text: responseText,
            action: 'CREATE_CONNECTION',
          },
          roomId: message.roomId,
          createdAt: Date.now(),
        });

        return true;
      }

      // Initialize Memgraph service
      const memgraphService = new MemgraphService();
      await memgraphService.connect();

      try {
        // Check if connection already exists
        const existingConnection = await memgraphService.findExistingHumanConnection(
          extractedInfo.userName,
          extractedInfo.partnerName,
          extractedInfo.secret
        );

        if (existingConnection) {
          logger.info('[createConnection] Connection already exists:', existingConnection);

          const responseText = `It looks like a connection between ${extractedInfo.userName} and ${extractedInfo.partnerName} with that secret already exists. Your connection status is: ${existingConnection.status}.`;

          await runtime.createMemory({
            id: runtime.agentId,
            entityId: runtime.agentId,
            agentId: runtime.agentId,
            content: {
              text: responseText,
              action: 'CREATE_CONNECTION',
            },
            roomId: message.roomId,
            createdAt: Date.now(),
          });

          return true;
        }

        // Create new HumanConnection with waitlist status
        const newConnection = await memgraphService.createHumanConnectionWithWaitlist(
          extractedInfo.userName,
          extractedInfo.partnerName,
          extractedInfo.secret
        );

        logger.info('[createConnection] Successfully created new connection:', newConnection);

        // Send confirmation message
        const responseText = `Perfect! I've created your connection with ${extractedInfo.partnerName} using your secret "${extractedInfo.secret}". Your connection is now on the waitlist and will be activated soon. You'll both be able to start your deeper conversations once everything is ready!`;

        await runtime.createMemory({
          id: runtime.agentId,
          entityId: runtime.agentId,
          agentId: runtime.agentId,
          content: {
            text: responseText,
            action: 'CREATE_CONNECTION',
          },
          roomId: message.roomId,
          createdAt: Date.now(),
        });

        return true;

      } finally {
        await memgraphService.disconnect();
      }

    } catch (error) {
      logger.error('[createConnection] Error in connection creation:', error);

      // Send error message to user
      const errorText = 'I encountered an issue while creating your connection. Please try again or contact support if the problem persists.';

      await runtime.createMemory({
        id: runtime.agentId,
        entityId: runtime.agentId,
        agentId: runtime.agentId,
        content: {
          text: errorText,
          action: 'CREATE_CONNECTION',
        },
        roomId: message.roomId,
        createdAt: Date.now(),
      });

      return false;
    }
  },
};