import {
    logger,
    Service,
    type IAgentRuntime,
    type UUID,
    type Memory,
    ModelType,
    composePromptFromState,
} from '@elizaos/core';

import { weeklyReflectionTemplate } from '../utils/promptTemplates.ts';

/**
 * WeeklyReflectionService class for analyzing agent's strategy effectiveness weekly
 */
export class WeeklyReflectionService extends Service {
    static serviceType = 'weekly-reflection' as const;
    capabilityDescription = 'Analyzes agent strategy effectiveness every Friday late afternoon';

    private readonly REFLECTION_DAY = 5; // Friday (0 = Sunday, 1 = Monday, ..., 5 = Friday)
    private readonly REFLECTION_HOUR = 17; // 5 PM
    private readonly REFLECTION_MINUTE_WINDOW = 30; // 30-minute window for execution
    private lastReflectionWeek: string | null = null;

    /**
     * Start the WeeklyReflectionService with the given runtime.
     * @param {IAgentRuntime} runtime - The runtime for the WeeklyReflectionService.
     * @returns {Promise<Service>} A promise that resolves with the WeeklyReflectionService instance.
     */
    static async start(runtime: IAgentRuntime): Promise<Service> {
        const service = new WeeklyReflectionService(runtime);
        await service.registerWeeklyReflectionTask();
        return service;
    }

    /**
     * Register the weekly reflection task worker
     */
    async registerWeeklyReflectionTask() {
        this.runtime.registerTaskWorker({
            name: 'WEEKLY_REFLECTION',
            validate: async (_runtime, _message, _state) => {
                const now = new Date();
                const dayOfWeek = now.getDay();
                const hour = now.getHours();
                const minute = now.getMinutes();
                
                // Get the current week identifier (year-week format)
                const currentWeek = this.getWeekIdentifier(now);

                // Check if it's Friday late afternoon
                const isFridayAfternoon = dayOfWeek === this.REFLECTION_DAY && 
                    hour >= this.REFLECTION_HOUR && 
                    minute <= this.REFLECTION_MINUTE_WINDOW;

                // Check if we haven't already reflected this week
                const hasNotReflectedThisWeek = this.lastReflectionWeek !== currentWeek;

                if (isFridayAfternoon && hasNotReflectedThisWeek) {
                    logger.debug('[Seren] Weekly reflection validation: It is Friday afternoon and reflection not done this week, task should run');
                    return true;
                }

                return false;
            },
            execute: async (runtime, _options) => {
                const currentWeek = this.getWeekIdentifier(new Date());
                await this.executeWeeklyReflection(runtime);
                // Mark this week as completed
                this.lastReflectionWeek = currentWeek;
            },
        });

        // Check if the weekly reflection task exists, if not create it
        const existingTasks = await this.runtime.getTasksByName('WEEKLY_REFLECTION');

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
                logger.warn('[Seren] Using default world for weekly reflection task creation');
                worldId = '00000000-0000-0000-0000-000000000000' as UUID;
            }

