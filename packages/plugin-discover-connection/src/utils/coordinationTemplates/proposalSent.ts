/**
 * Proposal Sent Status Template
 * One user sent meeting proposal, awaiting response
 */

export const proposalSentTemplate = `## STATUS: proposal_sent

**Context**: A meeting proposal has been sent and is awaiting response. Proposed time: {{proposedTime}} (in ISO format).

### If isInitiator = true (You sent the proposal):
The other user has received your proposal to meet at {{venue}} on [human-readable version of {{proposedTime}}].

**Analyze the user's intent**:
- Are they checking on the status?
- Are they modifying their proposal (time/venue)?
- Are they cancelling?

**Default response (checking status)**:
Output:
<newStatus>proposal_sent</newStatus>
<messageToUser>Still waiting to hear back from your match about your meeting at {{venue}} on [human-readable time]. I'll notify you as soon as they respond!</messageToUser>

**If modifying proposal**:
Extract new details and convert time to ISO format.

Output:
<newStatus>proposal_sent</newStatus>
<proposedTime>[new time in ISO 8601 format if changed]</proposedTime>
<messageToUser>I'll update your match with the new proposal details.</messageToUser>
<messageToOther>Your match would like to adjust the meeting to [describe changes]. Does this work for you?</messageToOther>

**If cancelling**:
Output:
<newStatus>cancelled</newStatus>
<messageToUser>I'll let your match know the meeting is cancelled. Would you like me to search for other matches?</messageToUser>
<messageToOther>Your match needs to cancel the meeting. Would you like me to find other potential matches for you?</messageToOther>

### If isInitiator = false (You received a proposal):
Your match has proposed meeting at {{venue}} on [human-readable version of {{proposedTime}}].

**Analyze the user's response intent**:
Based on context and tone, determine if they are:
- Accepting the time and venue
- Declining the proposal
- Suggesting an alternative time
- Asking questions about the match or meeting

**If accepting the time and venue**:
Move to accepted status WITHOUT requiring a clue yet.

Output:
<newStatus>accepted</newStatus>
<messageToUser>Wonderful! You're confirmed for [human-readable time] at {{venue}}. To help you recognize each other, how would you describe yourself or what will you be wearing?</messageToUser>
<messageToOther>Great news! Your match accepted your proposal for [human-readable time] at {{venue}}! We're now collecting identification details so you can find each other.</messageToOther>

**If declining**:
Output:
<newStatus>declined</newStatus>
<messageToUser>No problem at all! Would you like me to search for other potential matches?</messageToUser>
<messageToOther>Your match isn't able to meet at this time. Would you like me to find other potential matches for you?</messageToOther>

**If suggesting alternative time**:
Extract the alternative time and convert to ISO format.

Output:
<newStatus>proposal_sent</newStatus>
<proposedTime>[new time in ISO 8601 format, e.g., 2024-10-12T18:00:00.000Z]</proposedTime>
<messageToUser>I'll check if [human-readable alternative time] works for your match instead.</messageToUser>
<messageToOther>Your match is interested but suggests [human-readable alternative time] instead. Would this work for you at {{venue}}?</messageToOther>

**If asking questions**:
Keep status unchanged and answer their questions.

Output:
<newStatus>proposal_sent</newStatus>
<messageToUser>[Answer their specific questions about the match, venue, or timing. Share compatibility reasoning if asked.]</messageToUser>
`;
