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

export function App() {
  const [rulesets, setRulesets] = useState<RulesetConfig[]>(INITIAL_RULESETS);
  const [dataMap, setDataMap] = useState<Record<string, MetricData>>(() => {
    const initialMap: Record<string, MetricData> = {};
    INITIAL_RULESETS.forEach((r) => {
      initialMap[r.id] = {
        words: 0,
        characters: 0,
        content: '',
        wordSet: new Set(),
        wordCounts: new Map(),
        loading: true,
        error: null,
      };
    });
    return initialMap;
  });

  const [activeTabId, setActiveTabId] = useState<string>(INITIAL_RULESETS[0].id);
  const [showRawText, setShowRawText] = useState<boolean>(false);
  const [showTopWordsHelp, setShowTopWordsHelp] = useState<boolean>(false);
  const [showUniqueWordsHelp, setShowUniqueWordsHelp] = useState<boolean>(false);
  const [selectedTopWord, setSelectedTopWord] = useState<string | null>(null);

  // Load local import-template.txt on initialization
  useEffect(() => {
    let isMounted = true;

    const loadImportedRuleset = async () => {
      try {
        const res = await fetch('./import-template.txt');
        if (!res.ok || !isMounted) return;

        const rawText = await res.text();
        const lines = rawText.trim().split('\n');
        if (lines.length === 0 || !lines[0].trim()) return;

        const name = lines[0].trim();
        const linkUrl = lines[1] ? lines[1].trim() : '#';
        const id = name.toLowerCase().replace(/[^a-z0-9]/g, '');

        // Set homeUrl to '#' for imported local templates so "View Game" is omitted
        const homeUrl = '#';

        const contentBody = lines.slice(2).join('\n');
        const blob = new Blob([contentBody], { type: 'text/plain' });
        const objectUrl = URL.createObjectURL(blob);

        const newRuleset: RulesetConfig = {
          id,
          name,
          fetchUrl: objectUrl,
          linkUrl,
          homeUrl,
        };

        if (!isMounted) return;

        // Strictly set rulesets to INITIAL_RULESETS + 1 imported template (4 tabs total)
        setRulesets([...INITIAL_RULESETS, newRuleset]);
        setDataMap((prev) => ({
          ...prev,
          [id]: {
            words: 0,
            characters: 0,
            content: '',
            wordSet: new Set(),
            wordCounts: new Map(),
            loading: true,
            error: null,
          },
        }));
      } catch (e) {
        console.warn('Failed to import local import-template.txt file:', e);
      }
    };

    loadImportedRuleset();

    return () => {
      isMounted = false;
    };
  }, []);

  // Fetch metrics whenever the rulesets array changes
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

  const currentRuleset = rulesets.find((r) => r.id === activeTabId) || rulesets[0];
  const currentMetrics = dataMap[currentRuleset.id];

  const comparisons = useMemo(() => {
    if (!currentMetrics || currentMetrics.loading || currentMetrics.error) return [];

    return rulesets.filter((r) => r.id !== currentRuleset.id).map((other) => {
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
    });
  }, [currentRuleset, currentMetrics, dataMap, rulesets]);

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
    return getDistinctTopWords(topWords, currentRuleset.name, 4);
  }, [topWords, currentRuleset.name]);

  return (
    <div className="app-container">
      <h1>Nomic ruleset comparison</h1>

      <div className="nav-tabs">
        {rulesets.map((ruleset) => {
          const isActive = ruleset.id === activeTabId;
          return (
            <button
              key={ruleset.id}
              onClick={() => {
                setActiveTabId(ruleset.id);
                setShowRawText(false);
                setSelectedTopWord(null);
              }}
              className={`tab-button ${isActive ? 'active' : ''}`}
            >
              {ruleset.name}
            </button>
          );
        })}
      </div>

      {currentMetrics?.loading ? (
        <p>Loading ruleset data...</p>
      ) : currentMetrics?.error ? (
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
              {currentRuleset.homeUrl !== '#' && (
                <a href={currentRuleset.homeUrl} target="_blank" rel="noreferrer" className="external-link">
                  View Game ↗
                </a>
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
            <h3 style={{ marginTop: 0 }}>Similarity to Other Nomics</h3>

            <div className="comparisons-list">
              {comparisons.map(({ ruleset, score, sizeText, error }) => (
                <div key={ruleset.id} className="comparison-item">
                  <div className="comparison-header">
                    <span className="comparison-title">{ruleset.name}</span>
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
              ))}
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

        <div className="header-links">
          <a href="https://github.com/cieok/nomicinfra" target="_blank" rel="noreferrer" className="external-link">
            GitHub repository of this page ↗
          </a>
        </div>
      </div>
    </div>
  );
}

export default App;