import React, { useState, useEffect, useCallback, useMemo } from 'react';
import ReactDOM from 'react-dom/client';
import styles from './Dice.module.css';

// NIST Beacon 2.0 API Payload Type Definition
interface NistPulse {
  uri: string;
  version: string;
  cipherSuite: number;
  period: number;
  timeStamp: string;
  certificateId: string;
  outputValue: string; // 512-bit hex output
  statusCode: number;
}

interface NistBeaconResponse {
  pulse: NistPulse;
}

interface AttemptRecord {
  attemptIndex: number;
  hexSlice: string;
  decimalValue: string;
  accepted: boolean;
}

interface IndividualDieResult {
  dieIndex: number;
  bigIntValue: string;
  moduloResult: string;
  finalRandomValue: string;
  usedHexSlice: string;
  attemptsLog: AttemptRecord[];
}

interface CalculationDetails {
  pulseTimestampUtc: string;
  pulseUri: string;
  hexOutput: string;
  min: string;
  max: string;
  diceCount: number;
  rangeSpan: string;
  hexCharsNeeded: string;
  limit: string;
  capacity: string;
  totalAttempts: string;
  diceResults: IndividualDieResult[];
  totalSum: string;
  totalProduct: string;
}

interface ScheduledRoll {
  targetTimestampMs: number;
  targetDateUtc: string;
  pulseUri: string;
  shareableUrl: string;
}

// NIST pulse generation, signing & CDN propagation delay buffer in ms (30 seconds)
const NIST_DELAY_OFFSET_MS = 30 * 1000;

/**
 * Gets the browser's local timezone or falls back to UTC.
 */
const detectUserTimezone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

/**
 * Parses components of a date string formatted as "YYYY-MM-DDTHH:mm" in a target timezone.
 */
const parseDateTimeInTimezone = (dateTimeStr: string, timeZone: string): number => {
  if (!dateTimeStr) return NaN;
  const [datePart, timePart] = dateTimeStr.split('T');
  if (!datePart || !timePart) return NaN;

  const [year, month, day] = datePart.split('-').map(Number);
  const [hours, minutes] = timePart.split(':').map(Number);

  // Fallback to UTC simple parsing if UTC selected
  if (timeZone === 'UTC') {
    return Date.UTC(year, month - 1, day, hours, minutes);
  }

  // Target local wall time assumption in UTC initially
  const targetUtcAttempt = Date.UTC(year, month - 1, day, hours, minutes);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(new Date(targetUtcAttempt));
  const partMap: Record<string, string> = {};
  parts.forEach((p) => {
    if (p.type !== 'literal') partMap[p.type] = p.value;
  });

  // Calculate local timezone offset difference relative to target wall-clock
  const formattedHour = partMap.hour === '24' ? 0 : parseInt(partMap.hour, 10);
  const formattedAsDate = Date.UTC(
    parseInt(partMap.year, 10),
    parseInt(partMap.month, 10) - 1,
    parseInt(partMap.day, 10),
    formattedHour,
    parseInt(partMap.minute, 10)
  );

  const offsetMs = formattedAsDate - targetUtcAttempt;
  return targetUtcAttempt - offsetMs;
};

/**
 * Formats a Date object into "YYYY-MM-DDTHH:mm" for datetime-local input based on a given timezone.
 */
const formatDateTimeInputForTimezone = (date: Date, timeZone: string): string => {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const p: Record<string, string> = {};
  parts.forEach((part) => {
    if (part.type !== 'literal') p[part.type] = part.value;
  });

  const hourStr = p.hour === '24' ? '00' : p.hour;
  return `${p.year}-${p.month}-${p.day}T${hourStr}:${p.minute}`;
};

