/**
 * Unified Coordination Template - Modular Status-Based System
 * Dynamically builds prompts with only relevant status logic
 */

import { type UUID } from '@elizaos/core';
import { MatchStatus } from '../services/userStatusService.js';
import { baseHeader, baseFooter } from './coordinationTemplates/base.js';
import { matchFoundTemplate } from './coordinationTemplates/matchFound.js';
import { proposalSentTemplate } from './coordinationTemplates/proposalSent.js';
import { acceptedTemplate } from './coordinationTemplates/accepted.js';
import { completedTemplate } from './coordinationTemplates/completed.js';

/**
 * Template context interface - all variables that can be replaced
 */
export interface CoordinationTemplateContext {
  // Match details
  userFromId: string;
  userFromName: string;
  userToId: string;
  userToName: string;
  compatibilityScore: number;
  reasoning: string;

  // Current context
  currentUserId: UUID;
  isInitiator: boolean;
  status: string;
  venue: string;
  proposedTime: string;

  // Date/Time context for LLM
  currentDate: string; // Today's date in readable format
  currentTime: string; // Current time in ISO format

  // Initiator user details
  initiatorPersona: string;
  initiatorMessages: string;
  initiatorClue: string;

  // Matched user details
  matchedPersona: string;
  matchedMessages: string;
  matchedClue: string;

  // Current interaction
  userMessage: string;
  existingFeedback: string;
}

/**
 * Map of status to template content
 */
const statusTemplates: Record<string, string> = {
  [MatchStatus.MATCH_FOUND]: matchFoundTemplate,
  [MatchStatus.PROPOSAL_SENT]: proposalSentTemplate,
  [MatchStatus.ACCEPTED]: acceptedTemplate,
  [MatchStatus.COMPLETED]: completedTemplate,
  [MatchStatus.DECLINED]: completedTemplate,
  [MatchStatus.CANCELLED]: completedTemplate,
};

/**
 * Build coordination prompt with only relevant status logic
 * @param status - Current match status
 * @param context - Template context variables
 * @returns Complete prompt with variables replaced
 */
export function buildCoordinationPrompt(
  status: string,
  context: CoordinationTemplateContext
): string {
  // Get status-specific template (default to completed if unknown)
  const statusTemplate = statusTemplates[status] || completedTemplate;

  // Build complete prompt
  const fullTemplate = baseHeader + statusTemplate + baseFooter;

  // Replace all variables in one pass
  let prompt = fullTemplate;
  for (const [key, value] of Object.entries(context)) {
    const placeholder = `{{${key}}}`;
    const replacement = value?.toString() || '';
    // Use global replace to handle multiple occurrences
    prompt = prompt.split(placeholder).join(replacement);
  }

  return prompt;
}

/**
 * @deprecated Use buildCoordinationPrompt() instead
 * Legacy export for backward compatibility - will be removed in future version
 */
export const unifiedCoordinationTemplate = `# DEPRECATED: Use buildCoordinationPrompt() function instead
This template string is deprecated and will be removed in a future version.
Please update your code to use the new buildCoordinationPrompt() function.
`;
