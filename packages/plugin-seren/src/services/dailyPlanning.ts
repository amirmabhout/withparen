import {
    logger,
    Service,
    type IAgentRuntime,
    type UUID,
    type Content,
    ModelType,
} from '@elizaos/core';
import { MemgraphService } from './memgraph.js';
import { dailyPlanningTemplate } from '../utils/promptTemplates.js';
import { storeDailyPlan } from '../providers/dailyPlan.js';
import { formatPersonaMemories } from '../providers/personaMemory.js';
import { formatConnectionMemories } from '../providers/connectionMemory.js';

/**
 * DailyPlanningService class for generating daily plans and scheduling check-ins
 */
export class DailyPlanningService extends Service {
    static serviceType = 'daily-planning' as const;
    capabilityDescription = 'Generates daily plans and schedules personalized check-ins for relationship partners';

    private readonly PLANNING_HOUR = 6; // 6 AM for daily planning
    private readonly CHECKIN_HOUR = 12; // 12 PM (noon) for check-ins
    private readonly PLANNING_MINUTE_WINDOW = 30; // 30-minute window for execution
    private lastPlanningDate: string | null = null;
    private memgraphService: MemgraphService;

    constructor(runtime: IAgentRuntime) {
        super(runtime);
        this.memgraphService = new MemgraphService();
    }

    /**
     * Start the DailyPlanningService with the given runtime.
     * @param {IAgentRuntime} runtime - The runtime for the DailyPlanningService.
     * @returns {Promise<Service>} A promise that resolves with the DailyPlanningService instance.
     */
    static async start(runtime: IAgentRuntime): Promise<Service> {
        const service = new DailyPlanningService(runtime);
        await service.registerDailyPlanningTask();
        return service;
    }

    /**
     * Register the daily planning task worker
     */
    async registerDailyPlanningTask() {
        // Register the main daily planning task worker
        this.runtime.registerTaskWorker({
            name: 'DAILY_PLANNING',
            validate: async (_runtime, _message, _state) => {
                const now = new Date();
                const hour = now.getHours();
                const minute = now.getMinutes();
                const today = now.toISOString().split('T')[0]; // YYYY-MM-DD format

                // Check if it's the right time (6 AM with a window)
                const isPlanningTime = hour === this.PLANNING_HOUR && minute >= 0 && minute <= this.PLANNING_MINUTE_WINDOW;

                // Check if we haven't already planned today
                const hasNotPlannedToday = this.lastPlanningDate !== today;

                if (isPlanningTime && hasNotPlannedToday) {
                    logger.debug('[Seren] Daily planning validation: It is planning time and planning not done today, task should run');
                    return true;
                }

                return false;
            },
            execute: async (runtime, _options) => {
                const today = new Date().toISOString().split('T')[0];
                await this.executeDailyPlanning(runtime);
                // Mark today as completed
                this.lastPlanningDate = today;
            },
        });

        // Register the individual daily planning task worker
        this.runtime.registerTaskWorker({
            name: 'DAILY_PLANNING_TASK',
            validate: async (_runtime, _message, _state) => {
                // This task is created dynamically and should always execute when queued
                return true;
            },
            execute: async (runtime, _options, task) => {
                if (task?.metadata?.connectionData) {
                    await this.executeSingleConnectionPlanning(runtime, task.metadata.connectionData);
                }
            },
        });

        // Register the daily check-in task worker
        this.runtime.registerTaskWorker({
            name: 'DAILY_CHECKIN_TASK',
            validate: async (_runtime, _message, _state) => {
                const now = new Date();
                const hour = now.getHours();
                const minute = now.getMinutes();

                // Check if it's the right time (noon with a window)
                const isCheckinTime = hour === this.CHECKIN_HOUR && minute >= 0 && minute <= this.PLANNING_MINUTE_WINDOW;

                return isCheckinTime;
            },
            execute: async (runtime, _options, task) => {
                if (task?.metadata?.userId && task?.metadata?.checkInMessage) {
                    await this.sendPersonalizedCheckin(
                        runtime, 
                        task.metadata.userId as UUID, 
                        task.metadata.checkInMessage as string
                    );
                }
            },
        });

        // Check if the daily planning task exists, if not create it
        const existingTasks = await this.runtime.getTasksByName('DAILY_PLANNING');

        if (existingTasks.length === 0) {
            // Get the first available world ID for task creation
            let worldId: UUID;
            try {
                const worlds = await this.runtime.getAllWorlds();
                if (worlds.length > 0) {
                    worldId = worlds[0].id;
                } else {
                    // Use default world ID if no worlds exist
                    worldId = '00000000-0000-0000-0000-000000000000' as UUID;
                }
            } catch (error) {
                logger.warn('[Seren] Using default world for daily planning task creation');
                worldId = '00000000-0000-0000-0000-000000000000' as UUID;
            }

            await this.runtime.createTask({
                name: 'DAILY_PLANNING',
                description: 'Daily planning task that generates plans and schedules check-ins for all active connections',
                worldId: worldId,
                metadata: {
                    updatedAt: Date.now(),
                    updateInterval: 1000 * 60 * 60, // Check every hour
                },
                tags: ['queue', 'repeat', 'daily-planning'],
            });
            logger.info('[Seren] Created daily planning task');
        }
    }

