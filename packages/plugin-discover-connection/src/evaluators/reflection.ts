import { logger, parseKeyValueXml } from '@elizaos/core';
import { composePrompt } from '@elizaos/core';
import {
  type Evaluator,
  type IAgentRuntime,
  type Memory,
  ModelType,
  type State,
} from '@elizaos/core';
import { MemgraphService } from '../services/memgraph.js';

/**
 * Template string for generating Discover-Connection's reflection on persona insights and connection preferences.
 */
const reflectionTemplate = `# Task: Generate Discover-Connection Reflection and Extract Persona & Connection Discovery Insights

You are Discover-Connection, an AI agent focused on connection discovery. Your role is to:
1. Reflect on the conversation quality and your performance
2. Extract insights about the user's persona using the PEACOCK framework
3. Extract insights about the type of connections the user wishes to discover

## PEACOCK Framework Dimensions (6 dimensions):
- **demographic**: Static facts (age, gender, location, religion, environment)
- **characteristic**: Intrinsic traits, communication/attachment styles
- **routine**: Regular habits or behaviors
- **goal**: Ambitions or future plans
- **experience**: Past events or experiences
- **emotional_state**: Current feelings, mood, or pain points

## Connection Discovery Dimensions (3 consolidated dimensions):
- **who**: WHO they want to connect with - demographics, interaction style, energy match
  (Examples: "is seeking Berlin-based developers", "is seeking driven collaborative partners", "is seeking patient mentors")
- **what**: WHAT they want to do together - activities and relationship type
  (Examples: "is seeking mentorship in tech", "is seeking collaborative side projects", "is seeking intellectual discussions")
- **how**: HOW the connection works - time commitment and value exchange
  (Examples: "is offering design skills weekly", "is seeking long-term knowledge exchange", "is available for evening meetups")

## CRITICAL: Value Format Requirements for ALL Insights
ALL persona insights and connection insights MUST follow this standardized format:
- **Start with "is"** (e.g., "is interested in...", "is skilled at...", "is seeking...", "is experienced in...", "is located in...")
- **Keep it concise**: 5-10 words maximum
- **Use present tense**
- **Be specific but generalizable**: Multiple users should be able to share the same value if they have similar attributes

### Format Examples (DO THIS):
✅ "is interested in intellectual discussions"
✅ "is experienced in sustainable technology"
✅ "is seeking mentorship in development"
✅ "is based in Berlin"
✅ "is skilled at community building"
✅ "is looking for collaborative projects"
✅ "is available for weekly meetings"

### Anti-Examples (DO NOT DO THIS):
❌ "The user desires companions who are willing and able to discuss complex, socio-economic, or philosophical topics"
❌ "Works on a sustainable tech startup and needs technical help"
❌ "User is working on battery storage optimization"
❌ "Wants to connect with developers who are patient"

**Remember**: Keep values SHORT, start with "is", and make them REUSABLE across users with similar traits.

## Recent Conversation:
{{recentMessages}}

# Known Persona Insights:
{{knownPersonaInsights}}

# Known Connection Discovery Insights:
{{knownConnectionInsights}}

# Instructions:
1. Generate a self-reflective thought on the conversation about your performance and connection discovery quality.
2. Extract NEW persona insights about the user using PEACOCK dimensions that are NOT already captured in the known insights above.
3. Extract NEW insights about the type of connections the user wants to discover that are NOT already captured in the known insights above.

For each insight, provide the description, dimension, and supporting evidence from the conversation. Only include insights that add new information not already present in the known insights.

Do NOT include any thinking, reasoning, or <think> sections in your response. 
Go directly to the XML response format without any preamble or explanation.

Generate a response in the following format:
<response>
  <thought>a self-reflective thought on the conversation and connection-building quality</thought>
  <personaInsight1>specific insight about the user</personaInsight1>
  <personaDimension1>demographic|characteristic|routine|goal|experience|emotional_state</personaDimension1>
  <personaEvidence1>supporting quote or reference from conversation</personaEvidence1>
  <personaInsight2>another specific insight about the user</personaInsight2>
  <personaDimension2>demographic|characteristic|routine|goal|experience|emotional_state</personaDimension2>
  <personaEvidence2>supporting quote or reference from conversation</personaEvidence2>
  <connectionInsight1>insight about the type of connection the user wants to discover</connectionInsight1>
  <connectionDimension1>who|what|how</connectionDimension1>
  <connectionEvidence1>supporting quote or reference from conversation</connectionEvidence1>
  <connectionInsight2>another insight about the type of connection the user wants to discover</connectionInsight2>
  <connectionDimension2>who|what|how</connectionDimension2>
  <connectionEvidence2>supporting quote or reference from conversation</connectionEvidence2>
</response>

IMPORTANT: Your response must ONLY contain the <response></response> XML block above. Do not include any text, thinking, or reasoning before or after this XML block. Start your response immediately with <response> and end with </response>.

Note: Include only the insights you can extract from the conversation. If there are no persona insights, omit those fields. If there are no connection insights, omit those fields. You can include up to 5 persona insights and 5 connection insights by using personaInsight1-5 and connectionInsight1-5 patterns.`;

