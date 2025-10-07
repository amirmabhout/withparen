import { type IAgentRuntime, Memory, ModelType, Provider, State } from '@elizaos/core';
import { logger } from '@elizaos/core';
import { MemgraphService } from '../services/memgraph.js';

/**
 * Formats an array of connection memories into a single string with each memory content text separated by a new line.
 */
function formatConnectionMemories(connectionMemories: Memory[]): string {
  return connectionMemories
    .reverse()
    .map((memory: Memory) => memory.content.text)
    .join('\n');
}

/**
 * Provider for fetching connection discovery insights.
 * Retrieves relevant connection memories from consolidated dimensions: who, what, how.
 */
const connectionMemoryProvider: Provider = {
  name: 'CONNECTION_MEMORY',
  description:
    'Insights about connection preferences - WHO they want to connect with, WHAT they want to do together, and HOW the connection works',
  position: 2,
  dynamic: true,
  get: async (runtime: IAgentRuntime, message: Memory, _state?: State) => {
    try {
      // Get recent messages for context
      const recentMessages = await runtime.getMemories({
        tableName: 'messages',
        roomId: message.roomId,
        count: 10,
        unique: false,
      });

      // Join the text of the last 5 messages for embedding
      const last5Messages = recentMessages
        .slice(-5)
        .map((message) => message.content.text)
        .join('\n');

      const embedding = await runtime.useModel(ModelType.TEXT_EMBEDDING, {
        text: last5Messages,
      });

      // Get Memgraph service - REQUIRED for connection dimension queries
      const memgraphService = runtime.getService('memgraph') as MemgraphService;
      if (!memgraphService || !memgraphService['isConnected']) {
        logger.error(
          `[connectionMemory] Memgraph service not available for user ${message.entityId}`
        );
        return {
          values: {
            connectionMemory: '',
          },
          data: {
            connectionMemory: [],
          },
          text: 'Connection insights service temporarily unavailable.',
        };
      }

      let allConnectionMemories: Memory[] = [];

      try {
        logger.debug(
          `[connectionMemory] Using Memgraph vector search for user ${message.entityId}`
        );
        const vectorResults = await memgraphService.vectorSearchDesiredDimensions(
          Array.from(embedding),
          message.entityId,
          12 // Get top 12 most relevant
        );

        // Convert Memgraph results to Memory format for compatibility
        allConnectionMemories = vectorResults.map((result) => {
          const memory: Memory = {
            id: crypto.randomUUID() as any,
            entityId: message.entityId,
            agentId: message.agentId,
            content: { text: result.value },
            roomId: message.roomId,
            createdAt: Date.now(),
          };
          return memory;
        });

        logger.debug(
          `[connectionMemory] Memgraph search found ${allConnectionMemories.length} connection insights`
        );
      } catch (error) {
        logger.error(`[connectionMemory] Memgraph vector search failed: ${error}`);
        return {
          values: {
            connectionMemory: '',
          },
          data: {
            connectionMemory: [],
          },
          text: 'Error retrieving connection insights.',
        };
      }

      if (allConnectionMemories.length === 0) {
        return {
          values: {
            connectionMemory: '',
          },
          data: {
            connectionMemory: allConnectionMemories,
          },
          text: 'No connection insights available.',
        };
      }

      const formattedConnectionMemories = formatConnectionMemories(allConnectionMemories);

      // Create generic headline since we don't have MemgraphService in plugin-serenapp
      const headline = `# Human connection insights that ${runtime.character.name || 'the agent'} has learned:`;

      const text = `${headline}\n${formattedConnectionMemories}`;

      return {
        values: {
          connectionMemory: formattedConnectionMemories,
        },
        data: {
          connectionMemory: allConnectionMemories,
        },
        text,
      };
    } catch (error) {
      logger.error(`Error in connectionMemoryProvider: ${error}`);
      return {
        values: {
          connectionMemory: '',
        },
        data: {
          connectionMemory: [],
        },
        text: 'Error retrieving connection insights.',
      };
    }
  },
};

export { connectionMemoryProvider, formatConnectionMemories };
