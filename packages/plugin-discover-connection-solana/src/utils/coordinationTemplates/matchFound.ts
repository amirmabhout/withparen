/**
 * Match Found Status Template
 * Initial match discovered, awaiting proposal
 */

export const matchFoundTemplate = `## STATUS: match_found

**Context**: A match has been found. The initiator knows about this match, and the matched user may also inquire about it.

### If isInitiator = true (The user is the initiator):
You've found a compatible match!

**Analyze the user's intent**:
Based on the message context and tone, determine if they want to:
- Propose a meeting (expressing interest, enthusiasm, or agreement)
- Ask for more information or suggest changes (different time, day, or venue)
- Decline or express hesitation

**If they want to propose a meeting**:
- Extract specific date/time from their message
- Convert to ISO 8601 format (YYYY-MM-DDTHH:mm:ss.sssZ)
- Create an engaging introduction for the other user

Output:
<newStatus>proposal_sent</newStatus>
<proposedTime>[ISO 8601 format, e.g., 2024-10-10T19:00:00.000Z]</proposedTime>
<venue>{{venue}}</venue>
<messageToUser>Perfect! I'm sending your match the meeting proposal for [human-readable time]. I'll notify you as soon as they respond!</messageToUser>
<messageToOther>Exciting news! I found you a great match. [Use the reasoning to write 1-2 sentences explaining why you're compatible - mention shared interests, complementary skills, or common goals]. They'd love to meet you at {{venue}} on [human-readable time]. Interested? Let me know if this works or if you'd prefer a different time!</messageToOther>

**If they want more information or are hesitant**:
- Ask specific questions about their preferences
- Offer to adjust time, day, or venue
- Share more compatibility insights
- Keep status unchanged

Output:
<newStatus>match_found</newStatus>
<messageToUser>I understand you might want to know more! [Address their specific concern]. What would work better for you - a different time, day, or perhaps another venue? [Use the reasoning to naturally explain why this is a good match - don't insert the reasoning verbatim, but paraphrase it in a conversational way].</messageToUser>

**If they decline**:
Output:
<newStatus>declined</newStatus>
<messageToUser>No problem at all! I'll keep looking for other potential matches that might be a better fit. Let me know when you're ready to try again.</messageToUser>

### If isInitiator = false (You are NOT the initiator):
**The matched user checking on potential matches**

Since you're the recipient of a match, the initiator hasn't sent a proposal yet. However, I can tell you about it!

**If they're inquiring about matches or seem interested**:
Output:
<newStatus>match_found</newStatus>
<messageToUser>Exciting news! I found you a compatible match to meet at {{venue}}. [Use the reasoning to explain why you're a good match in natural language - mention shared interests or complementary traits]. Do you like to propose meeting tomorrow 7PM?</messageToUser>

**If they're busy in proposed time**:
Output:
<newStatus>match_found</newStatus>
<messageToUser>Let me know if any other day works better for you and we can reschedule it.</messageToUser>
`;
