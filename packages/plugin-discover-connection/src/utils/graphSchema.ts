/**
 * Graph Schema for Memgraph Property Graph
 * Simplified B2B Matchmaking System with Schema.org Compliance
 *
 * Focused on essential nodes for cross-venue matchmaking aligned with ElizaOS patterns.
 * Uses Schema.org standards where applicable with minimal custom extensions.
 *
 * Integration Status:
 * ✓ Person nodes - Synced from user entities (syncSingleUser in index.ts)
 * ✓ ContactPoint nodes - Synced from channel connections (syncSingleUser in index.ts)
 * ✓ PeacokDimension nodes - Synced from verification data (circlesVerification evaluator)
 * ✓ HAS_CONTACT relationships - Person → ContactPoint connections
 * ✓ HAS_DIMENSION relationships - Person → PeacokDimension connections
 * ✓ MATCHED_WITH relationships - Person → Person matches (findMatch action)
 * ⚠ Place nodes - Not yet implemented (reserved for future venue integration)
 *
 * Configuration:
 * - MEMGRAPH_URL environment variable (defaults to bolt://localhost:7687)
 * - Graceful degradation: plugin continues if Memgraph is unavailable
 * - Fault-tolerant: Memgraph failures don't break existing functionality
 */

import { type UUID } from '@elizaos/core';

// ============================================================================
// CORE NODE TYPES (Schema.org aligned with ElizaOS patterns)
// ============================================================================

/**
 * Person (schema:Person)
 * Core user entity aligned with ElizaOS entity structure
 * Note: agentId removed - use MANAGED_BY relationship to link Person to Agent
 */
export interface PersonNode {
  type: 'Person';
  entityid: UUID; // ElizaOS entityId of the user

  // Schema.org standard properties
  name?: string;

  // Custom properties
  userStatus?: 'onboarding' | 'unverified_member' | 'verification_pending' | 'group_member';

  // ElizaOS aligned properties
  metadata: {
    email?: string;
  };
  createdAt: number; // ElizaOS timestamp pattern
  updatedAt?: number;
}

/**
 * Place (schema:Place)
 * Venue details with class timetables as requested
 */
export interface PlaceNode {
  type: 'Place';
  venueType:
    | 'restaurant'
    | 'gym'
    | 'community_space'
    | 'coworking_space'
    | 'fitness_studio'
    | 'yoga_studio';

  // Schema.org standard properties
  name: string;
  description?: string;
  url?: string; // Venue website
  address?: string;

  // Venue-specific properties
  operatingHours: {
    [day: string]: {
      // 'monday', 'tuesday', etc.
      open?: string; // '09:00'
      close?: string; // '22:00'
      closed?: boolean;
    };
  };

  // Class/activity timetables
  classTimetable: {
    name: string; // 'Morning Yoga', 'Coffee & Code'
    description?: string;
    schedule: {
      day: string; // 'monday', 'tuesday', etc.
      startTime: string; // '10:00'
      endTime: string; // '11:00'
      recurring: boolean;
    }[];
    instructor?: string;
    capacity?: number;
    bookingRequired?: boolean;
  }[];

  metadata: {
    membershipRequired?: boolean;
    contactInfo?: {
      phone?: string;
      email?: string;
    };
  };

  createdAt: number;
  updatedAt?: number;
}

/**
 * Base dimension properties shared by all dimension node types
 */
interface BaseDimensionNode {
  value: string; // The extracted insight
  embeddings: number[]; // embedding of the value (dimension: 768 for all-MiniLM-L6-v2)
}

/**
 * Persona Dimension Nodes (custom)
 * User attributes extracted by Peacok system - each dimension type has its own label for separate vector indexes
 *
 * Vector Search: Each PersonaX node type has its own vector index on embeddings property
 * for fast similarity search using cosine similarity (metric: "cos").
 * Indexes created automatically: persona_profile_vector_index, persona_characteristic_vector_index, etc.
 */
