import { useState, useEffect, useMemo } from 'react';

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

// Words to explicitly block from becoming AKA titles (structural/meta words)
const BANNED_AKA_WORDS = new Set([
  'Decision',
  'rules',
  'ruleset',
  'section',
  'page',
  'wikitext',
  'http',
  'https',
  'action',
  'parse',
  'format',
  'index',
  'title',
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
  Filters characteristic words to avoid ones similar to the original name or to previously selected words.
 */
function getDistinctCharacteristicWords(
  characteristicWords: { word: string; score: number; count: number }[],
  baseName: string,
  limit: number = 4
): string[] {
  const result: string[] = [];
  const basePrefix = baseName.toLowerCase().replace(/nomic/g, '').trim();

  for (const item of characteristicWords) {
    if (result.length >= limit) break;
    const lowerWord = item.word.toLowerCase();

    if (BANNED_AKA_WORDS.has(lowerWord)) continue;

    // Skip words that match or start with the base name prefix
    const isTooSimilarToBase = basePrefix && (lowerWord.startsWith(basePrefix) || basePrefix.startsWith(lowerWord));

    // Skip words sharing stems/prefixes with previously selected AKA words
    const isDuplicateOrStem = result.some((selected) => {
      const lowerSelected = selected.toLowerCase();
      const minLength = Math.min(lowerSelected.length, lowerWord.length);
      const prefixLength = Math.min(3, minLength);

      return (
        lowerSelected.substring(0, prefixLength) === lowerWord.substring(0, prefixLength) ||
        lowerWord.includes(lowerSelected) ||
        lowerSelected.includes(lowerWord)
      );
    });

    if (!isTooSimilarToBase && !isDuplicateOrStem) {
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

  // Characteristic Words list (Smoothed Relative Frequency)
  const characteristicWords = useMemo(() => {
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

  // Derive top 4 distinct characteristic words for AKA titles
  const akaListWords = useMemo(() => {
    return getDistinctCharacteristicWords(characteristicWords, currentRuleset.name, 4);
  }, [characteristicWords, currentRuleset.name]);

  return (
    <div style={{ maxWidth: '1000px', margin: '2rem auto', fontFamily: 'sans-serif', padding: '0 1rem' }}>
      <h1>Nomic games comparison</h1>

      {/* Navigation Tabs */}
      <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '2px solid #e2e8f0', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        {RULESETS.map((ruleset) => {
          const isActive = ruleset.id === activeTabId;
          return (
            <button
              key={ruleset.id}
              onClick={() => {
                setActiveTabId(ruleset.id);
                setShowRawText(false);
              }}
              style={{
                padding: '0.75rem 1.25rem',
                border: 'none',
                borderBottom: isActive ? '3px solid #2563eb' : '3px solid transparent',
                background: isActive ? '#eff6ff' : 'transparent',
                fontWeight: isActive ? 'bold' : 'normal',
                color: isActive ? '#1d4ed8' : '#64748b',
                cursor: 'pointer',
                fontSize: '1rem',
                borderRadius: '6px 6px 0 0',
              }}
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
        <p style={{ color: '#dc2626' }}>
          Error loading {currentRuleset.name}: {currentMetrics.error}
        </p>
      ) : (
        <div>
          {/* Header Info with AKA Titles */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
            <div>
              <h2 style={{ margin: 0 }}>{currentRuleset.name}</h2>
              {akaListWords.length > 0 && (
                <p style={{ color: '#475569', margin: '0.35rem 0 0 0', fontSize: '0.95rem', fontStyle: 'italic' }}>
                  aka{' '}
                  {akaListWords
                    .map((word) => `${word.charAt(0).toUpperCase() + word.slice(1)} Nomic`)
                    .join(' aka ')}
                </p>
              )}
            </div>
            <div style={{ display: 'flex', gap: '1rem', marginTop: '0.25rem' }}>
              <a href={currentRuleset.homeUrl} target="_blank" rel="noreferrer" style={{ color: '#2563eb', textDecoration: 'underline' }}>
                View Game ↗
              </a>
              <a href={currentRuleset.linkUrl} target="_blank" rel="noreferrer" style={{ color: '#2563eb', textDecoration: 'underline' }}>
                View Ruleset ↗
              </a>
            </div>
          </div>

          {/* Characteristic Words Section */}
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', padding: '1.5rem', borderRadius: '8px', marginBottom: '2rem' }}>
            <h3 style={{ marginTop: 0 }}>Most Characteristic Words</h3>
            <p style={{ fontSize: '0.875rem', color: '#64748b', marginTop: '-0.5rem' }}>
              Words ordered by how disproportionately often they appear in <strong>{currentRuleset.name}</strong> relative to the other rulesets (normalized by total words).
            </p>

            <div style={{ maxHeight: '250px', overflowY: 'auto', display: 'flex', flexWrap: 'wrap', gap: '0.35rem', padding: '0.5rem', background: '#f1f5f9', borderRadius: '6px' }}>
              {characteristicWords.length > 0 ? (
                characteristicWords.map(({ word, score, count }) => {
                  const formattedScore = score >= 10 ? `${Math.round(score)}x` : `${score.toFixed(1)}x`;

                  return (
                    <span
                      key={word}
                      title={`Appears ${count} times. ${score.toFixed(1)}x more frequent here.`}
                      style={{
                        background: '#ffffff',
                        border: '1px solid #cbd5e1',
                        padding: '0.2rem 0.5rem',
                        borderRadius: '4px',
                        fontSize: '0.8rem',
                        color: '#1e293b',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.35rem',
                        cursor: 'help',
                      }}
                    >
                      <span>{word}</span>
                      <span
                        style={{
                          background: '#e2e8f0',
                          color: '#475569',
                          borderRadius: '999px',
                          padding: '0.05rem 0.35rem',
                          fontSize: '0.7rem',
                          fontWeight: 'bold',
                        }}
                      >
                        {formattedScore}
                      </span>
                    </span>
                  );
                })
              ) : (
                <span style={{ fontSize: '0.85rem', color: '#64748b' }}>No highly characteristic words found.</span>
              )}
            </div>
          </div>

          {/* Core Metrics Totals */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
            <div style={{ background: '#f8fafc', padding: '1rem', border: '1px solid #e2e8f0', borderRadius: '6px' }}>
              <div style={{ fontSize: '0.85rem', color: '#64748b' }}>Ruleset size</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{currentMetrics.words.toLocaleString()} words</div>
            </div>
            <div style={{ background: '#f8fafc', padding: '1rem', border: '1px solid #e2e8f0', borderRadius: '6px' }}>
              <div style={{ fontSize: '0.85rem', color: '#64748b' }}>Unique Vocabulary</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#2563eb' }}>
                {currentMetrics.wordSet.size.toLocaleString()} terms
              </div>
            </div>
          </div>

          {/* Similarity Analysis Section */}
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', padding: '1.5rem', borderRadius: '8px', marginBottom: '2rem' }}>
            <h3 style={{ marginTop: 0 }}>Similarity to Other Nomics</h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {comparisons.map(({ ruleset, score, sizeText, error }) => (
                <div key={ruleset.id} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', borderBottom: '1px solid #f1f5f9', paddingBottom: '0.75rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.95rem' }}>
                    <span style={{ fontWeight: 'bold' }}>{ruleset.name}</span>
                    <span>{score !== null ? `${score.toFixed(1)}% match` : error}</span>
                  </div>

                  {score !== null && (
                    <div style={{ height: '10px', background: '#e2e8f0', borderRadius: '5px', overflow: 'hidden' }}>
                      <div
                        style={{
                          height: '100%',
                          width: `${Math.min(100, Math.max(0, score))}%`,
                          background: '#2563eb',
                          borderRadius: '5px',
                        }}
                      />
                    </div>
                  )}

                  {score !== null && sizeText !== null && (
                    <div style={{ textAlign: 'left', fontSize: '0.85rem', color: '#475569' }}>
                      Size: {sizeText}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Unique Words Section */}
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', padding: '1.5rem', borderRadius: '8px', marginBottom: '2rem' }}>
            <h3 style={{ marginTop: 0 }}>Unique Words in Ruleset</h3>
            <p style={{ fontSize: '0.875rem', color: '#64748b', marginTop: '-0.5rem' }}>
              Words that appear in <strong>{currentRuleset.name}</strong> ruleset but do not appear in any other active ruleset, ordered by occurrences.
            </p>

            <div style={{ maxHeight: '250px', overflowY: 'auto', display: 'flex', flexWrap: 'wrap', gap: '0.35rem', padding: '0.5rem', background: '#f1f5f9', borderRadius: '6px' }}>
              {uniqueWordsWithCounts.length > 0 ? (
                uniqueWordsWithCounts.map(({ word, count }) => (
                  <span
                    key={word}
                    style={{
                      background: '#ffffff',
                      border: '1px solid #cbd5e1',
                      padding: '0.2rem 0.5rem',
                      borderRadius: '4px',
                      fontSize: '0.8rem',
                      color: '#1e293b',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                    }}
                  >
                    <span>{word}</span>
                    <span
                      style={{
                        background: '#e2e8f0',
                        color: '#475569',
                        borderRadius: '999px',
                        padding: '0.05rem 0.35rem',
                        fontSize: '0.7rem',
                        fontWeight: 'bold',
                      }}
                    >
                      {count}
                    </span>
                  </span>
                ))
              ) : (
                <span style={{ fontSize: '0.85rem', color: '#64748b' }}>No unique words found.</span>
              )}
            </div>
          </div>

          {/* Ruleset Preview Toggle */}
          <div>
            <button
              onClick={() => setShowRawText(!showRawText)}
              style={{
                background: '#f1f5f9',
                border: '1px solid #cbd5e1',
                padding: '0.5rem 1rem',
                borderRadius: '4px',
                cursor: 'pointer',
                fontWeight: 'bold',
              }}
            >
              📄 {showRawText ? 'Hide' : 'Show'} Ruleset Preview
            </button>

            {showRawText && (
              <pre
                style={{
                  marginTop: '1rem',
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  padding: '1rem',
                  borderRadius: '6px',
                  maxHeight: '400px',
                  overflowY: 'auto',
                  fontSize: '0.85rem',
                  whiteSpace: 'pre-wrap',
                }}
              >
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