    /**
     * Execute the daily planning by finding active connections and queuing individual planning tasks
     */
    async executeDailyPlanning(runtime: IAgentRuntime) {
        try {
            logger.info('[Seren] Executing daily planning task');

            // Connect to Memgraph
            await this.memgraphService.connect();

            // Get all active HumanConnection nodes with exactly two participants
            const activeConnections = await this.memgraphService.getActiveHumanConnections();

            logger.info(`[Seren] Found ${activeConnections.length} active connections for daily planning`);

            // Get the first available world ID for task creation
            let worldId: UUID;
            try {
                const worlds = await runtime.getAllWorlds();
                if (worlds.length > 0) {
                    worldId = worlds[0].id;
                } else {
                    worldId = '00000000-0000-0000-0000-000000000000' as UUID;
                }
            } catch (error) {
                logger.warn('[Seren] Using default world for daily planning task creation');
                worldId = '00000000-0000-0000-0000-000000000000' as UUID;
            }

            // Queue individual planning tasks for each connection
            for (const connectionData of activeConnections) {
                try {
                    await runtime.createTask({
                        name: 'DAILY_PLANNING_TASK',
                        description: `Daily planning task for connection between ${connectionData.participants[0].name} and ${connectionData.participants[1].name}`,
                        worldId: worldId,
                        metadata: {
                            updatedAt: Date.now(),
                            connectionData: connectionData,
                        },
                        tags: ['queue', 'daily-planning-individual'],
                    });

                    logger.debug(`[Seren] Queued planning task for connection: ${connectionData.connection.partners.join(' & ')}`);

                } catch (error) {
                    logger.error(`[Seren] Failed to queue planning task for connection:`, error);
                }
            }

            // Store completion status in cache for monitoring
            await runtime.setCache('daily-planning-last-run', {
                date: new Date().toISOString(),
                connectionsProcessed: activeConnections.length,
            });

        } catch (error) {
            logger.error('[Seren] Error in daily planning task execution:', error);
        } finally {
            await this.memgraphService.disconnect();
        }
    }