// SQL storage functions removed - using Memgraph-only storage
async function handler(runtime: IAgentRuntime, message: Memory, state?: State) {
  const { agentId, roomId, entityId } = message;

  if (!agentId || !roomId) {
    logger.warn(`Missing agentId or roomId in message: ${JSON.stringify(message)}`);
    return;
  }

  // Get the user ID - for DM conversations, roomId typically equals userId
  // But we can also use entityId from the message if it's not the agent
  const userId = entityId !== agentId ? entityId : roomId;

  // Get recent messages for context
  const recentMessages = await runtime.getMemories({
    tableName: 'messages',
    roomId,
    count: 10,
    unique: false,
  });

  // Get existing persona and connection memories from Memgraph to prevent duplicates
  const memgraphService = runtime.getService('memgraph') as MemgraphService;
  if (!memgraphService) {
    logger.error(
      '[discover-connection-reflection] Memgraph service not available - cannot fetch existing insights'
    );
    return;
  }

  let existingPersonaInsights: Array<{ value: string; dimension: string; similarity: number }> = [];
  let existingConnectionInsights: Array<{ value: string; dimension: string; similarity: number }> =
    [];

  try {
    // Create a generic embedding for fetching all dimensions (using zero vector)
    const dummyEmbedding = new Array(768).fill(0);

    // Get all persona dimensions for this user from Memgraph
    existingPersonaInsights = await memgraphService.vectorSearchPersonaDimensions(
      dummyEmbedding,
      userId,
      100 // Get up to 100 results
    );

    // Get all desired dimensions for this user from Memgraph
    existingConnectionInsights = await memgraphService.vectorSearchDesiredDimensions(
      dummyEmbedding,
      userId,
      100 // Get up to 100 results
    );

    logger.debug(
      `[discover-connection-reflection] Fetched ${existingPersonaInsights.length} persona and ${existingConnectionInsights.length} connection insights from Memgraph`
    );
  } catch (error) {
    logger.warn(
      `[discover-connection-reflection] Failed to fetch existing insights from Memgraph: ${error}`
    );
    // Continue with empty arrays
  }

  const prompt = composePrompt({
    state: {
      ...(state?.values || {}),
      recentMessages: formatMessages(recentMessages),
      knownPersonaInsights: formatPersonaInsights(existingPersonaInsights),
      knownConnectionInsights: formatConnectionInsights(existingConnectionInsights),
    },
    template: runtime.character.templates?.reflectionTemplate || reflectionTemplate,
  });

  try {
    const response = await runtime.useModel(ModelType.TEXT_SMALL, {
      prompt,
    });

    if (!response) {
      logger.warn('Discover-Connection reflection failed - empty response');
      return;
    }

    //logger.debug('Raw reflection response:', response);

    // Parse XML response
    const reflection = parseKeyValueXml(response);

    if (!reflection) {
      logger.warn(`Discover-Connection reflection failed - failed to parse XML: ${response}`);
      return;
    }

    //logger.debug('Parsed reflection:', reflection);

    // Extract persona insights (up to 5)
    const personaInsights: Array<{ description: string; dimension: string; evidence: string }> = [];
    for (let i = 1; i <= 5; i++) {
      const insight = reflection[`personaInsight${i}`];
      const dimension = reflection[`personaDimension${i}`];
      const evidence = reflection[`personaEvidence${i}`];

      if (insight && dimension && evidence) {
        // Use vector similarity search to check for duplicates
        let isDuplicate = false;

        try {
          // Generate embedding for the new insight
          const memoryForEmbedding = await runtime.addEmbeddingToMemory({
            entityId: userId,
            agentId,
            content: { text: insight },
            roomId,
            createdAt: Date.now(),
          });

          const embedding = memoryForEmbedding.embedding
            ? Array.from(memoryForEmbedding.embedding)
            : [];

          if (embedding.length > 0) {
            // Search for similar insights in the same dimension
            const similarInsights = await memgraphService.vectorSearchPersonaDimensions(
              embedding,
              userId,
              1, // Only need top result
              [dimension as any] // Search only in this specific dimension
            );

            // If we find a very similar insight (> 0.9 similarity), consider it a duplicate
            if (similarInsights.length > 0 && similarInsights[0].similarity > 0.9) {
              isDuplicate = true;
              logger.debug(
                `[discover-connection-reflection] Skipping duplicate persona insight (similarity: ${similarInsights[0].similarity.toFixed(3)}): ${insight}`
              );
            }
          }
        } catch (error) {
          logger.warn(
            `[discover-connection-reflection] Error checking persona duplicate via vector search: ${error}`
          );
          // Continue without duplicate check if vector search fails
        }

        if (!isDuplicate) {
          personaInsights.push({ description: insight, dimension, evidence });
        }
      }
    }

    // Extract connection insights (up to 5)
    const connectionInsights: Array<{ description: string; dimension: string; evidence: string }> =
      [];
    for (let i = 1; i <= 5; i++) {
      const insight = reflection[`connectionInsight${i}`];
      const dimension = reflection[`connectionDimension${i}`];
      const evidence = reflection[`connectionEvidence${i}`];

      if (insight && dimension && evidence) {
        // Use vector similarity search to check for duplicates
        let isDuplicate = false;

        try {
          // Generate embedding for the new insight
          const memoryForEmbedding = await runtime.addEmbeddingToMemory({
            entityId: userId,
            agentId,
            content: { text: insight },
            roomId,
            createdAt: Date.now(),
          });

          const embedding = memoryForEmbedding.embedding
            ? Array.from(memoryForEmbedding.embedding)
            : [];

          if (embedding.length > 0) {
            // Search for similar insights in the same dimension
            const similarInsights = await memgraphService.vectorSearchDesiredDimensions(
              embedding,
              userId,
              1, // Only need top result
              [dimension as any] // Search only in this specific dimension
            );

            // If we find a very similar insight (> 0.9 similarity), consider it a duplicate
            if (similarInsights.length > 0 && similarInsights[0].similarity > 0.9) {
              isDuplicate = true;
              logger.debug(
                `[discover-connection-reflection] Skipping duplicate connection insight (similarity: ${similarInsights[0].similarity.toFixed(3)}): ${insight}`
              );
            }
          }
        } catch (error) {
          logger.warn(
            `[discover-connection-reflection] Error checking connection duplicate via vector search: ${error}`
          );
          // Continue without duplicate check if vector search fails
        }

        if (!isDuplicate) {
          connectionInsights.push({ description: insight, dimension, evidence });
        }
      }
    }

    // Store persona and connection insights to Memgraph ONLY (no SQL storage)
    // memgraphService is already obtained at the beginning of the function

    try {
      // Store persona insights as PersonaDimension nodes
      await Promise.all(
        personaInsights.map(async (insight) => {
          try {
            // Generate embeddings for the insight
            const memoryForEmbedding = await runtime.addEmbeddingToMemory({
              entityId: userId,
              agentId,
              content: { text: insight.description },
              roomId,
              createdAt: Date.now(),
            });

            const embeddings = memoryForEmbedding.embedding
              ? Array.from(memoryForEmbedding.embedding)
              : [];

            await memgraphService.syncPersonaDimension(
              userId,
              insight.dimension as any, // Cast to the specific type
              insight.description,
              embeddings,
              {
                extractedFrom: 'reflection',
                evidence: insight.evidence,
                sourceMessageId: message.id,
                extractionModel: 'discover_connection_reflection',
              }
            );
          } catch (error) {
            logger.error(`Error syncing persona insight to Memgraph: ${error}`);
          }
        })
      );

      // Store connection insights as DesiredDimension nodes
      await Promise.all(
        connectionInsights.map(async (insight) => {
          try {
            // Generate embeddings for the insight
            const memoryForEmbedding = await runtime.addEmbeddingToMemory({
              entityId: userId,
              agentId,
              content: { text: insight.description },
              roomId,
              createdAt: Date.now(),
            });

            const embeddings = memoryForEmbedding.embedding
              ? Array.from(memoryForEmbedding.embedding)
              : [];

            // Connection dimension is already in the correct format (who/what/how)
            const mappedDimension = insight.dimension;

            await memgraphService.syncDesiredDimension(
              userId,
              mappedDimension as any, // Cast to the specific type
              insight.description,
              embeddings,
              {
                extractedFrom: 'reflection',
                evidence: insight.evidence,
                sourceMessageId: message.id,
                extractionModel: 'discover_connection_reflection',
              }
            );
          } catch (error) {
            logger.error(`Error syncing connection insight to Memgraph: ${error}`);
          }
        })
      );

      logger.debug(
        `[discover-connection-reflection] Synced ${personaInsights.length} persona and ${connectionInsights.length} connection insights to Memgraph for user ${userId}`
      );
    } catch (memgraphError) {
      logger.error(
        `[discover-connection-reflection] Failed to sync insights to Memgraph: ${memgraphError}`
      );
      // Throw error since Memgraph is required
      throw memgraphError;
    }

    // Store reflection thought (this can stay with agentId since it's the agent's reflection)
    if (reflection.thought) {
      try {
        const thoughtMemory = await runtime.addEmbeddingToMemory({
          entityId: agentId, // Agent's reflection about their own performance
          agentId,
          content: { text: reflection.thought },
          roomId,
          createdAt: Date.now(),
        });
        await runtime.createMemory(thoughtMemory, 'reflections', true);
      } catch (error) {
        logger.error(`Error storing reflection thought: ${error}`);
      }
    }

    await runtime.setCache<string>(
      `${message.roomId}-discover-connection-reflection-last-processed`,
      message?.id || ''
    );

    logger.info(
      `Discover-Connection reflection processed: ${personaInsights.length} persona insights, ${connectionInsights.length} connection discovery insights`
    );
  } catch (error) {
    logger.error(`Error in Discover-Connection reflection handler: ${error}`);
    return;
  }
}

