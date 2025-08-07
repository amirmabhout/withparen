import {
  type Action,
  type ActionExample,
  type HandlerCallback,
  type IAgentRuntime,
  logger,
  type Memory,
  type State,
} from '@elizaos/core';
import { DailyCheckinService } from '../services/dailyCheckin.ts';

export const dailyCheckinAction: Action = {
  name: 'DAILY_CHECKIN_TEST',
  similes: ['TEST_DAILY_CHECKIN', 'TRIGGER_CHECKIN', 'SEND_CHECKIN'],
  description: 'Manually trigger daily check-in messages for testing purposes',
  validate: async (_runtime: IAgentRuntime, message: Memory, _state?: State) => {
    // Only allow this action for admin/testing purposes
    // You might want to add additional validation here
    const messageText = message.content.text?.toLowerCase() || '';
    return messageText.includes('test daily checkin') || 
           messageText.includes('trigger checkin') ||
           messageText.includes('send daily checkin');
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
      logger.info('[Seren] Manual daily check-in triggered by user');
      
      // Get the DailyCheckinService
      const dailyCheckinService = runtime.getService('daily-checkin') as DailyCheckinService;
      
      if (!dailyCheckinService) {
        await callback?.({
          text: 'Daily check-in service is not available.',
          actions: ['DAILY_CHECKIN_ERROR'],
        });
        return;
      }

      // Trigger the daily check-in
      await dailyCheckinService.triggerTestCheckin();
      
      // Get the status
      const status = await dailyCheckinService.getLastCheckinStatus() as any;
      
      const responseText = status 
        ? `Daily check-in sent successfully! Reached ${status.successCount || 0} rooms (${status.errorCount || 0} failed).`
        : 'Daily check-in triggered, but status is not available.';

      await callback?.({
        text: responseText,
        actions: ['DAILY_CHECKIN_SUCCESS'],
      });

    } catch (error) {
      logger.error('[Seren] Error in daily check-in action:', error);
      
      await callback?.({
        text: `Failed to trigger daily check-in: ${(error as Error).message}`,
        actions: ['DAILY_CHECKIN_ERROR'],
      });
    }
  },
  examples: [
    [
      {
        name: '{{user1}}',
        content: { text: 'test daily checkin' },
      },
      {
        name: '{{agentName}}',
        content: {
          text: 'Daily check-in sent successfully! Reached 5 rooms (0 failed).',
          actions: ['DAILY_CHECKIN_SUCCESS'],
        },
      },
    ],
    [
      {
        name: '{{user1}}',
        content: { text: 'trigger checkin messages' },
      },
      {
        name: '{{agentName}}',
        content: {
          text: 'Daily check-in sent successfully! Reached 3 rooms (1 failed).',
          actions: ['DAILY_CHECKIN_SUCCESS'],
        },
      },
    ],
  ] as ActionExample[][],
};