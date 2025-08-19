/**
 * Seren AI Graph Schema for Memgraph Property Graph
 *
 * This schema defines the node types, relationships, and properties for modeling
 * romantic couples and their interactions within the Seren AI framework.
 *
 * Core Design Principles:
 * 1. Individual Dimensions: Personal traits, communication styles, emotional states
 * 2. Dyadic Relationships: Shared experiences, mutual perceptions, joint activities
 * 3. Temporal Tracking: Evolution of relationship dynamics over time
 * 4. Cultural Adaptability: Language and cultural context support
 */

// ============================================================================
// NODE TYPES AND PROPERTIES
// ============================================================================

export interface PersonNode {
  id: string;
  name: string;
  preferredPronouns: string[];
  primaryLanguage: string;
  culturalContext?: string;
  createdAt: number;
  updatedAt: number;

  // Communication Style Dimensions
  communicationStyle: {
    expressiveness: number; // 1-10 scale (reserved to talkative)
    directness: number; // 1-10 scale (indirect to direct)
    emotionalOpenness: number; // 1-10 scale (guarded to open)
    conflictStyle: string; // "avoidant" | "collaborative" | "competitive" | "accommodating"
    activeListening: number; // 1-10 scale
    empathyLevel: number; // 1-10 scale
  };

  // Emotional Intelligence Dimensions
  emotionalProfile: {
    selfAwareness: number; // 1-10 scale
    emotionRegulation: number; // 1-10 scale
    socialAwareness: number; // 1-10 scale
    relationshipManagement: number; // 1-10 scale
    stressResponse: string; // "withdraw" | "engage" | "seek_support" | "problem_solve"
    gratitudeExpression: number; // 1-10 scale
  };

  // Attachment and Intimacy
  attachmentStyle: {
    primary: string; // "secure" | "anxious" | "avoidant" | "disorganized"
    intimacyComfort: number; // 1-10 scale
    vulnerabilityWillingness: number; // 1-10 scale
    trustLevel: number; // 1-10 scale
    dependencyComfort: number; // 1-10 scale
  };

  // Personal Values and Interests
  values: {
    coreValues: string[]; // e.g., ["family", "career", "adventure", "stability"]
    relationshipPriorities: string[]; // e.g., ["communication", "intimacy", "shared_goals"]
    conflictResolutionValues: string[]; // e.g., ["fairness", "harmony", "honesty"]
  };

  // Current State Tracking
  currentState: {
    stressLevel: number; // 1-10 scale
    relationshipSatisfaction: number; // 1-10 scale
    emotionalState: string; // "happy" | "stressed" | "content" | "anxious" | "excited"
    energyLevel: number; // 1-10 scale
    availabilityForConnection: number; // 1-10 scale
  };
}

export interface CoupleNode {
  id: string;
  person1Id: string;
  person2Id: string;
  relationshipStage: string; // "dating" | "committed" | "engaged" | "married" | "long_term"
  relationshipDuration: number; // months
  howTheyMet: string;
  sharedLanguages: string[];
  primaryCommunicationLanguage: string;
  createdAt: number;
  updatedAt: number;

  // Relationship Dynamics
  dynamics: {
    communicationPatterns: {
      positiveInteractionRatio: number; // Gottman's 5:1 ratio tracking
      conflictFrequency: number; // conflicts per week
      resolutionSuccessRate: number; // 0-1 scale
      activeListeningUsage: number; // 1-10 scale
      gratitudeExpressionFrequency: number; // times per week
    };

    intimacyLevels: {
      emotional: number; // 1-10 scale
      physical: number; // 1-10 scale
      intellectual: number; // 1-10 scale
      experiential: number; // 1-10 scale (shared activities)
      spiritual: number; // 1-10 scale
    };

    copingStrategies: {
      dyadicCopingStyle: string; // "collaborative" | "supportive" | "delegated" | "protective"
      stressManagementTogether: number; // 1-10 effectiveness scale
      problemSolvingApproach: string; // "joint" | "individual" | "alternating"
      supportSeekingPattern: string; // "mutual" | "one_sided" | "external"
    };

    sharedGoals: {
      shortTerm: string[]; // goals for next 3-6 months
      longTerm: string[]; // goals for 1+ years
      alignmentLevel: number; // 1-10 scale of goal alignment
      progressTracking: { [goal: string]: number }; // progress on each goal (0-1)
    };
  };

