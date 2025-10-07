import { describe, it, expect } from 'bun:test';
import {
  buildCoordinationPrompt,
  type CoordinationTemplateContext,
} from '../utils/coordinationTemplate.js';
import { MatchStatus } from '../services/userStatusService.js';

describe('Coordination Template Tests', () => {
  const baseContext: CoordinationTemplateContext = {
    // Match details
    userFromId: 'user1-id',
    userFromName: 'Alice',
    userToId: 'user2-id',
    userToName: 'Bob',
    compatibilityScore: 85,
    reasoning: 'Both enjoy similar interests and communication styles',

    // Current context
    currentUserId: 'user1-id',
    isInitiator: true,
    status: MatchStatus.MATCH_FOUND,
    venue: 'Coffee House',
    proposedTime: 'Tomorrow at 6pm',

    // Date/Time context for LLM
    currentDate: 'Monday, October 10, 2024',
    currentTime: '2024-10-10T10:00:00.000Z',

    // Initiator user details
    initiatorPersona: 'Enthusiastic and social',
    initiatorMessages: '[2024-01-01 10:00:00] Alice: lets find someone to meet',
    initiatorClue: 'Blue jacket',

    // Matched user details
    matchedPersona: 'Thoughtful and engaging',
    matchedMessages: '[2024-01-01 10:05:00] Bob: looking for interesting conversations',
    matchedClue: 'Red scarf',

    // Current interaction
    userMessage: 'yes lets do it',
    existingFeedback: 'No feedback yet',
  };

  describe('match_found status', () => {
    it('should handle initiator proposing a meeting', () => {
      const prompt = buildCoordinationPrompt(MatchStatus.MATCH_FOUND, {
        ...baseContext,
        isInitiator: true,
        userMessage: 'yes lets do it',
      });

      // Check that the prompt includes initiator-specific logic
      expect(prompt).toContain('If isInitiator = true');
      expect(prompt).toContain('The user is the initiator');
      expect(prompt).toContain("You've found a compatible match!");
      expect(prompt).toContain("Analyze the user's intent");

      // Check venue is dynamic
      expect(prompt).toContain('Coffee House');
      expect(prompt).not.toContain('Bantabaa Restaurant');
    });

    it('should handle non-initiator error state', () => {
      const prompt = buildCoordinationPrompt(MatchStatus.MATCH_FOUND, {
        ...baseContext,
        isInitiator: false,
      });

      // Non-initiators can inquire about matches
      expect(prompt).toContain('If isInitiator = false');
      expect(prompt).toContain('You are NOT the initiator');
    });
  });

  describe('proposal_sent status', () => {
    it('should handle initiator checking status', () => {
      const prompt = buildCoordinationPrompt(MatchStatus.PROPOSAL_SENT, {
        ...baseContext,
        status: MatchStatus.PROPOSAL_SENT,
        isInitiator: true,
        userMessage: 'any update?',
      });

      expect(prompt).toContain('proposal_sent');
      expect(prompt).toContain('You sent the proposal');
      expect(prompt).toContain('Coffee House');
    });

    it('should handle recipient accepting proposal', () => {
      const prompt = buildCoordinationPrompt(MatchStatus.PROPOSAL_SENT, {
        ...baseContext,
        status: MatchStatus.PROPOSAL_SENT,
        isInitiator: false,
        userMessage: 'sounds good, I\'ll be wearing a green hat',
      });

      expect(prompt).toContain('You received a proposal');
      expect(prompt).toContain('Your match has proposed meeting');
    });
  });

  describe('venue handling', () => {
    it('should use dynamic venue from context', () => {
      const customVenue = 'The Meeting Place';
      const prompt = buildCoordinationPrompt(MatchStatus.ACCEPTED, {
        ...baseContext,
        status: MatchStatus.ACCEPTED,
        venue: customVenue,
      });

      expect(prompt).toContain(customVenue);
      expect(prompt).not.toContain('Bantabaa');
    });

    it('should handle empty venue', () => {
      const prompt = buildCoordinationPrompt(MatchStatus.MATCH_FOUND, {
        ...baseContext,
        venue: '',
      });

      // Empty venue should just be replaced with empty string
      expect(prompt).toContain('**Venue**: ');
    });
  });

  describe('template variable replacement', () => {
    it('should replace all template variables correctly', () => {
      const prompt = buildCoordinationPrompt(MatchStatus.ACCEPTED, {
        ...baseContext,
        status: MatchStatus.ACCEPTED,
      });

      // Check all variables are replaced
      expect(prompt).not.toContain('{{userFromName}}');
      expect(prompt).not.toContain('{{userToName}}');
      expect(prompt).not.toContain('{{venue}}');
      expect(prompt).not.toContain('{{proposedTime}}');

      // Check actual values are present
      expect(prompt).toContain('Alice');
      expect(prompt).toContain('Bob');
      expect(prompt).toContain('Coffee House');
      expect(prompt).toContain('Tomorrow at 6pm');
    });
  });

  describe('critical rules', () => {
    it('should include updated critical rules', () => {
      const prompt = buildCoordinationPrompt(MatchStatus.MATCH_FOUND, baseContext);

      // Check updated rules
      expect(prompt).toContain('Keep messages warm, friendly, and context-appropriate');
      expect(prompt).toContain('Extract and save clues, venue and proposed times whenever mentioned');
      expect(prompt).toContain('Only transition to completed if BOTH users provided feedback');
    });
  });
});