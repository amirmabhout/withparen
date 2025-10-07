import { type IAgentRuntime, type UUID, logger } from '@elizaos/core';
import { MemgraphService } from './memgraph.js';

/**
 * User Status Enumeration
 * Represents the user's status in the Discover-Connection system
 */
export enum UserStatus {
  ONBOARDING = 'onboarding', // User in discovery phase, going through onboarding
  ACTIVE = 'active', // Completed onboarding, can use all services
}

/**
 * Match Status Enumeration
 * Simplified unified workflow from match to completion
 */
export enum MatchStatus {
  MATCH_FOUND = 'match_found', // Initial match discovered, awaiting proposal
  PROPOSAL_SENT = 'proposal_sent', // One user sent meeting proposal
  ACCEPTED = 'accepted', // Both accepted, coordinating details (time/clues/meeting)
  COMPLETED = 'completed', // Meeting happened, awaiting feedback
  DECLINED = 'declined', // Declined at any stage
  CANCELLED = 'cancelled', // Cancelled after acceptance
  EXPIRED_NO_PROPOSAL = 'expired_no_proposal', // Match expired after 24h - initiator never sent proposal
  EXPIRED_NO_RESPONSE = 'expired_no_response', // Proposal expired after 24h - recipient never responded
}

/**
 * User Status Service
 * Manages user membership status and transitions within the Discover-Connection system
 */
export class UserStatusService {
  private runtime: IAgentRuntime;

  constructor(runtime: IAgentRuntime) {
    this.runtime = runtime;
  }

  /**
#   * Get the current status of a user from Memgraph
   */
  async getUserStatus(userId: UUID): Promise<UserStatus> {
    try {
      const memgraphService = this.runtime.getService('memgraph') as MemgraphService;
      if (!memgraphService) {
        logger.warn('[discover-connection] UserStatusService: Memgraph service not available');
        return UserStatus.ONBOARDING;
      }

      const status = await memgraphService.getUserStatus(userId);

      if (!status) {
        // New user - initialize with onboarding status
        await this.setUserStatus(userId, UserStatus.ONBOARDING);
        return UserStatus.ONBOARDING;
      }

      return status as UserStatus;
    } catch (error) {
      logger.error(
        `[discover-connection] UserStatusService: Error getting user status for ${userId}: ${error}`
      );
      // Default to onboarding for safety
      return UserStatus.ONBOARDING;
    }
  }

  /**
   * Set the status of a user in Memgraph
   */
  async setUserStatus(userId: UUID, status: UserStatus): Promise<void> {
    try {
      const memgraphService = this.runtime.getService('memgraph') as MemgraphService;
      if (!memgraphService) {
        logger.error('[discover-connection] UserStatusService: Memgraph service not available');
        throw new Error('Memgraph service not available');
      }

      // Get current status for logging
      const currentStatus = await memgraphService.getUserStatus(userId);

      // If Person node doesn't exist, create it first
      if (!currentStatus) {
        // Create Agent node if it doesn't exist
        await memgraphService.createAgentNode({
          agentId: this.runtime.agentId,
          name: this.runtime.character?.name || 'Agent',
          username: this.runtime.character?.username,
          metadata: {
            description: this.runtime.character?.bio?.[0],
          },
          createdAt: Date.now(),
        });

        // Create Person node
        const created = await memgraphService.syncPersonFromEntity(
          userId,
          '', // Name will be updated when available
          status
        );

        if (created) {
          // Link Person to Agent via MANAGED_BY relationship
          await memgraphService.createManagedByRelationship(
            userId,
            this.runtime.agentId,
            Date.now()
          );

          logger.info(
            `[discover-connection] UserStatusService: Created Person with initial status ${status} for user ${userId}`
          );
        } else {
          throw new Error('Failed to create Person node');
        }
      } else {
        // Update existing Person node's status
        const updated = await memgraphService.updatePersonStatus(userId, status);

        if (updated) {
          logger.info(
            `[discover-connection] UserStatusService: Updated user ${userId} status from ${currentStatus} to ${status}`
          );
        } else {
          throw new Error('Failed to update Person status');
        }
      }
    } catch (error) {
      logger.error(
        `[discover-connection] UserStatusService: Error setting user status for ${userId} to ${status}: ${error}`
      );
      throw error;
    }
  }

