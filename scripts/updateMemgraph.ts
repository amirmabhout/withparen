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
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log(`
Usage:
  npx tsx updateMemgraph.ts clear
  npx tsx updateMemgraph.ts addConnection "person1, person2, secret, status"
  npx tsx updateMemgraph.ts list

Examples:
  npx tsx updateMemgraph.ts clear
  npx tsx updateMemgraph.ts addConnection "amir, bianca, popcorn, active"
  npx tsx updateMemgraph.ts list
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
        
      default:
        console.error(`❌ Unknown command: ${command}`);
        console.log('Available commands: clear, addConnection, list');
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