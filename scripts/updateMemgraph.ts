#!/usr/bin/env npx tsx

/**
 * Unified Memgraph management script
 * Usage:
 *   npx tsx updateMemgraph.ts clear
 *   npx tsx updateMemgraph.ts addConnection "amir, bianca, popcorn, active"
 */

import neo4j from 'neo4j-driver';

// Hardcoded Memgraph configuration
const MEMGRAPH_HOST = '127.0.0.1';
const MEMGRAPH_PORT = '7687';
const MEMGRAPH_URI = `bolt://${MEMGRAPH_HOST}:${MEMGRAPH_PORT}`;

class MemgraphManager {
  private driver: any;
  private session: any;

  async connect() {
    this.driver = neo4j.driver(MEMGRAPH_URI);
    this.session = this.driver.session();
    console.log(`Connected to Memgraph at ${MEMGRAPH_HOST}:${MEMGRAPH_PORT}`);
  }

  async disconnect() {
    if (this.session) await this.session.close();
    if (this.driver) await this.driver.close();
    console.log('Disconnected from Memgraph');
  }

  async clear() {
    console.log('🧹 Clearing all data from Memgraph...');

    try {
      const query = `MATCH (n) DETACH DELETE n`;
      await this.session.run(query);
      console.log('✅ All data cleared successfully');
    } catch (error: any) {
      console.error('❌ Error clearing data:', error.message);
      throw error;
    }
  }

  async addConnection(connectionString: string) {
    console.log('➕ Adding HumanConnection...');

    try {
      // Parse the connection string "person1, person2, secret, status"
      const parts = connectionString.split(',').map(part => part.trim());

      if (parts.length !== 4) {
        throw new Error('Connection string must be in format: "person1, person2, secret, status"');
      }

      const [person1, person2, secret, status] = parts;

      const query = `
        CREATE (connection:HumanConnection {
          partners: [$person1, $person2],
          secret: $secret,
          status: $status,
          updatedAt: toString(datetime())
        })
        RETURN connection
      `;

      const result = await this.session.run(query, {
        person1,
        person2,
        secret,
        status
      });

      if (result.records.length > 0) {
        const connection = result.records[0].get('connection').properties;
        console.log('✅ HumanConnection created successfully!');
        console.log('Connection details:');
        console.log(`  Partners: ${JSON.stringify(connection.partners)}`);
        console.log(`  Secret: ${connection.secret}`);
        console.log(`  Status: ${connection.status}`);
        console.log(`  Updated At: ${connection.updatedAt}`);
      }

      // Verify the connection was created
      const verifyQuery = `
        MATCH (connection:HumanConnection {secret: $secret})
        RETURN connection
      `;

      const verifyResult = await this.session.run(verifyQuery, { secret });

      if (verifyResult.records.length > 0) {
        console.log('✅ Verification successful! HumanConnection node exists.');
      }

    } catch (error: any) {
      console.error('❌ Error adding connection:', error.message);
      throw error;
    }
  }

  async listConnections() {
    console.log('📋 Listing all HumanConnections...');

    try {
      const query = `
        MATCH (connection:HumanConnection)
        RETURN connection
        ORDER BY connection.updatedAt DESC
      `;

      const result = await this.session.run(query);

      if (result.records.length === 0) {
        console.log('No HumanConnection nodes found.');
        return;
      }

      console.log(`\n✅ Found ${result.records.length} HumanConnection(s):\n`);

      result.records.forEach((record, index) => {
        const connection = record.get('connection').properties;

        console.log(`${index + 1}. HumanConnection:`);
        console.log(`   Partners: ${JSON.stringify(connection.partners)}`);
        console.log(`   Secret: ${connection.secret}`);
        console.log(`   Status: ${connection.status}`);
        console.log(`   Updated At: ${connection.updatedAt}`);
        console.log('');
      });

    } catch (error: any) {
      console.error('❌ Error listing connections:', error.message);
      throw error;
    }
  }