  /**
   * Transition user status with validation
   */
  async transitionUserStatus(userId: UUID, newStatus: UserStatus): Promise<boolean> {
    try {
      const currentStatus = await this.getUserStatus(userId);

      // Validate transition
      const isValidTransition = this.isValidStatusTransition(currentStatus, newStatus);

      if (!isValidTransition) {
        logger.warn(
          `[discover-connection] UserStatusService: Invalid status transition for user ${userId}: ${currentStatus} -> ${newStatus}`
        );
        return false;
      }

      await this.setUserStatus(userId, newStatus);

      logger.debug(
        `[UserStatusService] Status transitioned for ${userId}: ${currentStatus} -> ${newStatus}`
      );

      return true;
    } catch (error) {
      logger.error(
        `[discover-connection] UserStatusService: Error transitioning user status for ${userId}: ${error}`
      );
      return false;
    }
  }

  /**
   * Check if a status transition is valid
   */
  private isValidStatusTransition(currentStatus: UserStatus, newStatus: UserStatus): boolean {
    // Define allowed transitions
    const allowedTransitions: Record<UserStatus, UserStatus[]> = {
      [UserStatus.ONBOARDING]: [UserStatus.ACTIVE],
      [UserStatus.ACTIVE]: [], // Active users don't transition back
    };

    return allowedTransitions[currentStatus]?.includes(newStatus) || currentStatus === newStatus;
  }

  /**
   * Check if user can perform a specific action based on their status
   */
  async canUserPerformAction(userId: UUID, requiredStatus: UserStatus): Promise<boolean> {
    try {
      const currentStatus = await this.getUserStatus(userId);
      return this.isStatusSufficientForAction(currentStatus, requiredStatus);
    } catch (error) {
      logger.error(
        `[discover-connection] UserStatusService: Error checking action permission for user ${userId}: ${error}`
      );
      return false;
    }
  }

  /**
   * Check if current status is sufficient for required status
   */
  private isStatusSufficientForAction(
    currentStatus: UserStatus,
    requiredStatus: UserStatus
  ): boolean {
    // Define status hierarchy (higher number = higher access level)
    const statusHierarchy = {
      [UserStatus.ONBOARDING]: 1,
      [UserStatus.ACTIVE]: 2,
    };

    return statusHierarchy[currentStatus] >= statusHierarchy[requiredStatus];
  }

  /**
   * Check if user has completed onboarding (has persona/connection dimensions in Memgraph)
   */
  async hasCompletedOnboarding(userId: UUID, _roomId?: UUID): Promise<boolean> {
    try {
      const memgraphService = this.runtime.getService('memgraph') as MemgraphService;
      if (!memgraphService) {
        logger.warn('[discover-connection] UserStatusService: Memgraph service not available');
        return false;
      }

      const dimensions = await memgraphService.hasOnboardingDimensions(userId);
      const hasCompletedOnboarding =
        dimensions.hasPersonaDimensions && dimensions.hasDesiredDimensions;

      logger.debug(
        `[discover-connection] UserStatusService: User ${userId} onboarding status - ` +
          `Persona: ${dimensions.hasPersonaDimensions}, Desired: ${dimensions.hasDesiredDimensions}`
      );

      return hasCompletedOnboarding;
    } catch (error) {
      logger.error(
        `[discover-connection] UserStatusService: Error checking onboarding completion for ${userId}: ${error}`
      );
      return false;
    }
  }

  /**
   * Get all users with a specific status from Memgraph
   */
  async getUsersByStatus(status: UserStatus, count: number = 50): Promise<UUID[]> {
    try {
      const memgraphService = this.runtime.getService('memgraph') as MemgraphService;
      if (!memgraphService) {
        logger.warn('[discover-connection] UserStatusService: Memgraph service not available');
        return [];
      }

      const usersWithStatus = await memgraphService.getUsersByStatus(status, count);

      logger.debug(
        `[discover-connection] UserStatusService: Found ${usersWithStatus.length} users with status ${status}`
      );

      return usersWithStatus;
    } catch (error) {
      logger.error(
        `[discover-connection] UserStatusService: Error getting users by status ${status}: ${error}`
      );
      return [];
    }
  }

  /**
   * Get detailed status information for debugging
   */
  async getUserStatusInfo(userId: UUID): Promise<{
    status: UserStatus;
    hasOnboardingData: boolean;
    isActive: boolean;
  }> {
    try {
      const status = await this.getUserStatus(userId);
      const hasOnboardingData = await this.hasCompletedOnboarding(userId);
      const isActive = status === UserStatus.ACTIVE;

      return {
        status,
        hasOnboardingData,
        isActive,
      };
    } catch (error) {
      logger.error(
        `[discover-connection] UserStatusService: Error getting status info for ${userId}: ${error}`
      );
      return {
        status: UserStatus.ONBOARDING,
        hasOnboardingData: false,
        isActive: false,
      };
    }
  }
}
