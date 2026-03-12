export const OFFLINE_NOTICE_TEXT = 'You are offline. Some actions are limited. Showing cached/last sync content.';

/**
 * Creates a standardized non-blocking warning message and logs a debug hint.
 *
 * The app currently does not include a global toast API, so callers can use the
 * returned message in existing component-level UI state.
 */
export function showOfflineBlockMessage(context: string, detail?: string): string {
  const message = detail
    ? `You are offline. ${context} was queued for later.`
    : OFFLINE_NOTICE_TEXT;

  if (globalThis.console !== undefined) {
    globalThis.console.warn(`[offline-block] ${context}`, { detail: detail ?? OFFLINE_NOTICE_TEXT });
  }
  return detail ? `${message} ${detail}` : OFFLINE_NOTICE_TEXT;
}
