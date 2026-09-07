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
    fetchUrl: 'https://agoranomic.org/ruleset/flr-fresh.txt',
    linkUrl: 'https://agoranomic.org/ruleset/flr-fresh.txt',
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

interface MetricData {
  words: number;
  characters: number;
  lines: number;
  hasImmutable: boolean;
  content: string;
  wordSet: Set<string>;
  loading: boolean;
  error: string | null;
}

/**
 * Calculates Jaccard Similarity between two sets of unique words.
 * Returns a percentage value between 0 and 100.
 */
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

/**
 * Formats comparative word count size as "X times bigger" or "X times smaller".
 */
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

export function App() {
  const [dataMap, setDataMap] = useState<Record<string, MetricData>>(() => {
    const initialMap: Record<string, MetricData> = {};
    RULESETS.forEach((r) => {
      initialMap[r.id] = {
        words: 0,
        characters: 0,
        lines: 0,
        hasImmutable: false,
        content: '',
        wordSet: new Set(),
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

    const hasImmutable = /\bimmutable\b/i.test(text);

    return {
      words: text.trim() ? text.trim().split(/\s+/).length : 0,
      characters: text.length,
      lines: text ? text.split('\n').length : 0,
      hasImmutable,
      content: text,
      wordSet: new Set(tokens),
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

  // Compare selected Nomic against all other Nomics
  const comparisons = useMemo(() => {
    if (!currentMetrics || currentMetrics.loading || currentMetrics.error) return [];

    return RULESETS.filter((r) => r.id !== currentRuleset.id).map((other) => {
      const otherMetrics = dataMap[other.id];
      if (!otherMetrics || otherMetrics.loading || otherMetrics.error) {
        return { 
          ruleset: other, 
          score: null, 
          immutableMatchLabel: 'Loading...',
          sizeText: null,
          error: otherMetrics?.error || 'Loading...' 
        };
      }

      const score = calculateJaccardSimilarity(currentMetrics.wordSet, otherMetrics.wordSet);
      const isMatch = currentMetrics.hasImmutable === otherMetrics.hasImmutable;
      
      let immutableMatchLabel = '';
      if (isMatch) {
        immutableMatchLabel = currentMetrics.hasImmutable ? 'also yes' : 'also no';
      } else {
        immutableMatchLabel = 'differs';
      }

      const sizeText = formatSizeComparison(currentMetrics.words, otherMetrics.words);

      return { 
        ruleset: other, 
        score, 
        immutableMatchLabel,
        sizeText,
        error: null 
      };
    });
  }, [currentRuleset, currentMetrics, dataMap]);

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
        <p style={{ color: '#dc2626' }}>Error loading {currentRuleset.name}: {currentMetrics.error}</p>
      ) : (
        <div>
          {/* Header Info */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h2>{currentRuleset.name}</h2>
            <div style={{ display: 'flex', gap: '1rem' }}>
              <a href={currentRuleset.homeUrl} target="_blank" rel="noreferrer" style={{ color: '#2563eb', textDecoration: 'underline' }}>
                View Game ↗
              </a>
              <a href={currentRuleset.linkUrl} target="_blank" rel="noreferrer" style={{ color: '#2563eb', textDecoration: 'underline' }}>
                View Ruleset ↗
              </a>
            </div>
          </div>

          {/* Similarity Analysis Section */}
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', padding: '1.5rem', borderRadius: '8px', marginBottom: '2rem' }}>
            <h3 style={{ marginTop: 0 }}>Similarity to Other Nomics</h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {comparisons.map(({ ruleset, score, immutableMatchLabel, sizeText, error }) => (
                <div key={ruleset.id} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', borderBottom: '1px solid #f1f5f9', paddingBottom: '0.75rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.95rem' }}>
                    <span style={{ fontWeight: 'bold' }}>{ruleset.name}</span>
                    <span>{score !== null ? `${score.toFixed(1)}% match` : error}</span>
                  </div>

                  {/* Percentage Bar */}
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

                  {/* Immutability & Size details moved under the bar */}
                  {score !== null && (
                    <div style={{ textAlign: 'left', fontSize: '0.85rem', color: '#475569' }}>
                      Immutability: <strong style={{ color: '#0f172a' }}>{immutableMatchLabel}</strong>
                      {sizeText !== null && ` | Size: ${sizeText}`}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Core Metrics Totals */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
            <div style={{ background: '#f8fafc', padding: '1rem', border: '1px solid #e2e8f0', borderRadius: '6px' }}>
              <div style={{ fontSize: '0.85rem', color: '#64748b' }}>Immutable Rules</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#0f172a' }}>
                {currentMetrics.hasImmutable ? 'Yes' : 'No'}
              </div>
            </div>
            <div style={{ background: '#f8fafc', padding: '1rem', border: '1px solid #e2e8f0', borderRadius: '6px' }}>
              <div style={{ fontSize: '0.85rem', color: '#64748b' }}>Total Words</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{currentMetrics.words.toLocaleString()}</div>
            </div>
            <div style={{ background: '#f8fafc', padding: '1rem', border: '1px solid #e2e8f0', borderRadius: '6px' }}>
              <div style={{ fontSize: '0.85rem', color: '#64748b' }}>Total Characters</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{currentMetrics.characters.toLocaleString()}</div>
            </div>
            <div style={{ background: '#f8fafc', padding: '1rem', border: '1px solid #e2e8f0', borderRadius: '6px' }}>
              <div style={{ fontSize: '0.85rem', color: '#64748b' }}>Total Lines</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{currentMetrics.lines.toLocaleString()}</div>
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