export interface PersonaProfileNode extends BaseDimensionNode {
  type: 'PersonaProfile';
  // Note: PersonaProfile nodes are unique per person, managed via Person-[:HAS_DIMENSION]->PersonaProfile relationship
  // Old profile nodes are deleted when new ones are created to prevent duplicates in vector search
}

export interface PersonaDemographicNode extends BaseDimensionNode {
  type: 'PersonaDemographic';
}

export interface PersonaCharacteristicNode extends BaseDimensionNode {
  type: 'PersonaCharacteristic';
}

export interface PersonaRoutineNode extends BaseDimensionNode {
  type: 'PersonaRoutine';
}

export interface PersonaGoalNode extends BaseDimensionNode {
  type: 'PersonaGoal';
}

export interface PersonaExperienceNode extends BaseDimensionNode {
  type: 'PersonaExperience';
}

export interface PersonaEmotionalStateNode extends BaseDimensionNode {
  type: 'PersonaEmotionalState';
}

/**
 * Union type for all persona dimension nodes
 */
export type PersonaDimensionNode =
  | PersonaProfileNode
  | PersonaDemographicNode
  | PersonaCharacteristicNode
  | PersonaRoutineNode
  | PersonaGoalNode
  | PersonaExperienceNode
  | PersonaEmotionalStateNode;

/**
 * Desired/Connection Dimension Nodes (custom)
 * Connection preferences extracted by Peacok system - each dimension type has its own label
 *
 * Consolidated from 7 to 3 dimensions for simplicity:
 * - who: Demographics, interaction style, energy match (was: desired_demographic, desired_dynamic, desired_vibe)
 * - what: Activities and relationship type (was: desired_activity, desired_relationship_type)
 * - how: Time commitment and value exchange (was: desired_availability, desired_value_exchange)
 *
 * Vector Search: Each DesiredX node type has its own vector index on embeddings property
 * Indexes created automatically: desired_profile_vector_index, desired_who_vector_index, etc.
 */
export interface DesiredProfileNode extends BaseDimensionNode {
  type: 'DesiredProfile';
  // Note: DesiredProfile nodes are unique per person, managed via Person-[:HAS_DIMENSION]->DesiredProfile relationship
  // Old profile nodes are deleted when new ones are created to prevent duplicates in vector search
}

export interface DesiredWhoNode extends BaseDimensionNode {
  type: 'DesiredWho';
}

export interface DesiredWhatNode extends BaseDimensionNode {
  type: 'DesiredWhat';
}

export interface DesiredHowNode extends BaseDimensionNode {
  type: 'DesiredHow';
}

/**
 * Union type for all desired dimension nodes
 */
export type DesiredDimensionNode =
  | DesiredProfileNode
  | DesiredWhoNode
  | DesiredWhatNode
  | DesiredHowNode;

/**
 * Dimension name mappings for backward compatibility and runtime type determination
 */
export const PERSONA_DIMENSION_NAMES = {
  profile: 'PersonaProfile',
  demographic: 'PersonaDemographic',
  characteristic: 'PersonaCharacteristic',
  routine: 'PersonaRoutine',
  goal: 'PersonaGoal',
  experience: 'PersonaExperience',
  emotional_state: 'PersonaEmotionalState',
} as const;

export const DESIRED_DIMENSION_NAMES = {
  profile: 'DesiredProfile',
  who: 'DesiredWho',
  what: 'DesiredWhat',
  how: 'DesiredHow',
} as const;

export type PersonaDimensionName = keyof typeof PERSONA_DIMENSION_NAMES;
export type DesiredDimensionName = keyof typeof DESIRED_DIMENSION_NAMES;

/**
 * Account (custom)
 * Unified node for all account types: Circles wallets, social media, contact channels
 * Replaces both ContactPointNode and VerificationDataNode with a single flexible structure
 */
export interface AccountNode {
  type: 'Account';

  // Universal account properties
  platform:
    | 'circles'
    | 'twitter'
    | 'github'
    | 'linkedin'
    | 'discord'
    | 'telegram'
    | 'email'
    | 'web'
    | 'whatsapp'
    | 'other';
  identifier: string; // Wallet address (0x...), username, email

