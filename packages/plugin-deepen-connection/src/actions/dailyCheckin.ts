import {
  type Action,
  type ActionExample,
  type HandlerCallback,
  type IAgentRuntime,
  logger,
  type Memory,
  type State,
} from '@elizaos/core';
import { DailyPlanningService } from '../services/dailyPlanning.js';

export const dailyPlanningAction: Action = {
  name: 'DAILY_PLANNING_TEST',
  similes: ['TEST_DAILY_PLANNING', 'TRIGGER_PLANNING', 'GENERATE_PLANS'],
  description: 'Manually trigger daily planning for testing purposes',
  validate: async (_runtime: IAgentRuntime, message: Memory, _state?: State) => {
    // Only allow this action for admin/testing purposes
    // You might want to add additional validation here
    const messageText = message.content.text?.toLowerCase() || '';
    return (
      messageText.includes('test daily planning') ||
      messageText.includes('trigger planning') ||
      messageText.includes('generate daily plans')
    );
  },
  handler: async (
    runtime: IAgentRuntime,
    _message: Memory,
    _state?: State,
    _options?: any,
    callback?: HandlerCallback,
    _responses?: Memory[]
  ) => {
    try {
      logger.info('[Deepen-Connection] Manual daily planning triggered by user');

      // Get the DailyPlanningService
      const dailyPlanningService = runtime.getService('daily-planning') as DailyPlanningService;

      if (!dailyPlanningService) {
        await callback?.({
          text: 'Daily planning service is not available.',
          actions: ['DAILY_PLANNING_ERROR'],
        });
        return;
      }

      // Trigger the daily planning
      await dailyPlanningService.triggerTestPlanning();

      // Get the status
      const status = (await dailyPlanningService.getLastPlanningStatus()) as any;

      const responseText = status
        ? `Daily planning completed successfully! Processed ${status.connectionsProcessed || 0} connections.`
        : 'Daily planning triggered, but status is not available.';

      await callback?.({
        text: responseText,
        actions: ['DAILY_PLANNING_SUCCESS'],
      });
    } catch (error) {
      logger.error(
        `[Deepen-Connection] Error in daily planning action: ${error instanceof Error ? error.message : String(error)}`
      );

      await callback?.({
        text: `Failed to trigger daily planning: ${error instanceof Error ? error.message : String(error)}`,
        actions: ['DAILY_PLANNING_ERROR'],
      });
    }
  },
  examples: [
    [
      {
        name: '{{user1}}',
        content: { text: 'test daily planning' },
      },
      {
        name: '{{agentName}}',
        content: {
          text: 'Daily planning completed successfully! Processed 3 connections.',
          actions: ['DAILY_PLANNING_SUCCESS'],
        },
      },
    ],
    [
      {
        name: '{{user1}}',
        content: { text: 'trigger planning for relationships' },
      },
      {
        name: '{{agentName}}',
        content: {
          text: 'Daily planning completed successfully! Processed 2 connections.',
          actions: ['DAILY_PLANNING_SUCCESS'],
        },
      },
    ],
  ] as ActionExample[][],
};