  // Relationship Health Metrics
  healthMetrics: {
    overallSatisfaction: number; // 1-10 scale (average of both partners)
    trustLevel: number; // 1-10 scale
    communicationQuality: number; // 1-10 scale
    conflictResolutionSkill: number; // 1-10 scale
    intimacyLevel: number; // 1-10 scale
    futureOptimism: number; // 1-10 scale
    externalStressImpact: number; // 1-10 scale (how much external stress affects relationship)
  };
}

export interface SessionNode {
  id: string;
  coupleId: string;
  sessionType: string; // "onboarding" | "check_in" | "conflict_resolution" | "appreciation" | "goal_setting"
  startTime: number;
  endTime?: number;
  duration?: number; // minutes
  facilitatorAgent: string; // agent ID

  // Session Content
  content: {
    topics: string[]; // main topics discussed
    exercises: string[]; // exercises completed
    insights: string[]; // key insights generated
    homeworkAssigned: string[]; // tasks assigned for offline completion
    emotionalTone: string; // "positive" | "neutral" | "tense" | "breakthrough"
    participationBalance: number; // -1 to 1 scale (-1 = person1 dominated, 0 = balanced, 1 = person2 dominated)
  };

  // Outcomes
  outcomes: {
    satisfactionRating: { person1: number; person2: number }; // 1-10 scale
    progressMade: number; // 1-10 scale
    homeworkCompliance: number; // 0-1 scale (from follow-up)
    breakthroughMoments: string[]; // significant realizations or connections
    challengesIdentified: string[]; // areas needing more work
  };
}

export interface InteractionNode {
  id: string;
  sessionId?: string; // if part of a session
  coupleId: string;
  timestamp: number;
  interactionType: string; // "gratitude_expression" | "conflict" | "support_seeking" | "affection" | "problem_solving"

  // Interaction Details
  details: {
    initiator: string; // person1 | person2 | both
    topic?: string; // what the interaction was about
    emotionalTone: string; // "positive" | "neutral" | "negative" | "mixed"
    intensity: number; // 1-10 scale
    duration: number; // minutes
    resolution?: string; // "resolved" | "unresolved" | "partially_resolved" | "escalated"

    // Communication Quality Metrics
    activeListeningUsed: boolean;
    empathyDemonstrated: boolean;
    gratitudeExpressed: boolean;
    vulnerabilityShared: boolean;
    supportOffered: boolean;
    supportReceived: boolean;
  };

  // Outcomes
  outcomes: {
    satisfactionLevel: { person1: number; person2: number }; // 1-10 scale
    connectionStrengthened: boolean;
    newInsightGained: boolean;
    conflictResolved: boolean;
    emotionalStateAfter: { person1: string; person2: string };
    followUpNeeded: boolean;
  };
}

export interface TaskNode {
  id: string;
  coupleId: string;
  assignedBy: string; // session ID or agent ID
  taskType: string; // "gratitude_exercise" | "communication_practice" | "shared_activity" | "reflection" | "conflict_resolution"

  // Task Details
  details: {
    title: string;
    description: string;
    instructions: string[];
    estimatedDuration: number; // minutes
    difficulty: number; // 1-10 scale
    category: string; // "appreciation" | "communication" | "intimacy" | "problem_solving" | "fun"
  };

  // Scheduling
  scheduling: {
    assignedAt: number;
    dueDate?: number;
    reminderFrequency?: string; // "daily" | "weekly" | "none"
    priority: string; // "low" | "medium" | "high" | "urgent"
  };

