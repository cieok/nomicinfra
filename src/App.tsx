import { useState, useEffect, useMemo } from 'react';
import './App.css';

interface RulesetConfig {
  id: string;
  name: string;
  fetchUrl: string;
  linkUrl: string;
  homeUrl: string;
  isJsonApi?: boolean;
}

const RULESETS: RulesetConfig[] = [
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

// Structural, procedural, or meta words strictly forbidden from appearing in AKA titles
const BANNED_AKA_WORDS = new Set([
  'decision',
  'decisions',
  'server',
  'votable',
  'post',
  'switch',
  'page',
  'wikitext',
  'http',
  'https',
  'action',
  'parse',
  'format',
  'index',
  'title',
  'nomic',
]);

interface MetricData {
  words: number;
  characters: number;
  content: string;
  wordSet: Set<string>;
  wordCounts: Map<string, number>;
  loading: boolean;
  error: string | null;
}

function calculateJaccardSimilarity(setA: Set<string>, setB: Set<string>): number {
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersectionSize = 0;
  setA.forEach((word) => {
    if (setB.has(word)) {
      intersectionSize++;
    }
  });

  const unionSize = new Set([...setA, ...setB]).size;
  return unionSize > 0 ? (intersectionSize / unionSize) * 100 : 0;
}

function formatSizeComparison(currentWords: number, targetWords: number): string {
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

/**
 * Robust check to see if two words share a common root stem
 */
function shareCommonStem(w1: string, w2: string): boolean {
  const minLength = Math.min(w1.length, w2.length);
  const prefixLength = Math.min(4, minLength);
  
  if (w1.substring(0, prefixLength) === w2.substring(0, prefixLength)) {
    return true;
  }
  return w1.includes(w2) || w2.includes(w1);
}

/**
 * Selects top distinct words guaranteed to exclude banned words and duplicate word roots.
 */
function getDistinctTopWords(
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

export function App() {
  const [dataMap, setDataMap] = useState<Record<string, MetricData>>(() => {
    const initialMap: Record<string, MetricData> = {};
    RULESETS.forEach((r) => {
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

  const [activeTabId, setActiveTabId] = useState<string>(RULESETS[0].id);
  const [showRawText, setShowRawText] = useState<boolean>(false);
  
  // State toggles for hiding explanations behind question marks
  const [showTopWordsHelp, setShowTopWordsHelp] = useState<boolean>(false);
  const [showUniqueWordsHelp, setShowUniqueWordsHelp] = useState<boolean>(false);

  const fetchMetrics = async (ruleset: RulesetConfig): Promise<Omit<MetricData, 'loading' | 'error'>> => {
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
  };

  useEffect(() => {
    RULESETS.forEach((ruleset) => {
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
  }, []);

  const currentRuleset = RULESETS.find((r) => r.id === activeTabId) || RULESETS[0];
  const currentMetrics = dataMap[currentRuleset.id];

  const comparisons = useMemo(() => {
    if (!currentMetrics || currentMetrics.loading || currentMetrics.error) return [];

    return RULESETS.filter((r) => r.id !== currentRuleset.id).map((other) => {
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
  }, [currentRuleset, currentMetrics, dataMap]);

  // Unique Words list
  const uniqueWordsWithCounts = useMemo(() => {
    if (!currentMetrics || currentMetrics.loading || currentMetrics.error) return [];

    const otherWordsSet = new Set<string>();
    RULESETS.forEach((r) => {
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
  }, [currentRuleset, currentMetrics, dataMap]);

  // Top Words list (Smoothed Relative Frequency)
  const topWords = useMemo(() => {
    if (!currentMetrics || currentMetrics.loading || currentMetrics.error) return [];

    let otherTotalWords = 0;
    const otherWordCounts = new Map<string, number>();

    RULESETS.forEach((r) => {
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
  }, [currentRuleset, currentMetrics, dataMap]);

  // Derive top 4 distinct words for AKA titles
  const akaListWords = useMemo(() => {
    return getDistinctTopWords(topWords, currentRuleset.name, 4);
  }, [topWords, currentRuleset.name]);

  return (
    <div className="app-container">
      <h1>Nomic games comparison</h1>

      {/* Navigation Tabs */}
      <div className="nav-tabs">
        {RULESETS.map((ruleset) => {
          const isActive = ruleset.id === activeTabId;
          return (
            <button
              key={ruleset.id}
              onClick={() => {
                setActiveTabId(ruleset.id);
                setShowRawText(false);
              }}
              className={`tab-button ${isActive ? 'active' : ''}`}
            >
              {ruleset.name}
            </button>
          );
        })}
      </div>

      {/* Main View for Active Nomic */}
      {currentMetrics.loading ? (
        <p>Loading ruleset data...</p>
      ) : currentMetrics.error ? (
        <p className="error-text">
          Error loading {currentRuleset.name}: {currentMetrics.error}
        </p>
      ) : (
        <div>
          {/* Header Info with AKA Titles */}
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
              <a href={currentRuleset.homeUrl} target="_blank" rel="noreferrer" className="external-link">
                View Game ↗
              </a>
              <a href={currentRuleset.linkUrl} target="_blank" rel="noreferrer" className="external-link">
                View Ruleset ↗
              </a>
            </div>
          </div>

          {/* Top Words Section */}
          <div className="card">
            <div className="section-header">
              <h3>Top Words</h3>
              <button
                onClick={() => setShowTopWordsHelp(!showTopWordsHelp)}
                className="help-button"
                title="Click to toggle explanation"
              >
                ?
              </button>
            </div>

            {showTopWordsHelp && (
              <p className="help-text">
                Words ordered by how disproportionately often they appear in <strong>{currentRuleset.name}</strong> ruleset relative to the other rulesets (normalized by total words).
              </p>
            )}

            <div className="words-container top-words-container">
              {topWords.length > 0 ? (
                topWords.map(({ word, score, count }) => {
                  const formattedScore = score >= 10 ? `${Math.round(score)}` : `${score.toFixed(1)}`;

                  return (
                    <span
                      key={word}
                      title={`Appears ${count} times. ${score.toFixed(1)}x more frequent here.`}
                      className="word-badge help-cursor"
                    >
                      <span>{word}</span>
                      <span className="count-pill">
                        {formattedScore}
                      </span>
                    </span>
                  );
                })
              ) : (
                <span className="empty-words-text">No top words found.</span>
              )}
            </div>
          </div>

          {/* Core Metrics Totals */}
          <div className="metrics-grid">
            <div className="metric-card">
              <div className="metric-label">Ruleset size</div>
              <div className="metric-value">{currentMetrics.words.toLocaleString()} words</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Unique Vocabulary</div>
              <div className="metric-value highlight">
                {currentMetrics.wordSet.size.toLocaleString()} terms
              </div>
            </div>
          </div>

          {/* Similarity Analysis Section */}
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

          {/* Unique Words Section */}
          <div className="card">
            <div className="section-header">
              <h3>Unique Words in Ruleset</h3>
              <button
                onClick={() => setShowUniqueWordsHelp(!showUniqueWordsHelp)}
                className="help-button"
                title="Click to toggle explanation"
              >
                ?
              </button>
            </div>

            {showUniqueWordsHelp && (
              <p className="help-text">
                Words that appear in <strong>{currentRuleset.name}</strong> ruleset but do not appear in any other active ruleset, ordered by occurrences.
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

          {/* Ruleset Preview Toggle */}
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
    </div>
  );
}

export default App;