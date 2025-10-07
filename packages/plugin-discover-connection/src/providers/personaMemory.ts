import { type IAgentRuntime, Memory, ModelType, Provider, State } from '@elizaos/core';
import { logger } from '@elizaos/core';
import { MemgraphService } from '../services/memgraph.js';

/**
 * Formats an array of persona memories into a single string with each memory content text separated by a new line.
 */
function formatPersonaMemories(personaMemories: Memory[]): string {
  return personaMemories
    .reverse()
    .map((memory: Memory) => memory.content.text)
    .join('\n');
}

/**
 * Provider for fetching persona insights using the PEACOCK framework.
 * Retrieves relevant persona memories from various dimensions: demographic, characteristic, routine, goal, experience, emotional_state.
 */
const personaMemoryProvider: Provider = {
  name: 'PERSONA_MEMORY',
  description:
    'Persona insights about the user using PEACOCK framework (Demographics, Characteristics, Routines, Goals, Experiences, Emotional States)',
  position: 3,
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

      // Get Memgraph service - REQUIRED for persona dimension queries
      const memgraphService = runtime.getService('memgraph') as MemgraphService;
      if (!memgraphService || !memgraphService['isConnected']) {
        logger.error(`[personaMemory] Memgraph service not available for user ${message.entityId}`);
        return {
          values: {
            personaMemory: '',
          },
          data: {
            personaMemory: [],
          },
          text: 'Persona insights service temporarily unavailable.',
        };
      }

      let allPersonaMemories: Memory[] = [];

      try {
        logger.debug(`[personaMemory] Using Memgraph vector search for user ${message.entityId}`);
        const vectorResults = await memgraphService.vectorSearchPersonaDimensions(
          Array.from(embedding),
          message.entityId,
          15 // Get top 15 most relevant
        );

        // Convert Memgraph results to Memory format for compatibility
        allPersonaMemories = vectorResults.map((result) => {
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
          `[personaMemory] Memgraph search found ${allPersonaMemories.length} persona insights`
        );
      } catch (error) {
        logger.error(`[personaMemory] Memgraph vector search failed: ${error}`);
        return {
          values: {
            personaMemory: '',
          },
          data: {
            personaMemory: [],
          },
          text: 'Error retrieving persona insights.',
        };
      }

      if (allPersonaMemories.length === 0) {
        return {
          values: {
            personaMemory: '',
          },
          data: {
            personaMemory: allPersonaMemories,
          },
          text: 'No persona insights available.',
        };
      }

      const formattedPersonaMemories = formatPersonaMemories(allPersonaMemories);

      const text =
        '# Persona insights that {{agentName}} has learned:\n{{formattedPersonaMemories}}'
          .replace('{{agentName}}', runtime.character.name || '')
          .replace('{{formattedPersonaMemories}}', formattedPersonaMemories);

      return {
        values: {
          personaMemory: formattedPersonaMemories,
        },
        data: {
          personaMemory: allPersonaMemories,
        },
        text,
      };
    } catch (error) {
      logger.error(`Error in personaMemoryProvider: ${error}`);
      return {
        values: {
          personaMemory: '',
        },
        data: {
          personaMemory: [],
        },
        text: 'Error retrieving persona insights.',
      };
    }
  },
};

export { personaMemoryProvider, formatPersonaMemories };
