import { type IAgentRuntime, logger } from '@elizaos/core';

/**
 * Template Loader Utility
 *
 * Provides dynamic template loading with agent-specific overrides.
 * If a custom template is defined in the agent's character.templates,
 * it will be used. Otherwise, the plugin's default template is returned.
 */

/**
 * Gets a template from the agent's character configuration or falls back to default
 *
 * @param runtime - The agent runtime containing character configuration
 * @param templateName - The name of the template to load
 * @param defaultTemplate - The default template to use if no custom template exists
 * @returns The custom template if available, otherwise the default template
 */
export function getTemplate(
  runtime: IAgentRuntime,
  templateName: string,
  defaultTemplate: string
): string {
  try {
    // Check if character has custom templates defined
    const customTemplate = runtime.character.templates?.[templateName];

    if (customTemplate && typeof customTemplate === 'string') {
      logger.debug(
        `[template-loader] Using custom template for '${templateName}' from character configuration`
      );
      return customTemplate;
    }

    // Fall back to default template
    logger.debug(`[template-loader] Using default template for '${templateName}' from plugin`);
    return defaultTemplate;
  } catch (error) {
    logger.error(
      `[template-loader] Error loading template '${templateName}': ${error}. Falling back to default.`
    );
    return defaultTemplate;
  }
}

/**
 * Template names used by the plugin
 * This enum helps maintain consistency and provides autocomplete support
 */
export enum TemplateNames {
  // Provider context templates
  ONBOARDING_CONTEXT = 'onboardingContext',
  VERIFICATION_CONTEXT = 'verificationContext',

  // Prompt templates for actions
  CONNECTION_DISCOVERY = 'connectionDiscoveryTemplate',
  COMPATIBILITY_ANALYSIS = 'compatibilityAnalysisTemplate',
  INTRODUCTION_PROPOSAL = 'introductionProposalTemplate',
  INTRODUCTION_TRUST_INVITE = 'introductionTrustInviteTemplate',
  MESSAGE_HANDLER = 'messageHandlerTemplate',
}
