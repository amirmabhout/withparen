/**
 * Accepted Status Template
 * Handles both acceptance phase and fully confirmed meetings (previously "scheduled")
 * Includes: collecting clues, confirming details, handling delays, and post-meeting feedback
 */

export const acceptedTemplate = `## STATUS: accepted

**Context**: Both users have accepted the meeting. Coordinating details for {{venue}} at [human-readable version of {{proposedTime}}].
Meeting time in ISO format: {{proposedTime}}
Current date/time: {{currentDate}} at {{currentTime}}

**Current clues**:
- Initiator: {{initiatorClue}}
- Matched User: {{matchedClue}}

**First, check if meeting time has passed**:
Compare {{currentTime}} with {{proposedTime}} to determine if this is about a past or future meeting.

## IF MEETING TIME HAS PASSED (Post-Meeting Feedback Collection)

**Analyze if user is providing feedback about completed meeting**:
Look for indicators like: "we met", "it went", "was nice", "had dinner", etc.

**If initial feedback mention (vague or brief)**:
**IMPORTANT**: One response is NOT enough - ask 1-2 follow-up questions
Examples: "What did you talk about?", "What was the highlight?", "How did you recognize each other?"

Output:
<newStatus>accepted</newStatus>
<messageToUser>That's great to hear! Tell me more - what did you talk about? What was the highlight of your meeting at {{venue}}?</messageToUser>

**If providing substantial feedback (after follow-ups)**:
Check if OTHER user already provided feedback (look at existingFeedback).

Output when OTHER user hasn't provided feedback yet:
<newStatus>accepted</newStatus>
<feedback>[Extract their detailed feedback about the meeting]</feedback>
<messageToUser>Thank you for the feedback! I'm glad your meeting went well. I'll check in with your match to hear about their experience too.</messageToUser>

Output when OTHER user already provided feedback:
<newStatus>completed</newStatus>
<feedback>[Extract their detailed feedback about the meeting]</feedback>
<messageToUser>Wonderful! So glad your dinner at {{venue}} was a success. Both of you enjoyed the meeting! Would you like me to search for more connections?</messageToUser>

## IF MEETING TIME IS IN THE FUTURE

**Analyze the user's message intent**:
Determine if they are:
- Providing their identification clue (if not yet provided)
- Confirming the time and venue
- Requesting changes to time or venue
- Running late or experiencing delays
- Needing to reschedule or cancel
- Sending messages or questions to the other person

### COLLECTING CLUES (if both clues not yet provided)

**If providing identification clue**:
Check if both users have provided clues.

Output when BOTH users NOW have clues:
<newStatus>accepted</newStatus>
<clue>[current user's identification]</clue>
<messageToUser>Perfect! You're all set for [human-readable time] at {{venue}}. You'll be [your clue], and your match will be [their clue]. Looking forward to your meeting!</messageToUser>
<messageToOther>All confirmed! Meeting at {{venue}} on [human-readable time]. You'll be [your clue], and your match will be [their clue]. Have a wonderful time!</messageToOther>

Output when still need other user's clue:
<newStatus>accepted</newStatus>
<clue>[current user's identification]</clue>
<messageToUser>Got it! I'll share that with your match. Just waiting for their identification details, then you're all set for [human-readable time]!</messageToUser>
<messageToOther>Your match will be [clue] at {{venue}} on [human-readable time]. How would you like them to recognize you?</messageToOther>

### FULLY CONFIRMED MEETING (both clues provided)

**If Running Late**:
Extract delay estimate if provided and notify other user.

Output:
<newStatus>accepted</newStatus>
<messageToUser>No worries! I'll let them know you're running late for your [human-readable time] meeting.</messageToUser>
<messageToOther>Quick heads up - they're running a bit late [delay details if provided]. They'll meet you at {{venue}} as soon as they can!</messageToOther>

**If Need to Reschedule**:
Move back to proposal_sent to allow new negotiation.

Output:
<newStatus>proposal_sent</newStatus>
<proposedTime></proposedTime>
<messageToUser>I understand - things come up! Let me check with them about rescheduling. What time would work better for you?</messageToUser>
<messageToOther>They need to reschedule your [human-readable time] dinner. Are you open to finding a new time that works for both of you?</messageToOther>

**If Confirming Meeting Details**:
Output:
<newStatus>accepted</newStatus>
<messageToUser>Yes, you're all set for [human-readable time] at {{venue}}! Remember: they'll be [their clue], and you mentioned you'll be [your clue]. See you there!</messageToUser>

### REQUESTING CHANGES

**If requesting time changes**:
Extract the requested changes and convert new time to ISO format.

Output:
<newStatus>proposal_sent</newStatus>
<proposedTime>[new time in ISO 8601 format, e.g., 2024-10-12T20:00:00.000Z]</proposedTime>
<messageToUser>I'll check if [human-readable new time] works better for your match.</messageToUser>
<messageToOther>Your match is asking if you could meet at [human-readable new time] instead. Would this work for you at {{venue}}?</messageToOther>

**If requesting venue changes**:
Output:
<newStatus>accepted</newStatus>
<venue>[new venue if specified]</venue>
<messageToUser>I'll check if your match is okay with changing the venue to [new venue].</messageToUser>
<messageToOther>Your match is wondering if you'd be open to meeting at [new venue] instead of {{venue}} at the same time. Would this work for you?</messageToOther>

### GENERAL ACTIONS

**If Canceling**:
Output:
<newStatus>cancelled</newStatus>
<messageToUser>I understand. I'll let them know the meeting is cancelled.</messageToUser>
<messageToOther>Unfortunately they need to cancel your dinner at {{venue}}. Would you like me to search for other potential matches for you?</messageToOther>

**If sending a message or question**:
Relay the message while maintaining accepted status.

Output:
<newStatus>accepted</newStatus>
<messageToUser>I'll pass that along to your match.</messageToUser>
<messageToOther>Message from your match: "{{userMessage}}"</messageToOther>

**If confirming without changes (no clues yet)**:
Output:
<newStatus>accepted</newStatus>
<messageToUser>Great! The meeting is confirmed for [human-readable time] at {{venue}}. Just need your identification details - what will you be wearing or how should your match recognize you?</messageToUser>
`;