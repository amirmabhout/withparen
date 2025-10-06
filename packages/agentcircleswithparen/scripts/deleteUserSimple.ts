#!/usr/bin/env bun

/**
 * User Deletion Script for AgentCirclesWithParen (Simplified Version)
 * 
 * This script safely deletes a user and all their associated data from the PostgreSQL database.
 * It handles deletion from all relevant tables and DM rooms.
 * 
 * Usage:
 *   bun run scripts/deleteUserSimple.ts --entityId=<uuid>
 *   bun run scripts/deleteUserSimple.ts --entityId=1bdf179d-cb47-038e-9c41-b15853bcd63a
 * 
 * Options:
 *   --entityId: UUID of the entity to delete
 *   --dry-run: Preview what would be deleted without actually deleting
 *   --yes: Skip confirmation prompt
 */

import postgres from 'postgres';

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
  const connectionString = process.env.POSTGRES_URL || 'postgresql://postgres:KOSTEnanat-1@34.32.127.185:5432/paren';
  
  console.log('🔌 Connecting to PostgreSQL database...');
  console.log(`📍 Connection: ${connectionString.replace(/:[^:@]*@/, ':****@')}`);
  
  const sql = postgres(connectionString, { 
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10
  });
  
  // Test connection
  try {
    await sql`SELECT 1`;
    console.log('✅ Database connection successful');
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    throw error;
  }

  return sql;
}

async function validateEntityExists(sql: any, entityId: string): Promise<boolean> {
  console.log(`🔍 Checking if entity ${entityId} exists...`);
  
  const entity = await sql`
    SELECT id, agent_id, names, created_at 
    FROM entities 
    WHERE id = ${entityId}
    LIMIT 1
  `;
  
  if (entity.length === 0) {
    console.log(`❌ Entity with ID ${entityId} not found in database`);
    return false;
  }

  console.log(`✅ Entity found:`, {
    id: entity[0].id,
    agentId: entity[0].agent_id,
    names: entity[0].names,
    createdAt: entity[0].created_at
  });
  
  return true;
}

