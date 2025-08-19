import {
  type IAgentRuntime,
  type Memory,
  type Action,
  type State,
  type ActionExample,
  type HandlerCallback,
  type ActionResult,
  logger,
  ModelType,
  parseKeyValueXml,
  type UUID,
} from '@elizaos/core';

import { connectionDiscoveryTemplate, compatibilityAnalysisTemplate } from '../utils/promptTemplates.js';

// Interface removed - using ActionResult directly

/**
 * Connection Discovery Action for Quinn
 * Discovers potential connections based on user's passions, challenges, and preferences
 */
export const createConnectionAction: Action = {
  name: 'CREATE_CONNECTION',
  description: 'Discovers potential connections for the user based on their persona and connection preferences',
  similes: [
    'DISCOVER_CONNECTION',
    'FIND_CONNECTION',
    'MATCH_CONNECTION',
    'SEARCH_CONNECTION',
    'FIND_MATCH',
  ],
  examples: [] as ActionExample[][],
  
  validate: async (runtime: IAgentRuntime, message: Memory): Promise<boolean> => {
    try {
      // Check if user has completed onboarding and has persona/connection data
      const personaMemories = await runtime.getMemories({
        roomId: message.roomId,
        tableName: 'persona_memories',
        count: 5,
      });

      const connectionMemories = await runtime.getMemories({
        roomId: message.roomId,
        tableName: 'connection_memories',
        count: 5,
      });

      return personaMemories.length > 0 || connectionMemories.length > 0;
    } catch (error) {
      logger.error(`[quinn] Error validating create connection action: ${error}`);
      return true; // Allow action to proceed even if validation fails
    }
  },
  
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options: any,
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    try {
      logger.info(`[quinn] Starting connection discovery for user ${message.entityId}`);

      // Get user's persona and connection memories
      const personaMemories = await runtime.getMemories({
        roomId: message.roomId,
        tableName: 'persona_memories',
        count: 10,
      });

      const connectionMemories = await runtime.getMemories({
        roomId: message.roomId,
        tableName: 'connection_memories',
        count: 10,
      });

      const recentMessages = await runtime.getMemories({
        roomId: message.roomId,
        tableName: 'messages',
        count: 10,
      });

      // Format memories for the prompt
      const personaMemoryText = personaMemories
        .map(m => m.content.text)
        .join('\n');
      
      const connectionMemoryText = connectionMemories
        .map(m => m.content.text)
        .join('\n');

      const recentMessagesText = recentMessages
        .map(m => `${m.entityId === runtime.agentId ? 'Quinn' : 'User'}: ${m.content.text}`)
        .join('\n');

      // Generate persona and connection contexts
      const prompt = connectionDiscoveryTemplate
        .replace('{{personaMemory}}', personaMemoryText || 'No persona information available yet.')
        .replace('{{connectionMemory}}', connectionMemoryText || 'No connection preferences available yet.')
        .replace('{{recentMessages}}', recentMessagesText);

      const response = await runtime.useModel(ModelType.TEXT_LARGE, {
        prompt,
      });

      logger.debug(`[quinn] Discovery response: ${response}`);

      const parsedResponse = parseKeyValueXml(response);
      
      if (!parsedResponse) {
        logger.error('[quinn] Failed to parse discovery response');
        const fallbackText = "I'm analyzing your background and preferences to find great connections. Let me gather a bit more information first. What specific challenges are you facing that you'd like help with?";
        
        if (callback) {
          await callback({
            text: fallbackText,
            thought: 'Failed to parse discovery response, asking for more info',
            actions: ['REPLY']
          });
        }

        return {
          text: fallbackText,
          success: false,
          error: new Error('Failed to parse discovery response')
        };
      }

      const personaContext = parsedResponse.personaContext;
      const connectionContext = parsedResponse.connectionContext;
      
      if (!personaContext || !connectionContext) {
        logger.error('[quinn] Missing persona or connection context in response');
        const fallbackText = "I need to understand you better before I can find great connections. Can you tell me more about what you're working on and what kind of people would be most helpful to you?";
        
        if (callback) {
          await callback({
            text: fallbackText,
            thought: 'Missing context information, asking for more details',
            actions: ['REPLY']
          });
        }

        return {
          text: fallbackText,
          success: false,
          error: new Error('Missing persona or connection context')
        };
      }

      // Store the generated contexts for future use
      await runtime.createMemory({
        entityId: message.entityId,
        agentId: runtime.agentId,
        roomId: message.roomId,
        content: {
          text: personaContext,
          type: 'persona_context',
        },
        createdAt: Date.now(),
      }, 'persona_contexts');

      await runtime.createMemory({
        entityId: message.entityId,
        agentId: runtime.agentId,
        roomId: message.roomId,
        content: {
          text: connectionContext,
          type: 'connection_context',
        },
        createdAt: Date.now(),
      }, 'connection_contexts');

      // Perform vector similarity search for potential matches
      const potentialMatches = await runtime.searchMemories({
        embedding: [], // Will be generated from connectionContext
        tableName: 'persona_contexts',
        count: 10,
        match_threshold: 0.6,
      });

      logger.debug(`[quinn] Found ${potentialMatches.length} potential matches`);

      if (potentialMatches.length === 0) {
        const noMatchText = "I've analyzed your profile and preferences, but I don't have enough other users in the system yet to find great matches. As more people join Quinn, I'll be able to find perfect connections for you!";
        
        if (callback) {
          await callback({
            text: noMatchText,
            thought: 'No potential matches found in database yet',
            actions: ['REPLY']
          });
        }

        return {
          text: noMatchText,
          success: true,
          values: {
            personaContext,
            connectionContext,
            matchScore: 0,
            reasoning: 'No potential matches found - need more users in the system',
          },
        };
      }

      // Get connection contexts for all potential matches for mutual compatibility check
      const candidateProfiles = await Promise.all(
        potentialMatches.slice(0, 10).map(async (match, index) => {
          const matchConnectionContext = await runtime.getMemories({
            entityId: match.entityId,
            tableName: 'connection_contexts',
            count: 1,
          });

          return `Candidate ${index + 1} (ID: ${match.entityId}):
Persona: ${match.content.text}
Looking for: ${matchConnectionContext.length > 0 ? matchConnectionContext[0].content.text : 'Not specified'}`;
        })
      );

      // Analyze compatibility with all candidates in one prompt
      const compatibilityPrompt = compatibilityAnalysisTemplate
        .replace('{{userPersonaContext}}', personaContext)
        .replace('{{userConnectionContext}}', connectionContext)
        .replace('{{candidateProfiles}}', candidateProfiles.join('\n\n'));

      const compatibilityResponse = await runtime.useModel(ModelType.TEXT_LARGE, {
        prompt: compatibilityPrompt,
      });

      const compatibilityParsed = parseKeyValueXml(compatibilityResponse);
      
      if (!compatibilityParsed) {
        logger.error('[quinn] Failed to parse compatibility response');
        const errorText = "I found some potential matches but had trouble analyzing compatibility. Let me try a different approach. What's the most important thing you're looking for in a connection right now?";
        
        if (callback) {
          await callback({
            text: errorText,
            thought: 'Failed to parse compatibility analysis',
            actions: ['REPLY']
          });
        }

        return {
          text: errorText,
          success: false,
          error: new Error('Failed to parse compatibility response')
        };
      }

      const bestMatch = compatibilityParsed.bestMatch;
      const compatibilityScore = parseInt(compatibilityParsed.compatibilityScore || '0');
      const reasoning = compatibilityParsed.reasoning || '';
      const recommendation = compatibilityParsed.recommendation || '';

      logger.info(`[quinn] Match analysis complete. Best match: ${bestMatch}, Score: ${compatibilityScore}`);

      if (bestMatch && bestMatch !== 'none' && compatibilityScore >= 70 && recommendation.toLowerCase().includes('yes')) {
        const successText = `Great news! I found a highly compatible match for you. Based on your interests in ${personaContext.split('.')[0].toLowerCase()} and your need for ${connectionContext.split('.')[0].toLowerCase()}, I've identified someone who could be a perfect connection.

${reasoning}

Would you like me to facilitate an introduction?`;

        if (callback) {
          await callback({
            text: successText,
            thought: 'Found a great match, offering to facilitate introduction',
            actions: ['REPLY']
          });
        }

        return {
          text: successText,
          success: true,
          values: {
            personaContext,
            connectionContext,
            matchedUserId: bestMatch as UUID,
            matchScore: compatibilityScore,
            reasoning: reasoning,
          },
        };
      } else {
        const partialMatchText = `I've analyzed your profile and found some potential connections, but none that meet my high standards for mutual compatibility yet. 

${reasoning}

I'll keep your profile active and notify you when better matches join the platform. In the meantime, is there anything specific about your connection preferences you'd like to refine?`;

        if (callback) {
          await callback({
            text: partialMatchText,
            thought: 'Found potential matches but none meet high compatibility threshold',
            actions: ['REPLY']
          });
        }

        return {
          text: partialMatchText,
          success: true,
          values: {
            personaContext,
            connectionContext,
            matchScore: compatibilityScore,
            reasoning: reasoning,
          },
        };
      }

    } catch (error) {
      logger.error(`[quinn] Error in connection discovery: ${error}`);
      
      const errorText = "I encountered an issue while searching for connections. Let me help you in a different way - what's one specific type of person you'd most like to connect with right now?";
      
      if (callback) {
        await callback({
          text: errorText,
          thought: 'Error in connection discovery, asking for clarification',
          actions: ['REPLY']
        });
      }

      return {
        text: errorText,
        success: false,
        error: error instanceof Error ? error : new Error(String(error))
      };
    }
  }
};