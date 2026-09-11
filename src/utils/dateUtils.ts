/**
 * Calculates an RGB color along a green-to-red gradient based on how recently a ruleset was updated.
 * Clamps output between 0 and 60 days.
 */
export function getDateColor(lastModified?: string | null): string {
  if (!lastModified) return 'inherit';
  const parsedDate = new Date(lastModified);
  if (isNaN(parsedDate.getTime())) return 'inherit';

  const diffDays = (new Date().getTime() - parsedDate.getTime()) / (1000 * 3600 * 24);
  const clampedDays = Math.max(0, Math.min(60, diffDays));

  let r: number, g: number, b: number;

  if (clampedDays <= 30) {
    const factor = clampedDays / 30;
    r = Math.round(46 + factor * (237 - 46));
    g = Math.round(125 + factor * (108 - 125));
    b = Math.round(50 + factor * (2 - 50));
  } else {
    const factor = (clampedDays - 30) / 30;
    r = Math.round(237 + factor * (211 - 237));
    g = Math.round(108 + factor * (47 - 108));
    b = Math.round(2 + factor * (47 - 2));
  }

  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Formats an ISO date string into a human-readable relative age string (e.g., "53 days old").
 */
export function formatRelativeAge(lastModified?: string | null): string | null {
  if (!lastModified) return null;
  const parsedDate = new Date(lastModified);
  if (isNaN(parsedDate.getTime())) return null;

  const diffMs = new Date().getTime() - parsedDate.getTime();
  if (diffMs < 0) return '0 seconds old';

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds} ${seconds === 1 ? 'second' : 'seconds'} old`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} old`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} old`;

  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'} old`;
}