  channelId?: string; //Elizaos channelId for direct commmunication via agent
  username?: string; //Username of user on this platform, could be similar as identifier for some platforms
  displayName?: string; // Display name on this platform
  profileUrl?: string; // URL to profile on this platform

  // Circles-specific properties (only populated when platform='circles')
  circles?: {
    status: 'verified' | 'registered' | 'unregistered';
    incomingTrustCount: number;
    trustsNeeded: number;
    isVerified: boolean;
    trustTransaction?: {
      hash: string; // Transaction hash
      timestamp: number; // When transaction occurred
      groupCA: string; // Circles group contract address
    };
  };

  // Verification metadata (for accounts used in verification process)
  hasMinimumInfo?: boolean; // AI assessment + validation (used for verification flow)

  // Timestamps
  createdAt: number;
  updatedAt?: number;
}

/**
 * Agent (custom)
 * Represents an ElizaOS agent that manages users and operates on communication channels
 * Extracted from ContactPointNode and PersonNode to separate agent concerns
 */
export interface AgentNode {
  type: 'Agent';

  agentId: UUID; // ElizaOS agent ID
  name: string; // Agent display name
  username?: string; // Agent username if applicable

  // Agent metadata
  metadata?: {
    description?: string;
    capabilities?: string[];
    version?: string;
  };

  createdAt: number;
  updatedAt?: number;
}

/**
 * VerificationData (custom)
 * @deprecated Use AccountNode instead. This node type is kept for backward compatibility.
 * Will be removed in a future version after migration is complete.
 *
 * Stores user verification information including Circles account and social proof
 */
export interface VerificationDataNode {
  type: 'VerificationData';

  // Circles Account (consolidates metriAccount and walletAddress)
  circlesAccount?: string; // Circles/Metri wallet address (0x...)
  circlesStatus?: 'verified' | 'registered' | 'unregistered';

  // Circles Network Status
  incomingTrustCount?: number;
  isVerified: boolean;
  trustsNeeded?: number;

  // Trust Transaction Info (if user joined via agent)
  trustTransactionHash?: string;
  trustedAt?: number;
  circlesGroupCA?: string;

  // Social Verification
  socialLinks: string[]; // Array of verification URLs (GitHub, Twitter, LinkedIn, etc.)

  // Status Tracking
  hasMinimumInfo: boolean; // AI assessment + validation

  // Timestamps (consistent with other nodes)
  createdAt: number;
  updatedAt?: number;
}

// ============================================================================
// RELATIONSHIP TYPES (essential only)
// ============================================================================

/**
 * HAS_DIMENSION (Person -> PeacokDimension)
 * Person's connection to extracted Peacok dimensions
 */
export interface HasDimensionRelationship {
  type: 'HAS_DIMENSION';
  from: UUID; // Person
  to: UUID; // PeacokDimension

  // Context
  createdAt: number; // When this was extracted
  evidence: string; // Context where this was extracted
}

/**
 * HAS_ACCOUNT (Person -> Account)
 * Links person to their accounts across different platforms
 * Replaces both HAS_CONTACT and HAS_VERIFICATION relationships
 */
export interface HasAccountRelationship {
  type: 'HAS_ACCOUNT';
  from: UUID; // Person
  to: UUID; // Account

  status: 'active' | 'inactive' | 'pending_verification';
  isPrimary?: boolean; // Is this their primary account on this platform?

  createdAt: number;
  updatedAt?: number;
}

/**
 * MANAGED_BY (Person -> Agent)
 * Links person to the agent that manages their interactions
 * Replaces the agentId field previously stored in PersonNode
 */
export interface ManagedByRelationship {
  type: 'MANAGED_BY';
  from: UUID; // Person
  to: UUID; // Agent (agentId)

  // Management metadata
  managementStartedAt: number;
  lastInteractionAt?: number;

  createdAt: number;
  updatedAt?: number;
}

/**
 * MANAGED_ON (Agent -> Account)
 * Links agent to the communication channels/platforms they operate on
 * Replaces agent metadata previously stored in ContactPointNode
 */
