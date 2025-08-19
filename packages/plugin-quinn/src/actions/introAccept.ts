import {
  type IAgentRuntime,
  type Memory,
  type Action,
  type State,
  type ActionExample,
  type HandlerCallback,
  type ActionResult,
  logger,
} from '@elizaos/core';

/**
 * Introduction Accept/Decline Action for Quinn
 * Handles responses to introduction proposals
 */
export const introAcceptAction: Action = {
  name: 'INTRO_ACCEPT',
  description:
    'Handles acceptance or decline of introduction proposals from potential matches',
  similes: [
    'ACCEPT_INTRODUCTION',
    'DECLINE_INTRODUCTION',
    'RESPOND_INTRODUCTION',
    'INTRODUCTION_RESPONSE',
    'INTRO_RESPONSE',
  ],
  examples: [] as ActionExample[][],

  validate: async (runtime: IAgentRuntime, message: Memory): Promise<boolean> => {
    try {
      // Check if there are any matches with "introduction_incoming" status for this user
      const matches = await runtime.getMemories({
        tableName: 'matches',
        count: 50,
      });

      // Find matches where this user has incoming introductions
      const incomingIntroductions = matches.filter(match => {
        const matchData = match.content as any;
        return (
          (matchData.user1Id === message.entityId || matchData.user2Id === message.entityId) &&
          matchData.status === 'introduction_incoming'
        );
      });

      // Check if user is responding to an introduction in their message
      const messageText = message.content.text?.toLowerCase() || '';
      const responseKeywords = ['yes', 'no', 'accept', 'decline', 'sure', 'not interested', 'sounds good', 'connect'];
      const hasIntroductionResponse = responseKeywords.some(keyword => 
        messageText.includes(keyword)
      );

      return incomingIntroductions.length > 0 && hasIntroductionResponse;
    } catch (error) {
      logger.error(`[quinn] Error validating intro accept action: ${error}`);
      return false;
    }
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options: any,
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    try {
      logger.info(`[quinn] Processing introduction response from user ${message.entityId}`);

      // Get matches with "introduction_incoming" status for this user
      const matches = await runtime.getMemories({
        tableName: 'matches',
        count: 50,
      });

      const incomingIntroductions = matches.filter(match => {
        const matchData = match.content as any;
        return (
          (matchData.user1Id === message.entityId || matchData.user2Id === message.entityId) &&
          matchData.status === 'introduction_incoming'
        );
      });

      if (incomingIntroductions.length === 0) {
        const noIntroText = "I don't see any pending introduction requests for you right now. Would you like me to search for new connections?";
        
        if (callback) {
          await callback({
            text: noIntroText,
            actions: ['REPLY'],
          });
        }

        return {
          text: noIntroText,
          success: false,
          error: new Error('No pending introductions found'),
        };
      }

      // Process the most recent introduction
      const introToProcess = incomingIntroductions[0];
      const introData = introToProcess.content as any;

      // Determine the other user in this match
      const isUser1 = introData.user1Id === message.entityId;
      const otherUserId = isUser1 ? introData.user2Id : introData.user1Id;
      const respondingUserId = message.entityId;

      // Analyze the user's response to determine acceptance or decline
      const messageText = message.content.text?.toLowerCase() || '';
      const acceptKeywords = ['yes', 'accept', 'sure', 'sounds good', 'i would like', 'connect', 'interested'];
      const declineKeywords = ['no', 'decline', 'not interested', 'pass', 'not right now'];
      
      const isAccepting = acceptKeywords.some(keyword => messageText.includes(keyword));
      const isDeclining = declineKeywords.some(keyword => messageText.includes(keyword));

      if (!isAccepting && !isDeclining) {
        // Ambiguous response, ask for clarification
        const clarificationText = "I want to make sure I understand correctly - would you like me to connect you with this person? Please let me know 'yes' if you'd like the introduction or 'no' if you'd prefer to pass on this connection.";
        
        if (callback) {
          await callback({
            text: clarificationText,
            actions: ['REPLY'],
          });
        }

        return {
          text: clarificationText,
          success: true,
          values: { needsClarification: true },
        };
      }

      let responseText: string;
      let newStatus: string;

      if (isAccepting) {
        // Both users accepted - make the connection!
        
        // Get other user's information for the connection message
        const otherUserEntity = await runtime.getEntityById(otherUserId);
        
        const otherUserName = otherUserEntity?.metadata?.username || 
                             otherUserEntity?.metadata?.name || 
                             `User${otherUserId}`;

        // Update status to connected
        newStatus = 'connected';
        
        responseText = `Wonderful! I'm excited to connect you two. You can now reach out to ${otherUserName} directly using their username: ${otherUserName}. They're also looking forward to connecting with you! Here's a great way to start: mention what drew you to connect and share what you're working on. Good luck with your new connection!`;

        // Send success message to the original requesting user
        try {
          // Get the accepting user's info for the message
          const acceptingUserEntity = await runtime.getEntityById(respondingUserId);
          const acceptingUserName = acceptingUserEntity?.metadata?.username || 
                                   acceptingUserEntity?.metadata?.name || 
                                   `User${respondingUserId}`;

          // Find the original user's room to send them the good news
          const originalUserRooms = await runtime.getMemories({
            tableName: 'rooms',
            count: 10,
          });

          let originalUserRoom: Memory | undefined = undefined;
          for (const room of originalUserRooms) {
            const roomData = room.content as any;
            if (room.entityId === otherUserId || roomData?.participants?.includes(otherUserId)) {
              originalUserRoom = room;
              break;
            }
          }

          const successMessage = `Great news! ${acceptingUserName} accepted your introduction and is excited to connect with you. You can now reach out to them directly using their username: ${acceptingUserName}. Here's a great way to start: mention what drew you to connect and share what you're working on. Good luck with your new connection!`;

          if (originalUserRoom) {
            const roomContent = originalUserRoom.content as any;
            const targetInfo = {
              source: roomContent.source || 'websocket-api',
              roomId: originalUserRoom.roomId || otherUserId,
              entityId: otherUserId,
            };

            await runtime.sendMessageToTarget(targetInfo, {
              text: successMessage,
              source: 'agent_introduction',
              type: 'connection_success',
            });

            logger.info(`[quinn] Successfully notified original user ${otherUserId} about accepted introduction`);
          } else {
            // Fallback method
            const fallbackTargetInfo = {
              source: 'websocket-api',
              roomId: otherUserId,
              entityId: otherUserId,
            };

            await runtime.sendMessageToTarget(fallbackTargetInfo, {
              text: successMessage,
              source: 'agent_introduction',
              type: 'connection_success',
            });

            logger.info(`[quinn] Sent success notification using fallback method to user ${otherUserId}`);
          }
        } catch (messageError) {
          logger.error(`[quinn] Failed to send success message to original user ${otherUserId}: ${messageError}`);
          // Continue with the workflow even if message delivery fails
        }

        // Find and update the corresponding match record for the other user
        const otherUserMatches = await runtime.getMemories({
          tableName: 'matches',
          count: 50,
        });

        const otherUserMatch = otherUserMatches.find(match => {
          const matchData = match.content as any;
          return (
            (matchData.user1Id === otherUserId || matchData.user2Id === otherUserId) &&
            (matchData.user1Id === respondingUserId || matchData.user2Id === respondingUserId) &&
            matchData.status === 'introduction_outgoing'
          );
        });

        if (otherUserMatch && otherUserMatch.id) {
          const updatedOtherMatchContent = {
            ...otherUserMatch.content,
            status: 'connected',
          };

          await runtime.updateMemory({
            id: otherUserMatch.id,
            content: updatedOtherMatchContent,
          });

          logger.info(`[quinn] Updated other user's match status to connected: ${otherUserId}`);
        }

      } else {
        // User declined the introduction
        newStatus = 'declined';
        responseText = "No problem at all! Not every connection is the right fit, and that's perfectly okay. I'll keep looking for other potential matches that might be more aligned with what you're seeking. Thanks for letting me know!";
      }

      // Update the introduction status
      if (introToProcess.id) {
        const updatedIntroContent = {
          ...introData,
          status: newStatus,
          responseTimestamp: Date.now(),
        };

        await runtime.updateMemory({
          id: introToProcess.id,
          content: updatedIntroContent,
        });
      }

      // Update introduction record in introductions table
      const introductions = await runtime.getMemories({
        tableName: 'introductions',
        count: 50,
      });

      const matchingIntroduction = introductions.find(intro => {
        const introContent = intro.content as any;
        return (
          introContent.toUserId === respondingUserId &&
          introContent.fromUserId === otherUserId &&
          introContent.status === 'proposal_sent'
        );
      });

      if (matchingIntroduction && matchingIntroduction.id) {
        const updatedIntroductionContent = {
          ...matchingIntroduction.content,
          status: isAccepting ? 'accepted' : 'declined',
          responseTimestamp: Date.now(),
        };

        await runtime.updateMemory({
          id: matchingIntroduction.id,
          content: updatedIntroductionContent,
        });

        logger.info(`[quinn] Updated introduction record status to ${updatedIntroductionContent.status}`);
      }

      if (callback) {
        await callback({
          text: responseText,
          actions: ['REPLY'],
        });
      }

      return {
        text: responseText,
        success: true,
        values: {
          respondingUserId,
          otherUserId,
          status: newStatus,
          accepted: isAccepting,
        },
      };
    } catch (error) {
      logger.error(`[quinn] Error in introduction response: ${error}`);

      const errorText = "I encountered an issue while processing your response. Please try again in a moment.";

      if (callback) {
        await callback({
          text: errorText,
          actions: ['REPLY'],
        });
      }

      return {
        text: errorText,
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  },
};