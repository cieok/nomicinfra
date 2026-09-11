import { useState, useMemo } from 'react';
import './App.css';
import {
  INITIAL_RULESETS,
  calculateJaccardSimilarity,
  formatSizeComparison,
  getDistinctTopWords,
} from './utils/rulesetAnalysis';
import { useRulesetData } from './useRulesetData';
import { RulesetViewer, type ComparisonItem } from './RulesetViewer';

export function App() {
  const { rulesets, dataMap } = useRulesetData();

  const [activeTabId, setActiveTabId] = useState<string>(
    INITIAL_RULESETS[0]?.id || rulesets[0]?.id || 'nomic'
  );
  const [similarityFilter, setSimilarityFilter] = useState<'All' | 'Games' | 'Templates'>('All');

  const groupedRulesets = useMemo(() => {
    return {
      Games: rulesets.filter((r) => r.category === 'Games'),
      Templates: rulesets.filter((r) => r.category === 'Templates'),
    };
  }, [rulesets]);

  const currentRuleset = rulesets.find((r) => r.id === activeTabId) || rulesets[0];
  const currentMetrics = dataMap[currentRuleset?.id];

  const getDateColor = (lastModified?: string | null): string => {
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
  };

  const dateColor = useMemo(() => {
    return getDateColor(currentMetrics?.lastModified);
  }, [currentMetrics?.lastModified]);

  const formatRelativeAge = (lastModified?: string | null): string | null => {
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
  };

  const relativeAge = useMemo(() => {
    return formatRelativeAge(currentMetrics?.lastModified);
  }, [currentMetrics?.lastModified]);

  const comparisons = useMemo<ComparisonItem[]>(() => {
    if (!currentMetrics || currentMetrics.loading || currentMetrics.error) return [];

    return rulesets
      .filter((r) => r.id !== currentRuleset.id)
      .filter((r) => similarityFilter === 'All' || r.category === similarityFilter)
      .map((other) => {
        const otherMetrics = dataMap[other.id];
        if (!otherMetrics || otherMetrics.loading || otherMetrics.error) {
          return {
            ruleset: other,
            score: null,
            sizeText: null,
            indicatorColor: 'inherit',
            error: otherMetrics?.error || 'Loading...',
          };
        }

        const score = calculateJaccardSimilarity(currentMetrics.wordSet, otherMetrics.wordSet);
        const sizeText = formatSizeComparison(currentMetrics.words, otherMetrics.words);
        const indicatorColor = getDateColor(otherMetrics.lastModified);

        return {
          ruleset: other,
          score,
          sizeText,
          indicatorColor,
          error: null,
        };
      })
      .sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity));
  }, [currentRuleset, currentMetrics, dataMap, rulesets, similarityFilter]);

  const uniqueWordsWithCounts = useMemo(() => {
    if (!currentMetrics || currentMetrics.loading || currentMetrics.error) return [];

    const otherWordsSet = new Set<string>();
    rulesets.forEach((r) => {
      if (r.id !== currentRuleset.id && dataMap[r.id] && !dataMap[r.id].loading) {
        dataMap[r.id].wordSet.forEach((w) => otherWordsSet.add(w));
      }
    });

    const uniqueList: { word: string; count: number }[] = [];
    currentMetrics.wordSet.forEach((word) => {
      const containsDigit = /\d/.test(word);
      const isHttp = word.startsWith('http');

      if (word.length > 1 && !containsDigit && !isHttp && !otherWordsSet.has(word)) {
        uniqueList.push({
          word,
          count: currentMetrics.wordCounts.get(word) || 1,
        });
      }
    });

    return uniqueList.sort((a, b) => b.count - a.count || a.word.localeCompare(b.word));
  }, [currentRuleset, currentMetrics, dataMap, rulesets]);

  const topWords = useMemo(() => {
    if (!currentMetrics || currentMetrics.loading || currentMetrics.error) return [];

    let otherTotalWords = 0;
    const otherWordCounts = new Map<string, number>();

    rulesets.forEach((r) => {
      if (r.id !== currentRuleset.id && dataMap[r.id] && !dataMap[r.id].loading) {
        otherTotalWords += dataMap[r.id].words;
        dataMap[r.id].wordCounts.forEach((count, word) => {
          otherWordCounts.set(word, (otherWordCounts.get(word) || 0) + count);
        });
      }
    });

    if (otherTotalWords === 0) return [];

    const scoredList: { word: string; score: number; count: number }[] = [];

    currentMetrics.wordSet.forEach((word) => {
      const containsDigit = /\d/.test(word);
      const isHttp = word.startsWith('http');
      const countInCurrent = currentMetrics.wordCounts.get(word) || 0;

      if (word.length > 2 && !containsDigit && !isHttp && countInCurrent >= 2) {
        const countInOthers = otherWordCounts.get(word) || 0;

        const frequencyInCurrent = (countInCurrent + 1) / (currentMetrics.words + 1);
        const frequencyInOthers = (countInOthers + 1) / (otherTotalWords + 1);

        const score = frequencyInCurrent / frequencyInOthers;

        if (score >= 1.5) {
          scoredList.push({
            word,
            count: countInCurrent,
            score,
          });
        }
      }
    });

    return scoredList.sort((a, b) => b.score - a.score).slice(0, 150);
  }, [currentRuleset, currentMetrics, dataMap, rulesets]);

  const akaListWords = useMemo(() => {
    return getDistinctTopWords(topWords, currentRuleset?.name || '', 4);
  }, [topWords, currentRuleset]);

  const handleExportTs = () => {
    const localRulesets = rulesets.filter(
      (r) => r.fetchUrl.startsWith('./') || r.fetchUrl.startsWith('blob:')
    );

    const exportData = localRulesets.map((r) => {
      const metrics = dataMap[r.id];
      return {
        id: r.id,
        name: r.name,
        linkUrl: r.linkUrl,
        homeUrl: r.homeUrl,
        content: metrics?.content || '',
        metrics: {
          words: metrics?.words || 0,
          characters: metrics?.characters || 0,
          uniqueWordCount: metrics?.wordSet?.size || 0,
          wordSet: metrics?.wordSet ? Array.from(metrics.wordSet) : [],
          wordCounts: metrics?.wordCounts ? Object.fromEntries(metrics.wordCounts) : {},
        },
      };
    });

    const tsContent = `// Auto-generated precomputed ruleset data (Local files only)
export interface PrecomputedRuleset {
  id: string;
  name: string;
  linkUrl: string;
  homeUrl: string;
  content: string;
  metrics: {
    words: number;
    characters: number;
    uniqueWordCount: number;
    wordSet: string[];
    wordCounts: Record<string, number>;
  };
}

export const PRECOMPUTED_RULESETS: PrecomputedRuleset[] = ${JSON.stringify(exportData, null, 2)};
`;

    const blob = new Blob([tsContent], { type: 'text/typescript' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = 'precomputedRulesets.ts';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <RulesetViewer
      rulesets={rulesets}
      groupedRulesets={groupedRulesets}
      currentRuleset={currentRuleset}
      currentMetrics={currentMetrics}
      activeTabId={activeTabId}
      relativeAge={relativeAge}
      dateColor={dateColor}
      akaListWords={akaListWords}
      topWords={topWords}
      uniqueWordsWithCounts={uniqueWordsWithCounts}
      comparisons={comparisons}
      similarityFilter={similarityFilter}
      onSelectRuleset={setActiveTabId}
      onFilterChange={setSimilarityFilter}
      onExportTs={handleExportTs}
    />
  );
}

export default App;