import {
    logger,
    Service,
    type IAgentRuntime,
    type UUID,
    type Content,
} from '@elizaos/core';

/**
 * DailyCheckinService class for sending daily check-in messages to all users
 */
export class DailyCheckinService extends Service {
    static serviceType = 'daily-checkin' as const;
    capabilityDescription = 'Sends daily check-in messages to all users at noon';

    private readonly CHECKIN_HOUR = 12; // 12 PM (noon)
    private readonly CHECKIN_MINUTE_WINDOW = 5; // 5-minute window for execution
    private lastCheckinDate: string | null = null;

    /**
     * Start the DailyCheckinService with the given runtime.
     * @param {IAgentRuntime} runtime - The runtime for the DailyCheckinService.
     * @returns {Promise<Service>} A promise that resolves with the DailyCheckinService instance.
     */
    static async start(runtime: IAgentRuntime): Promise<Service> {
        const service = new DailyCheckinService(runtime);
        await service.registerDailyCheckinTask();
        return service;
    }

    /**
     * Register the daily check-in task worker
     */
    async registerDailyCheckinTask() {
        this.runtime.registerTaskWorker({
            name: 'DAILY_CHECKIN',
            validate: async (_runtime, _message, _state) => {
                const now = new Date();
                const hour = now.getHours();
                const minute = now.getMinutes();
                const today = now.toISOString().split('T')[0]; // YYYY-MM-DD format

                // Check if it's the right time (noon with a window)
                const isNoonTime = hour === this.CHECKIN_HOUR && minute >= 0 && minute <= this.CHECKIN_MINUTE_WINDOW;

                // Check if we haven't already sent today's check-in
                const hasNotSentToday = this.lastCheckinDate !== today;

                if (isNoonTime && hasNotSentToday) {
                    logger.debug('[Seren] Daily check-in validation: It is noon time and check-in not sent today, task should run');
                    return true;
                }

                return false;
            },
            execute: async (runtime, _options) => {
                const today = new Date().toISOString().split('T')[0];
                await this.executeDailyCheckin(runtime);
                // Mark today as completed
                this.lastCheckinDate = today;
            },
        });

        // Check if the daily check-in task exists, if not create it
        const existingTasks = await this.runtime.getTasksByName('DAILY_CHECKIN');

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
                logger.warn('[Seren] Using default world for daily checkin task creation');
                worldId = '00000000-0000-0000-0000-000000000000' as UUID;
            }

            await this.runtime.createTask({
                name: 'DAILY_CHECKIN',
                description: 'Daily check-in message sent to all users at noon',
                worldId: worldId,
                metadata: {
                    updatedAt: Date.now(),
                    updateInterval: 1000 * 60 * 60, // Check every hour
                },
                tags: ['queue', 'repeat', 'daily-checkin'],
            });
            logger.info('[Seren] Created daily check-in task');
        }
    }

    /**
     * Execute the daily check-in by sending messages to all users
     */
    async executeDailyCheckin(runtime: IAgentRuntime) {
        try {
            logger.info('[Seren] Executing daily check-in task');

            // Get all rooms that have participants
            const allRoomIds = await this.getAllActiveRoomIds(runtime);

            logger.info(`[Seren] Found ${allRoomIds.length} active rooms for daily check-in`);

            // Daily check-in message content with variations
            const checkInMessages = [
                "How connected do you feel in your relationship today? Rate it 1-5 and tell me what's on your heart.",
                "Quick check-in: How's your relationship feeling today? 1-5?",
                "On a scale of 1-5, how close do you feel to your person right now?",
                "How's your connection energy today? Give me a number 1-5 and share what's stirring.",
                "Rate your relationship satisfaction today, 1-5. What's behind that number?",
                "How connected are you feeling to your person today? 1-5 and tell me more.",
                "Quick pulse check: How's your heart feeling about your relationship today? 1-5?",
                "On a 1-5 scale, how's your connection feeling right now?",
                "How's your relationship today? Rate it 1-5 and share what's alive for you.",
                "Connection check: How are you feeling about your relationship today? 1-5?"
            ];

            // Select a random message for variety
            const randomMessage = checkInMessages[Math.floor(Math.random() * checkInMessages.length)];

            const checkInContent: Content = {
                text: randomMessage,
                actions: ['NONE'],
                simple: true,
            };

            // Send check-in message to each room
            let successCount = 0;
            let errorCount = 0;

            for (const roomId of allRoomIds) {
                try {
                    await this.sendDailyCheckinToRoom(runtime, roomId, checkInContent);
                    successCount++;

                    // Add a small delay to avoid overwhelming the system
                    await new Promise(resolve => setTimeout(resolve, 100));

                } catch (error) {
                    logger.error(`[Seren] Failed to send daily check-in to room ${roomId}:`, error);
                    errorCount++;
                }
            }

            logger.info(`[Seren] Daily check-in completed: ${successCount} successful, ${errorCount} failed`);

            // Store completion status in cache for monitoring
            await runtime.setCache('daily-checkin-last-run', {
                date: new Date().toISOString(),
                successCount,
                errorCount,
                totalRooms: allRoomIds.length,
            });

        } catch (error) {
            logger.error('[Seren] Error in daily check-in task execution:', error);
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
     * Send daily check-in message to a specific room
     */
    async sendDailyCheckinToRoom(runtime: IAgentRuntime, roomId: UUID, content: Content) {
        try {
            // Create a memory for the check-in message
            const checkInMemory = {
                id: runtime.createRunId(), // Generate unique ID
                entityId: runtime.agentId,
                agentId: runtime.agentId,
                content: content,
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
                    }, content);

                    logger.debug(`[Seren] Daily check-in sent successfully to room: ${roomId} (${room.source})`);
                } catch (sendError) {
                    // If direct sending fails, try emitting an event
                    logger.debug(`[Seren] Direct send failed for room ${roomId}, trying event emission:`, sendError);

                    try {
                        // Emit a message event that the message handlers can pick up
                        await runtime.emitEvent('new_message', {
                            runtime,
                            message: checkInMemory,
                            roomId: roomId,
                            source: 'daily-checkin',
                        });

                        logger.debug(`[Seren] Daily check-in event emitted for room: ${roomId}`);
                    } catch (eventError) {
                        logger.warn(`[Seren] Event emission also failed for room ${roomId}:`, eventError);
                    }
                }
            } else {
                logger.warn(`[Seren] Room ${roomId} not found or has no source`);
            }

        } catch (error) {
            logger.error(`[Seren] Error sending daily check-in to room ${roomId}:`, error);
            throw error;
        }
    }

    /**
     * Manual trigger for testing daily check-in (bypasses time validation)
     */
    async triggerTestCheckin() {
        logger.info('[Seren] Manually triggering daily check-in for testing');
        await this.executeDailyCheckin(this.runtime);
    }

    /**
     * Get the last check-in status from cache
     */
    async getLastCheckinStatus() {
        return await this.runtime.getCache('daily-checkin-last-run');
    }

    /**
     * Stop the service
     */
    async stop() {
        // No cleanup needed for this service
        logger.debug('[Seren] DailyCheckinService stopped');
    }
}