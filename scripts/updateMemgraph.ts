#!/usr/bin/env bun

/**
 * Memgraph Database Management CLI Tool
 * 
 * Provides command-line operations for managing Memgraph database:
 * - Person node management (delete, list, view details)
 * - Database cleanup (orphaned nodes, full reset)
 * - Production-ready with proper error handling and logging
 * 
 * Usage:
 *   bun scripts/updateMemgraph.ts deletePerson <id>
 *   bun scripts/updateMemgraph.ts listPersons [--dry-run]
 *   bun scripts/updateMemgraph.ts getPersonDetails <id>
 *   bun scripts/updateMemgraph.ts deleteOrphans [--dry-run]
 *   bun scripts/updateMemgraph.ts reset --confirm [--dry-run]
 * 
 * Environment:
 *   MEMGRAPH_URL - Connection string (default: bolt://localhost:7687)
 */

import neo4j, { Driver, Session, Record } from 'neo4j-driver';
import type { UUID } from '@elizaos/core';
import type {
  PersonNode,
  ContactPointNode,
  PeacokDimensionNode,
  PlaceNode,
} from '../packages/plugin-discover-connection/src/utils/graphSchema.js';

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

interface CLIOptions {
  dryRun: boolean;
  confirm: boolean;
  verbose: boolean;
  restartMemgraph?: boolean;
}

interface PersonDetails {
  person: PersonNode;
  contactPoints: ContactPointNode[];
  dimensions: PeacokDimensionNode[];
  relationships: {
    hasContact: number;
    hasDimension: number;
    matchedWith: number;
  };
}

interface OrphanSummary {
  contactPoints: number;
  peacokDimensions: number;
}

// ============================================================================
// CONSOLE COLORS & FORMATTING
// ============================================================================

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
} as const;

function colorize(color: keyof typeof colors, text: string): string {
  return `${colors[color]}${text}${colors.reset}`;
}

function log(message: string): void {
  console.log(message);
}

function logSuccess(message: string): void {
  console.log(colorize('green', `✓ ${message}`));
}

function logError(message: string): void {
  console.error(colorize('red', `✗ ${message}`));
}

function logWarning(message: string): void {
  console.warn(colorize('yellow', `⚠ ${message}`));
}

function logInfo(message: string): void {
  console.log(colorize('blue', `ℹ ${message}`));
}

function logDebug(message: string, verbose: boolean = false): void {
  if (verbose) {
    console.log(colorize('gray', `  ${message}`));
  }
}

// ============================================================================
// HELPER FUNCTIONS FOR TEST DATA
// ============================================================================

/**
 * Generate realistic embedding vector with controlled variations
 * Based on real embedding from all-MiniLM-L6-v2 (768 dimensions)
 * Matches the dimension size used in the actual Memgraph PersonaDimension nodes
 */
function generateRealisticEmbedding(seed: number = 0): number[] {
  // Base embedding template (realistic values from actual embeddings)
  const baseEmbedding = [
    0.012661287, -0.010761488, -0.05165518, -0.05096045, 0.04850825, -0.017798888, 0.006944689, 0.0017611071,
    -0.044006616, 0.015515016, -0.02433645, 0.045304347, 0.08083047, -0.02109052, -0.011847785, -0.06598949
  ];

  const embedding: number[] = [];

  // Generate 768 dimensions with pseudo-random variations
  for (let i = 0; i < 768; i++) {
    // Use base pattern repeated and varied
    const baseValue = baseEmbedding[i % baseEmbedding.length];

    // Add seed-based variation for diversity between users
    const variation = Math.sin(seed * 1000 + i) * 0.08; // +/- 0.08 variation

    const value = baseValue + variation;

    // Clamp to reasonable embedding range
    embedding.push(Math.max(-0.15, Math.min(0.15, value)));
  }

  return embedding;
}

// ============================================================================
// DATABASE CONNECTION
// ============================================================================

class MemgraphManager {
  private driver: Driver | null = null;
  private connectionUrl: string;

  constructor() {
    this.connectionUrl = process.env.MEMGRAPH_URL || 'bolt://localhost:7687';
  }

  async connect(): Promise<void> {
    try {
      logInfo(`Connecting to Memgraph at ${this.connectionUrl}...`);

      this.driver = neo4j.driver(this.connectionUrl);

      // Test connection
      const session = this.driver.session();
      await session.run('RETURN 1 as test');
      await session.close();

      logSuccess('Connected to Memgraph successfully');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logError(`Failed to connect to Memgraph: ${errorMessage}`);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.driver) {
      await this.driver.close();
      this.driver = null;
      logInfo('Disconnected from Memgraph');
    }
  }

  private async withSession<T>(operation: (session: Session) => Promise<T>): Promise<T> {
    if (!this.driver) {
      throw new Error('Not connected to database');
    }

    const session = this.driver.session();
    try {
      return await operation(session);
    } finally {
      await session.close();
    }
  }

  // ============================================================================
  // PERSON MANAGEMENT
  // ============================================================================

  async deletePerson(id: string, options: CLIOptions): Promise<boolean> {
    logInfo(`${options.dryRun ? 'DRY RUN: ' : ''}Deleting Person with ID: ${id}`);

    return await this.withSession(async (session) => {
      // First, check if person exists and get details
      const findQuery = `
        MATCH (p:Person)
        WHERE p.entityid = $id OR p.id = $id
        OPTIONAL MATCH (p)-[r1:HAS_CONTACT]->(cp:ContactPoint)
        OPTIONAL MATCH (p)-[r2:HAS_DIMENSION]->(pd:PeacokDimension)
        OPTIONAL MATCH (p)-[r3:MATCHED_WITH]-(m:Person)
        OPTIONAL MATCH (p2:Person)-[r4:MATCHED_WITH]->(p)
        RETURN p, 
               count(DISTINCT r1) as contactRels,
               count(DISTINCT r2) as dimensionRels,
               count(DISTINCT r3) as matchedWithRels,
               count(DISTINCT r4) as matchedByRels
      `;

      const findResult = await session.run(findQuery, { id });

      if (findResult.records.length === 0) {
        logError(`Person with ID '${id}' not found`);
        return false;
      }

      const record = findResult.records[0];
      const person = record.get('p');
      const contactRels = record.get('contactRels').toNumber();
      const dimensionRels = record.get('dimensionRels').toNumber();
      const matchedWithRels = record.get('matchedWithRels').toNumber();
      const matchedByRels = record.get('matchedByRels').toNumber();

      logInfo(`Found Person: ${person.properties.name || 'Unnamed'} (${person.properties.entityid})`);
      logInfo(`  - Contact relationships: ${contactRels}`);
      logInfo(`  - Dimension relationships: ${dimensionRels}`);
      logInfo(`  - Matched with: ${matchedWithRels}`);
      logInfo(`  - Matched by: ${matchedByRels}`);

      if (options.dryRun) {
        logWarning('DRY RUN: Would delete this person and all relationships');
        return true;
      }

      // Delete all relationships and the person
      const deleteQuery = `
        MATCH (p:Person)
        WHERE p.entityid = $id OR p.id = $id
        DETACH DELETE p
        RETURN count(p) as deletedCount
      `;

      const deleteResult = await session.run(deleteQuery, { id });
      const deletedCount = deleteResult.records[0].get('deletedCount').toNumber();

      if (deletedCount > 0) {
        logSuccess(`Deleted Person and all relationships: ${person.properties.name || 'Unnamed'}`);
        return true;
      } else {
        logError('Failed to delete Person');
        return false;
      }
    });
  }

  async listPersons(options: CLIOptions): Promise<void> {
    logInfo(`${options.dryRun ? 'DRY RUN: ' : ''}Listing all Person nodes...`);

    await this.withSession(async (session) => {
      const query = `
        MATCH (p:Person)
        OPTIONAL MATCH (p)-[:HAS_CONTACT]->(cp:ContactPoint)
        OPTIONAL MATCH (p)-[:HAS_DIMENSION]->(pd:PeacokDimension)
        OPTIONAL MATCH (p)-[:MATCHED_WITH]-(m:Person)
        RETURN p,
               count(DISTINCT cp) as contactPoints,
               count(DISTINCT pd) as dimensions,
               count(DISTINCT m) as matches
        ORDER BY p.createdAt DESC
      `;

      const result = await session.run(query);

      if (result.records.length === 0) {
        logWarning('No Person nodes found in database');
        return;
      }

      log(colorize('bright', '\n=== PERSON NODES ==='));
      log(colorize('gray', 'ID'.padEnd(40) + 'Name'.padEnd(20) + 'Agent'.padEnd(10) + 'Contacts'.padEnd(10) + 'Dimensions'.padEnd(12) + 'Matches'));
      log(colorize('gray', '-'.repeat(100)));

      for (const record of result.records) {
        const person = record.get('p');
        const contactPoints = record.get('contactPoints').toNumber();
        const dimensions = record.get('dimensions').toNumber();
        const matches = record.get('matches').toNumber();

        const entityId = person.properties.entityid || person.properties.id || 'N/A';
        const name = person.properties.name || 'Unnamed';
        const agentId = person.properties.agentId ? person.properties.agentId.substring(0, 8) + '...' : 'N/A';

        const line = [
          entityId.substring(0, 38).padEnd(40),
          name.substring(0, 18).padEnd(20),
          agentId.padEnd(10),
          contactPoints.toString().padEnd(10),
          dimensions.toString().padEnd(12),
          matches.toString()
        ].join('');

        log(line);

        logDebug(`  Created: ${new Date(person.properties.createdAt).toISOString()}`, options.verbose);
        logDebug(`  Updated: ${person.properties.updatedAt ? new Date(person.properties.updatedAt).toISOString() : 'Never'}`, options.verbose);
      }

      log(colorize('bright', `\nTotal: ${result.records.length} Person nodes`));
    });
  }

