# Seren Services

This directory contains the background services for the Seren plugin.

## Services

### DailyCheckinService
- **Purpose**: Sends daily check-in messages to all users at noon
- **Schedule**: Every day at 12:00 PM (with 5-minute window)
- **Functionality**: Asks users to rate their relationship connection on a 1-5 scale

### WeeklyReflectionService
- **Purpose**: Analyzes agent's strategy effectiveness weekly
- **Schedule**: Every Friday at 5:00 PM (with 30-minute window)
- **Functionality**: 
  - Reviews the week's conversations and extracted insights
  - Analyzes how well the agent is bringing people closer together
  - Generates strategic reflections for improvement
  - Stores reflections in the 'reflections' memory table

### TaskService
- **Purpose**: Manages and executes scheduled tasks
- **Functionality**: Handles the execution of recurring tasks like daily check-ins and weekly reflections

## Testing

### Manual Testing of Weekly Reflection

You can manually trigger a weekly reflection for testing purposes:

```typescript
// Get the service instance
const weeklyReflectionService = runtime.getService('weekly-reflection');

// Trigger test reflection (bypasses time validation)
await weeklyReflectionService.triggerTestReflection();

// Check last reflection status
const status = await weeklyReflectionService.getLastReflectionStatus();
console.log('Last reflection status:', status);
```

### Manual Testing of Daily Check-in

```typescript
// Get the service instance
const dailyCheckinService = runtime.getService('daily-checkin');

// Trigger test check-in (bypasses time validation)
await dailyCheckinService.triggerTestCheckin();

// Check last check-in status
const status = await dailyCheckinService.getLastCheckinStatus();
console.log('Last check-in status:', status);
```

## Memory Tables Used

- **messages**: Stores conversation messages
- **persona_memories**: Stores persona insights extracted from conversations
- **connection_memories**: Stores connection insights extracted from conversations
- **reflections**: Stores weekly strategy reflections (created by WeeklyReflectionService)

## Configuration

Both services use the task system and will automatically create their required tasks on startup. The tasks are configured with:

- **Daily Check-in**: Runs every hour, validates for noon timing
- **Weekly Reflection**: Runs every hour, validates for Friday 5 PM timing

## Monitoring

Both services store their execution status in the runtime cache:

- `daily-checkin-last-run`: Contains last daily check-in execution details
- `weekly-reflection-last-run`: Contains last weekly reflection execution details