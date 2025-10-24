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

import { UserStatusService, UserStatus, MatchStatus } from '../services/userStatusService.js';
import { MemgraphService } from '../services/memgraph.js';
import { getTemplate, TemplateNames } from '../utils/templateLoader.js';

import {
  connectionDiscoveryTemplate as defaultConnectionDiscoveryTemplate,
  compatibilityAnalysisTemplate as defaultCompatibilityAnalysisTemplate,
} from '../utils/promptTemplates.js';

// Interface removed - using ActionResult directly

/**
 * Find Match Action for Discover-Connection
 * Discovers potential connections based on user's passions, challenges, and preferences
 */
export const findMatchAction: Action = {
  name: 'FIND_MATCH',
  description:
    'Discovers potential connections for the user based on their persona and connection preferences. call this action when and only when user clearly stated their intention to find a match.',
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
      // Check user status - only ONBOARDING and ACTIVE users can find matches
      const userStatusService = new UserStatusService(runtime);
      const userStatus = await userStatusService.getUserStatus(message.entityId);

      // Allow findMatch for ONBOARDING and ACTIVE users
      // Reject for MATCHED users (they already have an active match)
      if (userStatus === UserStatus.MATCHED) {
        logger.debug(`[find-match] User ${message.entityId} has MATCHED status, validation failed`);
        return false;
      }

      logger.debug(
        `[find-match] User ${message.entityId} has ${userStatus} status, validation passed`
      );
      return true;
    } catch (error) {
      logger.error(`[discover-connection] Error validating find match action: ${error}`);
      return false;
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
      logger.info(
        `[discover-connection] Starting connection discovery for user ${message.entityId}`
      );

      // Get user's persona and connection memories across all dimension tables
      const personaDimensions = [
        'persona_demographic',
        'persona_characteristic',
        'persona_routine',
        'persona_goal',
        'persona_experience',
        'persona_emotional_state',
      ];

      const connectionDimensions = [
        'connection_who', // WHO: demographics, interaction style, energy match
        'connection_what', // WHAT: activities and relationship type
        'connection_how', // HOW: time commitment and value exchange
      ];

      // Fetch persona memories from all dimensions
      const personaMemoryPromises = personaDimensions.map(async (tableName) => {
        try {
          const memories = await runtime.getMemories({
            roomId: message.roomId,
            tableName,
            count: 10,
          });
          return memories;
        } catch (error) {
          logger.warn(`Failed to get memories from ${tableName}: ${error}`);
          return [];
        }
      });

      // Fetch connection memories from all dimensions
      const connectionMemoryPromises = connectionDimensions.map(async (tableName) => {
        try {
          const memories = await runtime.getMemories({
            roomId: message.roomId,
            tableName,
            count: 10,
          });
          return memories;
        } catch (error) {
          logger.warn(`Failed to get memories from ${tableName}: ${error}`);
          return [];
        }
      });

      const [personaMemoryResults, connectionMemoryResults] = await Promise.all([
        Promise.all(personaMemoryPromises),
        Promise.all(connectionMemoryPromises),
      ]);

      // Flatten and get the most recent 20 memories from each category
      const allPersonaMemories = personaMemoryResults
        .flat()
        .filter((memory, index, self) => index === self.findIndex((t) => t.id === memory.id))
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
        .slice(0, 20);

      const allConnectionMemories = connectionMemoryResults
        .flat()
        .filter((memory, index, self) => index === self.findIndex((t) => t.id === memory.id))
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
        .slice(0, 20);

      const recentMessages = await runtime.getMemories({
        roomId: message.roomId,
        tableName: 'messages',
        count: 10,
      });

      // Format memories for the prompt
      const personaMemoryText = allPersonaMemories.map((m) => m.content.text).join('\n');

      const connectionMemoryText = allConnectionMemories.map((m) => m.content.text).join('\n');

      const recentMessagesText = recentMessages
        .map(
          (m) =>
            `${m.entityId === runtime.agentId ? 'Discover-Connection' : 'User'}: ${m.content.text}`
        )
        .join('\n');

      // Generate persona and connection contexts
      // Get custom or default connection discovery template
      const connectionDiscoveryTemplate = getTemplate(
        runtime,
        TemplateNames.CONNECTION_DISCOVERY,
        defaultConnectionDiscoveryTemplate
      );

      const prompt = connectionDiscoveryTemplate
        .replace('{{personaMemory}}', personaMemoryText || 'No persona information available yet.')
        .replace(
          '{{connectionMemory}}',
          connectionMemoryText || 'No connection preferences available yet.'
        )
        .replace('{{recentMessages}}', recentMessagesText);

      const response = await runtime.useModel(ModelType.TEXT_LARGE, {
        prompt,
      });

      logger.debug(`[discover-connection] Discovery response: ${response}`);

      const parsedResponse = parseKeyValueXml(response);

      if (!parsedResponse) {
        logger.error('[discover-connection] Failed to parse discovery response');
        const fallbackText =
          "I'm analyzing your background and preferences to find great connections. Let me gather a bit more information first. What specific challenges are you facing that you'd like help with?";

        if (callback) {
          await callback({
            text: fallbackText,
            actions: ['REPLY'],
          });

          // Log error message sent to user
          logger.info(
            `[discover-connection] MESSAGE_SENT_TO_USER: User ${message.entityId} received error message: "${fallbackText.substring(0, 100)}${fallbackText.length > 100 ? '...' : ''}"`
          );
        }

        return {
          text: fallbackText,
          success: false,
          error: new Error('Failed to parse discovery response'),
        };
      }

      const personaContext = parsedResponse.personaContext;
      const connectionContext = parsedResponse.connectionContext;

      if (!personaContext || !connectionContext) {
        logger.error('[discover-connection] Missing persona or connection context in response');
        const fallbackText =
          "I need to understand you better before I can find great connections. Can you tell me more about what you're working on and what kind of people would be most helpful to you?";

        if (callback) {
          await callback({
            text: fallbackText,
            actions: ['REPLY'],
          });

          // Log fallback message sent to user
          logger.info(
            `[discover-connection] MESSAGE_SENT_TO_USER: User ${message.entityId} received fallback message: "${fallbackText.substring(0, 100)}${fallbackText.length > 100 ? '...' : ''}"`
          );
        }

        return {
          text: fallbackText,
          success: false,
          error: new Error('Missing persona or connection context'),
        };
      }

      // Replace existing contexts to avoid duplicates in vector search
      // First, delete any existing persona_contexts for this user
      const existingPersonaContexts = await runtime.getMemories({
        tableName: 'persona_contexts',
        entityId: message.entityId,
        roomId: message.roomId,
        count: 100,
      });

      // Delete existing persona contexts to prevent duplicates in search
      for (const existingContext of existingPersonaContexts) {
        if (existingContext.id) {
          await runtime.deleteMemory(existingContext.id);
        }
      }

      // Create new persona context with embedding for vector search
      const personaMemoryWithEmbedding = await runtime.addEmbeddingToMemory({
        entityId: message.entityId,
        agentId: runtime.agentId,
        roomId: message.roomId,
        content: {
          text: personaContext,
          type: 'persona_context',
        },
        createdAt: Date.now(),
      });

      await runtime.createMemory(personaMemoryWithEmbedding, 'persona_contexts', true);

      // Sync persona context to Memgraph as PersonaDimension with name 'profile'
      try {
        const memgraphService = runtime.getService('memgraph') as MemgraphService;
        if (memgraphService && personaMemoryWithEmbedding.embedding) {
          await memgraphService.syncPersonaDimension(
            message.entityId,
            'profile',
            personaContext,
            Array.from(personaMemoryWithEmbedding.embedding),
            {
              extractedFrom: 'connection_discovery',
              sourceAction: 'find_match',
              sourceTemplate: 'connectionDiscoveryTemplate',
            }
          );
          logger.debug(
            `[find-match] Synced personaContext to Memgraph as profile dimension for user ${message.entityId}`
          );
        }
      } catch (memgraphError) {
        logger.error(`[find-match] Failed to sync personaContext to Memgraph: ${memgraphError}`);
        // Continue with normal flow even if Memgraph sync fails
      }

      // Store connection context WITH embeddings for consistency with PersonaDimension
      const connectionMemoryWithEmbedding = await runtime.addEmbeddingToMemory({
        entityId: message.entityId,
        agentId: runtime.agentId,
        roomId: message.roomId,
        content: {
          text: connectionContext,
          type: 'connection_context',
        },
        createdAt: Date.now(),
      });

      await runtime.createMemory(connectionMemoryWithEmbedding, 'connection_contexts');

      // Sync connection context to Memgraph as DesiredDimension with name 'profile'
      try {
        const memgraphService = runtime.getService('memgraph') as MemgraphService;
        if (memgraphService && connectionMemoryWithEmbedding.embedding) {
          await memgraphService.syncDesiredDimension(
            message.entityId,
            'profile',
            connectionContext,
            Array.from(connectionMemoryWithEmbedding.embedding), // Now using actual embeddings
            {
              extractedFrom: 'connection_discovery',
              sourceAction: 'find_match',
              sourceTemplate: 'connectionDiscoveryTemplate',
            }
          );
          logger.debug(
            `[find-match] Synced connectionContext to Memgraph as profile dimension with embeddings for user ${message.entityId}`
          );
        }
      } catch (memgraphError) {
        logger.error(`[find-match] Failed to sync connectionContext to Memgraph: ${memgraphError}`);
        // Continue with normal flow even if Memgraph sync fails
      }

      // Check for existing matches from Memgraph to avoid duplicates
      const memgraphService = runtime.getService('memgraph') as MemgraphService;
      if (!memgraphService) {
        const errorText =
          'Match discovery service is currently unavailable. Please try again later.';
        if (callback) {
          await callback({
            text: errorText,
            actions: ['REPLY'],
          });
        }
        return {
          text: errorText,
          success: false,
          error: new Error('Memgraph service not available'),
        };
      }

      const existingMatches = await memgraphService.getAllMatches(message.entityId);

      // Filter out users that have already been matched with this user
      const matchedUserIds = new Set<UUID>();
      existingMatches.forEach((match) => {
        const otherUserId = match.from === message.entityId ? match.to : match.from;
        matchedUserIds.add(otherUserId);
      });

      logger.info(
        `[discover-connection] Found ${matchedUserIds.size} existing matches for user ${message.entityId}`
      );

      // Get all ACTIVE users first - only active users can be matched
      const userStatusService = new UserStatusService(runtime);
      const allActiveUserIds = await userStatusService.getUsersByStatus(UserStatus.ACTIVE, 200);
      const activeUserIds = new Set(allActiveUserIds);

      logger.info(
        `[discover-connection] Found ${activeUserIds.size} active users for matching pool`
      );

      // Check requesting user's active status early to handle no-match scenarios appropriately
      const requestingUserStatus = await userStatusService.getUserStatus(message.entityId);
      const isUserActive = requestingUserStatus === UserStatus.ACTIVE;

      logger.info(
        `[discover-connection] DEBUG - FIND_MATCH User ${message.entityId} active status: ${isUserActive} (status: ${requestingUserStatus})`
      );

      // Check available data for connection discovery
      const allPersonaContexts = await runtime.getMemories({
        tableName: 'persona_contexts',
        count: 100,
      });

      logger.info(
        `[discover-connection] Starting connection discovery with ${allPersonaContexts.length} total persona contexts, filtering to ACTIVE users only`
      );

      // Perform vector similarity search for potential matches
      let potentialMatches: Memory[] = [];
      try {
        logger.debug(`[discover-connection] Generating embedding for similarity search...`);

        // Generate embedding from connection context for similarity search
        const embedding = await runtime.useModel(ModelType.TEXT_EMBEDDING, {
          text: connectionContext,
        });

        logger.debug(`[discover-connection] Searching for compatible connections...`);

        // Try Memgraph vector search first if available
        const memgraphService = runtime.getService('memgraph') as MemgraphService;
        let useMemgraphSearch = false;

        if (memgraphService && memgraphService['isConnected']) {
          try {
            logger.debug(`[discover-connection] Using Memgraph vector search...`);
            const vectorResults = await memgraphService.vectorSearchSimilarPersonas(
              Array.from(embedding),
              10,
              [message.entityId, ...Array.from(matchedUserIds)],
              activeUserIds,
              runtime.agentId
            );

            // Convert Memgraph results to Memory format for compatibility with rest of flow
            potentialMatches = vectorResults.map((result) => {
              const memory: Memory = {
                id: result.entityId, // Use entityId as memory ID for this context
                entityId: result.entityId,
                agentId: runtime.agentId,
                roomId: message.roomId,
                content: {
                  text: result.personaContext,
                  type: 'persona_context',
                },
                createdAt: Date.now(),
              };
              return memory;
            });

            useMemgraphSearch = true;
            logger.info(
              `[discover-connection] Memgraph vector search found ${potentialMatches.length} potential matches`
            );
          } catch (memgraphError) {
            logger.warn(
              `[discover-connection] Memgraph vector search failed, falling back to SQL: ${memgraphError}`
            );
          }
        }

        // Fallback to SQL-based search if Memgraph not available or failed
        if (!useMemgraphSearch) {
          logger.debug(`[discover-connection] Using SQL-based vector search...`);
          potentialMatches = await runtime.searchMemories({
            embedding,
            tableName: 'persona_contexts',
            count: 10,
            match_threshold: 0.4, // Reasonable threshold for good matches
          });

          // Filter out the requesting user, already matched users, and non-active users from potential matches
          potentialMatches = potentialMatches.filter(
            (match) =>
              match.entityId !== message.entityId &&
              !matchedUserIds.has(match.entityId) &&
              activeUserIds.has(match.entityId)
          );

          logger.info(
            `[discover-connection] SQL vector search found ${potentialMatches.length} potential matches (excluding self, existing matches, and non-active users)`
          );
        }
      } catch (error) {
        logger.warn(`[discover-connection] Vector search failed: ${error}`);
        // Continue with empty matches
      }

      if (potentialMatches.length === 0) {
        let noMatchText: string;

        if (!isUserActive) {
          // No matches found, but user is now active
          noMatchText =
            activeUserIds.size === 0
              ? "There aren't any available matches in my network right now. You're now active and will be notified as soon as someone who matches your profile joins!"
              : "I couldn't find a compatible match among current members right now, but you're now active and I'll keep checking as more people join. I'll notify you when I find a suitable connection!";

          // Transition user to ACTIVE status
          try {
            const userStatusService = new UserStatusService(runtime);
            await userStatusService.transitionUserStatus(message.entityId, UserStatus.ACTIVE);
            logger.info(
              `[discover-connection] DEBUG - FIND_MATCH Transitioned user ${message.entityId} to ACTIVE status (no matches found)`
            );
          } catch (error) {
            logger.error(
              `[discover-connection] Failed to transition user status for ${message.entityId}: ${error}`
            );
            // Continue anyway - don't break the user flow
          }
        } else {
          // For existing active users: standard no-match message
          noMatchText =
            activeUserIds.size <= 1
              ? "There aren't any other active users available for matching right now. Encourage others to complete their onboarding to expand the matching pool!"
              : "I couldn't find a compatible match among the current active users, but I'll keep checking as more people join. I'll notify you when I find a suitable connection!";
        }

        if (callback) {
          await callback({
            text: noMatchText,
            actions: ['REPLY'],
          });

          // Log no match message sent to user with active status info
          logger.info(
            `[discover-connection] MESSAGE_SENT_TO_USER: User ${message.entityId} (active: ${isUserActive}) received no match message: "${noMatchText.substring(0, 100)}${noMatchText.length > 100 ? '...' : ''}"`
          );
        }

        return {
          text: noMatchText,
          success: true,
          values: {
            personaContext,
            connectionContext,
            matchScore: 0,
            reasoning: isUserActive
              ? 'No potential matches found among active users - need more active users'
              : 'No matches found - user needs to complete onboarding',
            isUserActive,
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

          return `Match Option ${index + 1}:
ID: ${match.entityId}
Persona: ${match.content.text}
Looking for: ${matchConnectionContext.length > 0 ? matchConnectionContext[0].content.text : 'Not specified'}`;
        })
      );

      // Analyze compatibility with all candidates in one prompt
      // Get custom or default compatibility analysis template
      const compatibilityAnalysisTemplate = getTemplate(
        runtime,
        TemplateNames.COMPATIBILITY_ANALYSIS,
        defaultCompatibilityAnalysisTemplate
      );

      const compatibilityPrompt = compatibilityAnalysisTemplate
        .replace('{{userPersonaContext}}', personaContext)
        .replace('{{userConnectionContext}}', connectionContext)
        .replace('{{candidateProfiles}}', candidateProfiles.join('\n\n'));

      const compatibilityResponse = await runtime.useModel(ModelType.TEXT_LARGE, {
        prompt: compatibilityPrompt,
      });

      const compatibilityParsed = parseKeyValueXml(compatibilityResponse);

      if (!compatibilityParsed) {
        logger.error('[discover-connection] Failed to parse compatibility response');
        const errorText =
          "I found some potential matches but had trouble analyzing compatibility. Let me try a different approach. What's the most important thing you're looking for in a connection right now?";

        if (callback) {
          await callback({
            text: errorText,
            actions: ['REPLY'],
          });

          // Log compatibility error message sent to user
          logger.info(
            `[discover-connection] MESSAGE_SENT_TO_USER: User ${message.entityId} received compatibility error: "${errorText.substring(0, 100)}${errorText.length > 100 ? '...' : ''}"`
          );
        }

        return {
          text: errorText,
          success: false,
          error: new Error('Failed to parse compatibility response'),
        };
      }

      const bestMatch = compatibilityParsed.bestMatch;
      const compatibilityScorePlusReasoning =
        compatibilityParsed.compatibilityScorePlusReasoning || '';
      const responseText =
        compatibilityParsed.text || 'I analyzed your profile for potential matches.';

      // Extract compatibility score from the combined field (expecting format like "85 - explanation...")
      const scoreMatch = compatibilityScorePlusReasoning.match(/^(\d+)/);
      const compatibilityScore = scoreMatch ? parseInt(scoreMatch[1]) : 0;

      logger.info(
        `[discover-connection] Connection analysis complete. ${bestMatch !== 'none' ? `Found compatible match with score: ${compatibilityScore}` : 'No suitable matches found'}`
      );

      // Generate additional membership message if needed for non-group members with matches
      let finalResponseText = responseText;

      if (bestMatch && bestMatch !== 'none') {
        // User found a match, no additional membership messages needed
        if (!isUserActive) {
          // User not active yet - just use the basic response
        }
      }

      // Check for existing matches to prevent duplicates
      if (bestMatch && bestMatch !== 'none') {
        const matchedUserId = bestMatch as UUID;

        // Use Memgraph for duplicate check (already verified service is available above)
        const duplicateMatch = await memgraphService.hasExistingMatch(
          message.entityId,
          matchedUserId
        );

        logger.info(
          `[discover-connection] DEBUG - FIND_MATCH Memgraph duplicate check: ${duplicateMatch ? 'FOUND existing match' : 'No existing match'} between ${message.entityId} and ${matchedUserId}`
        );

        if (!duplicateMatch) {
          // Set match status - all new matches start with MATCH_FOUND
          const matchStatus = MatchStatus.MATCH_FOUND;

          logger.info(
            `[discover-connection] DEBUG - FIND_MATCH MATCH STATUS: User ${message.entityId} matched with ${matchedUserId}, setting status: "${matchStatus}"`
          );

          // Create match in Memgraph (ONLY source of truth for match data)
          await memgraphService.syncMatch(
            message.entityId,
            matchedUserId,
            compatibilityScorePlusReasoning,
            matchStatus,
            runtime.agentId,
            undefined // No venue context for now
          );

          logger.info(
            `[discover-connection] Created match in Memgraph: ${message.entityId} -> ${matchedUserId} status="${matchStatus}"`
          );

          // Both users are now set to MATCHED status by syncMatch() call above
          logger.info(
            `[discover-connection] Both users ${message.entityId} and ${matchedUserId} set to MATCHED status`
          );
        } else {
          logger.info(
            `[discover-connection] Match already exists between ${message.entityId} and ${matchedUserId}, skipping duplicate creation`
          );
        }
      }

      if (callback) {
        await callback({
          text: finalResponseText,
          actions: ['REPLY'],
        });

        // Log match result sent to user
        logger.info(
          `[discover-connection] MESSAGE_SENT_TO_USER: User ${message.entityId} received match result: "${finalResponseText.substring(0, 100)}${finalResponseText.length > 100 ? '...' : ''}"`
        );
      }

      return {
        text: finalResponseText,
        success: true,
        values: {
          personaContext,
          connectionContext,
          matchedUserId: bestMatch && bestMatch !== 'none' ? (bestMatch as UUID) : undefined,
          matchScore: compatibilityScore,
          reasoning: compatibilityScorePlusReasoning,
        },
      };
    } catch (error) {
      logger.error(`[discover-connection] Error in connection discovery: ${error}`);

      const errorText =
        "I encountered an issue while searching for connections. Let me help you in a different way - what's one specific type of person you'd most like to connect with right now?";

      if (callback) {
        await callback({
          text: errorText,
          actions: ['REPLY'],
        });

        // Log error message sent to user
        logger.info(
          `[discover-connection] MESSAGE_SENT_TO_USER: User ${message.entityId} received error: "${errorText.substring(0, 100)}${errorText.length > 100 ? '...' : ''}"`
        );
      }

      return {
        text: errorText,
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  },
};