export const reflectionEvaluator: Evaluator = {
  name: 'DISCOVER-CONNECTION_REFLECTION',
  similes: [
    'DISCOVER-CONNECTION_REFLECT',
    'PERSONA_EXTRACT',
    'CONNECTION_DISCOVER',
    'INSIGHT_GATHER',
  ],
  validate: async (runtime: IAgentRuntime, message: Memory): Promise<boolean> => {
    try {
      const lastMessageId = await runtime.getCache<string>(
        `${message.roomId}-discover-connection-reflection-last-processed`
      );
      const messages = await runtime.getMemories({
        tableName: 'messages',
        roomId: message.roomId,
        count: 20, // Use fixed count instead of getConversationLength()
      });

      if (lastMessageId) {
        const lastMessageIndex = messages.findIndex((msg) => msg.id === lastMessageId);
        if (lastMessageIndex !== -1) {
          messages.splice(0, lastMessageIndex + 1);
        }
      }

      // Trigger reflection every 4-5 messages to ensure we capture insights early
      const reflectionInterval = 4;
      const shouldReflect = messages.length >= reflectionInterval;

      logger.debug(
        `[discover-connection] Reflection validation: ${messages.length} messages since last reflection, should reflect: ${shouldReflect}`
      );
      return shouldReflect;
    } catch (error) {
      logger.error(`[discover-connection] Error in reflection validation: ${error}`);
      return false;
    }
  },
  description:
    'Generate Discover-Connection reflection on 1-on-1 conversation quality and extract persona insights using PEACOCK framework and connection discovery preferences.',
  handler,
  examples: [
    {
      prompt: `Recent conversation between Discover-Connection and user about their work and connection needs:`,
      messages: [
        {
          name: 'User',
          content: {
            text: "I'm working on a sustainable tech startup but I'm struggling with the technical aspects. I need someone who really understands clean energy.",
          },
        },
        {
          name: 'Discover-Connection',
          content: {
            text: 'That sounds like an exciting venture! What specific technical challenges are you facing? And what kind of expertise would be most helpful?',
          },
        },
        {
          name: 'User',
          content: {
            text: "Mainly battery storage optimization. I'd love to connect with someone who has experience in energy storage systems, maybe someone who's been through the startup journey before.",
          },
        },
        {
          name: 'Discover-Connection',
          content: {
            text: 'A mentor with both technical expertise and startup experience would be invaluable. What would you hope to offer in return to someone like that?',
          },
        },
      ],
      outcome: `<response>
    <thought>I'm effectively identifying the user's specific technical needs and connection preferences. They're being clear about wanting both technical expertise and startup experience, which gives me good direction for potential matches. I should continue exploring what they can offer in return.</thought>
    <personaInsight1>is building sustainable tech startup</personaInsight1>
    <personaDimension1>goal</personaDimension1>
    <personaEvidence1>"I'm working on a sustainable tech startup"</personaEvidence1>
    <personaInsight2>is experienced in clean energy systems</personaInsight2>
    <personaDimension2>experience</personaDimension2>
    <personaEvidence2>"I'm working on a sustainable tech startup but I'm struggling with the technical aspects"</personaEvidence2>
    <connectionInsight1>is seeking energy storage expert with startup experience</connectionInsight1>
    <connectionDimension1>who</connectionDimension1>
    <connectionEvidence1>"I'd love to connect with someone who has experience in energy storage systems, maybe someone who's been through the startup journey before"</connectionEvidence1>
    <connectionInsight2>is seeking mentorship in tech</connectionInsight2>
    <connectionDimension2>what</connectionDimension2>
    <connectionEvidence2>"I need someone who really understands clean energy" and "someone who's been through the startup journey"</connectionEvidence2>
</response>`,
    },
    {
      prompt: `Recent conversation between Discover-Connection and user about their creative pursuits and collaboration needs:`,
      messages: [
        {
          name: 'User',
          content: {
            text: "I'm a freelance graphic designer but I want to get into UX design. I feel like I need to collaborate with developers to really understand the technical side.",
          },
        },
        {
          name: 'Discover-Connection',
          content: {
            text: "That's a natural progression! What aspects of UX design are you most excited about? And what kind of collaboration are you envisioning?",
          },
        },
        {
          name: 'User',
          content: {
            text: "I love the problem-solving aspect and user research. I'd love to work on a side project with a developer who's patient and willing to teach. Maybe someone who also wants to learn more about design.",
          },
        },
        {
          name: 'Discover-Connection',
          content: {
            text: 'A mutual learning partnership sounds perfect. What design skills could you share in return?',
          },
        },
      ],
      outcome: `<response>
    <thought>The user is clearly articulating their career transition goals and the type of collaborative relationship they want. They're looking for mutual learning, which is great for finding compatible connections. I'm getting good insights about both their skills and what they want to learn.</thought>
    <personaInsight1>is transitioning from graphic design to UX</personaInsight1>
    <personaDimension1>goal</personaDimension1>
    <personaEvidence1>"I'm a freelance graphic designer but I want to get into UX design"</personaEvidence1>
    <personaInsight2>is interested in problem-solving and user research</personaInsight2>
    <personaDimension2>characteristic</personaDimension2>
    <personaEvidence2>"I love the problem-solving aspect and user research"</personaEvidence2>
    <connectionInsight1>is seeking patient developer willing to teach</connectionInsight1>
    <connectionDimension1>who</connectionDimension1>
    <connectionEvidence1>"I need to collaborate with developers" and "a developer who's patient and willing to teach"</connectionEvidence1>
    <connectionInsight2>is seeking side project collaboration</connectionInsight2>
    <connectionDimension2>what</connectionDimension2>
    <connectionEvidence2>"I'd love to work on a side project with a developer"</connectionEvidence2>
    <connectionInsight3>is offering design skills for mutual learning</connectionInsight3>
    <connectionDimension3>how</connectionDimension3>
    <connectionEvidence3>"someone who also wants to learn more about design"</connectionEvidence3>
</response>`,
    },
  ],
};

// Helper function to format messages for context
function formatMessages(messages: Memory[]) {
  return messages
    .reverse()
    .map((msg: Memory) => {
      const sender = msg.entityId === msg.agentId ? 'Discover-Connection' : 'User';
      return `${sender}: ${msg.content.text}`;
    })
    .join('\n');
}

// Helper function to format persona memories for context
function formatPersonaInsights(
  insights: Array<{ value: string; dimension: string; similarity: number }>
) {
  if (insights.length === 0) {
    return 'No persona insights recorded yet.';
  }
  return insights.map((insight) => insight.value).join('\n');
}

// Helper function to format connection insights for context
function formatConnectionInsights(
  insights: Array<{ value: string; dimension: string; similarity: number }>
) {
  if (insights.length === 0) {
    return 'No connection insights recorded yet.';
  }
  return insights.map((insight) => insight.value).join('\n');
}
