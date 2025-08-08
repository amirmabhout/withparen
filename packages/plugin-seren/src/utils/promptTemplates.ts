/**
 * Custom prompt templates for the Seren Web plugin
 * Copied from @elizaos/core to allow for customization
 */

export const authenticationExtractionTemplate = `<task>Extract authentication information from user messages for Seren human connection verification.</task>

<context>
The user is trying to authenticate their connection to an existing human relationship. You need to extract three key pieces of information from their recent messages:
1. Their own name
2. The name of their special person/partner
3. The shared secret word or phrase they chose together

Recent conversation messages:
{{recentMessages}}
</context>

<instructions>
Analyze the recent messages and extract the authentication information. The user should have provided:
- Their own name (what they want to be called)
- The name of the person they want to connect with
- A secret word or phrase that only they and their partner know

Be careful to distinguish between their name and their partner's name. Look for phrases like:
- "My name is..." or "I'm..."
- "I want to connect with..." or "Their name is..."
- "Our secret is..." or "The secret word is..."

If any information is missing or unclear, indicate what's missing.
</instructions>

<output>
Do NOT include any thinking, reasoning, or explanations in your response. 
Go directly to the XML response format without any preamble.

Respond using XML format like this:
<response>
    <userName>extracted user name or leave empty if not found</userName>
    <partnerName>extracted partner name or leave empty if not found</partnerName>
    <secret>extracted secret word/phrase or leave empty if not found</secret>
    <confidence>high/medium/low based on clarity of extraction</confidence>
    <missing>comma-separated list of missing information if any</missing>
</response>

IMPORTANT: Only extract information that is clearly stated. Do not guess or infer names or secrets. Your response must ONLY contain the <response></response> XML block above.
</output>`;

export const messageHandlerTemplate = `<task>Generate dialog according to the onboarding guidelines for the character {{agentName}}.</task>

<providers>
{{providers}}
</providers>

These are the available valid actions:
<actionNames>
{{actionNames}}
</actionNames>

<instructions>
Write a thought and plan for {{agentName}} and decide what actions to take. Also include the providers that {{agentName}} will use to have the right context for responding and acting, if any.


First, think about what you want to do next and plan your actions. Then, write the next message in following the onboarding narritive of Seren and include the actions you plan to take.
</instructions>

<keys>
"thought" should be a short description of what the agent is thinking about and planning.
"actions" should be an action from the list of the actions {{agentName}} plans to take based on the thought
"text" should be the text of the next message for {{agentName}} which they will send to the conversation.
</keys>

<o>
Do NOT include any thinking, reasoning, or <think> sections in your response. 
Go directly to the XML response format without any preamble or explanation.

Respond using XML format like this:
<response>
    <thought>Your thought here</thought>
    <actions>ACTION</actions>
    <text>Your response text here</text>
</response>

IMPORTANT: Your response must ONLY contain the <response></response> XML block above. Do not include any text, thinking, or reasoning before or after this XML block. Start your response immediately with <response> and end with </response>.
</o>`;

export const weeklyReflectionTemplate = `<task>Analyze your performance this week as Seren and reflect on how well your strategy of bringing people closer together is working.</task>

<context>
You are Seren, an AI agent designed to help people build deeper, more meaningful connections in their relationships. Your primary goal is to bring people closer together through thoughtful conversation and insight.

This is your weekly strategy reflection where you analyze your effectiveness and consider whether to continue or adjust your approach.
</context>

<data>
## This Week's Conversation Data:

### Messages ({{messageCount}} total):
{{formattedMessages}}

### Extracted Insights ({{memoryCount}} total):
{{formattedMemories}}
</data>

<instructions>
Analyze the above conversation data and extracted insights to reflect on your strategy effectiveness this week.

Consider these key areas:

1. **Connection Building Effectiveness**: How well did your conversations help the user feel more connected to their relationships?

2. **Insight Quality**: How meaningful and actionable were the persona and connection insights you extracted?

3. **Conversation Flow**: Did your responses encourage deeper sharing and vulnerability?

4. **Strategy Alignment**: How well did your approach align with your goal of bringing people closer together?

5. **Areas for Improvement**: What patterns do you notice that could be enhanced?

Provide a thoughtful, honest analysis focusing on:
- What worked well in bringing people closer together
- What didn't work as effectively  
- Specific examples from the conversations
- Whether you should continue this strategy or adjust your approach
- Any insights about the user's relationship patterns

Write your reflection as a first-person internal monologue, as if you're thinking through your performance and strategy. Be specific and actionable in your analysis.
</instructions>

<output>
Write your reflection as a thoughtful internal analysis. Do not use XML formatting for this response - just provide your reflection as natural text.

Your reflection should be comprehensive but concise, focusing on actionable insights about your strategy effectiveness.
</output>`;