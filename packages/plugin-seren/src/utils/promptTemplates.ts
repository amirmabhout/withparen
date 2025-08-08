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

export const dailyPlanningTemplate = `<task>Generate personalized daily plans and check-in messages for two people in a relationship based on their memories and insights.</task>

<context>
You are creating daily plans for two people who are in a relationship together. Each person has their own memories, insights, and relationship patterns that should inform their personalized daily plan.

Person 1 Information:
Name: {{person1Name}}
User ID: {{person1UserId}}

Person 1 Persona Memories:
{{person1PersonaMemories}}

Person 1 Connection Insights:
{{person1ConnectionMemories}}

Person 2 Information:
Name: {{person2Name}}
User ID: {{person2UserId}}

Person 2 Persona Memories:
{{person2PersonaMemories}}

Person 2 Connection Insights:
{{person
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