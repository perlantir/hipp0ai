/**
 * Weekly Digest — stub implementation.
 */
export async function generateDigest(projectId: string): Promise<{ summary: string; highlights: string[]; decisions_count: number }> {
  return { summary: `Weekly digest for project ${projectId.slice(0, 8)}..`, highlights: [], decisions_count: 0 };
}

export const generateWeeklyDigest = generateDigest;
