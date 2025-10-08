import {
  type IAgentRuntime,
  type Memory,
  type Action,
  type State,
  type ActionExample,
  type HandlerCallback,
  type ActionResult,
  ModelType,
  parseKeyValueXml,
  logger,
} from '@elizaos/core';
import { MemgraphService } from '../services/memgraph.js';
import { connectionExtractionTemplate, secretVerificationTemplate } from '../utils/promptTemplates.js';
import { sendConnectionActivatedNotification } from '../utils/adminNotifications.js';

/**
 * Action to join an existing HumanConnection - extracts data from conversation and authenticates
 */
export const joinConnectionAction: Action = {
  name: 'JOIN_CONNECTION',
  description: 'Joins a connection created by partner: When you have userName + partnerName + secret for existing connection, call this action',
  similes: ['AUTHENTICATE_CONNECTION', 'VERIFY_CONNECTION', 'LINK_CONNECTION'],
  examples: [] as ActionExample[][],
  validate: async (_runtime: IAgentRuntime, _message: Memory, _state?: State) => {
    // Simple validation - let the action handler do the heavy lifting
    // Action will be called when conversation flow reaches this point
    return true;
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options: any,
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    const memgraphService = new MemgraphService();

    try {
      await memgraphService.connect();

      const userId = message.entityId;

      // Get recent messages for extraction
      const recentMessages = await runtime.getMemories({
        roomId: message.roomId,
        tableName: 'messages',
        count: 15,
        unique: false,
      });

      // Format messages for extraction
      const formattedMessages = recentMessages
        .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
        .map((msg: any) => {
          const role = msg.entityId === userId ? 'User' : 'Seren';
          return `${role}: ${msg.content?.text || ''}`;
        })
        .join('\n');

      // Extract connection information from conversation
      const extractionPrompt = connectionExtractionTemplate.replace(
        '{{recentMessages}}',
        formattedMessages
      );

      const extractionResponse = await runtime.useModel(ModelType.TEXT_SMALL, {
        prompt: extractionPrompt,
        temperature: 0.1,
      });

      const extracted = parseKeyValueXml(extractionResponse);

      if (!extracted) {
        logger.error('[joinConnection] Failed to parse extraction response');
        const fallbackText =
          "I'm having trouble understanding the information. Let's start fresh - what's your first name?";

        if (callback) {
          await callback({
            text: fallbackText,
            thought: 'Failed to extract information',
            actions: ['NONE'],
          });
        }

        return {
          text: fallbackText,
          success: false,
          error: new Error('Failed to parse extraction'),
        };
      }

      const userName = extracted.userName?.trim().toLowerCase() || '';
      const partnerName = extracted.partnerName?.trim().toLowerCase() || '';
      const secret = extracted.secret?.trim() || '';

      logger.debug(
        `[joinConnection] Extracted - userName: "${userName}", partnerName: "${partnerName}", secret: "${!!secret}"`
      );

      // Validate we have all required information
      if (!userName || !partnerName || !secret) {
        const missing = extracted.missing || 'some information';
        const errorText = `I still need ${missing} to verify your connection. Can you provide that?`;

        logger.info(`[joinConnection] Missing data: ${missing}`);

        if (callback) {
          await callback({
            text: errorText,
            thought: `Missing: ${missing}`,
            actions: ['NONE'],
          });
        }

        return {
          text: errorText,
          success: false,
          error: new Error(`Missing required information: ${missing}`),
        };
      }

      // Search for connections by partner names
      let candidates = await memgraphService.findConnectionsByPartnerNames(userName, partnerName);

      logger.debug(
        `[joinConnection] Searching for connections with userName="${userName}" partnerName="${partnerName}"`
      );
      logger.debug(`[joinConnection] Found ${candidates?.length ?? 0} candidates by names`);

      // If no exact match, try broader search
      if (!candidates || candidates.length === 0) {
        logger.info('[joinConnection] No exact match, trying broader search');
        candidates = await memgraphService.searchHumanConnectionsByName(userName);
        logger.debug(`[joinConnection] Broader search found ${candidates.length} candidates`);
      }

      // Check if we have any candidates
      if (!candidates || candidates.length === 0) {
        const errorText = `I couldn't find a connection matching those names. Please double-check with ${partnerName} that they created the connection with these exact names.`;

        if (callback) {
          await callback({
            text: errorText,
            thought: 'No matching connections found',
            actions: ['NONE'],
          });
        }

        return {
          text: errorText,
          success: false,
          error: new Error('No matching connection candidates'),
        };
      }

      // Find matching connection by secret (case-insensitive)
      const normalizeSecret = (s: string) => s.trim().toLowerCase();
      const userSecretNorm = normalizeSecret(secret);

      let matchingConnection = candidates.find((c) => normalizeSecret(c.secret) === userSecretNorm);

      // If no exact secret match, try fuzzy matching
      if (!matchingConnection && candidates.length > 0) {
        for (const candidate of candidates) {
          const candidateSecret = normalizeSecret(candidate.secret);
          if (
            candidateSecret.includes(userSecretNorm) ||
            userSecretNorm.includes(candidateSecret)
          ) {
            matchingConnection = candidate;
            logger.info('[joinConnection] Found fuzzy match for secret');
            break;
          }
        }
      }

      // If still no match, try LLM-based semantic matching for phrase secrets
      if (!matchingConnection && candidates.length > 0) {
        logger.info('[joinConnection] Attempting LLM semantic secret matching');

        // Format candidate secrets for the template
        const candidateSecretsFormatted = candidates
          .map((c, idx) => `${idx + 1}. "${c.secret}"`)
          .join('\n');

        const verificationPrompt = secretVerificationTemplate
          .replace('{{userSecret}}', secret)
          .replace('{{candidateSecrets}}', candidateSecretsFormatted);

        try {
          const verificationResponse = await runtime.useModel(ModelType.TEXT_SMALL, {
            prompt: verificationPrompt,
            temperature: 0.1,
          });

          const verificationResult = parseKeyValueXml(verificationResponse);

          if (verificationResult) {
            const matchedCandidateNum = verificationResult.matchedCandidate?.trim();
            const confidence = verificationResult.confidence?.trim().toLowerCase();

            logger.debug(
              `[joinConnection] LLM verification result: candidate=${matchedCandidateNum}, confidence=${confidence}`
            );

            // Only accept high or medium confidence matches
            if (
              matchedCandidateNum &&
              matchedCandidateNum !== 'no_match' &&
              (confidence === 'high' || confidence === 'medium')
            ) {
              const candidateIndex = parseInt(matchedCandidateNum, 10) - 1;
              if (candidateIndex >= 0 && candidateIndex < candidates.length) {
                matchingConnection = candidates[candidateIndex];
                logger.info(
                  `[joinConnection] Found semantic match (confidence: ${confidence}): ${verificationResult.reasoning}`
                );
              }
            }
          }
        } catch (semanticError) {
          logger.warn(
            `[joinConnection] LLM semantic matching failed: ${semanticError instanceof Error ? semanticError.message : String(semanticError)}`
          );
          // Continue to standard error handling below
        }
      }

      if (!matchingConnection) {
        const errorText = `The secret doesn't match any connection for ${userName} and ${partnerName}. Please check with ${partnerName} and try again.`;

        if (callback) {
          await callback({
            text: errorText,
            thought: 'Secret did not match',
            actions: ['NONE'],
          });
        }

        return {
          text: errorText,
          success: false,
          error: new Error('Secret verification failed'),
        };
      }

      logger.info(`[joinConnection] Matched HumanConnection: ${JSON.stringify(matchingConnection)}`);

      // Ensure Person node exists
      await memgraphService.ensurePerson(userId, message.roomId, userName);

      // Link Person to HumanConnection
      const linkSuccess = await memgraphService.linkPersonToHumanConnection(
        userId,
        matchingConnection
      );

      if (!linkSuccess) {
        const errorText = 'Failed to link your profile to the connection. Please try again.';
        logger.error('[joinConnection] Failed to create connection link');

        if (callback) {
          await callback({
            text: errorText,
            thought: 'Link creation failed',
            actions: ['NONE'],
          });
        }

        return {
          text: errorText,
          success: false,
          error: new Error('Failed to create connection link'),
        };
      }

      // Deduplicate any stale Person nodes
      try {
        await memgraphService.deduplicatePersonsByUserId(userId);
      } catch (dedupError) {
        logger.warn(
          `[joinConnection] Deduplication warning: ${dedupError instanceof Error ? dedupError.message : String(dedupError)}`
        );
      }

      logger.info(`[joinConnection] Successfully authenticated and linked user ${userId}`);

      // Check if this completes the connection (2 participants) and activate if needed
      if (matchingConnection.status === 'waitlist') {
        try {
          const participantCount = await memgraphService.countConnectionParticipants(
            matchingConnection
          );

          if (participantCount === 2) {
            const activated = await memgraphService.updateHumanConnectionStatus(
              matchingConnection.partners,
              matchingConnection.secret,
              'active'
            );

            if (activated) {
              logger.info(`[joinConnection] Activated HumanConnection - both partners now connected`);
              matchingConnection.status = 'active'; // Update local object for response

              // Send admin notification for connection activation (non-blocking)
              sendConnectionActivatedNotification(memgraphService, matchingConnection, userId).catch(
                (error) =>
                  logger.error(
                    `[joinConnection] Connection activation notification failed: ${error instanceof Error ? error.message : String(error)}`
                  )
              );

              // Trigger immediate daily planning for the newly activated connection
              try {
                logger.info(`[joinConnection] Triggering immediate daily planning for newly activated connection`);

                // Get DailyPlanningService
                const dailyPlanningService = runtime.getService('daily-planning');

                if (dailyPlanningService) {
                  // Get full connection data with participants
                  const activeConnections = await memgraphService.getActiveHumanConnections();
                  const thisConnection = activeConnections.find(
                    (conn) => conn.connection.connectionId === matchingConnection.connectionId
                  );

                  if (thisConnection && thisConnection.participants.length === 2) {
                    // Execute immediate planning for this connection
                    await (dailyPlanningService as any).executeSingleConnectionPlanning(
                      runtime,
                      thisConnection
                    );
                    logger.info(`[joinConnection] Successfully triggered immediate daily planning`);
                  } else {
                    logger.warn(`[joinConnection] Could not find complete connection data for immediate planning`);
                  }
                } else {
                  logger.warn(`[joinConnection] DailyPlanningService not found, skipping immediate planning`);
                }
              } catch (planningError) {
                logger.error(
                  `[joinConnection] Error triggering immediate daily planning: ${planningError instanceof Error ? planningError.message : String(planningError)}`
                );
                // Don't block the join flow if planning fails
              }
            } else {
              logger.warn(
                `[joinConnection] Failed to activate HumanConnection despite 2 participants`
              );
            }
          }
        } catch (activationError) {
          logger.error(
            `[joinConnection] Error during activation check: ${activationError instanceof Error ? activationError.message : String(activationError)}`
          );
          // Continue processing - activation failure shouldn't block the join
        }
      }

      // Success response
      const successText = `Welcome! You've successfully joined the connection with ${partnerName}.

I'm here to help you both deepen your relationship through daily reflections and meaningful conversations. Looking forward to supporting your journey together!`;

      if (callback) {
        await callback({
          text: successText,
          thought: 'Authentication successful',
          actions: ['NONE'],
        });
      }

      return {
        text: successText,
        success: true,
        values: {
          authenticated: true,
          userName,
          partnerName,
          connectionId: matchingConnection.connectionId,
          status: matchingConnection.status || 'active',
        },
        data: { connection: matchingConnection },
      };
    } catch (error) {
      logger.error(
        `[joinConnection] Error: ${error instanceof Error ? error.message : String(error)}`
      );

      const errorText = 'I encountered an error joining the connection. Please try again.';

      if (callback) {
        await callback({
          text: errorText,
          thought: 'System error occurred',
          actions: ['NONE'],
        });
      }

      return {
        text: errorText,
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    } finally {
      await memgraphService.disconnect();
    }
  },
};