  async getPersonDetails(id: string, options: CLIOptions): Promise<void> {
    logInfo(`${options.dryRun ? 'DRY RUN: ' : ''}Getting details for Person: ${id}`);

    const details = await this.withSession(async (session): Promise<PersonDetails | null> => {
      // Get person and all relationships
      const query = `
        MATCH (p:Person)
        WHERE p.entityid = $id OR p.id = $id
        OPTIONAL MATCH (p)-[r1:HAS_CONTACT]->(cp:ContactPoint)
        OPTIONAL MATCH (p)-[r2:HAS_DIMENSION]->(pd:PeacokDimension)
        RETURN p,
               collect(DISTINCT {contact: cp, relationship: r1}) as contactData,
               collect(DISTINCT {dimension: pd, relationship: r2}) as dimensionData
      `;

      const result = await session.run(query, { id });

      if (result.records.length === 0) {
        return null;
      }

      const record = result.records[0];
      const personNode = record.get('p');
      const contactData = record.get('contactData');
      const dimensionData = record.get('dimensionData');

      // Parse person
      const person: PersonNode = {
        type: 'Person',
        entityid: personNode.properties.entityid,
        agentId: personNode.properties.agentId,
        name: personNode.properties.name,
        identifier: personNode.properties.identifier,
        metadata: JSON.parse(personNode.properties.metadata || '{}'),
        createdAt: personNode.properties.createdAt,
        updatedAt: personNode.properties.updatedAt,
      };

      // Parse contact points
      const contactPoints: ContactPointNode[] = contactData
        .filter((item: any) => item.contact !== null)
        .map((item: any) => ({
          type: 'ContactPoint',
          username: item.contact.properties.username,
          name: item.contact.properties.name,
          channelId: item.contact.properties.channelId,
          platform: item.contact.properties.platform,
          agentName: item.contact.properties.agentName,
          agentUsername: item.contact.properties.agentUsername,
          agentId: item.contact.properties.agentId,
          createdAt: item.contact.properties.createdAt,
          updatedAt: item.contact.properties.updatedAt,
        }));

      // Parse dimensions
      const dimensions: PeacokDimensionNode[] = dimensionData
        .filter((item: any) => item.dimension !== null)
        .map((item: any) => ({
          type: 'PeacokDimension',
          dimensionType: item.dimension.properties.dimensionType,
          name: item.dimension.properties.name,
          value: item.dimension.properties.value,
          confidence: item.dimension.properties.confidence,
          category: item.dimension.properties.category,
          weight: item.dimension.properties.weight,
          isVectorizable: item.dimension.properties.isVectorizable,
          metadata: JSON.parse(item.dimension.properties.metadata || '{}'),
          createdAt: item.dimension.properties.createdAt,
        }));

      // Count relationship types
      const matchCountQuery = `
        MATCH (p:Person)
        WHERE p.entityid = $id OR p.id = $id
        OPTIONAL MATCH (p)-[:MATCHED_WITH]-(m:Person)
        RETURN count(DISTINCT m) as matchCount
      `;

      const matchResult = await session.run(matchCountQuery, { id });
      const matchCount = matchResult.records[0].get('matchCount').toNumber();

      return {
        person,
        contactPoints,
        dimensions,
        relationships: {
          hasContact: contactPoints.length,
          hasDimension: dimensions.length,
          matchedWith: matchCount,
        }
      };
    });

    if (!details) {
      logError(`Person with ID '${id}' not found`);
      return;
    }

    // Display detailed information
    log(colorize('bright', '\n=== PERSON DETAILS ==='));

    log(colorize('cyan', '• Basic Info:'));
    log(`  Entity ID: ${details.person.entityid}`);
    log(`  Agent ID: ${details.person.agentId}`);
    log(`  Name: ${details.person.name || 'N/A'}`);
    log(`  Identifier: ${details.person.identifier || 'N/A'}`);
    log(`  Created: ${new Date(details.person.createdAt).toISOString()}`);
    log(`  Updated: ${details.person.updatedAt ? new Date(details.person.updatedAt).toISOString() : 'Never'}`);

    log(colorize('cyan', '\n• Metadata:'));
    log(`  User Status: ${details.person.metadata.userStatus || 'N/A'}`);
    log(`  Email: ${details.person.metadata.email || 'N/A'}`);

    log(colorize('cyan', '\n• Relationships:'));
    log(`  Contact Points: ${details.relationships.hasContact}`);
    log(`  Dimensions: ${details.relationships.hasDimension}`);
    log(`  Matches: ${details.relationships.matchedWith}`);

    if (details.contactPoints.length > 0) {
      log(colorize('cyan', '\n• Contact Points:'));
      for (const cp of details.contactPoints) {
        log(`  - ${cp.platform}: ${cp.channelId}`);
        log(`    Name: ${cp.name || 'N/A'}, Username: ${cp.username || 'N/A'}`);
        log(`    Agent: ${cp.agentName || 'N/A'} (${cp.agentUsername || 'N/A'})`);
      }
    }

    if (details.dimensions.length > 0) {
      log(colorize('cyan', '\n• Peacok Dimensions:'));
      for (const dim of details.dimensions) {
        log(`  - ${dim.category}/${dim.dimensionType}: ${dim.value}`);
        log(`    Confidence: ${(dim.confidence * 100).toFixed(1)}%, Weight: ${dim.weight}`);
        log(`    Vectorizable: ${dim.isVectorizable ? 'Yes' : 'No'}`);
      }
    }
  }

  async deleteContactPoint(agentId: string, options: CLIOptions): Promise<boolean> {
    logInfo(`${options.dryRun ? 'DRY RUN: ' : ''}Deleting ContactPoint nodes with agentId: ${agentId}`);

    return await this.withSession(async (session) => {
      // First, check if contact points exist and get details
      const findQuery = `
        MATCH (cp:ContactPoint {agentId: $agentId})
        OPTIONAL MATCH (p:Person)-[r:HAS_CONTACT]->(cp)
        RETURN cp, count(r) as incomingRels
      `;

      const findResult = await session.run(findQuery, { agentId });

      if (findResult.records.length === 0) {
        logError(`No ContactPoint nodes found with agentId: ${agentId}`);
        return false;
      }

      let totalContactPoints = 0;
      let totalRelationships = 0;

      logInfo(`Found ${findResult.records.length} ContactPoint nodes:`);
      for (const record of findResult.records) {
        const cp = record.get('cp');
        const incomingRels = record.get('incomingRels').toNumber();

        totalContactPoints++;
        totalRelationships += incomingRels;

        logInfo(`  - Platform: ${cp.properties.platform}, Channel: ${cp.properties.channelId}`);
        logInfo(`    Name: ${cp.properties.name || 'N/A'}, Username: ${cp.properties.username || 'N/A'}`);
        logInfo(`    Incoming relationships: ${incomingRels}`);
      }

      logInfo(`Total: ${totalContactPoints} ContactPoint nodes, ${totalRelationships} relationships`);

      if (options.dryRun) {
        logWarning('DRY RUN: Would delete these ContactPoint nodes and their relationships');
        return true;
      }

      // Delete all ContactPoint nodes with the given agentId
      const deleteQuery = `
        MATCH (cp:ContactPoint {agentId: $agentId})
        DETACH DELETE cp
        RETURN count(cp) as deletedCount
      `;

      const deleteResult = await session.run(deleteQuery, { agentId });
      const deletedCount = deleteResult.records[0].get('deletedCount').toNumber();

      if (deletedCount > 0) {
        logSuccess(`Deleted ${deletedCount} ContactPoint nodes with agentId: ${agentId}`);
        return true;
      } else {
        logError('Failed to delete ContactPoint nodes');
        return false;
      }
    });
  }

  async deleteHumanConnection(connectionId: string, options: CLIOptions): Promise<boolean> {
    logInfo(`${options.dryRun ? 'DRY RUN: ' : ''}Deleting HumanConnection with connectionId: ${connectionId}`);

    return await this.withSession(async (session) => {
      // First, check if connection exists and get details
      const findQuery = `
        MATCH (hc:HumanConnection {connectionId: $connectionId})
        OPTIONAL MATCH (hc)-[r]-()
        RETURN hc, count(DISTINCT r) as relationshipCount
      `;

      const findResult = await session.run(findQuery, { connectionId });

      if (findResult.records.length === 0) {
        logError(`HumanConnection with connectionId '${connectionId}' not found`);
        return false;
      }

      const record = findResult.records[0];
      const connection = record.get('hc');
      const relationshipCount = record.get('relationshipCount').toNumber();

      logInfo(`Found HumanConnection:`);
      logInfo(`  Connection ID: ${connection.properties.connectionId}`);
      logInfo(`  Status: ${connection.properties.status || 'N/A'}`);
      logInfo(`  Created At: ${connection.properties.createdAt ? new Date(connection.properties.createdAt).toISOString() : 'N/A'}`);
      logInfo(`  Total relationships: ${relationshipCount}`);

      if (options.dryRun) {
        logWarning('DRY RUN: Would delete this HumanConnection and all its relationships');
        return true;
      }

      // Delete the HumanConnection and all relationships
      const deleteQuery = `
        MATCH (hc:HumanConnection {connectionId: $connectionId})
        DETACH DELETE hc
        RETURN count(hc) as deletedCount
      `;

      const deleteResult = await session.run(deleteQuery, { connectionId });
      const deletedCount = deleteResult.records[0].get('deletedCount').toNumber();

      if (deletedCount > 0) {
        logSuccess(`Deleted HumanConnection: ${connectionId}`);
        return true;
      } else {
        logError('Failed to delete HumanConnection');
        return false;
      }
    });
  }

  async completeMatch(agentId: string, person1Id: string, person2Id: string, options: CLIOptions): Promise<boolean> {
    logInfo(`${options.dryRun ? 'DRY RUN: ' : ''}Marking MATCHED_WITH relationship as completed`);
    logInfo(`  Agent: ${agentId}`);
    logInfo(`  Person 1: ${person1Id}`);
    logInfo(`  Person 2: ${person2Id}`);

    return await this.withSession(async (session) => {
      // Find the MATCHED_WITH relationship
      const findQuery = `
        MATCH (p1:Person)-[r:MATCHED_WITH]-(p2:Person)
        WHERE (p1.entityid = $person1Id OR p1.id = $person1Id)
          AND (p2.entityid = $person2Id OR p2.id = $person2Id)
          AND r.agentFacilitated = $agentId
        RETURN p1, p2, r
      `;

      const findResult = await session.run(findQuery, { agentId, person1Id, person2Id });

      if (findResult.records.length === 0) {
        logError(`No MATCHED_WITH relationship found between persons ${person1Id} and ${person2Id} for agent ${agentId}`);
        return false;
      }

      const record = findResult.records[0];
      const p1 = record.get('p1');
      const p2 = record.get('p2');
      const rel = record.get('r');

      logInfo(`\nFound match:`);
      logInfo(`  ${p1.properties.name || 'Unnamed'} <-> ${p2.properties.name || 'Unnamed'}`);
      logInfo(`  Current status: ${rel.properties.status}`);
      logInfo(`  Proposed time: ${rel.properties.proposedTime || 'N/A'}`);
      logInfo(`  Venue: ${rel.properties.venue || 'Not set'}`);

      if (options.dryRun) {
        logWarning('DRY RUN: Would mark this relationship as completed');
        return true;
      }

      // Update the relationship to completed status
      const updateQuery = `
        MATCH (p1:Person)-[r:MATCHED_WITH]-(p2:Person)
        WHERE (p1.entityid = $person1Id OR p1.id = $person1Id)
          AND (p2.entityid = $person2Id OR p2.id = $person2Id)
          AND r.agentFacilitated = $agentId
        SET r.status = 'completed',
            r.completedAt = $timestamp,
            r.updatedAt = $timestamp
        RETURN r
      `;

      const updateResult = await session.run(updateQuery, {
        agentId,
        person1Id,
        person2Id,
        timestamp: Date.now()
      });

      if (updateResult.records.length > 0) {
        logSuccess(`✓ Marked MATCHED_WITH relationship as completed`);
        logInfo(`  Status: ${rel.properties.status} → completed`);
        return true;
      } else {
        logError('Failed to update MATCHED_WITH relationship');
        return false;
      }
    });
  }

