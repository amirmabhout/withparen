import {
  Action,
  type IAgentRuntime,
  type ActionResult,
  type HandlerCallback,
  type Memory,
  type State,
  logger,
} from '@elizaos/core';
import { RelationshipAddingService } from '../services/relationshipAdding.js';

/**
 * Test action to manually trigger relationship sync
 * Only available when ALLOW_TEST_ACTIONS=true
 */
export const testRelationshipSyncAction: Action = {
  name: 'TEST_RELATIONSHIP_SYNC',
  similes: ['test sync', 'sync relationships', 'test relationship sync', 'sync memgraph to sql'],
  description: 'Manually trigger relationship sync from Memgraph to SQL (test action)',
  validate: async (_runtime: IAgentRuntime, _message: Memory, _state?: State) => {
    // Only validate if ALLOW_TEST_ACTIONS is true
    const allowTestActions = process.env.ALLOW_TEST_ACTIONS === 'true';

    if (!allowTestActions) {
      logger.debug('[Deepen-Connection] Test actions are disabled (ALLOW_TEST_ACTIONS !== true)');
      return false;
    }

    logger.debug('[Deepen-Connection] Test relationship sync action validated');
    return true;
  },
  handler: async (
    runtime: IAgentRuntime,
    _message: Memory,
    _state?: State,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    try {
      logger.info('[Deepen-Connection] Executing test relationship sync action');

      // Get the relationship adding service
      const relationshipService = runtime.getService(
        'relationship-adding'
      ) as RelationshipAddingService;

      if (!relationshipService) {
        const errorMsg = 'RelationshipAddingService not found. Please ensure it is registered.';
        logger.error(`[Deepen-Connection] ${errorMsg}`);

        if (callback) {
          await callback({
            text: `❌ ${errorMsg}`,
            simple: true,
          });
        }

        return {
          success: false,
          error: errorMsg,
        };
      }

      // Trigger the test sync
      await relationshipService.triggerTestSync();

      // Get the sync status
      const syncStatus = await relationshipService.getLastSyncStatus();

      let responseText = '✅ Relationship sync completed successfully!\n\n';

      if (syncStatus && typeof syncStatus === 'object') {
        responseText += '📊 Sync Results:\n';
        responseText += `• Connections processed: ${(syncStatus as any).connectionsProcessed || 0}\n`;
        responseText += `• Successful syncs: ${(syncStatus as any).successCount || 0}\n`;
        responseText += `• Failed syncs: ${(syncStatus as any).errorCount || 0}\n`;
        responseText += `• Last sync: ${(syncStatus as any).timestamp || 'Unknown'}`;
      } else {
        responseText += 'No sync status available yet.';
      }

      if (callback) {
        await callback({
          text: responseText,
          simple: true,
        });
      }

      logger.info('[Deepen-Connection] Test relationship sync completed');

      return {
        success: true,
        text: 'Relationship sync test completed',
        data: {
          syncStatus,
        },
      } as ActionResult;
    } catch (error) {
      const errorMsg = `Failed to execute test relationship sync: ${error instanceof Error ? error.message : 'Unknown error'}`;
      logger.error(`[Deepen-Connection] ${errorMsg}`);

      if (callback) {
        await callback({
          text: `❌ ${errorMsg}`,
          simple: true,
        });
      }

      return {
        success: false,
        error: errorMsg,
      } as ActionResult;
    }
  },
  examples: [
    [
      {
        name: '{{user}}',
        content: { text: 'test relationship sync' },
      },
      {
        name: '{{agent}}',
        content: {
          text: '✅ Relationship sync completed successfully!\n\n📊 Sync Results:\n• Connections processed: 2\n• Successful syncs: 2\n• Failed syncs: 0',
        },
      },
    ],
    [
      {
        name: '{{user}}',
        content: { text: 'sync memgraph to sql' },
      },
      {
        name: '{{agent}}',
        content: {
          text: 'Syncing relationships from Memgraph to SQL database...',
        },
      },
    ],
  ],
};
