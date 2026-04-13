/** Defensive helpers for rendering API data that may be null/undefined. */

export const safeStr = (v: unknown): string => typeof v === 'string' ? v : '';
export const safeArr = <T>(v: T[] | null | undefined): T[] => Array.isArray(v) ? v : [];
export const safeNum = (v: unknown): number => typeof v === 'number' ? v : 0;
