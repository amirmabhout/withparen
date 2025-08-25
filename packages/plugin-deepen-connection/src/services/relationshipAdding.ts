import { logger, Service, type IAgentRuntime, type UUID, ModelType } from '@elizaos/core';
import { MemgraphService } from './memgraph.js';
import { relationshipProfilingTemplate } from '../utils/promptTemplates.js';

/**
 * RelationshipAddingService class for syncing Memgraph connections to SQL relationships table
 */
export class RelationshipAddingService extends Service {
  static serviceType = 'relationship-adding' as const;
  capabilityDescription =
    'Syncs active human connections from Memgraph to the SQL relationships table';

  private readonly SYNC_INTERVAL_HOURS = 6; // Sync every 6 hours
  private readonly SYNC_MINUTE_WINDOW = 30; // 30-minute window for execution
  private lastSyncDate: string | null = null;
  private memgraphService: MemgraphService;

  constructor(runtime: IAgentRuntime) {
    super(runtime);
    this.memgraphService = new MemgraphService();
  }

  /**
   * Start the RelationshipAddingService with the given runtime.
   * @param {IAgentRuntime} runtime - The runtime for the RelationshipAddingService.
   * @returns {Promise<Service>} A promise that resolves with the RelationshipAddingService instance.
   */
  static async start(runtime: IAgentRuntime): Promise<Service> {
    const service = new RelationshipAddingService(runtime);
    await service.registerRelationshipSyncTask();
    return service;
  }

  /**
   * Register the relationship sync task worker
   */
  async registerRelationshipSyncTask() {
    // Register the main relationship sync task worker
    this.runtime.registerTaskWorker({
      name: 'RELATIONSHIP_SYNC',
      validate: async (_runtime, _message, _state) => {
        const now = new Date();
        const hour = now.getHours();
        const minute = now.getMinutes();
        const today = now.toISOString().split('T')[0]; // YYYY-MM-DD format

        // Check if it's been 6 hours since last sync
        const shouldSync = this.shouldSyncRelationships(now);

        if (shouldSync && this.lastSyncDate !== today) {
          logger.debug(
            '[Deepen-Connection] Relationship sync validation: It is sync time and sync not done recently, task should run'
          );
          return true;
        }

        return false;
      },
      execute: async (runtime, _options) => {
        const today = new Date().toISOString().split('T')[0];
        await this.executeRelationshipSync(runtime);
        // Mark today as completed
        this.lastSyncDate = today;
      },
    });

    // Check if the relationship sync task exists, if not create it
    const existingTasks = await this.runtime.getTasksByName('RELATIONSHIP_SYNC');

    if (existingTasks.length === 0) {
      // Get the first available world ID for task creation
      let worldId: UUID;
      try {
        const worlds = await this.runtime.getAllWorlds();
        if (worlds.length > 0) {
          worldId = worlds[0].id;
        } else {
          // Use default world ID if no worlds exist
          worldId = '00000000-0000-0000-0000-000000000000' as UUID;
        }
      } catch (error) {
        logger.warn('[Deepen-Connection] Using default world for relationship sync task creation');
        worldId = '00000000-0000-0000-0000-000000000000' as UUID;
      }

      await this.runtime.createTask({
        name: 'RELATIONSHIP_SYNC',
        description:
          'Relationship sync task that syncs active connections from Memgraph to SQL relationships table',
        worldId: worldId,
        metadata: {
          updatedAt: Date.now(),
          updateInterval: 1000 * 60 * 60, // Check every hour
        },
        tags: ['queue', 'repeat', 'relationship-sync'],
      });
      logger.info('[Deepen-Connection] Created relationship sync task');
    }
  }

  /**
   * Check if it's time to sync relationships (every 6 hours)
   */
  private shouldSyncRelationships(now: Date): boolean {
    // Check if we have a cached last sync time
    const cacheKey = 'relationship-sync-last-run';
    this.runtime.getCache(cacheKey).then((cached) => {
      if (cached && typeof cached === 'object' && 'timestamp' in cached) {
        const lastSync = new Date(cached.timestamp as string);
        const hoursSinceLastSync = (now.getTime() - lastSync.getTime()) / (1000 * 60 * 60);
        return hoursSinceLastSync >= this.SYNC_INTERVAL_HOURS;
      }
      return true; // First run
    });
    return true;
  }

