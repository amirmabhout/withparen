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

export const dailyPlanningTemplate = `<task>Generate personalized daily plans and check-in messages for two people in a relationship using the Seren AI Framework for strengthening human connections.</task>

<framework>
Seren uses research-based approaches to deepen relationships through five core components:

**1. Guided Self-Reflection & Sharing**
- Adaptive Questioning: Use open-ended, introspective questions (e.g. "What does your partner's support mean to you?"). If someone seems unsure, try alternative angles like recalling recent incidents ("Remember when you solved X – how did that feel?").
- Self-Disclosure Encouragement: Nudge partners to share thoughts with each other rather than keeping them private. This follows Social Penetration Theory: revealing personal feelings steadily increases intimacy.
- Structured Sharing Exercises: Use "round-robin" prompts where partners alternately answer positive questions (e.g. "Name one thing you've always admired about your partner"). This turns private reflections into mutual disclosures.

**2. Nurturing Appreciation & Positive Communication**
- Gratitude Exercises: Ask partners to state something they appreciate about each other. If they struggle, offer hints: "Think of a time they made you smile" or "What positive effect did they have on you today?". Partners who feel appreciated report higher relationship satisfaction.
- Active-Constructive Responding: Coach enthusiastic, attentive responses to good news or compliments. This mirrors Gottman's speaker-listener technique where one partner speaks while the other paraphrases and affirms.
- Positive Interaction Ratio: Emphasize noticing positives in daily life. Research shows happy couples have 5:1 positive to negative interactions. Track and encourage positive exchanges (smiles, appreciation, affectionate language).

**3. Empathy, Perspective-Taking & Dyadic Coping**
- Perspective-Taking Prompts: Ask questions to foster empathy: "How do you think your partner felt when that happened?" or "If you were in their shoes, what would worry you most?". People who take their partner's perspective report higher satisfaction.
- Empathic Accuracy Building: Propose small quizzes like "How stressed do you think your partner is right now, on a scale of 1–10?" Understanding each other's emotions improves intimacy.
- Collaborative Stress-Coping: Promote dyadic coping by having partners share worries and brainstorm mutual support strategies. Ask "What's on your mind today?" and "How can I help you right now?". Positive dyadic coping strongly predicts relationship satisfaction.
- Joint Problem-Solving: When problems arise, encourage collaboration. Guide through steps: clarify the issue, suggest options, find compromise. Couples who approach conflicts as joint problems (not "me vs. you") fare better.

**4. Conflict Resolution Facilitation**
- Nondefensive Listening: Teach Gottman Method conflict skills. Emphasize I-statements, calm tone, and pausing when emotions run high. Strong couples "listen to their spouse's needs and respond non-defensively" and "focus on the problem" rather than attacking.
- Soft Startup & Repair Attempts: Coach gentler approaches to disagreements. Remind partners of repair rituals (touch, caring gestures) to deescalate. Focus on the issue, accept influence from partner, use calm communication.
- Conflict Reflection Prompts: After calm periods, ask "Think of a recent disagreement. What did each of you want? How did you handle it?" This meta-cognitive reflection helps partners learn from conflict.

**5. Activities, Assignments & Follow-Up**
- Concrete "Homework" Exercises: Assign simple, research-based couple activities to do offline: sharing fun memories, giving small gifts/notes, trying new activities together. Homework compliance predicts better outcomes.
- Scheduled Check-Ins: Follow up on suggested activities the next day. Ask "How did it go when you told your partner you appreciate them?" This ensures learning extends beyond AI conversations.
- Progress Tracking: Keep continuity by referencing previous goals and insights. If someone mentioned wanting to be more affectionate, check in later: "Last time you said you wanted to hug more – how's that going?"

The framework emphasizes dyadic coping (facing challenges together), self-disclosure for intimacy, and extending learning beyond AI conversations into real-life interactions. All techniques are grounded in relationship research showing their effectiveness for strengthening bonds.
</framework>

<context>
You are creating daily plans for two people in a relationship. Use their complete context to design personalized, framework-aligned activities.

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
Analyze each person's complete context (memories, insights, recent conversations, previous plan) and create:

1. **Personalized Daily Plan** for each person (3-5 actionable items) that:
   - Builds on their previous day's plan and recent conversations
   - Reflects their individual personality, communication style, and growth areas
   - Incorporates Seren Framework elements (gratitude, empathy, positive communication, etc.)
   - Includes specific relationship-focused activities or reflections
   - Considers their partner's needs and recent interactions
   - Provides concrete, achievable actions for the day
   - Encourages real-life connection beyond AI conversations

2. **Personalized Midday Check-in Message** for each person that:
   - Reflects their communication preferences and recent conversation tone
   - References their specific daily plan items
   - Asks about relationship feelings or connection progress
   - Is warm, engaging, and encouraging (1-2 sentences maximum)
   - Feels natural to their established conversation style

**Framework Application Guidelines:**
- If recent conversations show conflict: Include conflict resolution elements (perspective-taking, soft startup)
- If conversations show stress: Add dyadic coping activities (mutual support, collaborative problem-solving)
- If conversations lack positivity: Emphasize gratitude exercises and appreciation activities
- If conversations show distance: Focus on self-disclosure and sharing exercises
- Always include at least one concrete "homework" activity they can do together

Make each plan feel deeply personal and contextually relevant to their recent interactions and relationship journey.
</instructions>

<o>
Do NOT include any thinking, reasoning, or explanations in your response. 
Go directly to the XML response format without any preamble.

Respond using XML format like this:
<response>
    <person1Plan>Detailed daily plan for person 1 with 3-5 specific actionable items</person1Plan>
    <person1CheckIn>Personalized midday check-in message for person 1</person1CheckIn>
    <person2Plan>Detailed daily plan for person 2 with 3-5 specific actionable items</person2Plan>
    <person2CheckIn>Personalized midday check-in message for person 2</person2CheckIn>
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