  async deleteUser(userId: string, options: CLIOptions): Promise<boolean> {
    logInfo(`${options.dryRun ? 'DRY RUN: ' : ''}Deleting user with userId: ${userId}`);

    return await this.withSession(async (session) => {
      // First, check if user exists and get details
      const findQuery = `
        MATCH (n)
        WHERE n.userId = $userId
        OPTIONAL MATCH (n)-[r]-()
        RETURN n, labels(n) as labels, count(DISTINCT r) as relationshipCount
      `;

      const findResult = await session.run(findQuery, { userId });

      if (findResult.records.length === 0) {
        logError(`User with userId '${userId}' not found`);
        return false;
      }

      const record = findResult.records[0];
      const node = record.get('n');
      const labels = record.get('labels');
      const relationshipCount = record.get('relationshipCount').toNumber();

      logInfo(`Found user node:`);
      logInfo(`  Node type: ${labels.join(', ')}`);
      logInfo(`  User ID: ${node.properties.userId}`);
      logInfo(`  Name: ${node.properties.name || 'N/A'}`);
      logInfo(`  Room ID: ${node.properties.roomId || 'N/A'}`);
      logInfo(`  Updated At: ${node.properties.updatedAt || 'N/A'}`);
      logInfo(`  Total relationships: ${relationshipCount}`);

      if (options.dryRun) {
        logWarning('DRY RUN: Would delete this user node and all its relationships');
        return true;
      }

      // Delete the user node and all relationships
      const deleteQuery = `
        MATCH (n)
        WHERE n.userId = $userId
        DETACH DELETE n
        RETURN count(n) as deletedCount
      `;

      const deleteResult = await session.run(deleteQuery, { userId });
      const deletedCount = deleteResult.records[0].get('deletedCount').toNumber();

      if (deletedCount > 0) {
        logSuccess(`Deleted user: ${node.properties.name || userId} (${deletedCount} node(s))`);
        return true;
      } else {
        logError('Failed to delete user');
        return false;
      }
    });
  }

  /**
   * Delete all nodes created by a specific agent
   * Includes: Person, Account, PersonaDimension, DesiredDimension, and VerificationData nodes
   * Excludes: Agent and Place nodes (shared resources)
   */
  async deleteByAgent(agentId: string, options: CLIOptions): Promise<boolean> {
    logInfo(`${options.dryRun ? 'DRY RUN: ' : ''}Deleting all nodes created by agent: ${agentId}`);

    return await this.withSession(async (session) => {
      // Count nodes by type
      const countQuery = `
        MATCH (n)
        WHERE n.agentId = $agentId
        WITH labels(n)[0] as nodeType, count(n) as count
        RETURN nodeType, count
        ORDER BY nodeType
      `;

      const countResult = await session.run(countQuery, { agentId });

      if (countResult.records.length === 0) {
        logWarning(`No nodes found with agentId: ${agentId}`);
        return false;
      }

      // Display summary
      log(colorize('bright', '\n=== NODES TO DELETE ==='));
      let totalNodes = 0;
      for (const record of countResult.records) {
        const nodeType = record.get('nodeType');
        const count = record.get('count').toNumber();
        totalNodes += count;
        log(`  ${nodeType}: ${count} nodes`);
      }
      log(colorize('bright', `\nTotal: ${totalNodes} nodes`));

      if (options.dryRun) {
        logWarning('\nDRY RUN: Would delete all these nodes and their relationships');
        return true;
      }

      // Delete all nodes with this agentId (DETACH DELETE removes relationships too)
      // Note: We don't delete Agent or Place nodes as they are shared resources
      const deleteQuery = `
        MATCH (n)
        WHERE n.agentId = $agentId
        DETACH DELETE n
        RETURN count(n) as deletedCount
      `;

      const deleteResult = await session.run(deleteQuery, { agentId });
      const deletedCount = deleteResult.records[0].get('deletedCount').toNumber();

      if (deletedCount > 0) {
        logSuccess(`\nDeleted ${deletedCount} nodes and their relationships`);
        return true;
      } else {
        logError('\nFailed to delete nodes');
        return false;
      }
    });
  }

  /**
   * Delete all nodes and relationships created since a specific date
   * @param timestamp Unix timestamp in milliseconds
   * @param options CLI options including dryRun and confirm flags
   */
  async deleteSinceDate(timestamp: number, options: CLIOptions): Promise<boolean> {
    const dateStr = new Date(timestamp).toISOString();
    logInfo(`${options.dryRun ? 'DRY RUN: ' : ''}Finding data created since ${dateStr}...`);

    return await this.withSession(async (session) => {
      // Count nodes by type - ONLY numeric timestamps, exclude HumanConnection
      const nodeCountQuery = `
        MATCH (n)
        WHERE toInteger(n.createdAt) IS NOT NULL
          AND toInteger(n.createdAt) >= $timestamp
          AND NOT 'HumanConnection' IN labels(n)
        WITH labels(n)[0] as nodeType, count(n) as count
        RETURN nodeType, count
        ORDER BY nodeType
      `;

      const nodeCountResult = await session.run(nodeCountQuery, {
        timestamp: neo4j.int(timestamp)
      });

      // Count relationships by type - ONLY numeric timestamps
      const relCountQuery = `
        MATCH ()-[r]->()
        WHERE toInteger(r.createdAt) IS NOT NULL
          AND toInteger(r.createdAt) >= $timestamp
        WITH type(r) as relType, count(r) as count
        RETURN relType, count
        ORDER BY relType
      `;

      const relCountResult = await session.run(relCountQuery, {
        timestamp: neo4j.int(timestamp)
      });

      // Display node summary
      log(colorize('bright', '\n=== NODES CREATED SINCE ' + dateStr + ' ==='));
      let totalNodes = 0;

      if (nodeCountResult.records.length === 0) {
        logInfo('  No nodes found');
      } else {
        log(colorize('gray', 'Node Type'.padEnd(30) + 'Count'));
        log(colorize('gray', '-'.repeat(40)));
        for (const record of nodeCountResult.records) {
          const nodeType = record.get('nodeType') || 'Unlabeled';
          const count = record.get('count').toNumber();
          totalNodes += count;
          log(`  ${nodeType.padEnd(28)} ${count}`);
        }
        log(colorize('bright', `\nTotal nodes: ${totalNodes}`));
      }

      // Display relationship summary
      log(colorize('bright', '\n=== RELATIONSHIPS CREATED SINCE ' + dateStr + ' ==='));
      let totalRels = 0;

      if (relCountResult.records.length === 0) {
        logInfo('  No relationships found');
      } else {
        log(colorize('gray', 'Relationship Type'.padEnd(30) + 'Count'));
        log(colorize('gray', '-'.repeat(40)));
        for (const record of relCountResult.records) {
          const relType = record.get('relType');
          const count = record.get('count').toNumber();
          totalRels += count;
          log(`  ${relType.padEnd(28)} ${count}`);
        }
        log(colorize('bright', `\nTotal relationships: ${totalRels}`));
      }

      // Sample data for verification
      if (totalNodes > 0 && options.verbose) {
        log(colorize('cyan', '\n• Sample Nodes (first 5):'));
        const sampleQuery = `
          MATCH (n)
          WHERE toInteger(n.createdAt) IS NOT NULL
            AND toInteger(n.createdAt) >= $timestamp
            AND NOT 'HumanConnection' IN labels(n)
          RETURN labels(n)[0] as type,
                 n.name as name,
                 n.entityid as entityid,
                 n.createdAt as createdAt
          ORDER BY n.createdAt DESC
          LIMIT 5
        `;
        const sampleResult = await session.run(sampleQuery, {
          timestamp: neo4j.int(timestamp)
        });
        for (const record of sampleResult.records) {
          const type = record.get('type') || 'Unknown';
          const name = record.get('name') || record.get('entityid') || 'N/A';
          const createdAtRaw = record.get('createdAt');
          const createdAt = new Date(createdAtRaw).toISOString();
          log(`  - ${type}: ${name} (created: ${createdAt})`);
        }
      }

      // Overall summary
      log(colorize('bright', '\n=== DELETION SUMMARY ==='));
      log(`  Total nodes to delete: ${totalNodes}`);
      log(`  Total relationships to delete: ${totalRels}`);

      if (totalNodes === 0 && totalRels === 0) {
        logInfo('\nNo data found created since the specified date');
        return false;
      }

      if (options.dryRun) {
        logWarning('\nDRY RUN: Would delete all nodes and relationships listed above');
        logInfo('To execute deletion, run without --dry-run and with --confirm flag');
        return true;
      }

      if (!options.confirm) {
        logError('\nDeletion requires --confirm flag for safety');
        logWarning(`This will permanently delete ${totalNodes} nodes and ${totalRels} relationships!`);
        logInfo('Run with --confirm to proceed');
        return false;
      }

      // Execute deletion
      logWarning(`\nDeleting ${totalNodes} nodes and ${totalRels} relationships...`);

      // Delete nodes (DETACH DELETE also removes their relationships) - ONLY numeric timestamps, exclude HumanConnection
      const deleteQuery = `
        MATCH (n)
        WHERE toInteger(n.createdAt) IS NOT NULL
          AND toInteger(n.createdAt) >= $timestamp
          AND NOT 'HumanConnection' IN labels(n)
        DETACH DELETE n
        RETURN count(n) as deletedCount
      `;

      const deleteResult = await session.run(deleteQuery, {
        timestamp: neo4j.int(timestamp)
      });
      const deletedCount = deleteResult.records[0].get('deletedCount').toNumber();

      if (deletedCount > 0) {
        logSuccess(`\nDeleted ${deletedCount} nodes and all their relationships`);

        // Verify deletion
        const verifyResult = await session.run(nodeCountQuery, {
          timestamp: neo4j.int(timestamp)
        });
        const remaining = verifyResult.records.reduce((sum, r) => sum + r.get('count').toNumber(), 0);

        if (remaining === 0) {
          logSuccess('Verification: All targeted data successfully deleted');
        } else {
          logWarning(`Warning: ${remaining} nodes still remain with createdAt >= ${dateStr}`);
        }

        return true;
      } else {
        logError('\nFailed to delete data');
        return false;
      }
    });
  }

  // ============================================================================
  // PLACE MANAGEMENT
  // ============================================================================

  async createPlace(placeData: Omit<PlaceNode, 'createdAt' | 'updatedAt'>, options: CLIOptions): Promise<boolean> {
    logInfo(`${options.dryRun ? 'DRY RUN: ' : ''}Creating Place: ${placeData.name}`);

    return await this.withSession(async (session) => {
      // Check if place already exists by name
      const findQuery = `
        MATCH (p:Place {name: $name})
        RETURN p
      `;

      const findResult = await session.run(findQuery, { name: placeData.name });

      if (findResult.records.length > 0) {
        logError(`Place with name '${placeData.name}' already exists`);
        return false;
      }

      if (options.dryRun) {
        logWarning(`DRY RUN: Would create Place: ${placeData.name}`);
        logInfo(`  Description: ${placeData.description || 'N/A'}`);
        logInfo(`  Address: ${placeData.address || 'N/A'}`);
        logInfo(`  Class count: ${placeData.classTimetable.length}`);
        return true;
      }

      // Create the place
      const createQuery = `
        CREATE (p:Place {
          venueType: $venueType,
          name: $name,
          description: $description,
          url: $url,
          address: $address,
          operatingHours: $operatingHours,
          classTimetable: $classTimetable,
          metadata: $metadata,
          createdAt: $createdAt,
          updatedAt: $updatedAt
        })
        RETURN p
      `;

      const now = Date.now();
      const createResult = await session.run(createQuery, {
        venueType: placeData.venueType,
        name: placeData.name,
        description: placeData.description || null,
        url: placeData.url || null,
        address: placeData.address || null,
        operatingHours: JSON.stringify(placeData.operatingHours),
        classTimetable: JSON.stringify(placeData.classTimetable),
        metadata: JSON.stringify(placeData.metadata),
        createdAt: now,
        updatedAt: now,
      });

      if (createResult.records.length > 0) {
        logSuccess(`Created Place: ${placeData.name}`);
        return true;
      } else {
        logError('Failed to create Place');
        return false;
      }
    });
  }