export interface ManagedOnRelationship {
  type: 'MANAGED_ON';
  from: UUID; // Agent (agentId)
  to: UUID; // Account (the channel/platform where agent is present)

  // Channel-specific agent presence
  active: boolean;

  createdAt: number;
  updatedAt?: number;
}

/**
 * HAS_VERIFICATION (Person -> VerificationData)
 * @deprecated Use HAS_ACCOUNT relationship instead. This is kept for backward compatibility.
 * Will be removed in a future version after migration is complete.
 *
 * Links person to their verification information
 */
export interface HasVerificationRelationship {
  type: 'HAS_VERIFICATION';
  from: UUID; // Person
  to: UUID; // VerificationData

  createdAt: number;
  updatedAt?: number;
}

/**
 * MATCHED_WITH (Person -> Person)
 * Simplified direct match relationship for restaurant meetups
 */
export interface MatchedWithRelationship {
  type: 'MATCHED_WITH';
  from: UUID; // Person (initiating user - who created the match)
  to: UUID; // Person (matched user)

  // Core match info
  reasoning: string; // Why they match
  compatibilityScore?: number; // 0-100 match score
  status:
    | 'match_found'
    | 'proposal_sent'
    | 'accepted'
    | 'scheduled'
    | 'completed'
    | 'declined'
    | 'cancelled'
    | 'expired_no_proposal'
    | 'expired_no_response';

  // Essential coordination data (populated as status progresses)
  venue?: string; // "Bantabaa Restaurant"
  proposedTime?: string; // "Thursday evening" or "Nov 21, 7pm"

  // Identification clues (multiple entries per user)
  user1Clues?: Array<{
    text: string; // The clue content
    timestamp: number; // When clue was provided
  }>;
  user2Clues?: Array<{
    text: string; // The clue content
    timestamp: number; // When clue was provided
  }>;

  // Legacy single clue fields (for backward compatibility during migration)
  user1Clue?: string; // deprecated - use user1Clues
  user2Clue?: string; // deprecated - use user2Clues

  // Feedback collection (after meeting)
  feedback?: Array<{
    userId: UUID; // Who provided the feedback
    text: string; // The feedback content
    timestamp: number; // When feedback was provided
  }>;

  // Match context
  venueContext?: UUID; // Place node where matched
  agentFacilitated?: UUID; // Agent who facilitated

  // Timestamps
  createdAt: number;
  updatedAt?: number;
  proposalSentAt?: number; // When proposal was sent (for expiry calculations)

  // Expiry tracking
  reminders?: string[]; // Track which reminders have been sent ['8h', '16h', 'proposal_8h', 'proposal_16h']
}

/**
 * ATTENDS (Person -> Place)
 * Schema.org inspired - person attends/frequents this place
 * For restaurants, gyms, community spaces where people regularly visit
 */
export interface AttendsRelationship {
  type: 'ATTENDS';
  from: UUID; // Person entityId
  to: string; // Place name (unique identifier)

  // Attendance context
  frequency?: 'regular' | 'occasional' | 'first-time';
  firstVisit?: number;
  lastVisit?: number;

  createdAt: number;
  updatedAt?: number;
}

/**
 * OPERATES_AT (Agent -> Place)
 * Agent operates/provides services at this place
 */
export interface OperatesAtRelationship {
  type: 'OPERATES_AT';
  from: UUID; // Agent agentId
  to: string; // Place name (unique identifier)

  // Agent's role at this place
  role: 'host' | 'assistant' | 'manager';

  createdAt: number;
  updatedAt?: number;
}

// ============================================================================
// TYPE UNIONS AND SCHEMA DEFINITION
// ============================================================================

export type AnyNode =
  | PersonNode
  | AccountNode
  | AgentNode
  | PlaceNode
  | PersonaProfileNode
  | PersonaDemographicNode
  | PersonaCharacteristicNode
  | PersonaRoutineNode
  | PersonaGoalNode
  | PersonaExperienceNode
  | PersonaEmotionalStateNode
  | DesiredProfileNode
  | DesiredWhoNode
  | DesiredWhatNode
  | DesiredHowNode
  | VerificationDataNode; // deprecated

