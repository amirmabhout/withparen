/**
 * Custom templates for Bantabaa restaurant / Paren character
 * Export all templates for use in character configuration
 */

export * from './promptTemplates';
export * from './providerTemplates';

// Re-export as a consolidated templates object for character configuration
import {
  connectionDiscoveryTemplate,
  compatibilityAnalysisTemplate,
  introductionProposalTemplate,
} from './promptTemplates';

import {
  onboardingContext,
  verificationContext,
} from './providerTemplates';

export const bantabaaTemplates = {
  // Prompt templates used by actions
  connectionDiscoveryTemplate,
  compatibilityAnalysisTemplate,
  introductionProposalTemplate,

  // Provider templates for different user statuses
  onboardingContext,
  verificationContext,

  // Additional templates can be added here as needed
  // Templates not provided here will use defaults from plugin-discover-connection
};