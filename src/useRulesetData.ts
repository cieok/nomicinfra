import { useState, useEffect } from 'react';
import type { MetricData, RulesetConfig } from './utils/rulesetAnalysis';
import { INITIAL_RULESETS, fetchMetrics } from './utils/rulesetAnalysis';
import { PRECOMPUTED_RULESETS } from './precomputedRulesets';

export interface CategorizedRulesetConfig extends RulesetConfig {
  category: 'Templates' | 'Games';
}

function buildPrecomputedState() {
  const precomputedRulesets: CategorizedRulesetConfig[] = PRECOMPUTED_RULESETS.map((p) => ({
    id: p.id,
    name: p.name,
    fetchUrl: './',
    linkUrl: p.linkUrl,
    homeUrl: p.homeUrl,
    category: 'Templates',
  }));

  const precomputedDataMap: Record<string, MetricData> = {};
  PRECOMPUTED_RULESETS.forEach((p) => {
    precomputedDataMap[p.id] = {
      words: p.metrics.words,
      characters: p.metrics.characters,
      content: p.content,
      wordSet: new Set(p.metrics.wordSet),
      wordCounts: new Map(Object.entries(p.metrics.wordCounts)),
      loading: false,
      error: null,
    };
  });

  return { precomputedRulesets, precomputedDataMap };
}

export function useRulesetData() {
  const [rulesets, setRulesets] = useState<CategorizedRulesetConfig[]>(() => {
    const { precomputedRulesets } = buildPrecomputedState();
    const precomputedIds = new Set(precomputedRulesets.map((r) => r.id));

    const filteredInitial: CategorizedRulesetConfig[] = INITIAL_RULESETS
      .filter((r) => !precomputedIds.has(r.id))
      .map((r) => ({ ...r, category: 'Games' }));

    return [...filteredInitial, ...precomputedRulesets];
  });

  const [dataMap, setDataMap] = useState<Record<string, MetricData>>(() => {
    const { precomputedDataMap } = buildPrecomputedState();
    const initialMap: Record<string, MetricData> = { ...precomputedDataMap };

    INITIAL_RULESETS.forEach((r) => {
      if (!initialMap[r.id]) {
        initialMap[r.id] = {
          words: 0,
          characters: 0,
          content: '',
          wordSet: new Set(),
          wordCounts: new Map(),
          loading: true,
          error: null,
        };
      }
    });

    return initialMap;
  });

  useEffect(() => {
    let isMounted = true;

    const loadImportedRulesets = async () => {
      try {
        const { precomputedRulesets } = buildPrecomputedState();
        const precomputedIds = new Set(precomputedRulesets.map((r) => r.id));

        const importFiles = import.meta.glob('./templates/*.txt', { query: '?raw', import: 'default' });
        const filePaths = Object.keys(importFiles);

        if (filePaths.length === 0) return;

        const importedRulesets: CategorizedRulesetConfig[] = [];
        const importedDataMapEntries: [string, MetricData][] = [];

        for (const path of filePaths) {
          const rawFileName = path.split('/').pop()?.replace(/\.txt$/, '') || '';
          const id = rawFileName.toLowerCase().replace(/[^a-z0-9]/g, '');

          if (precomputedIds.has(id)) continue;

          const name = rawFileName ? rawFileName.charAt(0).toUpperCase() + rawFileName.slice(1) : 'Untitled';

          let rawText = '';
          try {
            rawText = (await importFiles[path]()) as string;
          } catch (fileErr) {
            console.error(`Failed to load template file '${path}':`, fileErr);
            continue;
          }

          const lines = rawText.trim().split('\n');
          const linkUrl = lines[0] ? lines[0].trim() : '#';
          const contentBody = lines.slice(1).join('\n');

          const blob = new Blob([contentBody], { type: 'text/plain' });
          const objectUrl = URL.createObjectURL(blob);

          importedRulesets.push({
            id,
            name,
            fetchUrl: objectUrl,
            linkUrl,
            homeUrl: '#',
            category: 'Templates',
          });

          importedDataMapEntries.push([
            id,
            {
              words: 0,
              characters: 0,
              content: '',
              wordSet: new Set(),
              wordCounts: new Map(),
              loading: true,
              error: null,
            },
          ]);
        }

        if (!isMounted || importedRulesets.length === 0) return;

        setRulesets((prev) => {
          const games = prev.filter((r) => r.category === 'Games');
          const templates = prev.filter((r) => r.category === 'Templates');

          const updatedTemplates = [...templates];
          importedRulesets.forEach((newRule) => {
            const index = updatedTemplates.findIndex((r) => r.id === newRule.id);
            if (index >= 0) {
              updatedTemplates[index] = newRule;
            } else {
              updatedTemplates.push(newRule);
            }
          });

          return [...games, ...updatedTemplates];
        });

        setDataMap((prev) => ({
          ...prev,
          ...Object.fromEntries(importedDataMapEntries),
        }));
      } catch (e) {
        console.error('Failure importing rulesets from /templates directory:', e);
      }
    };

    loadImportedRulesets();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    rulesets.forEach((ruleset) => {
      if (dataMap[ruleset.id] && !dataMap[ruleset.id].loading && !dataMap[ruleset.id].error) {
        return;
      }

      fetchMetrics(ruleset)
        .then((data) => {
          setDataMap((prev) => ({
            ...prev,
            [ruleset.id]: { ...data, loading: false, error: null },
          }));
        })
        .catch((err) => {
          setDataMap((prev) => ({
            ...prev,
            [ruleset.id]: { ...prev[ruleset.id], loading: false, error: err.message },
          }));
        });
    });
  }, [rulesets]);

  return { rulesets, dataMap };
}