    /**
     * Execute planning for a single connection
     */
    async executeSingleConnectionPlanning(runtime: IAgentRuntime, connectionData: any) {
        try {
            const { connection, participants } = connectionData;
            
            if (participants.length !== 2) {
                logger.warn('[Seren] Connection does not have exactly 2 participants, skipping');
                return;
            }

            const person1 = participants[0];
            const person2 = participants[1];

            logger.info(`[Seren] Generating daily plans for ${person1.name} and ${person2.name}`);

            // Get comprehensive context for both participants
            const person1PersonaMemories = await this.getPersonaMemories(runtime, person1.userId as UUID);
            const person1ConnectionMemories = await this.getConnectionMemories(runtime, person1.userId as UUID);
            const person1RecentMessages = await this.getRecentMessages(runtime, person1.userId as UUID);
            const person1PreviousPlan = await this.getPreviousDailyPlan(runtime, person1.userId as UUID);
            
            const person2PersonaMemories = await this.getPersonaMemories(runtime, person2.userId as UUID);
            const person2ConnectionMemories = await this.getConnectionMemories(runtime, person2.userId as UUID);
            const person2RecentMessages = await this.getRecentMessages(runtime, person2.userId as UUID);
            const person2PreviousPlan = await this.getPreviousDailyPlan(runtime, person2.userId as UUID);

            // Prepare the enhanced prompt with full context
            const currentDate = new Date().toLocaleDateString();
            const prompt = dailyPlanningTemplate
                .replace('{{person1Name}}', person1.name || 'Person 1')
                .replace('{{person1UserId}}', person1.userId)
                .replace('{{person1PersonaMemories}}', person1PersonaMemories)
                .replace('{{person1ConnectionMemories}}', person1ConnectionMemories)
                .replace('{{person1RecentMessages}}', person1RecentMessages)
                .replace('{{person1PreviousPlan}}', person1PreviousPlan)
                .replace('{{person2Name}}', person2.name || 'Person 2')
                .replace('{{person2UserId}}', person2.userId)
                .replace('{{person2PersonaMemories}}', person2PersonaMemories)
                .replace('{{person2ConnectionMemories}}', person2ConnectionMemories)
                .replace('{{person2RecentMessages}}', person2RecentMessages)
                .replace('{{person2PreviousPlan}}', person2PreviousPlan)
                .replace('{{sharedRelationshipContext}}', `Partners: ${connection.partners.join(' & ')}`)
                .replace('{{currentDate}}', currentDate);

            // Generate the daily plans using the runtime's model
            const response = await runtime.useModel(ModelType.TEXT_LARGE, {
                prompt: prompt,
                stop: ['</response>'],
            });

            // Parse the response
            const planningResult = this.parsePlanningResponse(response);

            if (planningResult) {
                // Store daily plans
                await storeDailyPlan(runtime, person1.userId as UUID, planningResult.person1Plan);
                await storeDailyPlan(runtime, person2.userId as UUID, planningResult.person2Plan);

                // Schedule check-in tasks for both participants
                await this.scheduleCheckinTasks(runtime, person1.userId as UUID, planningResult.person1CheckIn);
                await this.scheduleCheckinTasks(runtime, person2.userId as UUID, planningResult.person2CheckIn);

                logger.info(`[Seren] Successfully generated daily plans and scheduled check-ins for ${person1.name} and ${person2.name}`);
            } else {
                logger.error('[Seren] Failed to parse planning response');
            }

        } catch (error) {
            logger.error('[Seren] Error in single connection planning:', error);
        }
    }

    /**
     * Get persona memories for a user
     */
    private async getPersonaMemories(runtime: IAgentRuntime, userId: UUID): Promise<string> {
        try {
            // Use the same dimension tables as the persona memory provider
            const personaDimensions = [
                'persona_demographic',
                'persona_characteristic', 
                'persona_routine',
                'persona_goal',
                'persona_experience',
                'persona_persona_relationship',
                'persona_emotional_state'
            ];

            // Get memories from all persona dimensions - now using correct entityId (userId)
            const personaMemoryPromises = personaDimensions.map(async (tableName) => {
                try {
                    const memories = await runtime.getMemories({
                        tableName,
                        entityId: userId, // Now correctly using userId since memories are stored with user's entityId
                        count: 3, // Get top 3 from each dimension
                        unique: false,
                    });
                    logger.debug(`[Seren] Found ${memories.length} memories in ${tableName} for user ${userId}`);
                    return memories;
                } catch (error) {
                    logger.warn(`[Seren] Failed to get memories from ${tableName}:`, error);
                    return [];
                }
            });

            const personaMemoryResults = await Promise.all(personaMemoryPromises);
            
            // Flatten and deduplicate all persona memories
            const allPersonaMemories = personaMemoryResults
                .flat()
                .filter((memory, index, self) => 
                    index === self.findIndex((t) => t.id === memory.id)
                )
                .slice(0, 15); // Limit to top 15 most relevant

            logger.debug(`[Seren] Total persona memories found for user ${userId}: ${allPersonaMemories.length}`);

            if (allPersonaMemories.length === 0) {
                return 'No persona memories available.';
            }

            return formatPersonaMemories(allPersonaMemories);
        } catch (error) {
            logger.error(`[Seren] Error getting persona memories for ${userId}:`, error);
            return 'No persona memories available.';
        }
    }

