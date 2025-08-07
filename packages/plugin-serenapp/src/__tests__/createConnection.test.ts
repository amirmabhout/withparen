import { describe, it, expect } from 'bun:test';
import { createConnectionAction } from '../actions/createConnection';
import { createMockMemory } from './test-utils';

describe('createConnectionAction', () => {

  describe('validate', () => {
    it('should return true for messages with connection keywords', async () => {
      const message = createMockMemory({
        content: {
          text: 'I want to create a connection with my partner'
        }
      });

      const result = await createConnectionAction.validate(null as any, message);
      expect(result).toBe(true);
    });

    it('should return true for longer messages (serenapp is permissive)', async () => {
      const message = createMockMemory({
        content: {
          text: 'Hello, how are you today?'
        }
      });

      const result = await createConnectionAction.validate(null as any, message);
      expect(result).toBe(true);
    });

    it('should return true for any non-empty message', async () => {
      const message = createMockMemory({
        content: {
          text: 'hi'
        }
      });

      const result = await createConnectionAction.validate(null as any, message);
      expect(result).toBe(true);
    });

    it('should return true for "hey"', async () => {
      const message = createMockMemory({
        content: {
          text: 'hey'
        }
      });

      const result = await createConnectionAction.validate(null as any, message);
      expect(result).toBe(true);
    });

    it('should return true even for goodbye messages (completely permissive)', async () => {
      const message = createMockMemory({
        content: {
          text: 'bye'
        }
      });

      const result = await createConnectionAction.validate(null as any, message);
      expect(result).toBe(true);
    });

    it('should return false only for empty messages', async () => {
      const message = createMockMemory({
        content: {
          text: ''
        }
      });

      const result = await createConnectionAction.validate(null as any, message);
      expect(result).toBe(false);
    });

    it('should return true for messages with name and secret patterns', async () => {
      const message = createMockMemory({
        content: {
          text: 'My name is John and our secret word is rainbow'
        }
      });

      const result = await createConnectionAction.validate(null as any, message);
      expect(result).toBe(true);
    });
  });

  describe('basic functionality', () => {
    it('should have correct name and description', () => {
      expect(createConnectionAction.name).toBe('CREATE_CONNECTION');
      expect(createConnectionAction.description).toContain('Creates a new human connection');
    });

    it('should have examples', () => {
      expect(createConnectionAction.examples).toBeDefined();
      expect(createConnectionAction.examples.length).toBeGreaterThan(0);
    });

    it('should have similes', () => {
      expect(createConnectionAction.similes).toBeDefined();
      expect(createConnectionAction.similes).toContain('CREATE_HUMAN_CONNECTION');
    });
  });
});