  async listPlaces(options: CLIOptions): Promise<void> {
    logInfo(`${options.dryRun ? 'DRY RUN: ' : ''}Listing all Place nodes...`);

    await this.withSession(async (session) => {
      const query = `
        MATCH (p:Place)
        RETURN p
        ORDER BY p.createdAt DESC
      `;

      const result = await session.run(query);

      if (result.records.length === 0) {
        logWarning('No Place nodes found in database');
        return;
      }

      log(colorize('bright', '\n=== PLACE NODES ==='));
      log(colorize('gray', 'Name'.padEnd(25) + 'Address'.padEnd(30) + 'Classes'.padEnd(10) + 'Type'.padEnd(15) + 'Created'));
      log(colorize('gray', '-'.repeat(90)));

      for (const record of result.records) {
        const place = record.get('p');
        const name = place.properties.name || 'Unnamed';
        const address = place.properties.address || 'N/A';
        const classTimetable = JSON.parse(place.properties.classTimetable || '[]');
        const venueType = place.properties.venueType || 'N/A';
        const created = new Date(place.properties.createdAt).toLocaleDateString();

        const line = [
          name.substring(0, 23).padEnd(25),
          address.substring(0, 28).padEnd(30),
          classTimetable.length.toString().padEnd(10),
          venueType.padEnd(15),
          created
        ].join('');

        log(line);

        logDebug(`  Description: ${place.properties.description || 'N/A'}`, options.verbose);
        logDebug(`  URL: ${place.properties.url || 'N/A'}`, options.verbose);
        const metadata = JSON.parse(place.properties.metadata || '{}');
        logDebug(`  Membership required: ${metadata.membershipRequired ? 'Yes' : 'No'}`, options.verbose);
      }

      log(colorize('bright', `\nTotal: ${result.records.length} Place nodes`));
    });
  }

