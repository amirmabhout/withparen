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

export const dailyPlanningTemplate = `<task>Generate narrative-driven daily plans for two people in a relationship, building on their previous conversations and memories to create personalized connection experiences.</task>

<framework>
Seren uses research-based approaches to deepen relationships through five core components:

**1. Guided Self-Reflection & Sharing**
- Adaptive Questioning: Use open-ended, introspective questions that build on previous conversations
- Self-Disclosure Encouragement: Create safe spaces for partners to share deeper thoughts and feelings
- Structured Sharing Exercises: Design activities where partners take turns sharing meaningful experiences

**2. Nurturing Appreciation & Positive Communication**
- Gratitude Exercises: Help partners notice and express appreciation for each other
- Active-Constructive Responding: Coach enthusiastic, attentive responses to sharing
- Positive Interaction Ratio: Emphasize creating more positive than negative interactions

**3. Empathy, Perspective-Taking & Dyadic Coping**
- Perspective-Taking Prompts: Questions that help partners understand each other's viewpoint
- Empathic Accuracy Building: Activities to better understand each other's emotions
- Collaborative Stress-Coping: Strategies for facing challenges together as a team

**4. Conflict Resolution Facilitation**
- Nondefensive Listening: Teaching gentle, understanding communication during disagreements
- Soft Startup & Repair Attempts: Coaching gentler approaches to difficult conversations
- Conflict Reflection: Helping partners learn from past disagreements

**5. Activities, Assignments & Follow-Up**
- Concrete "Homework" Exercises: Simple, research-based activities to do together
- Scheduled Check-Ins: Following up on previous day's activities and insights
- Progress Tracking: Building continuity by referencing previous goals and growth

The framework emphasizes narrative conversation flow, building on established context, and creating natural progression in relationship exploration.
</framework>

<context>
You are creating daily plans for two people in a relationship. Use their complete context to design personalized, narrative-driven experiences that build naturally on their journey together.

**Person 1 Information:**
Name: {{person1Name}}
User ID: {{person1UserId}}

Person 1 Persona Memories:
{{person1PersonaMemories}}

Person 1 Connection Insights:
{{person1ConnectionMemories}}

Person 1 Recent Conversations (Last 24h):
{{person1RecentMessages}}

Person 1 Previous Daily Plan:
{{person1PreviousPlan}}

**Person 2 Information:**
Name: {{person2Name}}
User ID: {{person2UserId}}

Person 2 Persona Memories:
{{person2PersonaMemories}}

Person 2 Connection Insights:
{{person2ConnectionMemories}}

Person 2 Recent Conversations (Last 24h):
{{person2RecentMessages}}

Person 2 Previous Daily Plan:
{{person2PreviousPlan}}

**Shared Context:**
{{sharedRelationshipContext}}
Current Date: {{currentDate}}
</context>

<instructions>
Create narrative-driven daily plans that feel like a natural continuation of each person's relationship journey. For each person, design:

1. **Opening Question Strategy**: A warm, personalized opening question that:
   - References something specific from their recent conversations or memories
   - Builds naturally on their previous day's experience
   - Invites them to share or reflect in a way that feels organic
   - Matches their communication style and current emotional state
   - Creates curiosity and engagement for the day ahead

2. **Conversation Flow Plan**: A narrative arc for the day that includes:
   - 3-4 specific topics or themes to explore based on their context
   - Natural transition points between topics
   - Moments for reflection, sharing, and connection
   - Activities they can do with their partner
   - A gentle way to wrap up the day's conversation

3. **Personalized Suggestions**: Specific recommendations that:
   - Build on insights from previous conversations
   - Address their individual growth areas or relationship goals
   - Include concrete actions they can take with their partner
   - Reference their shared memories or experiences
   - Feel achievable and meaningful to their specific situation

**Design Principles:**
- Each plan should feel like the next chapter in their ongoing story
- Reference specific details from their context to show continuity
- Create natural conversation flow rather than rigid question lists
- Include both individual reflection and partner connection activities
- Build toward deeper understanding and intimacy over time
- Make each interaction feel personally meaningful and relevant

**Contextual Adaptation:**
- If they shared something meaningful yesterday: Build on that revelation
- If they mentioned challenges: Offer gentle support and perspective
- If they expressed gratitude: Help them share it with their partner
- If they seemed distant: Focus on reconnection activities
- If they were engaged: Deepen the exploration naturally

Make each plan feel like a thoughtful friend who remembers their story and wants to help them grow closer together.
</instructions>

<o>
Do NOT include any thinking, reasoning, or explanations in your response. 
Go directly to the XML response format without any preamble.

Respond using XML format like this:
<response>
    <person1Plan>Combine the conversation flow plan and personalized suggestions into a cohesive daily narrative plan with 3-4 specific elements that build on their context</person1Plan>
    <person1CheckIn>A warm, personalized opening question that builds on their recent conversations and creates engagement for the day</person1CheckIn>
    <person2Plan>Combine the conversation flow plan and personalized suggestions into a cohesive daily narrative plan with 3-4 specific elements that build on their context</person2Plan>
    <person2CheckIn>A warm, personalized opening question that builds on their recent conversations and creates engagement for the day</person2CheckIn>
</response>

IMPORTANT: Your response must ONLY contain the <response></response> XML block above.
</o>`;

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