  async getWaitlistConnections() {
    console.log('⏳ Getting all HumanConnections in waitlist status...');

    try {
      const query = `
        MATCH (connection:HumanConnection {status: "waitlist"})
        RETURN connection
        ORDER BY connection.updatedAt DESC
      `;

      const result = await this.session.run(query);

      if (result.records.length === 0) {
        console.log('No HumanConnection nodes with waitlist status found.');
        return [];
      }

      const connections = result.records.map(record => record.get('connection').properties);

      console.log(`✅ Found ${connections.length} waitlist connection(s)`);
      connections.forEach((connection, index) => {
        console.log(`${index + 1}. ConnectionId: ${connection.connectionId}`);
        console.log(`   Partners: ${JSON.stringify(connection.partners)}`);
        console.log(`   Secret: ${connection.secret}`);
        console.log(`   Status: ${connection.status}`);
        console.log(`   Updated At: ${connection.updatedAt}`);
        console.log('');
      });

      return connections;

    } catch (error: any) {
      console.error('❌ Error getting waitlist connections:', error.message);
      throw error;
    }
  }

  async activateConnection(connectionId: string) {
    console.log(`🔄 Activating connection with ID: ${connectionId}...`);

    try {
      const query = `
        MATCH (connection:HumanConnection {connectionId: $connectionId})
        SET connection.status = "active", connection.updatedAt = toString(datetime())
        RETURN connection
      `;

      const result = await this.session.run(query, { connectionId });

      if (result.records.length === 0) {
        console.log(`❌ No HumanConnection found with connectionId: ${connectionId}`);
        return null;
      }

      const connection = result.records[0].get('connection').properties;
      console.log('✅ Connection activated successfully!');
      console.log(`   ConnectionId: ${connection.connectionId}`);
      console.log(`   Partners: ${JSON.stringify(connection.partners)}`);
      console.log(`   Status: ${connection.status}`);
      console.log(`   Updated At: ${connection.updatedAt}`);

      return connection;

    } catch (error: any) {
      console.error('❌ Error activating connection:', error.message);
      throw error;
    }
  }

  async getActiveConnections() {
    console.log('✅ Getting all HumanConnections in active status...');

    try {
      const query = `
        MATCH (connection:HumanConnection {status: "active"})
        RETURN connection
        ORDER BY connection.updatedAt DESC
      `;

      const result = await this.session.run(query);

      if (result.records.length === 0) {
        console.log('No HumanConnection nodes with active status found.');
        return [];
      }

      const connections = result.records.map(record => record.get('connection').properties);

      console.log(`✅ Found ${connections.length} active connection(s)`);
      connections.forEach((connection, index) => {
        console.log(`${index + 1}. ConnectionId: ${connection.connectionId}`);
        console.log(`   Partners: ${JSON.stringify(connection.partners)}`);
        console.log(`   Secret: ${connection.secret}`);
        console.log(`   Status: ${connection.status}`);
        console.log(`   Updated At: ${connection.updatedAt}`);
        console.log('');
      });

      return connections;

    } catch (error: any) {
      console.error('❌ Error getting active connections:', error.message);
      throw error;
    }
  }

  async deleteConnection(connectionId: string) {
    console.log(`🗑️ Deleting HumanConnection and all connected Person nodes for ID: ${connectionId}...`);

    try {
      // First, get the connection details for logging
      const getConnectionQuery = `
        MATCH (connection:HumanConnection {connectionId: $connectionId})
        OPTIONAL MATCH (person:Person)-[:PARTICIPATES_IN]->(connection)
        RETURN connection, collect(person) as connectedPersons
      `;

      const getResult = await this.session.run(getConnectionQuery, { connectionId });

      if (getResult.records.length === 0) {
        console.log(`❌ No HumanConnection found with connectionId: ${connectionId}`);
        return null;
      }

      const connection = getResult.records[0].get('connection').properties;
      const connectedPersons = getResult.records[0].get('connectedPersons');

      console.log('Found connection to delete:');
      console.log(`   ConnectionId: ${connection.connectionId}`);
      console.log(`   Partners: ${JSON.stringify(connection.partners)}`);
      console.log(`   Secret: ${connection.secret}`);
      console.log(`   Status: ${connection.status}`);
      console.log(`   Connected Person nodes: ${connectedPersons.length}`);

      // Delete the HumanConnection and all connected Person nodes
      const deleteQuery = `
        MATCH (connection:HumanConnection {connectionId: $connectionId})
        OPTIONAL MATCH (person:Person)-[:PARTICIPATES_IN]->(connection)
        DETACH DELETE connection, person
        RETURN count(*) as deletedCount
      `;

      const deleteResult = await this.session.run(deleteQuery, { connectionId });

      console.log('✅ Successfully deleted:');
      console.log(`   - HumanConnection node (${connection.connectionId})`);
      console.log(`   - ${connectedPersons.length} connected Person node(s)`);
      console.log(`   - All relationships between them`);

      return {
        deletedConnection: connection,
        deletedPersonsCount: connectedPersons.length
      };

    } catch (error: any) {
      console.error('❌ Error deleting connection:', error.message);
      throw error;
    }
  }

