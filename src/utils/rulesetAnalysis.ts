export interface RulesetConfig {
  id: string;
  name: string;
  fetchUrl: string;
  linkUrl: string;
  homeUrl: string;
  isJsonApi?: boolean;
}

export interface MetricData {
  words: number;
  characters: number;
  content: string;
  wordSet: Set<string>;
  wordCounts: Map<string, number>;
  loading: boolean;
  error: string | null;
}

export const INITIAL_RULESETS: RulesetConfig[] = [
  {
    id: 'agora',
    name: 'Agora Nomic',
    fetchUrl: 'https://agoranomic.org/ruleset/slr.txt',
    linkUrl: 'https://agoranomic.org/ruleset/slr.txt',
    homeUrl: 'https://agoranomic.org/',
  },
  {
    id: 'blognomic',
    name: 'BlogNomic',
    fetchUrl: 'https://wiki.blognomic.com/api.php?action=parse&page=Ruleset&format=json&prop=wikitext&origin=*',
    linkUrl: 'https://wiki.blognomic.com/index.php?title=Ruleset',
    homeUrl: 'https://blognomic.com/',
    isJsonApi: true,
  },
  {
    id: 'infinite',
    name: 'Infinite Nomic',
    fetchUrl: 'https://infinite.nomic.space/wiki/api.php?action=parse&page=Metaruleset&format=json&prop=wikitext&origin=*',
    linkUrl: 'https://infinite.nomic.space/wiki/index.php?title=Metaruleset',
    homeUrl: 'https://infinite.nomic.space/',
    isJsonApi: true,
  },
];

export const BANNED_AKA_WORDS = new Set([
  'decision',
  'decisions',
  'server',
  'votable',
  'post',
  'switch',
  'periods',
  'moderator',
]);

export const HELP_TEXTS = {
  topWords: (name: string) =>
    `Number next to the word is a count. Words ordered by how disproportionately often they appear in ${name} ruleset relative to the other rulesets (normalized by total words).`,
  uniqueWords: (name: string) =>
    `Words that appear in ${name} ruleset but do not appear in any other active ruleset, ordered by occurrences.`,
};

export function calculateJaccardSimilarity(setA: Set<string>, setB: Set<string>): number {
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersectionSize = 0;
  setA.forEach((word) => {
    if (setB.has(word)) intersectionSize++;
  });

  const unionSize = new Set([...setA, ...setB]).size;
  return unionSize > 0 ? (intersectionSize / unionSize) * 100 : 0;
}

export function formatSizeComparison(currentWords: number, targetWords: number): string {
  if (targetWords === 0 || currentWords === 0) return 'N/A';
  if (currentWords === targetWords) return 'Same size';

  if (currentWords > targetWords) {
    const ratio = currentWords / targetWords;
    return `${ratio.toFixed(2)} times smaller`;
  } else {
    const ratio = targetWords / currentWords;
    return `${ratio.toFixed(2)} times bigger`;
  }
}

export function shareCommonStem(w1: string, w2: string): boolean {
  const minLength = Math.min(w1.length, w2.length);
  const prefixLength = Math.min(4, minLength);

  if (w1.substring(0, prefixLength) === w2.substring(0, prefixLength)) {
    return true;
  }
  return w1.includes(w2) || w2.includes(w1);
}

export function getDistinctTopWords(
  topWordsList: { word: string; score: number; count: number }[],
  baseName: string,
  limit: number = 4
): string[] {
  const result: string[] = [];
  const basePrefix = baseName.toLowerCase().replace(/nomic/g, '').trim();

  for (const item of topWordsList) {
    if (result.length >= limit) break;
    const lowerWord = item.word.toLowerCase();

    if (BANNED_AKA_WORDS.has(lowerWord)) continue;
    if (basePrefix && shareCommonStem(lowerWord, basePrefix)) continue;

    const isDuplicateOrStem = result.some((selected) =>
      shareCommonStem(lowerWord, selected.toLowerCase())
    );

    if (!isDuplicateOrStem) {
      result.push(item.word);
    }
  }

  return result;
}

export async function fetchMetrics(ruleset: RulesetConfig): Promise<Omit<MetricData, 'loading' | 'error'>> {
  const res = await fetch(ruleset.fetchUrl);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  let text = '';
  if (ruleset.isJsonApi) {
    const json = await res.json();
    text = json?.parse?.wikitext?.['*'] || '';
  } else {
    text = await res.text();
  }

  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  const wordCounts = new Map<string, number>();
  tokens.forEach((token) => {
    wordCounts.set(token, (wordCounts.get(token) || 0) + 1);
  });

  return {
    words: text.trim() ? text.trim().split(/\s+/).length : 0,
    characters: text.length,
    content: text,
    wordSet: new Set(tokens),
    wordCounts,
  };
}