/**
 * Feedback Request Template
 * Used for collecting post-meeting feedback from users
 */

export const feedbackRequestTemplate = `## STATUS: accepted (post-meeting feedback collection)

**Context**: The meeting at {{venue}} on [human-readable version of {{proposedTime}}] has passed.
We're now collecting feedback to improve future matches.

**Meeting Details**:
- Venue: {{venue}}
- Time: [human-readable version of {{proposedTime}}]
- Your clue: {{isInitiator}} ? {{user1Clue}} : {{user2Clue}}
- Their clue: {{isInitiator}} ? {{user2Clue}} : {{user1Clue}}

**Current Feedback Status**:
- Your feedback: {{currentUserFeedback}} (if provided)
- Other user's feedback: {{otherUserFeedback}} (if provided)

**Analyze the user's response**:
Determine if they are:
- Providing initial feedback about the meeting
- Answering follow-up questions about the meeting
- Declining to provide feedback
- Asking about next steps or new matches

**If initial feedback mention (vague or brief)**:
Ask follow-up questions to get substantial details.

Output:
<newStatus>accepted</newStatus>
<messageToUser>That's wonderful to hear! I'd love to know more - what did you two talk about? What was the highlight of your meeting at {{venue}}?</messageToUser>

**If providing substantial feedback (with details)**:
Extract detailed feedback. Check if other user already provided feedback.

Output when OTHER USER hasn't provided feedback yet:
<newStatus>accepted</newStatus>
<feedback>[Extract detailed feedback including: meeting outcome, topics discussed, overall experience]</feedback>
<messageToUser>Thank you so much for sharing your experience! I'm glad you had a [positive/interesting/good] time. Your feedback helps me find even better matches in the future. Would you like me to look for more connections?</messageToUser>

Output when OTHER USER already provided feedback:
<newStatus>completed</newStatus>
<feedback>[Extract detailed feedback including: meeting outcome, topics discussed, overall experience]</feedback>
<messageToUser>Thank you for the feedback! Both of you had a great experience - that's wonderful! Your input helps me improve future matches. Ready for me to find your next great connection?</messageToUser>

**If declining to provide feedback**:
Respect their choice but gently encourage if possible.

Output:
<newStatus>accepted</newStatus>
<messageToUser>No problem at all! If you change your mind, I'd love to hear even briefly how it went - it helps me find better matches. Would you like me to search for new connections?</messageToUser>

**If asking about next steps or new matches**:
Handle their request while still trying to collect feedback if not provided.

Output when feedback NOT yet provided:
<newStatus>accepted</newStatus>
<messageToUser>I'd be happy to find new matches for you! Before we move on, could you briefly share how your meeting went? Even a quick note helps me improve future matches.</messageToUser>

Output when feedback already provided:
<newStatus>completed</newStatus>
<messageToUser>Absolutely! I'll start searching for new compatible connections for you. Thanks again for the feedback about your meeting!</messageToUser>

**If meeting didn't happen or was cancelled last minute**:
Output:
<newStatus>cancelled</newStatus>
<messageToUser>I'm sorry to hear the meeting didn't work out. These things happen! Would you like me to find you another match to try again?</messageToUser>
<messageToOther>I understand the meeting didn't happen as planned. Would you like me to search for other potential matches?</messageToOther>
`;