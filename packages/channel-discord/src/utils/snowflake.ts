/**
 * Discord Snowflake ID utilities
 *
 * Discord uses Snowflake IDs - 64-bit integers represented as strings.
 * Format: 64-bit number = timestamp (42 bits) + worker (5) + process (5) + increment (12)
 */

/**
 * Discord epoch (first second of 2015)
 */
const DISCORD_EPOCH = 1420070400000n;

/**
 * Snowflake ID regex pattern (17-19 digit string)
 */
const SNOWFLAKE_REGEX = /^\d{17,19}$/;

/**
 * Validate a Discord Snowflake ID
 *
 * @param id - String to validate
 * @returns true if valid Snowflake format
 */
export function isValidSnowflake(id: string): boolean {
  if (!SNOWFLAKE_REGEX.test(id)) {
    return false;
  }

  // Ensure it can be parsed as a BigInt
  try {
    const snowflake = BigInt(id);
    // Must be positive and not exceed Discord's ID space
    return snowflake > 0n && snowflake < 1n << 64n;
  } catch {
    return false;
  }
}

/**
 * Get timestamp from a Snowflake ID
 *
 * @param id - Snowflake ID
 * @returns Date object or null if invalid
 */
export function snowflakeToDate(id: string): Date | null {
  if (!isValidSnowflake(id)) {
    return null;
  }

  const snowflake = BigInt(id);
  // Timestamp is in the upper 42 bits
  const timestamp = (snowflake >> 22n) + DISCORD_EPOCH;
  return new Date(Number(timestamp));
}

/**
 * Get timestamp in milliseconds from a Snowflake ID
 *
 * @param id - Snowflake ID
 * @returns Unix timestamp in ms or null if invalid
 */
export function snowflakeToTimestamp(id: string): number | null {
  const date = snowflakeToDate(id);
  return date ? date.getTime() : null;
}

/**
 * Compare two Snowflakes chronologically
 *
 * @param a - First Snowflake
 * @param b - Second Snowflake
 * @returns negative if a < b, positive if a > b, 0 if equal
 */
export function compareSnowflakes(a: string, b: string): number {
  const aNum = BigInt(a);
  const bNum = BigInt(b);

  if (aNum < bNum) return -1;
  if (aNum > bNum) return 1;
  return 0;
}

/**
 * Extract worker ID from a Snowflake
 *
 * @param id - Snowflake ID
 * @returns Worker ID (0-31) or null if invalid
 */
export function getWorkerId(id: string): number | null {
  if (!isValidSnowflake(id)) return null;

  const snowflake = BigInt(id);
  return Number((snowflake >> 17n) & 0x1fn);
}

/**
 * Extract process ID from a Snowflake
 *
 * @param id - Snowflake ID
 * @returns Process ID (0-31) or null if invalid
 */
export function getProcessId(id: string): number | null {
  if (!isValidSnowflake(id)) return null;

  const snowflake = BigInt(id);
  return Number((snowflake >> 12n) & 0x1fn);
}

/**
 * Extract increment from a Snowflake
 *
 * @param id - Snowflake ID
 * @returns Increment (0-4095) or null if invalid
 */
export function getIncrement(id: string): number | null {
  if (!isValidSnowflake(id)) return null;

  const snowflake = BigInt(id);
  return Number(snowflake & 0xfffn);
}