  async deletePerson(userId: string) {
    console.log(`🗑️ Deleting Person node and all relationships for userId: ${userId}...`);

    try {
      // First, get the person details for logging
      const getPersonQuery = `
        MATCH (person:Person {userId: $userId})
        OPTIONAL MATCH (person)-[r]-()
        RETURN person, count(r) as relationshipCount
      `;

      const getResult = await this.session.run(getPersonQuery, { userId });

      if (getResult.records.length === 0) {
        console.log(`❌ No Person found with userId: ${userId}`);
        return null;
      }

      const person = getResult.records[0].get('person').properties;
      const relationshipCount = getResult.records[0].get('relationshipCount').toNumber();

      console.log('Found person to delete:');
      console.log(`   UserId: ${person.userId}`);
      console.log(`   Name: ${person.name || 'N/A'}`);
      console.log(`   Connected relationships: ${relationshipCount}`);

      // Delete the Person node and all its relationships
      const deleteQuery = `
        MATCH (person:Person {userId: $userId})
        DETACH DELETE person
        RETURN count(*) as deletedCount
      `;

      const deleteResult = await this.session.run(deleteQuery, { userId });

      console.log('✅ Successfully deleted:');
      console.log(`   - Person node (${person.userId})`);
      console.log(`   - ${relationshipCount} relationship(s)`);

      return {
        deletedPerson: person,
        deletedRelationshipsCount: relationshipCount
      };

    } catch (error: any) {
      console.error('❌ Error deleting person:', error.message);
      throw error;
    }
  }

  async connectPerson(userId: string, connectionId: string) {
    console.log(`🔗 Creating PARTICIPATES_IN relationship from Person ${userId} to HumanConnection ${connectionId}...`);

    try {
      // First, verify both nodes exist
      const verifyQuery = `
        MATCH (person:Person {userId: $userId})
        MATCH (connection:HumanConnection {connectionId: $connectionId})
        RETURN person, connection
      `;

      const verifyResult = await this.session.run(verifyQuery, { userId, connectionId });

      if (verifyResult.records.length === 0) {
        console.log(`❌ Either Person (${userId}) or HumanConnection (${connectionId}) not found`);
        return null;
      }

      const person = verifyResult.records[0].get('person').properties;
      const connection = verifyResult.records[0].get('connection').properties;

      console.log('Found nodes to connect:');
      console.log(`   Person: ${person.userId} (${person.name || 'N/A'})`);
      console.log(`   HumanConnection: ${connection.connectionId} (${connection.secret})`);

      // Check if relationship already exists
      const existingRelQuery = `
        MATCH (person:Person {userId: $userId})-[r:PARTICIPATES_IN]->(connection:HumanConnection {connectionId: $connectionId})
        RETURN r
      `;

      const existingResult = await this.session.run(existingRelQuery, { userId, connectionId });

      if (existingResult.records.length > 0) {
        console.log('⚠️ PARTICIPATES_IN relationship already exists between these nodes');
        return { person, connection, created: false };
      }

      // Create the PARTICIPATES_IN relationship
      const createRelQuery = `
        MATCH (person:Person {userId: $userId})
        MATCH (connection:HumanConnection {connectionId: $connectionId})
        CREATE (person)-[r:PARTICIPATES_IN {createdAt: toString(datetime())}]->(connection)
        RETURN r
      `;

      const createResult = await this.session.run(createRelQuery, { userId, connectionId });

      if (createResult.records.length > 0) {
        const relationship = createResult.records[0].get('r').properties;
        console.log('✅ PARTICIPATES_IN relationship created successfully!');
        console.log(`   Created At: ${relationship.createdAt}`);

        return { person, connection, relationship, created: true };
      }

    } catch (error: any) {
      console.error('❌ Error connecting person:', error.message);
      throw error;
    }
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log(`
Usage:
  npx tsx updateMemgraph.ts clear
  npx tsx updateMemgraph.ts addConnection "person1, person2, secret, status"
  npx tsx updateMemgraph.ts list
  npx tsx updateMemgraph.ts waitlist
  npx tsx updateMemgraph.ts activate "connectionId"
  npx tsx updateMemgraph.ts active
  npx tsx updateMemgraph.ts delete "connectionId"
  npx tsx updateMemgraph.ts deletePerson "userId"
  npx tsx updateMemgraph.ts connectPerson "userId, connectionId"

Examples:
  npx tsx updateMemgraph.ts clear
  npx tsx updateMemgraph.ts addConnection "amir, bianca, popcorn, active"
  npx tsx updateMemgraph.ts list
  npx tsx updateMemgraph.ts waitlist
  npx tsx updateMemgraph.ts activate "b2b7d02f-7d27-0c3f-8e86-dcb24b043601"
  npx tsx updateMemgraph.ts active
  npx tsx updateMemgraph.ts delete "b2b7d02f-7d27-0c3f-8e86-dcb24b043601"
  npx tsx updateMemgraph.ts deletePerson "user123"
  npx tsx updateMemgraph.ts connectPerson "user123, b2b7d02f-7d27-0c3f-8e86-dcb24b043601"
    `);
    process.exit(1);
  }