export type AnyRelationship =
  | HasAccountRelationship
  | ManagedByRelationship
  | ManagedOnRelationship
  | HasDimensionRelationship
  | MatchedWithRelationship
  | AttendsRelationship
  | OperatesAtRelationship
  | HasVerificationRelationship; // deprecated

export type NodeType = AnyNode['type'];
export type RelationshipType = AnyRelationship['type'];

/**
 * Complete Graph Schema Definition
 */
export interface GraphSchema {
  nodeTypes: {
    Person: PersonNode;
    Account: AccountNode;
    Agent: AgentNode;
    Place: PlaceNode;
    PersonaProfile: PersonaProfileNode;
    PersonaDemographic: PersonaDemographicNode;
    PersonaCharacteristic: PersonaCharacteristicNode;
    PersonaRoutine: PersonaRoutineNode;
    PersonaGoal: PersonaGoalNode;
    PersonaExperience: PersonaExperienceNode;
    PersonaEmotionalState: PersonaEmotionalStateNode;
    DesiredProfile: DesiredProfileNode;
    DesiredWho: DesiredWhoNode;
    DesiredWhat: DesiredWhatNode;
    DesiredHow: DesiredHowNode;
    VerificationData: VerificationDataNode; // deprecated
  };

  relationshipTypes: {
    HAS_ACCOUNT: HasAccountRelationship;
    MANAGED_BY: ManagedByRelationship;
    MANAGED_ON: ManagedOnRelationship;
    HAS_DIMENSION: HasDimensionRelationship;
    MATCHED_WITH: MatchedWithRelationship;
    ATTENDS: AttendsRelationship;
    OPERATES_AT: OperatesAtRelationship;
    HAS_VERIFICATION: HasVerificationRelationship; // deprecated
  };
}

/**
 * Schema validation utilities
 */
export class GraphSchemaValidator {
  static isValidNodeType(type: string): type is NodeType {
    const validNodeTypes: NodeType[] = [
      'Person',
      'Account',
      'Agent',
      'Place',
      'PersonaProfile',
      'PersonaDemographic',
      'PersonaCharacteristic',
      'PersonaRoutine',
      'PersonaGoal',
      'PersonaExperience',
      'PersonaEmotionalState',
      'DesiredProfile',
      'DesiredWho',
      'DesiredWhat',
      'DesiredHow',
      'VerificationData', // deprecated
    ];
    return validNodeTypes.includes(type as NodeType);
  }

  static isValidRelationshipType(type: string): type is RelationshipType {
    const validRelationshipTypes: RelationshipType[] = [
      'HAS_ACCOUNT',
      'MANAGED_BY',
      'MANAGED_ON',
      'HAS_DIMENSION',
      'MATCHED_WITH',
      'OPERATES_AT',
      'HAS_VERIFICATION', // deprecated
    ];
    return validRelationshipTypes.includes(type as RelationshipType);
  }

  static isSchemaOrgCompliant(nodeOrRelType: string): boolean {
    const schemaOrgTypes = ['Person', 'Place'];
    return schemaOrgTypes.includes(nodeOrRelType);
  }

  static isDeprecatedNodeType(type: string): boolean {
    const deprecatedTypes = ['VerificationData'];
    return deprecatedTypes.includes(type);
  }

  static isDeprecatedRelationshipType(type: string): boolean {
    const deprecatedTypes = ['HAS_VERIFICATION'];
    return deprecatedTypes.includes(type);
  }
}

/**
 * Schema metadata
 */
export const SCHEMA_METADATA = {
  version: '1.0.0',
  description: 'Simplified B2B Matchmaking Graph Schema aligned with ElizaOS patterns',
  schemaOrgCompliance: true,
  elizaOSAlignment: true,
  supportedUseCases: [
    'Cross-venue user matchmaking',
    'Multi-channel identity management with agent tracking',
    'Peacok dimension extraction and matching',
    'Venue class scheduling and member tracking',
  ],
  lastUpdated: new Date().toISOString(),
};
