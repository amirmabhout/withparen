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
  logger 
} from '@elizaos/core';
import { MemgraphService } from '../services/memgraph.js';
import { connectionExtractionTemplate } from '../utils/promptTemplates.js';

/**
 * Action to create a new HumanConnection with waitlist status
 */
export const createConnectionAction: Action = {
  name: 'CREATE_CONNECTION',
  description: 'Creates a new human connection with waitlist status based on user-provided names and secret',
  similes: [
    'CREATE_HUMAN_CONNECTION',
    'SETUP_CONNECTION',
    'JOIN_WAITLIST',
    'REGISTER_CONNECTION',
    'ADD_CONNECTION'
  ],
  examples: [
    [
      {
        name: '{{name1}}',
        content: {
          text: 'I want to create a connection. My name is Sarah and I want to connect with my partner Mike. Our secret word is "sunset".'
        }
      },
      {
        name: 'Seren',
        content: {
          text: 'Great, please reach out to me on Telegram https://t.me/withseren_bot and we can continue from there.',
          actions: ['CREATE_CONNECTION']
        }
      }
    ],
    [
      {
        name: '{{name1}}',
        content: {
          text: 'Hi, I\'m Alex and I want to set up a connection with Emma. We decided our secret phrase is "morning coffee".'
        }
      },
      {
        name: 'Seren',
        content: {
          text: 'Great, please reach out to me on Telegram https://t.me/withseren_bot and we can continue from there.',
          actions: ['CREATE_CONNECTION']
        }
      }
    ]
  ] as ActionExample[][],
  validate: async (_runtime: IAgentRuntime, message: Memory) => {
    // In serenapp context, this action should always be available
    // since the primary purpose of this app is to create connections
    const messageText = message.content?.text?.trim() || '';
    
    // Only exclude completely empty messages
    return messageText.length > 0;
  },
  handler: async (
    runtime: IAgentRuntime, 
    message: Memory, 
    _state: State | undefined,
    _options: any,
    _callback?: HandlerCallback
  ): Promise<ActionResult> => {
    const memgraphService = new MemgraphService();

    try {
      await memgraphService.connect();

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
        
        return {
          text: 'I had trouble understanding the connection information. Could you please provide your name, your partner\'s name, and your shared secret more clearly?',
          success: false,
          error: e instanceof Error ? e : new Error(String(e))
        };
      }

      // Check if we have all required information
      if (!extractedInfo.userName || !extractedInfo.partnerName || !extractedInfo.secret) {
        logger.info('[createConnection] Missing required information:', {
          userName: !!extractedInfo.userName,
          partnerName: !!extractedInfo.partnerName,
          secret: !!extractedInfo.secret,
          missing: extractedInfo.missing
        });
        
        // Provide feedback about missing information
        const missingItems: string[] = [];
        if (!extractedInfo.userName) missingItems.push('your name');
        if (!extractedInfo.partnerName) missingItems.push('your partner\'s name');
        if (!extractedInfo.secret) missingItems.push('your secret word or phrase');
        
        const missingText = missingItems.length > 1 
          ? missingItems.slice(0, -1).join(', ') + ' and ' + missingItems[missingItems.length - 1]
          : missingItems[0];
        
        return {
          text: `I need a bit more information to create your connection. Could you please provide ${missingText}? For example: "My name is [your name], I want to connect with [partner's name], and our secret word is [secret]".`,
          success: true,
          values: {
            missingInfo: missingItems,
            partialExtraction: extractedInfo
          }
        };
      }

      // Check if connection already exists
      const existingConnection = await memgraphService.findExistingHumanConnection(
        extractedInfo.userName,
        extractedInfo.partnerName,
        extractedInfo.secret
      );

      if (existingConnection) {
        logger.info('[createConnection] Connection already exists:', existingConnection);
        
        return {
          text: `It looks like a connection between ${extractedInfo.userName} and ${extractedInfo.partnerName} with that secret already exists! The status is currently: ${existingConnection.status}.`,
          success: true,
          values: {
            connectionExists: true,
            existingConnection
          }
        };
      }

      // Create new HumanConnection with waitlist status
      const newConnection = await memgraphService.createHumanConnectionWithWaitlist(
        extractedInfo.userName,
        extractedInfo.partnerName,
        extractedInfo.secret
      );

      logger.info('[createConnection] Successfully created new HumanConnection:', newConnection);

      return {
        text: `Perfect! I've created your connection with ${extractedInfo.partnerName} using your secret "${extractedInfo.secret}". Your connection has been added to the waitlist and you'll be notified when it's ready for deeper conversations. Welcome to your Seren journey, ${extractedInfo.userName}!`,
        success: true,
        values: {
          connectionCreated: true,
          userName: extractedInfo.userName,
          partnerName: extractedInfo.partnerName,
          status: 'waitlist'
        },
        data: {
          connection: newConnection
        }
      };

    } catch (error) {
      logger.error('[createConnection] Error creating connection:', error);
      
      return {
        text: 'I encountered an issue while creating your connection. Please try again or contact support if the problem persists.',
        success: false,
        error: error instanceof Error ? error : new Error(String(error))
      };
    } finally {
      await memgraphService.disconnect();
    }
  }
};