    /**
     * Get connection memories for a user
     */
    private async getConnectionMemories(runtime: IAgentRuntime, userId: UUID): Promise<string> {
        try {
            // Use the same dimension tables as the connection memory provider
            const connectionDimensions = [
                'connection_profile',
                'connection_routine',
                'connection_goal',
                'connection_experience',
                'connection_communication',
                'connection_emotion'
            ];

            // Get memories from all connection dimensions - now using correct entityId (userId)
            const connectionMemoryPromises = connectionDimensions.map(async (tableName) => {
                try {
                    const memories = await runtime.getMemories({
                        tableName,
                        entityId: userId, // Now correctly using userId since memories are stored with user's entityId
                        count: 3, // Get top 3 from each dimension
                        unique: false,
                    });
                    logger.debug(`[Seren] Found ${memories.length} memories in ${tableName} for user ${userId}`);
                    return memories;
                } catch (error) {
                    logger.warn(`[Seren] Failed to get memories from ${tableName}:`, error);
                    return [];
                }
            });

            const connectionMemoryResults = await Promise.all(connectionMemoryPromises);
            
            // Flatten and deduplicate all connection memories
            const allConnectionMemories = connectionMemoryResults
                .flat()
                .filter((memory, index, self) => 
                    index === self.findIndex((t) => t.id === memory.id)
                )
                .slice(0, 12); // Limit to top 12 most relevant

            logger.debug(`[Seren] Total connection memories found for user ${userId}: ${allConnectionMemories.length}`);

            if (allConnectionMemories.length === 0) {
                return 'No connection insights available.';
            }

            return formatConnectionMemories(allConnectionMemories);
        } catch (error) {
            logger.error(`[Seren] Error getting connection memories for ${userId}:`, error);
            return 'No connection insights available.';
        }
    }

    /**
     * Get recent messages for a user (last 24 hours)
     */
    private async getRecentMessages(runtime: IAgentRuntime, userId: UUID): Promise<string> {
        try {
            // Calculate 24 hours ago
            const twentyFourHoursAgo = Date.now() - (24 * 60 * 60 * 1000);

            // Get recent messages from the user's room (assuming roomId = userId for DMs)
            const memories = await runtime.getMemories({
                tableName: 'messages',
                roomId: userId, // Assuming DM room ID matches user ID
                count: 50, // Get more messages to filter by time
                unique: false,
            });

            // Filter messages from the last 24 hours and format them
            const recentMessages = memories
                .filter(memory => memory.createdAt && memory.createdAt >= twentyFourHoursAgo)
                .slice(0, 20) // Limit to last 20 messages
                .map(memory => {
                    const timestamp = new Date(memory.createdAt).toLocaleTimeString();
                    const sender = memory.entityId === runtime.agentId ? 'Seren' : 'User';
                    return `[${timestamp}] ${sender}: ${memory.content.text || ''}`;
                })
                .join('\n');

            return recentMessages || 'No recent messages in the last 24 hours.';
        } catch (error) {
            logger.error(`[Seren] Error getting recent messages for ${userId}:`, error);
            return 'No recent conversation history available.';
        }
    }

    /**
     * Get previous daily plan for a user (yesterday's plan)
     */
    private async getPreviousDailyPlan(runtime: IAgentRuntime, userId: UUID): Promise<string> {
        try {
            // Calculate yesterday's date
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            const yesterdayStr = yesterday.toISOString().split('T')[0]; // YYYY-MM-DD format

            const cacheKey = `daily-plan-${userId}-${yesterdayStr}`;
            const cachedPlan = await runtime.getCache(cacheKey);

            if (cachedPlan && typeof cachedPlan === 'object' && 'plan' in cachedPlan) {
                return `Yesterday's Plan:\n${cachedPlan.plan}`;
            }

            return 'No previous daily plan available.';
        } catch (error) {
            logger.error(`[Seren] Error getting previous daily plan for ${userId}:`, error);
            return 'No previous daily plan available.';
        }
    }

    /**
     * Parse the planning response from the LLM
     */
    private parsePlanningResponse(response: string): {
        person1Plan: string;
        person1CheckIn: string;
        person2Plan: string;
        person2CheckIn: string;
    } | null {
        try {
            // Extract content between <response> tags
            const responseMatch = response.match(/<response>([\s\S]*?)<\/response>/);
            if (!responseMatch) {
                logger.error('[Seren] No response tags found in planning response');
                return null;
            }

            const responseContent = responseMatch[1];

            // Extract individual fields
            const person1PlanMatch = responseContent.match(/<person1Plan>([\s\S]*?)<\/person1Plan>/);
            const person1CheckInMatch = responseContent.match(/<person1CheckIn>([\s\S]*?)<\/person1CheckIn>/);
            const person2PlanMatch = responseContent.match(/<person2Plan>([\s\S]*?)<\/person2Plan>/);
            const person2CheckInMatch = responseContent.match(/<person2CheckIn>([\s\S]*?)<\/person2CheckIn>/);

            if (!person1PlanMatch || !person1CheckInMatch || !person2PlanMatch || !person2CheckInMatch) {
                logger.error('[Seren] Missing required fields in planning response');
                return null;
            }

            return {
                person1Plan: person1PlanMatch[1].trim(),
                person1CheckIn: person1CheckInMatch[1].trim(),
                person2Plan: person2PlanMatch[1].trim(),
                person2CheckIn: person2CheckInMatch[1].trim(),
            };

        } catch (error) {
            logger.error('[Seren] Error parsing planning response:', error);
            return null;
        }
    }

