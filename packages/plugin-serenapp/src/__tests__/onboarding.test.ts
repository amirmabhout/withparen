import { describe, it, expect, beforeEach, mock, spyOn } from 'bun:test';
import { onboardingProvider } from '../providers/onboarding';
import { MemgraphService } from '../services/memgraph';
import { createMockRuntime, createMockMemory, createMockState } from './test-utils';
import { logger } from '@elizaos/core';

describe('Onboarding Provider', () => {
  let mockRuntime: any;
  let mockMemgraphService: any;

  beforeEach(() => {
    // Spy on logger methods to suppress output during tests
    spyOn(logger, 'error').mockImplementation(() => {});
    spyOn(logger, 'warn').mockImplementation(() => {});
    spyOn(logger, 'debug').mockImplementation(() => {});
    spyOn(logger, 'info').mockImplementation(() => {});

    mockRuntime = createMockRuntime();
    
    // Mock MemgraphService methods
    mockMemgraphService = {
      connect: mock(() => Promise.resolve()),
      disconnect: mock(() => Promise.resolve()),
      findPersonByWebId: mock(() => Promise.resolve(null)),
    };
    
    // Mock the constructor to return our mock instance
    spyOn(MemgraphService.prototype, 'connect').mockImplementation(mockMemgraphService.connect);
    spyOn(MemgraphService.prototype, 'disconnect').mockImplementation(mockMemgraphService.disconnect);
    spyOn(MemgraphService.prototype, 'findPersonByWebId').mockImplementation(mockMemgraphService.findPersonByWebId);
  });

  it('should return relationship exploration context when no Person node exists', async () => {
    const message = createMockMemory({
      entityId: 'user123'
    });
    const state = createMockState();

    mockMemgraphService.findPersonByWebId.mockImplementation(() => Promise.resolve(null));

    const result = await onboardingProvider.get(mockRuntime, message, state);

    expect(mockMemgraphService.connect).toHaveBeenCalled();
    expect(mockMemgraphService.findPersonByWebId).toHaveBeenCalledWith('user123');
    expect(mockMemgraphService.disconnect).toHaveBeenCalled();
    
    expect(result.values?.onboardingStage).toBe('relationship_exploration');
    expect(result.text).toContain('Important task: Onboarding guidelines Context for Seren');
    expect(result.text).toContain('Create an engaging narrative conversation');
  });

  it('should return relationship exploration context when Person exists but has no email', async () => {
    const message = createMockMemory({
      entityId: 'user123'
    });
    const state = createMockState();

    const mockPerson = {
      webId: 'user123',
      email: null,
      firebaseId: 'firebase123',
      createdAt: '2023-01-01T00:00:00.000Z',
      updatedAt: '2023-01-01T00:00:00.000Z'
    };

    mockMemgraphService.findPersonByWebId.mockImplementation(() => Promise.resolve(mockPerson));

    const result = await onboardingProvider.get(mockRuntime, message, state);

    expect(result.values?.onboardingStage).toBe('relationship_exploration');
    expect(result.text).toContain('Important task: Onboarding guidelines Context for Seren');
  });

  it('should return relationship exploration context when Person exists but has empty email', async () => {
    const message = createMockMemory({
      entityId: 'user123'
    });
    const state = createMockState();

    const mockPerson = {
      webId: 'user123',
      email: '   ', // Empty/whitespace email
      firebaseId: 'firebase123',
      createdAt: '2023-01-01T00:00:00.000Z',
      updatedAt: '2023-01-01T00:00:00.000Z'
    };

    mockMemgraphService.findPersonByWebId.mockImplementation(() => Promise.resolve(mockPerson));

    const result = await onboardingProvider.get(mockRuntime, message, state);

    expect(result.values?.onboardingStage).toBe('relationship_exploration');
    expect(result.text).toContain('Important task: Onboarding guidelines Context for Seren');
  });

  it('should return connection invite context when Person exists with valid email', async () => {
    const message = createMockMemory({
      entityId: 'user123'
    });
    const state = createMockState();

    const mockPerson = {
      webId: 'user123',
      email: 'test@example.com',
      firebaseId: 'firebase123',
      createdAt: '2023-01-01T00:00:00.000Z',
      updatedAt: '2023-01-01T00:00:00.000Z'
    };

    mockMemgraphService.findPersonByWebId.mockImplementation(() => Promise.resolve(mockPerson));

    const result = await onboardingProvider.get(mockRuntime, message, state);

    expect(mockMemgraphService.connect).toHaveBeenCalled();
    expect(mockMemgraphService.findPersonByWebId).toHaveBeenCalledWith('user123');
    expect(mockMemgraphService.disconnect).toHaveBeenCalled();
    
    expect(result.values?.onboardingStage).toBe('connection_invite_creation');
    expect(result.text).toContain('Important task: App Onboarding to create connection invites');
    expect(result.text).toContain('Step-by-Step Conversation Flow');
    expect(result.text).toContain('Welcome & Get User\'s Name');
  });

  it('should handle database errors gracefully and return default context', async () => {
    const message = createMockMemory({
      entityId: 'user123'
    });
    const state = createMockState();

    mockMemgraphService.findPersonByWebId.mockImplementation(() => Promise.reject(new Error('Database connection failed')));

    const result = await onboardingProvider.get(mockRuntime, message, state);

    expect(result.values?.onboardingStage).toBe('relationship_exploration');
    expect(result.text).toContain('Important task: Onboarding guidelines Context for Seren');
    expect(mockMemgraphService.disconnect).toHaveBeenCalled();
  });

  it('should handle connection errors gracefully and return default context', async () => {
    const message = createMockMemory({
      entityId: 'user123'
    });
    const state = createMockState();

    mockMemgraphService.connect.mockImplementation(() => Promise.reject(new Error('Connection failed')));

    const result = await onboardingProvider.get(mockRuntime, message, state);

    expect(result.values?.onboardingStage).toBe('relationship_exploration');
    expect(result.text).toContain('Important task: Onboarding guidelines Context for Seren');
  });
});