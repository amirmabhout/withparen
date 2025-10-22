/**
 * Time utility helpers for handling ISO 8601 datetime formats
 * Used for scheduling meetings and reminders
 */

import { logger } from '@elizaos/core';

/**
 * Validates if a string is in ISO 8601 format
 * @param dateString - The date string to validate
 * @returns boolean indicating if the format is valid
 */
export function isValidISO8601(dateString: string): boolean {
  if (!dateString) return false;

  try {
    const date = new Date(dateString);
    // Check if the date is valid and the string is in ISO format
    return !isNaN(date.getTime()) && dateString === date.toISOString();
  } catch {
    return false;
  }
}

/**
 * Converts ISO 8601 string to human-readable format
 * @param isoString - ISO 8601 formatted date string
 * @param options - Formatting options
 * @returns Human-readable date string
 */
export function formatISOToHuman(
  isoString: string,
  options: {
    includeTime?: boolean;
    includeWeekday?: boolean;
    timeZone?: string;
  } = {}
): string {
  try {
    const date = new Date(isoString);

    if (isNaN(date.getTime())) {
      logger.warn(`[timeHelpers] Invalid ISO string: ${isoString}`);
      return isoString; // Return original if parsing fails
    }

    const { includeTime = true, includeWeekday = true, timeZone = 'UTC' } = options;

    const formatOptions: Intl.DateTimeFormatOptions = {
      timeZone,
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    };

    if (includeWeekday) {
      formatOptions.weekday = 'long';
    }

    if (includeTime) {
      formatOptions.hour = 'numeric';
      formatOptions.minute = '2-digit';
      formatOptions.timeZoneName = 'short';
    }

    return date.toLocaleString('en-US', formatOptions);
  } catch (error) {
    logger.error(`[timeHelpers] Error formatting ISO string: ${error}`);
    return isoString;
  }
}

/**
 * Gets current time in ISO 8601 format
 * @returns Current time as ISO string
 */
export function getCurrentISO(): string {
  return new Date().toISOString();
}

/**
 * Adds hours to an ISO date string
 * @param isoString - Base ISO date string
 * @param hours - Number of hours to add (can be negative)
 * @returns New ISO date string
 */
export function addHoursToISO(isoString: string, hours: number): string {
  try {
    const date = new Date(isoString);
    date.setHours(date.getHours() + hours);
    return date.toISOString();
  } catch (error) {
    logger.error(`[timeHelpers] Error adding hours to ISO string: ${error}`);
    return isoString;
  }
}

/**
 * Calculates hours until a future date
 * @param isoString - Target ISO date string
 * @returns Number of hours until the date (negative if past)
 */
export function hoursUntil(isoString: string): number {
  try {
    const targetDate = new Date(isoString);
    const now = new Date();
    const diffMs = targetDate.getTime() - now.getTime();
    return diffMs / (1000 * 60 * 60); // Convert ms to hours
  } catch (error) {
    logger.error(`[timeHelpers] Error calculating hours until: ${error}`);
    return 0;
  }
}

/**
 * Checks if a date has passed
 * @param isoString - ISO date string to check
 * @returns boolean indicating if the date has passed
 */
export function hasDatePassed(isoString: string): boolean {
  try {
    const date = new Date(isoString);
    return date.getTime() < Date.now();
  } catch (error) {
    logger.error(`[timeHelpers] Error checking if date passed: ${error}`);
    return false;
  }
}

/**
 * Formats a relative time description (e.g., "in 2 hours", "3 hours ago")
 * @param isoString - ISO date string
 * @returns Relative time string
 */
export function formatRelativeTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = date.getTime() - now.getTime();
    const absDiffMs = Math.abs(diffMs);

    const minutes = Math.floor(absDiffMs / (1000 * 60));
    const hours = Math.floor(absDiffMs / (1000 * 60 * 60));
    const days = Math.floor(absDiffMs / (1000 * 60 * 60 * 24));

    const isPast = diffMs < 0;
    const suffix = isPast ? 'ago' : '';
    const prefix = isPast ? '' : 'in';

    if (minutes < 1) {
      return isPast ? 'just now' : 'in a moment';
    } else if (minutes < 60) {
      return `${prefix} ${minutes} minute${minutes !== 1 ? 's' : ''} ${suffix}`.trim();
    } else if (hours < 24) {
      return `${prefix} ${hours} hour${hours !== 1 ? 's' : ''} ${suffix}`.trim();
    } else {
      return `${prefix} ${days} day${days !== 1 ? 's' : ''} ${suffix}`.trim();
    }
  } catch (error) {
    logger.error(`[timeHelpers] Error formatting relative time: ${error}`);
    return '';
  }
}

/**
 * Checks if a datetime is within a certain window for reminders
 * @param isoString - Meeting datetime in ISO format
 * @param reminderHours - Hours before meeting to send reminder
 * @param windowMinutes - Window in minutes to check (default 30)
 * @returns boolean indicating if reminder should be sent
 */
export function isWithinReminderWindow(
  isoString: string,
  reminderHours: number,
  windowMinutes: number = 30
): boolean {
  try {
    const meetingTime = new Date(isoString);
    const reminderTime = new Date(meetingTime);
    reminderTime.setHours(reminderTime.getHours() - reminderHours);

    const now = new Date();
    const windowMs = windowMinutes * 60 * 1000;

    // Check if current time is within the window of reminder time
    const diffMs = now.getTime() - reminderTime.getTime();
    return diffMs >= 0 && diffMs <= windowMs;
  } catch (error) {
    logger.error(`[timeHelpers] Error checking reminder window: ${error}`);
    return false;
  }
}

/**
 * Gets a sample ISO string for the LLM context
 * Useful for providing examples in templates
 * @param daysFromNow - Number of days from now (default 3)
 * @param hour - Hour of day in 24h format (default 19 for 7 PM)
 * @returns Sample ISO string
 */
export function getSampleISOString(daysFromNow: number = 3, hour: number = 19): string {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
}

/**
 * Parses a potentially malformed date string and returns ISO format
 * This is a fallback for when LLM doesn't produce perfect ISO
 * @param dateString - Date string to parse
 * @returns ISO string or null if unparseable
 */
export function parseToISO(dateString: string): string | null {
  try {
    // If already valid ISO, return it
    if (isValidISO8601(dateString)) {
      return dateString;
    }

    // Try to parse with Date constructor
    const date = new Date(dateString);
    if (!isNaN(date.getTime())) {
      return date.toISOString();
    }

    return null;
  } catch {
    return null;
  }
}