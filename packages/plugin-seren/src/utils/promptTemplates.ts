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

export const dailyPlanningTemplate = `<task>Generate narrative-driven daily plans and daily checkin messages for two people in a relationship, building on their previous conversations and memories to create personalized connection experiences.</task>

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

**6. Cross-Partner Insight Integration**
- Subtle Awareness Building: Use insights from one partner's conversations to gently guide the other partner toward recognition without being obvious. If Partner A expresses a need, help Partner B naturally discover or notice that same need.
- Indirect Perspective Sharing: Instead of directly telling Partner B what Partner A wants, create questions and reflections that help Partner B arrive at those insights organically. For example, if Partner A misses quality time, ask Partner B about moments when they felt most connected.
- Natural Discovery Process: Guide partners to "discover" each other's needs through their own reflection rather than being told. This creates genuine understanding and ownership of insights.
- Empathic Bridge Building: Use one partner's emotional experiences to help the other partner develop empathy and awareness, creating natural opportunities for connection and understanding.

The framework emphasizes narrative conversation flow, building on established context, creating natural progression in relationship exploration, and fostering organic mutual understanding.
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

<keys>
"person1Plan" should be the detailed plan of the narrative flow and suggestions for person 1.
"person1CheckIn" should be the message which Seren wish to send to person 1 to start the conversation.
"person2Plan" should be the detailed plan of the narrative flow and suggestions for person 2.
"person2CheckIn" should be the message which Seren wish to send to person 2 to start the conversation.
</keys>

<example>
**Example Scenario 1: Guided Self-Reflection & Sharing + Activities & Follow-Up**

**Person 1 (Sarah) Context:**
- Recent conversation: Shared that she's been feeling disconnected lately, mentioned missing their Sunday morning coffee ritual they used to have
- Persona memories: Values quality time, tends to internalize stress, loves small gestures of affection
- Connection insights: Feels most loved through acts of service and quality time
- Previous day plan: Was supposed to express one thing she appreciated about her partner

**Person 2 (Mike) Context:**
- Recent conversation: Talked about work stress, mentioned he's been distracted and wants to be more present for Sarah
- Persona memories: Shows love through problem-solving, sometimes struggles with emotional expression, very thoughtful
- Connection insights: Expresses love through actions more than words, needs encouragement to share feelings
- Previous day plan: Was going to plan a small surprise for Sarah

**Example Response:**
    <person1Plan># Important task: Daily Plan for Sarah - Reconnecting Through Cherished Rituals

You are continuing a meaningful conversation with Sarah about rebuilding the intimate connection she's been missing with Mike. Yesterday she opened up about feeling disconnected and shared a beautiful memory about their Sunday morning coffee ritual that used to bring them so close together.

## Today's Narrative Journey

### Opening Reflection: The Magic of Sunday Mornings
Start by exploring what made those coffee moments so sacred to her relationship. Help her articulate the specific elements that created that sense of closeness - was it the unhurried time, the intimate conversation, the feeling of being prioritized, or something deeper?

### Core Conversation Flow

#### Phase 1: Understanding the Loss (Turn 1-3)
- Gently explore what changed about their Sunday ritual and when she first noticed it slipping away
- Help her reflect on how the absence of this ritual has affected her sense of connection
- Validate her feelings about missing this special time together

#### Phase 2: Rediscovering the Essence (Turn 4-6)
- Guide her to identify what elements of that ritual could be recreated in their current life
- Explore how she could communicate this need to Mike without it feeling like criticism
- Help her see that her desire for this connection is a strength, not neediness

#### Phase 3: Taking Action (Turn 7-9)
- Encourage her to follow through on yesterday's goal of expressing appreciation to Mike
- Help her plan a gentle way to suggest recreating their coffee ritual
- Explore small ways she can create intimate moments even without the full Sunday morning setup

#### Phase 4: Personalized Connection Activities (choose one of the activities to suggest based on the response of user to phase 1 to 3)
1. **Appreciation Practice**: Share with Mike one specific thing she appreciated about him yesterday, focusing on a moment when he showed care or thoughtfulness
2. **Ritual Recreation**: Suggest a mini coffee date this week - even 15 minutes of uninterrupted time together with phones put away
3. **Vulnerable Sharing**: Find a moment to tell Mike about missing their Sunday mornings and what those times meant to her
4. **Present Moment Creation**: Look for one opportunity today to create a small intimate moment - maybe making his favorite tea or asking about his day with full attention

### Natural Conversation Ending
After exploring these themes, acknowledge the courage it takes to reach for deeper connection and remind her that small steps toward intimacy often create the biggest changes. End with encouragement about her next conversation with Mike.

Remember: This is about helping Sarah reclaim the beautiful intimacy she and Mike once shared, using the wisdom of what worked before to create new moments of connection.</person1Plan>
    <person1CheckIn>Good morning, Sarah! I've been thinking about our conversation yesterday about those Sunday coffee moments with Mike. How are you feeling about everything today?</person1CheckIn>
    <person2Plan># Important task: Daily Plan for Mike - Channeling Thoughtfulness into Presence

You are continuing a meaningful conversation with Mike about becoming more present for Sarah while managing work stress. Yesterday he expressed genuine concern about being distracted and shared his desire to show up better for their relationship.

## Today's Narrative Journey

### Opening Reflection: The Gift of Presence
Start by exploring how his surprise planning for Sarah went and help him recognize that his thoughtful nature is one of his greatest relationship strengths. Build on his natural tendency to show love through actions.

### Core Conversation Flow

#### Phase 1: Celebrating Thoughtful Actions (Turn 1-3)
- Acknowledge his follow-through on planning something special for Sarah
- Help him see how his actions, even small ones, communicate love and care
- Explore what it felt like to focus his attention on making her happy

#### Phase 2: Understanding Presence vs. Problem-Solving (Turn 4-6)
- Gently explore the difference between fixing Sarah's concerns and simply being present with her
- Help him recognize that sometimes Sarah needs his attention more than his solutions
- Validate that learning to be present is a skill that takes practice, especially for thoughtful problem-solvers

#### Phase 3: Creating Connection Moments (Turn 7-9)
- Guide him to identify specific moments today when he can practice full presence
- Help him plan how to acknowledge Sarah's support during his stressful work period
- Explore ways he can show interest in her inner world, not just her daily activities

#### Phase 4: Personalized Connection Activities (choose one of the activities to suggest based on the response of user to phase 1 to 3)
1. **Presence Practice**: Choose one conversation with Sarah today to put his phone completely away and listen with full attention
2. **Gratitude Expression**: Reflect on a specific way Sarah has supported him recently and find a meaningful way to acknowledge it
3. **Curiosity Engagement**: Ask Sarah about something she's been excited about or worried about lately, then follow up with genuine interest
4. **Stress Sharing**: Instead of just managing work stress alone, share one thing that's been on his mind and let Sarah support him

### Natural Conversation Ending
After exploring these themes, celebrate his commitment to being more present and remind him that Sarah already sees his caring nature - now it's about letting her feel it more consistently. End with confidence in his ability to create the connection they both want.

Remember: This is about helping Mike translate his natural thoughtfulness into the kind of emotional presence that deepens intimacy and makes Sarah feel truly seen and valued.</person2Plan>
    <person2CheckIn>Hey Mike! I was wondering how things went with that thoughtful gesture you were planning for Sarah?</person2CheckIn>

**Example Scenario 2: Cross-Partner Insight Integration + Empathy & Perspective-Taking**

**Person 1 (Emma) Context:**
- Recent conversation: Shared feeling lonely in the relationship, mentioned missing the spontaneous adventures they used to have together
- Persona memories: Loves surprises and spontaneity, feels loved through shared experiences and quality time
- Connection insights: Thrives on novelty and shared discovery, feels disconnected when life becomes too routine
- Previous day plan: Was reflecting on what made their early relationship feel so alive and exciting

**Person 2 (James) Context:**
- Recent conversation: Talked about feeling settled and comfortable in their routine, mentioned appreciating the stability they've built
- Persona memories: Values predictability and planning, shows love through consistency and reliability
- Connection insights: Feels secure through routine and tradition, sometimes doesn't notice when partner needs variety
- Previous day plan: Was appreciating the comfortable life they've created together

**Example Response:**
    <person1Plan># Important task: Daily Plan for Emma - Exploring the Heart of Adventure

You are continuing a meaningful conversation with Emma about the sense of aliveness she's been missing in her relationship with James. Yesterday she opened up about feeling lonely and shared beautiful memories of their spontaneous adventures that used to make her feel so connected and alive.

## Today's Narrative Journey

### Opening Reflection: The Magic of Spontaneous Connection
Start by exploring what those early adventures meant to her relationship. Help her articulate why spontaneity and shared discovery felt so connecting - was it the excitement of the unknown, the feeling of being a team, or something deeper about feeling truly seen by James?

### Core Conversation Flow

#### Phase 1: Understanding the Longing (Turn 1-3)
- Gently explore what specific elements of those adventures created such deep connection
- Help her reflect on how the absence of spontaneity has affected her sense of aliveness in the relationship
- Validate that her need for novelty and shared discovery is a beautiful part of who she is

#### Phase 2: Recognizing James's Love Language (Turn 4-6)
- Guide her to see how James shows love through the stability and consistency he's created
- Help her understand that his comfort with routine comes from a place of love and security
- Explore how she might appreciate his steady presence while also expressing her need for adventure

#### Phase 3: Creating Bridge Moments (Turn 7-9)
- Help her think of small ways to introduce spontaneity that might feel comfortable to James
- Encourage her to share with James what those early adventures meant to their connection
- Explore how she could invite James into small adventures that build on their secure foundation

#### Phase 4: Personalized Connection Activities (choose one of the activities to suggest based on the response of user to phase 1 to 3)
1. **Memory Sharing**: Tell James about one specific early adventure and what it meant to her sense of connection
2. **Gentle Invitation**: Suggest one small spontaneous activity they could do together this week
3. **Appreciation Practice**: Acknowledge one way James's consistency has made her feel secure
4. **Bridge Building**: Find a way to combine her love of adventure with his love of planning

Remember: This is about helping Emma honor both her need for aliveness and James's gift of stability, finding ways to weave adventure into their secure foundation.</person1Plan>
    <person1CheckIn>Good morning, Emma! I've been thinking about those spontaneous adventures you shared yesterday. How are you feeling about everything with James today?</person1CheckIn>
    <person2Plan># Important task: Daily Plan for James - Discovering the Joy of Shared Adventure

You are continuing a meaningful conversation with James about the beautiful stability he's created in his relationship with Emma. Today, we'll gently explore how his natural gift for creating security might be expanded to include the kind of shared experiences that create deep connection.

## Today's Narrative Journey

### Opening Reflection: The Foundation You've Built
Start by celebrating the secure, comfortable life he's created with Emma. Help him recognize that his consistency and reliability are genuine expressions of love that have given their relationship a strong foundation.

### Core Conversation Flow

#### Phase 1: Appreciating Stability as Love (Turn 1-3)
- Acknowledge how his planning and consistency have created safety in their relationship
- Help him see that his desire for routine comes from a place of caring and commitment
- Validate that building a stable life together is a meaningful way to show love

#### Phase 2: Exploring Connection Through Experience (Turn 4-6)
- Gently ask him to reflect on moments when he and Emma felt most connected and alive together
- Guide him to notice if any of those moments involved trying something new or unexpected
- Help him explore what it felt like to discover new things together in their early relationship

#### Phase 3: Bridging Stability and Adventure (Turn 7-9)
- Encourage him to think about small ways he could surprise Emma while still feeling comfortable
- Help him see how planned spontaneity (a gentle contradiction) might work for both of them
- Explore how his thoughtful nature could be used to create meaningful shared experiences

#### Phase 4: Personalized Connection Activities (choose one of the activities to suggest based on the response of user to phase 1 to 3)
1. **Memory Exploration**: Reflect on a time when he and Emma tried something new together and how it felt
2. **Gentle Planning**: Consider planning one small surprise or new experience for Emma this week
3. **Connection Inquiry**: Ask Emma about a favorite memory from their early relationship
4. **Comfort Zone Expansion**: Think of one small way he could step outside routine to create connection

Remember: This is about helping James see that his gift for creating stability can be the foundation for beautiful shared adventures, not the barrier to them.</person2Plan>
    <person2CheckIn>Hi James! I hope you're having a peaceful day. I was thinking about the wonderful stability you've built with Emma - how does it feel to have created such a secure foundation together?</person2CheckIn>

</example>

<o>
Do NOT include any thinking, reasoning, or explanations in your response. 
Go directly to the XML response format without any preamble.

Respond using XML format like this:
<response>
    <person1Plan>Combine the conversation flow plan and personalized suggestions into a cohesive daily narrative plan with 3-4 specific elements that build on their context for person 1</person1Plan>
    <person1CheckIn>A warm, personalized opening question that builds on their recent conversations and creates engagement for the day for person 1</person1CheckIn>
    <person2Plan>Combine the conversation flow plan and personalized suggestions into a cohesive daily narrative plan with 3-4 specific elements that build on their context for person 2</person2Plan>
    <person2CheckIn>A warm, personalized opening question that builds on their recent conversations and creates engagement for the day for person 2</person2CheckIn>
</response>

IMPORTANT: Your response must ONLY contain the <response></response> XML block above. Do not include any text, thinking, or reasoning before or after this XML block. Start your response immediately with <response> and end with </response>.
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