  // Completion Tracking
  completion: {
    status: string; // "assigned" | "in_progress" | "completed" | "skipped" | "overdue"
    completedAt?: number;
    completedBy: string[]; // ["person1", "person2"] or subset
    satisfactionRating?: { person1?: number; person2?: number }; // 1-10 scale
    difficultyExperienced?: number; // 1-10 scale
    insights?: string[]; // what they learned
    challengesFaced?: string[]; // what was difficult
    wouldRecommend?: boolean;
  };
}

export interface MemoryNode {
  id: string;
  coupleId: string;
  memoryType: string; // "shared_experience" | "milestone" | "conflict_resolution" | "breakthrough" | "tradition"

  // Memory Content
  content: {
    title: string;
    description: string;
    date: number;
    location?: string;
    participants: string[]; // person1, person2, others
    emotionalSignificance: number; // 1-10 scale
    relationshipImpact: string; // "strengthening" | "challenging" | "neutral" | "transformative"
  };

  // Memory Attributes
  attributes: {
    valence: string; // "positive" | "negative" | "mixed" | "neutral"
    intensity: number; // 1-10 scale
    clarity: number; // 1-10 scale (how well remembered)
    sharedNarrative: boolean; // do both partners remember it similarly
    triggers: string[]; // what brings this memory to mind
    lessons: string[]; // what was learned from this experience
  };

  // Recall Information
  recall: {
    lastRecalled: number;
    recallFrequency: number; // times recalled
    contextOfRecall: string[]; // when/why it's typically remembered
    emotionalResponseOnRecall: string; // current emotional response when remembered
  };
}

// ============================================================================
// RELATIONSHIP TYPES
// ============================================================================

export interface PersonToPersonRelationship {
  type: 'PARTNERS_WITH';
  properties: {
    since: number; // timestamp when relationship started
    relationshipType: string; // "romantic" | "married" | "engaged"
    currentStatus: string; // "active" | "on_break" | "complicated"

    // Mutual Perception Dimensions
    mutualPerception: {
      person1ViewOfPerson2: {
        trustLevel: number; // 1-10 scale
        attractionLevel: number; // 1-10 scale
        compatibilityRating: number; // 1-10 scale
        supportivenessRating: number; // 1-10 scale
        communicationRating: number; // 1-10 scale
        perceivedStressLevel: number; // 1-10 scale
        perceivedHappiness: number; // 1-10 scale
        appreciationLevel: number; // 1-10 scale
      };
      person2ViewOfPerson1: {
        trustLevel: number;
        attractionLevel: number;
        compatibilityRating: number;
        supportivenessRating: number;
        communicationRating: number;
        perceivedStressLevel: number;
        perceivedHappiness: number;
        appreciationLevel: number;
      };

      // Empathic Accuracy Tracking
      empathicAccuracy: {
        person1AccuracyScore: number; // 0-1 scale (how accurately person1 perceives person2)
        person2AccuracyScore: number; // 0-1 scale (how accurately person2 perceives person1)
        lastAssessment: number; // timestamp
        improvementTrend: string; // "improving" | "stable" | "declining"
      };
    };

    // Interaction Patterns
    interactionPatterns: {
      communicationFrequency: number; // interactions per day
      conflictFrequency: number; // conflicts per week
      affectionFrequency: number; // affectionate interactions per day
      supportFrequency: number; // support-seeking/giving per week
      qualityTimeFrequency: number; // dedicated time together per week (hours)

      // Gottman's Four Horsemen Tracking
      fourHorsemenFrequency: {
        criticism: number; // instances per month
        contempt: number; // instances per month
        defensiveness: number; // instances per month
        stonewalling: number; // instances per month
      };

      // Positive Interaction Tracking
      positiveInteractions: {
        gratitudeExpressions: number; // per week
        compliments: number; // per week
        physicalAffection: number; // per week
        emotionalSupport: number; // per week
        sharedLaughter: number; // per week
      };
    };
  };
}

