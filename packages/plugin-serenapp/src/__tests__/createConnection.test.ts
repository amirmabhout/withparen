import { describe, it, expect, vi, beforeEach } from 'bun:test';
import { createConnectionAction } from '../actions/createConnection';
import { createMockMemory } from './test-utils';

// Mock the MemgraphService
vi.mock('../services/memgraph.js', () => ({
  MemgraphService: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    findPersonByWebId: vi.fn(),
  })),
}));

describe('createConnectionAction', () => {

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('validate', () => {
    it('should return false for empty messages', async () => {
      const message = createMockMemory({
        content: {
          text: ''
        }
      });

      const result = await createConnectionAction.validate(null as any, message);
      expect(result).toBe(false);
    });

    it('should return false when no person node exists', async () => {
      const message = createMockMemory({
        content: {
          text: 'I want to create a connection with my partner'
        }
      });

      const { MemgraphService } = await import('../services/memgraph.js');
      const mockService = new MemgraphService();
      mockService.findPersonByWebId = vi.fn().mockResolvedValue(null);

      const result = await createConnectionAction.validate(null as any, message);
      expect(result).toBe(false);
    });

    it('should return false when person node exists but has no email', async () => {
      const message = createMockMemory({
        content: {
          text: 'I want to create a connection with my partner'
        }
      });

      const { MemgraphService } = await import('../services/memgraph.js');
      const mockService = new MemgraphService();
      mockService.findPersonByWebId = vi.fn().mockResolvedValue({
        webId: 'test-web-id',
        email: undefined,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z'
      });

      const result = await createConnectionAction.validate(null as any, message);
      expect(result).toBe(false);
    });

    it('should return true when person node exists with email', async () => {
      const message = createMockMemory({
        content: {
          text: 'I want to create a connection with my partner'
        }
      });

      const { MemgraphService } = await import('../services/memgraph.js');
      const mockService = new MemgraphService();
      mockService.findPersonByWebId = vi.fn().mockResolvedValue({
        webId: 'test-web-id',
        email: 'test@example.com',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z'
      });

      const result = await createConnectionAction.validate(null as any, message);
      expect(result).toBe(true);
    });

    it('should return false when memgraph service throws an error', async () => {
      const message = createMockMemory({
        content: {
          text: 'I want to create a connection with my partner'
        }
      });

      const { MemgraphService } = await import('../services/memgraph.js');
      const mockService = new MemgraphService();
      mockService.findPersonByWebId = vi.fn().mockRejectedValue(new Error('Connection failed'));

      const result = await createConnectionAction.validate(null as any, message);
      expect(result).toBe(false);
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