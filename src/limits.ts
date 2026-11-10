export const LIMITS = {
  messageChars: 8_000,
  broadcastChars: 4_000,
  taskChars: 16_000,
  resultChars: 16_000,
  descriptionChars: 500,
  inboxDefault: 20,
  inboxMax: 50,
  broadcastRecipients: 100,
  doorbellAttempts: 5,
  doorbellTimeoutMs: 8_000,
  rateLimitPerMinute: 120,
} as const;

/** Bearer-auth helpers reject tokens that omit expiresAt. Bot tokens stay valid until revoke. */
export const TOKEN_LIFETIME_SECONDS = 60 * 60 * 24 * 365 * 10;