  const command = args[0];
  const manager = new MemgraphManager();

  try {
    await manager.connect();

    switch (command) {
      case 'clear':
        await manager.clear();
        break;

      case 'addConnection':
        if (args.length < 2) {
          console.error('❌ Connection string required for addConnection command');
          console.log('Example: npx tsx updateMemgraph.ts addConnection "amir, bianca, popcorn, active"');
          process.exit(1);
        }
        await manager.addConnection(args[1]);
        break;

      case 'list':
        await manager.listConnections();
        break;

      case 'waitlist':
        await manager.getWaitlistConnections();
        break;

      case 'activate':
        if (args.length < 2) {
          console.error('❌ Connection ID required for activate command');
          console.log('Example: npx tsx updateMemgraph.ts activate "b2b7d02f-7d27-0c3f-8e86-dcb24b043601"');
          process.exit(1);
        }
        await manager.activateConnection(args[1]);
        break;

      case 'active':
        await manager.getActiveConnections();
        break;

      case 'delete':
        if (args.length < 2) {
          console.error('❌ Connection ID required for delete command');
          console.log('Example: npx tsx updateMemgraph.ts delete "b2b7d02f-7d27-0c3f-8e86-dcb24b043601"');
          process.exit(1);
        }
        await manager.deleteConnection(args[1]);
        break;

      case 'deletePerson':
        if (args.length < 2) {
          console.error('❌ User ID required for deletePerson command');
          console.log('Example: npx tsx updateMemgraph.ts deletePerson "user123"');
          process.exit(1);
        }
        await manager.deletePerson(args[1]);
        break;

      case 'connectPerson':
        if (args.length < 2) {
          console.error('❌ User ID and Connection ID required for connectPerson command');
          console.log('Example: npx tsx updateMemgraph.ts connectPerson "user123, b2b7d02f-7d27-0c3f-8e86-dcb24b043601"');
          process.exit(1);
        }

        // Parse the connection string "userId, connectionId"
        const parts = args[1].split(',').map(part => part.trim());

        if (parts.length !== 2) {
          console.error('❌ connectPerson requires format: "userId, connectionId"');
          console.log('Example: npx tsx updateMemgraph.ts connectPerson "user123, b2b7d02f-7d27-0c3f-8e86-dcb24b043601"');
          process.exit(1);
        }

        await manager.connectPerson(parts[0], parts[1]);
        break;

      default:
        console.error(`❌ Unknown command: ${command}`);
        console.log('Available commands: clear, addConnection, list, waitlist, activate, active, delete, deletePerson, connectPerson');
        process.exit(1);
    }

    console.log('\n🎉 Operation completed successfully!');

  } catch (error: any) {
    console.error('\n💥 Operation failed:', error.message);
    process.exit(1);
  } finally {
    await manager.disconnect();
  }
}

// Run the script
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}