            await this.runtime.createTask({
                name: 'WEEKLY_REFLECTION',
                description: 'Weekly strategy reflection analysis every Friday afternoon',
                worldId: worldId,
                metadata: {
                    updatedAt: Date.now(),
                    updateInterval: 1000 * 60 * 60, // Check every hour
                },
                tags: ['queue', 'repeat', 'weekly-reflection'],
            });
            logger.info('[Seren] Created weekly reflection task');
        }
    }

    /**
     * Get week identifier in YYYY-WW format
     */
    private getWeekIdentifier(date: Date): string {
        const year = date.getFullYear();
        const startOfYear = new Date(year, 0, 1);
        const daysSinceStart = Math.floor((date.getTime() - startOfYear.getTime()) / (24 * 60 * 60 * 1000));
        const weekNumber = Math.ceil((daysSinceStart + startOfYear.getDay() + 1) / 7);
        return `${year}-${weekNumber.toString().padStart(2, '0')}`;
    }

    /**
     * Execute the weekly reflection by analyzing strategy effectiveness
     */
    async executeWeeklyReflection(runtime: IAgentRuntime) {
        try {
            logger.info('[Seren] Executing weekly reflection task');

            // Get all active room IDs
            const allRoomIds = await this.getAllActiveRoomIds(runtime);
            logger.info(`[Seren] Found ${allRoomIds.length} active rooms for weekly reflection`);

            let totalReflections = 0;
            let successfulReflections = 0;
            let failedReflections = 0;

            // Process each room individually
            for (const roomId of allRoomIds) {
                try {
                    await this.performRoomReflection(runtime, roomId);
                    successfulReflections++;
                    totalReflections++;

                    // Add a small delay to avoid overwhelming the system
                    await new Promise(resolve => setTimeout(resolve, 200));

                } catch (error) {
                    logger.error(`[Seren] Failed to perform reflection for room ${roomId}:`, error);
                    failedReflections++;
                    totalReflections++;
                }
            }

            logger.info(`[Seren] Weekly reflection completed: ${successfulReflections} successful, ${failedReflections} failed out of ${totalReflections} total`);

            // Store completion status in cache for monitoring
            await runtime.setCache('weekly-reflection-last-run', {
                date: new Date().toISOString(),
                week: this.getWeekIdentifier(new Date()),
                successfulReflections,
                failedReflections,
                totalRooms: allRoomIds.length,
            });

        } catch (error) {
            logger.error('[Seren] Error in weekly reflection task execution:', error);
        }
    }

    /**
     * Perform reflection analysis for a specific room
     */
    async performRoomReflection(runtime: IAgentRuntime, roomId: UUID) {
        try {
            // Get the date range for this week (Monday to Friday)
            const now = new Date();
            const weekStart = this.getWeekStart(now);
            const weekEnd = new Date(now); // Current time (Friday afternoon)

            logger.debug(`[Seren] Analyzing room ${roomId} for week ${weekStart.toISOString()} to ${weekEnd.toISOString()}`);

            // Get messages from this week
            const weeklyMessages = await this.getWeeklyMessages(runtime, roomId, weekStart, weekEnd);
            
            // Get memories added this week (persona and connection insights)
            const weeklyMemories = await this.getWeeklyMemories(runtime, roomId, weekStart, weekEnd);

            // Skip reflection if there's insufficient data
            if (weeklyMessages.length === 0 && weeklyMemories.length === 0) {
                logger.debug(`[Seren] Skipping reflection for room ${roomId} - no activity this week`);
                return;
            }

            // Generate reflection using the analysis prompt
            const reflection = await this.generateStrategyReflection(
                runtime, 
                roomId, 
                weeklyMessages, 
                weeklyMemories
            );

            // Store the reflection as a memory
            await this.storeReflection(runtime, roomId, reflection);

            logger.debug(`[Seren] Completed reflection for room ${roomId}`);

        } catch (error) {
            logger.error(`[Seren] Error performing reflection for room ${roomId}:`, error);
            throw error;
        }
    }

    /**
     * Get the start of the current week (Monday)
     */
    private getWeekStart(date: Date): Date {
        const d = new Date(date);
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
        const monday = new Date(d.setDate(diff));
        monday.setHours(0, 0, 0, 0);
        return monday;
    }

    /**
     * Get messages from the current week for a specific room
     */
    async getWeeklyMessages(runtime: IAgentRuntime, roomId: UUID, weekStart: Date, weekEnd: Date): Promise<Memory[]> {
        try {
            // Get all messages for the room
            const allMessages = await runtime.getMemories({
                tableName: 'messages',
                roomId: roomId,
                count: 1000, // Get a large number to ensure we capture the week
            });

            // Filter messages to only include those from this week
            const weeklyMessages = allMessages.filter(message => {
                const messageDate = new Date(message.createdAt);
                return messageDate >= weekStart && messageDate <= weekEnd;
            });

            logger.debug(`[Seren] Found ${weeklyMessages.length} messages for room ${roomId} this week`);
            return weeklyMessages;

        } catch (error) {
            logger.error(`[Seren] Error getting weekly messages for room ${roomId}:`, error);
            return [];
        }
    }

    /**
     * Get memories (persona and connection insights) from the current week for a specific room
     */
    async getWeeklyMemories(runtime: IAgentRuntime, roomId: UUID, weekStart: Date, weekEnd: Date): Promise<Memory[]> {
        try {
            const weeklyMemories: Memory[] = [];

            // Get persona memories from this week
            const personaMemories = await runtime.getMemories({
                tableName: 'persona_memories',
                roomId: roomId,
                count: 500,
            });

            const weeklyPersonaMemories = personaMemories.filter(memory => {
                const memoryDate = new Date(memory.createdAt);
                return memoryDate >= weekStart && memoryDate <= weekEnd;
            });

            // Get connection memories from this week
            const connectionMemories = await runtime.getMemories({
                tableName: 'connection_memories',
                roomId: roomId,
                count: 500,
            });

            const weeklyConnectionMemories = connectionMemories.filter(memory => {
                const memoryDate = new Date(memory.createdAt);
                return memoryDate >= weekStart && memoryDate <= weekEnd;
            });

            weeklyMemories.push(...weeklyPersonaMemories, ...weeklyConnectionMemories);

            logger.debug(`[Seren] Found ${weeklyMemories.length} memories for room ${roomId} this week (${weeklyPersonaMemories.length} persona, ${weeklyConnectionMemories.length} connection)`);
            return weeklyMemories;

        } catch (error) {
            logger.error(`[Seren] Error getting weekly memories for room ${roomId}:`, error);
            return [];
        }
    }

    /**
     * Generate strategy reflection using AI analysis
     */
    async generateStrategyReflection(
        runtime: IAgentRuntime, 
        roomId: UUID, 
        messages: Memory[], 
        memories: Memory[]
    ): Promise<string> {
        try {
            // Format messages for analysis
            const formattedMessages = messages.map(msg => {
                const sender = msg.entityId === runtime.agentId ? 'Seren' : 'User';
                const timestamp = new Date(msg.createdAt).toISOString();
                return `[${timestamp}] ${sender}: ${msg.content.text || ''}`;
            }).join('\n');

            // Format memories for analysis
            const formattedMemories = memories.map(memory => {
                const timestamp = new Date(memory.createdAt).toISOString();
                const type = memory.tableName === 'persona_memories' ? 'Persona' : 'Connection';
                return `[${timestamp}] ${type} Insight: ${memory.content.text || ''}`;
            }).join('\n');

            // Create state for template composition
            const state = {
                messageCount: messages.length,
                formattedMessages: formattedMessages || 'No messages this week',
                memoryCount: memories.length,
                formattedMemories: formattedMemories || 'No new insights this week',
            };

            // Use the template with state composition
            const reflectionPrompt = composePromptFromState({
                state: { values: state },
                template: weeklyReflectionTemplate,
            });

            const response = await runtime.useModel(ModelType.TEXT_LARGE, {
                prompt: reflectionPrompt,
            });

            return response;

        } catch (error) {
            logger.error(`[Seren] Error generating strategy reflection:`, error);
            return `Error generating reflection: ${error.message}`;
        }
    }

    /**
     * Store the reflection as a memory
     */
    async storeReflection(runtime: IAgentRuntime, roomId: UUID, reflection: string) {
        try {
            const reflectionMemory = {
                id: runtime.createRunId(),
                entityId: runtime.agentId,
                agentId: runtime.agentId,
                content: {
                    text: reflection,
                    type: 'weekly_strategy_reflection',
                    week: this.getWeekIdentifier(new Date()),
                },
                roomId: roomId,
                createdAt: Date.now(),
            };

            // Store in a dedicated table for reflections
            await runtime.createMemory(reflectionMemory, 'reflections', true);

            logger.debug(`[Seren] Stored weekly reflection for room ${roomId}`);

        } catch (error) {
            logger.error(`[Seren] Error storing reflection for room ${roomId}:`, error);
            throw error;
        }
    }

    /**
     * Get all active room IDs from the database
     */
    async getAllActiveRoomIds(runtime: IAgentRuntime): Promise<UUID[]> {
        try {
            const allRoomIds: UUID[] = [];

            // Get all worlds
            const allWorlds = await runtime.getAllWorlds();

            // Collect all room IDs from all worlds
            for (const world of allWorlds) {
                try {
                    const rooms = await runtime.getRoomsByWorld(world.id);

                    // Filter for rooms that have participants
                    for (const room of rooms) {
                        const participants = await runtime.getParticipantsForRoom(room.id);

                        // Only include rooms with participants (excluding just the agent)
                        const nonAgentParticipants = participants.filter(p => p !== runtime.agentId);
                        if (nonAgentParticipants.length > 0) {
                            allRoomIds.push(room.id);
                        }
                    }
                } catch (error) {
                    logger.warn(`[Seren] Error getting rooms for world ${world.id}:`, error);
                }
            }

            return allRoomIds;
        } catch (error) {
            logger.error('[Seren] Error getting active room IDs:', error);
            return [];
        }
    }

    /**
     * Manual trigger for testing weekly reflection (bypasses time validation)
     */
    async triggerTestReflection() {
        logger.info('[Seren] Manually triggering weekly reflection for testing');
        await this.executeWeeklyReflection(this.runtime);
    }

    /**
     * Get the last reflection status from cache
     */
    async getLastReflectionStatus() {
        return await this.runtime.getCache('weekly-reflection-last-run');
    }

    /**
     * Stop the service
     */
    async stop() {
        // No cleanup needed for this service
        logger.debug('[Seren] WeeklyReflectionService stopped');
    }
}