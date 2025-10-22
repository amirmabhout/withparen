/**
 * Base Coordination Template
 * Shared sections used by all status-specific templates
 */

export const baseHeader = `# Coordination Handler

## Match Overview
- **Compatibility Score**: {{compatibilityScore}}/100
- **Match Status**: {{status}}
- **Venue**: {{venue}}
- **Proposed Time**: {{proposedTime}}
- **Compatibility Reasoning**: {{reasoning}}

---

## INITIATOR USER DETAILS
- **User ID**: {{userFromId}}
- **Display Name**: {{userFromName}}
- **Identification Clue**: {{initiatorClue}}

### Initiator's Persona
{{initiatorPersona}}

### Initiator's Recent Messages (Last 5)
{{initiatorMessages}}

---

## MATCHED USER DETAILS
- **User ID**: {{userToId}}
- **Display Name**: {{userToName}}
- **Identification Clue**: {{matchedClue}}

### Matched User's Persona
{{matchedPersona}}

### Matched User's Recent Messages (Last 5)
{{matchedMessages}}

---

## CURRENT INTERACTION CONTEXT
- **You are responding to**: {{isInitiator}} (true = Initiator, false = Matched User)
- **Current User ID**: {{currentUserId}}
- **Current User's Message**: {{userMessage}}

## Meeting Feedback History
{{existingFeedback}}

---

# COORDINATION LOGIC FOR CURRENT STATUS

`;

export const baseFooter = `
---

# RESPONSE FORMAT

## IMPORTANT: Date/Time Format
Today's date is: {{currentDate}}
Current time is: {{currentTime}}

When setting proposedTime, you MUST use ISO 8601 format: YYYY-MM-DDTHH:mm:ss.sssZ
Example: 2024-10-10T19:00:00.000Z for October 10, 2024 at 7:00 PM UTC

Calculate the exact date based on:
- If user says "tomorrow" - add 1 day to current date
- If user says "Thursday" - find the next Thursday from today
- If user says "next week" - add 7 days
- Always include specific time (if user says "evening", use 19:00:00)

You MUST respond ONLY with this XML format:

<response>
  <newStatus>The updated status (one of: match_found, proposal_sent, accepted, completed, declined, cancelled)</newStatus>
  <proposedTime>Meeting datetime in ISO 8601 format (YYYY-MM-DDTHH:mm:ss.sssZ) when setting/updating</proposedTime>
  <venue>Venue if setting for first time</venue>
  <clue>Current user's identification clue if they provided it</clue>
  <feedback>User's feedback about the meeting (only when they provide substantial feedback after follow-up questions)</feedback>
  <messageToUser>Message to send back to current user (ALWAYS required)</messageToUser>
  <messageToOther>Message to send to other user (optional, only if they need to know)</messageToOther>
</response>

## CRITICAL RULES:
1. ALWAYS provide messageToUser
2. Only provide messageToOther if the other person needs to be notified
3. Only change status when logic clearly indicates state transition
4. Extract and save clues, venue and proposed times whenever mentioned or changed
5. proposedTime MUST be in ISO 8601 format (e.g., 2024-10-10T19:00:00.000Z)
6. Only extract feedback after asking follow-up questions and getting substantial details
7. Only transition to completed if BOTH users provided feedback
8. Keep messages warm, friendly, and context-appropriate
9. No text outside the <response></response> XML block

START YOUR RESPONSE WITH <response> NOW:
`;