  /**
   * Execute the relationship sync by finding active connections and storing them in SQL
   */
  async executeRelationshipSync(runtime: IAgentRuntime) {
    try {
      logger.info('[Deepen-Connection] Executing relationship sync task');

      // Connect to Memgraph
      await this.memgraphService.connect();

      // Get all active HumanConnection nodes with exactly two participants
      const activeConnections = await this.memgraphService.getActiveHumanConnections();

      logger.info(
        `[Deepen-Connection] Found ${activeConnections.length} active connections for relationship sync`
      );

      let successCount = 0;
      let errorCount = 0;

      // Process each connection
      for (const connectionData of activeConnections) {
        try {
          await this.syncConnectionToRelationship(runtime, connectionData);
          successCount++;
        } catch (error: unknown) {
          logger.error(
            `[Deepen-Connection] Failed to sync connection ${connectionData.connection.connectionId}: ${error instanceof Error ? error.message : String(error)}`
          );
          errorCount++;
        }
      }

      // Store completion status in cache for monitoring
      await runtime.setCache('relationship-sync-last-run', {
        timestamp: new Date().toISOString(),
        connectionsProcessed: activeConnections.length,
        successCount,
        errorCount,
      });

      logger.info(
        `[Deepen-Connection] Relationship sync completed. Success: ${successCount}, Errors: ${errorCount}`
      );
    } catch (error) {
      logger.error('[Deepen-Connection] Error in relationship sync task execution:', error);
    } finally {
      await this.memgraphService.disconnect();
    }
  }

  /**
   * Sync a single connection to the relationships table
   */
  private async syncConnectionToRelationship(runtime: IAgentRuntime, connectionData: any) {
    const { connection, participants } = connectionData;

    if (participants.length !== 2) {
      logger.warn('[Deepen-Connection] Connection does not have exactly 2 participants, skipping');
      return;
    }

    // Identify source (has webId) and target (doesn't have webId) entities
    const sourceParticipant = participants.find((p: any) => p.webId);
    const targetParticipant = participants.find((p: any) => !p.webId);

    if (!sourceParticipant || !targetParticipant) {
      logger.warn('[Deepen-Connection] Could not identify source and target participants properly');
      return;
    }

    logger.debug(
      `[Deepen-Connection] Syncing relationship: ${sourceParticipant.name} (source) -> ${targetParticipant.name} (target)`
    );

    // Check if relationship already exists in SQL
    const existingRelationship = await this.getExistingRelationship(
      runtime,
      connection.connectionId
    );

    if (existingRelationship) {
      logger.debug(
        `[Deepen-Connection] Relationship ${connection.connectionId} already exists in SQL, updating`
      );

      // Update existing relationship if needed
      await this.updateRelationship(runtime, connection, sourceParticipant, targetParticipant);
    } else {
      logger.debug(
        `[Deepen-Connection] Creating new relationship ${connection.connectionId} in SQL`
      );

      // Create new relationship
      await this.createRelationship(runtime, connection, sourceParticipant, targetParticipant);
    }
  }

  /**
   * Check if a relationship already exists in SQL
   */
  private async getExistingRelationship(runtime: IAgentRuntime, connectionId: string) {
    try {
      // Using the database adapter to query relationships
      // Note: This assumes the relationship ID maps to connectionId
      const relationships = await runtime.getRelationships({
        entityId: connectionId as UUID,
      });

      // Find relationship with matching ID
      return relationships.find((rel) => rel.id === connectionId);
    } catch (error) {
      logger.error(
        `[Deepen-Connection] Error checking existing relationship ${connectionId}:`,
        error
      );
      return null;
    }
  }

