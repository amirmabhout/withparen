import { type IAgentRuntime, type UUID, logger, Service } from '@elizaos/core';
import neo4j, { Driver, Session } from 'neo4j-driver';
import {
  type PersonNode,
  type AccountNode,
  type AgentNode,
  type VerificationDataNode,
  type PersonaDimensionNode,
  type DesiredDimensionNode,
  type PersonaDimensionName,
  type DesiredDimensionName,
  type HasAccountRelationship,
  type ManagedByRelationship,
  type ManagedOnRelationship,
  type HasDimensionRelationship,
  type MatchedWithRelationship,
  PERSONA_DIMENSION_NAMES,
  DESIRED_DIMENSION_NAMES,
} from '../utils/graphSchema.js';

/**
 * Memgraph Service for Plugin-Discover-Connection
 * Provides graph database integration for storing and retrieving connection data
 */
export class MemgraphService extends Service {
  static readonly serviceType = 'memgraph';

  static async start(runtime: IAgentRuntime): Promise<MemgraphService> {
    const service = new MemgraphService();
    await service.initialize(runtime);
    return service;
  }

  private driver: Driver | null = null;
  private connectionUrl: string;
  private isConnected = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 5000; // 5 seconds
  private vectorIndexesEnsured: Map<string, boolean> = new Map(); // Track lazy-created indexes
  private healthCheckInterval: Timer | null = null;
  private lastHealthCheck: number = Date.now();
  private agentId: UUID; // Store agent ID for tracking node ownership

  constructor() {
    super();
    // Default to local Memgraph instance
    this.connectionUrl = process.env.MEMGRAPH_URL || 'bolt://localhost:7687';
  }

  async initialize(runtime: IAgentRuntime): Promise<void> {
    logger.info(`[memgraph] Initializing MemgraphService with URL: ${this.connectionUrl}`);

    // Store agent ID for tracking node ownership
    this.agentId = runtime.agentId;

    try {
      await this.connect();
      await this.ensureSchema();

      // Initialize Agent node and Agent-Place relationship once at startup
      await this.initializeAgentNode(runtime);

      logger.success(`[memgraph] MemgraphService initialized successfully`);
    } catch (error) {
      logger.error(`[memgraph] Failed to initialize MemgraphService: ${error}`);
      // Don't throw - allow plugin to continue without Memgraph
    }
  }

  /**
   * Initialize Agent node and establish Agent-Place relationship (called once at startup)
   */
  private async initializeAgentNode(runtime: IAgentRuntime): Promise<void> {
    if (!this.isConnected) {
      logger.warn(`[memgraph] Cannot initialize Agent node - service not connected`);
      return;
    }

    try {
      // Create Agent node
      const agentCreated = await this.createAgentNode({
        agentId: runtime.agentId,
        name: runtime.character?.name || 'Agent',
        username: runtime.character?.username,
        metadata: {
          description: runtime.character?.bio?.[0],
        },
        createdAt: Date.now(),
      });

      if (!agentCreated) {
        logger.warn(`[memgraph] Failed to create Agent node during initialization`);
        return;
      }

      logger.info(`[memgraph] Agent node initialized: ${runtime.agentId}`);

      // Connect Agent to Place if PLACE env variable is set
      const placeName = runtime.getSetting('PLACE');
      if (placeName) {
        const placeExists = await this.getPlaceByName(placeName);
        if (placeExists) {
          const relationshipCreated = await this.createOperatesAtRelationship(
            runtime.agentId,
            placeName,
            'host'
          );

          if (relationshipCreated) {
            logger.info(
              `[memgraph] Agent-OPERATES_AT-Place relationship established: ${runtime.agentId} -> ${placeName}`
            );
          } else {
            logger.warn(`[memgraph] Failed to create Agent-OPERATES_AT-Place relationship`);
          }
        } else {
          logger.warn(
            `[memgraph] Place "${placeName}" not found. Agent-OPERATES_AT-Place relationship not created. ` +
              `Create the Place using: bun scripts/updateMemgraph.ts createPlace scripts/bantabaa-place.json`
          );
        }
      } else {
        logger.debug(`[memgraph] No PLACE setting configured, skipping Agent-Place relationship`);
      }
    } catch (error) {
      logger.error(`[memgraph] Error initializing Agent node: ${error}`);
    }
  }

  async stop(): Promise<void> {
    await this.disconnect();
  }

  get capabilityDescription(): string {
    return 'Memgraph graph database integration for storing and querying connection data, user profiles, and relationship networks.';
  }

  async connect(): Promise<void> {
    try {
      // Close existing driver if any
      if (this.driver) {
        try {
          await this.driver.close();
        } catch (closeError) {
          // Ignore close errors
        }
        this.driver = null;
      }

      // Create new driver with better timeout and connection settings
      this.driver = neo4j.driver(
        this.connectionUrl,
        neo4j.auth.basic('', ''), // Memgraph doesn't require auth by default
        {
          maxConnectionPoolSize: 50,
          connectionAcquisitionTimeout: 10000, // 10 seconds
          connectionTimeout: 10000, // 10 seconds
          maxConnectionLifetime: 3600000, // 1 hour
          logging: {
            level: 'error',
            logger: (level, message) => {
              if (level === 'error') {
                logger.error(`[memgraph] Neo4j driver: ${message}`);
              }
            },
          },
        }
      );

      // Test connection with timeout
      const session = this.driver.session();
      const testPromise = session.run('RETURN 1 as test');
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Connection test timeout')), 5000)
      );

      await Promise.race([testPromise, timeoutPromise]);
      await session.close();

      this.isConnected = true;
      this.reconnectAttempts = 0;
      logger.success(`[memgraph] Connected to Memgraph at ${this.connectionUrl}`);

      // Start health check interval
      this.startHealthCheck();
    } catch (error) {
      this.isConnected = false;
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(
        `[memgraph] Connection failed (attempt ${this.reconnectAttempts + 1}): ${errorMessage}`
      );

      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        logger.warn(
          `[memgraph] Scheduling reconnection (${this.reconnectAttempts}/${this.maxReconnectAttempts}) in ${this.reconnectDelay}ms`
        );

        setTimeout(() => {
          this.connect();
        }, this.reconnectDelay);
      } else {
        logger.error(
          `[memgraph] Max reconnection attempts reached. Service will continue without graph database.`
        );
      }