export default function Dice(): React.ReactElement {
  // Detect local timezone once during initialization
  const [selectedTimezone, setSelectedTimezone] = useState<string>(detectUserTimezone);

  const [dateTimeInput, setDateTimeInput] = useState<string>(() =>
    formatDateTimeInputForTimezone(new Date(Date.now() + 1 * 60 * 1000), selectedTimezone)
  );

  const [min, setMin] = useState<number | string>(1);
  const [max, setMax] = useState<number | string>(6);
  const [diceCount, setDiceCount] = useState<number | string>(2);

  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [scheduledRoll, setScheduledRoll] = useState<ScheduledRoll | null>(null);
  const [timeRemainingSeconds, setTimeRemainingSeconds] = useState<number | null>(null);
  const [data, setData] = useState<CalculationDetails | null>(null);
  const [copied, setCopied] = useState<boolean>(false);

  // List of standard supported IANA Timezones
  const availableTimezones = useMemo(() => {
    try {
      return Intl.supportedValuesOf('timeZone');
    } catch {
      return ['UTC', 'America/New_York', 'America/Los_Angeles', 'Europe/London', 'Asia/Tokyo'];
    }
  }, []);

  const formatUtcDisplay = (dateStrOrMs: string | number): string => {
    const date = new Date(dateStrOrMs);
    return isNaN(date.getTime()) ? '' : `${date.toUTCString()} (UTC)`;
  };

  const formatSelectedTimezoneDisplay = (timestampMs: number): string => {
    if (isNaN(timestampMs)) return '';
    const date = new Date(timestampMs);
    return `${date.toLocaleString('en-US', { timeZone: selectedTimezone, timeZoneName: 'short' })}`;
  };

  const handleCopyUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const textArea = document.createElement('textarea');
      textArea.value = url;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const executeRoll = useCallback(
    async (
      targetMs: number,
      minVal: string | number,
      maxVal: string | number,
      numDiceVal: string | number
    ) => {
      setLoading(true);
      setError(null);
      setData(null);
      setScheduledRoll(null);

      const minNum = BigInt(minVal);
      const maxNum = BigInt(maxVal);
      const count = Math.max(1, parseInt(numDiceVal.toString(), 10) || 1);

      if (minNum >= maxNum) {
        setError('Minimum value must be strictly less than maximum value.');
        setLoading(false);
        return;
      }

      try {
        if (isNaN(targetMs)) {
          throw new Error('Invalid date/time timestamp.');
        }

        const expectedPulseUri = `https://beacon.nist.gov/beacon/2.0/pulse/time/${targetMs}`;
        const searchParams = new URLSearchParams({
          timestamp: targetMs.toString(),
          min: minVal.toString(),
          max: maxVal.toString(),
          diceCount: count.toString(),
        });
        const currentShareableUrl = `${window.location.origin}${window.location.pathname}?${searchParams.toString()}`;

        const now = Date.now();
        const targetAvailableTimeMs = targetMs + NIST_DELAY_OFFSET_MS;

        if (now < targetAvailableTimeMs) {
          setScheduledRoll({
            targetTimestampMs: targetMs,
            targetDateUtc: formatUtcDisplay(targetMs),
            pulseUri: expectedPulseUri,
            shareableUrl: currentShareableUrl,
          });
          setLoading(false);
          return;
        }

        const response = await fetch(expectedPulseUri);

        if (response.status === 404) {
          setScheduledRoll({
            targetTimestampMs: targetMs,
            targetDateUtc: formatUtcDisplay(targetMs),
            pulseUri: expectedPulseUri,
            shareableUrl: currentShareableUrl,
          });
          setLoading(false);
          return;
        }

        if (!response.ok) {
          throw new Error(`NIST API error: ${response.status} ${response.statusText}`);
        }

        const pulseData: NistBeaconResponse = await response.json();
        const pulse = pulseData.pulse;

        if (!pulse?.outputValue) {
          throw new Error('Invalid or empty pulse response from NIST Beacon.');
        }

        const hexOutput = pulse.outputValue.trim().toLowerCase();

        const rangeSpan = maxNum - minNum + 1n;
        const maxOffsetIndex = rangeSpan - 1n;
        const bitLength = BigInt(maxOffsetIndex.toString(2).length);
        const hexCharsNeeded = Number((bitLength + 3n) / 4n);
        const sliceMaxCapacity = 1n << BigInt(hexCharsNeeded * 4);
        const limit = (sliceMaxCapacity / rangeSpan) * rangeSpan;

        const diceResults: IndividualDieResult[] = [];
        let globalAttemptCount = 0;
        let currentHexIndex = 0;
        let totalSum = 0n;
        let totalProduct = 1n;

        for (let dieIdx = 1; dieIdx <= count; dieIdx++) {
          let selectedOffset: bigint | null = null;
          let usedHexSlice = '';
          let bigIntValue = 0n;
          const attemptsLog: AttemptRecord[] = [];

          while (currentHexIndex + hexCharsNeeded <= hexOutput.length) {
            globalAttemptCount++;
            const slice = hexOutput.substring(currentHexIndex, currentHexIndex + hexCharsNeeded);
            currentHexIndex += hexCharsNeeded;

            const val = BigInt(`0x${slice}`);
            const isAccepted = val < limit;

            attemptsLog.push({
              attemptIndex: globalAttemptCount,
              hexSlice: slice,
              decimalValue: val.toString(),
              accepted: isAccepted,
            });

            if (isAccepted) {
              selectedOffset = val % rangeSpan;
              usedHexSlice = slice;
              bigIntValue = val;
              break;
            }
          }

          if (selectedOffset === null) {
            throw new Error(
              `Rejection sampling exhausted available hex slices after ${globalAttemptCount} total attempt(s) across ${count} dice.`
            );
          }

          const dieFinalValue = minNum + selectedOffset;
          totalSum += dieFinalValue;
          totalProduct *= dieFinalValue;

          diceResults.push({
            dieIndex: dieIdx,
            bigIntValue: bigIntValue.toString(),
            moduloResult: selectedOffset.toString(),
            finalRandomValue: dieFinalValue.toString(),
            usedHexSlice,
            attemptsLog,
          });
        }

        setData({
          pulseTimestampUtc: formatUtcDisplay(pulse.timeStamp),
          pulseUri: expectedPulseUri,
          hexOutput: hexOutput,
          min: minNum.toString(),
          max: maxNum.toString(),
          diceCount: count,
          rangeSpan: rangeSpan.toString(),
          hexCharsNeeded: hexCharsNeeded.toString(),
          limit: limit.toString(),
          capacity: sliceMaxCapacity.toString(),
          totalAttempts: globalAttemptCount.toString(),
          diceResults,
          totalSum: totalSum.toString(),
          totalProduct: totalProduct.toString(),
        });
      } catch (err: unknown) {
        if (err instanceof Error) {
          setError(err.message);
        } else {
          setError('An unexpected error occurred while processing.');
        }
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const timestampParam = params.get('timestamp');
    const minParam = params.get('min');
    const maxParam = params.get('max');
    const countParam = params.get('diceCount');

    if (timestampParam) {
      const parsedMs = parseInt(timestampParam, 10);
      if (!isNaN(parsedMs)) {
        const parsedDate = new Date(parsedMs);
        setDateTimeInput(formatDateTimeInputForTimezone(parsedDate, selectedTimezone));

        const activeMin = minParam !== null ? minParam : min;
        const activeMax = maxParam !== null ? maxParam : max;
        const activeCount = countParam !== null ? countParam : diceCount;

        if (minParam !== null) setMin(minParam);
        if (maxParam !== null) setMax(maxParam);
        if (countParam !== null) setDiceCount(countParam);

        executeRoll(parsedMs, activeMin, activeMax, activeCount);
      }
    }
  }, [executeRoll, selectedTimezone]);

  const handleTimezoneChange = (newTz: string) => {
    const currentMs = parseDateTimeInTimezone(dateTimeInput, selectedTimezone);
    setSelectedTimezone(newTz);
    if (!isNaN(currentMs)) {
      setDateTimeInput(formatDateTimeInputForTimezone(new Date(currentMs), newTz));
    }
  };

  const handleFetchAndCalculate = async (
    e: React.FormEvent<HTMLFormElement>
  ): Promise<void> => {
    e.preventDefault();
    const timestampMs = parseDateTimeInTimezone(dateTimeInput, selectedTimezone);

    if (isNaN(timestampMs)) {
      setError('Invalid date/time selection.');
      return;
    }

    const searchParams = new URLSearchParams(window.location.search);
    searchParams.set('timestamp', timestampMs.toString());
    searchParams.set('min', min.toString());
    searchParams.set('max', max.toString());
    searchParams.set('diceCount', diceCount.toString());

    const newUrl = `${window.location.pathname}?${searchParams.toString()}`;
    window.history.pushState({ path: newUrl }, '', newUrl);

    executeRoll(timestampMs, min, max, diceCount);
  };

  const addTenMinutesToCurrentInput = (): void => {
    const currentMs = parseDateTimeInTimezone(dateTimeInput, selectedTimezone);
    const targetMs = isNaN(currentMs) ? Date.now() + 10 * 60 * 1000 : currentMs + 10 * 60 * 1000;
    setDateTimeInput(formatDateTimeInputForTimezone(new Date(targetMs), selectedTimezone));
  };

  useEffect(() => {
    if (!scheduledRoll) {
      setTimeRemainingSeconds(null);
      return;
    }

    const updateCountdown = () => {
      const availabilityTimeMs = scheduledRoll.targetTimestampMs + NIST_DELAY_OFFSET_MS;
      const diffMs = availabilityTimeMs - Date.now();
      if (diffMs <= 0) {
        setTimeRemainingSeconds(0);
      } else {
        setTimeRemainingSeconds(Math.ceil(diffMs / 1000));
      }
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [scheduledRoll]);

  const formatCountdownText = (seconds: number | null): string => {
    if (seconds === null) return '';
    if (seconds <= 0) return 'Pulse available now! Click below to fetch.';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins > 0) {
      return `${mins}m ${secs}s remaining (incl. ~30s NIST release buffer)`;
    }
    return `${secs}s remaining (incl. ~30s NIST release buffer)`;
  };

  const isScheduledRollDisabled =
    timeRemainingSeconds !== null && timeRemainingSeconds > 0;

  const currentParsedTimestamp = parseDateTimeInTimezone(dateTimeInput, selectedTimezone);

  return (
    <div className={styles.container}>
      {/* Top Navigation */}
      <nav className={styles.topNav}>
        <a href="/" className={styles.backLink}>
          ← Back to Ruleset Comparison
        </a>
      </nav>

      <header className={styles.header}>
        <h1 className={styles.title}>NIST Beacon 2.0 Dice Roller</h1>
        <p className={styles.subtext}>
          Fetches public entropy from the{' '}
          <a
            href="https://csrc.nist.gov/projects/interoperable-randomness-beacons/beacon-20"
            target="_blank"
            rel="noopener noreferrer"
          >
            NIST Randomness Beacon
          </a>{' '}
          and maps it to your specified range.
        </p>
      </header>

      {/* Why NIST is Great for Nomic */}
      <section className={styles.nomicInfoCard}>
        <h2 className={styles.nomicTitle}>🎲 Why Use This for Online Nomic?</h2>
        <ul className={styles.nomicList}>
          <li>
            <strong>Pre-Commitment Mechanism:</strong> Players can agree on a target UTC timestamp <em>in advance</em> (e.g., "The turn 14 roll will use the NIST pulse at 18:00 UTC"). Because the future pulse output is mathematically unpredictable by anyone prior to release, no player can choose when to roll or delete roll based on favorable odds.
          </li>
          <li>
            <strong>Asynchronous Friendly:</strong> Ideal for play-by-forum or play-by-mail Nomic. Anyone can independently calculate and verify the exact same outcome from the NIST archive using the exact deterministic formula shown after a successful roll.
          </li>
          <li>
            <strong>Verifiable & Anti-Cheat:</strong> NIST pulses are cryptographically signed using RSA/SHA-512 by a government agency, making them impossible to alter if you have no control over the agency.
          </li>
        </ul>
      </section>

      {/* Input Form */}
      <form onSubmit={handleFetchAndCalculate} className={styles.form}>
        <div className={styles.inputGroup}>
          <div className={styles.labelRow}>
            <label className={styles.label}>Select Timezone:</label>
          </div>
          <select
            value={selectedTimezone}
            onChange={(e) => handleTimezoneChange(e.target.value)}
            className={styles.input}
          >
            {!availableTimezones.includes('UTC') && <option value="UTC">UTC</option>}
            {availableTimezones.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.inputGroup}>
          <div className={styles.labelRow}>
            <label className={styles.label}>Select Target Timestamp:</label>
            <span className={styles.utcBadge}>{selectedTimezone}</span>
          </div>
          <div className={styles.timestampRow}>
            <input
              type="datetime-local"
              value={dateTimeInput}
              onChange={(e) => setDateTimeInput(e.target.value)}
              required
              className={styles.input}
            />
            <button
              type="button"
              onClick={addTenMinutesToCurrentInput}
              className={styles.quickSelectBtn}
              title="Add 10 minutes to current selection"
            >
              +10 Min
            </button>
          </div>
          <span className={styles.helpText}>
            Selected Local: {formatSelectedTimezoneDisplay(currentParsedTimestamp)}
            <br />
            Converted UTC: {formatUtcDisplay(currentParsedTimestamp)}
          </span>
        </div>

        <div className={styles.row}>
          <div className={styles.inputGroup}>
            <label className={styles.label}>Number of Dice:</label>
            <input
              type="number"
              min="1"
              max="50"
              value={diceCount}
              onChange={(e) => setDiceCount(e.target.value)}
              required
              className={styles.input}
            />
          </div>

          <div className={styles.inputGroup}>
            <label className={styles.label}>Range Min (Per Die):</label>
            <input
              type="number"
              value={min}
              onChange={(e) => setMin(e.target.value)}
              required
              className={styles.input}
            />
          </div>

          <div className={styles.inputGroup}>
            <label className={styles.label}>Range Max (Per Die):</label>
            <input
              type="number"
              value={max}
              onChange={(e) => setMax(e.target.value)}
              required
              className={styles.input}
            />
          </div>
        </div>

        <button type="submit" disabled={loading} className={styles.button}>
          {loading ? 'Fetching Beacon Data...' : 'Roll Dice / Generate'}
        </button>
      </form>

      {/* Errors */}
      {error && <div className={styles.errorCard}>{error}</div>}

      {/* Future Roll Scheduled Card */}
      {scheduledRoll && (
        <div className={styles.scheduledCard}>
          <div className={styles.scheduledHeader}>
            <span className={styles.scheduledBadge}>Scheduled Roll (UTC)</span>
          </div>
     
          {timeRemainingSeconds !== null && (
            <div className={styles.countdownBox}>
              ⏱️ {formatCountdownText(timeRemainingSeconds)}
            </div>
          )}
 
          <div className={styles.sectionSpacing}>
            <strong>Share following url with players in advance:</strong>
            <div className={styles.copyUrlRow}>
              <a
                href={scheduledRoll.shareableUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={`${styles.backLink} ${styles.truncatedLink}`}
              >
                <code className={styles.inlineCode}>{scheduledRoll.shareableUrl}</code>
              </a>
              <button
                type="button"
                onClick={() => handleCopyUrl(scheduledRoll.shareableUrl)}
                className={styles.copyBtn}
                title="Copy URL to clipboard"
              >
                {copied ? '✓ Copied!' : '📋 Copy URL'}
              </button>
            </div>
          </div>

      

          <button
            onClick={() => executeRoll(scheduledRoll.targetTimestampMs, min, max, diceCount)}
            disabled={loading || isScheduledRollDisabled}
            className={`${styles.button} ${styles.fullWidthBtn} ${
              isScheduledRollDisabled ? styles.disabledBtn : ''
            }`}
          >
            {isScheduledRollDisabled
              ? 'Pulse Not Available (Waiting for target timestamp + NIST delay)'
              : 'Fetch Verifiable Pulse Now'}
          </button>

          <p className={styles.scheduledNote}>
            NIST generates pulses every 60 seconds (aligned to UTC minute boundaries) with a ~30 second delay for digital signing and distribution.
          </p>
          <div className={styles.subSectionSpacing}>
  <strong>Target Pulse URI:</strong>{' '}
  <div className={styles.noticeBox}>
    ℹ️ <strong>Note:</strong> Accessing the NIST URI above prior to release will display{' '}
    <code className={styles.inlineCode}>&quot;Pulse Not Available.&quot;</code> until the countdown expires.
  </div>
  <a
    href={scheduledRoll.pulseUri}
    target="_blank"
    rel="noopener noreferrer"
    className={styles.backLink}
  >
    <code className={styles.inlineCode}>{scheduledRoll.pulseUri}</code>
  </a>
</div>

        </div>
      )}

      {/* Results & Calculations */}
      {data && (
        <div className={styles.resultsContainer}>
          {/* Prominent Result Header */}
          <div className={styles.resultBadge}>
            <span className={styles.badgeLabel}>
              {data.diceCount > 1 ? `Final Random Roll (${data.diceCount} Dice)` : 'Final Random Roll'}
            </span>

            {/* Individual Dice Rectangles Grid with Blue Accented Values */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
                gap: '0.75rem',
                margin: '1rem 0',
                width: '100%',
              }}
            >
              {data.diceResults.map((die) => (
                <div
                  key={die.dieIndex}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '0.75rem 0.5rem',
                    backgroundColor: 'rgba(255, 255, 255, 0.08)',
                    border: '1px solid rgba(59, 130, 246, 0.4)',
                    borderRadius: '8px',
                    boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
                  }}
                >
                  <span
                    style={{
                      fontSize: '0.75rem',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      opacity: 0.8,
                      marginBottom: '0.25rem',
                    }}
                  >
                    Die #{die.dieIndex}
                  </span>
                  <span
                    style={{
                      fontSize: '2.25rem',
                      fontWeight: 'bold',
                      color: '#3b82f6',
                      lineHeight: 1,
                    }}
                  >
                    {die.finalRandomValue}
                  </span>
                  <span
                    style={{
                      fontSize: '0.7rem',
                      opacity: 0.6,
                      marginTop: '0.35rem',
                      fontFamily: 'monospace',
                    }}
                  >
                    0x{die.usedHexSlice}
                  </span>
                </div>
              ))}
            </div>

            {/* Math Aggregations (Sum & Product) */}
            {data.diceCount > 1 && (
              <div
                style={{
                  display: 'flex',
                  gap: '1.5rem',
                  justifyContent: 'center',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  marginTop: '0.5rem',
                  padding: '0.5rem 1rem',
                  background: 'rgba(0, 0, 0, 0.15)',
                  borderRadius: '6px',
                }}
              >
                <span className={styles.badgeSubtext}>
                  Sum (Σ): <strong style={{ color: '#60a5fa', fontSize: '1.1rem' }}>{data.totalSum}</strong>
                </span>
                <span className={styles.badgeSubtext}>
                  Product (∏): <strong style={{ color: '#60a5fa', fontSize: '1.1rem' }}>{data.totalProduct}</strong>
                </span>
              </div>
            )}

            <span className={styles.badgeSubtext} style={{ marginTop: '0.75rem' }}>
              Valid range per die: [{data.min} to {data.max}]
            </span>
          </div>

          {/* Section 1: NIST Source Data */}
          <div className={styles.card}>
            <h3 className={styles.cardTitle}>1. NIST Pulse Entropy Source</h3>
            <div className={styles.detailRow}>
              <strong>Pulse Time (UTC):</strong> <span>{data.pulseTimestampUtc}</span>
            </div>
            <div className={styles.detailRow}>
              <strong>Verification URI:</strong>{' '}
              <a
                href={data.pulseUri}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.backLink}
              >
                <code className={styles.inlineCode}>{data.pulseUri}</code>
              </a>
            </div>
            <div className={styles.rawHexBlock}>
              <strong>Raw 512-bit Hex Output (64 bytes):</strong>
              <code className={styles.codeBlock}>{data.hexOutput}</code>
            </div>
          </div>

          {/* Section 2: Step-by-Step Unbiased Calculation */}
          <div className={styles.card}>
            <h3 className={styles.cardTitle}>2. Cryptographic Mapping & Verification</h3>
            <p className={styles.sectionExplainer}>
              To guarantee fair outcomes without <strong>Modulo Bias</strong>, we use <em>rejection sampling</em>. 
              We slice minimal hex chunks from the 512-bit output and reject values falling into uneven remainder zones.
            </p>

            {/* Step A */}
            <div className={styles.stepBox}>
              <div className={styles.stepHeader}>
                <span className={styles.stepBadge}>Step A</span>
                <strong>Determine Range & Minimal Hex Chunk Size</strong>
              </div>
              <p className={styles.stepDescription}>
                Calculate the span N and find the minimum number of hex characters needed to represent N - 1.
              </p>
              <div className={styles.formulaBlock}>
                <div>Span (N) = Max - Min + 1 = <strong>{data.rangeSpan}</strong> possible values</div>
                <div>Hex Characters Needed = <strong>{data.hexCharsNeeded}</strong> char(s) (1 char = 4 bits)</div>
                <div>Maximum Chunk Capacity (16<sup>{data.hexCharsNeeded}</sup>) = <strong>{data.capacity}</strong></div>
              </div>
            </div>

            {/* Step B */}
            <div className={styles.stepBox}>
              <div className={styles.stepHeader}>
                <span className={styles.stepBadge}>Step B</span>
                <strong>Calculate Unbiased Rejection Limit</strong>
              </div>
              <p className={styles.stepDescription}>
                The rejection limit is the largest multiple of N that fits within total capacity. 
                Values strictly less than this limit guarantee equal probability for every number.
              </p>
              <div className={styles.formulaBlock}>
                <div>Limit = floor(Capacity / N) × N</div>
                <div>Limit = floor({data.capacity} / {data.rangeSpan}) × {data.rangeSpan} = <strong>{data.limit}</strong></div>
              </div>
            </div>

            {/* Step C & D Per Die */}
            {data.diceResults.map((die) => (
              <div key={die.dieIndex} className={styles.stepBox}>
                <div className={styles.stepHeader}>
                  <span className={styles.stepBadge}>Die #{die.dieIndex}</span>
                  <strong>Rejection Sampling & Range Mapping</strong>
                </div>

                <div className={styles.attemptsContainer}>
                  {die.attemptsLog.map((attempt) => (
                    <div
                      key={attempt.attemptIndex}
                      className={`${styles.formulaBlock} ${
                        attempt.accepted ? styles.acceptedBlock : styles.rejectedBlock
                      }`}
                    >
                      <div>
                        <strong>Attempt #{attempt.attemptIndex}:</strong> Chunk <code className={styles.inlineCode}>"0x{attempt.hexSlice}"</code> → Decimal (X) = <strong>{attempt.decimalValue}</strong>
                      </div>
                      <div className={styles.statusCheck}>
                        Validation: {attempt.decimalValue} {attempt.accepted ? '<' : '≮'} {data.limit}{' '}
                        {attempt.accepted ? (
                          <span className={styles.validBadge}>✓ ACCEPTED</span>
                        ) : (
                          <span className={styles.rejectedBadge}>✕ REJECTED (Modulo Bias)</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                <div className={styles.formulaBlock} style={{ marginTop: '0.75rem' }}>
                  <div>Offset Index = X mod N = {die.bigIntValue} mod {data.rangeSpan} = <strong>{die.moduloResult}</strong></div>
                  <div>Die #{die.dieIndex} Result = Min + Offset = {data.min} + {die.moduloResult} = <strong className={styles.finalHighlight} style={{ color: '#3b82f6' }}>{die.finalRandomValue}</strong></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Footer link */}
      <div className={styles.footer}>
        <a href="/" className={styles.backLink}>
          ← Back to Main App
        </a>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Dice />
  </React.StrictMode>
);