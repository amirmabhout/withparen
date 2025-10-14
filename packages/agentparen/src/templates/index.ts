/**
 * Custom templates for Paren character
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
} from './providerTemplates';

export const buildStationTemplates = {
  // Prompt templates used by actions
  connectionDiscoveryTemplate,
  compatibilityAnalysisTemplate,
  introductionProposalTemplate,

  // Provider templates for different user statuses
  onboardingContext,

  // Additional templates can be added here as needed
  // Templates not provided here will use defaults from plugin-discover-connection
};