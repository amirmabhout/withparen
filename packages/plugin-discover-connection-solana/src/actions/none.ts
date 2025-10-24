import type { Action, ActionExample, IAgentRuntime, Memory, ActionResult } from '@elizaos/core';

/**
 * Represents the none action.
 *
 * This action responds but performs no additional action. It is the default if the agent is speaking and not doing anything additional.
 *
 * @type {Action}
 */
/**
 * Represents an action that responds but performs no additional action.
 * This is the default behavior if the agent is speaking and not doing anything additional.
 * @type {Action}
 */
export const noneAction: Action = {
  name: 'NONE',
  similes: ['NO_ACTION', 'NO_RESPONSE', 'NO_REACTION'],
  validate: async (runtime: IAgentRuntime, message: Memory) => {
    // Don't allow NONE action for matched users - they should use COORDINATE
    try {
      const { UserStatusService } = await import('../services/userStatusService.js');
      const userStatusService = new UserStatusService(runtime);
      const userStatus = await userStatusService.getUserStatus(message.entityId);

      if (userStatus === 'matched') {
        return false; // Matched users must use COORDINATE, not NONE
      }
      return true;
    } catch (error) {
      // If we can't check status, allow NONE to avoid breaking the flow
      return true;
    }
  },
  description:
    'Respond but perform no additional action. This is the default if the agent is speaking and not doing anything additional.',
  handler: async (_runtime: IAgentRuntime, _message: Memory): Promise<ActionResult> => {
    return {
      text: 'No additional action taken',
      values: {
        success: true,
        actionType: 'NONE',
      },
      data: {
        actionName: 'NONE',
        description: 'Response without additional action',
      },
      success: true,
    };
  },
  examples: [] as ActionExample[][],
} as Action;
