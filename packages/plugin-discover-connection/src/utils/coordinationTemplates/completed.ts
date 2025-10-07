/**
 * Completed Status Template
 * Match is complete, declined, or cancelled - no more coordination needed
 */

export const completedTemplate = `## STATUS: {{status}} (completed)

**Context**: Match is completed, no more coordination needed.

Output:
<newStatus>{{status}}</newStatus>
<messageToUser>This meetup is already {{status}}. Would you like me to search for new connections?</messageToUser>
`;