export interface PersonToSessionRelationship {
  type: 'PARTICIPATED_IN';
  properties: {
    participationLevel: number; // 1-10 scale
    emotionalEngagement: number; // 1-10 scale
    resistanceLevel: number; // 1-10 scale
    insightsGained: string[];
    challengesFaced: string[];
    satisfactionRating: number; // 1-10 scale
    followUpCommitment: number; // 1-10 scale
  };
}

export interface PersonToTaskRelationship {
  type: 'ASSIGNED_TO' | 'COMPLETED';
  properties: {
    assignedAt?: number;
    completedAt?: number;
    effortLevel: number; // 1-10 scale
    enjoymentLevel: number; // 1-10 scale
    difficultyExperienced: number; // 1-10 scale
    insightsGained: string[];
    wouldRepeat: boolean;
    partnerSupportReceived: number; // 1-10 scale
  };
}

export interface PersonToMemoryRelationship {
  type: 'REMEMBERS' | 'CREATED';
  properties: {
    emotionalResponse: string; // "joy" | "sadness" | "pride" | "regret" | "love"
    personalSignificance: number; // 1-10 scale
    roleInMemory: string; // "initiator" | "supporter" | "participant" | "observer"
    detailsRemembered: string[]; // specific aspects they remember
    emotionalIntensityWhenRecalling: number; // 1-10 scale
    frequencyOfRecall: number; // times per month
    sharesWithPartner: boolean; // do they bring this up with partner
  };
}

export interface SessionToInteractionRelationship {
  type: 'CONTAINS';
  properties: {
    sequenceOrder: number; // order within the session
    timeOffset: number; // minutes from session start
    significance: string; // "breakthrough" | "routine" | "challenging" | "pivotal"
  };
}

export interface InteractionToMemoryRelationship {
  type: 'BECAME' | 'TRIGGERED';
  properties: {
    transformationReason: string; // why this interaction became a memory
    emotionalImpact: number; // 1-10 scale
    relationshipSignificance: string; // "milestone" | "turning_point" | "pattern_example"
    timeToMemoryFormation: number; // days between interaction and memory formation
  };
}

export interface TaskToSessionRelationship {
  type: 'ASSIGNED_IN' | 'REVIEWED_IN';
  properties: {
    assignmentContext: string; // why this task was assigned
    expectedOutcome: string; // what the facilitator hoped to achieve
    followUpPlanned: boolean;
    priorityLevel: string; // "high" | "medium" | "low"
  };
}

// ============================================================================
// TEMPORAL TRACKING RELATIONSHIPS
// ============================================================================

export interface TemporalProgressRelationship {
  type: 'PROGRESSED_TO';
  properties: {
    timespan: number; // days between measurements
    changeDirection: string; // "improved" | "declined" | "stable"
    changeMagnitude: number; // 0-1 scale
    triggeringEvents: string[]; // what caused the change
    interventionsUsed: string[]; // what was done to facilitate change
  };
}

// ============================================================================
// GRAPH SCHEMA UTILITIES
// ============================================================================

