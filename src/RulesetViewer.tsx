import React, { useState } from 'react';
import { HELP_TEXTS } from './utils/rulesetAnalysis';

export interface Ruleset {
  id: string;
  name: string;
  category: string;
  homeUrl: string;
  linkUrl: string;
  fetchUrl: string;
}

export interface RulesetMetrics {
  words: number;
  characters: number;
  wordSet: Set<string>;
  wordCounts: Map<string, number>;
  lastModified?: string | null;
  loading?: boolean;
  error?: string | null;
  content?: string;
}

export interface ComparisonItem {
  ruleset: Ruleset;
  score: number | null;
  sizeText: string | null;
  indicatorColor: string;
  error: string | null;
}

interface RulesetViewerProps {
  rulesets: Ruleset[];
  groupedRulesets: Record<string, Ruleset[]>;
  currentRuleset: Ruleset;
  currentMetrics?: RulesetMetrics;
  activeTabId: string;
  relativeAge: string | null;
  dateColor: string;
  akaListWords: string[];
  topWords: { word: string; score: number; count: number }[];
  uniqueWordsWithCounts: { word: string; count: number }[];
  comparisons: ComparisonItem[];
  similarityFilter: 'All' | 'Games' | 'Templates';
  onSelectRuleset: (id: string) => void;
  onFilterChange: (filter: 'All' | 'Games' | 'Templates') => void;
  onExportTs: () => void;
}

export const RulesetViewer: React.FC<RulesetViewerProps> = ({
  groupedRulesets,
  currentRuleset,
  currentMetrics,
  activeTabId,
  relativeAge,
  dateColor,
  akaListWords,
  topWords,
  uniqueWordsWithCounts,
  comparisons,
  similarityFilter,
  onSelectRuleset,
  onFilterChange,
  onExportTs,
}) => {
  const [showRawText, setShowRawText] = useState<boolean>(false);
  const [showTopWordsHelp, setShowTopWordsHelp] = useState<boolean>(false);
  const [showUniqueWordsHelp, setShowUniqueWordsHelp] = useState<boolean>(false);
  const [selectedTopWord, setSelectedTopWord] = useState<string | null>(null);

  const handleRulesetClick = (id: string) => {
    setShowRawText(false);
    setSelectedTopWord(null);
    onSelectRuleset(id);
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
                        onClick={() => handleRulesetClick(ruleset.id)}
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
                        onClick={() => onFilterChange(filter)}
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
                              onClick={() => handleRulesetClick(ruleset.id)}
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
              onClick={onExportTs}
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
};