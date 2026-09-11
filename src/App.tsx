import React, { useState, useMemo } from 'react';
import './App.css';
import {
  INITIAL_RULESETS,
  HELP_TEXTS,
  calculateJaccardSimilarity,
  formatSizeComparison,
  getDistinctTopWords,
} from './utils/rulesetAnalysis';
import { useRulesetData } from './useRulesetData';

export function App() {
  const { rulesets, dataMap } = useRulesetData();

  const [activeTabId, setActiveTabId] = useState<string>(INITIAL_RULESETS[0]?.id || rulesets[0]?.id || 'nomic');
  const [showRawText, setShowRawText] = useState<boolean>(false);
  const [showTopWordsHelp, setShowTopWordsHelp] = useState<boolean>(false);
  const [showUniqueWordsHelp, setShowUniqueWordsHelp] = useState<boolean>(false);
  const [selectedTopWord, setSelectedTopWord] = useState<string | null>(null);
  const [similarityFilter, setSimilarityFilter] = useState<'All' | 'Games' | 'Templates'>('All');

  const handleSelectRuleset = (id: string) => {
    setActiveTabId(id);
    setShowRawText(false);
    setSelectedTopWord(null);
  };

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
    <div className="app-container">
      <header className="app-header">
        <h1>Nomic ruleset comparison</h1>
      </header>

      <div className="layout-body">
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
                  {currentRuleset.category !== 'Templates' && relativeAge && (
                    <p className="last-changed-subtitle">
                      Current ruleset is{' '}
                      <span className="last-changed-value" style={{ color: dateColor }}>
                        {relativeAge}
                      </span>
                    </p>
                  )}
                </div>
                <div className="header-links">
                  {currentRuleset.category === 'Templates' ? (
                    <span className="template-badge">Template</span>
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
                    <div className="help-text top-word-detail" title={detailText}>
                      <span>
                        <strong>{activeItem.word}:</strong> {detailText}
                      </span>
                      <button onClick={() => setSelectedTopWord(null)} className="close-detail-button">
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
                <div className="section-header similarity-header">
                  <h3 className="similarity-header-title">Similarity to Other Nomics</h3>
                  <div className="similarity-filter-group">
                    {(['All', 'Games', 'Templates'] as const).map((filter) => (
                      <button
                        key={filter}
                        onClick={() => setSimilarityFilter(filter)}
                        className={`similarity-filter-button ${similarityFilter === filter ? 'active' : ''}`}
                      >
                        {filter}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="comparisons-list">
                  {comparisons.length > 0 ? (
                    comparisons.map(({ ruleset, score, sizeText, indicatorColor, error }) => (
                      <div key={ruleset.id} className="comparison-item">
                        <div className="comparison-header">
                          <div className="comparison-title-container">
                            <button
                              onClick={() => handleSelectRuleset(ruleset.id)}
                              className="comparison-title-button"
                            >
                              {ruleset.name}
                            </button>
                            {ruleset.category === 'Templates' ? (
                              <span className="template-badge badge-template-small">Template</span>
                            ) : (
                              <span
                                className="badge-game"
                                style={{
                                  color: indicatorColor !== 'inherit' ? indicatorColor : 'var(--text-secondary, #666)',
                                  background: indicatorColor !== 'inherit' ? `${indicatorColor}15` : 'rgba(0,0,0,0.05)',
                                  fontWeight: indicatorColor !== 'inherit' ? 600 : 400,
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
                          <div className="comparison-size">Size: {sizeText}</div>
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
                <button onClick={() => setShowRawText(!showRawText)} className="preview-toggle-button">
                  📄 {showRawText ? 'Hide' : 'Show'} Ruleset Preview
                </button>

                {showRawText && <pre className="raw-text-preview">{currentMetrics.content}</pre>}
              </div>
            </div>
          )}

          <div className="card footer-card">
            <div className="header-links footer-links">
              <a href="https://nomic.fandom.com/wiki/Leaderboards" target="_blank" rel="noreferrer" className="external-link">
                More games, more comparisons and Fandom pages ↗
              </a>
              <a href="https://kiako.me/nomic/" target="_blank" rel="noreferrer" className="external-link">
                Introduction to Nomic ↗
              </a>
              <a href="https://github.com/cieok/nomicinfra" target="_blank" rel="noreferrer" className="external-link">
                GitHub repository of this page ↗
              </a>
            </div>
          </div>

          <div className="export-trigger-container">
            <button
              onClick={handleExportTs}
              aria-label="Export"
              className="export-trigger-button"
            >
              .
            </button>
          </div>
        </main>
      </div>
    </div>
  );
}

export default App;