  /**
   * Create a new relationship in SQL
   */
  private async createRelationship(
    runtime: IAgentRuntime,
    connection: any,
    sourceParticipant: any,
    targetParticipant: any
  ) {
    try {
      // Check if we should profile this relationship
      const shouldProfile = await this.shouldProfileRelationship(
        runtime,
        sourceParticipant.userId as UUID,
        targetParticipant.userId as UUID
      );

      let profileData = {};
      if (shouldProfile) {
        logger.debug(`[Deepen-Connection] Profiling relationship ${connection.connectionId} before creation`);
        profileData = await this.profileRelationship(
          runtime,
          sourceParticipant.userId as UUID,
          targetParticipant.userId as UUID
        ) || {};
      }

      const relationship = {
        id: connection.connectionId as UUID, // Map connectionId to relationship id
        sourceEntityId: sourceParticipant.userId as UUID,
        targetEntityId: targetParticipant.userId as UUID,
        agentId: runtime.agentId,
        tags: ['active', 'human-connection'],
        metadata: {
          partners: connection.partners,
          secret: connection.secret,
          status: connection.status,
          memgraphSyncedAt: new Date().toISOString(),
          ...profileData, // Include profiling data if available
        },
      };

      await runtime.createRelationship(relationship);

      logger.info(`[Deepen-Connection] Created relationship ${connection.connectionId} in SQL with ${Object.keys(profileData).length > 0 ? 'profiling data' : 'no profiling'}`);
    } catch (error) {
      logger.error(
        `[Deepen-Connection] Failed to create relationship ${connection.connectionId}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Update an existing relationship in SQL
   */
  private async updateRelationship(
    runtime: IAgentRuntime,
    connection: any,
    sourceParticipant: any,
    targetParticipant: any
  ) {
    try {
      // Note: ElizaOS doesn't have a direct updateRelationship method
      // We'll need to use the database adapter directly or recreate
      // For now, we'll log that an update is needed
      logger.info(
        `[Deepen-Connection] Relationship ${connection.connectionId} exists, metadata may need updating`
      );

      // If the runtime has direct database access, we could update here
      // Otherwise, this would need to be implemented in the database adapter
    } catch (error) {
      logger.error(
        `[Deepen-Connection] Failed to update relationship ${connection.connectionId}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Manual trigger for testing relationship sync (bypasses time validation)
   */
  async triggerTestSync() {
    logger.info('[Deepen-Connection] Manually triggering relationship sync for testing');
    await this.executeRelationshipSync(this.runtime);
  }

  /**
   * Get the last sync status from cache
   */
  async getLastSyncStatus() {
    return await this.runtime.getCache('relationship-sync-last-run');
  }

  /**
   * Check if a relationship should be profiled based on message count
   */
  private async shouldProfileRelationship(
    runtime: IAgentRuntime,
    sourceEntityId: UUID,
    targetEntityId: UUID
  ): Promise<boolean> {
    try {
      const MIN_MESSAGES_PER_PARTNER = 7;
      
      // Check message counts for both partners
      const sourceMessageCount = await this.getMessageCount(runtime, sourceEntityId);
      const targetMessageCount = await this.getMessageCount(runtime, targetEntityId);

      if (sourceMessageCount >= MIN_MESSAGES_PER_PARTNER && targetMessageCount >= MIN_MESSAGES_PER_PARTNER) {
        logger.debug(
          `[Deepen-Connection] Relationship eligible for profiling (source: ${sourceMessageCount}, target: ${targetMessageCount} messages)`
        );
        return true;
      } else {
        logger.debug(
          `[Deepen-Connection] Relationship not eligible for profiling - insufficient messages (source: ${sourceMessageCount}, target: ${targetMessageCount})`
        );
        return false;
      }
    } catch (error) {
      logger.error('[Deepen-Connection] Error checking if relationship should be profiled:', error);
      return false;
    }
  }

  /**
   * Get message count for a specific entity (user)
   */
  private async getMessageCount(runtime: IAgentRuntime, entityId: UUID): Promise<number> {
    try {
      // Get messages from the user's room (assuming roomId = entityId for DMs)
      const messages = await runtime.getMemories({
        tableName: 'messages',
        roomId: entityId, // For DMs, roomId typically matches userId
        entityId: entityId,
        count: 100, // Get more than we need to be sure
        unique: false,
      });

      return messages.length;
    } catch (error) {
      logger.error(`[Deepen-Connection] Error getting message count for ${entityId}:`, error);
      return 0;
    }
  }

  /**
   * Profile a relationship by analyzing conversation histories
   */
  private async profileRelationship(
    runtime: IAgentRuntime,
    sourceEntityId: UUID,
    targetEntityId: UUID
  ): Promise<any> {
    try {
      logger.debug(`[Deepen-Connection] Profiling relationship between ${sourceEntityId} and ${targetEntityId}`);

      // Get conversation histories for both partners
      const partner1History = await this.getConversationHistory(runtime, sourceEntityId);
      const partner2History = await this.getConversationHistory(runtime, targetEntityId);

      if (!partner1History || !partner2History) {
        logger.warn('[Deepen-Connection] Insufficient conversation history for profiling');
        return null;
      }

      // Prepare the profiling prompt
      const prompt = relationshipProfilingTemplate
        .replace('{{partner1ConversationHistory}}', partner1History)
        .replace('{{partner2ConversationHistory}}', partner2History);

      // Use large model for comprehensive analysis
      const response = await runtime.useModel(ModelType.TEXT_LARGE, {
        prompt: prompt,
      });

      // Check if response is empty or invalid
      if (!response || typeof response !== 'string' || response.trim() === '') {
        logger.error('[Deepen-Connection] Empty or invalid response from model for profiling');
        logger.debug(`[Deepen-Connection] Response type: ${typeof response}, length: ${response?.length}`);
        return null;
      }

      // Parse the response to extract relationship information
      const profileData = this.parseProfilingResponse(response);

      if (profileData) {
        logger.info(
          `[Deepen-Connection] Successfully profiled relationship: ${profileData.relationshipStage || 'Unknown'}`
        );
        return profileData;
      } else {
        logger.error('[Deepen-Connection] Failed to parse profiling response');
        logger.debug(`[Deepen-Connection] Raw response (first 500 chars): ${response.substring(0, 500)}`);
        return null;
      }
    } catch (error) {
      logger.error('[Deepen-Connection] Error profiling relationship:', error);
      return null;
    }
  }

  /**
   * Get conversation history for a partner
   */
  private async getConversationHistory(
    runtime: IAgentRuntime,
    entityId: UUID
  ): Promise<string | null> {
    try {
      // Get recent messages from the user's room (last 50 messages should be sufficient)
      const messages = await runtime.getMemories({
        tableName: 'messages',
        roomId: entityId, // Assuming DM room ID matches user ID
        count: 50,
        unique: false,
      });

      if (messages.length === 0) {
        return null;
      }

      // Format messages into readable conversation history
      const conversationHistory = messages
        .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)) // Sort by timestamp
        .map((message) => {
          const timestamp = new Date(message.createdAt || Date.now()).toLocaleString();
          const sender = message.entityId === runtime.agentId ? 'AI' : 'User';
          return `[${timestamp}] ${sender}: ${message.content.text || ''}`;
        })
        .join('\n');

      return conversationHistory;
    } catch (error) {
      logger.error(
        `[Deepen-Connection] Error getting conversation history for ${entityId}:`,
        error
      );
      return null;
    }
  }

  /**
   * Parse the profiling response from the LLM
   */
  private parseProfilingResponse(response: string) {
    try {
      const profileData: any = {};

      // First check if response is wrapped in <response> tags
      let responseContent = response;
      const responseMatch = response.match(/<response>([\s\S]*?)<\/response>/);
      if (responseMatch) {
        responseContent = responseMatch[1];
      }

      // Extract relationshipStage
      const stageMatch = responseContent.match(/<relationshipStage>(.*?)<\/relationshipStage>/);
      if (stageMatch) {
        profileData.relationshipStage = stageMatch[1].trim();
      }

      // Extract relationshipLength
      const lengthMatch = responseContent.match(/<relationshipLength>(.*?)<\/relationshipLength>/);
      if (lengthMatch) {
        const length = parseInt(lengthMatch[1].trim());
        if (!isNaN(length)) {
          profileData.relationshipLength = length;
        }
      }

      // Extract currentDynamics
      const dynamicsMatch = responseContent.match(/<currentDynamics>(.*?)<\/currentDynamics>/);
      if (dynamicsMatch) {
        profileData.currentDynamics = dynamicsMatch[1].trim();
      }

      // Extract recentPatterns
      const patternsMatch = responseContent.match(/<recentPatterns>(.*?)<\/recentPatterns>/);
      if (patternsMatch) {
        profileData.recentPatterns = patternsMatch[1].trim();
      }

      // Extract activeChallenges
      const challengesMatch = responseContent.match(/<activeChallenges>(.*?)<\/activeChallenges>/);
      if (challengesMatch) {
        profileData.activeChallenges = challengesMatch[1].trim();
      }

      // Extract sharedGoals
      const goalsMatch = responseContent.match(/<sharedGoals>(.*?)<\/sharedGoals>/);
      if (goalsMatch) {
        profileData.sharedGoals = goalsMatch[1].trim();
      }

      // Extract culturalContext
      const culturalMatch = responseContent.match(/<culturalContext>(.*?)<\/culturalContext>/);
      if (culturalMatch) {
        profileData.culturalContext = culturalMatch[1].trim();
      }

      // Only return data if we extracted at least relationshipStage
      if (profileData.relationshipStage) {
        profileData.profiledAt = new Date().toISOString();
        return profileData;
      }

      return null;
    } catch (error) {
      logger.error('[Deepen-Connection] Error parsing profiling response:', error);
      return null;
    }
  }

  /**
   * Stop the service
   */
  async stop() {
    await this.memgraphService.disconnect();
    logger.debug('[Deepen-Connection] RelationshipAddingService stopped');
  }
}