      // Don't throw to allow plugin to continue
      // throw error;
    }
  }

  async disconnect(): Promise<void> {
    // Stop health check
    this.stopHealthCheck();

    if (this.driver) {
      await this.driver.close();
      this.driver = null;
      this.isConnected = false;
      logger.info(`[memgraph] Disconnected from Memgraph`);
    }
  }

  private startHealthCheck(): void {
    // Clear any existing interval
    this.stopHealthCheck();

    // Start health check every 30 seconds
    this.healthCheckInterval = setInterval(() => {
      this.performHealthCheck();
    }, 30000);
  }

  private stopHealthCheck(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  private async performHealthCheck(): Promise<void> {
    if (!this.isConnected || !this.driver) {
      return;
    }

    const now = Date.now();
    // Skip if we recently did a health check (within 15 seconds)
    if (now - this.lastHealthCheck < 15000) {
      return;
    }

    this.lastHealthCheck = now;

    try {
      const session = this.driver.session();
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Health check timeout')), 5000)
      );

      await Promise.race([session.run('RETURN 1 as health'), timeoutPromise]);

      await session.close();

      // Connection is healthy
      // logger.debug(`[memgraph] Health check successful`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn(`[memgraph] Health check failed: ${errorMessage}`);

      // Mark as disconnected and try to reconnect
      this.isConnected = false;
      this.reconnectAttempts = 0;

      if (this.driver) {
        try {
          await this.driver.close();
        } catch (closeError) {
          // Ignore close errors
        }
        this.driver = null;
      }

      // Stop health checks during reconnection
      this.stopHealthCheck();

      // Attempt reconnect
      setTimeout(() => this.connect(), 1000);
    }
  }

  private async ensureSchema(): Promise<void> {
    if (!this.isConnected || !this.driver) {
      logger.warn(`[memgraph] Cannot ensure schema - not connected`);
      return;
    }

    const session = this.driver.session();

    try {
      // Create indexes for better performance
      const indexQueries = [
        'CREATE INDEX ON :Person(id);',
        'CREATE INDEX ON :Person(agentId);',
        'CREATE INDEX ON :ContactPoint(id);',
        'CREATE INDEX ON :ContactPoint(channelId);',
        'CREATE INDEX ON :PersonaDimension(name);',
        'CREATE INDEX ON :DesiredDimension(name);',
      ];

      for (const query of indexQueries) {
        try {
          await session.run(query);
        } catch (error) {
          // Ignore errors for existing indexes
          const errorMessage = error instanceof Error ? error.message : String(error);
          if (!errorMessage.includes('already exists')) {
            logger.warn(`[memgraph] Index creation warning: ${error}`);
          }
        }
      }

      logger.info(`[memgraph] Schema indexes created successfully`);
      logger.info(`[memgraph] Vector indexes will be created lazily on first embedding write`);
    } catch (error) {
      logger.error(`[memgraph] Failed to ensure schema: ${error}`);
    } finally {
      await session.close();
    }
  }

  /**
   * Ensure vector index exists for given dimension type (lazy creation)
   * Creates index on first use when actual embedding dimension is known
   *
   * @param session - Memgraph session
   * @param dimension - Embedding dimension size (e.g., 768, 1536)
   * @param nodeTypePrefix - Node type prefix ('persona' or 'desired')
   * @param dimensionName - Specific dimension name ('profile', 'demographic', 'characteristic', etc.)
   */
  private async ensureVectorIndexForDimension(
    session: Session,
    dimension: number,
    nodeTypePrefix: 'persona' | 'desired',
    dimensionName: PersonaDimensionName | DesiredDimensionName
  ): Promise<void> {
    // Generate index name: persona_profile_vector_index, desired_vibe_vector_index, etc.
    const indexName = `${nodeTypePrefix}_${dimensionName}_vector_index`;

    // Get the specific node label based on dimension type
    const nodeLabel =
      nodeTypePrefix === 'persona'
        ? PERSONA_DIMENSION_NAMES[dimensionName as PersonaDimensionName]
        : DESIRED_DIMENSION_NAMES[dimensionName as DesiredDimensionName];

    const cacheKey = `${indexName}_${dimension}`;

    if (this.vectorIndexesEnsured.get(cacheKey)) {
      return; // Already ensured for this dimension
    }

    try {
      const query = `CREATE VECTOR INDEX ${indexName} ON :${nodeLabel}(embeddings) WITH CONFIG {
        "dimension": ${dimension},
        "capacity": 10000,
        "metric": "cos"
      }`;

      await session.run(query);
      logger.info(
        `[memgraph] Created vector index: ${indexName} on :${nodeLabel}(embeddings) (dimension: ${dimension})`
      );
      this.vectorIndexesEnsured.set(cacheKey, true);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (
        errorMessage.includes('already exists') ||
        errorMessage.includes('Index already exists')
      ) {
        logger.debug(
          `[memgraph] Vector index ${indexName} already exists (dimension: ${dimension})`
        );
        this.vectorIndexesEnsured.set(cacheKey, true);
      } else {
        logger.error(`[memgraph] Failed to create vector index ${indexName}: ${error}`);
        throw error;
      }
    }
  }

  private async withSession<T>(operation: (session: Session) => Promise<T>): Promise<T | null> {
    if (!this.isConnected || !this.driver) {
      logger.warn(`[memgraph] Operation skipped - service not connected`);
      // Attempt to connect if not connected
      if (!this.isConnected && this.reconnectAttempts <= this.maxReconnectAttempts) {
        setTimeout(() => this.connect(), 100);
      }
      return null;
    }

    let session: Session | null = null;

    try {
      session = this.driver.session();

      // Add timeout for operations
      const timeoutPromise = new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error('Database operation timeout')), 30000)
      );

      const result = await Promise.race([operation(session), timeoutPromise]);

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`[memgraph] Database operation failed: ${errorMessage}`);

      // Attempt to reconnect on connection errors
      if (
        errorMessage.includes('connection') ||
        errorMessage.includes('Connection') ||
        errorMessage.includes('network') ||
        errorMessage.includes('socket') ||
        errorMessage.includes('closed by server') ||
        errorMessage.includes('ECONNREFUSED') ||
        errorMessage.includes('ETIMEDOUT') ||
        errorMessage.includes('timeout')
      ) {
        logger.warn(`[memgraph] Connection error detected, attempting reconnect`);
        this.isConnected = false;
        // Reset reconnect attempts for new connection issues
        this.reconnectAttempts = 0;
        // Check if driver is still valid before attempting reconnect
        if (this.driver) {
          try {
            await this.driver.close();
          } catch (closeError) {
            // Ignore close errors
          }
          this.driver = null;
        }
        setTimeout(() => {
          this.connect();
        }, this.reconnectDelay);
      }

      return null;
    } finally {
      if (session) {
        try {
          await session.close();
        } catch (closeError) {
          // Ignore session close errors
          logger.debug(`[memgraph] Session close error ignored: ${closeError}`);
        }
      }
    }
  }

  /**
   * Retry wrapper for operations that may encounter Memgraph transaction conflicts
   * Uses exponential backoff: 100ms, 200ms, 400ms
   */
  private async withRetry<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    baseDelay: number = 100
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        lastError = error instanceof Error ? error : new Error(String(error));

        // Only retry on transaction conflict errors
        if (errorMessage.includes('Cannot resolve conflicting transactions')) {
          const delay = baseDelay * Math.pow(2, attempt);
          logger.debug(
            `[memgraph] Transaction conflict detected (attempt ${attempt + 1}/${maxRetries}), retrying in ${delay}ms...`
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }

        // For other errors, throw immediately
        throw error;
      }
    }

    // All retries exhausted
    logger.error(`[memgraph] Operation failed after ${maxRetries} retries: ${lastError?.message}`);
    throw lastError;
  }

  // ============================================================================
  // NODE CREATION METHODS
  // ============================================================================

  async createPersonNode(personNode: Omit<PersonNode, 'type'>): Promise<boolean> {
    if (!this.isConnected) {
      logger.error(`[memgraph] Cannot create Person node - service not connected`);
      return false;
    }

    return (
      (await this.withSession(async (session) => {
        const query = `
        MERGE (p:Person {entityid: $entityid})
        ON CREATE SET p.createdAt = $createdAt
        SET p.name = $name,
            p.userStatus = $userStatus,
            p.metadata = $metadata,
            p.updatedAt = $updatedAt,
            p.agentId = $agentId,
            p.type = 'Person'
        RETURN p.entityid as entityid
      `;

        const params = {
          entityid: personNode.entityid,
          name: personNode.name || null,
          userStatus: personNode.userStatus || null,
          metadata: JSON.stringify(personNode.metadata),
          createdAt: personNode.createdAt,
          updatedAt: personNode.updatedAt || Date.now(),
          agentId: this.agentId,
        };

        const result = await session.run(query, params);
        const created = result.records.length > 0;

        if (created) {
          logger.info(`[memgraph] Person node created/updated: ${personNode.entityid}`);
        } else {
          logger.warn(`[memgraph] Person node creation failed: ${personNode.entityid}`);
        }

        return created;
      })) !== null
    );
  }

  async updatePersonProperty(personEntityId: UUID, property: string, value: any): Promise<boolean> {
    if (!this.isConnected) {
      logger.error(`[memgraph] Cannot update Person property - service not connected`);
      return false;
    }

    return (
      (await this.withSession(async (session) => {
        const query = `
        MATCH (p:Person {entityid: $entityid})
        SET p.${property} = $value,
            p.updatedAt = $updatedAt
        RETURN p.entityid as entityid
      `;

        const params = {
          entityid: personEntityId,
          value: value,
          updatedAt: Date.now(),
        };

        const result = await session.run(query, params);
        const updated = result.records.length > 0;

        if (updated) {
          logger.info(
            `[memgraph] Person property updated: ${personEntityId} - ${property} = ${value}`
          );
        } else {
          logger.warn(`[memgraph] Person property update failed: ${personEntityId} - ${property}`);
        }

        return updated;
      })) !== null
    );
  }

  async createPersonaDimensionNode(dimensionNode: {
    name: PersonaDimensionName;
    value: string;
    embeddings: number[];
  }): Promise<boolean> {
    if (!this.isConnected) {
      logger.error(`[memgraph] Cannot create PersonaDimension node - service not connected`);
      return false;
    }

    return (
      (await this.withSession(async (session) => {
        // Get the specific label for this dimension type
        const label = PERSONA_DIMENSION_NAMES[dimensionNode.name];

        const query = `
        MERGE (pd:${label} {value: $value})
        SET pd.embeddings = $embeddings,
            pd.agentId = $agentId
        RETURN pd.value as value, pd.embeddings as embeddings
      `;

        const params = {
          value: dimensionNode.value,
          embeddings: dimensionNode.embeddings, // Pass as array, not JSON string
          agentId: this.agentId,
        };

        const result = await session.run(query, params);
        const created = result.records.length > 0;

        if (created) {
          logger.info(
            `[memgraph] ${label} node created/updated: ${dimensionNode.value.substring(0, 60)}...`
          );

          // Ensure vector index exists AFTER storing - this way we guarantee embeddings are in the node
          const storedEmbeddings = result.records[0].get('embeddings');
          if (storedEmbeddings && storedEmbeddings.length > 0) {
            // Create index using the dimension name (profile, characteristic, etc.)
            await this.ensureVectorIndexForDimension(
              session,
              storedEmbeddings.length,
              'persona',
              dimensionNode.name
            );
          }
        } else {
          logger.warn(`[memgraph] ${label} node creation failed`);
        }

        return created;
      })) !== null
    );
  }

  async createDesiredDimensionNode(dimensionNode: {
    name: DesiredDimensionName;
    value: string;
    embeddings: number[];
  }): Promise<boolean> {
    if (!this.isConnected) {
      logger.error(`[memgraph] Cannot create DesiredDimension node - service not connected`);
      return false;
    }

    return (
      (await this.withSession(async (session) => {
        // Get the specific label for this dimension type
        const label = DESIRED_DIMENSION_NAMES[dimensionNode.name];

        const query = `
        MERGE (dd:${label} {value: $value})
        SET dd.embeddings = $embeddings,
            dd.agentId = $agentId
        RETURN dd.value as value, dd.embeddings as embeddings
      `;

        const params = {
          value: dimensionNode.value,
          embeddings: dimensionNode.embeddings, // Pass as array, not JSON string
          agentId: this.agentId,
        };

        const result = await session.run(query, params);
        const created = result.records.length > 0;

        if (created) {
          logger.info(
            `[memgraph] ${label} node created/updated: ${dimensionNode.value.substring(0, 60)}...`
          );

          // Ensure vector index exists AFTER storing - this way we guarantee embeddings are in the node
          const storedEmbeddings = result.records[0].get('embeddings');
          if (storedEmbeddings && storedEmbeddings.length > 0) {
            // Create index using the dimension name (profile, vibe, etc.)
            await this.ensureVectorIndexForDimension(
              session,
              storedEmbeddings.length,
              'desired',
              dimensionNode.name
            );
          }
        } else {
          logger.warn(`[memgraph] ${label} node creation failed`);
        }

        return created;
      })) !== null
    );
  }

  // ============================================================================
  // RELATIONSHIP CREATION METHODS
  // ============================================================================

  async createHasPersonaDimensionRelationship(
    personEntityId: UUID,
    dimensionName: PersonaDimensionName,
    dimensionValue: string,
    evidence: string
  ): Promise<boolean> {
    if (!this.isConnected) {
      logger.error(`[memgraph] Cannot create HAS_DIMENSION relationship - service not connected`);
      return false;
    }

    return (
      (await this.withSession(async (session) => {
        // Get the specific label for this dimension type
        const label = PERSONA_DIMENSION_NAMES[dimensionName];

        const query = `
        MATCH (p:Person {entityid: $personEntityId})
        MATCH (pd:${label} {value: $dimensionValue})
        MERGE (p)-[r:HAS_DIMENSION]->(pd)
        ON CREATE SET r.createdAt = $createdAt
        SET r.evidence = $evidence,
            r.type = 'HAS_DIMENSION'
        RETURN r
      `;

        const params = {
          personEntityId: personEntityId,
          dimensionValue: dimensionValue,
          createdAt: Date.now(),
          evidence: evidence,
        };

        const result = await session.run(query, params);
        const created = result.records.length > 0;

        if (created) {
          logger.info(
            `[memgraph] HAS_DIMENSION (persona) relationship created: ${label} - ${dimensionValue.substring(0, 60)}...`
          );
        } else {
          logger.warn(
            `[memgraph] HAS_DIMENSION (persona) relationship creation failed - Person or ${label} node may not exist`
          );
        }

        return created;
      })) !== null
    );
  }

  async createHasDesiredDimensionRelationship(
    personEntityId: UUID,
    dimensionName: DesiredDimensionName,
    dimensionValue: string,
    evidence: string
  ): Promise<boolean> {
    if (!this.isConnected) {
      logger.error(`[memgraph] Cannot create HAS_DIMENSION relationship - service not connected`);
      return false;
    }

    return (
      (await this.withSession(async (session) => {
        // Get the specific label for this dimension type
        const label = DESIRED_DIMENSION_NAMES[dimensionName];

        const query = `
        MATCH (p:Person {entityid: $personEntityId})
        MATCH (dd:${label} {value: $dimensionValue})
        MERGE (p)-[r:HAS_DIMENSION]->(dd)
        ON CREATE SET r.createdAt = $createdAt
        SET r.evidence = $evidence,
            r.type = 'HAS_DIMENSION'
        RETURN r
      `;

        const params = {
          personEntityId: personEntityId,
          dimensionValue: dimensionValue,
          createdAt: Date.now(),
          evidence: evidence,
        };

        const result = await session.run(query, params);
        const created = result.records.length > 0;

        if (created) {
          logger.info(
            `[memgraph] HAS_DIMENSION (desired) relationship created: ${label} - ${dimensionValue.substring(0, 60)}...`
          );
        } else {
          logger.warn(
            `[memgraph] HAS_DIMENSION (desired) relationship creation failed - Person or ${label} node may not exist`
          );
        }

        return created;
      })) !== null
    );
  }

  async createMatchedWithRelationship(
    fromEntityId: UUID,
    toEntityId: UUID,
    reasoning: string,
    status:
      | 'match_found'
      | 'proposal_pending'
      | 'accepted'
      | 'declined'
      | 'connected' = 'match_found',
    agentFacilitated?: UUID,
    venueContext?: UUID
  ): Promise<boolean> {
    if (!this.isConnected) {
      logger.error(`[memgraph] Cannot create MATCHED_WITH relationship - service not connected`);
      return false;
    }

    return (
      (await this.withSession(async (session) => {
        const query = `
        MATCH (p1:Person {entityid: $fromEntityId})
        MATCH (p2:Person {entityid: $toEntityId})
        MERGE (p1)-[r:MATCHED_WITH]->(p2)
        ON CREATE SET r.createdAt = $createdAt
        SET r.reasoning = $reasoning,
            r.status = $status,
            r.agentFacilitated = $agentFacilitated,
            r.venueContext = $venueContext,
            r.updatedAt = $updatedAt,
            r.type = 'MATCHED_WITH'
        RETURN r
      `;

        const params = {
          fromEntityId: fromEntityId,
          toEntityId: toEntityId,
          reasoning: reasoning,
          status: status,
          agentFacilitated: agentFacilitated || null,
          venueContext: venueContext || null,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };

        const result = await session.run(query, params);
        const created = result.records.length > 0;

        if (created) {
          logger.info(
            `[memgraph] MATCHED_WITH relationship created: ${fromEntityId} -> ${toEntityId}`
          );
        } else {
          logger.warn(
            `[memgraph] MATCHED_WITH relationship creation failed - One or both Person nodes may not exist`
          );
        }

        return created;
      })) !== null
    );
  }

  // ============================================================================
  // CONVENIENCE METHODS FOR PLUGIN INTEGRATION
  // ============================================================================

  /**
   * Sync a user entity to Memgraph as a Person node
   * Note: agentId parameter removed - use createManagedByRelationship to link Person to Agent
   */
  async syncPersonFromEntity(
    entityId: UUID,
    entityName?: string,
    userStatus?: 'onboarding' | 'active' | 'matched'
  ): Promise<boolean> {
    if (!this.isConnected) {
      logger.warn(
        `[memgraph] Service not connected, skipping Person node sync for entity ${entityId}`
      );
      return false;
    }

    const personNode: Omit<PersonNode, 'type'> = {
      entityid: entityId,
      name: entityName,
      userStatus,
      metadata: {
        email: undefined,
      },
      createdAt: Date.now(),
    };

    const result = await this.createPersonNode(personNode);

    return result;
  }

  /**
   * Sync a channel connection to Memgraph as Account and Agent nodes with relationships
   */
  async syncChannelConnection(
    personId: UUID,
    channelId: string,
    platform: AccountNode['platform'],
    username?: string,
    displayName?: string,
    agentName?: string,
    agentId?: UUID,
    agentUsername?: string
  ): Promise<boolean> {
    if (!this.isConnected) {
      logger.warn(`[memgraph] Service not connected, skipping Account sync for person ${personId}`);
      return false;
    }

    if (!agentId) {
      logger.error(`[memgraph] agentId is required for Account creation`);
      return false;
    }

    // Create or update Agent node
    const agentNode: Omit<AgentNode, 'type'> = {
      agentId,
      name: agentName || 'Agent',
      username: agentUsername,
      createdAt: Date.now(),
    };

    const agentCreated = await this.createAgentNode(agentNode);

    if (!agentCreated) {
      logger.error(`[memgraph] Failed to create Agent node for ${agentId}`);
      return false;
    }

    // Create Account node for the channel
    // Use channelId as identifier for communication platforms
    const accountNode: Omit<AccountNode, 'type'> = {
      platform,
      identifier: channelId, // Use channelId as the unique identifier
      channelId, // Also store as channelId for clarity
      username,
      displayName,
      createdAt: Date.now(),
    };

    const accountCreated = await this.createAccountNode(accountNode);

    if (!accountCreated) {
      logger.error(`[memgraph] Failed to create Account node for channel ${channelId}`);
      return false;
    }

    // Create HAS_ACCOUNT relationship (Person -> Account)
    const hasAccountCreated = await this.createHasAccountRelationship(
      personId,
      platform,
      channelId, // identifier
      'active'
    );

    if (!hasAccountCreated) {
      logger.error(`[memgraph] Failed to create HAS_ACCOUNT relationship`);
      return false;
    }

    // Create MANAGED_ON relationship (Agent -> Account)
    const managedOnCreated = await this.createManagedOnRelationship(
      agentId,
      platform,
      channelId, // identifier
      true // active
    );

    return hasAccountCreated && managedOnCreated;
  }

  /**
   * Sync a persona dimension extracted from AI with HAS_DIMENSION relationship
   * For 'profile' dimension: Updates existing node in-place (one profile per person)
   * For other dimensions: Creates/merges nodes by value (multiple dimensions allowed)
   */
  async syncPersonaDimension(
    personId: UUID,
    dimensionName: PersonaDimensionName,
    value: string,
    embeddings: number[] = [],
    extractionMetadata: any = {}
  ): Promise<boolean> {
    if (!this.isConnected) {
      logger.warn(`[memgraph] Service not connected, skipping PersonaDimension sync`);
      return false;
    }

    // Special handling for 'profile' dimension - one profile per person, updated in-place
    if (dimensionName === 'profile') {
      return await this.syncPersonaProfileInPlace(personId, value, embeddings, extractionMetadata);
    }

    // For other dimensions, use atomic transaction with retry
    return await this.withRetry(async () => {
      const result = await this.withSession(async (session) => {
        const label = PERSONA_DIMENSION_NAMES[dimensionName];
        const evidence =
          extractionMetadata.evidence ||
          extractionMetadata.sourceMessageId ||
          `Extracted from ${extractionMetadata.extractedFrom || 'automated'}`;

        // Atomic query: Create/merge dimension node AND relationship in single transaction
        const query = `
          MATCH (p:Person {entityid: $personId})
          MERGE (pd:${label} {value: $value})
          ON CREATE SET pd.embeddings = $embeddings
          MERGE (p)-[r:HAS_DIMENSION]->(pd)
          ON CREATE SET r.createdAt = $createdAt
          SET r.evidence = $evidence,
              r.type = 'HAS_DIMENSION'
          RETURN pd.value as value, pd.embeddings as embeddings, r
        `;

        const params = {
          personId,
          value,
          embeddings,
          createdAt: Date.now(),
          evidence,
        };

        const queryResult = await session.run(query, params);

        if (queryResult.records.length > 0) {
          logger.info(
            `[memgraph] ${label} dimension synced atomically: ${value.substring(0, 60)}...`
          );

          // Ensure vector index exists
          const storedEmbeddings = queryResult.records[0].get('embeddings');
          if (storedEmbeddings && storedEmbeddings.length > 0) {
            await this.ensureVectorIndexForDimension(
              session,
              storedEmbeddings.length,
              'persona',
              dimensionName
            );
          }

          return true;
        }

        return false;
      });

      return result !== null && result;
    });
  }

  /**
   * Update PersonaProfile for a specific person by replacing old node
   * Ensures each person has exactly one profile node, preventing duplicates in vector search
   * Strategy: Delete old profile node and relationship, create new ones
   */
  private async syncPersonaProfileInPlace(
    personId: UUID,
    value: string,
    embeddings: number[],
    extractionMetadata: any = {}
  ): Promise<boolean> {
    if (!this.isConnected) {
      return false;
    }

    return (
      (await this.withSession(async (session) => {
        const label = PERSONA_DIMENSION_NAMES['profile'];
        const evidence =
          extractionMetadata.evidence ||
          extractionMetadata.sourceMessageId ||
          `Extracted from ${extractionMetadata.extractedFrom || 'automated'}`;

        const query = `
          MATCH (p:Person {entityid: $personId})
          OPTIONAL MATCH (p)-[oldRel:HAS_DIMENSION]->(oldPd:${label})
          DELETE oldRel, oldPd
          WITH p
          CREATE (pd:${label} {value: $value, embeddings: $embeddings})
          CREATE (p)-[r:HAS_DIMENSION]->(pd)
          SET r.evidence = $evidence,
              r.createdAt = $createdAt,
              r.type = 'HAS_DIMENSION'
          RETURN pd.value as value, pd.embeddings as embeddings
        `;

        const params = {
          personId,
          value,
          embeddings,
          evidence,
          createdAt: Date.now(),
        };

        const result = await session.run(query, params);

        if (result.records.length > 0) {
          logger.info(
            `[memgraph] ${label} replaced for person ${personId}: ${value.substring(0, 60)}...`
          );

          // Ensure vector index exists
          const storedEmbeddings = result.records[0].get('embeddings');
          if (storedEmbeddings && storedEmbeddings.length > 0) {
            await this.ensureVectorIndexForDimension(
              session,
              storedEmbeddings.length,
              'persona',
              'profile'
            );
          }

          return true;
        }

        return false;
      })) !== null
    );
  }

  /**
   * Sync a desired connection dimension extracted from AI with HAS_DIMENSION relationship
   * For 'profile' dimension: Updates existing node in-place (one profile per person)
   * For other dimensions: Creates/merges nodes by value (multiple dimensions allowed)
   */
  async syncDesiredDimension(
    personId: UUID,
    dimensionName: DesiredDimensionName,
    value: string,
    embeddings: number[] = [],
    extractionMetadata: any = {}
  ): Promise<boolean> {
    if (!this.isConnected) {
      logger.warn(`[memgraph] Service not connected, skipping DesiredDimension sync`);
      return false;
    }

    // Special handling for 'profile' dimension - one profile per person, updated in-place
    if (dimensionName === 'profile') {
      return await this.syncDesiredProfileInPlace(personId, value, embeddings, extractionMetadata);
    }

    // For other dimensions, use atomic transaction with retry
    return await this.withRetry(async () => {
      const result = await this.withSession(async (session) => {
        const label = DESIRED_DIMENSION_NAMES[dimensionName];
        const evidence =
          extractionMetadata.evidence ||
          extractionMetadata.sourceMessageId ||
          `Extracted from ${extractionMetadata.extractedFrom || 'automated'}`;

        // Atomic query: Create/merge dimension node AND relationship in single transaction
        const query = `
          MATCH (p:Person {entityid: $personId})
          MERGE (dd:${label} {value: $value})
          ON CREATE SET dd.embeddings = $embeddings
          MERGE (p)-[r:HAS_DIMENSION]->(dd)
          ON CREATE SET r.createdAt = $createdAt
          SET r.evidence = $evidence,
              r.type = 'HAS_DIMENSION'
          RETURN dd.value as value, dd.embeddings as embeddings, r
        `;

        const params = {
          personId,
          value,
          embeddings,
          createdAt: Date.now(),
          evidence,
        };

        const queryResult = await session.run(query, params);

        if (queryResult.records.length > 0) {
          logger.info(
            `[memgraph] ${label} dimension synced atomically: ${value.substring(0, 60)}...`
          );

          // Ensure vector index exists
          const storedEmbeddings = queryResult.records[0].get('embeddings');
          if (storedEmbeddings && storedEmbeddings.length > 0) {
            await this.ensureVectorIndexForDimension(
              session,
              storedEmbeddings.length,
              'desired',
              dimensionName
            );
          }

          return true;
        }

        return false;
      });

      return result !== null && result;
    });
  }

  /**
   * Update DesiredProfile for a specific person by replacing old node
   * Ensures each person has exactly one profile node, preventing duplicates in vector search
   * Strategy: Delete old profile node and relationship, create new ones
   */
  private async syncDesiredProfileInPlace(
    personId: UUID,
    value: string,
    embeddings: number[],
    extractionMetadata: any = {}
  ): Promise<boolean> {
    if (!this.isConnected) {
      return false;
    }

    return (
      (await this.withSession(async (session) => {
        const label = DESIRED_DIMENSION_NAMES['profile'];
        const evidence =
          extractionMetadata.evidence ||
          extractionMetadata.sourceMessageId ||
          `Extracted from ${extractionMetadata.extractedFrom || 'automated'}`;

        const query = `
          MATCH (p:Person {entityid: $personId})
          OPTIONAL MATCH (p)-[oldRel:HAS_DIMENSION]->(oldDd:${label})
          DELETE oldRel, oldDd
          WITH p
          CREATE (dd:${label} {value: $value, embeddings: $embeddings})
          CREATE (p)-[r:HAS_DIMENSION]->(dd)
          SET r.evidence = $evidence,
              r.createdAt = $createdAt,
              r.type = 'HAS_DIMENSION'
          RETURN dd.value as value, dd.embeddings as embeddings
        `;

        const params = {
          personId,
          value,
          embeddings,
          evidence,
          createdAt: Date.now(),
        };

        const result = await session.run(query, params);

        if (result.records.length > 0) {
          logger.info(
            `[memgraph] ${label} replaced for person ${personId}: ${value.substring(0, 60)}...`
          );

          // Ensure vector index exists
          const storedEmbeddings = result.records[0].get('embeddings');
          if (storedEmbeddings && storedEmbeddings.length > 0) {
            await this.ensureVectorIndexForDimension(
              session,
              storedEmbeddings.length,
              'desired',
              'profile'
            );
          }

          return true;
        }

        return false;
      })) !== null
    );
  }

  /**
   * Update Person node properties directly (for system properties like userStatus)
   */
  async updatePersonStatus(
    personId: UUID,
    userStatus: 'onboarding' | 'active' | 'matched'
  ): Promise<boolean> {
    if (!this.isConnected) {
      logger.warn(`[memgraph] Service not connected, skipping Person status update`);
      return false;
    }

    return await this.updatePersonProperty(personId, 'userStatus', userStatus);
  }

  /**
   * Update Person node with Solana PDA/ATA addresses after on-chain initialization
   */
  async updatePersonSolanaAddresses(
    personId: UUID,
    solanaData: {
      userAccountPDA: string;
      meMintPDA: string;
      userMeATA: string;
      userMemoATA: string;
      memoMintPDA: string;
      initializedAt: number;
    }
  ): Promise<boolean> {
    if (!this.isConnected) {
      logger.warn(
        `[memgraph] Service not connected, skipping Solana addresses update for ${personId}`
      );
      return false;
    }

    return await this.withSession(async (session) => {
      const query = `
        MATCH (p:Person {entityid: $personId})
        SET p.solana = $solanaData,
            p.updatedAt = timestamp()
        RETURN p
      `;

      await session.run(query, {
        personId,
        solanaData: JSON.stringify(solanaData),
      });

      logger.info(`[memgraph] Updated Solana addresses for Person ${personId}`);
      return true;
    });
  }

  /**
   * Sync a match between two users with MATCHED_WITH relationship
   */
  async syncMatch(
    user1Id: UUID,
    user2Id: UUID,
    reasoning: string,
    status: 'match_found' | 'proposal_pending' | 'accepted' | 'declined' | 'connected',
    agentId?: UUID,
    venueContext?: UUID
  ): Promise<boolean> {
    if (!this.isConnected) {
      logger.warn(`[memgraph] Service not connected, skipping match sync`);
      return false;
    }

    const result = await this.createMatchedWithRelationship(
      user1Id,
      user2Id,
      reasoning,
      status,
      agentId,
      venueContext
    );

    // Update both users' status to 'matched' to prevent them from being matched again
    // Only for active match statuses (not ended matches)
    const activeMatchStatuses = ['match_found', 'proposal_pending', 'accepted'];
    if (activeMatchStatuses.includes(status)) {
      await this.updatePersonStatus(user1Id, 'matched');
      await this.updatePersonStatus(user2Id, 'matched');
      logger.debug(
        `[memgraph] Updated both users ${user1Id} and ${user2Id} to 'matched' status for match with status ${status}`
      );
    }

    return result;
  }

  // ============================================================================
  // QUERY METHODS
  // ============================================================================

  /**
   * Vector search for similar PersonaDimension profiles using Memgraph's vector index
   * @param queryEmbedding - The embedding vector to search for (from connectionContext)
   * @param limit - Maximum number of results to return
   * @param excludeEntityIds - Entity IDs to exclude from results (e.g., requesting user)
   * @param activeUserIds - Set of entity IDs that have ACTIVE status for filtering
   * @param agentId - Agent ID to filter users by (only returns users managed by this agent)
   * @param dimensionName - Specific dimension to search (default: 'profile' for compatibility)
   * @returns Array of matching personas with their similarity scores
   */
  async vectorSearchSimilarPersonas(
    queryEmbedding: number[],
    limit: number = 10,
    excludeEntityIds: UUID[] = [],
    activeUserIds: Set<UUID> = new Set(),
    agentId: UUID,
    dimensionName: PersonaDimensionName = 'profile'
  ): Promise<
    Array<{
      entityId: UUID;
      personaContext: string;
      similarity: number;
    }>
  > {
    if (!this.isConnected) {
      logger.warn(`[memgraph] Service not connected, cannot perform vector search`);
      return [];
    }

    return (
      (await this.withSession(async (session) => {
        try {
          // Convert embedding array to format expected by vector_search
          const embeddingArray = Array.from(queryEmbedding);

          // Get the specific node label for this dimension type
          const nodeLabel = PERSONA_DIMENSION_NAMES[dimensionName];

          // Cypher query: Use vector search to find similar dimension nodes,
          // then join with Person nodes and filter
          const indexName = `persona_${dimensionName}_vector_index`;

          const query = `
            CALL vector_search.search('${indexName}', toInteger($limit * 2), $queryEmbedding)
            YIELD node, similarity
            WITH node as pd, similarity
            MATCH (p:Person)-[:HAS_DIMENSION]->(pd)
            WHERE p.agentId = $agentId
              AND p.userStatus = 'active'
              AND NOT p.entityid IN $excludeIds
              ${activeUserIds.size > 0 ? 'AND p.entityid IN $activeUserIds' : ''}
            RETURN p.entityid as entityId,
                   pd.value as personaContext,
                   similarity
            ORDER BY similarity DESC
            LIMIT toInteger($limit)
          `;

          const params = {
            queryEmbedding: embeddingArray,
            limit: limit,
            excludeIds: excludeEntityIds,
            activeUserIds: Array.from(activeUserIds),
            agentId: agentId,
          };

          const result = await session.run(query, params);

          const matches = result.records.map((record) => ({
            entityId: record.get('entityId') as UUID,
            personaContext: record.get('personaContext') as string,
            similarity: record.get('similarity') as number,
          }));

          logger.info(
            `[memgraph] Vector search found ${matches.length} similar personas for ${dimensionName} (limit: ${limit}, excluded: ${excludeEntityIds.length})`
          );

          return matches;
        } catch (error) {
          logger.error(`[memgraph] Vector search failed: ${error}`);
          throw error; // Re-throw to allow fallback in calling code
        }
      })) || []
    );
  }

  /**
   * Vector search for persona dimensions of a specific user
   * Used by personaMemory provider to find relevant insights based on conversation context
   * @param queryEmbedding - The embedding vector from recent messages
   * @param userId - The user whose persona dimensions to search
   * @param limit - Maximum number of results to return
   * @param dimensionNames - Which dimensions to search (default: all 6)
   * @returns Array of persona insights with similarity scores
   */
  async vectorSearchPersonaDimensions(
    queryEmbedding: number[],
    userId: UUID,
    limit: number = 15,
    dimensionNames: PersonaDimensionName[] = [
      'demographic',
      'characteristic',
      'routine',
      'goal',
      'experience',
      'emotional_state',
    ]
  ): Promise<
    Array<{
      value: string;
      dimension: string;
      similarity: number;
    }>
  > {
    if (!this.isConnected) {
      logger.warn(`[memgraph] Service not connected, cannot perform persona vector search`);
      return [];
    }

    return (
      (await this.withSession(async (session) => {
        try {
          const embeddingArray = Array.from(queryEmbedding);
          const results: Array<{ value: string; dimension: string; similarity: number }> = [];

          // Search each dimension type separately (each has its own vector index)
          for (const dimensionName of dimensionNames) {
            const nodeLabel = PERSONA_DIMENSION_NAMES[dimensionName];
            const indexName = `persona_${dimensionName}_vector_index`;

            const query = `
              CALL vector_search.search('${indexName}', toInteger($limit), $queryEmbedding)
              YIELD node, similarity
              WITH node as pd, similarity
              MATCH (p:Person {entityid: $userId})-[:HAS_DIMENSION]->(pd)
              RETURN pd.value as value,
                     '${dimensionName}' as dimension,
                     similarity
              ORDER BY similarity DESC
              LIMIT toInteger($limitPerDimension)
            `;

            const params = {
              queryEmbedding: embeddingArray,
              userId,
              limit,
              limitPerDimension: Math.ceil(limit / dimensionNames.length), // Distribute limit across dimensions
            };

            try {
              const result = await session.run(query, params);
              const dimensionResults = result.records.map((record) => ({
                value: record.get('value') as string,
                dimension: record.get('dimension') as string,
                similarity: record.get('similarity') as number,
              }));
              results.push(...dimensionResults);
            } catch (dimensionError) {
              logger.debug(
                `[memgraph] Vector search for ${dimensionName} skipped: ${dimensionError}`
              );
              // Continue with other dimensions even if one fails
            }
          }

          // Sort all results by similarity and limit
          results.sort((a, b) => b.similarity - a.similarity);
          const limitedResults = results.slice(0, limit);

          logger.info(
            `[memgraph] Persona vector search found ${limitedResults.length} insights for user ${userId} across ${dimensionNames.length} dimensions`
          );

          return limitedResults;
        } catch (error) {
          logger.error(`[memgraph] Persona vector search failed: ${error}`);
          return [];
        }
      })) || []
    );
  }

  /**
   * Vector search for connection/desired dimensions of a specific user
   * Used by connectionMemory provider to find relevant connection preferences
   * @param queryEmbedding - The embedding vector from recent messages
   * @param userId - The user whose connection preferences to search
   * @param limit - Maximum number of results to return
   * @param dimensionNames - Which dimensions to search (default: all 3 - who, what, how)
   * @returns Array of connection insights with similarity scores
   */
  async vectorSearchDesiredDimensions(
    queryEmbedding: number[],
    userId: UUID,
    limit: number = 12,
    dimensionNames: DesiredDimensionName[] = ['who', 'what', 'how']
  ): Promise<
    Array<{
      value: string;
      dimension: string;
      similarity: number;
    }>
  > {
    if (!this.isConnected) {
      logger.warn(`[memgraph] Service not connected, cannot perform desired vector search`);
      return [];
    }

    return (
      (await this.withSession(async (session) => {
        try {
          const embeddingArray = Array.from(queryEmbedding);
          const results: Array<{ value: string; dimension: string; similarity: number }> = [];

          // Search each dimension type separately (each has its own vector index)
          for (const dimensionName of dimensionNames) {
            const nodeLabel = DESIRED_DIMENSION_NAMES[dimensionName];
            const indexName = `desired_${dimensionName}_vector_index`;

            const query = `
              CALL vector_search.search('${indexName}', toInteger($limit), $queryEmbedding)
              YIELD node, similarity
              WITH node as dd, similarity
              MATCH (p:Person {entityid: $userId})-[:HAS_DIMENSION]->(dd)
              RETURN dd.value as value,
                     '${dimensionName}' as dimension,
                     similarity
              ORDER BY similarity DESC
              LIMIT toInteger($limitPerDimension)
            `;

            const params = {
              queryEmbedding: embeddingArray,
              userId,
              limit,
              limitPerDimension: Math.ceil(limit / dimensionNames.length), // Distribute limit across dimensions
            };

            try {
              const result = await session.run(query, params);
              const dimensionResults = result.records.map((record) => ({
                value: record.get('value') as string,
                dimension: record.get('dimension') as string,
                similarity: record.get('similarity') as number,
              }));
              results.push(...dimensionResults);
            } catch (dimensionError) {
              logger.debug(
                `[memgraph] Vector search for ${dimensionName} skipped: ${dimensionError}`
              );
              // Continue with other dimensions even if one fails
            }
          }

          // Sort all results by similarity and limit
          results.sort((a, b) => b.similarity - a.similarity);
          const limitedResults = results.slice(0, limit);

          logger.info(
            `[memgraph] Desired vector search found ${limitedResults.length} insights for user ${userId} across ${dimensionNames.length} dimensions`
          );

          return limitedResults;
        } catch (error) {
          logger.error(`[memgraph] Desired vector search failed: ${error}`);
          return [];
        }
      })) || []
    );
  }

  async getPersonNode(personId: UUID): Promise<PersonNode | null> {
    return await this.withSession(async (session) => {
      const query = 'MATCH (p:Person {entityid: $entityid}) RETURN p';
      const result = await session.run(query, { entityid: personId });

      if (result.records.length > 0) {
        const record = result.records[0];
        const node = record.get('p');
        return {
          type: 'Person',
          entityid: node.properties.entityid,
          agentId: node.properties.agentId,
          name: node.properties.name,
          userStatus: node.properties.userStatus,
          metadata: JSON.parse(node.properties.metadata || '{}'),
          solana: node.properties.solana || undefined,
          createdAt: node.properties.createdAt,
          updatedAt: node.properties.updatedAt,
        } as PersonNode;
      }

      return null;
    });
  }

  async getPersonConnections(personId: UUID): Promise<{
    accounts: AccountNode[];
    personaDimensions: PersonaDimensionNode[];
    desiredDimensions: DesiredDimensionNode[];
    matches: PersonNode[];
  }> {
    return (
      (await this.withSession(async (session) => {
        const query = `
        MATCH (p:Person {entityid: $entityid})
        OPTIONAL MATCH (p)-[:HAS_ACCOUNT]->(a:Account)
        OPTIONAL MATCH (p)-[:HAS_DIMENSION]->(pd:PersonaDimension)
        OPTIONAL MATCH (p)-[:HAS_DIMENSION]->(dd:DesiredDimension)
        OPTIONAL MATCH (p)-[:MATCHED_WITH]->(m:Person)
        RETURN p, collect(DISTINCT a) as accounts,
               collect(DISTINCT pd) as personaDimensions,
               collect(DISTINCT dd) as desiredDimensions,
               collect(DISTINCT m) as matches
      `;

        const result = await session.run(query, { entityid: personId });

        if (result.records.length > 0) {
          const record = result.records[0];

          const accounts = record
            .get('accounts')
            .filter((a: any) => a !== null)
            .map(
              (a: any) =>
                ({
                  type: 'Account',
                  platform: a.properties.platform,
                  identifier: a.properties.identifier,
                  channelId: a.properties.channelId,
                  username: a.properties.username,
                  displayName: a.properties.displayName,
                  profileUrl: a.properties.profileUrl,
                  hasMinimumInfo: a.properties.hasMinimumInfo,
                  createdAt: a.properties.createdAt,
                  updatedAt: a.properties.updatedAt,
                }) as AccountNode
            );

          const personaDimensions = record
            .get('personaDimensions')
            .filter((pd: any) => pd !== null)
            .map(
              (pd: any) =>
                ({
                  type: 'PersonaDimension',
                  name: pd.properties.name,
                  value: pd.properties.value,
                  embeddings: JSON.parse(pd.properties.embeddings || '[]'),
                }) as PersonaDimensionNode
            );

          const desiredDimensions = record
            .get('desiredDimensions')
            .filter((dd: any) => dd !== null)
            .map(
              (dd: any) =>
                ({
                  type: 'DesiredDimension',
                  name: dd.properties.name,
                  value: dd.properties.value,
                  embeddings: JSON.parse(dd.properties.embeddings || '[]'),
                }) as DesiredDimensionNode
            );

          const matches = record
            .get('matches')
            .filter((m: any) => m !== null)
            .map(
              (m: any) =>
                ({
                  type: 'Person',
                  entityid: m.properties.entityid,
                  agentId: m.properties.agentId,
                  name: m.properties.name,
                  userStatus: m.properties.userStatus,
                  metadata: JSON.parse(m.properties.metadata || '{}'),
                  createdAt: m.properties.createdAt,
                  updatedAt: m.properties.updatedAt,
                }) as PersonNode
            );

          return { accounts, personaDimensions, desiredDimensions, matches };
        }

        return { accounts: [], personaDimensions: [], desiredDimensions: [], matches: [] };
      })) || { accounts: [], personaDimensions: [], desiredDimensions: [], matches: [] }
    );
  }

  /**
   * Get user status from Person node
   */
  async getUserStatus(
    personId: UUID
  ): Promise<'onboarding' | 'unverified_member' | 'verification_pending' | 'group_member' | null> {
    if (!this.isConnected) {
      logger.warn(`[memgraph] Service not connected, cannot get user status`);
      return null;
    }

    const personNode = await this.getPersonNode(personId);
    return personNode?.userStatus || null;
  }

  /**
   * Get all users with a specific status
   */
  async getUsersByStatus(
    status: 'onboarding' | 'unverified_member' | 'verification_pending' | 'group_member',
    limit: number = 50
  ): Promise<UUID[]> {
    if (!this.isConnected) {
      logger.warn(`[memgraph] Service not connected, returning empty user list`);
      return [];
    }

    return (
      (await this.withSession(async (session) => {
        const query = `
          MATCH (p:Person {userStatus: $status})
          RETURN p.entityid as entityId
          LIMIT toInteger($limit)
        `;

        const result = await session.run(query, { status, limit: limit });

        const userIds = result.records.map((record) => record.get('entityId') as UUID);

        logger.debug(`[memgraph] Found ${userIds.length} users with status ${status}`);
        return userIds;
      })) || []
    );
  }

  /**
   * Check if user has completed onboarding by checking for persona and desired dimensions
   */
  async hasOnboardingDimensions(
    personId: UUID
  ): Promise<{ hasPersonaDimensions: boolean; hasDesiredDimensions: boolean }> {
    if (!this.isConnected) {
      logger.warn(`[memgraph] Service not connected, cannot check onboarding dimensions`);
      return { hasPersonaDimensions: false, hasDesiredDimensions: false };
    }

    return (
      (await this.withSession(async (session) => {
        const query = `
          MATCH (p:Person {entityid: $personId})
          OPTIONAL MATCH (p)-[:HAS_DIMENSION]->(pd)
          WHERE pd:PersonaProfile OR pd:PersonaDemographic OR pd:PersonaCharacteristic
                OR pd:PersonaRoutine OR pd:PersonaGoal OR pd:PersonaExperience
                OR pd:PersonaEmotionalState
          OPTIONAL MATCH (p)-[:HAS_DIMENSION]->(dd)
          WHERE dd:DesiredProfile OR dd:DesiredWho OR dd:DesiredWhat OR dd:DesiredHow
          RETURN
            COUNT(DISTINCT pd) > 0 as hasPersonaDimensions,
            COUNT(DISTINCT dd) > 0 as hasDesiredDimensions
        `;

        const result = await session.run(query, { personId });

        if (result.records.length > 0) {
          const record = result.records[0];
          return {
            hasPersonaDimensions: record.get('hasPersonaDimensions') as boolean,
            hasDesiredDimensions: record.get('hasDesiredDimensions') as boolean,
          };
        }

        return { hasPersonaDimensions: false, hasDesiredDimensions: false };
      })) || { hasPersonaDimensions: false, hasDesiredDimensions: false }
    );
  }

  // ============================================================================
  // VERIFICATION DATA METHODS
  // ============================================================================

  /**
   * Create or update VerificationData node for a person
   */
  async createVerificationDataNode(
    personId: UUID,
    verificationData: Partial<Omit<VerificationDataNode, 'type'>>
  ): Promise<boolean> {
    if (!this.isConnected) {
      logger.error(`[memgraph] Cannot create VerificationData - service not connected`);
      return false;
    }

    return (
      (await this.withSession(async (session) => {
        const query = `
        MATCH (p:Person {entityid: $personId})
        MERGE (p)-[r:HAS_VERIFICATION]->(v:VerificationData {personId: $personId})
        ON CREATE SET v.createdAt = $createdAt, r.createdAt = $createdAt
        SET v.circlesAccount = $circlesAccount,
            v.circlesStatus = $circlesStatus,
            v.incomingTrustCount = $incomingTrustCount,
            v.isVerified = $isVerified,
            v.trustsNeeded = $trustsNeeded,
            v.trustTransactionHash = $trustTransactionHash,
            v.trustedAt = $trustedAt,
            v.circlesGroupCA = $circlesGroupCA,
            v.socialLinks = $socialLinks,
            v.hasMinimumInfo = $hasMinimumInfo,
            v.updatedAt = $updatedAt,
            v.type = 'VerificationData',
            r.updatedAt = $updatedAt
        RETURN v.personId as personId
      `;

        const now = Date.now();
        const params = {
          personId: personId,
          circlesAccount: verificationData.circlesAccount || null,
          circlesStatus: verificationData.circlesStatus || null,
          incomingTrustCount: verificationData.incomingTrustCount ?? null,
          isVerified: verificationData.isVerified ?? false,
          trustsNeeded: verificationData.trustsNeeded ?? null,
          trustTransactionHash: verificationData.trustTransactionHash || null,
          trustedAt: verificationData.trustedAt ?? null,
          circlesGroupCA: verificationData.circlesGroupCA || null,
          socialLinks: JSON.stringify(verificationData.socialLinks || []),
          hasMinimumInfo: verificationData.hasMinimumInfo ?? false,
          createdAt: now,
          updatedAt: now,
        };

        const result = await session.run(query, params);
        const created = result.records.length > 0;

        if (created) {
          logger.info(`[memgraph] VerificationData node created/updated for person ${personId}`);
        } else {
          logger.warn(`[memgraph] VerificationData node creation failed for person ${personId}`);
        }

        return created;
      })) !== null
    );
  }

  /**
   * Get VerificationData for a person
   */
  async getPersonVerificationData(personId: UUID): Promise<VerificationDataNode | null> {
    if (!this.isConnected) {
      logger.warn(`[memgraph] Service not connected, cannot get verification data`);
      return null;
    }

    return await this.withSession(async (session) => {
      const query = `
        MATCH (p:Person {entityid: $personId})-[:HAS_VERIFICATION]->(v:VerificationData)
        RETURN v
      `;

      const result = await session.run(query, { personId });

      if (result.records.length > 0) {
        const node = result.records[0].get('v');
        return {
          type: 'VerificationData',
          circlesAccount: node.properties.circlesAccount || undefined,
          circlesStatus: node.properties.circlesStatus || undefined,
          incomingTrustCount: node.properties.incomingTrustCount ?? undefined,
          isVerified: node.properties.isVerified ?? false,
          trustsNeeded: node.properties.trustsNeeded ?? undefined,
          trustTransactionHash: node.properties.trustTransactionHash || undefined,
          trustedAt: node.properties.trustedAt ?? undefined,
          circlesGroupCA: node.properties.circlesGroupCA || undefined,
          socialLinks: JSON.parse(node.properties.socialLinks || '[]'),
          hasMinimumInfo: node.properties.hasMinimumInfo ?? false,
          createdAt: node.properties.createdAt,
          updatedAt: node.properties.updatedAt || undefined,
        } as VerificationDataNode;
      }

      return null;
    });
  }

  /**
   * Update specific fields in VerificationData
   */
  async updateVerificationData(
    personId: UUID,
    updates: Partial<Omit<VerificationDataNode, 'type' | 'createdAt'>>
  ): Promise<boolean> {
    if (!this.isConnected) {
      logger.warn(`[memgraph] Service not connected, cannot update verification data`);
      return false;
    }

    // Build SET clauses dynamically based on provided updates
    const setClauses: string[] = ['v.updatedAt = $updatedAt', 'r.updatedAt = $updatedAt'];
    const params: any = {
      personId,
      updatedAt: Date.now(),
    };

    if (updates.circlesAccount !== undefined) {
      setClauses.push('v.circlesAccount = $circlesAccount');
      params.circlesAccount = updates.circlesAccount;
    }
    if (updates.circlesStatus !== undefined) {
      setClauses.push('v.circlesStatus = $circlesStatus');
      params.circlesStatus = updates.circlesStatus;
    }
    if (updates.incomingTrustCount !== undefined) {
      setClauses.push('v.incomingTrustCount = $incomingTrustCount');
      params.incomingTrustCount = updates.incomingTrustCount;
    }
    if (updates.isVerified !== undefined) {
      setClauses.push('v.isVerified = $isVerified');
      params.isVerified = updates.isVerified;
    }
    if (updates.trustsNeeded !== undefined) {
      setClauses.push('v.trustsNeeded = $trustsNeeded');
      params.trustsNeeded = updates.trustsNeeded;
    }
    if (updates.trustTransactionHash !== undefined) {
      setClauses.push('v.trustTransactionHash = $trustTransactionHash');
      params.trustTransactionHash = updates.trustTransactionHash;
    }
    if (updates.trustedAt !== undefined) {
      setClauses.push('v.trustedAt = $trustedAt');
      params.trustedAt = updates.trustedAt;
    }
    if (updates.circlesGroupCA !== undefined) {
      setClauses.push('v.circlesGroupCA = $circlesGroupCA');
      params.circlesGroupCA = updates.circlesGroupCA;
    }
    if (updates.socialLinks !== undefined) {
      setClauses.push('v.socialLinks = $socialLinks');
      params.socialLinks = JSON.stringify(updates.socialLinks);
    }
    if (updates.hasMinimumInfo !== undefined) {
      setClauses.push('v.hasMinimumInfo = $hasMinimumInfo');
      params.hasMinimumInfo = updates.hasMinimumInfo;
    }

    return (
      (await this.withSession(async (session) => {
        const query = `
        MATCH (p:Person {entityid: $personId})-[r:HAS_VERIFICATION]->(v:VerificationData)
        SET ${setClauses.join(', ')}
        RETURN v.personId as personId
      `;

        const result = await session.run(query, params);
        const updated = result.records.length > 0;

        if (updated) {
          logger.info(`[memgraph] VerificationData updated for person ${personId}`);
        } else {
          logger.warn(
            `[memgraph] VerificationData update failed - no node found for person ${personId}`
          );
        }

        return updated;
      })) !== null
    );
  }

  /**
   * Check if person has minimum verification info
   */
  async hasMinimumVerificationInfo(personId: UUID): Promise<boolean> {
    if (!this.isConnected) {
      return false;
    }

    const verificationData = await this.getPersonVerificationData(personId);
    return verificationData?.hasMinimumInfo ?? false;
  }

  /**
   * Get users by verification status
   */
  async getUsersByVerificationStatus(
    status: 'verified' | 'registered' | 'unregistered',
    limit: number = 50
  ): Promise<UUID[]> {
    if (!this.isConnected) {
      logger.warn(`[memgraph] Service not connected, returning empty list`);
      return [];
    }

    return (
      (await this.withSession(async (session) => {
        const query = `
          MATCH (p:Person)-[:HAS_VERIFICATION]->(v:VerificationData {circlesStatus: $status})
          RETURN p.entityid as entityId
          LIMIT toInteger($limit)
        `;

        const result = await session.run(query, { status, limit });

        const userIds = result.records.map((record) => record.get('entityId') as UUID);

        logger.debug(`[memgraph] Found ${userIds.length} users with verification status ${status}`);
        return userIds;
      })) || []
    );
  }

  // ============================================================================
  // NEW UNIFIED SCHEMA METHODS (AccountNode + AgentNode)
  // ============================================================================

  /**
   * Create or update an AccountNode
   * Unified node for Circles wallets, social media accounts, and contact channels
   */
  async createAccountNode(accountData: Omit<AccountNode, 'type'>): Promise<boolean> {
    if (!this.isConnected) {
      logger.error(`[memgraph] Cannot create Account - service not connected`);
      return false;
    }

    return (
      (await this.withSession(async (session) => {
        // Use platform + identifier as composite key
        const query = `
          MERGE (a:Account {platform: $platform, identifier: $identifier})
          ON CREATE SET a.createdAt = $createdAt
          SET a.displayName = $displayName,
              a.profileUrl = $profileUrl,
              a.channelId = $channelId,
              a.username = $username,
              a.hasMinimumInfo = $hasMinimumInfo,
              a.agentId = $agentId,
              a.updatedAt = $updatedAt,
              a.type = 'Account'
              ${
                accountData.circles
                  ? `,
              a.circlesStatus = $circlesStatus,
              a.circlesIncomingTrustCount = $circlesIncomingTrustCount,
              a.circlesTrustsNeeded = $circlesTrustsNeeded,
              a.circlesIsVerified = $circlesIsVerified,
              a.circlesTrustTransactionHash = $circlesTrustTransactionHash,
              a.circlesTrustTransactionTimestamp = $circlesTrustTransactionTimestamp,
              a.circlesTrustGroupCA = $circlesTrustGroupCA`
                  : ''
              }
          RETURN a.identifier as identifier
        `;

        const params: any = {
          platform: accountData.platform,
          identifier: accountData.identifier,
          displayName: accountData.displayName || null,
          profileUrl: accountData.profileUrl || null,
          channelId: accountData.channelId || null,
          username: accountData.username || null,
          hasMinimumInfo: accountData.hasMinimumInfo || null,
          agentId: this.agentId,
          createdAt: accountData.createdAt,
          updatedAt: accountData.updatedAt || Date.now(),
        };

        // Add Circles-specific params if present
        if (accountData.circles) {
          params.circlesStatus = accountData.circles.status;
          params.circlesIncomingTrustCount = accountData.circles.incomingTrustCount;
          params.circlesTrustsNeeded = accountData.circles.trustsNeeded;
          params.circlesIsVerified = accountData.circles.isVerified;
          params.circlesTrustTransactionHash = accountData.circles.trustTransaction?.hash || null;
          params.circlesTrustTransactionTimestamp =
            accountData.circles.trustTransaction?.timestamp || null;
          params.circlesTrustGroupCA = accountData.circles.trustTransaction?.groupCA || null;
        }

        const result = await session.run(query, params);

        if (result.records.length > 0) {
          logger.debug(
            `[memgraph] Created/updated Account node: ${accountData.platform}:${accountData.identifier}`
          );
          return result.records[0].get('identifier');
        }
        return null;
      })) !== null
    );
  }

  /**
   * Create or update an AgentNode
   */
  async createAgentNode(agentData: Omit<AgentNode, 'type'>): Promise<boolean> {
    if (!this.isConnected) {
      logger.error(`[memgraph] Cannot create Agent - service not connected`);
      return false;
    }

    return (
      (await this.withSession(async (session) => {
        const query = `
          MERGE (agent:Agent {agentId: $agentId})
          ON CREATE SET agent.createdAt = $createdAt
          SET agent.name = $name,
              agent.username = $username,
              agent.metadataDescription = $metadataDescription,
              agent.metadataCapabilities = $metadataCapabilities,
              agent.metadataVersion = $metadataVersion,
              agent.updatedAt = $updatedAt,
              agent.type = 'Agent'
          RETURN agent.agentId as agentId
        `;

        const params = {
          agentId: agentData.agentId,
          name: agentData.name,
          username: agentData.username || null,
          metadataDescription: agentData.metadata?.description || null,
          metadataCapabilities: agentData.metadata?.capabilities || null,
          metadataVersion: agentData.metadata?.version || null,
          createdAt: agentData.createdAt,
          updatedAt: agentData.updatedAt || Date.now(),
        };

        const result = await session.run(query, params);

        if (result.records.length > 0) {
          logger.debug(`[memgraph] Created/updated Agent node: ${agentData.agentId}`);
          return result.records[0].get('agentId');
        }
        return null;
      })) !== null
    );
  }

  /**
   * Create HAS_ACCOUNT relationship (Person -> Account)
   */
  async createHasAccountRelationship(
    personId: UUID,
    platform: AccountNode['platform'],
    identifier: string,
    status: 'active' | 'inactive' | 'pending_verification' = 'active',
    isPrimary: boolean = false
  ): Promise<boolean> {
    if (!this.isConnected) {
      logger.error(`[memgraph] Cannot create HAS_ACCOUNT relationship - service not connected`);
      return false;
    }

    return (
      (await this.withSession(async (session) => {
        const query = `
          MATCH (p:Person {entityid: $personId})
          MATCH (a:Account {platform: $platform, identifier: $identifier})
          MERGE (p)-[r:HAS_ACCOUNT]->(a)
          ON CREATE SET r.createdAt = $createdAt
          SET r.status = $status,
              r.isPrimary = $isPrimary,
              r.updatedAt = $updatedAt
          RETURN p.entityid as personId
        `;

        const params = {
          personId,
          platform,
          identifier,
          status,
          isPrimary,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };

        const result = await session.run(query, params);

        if (result.records.length > 0) {
          logger.debug(
            `[memgraph] Created HAS_ACCOUNT relationship: ${personId} -> ${platform}:${identifier}`
          );
          return result.records[0].get('personId');
        }
        return null;
      })) !== null
    );
  }

  /**
   * Create MANAGED_BY relationship (Person -> Agent)
   */
  async createManagedByRelationship(
    personId: UUID,
    agentId: UUID,
    managementStartedAt?: number
  ): Promise<boolean> {
    if (!this.isConnected) {
      logger.error(`[memgraph] Cannot create MANAGED_BY relationship - service not connected`);
      return false;
    }

    return (
      (await this.withSession(async (session) => {
        const query = `
          MATCH (p:Person {entityid: $personId})
          MATCH (agent:Agent {agentId: $agentId})
          MERGE (p)-[r:MANAGED_BY]->(agent)
          ON CREATE SET r.createdAt = $createdAt
          SET r.managementStartedAt = $managementStartedAt,
              r.lastInteractionAt = $lastInteractionAt,
              r.updatedAt = $updatedAt
          RETURN p.entityid as personId
        `;

        const params = {
          personId,
          agentId,
          managementStartedAt: managementStartedAt || Date.now(),
          lastInteractionAt: Date.now(),
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };

        const result = await session.run(query, params);

        if (result.records.length > 0) {
          logger.debug(`[memgraph] Created MANAGED_BY relationship: ${personId} -> ${agentId}`);
          return result.records[0].get('personId');
        }
        return null;
      })) !== null
    );
  }

  /**
   * Create MANAGED_ON relationship (Agent -> Account)
   * Links agent to communication channels they operate on
   */
  async createManagedOnRelationship(
    agentId: UUID,
    platform: AccountNode['platform'],
    identifier: string,
    active: boolean = true
  ): Promise<boolean> {
    if (!this.isConnected) {
      logger.error(`[memgraph] Cannot create MANAGED_ON relationship - service not connected`);
      return false;
    }

    return (
      (await this.withSession(async (session) => {
        const query = `
          MATCH (agent:Agent {agentId: $agentId})
          MATCH (a:Account {platform: $platform, identifier: $identifier})
          MERGE (agent)-[r:MANAGED_ON]->(a)
          ON CREATE SET r.createdAt = $createdAt
          SET r.active = $active,
              r.updatedAt = $updatedAt
          RETURN agent.agentId as agentId
        `;

        const params = {
          agentId,
          platform,
          identifier,
          active,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };

        const result = await session.run(query, params);

        if (result.records.length > 0) {
          logger.debug(
            `[memgraph] Created MANAGED_ON relationship: ${agentId} -> ${platform}:${identifier}`
          );
          return result.records[0].get('agentId');
        }
        return null;
      })) !== null
    );
  }

  /**
   * Get Place node by name
   */
  async getPlaceByName(
    placeName: string
  ): Promise<import('../utils/graphSchema.js').PlaceNode | null> {
    if (!this.isConnected) {
      logger.warn(`[memgraph] Cannot get Place - service not connected`);
      return null;
    }

    return await this.withSession(async (session) => {
      const query = `
        MATCH (p:Place {name: $placeName})
        RETURN p
      `;

      const result = await session.run(query, { placeName });

      if (result.records.length === 0) {
        logger.debug(`[memgraph] Place not found: ${placeName}`);
        return null;
      }

      const placeNode = result.records[0].get('p');

      const place: import('../utils/graphSchema.js').PlaceNode = {
        type: 'Place',
        venueType: placeNode.properties.venueType,
        name: placeNode.properties.name,
        description: placeNode.properties.description,
        url: placeNode.properties.url,
        address: placeNode.properties.address,
        operatingHours: JSON.parse(placeNode.properties.operatingHours || '{}'),
        classTimetable: JSON.parse(placeNode.properties.classTimetable || '[]'),
        metadata: JSON.parse(placeNode.properties.metadata || '{}'),
        createdAt: placeNode.properties.createdAt,
        updatedAt: placeNode.properties.updatedAt,
      };

      logger.debug(`[memgraph] Found Place: ${placeName}`);
      return place;
    });
  }

  /**
   * Create ATTENDS relationship (Person -> Place)
   * Schema.org inspired - person attends/frequents this place
   */
  async createAttendsRelationship(
    personId: UUID,
    placeName: string,
    frequency: 'regular' | 'occasional' | 'first-time' = 'regular'
  ): Promise<boolean> {
    if (!this.isConnected) {
      logger.error(`[memgraph] Cannot create ATTENDS relationship - service not connected`);
      return false;
    }

    return (
      (await this.withSession(async (session) => {
        const now = Date.now();
        const query = `
          MATCH (person:Person {entityid: $personId})
          MATCH (place:Place {name: $placeName})
          MERGE (person)-[r:ATTENDS]->(place)
          ON CREATE SET
            r.createdAt = $createdAt,
            r.firstVisit = $firstVisit
          SET
            r.frequency = $frequency,
            r.lastVisit = $lastVisit,
            r.updatedAt = $updatedAt
          RETURN person.entityid as personId
        `;

        const result = await session.run(query, {
          personId,
          placeName,
          frequency,
          firstVisit: now,
          lastVisit: now,
          createdAt: now,
          updatedAt: now,
        });

        if (result.records.length > 0) {
          logger.info(
            `[memgraph] Created ATTENDS relationship: Person ${personId} -> Place ${placeName}`
          );
          return result.records[0].get('personId');
        }

        logger.warn(`[memgraph] Failed to create ATTENDS relationship for ${personId}`);
        return null;
      })) !== null
    );
  }

  /**
   * Create OPERATES_AT relationship (Agent -> Place)
   * Agent operates/provides services at this place
   */
  async createOperatesAtRelationship(
    agentId: UUID,
    placeName: string,
    role: 'host' | 'assistant' | 'manager' = 'host'
  ): Promise<boolean> {
    if (!this.isConnected) {
      logger.error(`[memgraph] Cannot create OPERATES_AT relationship - service not connected`);
      return false;
    }

    return (
      (await this.withSession(async (session) => {
        const query = `
          MATCH (agent:Agent {agentId: $agentId})
          MATCH (place:Place {name: $placeName})
          MERGE (agent)-[r:OPERATES_AT]->(place)
          ON CREATE SET r.createdAt = $createdAt
          SET
            r.role = $role,
            r.updatedAt = $updatedAt
          RETURN agent.agentId as agentId
        `;

        const result = await session.run(query, {
          agentId,
          placeName,
          role,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        if (result.records.length > 0) {
          logger.info(
            `[memgraph] Created OPERATES_AT relationship: Agent ${agentId} -> Place ${placeName}`
          );
          return result.records[0].get('agentId');
        }

        logger.warn(`[memgraph] Failed to create OPERATES_AT relationship for ${agentId}`);
        return null;
      })) !== null
    );
  }

  /**
   * Get all accounts for a person, optionally filtered by platform
   */
  async getPersonAccounts(
    personId: UUID,
    platform?: AccountNode['platform']
  ): Promise<AccountNode[]> {
    if (!this.isConnected) {
      logger.warn(`[memgraph] Service not connected, returning empty list`);
      return [];
    }

    return (
      (await this.withSession(async (session) => {
        const platformFilter = platform ? `{platform: $platform}` : '';
        const query = `
          MATCH (p:Person {entityid: $personId})-[:HAS_ACCOUNT]->(a:Account ${platformFilter})
          RETURN a
          ORDER BY a.createdAt DESC
        `;

        const result = await session.run(query, { personId, platform });

        const accounts: AccountNode[] = result.records.map((record) => {
          const node = record.get('a').properties;
          return {
            type: 'Account',
            platform: node.platform,
            identifier: node.identifier,
            channelId: node.channelId || undefined,
            username: node.username || undefined,
            displayName: node.displayName || undefined,
            profileUrl: node.profileUrl || undefined,
            circles: node.circlesStatus
              ? {
                  status: node.circlesStatus,
                  incomingTrustCount: node.circlesIncomingTrustCount || 0,
                  trustsNeeded: node.circlesTrustsNeeded || 0,
                  isVerified: node.circlesIsVerified || false,
                  trustTransaction: node.circlesTrustTransactionHash
                    ? {
                        hash: node.circlesTrustTransactionHash,
                        timestamp: node.circlesTrustTransactionTimestamp,
                        groupCA: node.circlesTrustGroupCA,
                      }
                    : undefined,
                }
              : undefined,
            hasMinimumInfo: node.hasMinimumInfo || undefined,
            createdAt: node.createdAt,
            updatedAt: node.updatedAt || undefined,
          };
        });

        logger.debug(`[memgraph] Found ${accounts.length} accounts for person ${personId}`);
        return accounts;
      })) || []
    );
  }

  /**
   * Get the agent managing a person
   */
  async getPersonAgent(personId: UUID): Promise<AgentNode | null> {
    if (!this.isConnected) {
      logger.warn(`[memgraph] Service not connected, returning null`);
      return null;
    }

    return await this.withSession(async (session) => {
      const query = `
        MATCH (p:Person {entityid: $personId})-[:MANAGED_BY]->(agent:Agent)
        RETURN agent
        LIMIT 1
      `;

      const result = await session.run(query, { personId });

      if (result.records.length === 0) {
        return null;
      }

      const node = result.records[0].get('agent').properties;
      return {
        type: 'Agent',
        agentId: node.agentId,
        name: node.name,
        username: node.username || undefined,
        metadata: {
          description: node.metadataDescription || undefined,
          capabilities: node.metadataCapabilities || undefined,
          version: node.metadataVersion || undefined,
        },
        createdAt: node.createdAt,
        updatedAt: node.updatedAt || undefined,
      };
    });
  }

  // ============================================================================
  // MATCH QUERY METHODS
  // ============================================================================

  /**
   * Get outgoing matches where user is the initiator
   */
  async getOutgoingMatches(
    userId: UUID,
    status?: 'match_found' | 'proposal_pending' | 'accepted' | 'declined' | 'connected'
  ): Promise<MatchedWithRelationship[]> {
    if (!this.isConnected) {
      logger.warn(`[memgraph] Service not connected, returning empty array`);
      return [];
    }

    return (
      (await this.withSession(async (session) => {
        const statusFilter = status ? 'AND r.status = $status' : '';
        const query = `
          MATCH (p:Person {entityid: $userId})-[r:MATCHED_WITH]->(other:Person)
          WHERE 1=1 ${statusFilter}
          RETURN r, other.entityid as otherUserId
          ORDER BY r.createdAt DESC
        `;

        const result = await session.run(query, { userId, status });

        const matches: MatchedWithRelationship[] = result.records.map((record) => {
          const rel = record.get('r').properties;
          const otherUserId = record.get('otherUserId');

          return {
            type: 'MATCHED_WITH',
            from: userId,
            to: otherUserId,
            reasoning: rel.reasoning,
            status: rel.status,
            agentFacilitated: rel.agentFacilitated || undefined,
            venueContext: rel.venueContext || undefined,
            createdAt: rel.createdAt,
            updatedAt: rel.updatedAt || undefined,
          };
        });

        logger.debug(
          `[memgraph] Found ${matches.length} outgoing matches for user ${userId}${status ? ` with status ${status}` : ''}`
        );
        return matches;
      })) || []
    );
  }

  /**
   * Get incoming matches where user is the target
   */
  async getIncomingMatches(
    userId: UUID,
    status?: 'match_found' | 'proposal_pending' | 'accepted' | 'declined' | 'connected'
  ): Promise<MatchedWithRelationship[]> {
    if (!this.isConnected) {
      logger.warn(`[memgraph] Service not connected, returning empty array`);
      return [];
    }

    return (
      (await this.withSession(async (session) => {
        const statusFilter = status ? 'AND r.status = $status' : '';
        const query = `
          MATCH (other:Person)-[r:MATCHED_WITH]->(p:Person {entityid: $userId})
          WHERE 1=1 ${statusFilter}
          RETURN r, other.entityid as otherUserId
          ORDER BY r.createdAt DESC
        `;

        const result = await session.run(query, { userId, status });

        const matches: MatchedWithRelationship[] = result.records.map((record) => {
          const rel = record.get('r').properties;
          const otherUserId = record.get('otherUserId');

          return {
            type: 'MATCHED_WITH',
            from: otherUserId,
            to: userId,
            reasoning: rel.reasoning,
            status: rel.status,
            agentFacilitated: rel.agentFacilitated || undefined,
            venueContext: rel.venueContext || undefined,
            createdAt: rel.createdAt,
            updatedAt: rel.updatedAt || undefined,
          };
        });

        logger.debug(
          `[memgraph] Found ${matches.length} incoming matches for user ${userId}${status ? ` with status ${status}` : ''}`
        );
        return matches;
      })) || []
    );
  }

  /**
   * Get all matches for a user (both directions)
   */
  async getAllMatches(
    userId: UUID,
    status?: 'match_found' | 'proposal_pending' | 'accepted' | 'declined' | 'connected'
  ): Promise<MatchedWithRelationship[]> {
    if (!this.isConnected) {
      logger.warn(`[memgraph] Service not connected, returning empty array`);
      return [];
    }

    return (
      (await this.withSession(async (session) => {
        const statusFilter = status ? 'AND r.status = $status' : '';
        const query = `
          MATCH (p:Person {entityid: $userId})-[r:MATCHED_WITH]-(other:Person)
          WHERE 1=1 ${statusFilter}
          RETURN r, other.entityid as otherUserId,
                 startNode(r).entityid as fromUserId,
                 endNode(r).entityid as toUserId
          ORDER BY r.createdAt DESC
        `;

        const result = await session.run(query, { userId, status });

        const matches: MatchedWithRelationship[] = result.records.map((record) => {
          const rel = record.get('r').properties;
          const fromUserId = record.get('fromUserId');
          const toUserId = record.get('toUserId');

          // Handle migration from single clues to arrays
          const user1Clues =
            rel.user1Clues ||
            (rel.user1Clue
              ? [
                  {
                    text: rel.user1Clue,
                    timestamp: rel.updatedAt || rel.createdAt || Date.now(),
                  },
                ]
              : undefined);

          const user2Clues =
            rel.user2Clues ||
            (rel.user2Clue
              ? [
                  {
                    text: rel.user2Clue,
                    timestamp: rel.updatedAt || rel.createdAt || Date.now(),
                  },
                ]
              : undefined);

          return {
            type: 'MATCHED_WITH',
            from: fromUserId,
            to: toUserId,
            reasoning: rel.reasoning,
            compatibilityScore: rel.compatibilityScore,
            status: rel.status,
            venue: rel.venue,
            proposedTime: rel.proposedTime,
            user1Clues,
            user2Clues,
            user1Clue: rel.user1Clue, // Keep for backward compatibility
            user2Clue: rel.user2Clue, // Keep for backward compatibility
            feedback: rel.feedback,
            agentFacilitated: rel.agentFacilitated || undefined,
            venueContext: rel.venueContext || undefined,
            createdAt: rel.createdAt,
            updatedAt: rel.updatedAt || undefined,
            proposalSentAt: rel.proposalSentAt || undefined,
            reminders: rel.reminders || undefined,
            connectionId: rel.connectionId || undefined, // Connection ID for on-chain PIN verification
          };
        });

        logger.debug(
          `[memgraph] Found ${matches.length} total matches for user ${userId}${status ? ` with status ${status}` : ''}`
        );
        return matches;
      })) || []
    );
  }

  /**
   * Get specific match relationship between two users
   */
  async getMatchRelationship(
    fromUserId: UUID,
    toUserId: UUID
  ): Promise<MatchedWithRelationship | null> {
    if (!this.isConnected) {
      logger.warn(`[memgraph] Service not connected, returning null`);
      return null;
    }

    return await this.withSession(async (session) => {
      const query = `
        MATCH (p1:Person {entityid: $fromUserId})-[r:MATCHED_WITH]->(p2:Person {entityid: $toUserId})
        RETURN r
      `;

      const result = await session.run(query, { fromUserId, toUserId });

      if (result.records.length === 0) {
        return null;
      }

      const rel = result.records[0].get('r').properties;

      // Handle migration from single clues to arrays
      const user1Clues =
        rel.user1Clues ||
        (rel.user1Clue
          ? [
              {
                text: rel.user1Clue,
                timestamp: rel.updatedAt || rel.createdAt || Date.now(),
              },
            ]
          : undefined);

      const user2Clues =
        rel.user2Clues ||
        (rel.user2Clue
          ? [
              {
                text: rel.user2Clue,
                timestamp: rel.updatedAt || rel.createdAt || Date.now(),
              },
            ]
          : undefined);

      return {
        type: 'MATCHED_WITH',
        from: fromUserId,
        to: toUserId,
        reasoning: rel.reasoning,
        compatibilityScore: rel.compatibilityScore,
        status: rel.status,
        venue: rel.venue,
        proposedTime: rel.proposedTime,
        user1Clues,
        user2Clues,
        user1Clue: rel.user1Clue, // Keep for backward compatibility
        user2Clue: rel.user2Clue, // Keep for backward compatibility
        feedback: rel.feedback,
        agentFacilitated: rel.agentFacilitated || undefined,
        venueContext: rel.venueContext || undefined,
        createdAt: rel.createdAt,
        updatedAt: rel.updatedAt || undefined,
        proposalSentAt: rel.proposalSentAt || undefined,
        reminders: rel.reminders || undefined,
      };
    });
  }

  /**
   * Update match status between two users
   */
  async updateMatchStatus(
    fromUserId: UUID,
    toUserId: UUID,
    newStatus:
      | 'match_found'
      | 'proposal_sent'
      | 'accepted'
      | 'scheduled'
      | 'completed'
      | 'declined'
      | 'cancelled'
      | 'expired_no_proposal'
      | 'expired_no_response'
  ): Promise<boolean> {
    if (!this.isConnected) {
      logger.error(`[memgraph] Cannot update match status - service not connected`);
      return false;
    }

    return (
      (await this.withSession(async (session) => {
        const query = `
          MATCH (p1:Person {entityid: $fromUserId})-[r:MATCHED_WITH]->(p2:Person {entityid: $toUserId})
          SET r.status = $newStatus,
              r.updatedAt = $updatedAt
          RETURN r
        `;

        const params = {
          fromUserId,
          toUserId,
          newStatus,
          updatedAt: Date.now(),
        };

        const result = await session.run(query, params);

        if (result.records.length > 0) {
          logger.info(
            `[memgraph] Updated match status: ${fromUserId} -> ${toUserId} to ${newStatus}`
          );

          // When match ends, set both users back to 'active' so they can be matched again
          const endedStatuses = [
            'completed',
            'declined',
            'cancelled',
            'expired_no_proposal',
            'expired_no_response',
          ];
          if (endedStatuses.includes(newStatus)) {
            await this.updatePersonStatus(fromUserId, 'active');
            await this.updatePersonStatus(toUserId, 'active');
            logger.debug(
              `[memgraph] Reset both users ${fromUserId} and ${toUserId} to 'active' status as match ended with status ${newStatus}`
            );
          }

          return true;
        }

        logger.warn(`[memgraph] Match relationship not found: ${fromUserId} -> ${toUserId}`);
        return false;
      })) || false
    );
  }

  /**
   * Check if match exists between two users (either direction)
   */
  async hasExistingMatch(user1Id: UUID, user2Id: UUID): Promise<boolean> {
    if (!this.isConnected) {
      logger.warn(`[memgraph] Service not connected, returning false`);
      return false;
    }

    return (
      (await this.withSession(async (session) => {
        const query = `
          MATCH (p1:Person {entityid: $user1Id})-[:MATCHED_WITH]-(p2:Person {entityid: $user2Id})
          RETURN count(*) as matchCount
        `;

        const result = await session.run(query, { user1Id, user2Id });

        const matchCount = result.records[0]?.get('matchCount')?.toNumber() || 0;

        logger.debug(
          `[memgraph] Match check between ${user1Id} and ${user2Id}: ${matchCount > 0 ? 'EXISTS' : 'NOT FOUND'}`
        );

        return matchCount > 0;
      })) || false
    );
  }

  /**
   * Get match with full Person node details for both users
   */
  async getMatchWithDetails(
    fromUserId: UUID,
    toUserId: UUID
  ): Promise<{
    match: MatchedWithRelationship;
    fromPerson: PersonNode;
    toPerson: PersonNode;
  } | null> {
    if (!this.isConnected) {
      logger.warn(`[memgraph] Service not connected, returning null`);
      return null;
    }

    return await this.withSession(async (session) => {
      const query = `
        MATCH (p1:Person {entityid: $fromUserId})-[r:MATCHED_WITH]->(p2:Person {entityid: $toUserId})
        RETURN r, p1, p2
      `;

      const result = await session.run(query, { fromUserId, toUserId });

      if (result.records.length === 0) {
        return null;
      }

      const record = result.records[0];
      const rel = record.get('r').properties;
      const p1 = record.get('p1').properties;
      const p2 = record.get('p2').properties;

      return {
        match: {
          type: 'MATCHED_WITH',
          from: fromUserId,
          to: toUserId,
          reasoning: rel.reasoning,
          status: rel.status,
          agentFacilitated: rel.agentFacilitated || undefined,
          venueContext: rel.venueContext || undefined,
          createdAt: rel.createdAt,
          updatedAt: rel.updatedAt || undefined,
        },
        fromPerson: {
          type: 'Person',
          entityid: p1.entityid,
          name: p1.name || undefined,
          userStatus: p1.userStatus || undefined,
          metadata: JSON.parse(p1.metadata || '{}'),
          createdAt: p1.createdAt,
          updatedAt: p1.updatedAt || undefined,
        },
        toPerson: {
          type: 'Person',
          entityid: p2.entityid,
          name: p2.name || undefined,
          userStatus: p2.userStatus || undefined,
          metadata: JSON.parse(p2.metadata || '{}'),
          createdAt: p2.createdAt,
          updatedAt: p2.updatedAt || undefined,
        },
      };
    });
  }

  /**
   * Get all active matches across all users with specific statuses
   * Used by match expiry task to check all matches requiring action
   */
  async getAllActiveMatches(statuses: string[] = ['match_found', 'proposal_sent']): Promise<
    Array<{
      from: UUID;
      to: UUID;
      status: string;
      reasoning: string;
      createdAt: number;
      updatedAt?: number;
      proposalSentAt?: number;
      reminders?: string[];
      venue?: string;
      proposedTime?: string;
      user1Clues?: Array<{
        text: string;
        timestamp: number;
      }>;
      user2Clues?: Array<{
        text: string;
        timestamp: number;
      }>;
      user1Clue?: string; // legacy - will be migrated
      user2Clue?: string; // legacy - will be migrated
      feedback?: Array<{
        userId: UUID;
        text: string;
        timestamp: number;
      }>;
    }>
  > {
    if (!this.isConnected) {
      logger.warn(`[memgraph] Service not connected, returning empty array`);
      return [];
    }

    return (
      (await this.withSession(async (session) => {
        const query = `
          MATCH (p1:Person)-[r:MATCHED_WITH]->(p2:Person)
          WHERE r.status IN $statuses
          RETURN r, p1.entityid as fromUserId, p2.entityid as toUserId
          ORDER BY r.createdAt DESC
        `;

        const result = await session.run(query, { statuses });

        const matches = result.records.map((record) => {
          const rel = record.get('r').properties;
          const fromUserId = record.get('fromUserId');
          const toUserId = record.get('toUserId');

          // Handle migration from single clues to arrays
          const user1Clues =
            rel.user1Clues ||
            (rel.user1Clue
              ? [
                  {
                    text: rel.user1Clue,
                    timestamp: rel.updatedAt || rel.createdAt || Date.now(),
                  },
                ]
              : undefined);

          const user2Clues =
            rel.user2Clues ||
            (rel.user2Clue
              ? [
                  {
                    text: rel.user2Clue,
                    timestamp: rel.updatedAt || rel.createdAt || Date.now(),
                  },
                ]
              : undefined);

          return {
            from: fromUserId,
            to: toUserId,
            status: rel.status,
            reasoning: rel.reasoning,
            createdAt: rel.createdAt,
            updatedAt: rel.updatedAt || undefined,
            proposalSentAt: rel.proposalSentAt || undefined,
            reminders: rel.reminders || [],
            venue: rel.venue || undefined,
            proposedTime: rel.proposedTime || undefined,
            user1Clues,
            user2Clues,
            user1Clue: rel.user1Clue || undefined, // Keep for backward compatibility
            user2Clue: rel.user2Clue || undefined, // Keep for backward compatibility
            feedback: rel.feedback || undefined,
          };
        });

        logger.debug(
          `[memgraph] Found ${matches.length} active matches with statuses: ${statuses.join(', ')}`
        );
        return matches;
      })) || []
    );
  }

  /**
   * Get all scheduled matches that are upcoming within a time window
   * Used by meeting reminder task to send reminders
   * @param hoursFromNow - Look for meetings within this many hours from now
   * @returns Array of scheduled matches with meeting times
   */
  async getUpcomingScheduledMeetings(hoursFromNow: number = 24): Promise<
    Array<{
      from: UUID;
      to: UUID;
      status: string;
      reasoning: string;
      createdAt: number;
      proposedTime: string; // ISO 8601 format
      venue: string;
      user1Clues?: Array<{
        text: string;
        timestamp: number;
      }>;
      user2Clues?: Array<{
        text: string;
        timestamp: number;
      }>;
      user1Clue?: string; // legacy - will be migrated
      user2Clue?: string; // legacy - will be migrated
      reminders?: string[];
      feedback?: Array<{
        userId: UUID;
        text: string;
        timestamp: number;
      }>;
    }>
  > {
    if (!this.isConnected) {
      logger.warn(`[memgraph] Service not connected, returning empty array`);
      return [];
    }

    return (
      (await this.withSession(async (session) => {
        // Note: Since proposedTime is stored as string (ISO 8601), we'll filter in JS
        const query = `
          MATCH (p1:Person)-[r:MATCHED_WITH]->(p2:Person)
          WHERE r.status = 'scheduled' AND r.proposedTime IS NOT NULL
          RETURN r, p1.entityid as fromUserId, p2.entityid as toUserId
          ORDER BY r.proposedTime ASC
        `;

        const result = await session.run(query);

        const now = Date.now();
        const windowMs = hoursFromNow * 60 * 60 * 1000;
        const windowEnd = now + windowMs;

        const matches = result.records
          .map((record) => {
            const rel = record.get('r').properties;
            const fromUserId = record.get('fromUserId');
            const toUserId = record.get('toUserId');

            // Parse proposedTime to check if it's within window
            const meetingTime = new Date(rel.proposedTime).getTime();

            if (isNaN(meetingTime) || meetingTime < now || meetingTime > windowEnd) {
              return null; // Skip if invalid or outside window
            }

            // Handle migration from single clues to arrays
            const user1Clues =
              rel.user1Clues ||
              (rel.user1Clue
                ? [
                    {
                      text: rel.user1Clue,
                      timestamp: rel.updatedAt || rel.createdAt || Date.now(),
                    },
                  ]
                : undefined);

            const user2Clues =
              rel.user2Clues ||
              (rel.user2Clue
                ? [
                    {
                      text: rel.user2Clue,
                      timestamp: rel.updatedAt || rel.createdAt || Date.now(),
                    },
                  ]
                : undefined);

            return {
              from: fromUserId,
              to: toUserId,
              status: rel.status,
              reasoning: rel.reasoning,
              createdAt: rel.createdAt,
              proposedTime: rel.proposedTime,
              venue: rel.venue,
              user1Clues,
              user2Clues,
              user1Clue: rel.user1Clue || undefined, // Keep for backward compatibility
              user2Clue: rel.user2Clue || undefined, // Keep for backward compatibility
              reminders: rel.reminders || [],
              feedback: rel.feedback || undefined,
            };
          })
          .filter(Boolean); // Remove nulls

        logger.debug(
          `[memgraph] Found ${matches.length} upcoming scheduled meetings within ${hoursFromNow} hours`
        );
        return matches;
      })) || []
    );
  }

  /**
   * Get all scheduled matches where meeting time has passed
   * Used for feedback collection
   * @param hoursSince - Look for meetings that happened within this many hours ago
   * @returns Array of past scheduled matches
   */
  async getPastScheduledMeetings(hoursSince: number = 24): Promise<
    Array<{
      from: UUID;
      to: UUID;
      status: string;
      reasoning: string;
      createdAt: number;
      proposedTime: string; // ISO 8601 format
      venue: string;
      user1Clue?: string;
      user2Clue?: string;
      reminders?: string[];
      feedback?: Array<{
        userId: UUID;
        text: string;
        timestamp: number;
      }>;
    }>
  > {
    if (!this.isConnected) {
      logger.warn(`[memgraph] Service not connected, returning empty array`);
      return [];
    }

    return (
      (await this.withSession(async (session) => {
        const query = `
          MATCH (p1:Person)-[r:MATCHED_WITH]->(p2:Person)
          WHERE r.status = 'scheduled' AND r.proposedTime IS NOT NULL
          RETURN r, p1.entityid as fromUserId, p2.entityid as toUserId
          ORDER BY r.proposedTime DESC
        `;

        const result = await session.run(query);

        const now = Date.now();
        const windowMs = hoursSince * 60 * 60 * 1000;
        const windowStart = now - windowMs;

        const matches = result.records
          .map((record) => {
            const rel = record.get('r').properties;
            const fromUserId = record.get('fromUserId');
            const toUserId = record.get('toUserId');

            // Parse proposedTime to check if it's within past window
            const meetingTime = new Date(rel.proposedTime).getTime();

            if (isNaN(meetingTime) || meetingTime >= now || meetingTime < windowStart) {
              return null; // Skip if invalid or outside window
            }

            return {
              from: fromUserId,
              to: toUserId,
              status: rel.status,
              reasoning: rel.reasoning,
              createdAt: rel.createdAt,
              proposedTime: rel.proposedTime,
              venue: rel.venue,
              user1Clue: rel.user1Clue || undefined,
              user2Clue: rel.user2Clue || undefined,
              reminders: rel.reminders || [],
              feedback: rel.feedback || undefined,
            };
          })
          .filter(Boolean); // Remove nulls

        logger.debug(
          `[memgraph] Found ${matches.length} past scheduled meetings within ${hoursSince} hours ago`
        );
        return matches;
      })) || []
    );
  }

  /**
   * Get user's PersonaProfile node value
   * Returns the value from the PersonaProfile dimension node connected to the user
   */
  async getUserPersonaProfile(userId: UUID): Promise<string | null> {
    if (!this.isConnected) {
      logger.warn(`[memgraph] Service not connected, returning null`);
      return null;
    }

    return await this.withSession(async (session) => {
      const query = `
        MATCH (p:Person {entityid: $userId})-[:HAS_DIMENSION]->(pd:PersonaProfile)
        RETURN pd.value as personaProfile
        ORDER BY pd.createdAt DESC
        LIMIT 1
      `;

      const result = await session.run(query, { userId });

      if (result.records.length === 0) {
        logger.debug(`[memgraph] No PersonaProfile found for user ${userId}`);
        return null;
      }

      const personaProfile = result.records[0].get('personaProfile');
      logger.debug(`[memgraph] Retrieved PersonaProfile for user ${userId}`);
      return personaProfile;
    });
  }

  /**
   * Update match properties (generic method for any property updates)
   * Supports updating any MATCHED_WITH relationship property
   */
  async updateMatchProperties(
    fromUserId: UUID,
    toUserId: UUID,
    properties: {
      status?: string;
      venue?: string;
      proposedTime?: string;
      user1Clue?: string; // deprecated - for backward compatibility
      user2Clue?: string; // deprecated - for backward compatibility
      user1Clues?: Array<{
        text: string;
        timestamp: number;
      }>;
      user2Clues?: Array<{
        text: string;
        timestamp: number;
      }>;
      feedback?: Array<{
        userId: UUID;
        text: string;
        timestamp: number;
      }>;
      reminders?: string[];
      proposalSentAt?: number;
      [key: string]: any;
    }
  ): Promise<boolean> {
    if (!this.isConnected) {
      logger.error(`[memgraph] Cannot update match properties - service not connected`);
      return false;
    }

    const result = await this.withSession(async (session) => {
      // Build SET clause dynamically from properties
      const setStatements: string[] = ['r.updatedAt = $updatedAt'];
      const params: any = {
        fromUserId,
        toUserId,
        updatedAt: Date.now(),
      };

      for (const [key, value] of Object.entries(properties)) {
        if (value !== undefined) {
          setStatements.push(`r.${key} = $${key}`);
          params[key] = value;
        }
      }

      const query = `
        MATCH (p1:Person {entityid: $fromUserId})-[r:MATCHED_WITH]->(p2:Person {entityid: $toUserId})
        SET ${setStatements.join(', ')}
        RETURN r
      `;

      const queryResult = await session.run(query, params);

      if (queryResult.records.length > 0) {
        logger.info(
          `[memgraph] Updated match properties: ${fromUserId} -> ${toUserId} (${Object.keys(properties).join(', ')})`
        );
        return true;
      }

      logger.warn(`[memgraph] Match relationship not found: ${fromUserId} -> ${toUserId}`);
      return false;
    });

    if (!result) {
      return false;
    }

    // NOTE: User status transitions are managed by the coordinate handler based on feedback
    // We do NOT automatically set user status here to avoid overwriting explicit status transitions
    // The coordinate handler:
    // - Sets users to 'matched' when match is first created
    // - Transitions to 'active' when feedback is provided
    // - Transitions to 'active' when match ends (completed, declined, cancelled, expired)
    if (properties.status) {
      const newStatus = properties.status;

      // When match ends, set both users back to 'active' so they can be matched again
      const endedStatuses = [
        'completed',
        'declined',
        'cancelled',
        'expired_no_proposal',
        'expired_no_response',
      ];
      if (endedStatuses.includes(newStatus)) {
        try {
          await this.updatePersonStatus(fromUserId, 'active');
          await this.updatePersonStatus(toUserId, 'active');
          logger.info(
            `[memgraph] Reset both users to 'active' status after match ended: ${fromUserId}, ${toUserId}`
          );
        } catch (error) {
          logger.error(`[memgraph] Failed to reset user statuses to 'active': ${error}`);
          // Don't fail the whole operation if status update fails
        }
      }
    }

    return result;
  }

  /**
   * Health check method
   */
  async healthCheck(): Promise<boolean> {
    if (!this.isConnected || !this.driver) {
      return false;
    }

    try {
      const session = this.driver.session();
      await session.run('RETURN 1');
      await session.close();
      return true;
    } catch (error) {
      logger.error(`[memgraph] Health check failed: ${error}`);
      return false;
    }
  }
}

export default MemgraphService;
