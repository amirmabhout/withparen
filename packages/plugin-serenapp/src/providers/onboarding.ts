import { type IAgentRuntime, type Memory, type Provider, type State } from '@elizaos/core';

/**
 * Onboarding provider for app users who want to create connection invites
 * with shared secrets for authentication.
 */
export const onboardingProvider: Provider = {
  name: 'ONBOARDING',
  description: 'Provides context for app onboarding to create connection invites with shared secrets',
  get: async (_runtime: IAgentRuntime, _message: Memory, _state: State) => {
    const context = `# Important task: App Onboarding to create connection invites

You are helping a user create a connection invite through the Seren app. Follow this structured conversation flow:

## Step-by-Step Conversation Flow

### Step 1: Welcome & Get User's Name
- Welcome them warmly to Seren
- Explain that you'll help them create a connection invite
- Ask: "What's your name?" (first question)

### Step 2: Get Partner's Name  
- Once you have their name, ask in a separate question:
- "Who would you like to deepen your connection with?" or "What's the name of the person you want to connect with?"

### Step 3: Establish Shared Secret
- Once you have both names, explain the shared secret concept
- Ask them to choose a shared secret that only both people would know
- Provide examples like:
  - "The name of the coffee shop where we first met"
  - "Your favorite pizza topping that I always tease you about" 
  - "The movie we watched on our first date"
  - "The nickname you gave my dog"
  - "The city where we went on that weekend trip"

### Step 4: Trigger Connection Creation
- Once you have all three pieces of information (user name, partner name, shared secret), the CREATE_CONNECTION action should be triggered
- The action will extract this information from the conversation and create the HumanConnection node with waitlist status

## Important Guidelines
- Ask for information **one step at a time** - don't ask for multiple things in one message
- Keep each question focused and simple
- Be warm and encouraging throughout the process
- Once all information is collected, let the CREATE_CONNECTION action handle the database creation

## Information You're Collecting
1. **User's Name**: Their own name
2. **Partner's Name**: Who they want to connect with  
3. **Shared Secret**: Something only both people would know

Remember: This creates secure, authenticated connections between people who already know each other. The CREATE_CONNECTION action will handle the technical creation once you've gathered all the information through conversation.`;

// ## Final Output Format
// - Use the wrap suggested around invite card so the front end can pick it up and make it copiable.
// When ready, provide:
// "Here's your connection invite card to share:


// ***INVITE_CARD_START***
// Hey! I'd love to deepen our connection and explore meaningful conversations together. I'm using Seren, an AI companion that helps facilitate deeper connections between people who matter to each other. Please send Seren a message and introduce yourself.

// 🤖 Telegram Bot: https://t.me/withseren_bot
// 👤 Connection: [Name of connection]
// 🔐 Secret: [Shared Secret]
// ***INVITE_CARD_END***
// Copy this and send it to [Name]. When they message the bot with your name and the secret, you'll both be connected and can start your journey together!"
    return {
      values: {
        onboardingStage: 'connection_invite_creation',
        conversationType: 'app_onboarding',
      },
      data: {
        context: context,
      },
      text: context,
    };
  },
};