    /**
     * Schedule check-in tasks for a user
     */
    private async scheduleCheckinTasks(runtime: IAgentRuntime, userId: UUID, checkInMessage: string) {
        try {
            // Get the first available world ID for task creation
            let worldId: UUID;
            try {
                const worlds = await runtime.getAllWorlds();
                if (worlds.length > 0) {
                    worldId = worlds[0].id;
                } else {
                    worldId = '00000000-0000-0000-0000-000000000000' as UUID;
                }
            } catch (error) {
                logger.warn('[Seren] Using default world for check-in task creation');
                worldId = '00000000-0000-0000-0000-000000000000' as UUID;
            }

            await runtime.createTask({
                name: 'DAILY_CHECKIN_TASK',
                description: `Daily check-in task for user ${userId}`,
                worldId: worldId,
                metadata: {
                    updatedAt: Date.now(),
                    userId: userId,
                    checkInMessage: checkInMessage,
                },
                tags: ['queue', 'daily-checkin-individual'],
            });

            logger.debug(`[Seren] Scheduled check-in task for user: ${userId}`);

        } catch (error) {
            logger.error(`[Seren] Failed to schedule check-in task for user ${userId}:`, error);
        }
    }

    /**
     * Send personalized check-in message to a user
     */
    private async sendPersonalizedCheckin(runtime: IAgentRuntime, userId: UUID, checkInMessage: string) {
        try {
            const roomId = userId; // Assuming roomId is same as userId for DMs

            const checkInContent: Content = {
                text: checkInMessage,
                actions: ['NONE'],
                simple: true,
            };

            // Create a memory for the check-in message
            const checkInMemory = {
                id: runtime.createRunId(),
                entityId: runtime.agentId,
                agentId: runtime.agentId,
                content: checkInContent,
                roomId: roomId,
                createdAt: Date.now(),
            };

            // Save the message to memory first
            await runtime.createMemory(checkInMemory, 'messages');

            // Get the room to determine the source and send the message
            const room = await runtime.getRoom(roomId);
            if (room && room.source) {
                try {
                    // Use the sendMessageToTarget method to send the message
                    await runtime.sendMessageToTarget({
                        source: room.source,
                        roomId: roomId,
                    }, checkInContent);

                    logger.debug(`[Seren] Personalized check-in sent successfully to user: ${userId} (${room.source})`);
                } catch (sendError) {
                    // If direct sending fails, try emitting an event
                    logger.debug(`[Seren] Direct send failed for user ${userId}, trying event emission:`, sendError);

                    try {
                        // Emit a message event that the message handlers can pick up
                        await runtime.emitEvent('new_message', {
                            runtime,
                            message: checkInMemory,
                            roomId: roomId,
                            source: 'daily-checkin',
                        });

                        logger.debug(`[Seren] Check-in event emitted for user: ${userId}`);
                    } catch (eventError) {
                        logger.warn(`[Seren] Event emission also failed for user ${userId}:`, eventError);
                    }
                }
            } else {
                logger.warn(`[Seren] Room ${roomId} not found or has no source`);
            }

        } catch (error) {
            logger.error(`[Seren] Error sending personalized check-in to user ${userId}:`, error);
        }
    }

    /**
     * Manual trigger for testing daily planning (bypasses time validation)
     */
    async triggerTestPlanning() {
        logger.info('[Seren] Manually triggering daily planning for testing');
        await this.executeDailyPlanning(this.runtime);
    }

    /**
     * Get the last planning status from cache
     */
    async getLastPlanningStatus() {
        return await this.runtime.getCache('daily-planning-last-run');
    }

    /**
     * Stop the service
     */
    async stop() {
        await this.memgraphService.disconnect();
        logger.debug('[Seren] DailyPlanningService stopped');
    }
}