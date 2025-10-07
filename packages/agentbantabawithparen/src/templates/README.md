# Custom Templates for Bantabaa Restaurant / Paren Character

This directory contains custom templates that override the default templates from the `@elizaos/plugin-discover-connection` plugin to focus on dining companionship and conversational chemistry rather than professional networking.

## Template Structure

### Prompt Templates (`promptTemplates.ts`)
- **connectionDiscoveryTemplate** - Discovers dining companions based on conversational style and social vibe
- **compatibilityAnalysisTemplate** - Analyzes conversational compatibility and dining chemistry between users
- **introductionProposalTemplate** - Creates warm, engaging introduction messages for dining companions
- **circlesVerificationExtractionTemplate** - Extracts social profile information for matching

### Provider Templates (`providerTemplates.ts`)
- **onboardingContext** - Guides users through the Bantabaa community onboarding focused on:
  - Conversational interests and communication style
  - Social energy and vibe (playful vs reflective)
  - Dining companionship preferences (intimate vs group)
- **verificationContext** - Social profile verification for trust building
- **messageHandlerTemplate** - Paren's conversational style for dining companion discovery
- **reflectionTemplate** - Learning about user's conversational wavelength and dining preferences

## How Templates Work

1. Templates are loaded automatically when the Paren character is initialized
2. The `TemplateConfigService` in the plugin checks for custom templates
3. If a custom template exists, it overrides the default template
4. If no custom template exists, the default template is used

## Template Customization Points

The templates customize the following aspects:
- Focus on **conversational chemistry** vs professional networking
- Emphasis on **social vibe and communication style**
- **Vibe-based matching** instead of skill-based matching
- **Dining companionship compatibility** (conversational wavelength, energy levels, group preferences)
- **Warm and curious tone** focused on cultural exchange

## Usage

These templates are automatically registered through the character configuration in `character.ts`:

```typescript
export const character: Character = {
  // ... other config
  templates: bantabaaTemplates, // Custom templates for Bantabaa restaurant
};
```

The plugin will automatically use these templates when the Paren character is active.