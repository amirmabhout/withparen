#!/usr/bin/env bun

/**
 * User Deletion Script for AgentCirclesWithParen
 * 
 * This script safely deletes a user and all their associated data from the PostgreSQL database.
 * It handles deletion from all relevant tables using CASCADE foreign key constraints.
 * 
 * Usage:
 *   bun run scripts/deleteUser.ts --entityId=<uuid>
 *   bun run scripts/deleteUser.ts --entityId=1bdf179d-cb47-038e-9c41-b15853bcd63a
 * 
 * Options:
 *   --entityId: UUID of the entity to delete
 *   --dry-run: Preview what would be deleted without actually deleting
 *   --yes: Skip confirmation prompt
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { eq, sql, inArray } from 'drizzle-orm';
import { schema } from '@elizaos/plugin-sql';

const {
  entityTable,
  participantTable,
  memoryTable,
  relationshipTable,
  cacheTable,
  roomTable,
  componentTable,
  logTable,
  taskTable
} = schema;

interface DeleteUserOptions {
  entityId: string;
  dryRun?: boolean;
  yes?: boolean;
}

interface DatabaseCounts {
  entities: number;
  participants: number;
  memories: number;
  relationships: number;
  cacheEntries: number;
  dmRooms: number;
  groupRooms: number;
  dmRoomComponents: number;
  dmRoomLogs: number;
  dmRoomTasks: number;
  dmRoomMemories: number;
}

async function parseArguments(): Promise<DeleteUserOptions> {
  const args = process.argv.slice(2);
  const options: DeleteUserOptions = {
    entityId: '',
    dryRun: false,
    yes: false
  };

  for (const arg of args) {
    if (arg.startsWith('--entityId=')) {
      options.entityId = arg.split('=')[1];
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--yes') {
      options.yes = true;
    }
  }

  // Default entityId if not provided
  if (!options.entityId) {
    options.entityId = '1bdf179d-cb47-038e-9c41-b15853bcd63a';
    console.log(`⚠️  No entityId provided, using default: ${options.entityId}`);
  }

  return options;
}

async function connectToDatabase() {
  const connectionString = process.env.POSTGRES_URL || 'postgresql://postgres:KOSTEnanat-1@34.32.127.185:5432/circleswithparen';

  console.log('🔌 Connecting to PostgreSQL database...');
  console.log(`📍 Connection: ${connectionString.replace(/:[^:@]*@/, ':****@')}`);

  const sql_client = postgres(connectionString, {
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10
  });

  const db = drizzle(sql_client);

  // Test connection
  try {
    await sql_client`SELECT 1`;
    console.log('✅ Database connection successful');
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    throw error;
  }

  return { db, sql_client };
}

async function validateEntityExists(db: any, entityId: string): Promise<boolean> {
  console.log(`🔍 Checking if entity ${entityId} exists...`);

  const entity = await db.select().from(entityTable).where(eq(entityTable.id, entityId)).limit(1);

  if (entity.length === 0) {
    console.log(`❌ Entity with ID ${entityId} not found in database`);
    return false;
  }

  console.log(`✅ Entity found:`, {
    id: entity[0].id,
    agentId: entity[0].agentId,
    names: entity[0].names,
    createdAt: entity[0].createdAt
  });

  return true;
}

async function countRelatedRecords(db: any, entityId: string): Promise<DatabaseCounts> {
  console.log('📊 Counting related records...');

  // First get room IDs where user participates
  const userRooms = await db
    .select({ roomId: participantTable.roomId, roomType: roomTable.type })
    .from(participantTable)
    .innerJoin(roomTable, eq(participantTable.roomId, roomTable.id))
    .where(eq(participantTable.entityId, entityId));

  const dmRoomIds = userRooms.filter(room => room.roomType === 'DM').map(room => room.roomId);
  const groupRoomIds = userRooms.filter(room => room.roomType !== 'DM').map(room => room.roomId);

  const [
    entities,
    participants,
    memories,
    relationshipsAsSource,
    relationshipsAsTarget,
    cacheEntries,
    dmRoomComponents,
    dmRoomLogs,
    dmRoomTasks,
    dmRoomMemories
  ] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(entityTable).where(eq(entityTable.id, entityId)),
    db.select({ count: sql<number>`count(*)` }).from(participantTable).where(eq(participantTable.entityId, entityId)),
    db.select({ count: sql<number>`count(*)` }).from(memoryTable).where(eq(memoryTable.entityId, entityId)),
    db.select({ count: sql<number>`count(*)` }).from(relationshipTable).where(eq(relationshipTable.sourceEntityId, entityId)),
    db.select({ count: sql<number>`count(*)` }).from(relationshipTable).where(eq(relationshipTable.targetEntityId, entityId)),
    db.select({ count: sql<number>`count(*)` }).from(cacheTable).where(sql`value::text LIKE ${'%' + entityId + '%'}`),
    // Count DM room related data that will be deleted
    dmRoomIds.length > 0 ? db.select({ count: sql<number>`count(*)` }).from(componentTable).where(inArray(componentTable.roomId, dmRoomIds)) : Promise.resolve([{ count: 0 }]),
    dmRoomIds.length > 0 ? db.select({ count: sql<number>`count(*)` }).from(logTable).where(inArray(logTable.roomId, dmRoomIds)) : Promise.resolve([{ count: 0 }]),
    dmRoomIds.length > 0 ? db.select({ count: sql<number>`count(*)` }).from(taskTable).where(inArray(taskTable.roomId, dmRoomIds)) : Promise.resolve([{ count: 0 }]),
    dmRoomIds.length > 0 ? db.select({ count: sql<number>`count(*)` }).from(memoryTable).where(inArray(memoryTable.roomId, dmRoomIds)) : Promise.resolve([{ count: 0 }])
  ]);

  const counts: DatabaseCounts = {
    entities: Number(entities[0]?.count || 0),
    participants: Number(participants[0]?.count || 0),
    memories: Number(memories[0]?.count || 0),
    relationships: Number(relationshipsAsSource[0]?.count || 0) + Number(relationshipsAsTarget[0]?.count || 0),
    cacheEntries: Number(cacheEntries[0]?.count || 0),
    dmRooms: dmRoomIds.length,
    groupRooms: groupRoomIds.length,
    dmRoomComponents: Number(dmRoomComponents[0]?.count || 0),
    dmRoomLogs: Number(dmRoomLogs[0]?.count || 0),
    dmRoomTasks: Number(dmRoomTasks[0]?.count || 0),
    dmRoomMemories: Number(dmRoomMemories[0]?.count || 0)
  };

  console.log('📋 Records to be affected:');
  console.log(`   • Entities: ${counts.entities}`);
  console.log(`   • User Participants: ${counts.participants}`);
  console.log(`   • User Memories: ${counts.memories}`);
  console.log(`   • Relationships: ${counts.relationships}`);
  console.log(`   • Cache entries: ${counts.cacheEntries}`);
  console.log(`   • DM Rooms (will be deleted entirely): ${counts.dmRooms}`);
  console.log(`   • Group Rooms (user will be removed): ${counts.groupRooms}`);
  if (counts.dmRooms > 0) {
    console.log(`   • DM Room Components: ${counts.dmRoomComponents}`);
    console.log(`   • DM Room Logs: ${counts.dmRoomLogs}`);
    console.log(`   • DM Room Tasks: ${counts.dmRoomTasks}`);
    console.log(`   • DM Room Memories (all users): ${counts.dmRoomMemories}`);
  }

  return counts;
}

async function promptConfirmation(entityId: string, counts: DatabaseCounts): Promise<boolean> {
  const totalRecords = counts.entities + counts.participants + counts.memories + counts.relationships +
    counts.cacheEntries + counts.dmRooms + counts.dmRoomComponents + counts.dmRoomLogs +
    counts.dmRoomTasks + counts.dmRoomMemories;

  console.log('\n⚠️  DELETION CONFIRMATION');
  console.log('═══════════════════════════');
  console.log(`Entity ID: ${entityId}`);
  console.log(`Total records to delete: ${totalRecords}`);
  console.log('\nThis action CANNOT be undone!');

  // Simple confirmation (in a real script you might want to use a proper prompt library)
  const response = prompt('\nType "DELETE" to confirm deletion: ');
  return response === 'DELETE';
}

async function deleteUser(db: any, entityId: string, dryRun: boolean = false): Promise<void> {
  // Get room information for dry run display
  const userRooms = await db
    .select({ roomId: participantTable.roomId, roomType: roomTable.type, roomName: roomTable.name })
    .from(participantTable)
    .innerJoin(roomTable, eq(participantTable.roomId, roomTable.id))
    .where(eq(participantTable.entityId, entityId));

  const dmRoomIds = userRooms.filter(room => room.roomType === 'DM').map(room => room.roomId);
  const groupRooms = userRooms.filter(room => room.roomType !== 'DM');

  if (dryRun) {
    console.log('\n🔍 DRY RUN MODE - No actual deletions will be performed');
    console.log('The following operations would be executed:');

    if (dmRoomIds.length > 0) {
      console.log(`   1. Delete DM rooms and all their content:`);
      userRooms.filter(room => room.roomType === 'DM').forEach(room => {
        console.log(`      - Room: ${room.roomName || 'Unnamed'} (${room.roomId})`);
      });
      console.log(`      • All components, logs, tasks, memories in these rooms`);
      console.log(`      • All participants in these rooms`);
      console.log(`      • The rooms themselves`);
    }

    if (groupRooms.length > 0) {
      console.log(`   2. Remove user from group rooms (preserve rooms):`);
      groupRooms.forEach(room => {
        console.log(`      - Room: ${room.roomName || 'Unnamed'} (${room.roomId})`);
      });
    }

    console.log(`   3. DELETE FROM relationships WHERE sourceEntityId = '${entityId}' OR targetEntityId = '${entityId}'`);
    console.log(`   4. DELETE FROM memories WHERE entityId = '${entityId}' (user-specific memories)`);
    console.log(`   5. DELETE FROM participants WHERE entityId = '${entityId}' (group room participations)`);
    console.log(`   6. DELETE FROM entities WHERE id = '${entityId}' (CASCADE)`);
    console.log(`   7. Clean cache entries containing entity reference`);
    return;
  }

  console.log('\n🗑️  Starting user deletion...');

  try {
    // Start a transaction for safety
    await db.transaction(async (tx: any) => {
      // 1. Delete DM rooms entirely (if any)
      if (dmRoomIds.length > 0) {
        console.log('🏠 Deleting DM rooms and all their content...');

        // Delete all data in DM rooms first
        console.log('   📝 Deleting DM room components...');
        await tx.delete(componentTable).where(inArray(componentTable.roomId, dmRoomIds));

        console.log('   📜 Deleting DM room logs...');
        await tx.delete(logTable).where(inArray(logTable.roomId, dmRoomIds));

        console.log('   📋 Deleting DM room tasks...');
        await tx.delete(taskTable).where(inArray(taskTable.roomId, dmRoomIds));

        console.log('   🧠 Deleting DM room memories (all users)...');
        await tx.delete(memoryTable).where(inArray(memoryTable.roomId, dmRoomIds));

        console.log('   👥 Deleting DM room participants...');
        await tx.delete(participantTable).where(inArray(participantTable.roomId, dmRoomIds));

        console.log('   🏠 Deleting DM rooms...');
        await tx.delete(roomTable).where(inArray(roomTable.id, dmRoomIds));

        console.log(`   ✅ Deleted ${dmRoomIds.length} DM rooms and all their content`);
      }

      // 2. Delete relationships (both as source and target)
      console.log('🔗 Deleting relationships...');
      await tx.delete(relationshipTable)
        .where(
          sql`${relationshipTable.sourceEntityId} = ${entityId} OR ${relationshipTable.targetEntityId} = ${entityId}`
        );
      console.log(`   ✅ Deleted relationships`);

      // 3. Delete user memories (not in DM rooms - those were already deleted)
      console.log('🧠 Deleting user memories...');
      await tx.delete(memoryTable).where(eq(memoryTable.entityId, entityId));
      console.log(`   ✅ Deleted user memories`);

      // 4. Delete user participants from group rooms
      console.log('👥 Deleting user from group rooms...');
      await tx.delete(participantTable).where(eq(participantTable.entityId, entityId));
      console.log(`   ✅ Removed user from group rooms`);

      // 5. Delete entity (this should cascade to any remaining foreign key references)
      console.log('👤 Deleting entity...');
      await tx.delete(entityTable).where(eq(entityTable.id, entityId));
      console.log(`   ✅ Deleted entity`);

      // 6. Clean cache entries that might contain the entity ID
      console.log('🗂️  Cleaning cache entries...');
      await tx.delete(cacheTable).where(sql`value::text LIKE ${'%' + entityId + '%'}`);
      console.log(`   ✅ Cleaned cache entries`);
    });

    console.log('\n✅ User deletion completed successfully!');

  } catch (error) {
    console.error('\n❌ Error during deletion:', error);
    throw error;
  }
}

async function main() {
  console.log('🚀 User Deletion Script Started');
  console.log('═══════════════════════════════');

  try {
    // Parse command line arguments
    const options = await parseArguments();
    console.log(`🎯 Target Entity ID: ${options.entityId}`);

    if (options.dryRun) {
      console.log('🔍 Running in DRY RUN mode');
    }

    // Connect to database
    const { db, sql_client } = await connectToDatabase();

    try {
      // Validate entity exists
      const exists = await validateEntityExists(db, options.entityId);
      if (!exists) {
        process.exit(1);
      }

      // Count related records
      const counts = await countRelatedRecords(db, options.entityId);

      // Get confirmation (skip if --yes flag is provided)
      if (!options.dryRun && !options.yes) {
        const confirmed = await promptConfirmation(options.entityId, counts);
        if (!confirmed) {
          console.log('❌ Deletion cancelled by user');
          process.exit(0);
        }
      }

      // Perform deletion
      await deleteUser(db, options.entityId, options.dryRun);

      if (options.dryRun) {
        console.log('\n🔍 Dry run completed. Use without --dry-run flag to perform actual deletion.');
      }

    } finally {
      // Close database connection
      console.log('🔌 Closing database connection...');
      await sql_client.end();
    }

  } catch (error) {
    console.error('\n💥 Fatal error:', error);
    process.exit(1);
  }
}

// Run the script
if (import.meta.main) {
  main();
}