export class SerenGraphSchema {
  /**
   * Cypher queries for creating the graph schema constraints and indexes
   */
  static getSchemaQueries(): string[] {
    return [
      // Node constraints
      'CREATE CONSTRAINT person_id IF NOT EXISTS FOR (p:Person) REQUIRE p.id IS UNIQUE;',
      'CREATE CONSTRAINT couple_id IF NOT EXISTS FOR (c:Couple) REQUIRE c.id IS UNIQUE;',
      'CREATE CONSTRAINT session_id IF NOT EXISTS FOR (s:Session) REQUIRE s.id IS UNIQUE;',
      'CREATE CONSTRAINT interaction_id IF NOT EXISTS FOR (i:Interaction) REQUIRE i.id IS UNIQUE;',
      'CREATE CONSTRAINT task_id IF NOT EXISTS FOR (t:Task) REQUIRE t.id IS UNIQUE;',
      'CREATE CONSTRAINT memory_id IF NOT EXISTS FOR (m:Memory) REQUIRE m.id IS UNIQUE;',

      // Indexes for performance
      'CREATE INDEX person_name IF NOT EXISTS FOR (p:Person) ON (p.name);',
      'CREATE INDEX couple_stage IF NOT EXISTS FOR (c:Couple) ON (c.relationshipStage);',
      'CREATE INDEX session_type IF NOT EXISTS FOR (s:Session) ON (s.sessionType);',
      'CREATE INDEX interaction_type IF NOT EXISTS FOR (i:Interaction) ON (i.interactionType);',
      'CREATE INDEX task_status IF NOT EXISTS FOR (t:Task) ON (t.completion.status);',
      'CREATE INDEX memory_type IF NOT EXISTS FOR (m:Memory) ON (m.memoryType);',

      // Temporal indexes
      'CREATE INDEX person_updated IF NOT EXISTS FOR (p:Person) ON (p.updatedAt);',
      'CREATE INDEX session_start IF NOT EXISTS FOR (s:Session) ON (s.startTime);',
      'CREATE INDEX interaction_timestamp IF NOT EXISTS FOR (i:Interaction) ON (i.timestamp);',
      'CREATE INDEX task_assigned IF NOT EXISTS FOR (t:Task) ON (t.scheduling.assignedAt);',
      'CREATE INDEX memory_date IF NOT EXISTS FOR (m:Memory) ON (m.content.date);',
    ];
  }

  /**
   * Sample queries for common Seren AI operations
   */
  static getSampleQueries() {
    return {
      // Get couple's current relationship health
      getCoupleHealth: `
        MATCH (c:Couple {id: $coupleId})
        RETURN c.healthMetrics as health, c.dynamics as dynamics
      `,

      // Get recent interactions for pattern analysis
      getRecentInteractions: `
        MATCH (i:Interaction {coupleId: $coupleId})
        WHERE i.timestamp > $since
        RETURN i
        ORDER BY i.timestamp DESC
        LIMIT $limit
      `,

      // Get empathic accuracy trends
      getEmpathicAccuracy: `
        MATCH (p1:Person)-[r:PARTNERS_WITH]-(p2:Person)
        WHERE p1.id = $person1Id AND p2.id = $person2Id
        RETURN r.properties.mutualPerception.empathicAccuracy as accuracy
      `,

      // Get incomplete tasks for follow-up
      getIncompleteTasks: `
        MATCH (t:Task {coupleId: $coupleId})
        WHERE t.completion.status IN ['assigned', 'in_progress', 'overdue']
        RETURN t
        ORDER BY t.scheduling.dueDate ASC
      `,

      // Get positive memories for gratitude exercises
      getPositiveMemories: `
        MATCH (m:Memory {coupleId: $coupleId})
        WHERE m.attributes.valence = 'positive' 
        AND m.attributes.emotionalSignificance >= $minSignificance
        RETURN m
        ORDER BY m.content.date DESC
        LIMIT $limit
      `,

      // Track communication pattern improvements
      getCommunicationTrends: `
        MATCH (s:Session {coupleId: $coupleId})
        WHERE s.startTime > $since
        AND s.sessionType IN ['communication_practice', 'conflict_resolution']
        RETURN s.startTime, s.outcomes.progressMade, s.content.emotionalTone
        ORDER BY s.startTime ASC
      `,

      // Get relationship milestone progression
      getMilestoneProgression: `
        MATCH (m:Memory {coupleId: $coupleId})
        WHERE m.memoryType = 'milestone'
        RETURN m.content.date, m.content.title, m.attributes.relationshipImpact
        ORDER BY m.content.date ASC
      `,
    };
  }
}
