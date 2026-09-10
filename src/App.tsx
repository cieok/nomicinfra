import { useState, useEffect, useMemo } from 'react';
import './App.css';
import {
  type RulesetConfig,
  type MetricData,
  INITIAL_RULESETS,
  HELP_TEXTS,
  calculateJaccardSimilarity,
  formatSizeComparison,
  getDistinctTopWords,
  fetchMetrics,
} from './utils/rulesetAnalysis';
import { PRECOMPUTED_RULESETS } from './precomputedRulesets';

// Interface extending ruleset configuration with explicit grouping
export interface CategorizedRulesetConfig extends RulesetConfig {
  category: 'Templates' | 'Games';
}

// Convert precomputed items into RulesetConfig and MetricData formats
function buildPrecomputedState() {
  const precomputedRulesets: CategorizedRulesetConfig[] = PRECOMPUTED_RULESETS.map((p) => ({
    id: p.id,
    name: p.name,
    fetchUrl: './', // Dummy path since content is pre-loaded
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

export function App() {
  const [rulesets, setRulesets] = useState<CategorizedRulesetConfig[]>(() => {
    const { precomputedRulesets } = buildPrecomputedState();
    const precomputedIds = new Set(precomputedRulesets.map((r) => r.id));

    // Initial fetched rulesets default to Games
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

  const [activeTabId, setActiveTabId] = useState<string>(INITIAL_RULESETS[0]?.id || rulesets[0]?.id || 'nomic');
  const [showRawText, setShowRawText] = useState<boolean>(false);
  const [showTopWordsHelp, setShowTopWordsHelp] = useState<boolean>(false);
  const [showUniqueWordsHelp, setShowUniqueWordsHelp] = useState<boolean>(false);
  const [selectedTopWord, setSelectedTopWord] = useState<string | null>(null);
  const [similarityFilter, setSimilarityFilter] = useState<'All' | 'Games' | 'Templates'>('All');

  // Helper function to handle switching active rulesets (resets view states)
  const handleSelectRuleset = (id: string) => {
    setActiveTabId(id);
    setShowRawText(false);
    setSelectedTopWord(null);
  };

  // Load imported template rulesets dynamically from the /templates directory
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
            category: 'Templates', // Local template files grouped under Templates
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

  // Group rulesets into categorized sets
  const groupedRulesets = useMemo(() => {
    return {
      Games: rulesets.filter((r) => r.category === 'Games'),
      Templates: rulesets.filter((r) => r.category === 'Templates'),
    };
  }, [rulesets]);

  // Fetch metrics only for rulesets that aren't loaded yet
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

  const currentRuleset = rulesets.find((r) => r.id === activeTabId) || rulesets[0];
  const currentMetrics = dataMap[currentRuleset?.id];

  const comparisons = useMemo(() => {
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
            error: otherMetrics?.error || 'Loading...',
          };
        }

        const score = calculateJaccardSimilarity(currentMetrics.wordSet, otherMetrics.wordSet);
        const sizeText = formatSizeComparison(currentMetrics.words, otherMetrics.words);

        return {
          ruleset: other,
          score,
          sizeText,
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

  return (
    <div className="app-container">
      <header className="app-header">
        <h1>Nomic ruleset comparison</h1>
      </header>

      <div className="layout-body">
        {/* Sidebar Navigation */}
        <aside className="sidebar-nav">
          {Object.entries(groupedRulesets).map(([category, items]) => {
            if (items.length === 0) return null;
            return (
              <div key={category} className="nav-group">
                <div className="group-label">{category}</div>
                <div className="nav-list">
                  {items.map((ruleset) => {
                    const isActive = ruleset.id === activeTabId;
                    return (
                      <button
                        key={ruleset.id}
                        onClick={() => handleSelectRuleset(ruleset.id)}
                        className={`nav-item ${isActive ? 'active' : ''}`}
                      >
                        {ruleset.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </aside>

        {/* Main Content Area */}
        <main className="main-content">
          {!currentMetrics || currentMetrics.loading ? (
            <p>Loading ruleset data...</p>
          ) : currentMetrics.error ? (
            <p className="error-text">
              Error loading {currentRuleset.name}: {currentMetrics.error}
            </p>
          ) : (
            <div>
              <div className="header-container">
                <div>
                  <h2 className="title-primary">{currentRuleset.name}</h2>
                  {akaListWords.length > 0 && (
                    <p className="aka-subtitle">
                      aka{' '}
                      {akaListWords
                        .map((word) => `${word.charAt(0).toUpperCase() + word.slice(1)} Nomic`)
                        .join(' aka ') + ' 😉'}
                    </p>
                  )}
                </div>
                <div className="header-links">
                  {currentRuleset.category === 'Templates' ? (
                    <span className="template-badge">
                      Template
                    </span>
                  ) : (
                    currentRuleset.homeUrl !== '#' && (
                      <a href={currentRuleset.homeUrl} target="_blank" rel="noreferrer" className="external-link">
                        View Game ↗
                      </a>
                    )
                  )}

                  {currentRuleset.linkUrl !== '#' && (
                    <a href={currentRuleset.linkUrl} target="_blank" rel="noreferrer" className="external-link">
                      View Ruleset ↗
                    </a>
                  )}
                </div>
              </div>

              <div className="card">
                <div className="section-header">
                  <h3>Top Words in Ruleset</h3>
                  <button
                    onClick={() => setShowTopWordsHelp(!showTopWordsHelp)}
                    className="help-button"
                    title={HELP_TEXTS.topWords(currentRuleset.name)}
                  >
                    ?
                  </button>
                </div>

                {showTopWordsHelp && (
                  <p className="help-text" title={HELP_TEXTS.topWords(currentRuleset.name)}>
                    {HELP_TEXTS.topWords(currentRuleset.name)}
                  </p>
                )}

                <div className="words-container top-words-container">
                  {topWords.length > 0 ? (
                    topWords.map(({ word, score, count }) => {
                      const textContent = `Appears ${count} times. ${score.toFixed(1)}x more frequent than in normalized ruleset.`;
                      const isSelected = selectedTopWord === word;

                      return (
                        <span
                          key={word}
                          title={textContent}
                          onClick={() => setSelectedTopWord(isSelected ? null : word)}
                          className={`word-badge help-cursor ${isSelected ? 'selected-badge' : ''}`}
                          style={{ cursor: 'pointer' }}
                        >
                          <span>{word}</span>
                          <span className="count-pill">{count}</span>
                        </span>
                      );
                    })
                  ) : (
                    <span className="empty-words-text">No top words found.</span>
                  )}
                </div>

                {selectedTopWord && (() => {
                  const activeItem = topWords.find((item) => item.word === selectedTopWord);
                  if (!activeItem) return null;
                  const detailText = `Appears ${activeItem.count} times. ${activeItem.score.toFixed(1)}x more frequent than in normalized ruleset.`;

                  return (
                    <div
                      className="help-text"
                      title={detailText}
                      style={{ marginTop: '12px', display: 'flex', alignItems: 'center' }}
                    >
                      <span>
                        <strong>{activeItem.word}:</strong> {detailText}
                      </span>
                      <button
                        onClick={() => setSelectedTopWord(null)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}
                      >
                        ✕
                      </button>
                    </div>
                  );
                })()}
              </div>

              <div className="metrics-grid">
                <div className="metric-card">
                  <div className="metric-label">Ruleset size</div>
                  <div className="metric-value">{currentMetrics.words.toLocaleString()} words</div>
                </div>
                <div className="metric-card">
                  <div className="metric-label">Unique words</div>
                  <div className="metric-value highlight">
                    {currentMetrics.wordSet.size.toLocaleString()}
                  </div>
                </div>
              </div>

              <div className="card">
                <div className="section-header" style={{justifyContent: 'space-between', gap: '8px' }}>
                  <h3 style={{ margin: 0 }}>Similarity to Other Nomics</h3>
                  <div style={{ display: 'flex', gap: '4px', background: 'rgba(0,0,0,0.05)', padding: '3px', borderRadius: '6px' }}>
                    {(['All', 'Games', 'Templates'] as const).map((filter) => (
                      <button
                        key={filter}
                        onClick={() => setSimilarityFilter(filter)}
                        style={{
                          background: similarityFilter === filter ? '#fff' : 'transparent',
                          border: 'none',
                          borderRadius: '4px',
                          padding: '4px 10px',
                          fontSize: '0.8rem',
                          fontWeight: similarityFilter === filter ? 600 : 400,
                          color: similarityFilter === filter ? 'var(--text-primary, #111)' : 'var(--text-secondary, #666)',
                          cursor: 'pointer',
                          boxShadow: similarityFilter === filter ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        {filter}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="comparisons-list" style={{ marginTop: '16px' }}>
                  {comparisons.length > 0 ? (
                    comparisons.map(({ ruleset, score, sizeText, error }) => (
                      <div key={ruleset.id} className="comparison-item">
                        <div className="comparison-header">
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <button
                              onClick={() => handleSelectRuleset(ruleset.id)}
                              className="comparison-title-button"
                              style={{
                                background: 'none',
                                border: 'none',
                                padding: 0,
                                font: 'inherit',
                                color: 'inherit',
                                fontWeight: 600,
                                cursor: 'pointer',
                                textDecoration: 'underline',
                                textDecorationColor: 'transparent',
                                transition: 'text-decoration-color 0.15s ease',
                              }}
                              onMouseEnter={(e) => (e.currentTarget.style.textDecorationColor = 'currentColor')}
                              onMouseLeave={(e) => (e.currentTarget.style.textDecorationColor = 'transparent')}
                            >
                              {ruleset.name}
                            </button>
                            {ruleset.category === 'Templates' ? (
                              <span className="template-badge" style={{ fontSize: '0.75rem', padding: '2px 6px' }}>
                                Template
                              </span>
                            ) : (
                              <span
                                style={{
                                  fontSize: '0.75rem',
                                  color: 'var(--text-secondary, #666)',
                                  background: 'rgba(0,0,0,0.05)',
                                  padding: '2px 6px',
                                  borderRadius: '4px',
                                }}
                              >
                                Game
                              </span>
                            )}
                          </div>
                          <span>{score !== null ? `${score.toFixed(1)}% match` : error}</span>
                        </div>

                        {score !== null && (
                          <div className="progress-bar-track">
                            <div
                              className="progress-bar-fill"
                              style={{ '--progress-width': `${Math.min(100, Math.max(0, score))}%` } as React.CSSProperties}
                            />
                          </div>
                        )}

                        {score !== null && sizeText !== null && (
                          <div className="comparison-size">
                            Size: {sizeText}
                          </div>
                        )}
                      </div>
                    ))
                  ) : (
                    <span className="empty-words-text">No matching rulesets found for this filter.</span>
                  )}
                </div>
              </div>

              <div className="card">
                <div className="section-header">
                  <h3>Unique Words in Ruleset</h3>
                  <button
                    onClick={() => setShowUniqueWordsHelp(!showUniqueWordsHelp)}
                    className="help-button"
                    title={HELP_TEXTS.uniqueWords(currentRuleset.name)}
                  >
                    ?
                  </button>
                </div>

                {showUniqueWordsHelp && (
                  <p className="help-text" title={HELP_TEXTS.uniqueWords(currentRuleset.name)}>
                    {HELP_TEXTS.uniqueWords(currentRuleset.name)}
                  </p>
                )}

                <div className="words-container unique-words-container">
                  {uniqueWordsWithCounts.length > 0 ? (
                    uniqueWordsWithCounts.map(({ word, count }) => (
                      <span key={word} className="word-badge">
                        <span>{word}</span>
                        <span className="count-pill">{count}</span>
                      </span>
                    ))
                  ) : (
                    <span className="empty-words-text">No unique words found.</span>
                  )}
                </div>
              </div>

              <div>
                <button
                  onClick={() => setShowRawText(!showRawText)}
                  className="preview-toggle-button"
                >
                  📄 {showRawText ? 'Hide' : 'Show'} Ruleset Preview
                </button>

                {showRawText && (
                  <pre className="raw-text-preview">
                    {currentMetrics.content}
                  </pre>
                )}
              </div>
            </div>
          )}

          <div className="card" style={{ marginTop: '24px' }}>
            <div className="header-links" style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '16px' }}>
              <a href="https://nomic.fandom.com/wiki/Leaderboards" target="_blank" rel="noreferrer" className="external-link">
                More games, more comparisons and Fandom pages ↗
              </a>
              <a href="https://kiako.me/nomic/" target="_blank" rel="noreferrer" className="external-link">
                Introduction to Nomic ↗
              </a>
            </div>

            <div className="header-links" style={{ marginBottom: '16px' }}>
              <a href="https://github.com/cieok/nomicinfra" target="_blank" rel="noreferrer" className="external-link">
                GitHub repository of this page ↗
              </a>
            </div>

            <div style={{ marginTop: '12px', textAlign: 'right' }}>
              <button
                onClick={handleExportTs}
                aria-label="Export"
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'rgba(0, 0, 0, 0.08)',
                  fontSize: '0.7rem',
                  cursor: 'pointer',
                  padding: '2px 4px',
                  outline: 'none',
                  boxShadow: 'none',
                }}
              >
                .
              </button>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

export default App;