  async getPlaceDetails(name: string, options: CLIOptions): Promise<void> {
    logInfo(`${options.dryRun ? 'DRY RUN: ' : ''}Getting details for Place: ${name}`);

    const placeDetails = await this.withSession(async (session): Promise<PlaceNode | null> => {
      const query = `
        MATCH (p:Place)
        WHERE p.name = $name
        RETURN p
      `;

      const result = await session.run(query, { name });

      if (result.records.length === 0) {
        return null;
      }

      const record = result.records[0];
      const placeNode = record.get('p');

      // Parse place data
      const place: PlaceNode = {
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

      return place;
    });

    if (!placeDetails) {
      logError(`Place with name '${name}' not found`);
      return;
    }

    // Display detailed information
    log(colorize('bright', '\n=== PLACE DETAILS ==='));

    log(colorize('cyan', '• Basic Info:'));
    log(`  Name: ${placeDetails.name}`);
    log(`  Description: ${placeDetails.description || 'N/A'}`);
    log(`  Address: ${placeDetails.address || 'N/A'}`);
    log(`  URL: ${placeDetails.url || 'N/A'}`);
    log(`  Created: ${new Date(placeDetails.createdAt).toISOString()}`);
    log(`  Updated: ${placeDetails.updatedAt ? new Date(placeDetails.updatedAt).toISOString() : 'Never'}`);

    log(colorize('cyan', '\n• Operating Hours:'));
    const operatingHours = placeDetails.operatingHours;
    const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    for (const day of days) {
      const hours = operatingHours[day];
      if (hours) {
        if (hours.closed) {
          log(`  ${day.charAt(0).toUpperCase() + day.slice(1)}: Closed`);
        } else {
          log(`  ${day.charAt(0).toUpperCase() + day.slice(1)}: ${hours.open || 'N/A'} - ${hours.close || 'N/A'}`);
        }
      }
    }

    log(colorize('cyan', '\n• Venue Info:'));
    log(`  Venue Type: ${placeDetails.venueType}`);
    log(`  Membership Required: ${placeDetails.metadata.membershipRequired ? 'Yes' : 'No'}`);
    if (placeDetails.metadata.contactInfo) {
      log(`  Phone: ${placeDetails.metadata.contactInfo.phone || 'N/A'}`);
      log(`  Email: ${placeDetails.metadata.contactInfo.email || 'N/A'}`);
    }

    if (placeDetails.classTimetable.length > 0) {
      log(colorize('cyan', '\n• Class Timetable:'));
      for (const classInfo of placeDetails.classTimetable) {
        log(`  - ${classInfo.name}`);
        log(`    Description: ${classInfo.description || 'N/A'}`);
        log(`    Instructor: ${classInfo.instructor || 'N/A'}`);
        log(`    Capacity: ${classInfo.capacity || 'N/A'}`);
        log(`    Booking Required: ${classInfo.bookingRequired ? 'Yes' : 'No'}`);
        log(`    Schedule:`);
        for (const schedule of classInfo.schedule) {
          log(`      ${schedule.day}: ${schedule.startTime}-${schedule.endTime} ${schedule.recurring ? '(recurring)' : '(one-time)'}`);
        }
      }
    }
  }

  async deletePlace(name: string, options: CLIOptions): Promise<boolean> {
    logInfo(`${options.dryRun ? 'DRY RUN: ' : ''}Deleting Place with name: ${name}`);

    return await this.withSession(async (session) => {
      // First, check if place exists
      const findQuery = `
        MATCH (p:Place)
        WHERE p.name = $name
        RETURN p
      `;

      const findResult = await session.run(findQuery, { name });

      if (findResult.records.length === 0) {
        logError(`Place with name '${name}' not found`);
        return false;
      }

      const record = findResult.records[0];
      const place = record.get('p');

      logInfo(`Found Place: ${place.properties.name}`);
      logInfo(`  Address: ${place.properties.address || 'N/A'}`);
      logInfo(`  Description: ${place.properties.description || 'N/A'}`);

      if (options.dryRun) {
        logWarning('DRY RUN: Would delete this place and all relationships');
        return true;
      }

      // Delete the place and all relationships
      const deleteQuery = `
        MATCH (p:Place)
        WHERE p.name = $name
        DETACH DELETE p
        RETURN count(p) as deletedCount
      `;

      const deleteResult = await session.run(deleteQuery, { name });
      const deletedCount = deleteResult.records[0].get('deletedCount').toNumber();

      if (deletedCount > 0) {
        logSuccess(`Deleted Place: ${place.properties.name}`);
        return true;
      } else {
        logError('Failed to delete Place');
        return false;
      }
    });
  }

  // ============================================================================
  // DATABASE CLEANUP
  // ============================================================================

  async deleteOrphans(options: CLIOptions): Promise<void> {
    logInfo(`${options.dryRun ? 'DRY RUN: ' : ''}Finding and deleting orphaned nodes...`);

    const summary = await this.withSession(async (session): Promise<OrphanSummary> => {
      // Find orphaned ContactPoint nodes (no incoming HAS_CONTACT relationships)
      const orphanContactQuery = `
        MATCH (cp:ContactPoint)
        WHERE NOT (cp)<-[:HAS_CONTACT]-(:Person)
        RETURN count(cp) as orphanContactCount
      `;

      // Find orphaned PeacokDimension nodes (no incoming HAS_DIMENSION relationships)
      const orphanDimensionQuery = `
        MATCH (pd:PeacokDimension)
        WHERE NOT (pd)<-[:HAS_DIMENSION]-(:Person)
        RETURN count(pd) as orphanDimensionCount
      `;

      const contactResult = await session.run(orphanContactQuery);
      const dimensionResult = await session.run(orphanDimensionQuery);

      const orphanContactCount = contactResult.records[0].get('orphanContactCount').toNumber();
      const orphanDimensionCount = dimensionResult.records[0].get('orphanDimensionCount').toNumber();

      logInfo(`Found ${orphanContactCount} orphaned ContactPoint nodes`);
      logInfo(`Found ${orphanDimensionCount} orphaned PeacokDimension nodes`);

      if (options.dryRun) {
        logWarning(`DRY RUN: Would delete ${orphanContactCount + orphanDimensionCount} orphaned nodes`);
        return { contactPoints: orphanContactCount, peacokDimensions: orphanDimensionCount };
      }

      // Delete orphaned ContactPoints
      if (orphanContactCount > 0) {
        const deleteContactQuery = `
          MATCH (cp:ContactPoint)
          WHERE NOT (cp)<-[:HAS_CONTACT]-(:Person)
          DELETE cp
          RETURN count(cp) as deletedCount
        `;

        const deleteContactResult = await session.run(deleteContactQuery);
        const deletedContactCount = deleteContactResult.records[0].get('deletedCount').toNumber();
        logSuccess(`Deleted ${deletedContactCount} orphaned ContactPoint nodes`);
      }

      // Delete orphaned PeacokDimensions
      if (orphanDimensionCount > 0) {
        const deleteDimensionQuery = `
          MATCH (pd:PeacokDimension)
          WHERE NOT (pd)<-[:HAS_DIMENSION]-(:Person)
          DELETE pd
          RETURN count(pd) as deletedCount
        `;

        const deleteDimensionResult = await session.run(deleteDimensionQuery);
        const deletedDimensionCount = deleteDimensionResult.records[0].get('deletedCount').toNumber();
        logSuccess(`Deleted ${deletedDimensionCount} orphaned PeacokDimension nodes`);
      }

      return { contactPoints: orphanContactCount, peacokDimensions: orphanDimensionCount };
    });

    if (summary.contactPoints === 0 && summary.peacokDimensions === 0) {
      logSuccess('No orphaned nodes found - database is clean');
    } else {
      logSuccess(`Cleanup complete: ${summary.contactPoints + summary.peacokDimensions} orphaned nodes processed`);
    }
  }

  async resetDatabase(options: CLIOptions): Promise<void> {
    if (!options.confirm) {
      logError('Database reset requires --confirm flag for safety');
      logWarning('This will permanently delete ALL data in the Memgraph database!');
      logWarning('Use: bun scripts/updateMemgraph.ts reset --confirm');
      return;
    }

    logWarning(`${options.dryRun ? 'DRY RUN: ' : ''}RESETTING ENTIRE DATABASE...`);

    if (!options.dryRun) {
      // Additional confirmation prompt in non-dry-run mode
      logError('⚠️  DANGER: This will delete ALL data in the Memgraph database!');
      logError('⚠️  This action cannot be undone!');

      // In a real CLI tool, you'd want to use readline for interactive confirmation
      // For this script, we rely on the --confirm flag
    }

    await this.withSession(async (session) => {
      // Get database statistics first
      const statsQuery = `
        MATCH (n)
        OPTIONAL MATCH ()-[r]-()
        RETURN 
          count(DISTINCT n) as nodeCount,
          count(DISTINCT r) as relationshipCount,
          labels(n) as labels
      `;

      const statsResult = await session.run(statsQuery);
      const nodeCount = statsResult.records[0]?.get('nodeCount').toNumber() || 0;
      const relationshipCount = statsResult.records[0]?.get('relationshipCount').toNumber() || 0;

      logInfo(`Database contains: ${nodeCount} nodes, ${relationshipCount} relationships`);

      if (options.dryRun) {
        logWarning('DRY RUN: Would delete all nodes, relationships, indexes, and constraints');
        return;
      }

      // Drop all indexes (regular + vector)
      try {
        const indexesResult = await session.run('SHOW INDEX INFO');
        const indexes = indexesResult.records;

        if (indexes.length > 0) {
          logInfo(`Dropping ${indexes.length} indexes...`);
          let droppedCount = 0;

          for (const indexRecord of indexes) {
            const indexType = indexRecord.get('index type');
            const label = indexRecord.get('label');
            const property = indexRecord.get('property');

            try {
              let dropQuery = '';

              // Handle different index types
              if (indexType === 'label') {
                // Label-only index
                dropQuery = `DROP INDEX ON :${label}`;
              } else if (indexType === 'label+property') {
                // Label+property index
                dropQuery = `DROP INDEX ON :${label}(${property})`;
              } else if (indexType === 'label+property_vector') {
                // Vector index - use same DROP syntax as regular property indexes
                dropQuery = `DROP INDEX ON :${label}(${property})`;
              } else if (indexType === 'edge-type') {
                // Edge type index
                dropQuery = `DROP EDGE INDEX ON :${label}`;
              } else if (indexType === 'edge-type+property') {
                // Edge type+property index
                dropQuery = `DROP EDGE INDEX ON :${label}(${property})`;
              } else {
                logWarning(`Unknown index type '${indexType}' for ${label}${property ? '.' + property : ''}, skipping`);
                continue;
              }

              await session.run(dropQuery);
              droppedCount++;
              logDebug(`  Dropped ${indexType} index: ${label}${property ? '(' + property + ')' : ''}`, options.verbose);
            } catch (error) {
              logWarning(`Failed to drop index on ${label}${property ? '(' + property + ')' : ''}: ${error instanceof Error ? error.message : String(error)}`);
            }
          }

          logSuccess(`Dropped ${droppedCount} indexes (including vector indexes)`);
        }
      } catch (error) {
        logWarning(`Could not retrieve or drop indexes: ${error instanceof Error ? error.message : String(error)}`);
      }

      // Drop all constraints
      try {
        const constraintsResult = await session.run('SHOW CONSTRAINT INFO');
        const constraints = constraintsResult.records;

        if (constraints.length > 0) {
          logInfo(`Dropping ${constraints.length} constraints...`);
          let droppedCount = 0;

          for (const constraintRecord of constraints) {
            // Constraint info returns: constraint type, label, properties
            const constraintType = constraintRecord.get('constraint type');
            const label = constraintRecord.get('label');
            const properties = constraintRecord.get('properties');

            try {
              // Memgraph constraint drop syntax
              const dropQuery = `DROP CONSTRAINT ON (n:${label}) ASSERT ${properties.map((p: string) => `n.${p}`).join(', ')} IS ${constraintType}`;
              await session.run(dropQuery);
              droppedCount++;
              logDebug(`  Dropped ${constraintType} constraint on ${label}(${properties.join(', ')})`, options.verbose);
            } catch (error) {
              logWarning(`Failed to drop constraint on ${label}: ${error instanceof Error ? error.message : String(error)}`);
            }
          }

          logSuccess(`Dropped ${droppedCount} of ${constraints.length} constraints`);
        }
      } catch (error) {
        logWarning(`Could not retrieve or drop constraints: ${error instanceof Error ? error.message : String(error)}`);
      }

      // Delete everything
      const deleteQuery = `
        MATCH (n)
        DETACH DELETE n
        RETURN count(n) as deletedNodes
      `;

      const deleteResult = await session.run(deleteQuery);
      const deletedNodes = deleteResult.records[0].get('deletedNodes').toNumber();

      // Clear Memgraph storage to prevent indexes from being reloaded from disk
      try {
        logInfo('Clearing Memgraph storage snapshots...');
        await session.run('STORAGE CLEAR');
        logSuccess('Storage cleared successfully');
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (errorMessage.includes('Unknown query')) {
          // Try alternative: FREE MEMORY
          try {
            await session.run('FREE MEMORY');
            logSuccess('Memory freed successfully');
          } catch (e2) {
            logWarning('Could not clear storage - indexes may persist from disk');
          }
        } else {
          logWarning(`Storage clear warning: ${errorMessage}`);
        }
      }

      logSuccess(`Database reset complete: ${deletedNodes} nodes and all relationships deleted`);

      // Verify database is empty
      const verifyResult = await session.run('MATCH (n) RETURN count(n) as remaining');
      const remaining = verifyResult.records[0].get('remaining').toNumber();

      if (remaining === 0) {
        logSuccess('Database is now empty and ready for fresh data');
      } else {
        logError(`Warning: ${remaining} nodes still remain in database`);
      }

      // Check if vector indexes still exist after drop
      let vectorIndexCount = 0;
      try {
        const vectorCheck = await session.run('SHOW VECTOR INDEX INFO');
        vectorIndexCount = vectorCheck.records.length;
        if (vectorIndexCount > 0) {
          logWarning(`\n⚠  ${vectorIndexCount} vector indexes persist due to Memgraph durability`);
          logWarning('Vector indexes are stored on disk and reload automatically');

          if (options.restartMemgraph) {
            logInfo('\nRestarting Memgraph container...');
          } else {
            logInfo('\nTo fully remove vector indexes, add --restart-memgraph flag or run:');
            logInfo('  docker restart memgraph');
          }
        }
      } catch (e) {
        // Ignore if vector index query fails
      }

      // Restart Memgraph if requested
      if (options.restartMemgraph && vectorIndexCount > 0) {
        await session.close();
        await this.disconnect();

        const { execSync } = await import('child_process');
        try {
          // Stop Memgraph first
          logInfo('Stopping Memgraph container...');
          execSync('docker stop memgraph', { stdio: 'pipe' });

          // Delete ALL persistent data including RocksDB storage where vector indexes live
          logInfo('Clearing all Memgraph persistent storage (snapshots, WAL, RocksDB)...');
          try {
            execSync('docker exec memgraph sh -c "rm -rf /var/lib/memgraph/snapshots/*"', { stdio: 'pipe' });
            execSync('docker exec memgraph sh -c "rm -rf /var/lib/memgraph/wal/*"', { stdio: 'pipe' });
            execSync('docker exec memgraph sh -c "rm -rf /var/lib/memgraph/rocksdb_*"', { stdio: 'pipe' });
            logSuccess('Cleared all persistent storage files');
          } catch (error) {
            // Container is stopped, use sudo to access volumes directly
            try {
              execSync('sudo rm -rf /var/lib/docker/volumes/specialpedrito_mg_lib/_data/snapshots/*', { stdio: 'pipe' });
              execSync('sudo rm -rf /var/lib/docker/volumes/specialpedrito_mg_lib/_data/wal/*', { stdio: 'pipe' });
              execSync('sudo rm -rf /var/lib/docker/volumes/specialpedrito_mg_lib/_data/rocksdb_*', { stdio: 'pipe' });
              execSync('sudo rm -rf /var/lib/docker/volumes/specialpedrito_mg_lib/_data/.system/*', { stdio: 'pipe' });
              execSync('sudo rm -rf /var/lib/docker/volumes/specialpedrito_mg_lib/_data/databases/*', { stdio: 'pipe' });
              logSuccess('Cleared persistent storage via Docker volumes');
            } catch (e2) {
              logWarning('Could not clear all storage files - vector indexes may persist');
            }
          }

          // Start container fresh
          logInfo('Starting Memgraph container...');
          execSync('docker start memgraph', { stdio: 'inherit' });
          logSuccess('Memgraph container restarted successfully');
          logInfo('Waiting for Memgraph to be ready...');

          // Wait and reconnect
          await new Promise(resolve => setTimeout(resolve, 3000));
          await this.connect();

          // Verify indexes are gone or empty
          const newSession = this.driver!.session();
          const finalCheck = await newSession.run('SHOW VECTOR INDEX INFO');
          const regularCheck = await newSession.run('SHOW INDEX INFO');
          await newSession.close();

          if (finalCheck.records.length === 0) {
            logSuccess('✓ All vector indexes successfully removed');
          } else {
            // Check if indexes are empty (count = 0)
            const nonEmptyIndexes = regularCheck.records.filter(r => {
              const count = r.get('count')?.toNumber() || 0;
              return count > 0;
            });

            if (nonEmptyIndexes.length === 0) {
              logSuccess(`✓ Database fully reset - ${finalCheck.records.length} empty vector index definitions remain`);
              logInfo('(Empty index metadata will be populated on next data write)');
            } else {
              logWarning(`⚠  ${nonEmptyIndexes.length} indexes still contain data`);
            }
          }
        } catch (error) {
          logError(`Failed to restart Memgraph: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    });
  }

  // ============================================================================
  // DATABASE HEALTH CHECK & INDEX MANAGEMENT
  // ============================================================================

  /**
   * Show all indexes in the database
   */
  /**
   * Create vector indexes for PersonaDimension and DesiredDimension nodes
   * Enables fast similarity search using cosine distance
   *
   * Note: This only creates 'profile' indexes as they are the primary indexes used for matchmaking.
   * Other dimension-specific indexes (characteristic, vibe, etc.) are created lazily by the
   * memgraph service when nodes with those dimension names are first created.
   */
  async ensureVectorIndexes(dimension: number = 768, options: CLIOptions): Promise<void> {
    logInfo(`${options.dryRun ? 'DRY RUN: ' : ''}Creating 'profile' vector indexes with dimension ${dimension}...`);

    await this.withSession(async (session) => {
      const indexes = [
        {
          name: 'persona_profile_vector_index',
          label: 'PersonaProfile',
          property: 'embeddings',
        },
        {
          name: 'desired_profile_vector_index',
          label: 'DesiredProfile',
          property: 'embeddings',
        },
      ];

      let created = 0;
      let skipped = 0;

      for (const index of indexes) {
        try {
          if (options.dryRun) {
            logInfo(`  Would create: ${index.name} on :${index.label}(${index.property})`);
            logInfo(`    Config: dimension=${dimension}, capacity=10000, metric=cos`);
            created++;
            continue;
          }

          const query = `CREATE VECTOR INDEX ${index.name} ON :${index.label}(${index.property}) WITH CONFIG {
            "dimension": ${dimension},
            "capacity": 10000,
            "metric": "cos"
          }`;

          logDebug(`  Executing: ${query}`, options.verbose);

          await session.run(query);
          logSuccess(`✓ Created vector index: ${index.name} (dimension: ${dimension})`);
          logDebug(`  Label: ${index.label}, Property: ${index.property}, Metric: cos, Capacity: 10000`, options.verbose);
          created++;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);

          // Log the actual error for debugging
          logDebug(`  Error creating ${index.name}: ${errorMessage}`, options.verbose);

          if (errorMessage.includes('already exists') || errorMessage.includes('Index already exists')) {
            logWarning(`⚠ Vector index ${index.name} already exists (dimension: ${dimension})`);
            skipped++;
          } else {
            logError(`✗ Failed to create vector index ${index.name}: ${errorMessage}`);
          }
        }
      }

      // Summary
      log(colorize('bright', '\n=== VECTOR INDEX SUMMARY ==='));
      if (created > 0) {
        logSuccess(`Created: ${created} vector index(es)`);
      }
      if (skipped > 0) {
        logWarning(`Skipped: ${skipped} index(es) (already exist)`);
      }

      if (!options.dryRun && (created > 0 || skipped > 0)) {
        logInfo('\nUse "showIndexes" command to verify vector indexes');
      }
    });
  }

  async showIndexes(): Promise<void> {
    logInfo('Retrieving all indexes from Memgraph...');

    await this.withSession(async (session) => {
      // Show regular indexes
      try {
        const indexesResult = await session.run('SHOW INDEX INFO');
        const indexes = indexesResult.records;

        if (indexes.length > 0) {
          log(colorize('bright', '\n=== REGULAR INDEXES ==='));
          log(colorize('gray', 'Type'.padEnd(25) + 'Label'.padEnd(25) + 'Property'.padEnd(20) + 'Count'));
          log(colorize('gray', '-'.repeat(90)));

          for (const record of indexes) {
            const indexType = record.get('index type');
            const label = record.get('label');
            const propertyRaw = record.get('property');
            // Handle both string and array property values
            const property = propertyRaw
              ? (Array.isArray(propertyRaw) ? propertyRaw.join(', ') : String(propertyRaw))
              : 'N/A';
            const count = record.get('count')?.toNumber() || 0;

            const line = [
              String(indexType).padEnd(25),
              String(label).padEnd(25),
              property.padEnd(20),
              count.toString()
            ].join('');

            log(line);
          }

          log(colorize('bright', `\nTotal regular indexes: ${indexes.length}`));
        } else {
          logInfo('\nNo regular indexes found');
        }
      } catch (error) {
        logError(`Failed to retrieve regular indexes: ${error instanceof Error ? error.message : String(error)}`);
      }

      // Show vector indexes
      try {
        const vectorIndexesResult = await session.run('SHOW VECTOR INDEX INFO');
        const vectorIndexes = vectorIndexesResult.records;

        if (vectorIndexes.length > 0) {
          log(colorize('bright', '\n=== VECTOR INDEXES ==='));
          log(colorize('gray', 'Index Name'.padEnd(30) + 'Label'.padEnd(25) + 'Property'.padEnd(20) + 'Dimension'.padEnd(12) + 'Metric'));
          log(colorize('gray', '-'.repeat(95)));

          for (const record of vectorIndexes) {
            const indexName = record.get('index_name');
            const label = record.get('label');
            const property = record.get('property');
            const dimension = record.get('dimension')?.toNumber() || 0;
            const metric = record.get('metric') || 'N/A';

            const line = [
              indexName.padEnd(30),
              label.padEnd(25),
              property.padEnd(20),
              dimension.toString().padEnd(12),
              metric
            ].join('');

            log(line);
          }

          log(colorize('bright', `\nTotal vector indexes: ${vectorIndexes.length}`));
        } else {
          logInfo('\nNo vector indexes found');
        }
      } catch (error) {
        logError(`Failed to retrieve vector indexes: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  }

  /**
   * Test vector search on available indexes
   */
  async testVectorSearch(options: CLIOptions): Promise<void> {
    logInfo('Testing vector search on available indexes...');

    await this.withSession(async (session) => {
      // First, list available vector indexes
      try {
        const vectorIndexesResult = await session.run('SHOW VECTOR INDEX INFO');
        const vectorIndexes = vectorIndexesResult.records;

        if (vectorIndexes.length === 0) {
          logWarning('No vector indexes found in database');
          return;
        }

        log(colorize('bright', '\n=== AVAILABLE VECTOR INDEXES ==='));
        for (const record of vectorIndexes) {
          const indexName = record.get('index_name');
          const label = record.get('label');
          const dimension = record.get('dimension')?.toNumber() || 0;
          logInfo(`  - ${indexName} (${label}, dimension: ${dimension})`);
        }

        // Generate a test embedding (768 dimensions)
        const testEmbedding = generateRealisticEmbedding(0);
        logInfo(`\nGenerated test embedding with ${testEmbedding.length} dimensions`);

        // Test search on each vector index
        for (const record of vectorIndexes) {
          const indexName = record.get('index_name');
          const label = record.get('label');

          log(colorize('cyan', `\n• Testing search on: ${indexName}`));

          try {
            const searchQuery = `
              CALL vector_search.search('${indexName}', 5, $testEmbedding)
              YIELD node, similarity
              RETURN node, similarity
              LIMIT 5
            `;

            const result = await session.run(searchQuery, { testEmbedding });

            if (result.records.length > 0) {
              logSuccess(`  ✓ Search successful! Found ${result.records.length} results`);

              for (let i = 0; i < result.records.length; i++) {
                const node = result.records[i].get('node');
                const similarity = result.records[i].get('similarity');
                const name = node.properties.name || 'N/A';
                const value = node.properties.value || 'N/A';
                logInfo(`    [${i + 1}] ${name}: "${value.substring(0, 60)}..." (similarity: ${similarity.toFixed(4)})`);
              }
            } else {
              logWarning(`  ⚠ Search returned 0 results (index may be empty)`);
            }
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logError(`  ✗ Search failed: ${errorMessage}`);
          }
        }

        log(colorize('bright', '\n=== TEST COMPLETE ==='));
      } catch (error) {
        logError(`Failed to test vector search: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  }

  async healthCheck(): Promise<boolean> {
    try {
      logInfo('Performing database health check...');

      await this.withSession(async (session) => {
        // Test basic connectivity
        await session.run('RETURN 1 as test');
        logSuccess('✓ Basic connectivity: OK');

        // Check node counts by type
        const nodeCountQuery = `
          MATCH (n)
          RETURN labels(n)[0] as nodeType, count(n) as count
          ORDER BY nodeType
        `;

        const nodeResult = await session.run(nodeCountQuery);

        log(colorize('cyan', '\n• Node counts by type:'));
        for (const record of nodeResult.records) {
          const nodeType = record.get('nodeType') || 'Unlabeled';
          const count = record.get('count').toNumber();
          log(`  ${nodeType}: ${count}`);
        }

        // Check relationship counts by type
        const relCountQuery = `
          MATCH ()-[r]->()
          RETURN type(r) as relType, count(r) as count
          ORDER BY relType
        `;

        const relResult = await session.run(relCountQuery);

        log(colorize('cyan', '\n• Relationship counts by type:'));
        if (relResult.records.length === 0) {
          log('  No relationships found');
        } else {
          for (const record of relResult.records) {
            const relType = record.get('relType');
            const count = record.get('count').toNumber();
            log(`  ${relType}: ${count}`);
          }
        }

        // Check for orphaned nodes - using simpler Memgraph-compatible approach
        const orphanQuery = `
          MATCH (n)
          WHERE NOT EXISTS {
            MATCH (n)-[r]-()
          }
          RETURN labels(n)[0] as nodeType, count(n) as orphanCount
          ORDER BY nodeType
        `;

        const orphanResult = await session.run(orphanQuery);

        if (orphanResult.records.length > 0) {
          log(colorize('yellow', '\n• Orphaned nodes (no relationships):'));
          for (const record of orphanResult.records) {
            const nodeType = record.get('nodeType') || 'Unlabeled';
            const count = record.get('orphanCount').toNumber();
            log(`  ${nodeType}: ${count}`);
          }
        } else {
          logSuccess('\n✓ No orphaned nodes found');
        }
      });

      logSuccess('\nHealth check completed successfully');
      return true;
    } catch (error) {
      logError(`Health check failed: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  // ============================================================================
  // TEST DATA SEEDING
  // ============================================================================

  /**
   * Remove all test users created by seedTestUsers
   * Deletes Person, Account, and Dimension nodes for test users (channelIds 100000001-100000005)
   */
  async removeTestUsers(options: CLIOptions): Promise<void> {
    logInfo(`${options.dryRun ? 'DRY RUN: ' : ''}Removing test users...`);

    const testChannelIds = ['100000001', '100000002', '100000003', '100000004', '100000005'];

    await this.withSession(async (session) => {
      let removed = 0;
      let notFound = 0;

      for (const channelId of testChannelIds) {
        try {
          // Find Person associated with this Account channelId
          const findQuery = `
            MATCH (acc:Account {platform: 'telegram', identifier: $channelId})
            OPTIONAL MATCH (p:Person)-[:HAS_ACCOUNT]->(acc)
            RETURN p, acc, p.name as name
          `;

          const findResult = await session.run(findQuery, { channelId });

          if (findResult.records.length === 0 || !findResult.records[0].get('p')) {
            logWarning(`  Test user with channelId ${channelId} not found`);
            notFound++;
            continue;
          }

          const personName = findResult.records[0].get('name') || 'Unknown';

          logInfo(`  Found test user: ${personName} (channelId: ${channelId})`);

          if (options.dryRun) {
            logWarning(`  Would delete: ${personName} and all related nodes/relationships`);
            removed++;
            continue;
          }

          // Delete Person and all connected nodes (Account, Dimensions, etc.)
          const deleteQuery = `
            MATCH (acc:Account {platform: 'telegram', identifier: $channelId})
            MATCH (p:Person)-[:HAS_ACCOUNT]->(acc)
            OPTIONAL MATCH (p)-[:HAS_DIMENSION]->(dim)
            DETACH DELETE p, acc, dim
            RETURN count(p) as deletedCount
          `;

          const deleteResult = await session.run(deleteQuery, { channelId });
          const deletedCount = deleteResult.records[0].get('deletedCount').toNumber();

          if (deletedCount > 0) {
            logSuccess(`  ✓ Removed test user: ${personName}`);
            removed++;
          } else {
            logError(`  ✗ Failed to remove test user: ${personName}`);
          }
        } catch (error) {
          logError(`  ✗ Error removing user with channelId ${channelId}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      // Summary
      log(colorize('bright', '\n=== REMOVAL SUMMARY ==='));
      if (removed > 0) {
        logSuccess(`Removed: ${removed} test users`);
      }
      if (notFound > 0) {
        logWarning(`Not found: ${notFound} test users`);
      }

      if (!options.dryRun && removed > 0) {
        logInfo('\nTest users have been removed from the database');
      }
    });
  }

  /**
   * Seed database with 5 sample test users for vector search and matchmaking testing
   * Creates Person, Account, PersonaDimension, and DesiredDimension nodes with relationships
   */
  async seedTestUsers(options: CLIOptions): Promise<void> {
    logInfo(`${options.dryRun ? 'DRY RUN: ' : ''}Seeding 5 test users for matchmaking...`);

    // Reference IDs for existing nodes
    const AGENT_ID = '85dd8272-625b-053b-9c7d-d49cd0bbdde8'; // Paren agent
    const PLACE_NAME = 'Bantabaa Food Dealer';

    // Test user profiles
    const testUsers = [
      {
        name: 'Sarah Chen',
        username: 'sarahchen',
        channelId: '100000001',
        personaText:
          'Serial entrepreneur building AI startups in Berlin. Passionate about product-market fit, venture capital, and scaling technology companies. Analytical thinker who loves discussing business strategy and innovation. Prefers focused 1-on-1 conversations over large groups.',
        desiredText:
          'Looking for technical co-founders, angel investors, and experienced startup operators in the Berlin tech ecosystem. Interested in meeting people who can discuss product strategy, fundraising, and growth hacking. Values direct, high-signal conversations.',
      },
      {
        name: 'Marcus Weber',
        username: 'marcusweber',
        channelId: '100000002',
        personaText:
          'PhD candidate studying ethics and social theory at Humboldt University. Loves deep philosophical debates about consciousness, morality, and societal structures. Thoughtful listener who enjoys exploring complex ideas. Values substantive intellectual exchanges in small group settings.',
        desiredText:
          'Seeking intellectually curious individuals for thoughtful dinner conversations about philosophy, society, and human nature. Interested in connecting with academics, writers, and deep thinkers. Prefers serious, thought-provoking discussions over casual small talk.',
      },
      {
        name: 'Nina Kowalski',
        username: 'ninakowalski',
        channelId: '100000003',
        personaText:
          'Climate activist and sustainability project manager. Works on community organizing and environmental policy initiatives in Berlin. Energetic changemaker passionate about social impact and systems thinking. Enjoys collaborative brainstorming in groups of 2-4 people.',
        desiredText:
          'Wants to connect with fellow changemakers, social entrepreneurs, and activists working on sustainability and community development. Looking for people to discuss environmental justice, regenerative systems, and grassroots organizing. Values action-oriented collaborators.',
      },
      {
        name: 'Leon Baptiste',
        username: 'leonbaptiste',
        channelId: '100000004',
        personaText:
          'Professional jazz saxophonist and music producer. Passionate about improvisation, creative collaboration, and musical experimentation. Free-spirited artist who thrives in spontaneous, creative environments. Enjoys connecting through shared artistic expression rather than structured conversation.',
        desiredText:
          'Looking for fellow musicians, artists, and creatives to jam with and collaborate on projects. Interested in people who appreciate improvisation, jazz, and experimental music. Seeks authentic connections through creative collaboration and artistic dialogue.',
      },
      {
        name: 'Priya Sharma',
        username: 'priyasharma',
        channelId: '100000005',
        personaText:
          'ML engineer at a Berlin fintech company specializing in fraud detection algorithms. Enjoys technical discussions about machine learning systems, distributed computing, and software architecture. Detail-oriented problem solver who loves diving deep into technical challenges. Prefers knowledge-sharing in small technical groups.',
        desiredText:
          'Seeking other technologists, data scientists, and engineers for knowledge exchange about ML systems, algorithms, and technical architecture. Interested in people building interesting technical products. Values depth over breadth in technical discussions and collaborative problem-solving.',
      },
    ];

    await this.withSession(async (session) => {
      let created = 0;
      let skipped = 0;

      // First, ensure Agent node exists
      try {
        const agentCheckQuery = `
          MATCH (agent:Agent {agentId: $agentId})
          RETURN agent.agentId as agentId
        `;
        const agentCheck = await session.run(agentCheckQuery, { agentId: AGENT_ID });

        if (agentCheck.records.length === 0) {
          logInfo('\nCreating Agent node...');
          const createAgentQuery = `
            CREATE (agent:Agent {
              agentId: $agentId,
              name: 'Paren',
              username: 'paren',
              type: 'Agent',
              createdAt: $timestamp,
              updatedAt: $timestamp
            })
            RETURN agent.agentId as agentId
          `;
          await session.run(createAgentQuery, { agentId: AGENT_ID, timestamp: Date.now() });
          logSuccess('✓ Agent node created');
        } else {
          logInfo('\nAgent node already exists');
        }
      } catch (error) {
        logError(`Failed to ensure Agent node: ${error instanceof Error ? error.message : String(error)}`);
        return;
      }

      for (let i = 0; i < testUsers.length; i++) {
        const user = testUsers[i];
        const userId = crypto.randomUUID() as UUID;
        const timestamp = Date.now();

        logInfo(`\n[${i + 1}/5] Creating test user: ${user.name}`);

        // Check if user already exists (by channelId on Account node)
        const checkQuery = `
          MATCH (a:Account {platform: 'telegram', identifier: $channelId})
          RETURN count(a) as exists
        `;

        const checkResult = await session.run(checkQuery, { channelId: user.channelId });
        const exists = checkResult.records[0].get('exists').toNumber() > 0;

        if (exists) {
          logWarning(`  User with channelId ${user.channelId} already exists, skipping`);
          skipped++;
          continue;
        }

        if (options.dryRun) {
          logInfo(`  Would create:`);
          logInfo(`    - Person: ${userId}`);
          logInfo(`    - Account (telegram): ${user.channelId}`);
          logInfo(`    - PersonaDimension (profile): ${user.personaText.substring(0, 80)}...`);
          logInfo(`    - DesiredDimension (profile): ${user.desiredText.substring(0, 80)}...`);
          logInfo(`    - Relationships: HAS_ACCOUNT, MANAGED_BY, HAS_DIMENSION (x2), MANAGED_ON, ATTENDS`);
          created++;
          continue;
        }

        try {
          // Generate embeddings for this user (as native arrays, not JSON strings)
          const personaEmbedding = generateRealisticEmbedding(i * 100);
          const desiredEmbedding = generateRealisticEmbedding(i * 100 + 50);

          // Create all nodes and relationships in one transaction
          const createQuery = `
            // Create Person node
            CREATE (p:Person {
              entityid: $userId,
              name: $name,
              userStatus: 'active',
              metadata: '{}',
              type: 'Person',
              createdAt: $timestamp,
              updatedAt: $timestamp
            })

            // Create Account node (telegram platform)
            CREATE (acc:Account {
              platform: 'telegram',
              identifier: $channelId,
              channelId: $channelId,
              username: $username,
              displayName: $name,
              type: 'Account',
              createdAt: $timestamp,
              updatedAt: $timestamp
            })

            // Create PersonaProfile node with embeddings array (using specific label)
            CREATE (pd:PersonaProfile {
              value: $personaText,
              embeddings: $personaEmbedding
            })

            // Create DesiredProfile node with embeddings array (using specific label)
            CREATE (dd:DesiredProfile {
              value: $desiredText,
              embeddings: $desiredEmbedding
            })

            // Get existing Agent and optional Place
            WITH p, acc, pd, dd
            MATCH (agent:Agent {agentId: $agentId})
            OPTIONAL MATCH (place:Place {name: $placeName})

            // Create relationships following new schema
            CREATE (p)-[:HAS_ACCOUNT {status: 'active', isPrimary: true, createdAt: $timestamp, updatedAt: $timestamp}]->(acc)
            CREATE (p)-[:MANAGED_BY {managementStartedAt: $timestamp, lastInteractionAt: $timestamp, createdAt: $timestamp, updatedAt: $timestamp}]->(agent)
            CREATE (p)-[:HAS_DIMENSION {createdAt: $timestamp, evidence: 'Seeded test data'}]->(pd)
            CREATE (p)-[:HAS_DIMENSION {createdAt: $timestamp, evidence: 'Seeded test data'}]->(dd)
            CREATE (agent)-[:MANAGED_ON {active: true, createdAt: $timestamp, updatedAt: $timestamp}]->(acc)

            // Create ATTENDS relationship if place exists
            FOREACH (pl IN CASE WHEN place IS NOT NULL THEN [place] ELSE [] END |
              CREATE (p)-[:ATTENDS {frequency: 'occasional', firstVisit: $timestamp, lastVisit: $timestamp, createdAt: $timestamp, updatedAt: $timestamp}]->(pl)
            )

            RETURN p.entityid as personId
          `;

          const result = await session.run(createQuery, {
            userId,
            name: user.name,
            channelId: user.channelId,
            username: user.username,
            personaText: user.personaText,
            desiredText: user.desiredText,
            personaEmbedding: personaEmbedding, // Pass as native array
            desiredEmbedding: desiredEmbedding, // Pass as native array
            timestamp,
            agentId: AGENT_ID,
            placeName: PLACE_NAME,
          });

          if (result.records.length > 0) {
            created++;
            logSuccess(`  ✓ Created user: ${user.name} (${userId})`);
          } else {
            logError(`  ✗ Failed to create user: ${user.name}`);
          }
        } catch (error) {
          logError(`  ✗ Error creating user ${user.name}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      // Summary
      log(colorize('bright', '\n=== SEED SUMMARY ==='));
      logSuccess(`Created: ${created} users`);
      if (skipped > 0) {
        logWarning(`Skipped: ${skipped} users (already exist)`);
      }

      if (!options.dryRun && created > 0) {
        logInfo('\nYou can now test vector search and matchmaking with these users!');
        logInfo('Use: bun scripts/updateMemgraph.ts listPersons');
      }
    });
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function inferVenueType(name: string, description?: string): 'restaurant' | 'gym' | 'community space' | 'coworking space' | 'fitness studio' | 'yoga studio' {
  const text = `${name} ${description || ''}`.toLowerCase();

  if (text.includes('yoga')) {
    return 'yoga studio';
  }
  if (text.includes('fitness') || text.includes('studio')) {
    return 'fitness studio';
  }
  if (text.includes('gym')) {
    return 'gym';
  }
  if (text.includes('coworking') || text.includes('office') || text.includes('workspace')) {
    return 'coworking space';
  }
  if (text.includes('community') || text.includes('meeting place')) {
    return 'community space';
  }
  // Default to restaurant for food-related venues
  return 'restaurant';
}

async function createPlaceFromFile(manager: MemgraphManager, filePath: string, options: CLIOptions): Promise<void> {
  try {
    logInfo(`Reading Place data from: ${filePath}`);

    // Read and parse the JSON file - compatible with both Bun and Node
    let fileContent: string;
    if (typeof Bun !== 'undefined' && Bun.file) {
      fileContent = await Bun.file(filePath).text();
    } else {
      // Fallback to Node.js fs for tsx/node execution
      const fs = await import('fs');
      fileContent = await fs.promises.readFile(filePath, 'utf-8');
    }
    const placeData = JSON.parse(fileContent);

    // Validate required fields
    if (!placeData.name) {
      logError('Place data must include a "name" field');
      return;
    }

    // Set defaults for required schema fields and infer venue type
    const inferredVenueType = inferVenueType(placeData.name, placeData.description);

    const placeNode: Omit<PlaceNode, 'createdAt' | 'updatedAt'> = {
      type: 'Place',
      venueType: placeData.venueType || placeData.metadata?.venueType || inferredVenueType,
      name: placeData.name,
      description: placeData.description,
      url: placeData.url,
      address: placeData.address,
      operatingHours: placeData.operatingHours || {},
      classTimetable: placeData.classTimetable || [],
      metadata: placeData.metadata || {},
    };

    logInfo(`Parsed Place data: ${placeNode.name}`);
    logInfo(`  Address: ${placeNode.address || 'N/A'}`);
    logInfo(`  Operating hours: ${Object.keys(placeNode.operatingHours).length} days defined`);
    logInfo(`  Classes: ${placeNode.classTimetable.length} classes scheduled`);

    const success = await manager.createPlace(placeNode, options);

    if (success) {
      logSuccess(`Successfully created Place: ${placeNode.name}`);
    } else {
      logError(`Failed to create Place: ${placeNode.name}`);
      process.exit(1);
    }

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logError(`Failed to create Place from file: ${errorMessage}`);
    process.exit(1);
  }
}

// ============================================================================
// CLI ARGUMENT PARSING
// ============================================================================

function parseArguments(): { command: string; args: string[]; options: CLIOptions } {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    showHelp();
    process.exit(1);
  }

  const command = args[0];
  const commandArgs: string[] = [];
  const options: CLIOptions = {
    dryRun: false,
    confirm: false,
    verbose: false,
    restartMemgraph: false,
  };

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--confirm') {
      options.confirm = true;
    } else if (arg === '--verbose' || arg === '-v') {
      options.verbose = true;
    } else if (arg === '--restart-memgraph') {
      options.restartMemgraph = true;
    } else if (arg.startsWith('--')) {
      logError(`Unknown option: ${arg}`);
      process.exit(1);
    } else {
      commandArgs.push(arg);
    }
  }

  return { command, args: commandArgs, options };
}

function showHelp(): void {
  log(colorize('bright', 'Memgraph Database Management CLI'));
  log('');
  log('Usage:');
  log('  bun scripts/updateMemgraph.ts <command> [options]');
  log('');
  log('Commands:');
  log(colorize('cyan', '  deletePerson <id>') + '        Delete a Person node by entityid or id');
  log(colorize('cyan', '  deleteContactPoint <agentId>') + ' Delete ContactPoint nodes by agentId');
  log(colorize('cyan', '  deleteHumanConnection <id>') + ' Delete a HumanConnection node by connectionId');
  log(colorize('cyan', '  deleteUser <userId>') + '      Delete a user node by userId');
  log(colorize('cyan', '  completeMatch <agentId> <person1Id> <person2Id>') + ' Mark MATCHED_WITH relationship as completed');
  log(colorize('cyan', '  deleteByAgent <agentId>') + '    Delete all nodes created by specific agent');
  log(colorize('cyan', '  deleteSinceDate <YYYY-MM-DD>') + ' Delete all nodes/relationships created since date');
  log(colorize('cyan', '  listPersons') + '              List all Person nodes with basic info');
  log(colorize('cyan', '  getPersonDetails <id>') + '    Show detailed Person information');
  log(colorize('cyan', '  createPlace <json-file>') + '  Create a Place node from JSON file');
  log(colorize('cyan', '  listPlaces') + '               List all Place nodes with basic info');
  log(colorize('cyan', '  getPlaceDetails <name>') + '   Show detailed Place information');
  log(colorize('cyan', '  deletePlace <name>') + '       Delete a Place node by name');
  log(colorize('cyan', '  deleteOrphans') + '            Remove orphaned ContactPoint and PeacokDimension nodes');
  log(colorize('cyan', '  reset --confirm') + '          Clear entire database (requires confirmation)');
  log(colorize('cyan', '  health') + '                   Perform database health check');
  log(colorize('cyan', '  showIndexes') + '              Display all regular and vector indexes');
  log(colorize('cyan', '  createVectorIndexes [dim]') + ' Create persona_profile and desired_profile vector indexes');
  log(colorize('cyan', '  testVectorSearch') + '         Test vector search on all available indexes');
  log(colorize('cyan', '  seedTestUsers') + '            Populate 5 sample users for testing vector search/matchmaking');
  log(colorize('cyan', '  removeTestUsers') + '          Remove all test users created by seedTestUsers');
  log('');
  log('Options:');
  log(colorize('yellow', '  --dry-run') + '               Preview changes without executing');
  log(colorize('yellow', '  --confirm') + '               Required for destructive operations');
  log(colorize('yellow', '  --verbose, -v') + '           Show detailed output');
  log(colorize('yellow', '  --restart-memgraph') + '      Restart Memgraph after reset to clear persistent indexes');
  log('');
  log('Environment:');
  log('  MEMGRAPH_URL                Connection string (default: bolt://localhost:7687)');
  log('');
  log('Examples:');
  log('  bun scripts/updateMemgraph.ts listPersons --dry-run');
  log('  bun scripts/updateMemgraph.ts deletePerson abc123-def456-789');
  log('  bun scripts/updateMemgraph.ts deleteContactPoint 85dd8272-625b-053b-9c7d-d49cd0bbdde8');
  log('  bun scripts/updateMemgraph.ts deleteHumanConnection "7360b4fb-ba3b-0eb8-aaac-9f9040ab4dd1_1760690724296"');
  log('  bun scripts/updateMemgraph.ts deleteUser "7360b4fb-ba3b-0eb8-aaac-9f9040ab4dd1"');
  log('  bun scripts/updateMemgraph.ts completeMatch 85dd8272-625b-053b-9c7d-d49cd0bbdde8 77bb6613-9c78-0319-830c-dc3353e517d7 1bdf179d-cb47-038e-9c41-b15853bcd63a');
  log('  bun scripts/updateMemgraph.ts deleteByAgent 85dd8272-625b-053b-9c7d-d49cd0bbdde8 --dry-run');
  log('  bun scripts/updateMemgraph.ts deleteSinceDate 2025-10-17 --dry-run --verbose');
  log('  bun scripts/updateMemgraph.ts deleteSinceDate 2025-10-17 --confirm');
  log('  bun scripts/updateMemgraph.ts createPlace bantabaa-place.json --dry-run');
  log('  bun scripts/updateMemgraph.ts listPlaces --verbose');
  log('  bun scripts/updateMemgraph.ts getPlaceDetails "Fitness Studio Alpha"');
  log('  bun scripts/updateMemgraph.ts deletePlace "Old Venue Name"');
  log('  bun scripts/updateMemgraph.ts deleteOrphans --verbose');
  log('  bun scripts/updateMemgraph.ts reset --confirm --dry-run');
  log('  bun scripts/updateMemgraph.ts createVectorIndexes 768 --dry-run');
  log('  bun scripts/updateMemgraph.ts testVectorSearch');
  log('  bun scripts/updateMemgraph.ts seedTestUsers --dry-run');
  log('  bun scripts/updateMemgraph.ts removeTestUsers --dry-run');
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

async function main(): Promise<void> {
  const { command, args, options } = parseArguments();

  const manager = new MemgraphManager();

  try {
    await manager.connect();

    switch (command) {
      case 'deletePerson':
        if (args.length !== 1) {
          logError('deletePerson requires exactly one ID argument');
          process.exit(1);
        }
        await manager.deletePerson(args[0], options);
        break;

      case 'deleteContactPoint':
        if (args.length !== 1) {
          logError('deleteContactPoint requires exactly one agentId argument');
          process.exit(1);
        }
        await manager.deleteContactPoint(args[0], options);
        break;

      case 'deleteHumanConnection':
        if (args.length !== 1) {
          logError('deleteHumanConnection requires exactly one connectionId argument');
          process.exit(1);
        }
        await manager.deleteHumanConnection(args[0], options);
        break;

      case 'completeMatch':
        if (args.length !== 3) {
          logError('completeMatch requires exactly three arguments: agentId person1Id person2Id');
          process.exit(1);
        }
        await manager.completeMatch(args[0], args[1], args[2], options);
        break;

      case 'deleteUser':
        if (args.length !== 1) {
          logError('deleteUser requires exactly one userId argument');
          process.exit(1);
        }
        await manager.deleteUser(args[0], options);
        break;

      case 'deleteByAgent':
        if (args.length !== 1) {
          logError('deleteByAgent requires exactly one agentId argument');
          process.exit(1);
        }
        await manager.deleteByAgent(args[0], options);
        break;

      case 'deleteSinceDate':
        if (args.length !== 1) {
          logError('deleteSinceDate requires exactly one date argument (YYYY-MM-DD)');
          process.exit(1);
        }
        // Parse date string to Unix timestamp
        const dateStr = args[0];
        const dateMatch = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!dateMatch) {
          logError('Invalid date format. Use YYYY-MM-DD (e.g., 2025-10-17)');
          process.exit(1);
        }
        const timestamp = new Date(dateStr + 'T00:00:00.000Z').getTime();
        if (isNaN(timestamp)) {
          logError('Invalid date. Please provide a valid date in YYYY-MM-DD format');
          process.exit(1);
        }
        await manager.deleteSinceDate(timestamp, options);
        break;

      case 'listPersons':
        await manager.listPersons(options);
        break;

      case 'getPersonDetails':
        if (args.length !== 1) {
          logError('getPersonDetails requires exactly one ID argument');
          process.exit(1);
        }
        await manager.getPersonDetails(args[0], options);
        break;

      case 'createPlace':
        if (args.length !== 1) {
          logError('createPlace requires exactly one JSON file path argument');
          process.exit(1);
        }
        await createPlaceFromFile(manager, args[0], options);
        break;

      case 'listPlaces':
        await manager.listPlaces(options);
        break;

      case 'getPlaceDetails':
        if (args.length !== 1) {
          logError('getPlaceDetails requires exactly one name argument');
          process.exit(1);
        }
        await manager.getPlaceDetails(args[0], options);
        break;

      case 'deletePlace':
        if (args.length !== 1) {
          logError('deletePlace requires exactly one name argument');
          process.exit(1);
        }
        await manager.deletePlace(args[0], options);
        break;

      case 'deleteOrphans':
        await manager.deleteOrphans(options);
        break;

      case 'reset':
        await manager.resetDatabase(options);
        break;

      case 'health':
        const healthy = await manager.healthCheck();
        process.exit(healthy ? 0 : 1);
        break;

      case 'showIndexes':
        await manager.showIndexes();
        break;

      case 'createVectorIndexes':
        // Parse optional dimension argument (default: 768)
        const dimension = args.length > 0 ? parseInt(args[0], 10) : 768;

        if (isNaN(dimension) || dimension <= 0) {
          logError(`Invalid dimension: ${args[0]}. Must be a positive integer.`);
          process.exit(1);
        }

        await manager.ensureVectorIndexes(dimension, options);
        break;

      case 'testVectorSearch':
        await manager.testVectorSearch(options);
        break;

      case 'seedTestUsers':
        await manager.seedTestUsers(options);
        break;

      case 'removeTestUsers':
        await manager.removeTestUsers(options);
        break;

      case 'help':
      case '--help':
      case '-h':
        showHelp();
        break;

      default:
        logError(`Unknown command: ${command}`);
        showHelp();
        process.exit(1);
    }

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logError(`Operation failed: ${errorMessage}`);

    if (options.verbose && error instanceof Error) {
      console.error(error.stack);
    }

    process.exit(1);
  } finally {
    await manager.disconnect();
  }
}

// Handle uncaught errors gracefully
process.on('unhandledRejection', (reason, promise) => {
  logError(`Unhandled Rejection at: ${promise}, reason: ${reason}`);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  logError(`Uncaught Exception: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

// Run the CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { MemgraphManager };