async function countRelatedRecords(sql: any, entityId: string): Promise<DatabaseCounts> {
  console.log('📊 Counting related records...');

  // Get room information where user participates
  const userRooms = await sql`
    SELECT r.id as room_id, r.type as room_type
    FROM participants p
    INNER JOIN rooms r ON p."roomId" = r.id
    WHERE p."entityId" = ${entityId}
  `;

  const dmRoomIds = userRooms.filter((room: any) => room.room_type === 'DM').map((room: any) => room.room_id);
  const groupRoomIds = userRooms.filter((room: any) => room.room_type !== 'DM').map((room: any) => room.room_id);

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
    sql`SELECT COUNT(*) as count FROM entities WHERE id = ${entityId}`,
    sql`SELECT COUNT(*) as count FROM participants WHERE "entityId" = ${entityId}`,
    sql`SELECT COUNT(*) as count FROM memories WHERE "entityId" = ${entityId}`,
    sql`SELECT COUNT(*) as count FROM relationships WHERE "sourceEntityId" = ${entityId}`,
    sql`SELECT COUNT(*) as count FROM relationships WHERE "targetEntityId" = ${entityId}`,
    sql`SELECT COUNT(*) as count FROM cache WHERE value::text LIKE ${'%' + entityId + '%'}`,
    // Count DM room related data that will be deleted
    dmRoomIds.length > 0 ? sql`SELECT COUNT(*) as count FROM components WHERE "roomId" = ANY(${dmRoomIds})` : Promise.resolve([{ count: 0 }]),
    dmRoomIds.length > 0 ? sql`SELECT COUNT(*) as count FROM logs WHERE "roomId" = ANY(${dmRoomIds})` : Promise.resolve([{ count: 0 }]),
    dmRoomIds.length > 0 ? sql`SELECT COUNT(*) as count FROM tasks WHERE "roomId" = ANY(${dmRoomIds})` : Promise.resolve([{ count: 0 }]),
    dmRoomIds.length > 0 ? sql`SELECT COUNT(*) as count FROM memories WHERE "roomId" = ANY(${dmRoomIds})` : Promise.resolve([{ count: 0 }])
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

async function deleteUser(sql: any, entityId: string, dryRun: boolean = false): Promise<void> {
  // Get room information for dry run display
  const userRooms = await sql`
    SELECT r.id as room_id, r.type as room_type, r.name as room_name
    FROM participants p
    INNER JOIN rooms r ON p."roomId" = r.id
    WHERE p."entityId" = ${entityId}
  `;

  const dmRoomIds = userRooms.filter((room: any) => room.room_type === 'DM').map((room: any) => room.room_id);
  const groupRooms = userRooms.filter((room: any) => room.room_type !== 'DM');

  if (dryRun) {
    console.log('\n🔍 DRY RUN MODE - No actual deletions will be performed');
    console.log('The following operations would be executed:');
    
    if (dmRoomIds.length > 0) {
      console.log(`   1. Delete DM rooms and all their content:`);
      userRooms.filter((room: any) => room.room_type === 'DM').forEach((room: any) => {
        console.log(`      - Room: ${room.room_name || 'Unnamed'} (${room.room_id})`);
      });
      console.log(`      • All components, logs, tasks, memories in these rooms`);
      console.log(`      • All participants in these rooms`);
      console.log(`      • The rooms themselves`);
    }
    
    if (groupRooms.length > 0) {
      console.log(`   2. Remove user from group rooms (preserve rooms):`);
      groupRooms.forEach((room: any) => {
        console.log(`      - Room: ${room.room_name || 'Unnamed'} (${room.room_id})`);
      });
    }
    
    console.log(`   3. DELETE FROM relationships WHERE "sourceEntityId" = '${entityId}' OR "targetEntityId" = '${entityId}'`);
    console.log(`   4. DELETE FROM memories WHERE "entityId" = '${entityId}' (user-specific memories)`);
    console.log(`   5. DELETE FROM participants WHERE "entityId" = '${entityId}' (group room participations)`);
    console.log(`   6. DELETE FROM entities WHERE id = '${entityId}' (CASCADE)`);
    console.log(`   7. Clean cache entries containing entity reference`);
    return;
  }

  console.log('\n🗑️  Starting user deletion...');

  try {
    // Start a transaction for safety
    await sql.begin(async (tx: any) => {
      // 1. Delete DM rooms entirely (if any)
      if (dmRoomIds.length > 0) {
        console.log('🏠 Deleting DM rooms and all their content...');
        
        // Delete all data in DM rooms first
        console.log('   📝 Deleting DM room components...');
        await tx`DELETE FROM components WHERE "roomId" = ANY(${dmRoomIds})`;
        
        console.log('   📜 Deleting DM room logs...');
        await tx`DELETE FROM logs WHERE "roomId" = ANY(${dmRoomIds})`;
        
        console.log('   📋 Deleting DM room tasks...');
        await tx`DELETE FROM tasks WHERE "roomId" = ANY(${dmRoomIds})`;
        
        console.log('   🧠 Deleting DM room memories (all users)...');
        await tx`DELETE FROM memories WHERE "roomId" = ANY(${dmRoomIds})`;
        
        console.log('   👥 Deleting DM room participants...');
        await tx`DELETE FROM participants WHERE "roomId" = ANY(${dmRoomIds})`;
        
        console.log('   🏠 Deleting DM rooms...');
        await tx`DELETE FROM rooms WHERE id = ANY(${dmRoomIds})`;
        
        console.log(`   ✅ Deleted ${dmRoomIds.length} DM rooms and all their content`);
      }

      // 2. Delete relationships (both as source and target)
      console.log('🔗 Deleting relationships...');
      await tx`DELETE FROM relationships WHERE "sourceEntityId" = ${entityId} OR "targetEntityId" = ${entityId}`;
      console.log(`   ✅ Deleted relationships`);

      // 3. Delete user memories (not in DM rooms - those were already deleted)
      console.log('🧠 Deleting user memories...');
      await tx`DELETE FROM memories WHERE "entityId" = ${entityId}`;
      console.log(`   ✅ Deleted user memories`);

      // 4. Delete user participants from group rooms
      console.log('👥 Deleting user from group rooms...');
      await tx`DELETE FROM participants WHERE "entityId" = ${entityId}`;
      console.log(`   ✅ Removed user from group rooms`);

      // 5. Delete entity (this should cascade to any remaining foreign key references)
      console.log('👤 Deleting entity...');
      await tx`DELETE FROM entities WHERE id = ${entityId}`;
      console.log(`   ✅ Deleted entity`);

      // 6. Clean cache entries that might contain the entity ID
      console.log('🗂️  Cleaning cache entries...');
      await tx`DELETE FROM cache WHERE value::text LIKE ${'%' + entityId + '%'}`;
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
    const sql = await connectToDatabase();

    try {
      // Validate entity exists
      const exists = await validateEntityExists(sql, options.entityId);
      if (!exists) {
        process.exit(1);
      }

      // Count related records
      const counts = await countRelatedRecords(sql, options.entityId);

      // Get confirmation (skip if --yes flag is provided)
      if (!options.dryRun && !options.yes) {
        const confirmed = await promptConfirmation(options.entityId, counts);
        if (!confirmed) {
          console.log('❌ Deletion cancelled by user');
          process.exit(0);
        }
      }

      // Perform deletion
      await deleteUser(sql, options.entityId, options.dryRun);

      if (options.dryRun) {
        console.log('\n🔍 Dry run completed. Use without --dry-run flag to perform actual deletion.');
      }

    } finally {
      // Close database connection
      console.log('🔌 Closing database connection...');
      await sql.end();
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