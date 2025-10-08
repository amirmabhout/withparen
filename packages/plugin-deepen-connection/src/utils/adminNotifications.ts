import { logger } from '@elizaos/core';
import { MemgraphService, type HumanConnectionNode } from '../services/memgraph.js';

/**
 * Escape special characters for Telegram Markdown
 */
function escapeMarkdown(text: string): string {
  return text.replace(/([_*[\]()~`>#+\-=|{}.!])/g, '\\$1');
}

/**
 * Send admin notification when a new HumanConnection is created
 */
export async function sendConnectionCreatedNotification(
  humanConnection: HumanConnectionNode,
  creatorUserId: string,
  creatorName: string
): Promise<void> {
  try {
    const botToken = process.env.TELEGRAM_ADMIN_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_ADMIN_BOT_CHATID;

    if (!botToken || !chatId) {
      logger.debug('[admin-notification] Telegram credentials not configured, skipping');
      return;
    }

    // Escape all dynamic values for Markdown
    const connectionId = escapeMarkdown(humanConnection.connectionId);
    const partners = escapeMarkdown(humanConnection.partners.join(' & '));
    const secret = escapeMarkdown(humanConnection.secret);
    const status = escapeMarkdown(humanConnection.status || 'waitlist');
    const name = escapeMarkdown(creatorName);
    const userId = escapeMarkdown(creatorUserId);
    const partner2 = escapeMarkdown(humanConnection.partners[1] || 'partner');

    // Create notification message for connection creation
    const message = `🆕 New Connection Created

*HumanConnection Details:*
• Connection ID: ${connectionId}
• Partners: ${partners}
• Secret: ${secret}
• Status: ${status}

*Creator:*
• Name: ${name}
• UserId: ${userId}

Waiting for ${partner2} to join\\.\\.\\.`;

    // Send message to admin
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'Markdown',
      }),
    });

    if (!response.ok) {
      logger.error(`[admin-notification] Failed to send Telegram message: ${response.statusText}`);
    } else {
      logger.info('[admin-notification] Connection created notification sent successfully');
    }
  } catch (error) {
    logger.error(
      `[admin-notification] Error sending connection created notification: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Send admin notification when both users have joined and connection is activated
 */
export async function sendConnectionActivatedNotification(
  memgraphService: MemgraphService,
  humanConnection: HumanConnectionNode,
  joiningUserId: string
): Promise<void> {
  try {
    const botToken = process.env.TELEGRAM_ADMIN_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_ADMIN_BOT_CHATID;

    if (!botToken || !chatId) {
      logger.debug('[admin-notification] Telegram credentials not configured, skipping');
      return;
    }

    // Get all participants in this HumanConnection
    const participants = await memgraphService.getConnectionParticipants(humanConnection);

    // Format participant information with escaped values
    const participantInfo = participants
      .map((person) => {
        const info = [`Name: ${escapeMarkdown(person.name)}`];
        if (person.userId) info.push(`UserId: ${escapeMarkdown(person.userId)}`);
        if (person.webId) info.push(`WebId: ${escapeMarkdown(person.webId)}`);
        return `• ${info.join(', ')}`;
      })
      .join('\n');

    // Escape all dynamic values for Markdown
    const connectionId = escapeMarkdown(humanConnection.connectionId);
    const partners = escapeMarkdown(humanConnection.partners.join(' & '));
    const secret = escapeMarkdown(humanConnection.secret);
    const userId = escapeMarkdown(joiningUserId);

    // Create notification message for connection activation
    const message = `✅ Connection Activated\\!

*HumanConnection Details:*
• Connection ID: ${connectionId}
• Partners: ${partners}
• Secret: ${secret}
• Status: active

*All Participants:*
${participantInfo}

*Latest Join:* ${userId}

Both users are now connected and the connection is active\\!`;

    // Send message to admin
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'Markdown',
      }),
    });

    if (!response.ok) {
      logger.error(`[admin-notification] Failed to send Telegram message: ${response.statusText}`);
    } else {
      logger.info('[admin-notification] Connection activated notification sent successfully');
    }
  } catch (error) {
    logger.error(
      `[admin-notification] Error sending connection activated notification: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
